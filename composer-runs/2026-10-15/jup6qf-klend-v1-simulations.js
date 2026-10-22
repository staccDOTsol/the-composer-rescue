#!/usr/bin/env node
'use strict';

// Read-only current-mainnet Solana-v1 simulations for exact-zero-fee KLend
// flash liquidity composed with the deployed Jupiter Lend Ethena liquidity
// program. This file has no signing or transaction-submission path.
const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey,
  TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const OUT = `${DIR}/jup6qf-klend-v1-simulations.json`;
const IDL_PATH = `${DIR}/jup6qf-onchain-idl.json`;
const CENSUS_PATH = `${DIR}/klend-zero-fee-census.json`;
const PRIOR_PATH = `${DIR}/klend-zero-fee-simulations.json`;
const FLASH_HISTORY_PATH = `${DIR}/kamino-flash-history.json`;
const INVENTORY_PATH = `${DIR}/jup6qf-current-inventory.json`;

const P = (value) => new PublicKey(value);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TARGET = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const AUTH_LIST = P('FdCSMQ51V9A1xYbdRvMeQrBYapPMUSRKUM7jHvFmXKNQ');
const REVENUE_COLLECTOR = P('Cvnta5ecoiCgNbLEXYm6kvhJMmRv3JM3ksKgTLVPg4hk');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = P('11111111111111111111111111111111');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL unavailable');

const census = JSON.parse(fs.readFileSync(CENSUS_PATH));
const prior = JSON.parse(fs.readFileSync(PRIOR_PATH));
const flashHistory = JSON.parse(fs.readFileSync(FLASH_HISTORY_PATH));
const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH));
const idl = JSON.parse(fs.readFileSync(IDL_PATH));
idl.address = TARGET.toBase58();
const accountCoder = new anchor.BorshAccountsCoder(idl);
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

function historicalIx(index) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const loaded = tx.meta.loadedAddresses;
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = (i) => i < staticKeys.length ?
    (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < staticKeys.length - h.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return new TransactionInstruction({
    programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({pubkey: P(allKeys[i]),
      isSigner: i < h.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

const borrowTemplate = historicalIx(3);
const repayTemplate = historicalIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND))
  throw new Error('KLend historical flash template changed');

function flashIx(template, row, user, amount, repayIndex, mutations = {}) {
  const keys = template.keys.map((item) => ({...item}));
  const market = P(row.market);
  const authority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const replacements = {
    0: user.owner,
    1: authority,
    2: row.market,
    3: row.reserve,
    4: row.mint,
    5: row.supplyVault,
    6: user.address,
    7: row.feeVault,
    11: user.tokenProgram,
    ...mutations,
  };
  for (const [index, address] of Object.entries(replacements)) keys[Number(index)].pubkey = P(address);
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function refreshIx(targetRow, rateOverride) {
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(rateOverride || targetRow.rateModel), isSigner: false, isWritable: false},
  ], data: Buffer.concat([
    Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]),
    P(targetRow.mint).toBuffer(),
  ])});
}

function i128(value) {
  const out = Buffer.alloc(16);
  let n = BigInt(value);
  if (n < 0) n += 1n << 128n;
  out.writeBigUInt64LE(n & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(n >> 64n, 8);
  return out;
}

function outsiderOperateIx(targetRow, user) {
  const binding = inventory.protocolBindings.find((item) =>
    item.ownerProgram === 'jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
  const borrowPosition = binding.borrowPositions.find((item) => item.mint === targetRow.mint);
  if (!borrowPosition) throw new Error(`No native-flash borrow position for ${targetRow.symbol}`);
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(user.owner), isSigner: true, isWritable: false},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.mint), isSigner: false, isWritable: false},
    {pubkey: P(targetRow.vault), isSigner: false, isWritable: true},
    {pubkey: TARGET, isSigner: false, isWritable: false}, // absent optional supply position
    {pubkey: P(borrowPosition.address), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.rateModel), isSigner: false, isWritable: false},
    {pubkey: TARGET, isSigner: false, isWritable: false}, // absent optional withdraw account
    {pubkey: P(user.address), isSigner: false, isWritable: true},
    {pubkey: TARGET, isSigner: false, isWritable: false}, // absent optional borrow claim
    {pubkey: TARGET, isSigner: false, isWritable: false}, // absent optional withdraw claim
    {pubkey: P(user.tokenProgram), isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN, isSigner: false, isWritable: false},
  ], data: Buffer.concat([
    Buffer.from([217, 106, 208, 99, 116, 151, 42, 135]),
    i128(0n), i128(10n), SYSTEM.toBuffer(), P(user.owner).toBuffer(), Buffer.from([1]),
  ])});
}

