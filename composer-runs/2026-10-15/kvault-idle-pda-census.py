#!/usr/bin/env python3
"""Read-only lower-bound Kvault census. Requires RPC_URL in the environment."""

import base64
import hashlib
import json
import os
import struct
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from solders.pubkey import Pubkey


PROGRAM = Pubkey.from_string("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd")
TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
KLEND = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
VAULT_SIZE = 62552  # Anchor discriminator + official VaultState size 62544.
DISC = hashlib.sha256(b"account:VaultState").digest()[:8]
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
OUT = Path(__file__).with_name("kvault-idle-pda-census.json")


def b58(data):
    value = int.from_bytes(data, "big")
    out = ""
    while value:
        value, digit = divmod(value, 58)
        out = BASE58[digit] + out
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + out


def rpc(method, params):
    url = os.environ.get("RPC_URL")
    if not url:
        raise RuntimeError("RPC_URL is required")
    for attempt in range(4):
        res = requests.post(
            url,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            timeout=60,
        )
        if res.status_code != 429:
            break
        time.sleep(attempt + 1)
    res.raise_for_status()
    reply = res.json()
    if "error" in reply:
        raise RuntimeError(f"{method}: {reply['error']}")
    return reply["result"]


def account_batch(addresses):
    result = []
    for start in range(0, len(addresses), 100):
        part = addresses[start : start + 100]
        response = rpc(
            "getMultipleAccounts",
            [part, {"encoding": "base64", "commitment": "confirmed"}],
        )
        result.extend(response["value"])
    return result


def key(data):
    return str(Pubkey.from_bytes(data))


