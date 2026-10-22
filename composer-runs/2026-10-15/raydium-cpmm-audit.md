# Raydium CPMM current-binary custody and flash-composition audit

**Date:** 2026-10-15  
**Target program:** `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`  
**Scope:** Raydium CPMM only. Raydium AMM v4 and CLMM are excluded.  
**Execution policy:** read-only RPC, `simulateTransaction`, and Surfpool mainnet forks only; no live transaction was submitted.  
**Result:** **No validated vulnerability. No unauthorized transfer. Exploitable amount demonstrated: $0.**

## Executive conclusion

The deployed CPMM binary rejected the tested authority, owner, vault-binding, mint/order, account-alias, and CPI-program substitutions. Successful swaps and withdrawals moved value only when the original authenticated payer or LP owner authorized the debit. Alternate same-mint destinations were accepted, but only while the legitimate signer paid the swap input or burned their LP; this is authorized gifting, not a custody bypass. Duplicated authorized instructions produced the expected doubled effects.

Real atomic v1 flash-loan compositions were simulated against deployed Project 0/marginfi and KLend programs. They covered exact minimum and maximum lender boundaries, CPMM dust thresholds, repeated and reordered swaps, account aliasing, reserve-scale input, and an LP mint/burn cycle. Every successful flash case fully repaid the lender. Round trips lost value after fees/rounding, fee-excluded CPMM constant products increased, and the reserve-scale KLend sequence could not repay. No flash-funded path created an unpaid lender debt, an LP-supply discrepancy, a profitable residual, or an unauthorized vault transfer.

The sampled CPMM custody is a **gross, time-specific, priced lower bound of $30,485,590.79**, not an exploitable-loss estimate. Eighty-seven sampled vaults were unpriced, so it is also not total protocol TVL.

## Scope and evidence standard

This review tested the current deployed binary and on-chain account state rather than treating public source as exact. A condition was reportable only if it produced a reproducible unauthorized value transfer or a concrete invariant failure in the deployed program. Successful simulations were reconciled across signer token accounts, CPMM vaults, lender vaults, debt/share fields, LP supply, accumulated fee fields, and observation/pool hashes. Failed simulations returned no post-account snapshots; rollback in those cases follows Solana transaction atomicity and is not presented as a measured post-balance comparison.

The flash harnesses emitted genuine custom Solana version-1 wire messages and enforced the requested limits of 4,096 serialized bytes and 64 inline accounts. The largest successful case was 1,173 bytes with 26 inline accounts. Both harnesses used `sigVerify: false` to replay authenticated mainnet account graphs on isolated forks. This does not synthesize signing authority on mainnet: successful token debits still used the original signer metas and token-account ownership relationships.

## Deployment provenance

