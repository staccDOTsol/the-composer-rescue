"""Read-only simulateTransaction controls and mutations for Raydium CPMM swaps."""
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
HISTORY_PATH = Path(os.environ.get("HISTORY_FILE", DIR / "raydium-cpmm-history-samples.json"))
OUTPUT_PATH = Path(os.environ.get("OUTPUT_FILE", DIR / "raydium-cpmm-swap-simulation.json"))
HISTORY = json.loads(HISTORY_PATH.read_text())
SWAPS = [row for row in HISTORY["samples"] if row["instruction"]["name"] == "swap_base_input"]
AUXILIARY = json.loads(Path(os.environ.get("AUX_HISTORY_FILE", HISTORY_PATH)).read_text())
ALL_SWAPS = [row for row in AUXILIARY["samples"] if row["instruction"]["name"] == "swap_base_input"]


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


def accounts(addresses):
    result = call("getMultipleAccounts", [addresses, {"encoding": "base64", "commitment": "processed"}])
    decoded = []
    for address, item in zip(addresses, result["value"]):
        if not item:
            decoded.append({"address": address, "exists": False})
            continue
        data = base64.b64decode(item["data"][0])
        row = {"address": address, "exists": True, "programOwner": item["owner"], "dataLength": len(data)}
        if len(data) >= 72 and item["owner"] in {
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        }:
            row.update(
                {
                    "mint": str(Pubkey.from_bytes(data[:32])),
                    "tokenAuthority": str(Pubkey.from_bytes(data[32:64])),
                    "rawAmount": str(struct.unpack_from("<Q", data, 64)[0]),
                }
            )
        decoded.append(row)
    return {"slot": result["context"]["slot"], "rows": decoded}


def make_ix(sample, amount, updates=None):
    definition = sample["instruction"]
    metas = []
    for index, item in enumerate(definition["accounts"]):
        address = (updates or {}).get(index, item["address"])
        metas.append(AccountMeta(Pubkey.from_string(str(address)), item["signer"], item["writable"]))
    data = bytes.fromhex(definition["dataHex"][:16]) + struct.pack("<QQ", amount, 0)
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
        if len(data) >= 72 and item["owner"] in {
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        }:
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
        ][-30:],
    }


selected = None
baseline = None
for sample in SWAPS:
    addrs = [item["address"] for item in sample["instruction"]["accounts"]]
    state = accounts([addrs[i] for i in (4, 5, 6, 7)])
    if not all(row["exists"] for row in state["rows"]):
        continue
    balance = int(state["rows"][0].get("rawAmount", "0"))
    original = struct.unpack_from("<Q", bytes.fromhex(sample["instruction"]["dataHex"]), 8)[0]
    candidates = []
    for amount in (original, balance // 2, balance // 10, balance // 100):
        if amount > 0 and amount <= balance and amount not in candidates:
            candidates.append(amount)
    for amount in candidates:
        watched = [addrs[i] for i in (3, 4, 5, 6, 7)]
        before = accounts(watched)
        candidate = run(sample, "baseline", [make_ix(sample, amount)], watched)
        if candidate["err"] is not None:
            continue
        pre_amounts = [int(row.get("rawAmount", "0")) for row in before["rows"]]
        post_amounts = [int(row.get("rawAmount", "0")) for row in candidate["post"]]
        if pre_amounts[2] == post_amounts[2] or pre_amounts[4] == post_amounts[4]:
            continue
        selected = {"sample": sample, "amount": amount, "addresses": addrs, "watched": watched, "before": before}
        baseline = candidate
        break
    if selected:
        break

if not selected:
    raise RuntimeError("no current-state value-moving swap positive control found")

sample = selected["sample"]
amount = selected["amount"]
addrs = selected["addresses"]
watched = selected["watched"]
output_info = accounts([addrs[5]])["rows"][0]
alternate_destination = None
alternate_destination_before = None
other_pool_vault = None
for other in SWAPS + ALL_SWAPS:
    other_addrs = [item["address"] for item in other["instruction"]["accounts"]]
    if other_addrs[3] != addrs[3] and other_pool_vault is None:
        other_pool_vault = other_addrs[6]
    candidate = accounts([other_addrs[5]])["rows"][0]
    if (
        other_addrs[5] != addrs[5]
        and candidate.get("mint") == output_info.get("mint")
        and candidate.get("programOwner") == output_info.get("programOwner")
    ):
        alternate_destination = other_addrs[5]
    if alternate_destination and other_pool_vault:
        break

results = [baseline]
results.append(run(sample, "authority_pda_as_system_program", [make_ix(sample, amount, {1: SYSTEM})], watched))
results.append(run(sample, "payer_as_attacker", [make_ix(sample, amount, {0: attacker})], watched))
results.append(run(sample, "input_token_program_as_system_program", [make_ix(sample, amount, {8: SYSTEM})], watched))
if other_pool_vault:
    results.append(run(sample, "other_pool_input_vault", [make_ix(sample, amount, {6: other_pool_vault})], watched))
if alternate_destination:
    alternate_destination_before = accounts([alternate_destination])
    watched_with_alt = watched + [alternate_destination]
    results.append(
        run(sample, "alternate_same_mint_destination", [make_ix(sample, amount, {5: alternate_destination})], watched_with_alt)
    )
results.append(run(sample, "duplicate_authorized_swap", [make_ix(sample, amount), make_ix(sample, amount)], watched))
invalid_updates = {1: SYSTEM}
results.append(run(sample, "valid_then_invalid_atomic", [make_ix(sample, amount), make_ix(sample, amount, invalid_updates)], watched))
results.append(run(sample, "invalid_then_valid_atomic", [make_ix(sample, amount, invalid_updates), make_ix(sample, amount)], watched))

output = {
    "program": str(PROGRAM),
    "rpcMode": "Surfpool live-state fork using simulateTransaction only; sigVerify=false; no mainnet submission",
    "sourceSignature": sample["signature"],
    "sourceSlot": sample["slot"],
    "samplePool": addrs[3],
    "amountInRaw": str(amount),
    "attacker": str(attacker),
    "alternateDestination": alternate_destination,
    "alternateDestinationBefore": alternate_destination_before,
    "otherPoolVault": other_pool_vault,
    "accounts": sample["instruction"]["accounts"],
    "watchedBefore": selected["before"],
    "results": results,
}
OUTPUT_PATH.write_text(json.dumps(output, indent=2))
print(json.dumps({"sourceSignature": sample["signature"], "amountInRaw": amount, "results": [{"label": r["label"], "err": r["err"]} for r in results]}, indent=2))
