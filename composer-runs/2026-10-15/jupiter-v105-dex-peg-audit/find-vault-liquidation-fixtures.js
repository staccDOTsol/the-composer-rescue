#!/usr/bin/env node
'use strict';

// Read-only bounded history scan. This script only calls getSignaturesForAddress
// and getTransaction against the configured mainnet RPC; it cannot submit.

const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey } = require(path.join(MODULES, '@solana', 'web3.js'));
const bs58Module = require(path.join(MODULES, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const OUT = path.join(__dirname, 'liquidation-fixtures.json');
const ENV = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = ENV.HEAVY_RPC_URL || ENV.RPC_URL;
if (!RPC) throw new Error('No read-only RPC configured');

const PROGRAM = new PublicKey('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi');
const V105_POSITION = new PublicKey('9FrRPr4Amb3c1riSBCrBryS5Uagq9qvNpUaMHUZJujhg');
const V105_CONFIG = new PublicKey('DdmQFd7gqYrZtDCVJYmUS37Yz5nu3k87HGjs8rwR4MZn');
const DISCS = new Map([
  ['dfb3e27d302e274a', 'liquidate'],
  ['1c81fd7df3340ba2', 'liquidate_dex'],
  ['1a717432f783d005', 'liquidate_perfect_dex'],
  ['5822b44d98baa6a2', 'operate_perfect_dex'],
]);

let id = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcBatch(calls) {
  const requests = calls.map((call) => ({jsonrpc: '2.0', id: ++id,
    method: call.method, params: call.params}));
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(requests)});
  const bodies = await response.json();
  const byId = new Map(bodies.map((body) => [body.id, body]));
  return requests.map((request) => {
    const body = byId.get(request.id);
    if (body?.error) throw new Error(`${request.method}: ${JSON.stringify(body.error)}`);
    return body?.result;
  });
}

function compiledInstructions(transaction) {
  if (!transaction?.transaction?.message) return [];
  const message = transaction.transaction.message;
  const allKeys = [...message.accountKeys, ...(transaction.meta?.loadedAddresses?.writable || []),
    ...(transaction.meta?.loadedAddresses?.readonly || [])];
  return (message.instructions || []).flatMap((instruction, topLevelIndex) => {
    const program = allKeys[instruction.programIdIndex];
    if (program !== PROGRAM.toBase58()) return [];
    const data = Buffer.from(bs58.decode(instruction.data));
    const name = DISCS.get(data.subarray(0, 8).toString('hex'));
    if (!name) return [];
    return [{topLevelIndex, name, dataHex: data.toString('hex'),
      accounts: instruction.accounts.map((index) => allKeys[index])}];
  });
}

async function scanAddress(address, pageLimit, signatureLimit) {
  const rows = [];
  let before;
  let signaturesSeen = 0;
  for (let page = 0; page < pageLimit && signaturesSeen < signatureLimit; page += 1) {
    const pageRows = await rpc('getSignaturesForAddress', [address.toBase58(), {
      limit: Math.min(1000, signatureLimit - signaturesSeen), ...(before ? {before} : {}),
      commitment: 'confirmed',
    }]);
    if (!pageRows.length) break;
    signaturesSeen += pageRows.length;
    before = pageRows.at(-1).signature;
    for (const signature of pageRows) {
      if (signature.err) continue;
      const transaction = await rpc('getTransaction', [signature.signature, {
        encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
      }]);
      const instructions = compiledInstructions(transaction);
      if (instructions.length) rows.push({signature: signature.signature, slot: signature.slot,
        blockTime: signature.blockTime, instructions});
    }
    if (pageRows.length < 1000) break;
  }
  return {address: address.toBase58(), signaturesSeen, rows};
}

async function scanProgram(signatureLimit) {
  const signatures = await rpc('getSignaturesForAddress', [PROGRAM.toBase58(), {
    limit: signatureLimit, commitment: 'confirmed',
  }]);
  const rows = [];
  for (let offset = 0; offset < signatures.length; offset += 50) {
    const batch = signatures.slice(offset, offset + 50).filter((row) => !row.err);
    const transactions = await rpcBatch(batch.map((row) => ({method: 'getTransaction', params: [row.signature, {
      encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
    }]})));
    transactions.forEach((transaction, index) => {
      const instructions = compiledInstructions(transaction).filter((instruction) =>
        instruction.name.startsWith('liquidate'));
      if (instructions.length) rows.push({signature: batch[index].signature,
        slot: batch[index].slot, blockTime: batch[index].blockTime, instructions});
    });
  }
  return {address: PROGRAM.toBase58(), signaturesSeen: signatures.length, rows};
}

async function main() {
  const position = await scanAddress(V105_POSITION, 2, 200);
  const config = await scanAddress(V105_CONFIG, 1, 100);
  const program = await scanProgram(1000);
  const output = {generatedAt: new Date().toISOString(), scope: 'read-only mainnet history scan',
    program: PROGRAM.toBase58(), v105: {position: V105_POSITION.toBase58(), config: V105_CONFIG.toBase58()},
    scans: {position, config, program}};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, positionSignatures: position.signaturesSeen,
    positionHits: position.rows.length, configSignatures: config.signaturesSeen,
    configHits: config.rows.length, programSignatures: program.signaturesSeen,
    programLiquidationHits: program.rows.length}));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
