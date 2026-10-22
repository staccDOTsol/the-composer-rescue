#!/usr/bin/env python3
"""Read active position shares in selected high-liquidity Whirlpool pools.

Usage: ORCA_RPC_URL=<authenticated RPC endpoint> python3 scan_high_liquidity_positions.py
The endpoint is never saved to the output or printed.
"""

import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from scan_mainnet_pool_liquidity import PROGRAM, OUT as POOL_SCAN, b58, rpc, inspect_pool

OUT = Path(__file__).with_name("mainnet-high-liquidity-positions.json")
DISCRIMINATOR = hashlib.sha256(b"account:Position").digest()[:8]


def scan_pool(address):
    pool = inspect_pool(address)
    options = {"commitment": "finalized", "encoding": "base64",
               "filters": [{"dataSize": 216},
                           {"memcmp": {"offset": 0, "bytes": b58(DISCRIMINATOR)}},
                           {"memcmp": {"offset": 8, "bytes": address}}],
               "dataSlice": {"offset": 72, "length": 24}}
    accounts = rpc("getProgramAccounts", [PROGRAM, options])
    positions = []
    for account in accounts:
        raw = base64.b64decode(account["account"]["data"][0])
        assert len(raw) == 24
        liquidity = int.from_bytes(raw[:16], "little")
        lower = int.from_bytes(raw[16:20], "little", signed=True)
        upper = int.from_bytes(raw[20:24], "little", signed=True)
        if liquidity and lower <= pool["currentTick"] < upper:
            positions.append({"position": account["pubkey"],
                              "liquidity": str(liquidity),
                              "lowerTick": lower, "upperTick": upper,
                              "shareOfPool": round(liquidity / int(pool["liquidity"]), 9)})
    positions.sort(key=lambda item: int(item["liquidity"]), reverse=True)
    return {"pool": address, "poolLiquidity": pool["liquidity"],
            "currentTick": pool["currentTick"],
            "positionCount": len(accounts), "activePositionCount": len(positions),
            "activePositionLiquiditySum": str(sum(int(p["liquidity"]) for p in positions)),
            "largestActivePositions": positions[:10],
            "query": options}


def main():
    scan = json.loads(POOL_SCAN.read_text())
    addresses = list(dict.fromkeys([scan["topTen"][0]["pool"]] +
                               [item["pool"] for item in scan["nearestQ"]]))
    before = rpc("getSlot", [{"commitment": "finalized"}])
    pools = [scan_pool(address) for address in addresses]
    after = rpc("getSlot", [{"commitment": "finalized"}])
    result = {"schema": "orca-pr1396-mainnet-position-shares/v1",
              "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
              "finalizedSlotBeforeScan": before, "finalizedSlotAfterScan": after,
              "programId": PROGRAM, "positionDiscriminatorHex": DISCRIMINATOR.hex(),
              "sourceLayout": "Position account discriminator8 + Whirlpool pubkey32 + position mint32 + liquidity16 + lower tick4 + upper tick4",
              "rpcCredentialPersisted": False, "pools": pools}
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps([{"pool": pool["pool"],
                       "active": pool["activePositionCount"],
                       "largestShare": (pool["largestActivePositions"][0]["shareOfPool"]
                                        if pool["largestActivePositions"] else None),
                       "liquidityMatches": pool["activePositionLiquiditySum"] == pool["poolLiquidity"]}
                      for pool in pools]))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {str(error)[:160]}")
        raise SystemExit(1)
