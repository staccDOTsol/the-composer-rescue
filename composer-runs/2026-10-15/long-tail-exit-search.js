#!/usr/bin/env node
// Search bounded recent history for an observed CPI spend from selected vaults.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-token-authority-census.raw.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const targets = [
  'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS',
  'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc',
  'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ',
  'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn',
];
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
async function analyzeVault(programId, group, tokenAccount) {
  const signatures = (await rpc('getSignaturesForAddress', [tokenAccount.address,
    { limit: 30, commitment: 'confirmed' }])).filter((row) => !row.err).slice(0, 20);
  const result = { programId, authority: group.authority, vault: tokenAccount.address,
    symbol: tokenAccount.symbol, pricedGrossUsd: tokenAccount.usdValue,
    availableRecentSuccessfulSignatures: signatures.length, inspected: 0, latestSlot: signatures[0]?.slot ?? null,
    outgoing: null };
  for (const candidate of signatures) {
    const tx = await rpc('getTransaction', [candidate.signature, { encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 0 }]);
    result.inspected += 1;
    if (!tx || tx.meta?.err) continue;
    const top = tx.transaction?.message?.instructions || [];
    for (const groupIx of tx.meta?.innerInstructions || []) {
      const topLevelProgramId = top[groupIx.index]?.programId;
      const stack = [];
      stack[1] = topLevelProgramId;
      for (const ix of groupIx.instructions || []) {
        const height = ix.stackHeight ?? 2;
        const immediateInvokingProgramId = stack[height - 1] || null;
        stack[height] = ix.programId;
        stack.length = height + 1;
        const info = ix.parsed?.info || {};
        if (info.source !== tokenAccount.address || info.authority !== group.authority) continue;
        if (!['transfer', 'transferChecked'].includes(ix.parsed?.type)) continue;
        result.outgoing = { signature: candidate.signature, slot: tx.slot, blockTime: tx.blockTime,
          topLevelProgramId, immediateInvokingProgramId,
          tokenProgramId: ix.programId, stackHeight: ix.stackHeight ?? null,
          rawAmount: String(info.amount ?? info.tokenAmount?.amount ?? ''), destination: info.destination,
          callerMatchesStateOwner: immediateInvokingProgramId === programId };
        return result;
      }
    }
  }
  return result;
}
async function main() {
  const selected = [];
  for (const programId of targets) {
    const group = source.authorities.find((row) => row.directExecutableOwner === programId && !row.onCurve);
    if (!group) continue;
    for (const account of group.tokenAccounts.slice(0, 3)) selected.push({ programId, group, account });
  }
  const rows = [];
  for (const item of selected) rows.push(await analyzeVault(item.programId, item.group, item.account));
  const report = { generatedAt: new Date().toISOString(), maxSuccessfulSignaturesPerVault: 20,
    selectedVaults: selected.length, rows };
  fs.writeFileSync(path.join(DIR, 'long-tail-exit-search.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
