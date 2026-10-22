#!/usr/bin/env node
// Read-only on-chain Anchor IDL lookup for MEX; loads runtime signer without logging it.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {PublicKey, Keypair} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const program = new PublicKey('MEXkeo4BPUCZuEJ4idUUwMPu4qvc9nkqtLn3yAyZLxg');
Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'hooked.json'), 'utf8'))));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
async function rpc(method, params) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const j = await r.json(); if (j.error) throw Error(method + ' error ' + j.error.code);
  return j.result;
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const base = PublicKey.findProgramAddressSync([], program)[0];
  const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', program);
  const result = await rpc('getAccountInfo', [idlAddress.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]);
  if (!result.value) {console.log(JSON.stringify({available: false, slot: result.context.slot})); return;}
  if (result.value.owner !== program.toBase58()) throw Error('IDL owner mismatch');
  const bytes = Buffer.from(result.value.data[0], 'base64');
  const len = bytes.readUInt32LE(40);
  const idl = JSON.parse(zlib.inflateSync(bytes.subarray(44, 44 + len)).toString('utf8'));
  const dest = path.join(__dirname, 'mex-onchain-idl.json');
  fs.writeFileSync(dest, JSON.stringify(idl, null, 2) + '\n');
  console.log(JSON.stringify({available: true, slot: result.context.slot,
    instructionNames: idl.instructions?.map(x => x.name), file: dest}));
}
main().catch(e => {console.error(e.message); process.exitCode = 1;});
