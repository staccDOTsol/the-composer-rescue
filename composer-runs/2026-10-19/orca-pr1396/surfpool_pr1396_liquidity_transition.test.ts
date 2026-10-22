import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import { Connection, Keypair } from "@solana/web3.js";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import BN from "bn.js";
import Decimal from "decimal.js";
import whirlpoolIdl from "../../../src/artifacts/whirlpool.json";
import type { PositionData, WhirlpoolData } from "../../../src";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { MAX_U64, TickSpacing, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";

const rpc = process.env.SURFPOOL_RPC_URL;
if (!rpc) throw new Error("SURFPOOL_RPC_URL is required");

async function fund(connection: Connection, keypair: Keypair) {
  const sig = await connection.requestAirdrop(keypair.publicKey, 100_000_000_000);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...blockhash }, "confirmed");
}

function context(connection: Connection, keypair: Keypair): WhirlpoolContext {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new anchor.Program(whirlpoolIdl as anchor.Idl, provider);
  return WhirlpoolContext.fromWorkspace(provider, program);
}

async function runScenario(partialUpdates: boolean) {
  const connection = new Connection(rpc!, "confirmed");
  const lp = Keypair.generate();
  const outsider = Keypair.generate();
  await fund(connection, lp);
  await fund(connection, outsider);
  const ctx = context(connection, lp);
  const outsiderCtx = context(connection, outsider);
  const fixture = await new WhirlpoolTestFixture(ctx).init({
    tickSpacing: TickSpacing.Standard,
    positions: [
      { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new BN(210_000_000) },
      { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new BN(790_000_000) },
    ],
  });
  const {
    poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
    tokenAccountA,
    tokenAccountB,
    positions,
  } = fixture.getInfos();
  const target = positions[0];
  const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
  const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);

  async function swap() {
    await toTx(ctx, WhirlpoolIx.swapIx(ctx.program, {
      amount: new BN(333),
      otherAmountThreshold: ZERO_BN,
      sqrtPriceLimit: MathUtil.toX64(new Decimal(4)),
      amountSpecifiedIsInput: true,
      aToB: true,
      whirlpool: whirlpoolPda.publicKey,
      tokenAuthority: ctx.wallet.publicKey,
      tokenOwnerAccountA: tokenAccountA,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenOwnerAccountB: tokenAccountB,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      tickArray0: tickArrayPda.publicKey,
      tickArray1: tickArrayPda.publicKey,
      tickArray2: tickArrayPda.publicKey,
      oracle: oraclePda.publicKey,
    })).buildAndExecute();
  }

  async function outsiderUpdate() {
    await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
      whirlpool: whirlpoolPda.publicKey,
      position: target.publicKey,
      tickArrayLower: target.tickArrayLower,
      tickArrayUpper: target.tickArrayUpper,
    })).buildAndExecute();
  }

  async function snapshot() {
    const position = await ctx.fetcher.getPosition(target.publicKey, IGNORE_CACHE) as PositionData;
    const pool = await ctx.fetcher.getPool(whirlpoolPda.publicKey, IGNORE_CACHE) as WhirlpoolData;
    return {
      liquidity: position.liquidity.toString(),
      owed: position.feeOwedA.toString(),
      checkpoint: position.feeGrowthCheckpointA.toString(),
      growth: pool.feeGrowthGlobalA.toString(),
    };
  }

  for (let i = 0; i < 4; i++) {
    await swap();
    if (partialUpdates) await outsiderUpdate();
  }
  const beforeIncrease = await snapshot();
  assert.equal(beforeIncrease.owed, "0");
  assert.equal(beforeIncrease.liquidity, "210000000");

  const increaseSig = await toTx(ctx, WhirlpoolIx.increaseLiquidityIx(ctx.program, {
    whirlpool: whirlpoolPda.publicKey,
    position: target.publicKey,
    tickArrayLower: target.tickArrayLower,
    tickArrayUpper: target.tickArrayUpper,
    liquidityAmount: new BN(210_000_000),
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: target.tokenAccount,
    tokenMaxA: MAX_U64,
    tokenMaxB: MAX_U64,
    tokenOwnerAccountA: tokenAccountA,
    tokenOwnerAccountB: tokenAccountB,
    tokenVaultA: tokenVaultAKeypair.publicKey,
    tokenVaultB: tokenVaultBKeypair.publicKey,
  })).buildAndExecute();
  const afterIncrease = await snapshot();
  assert.equal(afterIncrease.owed, "0");
  assert.equal(afterIncrease.liquidity, "420000000");
  assert.equal(afterIncrease.checkpoint, afterIncrease.growth);
  const beforeIncreaseDelta = BigInt(beforeIncrease.growth) - BigInt(beforeIncrease.checkpoint);
  const expectedIncreaseOwed = BigInt(beforeIncrease.owed) +
    (BigInt(beforeIncrease.liquidity) * beforeIncreaseDelta >> 64n);
  assert.equal(BigInt(afterIncrease.owed), expectedIncreaseOwed);

  for (let i = 0; i < 4; i++) {
    await swap();
    if (partialUpdates) await outsiderUpdate();
  }
  const beforeDecrease = await snapshot();

  const decreaseSig = await toTx(ctx, WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
    whirlpool: whirlpoolPda.publicKey,
    position: target.publicKey,
    tickArrayLower: target.tickArrayLower,
    tickArrayUpper: target.tickArrayUpper,
    liquidityAmount: new BN(210_000_000),
    positionAuthority: ctx.wallet.publicKey,
    positionTokenAccount: target.tokenAccount,
    tokenMinA: ZERO_BN,
    tokenMinB: ZERO_BN,
    tokenOwnerAccountA: tokenAccountA,
    tokenOwnerAccountB: tokenAccountB,
    tokenVaultA: tokenVaultAKeypair.publicKey,
    tokenVaultB: tokenVaultBKeypair.publicKey,
  })).buildAndExecute();
  const afterDecrease = await snapshot();
  assert.equal(afterDecrease.liquidity, "210000000");
  assert.equal(afterDecrease.checkpoint, afterDecrease.growth);
  const beforeDecreaseDelta = BigInt(beforeDecrease.growth) - BigInt(beforeDecrease.checkpoint);
  const expectedDecreaseOwed = BigInt(beforeDecrease.owed) +
    (BigInt(beforeDecrease.liquidity) * beforeDecreaseDelta >> 64n);
  assert.equal(BigInt(afterDecrease.owed), expectedDecreaseOwed);

  for (let i = 0; i < 5; i++) {
    await swap();
    if (partialUpdates) await outsiderUpdate();
  }
  if (!partialUpdates) await outsiderUpdate();
  const finalPosition = await snapshot();
  const ownerBefore = BigInt((await connection.getTokenAccountBalance(tokenAccountA)).value.amount);
  const vaultBefore = BigInt((await connection.getTokenAccountBalance(tokenVaultAKeypair.publicKey)).value.amount);
  await toTx(ctx, WhirlpoolIx.collectFeesIx(ctx.program, {
    whirlpool: whirlpoolPda.publicKey,
    positionAuthority: ctx.wallet.publicKey,
    position: target.publicKey,
    positionTokenAccount: target.tokenAccount,
    tokenOwnerAccountA: tokenAccountA,
    tokenOwnerAccountB: tokenAccountB,
    tokenVaultA: tokenVaultAKeypair.publicKey,
    tokenVaultB: tokenVaultBKeypair.publicKey,
  })).buildAndExecute();
  const ownerAfter = BigInt((await connection.getTokenAccountBalance(tokenAccountA)).value.amount);
  const vaultAfter = BigInt((await connection.getTokenAccountBalance(tokenVaultAKeypair.publicKey)).value.amount);
  const collected = ownerAfter - ownerBefore;
  const vaultDebit = vaultBefore - vaultAfter;
  assert.equal(collected.toString(), finalPosition.owed);
  assert.equal(vaultDebit, collected);

  async function instructionLog(sig: string) {
    const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    assert.equal(tx?.meta?.err, null);
    return { cu: tx?.meta?.computeUnitsConsumed, logs: tx?.meta?.logMessages?.filter(x => x.includes("Instruction: ")) };
  }

  return {
    partialUpdates,
    beforeIncrease,
    afterIncrease,
    beforeDecrease,
    afterDecrease,
    finalPosition,
    collected: collected.toString(),
    vaultDebit: vaultDebit.toString(),
    increase: await instructionLog(increaseSig),
    decrease: await instructionLog(decreaseSig),
  };
}

describe("PR1396 real increase/decrease checkpoint transition", () => {
  it("compares outsider partial updates against no intermediate partial updates", async () => {
    const withPartial = await runScenario(true);
    const withoutPartial = await runScenario(false);
    console.log("PR1396_LIQUIDITY_TRANSITION " + JSON.stringify({ withPartial, withoutPartial }));
    if (process.env.RESULT_PATH) {
      writeFileSync(process.env.RESULT_PATH, JSON.stringify({ withPartial, withoutPartial }, null, 2) + "\n");
    }
    if (process.env.EXPECT_EQUAL === "true") {
      assert.equal(withPartial.finalPosition.owed, withoutPartial.finalPosition.owed);
    }
  }, 300_000);
});
