#!/usr/bin/env node
'use strict';

// Read-only finalized-mainnet crosswalk of every live SVSP pool mint against
// independently evidenced flash-liquidity providers. This script never builds,
// signs, simulates, or submits a transaction and never prints an RPC endpoint.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = process.env.SVSP_CROSSWALK_OUT || `${DIR}/svsp-flash-provider-crosswalk.json`;
const TARGET_FILE = process.env.SVSP_TARGET_FILE || `${DIR}/svsp-live-finalized-evidence.json`;
const legacyEnvPath = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env']
  .find((candidate) => fs.existsSync(candidate));
const legacyEnv = legacyEnvPath ? Object.fromEntries(fs.readFileSync(legacyEnvPath, 'utf8').split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC
  || process.env.RPC_URL || process.env.RPC || legacyEnv.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL unavailable');

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
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const U64_MAX = (1n << 64n) - 1n;
const I80_SCALE = 1n << 48n;
const I80_PRODUCT_SCALE = 1n << 96n;
const KLEND_FEE_SCALE = 1n << 60n;
const WAD = 10n ** 18n;

const target = JSON.parse(fs.readFileSync(TARGET_FILE));
const pools = target.pools.map((pool) => ({
  pool: pool.pool,
  voteAccount: pool.voteAccount,
  canonicalStake: pool.stake.address,
  mint: pool.mint.address,
  mintSupplyRaw: pool.mintAccount.supplyRaw,
  decimals: pool.mintAccount.decimals,
  canonicalDelegatedStakeLamports: pool.stakeAccount.delegatedStakeLamports,
  mainAvailableDelegatedStakeLamports: (BigInt(pool.stakeAccount.delegatedStakeLamports) > 1000000000n
    ? BigInt(pool.stakeAccount.delegatedStakeLamports) - 1000000000n : 0n).toString(),
}));
const poolByMint = new Map(pools.map((pool) => [pool.mint, pool]));
const targetMints = new Set(poolByMint.keys());
const activePools = new Set(target.epochFieldMergePrerequisitePools.map((row) => row.pool));
let rpcId = 0;
const slots = [];

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw last;
}

function recordSlot(label, result) {
  if (result?.context?.slot !== undefined) slots.push({label, slot: result.context.slot});
  return result;
}

async function gpa(label, program, filters, dataSlice) {
  return recordSlot(label, await rpc('getProgramAccounts', [program, {encoding: 'base64',
    commitment: 'finalized', withContext: true, filters, ...(dataSlice ? {dataSlice} : {})}]));
}

async function multiple(label, addresses, dataSlice) {
  if (!addresses.length) return {slot: null, byAddress: new Map()};
  const byAddress = new Map();
  const seenSlots = [];
  for (let start = 0; start < addresses.length; start += 100) {
    const chunk = addresses.slice(start, start + 100);
    const result = recordSlot(`${label}:${start / 100}`, await rpc('getMultipleAccounts', [chunk,
      {encoding: 'base64', commitment: 'finalized', ...(dataSlice ? {dataSlice} : {})}]));
    seenSlots.push(result.context.slot);
    result.value.forEach((account, index) => byAddress.set(chunk[index], account));
  }
  return {slot: Math.min(...seenSlots), slots: seenSlots, byAddress};
}

