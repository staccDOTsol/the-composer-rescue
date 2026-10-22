#!/usr/bin/env python3
"""Read-only proof of the deployed Locp program and upgradeable ProgramData.

Reproduce with: python3 composer-runs/2026-10-15/locp-source-programdata.py
"""

import base64
import hashlib
import json
from pathlib import Path

import requests
from solders.pubkey import Pubkey

RUN = Path(__file__).resolve().parent
PROGRAM = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn"
PROGRAMDATA = "7yXf8ZG1qdc6GdRUc6LxmwUJuUDUAqta84oPU7fsJ6Yy"
LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"
RPC = "https://api.mainnet-beta.solana.com"


def rpc(method, params):
    response = requests.post(
        RPC,
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        timeout=45,
    )
    response.raise_for_status()
    body = response.json()
    if "error" in body:
        raise RuntimeError(body["error"])
    return body["result"]


def main():
    result = rpc(
        "getMultipleAccounts",
        [[PROGRAM, PROGRAMDATA], {"encoding": "base64", "commitment": "confirmed", "dataSlice": {"offset": 0, "length": 45}}],
    )
    program, programdata = result["value"]
    program_bytes = base64.b64decode(program["data"][0])
    programdata_bytes = base64.b64decode(programdata["data"][0])
    assert int.from_bytes(program_bytes[:4], "little") == 2
    assert int.from_bytes(programdata_bytes[:4], "little") == 3
    extracted_programdata = str(Pubkey.from_bytes(program_bytes[4:36]))
    deploy_slot = int.from_bytes(programdata_bytes[4:12], "little")
    authority_option = programdata_bytes[12]
    authority = str(Pubkey.from_bytes(programdata_bytes[13:45])) if authority_option == 1 else None
    assert extracted_programdata == PROGRAMDATA
    assert program["owner"] == LOADER and programdata["owner"] == LOADER
    assert program["executable"] is True and programdata["executable"] is False
    dumped_binary = RUN / "locp-current.so"
    evidence = {
        "rpc": RPC,
        "method": "getMultipleAccounts with dataSlice (read-only)",
        "observedSlot": result["context"]["slot"],
        "program": {
            "address": PROGRAM,
            "owner": program["owner"],
            "executable": program["executable"],
            "lamports": program["lamports"],
            "programdataAddressFromAccount": extracted_programdata,
        },
        "programdata": {
            "address": PROGRAMDATA,
            "owner": programdata["owner"],
            "executable": programdata["executable"],
            "lamports": programdata["lamports"],
            "lastDeploySlot": deploy_slot,
            "upgradeAuthority": authority,
        },
        "dumpedBinary": {
            "path": str(dumped_binary),
            "length": dumped_binary.stat().st_size,
            "sha256": hashlib.sha256(dumped_binary.read_bytes()).hexdigest(),
            "dumpMethod": "solana program dump LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn",
        },
        "referenceFixtureBinary": {
            "path": str(RUN / "meteora-dbc-source/tests/fixtures/locker.so"),
            "sha256": hashlib.sha256((RUN / "meteora-dbc-source/tests/fixtures/locker.so").read_bytes()).hexdigest(),
            "matchesDump": dumped_binary.read_bytes() == (RUN / "meteora-dbc-source/tests/fixtures/locker.so").read_bytes(),
        },
        "submittedTransactions": 0,
    }
    path = RUN / "locp-source-programdata.json"
    path.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
