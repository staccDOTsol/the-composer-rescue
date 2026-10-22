#!/usr/bin/env node
'use strict';

// Read-only sampled history mapper. It retrieves signatures and transactions,
// but never signs or submits anything and never records the RPC URL.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const PROGRAM = 'FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP';
const OUT = process.argv[2] || path.join(__dirname, 'history-map.json');
const env = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const rpcUrl = process.env.RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('missing RPC endpoint configuration');

const names = [
  'initialize', 'update_config', 'init_deposit', 'deposit', 'stake_fox_v2',
  'unstake_fox', 'unstake_fox_v2', 'claim', 'auth_unstake_fox',
];
const known = new Map(names.map((name) => [
  crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex'),
  name,
]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 8) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 === attempts) break;
      await sleep(300 * (2 ** attempt));
    }
  }
  throw last;
}

async function allSignatures() {
  const rows = [];
  let before;
  for (let page = 0; page < 50; page += 1) {
    const options = { commitment: 'confirmed', limit: 1000 };
    if (before) options.before = before;
    const batch = await rpc('getSignaturesForAddress', [PROGRAM, options]);
    rows.push(...batch);
    if (batch.length < 1000) break;
    before = batch.at(-1).signature;
  }
  return rows;
}

function selectSamples(rows) {
  const indexes = new Set();
  for (let i = 0; i < Math.min(500, rows.length); i += 1) indexes.add(i);
  for (let i = Math.max(0, rows.length - 500); i < rows.length; i += 1) indexes.add(i);
  for (let i = 0; i < rows.length; i += 10) indexes.add(i);
  // Include every successful entry around the first transaction after the current deployment.
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].slot >= 415920556 && rows[i].slot <= 415950000 && rows[i].err === null) indexes.add(i);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => ({ index, ...rows[index] }));
}

async function mapLimit(items, concurrency, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      result[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return result;
}

function accountFlags(message, address) {
  const item = message.accountKeys.find((entry) => (entry.pubkey || entry) === address);
  return item && typeof item === 'object' ? {
    signer: Boolean(item.signer),
    writable: Boolean(item.writable),
    source: item.source,
  } : null;
}

async function inspect(sample) {
  const tx = await rpc('getTransaction', [sample.signature, {
    encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  if (!tx) return { ...sample, available: false, instructions: [] };
  const instructions = [];
  for (const [outerIndex, instruction] of tx.transaction.message.instructions.entries()) {
    if (instruction.programId !== PROGRAM || !instruction.data) continue;
    const raw = Buffer.from(bs58.decode(instruction.data));
    const discriminator = raw.subarray(0, 8).toString('hex');
    instructions.push({
      outerIndex,
      discriminator,
      name: known.get(discriminator) || null,
      dataHex: raw.toString('hex'),
      dataLength: raw.length,
      accounts: instruction.accounts.map((address) => ({
        address,
        ...accountFlags(tx.transaction.message, address),
      })),
    });
  }
  return {
    ...sample,
    available: true,
    blockTime: tx.blockTime,
    transactionErr: tx.meta?.err ?? null,
    instructions,
    logMessages: tx.meta?.logMessages ?? [],
    innerInstructions: tx.meta?.innerInstructions ?? [],
    preTokenBalances: tx.meta?.preTokenBalances ?? [],
    postTokenBalances: tx.meta?.postTokenBalances ?? [],
  };
}

async function main() {
  const signatures = await allSignatures();
  const selected = selectSamples(signatures);
  const inspected = await mapLimit(selected, 8, inspect);
  const counts = new Map();
  const firstByName = new Map();
  const successfulByName = new Map();
  for (const row of inspected) {
    for (const instruction of row.instructions) {
      const key = instruction.name || instruction.discriminator;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!firstByName.has(key)) firstByName.set(key, { ...row, instructions: [instruction] });
      if (row.transactionErr === null && !successfulByName.has(key)) {
        successfulByName.set(key, { ...row, instructions: [instruction] });
      }
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    noTransactionsSubmitted: true,
    programId: PROGRAM,
    signaturePopulation: {
      count: signatures.length,
      newest: signatures[0] || null,
      oldest: signatures.at(-1) || null,
    },
    sampling: {
      selectedCount: selected.length,
      rule: 'newest 500, oldest 500, every tenth signature, and successful post-deployment-window entries',
    },
    knownDiscriminators: Object.fromEntries([...known].map(([hex, name]) => [name, hex])),
    sampledCounts: Object.fromEntries([...counts].sort()),
    firstExamples: Object.fromEntries([...firstByName].sort()),
    successfulExamples: Object.fromEntries([...successfulByName].sort()),
    inspected,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    signatureCount: signatures.length,
    sampledCount: selected.length,
    sampledCounts: output.sampledCounts,
    successfulExamples: Object.fromEntries(Object.entries(output.successfulExamples).map(([name, row]) => [name, {
      signature: row.signature,
      slot: row.slot,
      dataHex: row.instructions[0].dataHex,
      accounts: row.instructions[0].accounts,
    }])),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
