#!/usr/bin/env node
// Read-only, sigVerify:false simulations derived from a recent successful DGLD swap.
// No wallet is connected and no transaction is submitted.
const fs = require('fs');
const {Connection, PublicKey, Transaction, TransactionInstruction} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const bs58mod = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;
const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8').split(/\r?\n/)
  .find(x => /^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if (!row) throw Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');
const programId = new PublicKey('HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8');
const sourceSignature = '2qeWYN1pyNvsbedyBX4hFHgaXrWYar9yg9bv7ieWqpVCrDZnfsWFNmo9NgUoGsKLiVukq1F9814K7tX5U9tAReAU';
const sourceFeePayer = new PublicKey('prUWZMpQAbRzmqnRqcoSh8jqcJ1M1g64uxsR7mq9bmv');
const addresses = [
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs',
  'EL8ydNSekaHhJbTvXZ4fM4oPSc8U1SipRBRMHMLFiNMW',
  '96EGMKrMjkktPMsxaSUUAtHJH2GCneCooS2YehAt9Epn',
  'AYZLyjh7uyd9wGzGPQ9VUvXMJZNZbd1f5dJQXeQz1qQS',
  // This successful mainnet route intentionally aliases the unused authority slot to config.
  'rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs',
  'Fe7SEekiKygziaEGKxsDsgLVzrCfNvVBvAYsaJBwFA8s',
  'AN79iAC4SZvCDFFFE28UiKK9VNpPpB1FpivBjR2aYAus',
  '6wDjoz5W9YvyPS3DNata4JbK9no8g9p9Xxxjr8z3UD5t',
  '6qLvvh792CmACUTRMvZg1roAqbnHUsLyLnQJPjRp4CMe',
  '5D3br1bKTe93WFxZ5SthwxYwstjLHWECaFe9MT1j9g2S',
  '63sGvdACSA2Kvf4yr7n7SFEJ9V1yAVVyyduPU3br8Lyt',
  'CVNTqUjHpsvNZ4h15yn1524eNEi4iVMyrbwvZsHzHrcZ',
  'SysvarC1ock11111111111111111111111111111111',
  'Eq29w5HSb8S79c3x6gS1soTx8oqzkqmcNpfhejEBf2PQ',
  'dg1dmo6NZNagkwB6EAfUeaco6CFXFLRhb1KCrsqXTVz'
];
const writable = new Set([2, 5, 8, 9, 10, 11, 13, 15]);
const signer = 7;
const data = Buffer.from(bs58.decode('6LfwoiohK12LjFA7enghHW3aq3jLAH7JVN6'));

async function simulate(name, aliases = {}) {
  const resolved = addresses.map((address, i) => aliases[i] === undefined ? address : addresses[aliases[i]]);
  const ix = new TransactionInstruction({programId, data, keys: resolved.map((address, i) => ({
    pubkey: new PublicKey(address), isSigner: i === signer, isWritable: writable.has(i)
  }))});
  const tx = new Transaction();
  tx.feePayer = sourceFeePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  tx.add(ix);
  tx.addSignature(tx.feePayer, Buffer.alloc(64));
  tx.addSignature(new PublicKey(resolved[signer]), Buffer.alloc(64));
  const wire = tx.serialize({requireAllSignatures: false, verifySignatures: false}).toString('base64');
  const result = await connection._rpcRequest('simulateTransaction', [wire, {
    encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: true
  }]);
  if (result.error) throw Error(JSON.stringify(result.error));
  const value = result.result.value;
  return {name, aliases, err: value.err, unitsConsumed: value.unitsConsumed,
    returnData: value.returnData || null, logs: value.logs || []};
}

async function main() {
  const source = await connection.getParsedTransaction(sourceSignature, {commitment: 'confirmed', maxSupportedTransactionVersion: 1});
  const probes = [];
  probes.push(await simulate('baseline_recent_success_accounts'));
  probes.push(await simulate('alias_user_source_to_vault_source', {8: 9}));
  probes.push(await simulate('alias_vault_source_to_vault_dest', {9: 10}));
  probes.push(await simulate('alias_vault_dest_to_user_dest', {10: 11}));
  probes.push(await simulate('alias_curve_updates_to_curve_prefabs', {15: 5}));
  probes.push(await simulate('alias_fee_recipient_to_vault_source', {13: 9}));
  const output = {
    observedAtUtc: new Date().toISOString(), noTransactions: true, sigVerify: false,
    sourceSignature, sourceSlot: source.slot, sourceErr: source.meta.err,
    sourceObservedAlias: {account2: addresses[2], account6: addresses[6], meaning: 'config equals SDK-documented unused _authority slot'},
    amountIn: data.readBigUInt64LE(2).toString(), probes
  };
  const out = __dirname + '/hadron-account-alias-probes.json';
  fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({out, sourceSlot: source.slot, probes: probes.map(p => ({name: p.name, err: p.err,
    lastLogs: p.logs.slice(-5)}))}, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
