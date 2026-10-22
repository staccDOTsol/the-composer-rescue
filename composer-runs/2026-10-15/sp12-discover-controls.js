#!/usr/bin/env node
// Read-only discovery of successful current-SP12 instruction controls.
const fs = require('fs');
const path = require('path');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const PROGRAM = 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY';
const names = {
  0: 'initialize', 1: 'addValidatorToPool', 2: 'removeValidatorFromPool',
  3: 'decreaseValidatorStake', 4: 'increaseValidatorStake', 5: 'setPreferredValidator',
  6: 'updateValidatorListBalance', 7: 'updateStakePoolBalance',
  8: 'cleanupRemovedValidatorEntries', 9: 'depositStake', 10: 'withdrawStake',
  11: 'setManager', 12: 'setFee', 13: 'setStaker', 14: 'depositSol',
  15: 'setFundingAuthority', 16: 'withdrawSol', 17: 'createTokenMetadata',
  18: 'updateTokenMetadata', 19: 'increaseAdditionalValidatorStake',
  20: 'decreaseAdditionalValidatorStake', 21: 'decreaseValidatorStakeWithReserve',
  22: 'redelegate',
};
const envFile = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env']
  .find((candidate) => fs.existsSync(candidate));
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = (env.RPC_URL || env.HEAVY_RPC_URL).replace(/^['"]|['"]$/g, '');

async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcBatch(requests) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(requests.map((request, id) => ({jsonrpc: '2.0', id, ...request})))});
  if (!response.ok) throw new Error(`batch HTTP ${response.status}`);
  const body = await response.json();
  return body.sort((a, b) => a.id - b.id).map((row) => row.error ? null : row.result);
}

function allKeys(tx) {
  const staticKeys = tx.transaction.message.accountKeys.map((key) =>
    typeof key === 'string' ? key : key.pubkey);
  return [...staticKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
}

function decodeInstruction(ix, keys, inner, parentProgramId) {
  const programId = ix.programId || keys[ix.programIdIndex];
  if (programId !== PROGRAM || !ix.data) return null;
  let data;
  try { data = Buffer.from(bs58.decode(ix.data)); } catch (_) { return null; }
  const accounts = (ix.accounts || []).map((key) => typeof key === 'number' ? keys[key] : key);
  return {
    inner,
    parentProgramId: parentProgramId || null,
    stackHeight: ix.stackHeight ?? null,
    discriminator: data[0] ?? null,
    name: names[data[0]] || `unknown_${data[0]}`,
    dataHex: data.toString('hex'),
    accounts,
  };
}

function txInvocations(signature, tx) {
  if (!tx || tx.meta?.err) return [];
  const keys = allKeys(tx);
  const top = tx.transaction.message.instructions || [];
  const rows = [];
  for (const ix of top) {
    const decoded = decodeInstruction(ix, keys, false, null);
    if (decoded) rows.push(decoded);
  }
  for (const group of tx.meta.innerInstructions || []) {
    const parent = top[group.index];
    const parentProgramId = parent?.programId || keys[parent?.programIdIndex];
    for (const ix of group.instructions || []) {
      const decoded = decodeInstruction(ix, keys, true, parentProgramId);
      if (decoded) rows.push(decoded);
    }
  }
  return rows.map((row) => ({signature, slot: tx.slot, blockTime: tx.blockTime,
    messageVersion: tx.version ?? 'legacy', fee: tx.meta.fee, computeUnitsConsumed: tx.meta.computeUnitsConsumed ?? null,
    ...row}));
}

async function main() {
  const pageLimit = Math.max(1, Math.min(40, Number(process.env.SIGNATURE_PAGES || '12')));
  const signatures = [];
  let before;
  for (let page = 0; page < pageLimit; page += 1) {
    const config = {limit: 1000, commitment: 'confirmed', ...(before ? {before} : {})};
    const rows = await rpc('getSignaturesForAddress', [PROGRAM, config]);
    signatures.push(...rows);
    if (rows.length < 1000) break;
    before = rows[rows.length - 1].signature;
  }
  const invocations = [];
  let successfulTransactions = 0;
  for (let start = 0; start < signatures.length; start += 40) {
    const batch = signatures.slice(start, start + 40);
    const txs = await rpcBatch(batch.map((row) => ({method: 'getTransaction', params: [row.signature,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]})));
    for (let index = 0; index < txs.length; index += 1) {
      if (txs[index]?.meta?.err === null) successfulTransactions += 1;
      invocations.push(...txInvocations(batch[index].signature, txs[index]));
    }
  }
  const byName = {};
  for (const row of invocations) {
    if (!byName[row.name]) byName[row.name] = [];
    if (byName[row.name].length < 12) byName[row.name].push(row);
  }
  const output = {
    generatedAt: new Date().toISOString(), programId: PROGRAM,
    signaturesScanned: signatures.length, successfulTransactions, invocationCount: invocations.length,
    observedInstructionCounts: Object.fromEntries(Object.entries(invocations.reduce((acc, row) => {
      acc[row.name] = (acc[row.name] || 0) + 1; return acc;
    }, {})).sort((a, b) => b[1] - a[1])),
    recentSuccessfulByInstruction: byName,
  };
  fs.writeFileSync(path.join(DIR, 'sp12-successful-controls.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({signaturesScanned: output.signaturesScanned,
    successfulTransactions, invocationCount: invocations.length,
    observedInstructionCounts: output.observedInstructionCounts}, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
