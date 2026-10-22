#!/usr/bin/env python3
"""Read finalized Whirlpool pool liquidity without persisting the RPC URL.

Usage: ORCA_RPC_URL=<authenticated RPC endpoint> python3 scan_mainnet_pool_liquidity.py
The output is a redacted JSON summary in the adjacent directory.
"""

import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import urllib.request

PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
Q = 1 << 64
OUT = Path(__file__).with_name("mainnet-liquidity-scan.json")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
DISCRIMINATOR = hashlib.sha256(b"account:Whirlpool").digest()[:8]


def b58(data):
    n = int.from_bytes(data, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + s


def rpc(method, params):
    url = os.environ.get("ORCA_RPC_URL")
    if not url:
        raise RuntimeError("ORCA_RPC_URL is required")
    payload = json.dumps({"jsonrpc": "2.0", "id": 1,
                          "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=payload,
                                     headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=90) as response:
        body = json.load(response)
    if "error" in body:
        # Never print the provider response: it may echo the authenticated URL.
        raise RuntimeError(f"{method} RPC error code {body['error'].get('code')}")
    return body["result"]


def inspect_pool(address):
    account = rpc("getAccountInfo", [address, {"encoding": "base64",
                                               "commitment": "finalized"}])["value"]
    data = base64.b64decode(account["data"][0])
    assert len(data) == 653
    assert data[:8] == DISCRIMINATOR
    mint_a = b58(data[101:133])
    mint_b = b58(data[181:213])
    return {"pool": address, "liquidity": str(int.from_bytes(data[49:65], "little")),
            "tickSpacing": int.from_bytes(data[41:43], "little"),
            "feeRate": int.from_bytes(data[45:47], "little"),
            "currentTick": int.from_bytes(data[81:85], "little", signed=True),
            "mintA": mint_a, "mintB": mint_b,
            "vaultA": b58(data[133:165]), "vaultB": b58(data[213:245])}


def main():
    slot = rpc("getSlot", [{"commitment": "finalized"}])
    options = {"commitment": "finalized", "encoding": "base64",
               "filters": [{"dataSize": 653},
                           {"memcmp": {"offset": 0, "bytes": b58(DISCRIMINATOR)}}],
               "dataSlice": {"offset": 49, "length": 16}}
    accounts = rpc("getProgramAccounts", [PROGRAM, options])
    slot_after = rpc("getSlot", [{"commitment": "finalized"}])
    rows = []
    for item in accounts:
        raw = base64.b64decode(item["account"]["data"][0])
        if len(raw) != 16:
            raise RuntimeError("Unexpected liquidity slice length")
        rows.append((int.from_bytes(raw, "little"), item["pubkey"]))
    rows.sort(reverse=True)
    active = [(v, k) for v, k in rows if v]
    nearest_q = sorted(active, key=lambda row: abs(row[0] - Q))[:5]
    max_address = rows[0][1]
    nearest_address = nearest_q[0][1]
    known_wsol_usdc = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
    pools = [inspect_pool(address) for address in
             [max_address, nearest_address, known_wsol_usdc]]
    mint_addresses = list(dict.fromkeys(mint for pool in pools
                                        for mint in (pool["mintA"], pool["mintB"])))
    mint_accounts = rpc("getMultipleAccounts", [mint_addresses,
        {"encoding": "base64", "commitment": "finalized"}])["value"]
    decimals = {}
    for address, account in zip(mint_addresses, mint_accounts):
        if account:
            raw = base64.b64decode(account["data"][0])
            decimals[address] = raw[44] if len(raw) > 44 else None
        else:
            decimals[address] = None
    for pool in pools:
        pool["mintADecimals"] = decimals[pool["mintA"]]
        pool["mintBDecimals"] = decimals[pool["mintB"]]
    report = {
        "schema": "orca-pr1396-mainnet-liquidity-scan/v1",
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "finalizedSlotBeforeScan": slot,
        "finalizedSlotAfterScan": slot_after,
        "programId": PROGRAM,
        "query": {"method": "getProgramAccounts", "options": options,
                  "liquidityFieldOffset": 49, "liquidityFieldBytes": 16,
                  "sourceLayout": "Whirlpool account discriminator8 + config32 + bump1 + spacing2 + feeTierSeed2 + feeRate2 + protocolFeeRate2"},
        "whirlpoolDiscriminatorHex": DISCRIMINATOR.hex(),
        "rpcCredentialPersisted": False,
        "q64": str(Q),
        "poolCount": len(rows),
        "activePositiveLiquidity": len(active),
        "liquidityGteQ": sum(v >= Q for v, _ in rows),
        "liquidityGteHalfQ": sum(v >= Q // 2 for v, _ in rows),
        "liquidityGteTenthQ": sum(v >= Q // 10 for v, _ in rows),
        "liquidityBetweenQAnd2Q": sum(Q <= v < 2 * Q for v, _ in rows),
        "liquidityGte10Q": sum(v >= 10 * Q for v, _ in rows),
        "topTen": [{"pool": k, "liquidity": str(v)} for v, k in rows[:10]],
        "nearestQ": [{"pool": k, "liquidity": str(v),
                      "ratioToQ": round(v / Q, 9)} for v, k in nearest_q],
        "inspectedPools": pools,
    }
    OUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"finalizedSlotBeforeScan": slot,
                      "poolCount": len(rows), "liquidityGteQ": report["liquidityGteQ"],
                      "max": report["topTen"][0], "nearestQ": report["nearestQ"][0]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Keep credentials out of tracebacks and terminal logs.
        print(f"{type(error).__name__}: {str(error)[:160]}")
        raise SystemExit(1)