function data(account) { return account ? Buffer.from(account.data[0], 'base64') : null; }
function pubkey(bytes) { return new PublicKey(bytes).toBase58(); }
function tokenImage(account) {
  const bytes = data(account);
  if (!account || !bytes || bytes.length < 72 || ![TOKEN, TOKEN_2022].includes(account.owner)) return null;
  return {ownerProgram: account.owner, mint: pubkey(bytes.subarray(0, 32)),
    authority: pubkey(bytes.subarray(32, 64)), amountRaw: bytes.readBigUInt64LE(64).toString(),
    dataLength: bytes.length};
}
function fixedRaw(value) {
  const bytes = Buffer.from(value.value);
  let result = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) result -= 1n << 128n;
  return result;
}
function enumName(value) { return value && typeof value === 'object' ? Object.keys(value)[0] : String(value); }
function decimalRatio(numerator, denominator, places = 12) {
  const whole = numerator / denominator;
  const fraction = ((numerator % denominator) * (10n ** BigInt(places)) / denominator)
    .toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function sha256File(path) { return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'); }

const marginfiIdl = JSON.parse(fs.readFileSync(
  `${DIR}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`));
const jupiterIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-idl.json`));
const jupiterFlashIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-flash-idl.json`));
const marginfiCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const jupiterCoder = new anchor.BorshAccountsCoder(jupiterIdl);
const jupiterFlashCoder = new anchor.BorshAccountsCoder(jupiterFlashIdl);
const discriminator = (name) => bs58.encode(crypto.createHash('sha256')
  .update(`account:${name}`).digest().subarray(0, 8));

async function scanSave() {
  const inventory = await gpa('save.reserveInventory', PROGRAMS.save, [{dataSize: 619}],
    {offset: 0, length: 371});
  const candidates = inventory.value.filter((row) => {
    const bytes = data(row.account);
    return bytes.length >= 74 && targetMints.has(pubkey(bytes.subarray(42, 74)));
  });
  const reserveAccounts = await multiple('save.positiveReserveCrossCheck', candidates.map((x) => x.pubkey));
  const prelim = candidates.map((row) => {
    const bytes = data(reserveAccounts.byAddress.get(row.pubkey));
    return {address: row.pubkey, bytes};
  }).filter((row) => row.bytes?.length === 619 && targetMints.has(pubkey(row.bytes.subarray(42, 74))));
  const dependent = [...new Set(prelim.flatMap((row) => [pubkey(row.bytes.subarray(10, 42)),
    pubkey(row.bytes.subarray(75, 107)), pubkey(row.bytes.subarray(339, 371))]))];
  const deps = await multiple('save.positiveDependencies', dependent);
  const matches = prelim.map(({address, bytes}) => {
    const mint = pubkey(bytes.subarray(42, 74));
    const market = pubkey(bytes.subarray(10, 42));
    const supplyVault = pubkey(bytes.subarray(75, 107));
    const vault = tokenImage(deps.byAddress.get(supplyVault));
    const available = bytes.readBigUInt64LE(171);
    const vaultAmount = BigInt(vault?.amountRaw || 0);
    const feeWad = bytes.readBigUInt64LE(314);
    const disabled = feeWad === U64_MAX;
    const [authority] = PublicKey.findProgramAddressSync([new PublicKey(market).toBuffer()],
      new PublicKey(PROGRAMS.save));
    const stateReady = bytes[0] > 0 && bytes[9] === 0 && !disabled && vault?.mint === mint;
    return {mint, pool: poolByMint.get(mint).pool, reserve: address, market,
      marketAuthority: authority.toBase58(), supplyVault, vaultAmountRaw: vault?.amountRaw || null,
      availableAmountRaw: available.toString(), stateDerivedBorrowableUpperBoundRaw:
        stateReady ? (available < vaultAmount ? available : vaultAmount).toString() : '0',
      version: bytes[0], lastUpdateSlot: bytes.readBigUInt64LE(1).toString(), stale: bytes[9],
      decimals: bytes[74], flashLoanFeeWad: feeWad.toString(),
      flashLoanFeeBps: disabled ? null : decimalRatio(feeWad * 10000n, WAD),
      flashDisabled: disabled, borrowLimitRaw: bytes.readBigUInt64LE(331).toString(),
      crossCheckSlot: reserveAccounts.slot, dependencySlot: deps.slot};
  });
  return {programId: PROGRAMS.save, reserveInventoryCount: inventory.value.length,
    inventorySlot: inventory.context.slot, targetReserveCount: matches.length, matches,
    semantics: {fee: 'flash fee is a WAD rate; fee rounds up; u64::MAX disables flash loans',
      minimumSuccessfulPrincipalRaw: '3 (existing signed runtime control, not rerun here)',
      route: 'single borrow plus indexed same-transaction repay; one flash borrow per transaction'}};
}

