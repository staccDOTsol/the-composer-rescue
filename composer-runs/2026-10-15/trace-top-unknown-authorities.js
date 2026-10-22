#!/usr/bin/env node
// Read-only signer-provenance trace for high-value off-curve authorities that
// have no live account of their own. No transaction is constructed or sent.

const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, 'mainnet-token-authority-census.raw.json');
const OUT = path.join(__dirname, 'mainnet-token-authority-signer-provenance.json');
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;

async function post(body, label) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const parsed = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`${label}: retryable ${response.status}`);
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      return parsed;
    } catch (error) {
      last = error;
      if (attempt === 6) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

async function rpc(method, params) {
  const response = await post({ jsonrpc: '2.0', id: 1, method, params }, method);
  if (response.error) throw new Error(`${method}: ${response.error.code} ${response.error.message}`);
  return response.result;
}

async function batchRpc(calls) {
  const response = await post(calls.map((call, index) => ({ jsonrpc: '2.0', id: index + 1, method: call.method, params: call.params })), 'batch');
  const byId = new Map(response.map((row) => [row.id, row]));
  return calls.map((_, index) => byId.get(index + 1));
}

function transferInfo(ix) {
  if (!TOKEN_PROGRAMS.has(ix?.programId) || !ix.parsed?.info) return null;
  const type = ix.parsed.type;
  if (!['transfer', 'transferChecked', 'burn', 'burnChecked', 'closeAccount'].includes(type)) return null;
  return { type, ...ix.parsed.info };
}

function provenance(tx, candidate) {
  if (!tx?.meta || tx.meta.err) return [];
  const outer = tx.transaction.message.instructions || [];
  const found = [];
  for (const group of tx.meta.innerInstructions || []) {
    const outerProgram = outer[group.index]?.programId;
    if (!outerProgram) continue;
    const stack = [{ height: 1, programId: outerProgram }];
    for (const ix of group.instructions || []) {
      const height = ix.stackHeight || 2;
      while (stack.length && stack[stack.length - 1].height >= height) stack.pop();
      const parent = [...stack].reverse().find((row) => row.height === height - 1);
      const info = transferInfo(ix);
      const authority = info?.authority || info?.multisigAuthority;
      const source = info?.source || info?.account;
      if (info && authority === candidate.authority && candidate.tokenAccounts.some((row) => row.address === source)) {
        found.push({
          slot: tx.slot, blockTime: tx.blockTime, tokenInstruction: info.type,
          sourceTokenAccount: source, destination: info.destination || null,
          authority, callerProgram: parent?.programId || null, outerProgram,
          stackHeight: height,
        });
      }
      if (ix.programId && !TOKEN_PROGRAMS.has(ix.programId)) stack.push({ height, programId: ix.programId });
    }
  }
  return found;
}

async function main() {
  const census = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const candidates = census.authorities
    .filter((row) => !row.onCurve && row.authorityAccount?.exists === false && row.pricedGrossUsd >= 1_000_000)
    .slice(0, 40)
    .map((row) => ({
      authority: row.authority, pricedGrossUsd: row.pricedGrossUsd,
      tokenAccounts: [...row.tokenAccounts].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0)).slice(0, 3),
      signatureRows: [], provenance: [],
    }));

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    for (const token of candidate.tokenAccounts) {
      const signatures = await rpc('getSignaturesForAddress', [token.address, { commitment: 'confirmed', limit: 20 }]);
      candidate.signatureRows.push({ tokenAccount: token.address, signatures: signatures.map((row) => ({ signature: row.signature, slot: row.slot, err: row.err, blockTime: row.blockTime })) });
      await sleep(150);
    }
    process.stderr.write(`signature histories ${index + 1}/${candidates.length}\n`);
  }

  const signatureSet = new Set();
  for (const candidate of candidates) for (const history of candidate.signatureRows) {
    for (const row of history.signatures.slice(0, 10)) if (!row.err) signatureSet.add(row.signature);
  }
  const signatures = [...signatureSet];
  const transactions = new Map();
  for (let start = 0; start < signatures.length; start += 50) {
    const batch = signatures.slice(start, start + 50);
    const results = await batchRpc(batch.map((signature) => ({
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }],
    })));
    batch.forEach((signature, index) => transactions.set(signature, results[index]?.result || null));
    process.stderr.write(`transaction batches ${Math.ceil((start + batch.length) / 50)}/${Math.ceil(signatures.length / 50)}\n`);
    await sleep(250);
  }

  for (const candidate of candidates) {
    const checked = new Set();
    for (const history of candidate.signatureRows) for (const row of history.signatures.slice(0, 10)) {
      checked.add(row.signature);
      for (const match of provenance(transactions.get(row.signature), candidate)) candidate.provenance.push({ signature: row.signature, ...match });
    }
    candidate.signaturesChecked = checked.size;
    delete candidate.signatureRows;
  }
  const output = {
    timestamp: new Date().toISOString(), sourceCensus: RAW, selection: 'top 40 off-curve null-account authorities with >= $1m sampled priced gross balance',
    noTransactionsSubmitted: true, candidates,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, candidates: candidates.map((row) => ({ authority: row.authority, pricedGrossUsd: row.pricedGrossUsd, signaturesChecked: row.signaturesChecked, provenance: row.provenance.slice(0, 3) })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
