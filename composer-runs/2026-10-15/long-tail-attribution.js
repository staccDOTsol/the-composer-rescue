#!/usr/bin/env node
// Bounded, read-only candidate mapping from observed stake withdraw authorities.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const source = JSON.parse(fs.readFileSync(path.join(DIR, 'native-stake-authority-census.json')));
const universe = new Map(fs.readFileSync(path.join(DIR, 'mainnet-program-universe.csv'), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [programId, loaderClass, owner, programdataAddress, observedSlot] = line.split(',');
    return [programId, { loaderClass, owner, programdataAddress, observedSlot: Number(observedSlot) }];
  }));
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
function compactInstruction(ix) {
  const parsed = ix.parsed || null;
  return { programId: ix.programId, program: ix.program, stackHeight: ix.stackHeight ?? null,
    type: parsed?.type || null, info: parsed?.info || null, accounts: ix.accounts || null };
}
function summarizeTx(result, authority, signature) {
  if (!result) return { signature, missing: true };
  const tx = result.transaction || {};
  const msg = tx.message || {};
  const meta = result.meta || {};
  const keys = (msg.accountKeys || []).map((k) => typeof k === 'string' ? k : k.pubkey);
  const topLevel = (msg.instructions || []).map(compactInstruction);
  const groups = (meta.innerInstructions || []).map((group) => ({
    index: group.index,
    parentProgramId: topLevel[group.index]?.programId || null,
    instructions: (group.instructions || []).map(compactInstruction),
  }));
  const mentions = [];
  for (const group of groups) for (const ix of group.instructions) {
    const info = ix.info || {};
    if (JSON.stringify(info).includes(authority) || (ix.accounts || []).includes(authority))
      mentions.push({ parentProgramId: group.parentProgramId, inner: ix });
  }
  return { signature, slot: result.slot, blockTime: result.blockTime, err: meta.err,
    accountKeys: keys, topLevel, innerMentionCount: mentions.length, innerMentions: mentions.slice(0, 8),
    // A complete parsed transaction is fetched but only compact evidence is retained.
  };
}
async function main() {
  const limit = Number(process.argv[2] || 100);
  const groups = source.retainedWithdrawerGroups.slice(0, limit).map((group) => ({
    authority: group.authority, sol: group.sol, accountCount: group.accountCount,
    onCurve: PublicKey.isOnCurve(new PublicKey(group.authority).toBytes()),
    exampleStakeAccounts: group.examples.slice(0, 3).map((row) => row.address),
  }));
  const offCurve = groups.filter((group) => !group.onCurve);
  const accountResults = await Promise.all(Array.from({ length: Math.ceil(offCurve.length / 100) }, (_, i) =>
    rpc('getMultipleAccounts', [offCurve.slice(i * 100, i * 100 + 100).map((group) => group.authority),
      { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }] )));
  for (let i = 0; i < offCurve.length; i += 1) {
    const info = accountResults[Math.floor(i / 100)].value[i % 100];
    offCurve[i].authorityAccount = info ? { owner: info.owner, lamports: info.lamports, executable: info.executable,
      space: info.space, ownerIsExecutable: universe.has(info.owner) } : { exists: false };
  }
  const signatures = await mapLimit(offCurve, 5, async (group) => {
    let indexedAddress = group.authority;
    let rows = await rpc('getSignaturesForAddress', [indexedAddress, { limit: 5, commitment: 'confirmed' }]);
    if (!rows.some((row) => !row.err) && group.exampleStakeAccounts[0]) {
      indexedAddress = group.exampleStakeAccounts[0];
      rows = await rpc('getSignaturesForAddress', [indexedAddress, { limit: 10, commitment: 'confirmed' }]);
    }
    return rows.filter((row) => !row.err).map((row) => ({ signature: row.signature, slot: row.slot,
      blockTime: row.blockTime, indexedAddress })).slice(0, 2);
  });
  const withHistory = offCurve.map((group, index) => ({ ...group, signatures: signatures[index] }));
  const txTargets = withHistory.filter((group) => Array.isArray(group.signatures) && group.signatures.length);
  const transactions = await mapLimit(txTargets, 4, async (group) => {
    const signature = group.signatures[0].signature;
    const result = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 }]);
    return summarizeTx(result, group.authority, signature);
  });
  txTargets.forEach((group, index) => { group.recentTransaction = transactions[index]; });
  const report = { generatedAt: new Date().toISOString(), sourceGeneratedAt: source.generatedAt,
    sourceCompletedShards: source.completedShards.length, sourceRequestedShards: source.requestedShardCount,
    sourceContextSlotMin: source.contextSlotMin, sourceContextSlotMax: source.contextSlotMax,
    requestedTopGroups: limit, offCurveGroups: offCurve.length, candidates: withHistory };
  fs.writeFileSync(path.join(DIR, 'long-tail-attribution-stake-sample.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ requestedTopGroups: limit, offCurveGroups: offCurve.length,
    historyFound: txTargets.length, directOwners: withHistory.filter((row) => row.authorityAccount?.ownerIsExecutable)
      .map((row) => ({ authority: row.authority, sol: row.sol, owner: row.authorityAccount.owner })) }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
