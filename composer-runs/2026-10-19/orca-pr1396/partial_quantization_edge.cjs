#!/usr/bin/env node
'use strict';

// Exact Whirlpool SBF instruction replay for the high-liquidity checkpoint
// quantization edge. The fee growth is seeded to the exact Q64 increment a
// two-unit LP fee would generate at pool liquidity 2^64; swaps are not made.

const fs = require('node:fs');
const {createRequire} = require('node:module');
const repo = process.env.WHIRLPOOLS_REPO;
if (!repo) throw new Error('WHIRLPOOLS_REPO must name a checkout with node_modules');
const req = createRequire(`${repo}/package.json`);
const {Connection, Keypair, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction} = req('@solana/web3.js');
const {PROGRAM, X64, discriminator, encodeWhirlpool, encodePosition,
  encodeTickArray, setAccount, owed, checkpoint} = require('./checkpoint_fuzz_helpers.cjs');

const url = process.argv[2];
const outputPath = process.argv[3];
const rounds = Number(process.argv[4] || 20);
if (!url || !outputPath || !Number.isSafeInteger(rounds) || rounds < 2)
  throw new Error('Usage: node partial_quantization_edge.cjs RPC OUTPUT_JSON [ROUNDS]');
const poolLiquidity = X64;
const positionLiquidity = 3n * X64 / 4n;
const feeGrowthStep = 2n;
const connection = new Connection(url, 'confirmed');

async function fixture(payer) {
  const whirlpool = Keypair.generate().publicKey;
  const position = Keypair.generate().publicKey;
  const lower = Keypair.generate().publicKey;
  const upper = Keypair.generate().publicKey;
  await setAccount(url, whirlpool, PROGRAM,
    encodeWhirlpool(0n, {liquidity: poolLiquidity}), 10_000_000);
  await setAccount(url, position, PROGRAM,
    encodePosition(whirlpool, {liquidity: positionLiquidity}), 10_000_000);
  await setAccount(url, lower, PROGRAM,
    encodeTickArray(whirlpool, -88, 87), 100_000_000);
  await setAccount(url, upper, PROGRAM,
    encodeTickArray(whirlpool, 0, 1), 100_000_000);
  const instruction = new TransactionInstruction({programId: PROGRAM,
    keys: [
      {pubkey: whirlpool, isWritable: true, isSigner: false},
      {pubkey: position, isWritable: true, isSigner: false},
      {pubkey: lower, isWritable: false, isSigner: false},
      {pubkey: upper, isWritable: false, isSigner: false},
    ],
    data: discriminator('global', 'update_fees_and_rewards'),
  });
  return {payer, whirlpool, position, instruction};
}

async function readState(position) {
  const info = await connection.getAccountInfo(position, 'confirmed');
  return {owed: String(owed(info.data)), checkpoint: String(checkpoint(info.data))};
}

async function update(f, firstReceipt) {
  const signature = await sendAndConfirmTransaction(connection,
    new Transaction().add(f.instruction), [f.payer],
    {commitment: 'confirmed', skipPreflight: false});
  if (firstReceipt.receipt) return signature;
  const tx = await connection.getTransaction(signature,
    {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
  const logs = tx?.meta?.logMessages || [];
  if (tx?.meta?.err || !logs.some(s => s.includes('Instruction: UpdateFeesAndRewards')) ||
      logs.some(s => s.includes('Hello from my program!')))
    throw new Error(`Invalid Whirlpool execution: ${JSON.stringify({err: tx?.meta?.err, logs})}`);
  firstReceipt.receipt = {signature, computeUnits: tx.meta.computeUnitsConsumed,
    logs: logs.filter(s => s.includes('Instruction: UpdateFeesAndRewards') ||
      s.includes('Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'))};
  return signature;
}

async function main() {
  const payer = Keypair.generate();
  await setAccount(url, payer.publicKey, SystemProgram.programId,
    Buffer.alloc(0), 2_000_000_000);
  const interleaved = await fixture(payer);
  const endOnly = await fixture(payer);
  const firstReceipt = {};
  const sequence = [];
  for (let n = 1; n <= rounds; n++) {
    const growth = feeGrowthStep * BigInt(n);
    for (const f of [interleaved, endOnly]) {
      await setAccount(url, f.whirlpool, PROGRAM,
        encodeWhirlpool(growth, {liquidity: poolLiquidity}), 10_000_000);
    }
    await update(interleaved, firstReceipt);
    sequence.push({round: n, growth: String(growth),
      interleaved: await readState(interleaved.position)});
  }
  await update(endOnly, firstReceipt);
  const result = {schema: 'orca-pr1396-partial-quantization-edge/v1',
    rpc: url, rounds, poolLiquidity: String(poolLiquidity),
    positionLiquidity: String(positionLiquidity), feeGrowthStep: '2',
    notRealSwaps: true, firstExecution: firstReceipt.receipt,
    theoreticalNoInterimOwed: String(positionLiquidity * feeGrowthStep * BigInt(rounds) / X64),
    interleaved: await readState(interleaved.position),
    endOnly: await readState(endOnly.position), sequence};
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({rounds, interleaved: result.interleaved,
    endOnly: result.endOnly, firstExecution: result.firstExecution}));
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
