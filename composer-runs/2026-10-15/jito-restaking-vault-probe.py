#!/usr/bin/env python3
"""Read-only mainnet simulations for Jito Vault withdrawal controls.

No transaction is submitted. The script uses simulateTransaction with signature
verification disabled so existing account keys can be represented without their
private keys; every mutation models the account-meta signer flags that a real
transaction would have to satisfy.
"""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction


PROGRAM = Pubkey.from_string("Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
SYSTEM = Pubkey.default()
POSITIVE_TICKET = Pubkey.from_string("BKyBEHxeV7QbwGBScyQBWuHXtt2w92pJ9Tx3gthRTGNV")
PREMATURE_TICKET = Pubkey.from_string("EfDpXjxPRVGVRaVMdMmmjuKsapwRsTY7Pr52cxrgbBio")
FOREIGN_TICKET = Pubkey.from_string("CctZZbTJdHMj1jQ1CjEd5ELp1i6La6YFppA6xWM1Gczf")


def load_rpc_url() -> str:
    candidates: dict[str, str] = {}
    for env_path in (Path("/tmp/composer-helius-only.env"), Path("/tmp/composer-helius-rpc.env")):
        if not env_path.is_file():
            continue
        for line in env_path.read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            if key.strip() in {"HEAVY_RPC_URL", "RPC_URL"}:
                candidates.setdefault(key.strip(), value.strip().strip("\"'"))
    for key in ("HEAVY_RPC_URL", "RPC_URL"):
        if candidates.get(key):
            return candidates[key]
    raise RuntimeError("RPC_URL was not found in the authorized environment files")


RPC_URL = load_rpc_url()


def rpc(method: str, params: list) -> dict:
    for attempt in range(5):
        request = urllib.request.Request(
            RPC_URL,
            data=json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
            ).encode(),
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = json.load(response)
            if payload.get("error"):
                raise RuntimeError(payload["error"])
            return payload["result"]
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


ACCOUNT_CACHE: dict[str, bytes] = {}


def account(pubkey: Pubkey) -> bytes:
    cached = ACCOUNT_CACHE.get(str(pubkey))
    if cached is not None:
        return cached
    value = rpc("getAccountInfo", [str(pubkey), {"encoding": "base64", "commitment": "finalized"}])["value"]
    if value is None:
        raise RuntimeError(f"missing account {pubkey}")
    decoded = base64.b64decode(value["data"][0])
    ACCOUNT_CACHE[str(pubkey)] = decoded
    return decoded


def ata(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [bytes(owner), bytes(TOKEN), bytes(mint)], ATA_PROGRAM
    )[0]


def decode_ticket(pubkey: Pubkey) -> dict:
    data = account(pubkey)
    if data[:8] != (7).to_bytes(8, "little"):
        raise RuntimeError(f"{pubkey} is not a withdrawal ticket")
    return {
        "pubkey": pubkey,
        "vault": Pubkey.from_bytes(data[8:40]),
        "staker": Pubkey.from_bytes(data[40:72]),
        "base": Pubkey.from_bytes(data[72:104]),
        "vrt_amount": int.from_bytes(data[104:112], "little"),
        "slot_unstaked": int.from_bytes(data[112:120], "little"),
    }


def decode_vault(pubkey: Pubkey) -> dict:
    data = account(pubkey)
    if data[:8] != (2).to_bytes(8, "little"):
        raise RuntimeError(f"{pubkey} is not a vault")
    return {
        "pubkey": pubkey,
        "vrt_mint": Pubkey.from_bytes(data[40:72]),
        "supported_mint": Pubkey.from_bytes(data[72:104]),
        "fee_wallet": Pubkey.from_bytes(data[696:728]),
        "mint_burn_admin": Pubkey.from_bytes(data[728:760]),
    }


CONFIG = Pubkey.find_program_address([b"config"], PROGRAM)[0]
CONFIG_DATA = account(CONFIG)
PROGRAM_FEE_WALLET = Pubkey.from_bytes(CONFIG_DATA[96:128])


def burn_instruction(ticket: dict, *, staker: Pubkey | None = None,
                     destination: Pubkey | None = None,
                     ticket_pubkey: Pubkey | None = None) -> Instruction:
    vault = decode_vault(ticket["vault"])
    staker = staker or ticket["staker"]
    ticket_pubkey = ticket_pubkey or ticket["pubkey"]
    destination = destination or ata(staker, vault["supported_mint"])
    metas = [
        AccountMeta(CONFIG, False, False),
        AccountMeta(vault["pubkey"], False, True),
        AccountMeta(ata(vault["pubkey"], vault["supported_mint"]), False, True),
        AccountMeta(vault["vrt_mint"], False, True),
        AccountMeta(staker, False, True),
        AccountMeta(destination, False, True),
        AccountMeta(ticket_pubkey, False, True),
        AccountMeta(ata(ticket_pubkey, vault["vrt_mint"]), False, True),
        AccountMeta(ata(vault["fee_wallet"], vault["vrt_mint"]), False, True),
        AccountMeta(ata(PROGRAM_FEE_WALLET, vault["vrt_mint"]), False, True),
        AccountMeta(TOKEN, False, False),
        AccountMeta(SYSTEM, False, False),
    ]
    if vault["mint_burn_admin"] != Pubkey.default():
        metas.append(AccountMeta(vault["mint_burn_admin"], True, False))
    return Instruction(PROGRAM, bytes([14]), metas)


def change_owner_instruction(ticket: dict, old_owner: Pubkey, new_owner: Pubkey) -> Instruction:
    return Instruction(
        PROGRAM,
        bytes([13]),
        [
            AccountMeta(CONFIG, False, False),
            AccountMeta(ticket["vault"], False, False),
            AccountMeta(ticket["pubkey"], False, True),
            AccountMeta(old_owner, True, False),
            AccountMeta(new_owner, False, False),
        ],
    )


def simulate(label: str, instructions: list[Instruction], payer: Pubkey) -> dict:
    blockhash = Hash.from_string(
        rpc("getLatestBlockhash", [{"commitment": "processed"}])["value"]["blockhash"]
    )
    message = Message.new_with_blockhash(instructions, payer, blockhash)
    transaction = Transaction.populate(
        message, [Signature.default() for _ in message.signer_keys()]
    )
    encoded = base64.b64encode(bytes(transaction)).decode()
    simulation = rpc(
        "simulateTransaction",
        [
            encoded,
            {
                "encoding": "base64",
                "sigVerify": False,
                "replaceRecentBlockhash": True,
                "commitment": "processed",
            },
        ],
    )
    value = simulation["value"]
    return {
        "label": label,
        "contextSlot": simulation["context"]["slot"],
        "err": value["err"],
        "unitsConsumed": value.get("unitsConsumed"),
        "logTail": (value.get("logs") or [])[-8:],
    }


positive = decode_ticket(POSITIVE_TICKET)
premature = decode_ticket(PREMATURE_TICKET)
vault = decode_vault(positive["vault"])

# The premature ticket belongs to the same vault and gives us another live
# staker with an existing supported-mint ATA. This lets the ticket-owner check,
# rather than an earlier missing-account check, reject the mutation.
wrong_owner = premature["staker"]
foreign_ticket = FOREIGN_TICKET

positive_ix = burn_instruction(positive)
tests = [
    simulate("positive matured withdrawal", [positive_ix], positive["staker"]),
    simulate(
        "wrong ticket owner",
        [burn_instruction(positive, staker=wrong_owner)],
        wrong_owner,
    ),
    simulate(
        "destination aliases vault custody ATA",
        [
            burn_instruction(
                positive,
                destination=ata(vault["pubkey"], vault["supported_mint"]),
            )
        ],
        positive["staker"],
    ),
    simulate(
        "foreign-vault ticket substitution",
        [burn_instruction(positive, ticket_pubkey=foreign_ticket)],
        positive["staker"],
    ),
    simulate(
        "premature withdrawal",
        [burn_instruction(premature)],
        premature["staker"],
    ),
    simulate(
        "same-transaction duplicate burn",
        [positive_ix, positive_ix],
        positive["staker"],
    ),
    simulate(
        "unauthorized withdrawal-ticket owner change",
        [change_owner_instruction(positive, wrong_owner, wrong_owner)],
        wrong_owner,
    ),
]

print(
    json.dumps(
        {
            "program": str(PROGRAM),
            "positiveTicket": {
                "pubkey": str(positive["pubkey"]),
                "vault": str(positive["vault"]),
                "staker": str(positive["staker"]),
                "vrtAmount": positive["vrt_amount"],
                "slotUnstaked": positive["slot_unstaked"],
            },
            "prematureTicket": {
                "pubkey": str(premature["pubkey"]),
                "slotUnstaked": premature["slot_unstaked"],
            },
            "tests": tests,
        },
        indent=2,
    )
)
