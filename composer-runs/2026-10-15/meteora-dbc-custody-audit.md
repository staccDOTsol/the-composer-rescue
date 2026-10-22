# Meteora Dynamic Bonding Curve — current-mainnet custody and adversarial audit

**Date:** 2026-10-15  
**Target:** Meteora Dynamic Bonding Curve (DBC) only  
**Program:** `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`  
**Result:** **No unauthorized value-moving path was confirmed.**  
**Live transactions submitted:** **0**

## Executive result

The current deployed DBC binary rejected every tested unauthorized fee claim and account-substitution path. Positive controls moved real simulated token value before each mutation. A zero-fee KLend USDC flashloan composed successfully with the current DBC binary in one real Solana v1 message at the 1-raw-unit boundary, the exact current KLend available-liquidity boundary, and repeated DBC buy/reverse-sell cycles. Every successful unprivileged cycle fully repaid the loan and ended with a **negative** USDC residual; no residual base tokens remained.

The highest-priority post-swap fee-claim hypothesis also failed: after flash-funded DBC swaps accrued a creator fee, replacing the authorized creator with the flash borrower failed at `access_control.rs:38` with `Unauthorized (6053)`, atomically rolling back the swaps and flashloan. An authorized creator control succeeded; repeating that authorized claim in the same transaction did not pay twice.

The finished v1 matrix contains **24 paths**: 21 outsider flashloan paths (15 successes, 6 expected failures), 2 creator-authorized controls, and 1 no-flash DBC control. No outsider success produced positive value. A follow-up search for the requested `DBC price move → independent consumer → reverse → repay` path found no usable current second consumer for the selected base mint: apparent HuT and Titan consumers were routers that CPI-called DBC for that token leg. No synthetic consumer or substitute venue was introduced.

No drain is reported. The evidence supports the deployed binary's signer, vault-binding, rounding, and atomic repayment controls for the tested paths.

## Exact deployed program

