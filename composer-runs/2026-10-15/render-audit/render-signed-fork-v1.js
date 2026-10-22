#!/usr/bin/env node
'use strict';

// Signed, simulation-only current-mainnet-fork checks for ReceiveRenderV3.
// Deliberately contains no sendTransaction path.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} =
  require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync} = require(`${MOD}/@solana/spl-token`);
const {encodeV1} = require('../klend-v1-composition.js');

const DIR = __dirname;
const STATE = JSON.parse(fs.readFileSync(path.join(DIR, 'render-current-state-and-history.json')));
const OUT = path.join(DIR, 'render-signed-fork-v1.json');
const FORK = process.env.RENDER_FORK_RPC || 'http://127.0.0.1:9027';
const BRIDGE = new PublicKey(STATE.addresses.bridge);
const DISC = 'd6d621d0b8a1dcab';
let id = 0;

async function rpc(method, params) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(body.error)}`), {rpcError: body.error});
  return body.result;
}
const P = (value) => new PublicKey(value);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function sourceCalls() {
  const calls = [];
  for (const tx of STATE.transactions) for (const ix of tx.top) {
    if (ix.programId === BRIDGE.toBase58() && ix.dataHex.startsWith(DISC)) {
      calls.push({signature: tx.signature, slot: tx.slot,
        ix: new TransactionInstruction({programId: BRIDGE,
          keys: ix.accounts.map((key) => ({pubkey: P(key.address), isSigner: key.signer, isWritable: key.writable})),
          data: Buffer.from(ix.dataHex, 'hex')})});
    }
  }
  return calls;
}

function withPayer(ix, payer) {
  const copy = new TransactionInstruction({programId: ix.programId,
    keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});
  copy.keys[0].pubkey = payer;
  copy.keys[0].isSigner = true;
  // ReceiveRenderV3 also initializes/validates the payer's upgrade-points ATA.
  copy.keys[3].pubkey = getAssociatedTokenAddressSync(copy.keys[7].pubkey, payer);
  return copy;
}

function signV1(encoded, instructions, payer, signer, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  for (const [index, address] of signerOrder.entries()) {
    if (address !== signer.publicKey.toBase58()) throw new Error(`uncontrolled signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(signer.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  }
  return {signed, signerOrder};
}

async function importInstructions(instructions) {
  const addresses = [...new Set(instructions.flatMap((ix) => [ix.programId, ...ix.keys.map((key) => key.pubkey)])
    .map(String))];
  for (const address of addresses) await rpc('getAccountInfo', [address,
    {encoding: 'base64', commitment: 'processed'}]);
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function simulate(label, instructions, attacker, watched, metadata = {}) {
  await importInstructions(instructions);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const {signed, signerOrder} = signV1(encoded, instructions, attacker.publicKey, attacker, blockhash);
  const before = await rpc('getMultipleAccounts', [watched, {encoding: 'base64', commitment: 'processed'}]);
  const result = await rpc('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched},
  }]);
  const deltas = Object.fromEntries(watched.map((address, index) => {
    const a = tokenAmount(before.value[index]);
    const b = tokenAmount(result.value.accounts?.[index]);
    return [address, a != null && b != null ? (BigInt(b) - BigInt(a)).toString() : null];
  }));
  const row = {label, metadata, err: result.value.err || null,
    unitsConsumed: result.value.unitsConsumed, logs: result.value.logs || [],
    wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder, sigVerify: true, replaceRecentBlockhash: false, sha256: sha256(signed)}, deltas};
  console.log(JSON.stringify({label, err: row.err, bytes: row.wire.bytes,
    addresses: row.wire.addresses, units: row.unitsConsumed,
    lastLogs: row.logs.slice(-8), deltas}));
  return row;
}

async function zeroClaim(address) {
  await rpc('surfnet_setAccount', [address, {data: '', executable: false, lamports: 0,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
}

async function normalizeForkRent(address) {
  const account = await rpc('getAccountInfo', [address, {encoding: 'base64', commitment: 'processed'}]);
  if (!account.value) return;
  const data = Buffer.from(account.value.data[0], 'base64');
  const minimum = await rpc('getMinimumBalanceForRentExemption', [data.length]);
  if (account.value.lamports >= minimum) return;
  await rpc('surfnet_setAccount', [address, {data: data.toString('hex'), executable: account.value.executable,
    lamports: minimum, owner: account.value.owner, rentEpoch: 0}]);
}

async function main() {
  const attacker = Keypair.generate();
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const calls = sourceCalls().slice(0, 2);
  if (calls.length !== 2) throw new Error('two recent ReceiveRenderV3 calls required');
  const first = withPayer(calls[0].ix, attacker.publicKey);
  const second = withPayer(calls[1].ix, attacker.publicKey);
  await importInstructions([first, second]);
  const vault = first.keys[10].pubkey.toBase58();
  const firstRecipientAta = first.keys[11].pubkey.toBase58();
  const secondRecipientAta = second.keys[11].pubkey.toBase58();
  const firstClaim = first.keys[18].pubkey.toBase58();
  const secondClaim = second.keys[18].pubkey.toBase58();
  const watched = [vault, firstRecipientAta, secondRecipientAta, firstClaim, secondClaim];
  // Mainnet's current rent minimum for a 165-byte token account is 1,488,440
  // lamports; Surfpool 1.6.0 uses 2,039,280. Normalize only the two historical
  // recipient ATAs so the fork tests program logic rather than that emulator gap.
  await normalizeForkRent(firstRecipientAta);
  await normalizeForkRent(secondRecipientAta);
  const cases = [];
  cases.push(await simulate('current_claim_replay', [first], attacker, watched,
    {expected: 'reject already consumed Wormhole claim'}));
  await zeroClaim(firstClaim);
  cases.push(await simulate('valid_verified_message_from_outsider_payer', [first], attacker, watched,
    {expected: 'success, but credit only signed payload recipient'}));
  const substituted = withPayer(calls[0].ix, attacker.publicKey);
  substituted.keys[12].pubkey = attacker.publicKey;
  cases.push(await simulate('recipient_wallet_substitution', [substituted], attacker, watched,
    {expected: 'reject recipient differing from signed payload'}));
  cases.push(await simulate('duplicate_same_claim_atomic', [first, first], attacker, watched,
    {expected: 'reject second redemption and roll back first'}));
  await zeroClaim(secondClaim);
  cases.push(await simulate('two_independent_verified_claims_atomic', [first, second], attacker, watched,
    {expected: 'success; each credit remains bound to its own signed recipient'}));
  const output = {generatedAt: new Date().toISOString(), fork: FORK,
    safety: {mainnetTransactionsSubmitted: false, sendTransactionPathPresent: false,
      forkMutations: 'fresh outsider lamports; two historical claim PDAs reset; two recipient ATAs topped up only to Surfpool 1.6.0 rent minimum (mainnet minimum is lower)'},
    outsider: attacker.publicKey.toBase58(), sourceCalls: calls.map(({signature, slot}) => ({signature, slot})),
    envelopeLimits: {maximumBytes: 4096, maximumAddresses: 64, version: 1, sigVerify: true}, cases};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, cases: cases.map((row) => ({label: row.label,
    err: row.err, wire: row.wire, deltas: row.deltas}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