function collectRevenueIx(targetRow, user) {
  const tokenProgram = P(user.tokenProgram);
  const collectorAta = getAssociatedTokenAddressSync(P(targetRow.mint), REVENUE_COLLECTOR,
    true, tokenProgram, ASSOCIATED_TOKEN);
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(user.owner), isSigner: true, isWritable: true},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: AUTH_LIST, isSigner: false, isWritable: false},
    {pubkey: P(targetRow.mint), isSigner: false, isWritable: false},
    {pubkey: collectorAta, isSigner: false, isWritable: true},
    {pubkey: REVENUE_COLLECTOR, isSigner: false, isWritable: false},
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.vault), isSigner: false, isWritable: true},
    {pubkey: tokenProgram, isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN, isSigner: false, isWritable: false},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
  ], data: Buffer.from([87, 96, 211, 36, 240, 43, 246, 87])});
}

function changeStatusIx(user) {
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(user.owner), isSigner: true, isWritable: false},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: true},
    {pubkey: AUTH_LIST, isSigner: false, isWritable: false},
  ], data: Buffer.from([236, 145, 131, 228, 227, 17, 192, 255, 1])});
}

function updateRevenueCollectorIx(user) {
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(user.owner), isSigner: true, isWritable: false},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: true},
  ], data: Buffer.concat([
    Buffer.from([167, 142, 124, 240, 220, 113, 141, 59]), P(user.owner).toBuffer(),
  ])});
}

function claimIx(targetRow, user, recipientOwner, recipientAta) {
  const claim = inventory.decodedProgramAccounts.find((item) => item.accountName === 'UserClaim');
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: P(user.owner), isSigner: true, isWritable: false},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: P(targetRow.reserve), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.mint), isSigner: false, isWritable: false},
    {pubkey: P(recipientAta), isSigner: false, isWritable: true},
    {pubkey: P(targetRow.vault), isSigner: false, isWritable: true},
    {pubkey: P(claim.address), isSigner: false, isWritable: true},
    {pubkey: P(user.tokenProgram), isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN, isSigner: false, isWritable: false},
  ], data: Buffer.concat([
    Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]), P(recipientOwner).toBuffer(),
  ])});
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

function reserveImage(account, accountName) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  try {
    const decoded = json(accountCoder.decode(accountName, data));
    if (accountName === 'TokenReserve') return {
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
      lastUpdateTimestamp: decoded.last_update_timestamp,
      interactingProtocol: decoded.interacting_protocol,
      interactingTimestamp: decoded.interacting_timestamp,
      interactingBalance: decoded.interacting_balance,
    };
    return decoded;
  } catch (error) {
    return {decodeError: error.message, sha256: hashAccount(account)};
  }
}

function delta(after, before) {
  if (after === null || before === null || after === undefined || before === undefined) return null;
  return (BigInt(after) - BigInt(before)).toString();
}

async function preImage(addresses, targetReserveIndex, klendReserveIndex) {
  const result = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const accounts = result.value;
  const klendData = Buffer.from(accounts[klendReserveIndex].data[0], 'base64');
  return {slot: result.context.slot, accounts, tokenAmounts: accounts.map(tokenAmount),
    hashes: accounts.map(hashAccount), targetReserve: reserveImage(accounts[targetReserveIndex], 'TokenReserve'),
    klendReserveAvailableRaw: klendData.length >= 232 ?
      klendData.readBigUInt64LE(224).toString() : null};
}

