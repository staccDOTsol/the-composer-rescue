"""Read-only simulateTransaction controls and mutations for Raydium CPMM withdrawals."""
import base64
import json
import os
import struct
from pathlib import Path

import requests
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import MessageV0
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction

DIR = Path(__file__).parent
RPC = os.environ.get("RPC_URL") or os.environ.get("HEAVY_RPC_URL")
PROGRAM = Pubkey.from_string("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C")
SYSTEM = "11111111111111111111111111111111"
TOKEN_OWNERS = {
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
}
HISTORY = json.loads((DIR / "raydium-cpmm-history-samples.json").read_text())
WITHDRAWS = [row for row in HISTORY["samples"] if row["instruction"]["name"] == "withdraw"]


def call(method, params):
    response = requests.post(
        RPC,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=45,
    )
    response.raise_for_status()
    body = response.json()
    if body.get("error"):
        raise RuntimeError(body["error"])
    return body["result"]


def account_rows(addresses):
    result = call("getMultipleAccounts", [addresses, {"encoding": "base64", "commitment": "processed"}])
    rows = []
    for address, item in zip(addresses, result["value"]):
        if not item:
            rows.append({"address": address, "exists": False})
            continue
        data = base64.b64decode(item["data"][0])
        row = {
            "address": address,
            "exists": True,
            "programOwner": item["owner"],
            "dataLength": len(data),
        }
        if len(data) >= 72 and item["owner"] in TOKEN_OWNERS:
            row.update(
                {
                    "mint": str(Pubkey.from_bytes(data[:32])),
                    "tokenAuthority": str(Pubkey.from_bytes(data[32:64])),
                    "rawAmount": str(struct.unpack_from("<Q", data, 64)[0]),
                }
            )
        rows.append(row)
    return {"slot": result["context"]["slot"], "rows": rows}


def make_ix(sample, amount, updates=None):
    definition = sample["instruction"]
    metas = []
    for index, item in enumerate(definition["accounts"]):
        address = (updates or {}).get(index, item["address"])
        # The observed instruction was an inner CPI whose owner was signed by its
        # calling program. Replaying it at top level requires the owner signer bit.
        signer = True if index == 0 else item["signer"]
        metas.append(AccountMeta(Pubkey.from_string(str(address)), signer, item["writable"]))
    data = bytes.fromhex(definition["dataHex"][:16]) + struct.pack("<QQQ", amount, 0, 0)
    return Instruction(PROGRAM, data, metas)


blockhash = Hash.from_string(call("getLatestBlockhash", [{"commitment": "processed"}])["value"]["blockhash"])
attacker = Keypair().pubkey()


def run(sample, label, instructions, watched):
    fee_payer = Pubkey.from_string(sample["feePayer"])
    message = MessageV0.try_compile(fee_payer, instructions, [], blockhash)
    transaction = VersionedTransaction.populate(
        message, [Signature.default()] * message.header.num_required_signatures
    )
    encoded = base64.b64encode(bytes(transaction)).decode()
    options = {
        "encoding": "base64",
        "sigVerify": False,
        "replaceRecentBlockhash": True,
        "commitment": "processed",
        "accounts": {"encoding": "base64", "addresses": watched},
    }
    value = call("simulateTransaction", [encoded, options])["value"]
    post = []
    for address, item in zip(watched, value.get("accounts") or []):
        if not item:
            post.append({"address": address, "returned": False})
            continue
        data = base64.b64decode(item["data"][0])
        row = {"address": address, "exists": True, "programOwner": item["owner"]}
        if len(data) >= 72 and item["owner"] in TOKEN_OWNERS:
            row["rawAmount"] = str(struct.unpack_from("<Q", data, 64)[0])
        post.append(row)
    return {
        "label": label,
        "err": value.get("err"),
        "unitsConsumed": value.get("unitsConsumed"),
        "post": post,
        "programLogs": [
            line
            for line in value.get("logs") or []
            if "Program log:" in line or "failed:" in line
        ][-40:],
    }


def amount_vector(rows):
    return [int(row.get("rawAmount", "0")) for row in rows]


