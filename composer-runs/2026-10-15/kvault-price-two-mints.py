#!/usr/bin/env python3
"""Price only the verified PYUSD and USDC Kvault claims in a saved census."""

import json
from decimal import Decimal
from pathlib import Path

import requests


ROOT = Path(__file__).parent
SOURCE = ROOT / "kvault-idle-pda-census.json"
OUT = ROOT / "kvault-priced-lower-bound.json"
MINTS = {
    "PYUSD": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
}
PRICE_URL = (
    "https://coins.llama.fi/prices/current/"
    + ",".join(f"solana:{mint}" for mint in MINTS.values())
)


def main():
    census = json.loads(SOURCE.read_text())["summary"]
    prices = requests.get(PRICE_URL, timeout=20)
    prices.raise_for_status()
    coins = prices.json()["coins"]
    rows = {}
    total = Decimal(0)
    for symbol, mint in MINTS.items():
        idle = census["byMint"][mint]
        invested = census["investedUnderlyingEquivalentByMint"][mint]
        decimals = idle["decimals"]
        if decimals != invested["decimals"] or decimals != coins[f"solana:{mint}"]["decimals"]:
            raise RuntimeError(f"decimal mismatch for {symbol}")
        idle_ui = Decimal(idle["rawAmount"]) / (10**decimals)
        invested_ui = Decimal(invested["rawAmount"]) / (10**decimals)
        price = Decimal(str(coins[f"solana:{mint}"]["price"]))
        usd = (idle_ui + invested_ui) * price
        total += usd
        rows[symbol] = {
            "mint": mint,
            "idleUi": str(idle_ui),
            "investedUnderlyingEquivalentUi": str(invested_ui),
            "totalUi": str(idle_ui + invested_ui),
            "priceUsd": str(price),
            "priceTimestamp": coins[f"solana:{mint}"]["timestamp"],
            "priceConfidence": coins[f"solana:{mint}"].get("confidence"),
            "pricedClaimUsd": str(usd),
        }
    result = {
        "sourceStateSlot": census["stateSlot"],
        "sourceAllocationSlot": census["allocationSlot"],
        "sourceCensus": str(SOURCE),
        "priceSource": PRICE_URL,
        "pricedMintsOnly": rows,
        "partialPricedClaimUsd": str(total),
        "scope": "Only PYUSD and USDC; omits all other Kvault assets. Invested claims use near-slot KLend exchange rates, overlap underlying KLend liquidity, and are not additive to KLend custody. Quoted USD depends on the external spot prices at their stated timestamp.",
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