| Property | Current mainnet value |
|---|---|
| ProgramData | `HUfnSSiJxgspQm6C1rkqv6L3XgVtn7AESApgCQpCXCYh` |
| Upgrade authority | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` |
| Last deployed slot | `445503633` |
| Binary length | `2,326,577` bytes |
| SHA-256 | `4c26a8a5da99f8ce932fa0300c46675b527090021fbb74214c9486bedda9f23b` |
| Global pool authority PDA | `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` |

The binary was re-dumped from mainnet during this run. All decisive controls below executed with `simulateTransaction` against that deployed program. Official source commit `f552f20aa3c1c7631427c3827aeea7c58b902813` was used to explain behavior, but no claim is made that a local rebuild byte-matches the deployed ELF.

The source-level controls corresponding to the observed binary behavior are:

- partner fee claims: `lib.rs:104-125` calls `is_partner_fee_claimer`;
- creator fee claims: `lib.rs:179-201` calls `is_pool_creator`;
- those checks compare the supplied signer to state at `access_control.rs:25-39`;
- swaps bind `base_vault`, `quote_vault`, and `config` to pool state at `process_swap.rs:111-124`;
- token mint/program constraints are declared at `ix_swap.rs:35-56`.

## Live account and custody census

The program-owned census ran across confirmed slots **457,349,120–457,349,750**.

| Account class | Count |
|---|---:|
| `PoolConfig` | 547,822 |
| `VirtualPool` | 1,787,425 |
| `TransferHookPool` | 6,974 |
| Total pool accounts | **1,794,399** |
| Distinct configured quote mints | 1,647 |
| Priced pools | 1,784,923 |
| Unpriced pools | 2,502 |
| Pools whose config was absent from the compact config map | 6,974 |

Top quote mints by current config frequency were WSOL (483,957), USDC (46,418), EMBER (1,608), MET (1,338), and USD1 (1,306).

### Leading live quote vaults

Each row below was fetched from its token account after the pool census and verified for program ownership, pool PDA, quote-vault PDA, quote mint, and global pool-authority control. USD values use the independent contemporaneous price snapshot retained in `meteora-dbc-custody.json`.

| Rank | Pool | Quote | Raw balance | Approx. USD | Migrated | Controls |
|---:|---|---:|---:|---:|---:|---|
| 1 | `Hoeqaq74…fYju` | SOL | 1,392,185,148,400 | $147,435 | no | verified |
| 2 | `Bp2HLpCr…W7s3` | SOL | 418,862,372,716 | $44,358 | no | verified |
| 3 | `98eBsqyt…Dv6E` | SOL | 340,689,836,217 | $36,080 | no | verified |
| 4 | `RdyCFduk…wBTBP` | USDC | 32,635,918,706 | $32,623 | no | verified |
| 5 | `CwV5AxpR…wnJ2G` | SOL | 241,922,803,320 | $25,620 | no | verified |
| 6 | `4iV9XxvJ…9CNhG` | USDC | 24,081,533,617 | $24,072 | no | verified |
| 7 | `2tEsBd6h…yciH` | SOL | 204,661,621,361 | $21,674 | no | verified |
| 8 | `ESuZK6cB…eQup` | USDC | 18,652,299,320 | $18,645 | no | verified |
| 9 | `8CgsqBED…pXVx` | USDC | 16,929,236,925 | $16,923 | no | verified |
| 10 | `2HcQSmeS…6SCD` | SOL | 157,255,304,570 | $16,654 | no | verified |

This is a **quote-side** ranking, not protocol TVL: base-token vault value is excluded because most newly created base mints lack a reliable independent price. The candidate set is the union of the 250 largest priced virtual-book pools and 250 largest priced unmigrated pools; all returned token balances are live and verified, but the provider could not sort all 1.79 million vault token accounts by balance. A direct global token-program query was rejected because it expanded to 10,000,000 pubkeys. Synthetic `quote_reserve` totals are not presented as custody—migrated pools prove that virtual reserves can materially exceed their remaining token balance.

## Direct fee-claim controls

Pool `4Q67J3j7XBycUDs5GuvgHGnbcZ5koD9AoukA2cQGbxkK` had live partner fees of 279,902,722,585 base units and 45,853,583 quote lamports. The same receiver accounts and maximum amounts were used throughout.

| Case | Result | Value/state evidence |
|---|---|---|
| Authorized partner claimer | success | both fee fields became zero; base and quote receivers increased by the exact fee amounts |
| Signer-only mutation to unrelated swap payer | rejected `Unauthorized (6053)` | no post-state returned; transaction rolled back |
| Authorized same-mint wrong quote vault | rejected `ConstraintHasOne (2001)` | no state change |
| Two authorized claims in one transaction | success | receiver delta equaled one claim; second claim transferred zero |

This closes the apparent handler-local authorization concern: authorization is applied by the program entrypoint's `access_control` guard rather than inside the handler file.

## Atomic v1 flashloan composition

### Funding and target state

- KLend reserve: `AYL4LMc4aLbrov4PrvDTjXCWCniL1dxTUkZ1T2ss`
- asset: USDC (`EPj…Dt1v`)
- account-read slot: `457,349,837`
- decoded `liquidity.total_available_amount`: **8,033,161,134,261 raw USDC**
- decoded `flash_loan_fee_sf`: **0** — an actual zero configured rate, not a small fee rounded to zero
- fee vault before/after successful cases: **0 / 0**
- DBC pool: `ESuZK6cBK33eWC1cp9uwxRoxmfm5rHJ6Mzi6uyukeQup`
- pool status: canonical `VirtualPool`, `is_migrated = 0`
- original signer/fee payer: `FVWZsWaso2tzJHpxDbgmDUvrTAKmEti8JxcQ3wpgwnmR`

The standard successful message was 982 bytes, 22 inline accounts, 5 instructions, 1 required signer, and about 135k–136k CU. It stayed below the requested v1 limits (4,096 bytes, 64 inline addresses) without ALTs. The path was:

`KLend borrow → create base ATA idempotently → DBC exact-out buy → DBC exact-in reverse sell → KLend repay`

### Boundary and repetition results

| Case | Borrow | Result | Final unprivileged residual |
|---|---:|---|---|
| base output 1; flash 1 | 1 raw USDC | success, 135,496 CU | −2 raw USDC; base 0 |
| base output 2; flash 2 | 2 raw USDC | success | −2 raw USDC; base 0 |
| base output 10 | 10 raw USDC | success | −2 raw USDC; base 0 |
| base output 1,000 | 1 USDC flash | success | −2 raw USDC; base 0 |
| base output 10,000 | 1 USDC flash | success | −3 raw USDC; base 0 |
| three reverse round trips | 1 USDC flash | success, 1,158 bytes, 22 accounts, 260,837 CU | −9 raw USDC; base 0 |
| `available−1` | 8,033,161,134,260 | success | KLend supply restored; fee vault 0; −3 raw USDC |
| exact `available` | 8,033,161,134,261 | success | KLend supply restored; fee vault 0; −3 raw USDC |
| `available+1` | 8,033,161,134,262 | rejected `InsufficientLiquidity (6008)` | full rollback |
| exact-out `base_reserve−1` | near all pool base | rejected `AmountLeftIsNotZero (6047)` in DBC | full rollback |
| exact-out half base reserve, then reverse | large pool movement | swaps ran; repay failed SPL insufficient funds | full rollback; ordinary fee/slippage loss, not extraction |

Successful round trips restored the DBC base reserve/vault and the KLend token supply exactly. Quote-vault increases matched the borrower's negative USDC residual and creator-fee growth. No base-mint residual remained, so no separate token-price assumption was needed to decide profitability. The only nonzero unprivileged residual was negative USDC.

### Flash-induced fee claim and account mutation

| Mutation | Result |
|---|---|
| flash round trip → unrelated signer claims creator fee → repay | rejected `Unauthorized (6053)` at DBC instruction 4; atomic rollback |
| flash round trip → actual creator claims → repay | success; explicit privileged positive control only |
| same authorized creator claim repeated twice | success; identical payout to one claim, second paid zero |
| swap base/quote vault account order | rejected `ConstraintTokenMint (2014)` |
| alias user input to quote vault | rejected `ConstraintDuplicateMutableAccount (2040)` |

The authorized creator control increased the selected receiver from 1,109,081 to 1,299,423 raw USDC by claiming the pre-existing 190,343-unit creator fee plus the newly accrued fee, less the round-trip cost. It is not an exploit: it required the real pool creator to be marked signer. The unauthorized signer mutation failed before value moved.

No migration transition occurred in successful cases (`is_migrated` remained zero). DBC has no external oracle refresh/crank in this swap path; pricing and dynamic-fee state are internal to the pool/config and clock. Pre-migration DBC also has no LP mint/share supply to reconcile. Tick crossing and concentrated-liquidity arrays belong to distinct Meteora programs and were intentionally excluded.

### Outsider-only path count and complete accounting

The 24-case artifact separates unprivileged paths from privileged controls instead of treating an authorized fee withdrawal as an outsider result.

| Class | Paths | Success / fail | Complete successful-path accounting |
|---|---:|---:|---|
| Outsider, one DBC round trip, dust through 1,000 base raw | 5 | 5 / 0 | borrower USDC −2 each; borrower base 0; DBC base reserve/vault unchanged; quote vault +2, virtual quote reserve +1, creator quote fee +1; KLend supply restored exactly; KLend fee vault 0 |
| Outsider, one DBC round trip, 10,000 through 1,000,000 base raw plus 99%, `available−1`, and exact-`available` flash boundaries | 8 | 8 / 0 | borrower USDC −3 each; borrower base 0; DBC base reserve/vault unchanged; quote vault +3, virtual quote reserve +1, creator quote fee +2; KLend supply restored exactly; KLend fee vault 0 |
| Outsider, two DBC round trips | 1 | 1 / 0 | borrower USDC −6; borrower base 0; quote vault +6, virtual quote reserve +2, creator quote fee +4; DBC base and KLend supply restored exactly; KLend fee vault 0 |
| Outsider, three DBC round trips | 1 | 1 / 0 | borrower USDC −9; borrower base 0; quote vault +9, virtual quote reserve +3, creator quote fee +6; DBC base and KLend supply restored exactly; KLend fee vault 0 |
| Outsider negative/mutation paths | 6 | 0 / 6 | `available+1`, near-reserve exact-out, half-reserve round trip, unauthorized creator claim, wrong vault order, and quote-vault alias all failed atomically; no post-state committed |
| Actual-creator controls | 2 | 2 / 0 | privileged signer claimed the accrued/pre-existing creator fee; the duplicate second claim paid zero; excluded from outsider findings |
| DBC positive control without flash | 1 | 1 / 0 | borrower USDC −3; borrower base 0; pool accounting matched the corresponding flash-funded round trip |

Thus all 15 successful outsider flash paths conserved the tracked tokens: the borrower's USDC loss exactly equaled the selected DBC quote-vault gain, the borrower retained zero base, the DBC base vault equaled its starting value, and the KLend supply account equaled its starting value. The largest outsider message was the three-cycle case at **1,158 bytes, 22 inline accounts, 9 instructions, and 1 signer**, leaving substantial room under the requested 4,096-byte/64-inline-account envelope. Message capacity was not the limiting factor.

## Independent-consumer discovery

The requested second-consumer leg must consume the selected base token's DBC-induced price/state; an unrelated USDC venue would not do so. Read-only discovery produced:

- direct base-to-configured-quote route probes for the 100 leading verified live quote-vault pools: 0 currently tradable responses;
- the selected base mint `CkFm…moon`: 0 current DexScreener pairs;
- the selected pool's latest 100 confirmed transactions: DBC appeared in the inner-program set of all 100;
- programs that appeared to touch selected-base accounts outside DBC/token instructions: System (21), ATA (11), HuT (8), and Titan (1).

The System and ATA appearances were account creation/funding. Three sampled HuT/Titan transactions were then traced at CPI stack level. HuT logged multi-hop `dex:` routes whose selected-token hop was `MeteoraDBCV2`; Titan logged `SwapRouteV3` and directly invoked DBC. All three traces reached DBC for the selected base leg. They are routing layers, not independent price state from which a flash borrower could extract value after first moving DBC.

Accordingly, no honest `flash borrow → move DBC → independent consumer → reverse DBC → repay` transaction was available to construct for this selected current pre-migration asset. The concrete blocker was the absence of a discovered second live base-token venue/valuation consumer, not v1 message size. This is a bounded discovery result, not proof that no second consumer exists for any of the 1.79 million pool accounts; inventing one would have violated the exact-current-mainnet requirement.

## Hypotheses disposition

| Hypothesis | Disposition |
|---|---|
| Arbitrary partner fee claimer | disproved on current binary by positive/mutant pair |
| Arbitrary creator fee claimer after flash-induced accrual | disproved; `Unauthorized (6053)` and atomic rollback |
| Wrong-pool/wrong-vault substitution | disproved for tested same-mint, order, and alias variants |
| Same-transaction double fee claim | disproved; second authorized claim paid zero |
| Dust rounding creates borrower value | disproved; borrower lost 2–3 raw USDC and retained zero base |
| Repeated reverse swaps create value | disproved through three cycles; losses accumulated monotonically |
| Near-capacity flash bypass | disproved at exact boundary: `available` succeeds, `available+1` fails |
| Near-pool-reserve exact-out extraction | no success; DBC rejects the near-total request and the half-reserve route cannot repay |
| Flash movement plus migration-state change | not reached: tested pool remained below completion after successful reversible cases; near-total exact-out was rejected first |
| Flash movement plus independent price consumer | no usable current second consumer discovered for the selected base mint; observed HuT/Titan appearances routed the token leg back into DBC |

## Scope, exclusions, and limits

- In scope: the exact current DBC mainnet binary, current program-owned configs/pools, canonical pool/vault derivations, swaps, partner/creator trading-fee claims, account alias/order mutations, repeated atomic execution, and KLend-funded USDC composition.
- Explicitly out of scope: Meteora DAMM v1, DAMM v2, DLMM, Dynamic Vault, their LP/tick/bin state, and previously assigned OtterSec GoonFi work.
- No live transaction was signed or submitted. All value movement is from read-only current-mainnet simulation with signature verification disabled; signer bits and account privileges match the constructed messages.
- A signature-disabled authorized control proves program behavior, not possession of the privileged key. Findings were evaluated only from unprivileged mutations.
- Source commit behavior agrees with simulation, but reproducible ELF/source equivalence was not established.
- The census spans multiple confirmed slots and is not an atomic ledger snapshot.
- The 6,974 transfer-hook pools were counted, but the funded mutation matrix used a classic-SPL `VirtualPool`; transfer-hook remaining-account programs were not exhaustively composed.
- Protocol-fee operator claims were not value-tested on the selected pool because its protocol fee fields were zero; partner and creator authorization were directly tested on fee-bearing pools.
- Independent-consumer discovery covered direct route probes for 100 leading verified pools, one selected mint's current pair index, 100 recent selected-pool transactions, and three router traces; it was not an exhaustive consumer graph for every DBC pool.

## Reproduction artifacts

- `meteora-dbc-current.so` — exact dumped binary
- `meteora-dbc-custody.json` — census, pricing snapshot, and verified leading vaults
- `census-meteora-dbc-pools.js` — read-only full program-account census
- `meteora-dbc-recent-fee-pools.json` — recent live fee-bearing pool controls
- `meteora-dbc-partner-claim-simulations.json` — partner claim positive/mutant/alias/atomicity evidence
- `meteora-dbc-klend-v1-extremes.json` — v1 flash boundary, rounding, repetition, claim, and reconciliation evidence
- `meteora-dbc-klend-v1-extremes.js` — exact v1 message builder and simulator
- `meteora-dbc-independent-consumer-probe.json` — current route/pair probes and selected-pool 100-transaction program census
- `probe-meteora-dbc-independent-consumers.js` — read-only consumer-discovery script
- `meteora-dbc-independent-consumer-router-traces.json` — three CPI-level HuT/Titan traces resolving apparent consumers as DBC routers
- `trace-meteora-dbc-independent-consumers.js` — compact router-trace reproducer
- `meteora-dbc-source/` — official source snapshot at `f552f20…`

## Final assessment

**Validated vulnerabilities: 0.** Across 21 outsider flash paths, every success fully repaid principal and left only a negative borrower residual, while every unauthorized claim/vault/capacity mutation rolled back atomically. Authorized fee claims remain privileged controls, not outsider vulnerabilities. The main remaining assurance gaps are exhaustive independent-consumer discovery across all pools, exhaustive transfer-hook composition, protocol-operator claims on a fee-bearing pool, reproducible source-to-ELF matching, and a literal all-1.79M-vault balance sort.
