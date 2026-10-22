#!/usr/bin/env node
'use strict';

// Read-only, current-mainnet exact-mint inventory for independently evidenced
// flash-liquidity primitives. This script never builds, signs, simulates, or
// submits a transaction, and never prints the configured RPC endpoint.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MODULES}/@solana/web3.js`);
const anchor = require(`${MODULES}/@coral-xyz/anchor`);
const legacyAnchor = require(`${MODULES}/@project-serum/anchor`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const SOURCE_DIR = path.resolve(DIR, '../2026-10-15');
const OUT = path.join(DIR, 'hylo-exchange-current-jitosol-provider-inventory.json');
const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const U64_MAX = (1n << 64n) - 1n;
const I80_PRODUCT_SCALE = 1n << 96n;

const PROGRAMS = {
  save: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  klend: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  project0: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  mango: '4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg',
  jupiterMainLiquidity: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
  jupiterMainFlash: 'jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS',
  jupiterIsolatedLiquidity: 'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS',
  jupiterIsolatedFlash: 'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF',
};

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.replace(/^export\s+/, '').split(/=(.*)/s).slice(0, 2))
    .map(([key, value]) => [key, value.replace(/^(['"])(.*)\1$/, '$2')]));
}

const env = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
const RPC_URL = env.RPC || env.SOLANA_RPC || env.SOLANA_RPC_URL || env.FLUX_RPC_A || env.FLUX_RPC_B;
if (!RPC_URL) throw new Error('No configured RPC endpoint');

const marginfiIdl = JSON.parse(fs.readFileSync(
  path.join(SOURCE_DIR, 'marginfi-source/fuzz/crucible/idls/marginfi_program.json')));
const jupiterIdl = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'jup6qf-onchain-idl.json')));
const jupiterFlashIdl = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'jup6qf-onchain-flash-idl.json')));
const mangoIdl = JSON.parse(fs.readFileSync(
  path.join(SOURCE_DIR, 'chnry-usdg-daybreak-provider-mango-official-idl.json')));
const marginfiCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const jupiterCoder = new anchor.BorshAccountsCoder(jupiterIdl);
const jupiterFlashCoder = new anchor.BorshAccountsCoder(jupiterFlashIdl);
const mangoCoder = new legacyAnchor.BorshAccountsCoder(mangoIdl);

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function data(account) { return account ? Buffer.from(account.data[0], 'base64') : null; }
function pubkey(bytes) { return new PublicKey(bytes).toBase58(); }
function discriminator(name) {
  return bs58.encode(crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8));
}
function fixedRaw(value) {
  const bytes = Buffer.from(value.value);
  let result = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) result -= 1n << 128n;
  return result;
}
function enumName(value) {
  return value && typeof value === 'object' ? Object.keys(value)[0] : String(value);
}
function tokenImage(account) {
  const bytes = data(account);
  if (!account || account.owner !== TOKEN || !bytes || bytes.length < 72) return null;
  return {mint: pubkey(bytes.subarray(0, 32)), authority: pubkey(bytes.subarray(32, 64)),
    amountRaw: bytes.readBigUInt64LE(64).toString()};
}
async function gpa(program, filters, dataSlice) {
  return rpc('getProgramAccounts', [program, {encoding: 'base64', commitment: 'finalized',
    withContext: true, filters, ...(dataSlice ? {dataSlice} : {})}]);
}
async function multiple(addresses) {
  if (!addresses.length) return {context: {slot: null}, value: []};
  return rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'finalized'}]);
}

