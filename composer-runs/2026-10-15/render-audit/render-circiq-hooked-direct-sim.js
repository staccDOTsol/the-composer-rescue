#!/usr/bin/env node
'use strict';

// One current mainnet-beta simulation. Loads ~/hooked.json only in memory.
// This file has no sendTransaction path and never writes signer material.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Keypair, PublicKey, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {encodeV1} = require('../klend-v1-composition.js');
const DIR = __dirname;
const STATE = JSON.parse(fs.readFileSync(path.join(DIR, 'render-current-state-and-history.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!URL) throw new Error('missing RPC URL');
const OWNER_KEY = path.join(os.homedir(), 'hooked.json');
const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(OWNER_KEY, 'utf8'))));
const program = STATE.addresses.breakerProgram;
const source = STATE.transactions.find((tx) => tx.err === null && tx.inner.some((ix) =>
  ix.programId === program && ix.dataHex.startsWith('a2b6c16166557fbd')));
if (!source) throw new Error('no successful postdeploy TransferV0 found');
const historical = source.inner.find((ix) => ix.programId === program &&
  ix.dataHex.startsWith('a2b6c16166557fbd'));
const ix = new TransactionInstruction({programId: new PublicKey(program),
  keys: historical.accounts.map((a, i) => ({pubkey: i === 2 ? signer.publicKey : new PublicKey(a.address),
    isSigner: i === 2, isWritable: i === 2 ? false : a.writable})),
  data: Buffer.from(historical.dataHex, 'hex')});
if (ix.keys[0].pubkey.toBase58() !== STATE.addresses.vault ||
    ix.keys[3].pubkey.toBase58() !== STATE.addresses.breakerState) {
  throw new Error('source transfer does not target selected vault/breaker');
}
let id = 0;
async function rpc(method, params) {
  const response = await fetch(URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const amount = (row) => row && row.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  ? Buffer.from(row.data[0], 'base64').readBigUInt64LE(64) : null;
async function main() {
  const watched = [ix.keys[0].pubkey.toBase58(), ix.keys[1].pubkey.toBase58(),
    ix.keys[3].pubkey.toBase58()];
  const before = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'confirmed'}]);
  if (before.value.some((row) => !row)) throw new Error('historical transfer account missing');
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const encoded = encodeV1([ix], signer.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw new Error('unexpected additional required signer');
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', accounts: {encoding: 'base64', addresses: watched},
  }]);
  const deltas = Object.fromEntries(watched.map((address, index) => {
    const a = amount(before.value[index]);
    const b = amount(result.value.accounts?.[index]);
    return [address, a !== null && b !== null ? (b - a).toString() : null];
  }));
  const output = {generatedAt: new Date().toISOString(), sourceSignature: source.signature,
    sourceSlot: source.slot, simulationContextSlot: result.context.slot,
    safety: {simulationOnly: true, mainnetTransactionsSubmitted: false,
      sendTransactionPathPresent: false, secretStoredInOutput: false},
    mutation: {ownerSigner: signer.publicKey.toBase58(),
      originalRequiredOwner: STATE.breaker.owner,
      destination: ix.keys[1].pubkey.toBase58(), amountRaw: ix.data.readBigUInt64LE(8).toString()},
    wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      requiredSignatures: 1, sigVerify: true,
      sha256: crypto.createHash('sha256').update(wire).digest('hex')},
    err: result.value.err, unitsConsumed: result.value.unitsConsumed,
    logs: result.value.logs || [], deltas};
  fs.writeFileSync(path.join(DIR, 'render-circiq-hooked-direct-sim.json'),
    `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output));
}
main().catch((e) => {console.error(e.stack || e); process.exitCode = 1;});
