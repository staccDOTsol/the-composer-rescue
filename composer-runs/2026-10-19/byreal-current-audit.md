# Byreal CLMM current-state atomic audit — 2026-10-19

## Result

No outsider-profitable drain was demonstrated in the scoped current-state paths. The strongest executable candidate—flash-borrow USDC, buy CRCLx in Byreal, sell it through an independent Raydium CLMM pool, then repay every lender—is consistently loss-making. The GoonFi raw-vault-donation flaw does **not** reproduce: direct donations change custody balances but not Byreal's swap quote or the independent exit proceeds.

All transactions described below are locally signed custom Solana transaction-v1 packets and were passed only to `simulateTransaction` on a current-mainnet-backed Surfpool fork with `sigVerify:true`. No transaction was broadcast. The zero-capital signer came from `~/hooked.json`; secret material is not recorded in any artifact.

## Current deployment and state

At mainnet slot **458,746,581**, program `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2` was executable under the upgradeable loader. Its programdata account was `6YDesqidNpd8H4pWThk3yzT1aYaHLK4XYDXJcwbgMxdq`, length **1,498,093**, SHA-256 `0103e79b86deef6c7457902f7df743fa8dead36f87e416dd40f05eea4004cae6`. Pool `Hv44…nvtQa` was Byreal-owned and 1,544 bytes. The same read observed **224,414.492968 USDC** and **17,714.47958935 CRCLx** in its vaults. See `byreal-current-deployment.json` and the reproducible reader `byreal-current-deployment.js`.

The forked simulation baseline was slightly earlier, slot **458,742,154**, with **222,246.271370 USDC** in the Byreal vault. This time distinction is intentional; mutable pool balances are not presented as a coherent later-slot snapshot.

## Executable outsider path and economics

The route was:

`KLend USDC flash borrow → Byreal Hv44… USDC→CRCLx → independent Raydium GYqH… CRCLx→USDC → KLend full repay`.

The one-provider packet is **1,456 bytes, 36 accounts, four instructions, one valid signature**, below both requested ceilings (4,096 bytes and 64 accounts). Zero-capital attempts reach the repayment instruction and fail only because the independent exit returns less USDC than was borrowed. Buffer-funded controls complete, repay the lender fully, end with zero CRCLx, and quantify the deficit:

| Byreal input | CRCLx received | independent USDC exit | attacker USDC delta |
|---:|---:|---:|---:|
| 200.000000 | 2.35023203 | 199.575621 | **-0.424379** |
| 10,000.000000 | 117.23022402 | 9,949.703013 | **-50.296987** |
| 100,000.000000 | 1,144.88764810 | 96,719.503791 | **-3,280.496209** |
| 200,000.000000 | 2,220.78830323 | 186,492.834807 | **-13,507.165193** |
| 222,246.271370 | 2,450.79771459 | 205,502.662351 | **-16,743.609019** |

For every successful control, KLend supply-vault, fee-vault, and reserve token deltas reconcile to zero. Pool A gains the exact USDC input and loses the stated CRCLx; pool B gains the same CRCLx and loses the stated exit USDC; the attacker's residual is exactly the negative spread shown. Exact **capacity−1 / capacity / capacity+1** KLend tests found a current borrowable bound of `5,989,769,688,962` raw USDC: the first two borrow-and-repay packets succeed, while `5,989,769,688,963` fails `InsufficientLiquidity` (6008). These packets are **531 bytes / 11 accounts**. Full evidence is in `byreal-signed-cross-pool-v1.json`.

## Maximum compatible concurrent flash composition

The maximum demonstrated compatible same-mint composition uses **two independent USDC sources**, KLend and Project0/marginfi:

`Project0 start → KLend borrow → Project0 borrow → Byreal swap → Raydium exit → Project0 repay → KLend repay → Project0 end`.

It is one signed custom v1 transaction of **1,890 bytes, 44 accounts, nine instructions, two valid signatures**. Exact baseline **−1 / exact / +1** inputs all complete with both lenders repaid; an asymmetric split with only one raw USDC from KLend also completes. This shows neither lender ordering nor equal sizing creates a hidden repayment benefit.

The largest completed input tested was **225,000 USDC**, consuming **1,396,228 CU** and losing **17,167.648819 USDC**. At **230,000 USDC** the packet exhausts the 1,400,000-CU transaction meter during Project0 repayment; at **240,000 USDC** it exhausts the meter in the Raydium exit. Therefore the demonstrated feasible maximum is **225,000 USDC**, with the true compute boundary bracketed in **(225,000, 230,000) USDC**. It is not claimed to be exact: subsequent refinement attempts were blocked when Project0's Pyth account aged stale on the long-lived local fork (`PythPushStalePrice`, 6050). The pre-staleness signed evidence is preserved in `byreal-dual-provider-prestale-v1.json`; asymmetric evidence is in `byreal-dual-provider-asymmetric-v1.json`.

