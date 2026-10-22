#!/usr/bin/env node
'use strict';

// Local mainnet-backed Surfpool only. Exercise one existing high-liquidity
// Whirlpool position with a real B-to-A swap and outsider fee update. The
// swapper's token ATA is seeded only on this fork; no mainnet send path exists.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {ComputeBudgetProgram, Keypair, PublicKey, Transaction,
  TransactionInstruction, SystemProgram} =
  require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync} =
  require(`${MODULES}/@solana/spl-token`);
const anchor = require(`${MODULES}/@coral-xyz/anchor`);
const idl = require(path.join(process.env.WHIRLPOOLS_REPO ||
  '/private/tmp/whirlpools-1396-post',
  'legacy-sdk/whirlpool/src/artifacts/whirlpool.json'));
const {rpc} = require('./real-flash-envelope.js');

const FORK = process.env.ORCA_HIGH_L_FORK || 'http://127.0.0.1:48899';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK))
  throw new Error('Only localhost Surfpool endpoints are accepted');
const MODE = process.env.ORCA_HIGH_L_MODE || 'single';
if (!['single', 'interleave', 'endOnly'].includes(MODE))
  throw new Error('ORCA_HIGH_L_MODE must be single, interleave, or endOnly');
const ROUNDS = MODE === 'single' ? 1 : Number(process.env.ORCA_HIGH_L_ROUNDS || 2);
if (!Number.isSafeInteger(ROUNDS) ||
    (MODE !== 'single' && (ROUNDS < 2 || ROUNDS > 10)))
  throw new Error('ORCA_HIGH_L_ROUNDS must be 2..10');
const OUT = path.join(__dirname, MODE === 'single'
  ? 'real-mainnet-high-liquidity-pool.json'
  : `real-mainnet-high-liquidity-${MODE}.json`);
const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const POOL = new PublicKey('478r35b8cKMuj3HzxkwqWsx8vBfFLP5YhbkUEsWt2jfo');
const POSITION = new PublicKey('6K8ebAAheXRCfzSZo8zsdoaGJe2KzjTK8UPnci6Lrgm');
const MINT_A = new PublicKey('4RpS7bthtVvog6Q9HURWTS9kFsi2qdcpBiSch9wuDsvo');
const MINT_B = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VAULT_A = new PublicKey('AuXLE8VfYY9Gi4J6QrtaRiAZE8dmgAevsFVWfcde6bBj');
const VAULT_B = new PublicKey('GV543sv6xanAEdfQVp1sofJra6mfUUbsX6oYBSDahqAZ');
const [TICK] = PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from('-39600')], PROGRAM);
const [ORACLE] = PublicKey.findProgramAddressSync(
  [Buffer.from('oracle'), POOL.toBuffer()], PROGRAM);
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-mainnet-high-l-local-only-actor-20261019').digest());
const ATA_A = getAssociatedTokenAddressSync(MINT_A, actor.publicKey);
const ATA_B = getAssociatedTokenAddressSync(MINT_B, actor.publicKey);
const coder = new anchor.BorshAccountsCoder(idl);
const D = name => crypto.createHash('sha256').update(`global:${name}`)
  .digest().subarray(0, 8);
const key = (pubkey, isWritable, isSigner = false) =>
  ({pubkey, isWritable, isSigner});
const address = pubkey => pubkey.toBase58();

function accountData(account) {
  return account && Buffer.from(account.data[0], 'base64');
}

function snapshotFromAccounts(accounts) {
  const [poolAccount, positionAccount, vaultAAccount, vaultBAccount,
    actorAAccount, actorBAccount] = accounts;
  const pool = coder.decode('Whirlpool', accountData(poolAccount));
  const position = coder.decode('Position', accountData(positionAccount));
  const amount = account => account ? accountData(account).readBigUInt64LE(64).toString() : null;
  return {
    poolLiquidity: pool.liquidity.toString(),
    tick: pool.tick_current_index,
    feeRate: pool.fee_rate,
    feeGrowthGlobalA: pool.fee_growth_global_a.toString(),
    feeGrowthGlobalB: pool.fee_growth_global_b.toString(),
    positionLiquidity: position.liquidity.toString(),
    positionLower: position.tick_lower_index,
    positionUpper: position.tick_upper_index,
    positionCheckpointA: position.fee_growth_checkpoint_a.toString(),
    positionCheckpointB: position.fee_growth_checkpoint_b.toString(),
    positionFeeOwedA: position.fee_owed_a.toString(),
    positionFeeOwedB: position.fee_owed_b.toString(),
    vaultA: amount(vaultAAccount), vaultB: amount(vaultBAccount),
    actorA: amount(actorAAccount), actorB: amount(actorBAccount),
  };
}

