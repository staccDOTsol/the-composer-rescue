#!/usr/bin/env node
// Read-only classification of recent target-program transactions and Anchor events.
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;
const anchor = require(`${MOD}/@coral-xyz/anchor`);

const TARGET = '97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY';
const VAULT = 'FvkbfMm98jefJWrqkvXvsSZ9RFaRBae8k6c1jaYA5vY3';
const idl = JSON.parse(fs.readFileSync(`${__dirname}/hastra-release-v0.0.6/idl/vault_stake.json`, 'utf8'));
const eventCoder = new anchor.BorshEventCoder(idl);
const instructionNames = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^export\s+/, '');
    if (!cleaned || cleaned.startsWith('#')) continue;
    const i = cleaned.indexOf('=');
    if (i > 0) out[cleaned.slice(0, i)] = cleaned.slice(i + 1).replace(/^["']|["']$/g, '');
  }
  return out;
}
function clean(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (anchor.BN.isBN(value)) return value.toString(10);
  if (value?.toBase58) return value.toBase58();
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
  return value;
}

const env = { ...readEnv('/tmp/composer-helius-rpc.env'), ...process.env };
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
let id = 0;
async function request(method, params) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function batch(calls) {
  const payload = calls.map(({ method, params }) => ({ jsonrpc: '2.0', id: ++id, method, params }));
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const bodies = await response.json();
  const byId = new Map(bodies.map((body) => [body.id, body]));
  return payload.map((item) => {
    const body = byId.get(item.id);
    if (body?.error) throw new Error(`${item.method}: ${JSON.stringify(body.error)}`);
    return body?.result ?? null;
  });
}

function allKeys(tx) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map((key) => typeof key === 'string' ? key : key.pubkey);
  return [...staticKeys, ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])];
}
function vaultDelta(tx, keys) {
  const index = keys.indexOf(VAULT);
  if (index < 0) return null;
  const pre = tx.meta?.preTokenBalances?.find((x) => x.accountIndex === index)?.uiTokenAmount?.amount;
  const post = tx.meta?.postTokenBalances?.find((x) => x.accountIndex === index)?.uiTokenAmount?.amount;
  return pre != null && post != null ? (BigInt(post) - BigInt(pre)).toString() : null;
}
function decodedEvents(logs) {
  const events = [];
  let targetDepth = 0;
  for (const log of logs || []) {
    if (log.startsWith(`Program ${TARGET} invoke [`)) targetDepth += 1;
    else if (targetDepth && (log === `Program ${TARGET} success` || log.startsWith(`Program ${TARGET} failed:`))) targetDepth -= 1;
    else if (targetDepth && log.startsWith('Program data: ')) {
      try {
        const event = eventCoder.decode(log.slice('Program data: '.length));
        if (event) events.push({ name: event.name, data: clean(event.data) });
      } catch (_) {}
    }
  }
  return events;
}

(async () => {
  const signatures = await request('getSignaturesForAddress', [TARGET, { limit: 500, commitment: 'confirmed' }]);
  const transactions = [];
  for (let start = 0; start < signatures.length; start += 40) {
    const slice = signatures.slice(start, start + 40);
    transactions.push(...await batch(slice.map((row) => ({
      method: 'getTransaction',
      params: [row.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }],
    }))));
  }
  const rows = [];
  for (let i = 0; i < signatures.length; i += 1) {
    const tx = transactions[i];
    if (!tx) continue;
    const keys = allKeys(tx);
    const instructions = [];
    for (const ix of tx.transaction.message.instructions) {
      if (keys[ix.programIdIndex] !== TARGET) continue;
      const data = Buffer.from(bs58.decode(ix.data));
      instructions.push(instructionNames.get(data.subarray(0, 8).toString('hex')) || `unknown:${data.subarray(0, 8).toString('hex')}`);
    }
    if (!instructions.length) continue;
    const events = decodedEvents(tx.meta?.logMessages);
    rows.push({
      signature: signatures[i].signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      blockTimeIso: tx.blockTime == null ? null : new Date(tx.blockTime * 1000).toISOString(),
      err: tx.meta?.err ?? null,
      instructions,
      vaultDeltaRaw: vaultDelta(tx, keys),
      events,
    });
  }
  const economic = rows.filter((row) => row.instructions.some((name) => ['publish_rewards', 'verify_price', 'deposit', 'redeem'].includes(name)));
  const output = {
    generatedAt: new Date().toISOString(), rpcEndpointRedacted: true,
    method: 'read-only getSignaturesForAddress/getTransaction; no transaction signed or submitted',
    signaturesRequested: signatures.length, decodedTargetTransactions: rows.length,
    rows: economic,
  };
  fs.writeFileSync(`${__dirname}/hastra-history-analysis.json`, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(economic.filter((row) => row.instructions.includes('publish_rewards') || row.instructions.includes('verify_price')).slice(0, 40), null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
