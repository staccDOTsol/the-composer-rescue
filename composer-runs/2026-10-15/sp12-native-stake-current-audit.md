# SP12 native-stake current-binary audit

Date: 2026-10-15 (mainnet-beta)  
Target: `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY`  
Correct label: **SanctumSpl Stake Pool Program**, per [Sanctum's official deployed-programs page](https://learn.sanctum.so/docs/for-developers/deployed-programs). The separate multi-validator deployment is `SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn` (**SanctumSplMulti**). `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` is the official SPL deployment and is not the target.

## Result

**No demonstrated unauthorized native-stake or SOL value movement, accounting corruption, or profitable flash-loan path.** Current-binary simulations rejected missing/substituted signers, cross-pool lists/reserves, noncanonical stake sources, and native Stake-program substitution. Successful beneficiary redirection always retained the legitimate source authority's signature and is gift semantics, not an authorization bypass.

The one material assurance limit is provenance: the current SP12/SPMB ELF was pinned and tested directly, but no public Sanctum source revision or IDL can be cryptographically matched to that ELF. Published source is therefore used only as explanatory context; conclusions rely on live state, successful transactions, ELF evidence, and current mainnet simulation.

All probes were read-only RPC or `simulateTransaction` with `sigVerify:false`/replacement blockhash. **No transaction was submitted and no team was contacted.**

## Deployment pin and identity

| Program | ProgramData | Last deploy slot | Upgrade authority | Current ELF SHA-256 |
|---|---|---:|---|---|
| SanctumSpl `SP12…` | `Cn5fegqLh8Fmvffisr4Wk3LmuaUgMMzTFfEuidpZFsvV` | 371,704,212 | `47SND7bGKvNXrqfP1bjsLCbwTgZhFBzAgmZ42QSkRScz` | `a8571c781982c72c2531f5957aab7d902df35cb3c1ed0d34829f03f9f0166770` |
| SanctumSplMulti `SPMB…` | `HxBTMuB7cFBPVWVJjTi9iBF8MPd7mfY1QnrrWfLAySFd` | 371,704,232 | same | same |
| official SPL `SPoo…` | `EmiU8AQkB2sswTxVB6aCmsAJftoowZGGDXuytm6X65R3` | 429,882,117 | `dPpFfahSWhm5M2RB3nVaHsXfnh9ooz5bWtR3WeUguDH` | `ec2dfefaa70d560754a0000f39bd2cabc192b895d36205b3c428f601b6e1d7e1` |

Fresh dumps matched the pinned 1,080,464-byte files. SP12 and SPMB are byte-identical; SPoo differs at 209,472 byte positions. This establishes a shared SP12/SPMB runtime but does not collapse their PDA namespaces or state graphs.

The [public Sanctum source repository](https://github.com/igneous-labs/sanctum-spl-stake-pool) branch tips are `81f7e922a4cad340da8347a2ef244445d0cc3e26` (SP12, 2024-03-14) and `5fd31ede7629761d7c98b2358161cdc219e669fa` (SPMB, 2024-03-30). Their program sources differ only at `declare_id`, but they predate the October 2025 live deployment and enable `Redelegate`; the current ELF instead embeds `Instruction: Redelegate will not be enabled`. No matching release/build manifest was found. The ELF also embeds old upstream labels (`stake-pool-v1.0.0`, revision `b7dd8fee…`), which do not prove a Sanctum fork commit or toolchain.

## SP12 high-value authority derivation and exact custody

The full native Stake account census completed all 256/256 byte-prefix shards: 1,454,184 initialized/delegated accounts, context slots 457,338,864–457,342,564. The three requested groups contain distinct stake-account addresses, so gross custody is non-overlapping.

For every row, the live pool state is SP12-owned account type 1 and:

`withdraw_authority = find_program_address([stake_pool, "withdraw"], SP12)`

The derived bump equals the bump stored in pool state. A successful recent SP12 invocation independently confirms each account order.

| Pool state | Derived withdraw authority | Bump | Stake accounts | Gross custody at census | Successful reference |
|---|---|---:|---:|---:|---|
| `9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn` | `6727ZvQ2YEz8jky1Z9fqDFG5mYuAvC9G34o2MxwzmrUK` | 255 | 2 | 2,785,889.459632068 SOL | `3m1fHhPv…JGBgshX`, slot 457,331,268, direct SP12 |
| `2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa` | `3ndMuPC9Cz5VC4RJkpoPaZz6Px6eVXtRenw9Yi1o2xnA` | 255 | 2 | 2,390,369.486850748 SOL | `37v559Td…pKqQu9Ed`, slot 457,232,056, inner SP12 |
| `pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP` | `7cWNhDsHe1m36ttDkJVBgbee1hRFvPqWZT2iWaBAyYGW` | 255 | 2 | 1,936,942.047619021 SOL | `4UrUqq6w…tE7jyCCW`, slot 457,338,667, inner SP12 |
| **Non-overlapping total** |  |  | **6** | **7,113,200.994101837 SOL** |  |

At state slot 457,344,037 the corresponding `total_lamports` sum was 7,113,200.987253197 SOL. The 0.006848640 SOL difference is exactly three reserve Stake rent reserves (3 × 0.002282880 SOL), explaining rather than obscuring the gross/state relationship. The complete SP12 state inventory was 1,553 pools with aggregate recorded `total_lamports` 12,691,360.066520193 SOL.

The matching deposit PDAs are also exact `[pool, "deposit"]` derivations: `7PTvgk…7ZJt` (bump 254), `5qCzn6…TsVM` (251), and `E4RWxE…Xuv` (254).

## SPMB is a separate authority graph

SPMB has the same ELF but a different program address and therefore different PDAs. At slot 457,344,037 it had 56 pool states and 6,015,716.889451361 SOL in aggregate recorded `total_lamports`. A separate exact per-authority query found 6,034,747.129075525 SOL gross across all 56 authorities; all 56 stored/derived withdraw PDAs matched.

| SPMB pool | SPMB withdraw PDA | Gross authority custody | Accounts |
|---|---|---:|---:|
| `8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr` | `EMjuABxELpYWYEwjkKmQKBNCwdaFAy4QYAs6W9bDQDNw` | 5,242,876.649611240 SOL | 11 |
| `Bvbu55B991evqqhLtKcyTZjzQ4EQzRUwtf9T4CcpMmPL` | `5ugu8RogBq5ZdfGt4hKxKotRBkndiV1ndsqWCf7PBmST` | 316,771.890644716 SOL | 46 |
| `3aUmJDNpMHjkxunQEkHTj2chzyryKoH2uQj6YACLD174` | `tjbFnqBF8xwBbU7qg46mU5McehUVJLMU5gVryE25D9F` | 213,345.462360761 SOL | 2 |
| `hy1oDeVCVRDGkxS26qLVDvRhDpZGfWJ6w9AMvwMegwL` | `2C9aTiNL6VyrPhFKspZC8BY9JeL3j4RtkPP2e4PrVAwP` | 193,781.035006164 SOL | 8 |

These values are reported separately and are not included in the SP12 three-authority total or exit conclusions.

## Current successful controls

A 12,000-signature SP12 history scan found 10,854 successful transactions and 13,836 SP12 invocations. Relevant observed successes included 32 `DepositStake`, 61 `WithdrawStake`, 3,438 `UpdateValidatorListBalance`, 4,081 `UpdateStakePoolBalance`, 54 `IncreaseAdditionalValidatorStake`, 31 `DecreaseAdditionalValidatorStake`, 1,940 `DepositSol`, 1,042 `WithdrawSol`, and one each of SOL slippage variants 25/26. Thus the tested paths are active under the current deployment, not hypothetical ABI entries.

Current live-account simulations against pool `9mh…` supplied stronger controlled positives and mutations:

| Path | Positive control | Adversarial boundary/results |
|---|---|---|
| `DepositStake` | success; 120,511 CU; 3.148 SOL live delegated stake input; 2,580,451,882 raw pool tokens expected | exact min-out success; +1 → custom 39; missing/substituted signer → `MissingRequiredSignature`; wrong list 8, canonical validator stake 14, reserve 1; Stake CPI alias → `IncorrectProgramId`; deposit before authorize fails; duplicate same-tx input → `InvalidAccountData` |
| `WithdrawStake` | success; 67,447 CU; 1,000,000,000 raw pool tokens → 1,218,729,710 lamports | exact min-out success; +1 → 39; source signer substitution → 4; wrong list 8; wrong validator stake 14; cross-pool reserve source 11; Stake CPI alias → `IncorrectProgramId`; one raw token → 28; withdraw before approve → 4 |
| Updates | validator-list then pool-balance success; 16,948 CU | reversed order also succeeded because the list was already current this epoch; wrong list 8; wrong reserve 1; Stake CPI alias → `IncorrectProgramId`; wrong pair address logged expected/received and skipped that entry without mutating it, as designed |
| Rebalance `IncreaseAdditionalValidatorStake` | exact 1,000,000,000-lamport minimum success; 72,940 CU | minimum−1 → 12; exact live maximum 5,192,254,320 success; +1 → `InsufficientFunds`; staker substitution → 21; wrong list 8; wrong reserve 1; Stake CPI alias → `IncorrectProgramId`; update-before-and-after success, 107,187 CU |

Beneficiary substitution succeeded only when the genuine source/deposit authority still signed; it is an authorized transfer/gift. Same-transaction `update` interleavings around deposit and rebalance succeeded without breaking accounting. Transactions containing a later invalid reserve/source failed as a whole; failed simulation responses did not return post-account snapshots, so this report does not invent per-account deltas for them.

The ABI has no `Claim` instruction. No `Claim` variant exists in discriminants 0–26, and no case-insensitive whole-word `claim` was found in the public source or current SP12/SPMB/SPoo ELF strings. There is therefore no claim entrypoint to mutate.

### Runtime-enforced invariant summary

Live mutations demonstrate exact bindings for pool/list/reserve/mint/withdraw PDA, canonical validator stake source, required token/stake authority, native Stake program, and signer-gated staker operations. Slippage variants enforce exact minimum output. Minimum delegation, reserve liquidity, token burn/authority, and Stake rent boundaries were active.

Published source describes the same account ordering and checked math, but is not treated as binary proof. In particular: deposits merge the authorized incoming stake before deriving its actual lamport delta; withdrawals burn under the user's signer before split/reauthorize; updates are permissionless but bind all state and canonical account derivations; rebalances require the stored staker signer and preserve rent/minimum delegation. ABI discriminant 22 (`Redelegate`) remains parseable but is explicitly disabled by the live ELF.

## Atomic KLend v1 composition

The real current KLend wSOL reserve used was:

- reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM`
- market `C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV`
- supply vault `3SdrFTt4Ye5yppzpT9axNMj8W1x71nDYXdjv7vDuBpnR`
- fee vault `DW718KwF5d9URykynv8dcmHSQNXKTv7V5VxW5ozckbGS`
- mint `So11111111111111111111111111111111111111112` (wSOL)

Its decoded `flash_loan_fee_sf` is **exactly 0**. This is a configured zero fee, not a fee rounded to zero.

A real no-ALT Solana v1 message, constrained to 4,096 bytes/64 inline accounts, successfully simulated the atomic sequence:

`KLend borrow wSOL → close/unwrap → SP12 DepositSol → SP12 WithdrawSol → recreate/sync wSOL → KLend repay`

Standard funded control (1,000,000 lamports):

| Property | Exact value |
|---|---:|
| Serialized message | 1,028 bytes |
| Inline accounts / instructions | 23 / 10 |
| Compute | 138,356 CU |
| SP12 deposit mint | 949,034 raw pool units |
| SP12 withdrawal fee | 950 raw pool units (1/1000, ceiling) |
| SOL returned by SP12 | 998,998 lamports |
| KLend supply vault pre → post | 6,583,112,759,818 → 6,583,112,759,818 raw wSOL |
| KLend fee vault pre → post | 0 → 0 |
| User wSOL / pool-token post | 0 / 0 |
| SP12 reserve delta | +1,002 lamports |
| Pool mint-supply delta | +950 raw units |

Repayment equaled the borrow because KLend's configured rate was zero. The control was intentionally funded: the owner supplied the 1,002-lamport SP12 economic loss, so this is not a zero-capital profitable cycle.

Boundary and composition results:

- Bare KLend pairs succeeded for 1 lamport, 1,000,000 lamports, and available−1.
- The smallest SP12 round trip succeeded at 3 lamports; 2 lamports minted one pool unit, then failed custom 28 because the 1/1000 withdrawal fee ceilings to one unit and leaves nothing withdrawable. This is SP12 fee rounding, not KLend fee rounding.
- A near-liquidity borrow of 6,583,112,759,817 raw lamports with the SP12 leg succeeded and repaid exactly.
- Update interleavings and the SP12-leg-before-flash ordering succeeded within 1,084 bytes and 154,925 CU. Two repeated SP12 legs also succeeded at 1,076 bytes and 174,759 CU.
- Withdraw-before-deposit failed for insufficient funds; destination alias to the manager-fee account failed token owner validation.

No ordering, repetition, rounding, aliasing, or near-liquidity case produced unbacked pool tokens, unpaid KLend debt, or value to an unauthorized beneficiary.

## Evidence and reproduction

- [`long-tail-sp12-proof.json`](./long-tail-sp12-proof.json) — three PDA/state/reference proofs and full-census values
- [`native-stake-authority-census.json`](./native-stake-authority-census.json) — completed 256-shard Stake census
- [`sp12-state-authority-graph.json`](./sp12-state-authority-graph.json) — decoded SP12/SPMB pool graphs
- [`sanctum-splmulti-current-custody.json`](./sanctum-splmulti-current-custody.json) — separate SPMB exact authority queries
- [`sp12-source-evidence-20261015.json`](./sp12-source-evidence-20261015.json) — ProgramData/ELF/source provenance and ABI evidence
- [`sp12-successful-controls.json`](./sp12-successful-controls.json) — 12,000-signature live-history control census
- [`sp12-current-mutations.json`](./sp12-current-mutations.json) and [`sp12-current-mutations.js`](./sp12-current-mutations.js) — current-account mutation matrix/reproduction
- [`sp12-flash-klend-v1-summary.json`](./sp12-flash-klend-v1-summary.json), [`sp12-flash-klend-v1.json`](./sp12-flash-klend-v1.json), and [`sp12-flash-klend-v1.js`](./sp12-flash-klend-v1.js) — v1 atomic composition summary/full logs/reproduction
- [`sp12-current.so`](./sp12-current.so), [`spmb-current.so`](./spmb-current.so), and [`spoo-current.so`](./spoo-current.so) — pinned live ELF dumps

## Limits

Mainnet state is live and the multi-shard census is not an atomic single-slot snapshot; every number above is pinned to its recorded RPC context. Simulation proves current runtime acceptance/rejection and returned post-state for successful transactions, but it is not a live submission. Exact public source-to-ELF identity remains unverified. These limits do not weaken the concrete negative result: within the covered deposit, withdrawal, update, rebalance, CPI-substitution, ordering, rounding, and KLend-composition surfaces, no unauthorized value path was demonstrated.