Save's usable source in the inspected fixtures was wSOL, and the other observed source was USDe. Neither is a concurrent same-mint addition to this USDC route without extra swaps, accounts, price risk, and compute. They are therefore not silently counted as compatible capacity.

## Thin liquidity and tick edges

For USDC→CRCLx, one raw unit fails Byreal `TooSmallInputOrOutputAmount` (6026), while 200 USDC through 225,000 USDC succeed. The current five historical tick-array accounts also succeed at `256,263,056,904`, exact `…905`, and `…906` raw USDC. At 300,000 USDC the five-account form fails `NotEnoughTickArrayAccount` (6027); supplying the expanded live PDA set avoids that error but instead reaches the **1,400,000-CU** ceiling. The current constraint is thus compute/tick traversal, not an exploitable vault underflow. The derived-PDA census and signed ±1 evidence are in `byreal-tick-array-proof.json`.

This differs from the 2026-10-15 observation near 256,000 USDC because pool state and initialized tick coverage changed. The earlier edge is not treated as immutable.

## GoonFi donation comparison

At a 200-USDC route size, the baseline returns exactly **235,023,203 raw CRCLx** from Byreal and **199,575,621 raw USDC** from Raydium. In the same signed transaction:

- donating **100,000 USDC** to Byreal's USDC vault before both swaps produces those exact same two outputs; attacker loss becomes the baseline `0.424379` USDC plus the donation;
- donating **1,000 CRCLx** to Byreal's Token-2022 vault before both swaps again produces those exact same outputs; attacker loss becomes the baseline USDC loss plus exactly 1,000 CRCLx;
- `KLend borrow → CRCLx donation → both swaps → full KLend repayment` succeeds in **1,474 bytes / 36 accounts / 171,389 CU**, with lender supply, fee, and reserve deltas all zero and the same negative attacker equity.

The published source is consistent with the execution evidence: `swap_v2.rs` reads `PoolState.sqrt_price_x64`, then calls the swap engine; `swap.rs` builds pricing state from pool sqrt price, current tick, fee growth and accounted liquidity. Raw `vault.amount` is consulted only after quote computation as an outgoing-transfer solvency/freeze check. The local source has not been proven byte-for-byte identical to the current ELF, so the signed deployed-program behavior is the primary evidence. See `byreal-vault-donation-v1.json`.

## Liquidity, fees, rewards, and price consumers

Published account constraints bind increase/decrease liquidity to a signer controlling the position NFT and bind the personal position to the pool. Protocol- and fund-fee collection is permissionless to invoke but fixes both recipients to the configured fee-keeper's associated token accounts; remaining-reward collection requires the pool owner or configured reward manager. No outsider-controlled destination is apparent in those reviewed paths.

The observed `BYrEa…PuT4` Rebalance consumer is not a privileged keeper/oracle drain. Its source transaction has the actual position owner plus a newly created replacement mint as signers, burns/closes the old owner-held NFT, and creates/mints its replacement. Substituting the fresh outsider signer and a fresh mint produces a valid **1,523-byte / 38-account / two-signature** v1 packet; current replay consumes 18,196 CU and fails `PriceSlippageExceeded` (12018) because the historical route is stale. A prior same-slot outsider mutation failed `InvalidTokenOwner` (12006), confirming the owner/ATA binding. See `byreal-rebalance-signer-provenance.md` and its JSON evidence.

These liquidity/fee/reward conclusions are source-and-provenance analysis, not exhaustive current positive-control simulations of every instruction. The concrete dynamic blocker is the absence of a fresh outsider-owned live Byreal position with accrued fees/rewards in the inspected state; manufacturing one would test the caller's own assets, not authorize withdrawal from another holder. No independent protocol consuming the donated raw Byreal vault balance as a price was found; the tested price consumer is position-owner bound.

## Scope and conclusion

The scoped attack is rejected economically, not merely by authorization: public swaps execute, an independent exit exists, one- and two-provider flash packets fit wire/account limits, and all lenders can be repaid—but every completed route loses attacker equity. Donations do not move the quote. At larger sizes, the hard barriers are tick-array coverage and the 1.4M-CU ceiling. No vulnerability report is warranted from this evidence.

Primary artifacts: `byreal-signed-cross-pool-v1.json`, `byreal-dual-provider-prestale-v1.json`, `byreal-dual-provider-asymmetric-v1.json`, `byreal-tick-array-proof.json`, `byreal-vault-donation-v1.json`, `byreal-rebalance-signer-provenance.json`, and `byreal-current-deployment.json`.
