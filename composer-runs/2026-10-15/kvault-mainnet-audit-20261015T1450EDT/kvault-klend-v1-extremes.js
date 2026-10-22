#!/usr/bin/env node

// Read-only current-mainnet v1 flash composition across KLend and Kvault.
// No transaction is signed or submitted. The authenticated RPC URL is never
// persisted or printed.
const fs = require("fs");
const crypto = require("crypto");
const {
  Connection, PublicKey, TransactionInstruction,
} = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js");
const bs = require("/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58");
const bs58 = bs.default || bs;
const {encodeV1} = require("../klend-v1-composition.js");

const DIR = "composer-runs/2026-10-15/kvault-mainnet-audit-20261015T1450EDT";
const OUTPUT = `${DIR}/evidence/kvault-klend-v1-extremes-v2.json`;
const env = Object.fromEntries(fs.readFileSync("/tmp/composer-helius-only.env", "utf8")
  .split("\n").filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error("No read-only RPC configured");
const connection = new Connection(rpcUrl, "confirmed");
const P = (value) => new PublicKey(value);
const KVAULT = P("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd");
const KLEND = P("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const TOKEN = P("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM = P("11111111111111111111111111111111");
const INSTRUCTIONS = P("Sysvar1nstructions1111111111111111111111111");
const OUTSIDER = P("6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3");
const ROOT_CONTROL_AMOUNT = 7789632497552n;
const U64_MAX = (1n << 64n) - 1n;

const depositEvidence = JSON.parse(fs.readFileSync(`${DIR}/evidence/source-deposit-517H.json`));
const depositRecord = depositEvidence.instructions.find((ix) => ix.programId === KVAULT.toBase58());
if (!depositRecord) throw new Error("Kvault deposit source instruction missing");
const withdrawEvidence = JSON.parse(fs.readFileSync(`${DIR}/evidence/source-withdraw-available-4VyB.json`));
const withdrawRecord = withdrawEvidence.instructions.find((ix) => ix.programId === KVAULT.toBase58());
if (!withdrawRecord) throw new Error("Kvault withdrawal source instruction missing");
const inventory = JSON.parse(fs.readFileSync(`${DIR}/evidence/mainnet-custody-inventory.json`));
const vaultAddress = depositRecord.accounts[1].pubkey;
const vaultInventory = inventory.vaults.find((vault) => vault.address === vaultAddress);
if (!vaultInventory || vaultInventory.tokenMint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
  throw new Error("Selected source is not the expected current USDC vault");
}
if (vaultInventory.allocations.length !== 1) throw new Error("Selected vault allocation count changed");
const allocation = vaultInventory.allocationCustody[0];
const reserve = allocation.reserve;

const flashSource = JSON.parse(fs.readFileSync("composer-runs/2026-10-15/kamino-flash-history.json")).hits[0];
const flashMessage = flashSource.transaction.transaction.message;
const flashStatic = flashMessage.accountKeys;
const flashLoadedWritable = flashSource.transaction.meta.loadedAddresses?.writable || [];
const flashLoadedReadonly = flashSource.transaction.meta.loadedAddresses?.readonly || [];
const flashKeys = [...flashStatic, ...flashLoadedWritable, ...flashLoadedReadonly];
const flashHeader = flashMessage.header;
const isWritable = (index) => index < flashStatic.length
  ? (index < flashHeader.numRequiredSignatures
    ? index < flashHeader.numRequiredSignatures - flashHeader.numReadonlySignedAccounts
    : index < flashStatic.length - flashHeader.numReadonlyUnsignedAccounts)
  : index < flashStatic.length + flashLoadedWritable.length;
const sourceIx = (record) => new TransactionInstruction({
  programId: P(record.programId || flashKeys[record.programIdIndex]),
  keys: (record.accounts || []).map((account) => typeof account === "number" ? ({
    pubkey: P(flashKeys[account]),
    isSigner: account < flashHeader.numRequiredSignatures,
    isWritable: isWritable(account),
  }) : ({pubkey: P(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable})),
  data: Buffer.from(bs58.decode(record.data)),
});
const flashBorrowTemplate = sourceIx(flashMessage.instructions[3]);
const flashRepayTemplate = sourceIx(flashMessage.instructions[13]);
if (!flashBorrowTemplate.programId.equals(KLEND) || !flashRepayTemplate.programId.equals(KLEND)) {
  throw new Error("Historical KLend flash instruction indexes changed");
}

const depositTemplate = sourceIx(depositRecord);
// Use a recently successful withdrawer's same-vault accounts. The source
// share account is empty while its USDC account retains enough authorized
// balance to absorb the configured withdrawal penalty in a zero-fee flash
// round trip.
depositTemplate.keys[0].pubkey = P(withdrawRecord.accounts[0].pubkey);
depositTemplate.keys[6].pubkey = P(withdrawRecord.accounts[5].pubkey);
depositTemplate.keys[7].pubkey = P(withdrawRecord.accounts[7].pubkey);
const user = depositTemplate.keys[0].pubkey;
const vault = depositTemplate.keys[1].pubkey;
const tokenVault = depositTemplate.keys[2].pubkey;
const tokenMint = depositTemplate.keys[3].pubkey;
const baseAuthority = depositTemplate.keys[4].pubkey;
const sharesMint = depositTemplate.keys[5].pubkey;
const userToken = depositTemplate.keys[6].pubkey;
const userShares = depositTemplate.keys[7].pubkey;
const eventAuthority = depositTemplate.keys[11].pubkey;
const refreshRemaining = depositTemplate.keys.slice(13).map((key) => ({...key}));
const [globalConfig] = PublicKey.findProgramAddressSync([Buffer.from("global_config")], KVAULT);
const lendingMarket = P(reserve.lendingMarket);
const [lendingMarketAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("lma"), lendingMarket.toBuffer()], KLEND);
const ctokenVault = P(allocation.ctokenVault);
const reserveKey = P(reserve.address);
const reserveLiquiditySupply = P(reserve.liquiditySupplyVault);
const reserveCollateralMint = P(reserve.collateralMint);
const flashReserve = flashBorrowTemplate.keys[3].pubkey;
const flashSupply = flashBorrowTemplate.keys[5].pubkey;
const flashFeeVault = flashBorrowTemplate.keys[7].pubkey;

const disc = (name) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (value) => { const data = Buffer.alloc(8); data.writeBigUInt64LE(value); return data; };
const instruction = (programId, keys, data) => new TransactionInstruction({programId, keys, data});
const copy = (ix) => instruction(ix.programId, ix.keys.map((key) => ({...key})), Buffer.from(ix.data));
const flashIx = (template, amount, repayIndex) => {
  const ix = copy(template);
  ix.keys[0].pubkey = user;
  ix.keys[6].pubkey = userToken;
  ix.data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) ix.data[16] = repayIndex;
  return ix;
};
const deposit = (amount, mutate) => {
  const ix = copy(depositTemplate);
  ix.data.writeBigUInt64LE(amount, 8);
  if (mutate) mutate(ix);
  return ix;
};
const withdrawAvailable = (sharesAmount = U64_MAX, mutate) => {
  const keys = [
    {pubkey: user, isSigner: true, isWritable: false},
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: globalConfig, isSigner: false, isWritable: false},
    {pubkey: tokenVault, isSigner: false, isWritable: true},
    {pubkey: baseAuthority, isSigner: false, isWritable: false},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: tokenMint, isSigner: false, isWritable: true},
    {pubkey: userShares, isSigner: false, isWritable: true},
    {pubkey: sharesMint, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: eventAuthority, isSigner: false, isWritable: false},
    {pubkey: KVAULT, isSigner: false, isWritable: false},
    ...refreshRemaining.map((key) => ({...key})),
  ];
  const ix = instruction(KVAULT, keys, Buffer.concat([disc("withdraw_from_available"), u64(sharesAmount)]));
  if (mutate) mutate(ix);
  return ix;
};
const withdrawFull = (sharesAmount = U64_MAX, mutate) => {
  const keys = [
    ...withdrawAvailable(sharesAmount).keys.slice(0, 14),
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: reserveKey, isSigner: false, isWritable: true},
    {pubkey: ctokenVault, isSigner: false, isWritable: true},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
    {pubkey: lendingMarketAuthority, isSigner: false, isWritable: false},
    {pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true},
    {pubkey: reserveCollateralMint, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: INSTRUCTIONS, isSigner: false, isWritable: false},
    {pubkey: eventAuthority, isSigner: false, isWritable: false},
    {pubkey: KVAULT, isSigner: false, isWritable: false},
    ...refreshRemaining.map((key) => ({...key})),
  ];
  const ix = instruction(KVAULT, keys, Buffer.concat([disc("withdraw"), u64(sharesAmount)]));
  if (mutate) mutate(ix);
  return ix;
};
const invest = (maxAmount = U64_MAX, mutate) => {
  const keys = [
    {pubkey: user, isSigner: true, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: vault, isSigner: false, isWritable: true},
    {pubkey: tokenVault, isSigner: false, isWritable: true},
    {pubkey: tokenMint, isSigner: false, isWritable: true},
    {pubkey: baseAuthority, isSigner: false, isWritable: true},
    {pubkey: ctokenVault, isSigner: false, isWritable: true},
    {pubkey: reserveKey, isSigner: false, isWritable: true},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
    {pubkey: lendingMarketAuthority, isSigner: false, isWritable: false},
    {pubkey: reserveLiquiditySupply, isSigner: false, isWritable: true},
    {pubkey: reserveCollateralMint, isSigner: false, isWritable: true},
    {pubkey: KVAULT, isSigner: false, isWritable: false},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: INSTRUCTIONS, isSigner: false, isWritable: false},
    ...refreshRemaining.map((key) => ({...key})),
  ];
  const ix = instruction(KVAULT, keys, Buffer.concat([disc("invest_with_max_amount"), u64(maxAmount)]));
  if (mutate) mutate(ix);
  return ix;
};
const refresh = (mutate) => {
  const keys = [
    {pubkey: reserveKey, isSigner: false, isWritable: true},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
  ];
  const ix = instruction(KLEND, keys, Buffer.concat([disc("refresh_reserves_batch"), Buffer.from([1])]));
  if (mutate) mutate(ix);
  return ix;
};