async function scanKlend() {
  const inventory = await gpa('klend.reserveInventory', PROGRAMS.klend,
    [{dataSize: 8624}, {memcmp: {offset: 0, bytes: discriminator('Reserve')}}],
    {offset: 128, length: 32});
  const candidates = inventory.value.filter((row) => targetMints.has(pubkey(data(row.account))));
  const reserveAccounts = await multiple('klend.positiveReserveCrossCheck', candidates.map((x) => x.pubkey));
  const prelim = candidates.map((row) => ({address: row.pubkey,
    bytes: data(reserveAccounts.byAddress.get(row.pubkey))})).filter((row) => row.bytes?.length === 8624);
  const vaults = await multiple('klend.positiveVaults', [...new Set(prelim.flatMap((row) =>
    [pubkey(row.bytes.subarray(160, 192)), pubkey(row.bytes.subarray(192, 224))]))]);
  const matches = prelim.map(({address, bytes}) => {
    const mint = pubkey(bytes.subarray(128, 160));
    const supplyVault = pubkey(bytes.subarray(160, 192));
    const vault = tokenImage(vaults.byAddress.get(supplyVault));
    const available = bytes.readBigUInt64LE(224);
    const vaultAmount = BigInt(vault?.amountRaw || 0);
    const feeSf = bytes.readBigUInt64LE(4904);
    const disabled = feeSf === U64_MAX;
    const ready = bytes[4856] === 0 && bytes[4864] === 0 && !disabled && vault?.mint === mint;
    return {mint, pool: poolByMint.get(mint).pool, reserve: address,
      market: pubkey(bytes.subarray(32, 64)), supplyVault,
      feeVault: pubkey(bytes.subarray(192, 224)), vaultAmountRaw: vault?.amountRaw || null,
      availableAmountRaw: available.toString(), stateDerivedBorrowableUpperBoundRaw:
        ready ? (available < vaultAmount ? available : vaultAmount).toString() : '0',
      decimals: bytes.readBigUInt64LE(272).toString(), status: bytes[4856],
      emergencyMode: bytes[4864], flashLoanFeeSf: feeSf.toString(),
      flashLoanFeeBps: disabled ? null : decimalRatio(feeSf * 10000n, KLEND_FEE_SCALE),
      flashDisabled: disabled, crossCheckSlot: reserveAccounts.slot, vaultSlot: vaults.slot};
  });
  return {programId: PROGRAMS.klend, reserveInventoryCount: inventory.value.length,
    inventorySlot: inventory.context.slot, targetReserveCount: matches.length, matches,
    semantics: {fee: 'flashLoanFeeSf / 2^60; u64::MAX disables flash loans',
      route: 'one flash borrow per transaction plus indexed same-transaction repay'}};
}

