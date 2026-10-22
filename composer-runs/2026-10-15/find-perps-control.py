#!/usr/bin/env python3
"""Find a successful transaction containing a named Perps instruction."""
import json, os, time, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent
TARGET = os.environ["AUDIT_TARGET_ADDRESS"]
WANTED = set(os.environ["AUDIT_WANTED"].split(","))
MAX_PAGES = int(os.environ.get("AUDIT_MAX_PAGES", "10"))
LABEL = os.environ.get("AUDIT_LABEL", "control")
RPC = dict(line.split("=",1) for line in Path("/tmp/composer-helius-only.env").read_text().splitlines() if "=" in line)["RPC_URL"]
def rpc(calls):
    req=urllib.request.Request(RPC,json.dumps([{"jsonrpc":"2.0","id":i,"method":m,"params":p} for i,(m,p) in enumerate(calls)]).encode(),{"Content-Type":"application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req,timeout=90) as response: objects=json.load(response)
            if isinstance(objects,dict):objects=[objects]
            out=[]
            for item in sorted(objects,key=lambda x:x["id"]):
                if item.get("error"):raise RuntimeError(item["error"])
                out.append(item.get("result"))
            return out
        except Exception:
            if attempt==4:raise
            time.sleep(1+attempt*2)
before=None;found=[]
for page in range(1,MAX_PAGES+1):
    opts={"limit":1000}
    if before:opts["before"]=before
    signatures=rpc([("getSignaturesForAddress",[TARGET,opts])])[0]
    if not signatures:break
    before=signatures[-1]["signature"]
    for offset in range(0,len(signatures),50):
        chunk=signatures[offset:offset+50]
        txs=rpc([("getTransaction",[s["signature"],{"encoding":"json","maxSupportedTransactionVersion":1}]) for s in chunk])
        for signature,tx in zip(chunk,txs):
            if not tx or tx.get("meta",{}).get("err") is not None:continue
            names=[line.partition("Instruction: ")[2] for line in tx["meta"].get("logMessages",[]) if "Instruction: " in line]
            matched=sorted(WANTED.intersection(names))
            if matched:
                record={"signature":signature["signature"],"slot":tx["slot"],"blockTime":tx.get("blockTime"),"matched":matched}
                found.append(record);(ROOT/f"perps-{LABEL}-{signature['signature']}.json").write_text(json.dumps(tx))
                break
        if found:break
    print(json.dumps({"page":page,"oldestSlot":signatures[-1]["slot"],"found":found}),flush=True)
    if found:break
(ROOT/f"perps-{LABEL}-search.json").write_text(json.dumps({"target":TARGET,"wanted":sorted(WANTED),"pages":page,"oldestSlot":signatures[-1]["slot"],"found":found},indent=2))