const watched = [userToken, userShares, tokenVault, sharesMint, ctokenVault, vault,
  reserveLiquiditySupply, reserveKey, flashSupply, flashFeeVault, flashReserve];
const watchedLabels = ["walletUsdc", "walletKvaultShares", "kvaultUnderlyingVault",
  "kvaultSharesMint", "kvaultCtokenVault", "kvaultState", "kvaultReserveLiquiditySupply",
  "kvaultReserve", "flashReserveLiquiditySupply", "flashFeeVault", "flashReserve"];
const tokenAmount = (data) => data.length === 165 ? data.readBigUInt64LE(64).toString() : null;
const mintSupply = (data) => data.length === 82 ? data.readBigUInt64LE(36).toString() : null;
const u128 = (data, offset) => (data.readBigUInt64LE(offset)
  | (data.readBigUInt64LE(offset + 8) << 64n)).toString();
const decodeWatched = (account, index) => {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], "base64");
  const owner = typeof account.owner === "string" ? account.owner : account.owner.toBase58();
  const base = {owner, dataLength: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex")};
  if ([0, 1, 2, 4, 6, 8, 9].includes(index)) return {...base, amountRaw: tokenAmount(data)};
  if (index === 3) return {...base, supplyRaw: mintSupply(data)};
  if (index === 5 && data.length >= 1416) return {...base,
    tokenAvailableRaw: data.readBigUInt64LE(224).toString(),
    sharesIssuedRaw: data.readBigUInt64LE(232).toString(),
    previousAumSf: u128(data, 280), pendingFeesSf: u128(data, 296),
    ctokenAllocationRaw: data.readBigUInt64LE(1416).toString()};
  if ([7, 10].includes(index) && data.length >= 4912) return {...base,
    availableLiquidityRaw: data.readBigUInt64LE(224).toString(),
    borrowedLiquiditySf: u128(data, 232),
    flashLoanFeeSf: data.readBigUInt64LE(4904).toString()};
  return base;
};
const blueprint = (instructions) => instructions.map((ix, index) => ({index,
  programId: ix.programId.toBase58(), dataBase58: bs58.encode(ix.data),
  accounts: ix.keys.map((key) => ({pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner, isWritable: key.isWritable}))}));

