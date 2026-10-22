#!/usr/bin/env python3
"""Read-only Solana RPC audit of the Locp Jupiter Lock escrows in the census.

Reproduce with: python3 composer-runs/2026-10-15/locp-source-decode.py
Requires requests and solders. Never signs or submits a transaction.
"""

import base64
import hashlib
import json
import struct
import time
from collections import defaultdict
from pathlib import Path

import requests
from solders.pubkey import Pubkey


RUN = Path(__file__).resolve().parent
RPC = "https://api.mainnet-beta.solana.com"
PROGRAM = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn"
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
VESTING_DISC = bytes([244, 119, 183, 4, 73, 116, 135, 195])
OUT = RUN / "locp-source-current-state.json"
session = requests.Session()
_rpc_id = 0


def rpc(method, params):
    global _rpc_id
    _rpc_id += 1
    request = {"jsonrpc": "2.0", "id": _rpc_id, "method": method, "params": params}
    for attempt in range(8):
        try:
            response = session.post(RPC, json=request, timeout=45)
            if response.status_code == 429:
                raise RuntimeError("HTTP 429")
            response.raise_for_status()
            result = response.json()
            if "error" in result:
                raise RuntimeError(str(result["error"]))
            return result["result"]
        except (requests.RequestException, RuntimeError) as exc:
            if attempt == 7:
                raise RuntimeError(f"RPC {method} failed: {exc}") from exc
            time.sleep(min(1.5 * 2**attempt, 20))


def multiple_accounts(keys):
    accounts = {}
    slots = []
    for start in range(0, len(keys), 80):
        batch = keys[start : start + 80]
        response = rpc("getMultipleAccounts", [batch, {"encoding": "base64", "commitment": "confirmed"}])
        slots.append(response["context"]["slot"])
        accounts.update(zip(batch, response["value"]))
        time.sleep(0.15)
    return accounts, slots


def key(data, offset):
    return str(Pubkey.from_bytes(data[offset : offset + 32]))


def u64(data, offset):
    return struct.unpack_from("<Q", data, offset)[0]


def decode_escrow(address, account):
    if not account:
        return {"address": address, "error": "account absent"}
    data = base64.b64decode(account["data"][0])
    if account["owner"] != PROGRAM or len(data) != 296 or data[:8] != VESTING_DISC:
        return {
            "address": address,
            "error": "owner/length/discriminator mismatch",
            "owner": account["owner"],
            "length": len(data),
            "discriminator": data[:8].hex(),
        }
    state = {
        "address": address,
        "recipient": key(data, 8),
        "mint": key(data, 40),
        "creator": key(data, 72),
        "base": key(data, 104),
        "escrowBump": data[136],
        "updateRecipientMode": data[137],
        "cancelMode": data[138],
        "tokenProgramFlag": data[139],
        "cliffTime": u64(data, 144),
        "frequency": u64(data, 152),
        "cliffUnlockAmount": u64(data, 160),
        "amountPerPeriod": u64(data, 168),
        "numberOfPeriod": u64(data, 176),
        "totalClaimedAmount": u64(data, 184),
        "vestingStartTime": u64(data, 192),
        "cancelledAt": u64(data, 200),
        "lamports": account["lamports"],
    }
    derived, bump = Pubkey.find_program_address(
        [b"escrow", bytes(Pubkey.from_string(state["base"]))], Pubkey.from_string(PROGRAM)
    )
    state["pdaMatches"] = address == str(derived) and state["escrowBump"] == bump
    return state


def decode_vault(address, account):
    if not account:
        return {"address": address, "error": "account absent"}
    data = base64.b64decode(account["data"][0])
    if len(data) < 72:
        return {"address": address, "error": "token account too short", "length": len(data)}
    return {
        "address": address,
        "program": account["owner"],
        "mint": key(data, 0),
        "authority": key(data, 32),
        "amount": u64(data, 64),
    }


