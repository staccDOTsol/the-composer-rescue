#!/usr/bin/env node
// Read-only mainnet simulation of a configured zero-fee KLend wSOL flash loan
// composed with the live Sanctum SPL stake-pool program. Never signs or sends.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  SYSVAR_CLOCK_PUBKEY, SYSVAR_INSTRUCTIONS_PUBKEY, SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
  createSyncNativeInstruction, getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const envPath = fs.existsSync('/tmp/composer-helius-only.env')
  ? '/tmp/composer-helius-only.env' : '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = process.env.RPC_URL || process.env.HEAVY_RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC_URL) throw new Error('read-only RPC unavailable');
const conn = new Connection(RPC_URL, 'confirmed');
const P = value => new PublicKey(value);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const SP12 = P('SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY');
const OWNER = P('Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM');
// This live wSOL reserve was selected because its current Reserve config has an
// exact flash_loan_fee_sf of zero and substantial live available liquidity.
const KLEND_RESERVE = P('4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const STAKE_POOL = P('2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa');
const DEPOSIT_LAMPORTS = 1_000_000n;
const OUTPUT = `${DIR}/sp12-flash-klend-v1.json`;
const SUMMARY_OUTPUT = `${DIR}/sp12-flash-klend-v1-summary.json`;
const klendIdl = JSON.parse(fs.readFileSync(`${DIR}/marginfi-source/idls-complete/kamino_lending.json`));
const klendCoder = new anchor.BorshAccountsCoder(klendIdl);
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const cloneIx = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
const u64 = n => { const data = Buffer.alloc(8); data.writeBigUInt64LE(n); return data; };
const tokenAmount = account => account?.data?.length >= 72 ? account.data.readBigUInt64LE(64) : null;
const pk = value => value instanceof PublicKey ? value : P(value);

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  if (v0.addressTableLookups.length) throw new Error('v1 does not use ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64)
    throw new Error(`v1 key/instruction limit ${keys.length}/${items.length}`);
  const cfg = Buffer.alloc(8);
  cfg.writeUInt32LE(computeLimit, 0);
  cfg.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) throw new Error('v1 ix length');
    const head = Buffer.alloc(4);
    head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length;
    head.writeUInt16LE(ix.data.length, 2);
    return head;
  });
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map(key => key.toBuffer()), cfg,
    ...heads, ...payloads, Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 wire size ${wire.length}`);
  return {wire, sizeBytes: wire.length, accountCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    computeLimit, dataLimit};
}

function flashIx(kind, reserve, owner, userToken, amount, borrowIndex) {
  const lendingMarket = pk(reserve.lending_market);
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), lendingMarket.toBuffer()], KLEND);
  const data = Buffer.concat([
    Buffer.from(kind === 'borrow'
      ? [135, 231, 52, 167, 7, 52, 212, 193]
      : [185, 117, 0, 203, 96, 245, 180, 186]),
    u64(amount), ...(kind === 'repay' ? [Buffer.from([borrowIndex])] : []),
  ]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    {pubkey: owner, isSigner: true, isWritable: true},
    {pubkey: marketAuthority, isSigner: false, isWritable: false},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
    {pubkey: KLEND_RESERVE, isSigner: false, isWritable: true},
    {pubkey: pk(reserve.liquidity.mint_pubkey), isSigner: false, isWritable: false},
    {pubkey: pk(reserve.liquidity.supply_vault), isSigner: false, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: pk(reserve.liquidity.fee_vault), isSigner: false, isWritable: true},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function sp12Deposit(pool, poolToken, lamports = DEPOSIT_LAMPORTS, referral = poolToken) {
  return new TransactionInstruction({programId: SP12, data: Buffer.concat([Buffer.from([14]), u64(lamports)]), keys: [
    {pubkey: STAKE_POOL, isSigner: false, isWritable: true},
    {pubkey: pool.withdrawAuthority, isSigner: false, isWritable: false},
    {pubkey: pk(pool.state.reserveStake), isSigner: false, isWritable: true},
    {pubkey: OWNER, isSigner: true, isWritable: true},
    {pubkey: poolToken, isSigner: false, isWritable: true},
    {pubkey: pk(pool.state.managerFeeAccount), isSigner: false, isWritable: true},
    {pubkey: referral, isSigner: false, isWritable: true},
    {pubkey: pk(pool.state.poolMint), isSigner: false, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function sp12Withdraw(pool, poolToken, poolTokens, sourceOwner = OWNER) {
  return new TransactionInstruction({programId: SP12,
    data: Buffer.concat([Buffer.from([16]), u64(poolTokens)]), keys: [
      {pubkey: STAKE_POOL, isSigner: false, isWritable: true},
      {pubkey: pool.withdrawAuthority, isSigner: false, isWritable: false},
      {pubkey: sourceOwner, isSigner: true, isWritable: false},
      {pubkey: poolToken, isSigner: false, isWritable: true},
      {pubkey: pk(pool.state.reserveStake), isSigner: false, isWritable: true},
      {pubkey: OWNER, isSigner: false, isWritable: true},
      {pubkey: pk(pool.state.managerFeeAccount), isSigner: false, isWritable: true},
      {pubkey: pk(pool.state.poolMint), isSigner: false, isWritable: true},
      {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
      {pubkey: SYSVAR_STAKE_HISTORY_PUBKEY, isSigner: false, isWritable: false},
      {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    ]});
}

function updatePool(pool) {
  return new TransactionInstruction({programId: SP12, data: Buffer.from([7]), keys: [
    {pubkey: STAKE_POOL, isSigner: false, isWritable: true},
    {pubkey: pool.withdrawAuthority, isSigner: false, isWritable: false},
    {pubkey: pk(pool.state.validatorList), isSigner: false, isWritable: true},
    {pubkey: pk(pool.state.reserveStake), isSigner: false, isWritable: false},
    {pubkey: pk(pool.state.managerFeeAccount), isSigner: false, isWritable: true},
    {pubkey: pk(pool.state.poolMint), isSigner: false, isWritable: true},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function wrapRoundTrip(prefix, amount, reserve, pool, options = {}) {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, OWNER);
  const poolMint = pk(pool.state.poolMint);
  const poolAta = getAssociatedTokenAddressSync(poolMint, OWNER);
  const createWsol = createAssociatedTokenAccountIdempotentInstruction(OWNER, wsolAta, OWNER, NATIVE_MINT,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createPool = createAssociatedTokenAccountIdempotentInstruction(OWNER, poolAta, OWNER, poolMint,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const closeWsol = createCloseAccountInstruction(wsolAta, OWNER, OWNER);
  const recreateWsol = createAssociatedTokenAccountIdempotentInstruction(OWNER, wsolAta, OWNER, NATIVE_MINT,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const rewrap = SystemProgram.transfer({fromPubkey: OWNER, toPubkey: wsolAta, lamports: amount});
  const sync = createSyncNativeInstruction(wsolAta);
  const depositLamports = options.depositLamports || DEPOSIT_LAMPORTS;
  const withdrawPoolTokens = options.withdrawPoolTokens || pool.depositPoolTokens;
  const deposit = sp12Deposit(pool, options.depositDestination || poolAta, depositLamports,
    options.referral || poolAta);
  const withdraw = sp12Withdraw(pool, options.withdrawSource || poolAta,
    withdrawPoolTokens, options.withdrawOwner || OWNER);
  const middle = options.middle || [deposit, withdraw];
  let instructions = [createWsol, null, closeWsol, createPool, ...middle, recreateWsol, rewrap, sync, null];
  const borrowIndex = instructions.findIndex(ix => ix === null);
  instructions[borrowIndex] = flashIx('borrow', reserve, OWNER, wsolAta, amount);
  instructions[instructions.length - 1] = flashIx('repay', reserve, OWNER, wsolAta, amount, borrowIndex);
  return {label: prefix, instructions, watched: [OWNER, wsolAta, poolAta, KLEND_RESERVE,
    pk(reserve.liquidity.supply_vault), pk(reserve.liquidity.fee_vault), STAKE_POOL,
    pk(pool.state.reserveStake), poolMint, pk(pool.state.managerFeeAccount)]};
}

function accountView(address, account) {
  if (!account) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = account.owner?.toBase58?.() || account.owner;
  return {lamports: account.lamports, owner, dataLength: data.length,
    tokenAmount: data.length >= 72 && owner === TOKEN_PROGRAM_ID.toBase58()
      ? data.readBigUInt64LE(64).toString() : null,
    mintSupply: data.length === 82 && owner === TOKEN_PROGRAM_ID.toBase58()
      ? data.readBigUInt64LE(36).toString() : null,
    sha256: crypto.createHash('sha256').update(data).digest('hex')};
}

async function simulate(spec, blockhash) {
  const encoded = encodeV1(spec.instructions, OWNER, blockhash);
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true, accounts: {encoding: 'base64', addresses: spec.watched.map(String)},
  }]);
  const value = response.value;
  return {label: spec.label, v1Bytes: encoded.sizeBytes, accountCount: encoded.accountCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    slot: response.context?.slot ?? null, err: value.err, unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    watched: Object.fromEntries(spec.watched.map((address, i) =>
      [address.toBase58(), accountView(address, value.accounts?.[i])])),
    logs: value.logs,
  };
}

async function main() {
  const reserveInfo = await conn.getAccountInfo(KLEND_RESERVE, 'confirmed');
  if (!reserveInfo || !reserveInfo.owner.equals(KLEND)) throw new Error('KLend reserve owner mismatch');
  const reserve = klendCoder.decode('Reserve', reserveInfo.data);
  if (!pk(reserve.liquidity.mint_pubkey).equals(NATIVE_MINT)) throw new Error('KLend reserve is not wSOL');
  const supplyInfo = await conn.getAccountInfo(pk(reserve.liquidity.supply_vault), 'confirmed');
  const feeInfo = await conn.getAccountInfo(pk(reserve.liquidity.fee_vault), 'confirmed');
  const available = BigInt(reserve.liquidity.total_available_amount.toString());
  const supplyAmount = tokenAmount(supplyInfo);
  const flashFeeSf = BigInt(reserve.config.fees.flash_loan_fee_sf.toString());
  if (flashFeeSf !== 0n) throw new Error(`selected KLend reserve fee is ${flashFeeSf}`);

  const poolInfo = await conn.getAccountInfo(STAKE_POOL, 'confirmed');
  if (!poolInfo || !poolInfo.owner.equals(SP12)) throw new Error('SP12 pool owner mismatch');
  // The SPL stake-pool layout is stable; use the already-installed official decoder.
  const stakePoolLib = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-stake-pool');
  const poolAccount = await stakePoolLib.getStakePoolAccount(conn, STAKE_POOL);
  const state = poolAccount.account.data;
  const [withdrawAuthority, withdrawBump] = PublicKey.findProgramAddressSync(
    [STAKE_POOL.toBuffer(), Buffer.from('withdraw')], SP12);
  if (state.stakeWithdrawBumpSeed !== withdrawBump) throw new Error('SP12 withdraw PDA mismatch');
  const totalLamports = BigInt(state.totalLamports.toString());
  const poolSupply = BigInt(state.poolTokenSupply.toString());
  const depositPoolTokens = DEPOSIT_LAMPORTS * poolSupply / totalLamports;
  if (depositPoolTokens === 0n) throw new Error('deposit mints zero pool tokens');
  const withdrawalFeeNumerator = BigInt(state.solWithdrawalFee.numerator.toString());
  const withdrawalFeeDenominator = BigInt(state.solWithdrawalFee.denominator.toString());
  const withdrawalFee = withdrawalFeeNumerator === 0n ? 0n :
    (depositPoolTokens * withdrawalFeeNumerator + withdrawalFeeDenominator - 1n) /
      withdrawalFeeDenominator;
  const expectedWithdrawLamports = (depositPoolTokens - withdrawalFee) *
    (totalLamports + DEPOSIT_LAMPORTS) / (poolSupply + depositPoolTokens);
  const minimumNonzeroDepositLamports = (totalLamports + poolSupply - 1n) / poolSupply;
  const minimumDepositPoolTokens = minimumNonzeroDepositLamports * poolSupply / totalLamports;
  // This pool has a nonzero SOL withdrawal fee. Its on-chain fee calculator
  // charges at least one pool-token unit, so one minted unit cannot be redeemed.
  const minimumRoundTripDepositLamports = (2n * totalLamports + poolSupply - 1n) / poolSupply;
  const minimumRoundTripPoolTokens = minimumRoundTripDepositLamports * poolSupply / totalLamports;
  const pool = {state, withdrawAuthority, depositPoolTokens, expectedWithdrawLamports};
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, OWNER);
  const poolAta = getAssociatedTokenAddressSync(pk(state.poolMint), OWNER);
  const baseWatched = [OWNER, wsolAta, poolAta, KLEND_RESERVE, pk(reserve.liquidity.supply_vault),
    pk(reserve.liquidity.fee_vault), STAKE_POOL, pk(state.reserveStake), pk(state.poolMint),
    pk(state.managerFeeAccount)];
  const createWsol = createAssociatedTokenAccountIdempotentInstruction(OWNER, wsolAta, OWNER, NATIVE_MINT);
  const pair = amount => {
    const instructions = [createWsol, flashIx('borrow', reserve, OWNER, wsolAta, amount)];
    instructions.push(flashIx('repay', reserve, OWNER, wsolAta, amount, 1));
    return {label: `klend_wsol_pair_${amount}`, instructions, watched: baseWatched};
  };
  const deposit = sp12Deposit(pool, poolAta);
  const withdraw = sp12Withdraw(pool, poolAta, depositPoolTokens);
  const update = updatePool(pool);
  const specs = [pair(1n), pair(1_000_000n), pair(available - 1n)];
  specs.push(wrapRoundTrip('smallest_nonzero_flash_sp12_leg', minimumNonzeroDepositLamports,
    reserve, pool, {depositLamports: minimumNonzeroDepositLamports,
      withdrawPoolTokens: minimumDepositPoolTokens}));
  specs.push(wrapRoundTrip('smallest_successful_flash_sp12_roundtrip', minimumRoundTripDepositLamports,
    reserve, pool, {depositLamports: minimumRoundTripDepositLamports,
      withdrawPoolTokens: minimumRoundTripPoolTokens}));
  specs.push(wrapRoundTrip('flash_sp12_deposit_withdraw_rewrap_repay', 1_000_000n, reserve, pool));
  specs.push(wrapRoundTrip('flash_sp12_two_deposit_withdraw_legs', 2_000_000n, reserve, pool,
    {middle: [cloneIx(deposit), cloneIx(withdraw), cloneIx(deposit), cloneIx(withdraw)]}));
  specs.push(wrapRoundTrip('flash_sp12_update_between_deposit_withdraw', 1_000_000n, reserve, pool,
    {middle: [cloneIx(deposit), cloneIx(update), cloneIx(withdraw)]}));
  specs.push(wrapRoundTrip('flash_sp12_update_before_and_after_leg', 1_000_000n, reserve, pool,
    {middle: [cloneIx(update), cloneIx(deposit), cloneIx(withdraw), cloneIx(update)]}));
  specs.push(wrapRoundTrip('sp12_leg_before_flash_pair', 1_000_000n, reserve, pool,
    {middle: [cloneIx(deposit), cloneIx(withdraw)]}));
  // Reorder the prior case so the stake-pool leg executes before the flash borrow.
  const before = specs.at(-1);
  before.instructions = [before.instructions[0], before.instructions[3], before.instructions[4],
    before.instructions[5], before.instructions[1], before.instructions[2],
    ...before.instructions.slice(6, -1),
    flashIx('repay', reserve, OWNER, wsolAta, 1_000_000n, 4)];
  specs.push(wrapRoundTrip('flash_sp12_withdraw_before_deposit', 1_000_000n, reserve, pool,
    {middle: [cloneIx(withdraw), cloneIx(deposit)]}));
  specs.push(wrapRoundTrip('flash_sp12_destination_alias_manager_fee', 1_000_000n, reserve, pool,
    {depositDestination: pk(state.managerFeeAccount), referral: pk(state.managerFeeAccount),
      withdrawSource: pk(state.managerFeeAccount)}));
  specs.push(wrapRoundTrip('near_liquidity_flash_sp12_leg', available - 1n, reserve, pool));

  const preAccounts = await conn.getMultipleAccountsInfo(baseWatched, 'confirmed');
  const pre = Object.fromEntries(baseWatched.map((address, i) =>
    [address.toBase58(), accountView(address, preAccounts[i])]));
  const {blockhash} = await conn.getLatestBlockhash('confirmed');
  const results = [];
  for (const spec of specs) {
    try {
      const result = await simulate(spec, blockhash);
      results.push(result);
      console.log(JSON.stringify({label: result.label, err: result.err, v1Bytes: result.v1Bytes,
        accountCount: result.accountCount, instructionCount: result.instructionCount,
        unitsConsumed: result.unitsConsumed,
        logTail: result.logs?.filter(line => line.includes('Instruction:') || line.includes('failed') ||
          line.includes('Error') || line.includes('success')).slice(-12)}));
    } catch (error) {
      results.push({label: spec.label, localError: error.stack || error.message});
      console.log(JSON.stringify({label: spec.label, localError: error.message}));
    }
  }
  const output = {generatedAt: new Date().toISOString(), transport:
    'read-only mainnet getAccountInfo + simulateTransaction; sigVerify false; no sendTransaction',
  transactionFormat: {version: 1, maxBytes: 4096, maxAccounts: 64},
  klend: {program: KLEND.toBase58(), reserve: KLEND_RESERVE.toBase58(),
    lendingMarket: pk(reserve.lending_market).toBase58(), mint: pk(reserve.liquidity.mint_pubkey).toBase58(),
    supplyVault: pk(reserve.liquidity.supply_vault).toBase58(),
    feeVault: pk(reserve.liquidity.fee_vault).toBase58(), flashLoanFeeSf: flashFeeSf.toString(),
    configuredFeeRateIsExactlyZero: flashFeeSf === 0n, reserveAvailableRaw: available.toString(),
    supplyVaultRaw: supplyAmount?.toString() ?? null, feeVaultRaw: tokenAmount(feeInfo)?.toString() ?? null},
  sp12: {program: SP12.toBase58(), stakePool: STAKE_POOL.toBase58(),
    withdrawAuthority: withdrawAuthority.toBase58(), withdrawBump,
    reserveStake: state.reserveStake.toBase58(), poolMint: state.poolMint.toBase58(),
    managerFeeAccount: state.managerFeeAccount.toBase58(), userPoolAta: poolAta.toBase58(),
    totalLamports: totalLamports.toString(), poolTokenSupply: poolSupply.toString(),
    minimumNonzeroDepositLamports: minimumNonzeroDepositLamports.toString(),
    minimumDepositPoolTokens: minimumDepositPoolTokens.toString(),
    minimumRoundTripDepositLamports: minimumRoundTripDepositLamports.toString(),
    minimumRoundTripPoolTokens: minimumRoundTripPoolTokens.toString(),
    depositLamports: DEPOSIT_LAMPORTS.toString(), expectedMintedPoolTokens: depositPoolTokens.toString(),
    configuredSolDepositFee: {numerator: state.solDepositFee.numerator.toString(),
      denominator: state.solDepositFee.denominator.toString()},
    configuredSolWithdrawalFee: {numerator: state.solWithdrawalFee.numerator.toString(),
      denominator: state.solWithdrawalFee.denominator.toString()},
    computedWithdrawalFeePoolTokens: withdrawalFee.toString(),
    expectedWithdrawLamports: expectedWithdrawLamports.toString()},
  user: {owner: OWNER.toBase58(), wsolAta: wsolAta.toBase58()}, pre, results};
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  const compact = {generatedAt: output.generatedAt, transport: output.transport,
    transactionFormat: output.transactionFormat, klend: output.klend, sp12: output.sp12, user: output.user,
    results: results.map(row => ({label: row.label, slot: row.slot ?? null, err: row.err ?? null,
      localError: row.localError?.split('\n')[0] || null, v1Bytes: row.v1Bytes ?? null,
      accountCount: row.accountCount ?? null, instructionCount: row.instructionCount ?? null,
      unitsConsumed: row.unitsConsumed ?? null,
      post: row.err === null ? {
        klendSupplyRaw: row.watched[output.klend.supplyVault]?.tokenAmount ?? null,
        klendFeeVaultRaw: row.watched[output.klend.feeVault]?.tokenAmount ?? null,
        userWsolRaw: row.watched[output.user.wsolAta]?.tokenAmount ?? null,
        userPoolTokenRaw: row.watched[output.sp12.userPoolAta]?.tokenAmount ?? null,
        sp12ReserveLamports: row.watched[output.sp12.reserveStake]?.lamports ?? null,
        poolMintSupply: row.watched[output.sp12.poolMint]?.mintSupply ?? null,
      } : null,
      instructionLogs: row.logs?.filter(line => line.includes('Instruction:') || line.includes('failed') ||
        line.includes('Not enough pool tokens') || line.includes('owner does not match') ||
        line.includes('insufficient funds')) || [],
    })),
    pre: {klendSupplyRaw: pre[output.klend.supplyVault]?.tokenAmount ?? null,
      klendFeeVaultRaw: pre[output.klend.feeVault]?.tokenAmount ?? null,
      userWsol: pre[output.user.wsolAta], userPoolToken: pre[output.sp12.userPoolAta],
      sp12ReserveLamports: pre[output.sp12.reserveStake]?.lamports ?? null,
      poolMintSupply: pre[output.sp12.poolMint]?.mintSupply ?? null}};
  fs.writeFileSync(SUMMARY_OUTPUT, `${JSON.stringify(compact, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, summaryOutput: SUMMARY_OUTPUT,
    successful: results.filter(row => row.err === null).map(row => row.label),
    failed: results.filter(row => row.err || row.localError).map(row => ({label: row.label,
      err: row.err || row.localError?.split('\n')[0]}))}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