| Property | Observed value |
|---|---|
| ProgramData | `DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU` |
| Upgrade authority | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` |
| Last deployment slot | `452376460` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Allocated ProgramData bytes | `793,824` |
| Nonzero binary prefix | `722,617` bytes |
| Allocated SHA-256 | `b6dbea8cefc2e7d490775ce6115e34a2ba480c0853c359e0bb4043b9381ef09a` |
| Nonzero-prefix SHA-256 | `93cad2458ac72435c94b8ac89faa686987f4e29d2f0e862d546fbc5aa814a0d2` |

OtterSec reported the program as unverified, not frozen, and not closed. Its current on-chain hash agreed with the captured nonzero-prefix hash. A reproducible build attempt from the then-current official repository commit `b3187ae53a1b95a201f855a59024a12ca8f5b51a`, using Anchor 1.0.2 and Solana 3.1.10, produced a different nonzero ELF (`722,625` bytes, SHA-256 `4e42a5...`). Exact source equivalence therefore was **not established**. Source constraints and packed field offsets were used only as advisory interpretation; pass/fail conclusions below come from the deployed binary's runtime behavior.

The program remains upgradeable. The upgrade authority is a governance/trust dependency, not evidence of a present exploit in the tested binary.

## Custody and authority verification

The inventory contained 164 candidate CPMM pools. All 164 pool states were program-owned and state-verified; all 328 associated token vaults had their expected authority. Of those vaults, 241 had independent prices and 87 did not. State slots ranged from `457328170` to `457328180`, vault slots from `457328183` to `457328204`, and mint slots from `457328205` to `457328239`.

The highest-value sampled pool was `Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp`:

| Side | Mint | Vault | Snapshot balance | Snapshot value |
|---|---|---|---:|---:|
| A | wrapped SOL | `HgNPDD8bpbSrGyHegiCT5xrYxHTfwLfZydwGkjNCJRKA` | 20,167.688804087 SOL | $2,136,267.44 |
| B | `Dz9m...bonk` | `9xsCiNwYQXM3ZeHFSVj9JQdP1vREJREpN23f6wvxA1ty` | 12,555,845.810895 | $2,123,138.16 |

Its state owner matched CPMM; its pool PDA, both `pool_vault` PDAs, and bump matched; and both vault authorities were the global CPMM authority PDA `GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL`. The second high-value test pool, `gyYigqG8vdEMkDNTTVL6at2msbHdTDWyb6bccyR238U`, held approximately $1.396 million USDC plus $1.370 million of `3ZLek...` at the custody snapshot.

## Direct deployed-binary simulations

### High-value swap

A historical successful `SwapBaseInput` on the `Q2s...` pool was reconstructed and simulated at a current-mainnet fork slot. The authorized swap debited `82,285` raw input tokens, credited the input vault by the same amount, credited the user's wrapped-SOL destination by `131,957` lamports, and debited the output vault by `131,957` lamports.

| Mutation | Runtime result | Interpretation |
|---|---|---|
| Baseline authorized swap | Success | Exact user/vault conservation |
| Authority PDA replaced with System Program | Rejected: `ConstraintSeeds` 2006 | Global authority binding enforced |
| Payer replaced with attacker while retaining victim input account | Rejected: token error 4, owner mismatch | Input debit requires token owner authority |
| Input token program replaced with System Program | Rejected: `InvalidProgramId` 3008 | CPI program identity enforced |
| Input vault replaced by another pool's vault | Rejected: `ConstraintRaw` 2003 | Pool-to-vault binding enforced |
| Alternate destination of the correct output mint | Success | Legitimate payer gifted their purchased output; no victim debit |
| Same authorized swap duplicated | Success, exactly doubled deltas | Normal per-instruction execution; no hidden amplification |
| Valid then invalid authority mutation | Whole transaction failed at instruction 1 | Same-transaction failure is atomic |
| Invalid then valid | Whole transaction failed at instruction 0 | Invalid prefix cannot be repaired later |

### Value-moving LP exit

A successful withdrawal from pool `583xuMPHi3hGCmtLwCsrCJVUbZuaazA9FLwcQwUDZhJ` burned `35,096,810,320` raw LP units. The authorized destinations gained `291,145,596` raw wrapped SOL and `4,377,206,859,681` raw units of the other token; the two pool vaults decreased by the same amounts.

| Mutation | Runtime result | Interpretation |
|---|---|---|
| Baseline authorized withdrawal | Success | LP debit and both vault exits reconciled |
| Authority PDA replaced with System Program | Rejected: 2006 | Withdrawal signer PDA enforced |
| Owner signer replaced with attacker | Rejected: `ConstraintTokenOwner` 2015 | LP ownership enforced |
| Classic token program replaced with System Program | Rejected: 3008 | CPI target enforced |
| Vault order swapped | Rejected: `ConstraintTokenMint` 2014 | Mint/order binding enforced |
| Token-0 vault replaced by another pool's vault | Rejected: 2003 | Pool-to-vault binding enforced |
| Alternate same-mint destination | Success | LP owner gifted their redeemed asset; LP still burned |
| Authorized withdrawal duplicated | Success, exactly doubled burn and payouts | Expected repeated authorized action |
| Valid/invalid and invalid/valid pairs | Whole transaction rejected at the mutated instruction | No partial commit |

The withdrawal also exercised a mixed classic-token/Token-2022 value path. No mutation transferred CPMM custody without the authenticated source owner paying or burning the corresponding asset.

## Atomic v1 flash-loan stress

### Project 0 / marginfi, wrapped SOL, high-value `Q2s...` pool

The Project 0 program was `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`. Its sampled liquidity vault held `11,208,583,873,143` raw wrapped-SOL units. The exact successful borrow interval was established by binary search:

- `1` raw failed with `IllegalBalanceState` 6040; `2` raw succeeded.
- `11,204,442,713,581` raw succeeded; the adjacent `11,204,442,713,582` failed with `IllegalUtilizationRatio` 6026.
- The maximum success was 99.9630537% of available liquidity and left `4,141,159,562` raw units.

For successful controls, the Project 0 liquidity-vault token balance was identical before and after, the borrower's margin position had zero liability shares before and after, and the loan was fully repaid.

| CPMM composition | Result | Measured effects |
|---|---|---|
| Inputs 1 and 2 raw wSOL | Rejected: `RequireGt` 2505 | Output rounded to zero |
| Input 3 raw wSOL | Success, repaid | Borrower `-3` wSOL; pool `+3` wSOL; pool `-1` output raw |
| One 100,000-lamport swap between borrow/repay | Success, repaid | `62,154` raw output; 1,000 bytes, 23 accounts, 6 instructions, 120,363 CU |
| CPMM before flash; within borrow/repay; after repay; after flash end | All succeed when individually authorized/funded | No ordering-sensitive accounting bypass |
| Two identical swaps | Success, repaid | Exact doubled deltas; 1,041 bytes, 23 accounts, 7 instructions, 145,129 CU |
| One two-leg round trip | Success, repaid | Seeded 100,000 wSOL; net `-19,957` wSOL and `+12,154` raw output |
| Two repeated round trips | Success, repaid | Seeded 200,000 wSOL; net `-39,914` wSOL and `+24,308` raw output |
| Same token account aliased as input and output | Rejected: 2040 | Mint/account alias blocked |
| Pool vaults reversed | Rejected: 2012 | Vault order/binding enforced |
| Near-liquidity principal into CPMM | Success, repaid | See qualification below |

The near-liquidity case borrowed and swapped `11,193,238,270,867` raw wSOL. It used a Surfpool-only authenticated borrower balance seeded to the same amount so repayment remained possible after the one-way swap. The CPMM wSOL vault increased by that amount and the output vault decreased by `4,477,399,434,436` raw units; the Project 0 vault was fully restored and liability shares remained zero. This is a scale/price-impact control, **not a self-financing or mainnet attacker path**, because the disclosed pre-seeded balance paid the principal shortfall.

The CPMM pool and observation hashes changed with each successful swap. CPMM has no separate permissionless refresh/crank leg applicable here; pool and observation state update inline during a swap.

### KLend, exact-zero-fee USDC, high-value `gyYigq...` pool

The KLend program was `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`. At fork slot `457347697`, reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` had `flashLoanFeeSf = 0`. This was a literal on-chain zero, not a positive rate whose computed fee rounded down. Available liquidity was `7,868,315,584,088` raw USDC. Direct borrows of 1 and 2 raw, and `7,868,315,584,087` raw (available minus one), all succeeded with unchanged supply and fee-vault token balances.