async function scanProject0() {
  const inventory = await gpa('project0.bankInventory', PROGRAMS.project0,
    [{dataSize: 3912}, {memcmp: {offset: 0, bytes: discriminator('Bank')}}],
    {offset: 8, length: 32});
  const candidates = inventory.value.filter((row) => targetMints.has(pubkey(data(row.account))));
  const bankAccounts = await multiple('project0.positiveBankCrossCheck', candidates.map((x) => x.pubkey));
  const decoded = candidates.map((row) => {
    const account = bankAccounts.byAddress.get(row.pubkey);
    if (!account || data(account).length !== 3912 || account.owner !== PROGRAMS.project0) return null;
    try { return {address: row.pubkey, bank: marginfiCoder.decode('Bank', data(account))}; }
    catch { return null; }
  }).filter(Boolean).filter((row) => targetMints.has(row.bank.mint.toBase58()));
  const vaults = await multiple('project0.positiveVaults', decoded.map((row) => row.bank.liquidity_vault.toBase58()));
  const matches = decoded.map(({address, bank}) => {
    const mint = bank.mint.toBase58();
    const liquidityVault = bank.liquidity_vault.toBase58();
    const vault = tokenImage(vaults.byAddress.get(liquidityVault));
    const assetShares = fixedRaw(bank.total_asset_shares);
    const assetShareValue = fixedRaw(bank.asset_share_value);
    const liabilityShares = fixedRaw(bank.total_liability_shares);
    const liabilityShareValue = fixedRaw(bank.liability_share_value);
    const totalAssets = assetShares * assetShareValue / I80_PRODUCT_SCALE;
    const totalLiabilities = liabilityShares * liabilityShareValue / I80_PRODUCT_SCALE;
    const physical = BigInt(vault?.amountRaw || 0);
    const accountingHeadroom = totalAssets > totalLiabilities ? totalAssets - totalLiabilities : 0n;
    const borrowLimit = BigInt(bank.config.borrow_limit.toString());
    // Marginfi uses u64::MAX to disable the configured cap. Zero is a hard
    // zero-liability ceiling (confirmed by Bank::change_asset_shares and the
    // signed/runtime HHZn 1/2/3-raw blocker controls), not "unlimited".
    const limitHeadroom = borrowLimit === U64_MAX ? physical :
      (borrowLimit > totalLiabilities + 1n ? borrowLimit - totalLiabilities - 1n : 0n);
    const operationalState = enumName(bank.config.operational_state);
    const originFeeRaw = fixedRaw(bank.config.interest_rate_config.protocol_origination_fee);
    const ready = operationalState === 'Operational' && bank.cb_tier === 0 && vault?.mint === mint;
    const bound = [physical, accountingHeadroom, limitHeadroom].reduce((a, b) => a < b ? a : b);
    return {mint, pool: poolByMint.get(mint).pool, bank: address,
      group: bank.group.toBase58(), liquidityVault, liquidityVaultAuthority: vault?.authority || null,
      vaultAmountRaw: vault?.amountRaw || null, totalAssetsNativeFloorRaw: totalAssets.toString(),
      totalLiabilitiesNativeFloorRaw: totalLiabilities.toString(), borrowLimitRaw: borrowLimit.toString(),
      operationalState, cbTier: bank.cb_tier, riskTier: enumName(bank.config.risk_tier),
      assetTag: bank.config.asset_tag, oracleSetup: enumName(bank.config.oracle_setup),
      integrationAccount1: bank.integration_acc_1.toBase58(),
      protocolOriginationFeeI80F48Raw: originFeeRaw.toString(),
      protocolOriginationFeeBps: decimalRatio(originFeeRaw * 10000n, I80_SCALE),
      stateDerivedBorrowableUpperBoundRaw: ready ? bound.toString() : '0',
      controlClassification: ready && originFeeRaw === 0n && bound > 0n
        ? 'state-compatible zero-origination-fee flash candidate' : 'not currently state-compatible',
      bankCrossCheckSlot: bankAccounts.slot, vaultSlot: vaults.slot};
  });
  return {programId: PROGRAMS.project0, bankInventoryCount: inventory.value.length,
    inventorySlot: inventory.context.slot, targetBankCount: matches.length, matches,
    semantics: {protocolFlashFee: 'no separate flash-session fee; ordinary bank origination fee still applies per bank',
      route: 'authority-owned Marginfi account; top-level start/end flash session; ordinary borrow/repay in between; end health must pass',
      limits: 'bank operational state, physical vault, accounting utilization and active borrow limit; bank/group outflow rate limit is skipped for flashloan flows per pinned source'}};
}

