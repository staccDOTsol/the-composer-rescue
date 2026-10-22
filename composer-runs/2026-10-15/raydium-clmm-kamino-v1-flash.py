#!/usr/bin/env python3
"""Read-only MessageV1 Kamino flash-loan compositions through Raydium CLMM."""

import base64
import hashlib
import json
import os
import struct
import time
import urllib.error
import urllib.request
from pathlib import Path

from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.message import MessageV1, TransactionConfig
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import VersionedTransaction


ROOT = Path("/Users/stacc/the-composer-rescue/composer-runs/2026-10-15")
SOURCE = ROOT / "kamino-flash-history.json"
OUTPUT = ROOT / "raydium-clmm-kamino-v1-flash.json"
ENV_FILE = Path("/tmp/composer-helius-only.env")
V1_TRANSACTION_SIZE_LIMIT = 4096

PROGRAM = Pubkey.from_string("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
KAMINO = Pubkey.from_string("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD")
TOKEN = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
TOKEN_2022 = Pubkey.from_string("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
MEMO = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
SYSTEM = Pubkey.from_string("11111111111111111111111111111111")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")

POOL = Pubkey.from_string("BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU")
CONFIG = Pubkey.from_string("9iFER3bpjf1PTTCQCfTRu17EJgvsxo9pVyA9QWwEuX4x")
USDC = Pubkey.from_string("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
USDT = Pubkey.from_string("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")
VAULT_USDC = Pubkey.from_string("4iJQGzZpys4N13rGXbsB3NqehPkrgrcmDUEcLw7D6GKL")
VAULT_USDT = Pubkey.from_string("7NQjToK5NenQZvhPRc1nC1URuKJ4nuLxGPdTbpTiz9EN")
OBSERVATION = Pubkey.from_string("3YZE41e4GKm9Uqvx6H4QA1FdyxT15nEjUP8LbvdiDF2t")
TICK_ARRAY_0 = Pubkey.find_program_address(
    [b"tick_array", bytes(POOL), (0).to_bytes(4, "big", signed=True)], PROGRAM
)[0]

# A live low-liquidity, classic-token pool selected from the current deployed
# program state.  Both vaults had about 115-119 whole tokens at selection time;
# the only initialized tick array around tick -2121 starts at -3600.
THIN_POOL = Pubkey.from_string("121XWup4g8R2iFhN6jRMtx9W423JbfJk4AqA753sUExw")
THIN_CONFIG = Pubkey.from_string("E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp")
THIN_TOKEN = Pubkey.from_string("HzCmPHhxnhXGh3n7EG21mwnjaxjHVtYBecF8c9D79m8U")
THIN_VAULT_USDC = Pubkey.from_string("FKtcwnKmxXtTjk7szvuR5bKMhSmrUTG7JUHbBSMCxawo")
THIN_VAULT_TOKEN = Pubkey.from_string("H4de98zzojAzbkafqZrzocnJt4HmgoUVRgjm9aRkSYNM")
THIN_OBSERVATION = Pubkey.from_string("8VqRnFwPcbV9W4T8XFZw2cXEMdioYXG8XVwJvjjWBwBC")
THIN_TICK_START = -3600
THIN_TICK_ARRAY = Pubkey.find_program_address(
    [b"tick_array", bytes(THIN_POOL), THIN_TICK_START.to_bytes(4, "big", signed=True)], PROGRAM
)[0]

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(value):
    number = 0
    for char in value:
        number = number * 58 + ALPHABET.index(char)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * (len(value) - len(value.lstrip("1"))) + raw


def load_rpc_url():
    values = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    return os.environ.get("HEAVY_RPC_URL") or os.environ.get("RPC_URL") or values.get("HEAVY_RPC_URL") or values.get("RPC_URL") or "https://api.mainnet-beta.solana.com"


RPC = load_rpc_url()


def rpc(method, params, retries=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(retries):
        try:
            request = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
            if result.get("error"):
                return {"rpcError": result["error"]}
            return result["result"]
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == retries:
                raise
            retry_after = getattr(error, "headers", {}).get("Retry-After") if hasattr(error, "headers") else None
            time.sleep(float(retry_after) if retry_after else min(30, 2 ** attempt))


source_hit = json.loads(SOURCE.read_text())["hits"][0]
source_tx = source_hit["transaction"]
source_message = source_tx["transaction"]["message"]
static_keys = source_message["accountKeys"]
loaded_writable = source_tx["meta"]["loadedAddresses"]["writable"]
loaded_readonly = source_tx["meta"]["loadedAddresses"]["readonly"]
all_keys = static_keys + loaded_writable + loaded_readonly
header = source_message["header"]


def source_is_signer(index):
    return index < header["numRequiredSignatures"]


def source_is_writable(index):
    if index < len(static_keys):
        if source_is_signer(index):
            return index < header["numRequiredSignatures"] - header["numReadonlySignedAccounts"]
        return index < len(static_keys) - header["numReadonlyUnsignedAccounts"]
    return index < len(static_keys) + len(loaded_writable)


def source_instruction(index):
    item = source_message["instructions"][index]
    return Instruction(
        Pubkey.from_string(all_keys[item["programIdIndex"]]),
        b58decode(item["data"]),
        [
            AccountMeta(Pubkey.from_string(all_keys[key_index]), source_is_signer(key_index), source_is_writable(key_index))
            for key_index in item["accounts"]
        ],
    )


SOURCE_BORROW = source_instruction(3)
SOURCE_REPAY = source_instruction(13)
PAYER = SOURCE_BORROW.accounts[0].pubkey
KAMINO_RESERVE = SOURCE_BORROW.accounts[3].pubkey
KAMINO_SUPPLY = SOURCE_BORROW.accounts[5].pubkey
USER_USDC = SOURCE_BORROW.accounts[6].pubkey
KAMINO_FEE_VAULT = SOURCE_BORROW.accounts[7].pubkey
USER_USDT = Pubkey.find_program_address([bytes(PAYER), bytes(TOKEN), bytes(USDT)], ATA_PROGRAM)[0]
USER_THIN_TOKEN = Pubkey.find_program_address([bytes(PAYER), bytes(TOKEN), bytes(THIN_TOKEN)], ATA_PROGRAM)[0]


def borrow_ix(amount):
    data = bytearray(SOURCE_BORROW.data)
    data[8:16] = amount.to_bytes(8, "little")
    return Instruction(KAMINO, bytes(data), SOURCE_BORROW.accounts)


def repay_ix(amount, borrow_index):
    data = bytearray(SOURCE_REPAY.data)
    data[8:16] = amount.to_bytes(8, "little")
    data[16] = borrow_index
    return Instruction(KAMINO, bytes(data), SOURCE_REPAY.accounts)


def create_ata_ix(mint, ata):
    return Instruction(
        ATA_PROGRAM,
        bytes([1]),
        [
            AccountMeta(PAYER, True, True),
            AccountMeta(ata, False, True),
            AccountMeta(PAYER, False, False),
            AccountMeta(mint, False, False),
            AccountMeta(SYSTEM, False, False),
            AccountMeta(TOKEN, False, False),
        ],
    )


def create_usdt_ata_ix():
    return create_ata_ix(USDT, USER_USDT)


def swap_ix(amount, forward=True, mutate=None):
    if forward:
        keys = [
            PAYER, CONFIG, POOL, USER_USDC, USER_USDT, VAULT_USDC, VAULT_USDT,
            OBSERVATION, TOKEN, TOKEN_2022, MEMO, USDC, USDT, TICK_ARRAY_0,
        ]
    else:
        keys = [
            PAYER, CONFIG, POOL, USER_USDT, USER_USDC, VAULT_USDT, VAULT_USDC,
            OBSERVATION, TOKEN, TOKEN_2022, MEMO, USDT, USDC, TICK_ARRAY_0,
        ]
    writable = [True, False, True, True, True, True, True, True, False, False, False, False, False, True]
    signers = [True] + [False] * 13
    if mutate:
        mutate(keys, signers)
    data = bytes.fromhex("2b04ed0b1ac91e62") + struct.pack("<QQ", amount, 0) + (0).to_bytes(16, "little") + bytes([1])
    return Instruction(PROGRAM, data, [AccountMeta(key, signers[i], writable[i]) for i, key in enumerate(keys)])


def update_ix():
    disc = hashlib.sha256(b"global:update_reward_infos").digest()[:8]
    return Instruction(PROGRAM, disc, [AccountMeta(POOL, False, True)])


def thin_swap_ix(amount, forward=True, is_base_input=True):
    if forward:
        keys = [
            PAYER, THIN_CONFIG, THIN_POOL, USER_USDC, USER_THIN_TOKEN,
            THIN_VAULT_USDC, THIN_VAULT_TOKEN, THIN_OBSERVATION,
            TOKEN, TOKEN_2022, MEMO, USDC, THIN_TOKEN, THIN_TICK_ARRAY,
        ]
    else:
        keys = [
            PAYER, THIN_CONFIG, THIN_POOL, USER_THIN_TOKEN, USER_USDC,
            THIN_VAULT_TOKEN, THIN_VAULT_USDC, THIN_OBSERVATION,
            TOKEN, TOKEN_2022, MEMO, THIN_TOKEN, USDC, THIN_TICK_ARRAY,
        ]
    writable = [True, False, True, True, True, True, True, True, False, False, False, False, False, True]
    disc = bytes.fromhex("2b04ed0b1ac91e62")
    data = disc + struct.pack("<QQ", amount, 0) + (0).to_bytes(16, "little") + bytes([int(is_base_input)])
    return Instruction(
        PROGRAM,
        data,
        [AccountMeta(key, i == 0, writable[i]) for i, key in enumerate(keys)],
    )


MONITOR = [
    USER_USDC, USER_USDT, USER_THIN_TOKEN,
    KAMINO_SUPPLY, KAMINO_FEE_VAULT,
    VAULT_USDC, VAULT_USDT, POOL,
    THIN_VAULT_USDC, THIN_VAULT_TOKEN, THIN_POOL, THIN_OBSERVATION, THIN_TICK_ARRAY,
    KAMINO_RESERVE,
]


def decode_account(address, account):
    if account is None:
        return None
    data = base64.b64decode(account["data"][0])
    row = {"address": str(address), "owner": account["owner"], "dataLen": len(data)}
    if len(data) in (165, 170, 182):
        row["tokenAmount"] = struct.unpack_from("<Q", data, 64)[0]
    elif len(data) == 1544:
        row.update(
            liquidity=int.from_bytes(data[237:253], "little"),
            sqrtPriceX64=int.from_bytes(data[253:269], "little"),
            tickCurrent=int.from_bytes(data[269:273], "little", signed=True),
            feeGrowthGlobal0X64=int.from_bytes(data[277:293], "little"),
            feeGrowthGlobal1X64=int.from_bytes(data[293:309], "little"),
            protocolFees0=struct.unpack_from("<Q", data, 309)[0],
            protocolFees1=struct.unpack_from("<Q", data, 317)[0],
            fundFees0=struct.unpack_from("<Q", data, 1064)[0],
            fundFees1=struct.unpack_from("<Q", data, 1072)[0],
            dataSha256=hashlib.sha256(data).hexdigest(),
        )
    elif len(data) == 8624:
        row.update(
            availableLiquidityRaw=struct.unpack_from("<Q", data, 224)[0],
            flashLoanFeeSf=str(int.from_bytes(data[4904:4912], "little")),
            dataSha256=hashlib.sha256(data).hexdigest(),
        )
    else:
        row["dataSha256"] = hashlib.sha256(data).hexdigest()
    return row


def snapshot():
    result = rpc("getMultipleAccounts", [[str(k) for k in MONITOR], {"encoding": "base64", "commitment": "confirmed"}])
    if "rpcError" in result:
        raise RuntimeError(result["rpcError"])
    return {
        "slot": result["context"]["slot"],
        "accounts": [decode_account(k, account) for k, account in zip(MONITOR, result["value"])],
    }


BEFORE = snapshot()
BEFORE_BY_ADDRESS = {row["address"]: row for row in BEFORE["accounts"] if row}
AVAILABLE = BEFORE_BY_ADDRESS[str(KAMINO_SUPPLY)]["tokenAmount"]
RESERVE_AVAILABLE = BEFORE_BY_ADDRESS[str(KAMINO_RESERVE)]["availableLiquidityRaw"]


def simulate(label, instructions, config=None):
    config = config or TransactionConfig(compute_unit_limit=1_000_000, loaded_accounts_data_size_limit=64_000_000)
    message = MessageV1.try_compile(PAYER, instructions, Hash.default(), config)
    tx = VersionedTransaction.populate(message, [Signature.default()] * message.header.num_required_signatures)
    message_bytes = bytes(message)
    transaction_bytes = bytes(tx)
    evidence = {
        "label": label,
        "messageVersion": 1,
        "instructionCount": len(instructions),
        "inlineAccountCount": len(message.account_keys),
        "inlineAccounts": [str(key) for key in message.account_keys],
        "messageSize": len(message_bytes),
        "transactionSize": len(transaction_bytes),
        "messageSha256": hashlib.sha256(message_bytes).hexdigest(),
        "transactionSha256": hashlib.sha256(transaction_bytes).hexdigest(),
        "messageBase64": base64.b64encode(message_bytes).decode(),
        "transactionBase64": base64.b64encode(transaction_bytes).decode(),
        "configuredComputeLimit": config.compute_unit_limit,
        "configuredLoadedAccountDataLimit": config.loaded_accounts_data_size_limit,
    }
    if len(transaction_bytes) > V1_TRANSACTION_SIZE_LIMIT:
        evidence["compileError"] = f"serialized transaction exceeds {V1_TRANSACTION_SIZE_LIMIT} bytes"
        return evidence
    # Providers cap returned-account snapshots at the number of transaction
    # accounts.  Only request watched accounts actually present in this case.
    watched = [key for key in MONITOR if key in message.account_keys]
    result = rpc(
        "simulateTransaction",
        [base64.b64encode(transaction_bytes).decode(), {
            "encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True,
            "commitment": "confirmed", "innerInstructions": True,
            "accounts": {"encoding": "base64", "addresses": [str(k) for k in watched]},
        }],
    )
    if "rpcError" in result:
        evidence["rpcError"] = result["rpcError"]
        return evidence
    value = result["value"]
    post = [decode_account(k, account) for k, account in zip(watched, value.get("accounts") or [])]
    deltas = {}
    created_token_accounts = []
    for row in post:
        if not row or "tokenAmount" not in row:
            continue
        before = BEFORE_BY_ADDRESS.get(row["address"])
        if not before or "tokenAmount" not in before:
            deltas[row["address"]] = row["tokenAmount"]
            created_token_accounts.append(row["address"])
        else:
            deltas[row["address"]] = row["tokenAmount"] - before["tokenAmount"]
    evidence.update(
        contextSlot=result.get("context", {}).get("slot"),
        err=value.get("err"),
        unitsConsumed=value.get("unitsConsumed"),
        postAccounts=post,
        tokenDeltas=deltas,
        createdTokenAccounts=created_token_accounts,
        relevantLogs=[line for line in value.get("logs") or [] if
                      "Instruction:" in line or "AnchorError" in line or "failed:" in line
                      or "flash" in line.lower() or "Program data:" in line],
        innerInstructions=value.get("innerInstructions"),
    )
    return evidence


results = []


def add(label, instructions):
    result = simulate(label, instructions)
    results.append(result)
    print(json.dumps({
        "label": label, "size": result.get("transactionSize"), "accounts": result.get("inlineAccountCount"),
        "err": result.get("err") or result.get("rpcError") or result.get("compileError"),
        "units": result.get("unitsConsumed"), "deltas": result.get("tokenDeltas"),
    }))
    time.sleep(0.15)
    return result


def transfer_amount(result, outer_index, source, destination):
    """Return a parsed SPL transfer amount from one outer instruction."""
    for group in result.get("innerInstructions") or []:
        if group.get("index") != outer_index:
            continue
        for item in group.get("instructions") or []:
            info = (item.get("parsed") or {}).get("info") or {}
            if info.get("source") == str(source) and info.get("destination") == str(destination):
                token_amount = info.get("tokenAmount") or {}
                raw = token_amount.get("amount") or info.get("amount")
                if raw is not None:
                    return int(raw)
    return None


# Native V1 funded controls and exact flash-loan boundary amounts.
add("v1_flash_1_update_repay", [borrow_ix(1), update_ix(), repay_ix(1, 0)])
add("v1_flash_reserve_available_minus_1_update_repay", [borrow_ix(RESERVE_AVAILABLE - 1), update_ix(), repay_ix(RESERVE_AVAILABLE - 1, 0)])
add("v1_flash_exact_reserve_available_update_repay", [borrow_ix(RESERVE_AVAILABLE), update_ix(), repay_ix(RESERVE_AVAILABLE, 0)])
add("v1_flash_reserve_available_plus_1_update_repay", [borrow_ix(RESERVE_AVAILABLE + 1), update_ix(), repay_ix(RESERVE_AVAILABLE + 1, 0)])

# Update/crank placement and replay/order controls.
add("v1_update_before_flash_pair", [update_ix(), borrow_ix(100_000), repay_ix(100_000, 1)])
add("v1_update_between_flash_pair", [borrow_ix(100_000), update_ix(), repay_ix(100_000, 0)])
add("v1_update_after_flash_pair", [borrow_ix(100_000), repay_ix(100_000, 0), update_ix()])
add("v1_updates_before_between_after", [update_ix(), borrow_ix(100_000), update_ix(), update_ix(), repay_ix(100_000, 1), update_ix()])
add("v1_repay_before_borrow", [repay_ix(100_000, 1), borrow_ix(100_000)])
add("v1_borrow_without_repay_then_update", [borrow_ix(100_000), update_ix()])
add("v1_duplicate_borrow_single_repay", [borrow_ix(100_000), borrow_ix(100_000), repay_ix(100_000, 0)])
add("v1_repay_amount_minus_1", [borrow_ix(100_000), update_ix(), repay_ix(99_999, 0)])

# Probe the deployed Raydium exact-input threshold with flash-borrowed USDC.
successful_threshold = None
for amount in [1, 2, 3, 4, 5, 10, 25, 50, 100, 250, 500, 1_000, 10_000, 100_000]:
    case = add(
        f"v1_flash_raydium_one_way_{amount}",
        [create_usdt_ata_ix(), borrow_ix(amount), swap_ix(amount, True), repay_ix(amount, 1)],
    )
    if case.get("err") is None and not case.get("rpcError"):
        successful_threshold = amount
        break

# A material same-asset round trip, then repeated legs, using the first simulation's exact output.
one_way = add(
    "v1_flash_raydium_one_way_100000",
    [create_usdt_ata_ix(), borrow_ix(100_000), swap_ix(100_000, True), repay_ix(100_000, 1)],
)
usdt_delta = (one_way.get("tokenDeltas") or {}).get(str(USER_USDT))
if isinstance(usdt_delta, int) and usdt_delta > 0:
    add(
        "v1_flash_raydium_roundtrip_100000",
        [create_usdt_ata_ix(), borrow_ix(100_000), swap_ix(100_000, True), swap_ix(usdt_delta, False), repay_ix(100_000, 1)],
    )
    add(
        "v1_flash_raydium_two_roundtrips",
        [create_usdt_ata_ix(), borrow_ix(200_000), swap_ix(100_000, True), swap_ix(usdt_delta, False),
         swap_ix(100_000, True), swap_ix(usdt_delta, False), repay_ix(200_000, 1)],
    )
    add(
        "v1_updates_interleaved_with_roundtrip",
        [create_usdt_ata_ix(), update_ix(), borrow_ix(100_000), update_ix(), swap_ix(100_000, True),
         update_ix(), swap_ix(usdt_delta, False), update_ix(), repay_ix(100_000, 2), update_ix()],
    )

# Target account alias and CPI-substitution controls while a valid loan envelope is present.
add(
    "v1_flash_swap_output_aliases_output_vault",
    [create_usdt_ata_ix(), borrow_ix(100_000), swap_ix(100_000, True, lambda keys, _: keys.__setitem__(4, VAULT_USDT)), repay_ix(100_000, 1)],
)
add(
    "v1_flash_swap_input_aliases_input_vault",
    [create_usdt_ata_ix(), borrow_ix(100_000), swap_ix(100_000, True, lambda keys, _: keys.__setitem__(3, VAULT_USDC)), repay_ix(100_000, 1)],
)
add(
    "v1_flash_swap_token_programs_substituted",
    [create_usdt_ata_ix(), borrow_ix(100_000), swap_ix(100_000, True, lambda keys, _: (keys.__setitem__(8, TOKEN_2022), keys.__setitem__(9, TOKEN))), repay_ix(100_000, 1)],
)

# Current-state dust, fee-rounding, reserve-capacity, and tick-edge tests on a
# genuinely thin CLMM pool.  An intentionally doomed probe first extracts the
# exact forward output from parsed inner transfers; the following transaction
# reverses that exact amount and attempts the flash repayment atomically.
for amount in [1, 2, 3, 4, 5, 10, 25, 50, 100, 1_000]:
    add(
        f"v1_thin_flash_one_way_{amount}",
        [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(amount),
         thin_swap_ix(amount, True), repay_ix(amount, 1)],
    )


def thin_roundtrip(label, amount, reverse_parts=1, interleave_updates=False):
    probe = add(
        label + "_forward_output_probe",
        [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(amount),
         thin_swap_ix(amount, True), thin_swap_ix(1, False), repay_ix(amount, 1)],
    )
    output = transfer_amount(probe, 2, THIN_VAULT_TOKEN, USER_THIN_TOKEN)
    if output is None or output <= 0:
        return {"label": label, "amount": amount, "forwardOutput": output, "final": None}
    parts = [output // reverse_parts] * reverse_parts
    parts[-1] += output - sum(parts)
    if interleave_updates:
        instructions = [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN),
                        Instruction(PROGRAM, hashlib.sha256(b"global:update_reward_infos").digest()[:8],
                                    [AccountMeta(THIN_POOL, False, True)]),
                        borrow_ix(amount),
                        thin_swap_ix(amount, True)]
        for part in parts:
            instructions.extend([
                Instruction(PROGRAM, hashlib.sha256(b"global:update_reward_infos").digest()[:8],
                            [AccountMeta(THIN_POOL, False, True)]),
                thin_swap_ix(part, False),
            ])
        instructions.extend([repay_ix(amount, 2),
                             Instruction(PROGRAM, hashlib.sha256(b"global:update_reward_infos").digest()[:8],
                                         [AccountMeta(THIN_POOL, False, True)])])
    else:
        instructions = [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(amount),
                        thin_swap_ix(amount, True)]
        instructions.extend(thin_swap_ix(part, False) for part in parts)
        instructions.append(repay_ix(amount, 1))
    final = add(label, instructions)
    final["forwardOutputRawFromProbe"] = output
    final["reversePartsRaw"] = parts
    return {"label": label, "amount": amount, "forwardOutput": output, "final": final}


thin_roundtrip("v1_thin_roundtrip_100000", 100_000)
thin_roundtrip("v1_thin_repeated_reverse_100000", 100_000, reverse_parts=3)
thin_roundtrip("v1_thin_update_interleaved_roundtrip_100000", 100_000, interleave_updates=True)
for amount in [1_000_000, 10_000_000, 50_000_000, 100_000_000,
               119_421_441, 119_421_442, 119_421_443]:
    thin_roundtrip(f"v1_thin_capacity_roundtrip_{amount}", amount)

# The 50m probe reaches the reverse leg and 100m fails in the forward leg with
# NotEnoughTickArrayAccount.  Binary-search the exact first failing amount at
# the initialized-array boundary in fresh atomic v1 simulations.
thin_threshold_low = 50_000_000
thin_threshold_high = 100_000_000
thin_threshold_low_output = None
while thin_threshold_low + 1 < thin_threshold_high:
    midpoint = (thin_threshold_low + thin_threshold_high) // 2
    probe = add(
        f"v1_thin_tick_boundary_probe_{midpoint}",
        [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(midpoint),
         thin_swap_ix(midpoint, True), thin_swap_ix(1, False), repay_ix(midpoint, 1)],
    )
    forward_output = transfer_amount(probe, 2, THIN_VAULT_TOKEN, USER_THIN_TOKEN)
    if forward_output is not None:
        thin_threshold_low = midpoint
        thin_threshold_low_output = forward_output
    else:
        thin_threshold_high = midpoint

if thin_threshold_low_output is None:
    final_low_probe = add(
        f"v1_thin_tick_boundary_probe_{thin_threshold_low}",
        [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(thin_threshold_low),
         thin_swap_ix(thin_threshold_low, True), thin_swap_ix(1, False), repay_ix(thin_threshold_low, 1)],
    )
    thin_threshold_low_output = transfer_amount(final_low_probe, 2, THIN_VAULT_TOKEN, USER_THIN_TOKEN)
if thin_threshold_low_output:
    final_low = add(
        "v1_thin_exact_last_successful_forward_roundtrip",
        [create_ata_ix(THIN_TOKEN, USER_THIN_TOKEN), borrow_ix(thin_threshold_low),
         thin_swap_ix(thin_threshold_low, True), thin_swap_ix(thin_threshold_low_output, False),
         repay_ix(thin_threshold_low, 1)],
    )
    final_low["forwardOutputRawFromProbe"] = thin_threshold_low_output

output = {
    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "transport": "read-only mainnet simulateTransaction; sigVerify=false; no sendTransaction",
    "messageVersion": 1,
    "v1Limits": {"transactionBytes": V1_TRANSACTION_SIZE_LIMIT, "inlineAccounts": 64},
    "sourceKamino": {"signature": source_hit["signature"], "slot": source_hit["slot"]},
    "programs": {"kamino": str(KAMINO), "raydiumClmm": str(PROGRAM)},
    "pool": {"address": str(POOL), "mint0": str(USDC), "mint1": str(USDT), "tickArray": str(TICK_ARRAY_0)},
    "thinPool": {
        "address": str(THIN_POOL), "mint0": str(USDC), "mint1": str(THIN_TOKEN),
        "vault0": str(THIN_VAULT_USDC), "vault1": str(THIN_VAULT_TOKEN),
        "tickArrayStart": THIN_TICK_START, "tickArray": str(THIN_TICK_ARRAY),
        "selection": "current live low-liquidity classic-token pool; approximately 119.4/115.2 whole-token vault balances at selection",
    },
    "accounts": {
        "payer": str(PAYER), "userUsdc": str(USER_USDC), "userUsdt": str(USER_USDT),
        "kaminoReserve": str(KAMINO_RESERVE), "kaminoSupply": str(KAMINO_SUPPLY),
        "kaminoFeeVault": str(KAMINO_FEE_VAULT), "raydiumVaultUsdc": str(VAULT_USDC),
        "raydiumVaultUsdt": str(VAULT_USDT),
    },
    "pre": BEFORE,
    "supplyVaultBalanceRaw": AVAILABLE,
    "reserveAvailableLiquidityRaw": RESERVE_AVAILABLE,
    "firstSuccessfulRaydiumInputRaw": successful_threshold,
    "thinPoolForwardBoundary": {
        "lastAmountReachingReverseInstructionRaw": thin_threshold_low,
        "firstAmountFailingForwardRaw": thin_threshold_high,
        "lastForwardOutputRaw": thin_threshold_low_output,
        "firstFailure": "deployed custom 6023 / source-era NotEnoughTickArrayAccount",
    },
    "results": results,
    "debtAndShares": "not applicable: Kamino flash borrow/payback supplies no obligation, debt, or share account and creates none",
}
OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({"output": str(OUTPUT), "cases": len(results), "firstSuccessfulRaydiumInputRaw": successful_threshold}, indent=2))
