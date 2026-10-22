#!/usr/bin/env python3
"""Read-only native-v1 Project 0 flash compositions through Raydium CLMM."""

import base64
import hashlib
import json
import os
import struct
import time
import urllib.error
import urllib.request
from pathlib import Path

from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV1, TransactionConfig
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction


ROOT = Path("/Users/stacc/the-composer-rescue/composer-runs/2026-10-15")
SOURCE = ROOT / "damm-v2-project0-flash-stress.json"
OUTPUT = ROOT / "raydium-clmm-project0-v1.json"
ENV_FILE = Path("/tmp/composer-helius-only.env")
LIMIT = 4096

P0 = Pubkey.from_string("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA")
CLMM = Pubkey.from_string("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
MEMO = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
ATA = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
USDC = Pubkey.from_string("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
USDT = Pubkey.from_string("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")

DEEP = {
    "pool": Pubkey.from_string("BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU"),
    "config": Pubkey.from_string("9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x"),
    "mint": USDT,
    "vault0": Pubkey.from_string("4iJQGzZpys4N13rGXbsB3NqehPkrgrcmDUEcLw7D6GKL"),
    "vault1": Pubkey.from_string("7NQjToK5NenQZvhPRc1nC1URuKJ4nuLxGPdTbpTiz9EN"),
    "observation": Pubkey.from_string("3YZE41e4GKm9Uqvx6H4QA1FdyxT15nEjUP8LbvdiDF2t"),
    "tick": 0,
}
THIN = {
    "pool": Pubkey.from_string("121XWup4g8R2iFhN6jRMtx9W423JbfJk4AqA753sUExw"),
    "config": Pubkey.from_string("E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp"),
    "mint": Pubkey.from_string("HzCmPHhxnhXGh3n7EG21mwnjaxjHVtYBecF8c9D79m8U"),
    "vault0": Pubkey.from_string("FKtcwnKmxXtTjk7szvuR5bKMhSmrUTG7JUHbBSMCxawo"),
    "vault1": Pubkey.from_string("H4de98zzojAzbkafqZrzocnJt4HmgoUVRgjm9aRkSYNM"),
    "observation": Pubkey.from_string("8VqRnFwPcbV9W4T8XFZw2cXEMdioYXG8XVwJvjjWBwBC"),
    "tick": -3600,
}
for pool in (DEEP, THIN):
    pool["tick_array"] = Pubkey.find_program_address(
        [b"tick_array", bytes(pool["pool"]), pool["tick"].to_bytes(4, "big", signed=True)], CLMM
    )[0]


def load_rpc():
    values = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return os.environ.get("HEAVY_RPC_URL") or values.get("HEAVY_RPC_URL") or values["RPC_URL"]


RPC = load_rpc()


def rpc(method, params, retries=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(retries):
        try:
            request = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
            if result.get("error"):
                return {"rpcError": result["error"]}
            return result["result"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt + 1 == retries:
                raise
            time.sleep(min(30, 2 ** attempt))


source_json = json.loads(SOURCE.read_text())
source_case = next(row for row in source_json["results"] if row["label"] == "positive_control_flash_only_one_raw")
source_tx = VersionedTransaction.from_bytes(base64.b64decode(source_case["wireBase64"]))
source_message = source_tx.message
SOURCE_KEYS = list(source_message.account_keys)


def is_signer(index):
    return index < source_message.header.num_required_signatures


def is_writable(index):
    if is_signer(index):
        return index < source_message.header.num_required_signatures - source_message.header.num_readonly_signed_accounts
    return index < len(SOURCE_KEYS) - source_message.header.num_readonly_unsigned_accounts


def source_ix(index):
    item = source_message.instructions[index]
    return Instruction(
        SOURCE_KEYS[item.program_id_index], bytes(item.data),
        [AccountMeta(SOURCE_KEYS[i], is_signer(i), is_writable(i)) for i in item.accounts],
    )


START, BORROW0, REPAY0, END = [source_ix(i) for i in range(4)]
PAYER = SOURCE_KEYS[0]
MARGIN_ACCOUNT = SOURCE_KEYS[1]
GROUP = SOURCE_KEYS[2]
BANK = SOURCE_KEYS[3]
USER_USDC = SOURCE_KEYS[4]
LENDER_AUTHORITY = SOURCE_KEYS[5]
LENDER_VAULT = SOURCE_KEYS[6]


def clone(ix):
    return Instruction(ix.program_id, bytes(ix.data), list(ix.accounts))


def pair(amount):
    borrow = clone(BORROW0)
    repay = clone(REPAY0)
    bdata, rdata = bytearray(borrow.data), bytearray(repay.data)
    bdata[8:16] = amount.to_bytes(8, "little")
    rdata[8:16] = amount.to_bytes(8, "little")
    return Instruction(P0, bytes(bdata), borrow.accounts), Instruction(P0, bytes(rdata), repay.accounts)


def wrap(middle):
    instructions = [clone(START), *middle, clone(END)]
    data = bytearray(instructions[0].data)
    data[8:16] = (len(instructions) - 1).to_bytes(8, "little")
    instructions[0] = Instruction(P0, bytes(data), instructions[0].accounts)
    return instructions


def user_ata(mint):
    return Pubkey.find_program_address([bytes(PAYER), bytes(TOKEN), bytes(mint)], ATA)[0]


def create_ata(mint, address):
    return Instruction(ATA, bytes([1]), [
        AccountMeta(PAYER, True, True), AccountMeta(address, False, True),
        AccountMeta(PAYER, False, False), AccountMeta(mint, False, False),
        AccountMeta(SYSTEM, False, False), AccountMeta(TOKEN, False, False),
    ])


def swap(pool, user_out, amount, forward=True):
    if forward:
        source, destination = USER_USDC, user_out
        input_vault, output_vault = pool["vault0"], pool["vault1"]
        input_mint, output_mint = USDC, pool["mint"]
    else:
        source, destination = user_out, USER_USDC
        input_vault, output_vault = pool["vault1"], pool["vault0"]
        input_mint, output_mint = pool["mint"], USDC
    keys = [PAYER, pool["config"], pool["pool"], source, destination,
            input_vault, output_vault, pool["observation"], TOKEN, TOKEN_2022,
            MEMO, input_mint, output_mint, pool["tick_array"]]
    writable = [True, False, True, True, True, True, True, True, False, False, False, False, False, True]
    data = bytes.fromhex("2b04ed0b1ac91e62") + struct.pack("<QQ", amount, 0) + bytes(16) + bytes([1])
    return Instruction(CLMM, data, [AccountMeta(key, i == 0, writable[i]) for i, key in enumerate(keys)])


DEEP_USER = user_ata(DEEP["mint"])
THIN_USER = user_ata(THIN["mint"])
MONITOR = [USER_USDC, DEEP_USER, THIN_USER, LENDER_VAULT, MARGIN_ACCOUNT, BANK,
           DEEP["pool"], DEEP["vault0"], DEEP["vault1"],
           THIN["pool"], THIN["vault0"], THIN["vault1"], THIN["observation"], THIN["tick_array"]]


def decode(address, account):
    if account is None:
        return None
    data = base64.b64decode(account["data"][0])
    row = {"address": str(address), "owner": account["owner"], "dataLen": len(data),
           "dataSha256": hashlib.sha256(data).hexdigest()}
    if address in (MARGIN_ACCOUNT, BANK):
        row["dataBase64"] = base64.b64encode(data).decode()
    if len(data) in (165, 170, 182):
        row["tokenAmount"] = struct.unpack_from("<Q", data, 64)[0]
    elif len(data) == 1544:
        row.update(liquidity=int.from_bytes(data[237:253], "little"),
                   sqrtPriceX64=int.from_bytes(data[253:269], "little"),
                   tickCurrent=int.from_bytes(data[269:273], "little", signed=True),
                   protocolFees0=struct.unpack_from("<Q", data, 309)[0],
                   protocolFees1=struct.unpack_from("<Q", data, 317)[0],
                   fundFees0=struct.unpack_from("<Q", data, 1064)[0],
                   fundFees1=struct.unpack_from("<Q", data, 1072)[0])
    return row


pre_rpc = rpc("getMultipleAccounts", [[str(key) for key in MONITOR], {"encoding": "base64", "commitment": "confirmed"}])
PRE = {"slot": pre_rpc["context"]["slot"],
       "accounts": [decode(key, value) for key, value in zip(MONITOR, pre_rpc["value"])]}
PRE_BY = {row["address"]: row for row in PRE["accounts"] if row}
RESULTS = []


def simulate(label, instructions):
    config = TransactionConfig(compute_unit_limit=1_000_000, loaded_accounts_data_size_limit=64_000_000)
    message = MessageV1.try_compile(PAYER, instructions, Hash.default(), config)
    transaction = VersionedTransaction.populate(message, [Signature.default()] * message.header.num_required_signatures)
    wire = bytes(transaction)
    evidence = {"label": label, "messageVersion": 1, "instructionCount": len(instructions),
                "inlineAccountCount": len(message.account_keys), "transactionSize": len(wire),
                "wireSha256": hashlib.sha256(wire).hexdigest(), "wireBase64": base64.b64encode(wire).decode(),
                "inlineAccounts": [str(key) for key in message.account_keys]}
    if len(wire) > LIMIT:
        evidence["compileError"] = f"serialized transaction exceeds {LIMIT} bytes"
        RESULTS.append(evidence)
        return evidence
    watched = [key for key in MONITOR if key in message.account_keys]
    case_pre_rpc = rpc("getMultipleAccounts", [[str(key) for key in watched],
                                                {"encoding": "base64", "commitment": "confirmed"}])
    case_pre = [decode(key, account) for key, account in zip(watched, case_pre_rpc["value"])]
    case_pre_by = {row["address"]: row for row in case_pre if row}
    result = rpc("simulateTransaction", [base64.b64encode(wire).decode(), {
        "encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True,
        "commitment": "confirmed", "innerInstructions": True,
        "accounts": {"encoding": "base64", "addresses": [str(key) for key in watched]},
    }])
    if "rpcError" in result:
        evidence["rpcError"] = result["rpcError"]
        RESULTS.append(evidence)
        return evidence
    value = result["value"]
    post = [decode(key, account) for key, account in zip(watched, value.get("accounts") or [])]
    deltas = {}
    for row in post:
        if not row or "tokenAmount" not in row:
            continue
        before = case_pre_by.get(row["address"])
        deltas[row["address"]] = row["tokenAmount"] - (before.get("tokenAmount", 0) if before else 0)
    evidence.update(preSlot=case_pre_rpc["context"]["slot"], preAccounts=case_pre,
                    contextSlot=result.get("context", {}).get("slot"), err=value.get("err"),
                    unitsConsumed=value.get("unitsConsumed"), postAccounts=post, tokenDeltas=deltas,
                    innerInstructions=value.get("innerInstructions"),
                    relevantLogs=[line for line in value.get("logs") or [] if
                                  "Instruction:" in line or "AnchorError" in line or "failed:" in line])
    RESULTS.append(evidence)
    print(json.dumps({"label": label, "err": evidence.get("err"), "size": len(wire),
                      "accounts": len(message.account_keys), "units": evidence.get("unitsConsumed"),
                      "deltas": deltas}))
    return evidence


def transfer_amount(result, outer_index, source, destination):
    for group in result.get("innerInstructions") or []:
        if group.get("index") != outer_index:
            continue
        for item in group.get("instructions") or []:
            info = (item.get("parsed") or {}).get("info") or {}
            if info.get("source") == str(source) and info.get("destination") == str(destination):
                raw = (info.get("tokenAmount") or {}).get("amount") or info.get("amount")
                if raw is not None:
                    return int(raw)
    return None


def roundtrip(label, pool, destination, amount, repeats=1):
    borrow, repay = pair(amount)
    probe_middle = [create_ata(pool["mint"], destination), borrow,
                    swap(pool, destination, amount, True), swap(pool, destination, 1, False), repay]
    probe = simulate(label + "_output_probe", wrap(probe_middle))
    # start=0, create=1, borrow=2, forward swap=3
    output = transfer_amount(probe, 3, pool["vault1"], destination)
    if not output:
        return
    total_borrow = amount * repeats
    borrow, repay = pair(total_borrow)
    middle = [create_ata(pool["mint"], destination), borrow]
    for _ in range(repeats):
        middle.extend([swap(pool, destination, amount, True), swap(pool, destination, output, False)])
    middle.append(repay)
    final = simulate(label, wrap(middle))
    final["forwardOutputRawFromProbe"] = output
    final["repeats"] = repeats


borrow1, repay1 = pair(1)
borrow2, repay2 = pair(2)
simulate("p0_flash_only_one_raw", wrap([borrow1, repay1]))
simulate("p0_flash_only_two_raw", wrap([borrow2, repay2]))

for amount in [2, 3, 4, 5, 10]:
    borrow, repay = pair(amount)
    simulate(f"p0_deep_one_way_{amount}",
             wrap([create_ata(DEEP["mint"], DEEP_USER), borrow, swap(DEEP, DEEP_USER, amount), repay]))

roundtrip("p0_deep_roundtrip_100000", DEEP, DEEP_USER, 100_000)
roundtrip("p0_deep_two_roundtrips_100000", DEEP, DEEP_USER, 100_000, repeats=2)
roundtrip("p0_thin_roundtrip_100000", THIN, THIN_USER, 100_000)
roundtrip("p0_thin_repeated_roundtrip_100000", THIN, THIN_USER, 100_000, repeats=2)
roundtrip("p0_thin_last_kamino_boundary_roundtrip", THIN, THIN_USER, 95_680_947)

output = {
    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "transport": "read-only current-mainnet simulateTransaction; sigVerify=false; no sendTransaction",
    "messageVersion": 1, "limits": {"transactionBytes": 4096, "inlineAccounts": 64},
    "source": {"signature": source_json["sourceTransactions"]["project0"]["signature"],
               "slot": source_json["sourceTransactions"]["project0"]["slot"],
               "wireArtifact": str(SOURCE)},
    "authority": {"pubkey": str(PAYER),
                  "signerSeed": "none: existing on-curve System authority and v1 payer; sigVerify=false only"},
    "project0": {"program": str(P0), "group": str(GROUP), "marginAccount": str(MARGIN_ACCOUNT),
                 "bank": str(BANK), "borrowDestination": str(USER_USDC),
                 "lenderAuthority": str(LENDER_AUTHORITY), "lenderVault": str(LENDER_VAULT),
                 "repayOptionBytes": REPAY0.data[16:].hex()},
    "raydium": {"program": str(CLMM), "deepPool": str(DEEP["pool"]), "thinPool": str(THIN["pool"])},
    "pre": PRE, "results": RESULTS,
}
OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({"output": str(OUTPUT), "cases": len(RESULTS)}, indent=2))