async function scanJupiterDeployment(label, liquidityProgram, flashProgram) {
  const reserveInventory = await gpa(`${label}.reserveInventory`, liquidityProgram,
    [{dataSize: 192}, {memcmp: {offset: 0, bytes: discriminator('TokenReserve')}}]);
  const positionInventory = await gpa(`${label}.borrowPositionInventory`, liquidityProgram,
    [{dataSize: 120}, {memcmp: {offset: 0, bytes: discriminator('UserBorrowPosition')}}]);
  const [flashAdmin] = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')],
    new PublicKey(flashProgram));
  const adminRead = await multiple(`${label}.flashAdmin`, [flashAdmin.toBase58()]);
  let admin = null;
  try { admin = jupiterFlashCoder.decode('FlashloanAdmin', data(adminRead.byAddress.get(flashAdmin.toBase58()))); }
  catch {}
  const reserves = reserveInventory.value.map((row) => {
    try { return {address: row.pubkey, state: jupiterCoder.decode('TokenReserve', data(row.account))}; }
    catch { return null; }
  }).filter(Boolean);
  const positions = positionInventory.value.map((row) => {
    try { return {address: row.pubkey, state: jupiterCoder.decode('UserBorrowPosition', data(row.account))}; }
    catch { return null; }
  }).filter(Boolean);
  const targetReserves = reserves.filter((row) => targetMints.has(row.state.mint.toBase58()));
  const targetPositions = positions.filter((row) => row.state.protocol.equals(flashAdmin) &&
    targetMints.has(row.state.mint.toBase58()));
  const vaultReads = await multiple(`${label}.targetVaults`, targetReserves.map((row) => row.state.vault.toBase58()));
  const matches = targetReserves.map((row) => {
    const mint = row.state.mint.toBase58();
    const position = targetPositions.find((candidate) => candidate.state.mint.toBase58() === mint);
    const vault = tokenImage(vaultReads.byAddress.get(row.state.vault.toBase58()));
    const positionHeadroom = position ? (() => {
      const max = BigInt(position.state.max_debt_ceiling.toString());
      const amount = BigInt(position.state.amount.toString());
      return max > amount ? max - amount : 0n;
    })() : 0n;
    const physical = BigInt(vault?.amountRaw || 0);
    const ready = !!admin?.status && !admin?.is_flashloan_active && position &&
      Number(position.state.status) === 0 && vault?.mint === mint;
    return {mint, pool: poolByMint.get(mint).pool, reserve: row.address,
      vault: row.state.vault.toBase58(), vaultAmountRaw: vault?.amountRaw || null,
      flashAdmin: flashAdmin.toBase58(), borrowPosition: position?.address || null,
      positionAmountRaw: position?.state.amount.toString() || null,
      positionMaxDebtCeilingRaw: position?.state.max_debt_ceiling.toString() || null,
      flashFeeBps: admin ? Number(admin.flashloan_fee) : null,
      stateDerivedBorrowableUpperBoundRaw: ready
        ? (physical < positionHeadroom ? physical : positionHeadroom).toString() : '0'};
  });
  return {label, liquidityProgram, flashProgram, flashAdmin: flashAdmin.toBase58(),
    reserveInventoryCount: reserves.length, borrowPositionInventoryCount: positions.length,
    reserveInventorySlot: reserveInventory.context.slot,
    positionInventorySlot: positionInventory.context.slot, adminSlot: adminRead.slot,
    adminState: admin ? {status: !!admin.status, feeBps: Number(admin.flashloan_fee),
      isFlashloanActive: !!admin.is_flashloan_active,
      activeFlashloanAmountRaw: admin.active_flashloan_amount.toString(),
      liquidityProgram: admin.liquidity_program.toBase58()} : null,
    targetReserveCount: targetReserves.length, targetBoundPositionCount: targetPositions.length, matches};
}

