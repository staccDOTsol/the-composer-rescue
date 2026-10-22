import * as anchor from "@coral-xyz/anchor";
import { MathUtil } from "@orca-so/common-sdk";
import { Connection, Keypair } from "@solana/web3.js";
import assert from "node:assert/strict";
import BN from "bn.js";
import Decimal from "decimal.js";
import whirlpoolIdl from "../../../src/artifacts/whirlpool.json";
import type { PositionData } from "../../../src";
import { PDAUtil, toTx, WhirlpoolContext, WhirlpoolIx } from "../../../src";
import { IGNORE_CACHE } from "../../../src/network/public/fetcher";
import { TickSpacing, ZERO_BN } from "../../utils";
import { WhirlpoolTestFixture } from "../../utils/fixture";

const rpc = process.env.SURFPOOL_RPC_URL;
if (!rpc) throw new Error("SURFPOOL_RPC_URL is required");

async function fund(connection: Connection, keypair: Keypair) {
  const sig = await connection.requestAirdrop(keypair.publicKey, 100_000_000_000);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...blockhash }, "confirmed");
}

function context(connection: Connection, keypair: Keypair): WhirlpoolContext {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(keypair),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const program = new anchor.Program(whirlpoolIdl as anchor.Idl, provider);
  return WhirlpoolContext.fromWorkspace(provider, program);
}

describe("PR1396 on real Surfpool RPC", () => {
  it("outsider updates between 20 one-unit fee swaps", async () => {
    const connection = new Connection(rpc, "confirmed");
    const lp = Keypair.generate();
    const outsider = Keypair.generate();
    await fund(connection, lp);
    await fund(connection, outsider);
    const ctx = context(connection, lp);
    const outsiderCtx = context(connection, outsider);

    const fixture = await new WhirlpoolTestFixture(ctx).init({
      tickSpacing: TickSpacing.Standard,
      positions: [
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new anchor.BN(210_000_000) },
        { tickLowerIndex: 29440, tickUpperIndex: 33536, liquidityAmount: new anchor.BN(790_000_000) },
      ],
    });
    const {
      poolInitInfo: { whirlpoolPda, tokenVaultAKeypair, tokenVaultBKeypair },
      tokenAccountA,
      tokenAccountB,
      positions,
    } = fixture.getInfos();
    const tickArrayPda = PDAUtil.getTickArray(ctx.program.programId, whirlpoolPda.publicKey, 22528);
    const oraclePda = PDAUtil.getOracle(ctx.program.programId, whirlpoolPda.publicKey);
    const target = positions[0].publicKey;

    for (let i = 0; i < 20; i++) {
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

      await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
        whirlpool: whirlpoolPda.publicKey,
        position: target,
        tickArrayLower: tickArrayPda.publicKey,
        tickArrayUpper: tickArrayPda.publicKey,
      })).buildAndExecute();
    }

    const position = await ctx.fetcher.getPosition(target, IGNORE_CACHE) as PositionData;
    await toTx(outsiderCtx, WhirlpoolIx.updateFeesAndRewardsIx(outsiderCtx.program, {
      whirlpool: whirlpoolPda.publicKey,
      position: positions[1].publicKey,
      tickArrayLower: tickArrayPda.publicKey,
      tickArrayUpper: tickArrayPda.publicKey,
    })).buildAndExecute();
    const otherPosition = await ctx.fetcher.getPosition(positions[1].publicKey, IGNORE_CACHE) as PositionData;
    const ownerBefore = BigInt((await connection.getTokenAccountBalance(tokenAccountA)).value.amount);
    const vaultBefore = BigInt((await connection.getTokenAccountBalance(tokenVaultAKeypair.publicKey)).value.amount);
    for (const p of positions) {
      await toTx(ctx, WhirlpoolIx.collectFeesIx(ctx.program, {
        whirlpool: whirlpoolPda.publicKey,
        positionAuthority: ctx.wallet.publicKey,
        position: p.publicKey,
        positionTokenAccount: p.tokenAccount,
        tokenOwnerAccountA: tokenAccountA,
        tokenOwnerAccountB: tokenAccountB,
        tokenVaultA: tokenVaultAKeypair.publicKey,
        tokenVaultB: tokenVaultBKeypair.publicKey,
      })).buildAndExecute();
    }
    const ownerAfter = BigInt((await connection.getTokenAccountBalance(tokenAccountA)).value.amount);
    const vaultAfter = BigInt((await connection.getTokenAccountBalance(tokenVaultAKeypair.publicKey)).value.amount);
    const result = {
      rpc,
      outsider: outsider.publicKey.toBase58(),
      position: target.toBase58(),
      feeOwedA: position.feeOwedA.toString(),
      otherFeeOwedA: otherPosition.feeOwedA.toString(),
      feeGrowthCheckpointA: position.feeGrowthCheckpointA.toString(),
      collectedA: (ownerAfter - ownerBefore).toString(),
      vaultADecreaseOnCollect: (vaultBefore - vaultAfter).toString(),
      vaultAAfterCollect: vaultAfter.toString(),
    };
    console.log("PR1396_SURFPOOL_RESULT " + JSON.stringify(result));
    assert.equal(result.collectedA, result.vaultADecreaseOnCollect);
    if (process.env.EXPECT_FEE_OWED_A) {
      assert.equal(result.feeOwedA, process.env.EXPECT_FEE_OWED_A);
    }
  }, 180_000);
});
