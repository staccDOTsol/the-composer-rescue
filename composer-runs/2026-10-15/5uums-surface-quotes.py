#!/usr/bin/env python3
"""Read-only Jupiter quotes for each live PDA-owned token account in the census."""
import datetime as dt
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "5uums-surface-token-census.json"
OUTPUT = HERE / "5uums-surface-quotes.json"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote"


def quote(mint, amount):
    query = urllib.parse.urlencode({"inputMint": mint, "outputMint": USDC,
                                    "amount": amount, "slippageBps": 50})
    url = QUOTE_URL + "?" + query
    request = urllib.request.Request(url, headers={"user-agent": "composer-rescue-readonly/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.load(response)
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        try:
            body = json.loads(exc.read())
        except Exception:
            body = {"error": "non-JSON HTTP response"}
    except Exception as exc:
        status = None
        body = {"error": f"{type(exc).__name__}: {exc}"}
    result = {"inputAmountRaw": str(amount), "url": url,
              "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "httpStatus": status}
    if isinstance(body, dict) and "outAmount" in body:
        result.update({"outUSDCraw": body["outAmount"],
                       "outUSDC": str(int(body["outAmount"]) / 1_000_000),
                       "priceImpactPct": body.get("priceImpactPct"),
                       "contextSlot": body.get("contextSlot"),
                       "routePlan": body.get("routePlan")})
    else:
        result["error"] = body
    return result


def main():
    census = json.loads(SOURCE.read_text())
    accounts = [a for a in census["tokenAccounts"] if int(a["amountRaw"]) > 0]
    previous = {}
    if OUTPUT.exists():
        prior = json.loads(OUTPUT.read_text())
        previous = {(t["address"], t["amountRaw"]): t for t in prior.get("tokens", [])}
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
           "method": "Jupiter Metis read-only exact-in quote; no transaction built or submitted",
           "source": SOURCE.name, "sourceSummary": census.get("summary"),
           "outputMint": USDC, "slippageBps": 50, "tokens": []}
    for idx, account in enumerate(accounts, 1):
        item = {key: account[key] for key in ("address", "mint", "authority", "amountRaw", "decimals", "uiAmountExact")}
        saved = previous.get((item["address"], item["amountRaw"]))
        if saved:
            out["tokens"].append(saved)
            continue
        full = quote(item["mint"], int(item["amountRaw"]))
        item["fullVault"] = full
        if "outUSDCraw" not in full:
            probes = []
            for divisor in (100, 10000):
                amount = max(1, int(item["amountRaw"]) // divisor)
                probes.append({"fraction": f"1/{divisor}", **quote(item["mint"], amount)})
                time.sleep(0.35)
            item["probes"] = probes
        out["tokens"].append(item)
        OUTPUT.write_text(json.dumps(out, indent=2) + "\n")
        print(f"{idx}/{len(accounts)} {item['mint']} full: {full.get('outUSDC', full.get('error'))}", flush=True)
        time.sleep(0.35)
    out["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    OUTPUT.write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