No synthetic token balance was added for the KLend cases. The authenticated owner began with `1,109,081` raw USDC, which allowed ordinary CPMM losses to be paid while principal was returned.

| CPMM composition | Result | Measured effects |
|---|---|---|
| 1 raw USDC input | Rejected: 2505 | Output rounded to zero |
| 2 raw USDC input | Success, repaid | Owner `-2` USDC raw; pool `+2` USDC; output `+186` raw |
| One two-leg round trip | Success, repaid | Owner `-19,816` USDC raw; residual `+3,613,373` output raw; lender supply/fee vault unchanged |
| Two repeated round trips | Success, repaid | Owner `-39,632` USDC raw; residual `+7,226,746` output raw; fee deltas doubled |
| Available-minus-one principal plus small round trip | Success, repaid | Same AMM loss as the one-cycle case; lender fully restored |
| CPMM input approximately equal to its USDC reserve | Both swaps succeeded; KLend repayment failed | Atomic transaction rejected at repay for insufficient funds |
| Same input/output account | Rejected: 2040 | Alias blocked |
| Reversed vault order | Rejected: 2012 | Order/binding enforced |

The reserve-scale failure borrowed `1,693,366,560,392` raw USDC, sent `1,411,138,800,327` raw USDC into CPMM (one less than the live USDC vault), then reversed `130,015,221,293,574` raw output units. Both CPMM swaps completed in the execution trace, but KLend's repay transfer failed with token error 1 for insufficient funds. The message was only 976 bytes, used 22 accounts and five instructions, and consumed about 123,225 CU. Thus the blocker was the ordinary AMM fee/slippage loss exceeding the signer's starting buffer, not a byte, account, or compute limit. Because the transaction failed, it committed none of the interim changes.

### LP mint/burn rounding

Inside a fully repaid zero-fee KLend flash loan, a swap was followed by CPMM deposit and withdrawal. Desired LP amounts 1, 2, 10, and 11 raw failed with `ZeroTradingTokens` 6006; 12 raw was the first success. The 12-unit case used 1,173 bytes, 26 accounts, seven instructions, and 165,660 CU. At completion:

