#!/usr/bin/env node
// Bounded read-only history scan of the MOVEUSD mint. This looks for bridge,
// DEX, oracle, or lending programs in the latest 1,000 mint-touching mainnet
// transactions without constructing or submitting a transaction.

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'moveusd-mint-history.json');
const MINT = '3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm';
const CONTROLLER = 'EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC';
const KNOWN_INFRASTRUCTURE = new Set([
  CONTROLLER,
  '11111111111111111111111111111111',
  'ComputeBudget111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'SysvarRent111111111111111111111111111111111',
]);
const WORMHOLE_CORE = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth';
const WORMHOLE_WTT = 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb';

function endpoint() {
  const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
  const env = Object.fromEntries(lines.filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL unavailable');
  return env.RPC_URL;
}
const RPC = endpoint();
let rpcId = 1;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postJson(payload, label) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload) });
    const raw = await response.text();
    if (response.ok) {
      try { return JSON.parse(raw); } catch (error) { lastError = error; }
    } else {
      lastError = new Error(`${label}: HTTP ${response.status}`);
    }
    if (attempt < 4) await delay(500 * (2 ** attempt));
  }
  throw lastError || new Error(`${label}: request failed`);
}

async function rpc(method, params) {
  const body = await postJson({ jsonrpc: '2.0', id: rpcId++, method, params }, method);
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

async function transactionBatch(signatures) {
  const requests = signatures.map((signature) => ({ jsonrpc: '2.0', id: rpcId++, method: 'getTransaction',
    params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }));
  const bodies = await postJson(requests, 'getTransaction batch');
  if (!Array.isArray(bodies)) throw new Error('batch RPC did not return an array');
  const byId = new Map(bodies.map((body) => [body.id, body]));
  return requests.map((request) => {
    const body = byId.get(request.id);
    return body?.error ? { error: body.error } : { result: body?.result ?? null };
  });
}

function pubkey(value) {
  if (typeof value === 'string') return value;
  return value?.pubkey || null;
}

function programId(ix) {
  return ix?.programId || ix?.program || null;
}

function tokenOperation(ix) {
  const parsed = ix?.parsed;
  if (!parsed || !['mintTo', 'mintToChecked', 'burn', 'burnChecked'].includes(parsed.type)) return null;
  if (parsed.info?.mint !== MINT) return null;
  return { type: parsed.type, info: parsed.info };
}

function summarize(signatureRow, tx) {
  if (!tx) return { signature: signatureRow.signature, slot: signatureRow.slot, unavailable: true };
  const accountKeys = tx.transaction.message.accountKeys || [];
  const outer = tx.transaction.message.instructions || [];
  const inner = (tx.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  const instructions = [...outer, ...inner];
  const programs = [...new Set(instructions.map(programId).filter(Boolean))];
  const tokenOperations = instructions.map(tokenOperation).filter(Boolean);
  const signers = accountKeys.filter((key) => typeof key === 'object' && key.signer).map(pubkey);
  const controllerInstructions = instructions.filter((ix) => programId(ix) === CONTROLLER).map((ix) => ({
    data: typeof ix.data === 'string' ? ix.data : null,
    parsedType: ix.parsed?.type || null,
    accountCount: Array.isArray(ix.accounts) ? ix.accounts.length : null,
  }));
  return {
    signature: signatureRow.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    error: tx.meta?.err ?? null,
    signers,
    outerPrograms: [...new Set(outer.map(programId).filter(Boolean))],
    allPrograms: programs,
    externalPrograms: programs.filter((id) => !KNOWN_INFRASTRUCTURE.has(id)),
    tokenOperations,
    controllerInstructions,
  };
}

async function main() {
  const signatures = await rpc('getSignaturesForAddress', [MINT, { limit: 1000, commitment: 'confirmed' }]);
  const rows = [];
  const failures = [];
  for (let offset = 0; offset < signatures.length; offset += 50) {
    const slice = signatures.slice(offset, offset + 50);
    const responses = await transactionBatch(slice.map((row) => row.signature));
    responses.forEach((response, index) => {
      if (response.error) failures.push({ signature: slice[index].signature, error: response.error });
      else rows.push(summarize(slice[index], response.result));
    });
    process.stdout.write(`fetched ${Math.min(offset + slice.length, signatures.length)}/${signatures.length}\n`);
    if (offset + slice.length < signatures.length) await delay(250);
  }
  const programTxCounts = new Map();
  for (const row of rows) for (const id of row.allPrograms || []) {
    programTxCounts.set(id, (programTxCounts.get(id) || 0) + 1);
  }
  const externalProgramTxCounts = [...programTxCounts.entries()]
    .filter(([id]) => !KNOWN_INFRASTRUCTURE.has(id))
    .map(([programIdValue, transactionCount]) => ({ programId: programIdValue, transactionCount }))
    .sort((a, b) => b.transactionCount - a.transactionCount);
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noTransactionConstructedOrSubmitted: true,
    mint: MINT,
    limit: 1000,
    signaturesReturned: signatures.length,
    transactionsFetched: rows.length,
    failures,
    oldestIncluded: rows.length ? { signature: rows.at(-1).signature, slot: rows.at(-1).slot,
      blockTime: rows.at(-1).blockTime } : null,
    newestIncluded: rows.length ? { signature: rows[0].signature, slot: rows[0].slot,
      blockTime: rows[0].blockTime } : null,
    programTransactionCounts: [...programTxCounts.entries()]
      .map(([programIdValue, transactionCount]) => ({ programId: programIdValue, transactionCount }))
      .sort((a, b) => b.transactionCount - a.transactionCount),
    externalProgramTransactionCounts: externalProgramTxCounts,
    wormholeObserved: {
      core: rows.some((row) => row.allPrograms?.includes(WORMHOLE_CORE)),
      wrappedTokenTransfer: rows.some((row) => row.allPrograms?.includes(WORMHOLE_WTT)),
    },
    tokenOperationCounts: Object.fromEntries(['mintTo', 'mintToChecked', 'burn', 'burnChecked'].map((type) => [
      type, rows.flatMap((row) => row.tokenOperations || []).filter((op) => op.type === type).length,
    ])),
    transactionsWithExternalPrograms: rows.filter((row) => row.externalPrograms?.length),
    rows,
    limitation: 'This is the latest 1,000 mint-address signatures, not complete lifetime history. A custom NTT program cannot be identified by name alone; external programs are preserved by address for review.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    signaturesReturned: output.signaturesReturned,
    transactionsFetched: output.transactionsFetched,
    failures: failures.length,
    oldestIncluded: output.oldestIncluded,
    newestIncluded: output.newestIncluded,
    wormholeObserved: output.wormholeObserved,
    tokenOperationCounts: output.tokenOperationCounts,
    externalProgramTransactionCounts: externalProgramTxCounts,
    transactionsWithExternalPrograms: output.transactionsWithExternalPrograms.length,
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