def available(state, timestamp):
    if timestamp < state["cliffTime"]:
        unlocked = 0
    elif state["frequency"] == 0:
        unlocked = state["cliffUnlockAmount"]
    else:
        periods = min((timestamp - state["cliffTime"]) // state["frequency"], state["numberOfPeriod"])
        unlocked = state["cliffUnlockAmount"] + periods * state["amountPerPeriod"]
    if unlocked > 2**64 - 1 or unlocked < state["totalClaimedAmount"]:
        return {"error": "schedule arithmetic overflow/underflow"}
    return {
        "scheduleUnlockedAmount": unlocked,
        "scheduleClaimableAmount": unlocked - state["totalClaimedAmount"],
    }


def main():
    source = json.loads((RUN / "mainnet-token-authority-census.raw.json").read_text())
    group = next(p for p in source["programsByDirectStateAuthority"] if p["programId"] == PROGRAM)
    authority_index = {a["authority"]: a for a in source["authorities"]}
    mint_decimals = {t["mint"]: t["decimals"] for t in source["tokenAccounts"]}
    addresses = group["authorities"]
    assert len(addresses) == 308
    vault_addresses = [authority_index[a]["tokenAccounts"][0]["address"] for a in addresses]
    state_accounts, state_slots = multiple_accounts(addresses)
    vault_accounts, vault_slots = multiple_accounts(vault_addresses)
    time_slot = rpc("getSlot", [{"commitment": "confirmed"}])
    timestamp = rpc("getBlockTime", [time_slot])
    if timestamp is None:
        raise RuntimeError("getBlockTime returned null; cannot compute a timestamped schedule")

    rows = []
    for authority, vault_address in zip(addresses, vault_addresses):
        old = authority_index[authority]["tokenAccounts"][0]
        state = decode_escrow(authority, state_accounts[authority])
        vault = decode_vault(vault_address, vault_accounts[vault_address])
        if "error" not in state:
            ata, _ = Pubkey.find_program_address(
                [
                    bytes(Pubkey.from_string(authority)),
                    bytes(Pubkey.from_string(vault["program"])),
                    bytes(Pubkey.from_string(state["mint"])),
                ],
                ATA_PROGRAM,
            )
            state["schedule"] = available(state, timestamp)
            vault["matchesState"] = (
                vault["authority"] == authority
                and vault["mint"] == state["mint"]
                and vault_address == str(ata)
            )
        rows.append(
            {
                "state": state,
                "vault": vault,
                "censusSymbol": old["symbol"],
                "censusDecimals": mint_decimals.get(old["mint"]),
                "censusUsdPrice": old.get("usdPrice"),
                "censusUsdValue": old.get("usdValue"),
                "censusRawAmount": old.get("rawAmount"),
            }
        )

    summary = defaultdict(lambda: {"escrows": 0, "rawVaultAmount": 0, "rawScheduledClaimable": 0, "censusGrossUsd": 0.0, "freshMarkedGrossUsd": 0.0, "freshMarkedClaimableUsd": 0.0})
    for row in rows:
        state, vault = row["state"], row["vault"]
        if "error" in state or "error" in vault:
            continue
        item = summary[state["mint"]]
        item["symbol"] = row["censusSymbol"]
        item["decimals"] = row["censusDecimals"]
        item["escrows"] += 1
        item["rawVaultAmount"] += vault["amount"]
        claimable = min(vault["amount"], state["schedule"].get("scheduleClaimableAmount", 0))
        item["rawScheduledClaimable"] += claimable
        item["censusGrossUsd"] += row["censusUsdValue"] or 0
        if row["censusDecimals"] is not None and row["censusUsdPrice"] is not None:
            factor = row["censusUsdPrice"] / 10 ** row["censusDecimals"]
            item["freshMarkedGrossUsd"] += vault["amount"] * factor
            item["freshMarkedClaimableUsd"] += claimable * factor
    for value in summary.values():
        value["rawVaultAmount"] = str(value["rawVaultAmount"])
        value["rawScheduledClaimable"] = str(value["rawScheduledClaimable"])

    output = {
        "program": PROGRAM,
        "method": "read-only getMultipleAccounts, getSlot, getBlockTime; no transaction submission",
        "sourceCensusCompletedAt": source["completedAt"],
        "stateObservationSlots": state_slots,
        "vaultObservationSlots": vault_slots,
        "timeObservationSlot": time_slot,
        "blockTime": timestamp,
        "deployedBinarySha256": hashlib.sha256((RUN / "locp-current.so").read_bytes()).hexdigest(),
        "rows": rows,
        "byMint": summary,
        "checks": {
            "statesFound": sum("error" not in row["state"] for row in rows),
            "pdaMatches": sum(row["state"].get("pdaMatches") is True for row in rows),
            "vaultMatches": sum(row["vault"].get("matchesState") is True for row in rows),
            "cancelModeCounts": {str(mode): sum(row["state"].get("cancelMode") == mode for row in rows) for mode in range(4)},
            "updateRecipientModeCounts": {str(mode): sum(row["state"].get("updateRecipientMode") == mode for row in rows) for mode in range(4)},
            "cancelledStates": sum(bool(row["state"].get("cancelledAt")) for row in rows),
            "vaultAmountMatchesCensus": sum(str(row["vault"].get("amount")) == row["censusRawAmount"] for row in rows),
        },
    }
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    top_mints = sorted(summary.items(), key=lambda pair: pair[1]["censusGrossUsd"], reverse=True)[:12]
    print(json.dumps({"file": str(OUT), "slots": [min(state_slots + vault_slots), max(state_slots + vault_slots)], "time": timestamp, "checks": output["checks"], "topMints": top_mints}, indent=2))


if __name__ == "__main__":
    main()
