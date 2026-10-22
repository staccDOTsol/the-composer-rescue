#!/usr/bin/env python3
"""Bounded read-only JLP history scan for current Perps liquidation controls."""
import json, os, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4"
WANTED = {"LiquidateBorrowPosition", "PartialLiquidateBorrowPosition", "LiquidateFullPosition4"}
RPC = dict(line.split("=", 1) for line in Path("/tmp/composer-helius-only.env").read_text().splitlines() if "=" in line)["RPC_URL"]
MAX_PAGES = int(os.environ.get("AUDIT_MAX_PAGES", "40"))

def rpc(calls):
    payload = [{"jsonrpc":"2.0","id":i,"method":m,"params":p} for i,(m,p) in enumerate(calls)]
    req = urllib.request.Request(RPC, json.dumps(payload).encode(), {"Content-Type":"application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=90) as response: objects = json.load(response)
            if isinstance(objects, dict): objects = [objects]
            ordered = []
            for item in sorted(objects, key=lambda x:x["id"]):
                if item.get("error"): raise RuntimeError(item["error"])
                ordered.append(item.get("result"))
            return ordered
        except Exception:
            if attempt == 4: raise
            time.sleep(1 + attempt * 2)

before = None
found = []
for page in range(1, MAX_PAGES + 1):
    options = {"limit":1000}
    if before: options["before"] = before
    signatures = rpc([("getSignaturesForAddress", [TARGET, options])])[0]
    if not signatures: break
    before = signatures[-1]["signature"]
    for offset in range(0, len(signatures), 50):
        chunk = signatures[offset:offset+50]
        transactions = rpc([("getTransaction", [x["signature"], {"encoding":"json", "maxSupportedTransactionVersion":1}]) for x in chunk])
        for signature, transaction in zip(chunk, transactions):
            if not transaction or transaction.get("meta",{}).get("err") is not None: continue
            names = [line.partition("Instruction: ")[2] for line in transaction["meta"].get("logMessages",[]) if "Instruction: " in line]
            matched = sorted(WANTED.intersection(names))
            if matched:
                record = {"signature":signature["signature"], "slot":transaction["slot"], "blockTime":transaction.get("blockTime"), "matched":matched}
                found.append(record)
                (ROOT/f"perps-liquidation-{signature['signature']}.json").write_text(json.dumps(transaction))
    print(json.dumps({"page":page,"oldestSlot":signatures[-1]["slot"],"found":found[-3:]}), flush=True)
    if found: break
(ROOT/"perps-liquidation-search.json").write_text(json.dumps({"pages":page,"oldestSlot":signatures[-1]["slot"],"found":found}, indent=2))
