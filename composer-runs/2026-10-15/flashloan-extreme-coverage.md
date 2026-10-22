# Flashloan extreme coverage tracker

Observed 2026-10-15. Mainnet transactions are read-only `simulateTransaction` or local-fork calls. **No live transaction submitted.** One separate current-binary finding is validated with a one-authorized-key precondition: [RuneMine's duplicate signer-slot threshold bypass](5uums-validation.md). No permissionless drain or realized USD proceeds were established. Gross PDA custody values are not exploitable amounts. Assignment is not completed testing.

## Current verified compositions

| Funding / target | Strongest successful control | Boundary or accounting result | Evidence |
| --- | --- | --- | --- |
| KLend USDC → Meteora Dynamic Vault | 22 instructions, 1,391-byte v1, ten deposit/withdraw cycles | Flash principal fully repaid; each withdrawal burns holder LP; outsider exit rejected; 11 cycles reaches instruction trace limit | [Report](klend-v1-composition.md) |
| KLend USDC → Jupiter Earn | 7,789,632,497,552 raw USDC flash (~$7.79M) → Earn deposit/withdraw → repay; six rounds fit 1,429-byte v1 | Reserve/fee vault unchanged; user USDC unchanged; share supply fell with burned fTokens; larger borrow rejected `InsufficientLiquidity` | [Evidence](klend-jupiter-v1-extremes.json) |
| Project 0 WSOL → Raydium CPMM | Borrow 10,000,000 raw WSOL → two opposite swaps → full repay in a 1,076-byte v1 transaction; separate tiny LP-backed pools and LP mint/burn tested | Across 108 read-only variants, 61 completed and 47 rejected. Independent output quotes, fee-adjusted invariant, and newly minted LP burn show no verified outsider gain; pool fees and rounding cost the caller. | [Full report](project0-v1-thin-pools.md) |
| Project 0 USDT → Jupiter Vault | P0 borrow 2,248,341,974 raw USDT → repay succeeds in 564-byte v1; independent Jupiter Vault borrow leg fits 1,680 bytes | Same-asset P0→Jupiter Vault supply rejected `ConstraintTokenOwner` before state change; no linked gain | Agent report pending |
| KLend USDC → RuneMine wrapper | Zero-rate borrow → one-authorized-key alias unlock → full repay succeeds in 963-byte v1 | Unlock-only control has identical DOG outflow; flash liquidity adds no DOG. One-key threshold bypass is a separate validated conditional finding. | [Composition](flashloan-5uu-composition.md), [validation](5uums-validation.md) |

The sampled KLend USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` has decoded on-chain `flash_loan_fee_sf = 0` at slot 457347654. The observed zero fee-vault delta therefore reflects an actual zero rate for this reserve, including a later exact-available **7,868,315,584,088 raw USDC** successful flash → Earn → repay control; exact available plus one raw unit rejected `InsufficientLiquidity`. A [current reserve census](klend-zero-fee-census.json) decoded 619 reserves: 562 exact zero-rate, 43 positive-rate, and 14 disabled; 441 zero-rate reserves were active, non-emergency, and nonempty. This is config coverage, not 441 simulated flash controls. Read-only borrow/repay controls also succeeded on zero-rate USDe, PYUSD, and USDG reserves at dust and large amounts in [simulation evidence](klend-zero-fee-simulations.json). One USDe plus-one boundary succeeded across a later slot and remains under same-slot recheck.

## Program audit assignments

Each program-specific task received the same atomic v1 flashloan matrix: dust/minimum, near-available reserve balance, threshold rounding, repeated legs, update/refresh placement, aliases/order, full repayment, and exact pre/post accounting. A task is marked **assigned** until its current-binary evidence is reviewed.

| Program task | Task state | Flash extreme verification |
| --- | --- | --- |
| Daybreak: Jito Restaking Vault audit | active | Assigned; report review pending |
| Daybreak: 5UuMS custody controller | active | Assigned; report review pending |
| Daybreak: SKR custody controller | active | Assigned; report review pending |
| Daybreak: Locp custody controller | active | Assigned; report review pending |
| Daybreak: GRASS custody controller | active | Assigned; report review pending |
| Daybreak: Wormhole Token Bridge custody | active | Assigned; report review pending |
| Daybreak: PumpSwap atomicity audit | active | Assigned; report review pending |
| Daybreak: marginfi vault exits | active | Assigned; report review pending |
| Daybreak: Sanctum unstake custody | active | Assigned; report review pending |
| Daybreak: Save current-binary revalidation | active | Assigned; report review pending |
| Daybreak: Sanctum multi-validator stake… | active | Assigned; report review pending |
| Daybreak: jup6QF vault controller | active | Assigned; report review pending |
| Daybreak: SP12 native stake controller | active | Assigned; report review pending |
| Daybreak: GR8 vesting META custody | active | Assigned; report review pending |
| Daybreak: Magna vesting custody | active | Assigned; report review pending |
| Daybreak: GOHOME vesting custody | active | Assigned; report review pending |
| Daybreak: Kamino automated liquidity | active | Assigned; report review pending |
| Daybreak: Raydium CLMM remaining exits | active | Assigned; report review pending |
| Daybreak: Meteora DLMM revalidation | active | Assigned; report review pending |
| Daybreak: Raydium AMM v4 revalidation | active | Assigned; report review pending |
| Daybreak: Sanctum INF revalidation | active | Assigned; report review pending |
| Daybreak: Orca Whirlpools revalidation | active | Assigned; report review pending |
| Daybreak: Marinade Liquid remaining… | active | Assigned; report review pending |
| Daybreak: Kamino Kvault custody audit | active | Assigned; report review pending |
| Daybreak: orderbook DEX custody | active | Assigned; report review pending |
| Daybreak: Meteora DAMM v1 integration | active | Assigned; report review pending |
| Daybreak: Jupiter Perps remaining exits | active | Assigned; report review pending |
| Daybreak: Jupiter Lend composition | active | Assigned; report review pending |
| Daybreak: Meteora DBC census and audit | active | Assigned; report review pending |
| Daybreak: Drift custody and exit audit | active | Assigned; report review pending |
| Daybreak: Meteora DAMM v2 audit | active | Assigned; report review pending |
| Daybreak: Raydium CPMM audit | active | Assigned; report review pending |

## Discovery assignments

| Discovery task | Task state |
| --- | --- |
| Daybreak: mainnet executable inventory | active |
| Daybreak: bridge families inventory | active |
| Daybreak: native SOL and stake custody | active |
| Daybreak: SPL token authority census | active |

## Validation rule

Call a fund-loss finding only if a current deployed binary or faithful local fork shows unauthorized net asset gain after complete flash repayment and all debt/share/equity changes. Simulated signatures for legitimate owners or administrators establish control paths; they do not establish outsider authority.
