#!/usr/bin/env node
'use strict';
// Read-only current on-chain Anchor IDL. Secrets and RPC endpoint are never logged.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {PublicKey, Keypair} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR = __dirname;
const PROGRAM = '8ybMhmtJb1VS6cqV4bPapvEUCRg3EGGrjpNhkLBPezA7';
const secret = JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(secret) || secret.length !== 64) throw Error('hooked keypair invalid');
Keypair.fromSecretKey(Uint8Array.from(secret));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC unavailable');
async function rpc(method, params) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const j = await r.json();
  if (!r.ok || j.error) throw Error(`${method} failed: ${j.error?.code || r.status}`);
  return j.result;
}
async function main() {
  const program = new PublicKey(PROGRAM);
  const base = PublicKey.findProgramAddressSync([], program)[0];
  const address = await PublicKey.createWithSeed(base, 'anchor:idl', program);
  const result = await rpc('getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]);
  if (!result.value) throw Error('Published Anchor IDL unavailable');
  if (result.value.owner !== PROGRAM) throw Error('IDL owner mismatch');
  const b = Buffer.from(result.value.data[0], 'base64');
  const len = b.readUInt32LE(40);
  const idl = JSON.parse(zlib.inflateSync(b.subarray(44, 44 + len)).toString('utf8'));
  fs.writeFileSync(path.join(DIR, '8yb-onchain-idl.json'), JSON.stringify(idl, null, 2) + '\n');
  fs.writeFileSync(path.join(DIR, '8yb-onchain-idl-metadata.json'), JSON.stringify({
    slot: result.context.slot, program: PROGRAM, address: address.toBase58(),
    owner: result.value.owner, authority: new PublicKey(b.subarray(8, 40)).toBase58(),
    compressedBytes: len, instructionCount: idl.instructions?.length,
  }, null, 2) + '\n');
  console.log(JSON.stringify({slot: result.context.slot, instructionCount: idl.instructions?.length}));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
