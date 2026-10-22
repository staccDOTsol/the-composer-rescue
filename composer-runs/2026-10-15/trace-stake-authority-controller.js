#!/usr/bin/env node
// Read-only transaction-history triage for candidate Stake withdrawer PDAs.
// This finds co-occurring executables; it does not by itself prove PDA control.

const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL (Helius standard/current endpoint preferred)');
const CENSUS = path.join(__dirname, 'native-stake-authority-census.json');
const OUT = process.argv[2] || path.join(__dirname, 'native-stake-controller-traces.json');
const authorities = process.argv.slice(3);
if (!authorities.length) throw new Error('usage: node trace-stake-authority-controller.js OUTPUT AUTHORITY...');

const BUILTINS = new Set([
  '11111111111111111111111111111111',
  'Stake11111111111111111111111111111111111111',
  'Vote111111111111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'Sysvar1111111111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params, attempts = 5) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      const body = JSON.parse(text);
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

function programIds(transaction) {
  const out = [];
  const visit = (ix) => {
    if (ix && ix.programId) out.push(typeof ix.programId === 'string' ? ix.programId : ix.programId.toString());
  };
  for (const ix of transaction?.transaction?.message?.instructions || []) visit(ix);
  for (const inner of transaction?.meta?.innerInstructions || []) for (const ix of inner.instructions || []) visit(ix);
  return [...new Set(out)];
}

function stakeInstructions(transaction) {
  const out = [];
  const visit = (ix, inner) => {
    if (ix?.program === 'stake' || ix?.programId === 'Stake11111111111111111111111111111111111111') {
      out.push({ inner, type: ix?.parsed?.type || null, info: ix?.parsed?.info || null });
    }
  };
  for (const ix of transaction?.transaction?.message?.instructions || []) visit(ix, false);
  for (const group of transaction?.meta?.innerInstructions || []) for (const ix of group.instructions || []) visit(ix, true);
  return out;
}

(async () => {
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
  const byAuthority = new Map(census.retainedWithdrawerGroups.map((g) => [g.authority, g]));
  const results = [];
  for (const authority of authorities) {
    const group = byAuthority.get(authority);
    const queriedAddresses = [authority, ...(group?.examples || []).map((x) => x.address)].slice(0, 4);
    const signatureMap = new Map();
    for (const address of queriedAddresses) {
      const signatures = await rpc('getSignaturesForAddress', [address, { limit: address === authority ? 50 : 20, commitment: 'confirmed' }]);
      for (const s of signatures) if (!signatureMap.has(s.signature)) signatureMap.set(s.signature, { ...s, discoveredVia: address });
      await sleep(150);
    }
    const signatures = [...signatureMap.values()].sort((a, b) => b.slot - a.slot).slice(0, 80);
    const calls = new Map();
    const transactions = [];
    for (const sig of signatures) {
      const tx = await rpc('getTransaction', [sig.signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
      if (!tx) continue;
      const programs = programIds(tx);
      for (const program of programs) {
        if (BUILTINS.has(program)) continue;
        calls.set(program, (calls.get(program) || 0) + 1);
      }
      const stakeIxs = stakeInstructions(tx);
      if (stakeIxs.length || programs.some((p) => !BUILTINS.has(p))) transactions.push({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime,
        discoveredVia: sig.discoveredVia,
        err: sig.err,
        programs,
        stakeInstructions: stakeIxs,
      });
      await sleep(80);
    }
    results.push({
      authority,
      census: group ? { sol: group.sol, accountCount: group.accountCount, examples: group.examples } : null,
      queriedAddresses,
      uniqueSignatureCount: signatureMap.size,
      candidateProgramsByTransactionCount: [...calls.entries()].sort((a, b) => b[1] - a[1]).map(([programId, transactionCount]) => ({ programId, transactionCount })),
      transactions: transactions.slice(0, 30),
    });
    fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  }
  console.log(JSON.stringify(results.map((r) => ({ authority: r.authority, census: r.census && { sol: r.census.sol, accountCount: r.census.accountCount }, signatures: r.uniqueSignatureCount, candidates: r.candidateProgramsByTransactionCount.slice(0, 10) })), null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
