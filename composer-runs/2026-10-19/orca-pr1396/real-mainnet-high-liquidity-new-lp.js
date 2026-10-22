#!/usr/bin/env node
'use strict';

// Fork-only negative control: after the existing high-L LP's rounding loss,
// create a new actor-owned LP position, deposit, update, collect, withdraw.
// Compare the new LP's token deltas across the two local differential forks.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram} = require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync} = require(`${MODULES}/@solana/spl-token`);
const anchor = require(`${MODULES}/@coral-xyz/anchor`);
const idl = require(path.join(process.env.WHIRLPOOLS_REPO ||
  '/private/tmp/whirlpools-1396-post',
  'legacy-sdk/whirlpool/src/artifacts/whirlpool.json'));
const {rpc} = require('./real-flash-envelope.js');

const MODE = process.env.ORCA_HIGH_L_MODE;
if (!['interleave', 'endOnly'].includes(MODE))
  throw new Error('ORCA_HIGH_L_MODE must be interleave or endOnly');
const FORK = process.env.ORCA_HIGH_L_FORK;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK || ''))
  throw new Error('Only localhost Surfpool endpoints are accepted');
const OUT = path.join(__dirname, `real-mainnet-high-liquidity-new-lp-${MODE}.json`);
const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const POOL = new PublicKey('478r35b8cKMuj3HzxkwqWsx8vBfFLP5YhbkUEsWt2jfo');
const VICTIM = new PublicKey('6K8ebAAheXRCfzSZo8zsdoaGJe2KzjTK8UPnci6Lrgm');
const VAULT_A = new PublicKey('AuXLE8VfYY9Gi4J6QrtaRiAZE8dmgAevsFVWfcde6bBj');
const VAULT_B = new PublicKey('GV543sv6xanAEdfQVp1sofJra6mfUUbsX6oYBSDahqAZ');
const MINT_A = new PublicKey('4RpS7bthtVvog6Q9HURWTS9kFsi2qdcpBiSch9wuDsvo');
const MINT_B = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const [TICK] = PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from('-39600')], PROGRAM);
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-mainnet-high-l-local-only-actor-20261019').digest());
const positionMint = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-mainnet-high-l-new-lp-mint-20261019').digest());
const [position, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from('position'), positionMint.publicKey.toBuffer()], PROGRAM);
const nftAta = getAssociatedTokenAddressSync(positionMint.publicKey, actor.publicKey);
const actorA = getAssociatedTokenAddressSync(MINT_A, actor.publicKey);
const actorB = getAssociatedTokenAddressSync(MINT_B, actor.publicKey);
const coder = new anchor.BorshAccountsCoder(idl);
const D = name => crypto.createHash('sha256').update(`global:${name}`)
  .digest().subarray(0, 8);
const key = (pubkey, isWritable = false, isSigner = false) =>
  ({pubkey, isWritable, isSigner});
const addr = key => key.toBase58();
const LIQUIDITY = 100_000_000n;

function openPosition() {
  const data = Buffer.alloc(17);
  D('open_position').copy(data);
  data[8] = bump;
  data.writeInt32LE(-39573, 9);
  data.writeInt32LE(-39567, 13);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(actor.publicKey, true, true), key(actor.publicKey),
    key(position, true), key(positionMint.publicKey, true, true),
    key(nftAta, true), key(POOL), key(TOKEN_PROGRAM_ID),
    key(SystemProgram.programId),
    key(new PublicKey('SysvarRent111111111111111111111111111111111')),
    key(ASSOCIATED_TOKEN_PROGRAM_ID),
  ]});
}

function liquidityChange(name) {
  const data = Buffer.alloc(40);
  D(name).copy(data);
  data.writeBigUInt64LE(LIQUIDITY, 8);
  data.writeBigUInt64LE(0n, 16);
  data.writeBigUInt64LE(name === 'increase_liquidity' ? 2_000_000n : 0n, 24);
  data.writeBigUInt64LE(name === 'increase_liquidity' ? 10_000n : 0n, 32);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(POOL, true), key(TOKEN_PROGRAM_ID), key(actor.publicKey, false, true),
    key(position, true), key(nftAta), key(actorA, true), key(actorB, true),
    key(VAULT_A, true), key(VAULT_B, true), key(TICK, true), key(TICK, true),
  ]});
}

function updatePosition() {
  return new TransactionInstruction({programId: PROGRAM, data: D('update_fees_and_rewards'),
    keys: [key(POOL, true), key(position, true), key(TICK), key(TICK)]});
}

function collectFees() {
  return new TransactionInstruction({programId: PROGRAM, data: D('collect_fees'),
    keys: [key(POOL), key(actor.publicKey, false, true), key(position, true),
      key(nftAta), key(actorA, true), key(VAULT_A, true),
      key(actorB, true), key(VAULT_B, true), key(TOKEN_PROGRAM_ID)]});
}

