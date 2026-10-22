#!/usr/bin/env node
// Read-only current-deployment instruction census for the Loopscale program.
// RPC methods are limited to getSignaturesForAddress and getTransaction.

const fs = require('fs');

const PROGRAM = '1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78';
const DEPLOY_SLOT = 440130674;
const OUTPUT = `${__dirname}/1oop-history-scan.json`;
const PAGE_LIMIT = 1000;
const MAX_SIGNATURES = 5000;
const SAMPLE_LIMIT = 5;

function rpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const envPath = '/tmp/composer-helius-only.env';
  const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL is unavailable');
  return env.RPC_URL;
}

const ENDPOINT = rpcUrl();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`${method}: retryable HTTP ${response.status}`);
      }
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt === 5) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function transactionBatch(signatures) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const request = signatures.map((signature, id) => ({
        jsonrpc: '2.0', id,
        method: 'getTransaction',
        params: [signature, {
          encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
        }],
      }));
      const response = await fetch(ENDPOINT, {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`getTransaction batch: retryable HTTP ${response.status}`);
      }
      if (!Array.isArray(body)) throw new Error(`getTransaction batch: ${JSON.stringify(body)}`);
      const byId = new Map(body.map((entry) => [entry.id, entry]));
      return signatures.map((signature, id) => ({signature, response: byId.get(id)}));
    } catch (error) {
      lastError = error;
      if (attempt === 5) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError;
}

function signerKeys(transaction) {
  return transaction?.transaction?.message?.accountKeys
    ?.filter((entry) => entry.signer)
    .map((entry) => entry.pubkey) || [];
}

function instructionNames(transaction) {
  const names = [];
  for (const log of transaction?.meta?.logMessages || []) {
    const match = /^Program log: Instruction: (.+)$/.exec(log);
    if (match) names.push(match[1]);
  }
  return names;
}

async function main() {
  const counts = {};
  const samples = {};
  let before;
  let oldestSlot = null;
  let signatureCount = 0;
  let transactionCount = 0;
  let reachedDeployment = false;

  while (signatureCount < MAX_SIGNATURES && !reachedDeployment) {
    const options = {limit: Math.min(PAGE_LIMIT, MAX_SIGNATURES - signatureCount), commitment: 'confirmed'};
    if (before) options.before = before;
    const signatures = await rpc('getSignaturesForAddress', [PROGRAM, options]);
    if (!signatures.length) break;
    signatureCount += signatures.length;
    before = signatures[signatures.length - 1].signature;
    oldestSlot = signatures[signatures.length - 1].slot;
    reachedDeployment = oldestSlot <= DEPLOY_SLOT;

    const current = signatures.filter((entry) => entry.slot >= DEPLOY_SLOT && entry.err === null);
    for (let offset = 0; offset < current.length; offset += 50) {
      const slice = current.slice(offset, offset + 50);
      const batch = await transactionBatch(slice.map((entry) => entry.signature));
      for (const {signature, response} of batch) {
        if (response?.error || !response?.result) continue;
        const transaction = response.result;
        transactionCount += 1;
        const names = instructionNames(transaction);
        for (const name of names) {
          counts[name] = (counts[name] || 0) + 1;
          samples[name] ||= [];
          if (samples[name].length < SAMPLE_LIMIT) {
            samples[name].push({
              signature,
              slot: transaction.slot,
              blockTime: transaction.blockTime,
              topLevelError: transaction.meta?.err ?? null,
              signers: signerKeys(transaction),
              instructionNames: names,
            });
          }
        }
      }
      await sleep(120);
    }
    process.stderr.write(`scanned ${signatureCount} signatures; oldest slot ${oldestSlot}\n`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    programId: PROGRAM,
    deploymentSlotFloor: DEPLOY_SLOT,
    rpcMethods: ['getSignaturesForAddress', 'getTransaction'],
    readOnly: true,
    signaturesScanned: signatureCount,
    successfulTransactionsDecoded: transactionCount,
    oldestSlot,
    reachedDeployment,
    maxSignatures: MAX_SIGNATURES,
    instructionLogCounts: counts,
    samples,
    limitations: [
      'Anchor instruction logs include nested self-CPI calls, so counts are invocations, not unique transactions.',
      'A bounded signature scan is not proof that an instruction never executed outside the scanned window.',
    ],
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUTPUT, signaturesScanned: signatureCount, oldestSlot, reachedDeployment, instructionLogCounts: counts}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
