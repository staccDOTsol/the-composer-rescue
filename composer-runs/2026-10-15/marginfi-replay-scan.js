#!/usr/bin/env node

// Read-only: finds confirmed marginfi controls and replays their signed wire
// bytes only through simulateTransaction. It never calls sendTransaction.
const fs = require('fs');

const PROGRAM_ID = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const rpcUrl = process.env.RPC_URL;
const outputPath = process.env.OUTPUT_PATH;
const maxSignatures = Number(process.env.MAX_SIGNATURES || 6000);
const concurrency = Number(process.env.CONCURRENCY || 12);
const targets = new Set((process.env.TARGETS || [
  'LendingAccountBorrow',
  'LendingAccountWithdraw',
  'LendingAccountRepay',
  'LendingAccountLiquidate',
  'StartLiquidation',
  'EndLiquidation',
  'LendingPoolCollectBankFees',
  'LendingPoolCollectBankPremiumFees',
].join(',')).split(',').filter(Boolean));

if (!rpcUrl) throw new Error('RPC_URL is required');
if (!outputPath) throw new Error('OUTPUT_PATH is required');

let rpcId = 0;
async function rpc(method, params, retries = 4) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    if (response.ok) {
      const body = await response.json();
      if (!body.error) return body.result;
      if (attempt >= retries) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    } else if (attempt >= retries) {
      throw new Error(`${method}: HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }
}

function instructionNames(logs) {
  const names = [];
  for (const line of logs || []) {
    const match = /^Program log: Instruction: (.+)$/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

function tokenDeltas(meta) {
  const before = new Map((meta.preTokenBalances || []).map((row) => [row.accountIndex, row]));
  const after = new Map((meta.postTokenBalances || []).map((row) => [row.accountIndex, row]));
  return [...new Set([...before.keys(), ...after.keys()])].map((accountIndex) => {
    const pre = before.get(accountIndex);
    const post = after.get(accountIndex);
    const preRaw = BigInt(pre?.uiTokenAmount?.amount || 0);
    const postRaw = BigInt(post?.uiTokenAmount?.amount || 0);
    return {
      accountIndex,
      mint: post?.mint || pre?.mint,
      owner: post?.owner || pre?.owner || null,
      rawDelta: (postRaw - preRaw).toString(),
    };
  }).filter((row) => row.rawDelta !== '0');
}

async function main() {
  const signatureRows = [];
  let before;
  while (signatureRows.length < maxSignatures) {
    const limit = Math.min(1000, maxSignatures - signatureRows.length);
    const page = await rpc('getSignaturesForAddress', [PROGRAM_ID, {limit, ...(before ? {before} : {})}]);
    if (!page.length) break;
    signatureRows.push(...page.filter((row) => !row.err));
    before = page.at(-1).signature;
    if (page.length < limit) break;
  }

  const successfulReplays = Object.create(null);
  const attemptedReplays = Object.fromEntries([...targets].map((name) => [name, []]));
  const historicalControls = Object.create(null);

  for (let offset = 0; offset < signatureRows.length; offset += concurrency) {
    const batch = signatureRows.slice(offset, offset + concurrency);
    const transactions = await Promise.all(batch.map(async (row) => ({
      row,
      tx: await rpc('getTransaction', [row.signature, {encoding: 'base64', maxSupportedTransactionVersion: 1}]),
    })));

    for (const {row, tx} of transactions) {
      if (!tx?.meta || tx.meta.err) continue;
      const names = instructionNames(tx.meta.logMessages);
      const matched = [...targets].filter((name) => names.includes(name));
      if (!matched.length) continue;
      for (const name of matched) {
        historicalControls[name] ||= {
          signature: row.signature,
          slot: row.slot,
          blockTime: row.blockTime,
          instructions: names,
          tokenDeltas: tokenDeltas(tx.meta),
        };
      }

      if (matched.every((name) => successfulReplays[name])) continue;
      const simulation = await rpc('simulateTransaction', [tx.transaction[0], {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'processed',
        innerInstructions: true,
      }]);
      const simNames = instructionNames(simulation.value.logs);
      for (const name of matched) {
        const attempt = {
          signature: row.signature,
          slot: row.slot,
          blockTime: row.blockTime,
          err: simulation.value.err,
          unitsConsumed: simulation.value.unitsConsumed ?? null,
          instructionsObserved: simNames,
          relevantLogs: (simulation.value.logs || []).filter((line) =>
            line.includes('Instruction:') || line.includes('AnchorError') || line.includes('failed'),
          ).slice(-24),
        };
        if (attemptedReplays[name].length < 12) attemptedReplays[name].push(attempt);
        if (!simulation.value.err && simNames.includes(name)) successfulReplays[name] ||= attempt;
      }
    }
    if ([...targets].every((name) => successfulReplays[name])) break;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    program: PROGRAM_ID,
    signaturesScanned: signatureRows.length,
    historicalControls,
    successfulReplays,
    attemptedReplays,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    signaturesScanned: signatureRows.length,
    historical: Object.keys(historicalControls),
    successful: Object.keys(successfulReplays),
    attempted: Object.fromEntries(Object.entries(attemptedReplays).map(([key, value]) => [key, value.length])),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
