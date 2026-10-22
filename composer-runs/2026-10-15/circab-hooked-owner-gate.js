#!/usr/bin/env node
'use strict';
// Signed mainnet-beta simulation only. This file has no sendTransaction path.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage} = require(modules + '@solana/web3.js');
const bs58mod = require(modules + 'bs58');
const bs58 = bs58mod.default || bs58mod;
const {encodeV1} = require('./klend-v1-composition.js');

const program = new PublicKey('circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g');
const historicalSignature = '4kjS4A2QM8Hzai8mcNYYkwmahucP7baf9MSdw1c8aQq5bg2efRThD6tmem8KKnRpDcxvFyhtCHXdteNoKgDkdkBa';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(line => line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function signV1(instruction, wallet, blockhash) {
  const encoded = encodeV1([instruction], wallet.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw Error('unexpected signer count');
  const compiled = new TransactionMessage({payerKey: wallet.publicKey,
    recentBlockhash: blockhash, instructions: [instruction]}).compileToV0Message();
  if (!compiled.staticAccountKeys[0].equals(wallet.publicKey)) throw Error('unexpected signer order');
  const wire = Buffer.from(encoded.wire);
  const key = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(wallet.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, wire.subarray(0, wire.length - 64), key).copy(wire, wire.length - 64);
  return {wire, encoded};
}
function tokenRaw(account) {
  return account?.data ? Buffer.from(account.data[0], 'base64').readBigUInt64LE(64).toString() : null;
}
async function main() {
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
  if (wallet.publicKey.toBase58() !== '331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth')
    throw Error('unexpected hooked wallet');
  const tx = await rpc('getTransaction', [historicalSignature,
    {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  if (!tx || tx.meta.err) throw Error('historical positive control unavailable');
  const item = tx.meta.innerInstructions.flatMap(x => x.instructions)
    .find(x => x.programId === program.toBase58());
  if (!item || item.accounts.length !== 5) throw Error('historical TransferV0 shape changed');
  const [from, to, originalOwner, circuitBreaker, tokenProgram] = item.accounts.map(x => new PublicKey(x));
  const data = Buffer.from(bs58.decode(item.data));
  const ix = new TransactionInstruction({programId: program, keys: [
    {pubkey: from, isWritable: true, isSigner: false},
    {pubkey: to, isWritable: true, isSigner: false},
    {pubkey: wallet.publicKey, isWritable: false, isSigner: true},
    {pubkey: circuitBreaker, isWritable: true, isSigner: false},
    {pubkey: tokenProgram, isWritable: false, isSigner: false},
  ], data});
  const addresses = [from.toBase58(), to.toBase58()];
  const before = await rpc('getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const {wire, encoded} = signV1(ix, wallet, blockhash);
  const sim = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed',
    accounts: {encoding: 'base64', addresses}}]);
  const out = {generatedAt: new Date().toISOString(), chain: 'mainnet-beta',
    historicalSignature, historicalSlot: tx.slot, program: program.toBase58(),
    source: from.toBase58(), destination: to.toBase58(), breaker: circuitBreaker.toBase58(),
    originalRequiredOwner: originalOwner.toBase58(), substitutedSigner: wallet.publicKey.toBase58(),
    instructionDataHex: data.toString('hex'), sigVerify: true, noTransactionSubmitted: true,
    wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      signatures: encoded.requiredSignatures},
    beforeSlot: before.context.slot, beforeRaw: before.value.map(tokenRaw),
    simulationSlot: sim.context.slot, err: sim.value.err,
    unitsConsumed: sim.value.unitsConsumed, logs: sim.value.logs,
    simulatedPostRaw: (sim.value.accounts || []).map(tokenRaw)};
  fs.writeFileSync(__dirname + '/circab-hooked-owner-gate.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({slot: out.simulationSlot, err: out.err,
    bytes: out.wire.bytes, addresses: out.wire.addresses,
    errorLog: out.logs?.find(x => x.includes('Error'))}));
}
main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
