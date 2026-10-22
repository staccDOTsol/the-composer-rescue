#!/usr/bin/env node
'use strict';

// Read-only current-mainnet fixture collector for deployed Byreal CLMM.
// It never constructs or submits a transaction.

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(`${MODULES}/@solana/web3.js`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const OUTPUT = `${ROOT}/byreal-current-fixture.json`;
const PROGRAM = 'REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2';
const SEED_SIGNATURE = '3Pd2Li7YKLJfQC3HDqi48TBu1P5zg52V8UNczoL2u5tha2ErcCMXceHvVtDmM7hTroZEgEt9j6n96DmRRj9Sdvq3';
const ENV_FILE = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env'].find(fs.existsSync);
if (!ENV_FILE) throw new Error('authenticated read-only RPC configuration unavailable');
const env = Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const RPCS = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!RPCS.length) throw new Error('RPC_URL/HEAVY_RPC_URL unavailable');

let rpcId = 0;
async function rpc(method, params) {
  const failures = [];
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      const json = await response.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) { failures.push(error.message); }
  }
  throw new Error(`${method}: ${failures.join(' | ')}`);
}

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const keyString = value => typeof value === 'string' ? value : value.pubkey || String(value);

function normalizeInstruction(ix, keys) {
  if ('parsed' in ix) return {program: ix.program, programId: ix.programId, parsed: ix.parsed};
  const programId = ix.programId || keys[ix.programIdIndex];
  const accounts = ix.accounts.map(value => typeof value === 'number' ? keys[value] : value);
  const raw = Buffer.from(bs58.decode(ix.data));
  return {programId, accounts, dataHex: raw.toString('hex'), discriminatorHex: raw.subarray(0, 8).toString('hex')};
}

async function getTransaction(signature) {
  return rpc('getTransaction', [signature, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
}

async function main() {
  const finalizedSlot = await rpc('getSlot', [{commitment: 'finalized'}]);
  const programAccount = await rpc('getAccountInfo', [PROGRAM, {encoding: 'base64', commitment: 'finalized'}]);
  const signatures = await rpc('getSignaturesForAddress', [PROGRAM, {limit: 60, commitment: 'finalized'}]);
  const ordered = [SEED_SIGNATURE, ...signatures.map(row => row.signature).filter(value => value !== SEED_SIGNATURE)];
  const inspected = [];
  let chosen = null;
  for (const signature of ordered.slice(0, 25)) {
    const transaction = await getTransaction(signature);
    if (!transaction) continue;
    const message = transaction.transaction.message;
    const staticKeys = message.accountKeys.map(keyString);
    const loaded = transaction.meta?.loadedAddresses || {writable: [], readonly: []};
    const keys = [...staticKeys, ...(loaded.writable || []), ...(loaded.readonly || [])];
    const outer = message.instructions.map(ix => normalizeInstruction(ix, keys));
    const inner = (transaction.meta?.innerInstructions || []).flatMap(group =>
      group.instructions.map(ix => ({outerIndex: group.index, ...normalizeInstruction(ix, keys)})));
    const byreal = [...outer.map((ix, index) => ({outerIndex: index, ...ix})), ...inner]
      .filter(ix => ix.programId === PROGRAM);
    const tokenTransfers = inner.filter(ix => ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked');
    const summary = {signature, slot: transaction.slot, blockTime: transaction.blockTime,
      err: transaction.meta?.err || null, fee: transaction.meta?.fee, staticKeys, loaded, byreal, tokenTransfers,
      logMessages: (transaction.meta?.logMessages || []).filter(line =>
        line.includes('Instruction:') || line.includes(PROGRAM) || line.includes('Swap') || line.includes('failed'))};
    inspected.push(summary);
    if (!chosen && !summary.err && byreal.length && tokenTransfers.length >= 2) chosen = {transaction, summary, keys};
    if (chosen && inspected.length >= 8) break;
  }
  if (!chosen) throw new Error('no recent successful Byreal value-moving fixture found');

  const addresses = [...new Set(chosen.keys)];
  const accountRows = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'finalized'}]);
  const accounts = addresses.map((address, index) => {
    const row = accountRows.value[index];
    if (!row) return {address, exists: false};
    const data = Buffer.from(row.data[0], 'base64');
    const entry = {address, exists: true, owner: row.owner, executable: row.executable,
      lamports: row.lamports, dataLength: data.length, dataSha256: sha256(data)};
    if ((row.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
         row.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72) {
      entry.mint = new PublicKey(data.subarray(0, 32)).toBase58();
      entry.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
      entry.rawTokenAmount = data.readBigUInt64LE(64).toString();
    }
    return entry;
  });

  const result = {capturedAt: new Date().toISOString(), commitment: 'finalized', finalizedSlot,
    noTransactionsSubmitted: true, program: PROGRAM,
    programAccount: {owner: programAccount.value.owner, executable: programAccount.value.executable,
      dataLength: Buffer.from(programAccount.value.data[0], 'base64').length,
      dataSha256: sha256(Buffer.from(programAccount.value.data[0], 'base64'))},
    chosenSignature: chosen.summary.signature, chosenSlot: chosen.summary.slot,
    chosenTransaction: chosen.transaction, inspected, accountsContextSlot: accountRows.context.slot, accounts};
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, finalizedSlot, chosenSignature: result.chosenSignature,
    chosenSlot: result.chosenSlot, byrealInstructions: chosen.summary.byreal.length,
    tokenTransfers: chosen.summary.tokenTransfers.length, accountCount: accounts.length}));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
