#!/usr/bin/env node
'use strict';

// Current-mainnet-backed, local-fork-only proof for the Byreal tick-array edge.
// No transaction is sent to mainnet or to the fork.
const crypto = require('crypto');
const fs = require('fs');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} = require(MOD + '@solana/web3.js');
const spl = require(MOD + '@solana/spl-token');
const bs58Module = require(MOD + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1, signV1} = require('../2026-10-15/hylo-exchange-v1-wire.js');

const RPC = 'https://api.mainnet-beta.solana.com';
const FORK = 'http://127.0.0.1:19107';
const PROGRAM = new PublicKey('REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2');
const POOL = new PublicKey('Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const CRCL = new PublicKey('XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1');
const BITMAP = new PublicKey('8HGwy2uNb2iQshSh92toBUHvAYYsNnCMYBZFWWmAFidW');
const FIXTURE = JSON.parse(fs.readFileSync('../2026-10-15/byreal-current-fixture.json', 'utf8'));
const OUTPUT = 'byreal-tick-array-proof.json';
let id = 0;
async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    signal: AbortSignal.timeout(20_000), body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const upstream = (method, params) => rpc(RPC, method, params);
const fork = (method, params) => rpc(FORK, method, params);
const P = value => new PublicKey(value);

const allArrays = [
  [-2400, 'GFSnRB8RAXkqFmAiewsmb4p3zxuDTx9dY54NXYpSPwi7'],
  [-1800, '4BRN37zva7rQNiU2sGKjxxvRRuHppnXQXPptMit587ST'],
  [-1200, '6k85MtwzGpktsbdQ6NX7Ea8UXWhy2zMKhLX6A9jWbXM9'],
  [-600, 'Aw7LLKnEj2E3fXLxkhwzwrYX8Yh7Jd3oEnz5h82hwgJj'],
  [0, 'CSdb5FRZj6oBMXK9DyzoysqdpT9z3QDuFLsntbpHyD1M'],
  [600, '2KGCyeXLD3wrvPTgywfL4zUob1eoDrYLPzYCVWbaP9ck'],
  [1200, 'CCrMi7iW4EPMDsTo5mAhU3oF7aGxkEYgBCwcBFjHtNvG'],
  [1800, 'CyzYC3FoScKVNuwNtALoAKVjkEDBbZKtcQS3Uc4vD3j5'],
  [2400, 'CtMGKEkodYZf4yqkw7AqzWLBe33Uwb3XCJLrj1dUEpN4'],
  [3000, '9WHr3mjsdEVNDLQs9gxR3xrbgzwXccp4DSxUoQcovGXz'],
  [3600, 'GJvc2JZ4tJTfkto7fAf8WbbgLHeaqXmv8iwkqhz5baeC'],
  [4200, 'CfkJ99FowajLKuVCq3zwi8M2nyqFsWzb6fp6QcCbP182'],
  [6000, '4bbRAuCWnEAkdAeak7gUXri7vJKksERWTDJGVAERaRe2'],
  [6600, '4LMgzfwyfGCEEF4PRvL7EvuiWL3fvE6fucErpi7RuchU'],
];

function derive(start) {
  const bytes = Buffer.alloc(4); bytes.writeInt32BE(start);
  return PublicKey.findProgramAddressSync([Buffer.from('tick_array'), POOL.toBuffer(), bytes], PROGRAM)[0];
}
function tokenAmount(account) {
  if (!account?.data) return null;
  return Buffer.from(account.data[0], 'base64').readBigUInt64LE(64);
}
async function setToken(target, template, authority, amount) {
  const row = (await upstream('getAccountInfo', [template, {encoding: 'base64', commitment: 'confirmed'}])).value;
  const data = Buffer.from(row.data[0], 'base64');
  authority.toBuffer().copy(data, 32); data.writeBigUInt64LE(amount, 64);
  await fork('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'), executable: false,
    lamports: row.lamports, owner: row.owner, rentEpoch: 0}]);
}
function baseInstruction(signer, userUsdc, userCrcl) {
  const message = FIXTURE.chosenTransaction.transaction.message;
  const source = message.instructions.find(ix => ix.programId === PROGRAM.toBase58());
  const meta = new Map(message.accountKeys.map(key => [key.pubkey, key]));
  const replacements = new Map([
    ['Hasda78TSaT9bjiPxDBvP4GpohFpP3TDTaJEcCYK5kyN', signer],
    ['ArwpdfBciGYoxVFbJKKqEmhLbtCjZk9sy9Be3VLvrUtL', userUsdc],
    ['5AK1cujgbvgfSxpQ2HphKKfGhdPnQLTKHBRgtktDiPLt', userCrcl],
  ]);
  const baseAccounts = source.accounts.slice(0, 13);
  return new TransactionInstruction({programId: PROGRAM, keys: baseAccounts.map(address => {
    const m = meta.get(address); return {pubkey: replacements.get(address) || P(address),
      isSigner: Boolean(m.signer), isWritable: Boolean(m.writable)};
  }), data: Buffer.from(bs58.decode(source.data))});
}
function swap(ix, amount, arrays) {
  const data = Buffer.from(ix.data); data.writeBigUInt64LE(amount, 8); data.writeBigUInt64LE(0n, 16);
  data.fill(0, 24, 40); data[40] = 1;
  return new TransactionInstruction({programId: ix.programId,
    keys: [...ix.keys, {pubkey: BITMAP, isSigner: false, isWritable: true},
      ...arrays.map(([, address]) => ({pubkey: P(address), isSigner: false, isWritable: true}))], data});
}
async function simulate(label, signer, ix, watched) {
  for (const key of [ix.programId, ...ix.keys.map(x => x.pubkey)]) {
    await fork('getAccountInfo', [key.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
  const before = await fork('getMultipleAccounts', [watched.map(String), {encoding: 'base64', commitment: 'processed'}]);
  const blockhash = (await fork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([ix], signer.publicKey, blockhash);
  const signed = signV1(encoded, [ix], signer.publicKey, blockhash, [signer]);
  const result = await fork('simulateTransaction', [signed.wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)}}]);
  const deltas = watched.map((_, i) => result.value.accounts?.[i] && before.value[i]
    ? (tokenAmount(result.value.accounts[i]) !== null && tokenAmount(before.value[i]) !== null
      ? (tokenAmount(result.value.accounts[i]) - tokenAmount(before.value[i])).toString() : null) : null);
  return {label, err: result.value.err, unitsConsumed: result.value.unitsConsumed, sigVerify: true,
    wire: {sizeBytes: encoded.sizeBytes, addressCount: encoded.addressCount, instructionCount: encoded.instructionCount,
      sha256: crypto.createHash('sha256').update(signed.wire).digest('hex')}, deltas,
    logs: result.value.logs};
}

(async () => {
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(`${process.env.HOME}/hooked.json`, 'utf8')));
  const signer = Keypair.fromSecretKey(secret);
  const userUsdc = spl.getAssociatedTokenAddressSync(USDC, signer.publicKey, false, spl.TOKEN_PROGRAM_ID);
  const userCrcl = spl.getAssociatedTokenAddressSync(CRCL, signer.publicKey, false, spl.TOKEN_2022_PROGRAM_ID);
  await fork('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await setToken(userUsdc, 'ArwpdfBciGYoxVFbJKKqEmhLbtCjZk9sy9Be3VLvrUtL', signer.publicKey, 8_000_000_000_000n);
  await setToken(userCrcl, '5AK1cujgbvgfSxpQ2HphKKfGhdPnQLTKHBRgtktDiPLt', signer.publicKey, 0n);
  const base = baseInstruction(signer.publicKey, userUsdc, userCrcl);
  const watched = [userUsdc, userCrcl, P('5JcntpKHEy2vyjCiiLY5e4Te1ZVG1zU6pp6ZU667d6tw'),
    P('8feVD1rbhaE17kZiWhTssFrC75DUoJUCX9SLZ6C9oxhd')];
  const cases = [];
  for (const amount of [256_263_056_904n, 256_263_056_905n, 256_263_056_906n,
    300_000_000_000n, 500_000_000_000n, 1_000_000_000_000n,
    260_000_000_000n, 270_000_000_000n, 280_000_000_000n, 290_000_000_000n,
    2_000_000_000_000n, 5_000_000_000_000n, 7_800_000_000_000n]) {
    cases.push(await simulate(`historical_arrays_${amount}`, signer, swap(base, amount, allArrays.slice(0, 4)), watched));
    cases.push(await simulate(`expanded_arrays_${amount}`, signer, swap(base, amount, allArrays), watched));
  }
  const addressPage = await fork('getMultipleAccounts', [[BITMAP, ...allArrays.map(x => x[1])].map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const output = {observedAt: new Date().toISOString(), currentSlot: addressPage.context.slot,
    pool: POOL.toBase58(), tickSpacing: 10, direction: 'USDC mint1 -> CRCLx mint0; zero_for_one=false; increasing ticks',
    signer: signer.publicKey.toBase58(), noBroadcast: true,
    bitmap: BITMAP.toBase58(), arrays: allArrays.map(([start, address], i) => ({start, address,
      derived: derive(start).toBase58(), pdaMatches: derive(start).toBase58() === address,
      exists: Boolean(addressPage.value[i + 1]), dataLength: addressPage.value[i + 1] && Buffer.from(addressPage.value[i + 1].data[0], 'base64').length})),
    cases};
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: `${process.cwd()}/${OUTPUT}`, cases: cases.map(x => ({label: x.label,
    err: x.err, units: x.unitsConsumed, wire: x.wire, tail: x.logs?.slice(-4)}))}, null, 2));
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
