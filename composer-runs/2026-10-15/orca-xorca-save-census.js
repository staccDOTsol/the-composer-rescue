#!/usr/bin/env node
'use strict';

// Read-only exact-mint Save/Solend reserve census for ORCA and xORCA.
// No transaction is constructed, signed, simulated, or submitted.
const fs = require('fs');
const path = require('path');
const {PublicKey} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const dir = __dirname;
const outPath = path.join(dir, 'orca-xorca-save-census.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoints = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!endpoints.length) throw new Error('Missing configured read-only RPC');

const SAVE = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const U64_MAX = (2n ** 64n - 1n).toString();
const mints = {ORCA: live.identities.orcaMint, xORCA: live.identities.xorcaMint};
let requestId = 0;

async function rpcAt(endpoint, method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}
async function rpc(method, params) {
  const errors = [];
  for (let index = 0; index < endpoints.length; index += 1) {
    try { return {result: await rpcAt(endpoints[index], method, params), endpointIndex: index}; }
    catch (error) { errors.push(`endpoint[${index}]: ${error.message}`); }
  }
  throw new Error(errors.join(' | '));
}

const key = (bytes) => new PublicKey(bytes).toBase58();
const dataOf = (account) => Buffer.from(account.data[0], 'base64');
function accountSummary(account) {
  if (!account) return {exists: false};
  return {exists: true, owner: account.owner, executable: account.executable,
    lamports: account.lamports, dataBytes: dataOf(account).length};
}
function mintSummary(account) {
  const summary = accountSummary(account);
  if (!account || dataOf(account).length < 82) return summary;
  const data = dataOf(account);
  return {...summary, supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44],
    initialized: data[45] === 1, tokenProgram: account.owner,
    token2022: account.owner === TOKEN_2022};
}
function decodeReserve(address, account) {
  const data = dataOf(account);
  if (data.length !== 619) throw new Error(`Unexpected Save reserve bytes ${data.length}`);
  const feeWad = data.readBigUInt64LE(314);
  return {address, accountOwner: account.owner, version: data[0],
    lastUpdateSlot: data.readBigUInt64LE(1).toString(), stale: data[9] !== 0,
    market: key(data.subarray(10, 42)), mint: key(data.subarray(42, 74)),
    mintDecimals: data[74], supplyVault: key(data.subarray(75, 107)),
    availableRaw: data.readBigUInt64LE(171).toString(),
    flashLoanFeeWad: feeWad.toString(),
    flashLoanFeeFraction: feeWad.toString() === U64_MAX ? null : `${feeWad}/1000000000000000000`,
    flashLoanDisabledByFeeSentinel: feeWad.toString() === U64_MAX,
    hostFeePercentage: data[322], borrowLimitRaw: data.readBigUInt64LE(331).toString(),
    feeReceiver: key(data.subarray(339, 371))};
}
function tokenAccountSummary(account) {
  const summary = accountSummary(account);
  if (!account || dataOf(account).length < 165) return summary;
  const data = dataOf(account);
  return {...summary, mint: key(data.subarray(0, 32)),
    authority: key(data.subarray(32, 64)), rawAmount: data.readBigUInt64LE(64).toString(),
    state: data[108], tokenProgram: account.owner};
}

