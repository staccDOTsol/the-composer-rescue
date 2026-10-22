# Raydium AMM v4 current-mainnet revalidation

Date: 2026-10-15  
Target: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`  
Method: read-only RPC and unsigned `simulateTransaction` only; no live transaction was signed or submitted.

## Result

No unauthorized value transfer or positive-net extraction was reproduced in the tested current-mainnet surface.

Four independent, current-state value-moving controls succeeded: admin excess-lamport collection, admin PnL withdrawal, owner-authorized LP withdrawal, and public v2 swaps. The corresponding outsider signer, authority, vault, mint/destination, CPI-program, aliasing, replay/order, and atomic rollback mutations either rejected or behaved as authorized accounting. A real fee-free KLend USDC flash loan was then composed atomically with Raydium v4 in Solana transaction version 1. Exact-capacity, dust, thin-pool, repeated reverse-swap, and repayment-failure cases produced no unauthorized gain.

This is evidence against the tested hypotheses, not a proof that the entire program is vulnerability-free.

## Current deployment and custody verification

- Program account: executable and owned by `BPFLoaderUpgradeab1e11111111111111111111111`.
- ProgramData: `A7ZG7ByDi8DpzT9Ab7CiXhvgYTJQmaDPJkMDoPitaCQV`.
- Upgrade authority: `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK`.
- Last deployment slot: `445763204`.
- Deployed byte length: `1,406,384`.
- Deployed binary SHA-256: `3bcf0828cf38e5f703adbf31dc1bf81f0a1254dcb176ca950ae52231c20e6d14`.
- Runtime authority PDA from seed `amm authority`: `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`.
- Config PDA from seed `amm_config_account_seed`: `9DCxsMizn3H1hprZ7xWe6LDzeUeZBksYFpBWBtSf1PQX`.
- Config PnL owner: `PNLCQcVCD26aC7ZWgRyr5ptfaR7bBrWdTFgRWwu2tvF`.
- Hardcoded AMM admin signer: `GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ`.
- Hardcoded lamport collector signer: `Rayyxz4cjBTQo7XTT1fhVNqFWK21TjiWcrtPgC3czbL`.

The fresh custody pass ran from `2026-10-15T19:01:53.725Z` to `19:02:15.769Z`, over state slots `457346804–457346814`, vault slots `457346817–457346860`, and mint slots `457346861–457346874`:

- 483 candidate AMM v4 pools; all 483 program-owner verified.
- 966/966 stored vaults verified as SPL Token accounts whose token authority is the Raydium authority PDA.
- Zero duplicate verified vaults and zero RPC/decoding errors.
- 777 priced vaults and 189 unpriced vaults.
- Priced gross custody lower bound: `$251,380,397.69`. This is custody, not exploitable value.

The principal SOL/USDC test pool was `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`, a program-owned allocated state account rather than a pool PDA. Its stored vaults were:

- WSOL `DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz`: `106,701.148840227` WSOL in the custody snapshot.
- USDC `HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz`: `11,283,745.192273` USDC.
- LP mint `8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu`.
- OpenBook market `8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6`, owned by the expected OpenBook program `srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX`.

The thin same-input-asset pool was `HW9W14rUK3n6p8fZeuE4HTmyPmxzJ2xnTLNjMEK4Cwka`, with verified USDC vault `GyUostdqy1cRDuURG1BQyAtumxj9FMtwgkcrF5eL3KMZ` holding `56,993.469073` USDC and token vault `3iYs48Z6NzdqKybb1jadtAm233Ds7AbUgTXTCzsKmTp3` holding mint `FANoyuAQZx7AHCnxqsLeWq6te63F6zs6ENkbncCyYUZu`.

The official source snapshot used for account-order review was commit `d26944bfb76fb5fa8f91e5d440c2050ed358ef81`. A reproducible source-to-deployed-binary build was not established, so runtime simulations and the dumped executable are authoritative here.

## Current successful controls

All transactions below used version 1 wire encoding, zeroed signatures with `sigVerify:false`, `replaceRecentBlockhash:true`, and no address lookup tables.

| Control | Slot | Wire / accounts / instructions | CU | Exact effect |
|---|---:|---:|---:|---|
| Withdraw excess lamports | 457350167 | 283 B / 5 / 1 | 5,994 | Pool state `5,225,717,013 → 4,470,400` lamports. Gross transfer `5,221,246,613`; collector net is gross less the simulated fee. |
| Withdraw PnL | 457350170 | 481 B / 11 / 1 | 64,780 | WSOL vault `-531,204,208`; USDC vault `-56,263,175`; arbitrary same-mint destinations increased by exactly those amounts. |
| V2 exact-input swap | 457350175 | 431 B / 9 / 1 | 15,399 | User `-1,000,000` raw USDC, `+9,415,724` raw WSOL; pool vaults changed by the exact opposite amounts. |
| V2 exact-output swap | 457350178 | 431 B / 9 / 1 | 15,529 | User `-106,206` raw USDC, `+1,000,000` raw WSOL; pool vaults reconciled exactly. |
| LP withdrawal | 457350182 | 915 B / 22 / 1 | 50,214 | Holder and mint supply each `-1,000,000` LP; pool `-1,170,537` raw WSOL and `-124,006` raw USDC; destinations increased exactly. |

The swap-vault product increased from `1203998599706644112412518778` to `1203998599973162441787220254` in the exact-input control. The positive delta is consistent with fees; it is not an invariant decrease or value creation for the caller.

## Adversarial mutation results

### Signer and authority

- Excess-lamport outsider collector: rejected with Raydium custom error `21` (`InvalidSignAccount`).
- PnL outsider admin: rejected with custom `21`.
- LP outsider owner: rejected with custom `18` (`InvalidOwner`).
- Swap outsider using another owner's source account: SPL Token rejected with custom `4` (`owner does not match`).
- Wrong AMM authority in swap or excess collection: rejected with custom `1` (`InvalidProgramAddress`).

### Vault, mint, destination, CPI substitution, and aliasing

- Wrong PnL coin vault and wrong LP coin vault: custom `4` (`InvalidCoinVault`).
- Swapped PnL output mints: custom `16` (`InvalidCoinMint`).
- Same-mint PnL destinations owned by unrelated programs are accepted, but only under the hardcoded admin signer. This is privileged destination flexibility, not outsider control.
- PnL destinations aliased to their source vaults succeed with zero token movement while PnL accounting state changes. This is a trusted-admin footgun; no unauthorized caller could invoke it.
- LP destinations aliased to pool vaults: rejected with `InvalidCoinVault`.
- Swap source aliased to the pool vault or destination aliased to the same-mint source: rejected with custom `42` (`User token input does not match AMM`).
- Token-program substitution with System Program: rejected with custom `38` (`InvalidSplTokenProgram`).

### Replay, order, rounding, and atomicity

- Two PnL instructions in one transaction paid once; the second recomputed zero PnL.
- Duplicate excess-lamport sources/instructions transferred only the original excess; the second pass was a no-op.
- Two valid 1,000,000-unit swaps consumed exactly 2,000,000 raw USDC and returned the sum of separately priced outputs.
- Two valid 1,000,000-unit LP withdrawals burned exactly 2,000,000 holder LP and 2,000,000 mint supply, with destinations matching both withdrawals.
- Swap dust boundary: 1 raw USDC rejected with custom `29` (`InvalidInput`); 2 raw USDC succeeded and returned 9 raw WSOL.
- LP withdrawal boundary: 8 raw LP rejected with `InvalidInput`; 9 raw LP succeeded, burning 9 and returning 10 raw WSOL plus 1 raw USDC.
- Valid instruction followed by an outsider mutation failed at the second instruction for PnL, swap, and LP withdrawal. Successful first-instruction logs were present, but failed simulations returned no post-state accounts, consistent with transaction-wide rollback. No partial state was committed.

## Real atomic version-1 flash-loan composition

Funding used live KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` and supply vault `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`.

