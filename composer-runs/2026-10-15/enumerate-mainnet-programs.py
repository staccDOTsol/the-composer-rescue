#!/usr/bin/env python3
"""Enumerate Solana mainnet executable program accounts by loader owner.

Read-only RPC only. Credentials are read from an env file and never emitted.
The output is a compact CSV plus a JSON summary/fingerprint, not account data.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


LOADERS = {
    "upgradeable": "BPFLoaderUpgradeab1e11111111111111111111111",
    "bpf_loader_2": "BPFLoader2111111111111111111111111111111111",
    "bpf_loader_deprecated": "BPFLoader1111111111111111111111111111111111",
    "loader_v4": "LoaderV411111111111111111111111111111111111",
    "native": "NativeLoader1111111111111111111111111111111",
}
B58 = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(raw: bytes) -> str:
    zeroes = len(raw) - len(raw.lstrip(b"\0"))
    value = int.from_bytes(raw, "big")
    out = bytearray()
    while value:
        value, rem = divmod(value, 58)
        out.append(B58[rem])
    return (B58[:1] * zeroes + out[::-1]).decode()


def env_value(path: Path, key: str) -> str:
    for raw in path.read_text().splitlines():
        if raw.strip() and not raw.lstrip().startswith("#") and "=" in raw:
            name, value = raw.split("=", 1)
            if name.strip() == key:
                return value.strip().strip("\"'")
    raise KeyError(f"{key} not found in {path}")


def rpc(url: str, method: str, params: list, attempts: int = 8):
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        separators=(",", ":"),
    ).encode()
    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "Accept-Encoding": "identity"},
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.load(response)
            if "error" in result:
                raise RuntimeError(json.dumps(result["error"], sort_keys=True))
            return result["result"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            retryable = not isinstance(exc, urllib.error.HTTPError) or exc.code in {
                408, 425, 429, 500, 502, 503, 504
            }
            if attempt + 1 == attempts or not retryable:
                raise
            time.sleep(min(30, 2**attempt + random.random()))
    raise AssertionError("unreachable")


def scan(url: str) -> tuple[dict, dict[str, dict]]:
    summaries = {}
    executable: dict[str, dict] = {}
    for label, owner in LOADERS.items():
        config = {
            "commitment": "finalized",
            "encoding": "base64",
            "withContext": True,
            "dataSlice": {"offset": 0, "length": 36 if label == "upgradeable" else 0},
        }
        if label == "upgradeable":
            config["filters"] = [{"dataSize": 36}]
        result = rpc(url, "getProgramAccounts", [owner, config])
        rows = result["value"]
        executable_count = 0
        non_executable_count = 0
        state_tags: dict[int, int] = {}
        for item in rows:
            account = item["account"]
            if account["executable"]:
                executable_count += 1
                programdata = ""
                if label == "upgradeable":
                    raw = base64.b64decode(account["data"][0])
                    tag = int.from_bytes(raw[:4], "little")
                    state_tags[tag] = state_tags.get(tag, 0) + 1
                    programdata = b58(raw[4:36])
                executable[item["pubkey"]] = {
                    "program_id": item["pubkey"],
                    "loader_class": label,
                    "owner": owner,
                    "programdata_address": programdata,
                    "observed_slot": result["context"]["slot"],
                }
            else:
                non_executable_count += 1
        summaries[label] = {
            "owner": owner,
            "slot": result["context"]["slot"],
            "rpc_rows": len(rows),
            "executable_rows": executable_count,
            "non_executable_rows": non_executable_count,
            "upgradeable_state_tags": state_tags if label == "upgradeable" else None,
        }
    return summaries, executable


def fingerprint(program_ids: set[str]) -> str:
    return hashlib.sha256(("\n".join(sorted(program_ids)) + "\n").encode()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--primary-env-file", type=Path, required=True)
    parser.add_argument("--primary-url-var", default="RPC_URL")
    parser.add_argument("--compare-public-url", default="https://api.mainnet-beta.solana.com")
    parser.add_argument("--flux-env-file", type=Path)
    parser.add_argument("--flux-url-var", default="HEAVY_RPC_URL")
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()

    providers = {
        "helius": env_value(args.primary_env_file, args.primary_url_var),
        "solana_public": args.compare_public_url,
    }
    if args.flux_env_file:
        providers["flux"] = env_value(args.flux_env_file, args.flux_url_var)

    provider_summaries = {}
    provider_sets = {}
    primary_rows = None
    for label, url in providers.items():
        per_loader, rows = scan(url)
        ids = set(rows)
        provider_summaries[label] = {
            "per_loader": per_loader,
            "deduped_executable_count": len(ids),
            "program_id_set_sha256": fingerprint(ids),
        }
        provider_sets[label] = ids
        if label == "helius":
            primary_rows = rows

    assert primary_rows is not None
    primary_ids = provider_sets["helius"]
    comparisons = {}
    for label, ids in provider_sets.items():
        if label == "helius":
            continue
        comparisons[label] = {
            "intersection": len(primary_ids & ids),
            "helius_only": len(primary_ids - ids),
            f"{label}_only": len(ids - primary_ids),
            "exact_set_match": ids == primary_ids,
        }

    args.csv.parent.mkdir(parents=True, exist_ok=True)
    with args.csv.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "program_id", "loader_class", "owner", "programdata_address", "observed_slot"
            ],
        )
        writer.writeheader()
        writer.writerows(primary_rows[key] for key in sorted(primary_rows))

    summary = {
        "schema": "solana-mainnet-executable-program-universe/v1",
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "commitment": "finalized",
        "method": "getProgramAccounts by loader owner; UpgradeableLoader filtered to dataSize=36",
        "loader_ids": LOADERS,
        "providers": provider_summaries,
        "comparisons_to_helius": comparisons,
        "primary_csv": str(args.csv),
    }
    args.summary.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
