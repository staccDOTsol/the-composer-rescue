#!/usr/bin/env node
'use strict';
// Read-only source transaction and live pool-account inspection; never submits.
const fs = require('fs');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
const PROGRAM = 'goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE';
const SIG = process.argv[2] || 'sMjvq1VE5A6iMxWEQfTPzdyG7Qmast6PK4GAD3HjesC6vxFLc5ZDeysaG12kMXNQbuvjc7hUN5Ly3Q9JntQNLgt';
let n = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(method + ': ' + JSON.stringify(result.error));
  return result.result;
}
async function main() {
  const tx = await rpc('getTransaction', [SIG, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  const m = tx.transaction.message, l = tx.meta.loadedAddresses || { writable: [], readonly: [] };
  const keys = [...m.accountKeys, ...l.writable, ...l.readonly];
  const h = m.header;
  const writable = j => j < m.accountKeys.length ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < m.accountKeys.length - h.numReadonlyUnsignedAccounts : j < m.accountKeys.length + l.writable.length;
  const goon = (tx.meta.innerInstructions || []).flatMap(g => g.instructions.map(ix => ({ ...ix, parentIndex: g.index })))
    .filter(ix => keys[ix.programIdIndex] === PROGRAM)
    .map(ix => ({ parentIndex: ix.parentIndex, stackHeight: ix.stackHeight, dataHex: Buffer.from(bs58.decode(ix.data)).toString('hex'),
      accounts: ix.accounts.map((j, i) => ({ i, key: keys[j], signer: j < h.numRequiredSignatures, writable: writable(j) })) }));
  const out = { signature: SIG, slot: tx.slot, success: !tx.meta.err,
    topLevel: m.instructions.map((ix, i) => ({ i, program: keys[ix.programIdIndex], dataLen: Buffer.from(bs58.decode(ix.data)).length })),
    goon, logs: tx.meta.logMessages.filter(s => s.includes(PROGRAM) || s.includes('Instruction:')) };
  fs.writeFileSync(__dirname + '/goonfi-v2-source-shape.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
