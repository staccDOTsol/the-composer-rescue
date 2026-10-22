# Save/Solend current-binary revalidation

Observed 2026-10-15 14:58–14:59 EDT. Target: `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo` on Solana mainnet-beta.

## Verdict

No reportable unauthorized value exit was reproduced. Two current-state value-moving positive controls succeeded, while all isolated fee-redemption and flash-loan mutations failed. No mutation produced an unauthorized token delta.

This is partial coverage, not a clean bill of health. A current successful liquidation could not be reconstructed from the sampled historical liquidation because its obligation now has zero borrows. Liquidation authority/destination/vault/CPI mutations were therefore not attributable and are not counted as protections. Gross custody is exposure context only, not exploitable value.

No live transaction was submitted. All dynamic tests used `simulateTransaction` with `sigVerify: false` and `replaceRecentBlockhash: true`; the remaining work was read-only RPC and local binary inspection.

## Deployment and custody anchor

- The program account was executable and owned by `BPFLoaderUpgradeab1e11111111111111111111111`.
- ProgramData: `DMCvGv1fS5rMcAvEDPDDBawPqbDRSzJh2Bo6qXCmgJkR`.
- Upgrade authority: `RY93CZYe5g6drtG7W9PmHRPzaBLZ1uwihTzayQTmJfh`.
- Last deploy slot: `350614570`.
- Current dumped ELF: 1,240,288 bytes, SHA-256 `0faf8e6f00291481fb5390439b1f8c8e77c85a9fafac603996f210c135de84db`.

At slot `457346046` (`2026-10-15T18:59:09Z`), the 619-byte reserve layout yielded 1,829 program-owned reserve accounts. Of their referenced supply vaults, 727 were nonzero and verified end to end: the vault existed, was SPL Token-owned, its mint matched the reserve, and its token authority equaled `findProgramAddress([lending_market], program_id)`.

- 599 verified nonzero vaults were priced.
- 128 verified nonzero vaults were unpriced.
- Priced gross custody: **$85,880,358.08**.
- Largest priced vaults were mSOL $27.52M, bSOL $24.14M, JitoSOL $9.34M, SOL $7.59M, and USDC $4.17M.

The exact census inputs and top-vault proofs are in [custody-evidence.json](save-current-revalidation/custody-evidence.json).

## Successful current-state controls

### Permissionless fee redemption

Source transaction `3uv5vHGZCzB48ZXmdxDimwFMeDxaF39pvZwhYhZ5kVq4hyY1ExnYa1g7oxu9fiuJ3zijLmcW2YzUm6a6YJ3HdDMu` (source slot `457329711`) replayed successfully at slot `457346250`.

The reserve supply `5PjYVwpt7mVmmRRgRWXCFG6SoehQevef4UCztfCxcGL2` decreased by 687 raw units and the configured fee receiver `Cpyk5WRGmdK2yFGTJCrmgyABPiNEF5eCyCMMZLxpdkXu` increased by 687. This is a real current-state value transfer and anchors the fee-account mutations below.

### Flash borrow and same-transaction repay

A current-state pair was synthesized from source transaction `2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA`: create the original WSOL ATA, borrow 1,000,000 raw WSOL, fund/sync 1,000,000 raw WSOL for fees, and repay in the same transaction. It succeeded at slot `457346254`.

Logs reached both `Flash Borrow Reserve Liquidity` and `Flash Repay Reserve Liquidity`; fee receiver `5wo1tFpi4HaVKnemqaXeQnBEpezrJXcXvuztYaPhvgC7` increased by 400 raw units. This is the current positive control for ordering, binding, CPI-program, and atomicity mutations.

## Isolated mutation results

| Surface | Mutation | Result |
|---|---|---|
| Fee destination binding | Replace configured fee receiver with reserve supply | Rejected, custom `0x0d`; zero token deltas |
| Fee supply binding | Replace reserve supply with fee receiver | Rejected, custom `0x0d`; zero token deltas |
| Fee CPI program | Replace SPL Token program with Save itself | Rejected, custom `0x09`; zero token deltas |
| Flash atomicity | Remove repay | Rejected at borrow, `No flash repay found`, custom `0x30`; zero token deltas |
| Flash order | Put repay before borrow | Rejected, `Supplied borrow instruction index is not a flash borrow`, custom `0x31`; zero token deltas |
| Flash replay/index | Point repay at instruction 7 instead of borrow at 6 | Rejected, index mismatch, custom `0x31`; zero token deltas |
| Flash account aliasing | Alias destination to reserve supply | Rejected, `supply cannot be used as destination`, custom `0x0d`; zero token deltas |
| Flash vault binding | Replace source supply with destination | Rejected, `supply must be used as source`, custom `0x0d`; zero token deltas |
| Flash CPI program | Replace SPL Token program with Save itself | Rejected, custom `0x09`; zero token deltas |

These cases rule out the tested fee/flash alternatives: a caller could not redirect fee redemption, substitute the reserve vault, alias the flash destination to the vault, substitute the CPI token program, omit repayment, reorder repayment, or point repayment at another instruction.

## Liquidation and replay limitation

The sampled flash → liquidation → flash-repay transaction succeeded historically at slot `457071342` on the same deployed binary. Its obligation `3WtJYJgHX2ZvMt2Q1ghAKVNx67gZyLg67R2RmTi5TwMm` now decodes to one deposit and zero borrows. An unchanged replay first failed refresh because the historical transaction supplied the reserve twice (once for the then-present borrow). After rebasing refresh to the current one-deposit/zero-borrow shape and removing stale assertion instructions, execution reached liquidation and rejected with `Obligation borrowed value is zero` / custom `0x24` at slot `457346261`.

