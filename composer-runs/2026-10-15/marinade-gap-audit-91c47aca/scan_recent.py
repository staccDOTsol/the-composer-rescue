"""Read-only classifier for recent Marinade mainnet instructions."""

import hashlib
import json
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def configured_rpc():
    for line in Path("/tmp/composer-helius-only.env").read_text().splitlines():
        key, _, value = line.partition("=")
        if key in ("HEAVY_RPC_URL", "RPC_URL") and value:
            return value
    return os.environ.get("SOLANA_RPC", "http://127.0.0.1:19599")


RPC = configured_rpc()
PROGRAM = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD"
OUT = Path(__file__).with_name("recent-instructions.json")
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
NAMES = [
    "initialize",
    "change_authority",
    "add_validator",
    "remove_validator",
    "set_validator_score",
    "config_validator_system",
    "deposit",
    "deposit_stake_account",
    "liquid_unstake",
    "add_liquidity",
    "remove_liquidity",
    "config_lp",
    "config_marinade",
    "order_unstake",
    "claim",
    "stake_reserve",
    "update_active",
    "update_deactivated",
    "deactivate_stake",
    "emergency_unstake",
    "partial_unstake",
    "merge_stakes",
    "create_canonical_stake",
    "pause",
    "resume",
    "withdraw_stake_account",
    "realloc_validator_list",
    "realloc_stake_list",
    "finalize_delinquent_upgrade",
]
DISCRIMINATORS = {
    hashlib.sha256(f"global:{name}".encode()).digest()[:8]: name for name in NAMES
}


def b58decode(value: str) -> bytes:
    number = 0
    for char in value:
        number = number * 58 + ALPHABET.index(char)
    leading = len(value) - len(value.lstrip("1"))
    body = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * leading + body


def rpc(method, params):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = Request(RPC, data=payload, headers={"content-type": "application/json"})
    for attempt in range(7):
        try:
            with urlopen(request, timeout=15) as response:
                body = json.load(response)
            if body.get("error"):
                raise RuntimeError(body["error"])
            return body.get("result")
        except (HTTPError, TimeoutError, RuntimeError) as error:
            if attempt == 6:
                raise
            wait = min(12.0, 0.5 * (2**attempt))
            if isinstance(error, HTTPError) and error.code != 429:
                wait = 1.0
            time.sleep(wait)


def program_instructions(transaction):
    message = transaction["transaction"]["message"]
    groups = transaction.get("meta", {}).get("innerInstructions") or []
    instructions = list(message.get("instructions") or [])
    instructions.extend(ix for group in groups for ix in group.get("instructions", []))
    for ix in instructions:
        if ix.get("programId") != PROGRAM or "data" not in ix:
            continue
        raw = b58decode(ix["data"])
        yield {
            "name": DISCRIMINATORS.get(raw[:8], "unknown:" + raw[:8].hex()),
            "dataHex": raw.hex(),
            "accounts": ix.get("accounts", []),
        }


def main():
    signatures = []
    before = None
    for _ in range(10):
        options = {"limit": 100, "commitment": "finalized"}
        if before:
            options["before"] = before
        page = rpc("getSignaturesForAddress", [PROGRAM, options]) or []
        signatures.extend(page)
        if not page:
            break
        before = page[-1]["signature"]

    counts = Counter()
    samples = defaultdict(list)
    transaction_errors = 0
    def fetch(row):
        try:
            return row, rpc(
                "getTransaction",
                [
                    row["signature"],
                    {
                        "encoding": "jsonParsed",
                        "commitment": "finalized",
                        "maxSupportedTransactionVersion": 1,
                    },
                ],
            )
        except Exception:
            return row, None

    with ThreadPoolExecutor(max_workers=4) as pool:
      futures = [pool.submit(fetch, row) for row in signatures]
      for index, future in enumerate(as_completed(futures)):
        row, transaction = future.result()
        if not transaction:
            transaction_errors += 1
            continue
        for instruction in program_instructions(transaction):
            name = instruction["name"]
            counts[name] += 1
            if transaction["meta"]["err"] is None and len(samples[name]) < 8:
                samples[name].append(
                    {
                        "signature": row["signature"],
                        "slot": transaction["slot"],
                        "blockTime": transaction.get("blockTime"),
                        "feePayer": transaction["transaction"]["message"]["accountKeys"][0]["pubkey"],
                        **instruction,
                        "logs": transaction["meta"].get("logMessages"),
                    }
                )

    result = {
        "program": PROGRAM,
        "signaturesScanned": len(signatures),
        "missingTransactions": transaction_errors,
        "counts": dict(sorted(counts.items())),
        "successfulSamples": dict(sorted(samples.items())),
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("signaturesScanned", "missingTransactions", "counts")}, indent=2))


if __name__ == "__main__":
    main()
