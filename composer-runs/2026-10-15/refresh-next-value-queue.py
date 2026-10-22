#!/usr/bin/env python3
"""Refresh candidate program/vault/authority accounts with read-only mainnet RPC."""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ENV = Path("/tmp/composer-helius-only.env")
RANKING = ROOT / "mainnet-long-tail-custody-ranked.json"
CALLERS = ROOT / "mainnet-token-authority-caller-programs.json"
OUTPUT = ROOT / "next-value-queue-current-accounts.json"

PROGRAMS = [
    "HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn",
    "onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe",
    "HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ",
    "eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3",
    "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz",
    "8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC",
    "4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT",
    "StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT",
    "LLoc8JX5dLAMVzbzTNKG6EFpkyJ9XCsVAGkqwQKUJoa",
    "BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi",
    "zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T",
    "VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj",
    "pytS9TjG1qyAZypk7n8rw8gfW9sUaqqYyMhJQ4E7JCQ",
    "1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78",
    "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw",
    "FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP",
]


def load_rpc_url() -> str:
    env = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip().removeprefix("export ")] = value.strip().strip("'\"")
    return os.environ.get("RPC_URL") or env["RPC_URL"]


def rpc(url: str, ids: list[str]) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getMultipleAccounts",
        "params": [ids, {"encoding": "jsonParsed", "commitment": "confirmed"}],
    }
    request = Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    for attempt in range(5):
        try:
            with urlopen(request, timeout=30) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(str(result["error"]))
            return result["result"]
        except (HTTPError, URLError, RuntimeError):
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise AssertionError


def main() -> None:
    ranking = json.loads(RANKING.read_text())["ranking"]
    callers = json.loads(CALLERS.read_text())["programs"]
    rank = {row["programId"]: row for row in ranking}
    call = {row["programId"]: row for row in callers}
    selected = {}
    for program_id in PROGRAMS:
        row = rank.get(program_id)
        if row:
            vaults = []
            for authority in row.get("sampledAuthorities", []):
                for account in authority.get("tokenAccounts", []):
                    vaults.append((authority["authority"], account))
        else:
            vaults = []
            for authority in call[program_id].get("authorities", []):
                for account in authority.get("tokenAccounts", []):
                    vaults.append((authority["authority"], account))
        selected[program_id] = vaults
    keys = sorted(
        set(PROGRAMS)
        | {authority for vaults in selected.values() for authority, _ in vaults}
        | {account["address"] for vaults in selected.values() for _, account in vaults}
    )
    url = load_rpc_url()
    accounts = {}
    slots = []
    for start in range(0, len(keys), 50):
        batch = keys[start : start + 50]
        result = rpc(url, batch)
        slots.append(result["context"]["slot"])
        for key, value in zip(batch, result["value"]):
            if value is None:
                accounts[key] = {"exists": False}
                continue
            data = value.get("data")
            parsed = data.get("parsed") if isinstance(data, dict) else None
            info = parsed.get("info", {}) if isinstance(parsed, dict) else {}
            accounts[key] = {
                "exists": True,
                "owner": value["owner"],
                "executable": value["executable"],
                "lamports": value["lamports"],
                "parsedType": parsed.get("type") if isinstance(parsed, dict) else None,
                "tokenAuthority": info.get("owner"),
                "mint": info.get("mint"),
                "rawAmount": info.get("tokenAmount", {}).get("amount"),
                "uiAmountString": info.get("tokenAmount", {}).get("uiAmountString"),
            }
    results = []
    for program_id, vaults in selected.items():
        rows = []
        for authority, old in vaults:
            now = accounts[old["address"]]
            rows.append(
                {
                    "authority": authority,
                    "vault": old["address"],
                    "mint": old["mint"],
                    "symbol": old["symbol"],
                    "authorityAccountOwner": accounts[authority].get("owner"),
                    "tokenAuthority": now.get("tokenAuthority"),
                    "tokenMint": now.get("mint"),
                    "rawAmount": now.get("rawAmount"),
                    "uiAmountString": now.get("uiAmountString"),
                    "usdPricePrior": old.get("usdPrice"),
                    "authorityAndMintMatch": (
                        now.get("tokenAuthority") == authority and now.get("mint") == old["mint"]
                    ),
                }
            )
        results.append(
            {
                "programId": program_id,
                "executable": accounts[program_id].get("executable"),
                "loaderOwner": accounts[program_id].get("owner"),
                "vaults": rows,
            }
        )
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "readOnly": True,
        "rpcMethod": "getMultipleAccounts",
        "contextSlotMin": min(slots),
        "contextSlotMax": max(slots),
        "programCount": len(PROGRAMS),
        "accountCount": len(keys),
        "results": results,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(
        json.dumps(
            {
                "output": str(OUTPUT),
                "programCount": len(PROGRAMS),
                "accountCount": len(keys),
                "contextSlotMin": min(slots),
                "contextSlotMax": max(slots),
                "allProgramsExecutable": all(row["executable"] for row in results),
                "vaultsMatched": sum(
                    vault["authorityAndMintMatch"]
                    for row in results
                    for vault in row["vaults"]
                ),
                "vaultsTotal": sum(len(row["vaults"]) for row in results),
            }
        )
    )


if __name__ == "__main__":
    main()
