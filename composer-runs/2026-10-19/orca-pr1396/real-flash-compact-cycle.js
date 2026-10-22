#!/usr/bin/env node
'use strict';

// Follow-on stress with one update after each WSOL-input swap. The preceding
// optimized setup transaction already initialized this actor and margin.

const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {PublicKey} = require(`${MODULES}/@solana/web3.js`);
const {getAssociatedTokenAddressSync} = require(`${MODULES}/@solana/spl-token`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');
const {FORK, POOL, POSITION, WSOL_VAULT, USDC_MINT, USDC_VAULT,
  swap, update, tokenAmount, positionImage} = require('./real-flash-swap-roundtrip.js');
const {remap, poolImage, accountImages, seed} = require('./real-flash-cycle-ceiling.js');

if (FORK !== 'http://127.0.0.1:48899') throw new Error('Local fork :48899 only');
const actor = seed('orca-pr1396-optimized-cycle-actor-2026-10-19');
const margin = seed('orca-pr1396-optimized-cycle-margin-2026-10-19');
const ataA = getAssociatedTokenAddressSync(new PublicKey(PROGRAMS.wsol), actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
const OUT = path.join(__dirname, 'real-flash-compact-cycle.json');

function payload(cycles) {
  const result = [];
  for (let i = 0; i < cycles; i += 1) {
    result.push(remap(swap({amount: 1_000_000_000n,
      exactInput: true, aToB: true, otherAmountThreshold: 0n}), actor, ataA, ataB));
    result.push(update());
    result.push(remap(swap({amount: 980_000_000n,
      exactInput: false, aToB: false,
      otherAmountThreshold: 0xffffffffffffffffn}), actor, ataA, ataB));
  }
  result.push(update());
  return result;
}

async function oneCase(cycles) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const envelope = buildFlashEnvelope({actor, marginAccount: margin,
    providers: ['save', 'klend', 'project0'],
    amounts: {save: 1_000_000_000n, klend: 1_000_000_000n,
      project0: 1_000_000_000n},
    payloadInstructions: payload(cycles), blockhash,
    initializeMargin: false, createWsolAta: false, saveFeeTopup: false});
  const watch = [POOL, POSITION, WSOL_VAULT, USDC_VAULT, ataA, ataB];
  const sim = await simulateFlashEnvelope(FORK, envelope, watch);
  const at = address => sim.watched.indexOf(address.toBase58());
  const summary = {cycles, err: sim.err, completeRepayment: sim.completeRepayment,
    stats: sim.stats, unitsConsumed: sim.unitsConsumed,
    swapsLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: Swap')).length,
    updatesLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: UpdateFeesAndRewards')).length,
    actorWsolBefore: tokenAmount(sim.beforeAccounts[at(ataA)]),
    actorWsolAfter: tokenAmount(sim.afterAccounts[at(ataA)]),
    poolWsolBefore: tokenAmount(sim.beforeAccounts[at(WSOL_VAULT)]),
    poolWsolAfter: tokenAmount(sim.afterAccounts[at(WSOL_VAULT)]),
    positionBefore: positionImage(sim.beforeAccounts[at(POSITION)]),
    positionAfter: positionImage(sim.afterAccounts[at(POSITION)]),
    poolBefore: poolImage(sim.beforeAccounts[at(POOL)]),
    poolAfter: poolImage(sim.afterAccounts[at(POOL)]),
    lenderVaultDeltas: sim.lenderVaultDeltas,
    finalLogs: sim.logs.slice(-10)};
  return {summary, envelope, watch};
}

async function commit(result) {
  const {envelope, watch} = result;
  const addresses = [...new Set([...Object.values(envelope.lenderAccounts),
    ...watch.map(value => value.toBase58())])];
  const before = await accountImages(addresses);
  const signature = await rpc(FORK, 'sendTransaction', [envelope.wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  let tx;
  for (let i = 0; i < 15; i += 1) {
    tx = await rpc(FORK, 'getTransaction', [signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
    if (tx) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const after = await accountImages(addresses);
  const deltas = Object.fromEntries(addresses.map(address => [address,
    before[address].tokenAmount !== null && after[address].tokenAmount !== null
      ? String(BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount))
      : null]));
  return {signature, version: tx?.version ?? null, slot: tx?.slot ?? null,
    err: tx?.meta?.err ?? null, unitsConsumed: tx?.meta?.computeUnitsConsumed ?? null,
    signedWireBase64: envelope.wire.toString('base64'), before, after,
    tokenDeltas: deltas, logs: tx?.meta?.logMessages || []};
}

async function main() {
  const wsolBefore = (await rpc(FORK, 'getTokenAccountBalance',
    [ataA.toBase58()])).value.amount;
  if (BigInt(wsolBefore) >= 1_000_000_000n) throw new Error('Starting WSOL is not below first swap input');
  const cases = [];
  const passed = [];
  for (const cycles of [7, 8, 9]) {
    const result = await oneCase(cycles);
    cases.push(result.summary);
    if (!result.summary.err && result.summary.completeRepayment) passed.push(result);
    console.log(JSON.stringify({cycles, err: result.summary.err,
      completeRepayment: result.summary.completeRepayment,
      instructions: result.summary.stats.instructions,
      bytes: result.summary.stats.bytes,
      unitsConsumed: result.summary.unitsConsumed}));
  }
  const strongest = passed.at(-1);
  const committed = strongest ? await commit(strongest) : null;
  if (committed) console.log(JSON.stringify({committedCycles: strongest.summary.cycles,
    signature: committed.signature, version: committed.version,
    err: committed.err, unitsConsumed: committed.unitsConsumed}));
  fs.writeFileSync(OUT, `${JSON.stringify({
    schema: 'orca-pr1396-real-flash-compact-cycle/v1',
    execution: 'mainnet-backed local Surfpool fork', mainnetSubmission: false,
    actor: actor.publicKey.toBase58(), margin: margin.publicKey.toBase58(),
    wsolAta: ataA.toBase58(), initialWsolRaw: wsolBefore,
    pool: POOL.toBase58(), position: POSITION.toBase58(),
    cases, strongest: strongest?.summary || null, committed,
  }, null, 2)}\n`);
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
