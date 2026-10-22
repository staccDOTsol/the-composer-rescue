#!/usr/bin/env node
'use strict';

// Read-only census of every transaction indexed to the currently deployed
// Janus program at or after the current ProgramData deployment slot.  It does
// not sign or submit a transaction.

const fs = require('fs');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = `${DIR}/janusfi-postdeploy-surface.json`;
const PROGRAM = 'JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP';
const DEPLOYMENT_SLOT = 457294564;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('No read-only RPC configured');

let rpcId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${response.status}`);
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

function keysFor(tx) {
  const message = tx.transaction.message;
  return [...(message.accountKeys || message.staticAccountKeys || []),
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || [])].map(String);
}

function privilege(tx, index) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys || message.staticAccountKeys || [];
  const header = message.header;
  const signer = index < header.numRequiredSignatures;
  const writable = signer ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts :
    index < staticKeys.length ? index < staticKeys.length - header.numReadonlyUnsignedAccounts :
      index < staticKeys.length + (tx.meta?.loadedAddresses?.writable || []).length;
  return {signer, writable};
}

function decodeJanus(tx, instruction, level, outerIndex, innerIndex = null) {
  const keys = keysFor(tx);
  if (keys[instruction.programIdIndex] !== PROGRAM) return null;
  const data = Buffer.from(bs58.decode(instruction.data || ''));
  return {level, outerIndex, innerIndex, stackHeight: instruction.stackHeight ?? null,
    opcode: data.length ? data[0] : null, dataLength: data.length, dataHex: data.toString('hex'),
    accounts: (instruction.accounts || []).map((index, position) => ({position, index,
      address: keys[index], ...privilege(tx, index)}))};
}

function summarizeTransaction(signatureRow, tx) {
  if (!tx) return {signature: signatureRow.signature, slot: signatureRow.slot,
    indexedErr: signatureRow.err, unavailable: true, janusInstructions: []};
  const message = tx.transaction.message;
  const topRaw = message.instructions || message.compiledInstructions || [];
  const top = topRaw.map((instruction, index) =>
    decodeJanus(tx, instruction, 'top', index)).filter(Boolean);
  const inner = (tx.meta?.innerInstructions || []).flatMap((group) =>
    (group.instructions || []).map((instruction, index) =>
      decodeJanus(tx, instruction, 'inner', group.index, index)).filter(Boolean));
  const keys = keysFor(tx);
  return {signature: signatureRow.signature, slot: tx.slot, blockTime: tx.blockTime,
    err: tx.meta?.err || null, version: tx.version ?? 'legacy', accountCount: keys.length,
    requiredSigners: keys.slice(0, message.header.numRequiredSignatures),
    topLevelInstructionCount: topRaw.length, janusInstructions: [...top, ...inner]};
}

async function main() {
  const signatures = [];
  let before;
  let pages = 0;
  while (true) {
    const page = await rpc('getSignaturesForAddress', [PROGRAM, {limit: 1000,
      commitment: 'confirmed', ...(before ? {before} : {})}]);
    pages += 1;
    signatures.push(...page.filter((row) => row.slot >= DEPLOYMENT_SLOT));
    if (!page.length || page.at(-1).slot < DEPLOYMENT_SLOT || page.length < 1000) break;
    before = page.at(-1).signature;
  }

  const transactions = [];
  for (let start = 0; start < signatures.length; start += 10) {
    const batch = signatures.slice(start, start + 10);
    const fetched = await Promise.all(batch.map((row) => rpc('getTransaction', [row.signature,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}])));
    for (let index = 0; index < batch.length; index += 1)
      transactions.push(summarizeTransaction(batch[index], fetched[index]));
  }

  const instructions = transactions.flatMap((transaction) =>
    transaction.janusInstructions.map((instruction) => ({signature: transaction.signature,
      slot: transaction.slot, transactionErr: transaction.err, ...instruction})));
  const histogram = {};
  for (const instruction of instructions) {
    const key = `${instruction.level}:opcode=${instruction.opcode}:length=${instruction.dataLength}`;
    histogram[key] = (histogram[key] || 0) + 1;
  }
  const output = {generatedAt: new Date().toISOString(), program: PROGRAM,
    deploymentSlot: DEPLOYMENT_SLOT, readOnly: true, transactionSubmitted: false,
    rpcMethods: ['getSignaturesForAddress', 'getTransaction'], pages,
    summary: {signatureCountAtOrAfterDeployment: signatures.length,
      transactionCount: transactions.length,
      unavailableTransactionCount: transactions.filter((row) => row.unavailable).length,
      transactionsWithJanus: transactions.filter((row) => row.janusInstructions.length).length,
      transactionsWithoutJanus: transactions.filter((row) => !row.janusInstructions.length).length,
      janusInstructionCount: instructions.length,
      successfulTransactionJanusInstructionCount:
        instructions.filter((row) => row.transactionErr === null).length,
      opcode7Length12Count: instructions.filter((row) =>
        row.opcode === 7 && row.dataLength === 12).length,
      otherOpcodeOrLengthCount: instructions.filter((row) =>
        row.opcode !== 7 || row.dataLength !== 12).length,
      byLevelOpcodeLength: histogram},
    signatures, transactions};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, pages, summary: output.summary}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