async function snapshot() {
  const keys = [POOL, VICTIM, position, VAULT_A, VAULT_B, actorA, actorB, nftAta].map(addr);
  const accounts = (await rpc(FORK, 'getMultipleAccounts', [keys,
    {encoding: 'base64', commitment: 'processed'}])).value;
  const data = item => item && Buffer.from(item.data[0], 'base64');
  const amount = item => item ? data(item).readBigUInt64LE(64).toString() : null;
  const pool = coder.decode('Whirlpool', data(accounts[0]));
  const victim = coder.decode('Position', data(accounts[1]));
  const attacker = accounts[2] ? coder.decode('Position', data(accounts[2])) : null;
  return {poolLiquidity: pool.liquidity.toString(),
    poolGrowthB: pool.fee_growth_global_b.toString(),
    victimOwedB: victim.fee_owed_b.toString(),
    newLiquidity: attacker?.liquidity.toString() ?? null,
    newCheckpointB: attacker?.fee_growth_checkpoint_b.toString() ?? null,
    newOwedA: attacker?.fee_owed_a.toString() ?? null,
    newOwedB: attacker?.fee_owed_b.toString() ?? null,
    vaultA: amount(accounts[3]), vaultB: amount(accounts[4]),
    actorA: amount(accounts[5]), actorB: amount(accounts[6]),
    nftAmount: amount(accounts[7])};
}

async function seedAbsent(instructions) {
  const programKeys = new Set(instructions.map(ix => addr(ix.programId)));
  const addresses = [...new Set(instructions.flatMap(ix => ix.keys.map(meta => addr(meta.pubkey))))];
  const seeded = [];
  for (const address of addresses) {
    if (programKeys.has(address)) continue;
    const info = (await rpc(FORK, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}])).value;
    if (info) continue;
    await rpc(FORK, 'surfnet_setAccount', [address, {
      data: '', owner: addr(SystemProgram.programId), lamports: 0,
      executable: false, rentEpoch: 0,
    }]);
    seeded.push(address);
  }
  return seeded;
}

async function localSend(label, instructions, signers = [actor]) {
  const seededAbsentAccounts = await seedAbsent(instructions);
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const tx = new Transaction({feePayer: actor.publicKey, recentBlockhash: blockhash});
  tx.add(...instructions);
  tx.sign(...signers);
  const wire = tx.serialize().toString('base64');
  const sim = (await rpc(FORK, 'simulateTransaction', [wire,
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true}])).value;
  const result = {label, seededAbsentAccounts, simulationError: sim.err || null,
    simulationUnits: sim.unitsConsumed,
    simulationLogs: (sim.logs || []).filter(line =>
      line.includes('Program log: Instruction:') ||
      line.includes(`Program ${addr(PROGRAM)} consumed`))};
  if (sim.err) return result;
  result.signature = await rpc(FORK, 'sendTransaction', [wire,
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  for (let i = 0; i < 15; i += 1) {
    const receipt = await rpc(FORK, 'getTransaction', [result.signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 0}]);
    if (receipt) {
      result.transactionError = receipt.meta?.err || null;
      result.transactionUnits = receipt.meta?.computeUnitsConsumed || null;
      result.transactionLogs = (receipt.meta?.logMessages || []).filter(line =>
        line.includes('Program log: Instruction:') ||
        line.includes(`Program ${addr(PROGRAM)} consumed`));
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`${label}: local getTransaction receipt unavailable`);
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Local fork does not identify as mainnet genesis');
  const before = await snapshot();
  if (before.newLiquidity !== null || before.nftAmount !== null)
    throw new Error('New position already exists on this fork');
  if (before.victimOwedB !== (MODE === 'interleave' ? '94639' : '94640'))
    throw new Error('Local fork does not hold the expected differential branch');
  const stages = [];
  for (const [label, instructions, signers] of [
    ['open attacker-owned position', [openPosition()], [actor, positionMint]],
    ['increase attacker liquidity', [liquidityChange('increase_liquidity')], [actor]],
    ['permissionless update attacker position', [updatePosition()], [actor]],
    ['collect attacker fees', [collectFees()], [actor]],
    ['decrease attacker liquidity', [liquidityChange('decrease_liquidity')], [actor]],
  ]) {
    const transaction = await localSend(label, instructions, signers);
    if (transaction.simulationError || transaction.transactionError)
      throw new Error(`${label} failed: ${JSON.stringify(transaction)}`);
    stages.push({transaction, state: await snapshot()});
  }
  const after = await snapshot();
  const output = {schema: 'orca-pr1396-new-lp-negative-control/v1', mode: MODE,
    execution: 'signed local mainnet-backed Surfpool fork', mainnetSubmission: false,
    fork: FORK, pool: addr(POOL), victim: addr(VICTIM),
    actor: addr(actor.publicKey), newPosition: addr(position),
    liquidity: LIQUIDITY.toString(), before, stages, after};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({mode: MODE, before, steps: stages.map(s => ({
    label: s.transaction.label, signature: s.transaction.signature,
    error: s.transaction.transactionError,
    newLiquidity: s.state.newLiquidity, newOwedB: s.state.newOwedB,
    vaultB: s.state.vaultB, actorB: s.state.actorB})), after}));
}

main().catch(error => {
  console.error(String(error?.stack || error)
    .replace(/api-key=[^&\s"']+/gi, 'api-key=[REDACTED]'));
  process.exitCode = 1;
});
