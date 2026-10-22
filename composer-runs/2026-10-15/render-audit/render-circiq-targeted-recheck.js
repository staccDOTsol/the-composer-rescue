#!/usr/bin/env node
'use strict';

// Bounded read-only mainnet-beta recheck. No signing or transaction submission.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MOD}/@solana/web3.js`);

const DIR = __dirname;
const OLD = JSON.parse(fs.readFileSync(path.join(DIR, 'render-current-state-and-history.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!URL) throw new Error('missing RPC URL');
const A = OLD.addresses;
const bridgeState = OLD.breaker.owner;
let id = 0;
async function rpc(method, params) {
  const response = await fetch(URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const pk = (b) => new PublicKey(b).toBase58();
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
function decode(address, row) {
  if (!row) return {address, exists: false};
  const data = Buffer.from(row.data[0], 'base64');
  const account = {address, exists: true, owner: row.owner, executable: row.executable,
    dataLength: data.length, dataSha256: hash(data)};
  if (address === A.vault) Object.assign(account, {mint: pk(data.subarray(0, 32)),
    tokenAuthority: pk(data.subarray(32, 64)), rawAmount: data.readBigUInt64LE(64).toString(),
    delegateOption: data.readUInt32LE(72), state: data[108]});
  if (address === A.breakerState) Object.assign(account, {
    discriminatorHex: data.subarray(0, 8).toString('hex'),
    tokenAccount: pk(data.subarray(8, 40)), updateAuthority: pk(data.subarray(40, 72)),
    transferOwner: pk(data.subarray(72, 104)), windowSeconds: data.readBigUInt64LE(104).toString(),
    thresholdKind: data[112], thresholdRaw: data.readBigUInt64LE(113).toString(),
    lastWindowRaw: data.readBigUInt64LE(121).toString(),
  });
  if (address === bridgeState) account.discriminatorHex = data.subarray(0, 8).toString('hex');
  if (address === A.bridge || address === A.breakerProgram) account.programData = pk(data.subarray(4, 36));
  return account;
}
async function main() {
  const names = [A.vault, A.breakerState, bridgeState, A.bridge, A.breakerProgram];
  const accounts = await rpc('getMultipleAccounts', [names, {encoding: 'base64', commitment: 'finalized'}]);
  const decoded = names.map((name, i) => decode(name, accounts.value[i]));
  const [bridgeProgramData, breakerProgramData] = [decoded[3].programData, decoded[4].programData];
  const deploymentRows = await rpc('getMultipleAccounts', [[bridgeProgramData, breakerProgramData],
    {encoding: 'base64', commitment: 'finalized', dataSlice: {offset: 0, length: 45}}]);
  const deployments = Object.fromEntries([['bridge', deploymentRows.value[0]],
    ['breaker', deploymentRows.value[1]]].map(([name, row]) => {
    const data = Buffer.from(row.data[0], 'base64');
    return [name, {programData: name === 'bridge' ? bridgeProgramData : breakerProgramData,
      loaderTag: data.readUInt32LE(0), deploySlot: data.readBigUInt64LE(4).toString(),
      upgradeAuthorityPresent: data[12] === 1}];
  }));
  const signatures = await rpc('getSignaturesForAddress', [A.vault,
    {limit: 5, commitment: 'finalized'}]);
  const output = {generatedAt: new Date().toISOString(), commitment: 'finalized',
    accountContextSlot: accounts.context.slot, deploymentContextSlot: deploymentRows.context.slot,
    safety: {readOnly: true, mainnetTransactionsSubmitted: false},
    accounts: decoded, deployments, latestVaultSignatures: signatures.map((s) =>
      ({signature: s.signature, slot: s.slot, err: s.err}))};
  fs.writeFileSync(path.join(DIR, 'render-circiq-targeted-recheck.json'),
    `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
}
main().catch((e) => {console.error(e.stack || e); process.exitCode = 1;});
