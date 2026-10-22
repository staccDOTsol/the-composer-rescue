#!/usr/bin/env node
'use strict';
// Read-only historical deposit/exit accounting for the same route vault.
const fs = require('fs');
const path = require('path');
const {Keypair} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const secret = JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'));
if (!Array.isArray(secret) || secret.length !== 64) throw Error('hooked keypair invalid');
Keypair.fromSecretKey(Uint8Array.from(secret));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC unavailable');
const sigs = [
  '33ZkMvFeX6DPEaReSKwkk1aMLmkoqP8fP4iLtS5oqoSowp1uDBdp5xAkbgXz8x8EMFLGf1bMZxd4fHdJdkawebWg',
  '57LeX53drHw7R81WbTySjBQGLJd5VQnjHxHMwPWg9FiUJuL8mvJSQfn6r9d9sucQuGWyEbe7PLbYBCuNAqU8Pk4G',
  '3nTDaJTxBYAPo7w5UZDJuoEYnavwCBCmVn2kKpnigbjL2Qsipj54GJD6NSQ2Vuizi6ao5cjoHxHFYMo3G2LA1mMW',
];
async function read(signature, id) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id, method: 'getTransaction', params: [signature,
      {encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]})});
  const j = await r.json();
  if (!r.ok || j.error || !j.result) throw Error(`historical transaction unavailable: ${id}`);
  const tx = j.result;
  const keys = tx.transaction.message.accountKeys.map(x => x.pubkey);
  const balances = [tx.meta.preTokenBalances || [], tx.meta.postTokenBalances || []]
    .map(rows => Object.fromEntries(rows.map(x => [x.accountIndex, {
      account: keys[x.accountIndex], mint: x.mint, owner: x.owner || null,
      raw: x.uiTokenAmount.amount, decimals: x.uiTokenAmount.decimals,
    }])));
  const allIndexes = [...new Set([...Object.keys(balances[0]), ...Object.keys(balances[1])])];
  const tokenDeltas = allIndexes.map(i => ({index: Number(i), account: keys[Number(i)],
    mint: balances[1][i]?.mint || balances[0][i]?.mint,
    owner: balances[1][i]?.owner || balances[0][i]?.owner,
    beforeRaw: balances[0][i]?.raw || '0', afterRaw: balances[1][i]?.raw || '0',
    deltaRaw: (BigInt(balances[1][i]?.raw || '0') - BigInt(balances[0][i]?.raw || '0')).toString(),
  })).filter(x => x.deltaRaw !== '0');
  const ixs = tx.transaction.message.instructions.filter(x => x.programId === '8ybMhmtJb1VS6cqV4bPapvEUCRg3EGGrjpNhkLBPezA7');
  return {signature, slot: tx.slot, signer: tx.transaction.message.accountKeys.find(x => x.signer)?.pubkey,
    instructionData: ixs.map(x => x.data), tokenDeltas};
}
Promise.all(sigs.map(read)).then(rows => {
  const file = path.join(__dirname, '8yb-perena-historical-flows.json');
  fs.writeFileSync(file, JSON.stringify({generatedAt: new Date().toISOString(), rows}, null, 2) + '\n');
  console.log(JSON.stringify(rows.map(x => ({slot: x.slot, signature: x.signature,
    tokenDeltas: x.tokenDeltas.filter(y => y.owner === x.signer)}))));
}).catch(e => { console.error(e.message); process.exitCode = 1; });
