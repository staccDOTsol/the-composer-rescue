#!/usr/bin/env python3
"""Capture current mint and token account facts with read-only Solana RPC."""
import base64
import datetime as dt
import json
import pathlib
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = json.loads((HERE / "long-tail-current-check.json").read_text())
PROGRAM = "5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9"
target = next(x for x in SOURCE["rows"] if x["programId"] == PROGRAM)
endpoint = next(line.partition("=")[2].strip() for line in pathlib.Path("/tmp/composer-helius-rpc.env").read_text().splitlines()
                if line.startswith("RPC_URL="))


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(endpoint, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        result = json.load(response)
    if result.get("error"):
        raise RuntimeError(f"{method}: {result['error']}")
    return result["result"]


ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(data):
    n = int.from_bytes(data, "big")
    s = ""
    while n:
        n, rem = divmod(n, 58)
        s = ALPHABET[rem] + s
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + s


addresses = [PROGRAM, target["authority"]] + [v["address"] for v in target["vaults"]] + [v["mint"] for v in target["vaults"]]
response = rpc("getMultipleAccounts", [addresses, {"encoding": "base64", "commitment": "confirmed"}])
report = {"generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "method": "getMultipleAccounts confirmed",
          "slot": response["context"]["slot"], "programId": PROGRAM, "authority": target["authority"],
          "accounts": []}
for address, info in zip(addresses, response["value"]):
    if info is None:
        report["accounts"].append({"address": address, "exists": False})
        continue
    data = base64.b64decode(info["data"][0])
    row = {"address": address, "exists": True, "owner": info["owner"], "executable": info["executable"], "dataLength": len(data)}
    if address in [v["address"] for v in target["vaults"]]:
        row["kind"] = "splTokenAccount"
        row["mint"] = b58(data[:32]); row["authority"] = b58(data[32:64]); row["rawAmount"] = str(int.from_bytes(data[64:72], "little"))
        row["state"] = data[108]
    elif address in [v["mint"] for v in target["vaults"]]:
        row["kind"] = "splMint"
        row["mintAuthority"] = b58(data[4:36]) if int.from_bytes(data[:4], "little") == 1 else None
        row["supplyRaw"] = str(int.from_bytes(data[36:44], "little"))
        row["decimals"] = data[44]; row["initialized"] = bool(data[45])
        row["freezeAuthority"] = b58(data[50:82]) if int.from_bytes(data[46:50], "little") == 1 else None
    report["accounts"].append(row)

for account in report["accounts"]:
    if account.get("kind") != "splTokenAccount":
        continue
    mint = next(x for x in report["accounts"] if x["address"] == account["mint"])
    account["uiAmount"] = int(account["rawAmount"]) / 10 ** mint["decimals"]
    account["pctMintSupply"] = 100 * int(account["rawAmount"]) / int(mint["supplyRaw"])

out = HERE / "5uu-live-state.json"
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
