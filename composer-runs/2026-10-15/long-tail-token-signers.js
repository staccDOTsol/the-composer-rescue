#!/usr/bin/env node
// Bounded read-only custody -> invoking-program signer attribution sample.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-token-authority-census.raw.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const universe = new Map(fs.readFileSync(path.join(DIR, 'mainnet-program-universe.csv'), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [programId, loaderClass, owner, programdataAddress, observedSlot] = line.split(',');
    return [programId, { loaderClass, owner, programdataAddress, observedSlot: Number(observedSlot) }];
  }));
const queue = new Set(JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-high-value-queue.json')))
  .map((row) => row.program_id));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let seq = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }) });
      if (response.status === 429 || response.status >= 500) throw new Error(`retryable HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(`${method}: ${data.error.code} ${data.error.message}`);
      return data.result;
    } catch (error) {
      last = error;
      if (attempt < 4) await sleep(300 * 2 ** attempt);
    }
  }
  throw last;
}
async function mapLimit(items, limit, fn) {
  let next = 0;
  const out = Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); }
      catch (error) { out[i] = { error: String(error.message || error) }; }
    }
  }));
  return out;
}
function summarizeTx(result, authority, signature, vaultAddress) {
  if (!result) return { signature, missing: true };
  const top = result.transaction?.message?.instructions || [];
  const groups = result.meta?.innerInstructions || [];
  const mentions = [];
  for (const group of groups) for (const ix of group.instructions || []) {
    const info = ix.parsed?.info || {};
    if (JSON.stringify(info).includes(authority) || JSON.stringify(info).includes(vaultAddress)) {
      mentions.push({ parentProgramId: top[group.index]?.programId || null,
        programId: ix.programId, type: ix.parsed?.type || null, info,
        stackHeight: ix.stackHeight ?? null });
    }
  }
  return { signature, slot: result.slot, blockTime: result.blockTime, err: result.meta?.err,
    topLevelPrograms: top.map((ix) => ix.programId), innerMentions: mentions.slice(0, 12) };
}
async function main() {
  const limit = Number(process.argv[2] || 100);
  const minUsd = Number(process.argv[3] || 1000000);
  const candidates = source.authorities.filter((row) => !row.onCurve && row.pricedGrossUsd >= minUsd)
    .slice(0, limit).map((row) => ({ authority: row.authority, pricedGrossUsd: row.pricedGrossUsd,
      programIdByStateOwner: row.directExecutableOwner, programIsOnKnownQueue: queue.has(row.directExecutableOwner),
      stateOwner: row.authorityAccount?.owner || null, stateAccountExists: row.authorityAccount?.exists || false,
      executable: row.directExecutableOwner ? universe.get(row.directExecutableOwner) || null : null,
      tokenAccounts: row.tokenAccounts.slice(0, 4) }));
  const indexed = await mapLimit(candidates, 6, async (row) => {
    const vaultAddress = row.tokenAccounts[0]?.address;
    if (!vaultAddress) return { signatures: [] };
    const signatures = await rpc('getSignaturesForAddress', [vaultAddress, { limit: 10, commitment: 'confirmed' }]);
    return { vaultAddress, signatures: signatures.filter((item) => !item.err).slice(0, 2)
      .map((item) => ({ signature: item.signature, slot: item.slot, blockTime: item.blockTime })) };
  });
  candidates.forEach((row, i) => { row.history = indexed[i]; });
  const txTargets = candidates.filter((row) => row.history?.signatures?.length);
  const txs = await mapLimit(txTargets, 4, async (row) => summarizeTx(
    await rpc('getTransaction', [row.history.signatures[0].signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 }]), row.authority, row.history.signatures[0].signature, row.history.vaultAddress));
  txTargets.forEach((row, i) => { row.recentTransaction = txs[i]; });
  const report = { generatedAt: new Date().toISOString(), sourceCompletedAt: source.completedAt,
    sourceObservationSlots: source.observationSlots, sourceDenominator: source.denominator,
    requestedTopAuthorities: limit, minUsd, sampledAuthorities: candidates.length, withHistory: txTargets.length,
    candidates };
  fs.writeFileSync(path.join(DIR, 'long-tail-attribution-token-signers.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ sampled: candidates.length, withHistory: txTargets.length,
    directUnknown: candidates.filter((row) => row.programIdByStateOwner && !row.programIsOnKnownQueue)
      .slice(0, 20).map((row) => ({ authority: row.authority, usd: row.pricedGrossUsd,
        program: row.programIdByStateOwner, symbol: row.tokenAccounts[0]?.symbol,
        recentTopLevel: row.recentTransaction?.topLevelPrograms || null })) }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
