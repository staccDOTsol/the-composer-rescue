#!/usr/bin/env node
// Read-only DGLD pending-curve-update snapshot. Never signs or submits transactions.
const fs = require('fs');
const path = require('path');
const {Connection, PublicKey} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron, decodeCurveUpdates} = require('./hadron-sdk/package/dist/index.js');

const poolAddress = new PublicKey('rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs');
const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8').split(/\r?\n/)
  .find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
if (!row) throw new Error('SOLANA_RPC missing');
const rpcUrl = row.slice(row.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
const connection = new Connection(rpcUrl, 'confirmed');
const json = value => JSON.parse(JSON.stringify(value, (_, v) =>
  typeof v === 'bigint' ? v.toString() : v?.toBase58 ? v.toBase58() : v));

async function main() {
  const genesis = await connection.getGenesisHash();
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('wrong cluster');
  const pool = await Hadron.load(connection, poolAddress);
  const result = await connection.getAccountInfoAndContext(pool.addresses.curveUpdates, 'confirmed');
  if (!result.value) throw new Error('curve updates account missing');
  const updates = decodeCurveUpdates(result.value.data);
  const output = {
    observedAtUtc: new Date().toISOString(),
    genesis,
    slot: result.context.slot,
    noTransactions: true,
    pool: poolAddress.toBase58(),
    poolState: pool.config.state,
    midprice: pool.getMidprice(),
    spreadBps: pool.getSpreadBps(),
    activeCurveSlots: pool.getActiveCurveSlots(),
    curveUpdatesAddress: pool.addresses.curveUpdates.toBase58(),
    updates: json(updates),
    conclusion: updates.numOps === 0
      ? 'No pending curve operations can be applied by the next swap at this slot.'
      : 'Pending curve operations exist and require exact next-swap evaluation.',
  };
  fs.writeFileSync(path.join(__dirname, 'hadron-dgld-curve-updates.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
