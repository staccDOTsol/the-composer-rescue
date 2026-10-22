#!/usr/bin/env node
// Current-binary, read-only ClaimRewards control and account-binding probes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const web3 = require('/Users/stacc/ftl/server/node_modules/@solana/web3.js');
const bs58pkg = require('/Users/stacc/ftl/server/node_modules/bs58');
const bs58 = bs58pkg.default || bs58pkg;
const dir = __dirname;
const program = 'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const signature = '4tdqCnpE3apHWD1nKjAbNnUnjcTteCvAgPm8Kmmfq3rz5oEMWXAAPmRLK7186EcnqvNzCUMSiFdmL2bWYHGtLvaF';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter((s) => s.includes('=')).map((s) => s.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
async function rpc(method, params) {
  const res = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const data = await res.json();
  if (!res.ok || data.error) throw Error(`${method}: ${res.status} ${JSON.stringify(data.error || {})}`);
  return data.result;
}
const pk = (s) => new web3.PublicKey(s);
function summary(a) {
  if (!a) return null;
  const data = Buffer.from(a.data[0], 'base64');
  const v = {owner: a.owner, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex')};
  if (a.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && data.length >= 72)
    v.token = {mint: bs58.encode(data.subarray(0, 32)), authority: bs58.encode(data.subarray(32, 64)),
      amount: data.readBigUInt64LE(64).toString()};
  return v;
}
async function main() {
  const hist = await rpc('getTransaction', [signature, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
  if (!hist || hist.meta.err) throw Error('Historical transaction unavailable or failed');
  const msg = hist.transaction.message, keys = msg.accountKeys, h = msg.header;
  const claims = msg.instructions.filter((i) => keys[i.programIdIndex] === program);
  if (claims.length !== 4) throw Error('Expected four historical claims');
  function writable(i) {return i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
    : i < keys.length - h.numReadonlyUnsignedAccounts;}
  function reconstruct(ix) {return ix.accounts.map((index) => ({key: keys[index], signer: index < h.numRequiredSignatures,
    writable: writable(index)}));}
  const originalAccounts = claims.map(reconstruct);
  const data = Buffer.from(bs58.decode(claims[0].data));
  // This RPC caps returned post-simulation accounts at 11. Include the shared
  // state/recipient and all four commission destinations for the multi-claim run.
  const monitors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13].map((i) => keys[i]);
  const pre = await rpc('getMultipleAccounts', [monitors, {encoding: 'base64', commitment: 'confirmed'}]);
  const before = Object.fromEntries(monitors.map((key, i) => [key, summary(pre.value[i])]));
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  function ix(accounts) {return new web3.TransactionInstruction({programId: pk(program), keys: accounts.map((a) =>
    ({pubkey: pk(a.key), isSigner: a.signer, isWritable: a.writable})), data});}
  const cases = [
    {name: 'claim_one_current', accounts: [originalAccounts[0]]},
    {name: 'claim_same_pool_twice', accounts: [originalAccounts[0], originalAccounts[0]]},
    {name: 'claim_four_pools_historical_order', accounts: originalAccounts},
    {name: 'claim_four_pools_reverse_order', accounts: [...originalAccounts].reverse()},
    {name: 'claim_wrong_signer', accounts: [originalAccounts[0].map((a, i) => i === 8 ? {...a, key: 'G5DXoJ2F3aPa6R93gGLmSQy5PvAbzoEkzkNYgeyun5B9'} : a)]},
    {name: 'claim_commission_destination_aliases_user_destination', accounts: [originalAccounts[0].map((a, i) => i === 7 ? {...a, key: originalAccounts[0][6].key} : a)]},
    {name: 'claim_reward_vault_aliases_staking_vault', accounts: [originalAccounts[0].map((a, i) => i === 5 ? {...a, key: 'GBSdbtzKg6A1a9HM99AvCUWpzXbDq4hbgAX5Q48N7VRK'} : a)]},
    {name: 'claim_staking_pool_crossed', accounts: [originalAccounts[0].map((a, i) => i === 1 ? {...a, key: originalAccounts[1][1].key} : a)]},
    {name: 'claim_user_destination_crossed', accounts: [originalAccounts[0].map((a, i) => i === 6 ? {...a, key: originalAccounts[0][7].key} : a)]},
  ];
  const outcomes = [];
  for (const test of cases) {
    const message = new web3.TransactionMessage({payerKey: pk(keys[0]), recentBlockhash: blockhash,
      instructions: test.accounts.map(ix)}).compileToV0Message();
    const tx = new web3.VersionedTransaction(message);
    const wire = Buffer.from(tx.serialize());
    if (wire.length > 1232) throw Error(`v0 control ${test.name} oversized: ${wire.length}`);
    const simMonitors = monitors.slice(0, message.staticAccountKeys.length);
    const sim = await rpc('simulateTransaction', [wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      minContextSlot: pre.context.slot,
      innerInstructions: true, accounts: {encoding: 'base64', addresses: simMonitors},
    }]);
    const after = Object.fromEntries(simMonitors.map((key, i) => [key, summary(sim.value.accounts?.[i])]));
    const tokenDeltas = Object.fromEntries(simMonitors.map((key) => {
      const x = before[key]?.token?.amount, y = after[key]?.token?.amount;
      return [key, x == null || y == null ? null : (BigInt(y) - BigInt(x)).toString()];
    }));
    const changedProgramStates = simMonitors.filter((key) => after[key] && before[key]?.owner === program &&
      before[key]?.sha256 !== after[key]?.sha256);
    outcomes.push({name: test.name, accountKeys: test.accounts.map((a) => a.map((v) => v.key)),
      wireBytes: wire.length, monitoredAccounts: simMonitors, slot: sim.context.slot,
      err: sim.value.err, unitsConsumed: sim.value.unitsConsumed,
      logs: sim.value.logs, innerInstructions: sim.value.innerInstructions, after,
      tokenDeltasVsPreRead: tokenDeltas, changedProgramStates});
    console.log(test.name, JSON.stringify(sim.value.err), 'units', sim.value.unitsConsumed);
  }
  const report = {generatedAt: new Date().toISOString(), method: 'read-only simulateTransaction, sigVerify:false, no sendTransaction',
    program, historical: {signature, slot: hist.slot, err: hist.meta.err, header: h,
      accountKeys: keys, claimDataHex: data.toString('hex'), claimAccounts: originalAccounts},
    preRead: {slot: pre.context.slot, accounts: before}, outcomes};
  const file = path.join(dir, 'eyx-claim-sim.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log('wrote', file);
}
main().catch((e) => {console.error(e.stack || e.message); process.exitCode = 1;});