async function simulate(label, instructions, payer, blockhash, watched, pre, targetReserveIndex,
  klendReserveIndex, metadata = {}) {
  const encoded = encodeV1(instructions, P(payer), blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses: watched},
  }]);
  const value = result.value;
  const accounts = value.accounts || [];
  const afterToken = accounts.map(tokenAmount);
  const klendData = accounts[klendReserveIndex]?.data ?
    Buffer.from(accounts[klendReserveIndex].data[0], 'base64') : null;
  return {label, ...metadata, slot: result.context.slot, err: value.err,
    v1Bytes: encoded.sizeBytes, legacyV0EquivalentBytes: encoded.v0Bytes,
    accountCount: encoded.addressCount, writableCount: encoded.writableCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    v1Limits: {maxBytes: 4096, maxInlineAddresses: 64, maxInstructions: 64},
    unitsConsumed: value.unitsConsumed, loadedAccountsDataSize: value.loadedAccountsDataSize,
    watched, accounting: {
      preSlot: pre.slot,
      tokenAmountsBeforeRaw: pre.tokenAmounts,
      tokenAmountsAfterRaw: afterToken,
      tokenDeltasRaw: afterToken.map((amount, i) => delta(amount, pre.tokenAmounts[i])),
      targetReserveBefore: pre.targetReserve,
      targetReserveAfter: reserveImage(accounts[targetReserveIndex], 'TokenReserve'),
      targetReserveHashBefore: pre.hashes[targetReserveIndex],
      targetReserveHashAfter: hashAccount(accounts[targetReserveIndex]),
      klendReserveAvailableBeforeRaw: pre.klendReserveAvailableRaw,
      klendReserveAvailableAfterRaw: klendData && klendData.length >= 232 ?
        klendData.readBigUInt64LE(224).toString() : null,
      klendReserveHashBefore: pre.hashes[klendReserveIndex],
      klendReserveHashAfter: hashAccount(accounts[klendReserveIndex]),
    },
    logs: value.logs?.filter((line) => line.includes('Instruction:') ||
      line.includes(TARGET.toBase58()) || line.includes(KLEND.toBase58()) ||
      line.includes('Error') || line.includes('failed') || line.includes('success')).slice(-45),
  };
}

async function findAssociatedHolder(mint, tokenProgram) {
  const largest = await rpc('getTokenLargestAccounts', [mint, {commitment: 'confirmed'}]);
  const addresses = largest.value.map((item) => item.address);
  const infos = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  for (let i = 0; i < addresses.length; i += 1) {
    if (!infos.value[i] || infos.value[i].owner !== tokenProgram) continue;
    const data = Buffer.from(infos.value[i].data[0], 'base64');
    if (data.length < 72) continue;
    const owner = new PublicKey(data.subarray(32, 64));
    const ata = getAssociatedTokenAddressSync(P(mint), owner, true, P(tokenProgram), ASSOCIATED_TOKEN);
    if (ata.toBase58() === addresses[i]) return {owner: owner.toBase58(), address: addresses[i]};
  }
  throw new Error(`No associated token holder for ${mint}`);
}

