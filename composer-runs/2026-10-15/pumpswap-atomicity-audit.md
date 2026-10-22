# PumpSwap current-binary atomicity audit

Date: 2026-10-15 (America/Toronto)  
Program: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`  
Result: **No validated novel immediately-at-risk fund vulnerability found in this tranche.**

No live transaction was signed or submitted. Every value-moving test used `simulateTransaction` with `sigVerify: false`; chain queries were read-only.

## Bottom line

The bounded custody census is a gross custody lower bound, not an exploit amount:

- 1,000 verified pools and 2,000 verified vaults.
- 1,440 priced vaults totalled **$111,822,151.76** at census slots 457328197-457328263.
- 560 vaults were unpriced, so the USD figure is a lower bound for sampled gross custody.
- **Demonstrated unauthorized transferable amount: $0.**

Positive value-moving controls succeeded for V1 buy and sell, V2 sell, LP deposit and withdrawal, and `boost_buy_and_burn`. Real version-1 Project 0/marginfi flash-borrow/PumpSwap/repay compositions also succeeded against current mainnet state, including at 90% of the lender’s available WSOL. Every successful composition repaid the exact principal, left the lender liquidity vault unchanged, and produced no profitable residual. Creator-fee sweep and sell also succeeded in both instruction orders. Mutating authority, pool-vault binding, or CPI program consistently stopped the tested unauthorized path. Output-account aliasing succeeded for sell and withdrawal only while the legitimate input/LP owner remained the signer; it lets that signer donate or forgo their own proceeds and does not authorize an outsider to move the signer’s assets.

This is a no-findings result, not proof that the entire PumpSwap program is bug-free. The bounded gaps are listed below.

## Current deployed binary anchor

The program was dumped again from mainnet and compared byte-for-byte with the retained audit binary:

- SHA-256: `a8d05e6927cc6e861d3052a9bf2258ce3a4588f47307d53d0c20ecbe0b86697e`
- Size: 10,485,715 bytes
- Program-data account: `6naEzKeUuFh1Jeeu51NXQgr5qkXgXtc9WKNct4xynVJc`
- Upgrade authority: `7gZufwwAo17y5kg8FMyJy2phgpvv9RSdzWtdXiWHjFr8`
- Last deploy slot: 454596406
- Final metadata recheck slot: 457344181; `lastDeploySlot` was unchanged.

The official 38-instruction IDL was used to name positions and derive canonical PDAs. Simulation against the deployed binary, not the IDL, was the acceptance oracle.

## Positive controls

### V1 sell

Landed source transaction `ceXdCrgjTG3q3JpArMzNJwVuH3gERBhGTCjzhcEZmtKod1SJZESdaDhVMJx2ahC6raFuuss6xeuLaoyv6gHqemx` at slot 457343699 was replayed with `min_quote_amount_out = 0` and a 1,380,253-raw-unit base input.

Simulation succeeded. The clean snapshot delta was:

- user base: -1,380,253
- pool base: +1,380,253
- user quote: +1,432,422,504
- pool quote: -1,433,140,871

The quote difference is consistent with fee outputs not included in the five tracked balance snapshots.

### V2 sell

Landed source transaction `5GdyKN8Q3tTp7nVzqZehHfG8ViYD6q3kcuwyq1kThi8maWtFtZhuGqtQPu5Hwb7JFTDidBMMsW1mP19Bye9bCHfG` at slot 457343689 was replayed with a 100,000,000-raw-unit base input and zero minimum quote output. It succeeded and logged `Instruction: SellV2` plus the token transfer CPI.

### LP withdrawal

Pool `2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd`, LP mint `2oC6bUcK8A3JMryKBCUA9cwxNqGrkEK3cbebT2hWf2jU`, and an on-curve LP holder were used for a current-state control. Burning 342,654,721 raw LP units succeeded and produced exactly matched vault/user deltas:

- user base +6,668,822,601; pool base -6,668,822,601
- user quote +30,445,901; pool quote -30,445,901
- LP holder account -342,654,721

Two identical withdrawals in one transaction also succeeded, with exactly twice the LP burn and token movements.

### Boost buy-and-burn

Landed source transaction `dWqKMmSKdv1NwAeMFmBWJHbbHXe4nMVAm6Lhq7f1XdjdnYBBuEDXhutBDogevT14hmFgsUr7rtc7NihaQH3EXVD` at slot 457343210 supplied a current funded boost vault. A 100,000,000-raw-unit quote control succeeded:

- boost vault -100,000,000
- pool quote vault +100,000,000
- pool base vault -33,508,421,574, with a burn CPI

Duplicating the instruction in the same transaction succeeded: boost vault -200,000,000, pool quote +200,000,000, and two burns. This is expected sequential execution under the configured boost authority, not an outsider-controlled drain.

### Creator sweep / sell sequencing

For pool `DJsyGAVm8QUJQworMk4KKk8v37CY5U3dqTMunq8u4Lmw`, both `sweep_creator_fee -> sell` and `sell -> sweep_creator_fee` succeeded. The selected pool had no creator-fee value transferred to the tracked creator vault in those simulations, so this is an instruction-order control rather than a second positive fee-sweep amount. The parent tranche had already established the separate positive 0.893 SOL creator sweep and its outsider destination rejection, which was intentionally not duplicated here.

## Mutation results

| Surface | Mutation | Current-binary result | Interpretation |
|---|---|---|---|
| V1 sell | Replace `user` signer, keep original input token account | SPL Token error `0x4`, “owner does not match” | Outsider cannot spend the original user’s base account. |
| V1 sell | Alias quote destination to pool quote vault | Success with original user signer | Authorized signer can donate/forgo their own output; no outsider authority gained. |
| V1 sell | Alias pool base vault to user base account | `InvalidPoolBaseTokenAccount` (6014) | Pool/vault binding enforced. |
| V1 sell | Replace base token CPI program with System Program | `InvalidProgramId` (3008) | CPI program fixed. |
| V2 sell | Replace `user` signer, keep original accumulator/input | `ConstraintSeeds` on `user_volume_accumulator` (2006) | User/accumulator relation blocks substitution before value movement. |
| V2 sell | Alias quote destination to pool quote vault | Success with original user signer | Same authorized-donation behavior; not unauthorized value movement. |
| V2 sell | Alias pool base vault | `InvalidPoolBaseTokenAccount` (6014) | Pool/vault binding enforced. |
| V2 sell | Replace base token CPI program | `InvalidProgramId` (3008) | CPI program fixed. |
| Withdraw | Replace LP owner signer, keep original LP account | `ConstraintTokenOwner` (2015) | Outsider cannot burn the holder’s LP. |
| Withdraw | Alias base destination to pool base vault | Success with original LP owner signer | LP owner can burn LP while donating base back; no outsider benefit or authority. |
| Withdraw | Alias pool base vault to user base account | `InvalidPoolBaseTokenAccount` (6014) | Pool/vault binding enforced. |
| Withdraw | Replace token CPI program | `InvalidProgramId` (3008) | CPI program fixed. |
| Boost | Replace configured authority | `InvalidAdmin` (6005) | Boost authority enforced. |
| Boost | Alias pool quote destination to boost vault | `InvalidPoolQuoteTokenAccount` (6015) | Output is bound to the pool’s quote vault. |
| Boost | Alias boost vault to pool quote vault | `ConstraintTokenOwner` (2015) | Boost source authority binding enforced. |
| Boost | Replace quote token CPI program | `InvalidProgramId` (3008) | CPI program fixed. |

## Duplication, ordering, and transaction atomicity

The following same-transaction duplicates all succeeded under their valid authorities:

- V1 sell twice
- V2 sell twice
- withdrawal twice
- boost buy-and-burn twice

This showed that each second instruction consumed the first instruction’s updated state normally. It did not reveal stale-state reuse, double-credit, or a bypass of signer/vault constraints.

For V1 sell, V2 sell, withdrawal, boost, and creator-sweep/sell, a valid first instruction followed by an invalid authority-substituted second instruction returned a transaction-level `InstructionError` at index 1. Reversing the order failed at index 0. The RPC returned `null` post-account images for failed simulations, so this tranche did not independently compare rollback bytes; it did establish that the composed transaction is rejected as a whole, and no transaction was submitted.

## Atomic V1 flashloan stress against current mainnet state

This additional tranche constructed real version-1 Solana transactions from a landed Project 0/marginfi WSOL flashloan and a fresh landed PumpSwap buy. It used the real programs, banks, liquidity vault, pools, fee accounts, signers, and current on-chain account data. The transactions were unsigned and sent only to `simulateTransaction` with signature verification disabled. The retained JSON contains the exact wire bytes in base64, wire SHA-256, ordered account metas, instruction count, size, compute units, logs, inner instructions, input snapshots, returned account images, same-slot inferred pre-state, token deltas, LP-supply deltas, and constant-product reconciliation for every case.

The principal same-asset round trip was:

1. Borrow 1,000,000 raw WSOL from Project 0.
2. Sell 100,000 raw WSOL through PumpSwap.
3. Buy 90,000 raw WSOL back through PumpSwap.
4. Repay exactly 1,000,000 raw WSOL and end the flashloan.

It succeeded in a 1,494-byte, 35-address, 11-instruction V1 transaction using 264,594 compute units. The lender vault delta was exactly zero. The borrower’s prefunded WSOL account lost 10,000 raw units; its quote residual was 31,570,168 raw units. The pool gained 10,000 raw WSOL and lost 31,888,214 raw quote units; protocol and buyback fee accounts gained 159,024 and 159,022 raw quote units respectively, which exactly reconciles the quote flow. The pool product increased by 2,452,192,889,975,898,924. This is ordinary fee/slippage loss, not extraction. The exact transaction wire SHA-256 is `2ddf3829244f203a716c17fe64fc1ce466286cf6718f3ec7ab0b0580bf7d5826`.

### Loan and liquidity boundaries

- Project 0’s current WSOL liquidity vault exposed 11,208,583,873,143 raw units. Borrow/repay controls succeeded at 2 raw units and at 90%, 95%, and 99% of that amount; 1 raw unit failed `IllegalBalanceState` (6040), and available-minus-one failed `IllegalUtilizationRatio` (6026).
- A complete PumpSwap round trip while borrowing 90% of lender availability (10,087,725,485,828 raw WSOL) succeeded. It still repaid exactly and left the lender vault at net zero.
- A PumpSwap leg sized to 90% of the primary pool’s WSOL reserve and buying 80% back reached repay short and failed with SPL insufficient funds. Because the transaction failed, the displayed transfer-derived deltas are partial execution trace, not committed state; returned post-account images were null.
- A separately verified KLend USDC reserve currently decodes `flashLoanFeeSf = 0`. Its V1 control borrowed and repaid 7,789,632,497,552 raw USDC (99% of observed availability) in 531 bytes, 11 accounts, and 52,644 compute units, restoring supply with zero fee-vault delta. It was not substituted into the PumpSwap composition: the assigned PumpSwap pool is WSOL-base, so using that USDC reserve would require an exchange leg and would no longer be a same-asset isolation test. No assumption was made that other KLend reserves are fee-free.

### Dust, repetition, LP churn, and sync/update ordering

- On the primary pool, a 1-raw-WSOL sell succeeded; 2 raw units also succeeded. On an earlier pool, `buy_exact_quote_in_v2` from 1 through 1,048,576 raw WSOL failed deterministically with `ZeroBaseAmount` (6001), so it was not represented as a successful control.
- A verified thin pool with exactly 1 raw WSOL and 34,055 raw quote units accepted a flash-funded 1-raw-WSOL sell. It paid 16,975 raw quote to the user and 9 raw quote to fee accounts while the pool’s WSOL rose from 1 to 2. Attempting to buy 1 raw WSOL back then failed with SPL insufficient funds; the transaction rolled back. The successful one-way case consumed the user’s 1 raw WSOL and therefore did not establish value creation or an unpaid loan.
- One and two complete PumpSwap swap round trips succeeded. Four attempted cycles hit Solana `MaxInstructionTraceLengthExceeded` at top-level instruction 13 (1,809 bytes, 35 accounts, 17 top-level instructions, 560,488 compute units), before either the 4,096-byte or 64-address cap; 6, 8, and 10 cycles failed at the same trace-depth boundary.
- A sell followed by 1-raw-LP deposit, withdrawal, buy, and repay succeeded. Each deposit spent 1 raw WSOL plus 133 raw quote, minted 1 raw LP, and its withdrawal returned 132 raw quote, burned the LP, and returned no raw WSOL at that rounding scale. Two LP mint/burn cycles also succeeded with net LP supply delta zero; four and eight cycles hit `MaxInstructionTraceLengthExceeded`. The successful two-cycle case lost 2 additional raw WSOL and 2 raw quote, rather than extracting value.
- `SyncUserVolumeAccumulator` inserted before, between, and after the swap legs succeeded in a 1,545-byte, 35-address, 14-instruction transaction using 330,897 compute units. Its economic deltas matched the ordinary round trip; no stale-state or order-dependent credit appeared.

### Aliasing, ordering, and debt binding

- Aliasing the user quote account to the pool quote vault ended in SPL insufficient funds; aliasing the user base account to the pool base vault was rejected as `SelfTransferNotAllowed` (6087). Buying before selling also failed for insufficient quote balance. All were atomic failures.
- Repaying before the PumpSwap legs, and placing the PumpSwap legs before the flash borrow, both simulated successfully only because the test signer’s WSOL account was deliberately prefunded. These controls show that Project 0 binds the exact same principal to the authorized account but does not claim that unrelated instructions occurred inside a semantic “loan region.” Neither ordering made a profit.
- The Project 0 lender account, bank, liquidity vault, destination/repay source, borrower authority, and exact principal are recorded in the artifact. Successful cases show equal borrow and repay transfers and a zero lender-vault delta.

The residuals were independently priced through DexScreener’s read-only API. At its displayed spot price, the primary 31,570,168-raw-unit residual was worth an estimated 9,414 raw WSOL, versus the 10,000 raw WSOL spent: an estimated net loss of 586 raw WSOL units before considering executable slippage. The thin-pool 16,975-raw-unit residual rounded down to 0 raw WSOL and the provider reported zero USD liquidity. These are independent quote-service spot checks, not independent venues or executable quotes; both underlying pairs are the same PumpSwap pools. Jupiter executable-quote requests were also retained but returned explicit HTTP 429 rate-limit blockers in the final run.

## Cashback and unclosed coverage gaps

- A filtered `getProgramAccountsV2` pass paged through an explicit 20,000 current `UserVolumeAccumulator` accounts with `needs_claim = 1` and found no accumulator that both had nonzero `cashback_earned` and a funded canonical WSOL source vault. Therefore no positive `claim_cashback` value-moving control was available, and destination/duplication mutations were not promoted to evidence. A later repeat was rate-limited by the provider.
- The original 1,000-signature window did not yield a replayable buy, but the flashloan tranche later anchored a fresh landed legacy buy transaction, `3mA9WxvLEKSGuFF9TyHborMTuLbPRNHyBkfmZPykSiNpUp1YpTWs6pZqZzxahtGWXZbBQGpDp7nVrnLzkf1Cm1oC` at slot 457348633, and used it in successful bidirectional current-state compositions. A current V2-buy or multi-hop positive control remains unclosed.
- Deposit is now covered through successful one- and two-cycle LP mint/burn compositions. Larger repeats reached the runtime trace-depth limit before message-size or address-count limits.
- The 1,000-pool custody set is sampled, not a chain-wide pool enumeration. Unpriced balances remain outside the $111.82M lower bound.
- Failed simulations did not return post-account images, so rollback byte equality was not directly observed.

These gaps prevent an exhaustive assurance claim. They do not support a vulnerability claim without a positive unauthorized value transfer.

## Finding disposition

No candidate met the required bar. In particular, the successful destination aliases were reachable only with the real source/LP owner’s signature and harmed or redirected that signer’s own proceeds. Every outsider authority attempt failed before unauthorized transfer. No simulated path moved program-controlled funds to an unauthorized party.

## Evidence

- `pumpswap-final-probe.js` — compact V1/V2 sell, LP exit, creator-sweep ordering, mutation, duplication, and atomicity harness.
- `pumpswap-final-probe-results.json` — retained raw simulation summaries and account snapshots.
- `pumpswap-boost-refresh.js` — bounded live boost-control finder and mutation harness.
- `pumpswap-boost-refresh-results.json` — retained boost value deltas and rejection logs.
- `pumpswap-flashloan-v1.js` — exact V1 Project 0/PumpSwap atomic-composition harness, including dust, thin-pool, repetition, LP, sync, alias, order, and boundary cases.
- `pumpswap-flashloan-v1-results.json` — exact transaction wires, ordered accounts, sizes, compute, traces, snapshots, deltas, product/supply reconciliation, and residual quote evidence.
- `klend-jupiter-v1-extremes.json` — current-config zero-fee KLend USDC control and 99%-availability V1 borrow/repay evidence; retained as a blocked same-asset alternative rather than substituted into the WSOL PumpSwap path.
- `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/deployments/canvass/pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA.so` — deployed binary with the hash above.
- `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/amm-canvass/pumpswap-summary-10p.json` and `pumpswap-verified-10p.json` — sampled custody census.
- `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/repos/pump-public-docs/idl/pump_amm.json` — account/discriminator map used by the harnesses.
