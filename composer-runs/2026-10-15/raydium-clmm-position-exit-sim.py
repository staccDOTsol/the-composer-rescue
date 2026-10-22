#!/usr/bin/env python3
"""Read-only current-state DecreaseLiquidityV2 fee/reward collection controls."""

import base64
import hashlib
import json
import struct
import time
import urllib.error
import urllib.request
from pathlib import Path

from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction


RPC = "https://api.mainnet-beta.solana.com"
PROGRAM = Pubkey.from_string("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
MEMO = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
PAYER = Pubkey.from_string("3fjFhpGqW4wSzhLzCZCV2CYLiLw5B98FxnQEDfujjijQ")
OUTPUT = Path("/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/raydium-clmm-position-liquidity-rounding.json")

OWNER = Pubkey.from_string("4SzSQ4y9GoPjaPQhmCoEfoVU55u8boXJDWxUfPcZWkLa")
NFT_ACCOUNT = Pubkey.from_string("D1VoQs4Korax4vYWNnHj2q2GjbahSE9FgtLejYzawFLP")
POSITION = Pubkey.from_string("FDZHJV8ktDRkxr8auQ47gajjeXinSjQJjhW7cm3Vkixj")
POOL = Pubkey.from_string("3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF")
PROTOCOL_POSITION = Pubkey.from_string("5r4CdM7Cg6jfrbnLzzmTeCrpdi1zZyhQpA9w9dPd2ipj")
VAULT_0 = Pubkey.from_string("AbcuyoPeYnddzFoFQudsiFka8qd6tTwvLgxwtpTKTpKC")
VAULT_1 = Pubkey.from_string("2n6fxuD6PA5NYgEnXXYMh2iWD1JBJ1LGf76kFJAayZmX")
TICK_LOWER = Pubkey.from_string("CKCjMgvi1Bs47Eibf94gVm7TepKo8F2SQhWd99gNKiWH")
TICK_UPPER = Pubkey.from_string("8t5n8TmSjhTnLir1FMh8R3f1sQTD2XfZ3EP9rm1sN7K7")
RECIPIENT_0 = Pubkey.from_string("481cLrKhWdQP8Qvs6ZbHUdxdjqiraS3m3fTQQ4SXCf9C")
RECIPIENT_1 = Pubkey.from_string("2iVZ3HCepn76X18v4Cr5QbU6MebNTxVwYNHWTWWNSjQc")
MINT_0 = Pubkey.from_string("So11111111111111111111111111111111111111112")
MINT_1 = Pubkey.from_string("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")
REWARD_VAULT = Pubkey.from_string("ETnN2GUhQB4Y2pKXB8kP4cfuQQyRJqvrfvvGkmRsmhqB")
REWARD_DEST = Pubkey.from_string("4u5GmwvqKjeSRnaWnSnqU3DsdDV1mwD8YBn486LLF9rL")
REWARD_MINT = Pubkey.from_string("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R")
FOREIGN_POOL = Pubkey.from_string("HpgV2jnzgrGfrZjeZGkHgTnEgRFAhtzCVuk3BRFTFJwk")
FOREIGN_REWARD_VAULT = Pubkey.from_string("HsBUudV9Y2Z2dJTieWFgK3zhrpX4ELvnfHcAwSBVqDGX")


def rpc(method, params, retries=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                RPC, data=body, headers={"content-type": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
            if result.get("error"):
                raise RuntimeError(result["error"])
            return result["result"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == retries:
                raise
            retry_after = getattr(error, "headers", {}).get("Retry-After") if hasattr(error, "headers") else None
            time.sleep(float(retry_after) if retry_after else min(30, 2 ** attempt))


def instruction(owner=OWNER, owner_signer=True, liquidity=0, mutate=None):
    keys = [
        owner, NFT_ACCOUNT, POSITION, POOL, PROTOCOL_POSITION, VAULT_0, VAULT_1,
        TICK_LOWER, TICK_UPPER, RECIPIENT_0, RECIPIENT_1, TOKEN, TOKEN_2022,
        MEMO, MINT_0, MINT_1, REWARD_VAULT, REWARD_DEST, REWARD_MINT,
    ]
    writable = [
        False, False, True, True, False, True, True, True, True, True, True,
        False, False, False, False, False, True, True, False,
    ]
    signers = [owner_signer] + [False] * 18
    if mutate:
        mutate(keys, signers)
    disc = hashlib.sha256(b"global:decrease_liquidity_v2").digest()[:8]
    data = disc + liquidity.to_bytes(16, "little") + struct.pack("<QQ", 0, 0)
    return Instruction(
        PROGRAM,
        data,
        [AccountMeta(key, signers[i], writable[i]) for i, key in enumerate(keys)],
    )


SNAPSHOT = [POSITION, POOL, VAULT_0, VAULT_1, RECIPIENT_0, RECIPIENT_1, REWARD_VAULT, REWARD_DEST]


def decode(address, account):
    if account is None:
        return None
    data = base64.b64decode(account["data"][0])
    result = {"address": str(address), "owner": account["owner"], "dataLen": len(data)}
    if len(data) == 281:
        result.update(
            liquidity=int.from_bytes(data[81:97], "little"),
            feeOwed0=struct.unpack_from("<Q", data, 129)[0],
            feeOwed1=struct.unpack_from("<Q", data, 137)[0],
            rewardOwed=[struct.unpack_from("<Q", data, 161 + i * 24)[0] for i in range(3)],
        )
    elif len(data) in (165, 170, 182):
        result["tokenAmount"] = struct.unpack_from("<Q", data, 64)[0]
    return result


def live_snapshot():
    result = rpc("getMultipleAccounts", [[str(k) for k in SNAPSHOT], {"encoding": "base64", "commitment": "confirmed"}])
    return {"slot": result["context"]["slot"], "accounts": [decode(k, a) for k, a in zip(SNAPSHOT, result["value"])]}


def simulate(name, instructions):
    message = Message.new_with_blockhash(instructions, PAYER, Hash.default())
    wire = base64.b64encode(bytes(Transaction.new_unsigned(message))).decode()
    result = rpc(
        "simulateTransaction",
        [wire, {
            "encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True,
            "commitment": "confirmed", "innerInstructions": True,
            "accounts": {"encoding": "base64", "addresses": [str(k) for k in SNAPSHOT]},
        }],
    )
    context_slot = result.get("context", {}).get("slot")
    result = result["value"]
    logs = [line for line in result.get("logs") or [] if
            "Instruction:" in line or "AnchorError" in line or "Error Code:" in line
            or "failed:" in line or "success" in line or "collect reward" in line]
    return {
        "case": name,
        "err": result.get("err"),
        "contextSlot": context_slot,
        "unitsConsumed": result.get("unitsConsumed"),
        "logs": logs,
        "innerInstructions": result.get("innerInstructions"),
        "postAccounts": [decode(k, a) for k, a in zip(SNAPSHOT, result.get("accounts") or [])],
    }


def main():
    before = live_snapshot()
    position_before = next(row for row in before["accounts"] if row and row["address"] == str(POSITION))
    full_liquidity = position_before["liquidity"]
    valid = instruction()
    cases = [
        ("position_fee_reward_control", [valid]),
        ("position_fee_reward_twice_atomic", [valid, valid]),
        ("position_decrease_one_liquidity_raw", [instruction(liquidity=1)]),
        ("position_decrease_two_liquidity_raw", [instruction(liquidity=2)]),
        ("position_decrease_full_liquidity", [instruction(liquidity=full_liquidity)]),
        ("position_decrease_full_plus_one", [instruction(liquidity=full_liquidity + 1)]),
        ("position_attacker_owner_and_destinations", [instruction(PAYER)]),
        ("position_missing_owner_signature", [instruction(OWNER, False)]),
        ("position_foreign_pool", [instruction(mutate=lambda k, _: k.__setitem__(3, FOREIGN_POOL))]),
        ("position_vaults_swapped", [instruction(mutate=lambda k, _: (k.__setitem__(5, VAULT_1), k.__setitem__(6, VAULT_0)))]),
        ("position_mints_swapped", [instruction(mutate=lambda k, _: (k.__setitem__(14, MINT_1), k.__setitem__(15, MINT_0)))]),
        ("position_recipient0_is_vault0", [instruction(mutate=lambda k, _: k.__setitem__(9, VAULT_0))]),
        ("position_recipient_mints_swapped", [instruction(mutate=lambda k, _: (k.__setitem__(9, RECIPIENT_1), k.__setitem__(10, RECIPIENT_0)))]),
        ("position_token_programs_swapped", [instruction(mutate=lambda k, _: (k.__setitem__(11, TOKEN_2022), k.__setitem__(12, TOKEN)))]),
        ("position_reward_vault_foreign", [instruction(mutate=lambda k, _: k.__setitem__(16, FOREIGN_REWARD_VAULT))]),
        ("position_reward_recipient_is_vault", [instruction(mutate=lambda k, _: k.__setitem__(17, REWARD_VAULT))]),
        ("position_valid_then_unauthorized_atomic_rollback", [valid, instruction(PAYER)]),
        ("position_unauthorized_then_valid_order", [instruction(PAYER), valid]),
    ]
    results = []
    for name, instructions in cases:
        results.append(simulate(name, instructions))
        time.sleep(0.35)
    output = {
        "transport": "read-only mainnet simulateTransaction; sigVerify=false; no sendTransaction",
        "position": str(POSITION),
        "positionLiquidityRaw": full_liquidity,
        "before": before,
        "results": results,
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"output": str(OUTPUT), "positionLiquidityRaw": full_liquidity,
                      "cases": [{"case": r["case"], "err": r["err"],
                                 "unitsConsumed": r["unitsConsumed"]} for r in results]}, indent=2))


if __name__ == "__main__":
    main()