async function main() {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const priorBySymbol = new Map(prior.results.map((item) => [item.symbol, item]));
  const targetByMint = new Map(inventory.reserves.map((item) => [item.mint, item]));
  const symbols = ['USDe', 'PYUSD', 'USDG'];
  const results = [];
  const setups = [];

  for (const symbol of symbols) {
    const priorRow = priorBySymbol.get(symbol);
    const row = census.activeZero.filter((item) => item.mint === priorRow.reserve.mint)
      .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
    const user = {owner: priorRow.userOwner, address: priorRow.userToken,
      tokenProgram: priorRow.tokenProgram};
    const targetRow = {...targetByMint.get(row.mint), symbol};
    const watched = [user.address, row.supplyVault, row.feeVault, targetRow.vault,
      targetRow.reserve, targetRow.rateModel, row.reserve];
    const targetReserveIndex = 4;
    const klendReserveIndex = 6;
    const pre = await preImage(watched, targetReserveIndex, klendReserveIndex);
    const available = BigInt(pre.klendReserveAvailableRaw);
    const oneUnit = 10n ** BigInt(row.decimals);
    setups.push({symbol, mint: row.mint, tokenProgram: user.tokenProgram,
      klendReserve: row.reserve, klendMarket: row.market, klendSupplyVault: row.supplyVault,
      klendFeeVault: row.feeVault, klendFlashFeeSf: row.flashFeeSf,
      klendFlashFeeClass: row.flashFeeClass, currentAvailableRaw: available.toString(),
      borrower: user.owner, borrowerTokenAccount: user.address,
      targetReserve: targetRow.reserve, targetRateModel: targetRow.rateModel,
      targetVault: targetRow.vault, watched});

    const makePair = (amount, middle = [], borrowIndex = 0, mutations = {}) => [
      flashIx(borrowTemplate, row, user, amount, undefined, mutations.borrow || {}),
      ...middle,
      flashIx(repayTemplate, row, user, mutations.repayAmount ?? amount,
        mutations.repayIndex ?? borrowIndex, mutations.repay || {}),
    ];
    const cases = [
      [`${symbol}_dust_refresh_repay`, makePair(1n, [refreshIx(targetRow)]), 1n,
        {class: 'funded-positive-control', ordering: 'borrow-refresh-repay'}],
      [`${symbol}_one_unit_refresh_repay`, makePair(oneUnit, [refreshIx(targetRow)]), oneUnit,
        {class: 'funded-positive-control', ordering: 'borrow-refresh-repay'}],
      [`${symbol}_ninety_nine_percent_refresh_repay`,
        makePair(available * 99n / 100n, [refreshIx(targetRow)]), available * 99n / 100n,
        {class: 'large-funded-control', ordering: 'borrow-refresh-repay'}],
      [`${symbol}_exact_available_refresh_repay`, makePair(available, [refreshIx(targetRow)]), available,
        {class: 'extreme-funded-control', ordering: 'borrow-refresh-repay'}],
      [`${symbol}_refresh_before_borrow`,
        [refreshIx(targetRow), ...makePair(oneUnit, [], 1)], oneUnit,
        {class: 'ordering-control', ordering: 'refresh-borrow-repay'}],
      [`${symbol}_refresh_after_repay`,
        [...makePair(oneUnit), refreshIx(targetRow)], oneUnit,
        {class: 'ordering-control', ordering: 'borrow-repay-refresh'}],
      [`${symbol}_repeated_refresh_legs`,
        makePair(oneUnit, [refreshIx(targetRow), refreshIx(targetRow), refreshIx(targetRow)]), oneUnit,
        {class: 'repetition-control', ordering: 'borrow-refresh-refresh-refresh-repay'}],
      [`${symbol}_two_flash_cycles`, [
        ...makePair(oneUnit, [refreshIx(targetRow)], 0),
        ...makePair(oneUnit, [refreshIx(targetRow)], 3),
      ], oneUnit, {class: 'repetition-control', ordering: 'two-complete-flash-cycles'}],
    ];
    for (const [label, instructions, amount, metadata] of cases) {
      results.push(await simulate(label, instructions, user.owner, blockhash, watched, pre,
        targetReserveIndex, klendReserveIndex, {symbol, mint: row.mint,
          amountRaw: amount.toString(), exactFeeRaw: '0', ...metadata}));
    }

    if (symbol === 'USDe') {
      const pyusdTarget = targetByMint.get('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');
      const negativeCases = [
        ['missing_repay', [flashIx(borrowTemplate, row, user, oneUnit), refreshIx(targetRow)]],
        ['repay_before_borrow', [flashIx(repayTemplate, row, user, oneUnit, 1),
          flashIx(borrowTemplate, row, user, oneUnit)]],
        ['mismatched_repay_amount', makePair(oneUnit, [refreshIx(targetRow)], 0,
          {repayAmount: oneUnit + 1n})],
        ['wrong_repay_index', makePair(oneUnit, [refreshIx(targetRow)], 0, {repayIndex: 1})],
        ['duplicate_repay', [...makePair(oneUnit, [refreshIx(targetRow)]),
          flashIx(repayTemplate, row, user, oneUnit, 0)]],
        ['cross_mint_rate_model', makePair(oneUnit,
          [refreshIx(targetRow, pyusdTarget.rateModel)])],
        ['klend_supply_vault_alias_target_vault', makePair(oneUnit, [refreshIx(targetRow)], 0,
          {borrow: {5: targetRow.vault}})],
        ['klend_destination_alias_target_vault', makePair(oneUnit, [refreshIx(targetRow)], 0,
          {borrow: {6: targetRow.vault}})],
        ['klend_wrong_mint', makePair(oneUnit, [refreshIx(targetRow)], 0,
          {borrow: {4: pyusdTarget.mint}})],
        ['klend_wrong_token_program', makePair(oneUnit, [refreshIx(targetRow)], 0,
          {borrow: {11: TOKEN_2022.toBase58()}})],
        ['outsider_direct_operate_between_flash', makePair(oneUnit,
          [outsiderOperateIx(targetRow, user)])],
        ['outsider_collect_revenue_between_flash', makePair(oneUnit,
          [collectRevenueIx(targetRow, user)])],
        ['outsider_change_status_between_flash', makePair(oneUnit,
          [changeStatusIx(user)])],
        ['outsider_update_revenue_collector_between_flash', makePair(oneUnit,
          [updateRevenueCollectorIx(user)])],
      ];
      for (const [suffix, instructions] of negativeCases) {
        results.push(await simulate(`USDe_${suffix}`, instructions, user.owner, blockhash, watched,
          pre, targetReserveIndex, klendReserveIndex, {symbol, mint: row.mint,
            amountRaw: oneUnit.toString(), exactFeeRaw: '0', class: 'negative-control'}));
      }
    }
  }

  // Claim substitution is tested against the only live UserClaim, which is
  // currently zero and bound to a different user and the JupUSD mint.
  const jupRow = {...targetByMint.get('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD'), symbol: 'JupUSD'};
  const usdePrior = priorBySymbol.get('USDe');
  const claimUser = {owner: usdePrior.userOwner, address: usdePrior.userToken,
    tokenProgram: TOKEN.toBase58()};
  const holder = await findAssociatedHolder(jupRow.mint, TOKEN.toBase58());
  const claimWatched = [jupRow.vault, jupRow.reserve];
  const claimPre = await preImage(claimWatched, 1, 1);
  results.push(await simulate('JupUSD_outsider_claim',
    [claimIx(jupRow, claimUser, holder.owner, holder.address)], claimUser.owner, blockhash,
    claimWatched, claimPre, 1, 1, {symbol: 'JupUSD', mint: jupRow.mint,
      amountRaw: '0', class: 'negative-control'}));

  fs.writeFileSync(OUT, JSON.stringify({generatedAt: new Date().toISOString(), readOnly: true,
    noSubmission: true, sigVerify: false, targetProgram: TARGET.toBase58(),
    klendProgram: KLEND.toBase58(), sourceFlashSignature: flashHistory.hits[0].signature,
    sourceFlashSlot: flashHistory.hits[0].slot,
    exactZeroFeeMeaning: 'flashFeeSf is the on-chain configured rate and equals integer zero; it is not a fee rounded to zero for small amounts',
    debtAccounting: 'KLend flash loans create no persistent obligation account; successful indexed repay plus restored borrower/supply/fee token balances and reserve available-liquidity establishes full atomic repayment.',
    setups, results}, null, 2));
  console.log(JSON.stringify({output: OUT, cases: results.length,
    success: results.filter((item) => item.err === null).length,
    failures: results.filter((item) => item.err !== null).length,
    unexpectedSuccesses: results.filter((item) => item.class === 'negative-control' && item.err === null)
      .map((item) => item.label)}));
}

main().catch((error) => {console.error(error.stack || error.message); process.exitCode = 1;});
