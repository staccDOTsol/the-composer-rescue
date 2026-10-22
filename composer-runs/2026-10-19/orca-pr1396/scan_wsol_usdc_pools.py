#!/usr/bin/env python3
"""Read current Whirlpool WSOL/USDC pools and rank spot virtual depth.

Usage: ORCA_RPC_URL=<authenticated RPC endpoint> python3 scan_wsol_usdc_pools.py
The endpoint is never saved or printed.
"""

import base64
from datetime import datetime, timezone
import json
from pathlib import Path

from scan_mainnet_pool_liquidity import PROGRAM, DISCRIMINATOR, Q, b58, rpc

WSOL = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
OUT = Path(__file__).with_name("mainnet-wsol-usdc-pools.json")


def u128(raw, offset):
    return int.from_bytes(raw[offset:offset + 16], "little")


def u64(raw, offset):
    return int.from_bytes(raw[offset:offset + 8], "little")


def query_order(mint_a, mint_b):
    options = {"commitment": "finalized", "encoding": "base64",
               "filters": [{"dataSize": 653},
                           {"memcmp": {"offset": 0, "bytes": b58(DISCRIMINATOR)}},
                           {"memcmp": {"offset": 101, "bytes": mint_a}},
                           {"memcmp": {"offset": 181, "bytes": mint_b}}],
               "dataSlice": {"offset": 0, "length": 245}}
    accounts = rpc("getProgramAccounts", [PROGRAM, options])
    rows = []
    for item in accounts:
        raw = base64.b64decode(item["account"]["data"][0])
        assert len(raw) == 245 and raw[:8] == DISCRIMINATOR
        l = u128(raw, 49)
        sqrt = u128(raw, 65)
        virtual_a = l * Q // sqrt if sqrt else 0
        virtual_b = l * sqrt // Q
        virtual_wsol = virtual_a if mint_a == WSOL else virtual_b
        virtual_usdc = virtual_b if mint_b == USDC else virtual_a
        rows.append({"pool": item["pubkey"], "mintA": mint_a, "mintB": mint_b,
                     "tickSpacing": int.from_bytes(raw[41:43], "little"),
                     "feeRate": int.from_bytes(raw[45:47], "little"),
                     "protocolFeeRate": int.from_bytes(raw[47:49], "little"),
                     "liquidity": str(l), "sqrtPriceX64": str(sqrt),
                     "currentTick": int.from_bytes(raw[81:85], "little", signed=True),
                     "vaultA": b58(raw[133:165]), "vaultB": b58(raw[213:245]),
                     "spotVirtualWsolRaw": str(virtual_wsol),
                     "spotVirtualUsdcRaw": str(virtual_usdc),
                     "spotVirtualWsol": round(virtual_wsol / 1e9, 6),
                     "spotVirtualUsdc": round(virtual_usdc / 1e6, 6)})
    return options, rows


def main():
    before = rpc("getSlot", [{"commitment": "finalized"}])
    query_ab, rows_ab = query_order(WSOL, USDC)
    query_ba, rows_ba = query_order(USDC, WSOL)
    rows = rows_ab + rows_ba
    vaults = list(dict.fromkeys(vault for row in rows
                                for vault in (row["vaultA"], row["vaultB"])))
    balances = {}
    for start in range(0, len(vaults), 100):
        selected = vaults[start:start + 100]
        accounts = rpc("getMultipleAccounts", [selected,
            {"encoding": "base64", "commitment": "finalized"}])["value"]
        for address, account in zip(selected, accounts):
            if account is None:
                balances[address] = None
                continue
            raw = base64.b64decode(account["data"][0])
            balances[address] = u64(raw, 64) if len(raw) >= 72 else None
    for row in rows:
        vault_wsol = row["vaultA"] if row["mintA"] == WSOL else row["vaultB"]
        vault_usdc = row["vaultB"] if row["mintB"] == USDC else row["vaultA"]
        row["vaultWsolRaw"] = str(balances[vault_wsol]) if balances[vault_wsol] is not None else None
        row["vaultUsdcRaw"] = str(balances[vault_usdc]) if balances[vault_usdc] is not None else None
        row["vaultWsol"] = round(balances[vault_wsol] / 1e9, 6) if balances[vault_wsol] is not None else None
        row["vaultUsdc"] = round(balances[vault_usdc] / 1e6, 6) if balances[vault_usdc] is not None else None
    rows.sort(key=lambda row: int(row["spotVirtualWsolRaw"]), reverse=True)
    after = rpc("getSlot", [{"commitment": "finalized"}])
    result = {"schema": "orca-pr1396-wsol-usdc-pools/v1",
              "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
              "finalizedSlotBeforeScan": before,
              "finalizedSlotAfterScan": after,
              "programId": PROGRAM,
              "queries": [query_ab, query_ba],
              "rpcCredentialPersisted": False,
              "poolCount": len(rows), "activePoolCount": sum(int(r["liquidity"]) > 0 for r in rows),
              "rankingMethod": "Spot virtual WSOL reserve L*Q/sqrtPriceX64 if WSOL=A, else L*sqrtPriceX64/Q; does not simulate tick crossing or price impact across a large swap",
              "pools": rows}
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"slots": [before, after], "poolCount": len(rows),
                      "activePoolCount": result["activePoolCount"],
                      "topTen": [{k: r[k] for k in
                                  ("pool", "feeRate", "liquidity", "spotVirtualWsol",
                                   "vaultWsol", "vaultUsdc")}
                                 for r in rows[:10]]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {str(error)[:160]}")
        raise SystemExit(1)