async function scanSave() {
  const result = await gpa(PROGRAMS.save, [{dataSize: 619}, {memcmp: {offset: 42, bytes: MINT}}]);
  const rows = result.value.map((row) => {
    const bytes = data(row.account);
    return {address: row.pubkey, market: pubkey(bytes.subarray(10, 42)),
      supplyVault: pubkey(bytes.subarray(75, 107)), availableRaw: bytes.readBigUInt64LE(171),
      feeWad: bytes.readBigUInt64LE(314), feeReceiver: pubkey(bytes.subarray(339, 371)),
      stale: bytes[9] !== 0};
  });
  const vaults = await multiple(rows.map((row) => row.supplyVault));
  return {slot: result.context.slot, reserveCount: rows.length, matches: rows.map((row, index) => {
    const vault = tokenImage(vaults.value[index]);
    const ready = !row.stale && row.feeWad !== U64_MAX && vault?.mint === MINT;
    const vaultAmount = BigInt(vault?.amountRaw || 0);
    const capacity = row.availableRaw < vaultAmount ? row.availableRaw : vaultAmount;
    return {reserve: row.address, market: row.market, supplyVault: row.supplyVault,
      feeReceiver: row.feeReceiver,
      availableRaw: row.availableRaw.toString(), vaultAmountRaw: vault?.amountRaw || null,
      flashLoanFeeWad: row.feeWad.toString(), stale: row.stale,
      stateDerivedBorrowableUpperBoundRaw: ready ? capacity.toString() : '0'};
  })};
}

async function scanKlend() {
  const result = await gpa(PROGRAMS.klend, [{dataSize: 8624},
    {memcmp: {offset: 0, bytes: discriminator('Reserve')}}, {memcmp: {offset: 128, bytes: MINT}}]);
  const rows = result.value.map((row) => {
    const bytes = data(row.account);
    return {address: row.pubkey, market: pubkey(bytes.subarray(32, 64)),
      supplyVault: pubkey(bytes.subarray(160, 192)), feeVault: pubkey(bytes.subarray(192, 224)),
      availableRaw: bytes.readBigUInt64LE(224), status: bytes[4856], emergencyMode: bytes[4864],
      feeSf: bytes.readBigUInt64LE(4904)};
  });
  const vaults = await multiple(rows.map((row) => row.supplyVault));
  return {slot: result.context.slot, reserveCount: rows.length, matches: rows.map((row, index) => {
    const vault = tokenImage(vaults.value[index]);
    const ready = row.status === 0 && row.emergencyMode === 0 && row.feeSf !== U64_MAX && vault?.mint === MINT;
    const vaultAmount = BigInt(vault?.amountRaw || 0);
    const capacity = row.availableRaw < vaultAmount ? row.availableRaw : vaultAmount;
    return {reserve: row.address, market: row.market, supplyVault: row.supplyVault,
      feeVault: row.feeVault, availableRaw: row.availableRaw.toString(),
      vaultAmountRaw: vault?.amountRaw || null, flashLoanFeeSf: row.feeSf.toString(),
      status: row.status, emergencyMode: row.emergencyMode,
      stateDerivedBorrowableUpperBoundRaw: ready ? capacity.toString() : '0'};
  })};
}

async function scanProject0() {
  const result = await gpa(PROGRAMS.project0, [{dataSize: 3912},
    {memcmp: {offset: 0, bytes: discriminator('Bank')}}, {memcmp: {offset: 8, bytes: MINT}}]);
  const decoded = result.value.map((row) => ({address: row.pubkey,
    bank: marginfiCoder.decode('Bank', data(row.account))}));
  const vaults = await multiple(decoded.map((row) => row.bank.liquidity_vault.toBase58()));
  return {slot: result.context.slot, bankCount: decoded.length, matches: decoded.map((row, index) => {
    const bank = row.bank;
    const vault = tokenImage(vaults.value[index]);
    const physical = BigInt(vault?.amountRaw || 0);
    const assets = fixedRaw(bank.total_asset_shares) * fixedRaw(bank.asset_share_value) / I80_PRODUCT_SCALE;
    const liabilities = fixedRaw(bank.total_liability_shares) * fixedRaw(bank.liability_share_value) / I80_PRODUCT_SCALE;
    const accounting = assets > liabilities ? assets - liabilities : 0n;
    const borrowLimit = BigInt(bank.config.borrow_limit.toString());
    const limit = borrowLimit === U64_MAX ? physical :
      (borrowLimit > liabilities + 1n ? borrowLimit - liabilities - 1n : 0n);
    const capacity = [physical, accounting, limit].reduce((a, b) => a < b ? a : b);
    const operationalState = enumName(bank.config.operational_state);
    const ready = operationalState === 'Operational' && bank.cb_tier === 0 && vault?.mint === MINT;
    return {bank: row.address, group: bank.group.toBase58(),
      liquidityVault: bank.liquidity_vault.toBase58(), vaultAmountRaw: vault?.amountRaw || null,
      operationalState, cbTier: bank.cb_tier, borrowLimitRaw: borrowLimit.toString(),
      stateDerivedBorrowableUpperBoundRaw: ready ? capacity.toString() : '0'};
  })};
}

