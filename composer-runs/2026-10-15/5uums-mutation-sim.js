#!/usr/bin/env node
// Read-only current-state adversarial simulations for 5UuMS Unlock.
// Important: sigVerify:false can fabricate a signer bit. Such cases are
// counterfactual privilege tests, not executable transactions.
const fs = require('fs');
const path = require('path');
const {PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} =
  require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const bs58 = require('./kliquidity-sdk-official/node_modules/bs58');

const DIR = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
const exemplars = JSON.parse(fs.readFileSync(path.join(DIR, '5uums-mutation-exemplars.json'))).rows;
const program = new PublicKey('5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9');
const payer = new PublicKey('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N');
const admin = '5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi';
const state = 'Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK';
const tracked = [
  '7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w', // MIM vault
  '4rfDdc8xLDWBiqRKpVQS689ivWAqe6ae9ckfc9c8HNDi', // MIM recipient
  'GQZmALKPHca7XHiXDCNiogXUP4rKWqj28CVQb4EEfCRE', // MIM fee recipient
  '5yXSQmeFkxCYrfcPpgu8UBpy3gqThvXXGVAUyRPAvVWb', // DOG vault
  '9XruDz444Wc6DwtM4rAooBgAZUGNeFnEwkyArjbBf2dA', // DOG recipient
  'A7w8ytRtX225qiPmn52kMGsob5aR3obVfL4qcqVBHeK1', // PUPS vault
  'yBvRQpgBbyrNtoWCAW6BxBHDGcqyDXgZzy2fZgiBYNC', // PUPS recipient
];
let rpcId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0', id:++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error) throw Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) {
      last = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw last;
}
function rawAmount(info) {
  if (!info?.data) return null;
  const raw = Buffer.from(info.data[0], 'base64');
  if (raw.length < 72) return null;
  return raw.readBigUInt64LE(64).toString();
}
const entry = (symbol, leg = 0) => {
  const row = exemplars[symbol];
  const ix = row.innerInstructions.flatMap(x => x.instructions)
    .filter(x => x.programId === program.toBase58())[leg];
  const keyInfo = new Map(row.accountKeys.map(x => [x.pubkey, x]));
  return {data: Buffer.from(bs58.decode(ix.data)), keys: ix.accounts.map(address => ({
    pubkey: new PublicKey(address), isSigner: address === admin,
    isWritable: !!keyInfo.get(address)?.writable,
  }))};
};
function cloneEntry(base) {
  return {data: Buffer.from(base.data), keys: base.keys.map(k => ({...k}))};
}
function setAmount(entry, amount) {entry.data.writeBigUInt64LE(BigInt(amount), 8); return entry;}
function buildIx(entry) {return new TransactionInstruction({programId: program, keys: entry.keys, data: entry.data});}
async function simulate(label, entries, observations = tracked) {
  const before = await rpc('getMultipleAccounts', [observations, {encoding:'base64', commitment:'processed'}]);
  const message = new TransactionMessage({payerKey:payer, recentBlockhash:'11111111111111111111111111111111',
    instructions:entries.map(buildIx)}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const wire = Buffer.from(tx.serialize());
  if (wire.length > 4096) throw Error(`v1 wire size ${wire.length}`);
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding:'base64',
    sigVerify:false, replaceRecentBlockhash:true, commitment:'processed', innerInstructions:true,
    accounts:{encoding:'base64', addresses:observations}}]);
  const pre = before.value.map(rawAmount);
  const post = result.value?.accounts?.map(rawAmount);
  const delta = post?.map((n,i) => n == null || pre[i] == null ? null : (BigInt(n) - BigInt(pre[i])).toString());
  return {label, bytes:wire.length, currentSlot:result.context?.slot,
    snapshotSlot:before.context?.slot, err:result.value?.err, unitsConsumed:result.value?.unitsConsumed,
    observations:observations.map((address,i) => ({address, pre:pre[i], post:post?.[i], delta:delta?.[i]})),
    logSummary:result.value?.logs?.filter(x => /5UuMS|Instruction:|AnchorError|Error|failed|Tokenkeg/.test(x)),
    rpcError:result.error};
}
async function simulateRaw(label, base64) {
  const result = await rpc('simulateTransaction', [base64, {encoding:'base64', sigVerify:false,
    replaceRecentBlockhash:true, commitment:'processed', innerInstructions:true}]);
  return {label, currentSlot:result.context?.slot, err:result.value?.err,
    unitsConsumed:result.value?.unitsConsumed,
    logSummary:result.value?.logs?.filter(x => /5UuMS|3LWzk|Instruction:|AnchorError|Error|failed/.test(x))};
}
async function main() {
  const adminAccount = await rpc('getAccountInfo', [admin, {encoding:'base64', commitment:'processed'}]);
  const stateAccount = await rpc('getAccountInfo', [state, {encoding:'base64', commitment:'processed'}]);
  const mim = entry('MIM');
  const dog = entry('DOG');
  const pups = entry('PUPS');
  const current = await rpc('getMultipleAccounts', [[tracked[0], tracked[3], tracked[5]],
    {encoding:'base64', commitment:'processed'}]);
  const vaultAmounts = current.value.map(rawAmount);
  const cases = [];
  cases.push(await simulateRaw('historical-wrapper-MIM-replay-current-state', exemplars.MIM.wireBase64));
  const missingSigner = setAmount(cloneEntry(mim), 1n);
  missingSigner.keys[0].isSigner = false;
  cases.push(await simulate('direct-unlock-missing-admin-signature', [missingSigner]));
  const alien = setAmount(cloneEntry(mim), 1n);
  alien.keys[0].pubkey = payer;
  cases.push(await simulate('direct-unlock-other-signer', [alien]));
  cases.push(await simulate('counterfactual-admin-signer-min-MIM', [setAmount(cloneEntry(mim), 1n)]));
  const alternate = setAmount(cloneEntry(mim), 1n);
  alternate.keys[4].pubkey = new PublicKey(tracked[2]);
  alternate.keys[5].pubkey = new PublicKey('7Lzj4Jr46rQUdKst1drAxSP2sBcQVvMoCBaDsrEYhWqj');
  cases.push(await simulate('counterfactual-admin-signer-alternate-recipient', [alternate]));
  cases.push(await simulate('counterfactual-admin-signer-zero-MIM', [setAmount(cloneEntry(mim), 0n)]));
  cases.push(await simulate('counterfactual-admin-signer-full-MIM', [setAmount(cloneEntry(mim), BigInt(vaultAmounts[0]))]));
  cases.push(await simulate('counterfactual-admin-signer-over-balance-MIM', [setAmount(cloneEntry(mim), BigInt(vaultAmounts[0])+1n)]));
  const alias = setAmount(cloneEntry(mim), 1n);
  alias.keys[4].pubkey = new PublicKey(tracked[0]);
  alias.keys[5].pubkey = new PublicKey(state);
  cases.push(await simulate('counterfactual-admin-signer-source-destination-alias', [alias]));
  const wrongMint = setAmount(cloneEntry(mim), 1n);
  wrongMint.keys[2].pubkey = new PublicKey('dog1viwbb2vWDpER5FrJ4YFG6gq6XuyFohUe9TXN65u');
  cases.push(await simulate('counterfactual-admin-signer-wrong-mint', [wrongMint]));
  const order = setAmount(cloneEntry(mim), 1n);
  [order.keys[2],order.keys[3]] = [order.keys[3],order.keys[2]];
  cases.push(await simulate('counterfactual-admin-signer-mint-vault-swapped', [order]));
  cases.push(await simulate('counterfactual-admin-signer-two-MIM-legs',
    [setAmount(cloneEntry(mim), 1n),setAmount(cloneEntry(mim), 1n)]));
  cases.push(await simulate('counterfactual-admin-signer-min-DOG', [setAmount(cloneEntry(dog), 1n)]));
  cases.push(await simulate('counterfactual-admin-signer-min-PUPS', [setAmount(cloneEntry(pups), 1n)]));
  const output = {generatedAt:new Date().toISOString(), transport:'get* and simulateTransaction only; no signing, no send',
    caveat:'sigVerify:false with synthetic signer bit is a privilege counterfactual and cannot show attacker feasibility',
    adminAccount:{address:admin, onCurve:PublicKey.isOnCurve(new PublicKey(admin).toBytes()),
      owner:adminAccount.value?.owner, lamports:adminAccount.value?.lamports, dataLength:adminAccount.value?.data?.[0] && Buffer.from(adminAccount.value.data[0], 'base64').length},
    stateAccount:{address:state, onCurve:PublicKey.isOnCurve(new PublicKey(state).toBytes()), owner:stateAccount.value?.owner},
    vaultAmounts:{MIM:vaultAmounts[0], DOG:vaultAmounts[1], PUPS:vaultAmounts[2]}, cases};
  fs.writeFileSync(path.join(DIR,'5uums-mutation-sim.json'), JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({adminAccount:output.adminAccount, vaultAmounts:output.vaultAmounts,
    cases:cases.map(c => ({label:c.label,bytes:c.bytes,err:c.err,unitsConsumed:c.unitsConsumed,
      deltas:c.observations?.filter(x => x.delta && x.delta !== '0').map(x => ({address:x.address,delta:x.delta})),
      logTail:c.logSummary?.slice(-5)}))},null,2));
}
main().catch(error => {console.error(error.stack || error.message); process.exitCode=1});
