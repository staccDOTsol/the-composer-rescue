#!/usr/bin/env node
'use strict';

// Read-only current-mainnet v1 simulations of the deployed Ethena Jupiter
// flashloan wrapper and jup6QF liquidity deployment. Never signs or submits.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey, TransactionInstruction} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const OUT = `${DIR}/jup6qf-native-flash-v1-simulations.json`;
const P = (value) => new PublicKey(value);
const TARGET = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = P('11111111111111111111111111111111');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const [FLASH_ADMIN, FLASH_ADMIN_BUMP] = PublicKey.findProgramAddressSync(
  [Buffer.from('flashloan_admin')], FLASH);
const BORROW_DISC = Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]);
const REPAY_DISC = Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]);
const REFRESH_DISC = Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]);

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL unavailable');
const inventory = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-current-inventory.json`));
const klendPrior = JSON.parse(fs.readFileSync(`${DIR}/klend-zero-fee-simulations.json`));
const liquidityIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-idl.json`));
const flashIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-flash-idl.json`));
liquidityIdl.address = TARGET.toBase58();
flashIdl.address = FLASH.toBase58();
const liquidityCoder = new anchor.BorshAccountsCoder(liquidityIdl);
const flashCoder = new anchor.BorshAccountsCoder(flashIdl);
let rpcId = 0;

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}

function json(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && value.constructor?.name === 'BN') return value.toString(10);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  return value;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function flashIx(discriminator, targetRow, position, user, amount, mutations = {}) {
  const keys = [
    {pubkey: P(user.owner), isSigner: true, isWritable: true},
    {pubkey: FLASH_ADMIN, isSigner: false, isWritable: true},
    {pubkey: P(user.address), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.mint), isSigner: false, isWritable: false},
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(position.address), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.rateModel), isSigner: false, isWritable: false},
    {pubkey: P(targetRow.vault), isSigner: false, isWritable: true},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: TARGET, isSigner: false, isWritable: false},
    {pubkey: P(user.tokenProgram), isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN, isSigner: false, isWritable: false},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
  ];
  for (const [index, address] of Object.entries(mutations)) keys[Number(index)].pubkey = P(address);
  return new TransactionInstruction({programId: FLASH, keys,
    data: Buffer.concat([discriminator, u64(amount)])});
}

function refreshIx(targetRow) {
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.rateModel), isSigner: false, isWritable: false},
  ], data: Buffer.concat([REFRESH_DISC, P(targetRow.mint).toBuffer()])});
}

function tokenAmount(account) {
  if (!account || ![TOKEN.toBase58(), TOKEN_2022.toBase58()].includes(account.owner)) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function hashAccount(account) {
  if (!account?.data) return null;
  return crypto.createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex');
}

function decode(account, coder, name) {
  if (!account?.data) return null;
  try { return json(coder.decode(name, Buffer.from(account.data[0], 'base64'))); }
  catch (error) { return {decodeError: error.message, sha256: hashAccount(account)}; }
}

function targetReserveImage(account) {
  const decoded = decode(account, liquidityCoder, 'TokenReserve');
  if (!decoded || decoded.decodeError) return decoded;
  return {
    mint: decoded.mint,
    totalSupplyWithInterestRaw: decoded.total_supply_with_interest,
    totalSupplyInterestFreeRaw: decoded.total_supply_interest_free,
    totalBorrowWithInterestRaw: decoded.total_borrow_with_interest,
    totalBorrowInterestFreeRaw: decoded.total_borrow_interest_free,
    totalClaimRaw: decoded.total_claim_amount,
    supplyExchangePrice: decoded.supply_exchange_price,
    borrowExchangePrice: decoded.borrow_exchange_price,
    borrowRate: decoded.borrow_rate,
    lastUtilization: decoded.last_utilization,
    maxUtilization: decoded.max_utilization,
    lastUpdateTimestamp: decoded.last_update_timestamp,
    interactingProtocol: decoded.interacting_protocol,
    interactingTimestamp: decoded.interacting_timestamp,
    interactingBalance: decoded.interacting_balance,
  };
}

function borrowPositionImage(account) {
  const decoded = decode(account, liquidityCoder, 'UserBorrowPosition');
  if (!decoded || decoded.decodeError) return decoded;
  return {protocol: decoded.protocol, mint: decoded.mint, withInterest: decoded.with_interest,
    amountRaw: decoded.amount, debtCeilingRaw: decoded.debt_ceiling,
    baseDebtCeilingRaw: decoded.base_debt_ceiling, maxDebtCeilingRaw: decoded.max_debt_ceiling,
    lastUpdate: decoded.last_update, status: decoded.status};
}

function flashAdminImage(account) {
  const decoded = decode(account, flashCoder, 'FlashloanAdmin');
  if (!decoded || decoded.decodeError) return decoded;
  return {authority: decoded.authority, liquidityProgram: decoded.liquidity_program,
    status: decoded.status, flashloanFeeBps: decoded.flashloan_fee,
    flashloanTimestamp: decoded.flashloan_timestamp, isFlashloanActive: decoded.is_flashloan_active,
    activeFlashloanAmountRaw: decoded.active_flashloan_amount, bump: decoded.bump};
}

function delta(after, before) {
  if (after === null || before === null || after === undefined || before === undefined) return null;
  return (BigInt(after) - BigInt(before)).toString();
}

async function getPre(watched) {
  const result = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'confirmed'}]);
  return {slot: result.context.slot, accounts: result.value,
    tokenAmounts: result.value.map(tokenAmount), hashes: result.value.map(hashAccount),
    targetReserve: targetReserveImage(result.value[2]),
    borrowPosition: borrowPositionImage(result.value[3]),
    flashAdmin: flashAdminImage(result.value[4])};
}

async function simulate(label, instructions, payer, blockhash, watched, pre, metadata = {}) {
  const encoded = encodeV1(instructions, P(payer), blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses: watched},
  }]);
  const value = result.value;
  const accounts = value.accounts || [];
  const tokenAfter = accounts.map(tokenAmount);
  return {label, ...metadata, slot: result.context.slot, err: value.err,
    v1Bytes: encoded.sizeBytes, legacyV0EquivalentBytes: encoded.v0Bytes,
    accountCount: encoded.addressCount, writableCount: encoded.writableCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    v1Limits: {maxBytes: 4096, maxInlineAddresses: 64, maxInstructions: 64},
    unitsConsumed: value.unitsConsumed, loadedAccountsDataSize: value.loadedAccountsDataSize,
    watched, accounting: {preSlot: pre.slot,
      tokenAmountsBeforeRaw: pre.tokenAmounts, tokenAmountsAfterRaw: tokenAfter,
      tokenDeltasRaw: tokenAfter.map((amount, i) => delta(amount, pre.tokenAmounts[i])),
      targetReserveBefore: pre.targetReserve, targetReserveAfter: targetReserveImage(accounts[2]),
      targetReserveHashBefore: pre.hashes[2], targetReserveHashAfter: hashAccount(accounts[2]),
      borrowPositionBefore: pre.borrowPosition, borrowPositionAfter: borrowPositionImage(accounts[3]),
      borrowPositionHashBefore: pre.hashes[3], borrowPositionHashAfter: hashAccount(accounts[3]),
      flashAdminBefore: pre.flashAdmin, flashAdminAfter: flashAdminImage(accounts[4]),
      flashAdminHashBefore: pre.hashes[4], flashAdminHashAfter: hashAccount(accounts[4])},
    logs: value.logs?.filter((line) => line.includes('Instruction:') ||
      line.includes(TARGET.toBase58()) || line.includes(FLASH.toBase58()) ||
      line.includes('Error') || line.includes('failed') || line.includes('success')).slice(-60),
  };
}

function accountingAvailable(targetRow) {
  const state = targetRow.reserveState;
  const supply = BigInt(state.total_supply_with_interest) * BigInt(state.supply_exchange_price) /
    1000000000000n + BigInt(state.total_supply_interest_free);
  const borrow = BigInt(state.total_borrow_with_interest) * BigInt(state.borrow_exchange_price) /
    1000000000000n + BigInt(state.total_borrow_interest_free);
  return supply - borrow - BigInt(state.total_claim_amount);
}

async function main() {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const flashAccountResult = await rpc('getAccountInfo', [FLASH_ADMIN.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const flashAdmin = flashAdminImage(flashAccountResult.value);
  const flashBinding = inventory.protocolBindings.find((item) =>
    item.protocol === FLASH_ADMIN.toBase58());
  if (!flashBinding) throw new Error('Current native flash binding unavailable');
  const priorBySymbol = new Map(klendPrior.results.map((item) => [item.symbol, item]));
  const targetBySymbol = new Map(inventory.reserves.map((item) => [item.symbol, item]));
  const symbols = ['USDe', 'PYUSD', 'USDG'];
  const setups = [];
  const results = [];

  for (const symbol of symbols) {
    const targetRow = targetBySymbol.get(symbol);
    const userPrior = priorBySymbol.get(symbol);
    const user = {owner: userPrior.userOwner, address: userPrior.userToken,
      tokenProgram: userPrior.tokenProgram};
    const position = flashBinding.borrowPositions.find((item) => item.mint === targetRow.mint);
    const watched = [user.address, targetRow.vault, targetRow.reserve, position.address,
      FLASH_ADMIN.toBase58(), targetRow.rateModel];
    const pre = await getPre(watched);
    const vaultBalance = BigInt(pre.tokenAmounts[1]);
    const available = accountingAvailable(targetRow);
    const ceiling = BigInt(position.state.max_debt_ceiling);
    const oneUnit = 10n ** BigInt(symbol === 'USDe' ? 9 : 6);
    const largeBound = [available, vaultBalance, ceiling].reduce((a, b) => a < b ? a : b);
    setups.push({symbol, mint: targetRow.mint, tokenProgram: user.tokenProgram,
      borrower: user.owner, borrowerTokenAccount: user.address,
      flashAdmin: FLASH_ADMIN.toBase58(), flashAdminBump: FLASH_ADMIN_BUMP,
      targetReserve: targetRow.reserve, targetVault: targetRow.vault,
      targetRateModel: targetRow.rateModel, targetBorrowPosition: position.address,
      targetVaultBalanceRaw: vaultBalance.toString(), targetAccountingAvailableRaw: available.toString(),
      positionMaxDebtCeilingRaw: ceiling.toString(), testedLargeBoundRaw: largeBound.toString(), watched});

    const borrow = (amount, mutations) => flashIx(BORROW_DISC, targetRow, position, user, amount, mutations);
    const repay = (amount, mutations) => flashIx(REPAY_DISC, targetRow, position, user, amount, mutations);
    const pair = (amount, middle = [], mutations = {}) => [
      borrow(amount, mutations.borrow), ...middle, repay(mutations.repayAmount ?? amount,
        mutations.repay),
    ];
    const positiveOrBoundary = [
      [`${symbol}_below_minimum_999`, pair(999n, [refreshIx(targetRow)]), 999n,
        'minimum-boundary-negative'],
      [`${symbol}_minimum_1000_refresh_repay`, pair(1000n, [refreshIx(targetRow)]), 1000n,
        'funded-positive-control'],
      [`${symbol}_minimum_plus_one_1001`, pair(1001n, [refreshIx(targetRow)]), 1001n,
        'funded-positive-control'],
      [`${symbol}_one_unit_refresh_repay`, pair(oneUnit, [refreshIx(targetRow)]), oneUnit,
        'funded-positive-control'],
      [`${symbol}_ninety_nine_percent_bound`, pair(largeBound * 99n / 100n,
        [refreshIx(targetRow)]), largeBound * 99n / 100n, 'large-boundary-control'],
      [`${symbol}_exact_bound`, pair(largeBound, [refreshIx(targetRow)]), largeBound,
        'extreme-boundary-control'],
      [`${symbol}_bound_plus_one`, pair(largeBound + 1n, [refreshIx(targetRow)]),
        largeBound + 1n, 'extreme-boundary-control'],
      [`${symbol}_repeated_refresh_legs`, pair(oneUnit,
        [refreshIx(targetRow), refreshIx(targetRow), refreshIx(targetRow)]), oneUnit,
        'repetition-control'],
      [`${symbol}_refresh_before_borrow`, [refreshIx(targetRow), borrow(oneUnit), repay(oneUnit)],
        oneUnit, 'ordering-control'],
      [`${symbol}_refresh_after_repay`, [borrow(oneUnit), repay(oneUnit), refreshIx(targetRow)],
        oneUnit, 'ordering-control'],
      [`${symbol}_two_flash_cycles`, [borrow(oneUnit), refreshIx(targetRow), repay(oneUnit),
        borrow(oneUnit), refreshIx(targetRow), repay(oneUnit)], oneUnit, 'repetition-control'],
    ];
    for (const [label, instructions, amount, klass] of positiveOrBoundary) {
      results.push(await simulate(label, instructions, user.owner, blockhash, watched, pre,
        {symbol, mint: targetRow.mint, amountRaw: amount.toString(),
          configuredFeeBps: flashAdmin.flashloanFeeBps, expectedFeeRaw: '0', class: klass}));
    }

    // The persisted exchange prices can be older than the bank timestamp. For
    // USDG, recompute the current accounting boundary from a successful
    // simulation's refreshed prices and test it plus a full token. The latter
    // is deliberately large enough to dominate sub-second interest drift.
    if (symbol === 'USDG') {
      const refreshed = results.find((item) => item.label === 'USDG_minimum_1000_refresh_repay')
        ?.accounting?.targetReserveAfter;
      if (refreshed) {
        const currentSupply = BigInt(refreshed.totalSupplyWithInterestRaw) *
          BigInt(refreshed.supplyExchangePrice) / 1000000000000n +
          BigInt(refreshed.totalSupplyInterestFreeRaw);
        const currentBorrow = BigInt(refreshed.totalBorrowWithInterestRaw) *
          BigInt(refreshed.borrowExchangePrice) / 1000000000000n +
          BigInt(refreshed.totalBorrowInterestFreeRaw);
        const currentBoundary = currentSupply - currentBorrow - BigInt(refreshed.totalClaimRaw);
        const precision = 1000000000000n;
        const scaledSupply = BigInt(refreshed.totalSupplyWithInterestRaw) *
          BigInt(refreshed.supplyExchangePrice) +
          BigInt(refreshed.totalSupplyInterestFreeRaw) * precision;
        const scaledBorrow = BigInt(refreshed.totalBorrowWithInterestRaw) *
          BigInt(refreshed.borrowExchangePrice) +
          BigInt(refreshed.totalBorrowInterestFreeRaw) * precision;
        // calc_utilization floors scaledBorrow*10000/scaledSupply. With a
        // 10000 max, the last passing amount is immediately below 10001.
        const maxUtilizationBound = (((scaledSupply * 10001n) - 1n) / 10000n -
          scaledBorrow) / precision;
        for (const [suffix, amount] of [
          ['refreshed_accounting_bound', currentBoundary],
          ['refreshed_accounting_bound_plus_one_token', currentBoundary + oneUnit],
          ['estimated_max_utilization_bound_minus_one_token', maxUtilizationBound - oneUnit],
          ['estimated_max_utilization_bound', maxUtilizationBound],
          ['estimated_max_utilization_bound_plus_one', maxUtilizationBound + 1n],
        ]) {
          results.push(await simulate(`USDG_${suffix}`, pair(amount, [refreshIx(targetRow)]),
            user.owner, blockhash, watched, pre, {symbol, mint: targetRow.mint,
              amountRaw: amount.toString(), configuredFeeBps: flashAdmin.flashloanFeeBps,
              expectedFeeRaw: '0', class: 'refreshed-extreme-boundary-control'}));
        }
      }
    }

    if (symbol === 'USDe') {
      const pyusd = targetBySymbol.get('PYUSD');
      const pyusdPosition = flashBinding.borrowPositions.find((item) => item.mint === pyusd.mint);
      const negativeCases = [
        ['missing_repay', [borrow(oneUnit), refreshIx(targetRow)]],
        ['repay_before_borrow', [repay(oneUnit), borrow(oneUnit)]],
        ['mismatched_repay_amount', pair(oneUnit, [refreshIx(targetRow)],
          {repayAmount: oneUnit + 1n})],
        ['duplicate_repay', [borrow(oneUnit), refreshIx(targetRow), repay(oneUnit), repay(oneUnit)]],
        ['wrong_vault', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {7: pyusd.vault}, repay: {7: pyusd.vault}})],
        ['wrong_rate_model', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {6: pyusd.rateModel}, repay: {6: pyusd.rateModel}})],
        ['wrong_borrow_position', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {5: pyusdPosition.address}, repay: {5: pyusdPosition.address}})],
        ['destination_alias_target_vault', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {2: targetRow.vault}, repay: {2: targetRow.vault}})],
        ['wrong_liquidity_program', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {9: SYSTEM.toBase58()}, repay: {9: SYSTEM.toBase58()}})],
        ['wrong_liquidity_pda', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {8: FLASH_ADMIN.toBase58()}, repay: {8: FLASH_ADMIN.toBase58()}})],
        ['wrong_token_program', pair(oneUnit, [refreshIx(targetRow)],
          {borrow: {10: TOKEN_2022.toBase58()}, repay: {10: TOKEN_2022.toBase58()}})],
        ['borrow_repay_account_mismatch', [borrow(oneUnit), refreshIx(targetRow),
          repay(oneUnit, {7: pyusd.vault})]],
      ];
      for (const [suffix, instructions] of negativeCases) {
        results.push(await simulate(`USDe_${suffix}`, instructions, user.owner, blockhash, watched,
          pre, {symbol, mint: targetRow.mint, amountRaw: oneUnit.toString(),
            configuredFeeBps: flashAdmin.flashloanFeeBps, expectedFeeRaw: '0',
            class: 'negative-control'}));
      }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({generatedAt: new Date().toISOString(), readOnly: true,
    noSubmission: true, sigVerify: false, targetProgram: TARGET.toBase58(),
    nativeFlashProgram: FLASH.toBase58(), flashAdmin: FLASH_ADMIN.toBase58(),
    flashAdminState: flashAdmin,
    exactZeroFeeMeaning: 'flashloanFeeBps is the current on-chain integer configuration and equals zero; fee calculations therefore return exact zero at every tested amount, rather than rounding a nonzero rate down.',
    repaymentAccounting: 'A successful payback CPI restores borrower and target-vault token balances, clears FlashloanAdmin active state and amount, and restores the bound target borrow-position amount. Target reserve exchange prices/timestamps may advance while raw supply, borrow, and claim totals remain coherent.',
    setups, results}, null, 2));
  console.log(JSON.stringify({output: OUT, cases: results.length,
    success: results.filter((item) => item.err === null).length,
    failures: results.filter((item) => item.err !== null).length,
    negativeUnexpectedSuccesses: results.filter((item) =>
      item.class === 'negative-control' && item.err === null).map((item) => item.label)}));
}

main().catch((error) => {console.error(error.stack || error.message); process.exitCode = 1;});
