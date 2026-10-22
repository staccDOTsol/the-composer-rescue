#!/usr/bin/env node
'use strict';

// Read-only current-mainnet identity probe for Chainlink's Lock/Release Token Pool.
// It fetches a published Anchor IDL when present and simulates the permissionless
// type_version instruction using Solana's v1 wire format. It never signs or sends.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  PublicKey,
  TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {encodeV1} = require('./klend-v1-composition.js');

const RUN = __dirname;
const PROGRAM = new PublicKey('8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC');
const CLOCK = new PublicKey('SysvarC1ock11111111111111111111111111111111');
const SOURCE_SIGNATURE =
  '5BfXHxzDmy3ejsamg2DRZ34k9XdxWbamyYyQnEjPLnmuEJiRQBoMQENbkFWxDo1Nioo2zr65wmyoPxb3sjs7hw5i';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrls = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!rpcUrls.length) throw new Error('No read-only RPC configured');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const discriminator = (name) => crypto.createHash('sha256')
  .update(`global:${name}`).digest().subarray(0, 8);

async function rpc(method, params, preferArchive = false) {
  let lastError;
  const endpoints = preferArchive ? [...rpcUrls].reverse() : rpcUrls;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(endpoints[attempt % endpoints.length], {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw lastError;
}

function decodeAnchorString(returnData) {
  if (!returnData?.data?.[0]) return null;
  const raw = Buffer.from(returnData.data[0], returnData.data[1] || 'base64');
  if (raw.length < 4) return {rawHex: raw.toString('hex')};
  const length = raw.readUInt32LE(0);
  return {rawHex: raw.toString('hex'), length,
    value: raw.subarray(4, 4 + length).toString('utf8')};
}

async function fetchIdl() {
  const base = PublicKey.findProgramAddressSync([], PROGRAM)[0];
  const address = await PublicKey.createWithSeed(base, 'anchor:idl', PROGRAM);
  const result = await rpc('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  if (!result.value) return {slot: result.context.slot, address: address.toBase58(), exists: false};
  const data = Buffer.from(result.value.data[0], 'base64');
  if (data.length < 44) throw new Error('Published IDL account is too short');
  const compressedLength = data.readUInt32LE(40);
  const compressed = data.subarray(44, 44 + compressedLength);
  const plain = zlib.inflateSync(compressed);
  const idl = JSON.parse(plain.toString('utf8'));
  const outputPath = path.join(RUN, 'prime-controller-onchain-idl.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(idl, null, 2)}\n`);
  return {slot: result.context.slot, address: address.toBase58(), exists: true,
    owner: result.value.owner, authority: new PublicKey(data.subarray(8, 40)).toBase58(),
    accountBytes: data.length, compressedBytes: compressed.length,
    compressedSha256: sha256(compressed), plainBytes: plain.length,
    plainSha256: sha256(plain), outputPath,
    metadata: idl.metadata || null, idlAddressField: idl.address || null,
    counts: {instructions: idl.instructions?.length || 0,
      accounts: idl.accounts?.length || 0, types: idl.types?.length || 0,
      errors: idl.errors?.length || 0}};
}

async function simulateTypeVersion() {
  const source = await rpc('getTransaction', [SOURCE_SIGNATURE,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}], true);
  if (!source) throw new Error('Source transaction unavailable');
  const firstKey = source.transaction.message.accountKeys[0];
  const payer = new PublicKey(typeof firstKey === 'string' ? firstKey : firstKey.pubkey);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const ix = new TransactionInstruction({programId: PROGRAM,
    keys: [{pubkey: CLOCK, isSigner: false, isWritable: false}],
    data: discriminator('type_version')});
  const encoded = encodeV1([ix], payer, latest.value.blockhash);
  const simulation = await rpc('simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed'}]);
  return {sourceSignature: SOURCE_SIGNATURE, sourceSlot: source.slot,
    payer: payer.toBase58(), v1Bytes: encoded.sizeBytes,
    v0Bytes: encoded.v0Bytes, addressCount: encoded.addressCount,
    requiredSignatures: encoded.requiredSignatures,
    simulationSlot: simulation.context.slot, err: simulation.value.err,
    unitsConsumed: simulation.value.unitsConsumed,
    returnData: decodeAnchorString(simulation.value.returnData),
    logs: simulation.value.logs};
}

async function main() {
  const [idl, typeVersion] = await Promise.all([fetchIdl(), simulateTypeVersion()]);
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    submittedTransactions: 0, programId: PROGRAM.toBase58(), idl, typeVersion};
  const outputPath = path.join(RUN, 'prime-controller-runtime-probe.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, idl, typeVersion: {
    v1Bytes: typeVersion.v1Bytes, simulationSlot: typeVersion.simulationSlot,
    err: typeVersion.err, unitsConsumed: typeVersion.unitsConsumed,
    returnData: typeVersion.returnData,
  }}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
