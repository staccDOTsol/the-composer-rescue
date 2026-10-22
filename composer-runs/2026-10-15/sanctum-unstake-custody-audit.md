# Sanctum Unstake custody audit — current deployed binary

Date: 2026-10-15 (America/Toronto)  
Target: `unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ`  
Scope: Sanctum Unstake SOL reserve, protocol-controlled pending stake accounts, LP accounting, unstake/reclaim exits, and the pool's flash-loan path. Sanctum INF is explicitly out of scope.

## Result

No novel, immediately executable fund-risk exploit was validated against the current deployed program at the sampled state.

The one live pool controlled **621,511.698929449 SOL**, worth approximately **$65,617,431.59** at the sampled SOL price of $105.577146. This is custody and prioritization evidence, not an exploitable-value claim. The tested wrong-authority, wrong-PDA, stale-record, duplicate-use, and same-transaction round-trip mutations did not produce unauthorized value movement.

Coverage is **partial rather than clean/exhaustive**. The deployed binary is not reproducibly matched to public source, all 29 pending stake accounts were still deactivating during the audit, and the pool's own flash-loan fee PDA was uninitialized. Those state constraints prevented a current positive reclaim and a successful **Sanctum-native** flash-loan control. Recent landed transactions supplied the positive reclaim control. Separately, a current, exactly zero-fee KLend WSOL reserve supplied a successful external flash-loan control and funded real atomic KLend→Sanctum→KLend v1 simulations through the full available 6,583.112759818 SOL. They repaid exactly and produced no unauthorized net gain. The epoch-bound add→reclaim→remove hypothesis remains deferred rather than validated.

No transaction was submitted. All newly constructed transactions used `simulateTransaction` with `sigVerify:false`; landed mainnet transactions were inspected read-only.

## Custody ranking and ownership proof

The census found exactly one account with the Anchor `Pool` discriminator owned by the target program:

| Component | Address / count | Lamports | SOL | Why it is protocol custody |
|---|---:|---:|---:|---|
| System-owned reserve PDA | `3rBnnH9TTgd3xwu48rnzGsaQkSr1hR64nY71DrDt6VrQ` | 620,585,846,611,158 | 620,585.846611158 | Canonical PDA derived from `[pool]`; it is the LP mint authority and signs program transfers. |
| Pending Stake Program accounts | 29 | 925,831,104,211 | 925.831104211 | Every account's staker and withdrawer authorities equal the reserve PDA. |
| Stake-record rent returned to the pool | 29 records | 21,214,080 | 0.021214080 | Each record has 731,520 lamports; live LP withdrawal valuation includes this aggregate field. |
| **LP-accounted total** |  | **621,511,698,929,449** | **621,511.698929449** | Reserve + controlled stake principal + reclaimable record rent. |

At the census snapshot, the pool's recorded incoming stake, the sum of the 29 record principals, and the 29 current stake-account balances all equalled 925,831,104,211 lamports. Thus the unrecognized current reward delta was zero.

The LP mint `uns3MbshJq1TmTyTF2iitMduevPktNKbePD73Wx4jQK` had 562,857,680,511,148 raw units outstanding and mint authority equal to the reserve PDA. LP supply is a claim on the assets above and was not double-counted as custody. User-owned stake accounts, unrelated Sanctum stake-pool holdings, and all Sanctum INF controller holdings were excluded.

The USD estimate uses the DefiLlama `coingecko:solana` observation embedded in [sanctum-unstake-custody-live.json](./sanctum-unstake-custody-live.json): $105.57714634765827/SOL, timestamp 1792089904, confidence 0.99. The pool-state, fee-account, mint, and protocol-fee rent balances are not included because the live LP valuation probe did not attribute them to withdrawable LP value.

## Current-binary identity and source limitation

The live executable was downloaded from ProgramData and retained as [sanctum-unstake-current.so](./sanctum-unstake-current.so).