async function scanJupiter() {
  const deployments = [];
  deployments.push(await scanJupiterDeployment('jupiterMain', PROGRAMS.jupiterMainLiquidity,
    PROGRAMS.jupiterMainFlash));
  deployments.push(await scanJupiterDeployment('jupiterIsolatedEthena',
    PROGRAMS.jupiterIsolatedLiquidity, PROGRAMS.jupiterIsolatedFlash));
  const [mainAuthority] = PublicKey.findProgramAddressSync([Buffer.from('liquidity')],
    new PublicKey(PROGRAMS.jupiterMainLiquidity));
  const knownMainCustody = target.nonzeroTokenAccounts.filter((row) => row.tokenOwner === mainAuthority.toBase58());
  const custodyRead = await multiple('jupiterMain.targetCustodyCrossCheck', knownMainCustody.map((row) => row.address));
  const custody = knownMainCustody.map((row) => {
    const live = tokenImage(custodyRead.byAddress.get(row.address));
    if (!live || live.authority !== mainAuthority.toBase58() || !targetMints.has(live.mint) || BigInt(live.amountRaw) === 0n) return null;
    return {tokenAccount: row.address, mint: live.mint, pool: poolByMint.get(live.mint).pool,
      amountRaw: live.amountRaw, configuredReserve: deployments.some((deployment) =>
        deployment.matches.some((match) => match.mint === live.mint)),
      flashBoundPosition: deployments.some((deployment) => deployment.matches.some((match) =>
        match.mint === live.mint && match.borrowPosition))};
  }).filter(Boolean);
  return {deployments, mainLiquidityAuthority: mainAuthority.toBase58(),
    targetCustodySlot: custodyRead.slot, targetCustodyCount: custody.length, targetCustody: custody,
    sourceabilityRule: 'custody alone is not native-flash capacity: a mint needs a TokenReserve plus a UserBorrowPosition bound to that deployment flash admin',
    semantics: {fee: 'FlashloanAdmin fee in bps', minimumSuccessfulPrincipalRaw: '1000',
      route: 'one active wrapper loan; exact later payback; configured reserve, active bound position, vault liquidity and max-debt-ceiling headroom required'}};
}

async function scanMango() {
  const inventory = await gpa('mango.bankInventory', PROGRAMS.mango,
    [{memcmp: {offset: 0, bytes: discriminator('Bank')}}], {offset: 56, length: 32});
  const matches = inventory.value.filter((row) => targetMints.has(pubkey(data(row.account))));
  const cross = await multiple('mango.positiveBankCrossCheck', matches.map((row) => row.pubkey));
  return {programId: PROGRAMS.mango, bankInventoryCount: inventory.value.length,
    inventorySlot: inventory.context.slot, targetBankCount: matches.length,
    matches: matches.map((row) => ({bank: row.pubkey, mint: pubkey(data(row.account)),
      crossChecked: cross.byAddress.get(row.pubkey)?.owner === PROGRAMS.mango,
      crossCheckSlot: cross.slot})),
    semantics: {evidence: 'official workspace IDL exposes flashLoanBegin/flashLoanEnd(V2)',
      limitation: 'no target Bank means no target-specific Mango capacity/fee decoding was necessary'}};
}

