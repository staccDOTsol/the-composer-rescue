#!/usr/bin/env python3
"""Replace local Surfpool Whirlpool ProgramData exactly, including ELF length.

`surfnet_writeProgram` grows ProgramData but may leave trailing old bytes when
swapping to a smaller ELF. This fork-only helper preserves the upgradeable
loader's ProgramData header, replaces all ELF bytes, and refreshes the Program
account to invalidate Surfpool's VM cache. It verifies exact byte equality.
"""

import base64
import hashlib
import json
import pathlib
import sys
import urllib.request

PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(raw):
    value = int.from_bytes(raw, "big")
    encoded = ""
    while value:
        value, digit = divmod(value, 58)
        encoded = BASE58[digit] + encoded
    return "1" * (len(raw) - len(raw.lstrip(b"\x00"))) + encoded


def rpc(url, method, params):
    request = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if "error" in body:
        message = json.dumps(body["error"])
        # Local Surfpool errors can echo a datasource URL. Never print its key.
        import re
        message = re.sub(r"api-key=[^\"\s)]+", "api-key=[REDACTED]", message)
        raise RuntimeError(message)
    return body["result"]


def account(url, address):
    value = rpc(url, "getAccountInfo", [address, {"encoding": "base64"}])["value"]
    if not value:
        raise RuntimeError(f"missing account {address}")
    return value, base64.b64decode(value["data"][0])


def image(value, data):
    return {
        "data": data.hex(),
        "owner": value["owner"],
        "lamports": value["lamports"],
        "executable": value["executable"],
        "rentEpoch": value["rentEpoch"],
    }


def main():
    url, elf_path = sys.argv[1:3]
    if not url.startswith("http://127.0.0.1:"):
        raise RuntimeError("only localhost Surfpool endpoints are accepted")
    elf = pathlib.Path(elf_path).read_bytes()
    if not elf.startswith(b"\x7fELF"):
        raise RuntimeError("input is not an ELF")
    program, program_bytes = account(url, PROGRAM_ID)
    if not program["executable"] or program_bytes[:4] != b"\x02\x00\x00\x00":
        raise RuntimeError("Whirlpool is not an upgradeable executable")
    programdata_address = b58encode(program_bytes[4:36])
    programdata, data_bytes = account(url, programdata_address)
    offset = data_bytes.find(b"\x7fELF")
    if offset < 45:
        raise RuntimeError(f"invalid ProgramData ELF offset: {offset}")
    rpc(url, "surfnet_setAccount", [programdata_address,
        image(programdata, data_bytes[:offset] + elf)])
    rpc(url, "surfnet_setAccount", [PROGRAM_ID, image(program, program_bytes)])
    new_programdata, new_data = account(url, programdata_address)
    new_elf = new_data[offset:]
    if new_elf != elf or len(new_data) != offset + len(elf):
        raise RuntimeError("exact ProgramData ELF replacement failed")
    if new_programdata["owner"] != programdata["owner"]:
        raise RuntimeError("ProgramData owner changed")
    print(f"ProgramData={programdata_address} offset={offset} ELF_BYTES={len(elf)} "
          f"ELF_SHA256={hashlib.sha256(new_elf).hexdigest()}", flush=True)


if __name__ == "__main__":
    main()