| Property | Observed value |
|---|---|
| ProgramData | `9Bs1PKmHfKQ57pTUDJZ9pG22tkRLuaeyfAGp5GxRuZkW` |
| Deployment slot | 220,337,978 |
| Upgrade authority | `47SND7bGKvNXrqfP1bjsLCbwTgZhFBzAgmZ42QSkRScz` |
| ProgramData payload | 852,640 bytes |
| Payload SHA-256 | `ec9e18d779372a96dbc9a1de5ba2a55244b721508aa8339c212ccb73a0cb3140` |

The [official repository](https://github.com/igneous-labs/sanctum-unstake-program) identifies commit [`11aac05b22794e6c2c3366dbb7141f4c61845c24`](https://github.com/igneous-labs/sanctum-unstake-program/tree/11aac05b22794e6c2c3366dbb7141f4c61845c24) as the current mainnet deploy, but it is not byte-for-byte/current-layout evidence:

- the public commit's `Pool` serializes to 80 bytes; the live pool is 88 bytes;
- the live trailing `u64` was 21,214,080 and increased by exactly 731,520 in a successful simulated unstake;
- the live binary contains `programs/unstake/src/instructions/deprecated/migrate_pool.rs` and `Instruction: Migrate`, which are absent from that commit; and
- [Otter Verify](https://verify.osec.io/status/unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ) reported the on-chain program as unverified during the audit.

Accordingly, public source was used only to form test hypotheses and interpret account roles. Current RPC state, the downloaded binary, current-binary simulation, and landed current-binary history are the authoritative evidence here. A reproducible current-source build or complete binary reverse engineering was not available.

## Positive controls and mutations

Full logs and post-account snapshots are in [sanctum-unstake-simulations.json](./sanctum-unstake-simulations.json). The replay generator is [sanctum_unstake_simulate.js](./sanctum_unstake_simulate.js).

| Test | Current result | Security meaning |
|---|---|---|
| Remove 1,000,000 raw LP | Success; reserve −1,104,207 lamports; recipient net +1,099,207 after the 5,000-lamport transaction fee | Positive value-moving remove control. |
| Remove 900,000,000 raw LP | Success; reserve −993,786,792 lamports | Exactly matches valuation including the live 21,214,080-lamport trailing field; formula excluding it predicts 993,786,758. |
| Wrong LP authority | SPL Token error 4, owner mismatch | Attacker cannot burn another holder's LP. |
| Wrong/aliased reserve | Anchor 2006, `ConstraintSeeds` | Reserve substitution is rejected. |
| Add 10,000,000 lamports, then remove all minted LP atomically | Success; owner net −5,001; reserve +1; supply and token balance unchanged | Same-transaction round trip loses the transaction fee plus one lamport of rounding; no extraction. |
| Create initialized 11,666,240-lamport stake, then Unstake | Success; user payout 11,653,200; fee 13,040; stake authorities changed to reserve; record created | Positive current-binary unstake control. It also proved both live pool counters update. |
| Wrong unstake authority | Stake Program `MissingRequiredSignature` | Cannot seize an unrelated initialized stake account. |
| Wrong unstake reserve | Anchor 2006 | Canonical reserve binding holds. |
| Record PDA for another stake | Anchor 2006 | Stake/record substitution is rejected. |
| Duplicate Unstake of the same new stake in one transaction | Second use fails because the canonical record is already allocated; whole transaction rolls back | No partial first-leg state survives. |
| Reclaim using another live stake's record | Anchor 2006 | Stake/record binding holds. |
| Reclaim an already closed historical stake/record | Anchor 3012, `AccountNotInitialized` | Stale replay is rejected. |
| Take 1,000,000-lamport Sanctum-native flash loan then canonical Repay | Take leg executes; Repay fails Anchor 3012 because the flash-fee PDA is absent; whole transaction rolls back | Sanctum's own flash surface is inactive for this pool at the sampled state; this does not prevent external atomic funding. |

All 29 controlled stake accounts were deactivating in epoch 1058 during the final simulation snapshot (slot 457345570). Therefore, a positive current `ReclaimStakeAccount`, duplicate reclaim, and atomic add→reclaim→remove transaction could not be executed at that moment.

## External zero-fee KLend WSOL v1 stress test

The complete retained artifact is [sanctum-klend-flash-extremes-v1.json](./sanctum-klend-flash-extremes-v1.json); the reproducible read-only harness is [sanctum-klend-flash-extremes-v1.js](./sanctum-klend-flash-extremes-v1.js). Every successful funded case was one real atomic Solana v1 wire transaction simulated at current mainnet state with `sigVerify:false`; none was submitted. The artifact retains each wire as base64, its SHA-256, ordered inline account list, header, message size, configured and consumed compute, loaded-account bytes, full logs and inner-instruction trace, and requested pre/post account images.

At slot 457350925, the selected KLend WSOL reserve was:

| Field | Current decoded value |
|---|---|
| Reserve | `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` |
| Lending market | `C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV` |
| Supply vault | `3SdrFTt4Ye5yppzpT9axNMj8W1x71nDYXdjv7vDuBpnR` |
| Fee vault | `DW718KwF5d9URykynv8dcmHSQNXKTv7V5VxW5ozckbGS` |
| Available WSOL | 6,583,112,759,818 raw = 6,583.112759818 SOL |
| `flash_loan_fee_sf` | **0 exactly**; this is the decoded configured rate, not a small fee rounded to zero |
| Status | 0, active |

The successful cross-program path was KLend WSOL borrow → transfer into a temporary native-mint token account → close it to unwrap into native SOL → Sanctum AddLiquidity/RemoveLiquidity → transfer the exact principal back into the existing WSOL account and `SyncNative` → KLend repay. This same-asset conversion is necessary: sending borrowed WSOL directly to Sanctum's native-SOL AddLiquidity failed at instruction 1 because the signer had only 0.191650443 native SOL available for a 1 SOL transfer. That was a representation blocker, not a protocol substitution; the tested target remained the real Sanctum program.

All v1 wires had the 4,096-byte and 64-inline-account limits enforced, no address lookup tables, a 1,400,000-CU limit, and a 67,108,864-byte loaded-account-data limit.

| Stress case | Wire / runtime result | Accounting result |
|---|---|---|
| Positive KLend pair, 1 raw WSOL | 531 bytes, 11 accounts, 2 instructions; success | Exact repayment; KLend supply, fee vault, and decoded available liquidity each Δ0. |
| Available−1 and exact available pairs | Both succeed; exact 6,583.112759818 SOL consumes about 55k CU | Exact repayment; available+1 fails KLend 6008 `InsufficientLiquidity`. |
| Smallest Sanctum composition | 1 raw lamport fails Sanctum 6009 `LiquidityToAddTooLittle`; 2 raw succeeds and mints the minimum 1 raw LP | Exact repayment; round trip leaves Sanctum reserve +1 lamport and LP supply/user LP Δ0. |
| 1 SOL round trip | 1,053 bytes, 19 accounts, 10 instructions; 117,622 CU in the retained run | Exact repayment; adjusted signer net −10,001 lamports, reserve +1, LP supply/user LP Δ0. |
| Exact available 6,583.112759818 SOL through Sanctum | 1,053 bytes, 19 accounts, 10 instructions; success at 118,926 CU | Same deltas as the 1 SOL case; no scale-dependent extraction. |
| Exact v1 maxima | **4,096 bytes, 64 inline accounts**, 11 instructions; success at 675,543 CU; wire SHA-256 `817631fe7a4d027c5b79a1c66d5aed19c5a7a9453c1f5be5db9b81a5b35c8ebf` | Exact repayment; adjusted signer net −10,001, Sanctum reserve +1, LP supply/user LP Δ0. A no-op memo filled the byte boundary and unique read-only remaining accounts filled the account boundary. |
| Format boundary mutations | 4,097 bytes rejected by the encoder; 65 inline accounts rejected by the encoder | First format blockers are the specified v1 limits; neither invalid wire was sent to RPC. |
| Repeated Sanctum round trips | 2/4/6/8/9 cycles succeed; 9 cycles are 1,509 bytes, 26 instructions, 583,118 CU | Exact repayment; adjusted signer net is transaction fees plus exactly one lost lamport per cycle (−10,009 at 9); reserve gains the same 9 lamports. |
| First repeated-path failure | 10 cycles, 1,566 bytes, 28 instructions, 615,073 CU | Fails at top-level instruction 24 with `MaxInstructionTraceLengthExceeded`; the atomic transaction does not reach repay and all mutations roll back. |
| Wrong Sanctum reserve alias | Sanctum 2006 `ConstraintSeeds` | Whole transaction fails atomically. |
| Repay before re-wrap | SPL Token insufficient funds | Whole transaction fails atomically. |
| Wrong KLend repay index | KLend 6033 `InvalidFlashRepay` | Whole transaction fails atomically. |
| 2/4/8 flash borrow/repay pairs in one transaction | First borrow fails KLend 6035 `MultipleFlashBorrows` | Repetition cannot bypass KLend's single-borrow invariant. |

The simulated owner WSOL account had a pre-existing stale token amount: 4,078,560 lamports in the account, a current 1,488,440-lamport rent reserve, but only 2,039,280 raw WSOL recorded. `SyncNative` therefore surfaced 550,840 raw WSOL without changing account lamports. An isolated `SyncNative`-only control produced exactly the same +550,840 token delta and no flash interaction. The report's adjusted signer net subtracts this pre-existing normalization; it is not flash-loan profit and cannot be attributed to Sanctum. Across successful compositions, KLend supply, its fee vault, and decoded reserve availability returned exactly to baseline, so the stateless flash debt was repaid with no residual obligation.

Sanctum exposes no permissionless refresh/crank/update instruction relevant to this path. Consequently there was no state-refresh permutation to front-run or reorder; current account state was read immediately before each simulation.

## Landed transaction controls

The program-history scan covered 8,000 successful transactions over 80 signature pages and identified 6,885 deactivations, 5,834 SOL unstakes, 1,053 WSOL unstakes, and 6,961 reclaim instructions. The separate LP-mint history covered all 46 returned transactions: 27 adds, 15 removes, and one older create-pool discriminator.

Representative landed controls against the current deployment include:

- Unstake: [`5m3ympUk…`](https://solscan.io/tx/5m3ympUk7TNB85K1jxcjLyWGVrWFasn8Aw2RjEtYcJqVsR7cZQP4Nv6k5CFfjkx62hpapajaMt9AvNbD8xJ566Bm), slot 457284819.
- Unstake WSOL: [`37jq4MD…`](https://solscan.io/tx/37jq4MD12QnGeCa7YGNyRXsEXKNfRRDFwiWJnbnEvLmctnpCtTQfazxQio2GyK4JFYJC72NgwhW6KAU4Mn9VLQ4d), slot 457165345.
- Reclaim: [`5EPaLam…`](https://solscan.io/tx/5EPaLam9KzFfCyjJLnnMChqxskYJjYTTzss9ekkpmjTUNupPQv6gD7vSkyqrRTq6B1sFPcvwHmozr6JhUpsRdz2k), slot 457113032.
- Add liquidity: [`5ZoyGeX…`](https://solscan.io/tx/5ZoyGeXQyHLKChWgfy9Cqcg6oZGdC15SEyVBGktTdVUes1JuC8wnfmZN7nrX3m2E6BUeNTWF1J7dAczF32ojyCvX), slot 397681820.
- Remove liquidity: [`27nkg7v…`](https://solscan.io/tx/27nkg7vJKy2SV7Rua3LppND29HRkbydneYLccvghpUBCegcnPRqkS1vCigmg6jedBhoURkETDJhzbZy65yMuY6Mp), slot 397682486.

Raw decoded history is in [sanctum-unstake-history.json](./sanctum-unstake-history.json) and [sanctum-unstake-lp-mint-history.json](./sanctum-unstake-lp-mint-history.json).

## Deferred economic timing hypothesis — not a validated exploit

The landed reclaim transaction above reclaimed eight stake accounts whose actual balances exceeded recorded principal by a combined **6,691,791 lamports**. Before reclaim, pending stake is represented in pool valuation at recorded principal; reclaim moves actual lamports to the reserve. Therefore an LP joining immediately before permissionless reclaim and exiting immediately after could, in principle, receive approximately:

`reward_delta × attacker_liquidity / (pool_value + attacker_liquidity)`

This is an epoch-bound LP-dilution/MEV hypothesis, not a validated current exploit:

- current reward delta was zero at the census;
- no controlled stake was yet inactive, so the complete atomic sequence could not be simulated;
- the historical eight-account delta was only 0.006691791 SOL (about $0.71 at the sampled price);
- even 1,000 SOL of temporary capital would capture only about 0.00001075 SOL (about $0.0011) from that historical-sized delta, before fees and capital costs; and
- flash liquidity from this pool is unavailable because its flash-fee PDA is not initialized.

The hypothesis should be retested at the first slot where a controlled stake is inactive and `current_lamports > record.lamports_at_creation`, using add→reclaim→remove in one simulation. Until then it is a follow-up item, not a reportable fund-risk finding.

## Exact coverage and blockers

Covered:

- live program/ProgramData identity, deployment metadata, upgrade authority, and retained executable hash;
- full live `Pool`-discriminator census for the target program;
- reserve, LP mint authority/supply, fee, flash, flash-fee, and protocol-fee PDA derivation/existence;
- full memcmp census of Stake Program accounts whose withdraw authority is the reserve, with independent staker/withdrawer decoding and record-PDA matching;
- custody pricing and non-double-counting of LP claims, user stake, and Sanctum INF;
- positive Unstake and RemoveLiquidity current simulations;
- landed AddLiquidity, RemoveLiquidity, Unstake, UnstakeWSOL, and Reclaim controls;
- wrong authority, wrong reserve, wrong record, stale replay, duplicate same-transaction use, add/remove atomicity, large-withdraw valuation, and inactive flash-loan rollback;
- current KLend WSOL reserve decoding with an exactly zero configured flash fee, positive borrow/repay controls from 1 raw unit through exact available liquidity, and available+1 rejection;
- real atomic v1 KLend→WSOL unwrap→Sanctum Add/Remove→WSOL re-wrap→KLend repayment at smallest, 1 SOL, exact available, repeated, ordering, aliasing, and cross-program same-asset variants;
- exact successful 4,096-byte/64-inline-account boundary, 4,097-byte and 65-account local rejections, and the first repeated-path runtime blocker between 9 and 10 round trips;
- pre/post KLend supply/fee/reserve-availability, Sanctum reserve/LP supply/user LP, owner SOL/WSOL, compute, loaded data, message hash/base64, and full trace capture;
- source-assisted review of Add/Remove, Unstake, Deactivate/Reclaim, flash repayment, fee/protocol-fee flow, PDA constraints, and arithmetic surfaces.

Blocked or deferred:

- exact source-to-binary equivalence: public source demonstrably differs from the deployed layout and instruction set;
- full decompilation/reverse engineering of all 746,433 trimmed executable bytes;
- a current positive Reclaim simulation and duplicate-Reclaim atomicity test: all 29 controlled stakes were deactivating, not inactive;
- a complete add→positive-delta reclaim→remove validation of the reward-timing hypothesis;
- a successful **Sanctum-native** flash-loan positive control: the canonical flash-loan-fee PDA `6pf1eJA1C97znNC1m12qFGTWoq4KCQXJKrvzksFWmd2D` did not exist; current external zero-fee KLend funding was tested successfully instead, without treating it as a substitute for the inactive native instruction;
- creation of a new sealed managed-scan artifact for the external-flash extension: two start attempts failed before allocating a scan ID with `The selected scan target changed while the scan was starting. Try again.` because the shared campaign directory was changing; the direct current-state v1 simulations and artifacts above completed independently;
- exhaustive admin-authority mutation tests and every possible remaining-account/referrer permutation;
- future upgrades by the live upgrade authority and state changes after the recorded slots.

These limitations mean “no validated exploit in tested current state,” not “the program is proven secure.”
