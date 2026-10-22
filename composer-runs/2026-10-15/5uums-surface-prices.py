#!/usr/bin/env python3
"""Read-only Jupiter price and token metadata snapshot for exact live PDA token list."""
import datetime as dt
from decimal import Decimal
import json
import pathlib
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "5uums-surface-token-census.json"
OUTPUT = HERE / "5uums-surface-prices.json"


def get_json(url):
    request = urllib.request.Request(url, headers={"user-agent": "composer-rescue-readonly/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    census = json.loads(SOURCE.read_text())
    mints = sorted({a["mint"] for a in census["tokenAccounts"]})
    prices, metadata = {}, {}
    for start in range(0, len(mints), 50):
        query = urllib.parse.quote(",".join(mints[start:start+50]), safe=",")
        prices.update(get_json("https://api.jup.ag/price/v3?ids=" + query))
    for start in range(0, len(mints), 100):
        query = urllib.parse.quote(",".join(mints[start:start+100]), safe=",")
        metadata.update({item["id"]: item for item in get_json("https://api.jup.ag/tokens/v2/search?query=" + query) if item.get("id") in mints})
    rows = []
    for a in census["tokenAccounts"]:
        price = prices.get(a["mint"])
        meta = metadata.get(a["mint"])
        row = {"address": a["address"], "authority": a["authority"], "mint": a["mint"],
               "amountRaw": a["amountRaw"], "uiAmountExact": a["uiAmountExact"],
               "decimals": a["decimals"], "symbol": meta.get("symbol") if meta else None,
               "name": meta.get("name") if meta else None,
               "isVerified": meta.get("isVerified") if meta else None,
               "price": price}
        row["markUsd"] = str(Decimal(a["uiAmountExact"]) * Decimal(str(price["usdPrice"]))) if price and price.get("usdPrice") is not None else None
        rows.append(row)
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
           "method": "Jupiter Price v3 / Tokens v2 read-only API; USD spot marks are not liquid proceeds",
           "source": SOURCE.name, "mintCount": len(mints), "priceCoverage": len(prices),
           "metadataCoverage": len(metadata), "rows": rows}
    OUTPUT.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"mintCount": len(mints), "priceCoverage": len(prices),
                      "metadataCoverage": len(metadata), "positiveMarkRows": sum(r["markUsd"] is not None for r in rows)}, indent=2))


if __name__ == "__main__":
    main()