async function simulate(name, instructions, blockhash, expected) {
  const encoded = encodeV1(instructions, user, blockhash);
  const wireSha256 = crypto.createHash("sha256").update(encoded.wire).digest("hex");
  const response = await fetch(rpcUrl, {method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: name, method: "simulateTransaction", params: [
      encoded.wire.toString("base64"), {encoding: "base64", sigVerify: false,
        replaceRecentBlockhash: true, commitment: "confirmed",
        accounts: {encoding: "base64", addresses: watched.map((key) => key.toBase58())}},
    ]})});
  const json = await response.json();
  const value = json.result?.value;
  const logs = value?.logs || [];
  return {name, expected, slot: json.result?.context?.slot || null,
    err: value?.err || null, rpcError: json.error || null,
    message: {format: "solana-v1", wireBytes: encoded.sizeBytes, equivalentV0Bytes: encoded.v0Bytes,
      wireSha256, wireBase64: encoded.wire.toString("base64"), addressCount: encoded.addressCount,
      writableCount: encoded.writableCount, instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures, config: encoded.config,
      instructionBlueprint: blueprint(instructions)},
    execution: {unitsConsumed: value?.unitsConsumed ?? null,
      loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
      maxInstructionTraceLengthExceeded: JSON.stringify(value?.err || {}).includes("MaxInstructionTraceLengthExceeded"),
      instructionTrace: logs.filter((line) => line.includes("Instruction:") || line.includes("invoke [")),
      selectedLogs: logs.filter((line) => line.includes("Instruction:") || line.includes("Error")
        || line.includes("failed") || line.includes("shares") || line.includes("amount")).slice(-80)},
    post: watched.map((_, index) => decodeWatched(value?.accounts?.[index], index))};
}

