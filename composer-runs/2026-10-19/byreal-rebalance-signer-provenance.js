#!/usr/bin/env node
'use strict';

// Current-mainnet-backed, read-only signed replay of the Byreal autoswap
// Rebalance wrapper. This script never calls sendTransaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} = require(MODULES + '@solana/web3.js');
const spl = require(MODULES + '@solana/spl-token');
const bs58Module = require(MODULES + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1, signV1} = require('../2026-10-15/hylo-exchange-v1-wire.js');

const RPC = process.env.BYREAL_FORK_RPC || 'http://127.0.0.1:19497';
const OUT = path.join(__dirname, 'byreal-rebalance-signer-provenance.json');
const SIGNATURE = '5DnzTGPMdakorV388SHPtSw4Yx7pvzYgVnajnAfUGTUVW5idbK9EfKZcqeLeaaFD5zqZF3Yet827ZJfUvFJdfpML';
const REBALANCER = 'BYrEa363GeActic949HkNmw7VGBf9k7awKEqCTZvPuT4';
const OLD_OWNER = 'DvhdUT7GHqjV5fodaQuZEvURwX1kvLLphhxmh4CZ9X9b';
const OLD_NEW_MINT = 'Ef9B3o1Dbo5WbVqzAZJH9GnorgRsqfbDVYvs1kxtT7Qy';
const OLD_POSITION_MINT = '79Uo4hn71wXSEpYbEMzRjoYEnpQpUGiMyJWRA8P3Cg32';
const OLD_POSITION_TOKEN = '2fkb7XgSYFHWDJExB9xzPTiWDCAyG7gYKzzPhEikbgRP';
const CRCL = new PublicKey('XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
let id = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function loadUserKeypair() {
  const bytes = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'hooked.json'), 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error('~/hooked.json must contain a 64-byte keypair array');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
function historicalIx(tx, index) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const all = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = message.header;
  const writable = keyIndex => keyIndex < staticKeys.length
    ? (keyIndex < h.numRequiredSignatures
      ? keyIndex < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : keyIndex < staticKeys.length - h.numReadonlyUnsignedAccounts)
    : keyIndex < staticKeys.length + loaded.writable.length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: new PublicKey(all[source.programIdIndex]),
    keys: source.accounts.map(keyIndex => ({pubkey: new PublicKey(all[keyIndex]),
      isSigner: keyIndex < h.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}
function keyList(tx) {
  const message = tx.transaction.message;
  return [...message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey),
    ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
}
function replace(ix, map) {
  return new TransactionInstruction({programId: ix.programId, data: Buffer.from(ix.data),
    keys: ix.keys.map(key => ({...key, pubkey: map.get(key.pubkey.toBase58()) || key.pubkey}))});
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

async function main() {
  const user = loadUserKeypair();
  const replacementMint = Keypair.generate();
  const raw = await rpc('getTransaction', [SIGNATURE,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  const parsed = await rpc('getTransaction', [SIGNATURE,
    {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  const all = keyList(raw);
  const index = raw.transaction.message.instructions.findIndex(source =>
    all[source.programIdIndex] === REBALANCER);
  if (index < 0) throw new Error('Rebalance instruction absent');
  const sourceIx = historicalIx(raw, index);
  const originalSigners = raw.transaction.message.accountKeys.slice(0,
    raw.transaction.message.header.numRequiredSignatures).map(String);
  const ixSignerAccounts = sourceIx.keys.filter(key => key.isSigner).map(key => key.pubkey.toBase58());
  const oldPositionIndex = parsed.transaction.message.accountKeys.findIndex(key => key.pubkey === OLD_POSITION_TOKEN);
  const oldPositionPre = parsed.meta.preTokenBalances.find(row => row.accountIndex === oldPositionIndex);
  const oldPositionPost = parsed.meta.postTokenBalances.find(row => row.accountIndex === oldPositionIndex) || null;
  const parsedInner = parsed.meta.innerInstructions.flatMap(group => group.instructions)
    .filter(instruction => instruction.parsed).map(instruction => ({programId: instruction.programId,
      type: instruction.parsed.type, info: instruction.parsed.info}));
  const lifecycle = parsedInner.filter(row => ['burn', 'closeAccount', 'createAccount', 'create',
    'createIdempotent', 'initializeMint2', 'mintTo', 'setAuthority'].includes(row.type));

  await rpc('surfnet_setAccount', [user.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const replayIx = replace(sourceIx, new Map([
    [OLD_OWNER, user.publicKey], [OLD_NEW_MINT, replacementMint.publicKey],
  ]));
  // Preload every live account used by the exact instruction. The two new
  // controlled signer accounts intentionally do not need to pre-exist.
  for (const address of [...new Set([replayIx.programId, ...replayIx.keys.map(key => key.pubkey)]
    .map(String))]) {
    if (address === replacementMint.publicKey.toBase58()) continue;
    await rpc('getAccountInfo', [address, {encoding: 'base64', commitment: 'processed'}]);
  }
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([replayIx], user.publicKey, blockhash);
  const signed = signV1(encoded, [replayIx], user.publicKey, blockhash, [user, replacementMint]);
  const simulation = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
  }]);
  const logs = simulation.value.logs || [];
  const tokenPrograms = new Set([spl.TOKEN_PROGRAM_ID.toBase58(), spl.TOKEN_2022_PROGRAM_ID.toBase58()]);
  const programAccounts = [...new Set(sourceIx.keys.map(key => key.pubkey.toBase58()))];
  const oracleLike = programAccounts.filter(address => /pyth|scope|switch/i.test(address));
  const result = {
    generatedAt: new Date().toISOString(), transport: 'current-mainnet-backed Surfpool fork',
    noBroadcast: true, source: {signature: SIGNATURE, slot: raw.slot, program: REBALANCER,
      instructionIndex: index, discriminatorHex: sourceIx.data.subarray(0, 8).toString('hex'),
      instructionDataLength: sourceIx.data.length, accountMetaCount: sourceIx.keys.length,
      uniqueInstructionAccounts: programAccounts.length},
    signerProvenance: {originalTransactionSigners: originalSigners, instructionSignerAccounts: ixSignerAccounts,
      positionOwnerSigner: OLD_OWNER, newlyCreatedPositionMintSigner: OLD_NEW_MINT,
      oldPositionNft: {mint: OLD_POSITION_MINT, tokenAccount: OLD_POSITION_TOKEN,
        preOwner: oldPositionPre?.owner || null,
        preAmountRaw: oldPositionPre?.uiTokenAmount?.amount || null,
        postBalancePresent: Boolean(oldPositionPost)},
      replacementSignerRoles: {positionOwner: user.publicKey.toBase58(),
        newPositionMint: replacementMint.publicKey.toBase58()}},
    lifecycle,
    consumerClassification: {standaloneOracleAccountsDetectedByKnownName: oracleLike,
      tokenPrograms: [...tokenPrograms],
      conclusion: 'owner-authorized concentrated-liquidity position rebalance/router; not a standalone oracle price consumer or privileged protocol keeper'},
    outsiderReplay: {sigVerify: true, err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed, logs,
      extractedError: logs.find(line => /Error Code:|Error Message:|custom program error/.test(line)) || null,
      wire: {version: 1, sizeBytes: encoded.sizeBytes, addressCount: encoded.addressCount,
        instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        sha256: sha256(signed.wire)}, signerOrder: signed.signerOrder},
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, signerProvenance: result.signerProvenance,
    replay: {err: result.outsiderReplay.err, units: result.outsiderReplay.unitsConsumed,
      wire: result.outsiderReplay.wire, extractedError: result.outsiderReplay.extractedError,
      logTail: logs.slice(-8)}}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
