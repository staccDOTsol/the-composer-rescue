#!/usr/bin/env python3
"""Read-only current-chain census for Sanctum Unstake pools and controlled stake."""

import base64
import hashlib
import json
import os
import struct
import time
from pathlib import Path

import requests
from solders.pubkey import Pubkey


PROGRAM = Pubkey.from_string("unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ")
STAKE_PROGRAM = "Stake11111111111111111111111111111111111111"
UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"
OUT_DIR = Path(__file__).resolve().parent
RPC = os.getenv("HEAVY_RPC_URL") or os.getenv("RPC_URL")


def rpc(method, params):
    if not RPC:
        raise RuntimeError("RPC_URL/HEAVY_RPC_URL is not set")
    for attempt in range(6):
        try:
            response = requests.post(
                RPC,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=120,
            )
            response.raise_for_status()
            body = response.json()
            if body.get("error"):
                raise RuntimeError(body["error"])
            return body["result"]
        except Exception:
            if attempt == 5:
                raise
            time.sleep(0.5 * (2**attempt))


def account_data(value):
    return base64.b64decode(value["data"][0])


def get_account(pubkey):
    return rpc(
        "getAccountInfo",
        [str(pubkey), {"encoding": "base64", "commitment": "confirmed"}],
    )


def get_multiple(pubkeys):
    values = []
    for start in range(0, len(pubkeys), 100):
        chunk = pubkeys[start : start + 100]
        result = rpc(
            "getMultipleAccounts",
            [[str(x) for x in chunk], {"encoding": "base64", "commitment": "confirmed"}],
        )
        values.extend(result["value"])
    return values


def account_discriminator(name):
    return hashlib.sha256(f"account:{name}".encode()).digest()[:8]


def derive(seeds):
    return Pubkey.find_program_address(seeds, PROGRAM)


def parse_program():
    info_result = get_account(PROGRAM)
    info = info_result["value"]
    data = account_data(info)
    if info["owner"] != UPGRADEABLE_LOADER or struct.unpack_from("<I", data, 0)[0] != 2:
        raise RuntimeError("program is not a live upgradeable-loader Program account")
    programdata = Pubkey.from_bytes(data[4:36])
    pd_result = get_account(programdata)
    pd = pd_result["value"]
    pd_data = account_data(pd)
    if pd["owner"] != UPGRADEABLE_LOADER or struct.unpack_from("<I", pd_data, 0)[0] != 3:
        raise RuntimeError("invalid ProgramData account")
    deployment_slot = struct.unpack_from("<Q", pd_data, 4)[0]
    has_authority = pd_data[12] == 1
    header_len = 45 if has_authority else 13
    authority = str(Pubkey.from_bytes(pd_data[13:45])) if has_authority else None
    payload = pd_data[header_len:]
    trimmed = payload.rstrip(b"\x00")
    binary_path = OUT_DIR / "sanctum-unstake-current.so"
    binary_path.write_bytes(payload)
    return {
        "program": str(PROGRAM),
        "programExecutable": info["executable"],
        "programOwner": info["owner"],
        "programdata": str(programdata),
        "programdataOwner": pd["owner"],
        "deploymentSlot": deployment_slot,
        "upgradeAuthority": authority,
        "payloadBytes": len(payload),
        "trimmedPayloadBytes": len(trimmed),
        "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "trimmedPayloadSha256": hashlib.sha256(trimmed).hexdigest(),
        "binaryPath": str(binary_path),
        "rpcSlot": info_result["context"]["slot"],
    }


def parse_pool(pubkey, value):
    data = account_data(value)
    # Anchor accepts trailing bytes. The canonical main pool is 88 bytes even
    # though the deployed struct deserializes the first 80 bytes.
    if len(data) < 80 or data[:8] != account_discriminator("Pool"):
        return None
    fee_authority = Pubkey.from_bytes(data[8:40])
    lp_mint = Pubkey.from_bytes(data[40:72])
    incoming_stake = struct.unpack_from("<Q", data, 72)[0]
    reserve, reserve_bump = derive([bytes(pubkey)])
    fee_account, fee_bump = derive([bytes(pubkey), b"fee"])
    flash_account, flash_bump = derive([bytes(pubkey), b"flashaccount"])
    flash_fee, flash_fee_bump = derive([bytes(pubkey), b"flashloanfee"])
    return {
        "pool": str(pubkey),
        "poolOwner": value["owner"],
        "feeAuthority": str(fee_authority),
        "lpMint": str(lp_mint),
        "incomingStakeRecordedLamports": incoming_stake,
        "poolDataLen": len(data),
        "trailingDataHex": data[80:].hex(),
        "reserve": str(reserve),
        "reserveBump": reserve_bump,
        "feeAccount": str(fee_account),
        "feeBump": fee_bump,
        "flashAccount": str(flash_account),
        "flashBump": flash_bump,
        "flashLoanFeeAccount": str(flash_fee),
        "flashLoanFeeBump": flash_fee_bump,
    }


