import * as anchor from '@coral-xyz/anchor';
import {MathUtil} from '@orca-so/common-sdk';
import {Connection, Keypair} from '@solana/web3.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const L = new BN('18439611894805844217'); // On-chain pool 478r35..., observed finalized slot 458870380.
const N = 20;

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
  const [position] = await fundPositions(ctx, init.poolInitInfo,
    init.tokenAccountA, init.tokenAccountB, [
      {tickLowerIndex: -1, tickUpperIndex: 1, liquidityAmount: L},
    ]);
  const arrLower = PDAUtil.getTickArray(ctx.program.programId, pool, -88).publicKey;
  const arrUpper = PDAUtil.getTickArray(ctx.program.programId, pool, 0).publicKey;
  const oracle = PDAUtil.getOracle(ctx.program.programId, pool).publicKey;
  const initialPool = await ctx.fetcher.getPool(pool, IGNORE_CACHE);
  assert.equal(initialPool!.liquidity.toString(), L.toString());
  let previousGrowth = new BN(initialPool!.feeGrowthGlobalA);
  const growthSteps: string[] = [];
  for (let i = 0; i < N; i++) {
    await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, {
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
    const currentPool = await ctx.fetcher.getPool(pool, IGNORE_CACHE);
    const growth = new BN(currentPool!.feeGrowthGlobalA);
    growthSteps.push(growth.sub(previousGrowth).toString());
    previousGrowth = growth;
    if (interleave) {
      await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
        whirlpool: pool, position: position.publicKey,
        tickArrayLower: arrLower, tickArrayUpper: arrUpper,
      })).buildAndExecute();
    }
  }
  await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
    whirlpool: pool, position: position.publicKey,
    tickArrayLower: arrLower, tickArrayUpper: arrUpper,
  })).buildAndExecute();
  const state = await ctx.fetcher.getPosition(position.publicKey, IGNORE_CACHE);
  const ownerBefore = BigInt((await connection.getTokenAccountBalance(init.tokenAccountA)).value.amount);
  const vaultBefore = BigInt((await connection.getTokenAccountBalance(
    init.poolInitInfo.tokenVaultAKeypair.publicKey)).value.amount);
  await toTx(ctx, WhirlpoolIx.collectFeesIx(ctx.program, {
    whirlpool: pool, positionAuthority: ctx.wallet.publicKey,
    position: position.publicKey, positionTokenAccount: position.tokenAccount,
    tokenOwnerAccountA: init.tokenAccountA, tokenOwnerAccountB: init.tokenAccountB,
    tokenVaultA: init.poolInitInfo.tokenVaultAKeypair.publicKey,
    tokenVaultB: init.poolInitInfo.tokenVaultBKeypair.publicKey,
  })).buildAndExecute();
  const ownerAfter = BigInt((await connection.getTokenAccountBalance(init.tokenAccountA)).value.amount);
  const vaultAfter = BigInt((await connection.getTokenAccountBalance(
    init.poolInitInfo.tokenVaultAKeypair.publicKey)).value.amount);
  return {interleave, poolLiquidity: L.toString(),
    feeGrowthSteps: growthSteps,
    owed: state!.feeOwedA.toString(),
    collected: String(ownerAfter - ownerBefore),
    vaultDebit: String(vaultBefore - vaultAfter)};
}

describe('PR1396 near-Q single-LP active liquidity', () => {
  it('shows positive-owed Partial rounding on a one-position pool', async () => {
    const withOutsider = await scenario(true);
    const endOnly = await scenario(false);
    const result = {withOutsider, endOnly};
    if (process.env.RESULT_PATH) fs.writeFileSync(process.env.RESULT_PATH,
      JSON.stringify(result, null, 2) + '\n');
    assert.ok(withOutsider.feeGrowthSteps.every(x => x === '2'));
    assert.ok(endOnly.feeGrowthSteps.every(x => x === '2'));
    assert.equal(withOutsider.collected, '20');
    assert.equal(endOnly.collected, '39');
    assert.equal(withOutsider.vaultDebit, '20');
    assert.equal(endOnly.vaultDebit, '39');
  }, 300_000);
});
