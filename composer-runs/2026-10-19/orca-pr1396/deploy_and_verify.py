import json
import pathlib
import sys
import urllib.request
import base64
import hashlib


PROGRAM_ID = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(raw):
    value = int.from_bytes(raw, "big")
    encoded = ""
    while value:
        value, digit = divmod(value, 58)
        encoded = BASE58[digit] + encoded
    leading_zeros = len(raw) - len(raw.lstrip(b"\x00"))
    return "1" * leading_zeros + encoded


def rpc(url, method, params):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(result["error"])
    return result["result"]


def main():
    url, path = sys.argv[1:3]
    code = pathlib.Path(path).read_bytes()
    if "--verify-only" not in sys.argv:
        print(f"Deploying {len(code)} bytes from {path} to {url}", flush=True)
        step = 256_000
        for offset in range(0, len(code), step):
            chunk = code[offset : offset + step]
            rpc(url, "surfnet_writeProgram", [PROGRAM_ID, chunk.hex(), offset])
            print(f"wrote {offset + len(chunk)}/{len(code)}", flush=True)
    result = rpc(url, "getAccountInfo", [PROGRAM_ID, {"encoding": "base64"}])
    account = result["value"]
    if not account or not account["executable"]:
        raise RuntimeError(f"program not executable: {account}")
    program_bytes = base64.b64decode(account["data"][0])
    if program_bytes[:4] != b"\x02\x00\x00\x00":
        raise RuntimeError(f"unexpected upgradeable program header: {program_bytes[:4].hex()}")
    programdata_address = b58encode(program_bytes[4:36])
    if "--verify-only" not in sys.argv:
        # surfnet_writeProgram can leave Surfpool's no-op executable cached.
        # Rewriting the identical executable account invalidates that cache.
        rpc(url, "surfnet_setAccount", [PROGRAM_ID, {
            "data": program_bytes.hex(),
            "owner": account["owner"],
            "lamports": account["lamports"],
            "executable": True,
            "rentEpoch": account["rentEpoch"],
        }])
    programdata = rpc(url, "getAccountInfo", [programdata_address, {"encoding": "base64"}])["value"]
    if not programdata:
        raise RuntimeError("ProgramData account missing")
    programdata_bytes = base64.b64decode(programdata["data"][0])
    elf_offset = programdata_bytes.find(b"\x7fELF")
    deployed_code = programdata_bytes[elf_offset:] if elf_offset >= 0 else b""
    if deployed_code != code:
        raise RuntimeError(f"deployed ELF mismatch: offset={elf_offset} len={len(deployed_code)}")
    print(f"Program executable; owner={account['owner']}; ProgramData={programdata_address}; ELF_SHA256={hashlib.sha256(deployed_code).hexdigest()}")


if __name__ == "__main__":
    main()
