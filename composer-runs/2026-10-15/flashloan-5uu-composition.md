# 5UuMS unlock with atomic v1 flash funding

Observed 2026-10-15 on read-only Solana mainnet RPC. The scripts call `get*` and `simulateTransaction` with `sigVerify:false`; they create no signature and never submit a transaction. A simulation that requires signer `FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N` does not establish possession of its private key.

## Direct same-mint funding boundary

The target vault mints are MIM `M1M6sdffCs3ozzhpRveweRCWdZhxth4mvVujPtYEC3h`, DOG `dog1viwbb2vWDpER5FrJ4YFG6gq6XuyFohUe9TXN65u`, and PUPS `2oGLxYuNBJRcepT1mEV6KnETaLD7Bf6qq3CM6skasBfe`.

Fresh filtered `getProgramAccounts` calls found **zero** matching current Kamino Lend Reserve accounts for each target mint at slots 457348211–219 and **zero** matching Project 0/marginfi Bank accounts at slots 457348296–302. The filters select Kamino's 8,624-byte Reserve and mint field at byte 128, or marginfi's Bank discriminator and mint field at byte 8. Positive controls returned 160 Kamino USDC Reserves and four marginfi USDS Banks, verifying that the filters were live and selective. The prior full censuses likewise lacked the three mints. This blocks a direct same-mint flash borrow from these two lenders at the observed slots. A cross-asset swap route was not validated; the absence of a direct reserve does not prove every possible swap route impossible.

Evidence: `flashloan-target-mint-reserve-filter.json`, `flashloan-target-mint-marginfi-filter.json`, `flashloan-target-mint-filter-positive-controls.json`, `marginfi-vaults-current.json`.

## Current zero-fee Kamino control and boundaries

For Kamino USDC Reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, the current zero-copy state at slot 457348058 stored `flash_loan_fee_sf = 0` at byte 4904. The same decoder returned nonzero `11529215046068` for a different USDC Reserve and a SOL Reserve at slot 457349012. This is a **configured zero fee rate**, not a small positive fee rounded to zero. Its recorded available amount was 7,868,315,584,088 raw USDC while its SPL supply vault held 7,868,315,654,093; the available field, not the slightly larger token balance, governed the upper bound.

The 531-byte v1 borrow/repay pair succeeded for zero, one, two, 1,000, 100,000, 90% of the vault token balance, recorded available minus one, and exact recorded available. In each successful case, the user USDC account returned to zero, the supply vault and fee vault had their starting balances, reserve available returned to its starting value, and collateral share accounting and collateral mint supply were unchanged. The reserve borrowed fixed-point field did increase from the pre-snapshot as the instruction refreshed accrued debt, but the same post value appeared for zero, dust, and near-full flash amounts at the test slots. The flash principal did not persist as an amount-dependent liability.

One raw unit above recorded available and the vault's full token balance failed `InsufficientLiquidity` (6008). Two, eight, and sixteen borrow/repay pairs in one v1 message failed at the first borrow with `MultipleFlashBorrows` (6035), even though each wire was below 4,096 bytes. Source inspection of `flash_ixs.rs:112–139` confirms the first borrow scans later instructions and forbids a second flash borrow anywhere in the same transaction.

Evidence: `flashloan-extremes-5uu.js` and `.json`; `flashloan-fee-field-control.json`.

## Atomic composition with target alias unlock

A direct v1 transaction with the wrapper alias unlock alone transferred the full 9,709,562,711,505,337 raw DOG from target vault `5yXSQmeFkxCYrfcPpgu8UBpy3gqThvXXGVAUyRPAvVWb` to the historical recipient `9XruDz444Wc6DwtM4rAooBgAZUGNeFnEwkyArjbBf2dA`. The tested wrapper instruction duplicates signer A into the B account slot, compiles the first three account indexes as `[0,0,1]`, and requires only A's one transaction signature. It used 599 v1 bytes and 56,647 CU.

The sequence `create A's missing USDC ATA → Kamino flash borrow → wrapper alias DOG unlock → Kamino flash repay` also succeeded. With a one-raw-unit borrow it used **963 bytes**, **22 inline keys**, **four instructions**, **one required signature**, and **132,864 CU**. The same sequence with the full recorded available 7,820,864,730,717 raw USDC at slot 457348635 also succeeded with the same resource shape. A zero-raw flash control at the same slot as the one-raw case likewise produced the same DOG transfer. The complete DOG balance moved in all four successful cases, while the Kamino supply vault, fee vault, reserve available amount, reserve collateral shares, and collateral mint supply were unchanged after full repayment. The newly created A USDC ATA finished at zero. The post reserve borrowed fixed-point field was equal for the zero, one, and maximum flash cases and differed from the pre-snapshot through ordinary reserve accrual.

An underfunded negative case borrowed one raw USDC, logged a successful wrapper DOG unlock, transferred that USDC away, then failed at the final repay with SPL `insufficient funds` (Custom 1). The 979-byte transaction was rejected and the RPC returned no post-account images. This demonstrates that a successful unlock log inside an unrepayable transaction does not constitute a completed atomic exit.

The USDC flash pair is technically composable, but it supplies no DOG and creates no additional DOG outflow: the unlock-only control has the same DOG delta. The direct alias unlock is the value path. This composition does not establish the liquid economic value of the DOG balance; quoted DOG liquidity was far below its spot-price gross mark in the custody census.

Evidence: `flashloan-5uu-alias-v1.js` and `.json`; wrapper alias controls in `5uums-wrapper-alias-independent.json`. All v1 messages use no address lookup tables and are below the 4,096-byte limit.