Consequently, the attempted unsigned-authority, destination-alias, wrong-vault, and CPI-substitution liquidation variants all lacked a successful current-state liquidation control. Their failures are recorded, but they are not used to claim that those liquidation bindings are proven. The current borrow sample likewise failed because the obligation no longer had borrowing capacity, and the withdraw sample referenced a now-closed account; neither is treated as a current control.

## Flash-loan extreme and composition pass

### Required v1 envelope: concrete runtime blocker

The installed web3 client defines message v1, a 4,096-byte limit, and 64 inline accounts, but exposes deserialization only. I serialized the documented v1 wire format directly and sent it only to `simulateTransaction`.

- Every 22-account, 940-byte v1 case was rejected before execution with `invalid message version`.
- A 64-inline-account, 2,284-byte v1 control was rejected by the RPC's active `raw 1232` byte limit.
- Exact 4,096-byte and 4,097-byte, 64-account wires were both rejected by that same active 1,232-byte limit.

Thus the specified 4,096-byte/64-inline v1 transaction could not reach Save, KLend, or Project 0 on the available current-mainnet simulation runtime. It was not silently replaced or reported as a successful v1 test. Exact handcrafted wire/message lengths and RPC errors are in [flash-extremes-v1.json](save-current-revalidation/flash-extremes-v1.json).

### Supported-envelope fallback tests

I continued the target-side tests in the runtime's supported v0 envelope (22 inline accounts, 925–966 wire bytes):

| Case | Result |
|---|---|
| 1 and 2 raw WSOL | Rejected at repay as `Borrow amount is too small to receive liquidity after fees`, custom `0x19`; zero deltas |
| 3 raw WSOL | Smallest successful nonzero control; 111,462 CU; configured fee receiver gained 1 raw unit |
| 4–10, 100, 1,000, 2,497–2,501 raw | All succeeded; receiver gained 1 raw unit |
| 1,000,000 raw | Succeeded; 113,404 CU; receiver gained 400 raw units |
| Refresh reserve before / between / after borrow-repay | All succeeded; 130,701 / 131,740 / 132,909 CU in the recorded run; fee remained 400 raw |
| SPL Token self-transfer between borrow and repay | Succeeded; 115,547 CU; no extra net token delta |
| Two flash-borrow/repay pairs | Rejected at the second borrow: `Multiple flash borrows not allowed`, custom `0x33`; zero deltas |
| `available - 1` and exact available liquidity | Borrow was accepted; repay failed for insufficient fee funding, and the complete transaction rolled back with zero deltas |
| `available + 1` | Rejected at borrow as `Insufficient liquidity available`, custom `0x14`; zero deltas |

At the final observation the reserve's decoded available amount was `71,761,036,714,272` raw and the vault held `71,761,130,947,900` raw. The successful 1,000,000-raw control recorded an 860-byte message / 925-byte wire, 22 accounts, eight instructions, five inner-instruction groups, 69 non-truncated log lines, 113,404 CU, vault net delta zero, fee-receiver delta +400, and destination WSOL balance 999,600. There are no debt/share accounts in Save's flash instruction; the reserve state and tracked custody were included directly instead. Payer lamports decreased by 4,672,760, covering account setup and the explicit 1,000,000-lamport fee funding; complete principal repayment is evidenced by the zero supply-vault delta and successful flash-repay log.

The 3-raw result is not a zero-fee control: the receiver gained 1 raw unit. It is the exact minimum passing amount under this Save reserve's rounding and minimum-fee behavior.

### KLend / Project 0 funding feasibility

Current KLend configuration was decoded rather than inferred from dust behavior. WSOL reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` had `flashLoanFeeSf = 0` exactly and 6,583,112,759,818 raw liquidity. USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` also had an exact zero field. Counterexample WSOL reserve `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q` had nonzero `flashLoanFeeSf = 11529215046068`, confirming that fee-free status is reserve-specific. See [klend-zero-fee-evidence.json](save-current-revalidation/klend-zero-fee-evidence.json).

A same-mint zero-fee KLend source therefore exists, but the requested KLend-to-Save v1 composition was blocked at transaction deserialization/size enforcement before either program executed. Project 0 also had no current Marginfi account whose authority matched the Save control signer `2AWPXqsTmjo1pHBYCX9vmxzFBPqNH3LBQtmuTAUyWaAn` (2,312-byte account filter, authority offset 40). Changing signer and rebuilding every signer-owned setup/fee account would be a different unvalidated control, so no funded cross-provider success is claimed.

## Evidence and reproducibility

- [simulation-evidence.json](save-current-revalidation/simulation-evidence.json): exact slots, errors, filtered program logs, and token deltas.
- [control-samples.json](save-current-revalidation/control-samples.json): recent successful source transactions and compiled instruction/account indices.
- [run-mutations.js](save-current-revalidation/run-mutations.js): deterministic simulation and mutation harness.
- [custody-current.js](save-current-revalidation/custody-current.js): reserve/vault/PDA/price census.
- [find-controls.js](save-current-revalidation/find-controls.js): recent successful control discovery.
- [flash-extremes-v1.js](save-current-revalidation/flash-extremes-v1.js): v1 wire probe and supported-envelope extreme harness.
- [flash-extremes-v1.json](save-current-revalidation/flash-extremes-v1.json): exact message/wire/account/CU/log/pre-post evidence.
- [klend-zero-fee-evidence.json](save-current-revalidation/klend-zero-fee-evidence.json): current decoded KLend fee fields and same-mint candidate.

Final classification: **0 validated unauthorized exits; partial liquidation coverage; no vulnerability claim.**
