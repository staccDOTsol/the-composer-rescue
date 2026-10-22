import * as anchor from '@coral-xyz/anchor';
import {MathUtil} from '@orca-so/common-sdk';
import {Connection, Keypair} from '@solana/web3.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import whirlpoolIdl from '../../../src/artifacts/whirlpool.json';
import {PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx} from '../../../src';
import {IGNORE_CACHE} from '../../../src/network/public/fetcher';
import {ZERO_BN} from '../../utils';
import {fundPositions, initTestPoolWithTokens, initTickArray} from '../../utils/init-utils';

const url = process.env.SURFPOOL_RPC_URL;
if (!url) throw new Error('SURFPOOL_RPC_URL required');
const Q = new BN('18446744073709551616');
const TARGET = Q.muln(3).divn(4);
const OTHER = Q.divn(4);
const N = Number(process.env.ROUNDS || 20);
const deployScript = process.env.LIVE_ELF_HOT_SWAP_SCRIPT;
const sourceElf = process.env.SOURCE_POST_ELF;
const liveElf = process.env.LIVE_ONCHAIN_ELF;
if (!deployScript || !sourceElf || !liveElf)
  throw new Error('LIVE_ELF_HOT_SWAP_SCRIPT, SOURCE_POST_ELF, and LIVE_ONCHAIN_ELF required');

function swapProgram(elfPath: string) {
  execFileSync('python3', [deployScript!, url!, elfPath],
    {stdio: 'inherit', timeout: 60_000});
}

async function fund(connection: Connection, keypair: Keypair) {
  const signature = await connection.requestAirdrop(keypair.publicKey, 100_000_000_000);
  const blockhash = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({signature, ...blockhash}, 'confirmed');
}

function context(connection: Connection, keypair: Keypair): WhirlpoolContext {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair),
    {commitment: 'confirmed', preflightCommitment: 'confirmed'});
  const program = new anchor.Program(whirlpoolIdl as anchor.Idl, provider);
  return WhirlpoolContext.fromWorkspace(provider, program);
}

