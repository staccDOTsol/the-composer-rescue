#!/usr/bin/env python3
"""Compact read-only history scan for landed Sanctum Unstake instructions."""

import json
import os
import time
from collections import Counter
from pathlib import Path

import requests

PROGRAM = "unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ"
TARGET_ADDRESS = os.getenv("TARGET_ADDRESS") or PROGRAM
RPC = os.getenv("HEAVY_RPC_URL") or os.getenv("RPC_URL")
OUT = Path(__file__).with_name(os.getenv("OUTPUT_NAME") or "sanctum-unstake-history.json")
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
DISCS = {
    bytes([181,157,89,67,143,182,52,72]).hex(): "add_liquidity",
    bytes([80,85,209,72,24,206,177,108]).hex(): "remove_liquidity",
    bytes([217,64,76,16,216,77,123,226]).hex(): "deactivate_stake_account",
    bytes([47,127,90,221,10,160,183,117]).hex(): "reclaim_stake_account",
    bytes([90,95,107,42,205,124,50,225]).hex(): "unstake",
    bytes([125,93,190,135,89,174,142,149]).hex(): "unstake_wsol",
    bytes([64,124,6,57,151,155,26,195]).hex(): "take_flash_loan",
    bytes([119,239,18,45,194,107,31,238]).hex(): "repay_flash_loan",
}


def b58decode(text):
    n = 0
    for char in text:
        n = n * 58 + ALPHABET.index(char)
    return b"\0" * (len(text) - len(text.lstrip("1"))) + n.to_bytes(max(1, (n.bit_length() + 7) // 8), "big")


def rpc(method, params):
    for attempt in range(6):
        try:
            response = requests.post(RPC, json={"jsonrpc":"2.0","id":1,"method":method,"params":params}, timeout=120)
            response.raise_for_status()
            body = response.json()
            if body.get("error"):
                raise RuntimeError(body["error"])
            return body["result"]
        except Exception:
            if attempt == 5:
                raise
            time.sleep(0.5 * 2**attempt)


def account_key(value):
    return value if isinstance(value, str) else value.get("pubkey")


def compact_instructions(tx):
    message = tx["transaction"]["message"]
    keys = [account_key(x) for x in message["accountKeys"]]
    loaded = tx["meta"].get("loadedAddresses") or {}
    keys += loaded.get("writable", []) + loaded.get("readonly", [])
    groups = [("top", message["instructions"])]
    groups += [(f"inner:{g['index']}", g["instructions"]) for g in (tx["meta"].get("innerInstructions") or [])]
    found = []
    for where, instructions in groups:
        for index, ix in enumerate(instructions):
            if "programIdIndex" not in ix or keys[ix["programIdIndex"]] != PROGRAM:
                continue
            data = b58decode(ix["data"])
            disc = data[:8].hex()
            found.append({
                "where": f"{where}:{index}",
                "name": DISCS.get(disc, "unknown"),
                "discriminatorHex": disc,
                "dataBase58": ix["data"],
                "accounts": [keys[i] for i in ix["accounts"]],
            })
    return found


def main():
    cursor = None
    counts = Counter()
    samples = {}
    transactions_scanned = 0
    pages = 0
    for page in range(80):
        options = {"transactionDetails":"full","limit":100,"filters":{"status":"succeeded"}}
        if cursor:
            options["paginationToken"] = cursor
        result = rpc("getTransactionsForAddress", [TARGET_ADDRESS, options])
        txs = result["data"]
        pages = page + 1
        transactions_scanned += len(txs)
        for tx in txs:
            found = compact_instructions(tx)
            for ix in found:
                counts[ix["name"]] += 1
                if len(samples.get(ix["name"], [])) < 3:
                    samples.setdefault(ix["name"], []).append({
                        "signature": tx["transaction"]["signatures"][0],
                        "slot": tx["slot"],
                        "blockTime": tx.get("blockTime"),
                        "instruction": ix,
                        "fee": tx["meta"].get("fee"),
                        "computeUnitsConsumed": tx["meta"].get("computeUnitsConsumed"),
                        "logMessages": tx["meta"].get("logMessages"),
                    })
        cursor = result.get("paginationToken")
        if not cursor or len(txs) < 100:
            break
        if all(counts[name] for name in ["add_liquidity","remove_liquidity","reclaim_stake_account","unstake"]):
            break
    output = {
        "program": PROGRAM,
        "targetAddress": TARGET_ADDRESS,
        "pages": pages,
        "transactionsScanned": transactions_scanned,
        "instructionCounts": dict(counts),
        "samples": samples,
    }
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"output":str(OUT),"pages":pages,"transactionsScanned":transactions_scanned,"instructionCounts":dict(counts),"sampleSignatures":{k:[x["signature"] for x in v] for k,v in samples.items()}}, indent=2))


if __name__ == "__main__":
    main()