async function scanJupiterDeployment(label, liquidityProgram, flashProgram) {
  const reserves = await gpa(liquidityProgram, [{dataSize: 192},
    {memcmp: {offset: 0, bytes: discriminator('TokenReserve')}}, {memcmp: {offset: 8, bytes: MINT}}]);
  const positions = await gpa(liquidityProgram, [{dataSize: 120},
    {memcmp: {offset: 0, bytes: discriminator('UserBorrowPosition')}}, {memcmp: {offset: 40, bytes: MINT}}]);
  const [adminAddress] = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')], new PublicKey(flashProgram));
  const adminRead = await multiple([adminAddress.toBase58()]);
  let admin = null;
  try { admin = jupiterFlashCoder.decode('FlashloanAdmin', data(adminRead.value[0])); } catch {}
  const decodedReserves = reserves.value.map((row) => ({address: row.pubkey,
    state: jupiterCoder.decode('TokenReserve', data(row.account))}));
  const decodedPositions = positions.value.map((row) => ({address: row.pubkey,
    state: jupiterCoder.decode('UserBorrowPosition', data(row.account))}));
  const bound = decodedPositions.filter((row) => row.state.protocol.equals(adminAddress));
  const vaultReads = await multiple(decodedReserves.map((row) => row.state.vault.toBase58()));
  const matches = decodedReserves.map((row, index) => {
    const position = bound.find((candidate) => candidate.state.mint.toBase58() === MINT);
    const vault = tokenImage(vaultReads.value[index]);
    const positionHeadroom = position
      ? BigInt(position.state.max_debt_ceiling.toString()) - BigInt(position.state.amount.toString())
      : 0n;
    const physical = BigInt(vault?.amountRaw || 0);
    const ready = !!admin?.status && !admin?.is_flashloan_active && position
      && Number(position.state.status) === 0 && vault?.mint === MINT;
    const capacity = physical < positionHeadroom ? physical : positionHeadroom;
    return {reserve: row.address, vault: row.state.vault.toBase58(),
      vaultAmountRaw: vault?.amountRaw || null, borrowPosition: position?.address || null,
      positionAmountRaw: position?.state.amount.toString() || null,
      positionMaxDebtCeilingRaw: position?.state.max_debt_ceiling.toString() || null,
      stateDerivedBorrowableUpperBoundRaw: ready ? capacity.toString() : '0'};
  });
  return {label, reserveSlot: reserves.context.slot, positionSlot: positions.context.slot,
    flashAdmin: adminAddress.toBase58(), adminState: admin ? {status: !!admin.status,
      feeBps: Number(admin.flashloan_fee), isFlashloanActive: !!admin.is_flashloan_active,
      liquidityProgram: admin.liquidity_program.toBase58()} : null,
    reserveCount: decodedReserves.length, boundPositionCount: bound.length, matches,
    reserves: decodedReserves.map((row) => ({address: row.address, vault: row.state.vault.toBase58()})),
    boundPositions: bound.map((row) => ({address: row.address,
      amountRaw: row.state.amount.toString(), maxDebtCeilingRaw: row.state.max_debt_ceiling.toString(),
      status: Number(row.state.status)}))};
}