async function scenario(interleave: boolean) {
  // Production's config creation requires Orca authority. Set up the fresh
  // fixture with the exact post-source ELF, then execute every swap/update/
  // collection against the byte-verified current on-chain ELF.
  swapProgram(sourceElf!);
  const connection = new Connection(url!, 'confirmed');
  const lp = Keypair.generate();
  const outsider = Keypair.generate();
  await fund(connection, lp);
  await fund(connection, outsider);
  const ctx = context(connection, lp);
  const outsiderCtx = context(connection, outsider);
  const init = await initTestPoolWithTokens(ctx, 1, Q,
    new BN('5000000000000000'));
  const pool = init.poolInitInfo.whirlpoolPda.publicKey;
  await initTickArray(ctx, pool, -88);
  await initTickArray(ctx, pool, 0);
  const positions = await fundPositions(ctx, init.poolInitInfo,
    init.tokenAccountA, init.tokenAccountB, [
      {tickLowerIndex: -1, tickUpperIndex: 1, liquidityAmount: TARGET},
      {tickLowerIndex: -1, tickUpperIndex: 1, liquidityAmount: OTHER},
    ]);
  swapProgram(liveElf!);
  const arrLower = PDAUtil.getTickArray(ctx.program.programId, pool, -88).publicKey;
  const arrUpper = PDAUtil.getTickArray(ctx.program.programId, pool, 0).publicKey;
  const oracle = PDAUtil.getOracle(ctx.program.programId, pool).publicKey;
  const target = positions[0].publicKey;
  const firstPool = await ctx.fetcher.getPool(pool, IGNORE_CACHE);
  assert.equal(firstPool!.liquidity.toString(), Q.toString());
  let previousGrowth = new BN(firstPool!.feeGrowthGlobalA);
  const growthSteps: string[] = [];
  let firstSwapReceipt: unknown = null;
  let firstUpdateReceipt: unknown = null;
  for (let i = 0; i < N; i++) {
    const swapSignature = await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, {
      amount: new BN(334), otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal('0.9998')),
      amountSpecifiedIsInput: true, aToB: true,
      whirlpool: pool, tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: init.tokenAccountA,
      tokenVaultA: init.poolInitInfo.tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: init.tokenAccountB,
      tokenVaultB: init.poolInitInfo.tokenVaultBKeypair.publicKey,
      tickArray0: arrUpper, tickArray1: arrLower,
      tickArray2: arrLower, oracle,
    })).buildAndExecute();
    if (i === 0) {
      const tx = await connection.getTransaction(swapSignature,
        {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
      assert.equal(tx?.meta?.err, null);
      assert.ok(tx?.meta?.logMessages?.some(s => s.includes('Instruction: Swap')));
      firstSwapReceipt = {signature: swapSignature, computeUnits: tx?.meta?.computeUnitsConsumed,
        logs: tx?.meta?.logMessages?.filter(s => s.includes('Instruction: Swap') ||
          s.includes('Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'))};
    }
    const p = await ctx.fetcher.getPool(pool, IGNORE_CACHE);
    const growth = new BN(p!.feeGrowthGlobalA);
    growthSteps.push(growth.sub(previousGrowth).toString());
    previousGrowth = growth;
    if (interleave) {
      const updateSignature = await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
        whirlpool: pool, position: target,
        tickArrayLower: arrLower, tickArrayUpper: arrUpper,
      })).buildAndExecute();
      if (i === 0) {
        const tx = await connection.getTransaction(updateSignature,
          {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
        assert.equal(tx?.meta?.err, null);
        assert.ok(tx?.meta?.logMessages?.some(s => s.includes('Instruction: UpdateFeesAndRewards')));
        firstUpdateReceipt = {signature: updateSignature,
          computeUnits: tx?.meta?.computeUnitsConsumed,
          logs: tx?.meta?.logMessages?.filter(s => s.includes('Instruction: UpdateFeesAndRewards') ||
            s.includes('Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'))};
      }
    }
  }
  const finalUpdateSignature = await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
    whirlpool: pool, position: target,
    tickArrayLower: arrLower, tickArrayUpper: arrUpper,
  })).buildAndExecute();
  if (!firstUpdateReceipt) {
    const tx = await connection.getTransaction(finalUpdateSignature,
      {commitment: 'confirmed', maxSupportedTransactionVersion: 0});
    assert.equal(tx?.meta?.err, null);
    assert.ok(tx?.meta?.logMessages?.some(s => s.includes('Instruction: UpdateFeesAndRewards')));
    firstUpdateReceipt = {signature: finalUpdateSignature,
      computeUnits: tx?.meta?.computeUnitsConsumed,
      logs: tx?.meta?.logMessages?.filter(s => s.includes('Instruction: UpdateFeesAndRewards') ||
        s.includes('Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'))};
  }
  await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
    whirlpool: pool, position: positions[1].publicKey,
    tickArrayLower: arrLower, tickArrayUpper: arrUpper,
  })).buildAndExecute();
  const targetState = await ctx.fetcher.getPosition(target, IGNORE_CACHE);
  const otherState = await ctx.fetcher.getPosition(positions[1].publicKey, IGNORE_CACHE);
  const ownerBefore = BigInt((await connection.getTokenAccountBalance(init.tokenAccountA)).value.amount);
  const vaultBefore = BigInt((await connection.getTokenAccountBalance(
    init.poolInitInfo.tokenVaultAKeypair.publicKey)).value.amount);
  const collect = (index: number) => toTx(ctx, WhirlpoolIx.collectFeesIx(ctx.program, {
    whirlpool: pool, positionAuthority: ctx.wallet.publicKey,
    position: positions[index].publicKey, positionTokenAccount: positions[index].tokenAccount,
    tokenOwnerAccountA: init.tokenAccountA, tokenOwnerAccountB: init.tokenAccountB,
    tokenVaultA: init.poolInitInfo.tokenVaultAKeypair.publicKey,
    tokenVaultB: init.poolInitInfo.tokenVaultBKeypair.publicKey,
  })).buildAndExecute();
  await collect(0);
  const ownerAfterTarget = BigInt((await connection.getTokenAccountBalance(init.tokenAccountA)).value.amount);
  const vaultAfterTarget = BigInt((await connection.getTokenAccountBalance(
    init.poolInitInfo.tokenVaultAKeypair.publicKey)).value.amount);
  await collect(1);
  const ownerAfter = BigInt((await connection.getTokenAccountBalance(init.tokenAccountA)).value.amount);
  const vaultAfter = BigInt((await connection.getTokenAccountBalance(
    init.poolInitInfo.tokenVaultAKeypair.publicKey)).value.amount);
  const row = {interleave, rounds: N,
    poolLiquidity: Q.toString(), positionLiquidity: TARGET.toString(),
    feeGrowthSteps: growthSteps, firstSwapReceipt, firstUpdateReceipt,
    owed: targetState!.feeOwedA.toString(),
    otherOwed: otherState!.feeOwedA.toString(),
    checkpoint: targetState!.feeGrowthCheckpointA.toString(),
    collected: String(ownerAfterTarget - ownerBefore),
    otherCollected: String(ownerAfter - ownerAfterTarget),
    totalCollected: String(ownerAfter - ownerBefore),
    expectedTotalLpFees: String(2 * N),
    targetVaultDebit: String(vaultBefore - vaultAfterTarget),
    vaultDebit: String(vaultBefore - vaultAfter)};
  assert.equal(row.collected, row.targetVaultDebit);
  assert.equal(row.totalCollected, row.vaultDebit);
  return row;
}

describe('PR1396 high-liquidity positive-owed partial update', () => {
  it('compares repeated outsider checkpoints with one final checkpoint after real swaps', async () => {
    const withOutsider = await scenario(true);
    const endOnly = await scenario(false);
    const result = {withOutsider, endOnly};
    console.log('PR1396_HIGH_LIQUIDITY_RESULT ' + JSON.stringify(result));
    if (process.env.RESULT_PATH) fs.writeFileSync(process.env.RESULT_PATH,
      JSON.stringify(result, null, 2) + '\n');
    assert.ok(withOutsider.feeGrowthSteps.every(x => x === '2'));
    assert.ok(endOnly.feeGrowthSteps.every(x => x === '2'));
    assert.equal(withOutsider.collected, String(N));
    assert.equal(endOnly.collected, String(3 * N / 2));
    assert.equal(withOutsider.otherCollected, String(N / 2));
    assert.equal(endOnly.otherCollected, String(N / 2));
    assert.equal(withOutsider.totalCollected, String(3 * N / 2));
    assert.equal(endOnly.totalCollected, String(2 * N));
  }, 300_000);
});
