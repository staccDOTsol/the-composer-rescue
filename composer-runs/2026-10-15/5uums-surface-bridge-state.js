#!/usr/bin/env node
'use strict';
// Read-only census of every current account owned by the 5UuMS bridge program.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const PROGRAM = '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8').split(/\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.RPC_URL || env.HEAVY_RPC_URL;
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const body = await response.json();
  if (!response.ok || body.error) throw Error(`${method}: ${body.error?.message || `HTTP ${response.status}`}`);
  return body.result;
}
function decode(address, account) {
  const bytes = Buffer.from(account.data[0], 'base64');
  const entry = { address, owner: account.owner, lamports: account.lamports, executable: account.executable, dataLength: bytes.length, discriminatorHex: bytes.subarray(0, 8).toString('hex') };
  if (bytes.length === 73) {
    entry.pubkeyAt8 = new PublicKey(bytes.subarray(8, 40)).toBase58();
    entry.pubkeyAt40 = new PublicKey(bytes.subarray(40, 72)).toBase58();
    entry.lastByte = bytes[72];
  }
  return entry;
}
async function main() {
  const startedAt = new Date().toISOString();
  const firstSlot = await rpc('getSlot', [{ commitment: 'finalized' }]);
  const result = await rpc('getProgramAccounts', [PROGRAM, { encoding: 'base64', commitment: 'finalized', withContext: true }]);
  const censusSlot = result.context?.slot ?? null;
  const values = result.value || result;
  const accounts = values.map(({ pubkey, account }) => decode(pubkey, account));
  if (accounts.some(a => a.owner !== PROGRAM)) throw Error('GPA owner mismatch');
  const lastSlot = await rpc('getSlot', [{ commitment: 'finalized' }]);
  const out = { method: 'unfiltered getProgramAccounts on bridge program (all currently program-owned accounts)', commitment: 'finalized', startedAt, finishedAt: new Date().toISOString(), firstSlot, censusSlot, lastSlot, program: PROGRAM, count: accounts.length, accounts };
  fs.writeFileSync(path.join(__dirname, '5uums-surface-bridge-state.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
