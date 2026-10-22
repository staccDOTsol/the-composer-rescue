#!/usr/bin/env node
'use strict';

// Read-only history sweep for the current deployment. This intentionally starts
// after the 50,000-signature window already recorded in history-map.json, then
// walks back to the deployment slot. It samples all successful transactions at
// regular intervals and every transaction near deployment, looking specifically
// for the rare AuthUnstakeFox discriminator. No transaction is signed/submitted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const PROGRAM = 'FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP';
const DEPLOYMENT_SLOT = 415920556;
const START_BEFORE = '55sv15xQbWYQBeieh8jsXwiX1krT6PqRf8pSPC1dKFMAzTAHvLtw83V5ML7prnZNJKM1LPAMSQEaULPxfXXySYcH';
const SAMPLE_STRIDE = Number(process.env.SAMPLE_STRIDE || 20);
const OUT = process.argv[2] || path.join(__dirname, 'auth-unstake-history.json');
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
const AUTH_HEX = [...known].find(([, name]) => name === 'auth_unstake_fox')[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 9) {
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
      await sleep(350 * (2 ** attempt));
    }
  }
  throw last;
}

async function pageSignatures() {
  const rows = [];
  const pageSummaries = [];
  let before = START_BEFORE;
  for (let page = 0; page < 600; page += 1) {
    const batch = await rpc('getSignaturesForAddress', [PROGRAM, {
      commitment: 'confirmed', limit: 1000, before,
    }]);
    if (!batch.length) break;
    rows.push(...batch);
    pageSummaries.push({
      page,
      count: batch.length,
      newestSlot: batch[0].slot,
      oldestSlot: batch.at(-1).slot,
      newestSignature: batch[0].signature,
      oldestSignature: batch.at(-1).signature,
    });
    before = batch.at(-1).signature;
    if (batch.at(-1).slot < DEPLOYMENT_SLOT) break;
    if (batch.length < 1000) break;
  }
  return { rows, pageSummaries };
}

function select(rows) {
  const indexes = new Set();
  for (let i = 0; i < rows.length; i += SAMPLE_STRIDE) {
    if (rows[i].err === null) indexes.add(i);
  }
  // Cover the deployment boundary completely, where the current binary first
  // became executable and rare initializer/admin calls are most likely.
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].slot >= DEPLOYMENT_SLOT - 25000 && rows[i].slot <= DEPLOYMENT_SLOT + 100000) indexes.add(i);
  }
  // Fully cover both ends of this continuation window.
  for (let i = 0; i < Math.min(500, rows.length); i += 1) indexes.add(i);
  for (let i = Math.max(0, rows.length - 500); i < rows.length; i += 1) indexes.add(i);
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

function flags(message, address) {
  const key = message.accountKeys.find((entry) => (entry.pubkey || entry) === address);
  return key && typeof key === 'object' ? { signer: Boolean(key.signer), writable: Boolean(key.writable) } : {};
}

async function inspect(row) {
  const tx = await rpc('getTransaction', [row.signature, {
    encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  if (!tx) return { index: row.index, signature: row.signature, slot: row.slot, available: false, instructions: [] };
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
      accounts: instruction.accounts.map((address) => ({ address, ...flags(tx.transaction.message, address) })),
    });
  }
  return {
    index: row.index,
    signature: row.signature,
    slot: row.slot,
    blockTime: tx.blockTime,
    available: true,
    transactionErr: tx.meta?.err ?? null,
    instructions,
    logMessages: instructions.some((ix) => ix.discriminator === AUTH_HEX) ? (tx.meta?.logMessages ?? []) : undefined,
    innerInstructions: instructions.some((ix) => ix.discriminator === AUTH_HEX) ? (tx.meta?.innerInstructions ?? []) : undefined,
    preTokenBalances: instructions.some((ix) => ix.discriminator === AUTH_HEX) ? (tx.meta?.preTokenBalances ?? []) : undefined,
    postTokenBalances: instructions.some((ix) => ix.discriminator === AUTH_HEX) ? (tx.meta?.postTokenBalances ?? []) : undefined,
  };
}

async function main() {
  const { rows, pageSummaries } = await pageSignatures();
  const selected = select(rows);
  const inspected = await mapLimit(selected, 12, inspect);
  const counts = {};
  const authMatches = [];
  const examples = {};
  for (const row of inspected) {
    for (const instruction of row.instructions) {
      const key = instruction.name || instruction.discriminator;
      counts[key] = (counts[key] || 0) + 1;
      if (!examples[key] && row.transactionErr === null) examples[key] = { ...row, instructions: [instruction] };
      if (instruction.discriminator === AUTH_HEX) authMatches.push({ ...row, instructions: [instruction] });
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noTransactionsSubmitted: true,
    programId: PROGRAM,
    currentDeploymentSlot: DEPLOYMENT_SLOT,
    continuationAfterSignature: START_BEFORE,
    population: {
      continuationCount: rows.length,
      newest: rows[0] || null,
      oldest: rows.at(-1) || null,
      crossedDeploymentSlot: Boolean(rows.length && rows.at(-1).slot < DEPLOYMENT_SLOT),
      pageSummaries,
    },
    sampling: {
      stride: SAMPLE_STRIDE,
      selectedCount: selected.length,
      fullCoverageRule: `slots ${DEPLOYMENT_SLOT - 25000} through ${DEPLOYMENT_SLOT + 100000}, plus first/last 500`,
    },
    knownDiscriminators: Object.fromEntries([...known].map(([hex, name]) => [name, hex])),
    sampledCounts: counts,
    authUnstakeMatches: authMatches,
    successfulExamples: examples,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    continuationCount: rows.length,
    oldest: output.population.oldest,
    crossedDeploymentSlot: output.population.crossedDeploymentSlot,
    selectedCount: selected.length,
    sampledCounts: counts,
    authUnstakeMatchCount: authMatches.length,
    authUnstakeMatches: authMatches.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      transactionErr: row.transactionErr,
      instruction: row.instructions[0],
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