async function main() {
  const identity = await multiple('programIdentities', Object.values(PROGRAMS), {offset: 0, length: 0});
  const providers = {};
  providers.saveSolend = await scanSave();
  providers.kaminoLend = await scanKlend();
  providers.project0Marginfi = await scanProject0();
  providers.jupiterNativeFlash = await scanJupiter();
  providers.mangoV4 = await scanMango();
  const sourceableByMint = new Map();
  for (const row of providers.saveSolend.matches) if (BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
    sourceableByMint.set(row.mint, [...(sourceableByMint.get(row.mint) || []), {provider: 'saveSolend', capacityRaw: row.stateDerivedBorrowableUpperBoundRaw}]);
  for (const row of providers.kaminoLend.matches) if (BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
    sourceableByMint.set(row.mint, [...(sourceableByMint.get(row.mint) || []), {provider: 'kaminoLend', capacityRaw: row.stateDerivedBorrowableUpperBoundRaw}]);
  for (const row of providers.project0Marginfi.matches) if (BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
    sourceableByMint.set(row.mint, [...(sourceableByMint.get(row.mint) || []), {provider: 'project0Marginfi', capacityRaw: row.stateDerivedBorrowableUpperBoundRaw, bank: row.bank}]);
  for (const deployment of providers.jupiterNativeFlash.deployments) for (const row of deployment.matches)
    if (BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
      sourceableByMint.set(row.mint, [...(sourceableByMint.get(row.mint) || []), {provider: deployment.label, capacityRaw: row.stateDerivedBorrowableUpperBoundRaw}]);

  const crosswalk = pools.map((pool) => {
    const supply = BigInt(pool.mintSupplyRaw);
    const available = BigInt(pool.mainAvailableDelegatedStakeLamports);
    // WithdrawStake prices against delegated stake *after* removing the fixed
    // one-SOL pool reserve, not against the full delegation.
    const minAtLeastOneSol = available > 0n
      ? (1000000000n * supply + available - 1n) / available : U64_MAX;
    const minStrictlyMoreOneSol = available > 0n
      ? ((1000000001n * supply) + available - 1n) / available : U64_MAX;
    const candidates = (sourceableByMint.get(pool.mint) || []).map((candidate) => {
      const capacity = BigInt(candidate.capacityRaw);
      const calculated = capacity * available / supply;
      const maxStake = calculated < available ? calculated : available;
      return {...candidate,
        minimumPoolTokensForAtLeastOneSolStakeRaw: minAtLeastOneSol.toString(),
        minimumPoolTokensForStrictlyMoreThanOneSolStakeRaw: minStrictlyMoreOneSol.toString(),
        capacityMeetsAtLeastOneSolStakeSplit: capacity >= minAtLeastOneSol && available >= 1000000000n,
        capacityMeetsStrictlyMoreThanOneSolStakeSplit:
          capacity >= minStrictlyMoreOneSol && available >= 1000000001n,
        maxStakeLamportsAtStateBound: maxStake.toString()};
    });
    return {...pool,
    activeOnrampMergePrerequisite: activePools.has(pool.pool),
    minimumPoolTokensForAtLeastOneSolStakeRaw: minAtLeastOneSol.toString(),
    minimumPoolTokensForStrictlyMoreThanOneSolStakeRaw: minStrictlyMoreOneSol.toString(),
    custody: {
      project0Vaults: providers.project0Marginfi.matches.filter((row) => row.mint === pool.mint)
        .map((row) => ({bank: row.bank, vault: row.liquidityVault, amountRaw: row.vaultAmountRaw})),
      jupiterMainLiquidityAuthority: providers.jupiterNativeFlash.targetCustody
        .filter((row) => row.mint === pool.mint).map((row) => ({tokenAccount: row.tokenAccount,
          amountRaw: row.amountRaw, configuredReserve: row.configuredReserve}))},
    stateCompatibleFlashCandidates: candidates,
    actuallySourceableCandidates: candidates,
  };});
  const activeCrosswalk = crosswalk.filter((row) => row.activeOnrampMergePrerequisite);
  const sourceable = crosswalk.filter((row) => row.stateCompatibleFlashCandidates.length);
  const stakeSized = sourceable.filter((row) => row.stateCompatibleFlashCandidates.some((candidate) =>
    candidate.capacityMeetsAtLeastOneSolStakeSplit));
  const identities = Object.fromEntries(Object.entries(PROGRAMS).map(([label, address]) => {
    const account = identity.byAddress.get(address);
    return [label, {programId: address, exists: !!account, owner: account?.owner || null,
      executable: account?.executable || false}];
  }));
  const out = {
    schema: 'svsp-flash-provider-crosswalk-v1', generatedAt: new Date().toISOString(),
    readOnly: true, transactionsBuilt: 0, simulations: 0, transactionsSubmitted: 0,
    transport: {endpointClass: 'primary RPC_URL only (HEAVY_RPC_URL ignored)', commitment: 'finalized',
      endpointRedacted: true},
    target: {programId: 'SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE', poolCount: pools.length,
      uniqueMintCount: targetMints.size, activeOnrampPoolCount: activePools.size,
      inputArtifact: TARGET_FILE, inputArtifactSha256: sha256File(TARGET_FILE)},
    programIdentitySlot: identity.slot, programIdentities: identities,
    providers,
    summary: {
      stateCompatibleFlashCandidateMintCount: sourceable.length,
      sourceableMintCount: sourceable.length,
      sourceableMints: sourceable.map((row) => ({pool: row.pool, mint: row.mint,
        activeOnramp: row.activeOnrampMergePrerequisite, sources: row.stateCompatibleFlashCandidates})),
      activeOnrampStateCompatibleFlashCandidateMintCount:
        activeCrosswalk.filter((row) => row.stateCompatibleFlashCandidates.length).length,
      activeOnrampSourceableMintCount: activeCrosswalk.filter((row) => row.stateCompatibleFlashCandidates.length).length,
      activeOnrampSourceableMints: activeCrosswalk.filter((row) => row.stateCompatibleFlashCandidates.length)
        .map((row) => ({pool: row.pool, voteAccount: row.voteAccount, mint: row.mint,
          sources: row.stateCompatibleFlashCandidates})),
      poolMintCapacityAtLeastOneSolStakeSplitCount: stakeSized.length,
      poolMintCapacityAtLeastOneSolStakeSplitPools: stakeSized.map((row) => ({pool: row.pool,
        voteAccount: row.voteAccount, mint: row.mint, activeOnramp: row.activeOnrampMergePrerequisite,
        sources: row.stateCompatibleFlashCandidates.filter((candidate) =>
          candidate.capacityMeetsAtLeastOneSolStakeSplit)})),
      activeOnrampPoolMintCapacityAtLeastOneSolStakeSplitCount:
        stakeSized.filter((row) => row.activeOnrampMergePrerequisite).length,
      exactValidatorActiveStakeDirectProviderCount: 0,
      exactValidatorActiveStakeConclusion: 'All enumerated provider primitives transfer SPL-token amounts, not ownership of native Stake-program accounts. No direct exact-validator active Stake-account flash route was identified. A sourceable SVSP pool mint may still be redeemed through SVSP into that pool validator stake, which is a separate protocol path.',
      flashRepaymentBlocker: 'SVSP redemption burns the borrowed pool mint. A capacity-at-threshold row proves inventory and withdrawal sizing only, not a complete flash route: a same-transaction mechanism must restore the burned mint plus any provider fee before flash-session end.',
    },
    crosswalk,
    observationSlots: {minimum: Math.min(...slots.map((row) => row.slot)),
      maximum: Math.max(...slots.map((row) => row.slot)), reads: slots},
    limitations: [
      'State-derived upper bounds are not signed sigVerify:true simulations; this follow-up was explicitly read-only and did not construct or simulate transactions.',
      'Project0 bounds assume an otherwise valid authority-owned Marginfi account and complete oracle/account list. They distinguish state compatibility from an executed route.',
      'Jupiter main custody rows are real token balances controlled by its liquidity PDA, but are not borrowable unless a configured TokenReserve and flash-admin-bound UserBorrowPosition also exist.',
      'No StakeHistory activation calculation was repeated here; the 11-pool subset is inherited from the pinned epoch-field prerequisite artifact.',
    ],
    reproducibility: {command: `node ${__filename}`, output: OUT,
      sourceFiles: [__filename, TARGET_FILE,
        `${DIR}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`,
        `${DIR}/jup6qf-onchain-idl.json`, `${DIR}/jup6qf-onchain-flash-idl.json`]},
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, slots: out.observationSlots,
    summary: out.summary, providerCounts: {
      save: providers.saveSolend.targetReserveCount,
      klend: providers.kaminoLend.targetReserveCount,
      project0: providers.project0Marginfi.targetBankCount,
      jupiterConfigured: providers.jupiterNativeFlash.deployments.map((row) =>
        ({label: row.label, reserves: row.targetReserveCount, positions: row.targetBoundPositionCount})),
      jupiterCustody: providers.jupiterNativeFlash.targetCustodyCount,
      mango: providers.mangoV4.targetBankCount}}, null, 2));
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
