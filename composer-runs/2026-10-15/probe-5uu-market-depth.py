#!/usr/bin/env python3
"""Read-only Jupiter quotes for the sampled 5UuM... vault token balances."""
import datetime as dt
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = json.loads((HERE / "long-tail-current-check.json").read_text())
TARGET = "5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
row = next(x for x in SOURCE["rows"] if x["programId"] == TARGET)


def get_json(url):
    req = urllib.request.Request(url, headers={"user-agent": "composer-rescue-readonly/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return {"httpStatus": response.status, "body": json.load(response)}
    except urllib.error.HTTPError as exc:
        return {"httpStatus": exc.code, "body": exc.read().decode("utf-8", "replace")[:5000]}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


report = {
    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    "method": "read-only Jupiter Metis exact-in quote; no transaction prepared or sent",
    "quoteEndpoint": "https://lite-api.jup.ag/swap/v1/quote",
    "sourceStateFile": "long-tail-current-check.json",
    "sourceStateObservedSlots": SOURCE["observationSlots"],
    "outputMint": USDC,
    "slippageBps": 50,
    "fractionsOfVaultRawBalance": [0.00001, 0.0001, 0.001, 0.01, 0.1, 1.0],
    "tokens": [],
}

for token in row["vaults"]:
    raw_balance = int(token["rawAmount"])
    item = {key: token[key] for key in ["address", "mint", "symbol", "rawAmount", "decimals", "usdPrice", "markUsd", "liquidity", "updatedAt"]}
    item["quotes"] = []
    for fraction in report["fractionsOfVaultRawBalance"]:
        amount = max(1, int(raw_balance * fraction))
        query = urllib.parse.urlencode({"inputMint": token["mint"], "outputMint": USDC,
                                        "amount": amount, "slippageBps": 50, "onlyDirectRoutes": "false"})
        url = report["quoteEndpoint"] + "?" + query
        response = get_json(url)
        item["quotes"].append({"fraction": fraction, "inputAmountRaw": str(amount),
                               "url": url, "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                               **response})
        time.sleep(0.3)
    report["tokens"].append(item)

out = HERE / "5uu-market-depth-quotes.json"
out.write_text(json.dumps(report, indent=2) + "\n")
for item in report["tokens"]:
    print(item["symbol"], "mark", round(item["markUsd"], 2), "metadata liquidity", round(item["liquidity"], 2))
    for q in item["quotes"]:
        body = q["body"]
        if isinstance(body, dict):
            amount_out = body.get("outAmount")
            print(q["fraction"], q["httpStatus"], "outUSDC", round(int(amount_out) / 1_000_000, 2) if amount_out else None,
                  "impact", body.get("priceImpactPct"), "error", body.get("error"))
        else:
            print(q["fraction"], q.get("httpStatus"), str(body)[:100])
print(out)
