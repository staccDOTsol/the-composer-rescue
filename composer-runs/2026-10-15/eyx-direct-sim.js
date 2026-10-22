#!/usr/bin/env node
// Read-only simulation of the current GRASS staking executable. No sendTransaction call.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const web3 = require('/Users/stacc/ftl/server/node_modules/@solana/web3.js');
const bs58pkg = require('/Users/stacc/ftl/server/node_modules/bs58');
const bs58 = bs58pkg.default || bs58pkg;

const DIR = __dirname;
const PROGRAM = 'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const SIGNATURE = 'vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter((s) => s.includes('=')).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const RPC = env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC) throw new Error('Read-only RPC unavailable');

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
      const result = await response.json();
      if (!response.ok || result.error) throw Error(`${method}: ${response.status} ${JSON.stringify(result.error || {})}`);
      return result.result;
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw last;
}

const pk = (s) => new web3.PublicKey(s);
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
function summarizeAccount(a) {
  if (!a) return null;
  const data = Buffer.from(a.data[0], 'base64');
  const result = {owner: a.owner, lamports: a.lamports, size: data.length, sha256: sha(data)};
  if (a.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && data.length >= 72) {
    result.token = {mint: bs58.encode(data.subarray(0, 32)),
      authority: bs58.encode(data.subarray(32, 64)), amount: data.readBigUInt64LE(64).toString()};
  }
  return result;
}

async function main() {
  const hist = await rpc('getTransaction', [SIGNATURE,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  if (!hist || hist.meta.err !== null) throw Error('Historical control transaction missing or failed');
  const msg = hist.transaction.message;
  const keys = msg.accountKeys;
  const h = msg.header;
  if (keys[msg.instructions[0].programIdIndex] !== PROGRAM) throw Error('Unexpected historical program');
  const original = msg.instructions[0];
  const originalData = Buffer.from(bs58.decode(original.data));
  if (originalData.subarray(0, 8).toString('hex') !== 'b712469c946da122') throw Error('Unexpected Withdraw discriminator');
  const isWritable = (i) => i < h.numRequiredSignatures
    ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
    : i < keys.length - h.numReadonlyUnsignedAccounts;
  const baseline = original.accounts.map((index) =>
    ({pubkey: keys[index], isSigner: index < h.numRequiredSignatures, isWritable: isWritable(index)}));
  const monitors = [...new Set([
    keys[original.accounts[1]], keys[original.accounts[2]], keys[original.accounts[3]],
    keys[original.accounts[4]], keys[original.accounts[5]], keys[0], keys[7],
    'BSb68HCsLMsuq9BSTZHKhTfZSyTMhUfipgvwaUDjBmv1',
    '5JwNA9W3SC5q8Ht23dGnWvixsaHkkbvmTX9eiZ9t9XUB',
  ])];
  const pre = await rpc('getMultipleAccounts', [monitors, {encoding: 'base64', commitment: 'confirmed'}]);
  const preAccounts = Object.fromEntries(monitors.map((key, i) => [key, summarizeAccount(pre.value[i])]));
  const latestBlockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const makeIx = (accounts, data = originalData) => new web3.TransactionInstruction({
    programId: pk(PROGRAM),
    keys: accounts.map((a) => ({pubkey: pk(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable})),
    data,
  });
  const cases = [
    {name: 'historical_withdraw_current_state', mutate: (a) => a},
    {name: 'withdraw_twice_atomic', mutate: (a) => a, repeats: 2},
    {name: 'unauthorized_claimant_signer', mutate: (a) => {a[6].pubkey = keys[0]; return a;}},
    {name: 'alternate_destination_same_mint', mutate: (a) => {a[5].pubkey = keys[7]; return a;}},
    {name: 'other_pool_with_original_vault', mutate: (a) => {a[1].pubkey = 'BSb68HCsLMsuq9BSTZHKhTfZSyTMhUfipgvwaUDjBmv1'; return a;}},
    {name: 'other_vault_with_original_pool', mutate: (a) => {a[4].pubkey = '5JwNA9W3SC5q8Ht23dGnWvixsaHkkbvmTX9eiZ9t9XUB'; return a;}},
    {name: 'other_pool_and_vault_original_claim', mutate: (a) => {a[1].pubkey = 'BSb68HCsLMsuq9BSTZHKhTfZSyTMhUfipgvwaUDjBmv1'; a[4].pubkey = '5JwNA9W3SC5q8Ht23dGnWvixsaHkkbvmTX9eiZ9t9XUB'; return a;}},
    {name: 'reward_pool_aliases_vault', mutate: (a) => {a[1].pubkey = a[4].pubkey; return a;}},
    {name: 'destination_aliases_vault', mutate: (a) => {a[5].pubkey = a[4].pubkey; return a;}},
    {name: 'withdraw_bool_one', mutate: (a) => a, data: Buffer.concat([originalData.subarray(0, 8), Buffer.from([1])])},
    {name: 'withdraw_instruction_data_trailing', mutate: (a) => a, data: Buffer.concat([originalData, Buffer.alloc(8, 255)])},
  ];
  const outcomes = [];
  for (const test of cases) {
    const accounts = test.mutate(baseline.map((a) => ({...a})));
    const instructions = Array.from({length: test.repeats || 1}, () => makeIx(accounts, test.data || originalData));
    const message = new web3.TransactionMessage({payerKey: pk(keys[0]), recentBlockhash: latestBlockhash,
      instructions}).compileToV0Message();
    const tx = new web3.VersionedTransaction(message);
    const raw = Buffer.from(tx.serialize());
    if (raw.length > 1232) throw Error(`test ${test.name} exceeds Solana transaction wire limit`);
    const result = await rpc('simulateTransaction', [raw.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      innerInstructions: true, accounts: {encoding: 'base64', addresses: monitors},
    }]);
    const postAccounts = Object.fromEntries(monitors.map((key, i) => [key, summarizeAccount(result.value.accounts?.[i])]));
    const deltas = Object.fromEntries(monitors.map((key) => {
      const before = preAccounts[key]?.token?.amount;
      const after = postAccounts[key]?.token?.amount;
      return [key, before == null || after == null ? null : (BigInt(after) - BigInt(before)).toString()];
    }));
    outcomes.push({name: test.name, wireBytes: raw.length, instructionDataHex: (test.data || originalData).toString('hex'),
      accounts, slot: result.context?.slot, err: result.value.err,
      unitsConsumed: result.value.unitsConsumed, logs: result.value.logs,
      innerInstructions: result.value.innerInstructions,
      postAccounts, tokenAmountDeltasVsPreRead: deltas});
    console.log(test.name, JSON.stringify(result.value.err), 'units', result.value.unitsConsumed);
  }
  const report = {generatedAt: new Date().toISOString(), method: 'read-only simulateTransaction; sigVerify:false; no sendTransaction',
    program: PROGRAM, reference: {signature: SIGNATURE, slot: hist.slot, err: hist.meta.err,
      signerAndWritableFlagsFromHeader: h, accountKeys: keys, instructionDataHex: originalData.toString('hex'),
      withdrawalAccountKeys: baseline}, preRead: {slot: pre.context.slot, accounts: preAccounts}, outcomes};
  const target = path.join(DIR, 'eyx-direct-sim.json');
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${target}`);
}

main().catch((error) => {console.error(error.stack || error.message); process.exitCode = 1;});
