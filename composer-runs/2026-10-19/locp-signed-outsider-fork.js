#!/usr/bin/env node
// Fresh-key, sigVerify:true outsider mutations on a current mainnet-backed Surfpool fork.
// No sendTransaction or broadcast path is present.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..', '2026-10-15');
const MOD = path.join(BASE, 'kliquidity-sdk-official', 'node_modules');
const {Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MOD}/@solana/spl-token`);

const RPC = 'http://127.0.0.1:8897';
const EXPECTED_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROGRAM = new PublicKey('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const EVENT = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM)[0];
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ESCROW = '6wsjaQTidXNqmPDw4st2yMtFmTk7yyBEox5SydFQeJe7';
const current = JSON.parse(fs.readFileSync(path.join(__dirname, 'locp-current-refresh.json')));
const row = current.exact21Proofs.rows.find(item => item.authority === ESCROW);
if (!row || row.tokenProgram !== TOKEN_PROGRAM_ID.toBase58()) throw new Error('selected current JUP escrow unavailable');

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}), signal: AbortSignal.timeout(45_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function meta(value, writable = false, signer = false) {
  return {pubkey: value instanceof PublicKey ? value : new PublicKey(value), isWritable: writable, isSigner: signer};
}
function instruction(discriminator, keys, suffix = Buffer.alloc(0)) {
  return new TransactionInstruction({programId: PROGRAM, keys, data: Buffer.concat([Buffer.from(discriminator), suffix])});
}
function claimV2(attacker, attackerAta) {
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(1n);
  return instruction([229,87,46,162,21,157,231,114], [
    meta(row.authority, true), meta(row.mint), meta(row.vault, true), meta(attacker, true, true),
    meta(attackerAta, true), meta(MEMO), meta(row.tokenProgram), meta(EVENT), meta(PROGRAM),
  ], Buffer.concat([amount, Buffer.from([0])]));
}
function updateRecipient(attacker) {
  const metadata = PROGRAM; // Option<Account<Metadata>>::None convention used by the deployed SDK wire.
  return instruction([26,242,127,255,237,109,47,206], [
    meta(row.authority, true), meta(metadata, true), meta(attacker, true, true),
    meta(SystemProgram.programId), meta(EVENT), meta(PROGRAM),
  ], Buffer.concat([attacker.toBuffer(), Buffer.from([0])]));
}
function cancel(attacker, creatorAta, recipientAta) {
  return instruction([217,233,13,3,143,101,53,201], [
    meta(row.authority, true), meta(row.mint, true), meta(row.vault, true), meta(creatorAta, true),
    meta(recipientAta, true), meta(row.creator, true), meta(attacker, true, true), meta(MEMO),
    meta(row.tokenProgram), meta(EVENT), meta(PROGRAM),
  ], Buffer.from([0]));
}
function accountDigest(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  return {lamports: value.lamports, owner: value.owner, executable: value.executable,
    dataLength: data.length, dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    tokenRawAmount: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
    escrowRecipient: data.length === 296 ? new PublicKey(data.subarray(8, 40)).toBase58() : null,
    escrowTotalClaimed: data.length === 296 ? data.readBigUInt64LE(184).toString() : null};
}
async function preload(addresses) {
  for (const address of addresses) await rpc('getAccountInfo', [new PublicKey(address).toBase58(), {encoding: 'base64', commitment: 'processed'}]);
}
async function read(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'processed'}]);
  return {slot: result.context.slot, values: Object.fromEntries(addresses.map((address, index) => [String(address), accountDigest(result.value[index])]))};
}
async function simulate(label, attacker, instructions, watch) {
  await preload([...new Set(instructions.flatMap(ix => [ix.programId, ...ix.keys.map(key => key.pubkey)]).map(String))]);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const tx = new Transaction({feePayer: attacker.publicKey, recentBlockhash: latest.value.blockhash}).add(...instructions);
  tx.sign(attacker);
  const raw = tx.serialize();
  const message = tx.compileMessage();
  const result = await rpc('simulateTransaction', [raw.toString('base64'), {encoding: 'base64', sigVerify: true,
    replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch.map(String)}}]);
  return {label, sigVerify: true, replaceRecentBlockhash: false, signed: true,
    wire: {bytes: raw.length, accountKeys: message.accountKeys.length, instructions: message.instructions.length,
      requiredSignatures: message.header.numRequiredSignatures,
      sha256: crypto.createHash('sha256').update(raw).digest('hex')},
    slot: result.context.slot, err: result.value.err, unitsConsumed: result.value.unitsConsumed,
    logs: result.value.logs || [], returnedAccounts: result.value.accounts?.map(accountDigest) || null};
}

async function main() {
  const genesisHash = await rpc('getGenesisHash', []);
  if (genesisHash !== EXPECTED_GENESIS) throw new Error(`wrong fork genesis ${genesisHash}`);
  const attacker = Keypair.generate();
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const mint = new PublicKey(row.mint), attackerAta = getAssociatedTokenAddressSync(mint, attacker.publicKey);
  const creatorAta = getAssociatedTokenAddressSync(mint, new PublicKey(row.creator), true);
  const recipientAta = getAssociatedTokenAddressSync(mint, new PublicKey(row.recipient), true);
  const watch = [row.authority, row.vault, attackerAta.toBase58(), creatorAta.toBase58(), recipientAta.toBase58()];
  await preload([PROGRAM, row.authority, row.vault, mint, row.creator, row.recipient, creatorAta, recipientAta,
    TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MEMO, EVENT]);
  const before = await read(watch);
  const createAta = createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey, attackerAta, attacker.publicKey, mint);
  const tests = [];
  tests.push(await simulate('fresh_outsider_claim_to_fresh_destination', attacker,
    [createAta, claimV2(attacker.publicKey, attackerAta)], watch));
  tests.push(await simulate('fresh_outsider_update_stored_recipient_to_self', attacker,
    [updateRecipient(attacker.publicKey)], watch));
  tests.push(await simulate('fresh_outsider_cancel_existing_escrow', attacker,
    [cancel(attacker.publicKey, creatorAta, recipientAta)], watch));
  const after = await read(watch);
  const persistedUnchanged = JSON.stringify(before.values) === JSON.stringify(after.values);
  const output = {generatedAtUtc: new Date().toISOString(), network: 'current mainnet-beta-backed Surfpool fork',
    genesisHash, upstreamObservationSlot: current.deployment.observationSlot,
    safety: {freshEphemeralKeyNotSaved: true, syntheticMutation: 'fresh outsider system lamports only',
      sigVerify: true, simulationsOnly: true, mainnetSubmission: false, forkSendOrBroadcast: false,
      noSendMethodInHarness: true},
    target: {program: PROGRAM.toBase58(), currentElfSha256: current.deployment.elfSha256,
      escrow: row.authority, vault: row.vault, mint: row.mint, storedCreator: row.creator,
      storedRecipient: row.recipient, cancelMode: row.cancelMode, updateRecipientMode: row.updateRecipientMode},
    outsider: {publicKey: attacker.publicKey.toBase58(), destinationAta: attackerAta.toBase58()},
    before, tests, after, persistedForkStateUnchanged: persistedUnchanged,
    interpretation: 'Every fresh outsider mutation must fail before any Locp-authorized vault release. A failed atomic simulation is not an outflow; returned account snapshots may be absent on error, so persisted before/after digests are recorded separately.'};
  const outputPath = path.join(__dirname, 'locp-signed-outsider-fork.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, target: output.target, outsider: output.outsider,
    tests: tests.map(test => ({label: test.label, err: test.err, unitsConsumed: test.unitsConsumed,
      wire: test.wire, logTail: test.logs.slice(-10)})), persistedForkStateUnchanged: persistedUnchanged}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
