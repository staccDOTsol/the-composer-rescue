"""Read-only RPC scan for recent successful Raydium CPMM value-moving calls."""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
DEFAULT_ADDRESSES = [
    PROGRAM,
    "Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp",
    "gyYigqG8vdEMkDNTTVL6at2msbHdTDWyb6bccyR238U",
    "HKRn6cDo5ACgWYY4N52ScCNzziAMSgS5YaEfwsBu4nu3",
    "FAn5gzoJMYriKeCoJzLTCepE9Y36oN3CidoF4dmgFNh9",
    "7SJ5UKJoqBUGjt1PT7AeSF7FKPgpnxeYMHHcejTiGQzc",
]
ADDRESSES = [
    value for value in os.environ.get("SCAN_ADDRESSES", ",".join(DEFAULT_ADDRESSES)).split(",") if value
]
NAMES = {
    "8fbe5adac41e33de": "swap_base_input",
    "37d96256a34ab4ad": "swap_base_output",
    "f223c68952e1f2b6": "deposit",
    "b712469c946da122": "withdraw",
}
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
RPC = os.environ.get("RPC_URL") or os.environ.get("HEAVY_RPC_URL")
OUT = Path(os.environ.get("SCAN_OUT", Path(__file__).with_name("raydium-cpmm-history-samples.json")))
TARGET_SWAPS = int(os.environ.get("TARGET_SWAPS", "5"))
TARGET_WITHDRAWS = int(os.environ.get("TARGET_WITHDRAWS", "5"))


def call(method, params):
    for attempt in range(5):
        try:
            response = requests.post(
                RPC,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=40,
            )
            response.raise_for_status()
            body = response.json()
            if body.get("error"):
                raise RuntimeError(body["error"])
            return body["result"]
        except Exception:
            if attempt == 4:
                raise
            time.sleep(0.4 * 2**attempt)


def b58decode(value):
    number = 0
    for char in value:
        number = number * 58 + ALPHABET.index(char)
    leading = len(value) - len(value.lstrip("1"))
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * leading + raw


def normalized(tx):
    message = tx["transaction"]["message"]
    static = list(message["accountKeys"])
    loaded = tx["meta"].get("loadedAddresses") or {}
    loaded_writable = list(loaded.get("writable") or [])
    loaded_readonly = list(loaded.get("readonly") or [])
    keys = static + loaded_writable + loaded_readonly
    header = message["header"]
    required = header["numRequiredSignatures"]
    readonly_signed = header["numReadonlySignedAccounts"]
    readonly_unsigned = header["numReadonlyUnsignedAccounts"]

    def flags(index):
        if index < len(static):
            signer = index < required
            if signer:
                writable = index < required - readonly_signed
            else:
                writable = index < len(static) - readonly_unsigned
        else:
            signer = False
            writable = index < len(static) + len(loaded_writable)
        return {"signer": signer, "writable": writable}

    groups = [("top", message["instructions"])]
    groups += [(f"inner:{g['index']}", g["instructions"]) for g in tx["meta"].get("innerInstructions") or []]
    matches = []
    for where, instructions in groups:
        for offset, ix in enumerate(instructions):
            if keys[ix["programIdIndex"]] != PROGRAM:
                continue
            raw = b58decode(ix.get("data") or "")
            name = NAMES.get(raw[:8].hex())
            if not name:
                continue
            matches.append(
                {
                    "where": f"{where}:{offset}",
                    "name": name,
                    "dataHex": raw.hex(),
                    "accounts": [
                        {"address": keys[index], **flags(index)} for index in ix["accounts"]
                    ],
                }
            )
    return matches


samples = []
seen = set()
scanned = 0
for address in ADDRESSES:
    signatures = call("getSignaturesForAddress", [address, {"limit": 1000}])
    signatures = [row["signature"] for row in signatures if not row.get("err") and row["signature"] not in seen]
    for start in range(0, len(signatures), 100):
        batch = signatures[start : start + 100]
        fetched = {}
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {
                executor.submit(
                    call,
                    "getTransaction",
                    [sig, {"encoding": "json", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}],
                ): sig
                for sig in batch
            }
            for future in as_completed(futures):
                sig = futures[future]
                try:
                    fetched[sig] = future.result()
                except Exception as error:
                    fetched[sig] = {"fetchError": str(error)}
        for sig in batch:
            seen.add(sig)
            tx = fetched[sig]
            if not tx or tx.get("fetchError") or tx["meta"].get("err"):
                continue
            matches = normalized(tx)
            for match in matches:
                if sum(row["instruction"]["name"] == match["name"] for row in samples) >= 12:
                    continue
                samples.append(
                    {
                        "signature": sig,
                        "slot": tx["slot"],
                        "blockTime": tx.get("blockTime"),
                        "scanAddress": address,
                        "feePayer": tx["transaction"]["message"]["accountKeys"][0],
                        "instruction": match,
                    }
                )
        scanned += len(batch)
        counts = {name: sum(row["instruction"]["name"] == name for row in samples) for name in NAMES.values()}
        OUT.write_text(json.dumps({"program": PROGRAM, "transactionsScanned": scanned, "counts": counts, "samples": samples}, indent=2))
        print(json.dumps({"address": address, "offset": start, "scanned": scanned, "counts": counts}), flush=True)
        if counts["withdraw"] >= TARGET_WITHDRAWS and counts["swap_base_input"] >= TARGET_SWAPS:
            break
    counts = {name: sum(row["instruction"]["name"] == name for row in samples) for name in NAMES.values()}
    if counts["withdraw"] >= TARGET_WITHDRAWS and counts["swap_base_input"] >= TARGET_SWAPS:
        break