(async () => {
  const {result: slot} = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const [{result: blockTime}, {result: basics, endpointIndex: basicsEndpointIndex}] =
    await Promise.all([
      rpc('getBlockTime', [slot]),
      rpc('getMultipleAccounts', [[SAVE, ...Object.values(mints)],
        {encoding: 'base64', commitment: 'confirmed'}]),
    ]);
  const targetMints = Object.fromEntries(Object.entries(mints).map(([label, address], index) =>
    [label, {address, ...mintSummary(basics.value[index + 1])}]));

  const found = {};
  for (const [label, mint] of Object.entries(mints)) {
    const {result: response, endpointIndex} = await rpc('getProgramAccounts', [SAVE, {
      encoding: 'base64', commitment: 'confirmed', withContext: true,
      filters: [{dataSize: 619}, {memcmp: {offset: 42, bytes: mint}}],
    }]);
    const reserves = response.value.map((row) => decodeReserve(row.pubkey, row.account));
    const vaultResponse = reserves.length ? (await rpc('getMultipleAccounts', [
      reserves.map((row) => row.supplyVault), {encoding: 'base64', commitment: 'confirmed'},
    ])).result : {value: []};
    found[label] = {mint, contextSlot: response.context.slot, rpcEndpointIndex: endpointIndex,
      reserveCount: reserves.length, reserves: reserves.map((reserve, index) => {
        const vault = tokenAccountSummary(vaultResponse.value[index]);
        const [authority] = PublicKey.findProgramAddressSync(
          [new PublicKey(reserve.market).toBuffer()], new PublicKey(SAVE));
        const usableRawUpperBound = !reserve.flashLoanDisabledByFeeSentinel && vault.exists &&
          vault.owner === TOKEN && vault.mint === mint && vault.authority === authority.toBase58() ?
          (BigInt(reserve.availableRaw) < BigInt(vault.rawAmount) ?
            reserve.availableRaw : vault.rawAmount) : '0';
        return {...reserve, vault, expectedMarketAuthority: authority.toBase58(),
          vaultVerified: vault.exists && vault.owner === TOKEN && vault.mint === mint &&
            vault.authority === authority.toBase58(),
          displayedUsableRawUpperBound: usableRawUpperBound,
          note: 'Upper bound only; instruction mode, freshness, indexed repay, fees, and transaction fit can further reduce usable capacity.'};
      })};
  }

  const {result: full, endpointIndex: censusEndpointIndex} = await rpc('getProgramAccounts',
    [SAVE, {encoding: 'base64', commitment: 'confirmed', withContext: true,
      dataSlice: {offset: 0, length: 75}, filters: [{dataSize: 619}]}]);
  const censusRows = full.value.map((row) => {
    const data = dataOf(row.account);
    return {address: row.pubkey, market: key(data.subarray(10, 42)),
      mint: key(data.subarray(42, 74))};
  });
  const output = {generatedAt: new Date().toISOString(), observedSlot: slot,
    observedBlockTime: blockTime, readOnly: true, liveSubmission: false,
    rpcUrlsStored: false, rpcEndpointIndicesOnly: true,
    program: {address: SAVE, rpcEndpointIndex: basicsEndpointIndex,
      ...accountSummary(basics.value[0])}, targetMints,
    reserveLayout: {bytes: 619, mintOffset: 42, availableOffset: 171,
      flashLoanFeeWadOffset: 314, hostFeePercentageOffset: 322, feeReceiverOffset: 339},
    semantics: {flashLoanFeeScale: '1e18', disabledFeeSentinel: U64_MAX,
      indexedRepayRequired: true, cpiBorrowRejected: true,
      repeatedSaveFlashBorrowRejected: true,
      source: 'Locally retained official Save token-lending source at commit d04ce00bbf4356c4fd32b3be38eb9760b696bb3e.'},
    fullReserveCensus: {contextSlot: full.context.slot,
      rpcEndpointIndex: censusEndpointIndex, reserveCount: censusRows.length,
      exactMintCounts: Object.fromEntries(Object.entries(mints).map(([label, mint]) =>
        [label, censusRows.filter((row) => row.mint === mint).length]))},
    found,
    conclusion: 'Exact-mint presence is a necessary condition only. A nonzero displayed upper bound is not claimed as executable capacity without signed boundary simulations.'};
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, observedSlot: slot,
    program: output.program, fullReserveCensus: output.fullReserveCensus,
    found: Object.fromEntries(Object.entries(found).map(([label, entry]) => [label, {
      contextSlot: entry.contextSlot, reserveCount: entry.reserveCount,
      reserves: entry.reserves.map((row) => ({address: row.address,
        availableRaw: row.availableRaw, vaultRaw: row.vault.rawAmount,
        feeWad: row.flashLoanFeeWad, disabled: row.flashLoanDisabledByFeeSentinel,
        displayedUsableRawUpperBound: row.displayedUsableRawUpperBound,
        vaultVerified: row.vaultVerified}))}]))}, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
