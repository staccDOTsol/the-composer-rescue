#!/usr/bin/env node
'use strict';

// Bounded, read-only mainnet-beta account gate. No transaction is constructed.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const ROOT = __dirname;
const PROGRAM = 'REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2';
const BYREAL_BBSOL_POOL = '87pbGHxigtjdMovzkAAFEe8XFVTETjDomoEFfpSFd2yD';
const BYREAL_CRCL_POOL = 'Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa';
const ADDRESSES = {
  program: PROGRAM,
  bbsolPool: BYREAL_BBSOL_POOL,
  crclPool: BYREAL_CRCL_POOL,
  bbsolVault: 'Auxmbn5HnmzzUaaiMkdNAb24uuMsNLuHJqjFAifpcdLq',
  crclVault: '8feVD1rbhaE17kZiWhTssFrC75DUoJUCX9SLZ6C9oxhd',
  crclUsdcVault: '5JcntpKHEy2vyjCiiLY5e4Te1ZVG1zU6pp6ZU667d6tw',
  crclLenderVault: '7AtXXWFRyBS3rSsbX7BHrDgvk8uERrreRYUS45e8QsmE',
  bbsolLenderVault: '5cda5cLwVatEY1z3tJ3LmVe9tzsqCeHv39HtyUtTpNAM',
  bbsolProject0Vault: 'GuZUMyg7mtcPZH3Rzrvd81xuue7N7onNpDJVf6kcW1NF',
  raydiumCrclVault: 'DMQver7kdMua1ANBY1rJPEFCX594zWn81ihv2yMVFEsF',
  raydiumUsdcVault: '8awg4iLSUmmmrkUGgj3T8VuWyvHRPudsLz8skyb3xV92',
  usdcLenderVault: '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB',
  bbsolMint: 'Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B',
  crclMint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1',
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw new Error('configured RPC unavailable');
let id = 0;
async function rpc(method, params) {
  let response;
  try {
    response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
      signal: AbortSignal.timeout(18000),
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  } catch { throw new Error(`${method}: transport failure`); }
  const json = await response.json();
  if (json.error) throw new Error(`${method}: RPC ${json.error.code}: ${json.error.message}`);
  return json.result;
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const key = bytes => new PublicKey(bytes).toBase58();
const bytes = row => row && Buffer.from(row.data[0], 'base64');
function image(row, address) {
  if (!row) return {exists: false};
  const data = bytes(row);
  const out = {exists: true, owner: row.owner, executable: row.executable,
    dataLength: data.length, dataSha256: hash(data)};
  const isKnownMint = [ADDRESSES.bbsolMint, ADDRESSES.crclMint, ADDRESSES.usdcMint].includes(address);
  if (!isKnownMint && (row.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
       row.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72) {
    out.mint = key(data.subarray(0, 32));
    out.authority = key(data.subarray(32, 64));
    out.rawAmount = data.readBigUInt64LE(64).toString();
  }
  return out;
}
function pool(row) {
  if (!row || row.owner !== PROGRAM || bytes(row).length !== 1544) return null;
  const data = bytes(row);
  return {ammConfig: key(data.subarray(9, 41)),
    mint0: key(data.subarray(73, 105)), mint1: key(data.subarray(105, 137)),
    vault0: key(data.subarray(137, 169)), vault1: key(data.subarray(169, 201)),
    observation: key(data.subarray(201, 233)), decimals0: data[233], decimals1: data[234],
    tickSpacing: data.readUInt16LE(235), liquidityRaw: data.readBigUInt64LE(237).toString() + ':' + data.readBigUInt64LE(245).toString(),
    sqrtPriceX64Raw: data.readBigUInt64LE(253).toString() + ':' + data.readBigUInt64LE(261).toString(),
    tickCurrent: data.readInt32LE(269)};
}
async function main() {
  const names = Object.keys(ADDRESSES), addresses = Object.values(ADDRESSES);
  const page = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'finalized'}]);
  const accounts = Object.fromEntries(names.map((name, i) => [name, image(page.value[i], addresses[i])]));
  const pools = {bbsol: pool(page.value[names.indexOf('bbsolPool')]),
    crcl: pool(page.value[names.indexOf('crclPool')])};
  const programDataAddress = key(bytes(page.value[0]).subarray(4, 36));
  const extra = [...new Set([programDataAddress, pools.bbsol?.vault0, pools.bbsol?.vault1,
    pools.crcl?.vault0, pools.crcl?.vault1].filter(Boolean).filter(x => !addresses.includes(x)))];
  const extraPage = await rpc('getMultipleAccounts', [extra, {encoding: 'base64', commitment: 'finalized',
    dataSlice: {offset: 0, length: 165}}]);
  const additionalAccounts = Object.fromEntries(extra.map((address, i) => [address, image(extraPage.value[i], address)]));
  const pd = bytes(extraPage.value[extra.indexOf(programDataAddress)]);
  const result = {capturedAt: new Date().toISOString(), commitment: 'finalized',
    primaryContextSlot: page.context.slot, additionalContextSlot: extraPage.context.slot,
    noTransactionConstructedOrSubmitted: true, programDataAddress,
    programDeploySlot: pd?.readBigUInt64LE(4).toString() || null,
    addresses: ADDRESSES, accounts, pools, additionalAccounts};
  const output = path.join(ROOT, 'byreal-current-readonly-gate.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({output, capturedAt: result.capturedAt, slot: page.context.slot,
    deploySlot: result.programDeploySlot, pools, balances: Object.fromEntries(Object.entries(accounts)
      .filter(([, v]) => v.rawAmount !== undefined).map(([k, v]) => [k, v.rawAmount])),
    additionalAccounts}));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