const WATCH = [POOL, POSITION, VAULT_A, VAULT_B, ATA_A, ATA_B].map(address);
async function snapshot() {
  const response = await rpc(FORK, 'getMultipleAccounts', [WATCH,
    {encoding: 'base64', commitment: 'processed'}]);
  return snapshotFromAccounts(response.value);
}

function updateInstruction() {
  return new TransactionInstruction({programId: PROGRAM,
    keys: [key(POOL, true), key(POSITION, true),
      key(TICK, false), key(TICK, false)],
    data: D('update_fees_and_rewards')});
}

function swapInstruction(amount) {
  const data = Buffer.alloc(42);
  D('swap').copy(data);
  data.writeBigUInt64LE(amount, 8);
  data[40] = 1; // exact input
  data[41] = 0; // B to A
  return new TransactionInstruction({programId: PROGRAM,
    keys: [key(TOKEN_PROGRAM_ID, false), key(actor.publicKey, false, true),
      key(POOL, true), key(ATA_A, true), key(VAULT_A, true),
      key(ATA_B, true), key(VAULT_B, true),
      key(TICK, true), key(TICK, true), key(TICK, true), key(ORACLE, false)],
    data});
}

async function seedAccount(pubkey, data, owner, lamports) {
  await rpc(FORK, 'surfnet_setAccount', [address(pubkey), {
    data: data.toString('hex'), owner: address(owner), lamports,
    executable: false, rentEpoch: 0,
  }]);
}

async function seedActor() {
  await seedAccount(actor.publicKey, Buffer.alloc(0),
    SystemProgram.programId, 1_000_000_000);
  const vaultA = (await rpc(FORK, 'getAccountInfo', [address(VAULT_A),
    {encoding: 'base64', commitment: 'processed'}])).value;
  const vaultB = (await rpc(FORK, 'getAccountInfo', [address(VAULT_B),
    {encoding: 'base64', commitment: 'processed'}])).value;
  for (const [ata, vault, amount] of [
    [ATA_A, vaultA, 0n], [ATA_B, vaultB, 50_000n],
  ]) {
    const data = Buffer.from(accountData(vault));
    actor.publicKey.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(amount, 64);
    await seedAccount(ata, data, TOKEN_PROGRAM_ID, vault.lamports);
  }
  // This Whirlpool's legacy-fee oracle PDA is absent on mainnet. A zero-
  // lamport System account gives Surfpool's send path the same missing state.
  const oracle = await rpc(FORK, 'getAccountInfo', [address(ORACLE),
    {encoding: 'base64', commitment: 'processed'}]);
  if (!oracle.value)
    await seedAccount(ORACLE, Buffer.alloc(0), SystemProgram.programId, 0);
}

async function signedTransaction(instructions) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const tx = new Transaction({feePayer: actor.publicKey, recentBlockhash: blockhash});
  tx.add(...instructions);
  tx.sign(actor);
  return tx.serialize().toString('base64');
}

