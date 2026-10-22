#!/usr/bin/env node
'use strict';

// Read-only Composer/RPC attestation. This script never constructs, signs,
// simulates, or submits a transaction and never persists the RPC endpoint.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const program = 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3';
const receipt = '4P9C1bfRHu9SZnjCs853cRC3HRTkV8w8CFNaDezicAvMaN7AcRCmnMAqmsTa2o11HQ9KDLjgDGRYLwNohsRFGuXv';
const envFile = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
if ((fs.statSync(envFile).mode & 0o777) !== 0o600) throw new Error('RPC env file must be mode 0600');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)\s*$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[match[1]] = value;
}
const endpoint = env.SOLANA_RPC_URL || env.SOLANA_RPC || env.HELIUS_RPC || env.RPC;
if (!endpoint) throw new Error('RPC endpoint absent');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
async function getJson(url, timeoutMs = 180000) {
  const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {raw: text}; }
  return {status: response.status, ok: response.ok, body};
}
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || response.status)}`);
  return body.result;
}
function keysFor(tx) {
  const messageKeys = tx.transaction.message.accountKeys.map(k => typeof k === 'string' ? k : k.pubkey);
  return [...messageKeys, ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])];
}
function instructionRows(tx, idl) {
  const bs58Module = require('../2026-10-15/onre-harness/node_modules/bs58');
  const bs58 = bs58Module.default || bs58Module;
  const keys = keysFor(tx);
  const bySelector = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix]));
  const decode = (ix, location, outerIndex) => {
    const programId = typeof ix.programId === 'string' ? ix.programId : keys[ix.programIdIndex];
    if (programId !== program) return null;
    const accountIndices = ix.accounts || [];
    const accounts = accountIndices.map((value, index) => {
      const address = typeof value === 'number' ? keys[value] : value;
      return {index, address};
    });
    const data = Buffer.from(bs58.decode(ix.data || ''));
    const selector = data.subarray(0, 8).toString('hex');
    const spec = bySelector.get(selector);
    return {
      location, outerIndex, selector, name: spec?.name || null,
      dataHex: data.toString('hex'), argsHex: data.subarray(8).toString('hex'),
      accounts: accounts.map((row, index) => ({...row, name: spec?.accounts?.[index]?.name || null})),
    };
  };
  const rows = [];
  tx.transaction.message.instructions.forEach((ix, index) => {
    const row = decode(ix, 'outer', index); if (row) rows.push(row);
  });
  for (const group of tx.meta?.innerInstructions || []) for (const ix of group.instructions) {
    const row = decode(ix, 'inner', group.index); if (row) rows.push(row);
  }
  return rows;
}

async function main() {
  const base = 'https://the-composer-svc.fly.dev';
  const idlResult = await getJson(`${base}/idl/${program}`);
  if (!idlResult.ok || !Array.isArray(idlResult.body?.instructions)) throw new Error(`Composer IDL failed: ${idlResult.status}`);
  fs.writeFileSync(path.join(root, 'fragmetric-composer-idl.json'), JSON.stringify(idlResult.body, null, 2) + '\n');

  let learnResult;
  try {
    // The full refresh endpoint can legitimately exceed an audit turn. A cached
    // sample is supplementary; the published IDL and exact deployed ELF are the
    // authoritative interface/binary attestations used below.
    learnResult = await getJson(`${base}/learn/${program}?limit=250`, 60000);
  } catch (error) {
    learnResult = {status: null, ok: false, body: {error: error.message}};
  }
  fs.writeFileSync(path.join(root, 'fragmetric-composer-learn.json'), JSON.stringify(learnResult.body, null, 2) + '\n');

  const [tx, programInfo] = await Promise.all([
    rpc('getTransaction', [receipt, {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0}]),
    rpc('getAccountInfo', [program, {encoding: 'base64', commitment: 'finalized'}]),
  ]);
  if (!tx || tx.meta?.err) throw new Error('successful receipt unavailable');
  const programDataAddress = require('../2026-10-15/fragmetric-core-current-audit/sdk-3.0.2/node_modules/@solana/web3.js').PublicKey
    ? new (require('../2026-10-15/fragmetric-core-current-audit/sdk-3.0.2/node_modules/@solana/web3.js').PublicKey)(Buffer.from(programInfo.value.data[0], 'base64').subarray(4, 36)).toBase58()
    : null;
  const pd = await rpc('getAccountInfo', [programDataAddress, {encoding: 'base64', commitment: 'finalized'}]);
  const pdData = Buffer.from(pd.value.data[0], 'base64');
  const elfOffset = pdData[12] === 1 ? 45 : 13;
  const focusNames = idlResult.body.instructions.map(x => x.name).filter(name => /withdraw|batch|command|normalized|reset|cancel|deposit/i.test(name));
  const out = {
    observedAt: new Date().toISOString(), network: 'mainnet-beta', commitment: 'finalized',
    composer: {
      idlStatus: idlResult.status,
      idlSha256: sha256(Buffer.from(JSON.stringify(idlResult.body))),
      instructionCount: idlResult.body.instructions.length,
      accountTypeCount: idlResult.body.accounts?.length || 0,
      learnStatus: learnResult.status,
      learnSha256: sha256(Buffer.from(JSON.stringify(learnResult.body))),
      learnEvidence: learnResult.body?.evidence || null,
      focusInstructionNames: focusNames,
    },
    deployedProgram: {
      address: program, programdataAddress: programDataAddress,
      programContextSlot: programInfo.context.slot, programdataContextSlot: pd.context.slot,
      deploySlot: Number(pdData.readBigUInt64LE(4)),
      elfLength: pdData.length - elfOffset,
      elfSha256: sha256(pdData.subarray(elfOffset)),
    },
    receipt: {
      signature: receipt, slot: tx.slot, successful: !tx.meta.err,
      signers: tx.transaction.message.accountKeys.slice(0, tx.transaction.message.header.numRequiredSignatures),
      fragmetricInstructions: instructionRows(tx, idlResult.body),
      logInstructionNames: (tx.meta.logMessages || []).filter(x => x.includes('Instruction: ')).map(x => x.split('Instruction: ')[1]),
    },
    safety: 'Read-only Composer and finalized RPC calls only; no transaction construction, signing, simulation, or broadcast.',
  };
  fs.writeFileSync(path.join(root, 'fragmetric-composer-current.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({composer: out.composer, deployedProgram: out.deployedProgram, receipt: out.receipt}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