def find_pools():
    result = rpc(
        "getProgramAccounts",
        [
            str(PROGRAM),
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [
                    {"dataSize": 80},
                    {"memcmp": {"offset": 0, "bytes": ""}},
                ],
            },
        ],
    )
    # Some providers reject an empty memcmp; retry with the discriminator encoded below.
    return result


def pools_by_discriminator():
    # Base58 encoding kept local to avoid an extra dependency.
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    raw = account_discriminator("Pool")
    n = int.from_bytes(raw, "big")
    out = ""
    while n:
        n, rem = divmod(n, 58)
        out = alphabet[rem] + out
    out = "1" * (len(raw) - len(raw.lstrip(b"\0"))) + (out or "1")
    result = rpc(
        "getProgramAccounts",
        [
            str(PROGRAM),
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [{"memcmp": {"offset": 0, "bytes": out}}],
            },
        ],
    )
    rows = []
    for entry in result["value"]:
        parsed = parse_pool(Pubkey.from_string(entry["pubkey"]), entry["account"])
        if parsed:
            rows.append(parsed)
    return result["context"]["slot"], rows


def get_stake_for_reserve(reserve):
    result = rpc(
        "getProgramAccounts",
        [
            STAKE_PROGRAM,
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "withContext": True,
                "filters": [
                    {"dataSize": 200},
                    {"memcmp": {"offset": 44, "bytes": reserve}},
                ],
            },
        ],
    )
    accounts = []
    for entry in result["value"]:
        data = account_data(entry["account"])
        state_tag = struct.unpack_from("<I", data, 0)[0]
        staker = str(Pubkey.from_bytes(data[12:44]))
        withdrawer = str(Pubkey.from_bytes(data[44:76]))
        accounts.append(
            {
                "stakeAccount": entry["pubkey"],
                "lamports": entry["account"]["lamports"],
                "stateTag": state_tag,
                "staker": staker,
                "withdrawer": withdrawer,
                "bothAuthoritiesMatchReserve": staker == reserve and withdrawer == reserve,
            }
        )
    return result["context"]["slot"], accounts


def enrich_pool(pool):
    reserve = Pubkey.from_string(pool["reserve"])
    lp_mint = Pubkey.from_string(pool["lpMint"])
    aux_keys = [reserve, lp_mint, Pubkey.from_string(pool["feeAccount"]), Pubkey.from_string(pool["flashAccount"]), Pubkey.from_string(pool["flashLoanFeeAccount"])]
    aux = get_multiple(aux_keys)
    reserve_info, mint_info, fee_info, flash_info, flash_fee_info = aux
    pool["reserveExists"] = reserve_info is not None
    pool["reserveOwner"] = reserve_info["owner"] if reserve_info else None
    pool["reserveLamports"] = reserve_info["lamports"] if reserve_info else 0
    if mint_info:
        mint_data = account_data(mint_info)
        pool["lpMintOwner"] = mint_info["owner"]
        pool["lpMintSupply"] = struct.unpack_from("<Q", mint_data, 36)[0]
        pool["lpMintDecimals"] = mint_data[44]
        mint_authority_flag = struct.unpack_from("<I", mint_data, 0)[0]
        pool["lpMintAuthority"] = str(Pubkey.from_bytes(mint_data[4:36])) if mint_authority_flag else None
        pool["lpMintAuthorityMatchesReserve"] = pool["lpMintAuthority"] == pool["reserve"]
    else:
        pool["lpMintSupply"] = None
        pool["lpMintAuthorityMatchesReserve"] = False
    pool["feeAccountExists"] = fee_info is not None
    pool["flashAccountExists"] = flash_info is not None
    pool["flashLoanFeeAccountExists"] = flash_fee_info is not None
    stake_slot, stakes = get_stake_for_reserve(pool["reserve"])
    pool["stakeScanSlot"] = stake_slot
    verified_stakes = [row for row in stakes if row["bothAuthoritiesMatchReserve"]]
    record_keys = [derive([bytes(Pubkey.from_string(pool["pool"])), bytes(Pubkey.from_string(row["stakeAccount"]))])[0] for row in verified_stakes]
    record_values = get_multiple(record_keys) if record_keys else []
    recorded_total = 0
    current_total = 0
    reward_delta = 0
    record_discm = account_discriminator("StakeAccountRecord")
    for row, record_key, record_info in zip(verified_stakes, record_keys, record_values):
        row["recordAccount"] = str(record_key)
        row["recordExists"] = record_info is not None
        recorded = None
        if record_info:
            record_data = account_data(record_info)
            row["recordOwner"] = record_info["owner"]
            row["recordDiscriminatorMatches"] = record_data[:8] == record_discm
            if len(record_data) >= 16 and row["recordDiscriminatorMatches"]:
                recorded = struct.unpack_from("<Q", record_data, 8)[0]
        row["recordedLamportsAtCreation"] = recorded
        row["currentMinusRecordedLamports"] = row["lamports"] - recorded if recorded is not None else None
        current_total += row["lamports"]
        if recorded is not None:
            recorded_total += recorded
            reward_delta += row["lamports"] - recorded
    pool["stakeAccounts"] = verified_stakes
    pool["allWithdrawAuthorityMatches"] = len(verified_stakes) == len(stakes)
    pool["verifiedControlledStakeCount"] = len(verified_stakes)
    pool["verifiedControlledStakeLamports"] = current_total
    pool["stakeRecordLamportsTotal"] = recorded_total
    pool["currentMinusRecordedStakeLamports"] = reward_delta
    pool["recordedTotalMatchesPoolIncomingStake"] = recorded_total == pool["incomingStakeRecordedLamports"]
    pool["grossCustodyLamports"] = pool["reserveLamports"] + current_total
    pool["accountingValueLamports"] = pool["reserveLamports"] + pool["incomingStakeRecordedLamports"]