- Reserve-configured `flashFeeRateSf` was exactly `0`; this was not inferred from a rounded zero fee.
- At harness construction, accounted available liquidity was `8,011,866,795,993` raw USDC and supply-vault balance was `8,011,866,865,998`, a 70,005-unit difference.
- Borrow/repay of 1 raw, 2 raw, and exactly `8,011,866,795,993` raw USDC all succeeded.
- Accounted available plus one rejected with KLend custom `6008` (`InsufficientLiquidity`), as did supply-vault balance and `u64::MAX`.
- The flash instructions include no obligation account and create no debt/share position. Successful cases left the borrower-to-KLend supply vault and fee vault at exact zero token delta. The reserve data hash changed because its last-update/accounting fields were refreshed, not because debt shares remained.

The primary cross-program positive control was:

`create WSOL ATA → KLend flash-borrow 8,011,866,795,993 USDC → Raydium v2 swap 1,000,000 USDC → KLend repay 8,011,866,795,993 USDC`

- Slot `457350192`.
- 859 bytes, 20 inline accounts, 9 writable accounts, 4 instructions, 1 signer.
- 85,241 CU and 12,122,304 loaded-account bytes.
- Borrower USDC `1,109,081 → 109,081`, new WSOL ATA `0 → 9,415,724` raw.
- Raydium vaults: WSOL `-9,415,724`, USDC `+1,000,000`.
- KLend supply vault: unchanged; KLend fee vault: unchanged at zero.
- Flash principal was repaid in full. The user's 1 USDC funded the swap loss; the flash loan did not produce a residual principal imbalance.