async function main() {
  const pre = await connection.getMultipleAccountsInfoAndContext(watched, "confirmed");
  const preDecoded = pre.value.map((account, index) => decodeWatched(account, index));
  const userSharesPre = BigInt(preDecoded[1]?.amountRaw || "0");
  const flashAvailable = BigInt(preDecoded[10]?.availableLiquidityRaw || "0");
  const flashFeeRate = BigInt(preDecoded[10]?.flashLoanFeeSf || U64_MAX.toString());
  if (flashFeeRate !== 0n) throw new Error(`Selected KLend flash reserve is not zero fee: ${flashFeeRate}`);
  if (userSharesPre !== 0n) throw new Error(`Selected positive-control share account is not empty: ${userSharesPre}`);
  if (flashAvailable <= ROOT_CONTROL_AMOUNT) throw new Error("Current flash reserve below root-provided control amount");
  const current99 = flashAvailable * 99n / 100n;
  const blockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  const pair = (amount, borrowIndex = 0) => [flashIx(flashBorrowTemplate, amount),
    flashIx(flashRepayTemplate, amount, borrowIndex)];
  const cycleAvailable = (amount) => [flashIx(flashBorrowTemplate, amount), deposit(amount),
    withdrawAvailable(), flashIx(flashRepayTemplate, amount, 0)];
  const cycleFull = (amount) => [flashIx(flashBorrowTemplate, amount), deposit(amount),
    withdrawFull(), flashIx(flashRepayTemplate, amount, 0)];
  const repeat = (rounds, amount) => [flashIx(flashBorrowTemplate, amount),
    ...Array.from({length: rounds}, () => [deposit(amount), withdrawAvailable()]).flat(),
    flashIx(flashRepayTemplate, amount, 0)];

  // Positive controls are always executed first. Mutations below are skipped
  // unless both a funded flash pair and a current Kvault round trip succeed.
  const controlCases = [
    ["control_flash_pair_one_raw", pair(1n), "success"],
    ["control_flash_pair_root_99pct", pair(ROOT_CONTROL_AMOUNT), "success"],
    ["control_flash_deposit_withdraw_threshold_plus_rounding", cycleAvailable(100001n), "success"],
    ["control_flash_deposit_full_withdraw_one_usdc", cycleFull(1000000n), "success"],
  ];
  const results = [];
  for (const [name, instructions, expected] of controlCases) {
    const result = await simulate(name, instructions, blockhash, expected);
    results.push(result);
    process.stdout.write(`${JSON.stringify({name, err: result.err, rpcError: result.rpcError,
      bytes: result.message.wireBytes, addresses: result.message.addressCount,
      units: result.execution.unitsConsumed})}\n`);
  }
  const funded = results[0].err === null && results[0].rpcError === null
    && results[1].err === null && results[1].rpcError === null;
  const kvaultPositive = results[2].err === null && results[2].rpcError === null;
  if (!funded || !kvaultPositive) {
    throw new Error(`Positive controls failed; mutations not run (funded=${funded}, kvault=${kvaultPositive})`);
  }

  const mutationCases = [
    ["threshold_minus_one", cycleAvailable(99999n), "minimum deposit rejection"],
    ["configured_threshold_exact", cycleAvailable(100000n), "rounding-aware minimum deposit rejection"],
    ["threshold_plus_one", cycleAvailable(100001n), "success"],
    ["one_usdc_cycle", cycleAvailable(1000000n), "success"],
    ["million_usdc_cycle", cycleAvailable(1000000000000n), "success or bounded repayment failure"],
    ["current_99pct_available_cycle", cycleAvailable(current99), "success or bounded repayment failure"],
    ["current_99_9pct_available_cycle", cycleAvailable(flashAvailable * 999n / 1000n), "success or bounded repayment failure"],
    ["full_available_flash_pair", pair(flashAvailable), "liquidity boundary rejection"],
    ["available_plus_one_flash_pair", pair(flashAvailable + 1n), "liquidity boundary rejection"],
    ["two_round_trips", repeat(2, 1000000n), "success or explicit penalty/rounding repayment failure"],
    ["four_round_trips", repeat(4, 1000000n), "success or trace/penalty limit"],
    ["eight_round_trips", repeat(8, 1000000n), "trace/runtime limit"],
    ["refresh_before_borrow", [refresh(), ...cycleAvailable(1000000n).map((ix, i) => i === 3
      ? flashIx(flashRepayTemplate, 1000000n, 1) : ix)], "success"],
    ["refresh_between_borrow_deposit", [flashIx(flashBorrowTemplate, 1000000n), refresh(),
      deposit(1000000n), withdrawAvailable(), flashIx(flashRepayTemplate, 1000000n, 0)], "success"],
    ["refresh_between_deposit_withdraw", [flashIx(flashBorrowTemplate, 1000000n),
      deposit(1000000n), refresh(), withdrawAvailable(),
      flashIx(flashRepayTemplate, 1000000n, 0)], "success"],
    ["refresh_after_withdraw", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawAvailable(), refresh(), flashIx(flashRepayTemplate, 1000000n, 0)], "success"],
    ["invest_then_full_withdraw_threshold_plus_rounding", [flashIx(flashBorrowTemplate, 100001n),
      deposit(100001n), invest(100001n), withdrawFull(), flashIx(flashRepayTemplate, 100001n, 0)],
      "success or explicit allocation/rounding limit"],
    ["invest_then_full_withdraw_one_usdc", [flashIx(flashBorrowTemplate, 1000000n),
      deposit(1000000n), invest(1000000n), withdrawFull(), flashIx(flashRepayTemplate, 1000000n, 0)],
      "success"],
    ["refresh_before_invest", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      refresh(), invest(1000000n), withdrawFull(), flashIx(flashRepayTemplate, 1000000n, 0)],
      "success or explicit refresh/allocation limit"],
    ["refresh_after_invest", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      invest(1000000n), refresh(), withdrawFull(), flashIx(flashRepayTemplate, 1000000n, 0)],
      "success or explicit refresh/allocation limit"],
    ["invest_then_full_withdraw_one_million_usdc", [flashIx(flashBorrowTemplate, 1000000000000n),
      deposit(1000000000000n), invest(1000000000000n), withdrawFull(),
      flashIx(flashRepayTemplate, 1000000000000n, 0)], "success or explicit runtime/liquidity limit"],
    ["withdraw_before_deposit", [flashIx(flashBorrowTemplate, 1000000n), withdrawAvailable(),
      deposit(1000000n), flashIx(flashRepayTemplate, 1000000n, 0)], "no unauthorized gain"],
    ["deposit_destination_aliases_token_vault", [flashIx(flashBorrowTemplate, 1000000n),
      deposit(1000000n, (ix) => { ix.keys[6].pubkey = tokenVault; }), withdrawAvailable(),
      flashIx(flashRepayTemplate, 1000000n, 0)], "account authority rejection"],
    ["withdraw_destination_aliases_token_vault", [flashIx(flashBorrowTemplate, 1000000n),
      deposit(1000000n), withdrawAvailable(U64_MAX, (ix) => { ix.keys[5].pubkey = tokenVault; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "account authority rejection"],
    ["withdraw_missing_user_signature", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawAvailable(U64_MAX, (ix) => { ix.keys[0].pubkey = OUTSIDER; ix.keys[0].isSigner = false; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "signer rejection"],
    ["withdraw_wrong_share_account", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawAvailable(U64_MAX, (ix) => { ix.keys[7].pubkey = sharesMint; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "token-account rejection"],
    ["withdraw_wrong_token_program", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawAvailable(U64_MAX, (ix) => { ix.keys[9].pubkey = SYSTEM; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "program-id rejection"],
    ["withdraw_refresh_accounts_reversed", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawAvailable(U64_MAX, (ix) => { [ix.keys[14], ix.keys[15]] = [ix.keys[15], ix.keys[14]]; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "reserve-order rejection"],
    ["full_withdraw_wrong_ctoken_vault", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawFull(U64_MAX, (ix) => { ix.keys[16].pubkey = flashSupply; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "ctoken PDA rejection"],
    ["full_withdraw_reserve_substitution", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      withdrawFull(U64_MAX, (ix) => { ix.keys[15].pubkey = flashReserve; }),
      flashIx(flashRepayTemplate, 1000000n, 0)], "reserve binding rejection"],
    ["repay_before_exit", [flashIx(flashBorrowTemplate, 1000000n), deposit(1000000n),
      flashIx(flashRepayTemplate, 1000000n, 0), withdrawAvailable()], "repay insufficiency or authorized exit"],
  ];
  for (const [name, instructions, expected] of mutationCases) {
    try {
      const result = await simulate(name, instructions, blockhash, expected);
      results.push(result);
      process.stdout.write(`${JSON.stringify({name, err: result.err, rpcError: result.rpcError,
        bytes: result.message.wireBytes, addresses: result.message.addressCount,
        units: result.execution.unitsConsumed,
        traceLimit: result.execution.maxInstructionTraceLengthExceeded})}\n`);
    } catch (error) {
      results.push({name, expected, localError: error.stack || error.message});
      process.stdout.write(`${JSON.stringify({name, localError: error.message})}\n`);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    liveSubmission: false,
    signatureVerification: false,
    rpc: "configured authenticated Solana RPC (URL redacted)",
    sourceRevision: "2dadf9449d32cfaa2ad5d1540c8edff378512c8c",
    sourceDeposit: {signature: depositEvidence.signature, slot: depositEvidence.slot,
      accountTuple: depositRecord.accounts, dataBase58: depositRecord.data},
    sourceWithdraw: {signature: withdrawEvidence.signature, slot: withdrawEvidence.slot,
      accountTuple: withdrawRecord.accounts, dataBase58: withdrawRecord.data},
    sourceFlash: {signature: flashSource.signature, slot: flashSource.slot,
      borrowInstructionIndex: 3, repayInstructionIndex: 13},
    selectedVault: {address: vault.toBase58(), name: vaultInventory.name,
      tokenMint: tokenMint.toBase58(), reserve: reserveKey.toBase58(),
      minDepositAmountRaw: vaultInventory.minDepositAmountRaw,
      minWithdrawAmountRaw: vaultInventory.minWithdrawAmountRaw,
      withdrawalPenaltyLamports: vaultInventory.withdrawalPenaltyLamports,
      withdrawalPenaltyBps: vaultInventory.withdrawalPenaltyBps},
    selectedFlashReserve: {address: flashReserve.toBase58(),
      liquiditySupply: flashSupply.toBase58(), feeVault: flashFeeVault.toBase58(),
      availableLiquidityRaw: flashAvailable.toString(), flashLoanFeeSf: flashFeeRate.toString(),
      feeInterpretation: "exact on-chain fixed-point fee-rate field equals zero; this is not fee rounding"},
    rootProvidedControlAmountRaw: ROOT_CONTROL_AMOUNT.toString(),
    currentNinetyNinePercentAvailableRaw: current99.toString(),
    preSlot: pre.context.slot,
    watched: watched.map((key, index) => ({label: watchedLabels[index], address: key.toBase58()})),
    pre: preDecoded,
    debtAccounting: "KLend flash loans create no persistent obligation account. Complete repayment is established only when the indexed repay instruction succeeds and the flash reserve liquidity supply, fee vault, and reserve accounting return to their pre-transaction values.",
    runtimeLimits: {v1WireBytes: 4096, inlineAddresses: 64, instructions: 64,
      configuredComputeUnits: 1400000, configuredLoadedAccountBytes: 67108864},
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, {flag: "wx"});
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
