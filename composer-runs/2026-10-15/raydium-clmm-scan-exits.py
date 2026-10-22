#!/usr/bin/env python3
"""Find recent successful Raydium CLMM instructions by Anchor discriminator."""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request


RPC = "https://api.mainnet-beta.solana.com"
PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"
TARGET_NAMES = [
    "decrease_liquidity_v2",
    "collect_protocol_fee",
    "collect_fund_fee",
    "collect_remaining_rewards",
]
TARGETS = {
    hashlib.sha256(("global:" + name).encode()).digest()[:8]: name
    for name in TARGET_NAMES
}


def b58decode(value):
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = 0
    for char in value:
        number = number * 58 + alphabet.index(char)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * (len(value) - len(value.lstrip("1"))) + raw


def request(payload, retries=10):
    body = json.dumps(payload).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                RPC, data=body, headers={"content-type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=90) as response:
                return json.load(response)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            if attempt + 1 == retries:
                raise
            time.sleep(min(30, 2 ** attempt))


def rpc(method, params):
    response = request({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if response.get("error"):
        raise RuntimeError(response["error"])
    return response["result"]


def all_clmm_instructions(tx):
    if not tx or tx.get("meta", {}).get("err") is not None:
        return
    message = tx["transaction"]["message"]
    for ix in message.get("instructions", []):
        if ix.get("programId") == PROGRAM and "data" in ix:
            yield "top", ix
    for group in tx.get("meta", {}).get("innerInstructions") or []:
        for ix in group.get("instructions", []):
            if ix.get("programId") == PROGRAM and "data" in ix:
                yield "inner", ix


def scan(pages, limit, stop_after_name):
    before = None
    matches = []
    scanned = 0
    for page in range(pages):
        opts = {"limit": min(1000, limit - scanned)}
        if before:
            opts["before"] = before
        signatures = rpc("getSignaturesForAddress", [PROGRAM, opts])
        if not signatures:
            break
        before = signatures[-1]["signature"]
        successful = [item for item in signatures if item.get("err") is None]
        for start in range(0, len(successful), 5):
            chunk = successful[start : start + 5]
            payload = [
                {
                    "jsonrpc": "2.0",
                    "id": index,
                    "method": "getTransaction",
                    "params": [
                        item["signature"],
                        {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
                    ],
                }
                for index, item in enumerate(chunk)
            ]
            responses = request(payload)
            by_id = {item["id"]: item for item in responses}
            for index, siginfo in enumerate(chunk):
                tx = by_id.get(index, {}).get("result")
                scanned += 1
                for level, ix in all_clmm_instructions(tx):
                    raw = b58decode(ix["data"])
                    name = TARGETS.get(raw[:8])
                    if not name:
                        continue
                    matches.append(
                        {
                            "name": name,
                            "signature": siginfo["signature"],
                            "slot": siginfo["slot"],
                            "blockTime": siginfo.get("blockTime"),
                            "level": level,
                            "accounts": ix.get("accounts", []),
                            "dataHex": raw.hex(),
                            "signers": [
                                key["pubkey"]
                                for key in tx["transaction"]["message"]["accountKeys"]
                                if key.get("signer")
                            ],
                            "logLines": [
                                line
                                for line in tx.get("meta", {}).get("logMessages") or []
                                if "Instruction:" in line
                                or "collect reward" in line
                                or "Program data:" in line
                            ],
                            "preTokenBalances": tx.get("meta", {}).get("preTokenBalances", []),
                            "postTokenBalances": tx.get("meta", {}).get("postTokenBalances", []),
                        }
                    )
            if stop_after_name and any(item["name"] == stop_after_name for item in matches):
                return {"program": PROGRAM, "scannedSuccessful": scanned, "matches": matches}
            if scanned >= limit:
                return {"program": PROGRAM, "scannedSuccessful": scanned, "matches": matches}
            time.sleep(2.0)
        if len(signatures) < 1000:
            break
        time.sleep(0.5)
    return {"program": PROGRAM, "scannedSuccessful": scanned, "matches": matches}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--stop-after-name", choices=TARGET_NAMES)
    args = parser.parse_args()
    print(json.dumps(scan(args.pages, args.limit, args.stop_after_name), indent=2))
