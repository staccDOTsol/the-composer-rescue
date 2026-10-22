#!/usr/bin/env python3
"""Read-only current-state simulations for Raydium CLMM fee/reward exits."""

import base64
import hashlib
import json
import struct
import time
import urllib.error
import urllib.request
from pathlib import Path

from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction


RPC = "https://api.mainnet-beta.solana.com"
PROGRAM = Pubkey.from_string("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
MEMO = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
PAYER = Pubkey.from_string("3fjFhpGqW4wSzhLzCZCV2CYLiLw5B98FxnQEDfujjijQ")
OUTPUT = Path("/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/raydium-clmm-remaining-exits-sim.json")

FEE_POOL = Pubkey.from_string("3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF")
FEE_CONFIG = Pubkey.from_string("9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x")
PROTOCOL_OWNER = Pubkey.from_string("projjosVCPQH49d5em7VYS7fJZzaqKixqKtus7yk416")
FUND_OWNER = Pubkey.from_string("FundHfY8oo8J9KYGyfXFFuQCHe7Z1VBNmsj84eMcdYs4")
VAULT_0 = Pubkey.from_string("AbcuyoPeYnddzFoFQudsiFka8qd6tTwvLgxwtpTKTpKC")
VAULT_1 = Pubkey.from_string("2n6fxuD6PA5NYgEnXXYMh2iWD1JBJ1LGf76kFJAayZmX")
MINT_0 = Pubkey.from_string("So11111111111111111111111111111111111111112")
MINT_1 = Pubkey.from_string("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")
RECIPIENT_0 = Pubkey.from_string("481cLrKhWdQP8Qvs6ZbHUdxdjqiraS3m3fTQQ4SXCf9C")
RECIPIENT_1 = Pubkey.from_string("2iVZ3HCepn76X18v4Cr5QbU6MebNTxVwYNHWTWWNSjQc")
FOREIGN_POOL = Pubkey.from_string("HpgV2jnzgrGfrZjeZGkHgTnEgRFAhtzCVuk3BRFTFJwk")

REWARD_POOL = Pubkey.from_string("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv")
REWARD_FUNDER = Pubkey.from_string("NCV2Uo3hfW5LSZXAJe19y6SpC5K98PuQwShCSZgTki3")
REWARD_DEST = Pubkey.from_string("4u5GmwvqKjeSRnaWnSnqU3DsdDV1mwD8YBn486LLF9rL")
REWARD_VAULT = Pubkey.from_string("HsBUudV9Y2Z2dJTieWFgK3zhrpX4ELvnfHcAwSBVqDGX")
REWARD_MINT = Pubkey.from_string("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R")
OTHER_RAY_VAULT = Pubkey.from_string("Es1U9B9ok4Pi9u9pfQjDXmDGA59FP47TkZvaEMQxrgUL")


def discriminator(name):
    return hashlib.sha256(("global:" + name).encode()).digest()[:8]


def rpc(method, params, retries=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                RPC, data=body, headers={"content-type": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
            if result.get("error"):
                raise RuntimeError(result["error"])
            return result["result"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == retries:
                raise
            retry_after = getattr(error, "headers", {}).get("Retry-After") if hasattr(error, "headers") else None
            time.sleep(float(retry_after) if retry_after else min(30, 2 ** attempt))


def fee_instruction(kind, owner, owner_signer=True, mutate=None):
    keys = [
        owner, FEE_POOL, FEE_CONFIG, VAULT_0, VAULT_1, MINT_0, MINT_1,
        RECIPIENT_0, RECIPIENT_1, TOKEN, TOKEN_2022,
    ]
    writable = [False, True, False, True, True, False, False, True, True, False, False]
    signers = [owner_signer] + [False] * 10
    if mutate:
        mutate(keys, signers)
    data = discriminator(kind) + struct.pack("<QQ", 1000, 1000)
    return Instruction(
        PROGRAM,
        data,
        [AccountMeta(key, signers[i], writable[i]) for i, key in enumerate(keys)],
    )


def reward_instruction(funder=REWARD_FUNDER, funder_signer=True, mutate=None, index=0):
    keys = [funder, REWARD_DEST, REWARD_POOL, REWARD_VAULT, REWARD_MINT, TOKEN, TOKEN_2022, MEMO]
    writable = [False, True, True, True, False, False, False, False]
    signers = [funder_signer] + [False] * 7
    if mutate:
        mutate(keys, signers)
    return Instruction(
        PROGRAM,
        discriminator("collect_remaining_rewards") + bytes([index]),
        [AccountMeta(key, signers[i], writable[i]) for i, key in enumerate(keys)],
    )


def decode_account(address, account):
    if account is None:
        return None
    data = base64.b64decode(account["data"][0])
    result = {"address": str(address), "owner": account["owner"], "dataLen": len(data)}
    if len(data) == 1544:
        result.update(
            protocolFees0=struct.unpack_from("<Q", data, 309)[0],
            protocolFees1=struct.unpack_from("<Q", data, 317)[0],
            fundFees0=struct.unpack_from("<Q", data, 1064)[0],
            fundFees1=struct.unpack_from("<Q", data, 1072)[0],
        )
        if address == REWARD_POOL:
            offset = 397
            result.update(
                rewardEnd=struct.unpack_from("<Q", data, offset + 9)[0],
                rewardLastUpdate=struct.unpack_from("<Q", data, offset + 17)[0],
                rewardTotalEmitted=struct.unpack_from("<Q", data, offset + 41)[0],
                rewardClaimed=struct.unpack_from("<Q", data, offset + 49)[0],
            )
    elif len(data) in (165, 182):
        result["tokenAmount"] = struct.unpack_from("<Q", data, 64)[0]
    return result


SNAPSHOT_ADDRESSES = [
    FEE_POOL, VAULT_0, VAULT_1, RECIPIENT_0, RECIPIENT_1,
    REWARD_POOL, REWARD_VAULT, REWARD_DEST, OTHER_RAY_VAULT,
]


def live_snapshot():
    result = rpc(
        "getMultipleAccounts",
        [[str(key) for key in SNAPSHOT_ADDRESSES], {"encoding": "base64", "commitment": "confirmed"}],
    )
    return {
        "slot": result["context"]["slot"],
        "accounts": [decode_account(key, account) for key, account in zip(SNAPSHOT_ADDRESSES, result["value"])],
    }


def simulate(name, instructions):
    message = Message.new_with_blockhash(instructions, PAYER, Hash.default())
    wire = base64.b64encode(bytes(Transaction.new_unsigned(message))).decode()
    result = rpc(
        "simulateTransaction",
        [
            wire,
            {
                "encoding": "base64",
                "sigVerify": False,
                "replaceRecentBlockhash": True,
                "commitment": "confirmed",
                "innerInstructions": True,
                "accounts": {
                    "encoding": "base64",
                    "addresses": [str(key) for key in SNAPSHOT_ADDRESSES],
                },
            },
        ],
    )
    value = result["value"]
    selected_logs = [
        line for line in value.get("logs") or []
        if "Instruction:" in line
        or "AnchorError" in line
        or "Error Code:" in line
        or "ProgramFailed" in line
        or "failed:" in line
        or "success" in line
        or "collect reward" in line
    ]
    return {
        "case": name,
        "contextSlot": result.get("context", {}).get("slot"),
        "err": value.get("err"),
        "unitsConsumed": value.get("unitsConsumed"),
        "logs": selected_logs,
        "innerInstructions": value.get("innerInstructions"),
        "postAccounts": [
            decode_account(key, account)
            for key, account in zip(SNAPSHOT_ADDRESSES, value.get("accounts") or [])
        ],
    }


def fee_cases(kind, authority):
    valid = fee_instruction(kind, authority)
    return [
        (f"{kind}_control", [valid]),
        (f"{kind}_twice_atomic", [valid, valid]),
        (
            f"{kind}_attacker_authority_and_destinations",
            [fee_instruction(kind, PAYER)],
        ),
        (
            f"{kind}_missing_authority_signature",
            [fee_instruction(kind, authority, owner_signer=False)],
        ),
        (
            f"{kind}_foreign_pool",
            [fee_instruction(kind, authority, mutate=lambda keys, _: keys.__setitem__(1, FOREIGN_POOL))],
        ),
        (
            f"{kind}_vaults_swapped",
            [fee_instruction(kind, authority, mutate=lambda keys, _: (keys.__setitem__(3, VAULT_1), keys.__setitem__(4, VAULT_0)))],
        ),
        (
            f"{kind}_mints_swapped",
            [fee_instruction(kind, authority, mutate=lambda keys, _: (keys.__setitem__(5, MINT_1), keys.__setitem__(6, MINT_0)))],
        ),
        (
            f"{kind}_recipient0_is_vault0",
            [fee_instruction(kind, authority, mutate=lambda keys, _: keys.__setitem__(7, VAULT_0))],
        ),
        (
            f"{kind}_recipient_mints_swapped",
            [fee_instruction(kind, authority, mutate=lambda keys, _: (keys.__setitem__(7, RECIPIENT_1), keys.__setitem__(8, RECIPIENT_0)))],
        ),
        (
            f"{kind}_token_programs_swapped",
            [fee_instruction(kind, authority, mutate=lambda keys, _: (keys.__setitem__(9, TOKEN_2022), keys.__setitem__(10, TOKEN)))],
        ),
        (
            f"{kind}_valid_then_unauthorized_atomic_rollback",
            [valid, fee_instruction(kind, PAYER)],
        ),
        (
            f"{kind}_unauthorized_then_valid_order",
            [fee_instruction(kind, PAYER), valid],
        ),
    ]


def main():
    before = live_snapshot()
    cases = []
    cases.extend(fee_cases("collect_protocol_fee", PROTOCOL_OWNER))
    cases.extend(fee_cases("collect_fund_fee", FUND_OWNER))
    valid_reward = reward_instruction()
    cases.extend(
        [
            ("collect_remaining_rewards_control", [valid_reward]),
            ("collect_remaining_rewards_twice_atomic", [valid_reward, valid_reward]),
            ("collect_remaining_rewards_attacker_authority", [reward_instruction(PAYER)]),
            ("collect_remaining_rewards_missing_signature", [reward_instruction(REWARD_FUNDER, False)]),
            (
                "collect_remaining_rewards_destination_substitution_authorized",
                [reward_instruction(mutate=lambda keys, _: keys.__setitem__(1, OTHER_RAY_VAULT))],
            ),
            (
                "collect_remaining_rewards_pool_substitution",
                [reward_instruction(mutate=lambda keys, _: keys.__setitem__(2, FEE_POOL))],
            ),
            (
                "collect_remaining_rewards_vault_substitution",
                [reward_instruction(mutate=lambda keys, _: keys.__setitem__(3, OTHER_RAY_VAULT))],
            ),
            (
                "collect_remaining_rewards_destination_is_vault",
                [reward_instruction(mutate=lambda keys, _: keys.__setitem__(1, REWARD_VAULT))],
            ),
            (
                "collect_remaining_rewards_mint_substitution",
                [reward_instruction(mutate=lambda keys, _: keys.__setitem__(4, MINT_0))],
            ),
            (
                "collect_remaining_rewards_token_programs_swapped",
                [reward_instruction(mutate=lambda keys, _: (keys.__setitem__(5, TOKEN_2022), keys.__setitem__(6, TOKEN)))],
            ),
            ("collect_remaining_rewards_index_oob", [reward_instruction(index=3)]),
            (
                "collect_remaining_rewards_valid_then_unauthorized_atomic_rollback",
                [valid_reward, reward_instruction(PAYER)],
            ),
            (
                "collect_remaining_rewards_unauthorized_then_valid_order",
                [reward_instruction(PAYER), valid_reward],
            ),
        ]
    )
    results = []
    for name, instructions in cases:
        results.append(simulate(name, instructions))
        time.sleep(0.35)
    output = {
        "transport": "read-only mainnet simulateTransaction; sigVerify=false; no sendTransaction",
        "before": before,
        "results": results,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"output": str(OUTPUT), "beforeSlot": before["slot"],
                      "cases": [{"case": row["case"], "err": row["err"],
                                 "unitsConsumed": row["unitsConsumed"]} for row in results]}, indent=2))


if __name__ == "__main__":
    main()