def main():
    states = rpc(
        "getProgramAccounts",
        [
            str(PROGRAM),
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [
                    {"dataSize": VAULT_SIZE},
                    {"memcmp": {"offset": 0, "bytes": b58(DISC)}},
                ],
                "dataSlice": {"offset": 0, "length": 248},
            },
        ],
    )
    rows = []
    for item in states["value"]:
        raw = base64.b64decode(item["account"]["data"][0])
        if len(raw) < 240 or raw[:8] != DISC:
            continue
        address = item["pubkey"]
        vault_key = Pubkey.from_string(address)
        expected_authority, bump = Pubkey.find_program_address(
            [b"authority", bytes(vault_key)], PROGRAM
        )
        expected_vault, _ = Pubkey.find_program_address(
            [b"token_vault", bytes(vault_key)], PROGRAM
        )
        row = {
            "state": address,
            "stateOwnedByProgram": item["account"]["owner"] == str(PROGRAM),
            "authority": key(raw[40:72]),
            "authorityMatchesPda": key(raw[40:72]) == str(expected_authority),
            "authorityBumpMatches": struct.unpack_from("<Q", raw, 72)[0] == bump,
            "mint": key(raw[80:112]),
            "decimals": struct.unpack_from("<Q", raw, 112)[0],
            "tokenVault": key(raw[120:152]),
            "tokenVaultMatchesPda": key(raw[120:152]) == str(expected_vault),
            "tokenProgram": key(raw[152:184]),
            "tokenAvailableState": struct.unpack_from("<Q", raw, 224)[0],
        }
        rows.append(row)

    account_data = account_batch([row["tokenVault"] for row in rows])
    totals = defaultdict(lambda: {"accounts": 0, "rawAmount": 0, "decimals": None})
    for row, account in zip(rows, account_data):
        row["idleTokenAccountPresent"] = account is not None
        row["idleTokenAccountValid"] = False
        if account is None:
            continue
        data = base64.b64decode(account["data"][0])
        if len(data) < 72:
            continue
        amount = struct.unpack_from("<Q", data, 64)[0]
        row["idleRawAmount"] = amount
        row["idleTokenAccountValid"] = (
            account["owner"] == row["tokenProgram"]
            and key(data[:32]) == row["mint"]
            and key(data[32:64]) == row["authority"]
            and row["stateOwnedByProgram"]
            and row["authorityMatchesPda"]
            and row["authorityBumpMatches"]
            and row["tokenVaultMatchesPda"]
        )
        if row["idleTokenAccountValid"] and amount:
            item = totals[row["mint"]]
            item["accounts"] += 1
            item["rawAmount"] += amount
            item["decimals"] = row["decimals"]

    # The vault's invested asset is its cToken claim on a KLend reserve. Verify
    # every recorded cToken account against the published PDA seeds, its SPL
    # token authority, and a real KLend-owned reserve. Do not sum cToken units
    # with underlying KLend liquidity or assign them a USD price here.
    allocations_reply = rpc(
        "getProgramAccounts",
        [
            str(PROGRAM),
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [
                    {"dataSize": VAULT_SIZE},
                    {"memcmp": {"offset": 0, "bytes": b58(DISC)}},
                ],
                "dataSlice": {"offset": 312, "length": 25 * 2160},
            },
        ],
    )
    row_by_state = {row["state"]: row for row in rows}
    allocations = []
    for item in allocations_reply["value"]:
        state = item["pubkey"]
        if state not in row_by_state:
            continue
        raw = base64.b64decode(item["account"]["data"][0])
        state_key = Pubkey.from_string(state)
        for index in range(25):
            offset = index * 2160
            reserve = Pubkey.from_bytes(raw[offset : offset + 32])
            if reserve == Pubkey.default():
                continue
            stored = Pubkey.from_bytes(raw[offset + 32 : offset + 64])
            derived, _ = Pubkey.find_program_address(
                [b"ctoken_vault", bytes(state_key), bytes(reserve)], PROGRAM
            )
            allocations.append(
                {
                    "state": state,
                    "reserve": str(reserve),
                    "cTokenVault": str(stored),
                    "cTokenVaultMatchesPda": stored == derived,
                    "recordedCtokenAllocation": struct.unpack_from(
                        "<Q", raw, offset + 1104
                    )[0],
                }
            )
    ctoken_accounts = account_batch([row["cTokenVault"] for row in allocations])
    reserve_addresses = sorted({row["reserve"] for row in allocations})
    reserve_accounts = dict(
        zip(reserve_addresses, account_batch(reserve_addresses))
    )
    reserve_facts = {}
    for address, account in reserve_accounts.items():
        if account is None or account["owner"] != KLEND:
            continue
        data = base64.b64decode(account["data"][0])
        if len(data) != 8624:
            continue
        u64 = lambda offset: struct.unpack_from("<Q", data, offset)[0]
        u128 = lambda offset: int.from_bytes(data[offset : offset + 16], "little")
        total_liquidity_bits = (
            u64(224) * (1 << 60)
            + u128(232)
            - u128(344)
            - u128(360)
            - u128(376)
        )
        reserve_facts[address] = {
            "liquidityMint": key(data[128:160]),
            "collateralMint": key(data[2560:2592]),
            "collateralSupply": u64(2592),
            "totalLiquidityBits": total_liquidity_bits,
        }
    invested_underlying = defaultdict(lambda: {"accounts": 0, "rawAmount": 0, "decimals": None})
    for row, account in zip(allocations, ctoken_accounts):
        state = row_by_state[row["state"]]
        reserve = reserve_facts.get(row["reserve"])
        row["reserveOwnedByKlend"] = reserve is not None
        row["cTokenAccountValid"] = False
        if account is None:
            continue
        raw = base64.b64decode(account["data"][0])
        if len(raw) < 72:
            continue
        row["cTokenMint"] = key(raw[:32])
        row["cTokenRawAmount"] = struct.unpack_from("<Q", raw, 64)[0]
        row["reserveLiquidityMintMatchesVault"] = (
            reserve is not None and reserve["liquidityMint"] == state["mint"]
        )
        row["reserveCollateralMintMatchesCtoken"] = (
            reserve is not None and reserve["collateralMint"] == row["cTokenMint"]
        )
        row["cTokenAccountValid"] = (
            row["cTokenVaultMatchesPda"]
            and row["reserveOwnedByKlend"]
            and row["reserveLiquidityMintMatchesVault"]
            and row["reserveCollateralMintMatchesCtoken"]
            and account["owner"] == TOKEN
            and key(raw[32:64]) == state["authority"]
        )
        if row["cTokenAccountValid"] and reserve["collateralSupply"]:
            # KLend Reserve::collateral_exchange_rate() uses current total
            # liquidity divided by collateral supply. Fraction is U68F60.
            row["investedUnderlyingEquivalentRaw"] = (
                row["cTokenRawAmount"] * reserve["totalLiquidityBits"]
                // ((1 << 60) * reserve["collateralSupply"])
            )
            item = invested_underlying[state["mint"]]
            item["accounts"] += 1
            item["rawAmount"] += row["investedUnderlyingEquivalentRaw"]
            item["decimals"] = state["decimals"]

    ctoken_by_reserve = defaultdict(int)
    for row in allocations:
        if row["cTokenAccountValid"]:
            ctoken_by_reserve[row["reserve"]] += row["cTokenRawAmount"]
    over_supply_reserves = [
        address
        for address, amount in ctoken_by_reserve.items()
        if amount > reserve_facts[address]["collateralSupply"]
    ]

    summary = {
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "stateSlot": states["context"]["slot"],
        "allocationSlot": allocations_reply["context"]["slot"],
        "program": str(PROGRAM),
        "expectedAnchorAccountSpace": VAULT_SIZE,
        "stateCount": len(rows),
        "verifiedIdleTokenVaultCount": sum(r["idleTokenAccountValid"] for r in rows),
        "nonzeroVerifiedIdleTokenVaultCount": sum(
            r["idleTokenAccountValid"] and r.get("idleRawAmount", 0) > 0 for r in rows
        ),
        "invalidRows": [
            r["state"] for r in rows if not r["idleTokenAccountValid"]
        ],
        "recordedCtokenAllocations": len(allocations),
        "verifiedCtokenVaults": sum(r["cTokenAccountValid"] for r in allocations),
        "nonzeroVerifiedCtokenVaults": sum(
            r["cTokenAccountValid"] and r.get("cTokenRawAmount", 0) > 0
            for r in allocations
        ),
        "invalidCtokenVaults": [
            r["cTokenVault"] for r in allocations if not r["cTokenAccountValid"]
        ],
        "ctokenAggregateExceedsReserveSupply": over_supply_reserves,
        "byMint": {
            mint: {
                **data,
                "uiAmount": data["rawAmount"] / 10 ** data["decimals"],
            }
            for mint, data in totals.items()
        },
        "investedUnderlyingEquivalentByMint": {
            mint: {
                **data,
                "uiAmount": data["rawAmount"] / 10 ** data["decimals"],
            }
            for mint, data in invested_underlying.items()
        },
        "scope": "Idle token vaults are direct balances. Invested cToken claims are converted to underlying units from current KLend reserve supply/exchange-rate state, observed at nearby non-atomic slots. They overlap KLend underlying liquidity, are not additive to KLend custody, and are not priced in USD here.",
    }
    OUT.write_text(
        json.dumps(
            {
                "summary": summary,
                "rows": rows,
                "allocations": allocations,
                "reserves": reserve_facts,
            },
            indent=2,
        )
        + "\n"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Kvault census failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
