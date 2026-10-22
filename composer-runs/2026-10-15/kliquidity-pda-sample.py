#!/usr/bin/env python3
"""Read-only PDA/position control sample for Kamino Liquidity. Requires RPC_URL."""

import base64
import json
import os
import struct
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from solders.pubkey import Pubkey


PROGRAM = Pubkey.from_string("6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc")
STRATEGY = Pubkey.from_string("Hmj82e48X9LNW8LeMLk186iE4UKPoUwWuLwoiqMpUiGm")
DISC = bytes([190, 178, 231, 184, 49, 186, 103, 13])
OUT = Path(__file__).with_name("kliquidity-pda-sample.json")


def rpc(method, params):
    url = os.environ["RPC_URL"]
    for attempt in range(5):
        response = requests.post(
            url,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            timeout=30,
        )
        try:
            result = response.json()
        except ValueError:
            result = {}
        if "result" in result:
            return result["result"]
        if response.status_code != 429:
            raise RuntimeError(f"{method} failed: {result.get('error', response.status_code)}")
        time.sleep(attempt + 1)
    raise RuntimeError(f"{method} remained rate limited")


def key(raw):
    return str(Pubkey.from_bytes(raw))


def token_account(account):
    if account is None:
        return None
    raw = base64.b64decode(account["data"][0])
    return {
        "tokenProgram": account["owner"],
        "mint": key(raw[:32]),
        "authority": key(raw[32:64]),
        "rawAmount": struct.unpack_from("<Q", raw, 64)[0],
    }


def main():
    state = rpc(
        "getAccountInfo",
        [str(STRATEGY), {"encoding": "base64", "commitment": "confirmed"}],
    )
    account = state["value"]
    raw = base64.b64decode(account["data"][0])
    if account["owner"] != str(PROGRAM) or raw[:8] != DISC:
        raise RuntimeError("strategy account did not match program and discriminator")
    authority = key(raw[72:104])
    token_a = key(raw[400:432])
    token_b = key(raw[432:464])
    mint_a = key(raw[544:576])
    mint_b = key(raw[576:608])
    position = key(raw[272:304])
    position_mint = key(raw[304:336])
    position_token = key(raw[368:400])

    expected_a, _ = Pubkey.find_program_address([b"svault_a", bytes(STRATEGY)], PROGRAM)
    expected_b, _ = Pubkey.find_program_address([b"svault_b", bytes(STRATEGY)], PROGRAM)
    expected_authority, _ = Pubkey.find_program_address(
        [b"authority", bytes(expected_a), bytes(expected_b)], PROGRAM
    )
    accounts = rpc(
        "getMultipleAccounts",
        [
            [token_a, token_b, position_token, position],
            {"encoding": "base64", "commitment": "confirmed"},
        ],
    )
    vault_a, vault_b, nft, position_account = accounts["value"]
    parsed_a = token_account(vault_a)
    parsed_b = token_account(vault_b)
    parsed_nft = token_account(nft)
    result = {
        "observedAtUtc": datetime.now(timezone.utc).isoformat(),
        "strategySlot": state["context"]["slot"],
        "tokenAccountSlot": accounts["context"]["slot"],
        "program": str(PROGRAM),
        "strategy": str(STRATEGY),
        "authority": authority,
        "authorityMatchesPda": authority == str(expected_authority),
        "tokenAVault": token_a,
        "tokenBVault": token_b,
        "vaultPdasMatch": token_a == str(expected_a) and token_b == str(expected_b),
        "mintA": mint_a,
        "mintB": mint_b,
        "decimalsA": struct.unpack_from("<Q", raw, 608)[0],
        "decimalsB": struct.unpack_from("<Q", raw, 616)[0],
        "vaultA": parsed_a,
        "vaultB": parsed_b,
        "vaultTokenBindingsMatch": parsed_a["mint"] == mint_a
        and parsed_b["mint"] == mint_b
        and parsed_a["authority"] == authority
        and parsed_b["authority"] == authority,
        "position": position,
        "positionOwnerProgram": position_account["owner"] if position_account else None,
        "positionMint": position_mint,
        "positionTokenAccount": position_token,
        "positionNft": parsed_nft,
        "positionNftControlledByPda": parsed_nft["mint"] == position_mint
        and parsed_nft["authority"] == authority
        and parsed_nft["rawAmount"] == 1,
        "scope": "One current strategy control sample. Idle balances exclude liquidity invested in its DEX position; API TVL is not treated as verified PDA custody.",
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
