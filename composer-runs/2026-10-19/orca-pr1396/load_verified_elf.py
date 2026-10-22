#!/usr/bin/env python3
"""Load a local Whirlpool ELF into Surfpool and refresh its executable cache.

The installed Surfpool 1.6.0 stores bytes through surfnet_writeProgram but may
keep its initial no-op executable cached. Re-setting the unchanged Program
account after the final chunk makes LiteSVM compile the written program.
"""

import argparse
import base64
import hashlib
import json
import pathlib
import urllib.error
import urllib.request


PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(raw: bytes) -> str:
    number = int.from_bytes(raw, "big")
    result = ""
    while number:
        number, digit = divmod(number, 58)
        result = BASE58[digit] + result
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + result


def rpc(url: str, method: str, params: list):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method}: HTTP {exc.code}") from None
    if "error" in result:
        raise RuntimeError(f"{method}: {result['error']}")
    return result["result"]


def account(url: str, pubkey: str):
    result = rpc(url, "getAccountInfo", [pubkey, {"encoding": "base64"}])
    if result["value"] is None:
        raise RuntimeError(f"missing account {pubkey}")
    return result["value"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("surfpool_url", help="Local Surfpool JSON-RPC URL")
    parser.add_argument(
        "elf",
        nargs="?",
        default=str(pathlib.Path(__file__).with_name("whirlpool-onchain-20261015.so")),
        help="Whirlpool ELF file; defaults to the saved verified mainnet binary",
    )
    args = parser.parse_args()
    code = pathlib.Path(args.elf).read_bytes()
    if code[:4] != b"\x7fELF":
        raise RuntimeError("input is not an ELF")

    for offset in range(0, len(code), 256_000):
        chunk = code[offset : offset + 256_000]
        rpc(args.surfpool_url, "surfnet_writeProgram", [PROGRAM_ID, chunk.hex(), offset])

    program = account(args.surfpool_url, PROGRAM_ID)
    program_data = base64.b64decode(program["data"][0])
    if not program["executable"] or program_data[:4] != b"\x02\0\0\0":
        raise RuntimeError("Surfpool Program account is not upgradeable/executable")
    programdata_address = b58encode(program_data[4:36])
    programdata = account(args.surfpool_url, programdata_address)
    stored = base64.b64decode(programdata["data"][0])
    if stored[:4] != b"\x03\0\0\0" or stored[45:] != code:
        raise RuntimeError("Surfpool ProgramData does not equal the input ELF")

    # This is necessary with Surfpool 1.6.0: otherwise a 138-CU no-op stub
    # prints "Hello from my program!" while ProgramData still shows the ELF.
    rpc(
        args.surfpool_url,
        "surfnet_setAccount",
        [
            PROGRAM_ID,
            {
                "data": program_data.hex(),
                "owner": program["owner"],
                "lamports": program["lamports"],
                "executable": program["executable"],
                "rentEpoch": program["rentEpoch"],
            },
        ],
    )

    print(f"program={PROGRAM_ID}")
    print(f"programdata={programdata_address}")
    print(f"elf_bytes={len(code)}")
    print(f"elf_sha256={hashlib.sha256(code).hexdigest()}")
    print("executable_cache_refreshed=true")
    print("Run a transaction and inspect its logs to confirm real instruction execution.")


if __name__ == "__main__":
    main()