async function localSend(label, instructions) {
  const wire = await signedTransaction(instructions);
  const sim = (await rpc(FORK, 'simulateTransaction', [wire,
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true}])).value;
  const row = {label, simulationError: sim.err || null,
    simulationUnits: sim.unitsConsumed,
    simulationWhirlpoolLogs: (sim.logs || []).filter(line =>
      line.includes('Program log: Instruction:') ||
      line.includes(`Program ${address(PROGRAM)} consumed`))};
  if (sim.err) return row;
  row.signature = await rpc(FORK, 'sendTransaction', [wire,
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  for (let i = 0; i < 15; i += 1) {
    const receipt = await rpc(FORK, 'getTransaction', [row.signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 0}]);
    if (receipt) {
      row.transactionError = receipt.meta?.err || null;
      row.transactionUnits = receipt.meta?.computeUnitsConsumed || null;
      row.transactionSlot = receipt.slot;
      row.transactionWhirlpoolLogs = (receipt.meta?.logMessages || []).filter(line =>
        line.includes('Program log: Instruction:') ||
        line.includes(`Program ${address(PROGRAM)} consumed`));
      return row;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`${label}: local getTransaction receipt unavailable`);
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Local fork does not identify as mainnet genesis');
  await seedActor();
  const initial = await snapshot();
  if (initial.poolLiquidity !== initial.positionLiquidity)
    throw new Error('Selected real position no longer spans all in-range liquidity');
  const baseline = await localSend('baseline permissionless update', [updateInstruction()]);
  const afterBaseline = await snapshot();
  if (baseline.simulationError || baseline.transactionError)
    throw new Error(`Baseline update failed: ${JSON.stringify(baseline)}`);
  const amount = 20_000n; // 2 raw USDC units at fee_rate=100 / 1e6
  const steps = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const instructions = [swapInstruction(amount)];
    // Surfpool can return the same blockhash across two fast local sends.
    // Make each signed transaction distinct without touching pool economics.
    if (index > 0) instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({units: 200_000 + index}));
    if (MODE !== 'endOnly') instructions.push(updateInstruction());
    const transaction = await localSend(
      `real swap ${index + 1}${MODE === 'endOnly' ? '' : ' then outsider update'}`,
      instructions);
    if (transaction.simulationError || transaction.transactionError)
      throw new Error(`Swap ${index + 1} failed: ${JSON.stringify(transaction)}`);
    steps.push({transaction, state: await snapshot()});
  }
  let finalUpdate = null;
  if (MODE === 'endOnly') {
    finalUpdate = await localSend('single outsider update after all swaps',
      [updateInstruction()]);
    if (finalUpdate.simulationError || finalUpdate.transactionError)
      throw new Error(`Final update failed: ${JSON.stringify(finalUpdate)}`);
  }
  const after = await snapshot();
  const output = {schema: 'orca-pr1396-real-existing-high-liquidity-pool/v1',
    execution: 'local mainnet-backed Surfpool fork', mainnetSubmission: false,
    fork: FORK, pool: address(POOL), position: address(POSITION),
    actor: address(actor.publicKey), swapDirection: 'B-to-A',
    swapInputRawB: String(amount), mode: MODE, rounds: ROUNDS,
    localSeeding: 'actor system account; actor A ATA zero; actor USDC ATA 50,000 raw; absent oracle PDA zero-lamport',
    accounts: {tickArray: address(TICK), oracle: address(ORACLE),
      actorA: address(ATA_A), actorB: address(ATA_B)},
    initial, baseline, afterBaseline, steps, finalUpdate, after};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({mode: MODE, rounds: ROUNDS, baseline,
    swaps: steps.map(step => ({signature: step.transaction.signature,
      error: step.transaction.transactionError,
      units: step.transaction.transactionUnits,
      logs: step.transaction.transactionWhirlpoolLogs})),
    finalUpdate,
    feeGrowthDeltaB: String(BigInt(after.feeGrowthGlobalB) - BigInt(afterBaseline.feeGrowthGlobalB)),
    owedDeltaB: String(BigInt(after.positionFeeOwedB) - BigInt(afterBaseline.positionFeeOwedB)),
    checkpointDeltaB: String(BigInt(after.positionCheckpointB) - BigInt(afterBaseline.positionCheckpointB)),
    vaultDeltaB: String(BigInt(after.vaultB) - BigInt(afterBaseline.vaultB))}));
}

main().catch(error => {
  console.error(String(error?.stack || error)
    .replace(/api-key=[^&\s"']+/gi, 'api-key=[REDACTED]'));
  process.exitCode = 1;
});