def get_sol_price():
    response = requests.get("https://coins.llama.fi/prices/current/coingecko:solana", timeout=30)
    response.raise_for_status()
    coin = response.json()["coins"]["coingecko:solana"]
    return {
        "source": "DefiLlama coins.llama.fi coingecko:solana",
        "priceUsd": coin["price"],
        "timestamp": coin["timestamp"],
        "confidence": coin.get("confidence"),
    }


def main():
    program = parse_program()
    pool_slot, pools = pools_by_discriminator()
    for pool in pools:
        enrich_pool(pool)
    price = get_sol_price()
    for pool in pools:
        pool["grossCustodySol"] = pool["grossCustodyLamports"] / 1_000_000_000
        pool["grossCustodyUsd"] = pool["grossCustodySol"] * price["priceUsd"]
        pool["reserveSol"] = pool["reserveLamports"] / 1_000_000_000
        pool["controlledStakeSol"] = pool["verifiedControlledStakeLamports"] / 1_000_000_000
        pool["unrecognizedRewardDeltaSol"] = pool["currentMinusRecordedStakeLamports"] / 1_000_000_000
    pools.sort(key=lambda row: row["grossCustodyLamports"], reverse=True)
    result = {
        "observedAt": int(time.time()),
        "program": program,
        "poolScanSlot": pool_slot,
        "price": price,
        "pools": pools,
        "totals": {
            "pools": len(pools),
            "reserveLamports": sum(x["reserveLamports"] for x in pools),
            "controlledStakeLamports": sum(x["verifiedControlledStakeLamports"] for x in pools),
            "grossCustodyLamports": sum(x["grossCustodyLamports"] for x in pools),
            "grossCustodyUsd": sum(x["grossCustodyUsd"] for x in pools),
            "currentMinusRecordedStakeLamports": sum(x["currentMinusRecordedStakeLamports"] for x in pools),
        },
    }
    output = OUT_DIR / "sanctum-unstake-custody-live.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({
        "output": str(output),
        "program": program,
        "poolScanSlot": pool_slot,
        "price": price,
        "poolCount": len(pools),
        "topPools": [{
            "pool": x["pool"], "reserve": x["reserve"], "grossCustodySol": x["grossCustodySol"],
            "grossCustodyUsd": x["grossCustodyUsd"], "reserveSol": x["reserveSol"],
            "controlledStakeSol": x["controlledStakeSol"], "stakeCount": x["verifiedControlledStakeCount"],
            "rewardDeltaSol": x["unrecognizedRewardDeltaSol"], "lpSupply": x["lpMintSupply"],
        } for x in pools[:10]],
        "totals": result["totals"],
    }, indent=2))


if __name__ == "__main__":
    main()