At the independent custody quote (`SOL $105.8698835748535`, `USDC $0.9995833599083518`), the received `0.009415724` WSOL was worth about `$0.99676` against about `$0.99958` spent, before transaction/ATA costs. This is ordinary swap fee/slippage, not unauthorized extraction.

### Repeated reverse swaps and runtime boundary

Each round trip swapped 1 raw USDC-dollar into WSOL, then 9,400,000 raw WSOL back into USDC. The 9-round-trip transaction succeeded:

- Slot `457350195`.
- 1,352 bytes, 20 accounts, 21 instructions, 367,448 CU.
- KLend supply and fee vault token deltas: exactly zero.
- Borrower residual: `-59,904` raw USDC and `+141,516` raw WSOL.
- Raydium vaults changed by the exact opposite residuals.
- Vault product increased by `4,787,889,423,038,889,732`, consistent with accumulated fees.
- Independent-price residual value was approximately `-$0.0449`, excluding refundable ATA rent and transaction cost.

The first tested repeat-count failure was 10 round trips:

- 1,410 bytes, 20 accounts, 23 instructions, 363,634 CU.
- Failed at instruction index 21 with `MaxInstructionTraceLengthExceeded`.
- Nine succeeded and ten failed, so the observed blocker was instruction-trace depth—not the 4,096-byte wire limit, 64-inline-address limit, or compute limit. Sixteen and twenty round trips failed at the same instruction index.

### Thin-pool and capacity cases

- Thin-pool 1 raw USDC rejected cleanly with Raydium `InvalidInput`.
- Thin-pool 2 raw USDC succeeded atomically: caller `-2` raw USDC, destination `+710,246` raw FAN, and both pool vaults reconciled exactly; KLend principal and fee-vault deltas were zero.
- Thin-pool 1 USDC succeeded and returned `708,458,631,317` raw FAN; the mint was unpriced in the independent price feed, so no net-gain claim is made.
- A flash-funded swap of 90% of the thin pool's sampled USDC vault executed through Raydium but KLend repayment then failed with SPL Token `insufficient funds`; transaction-wide rollback followed. A reverse trade necessarily incurs pool fees, while the selected historical owner had only `1.109081` USDC of prefunded balance, so there was no same-transaction source for the hundreds of USDC needed to cover round-trip fees.
- Swapping the entire KLend available amount through the top pool likewise reached the final repay and failed for insufficient USDC, then rolled back. This is an economic repayment constraint, not a wire-size or account-count blocker.

Raydium AMM v4 is constant-product/OpenBook-integrated, not CLMM or DLMM. It has no tick arrays, tick crossings, concentrated-liquidity zero-liquidity edges, or oracle/crank transition accounts to test. Those requirements are inapplicable to this exact target and were not replaced with a different Raydium program.

## Informational source/runtime discrepancy

At source commit `d26944b...`, the public `withdraw_excess_lamports` instruction builder supplies System Program as account 2, while the processor and deployed runtime require the SPL Token Program at account 2. A builder-shaped simulation failed with custom `38`; replacing that key with `Tokenkeg...` produced the successful current control above.

This is a client-construction/maintenance availability defect, not an unauthorized withdrawal primitive: the runtime still requires the hardcoded collector signer and correct AMM authority. Relevant source: [instruction builder](https://github.com/raydium-io/raydium-amm/blob/d26944bfb76fb5fa8f91e5d440c2050ed358ef81/program/src/instruction.rs#L1168-L1185) and [processor validation](https://github.com/raydium-io/raydium-amm/blob/d26944bfb76fb5fa8f91e5d440c2050ed358ef81/program/src/processor.rs#L2817-L2845).

## Coverage limits

- Simulation used current RPC bank state and disabled signature verification; it proves runtime account validation and arithmetic paths, not possession of private keys.
- No live transaction was sent and no team member was contacted.
- The custody census covered the 483 AMM v4 pools present in the supplied first API page. It is a verified sample/lower bound, not proof that no additional pool exists outside that discovery source.
- The detailed mutation and flash matrix focused on the largest verified SOL/USDC pool and the smallest verified same-input-asset USDC pool in that sample.
- Unpriced residual mint `FAN...` was not assigned a speculative value.
- Three of 56 simulations had comparison-slot mismatch for auxiliary baseline capture; none was used for an exact balance claim. The successful controls and principal conclusions above use same-slot or transaction-internal reconciliation.

## Artifacts

- Full harness: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/raydium-v4-current/raydium-v4-current-revalidation.js`
- Full 56-case result, logs, account images, bytes/accounts/CU: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/raydium-v4-current/raydium-v4-current-revalidation.json`
- Fresh custody evidence: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/raydium-v4-current/raydium-current-verified-1p.json`
- Dumped executable: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/raydium-v4-current/raydium-amm-v4-current.so`
- Official source snapshot: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/raydium-v4-current/source`

