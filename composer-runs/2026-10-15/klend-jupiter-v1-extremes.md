# Zero-fee Kamino flash liquidity through Jupiter Earn, Solana v1

Observed on mainnet 2026-10-15 through **read-only** `simulateTransaction` with `sigVerify: false`. No transaction was signed or submitted. **Validated unauthorized gain: $0.** The sampled custody and flashable amount are not an estimate of exploitable funds.

## Programs, reserve, and exact upper bound

- KLend: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`.
- Jupiter Earn lending controller: `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`, with `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` liquidity CPIs.
- KLend USDC reserve: `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`.
- At account-read slot `457347933`, the reserve's decoded `liquidity.total_available_amount` at byte offset 224 was **7,868,315,584,088 raw USDC** (7,868,315.584088 USDC). Its `flash_loan_fee_sf` at byte offset 4904 was exactly **zero**. The underlying SPL token supply vault held 7,868,315,654,093 raw units; its 70,005-unit excess over the accounted available amount was not flash-borrowable.
- At simulation slot `457347942`, a flash borrow of **exactly** 7,868,315,584,088 raw USDC followed by repay succeeded. An otherwise identical borrow of one raw unit more failed KLend `InsufficientLiquidity` (6008) at instruction 0. The full SPL balance and `u64::MAX` also failed 6008. The exact available amount also succeeded in an atomic `flash borrow → Jupiter Earn deposit → Jupiter Earn withdrawal → flash repay` transaction.

This is a **zero-fee-rate** flash reserve, confirmed from the on-chain reserve state, not merely a small-loan rounding artifact. The flash loan is still repayable liquidity, not funds the attacker can retain.

## Exact accounting at the same bank slot

The successful flash-only pair and full Jupiter Earn cycle both ran at slot `457347942`. They returned the following post-state snapshots:

| Account measure | Flash pair | Flash + Jupiter Earn cycle | Difference |
| --- | ---: | ---: | ---: |
| User USDC token | 1,109,081 | 1,109,081 | 0 |
| User fToken shares | 469,684,654 | 469,684,652 | −2 |
| Jupiter Earn USDC vault | 33,663,574,272,075 | 33,663,574,272,075 | 0 |
| Jupiter fToken mint supply | 453,407,905,982,305 | 453,407,905,982,303 | −2 |
| KLend USDC supply vault | 7,868,315,654,093 | 7,868,315,654,093 | 0 |
| KLend flash fee vault | 0 | 0 | 0 |

The KLend reserve and Jupiter liquidity state hashes also matched across these same-slot controls. Jupiter's lending and supply-position state hashes changed as the two shares were consumed. No persistent borrower obligation was involved: this path used Jupiter Earn deposit and withdrawal. The holder lost two raw fToken units to round-trip accounting; no unbacked USDC appeared.

The v1 cycle was 1,054 bytes, 4 instructions, 25 inline addresses, 13 writable accounts, one assumed signer, and about 149,000 compute units. It loaded 12,168,680 account-data bytes. The v1 config explicitly requested 1.4M compute units and 64 MiB loaded-account data; there were no address lookup tables. [Solana's v1 specification](https://solana.com/docs/core/transactions/versioned-transactions) permits 4,096 bytes and carries these resource limits in the message.

## Extremes, cranks, repeated legs, and mutations

| Probe | Current-binary result |
| --- | --- |
| 1 raw USDC KLend borrow/repay | Success. |
| 1–9 raw USDC flash → Jupiter Earn cycle | Deposit rejected `OperateAmountsNearlyZero` (6030); the whole transaction fails. |
| 10 raw USDC flash → Jupiter Earn cycle | Success; this was the smallest tested positive cycle. |
| 1,000, 1,000,000, 1,000,000,000, and 1,000,000,000,000 raw USDC cycles | Success; user USDC returned to its starting amount, with a small fToken share loss. |
| 90%, 99%, 99.9%, 99.99%, and 99.999% of displayed SPL supply | Flash-funded cycle succeeded at each level; exact accounted available amount was separately tested as above. |
| Jupiter `update_rate` before flash, between Earn deposit and withdrawal, or after withdrawal | All succeeded with the same user USDC and fToken outcome for the matched one-USDC cases. |
| Withdraw before deposit inside flash window | Succeeded using the owner's existing shares; user USDC ended unchanged and shares were consumed. |
| Two through six Earn round trips inside one flash window | Succeeded; each additional round consumed shares, with no user USDC gain or reserve loss. Six rounds: 14 instructions, **1,429 v1 bytes**, 25 accounts, 13 writable, one signer, 608,827 CU. The equivalent v0 layout was 1,405 bytes and could not fit v0's 1,232-byte cap. |
| Seven through twelve round trips | Failed at instruction 14 with `MaxInstructionTraceLengthExceeded`. This CPI-heavy route reaches the runtime trace limit before the 4,096-byte or 1.4M-CU limits. |
| Outsider signer withdrawing the holder's fToken | `ConstraintTokenOwner` (2015). The `sigVerify: false` simulation did not provide the holder's real signature to an attacker. |
| Alias the Jupiter deposit source to Jupiter's own token vault | `ConstraintTokenOwner` (2015). |

The tested boundary is one KLend USDC reserve, one Jupiter Earn pool, one live holder, and selected instruction families. It does not establish safety for all pools, flash reserve configs, token extensions, oracle routes, or CPI wrappers. Failed simulations returned null post-account images and were not treated as committed balance deltas.

Reproduce from the workspace with `node composer-runs/2026-10-15/klend-jupiter-v1-extremes.js`. The script contains no RPC credential; it reads the local read-only RPC configuration. Complete slots, logs, wire sizes, compute use, account images, and hashes are in `klend-jupiter-v1-extremes.json`.