async function scanMango() {
  const result = await gpa(PROGRAMS.mango, [{memcmp: {offset: 0, bytes: discriminator('Bank')}},
    {memcmp: {offset: 56, bytes: MINT}}]);
  const decoded = result.value.map((row) => ({address: row.pubkey,
    bank: mangoCoder.decode('Bank', data(row.account))}));
  const vaults = await multiple(decoded.map((row) => row.bank.vault.toBase58()));
  return {slot: result.context.slot, bankCount: result.value.length,
    banks: decoded.map((row, index) => {
      const vault = tokenImage(vaults.value[index]);
      return {address: row.address, group: row.bank.group.toBase58(),
        vault: row.bank.vault.toBase58(), vaultAmountRaw: vault?.amountRaw || null,
        reduceOnly: row.bank.reduceOnly, forceWithdraw: row.bank.forceWithdraw,
        flashLoanTokenAccountInitialRaw: row.bank.flashLoanTokenAccountInitial.toString(),
        flashLoanApprovedAmountRaw: row.bank.flashLoanApprovedAmount.toString(),
        flashLoanSwapFeeRate: row.bank.flashLoanSwapFeeRate,
        minVaultToDepositsRatio: row.bank.minVaultToDepositsRatio};
    })};
}

(async () => {
  const genesisHash = await rpc('getGenesisHash', []);
  if (genesisHash !== MAINNET_GENESIS) throw new Error('Configured RPC is not Solana mainnet-beta');
  const observationSlot = await rpc('getSlot', [{commitment: 'finalized'}]);
  const [save, klend, project0, jupiterMain, jupiterIsolated, mango] = await Promise.all([
    scanSave(), scanKlend(), scanProject0(),
    scanJupiterDeployment('main', PROGRAMS.jupiterMainLiquidity, PROGRAMS.jupiterMainFlash),
    scanJupiterDeployment('isolated', PROGRAMS.jupiterIsolatedLiquidity, PROGRAMS.jupiterIsolatedFlash),
    scanMango(),
  ]);
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    noTransactionsBuiltSignedSimulatedOrSubmitted: true, genesisHash, observationSlot,
    mint: MINT, providers: {save, klend, project0, jupiterMain, jupiterIsolated, mango}};
  const stateDerivedBorrowableProviders = [
      ...(save.matches.some((row) => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n) ? ['Save'] : []),
      ...(klend.matches.some((row) => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n) ? ['KLend'] : []),
      ...(project0.matches.some((row) => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n) ? ['Project0'] : []),
      ...(jupiterMain.matches.some((row) => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
        ? ['JupiterMain'] : []),
      ...(jupiterIsolated.matches.some((row) => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
        ? ['JupiterIsolated'] : []),
    ];
  output.conclusion = {
    exactMintStatePresentProviders: [
      ...(save.reserveCount ? ['Save'] : []), ...(klend.reserveCount ? ['KLend'] : []),
      ...(project0.bankCount ? ['Project0'] : []), ...(jupiterMain.reserveCount ? ['JupiterMain'] : []),
      ...(jupiterIsolated.reserveCount ? ['JupiterIsolated'] : []), ...(mango.bankCount ? ['MangoV4'] : []),
    ],
    stateDerivedBorrowableProviders,
    signedRuntimeValidatedProviders: ['Save', 'KLend', 'Project0'],
    runtimeUntestedRoutes: [
      ...(stateDerivedBorrowableProviders.includes('JupiterMain') ? ['JupiterMain'] : []),
      ...(mango.bankCount ? ['MangoV4'] : []),
    ],
    note: 'Exact-mint account presence is not treated as runtime validation. Save, KLend, and Project0 have signed runtime receipts; Jupiter Main and Mango remain explicitly untested here.'
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, observationSlot,
    providerCounts: {save: save.reserveCount, klend: klend.reserveCount,
      project0: project0.bankCount, jupiterMain: [jupiterMain.reserveCount, jupiterMain.boundPositionCount],
      jupiterIsolated: [jupiterIsolated.reserveCount, jupiterIsolated.boundPositionCount],
      mango: mango.bankCount}, stateDerivedBorrowableProviders,
      signedRuntimeValidatedProviders: output.conclusion.signedRuntimeValidatedProviders})}\n`);
})().catch((error) => {
  const redacted = String(error.stack || error.message || error).replaceAll(RPC_URL, '<redacted-rpc>');
  process.stderr.write(`${redacted}\n`);
  process.exitCode = 1;
});
