#!/usr/bin/env node
// Read-only fetch of legacy Anchor IDL accounts for the bridge and circuit breaker.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const PROGRAMS = {
  bridge: 'brdgGYmhGdaAJmqLN9oSp4381Ywc51vUfzn9NaSZC1d',
  circuitBreaker: 'circiqFCstNzaFBji1udQ6txgQBrn29pVSYHNJQo3wZ',
};
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function fetchIdl(label, address) {
  const program = new PublicKey(address);
  const base = PublicKey.findProgramAddressSync([], program)[0];
  const idlAddress = (await PublicKey.createWithSeed(base, 'anchor:idl', program)).toBase58();
  const result = await rpc('getAccountInfo', [idlAddress,
    {encoding: 'base64', commitment: 'finalized'}]);
  if (!result.value) return {label, program: address, idlAddress, slot: result.context.slot, exists: false};
  const data = Buffer.from(result.value.data[0], 'base64');
  const authority = new PublicKey(data.subarray(8, 40)).toBase58();
  const compressedLength = data.readUInt32LE(40);
  const compressed = data.subarray(44, 44 + compressedLength);
  const idl = JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
  const file = `${label}-current.idl.json`;
  fs.writeFileSync(path.join(DIR, file), `${JSON.stringify(idl, null, 2)}\n`);
  return {label, program: address, idlAddress, slot: result.context.slot, exists: true,
    owner: result.value.owner, authority, accountLength: data.length, compressedLength, file,
    idlName: idl.name, idlVersion: idl.version};
}

async function main() {
  const rows = [];
  for (const [label, address] of Object.entries(PROGRAMS)) rows.push(await fetchIdl(label, address));
  fs.writeFileSync(path.join(DIR, 'anchor-idl-status.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(JSON.stringify(rows));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