- the user's LP balance was zero;
- pool-state LP supply was unchanged at `16,366,797,079,419` raw;
- LP mint supply was unchanged at `16,366,797,079,319` raw;
- the KLend supply vault and fee vault were unchanged;
- the owner lost `100,001` raw USDC and retained `18,613,372` raw output tokens;
- vault deltas exactly mirrored the owner deltas.

No LP mint/burn rounding surplus or supply-accounting discrepancy was observed.

## Independent economic and invariant checks

Execution residuals were valued independently using custody-snapshot quotes: SOL at `$105.9252481810`, `Dz9m...` at `$0.1690955903`, and `3ZLek...` at `$5.1478852335`. These prices were not used by the programs and are only an independent profitability check.

| Case | Input-side loss | Residual value | Net value |
|---|---:|---:|---:|
| Project 0 one-way 100,000 lamports | $0.01059252 | $0.01050997 | **-$0.00008256** |
| Project 0 one round trip | $0.00211395 | $0.00205519 | **-$0.00005876** |
| Project 0 two round trips | $0.00422790 | $0.00411038 | **-$0.00011752** |
| Project 0 seeded near-liquidity one-way swap | about $1,185,646.54 | about $757,108.50 | **about -$428,538.04** |
| KLend dust input 2 raw USDC | $0.00000200 | $0.00000096 | **negative** |
| KLend one round trip | $0.01981600 | $0.01860123 | **-$0.00121477** |
| KLend two round trips | $0.03963200 | $0.03720246 | **-$0.00242954** |
| KLend LP mint/burn threshold case | $0.10000100 | $0.09581950 | **-$0.00418150** |

For the KLend/USDC pool, effective reserves were computed as vault balances minus recorded protocol, fund, and creator fees. The effective raw-unit constant product increased by `264,163,789,678,402` in the 2-raw dust case, `99,955,129,773,634,829` in one round trip, `199,910,116,393,828,762` in two repeated round trips, and `55,562,295,770,593,742` in the LP threshold case. The Project 0 pool checks likewise showed positive effective-product deltas. The sign of every tested delta was pool-favorable, not trader-favorable.

## Findings and residual risk

### Validated security findings

**None.** The drain criterion was not reached: there was no successful unauthorized transfer, no unpaid flash principal, no profitable rounding residual, and no supply mismatch. The demonstrated exploitable amount is `$0`; the custody figure must not be used as a loss estimate.

### Non-vulnerability observations

1. **Upgradeable program.** The current upgrade authority can replace the binary. Operational controls around that authority were outside this review.
2. **Exact source unavailable.** The official source build did not hash-match deployment, so source-level claims are advisory. Runtime simulations remain valid for the captured deployed binary and state.
3. **Destinations are not always owner-bound.** A legitimate payer/LP owner can direct proceeds to another account of the correct mint. This enables gifting but did not bypass the source owner's authorization.

### Coverage limits

This was a focused, evidence-driven audit, not a proof over every program state. Direct mutation work concentrated on `SwapBaseInput`, withdrawal, and the deposit/withdraw LP cycle. It did not exhaustively fuzz `SwapBaseOutput`, initialization, administrative fee collection, every Token-2022 extension or hook, every pool, or every possible multi-program composition. Custody values and lender liquidity are snapshot-dependent. The simulated signatures are valid only as fork-replay controls and do not show that an unaffiliated attacker possesses any private key.

## Reproducibility artifacts

- `raydium-cpmm-deployment.json` and `raydium-cpmm-current.so`: deployment identity and captured binary.
- `raydium-cpmm-custody-sample.json`: verified pool/vault inventory and priced custody sample.
- `raydium-cpmm-history-samples.json`, `raydium-cpmm-top-pool-history.json`, and `raydium-cpmm-usdc-pool-history.json`: successful historical controls.
- `raydium-cpmm-top-pool-swap-simulation.json`: high-value swap mutations and atomic order tests.
- `raydium-cpmm-withdraw-simulation.json`: value-moving exit mutations and atomic order tests.
- `raydium-cpmm-swap-simulation.json`: independent lower-value swap control.
- `raydium-cpmm-project0-flash-v1.js` and `.json`: Project 0 custom-v1 threshold, ordering, repetition, alias, and near-liquidity evidence.
- `raydium-cpmm-klend-zero-fee-v1.js` and `.json`: exact-zero-fee KLend, reserve-scale, rounding, and LP supply evidence.

All paths above are in `/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/`.