selected = None
baseline = None
for sample in WITHDRAWS:
    addrs = [item["address"] for item in sample["instruction"]["accounts"]]
    watched = [addrs[i] for i in (2, 3, 4, 5, 6, 7)]
    before = account_rows(watched)
    if not all(row["exists"] for row in before["rows"]):
        continue
    lp_balance = int(before["rows"][1].get("rawAmount", "0"))
    original = struct.unpack_from("<Q", bytes.fromhex(sample["instruction"]["dataHex"]), 8)[0]
    candidates = []
    for amount in (original, lp_balance // 100, lp_balance // 20, lp_balance // 10, lp_balance // 4):
        if amount > 0 and amount * 2 <= lp_balance and amount not in candidates:
            candidates.append(amount)
    for amount in candidates:
        candidate = run(sample, "baseline", [make_ix(sample, amount)], watched)
        if candidate["err"] is not None:
            continue
        pre = amount_vector(before["rows"])
        post = amount_vector(candidate["post"])
        # LP burns and both vault-to-destination legs must move value.
        if not (post[1] < pre[1] and post[2] > pre[2] and post[3] > pre[3] and post[4] < pre[4] and post[5] < pre[5]):
            continue
        selected = {
            "sample": sample,
            "amount": amount,
            "addresses": addrs,
            "watched": watched,
            "before": before,
        }
        baseline = candidate
        break
    if selected:
        break

if not selected:
    raise RuntimeError("no current-state value-moving withdrawal positive control found")

sample = selected["sample"]
amount = selected["amount"]
addrs = selected["addresses"]
watched = selected["watched"]
destination0 = account_rows([addrs[4]])["rows"][0]
alternate_destination = None
alternate_destination_before = None
other_pool_vault = None

# Recent swap accounts provide independent same-mint destinations and vaults.
candidate_addresses = []
for other in HISTORY["samples"]:
    other_addrs = [item["address"] for item in other["instruction"]["accounts"]]
    if other["instruction"]["name"].startswith("swap") and len(other_addrs) >= 8:
        candidate_addresses.extend([other_addrs[4], other_addrs[5]])
        if other_addrs[3] != addrs[2] and other_pool_vault is None:
            other_pool_vault = other_addrs[6]

for start in range(0, len(candidate_addresses), 50):
    chunk = list(dict.fromkeys(candidate_addresses[start : start + 50]))
    for row in account_rows(chunk)["rows"]:
        if (
            row["address"] != addrs[4]
            and row.get("mint") == destination0.get("mint")
            and row.get("programOwner") == destination0.get("programOwner")
        ):
            alternate_destination = row["address"]
            break
    if alternate_destination:
        break

results = [baseline]
results.append(run(sample, "authority_pda_as_system_program", [make_ix(sample, amount, {1: SYSTEM})], watched))
results.append(run(sample, "owner_signer_as_attacker", [make_ix(sample, amount, {0: attacker})], watched))
results.append(run(sample, "classic_token_program_as_system_program", [make_ix(sample, amount, {8: SYSTEM})], watched))
results.append(run(sample, "swapped_vault_account_order", [make_ix(sample, amount, {6: addrs[7], 7: addrs[6]})], watched))
if other_pool_vault:
    results.append(run(sample, "other_pool_token0_vault", [make_ix(sample, amount, {6: other_pool_vault})], watched))
if alternate_destination:
    alternate_destination_before = account_rows([alternate_destination])
    watched_with_alt = watched + [alternate_destination]
    results.append(
        run(sample, "alternate_same_mint_destination", [make_ix(sample, amount, {4: alternate_destination})], watched_with_alt)
    )
results.append(run(sample, "duplicate_authorized_withdrawal", [make_ix(sample, amount), make_ix(sample, amount)], watched))
invalid_updates = {1: SYSTEM}
results.append(run(sample, "valid_then_invalid_atomic", [make_ix(sample, amount), make_ix(sample, amount, invalid_updates)], watched))
results.append(run(sample, "invalid_then_valid_atomic", [make_ix(sample, amount, invalid_updates), make_ix(sample, amount)], watched))

output = {
    "program": str(PROGRAM),
    "rpcMode": "Surfpool live-state fork using simulateTransaction only; sigVerify=false; no mainnet submission",
    "sourceInstructionWasInnerCpi": True,
    "replaySignerNote": "owner signer bit restored at top level; placeholder signatures accepted only because sigVerify=false",
    "sourceSignature": sample["signature"],
    "sourceSlot": sample["slot"],
    "samplePool": addrs[2],
    "lpAmountRaw": str(amount),
    "attacker": str(attacker),
    "alternateDestination": alternate_destination,
    "alternateDestinationBefore": alternate_destination_before,
    "otherPoolVault": other_pool_vault,
    "accounts": sample["instruction"]["accounts"],
    "watchedBefore": selected["before"],
    "results": results,
}
(DIR / "raydium-cpmm-withdraw-simulation.json").write_text(json.dumps(output, indent=2))
print(json.dumps({
    "sourceSignature": sample["signature"],
    "lpAmountRaw": amount,
    "results": [{"label": row["label"], "err": row["err"]} for row in results],
}, indent=2))
