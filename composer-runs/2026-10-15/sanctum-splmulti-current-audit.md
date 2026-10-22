# Sanctum SPL Multi current-mainnet audit

Date: 2026-10-15 (America/Toronto)  
Target only: `SanctumSplMulti` `SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn`  
Excluded as targets: SanctumSpl `SP12…`, canonical SPL Stake Pool `SPoo1…`, Sanctum INF, and Sanctum Unstake. KLend appears only as a read-only flash-liquidity composition leg.

## Result

**No unauthorized net value movement was reproduced in the deployed SPMB binary.** Positive controls moved value only after the pool-token owner/funding signer authorized the corresponding burn or SOL transfer. Mutated signer, transfer authority, withdraw PDA, validator list, reserve, Stake CPI program, source/destination order, and flash-repay order either failed atomically or were explicit authorized redirections. Custody size and off-curve ownership are not classified as a drain.

The tested JupSOL pool charges a configured 0.1% SOL/stake withdrawal fee. Successful deposit/withdraw loops therefore leave value in pool custody and mint fee shares to the manager. Those expected economics are not an exploit. The separate KLend WSOL reserve used for funding had `flash_loan_fee_sf = 0` exactly; this is a decoded configuration value, not a small fee rounding to zero.

All active tests were `simulateTransaction` with `sigVerify:false` and `replaceRecentBlockhash:true`. No transaction was signed or submitted, and no team was contacted.

## 1. Current pool-owned state and gross native custody

At pool-state slot **457,345,342** (epoch 1058), SPMB owned 56 decodable pool states. All 56 stored withdraw bumps reproduced the PDA `find_program_address([stake_pool, "withdraw"], SPMB)`. Per-authority Stake-program queries at slots **457,345,351–457,346,031** returned:

| Measure | Current result |
|---|---:|
| Pools / verified withdraw PDAs | 56 / 56 |
| Native Stake accounts under those PDAs | 247 |
| Delegated validator/transient accounts | 191 |
| Initialized reserve accounts | 56 |
| Gross lamports in all 247 accounts | 6,034,747.129075525 SOL |
| Sum of pool-state `total_lamports` | 6,015,716.889451361 SOL |
| Of gross, reserve Stake accounts | 1,021.368883112 SOL |
| Gross minus stored state | 19,030.239624164 SOL |
| Pools updated in current epoch | 43 / 56 |

Largest withdraw-authority groups:

| Pool mint | Pool | Gross Stake-owned SOL | Stored-state SOL | Reserve SOL |
|---|---|---:|---:|---:|
| `jupSoL…` | `8VpRh…` | 5,242,876.649611240 | 5,229,445.574761253 | 12.428227154 |
| `DEF1…` | `Bvbu55…` | 316,771.890644716 | 311,368.673713209 | 10.940301979 |
| `BULK…` | `3aUm…` | 213,345.462360761 | 213,345.460077881 | 50.458825003 |
| `hy1oXY…` | `hy1oDe…` | 193,781.035006164 | 193,734.883745981 | 785.753518270 |
| `phaseZ…` | `phasej…` | 30,147.800313590 | 30,002.233945691 | 86.131699596 |
| `yLdBr…` | `6BBtp…` | 17,508.867803727 | 17,508.865520847 | 14.609687498 |

Caveats:

- The 1,021.368883112 SOL reserve subtotal is already inside the 6,034,747.129075525 SOL gross total; adding it again double-counts.
- Pool state and each withdraw-authority query were observed at different slots. The 19,030.239624164 SOL difference is not a coherent-slot profit/loss measure. It includes epoch/update timing and stake rewards; 13 pools were not current-epoch in the pool-state snapshot.
- A separate completed 256-shard native-Stake census (slots 457,345,236–457,347,694, zero retention threshold) independently joined the same 56 PDAs, 247 accounts, and exact gross lamports.
- Pool-token balances held by INF, controllers, vaults, or users are claims on this same native custody. They must not be added as separate underlying SOL. No Stake account matched two SPMB withdraw PDAs, but economic wrapper overlap can still exist above this layer.

Evidence: [current custody JSON](./sanctum-splmulti-current-custody.json), [complete native-Stake cross-check](./sanctum-spl-multi-live-stake-custody-complete.json), [census code](./sanctum-splmulti-current-custody.js).

## 2. Current ProgramData, ELF, and source pin

Rechecked at the end of the run:

| Field | Value |
|---|---|
| Program | `SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData | `HxBTMuB7cFBPVWVJjTi9iBF8MPd7mfY1QnrrWfLAySFd` |
| Upgrade authority | `47SND7bGKvNXrqfP1bjsLCbwTgZhFBzAgmZ42QSkRScz` |
| Last deployed slot | 371,704,232 |
| Program account data length | 1,080,464 bytes |
| Dumped ELF SHA-256 | `a8571c781982c72c2531f5957aab7d902df35cb3c1ed0d34829f03f9f0166770` |

The current ELF's embedded `security.txt` identifies `stake-pool-v1.0.0` and upstream source revision [`b7dd8fee93815b486fce98d3d43d1d0934980226`](https://github.com/solana-labs/solana-program-library/commit/b7dd8fee93815b486fce98d3d43d1d0934980226), “stake-pool: Upgrade to version 1.0.0 to tag release.” The official Sanctum SPM deployment branch is pinned locally and remotely at [`5fd31ede7629761d7c98b2358161cdc219e669fa`](https://github.com/igneous-labs/sanctum-spl-stake-pool/commit/5fd31ede7629761d7c98b2358161cdc219e669fa), dated 2024-03-30. Relative to the embedded upstream base, the relevant on-chain source changes are the SPMB program ID and ceiling fee application in `state.rs`; processor value-flow logic is otherwise identical. Current tiny-withdraw simulations exhibit that ceiling behavior.

The dumped ELF is byte-identical to `sanctum-inf-source/test-fixtures/programs/stake-pools/sanctum-spl-multi.so`, which provides an independent repository fixture match. This is strong provenance, but not claimed as a reproducible-build proof: a local `cargo build-sbf` attempt stopped in dependency `ahash` at `src/lib.rs:33` with `E0635: unknown feature stdsimd`, before emitting an ELF. The embedded revision is the upstream base identity, while `5fd31e…` is the SPM-specific fork pin.

Sources: [dumped ELF](./sanctum-splmulti-current.so), [pinned SPM source tree](./sanctum-splmulti-source/), [processor controls](./sanctum-splmulti-source/stake-pool/program/src/processor.rs), [fee math](./sanctum-splmulti-source/stake-pool/program/src/state.rs), [official deployed-program list](https://learn.sanctum.so/docs/for-developers/deployed-programs).

## 3. Successful current-binary controls

Chain control: mainnet signature `5J8Zt9TgK4NjtEWGXu26kA7EbpynUs83c2dn5zDvV4DMkydTvdBHfUcfbqEu7dHHFWjv1WcrnpnvC39sdHrSSx1s`, slot **457,317,618**, is a successful **version-1** SPMB `WithdrawStake` after the pinned deployment slot. It burns/transfers 1,237,051,157 raw JupSOL through holder `2cSw…`, validator stake `Emut…`, validator list `AXL4…`, withdraw PDA `EMju…`, SPL Token, and native Stake CPI; it consumed 78,806 CU. A successful permissionless `UpdateValidatorListBalance` control is signature `47SjXV…`, slot 457,243,651.

Fresh simulations at slots **457,352,732–457,352,745** supplied positive controls before interpreting failures:

- `WithdrawStake`: 1,000,000,000 raw JupSOL input succeeded; 999,000,000 shares burned, 1,000,000 shares transferred as the configured fee, pool `total_lamports` fell 1,213,334,048, and the newly created native Stake destination ended at 1,215,000,288 lamports including its 1,666,240-lamport rent reserve. 67,171 CU.
- `UpdateStakePoolBalance` succeeded with zero state/mint/fee-account delta, 7,313 CU.
- `UpdateValidatorListBalance(start_index=0, no_merge=true)` succeeded, 35,738 CU.
- Atomic KLend borrow → unwrap WSOL → SPMB `DepositSol` → SPMB `WithdrawSol` → rewrap → KLend repay succeeded and fully restored KLend supply, fee-vault balance, and decoded available liquidity.

These controls exercise the current RPC-loaded binary, not a local emulator.

## 4. Zero-fee KLend flash extremes and real v1 composition

Decoded at slot **457,352,724**:

- KLend reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM`, WSOL mint, status `0` (active).
- Supply `3Sdr…`, fee vault `DW718…`, effective available **6,583,425,299,329 raw WSOL** (6,583.425299329 SOL).
- `flash_loan_fee_sf = 0` exactly. KLend supply/fee/available deltas were all zero after every successful flash composition; there is no obligation account because this is a stateless atomic flash loan.

Selected outcomes:

| Case | Result | v1 bytes / accounts / ix | CU | Post-state / repayment |
|---|---|---:|---:|---|
| KLend 1 raw unit | success | 606 / 13 / 3 | 70,063–70,069 | full repay; supply/fee/available Δ 0 |
| KLend available−1 | success | 606 / 13 / 3 | ~70,069 | full repay |
| KLend exact available | success | 606 / 13 / 3 | ~70,069 | full repay |
| KLend available+1 | rejected `InsufficientLiquidity` 6008 | 606 / 13 / 3 | 47,522 | atomic failure |
| SPM round trip, 1 raw lamport | rejected `DepositTooSmall` 29 | 1,028 / 23 / 10 | 68,139 | no committed delta |
| SPM round trip, 2 raw lamports | deposit mints 1 share; withdraw rejected `WithdrawalTooSmall` 28 | 1,028 / 23 / 10 | 80,054 | no committed delta |
| **SPM smallest successful round trip, 3 raw lamports** | success | 1,028 / 23 / 10 | 132,158 | full flash repay; pool retains 2 lamports and 1 fee share |
| 1 SOL round trip | success | 1,028 / 23 / 10 | ~132,547 | full repay; pool/reserve +1,000,002 lamports; manager +823,352 raw shares; user share Δ 0 |
| available−1 round trip | success | 1,028 / 23 / 10 | ~132,802 | full repay; pool/reserve +6,583,425,301 lamports; manager +5,420,470,879 raw shares; user share Δ 0 |
| 2 / 4 repeated 1-SOL cycles | success | 1,076 / 23 / 12; 1,172 / 23 / 16 | 169,227; 242,582 | full repay; residuals exactly 2,000,004 / 4,000,008 lamports |
| update crank before / between / after target | all success | 1,072 / 24 / 11 | ~140,977 each | same 1-SOL economics and full repay |
| Withdraw directly into recreated WSOL ATA, no fee top-up | repay rejected for insufficient funds | 1,010 / 23 / 9 | ~130,588 | expected 1,000,002-lamport shortfall; atomic failure |
| Same-asset WSOL destination + exact shortfall top-up | success | 1,028 / 23 / 10 | ~132,633 | full repay; same expected SPM fee |
| **Exact 4,096-byte v1 wire** | success | **4,096 / 24 / 11** | **1,197,178** | full repay; same 1-SOL deltas |
| **Exact 64 inline addresses, no ALT** | success | **2,381 / 64 / 10** | **141,760** | full repay; same 1-SOL deltas |
| 4,097 bytes / 65 inline addresses | locally rejected by v1 encoder | 4,097 / 65 | — | limit enforcement |

The first concrete blocker to feeding borrowed WSOL directly into `DepositSol` is the native System Program transfer: using the WSOL token account as SPM's funding account fails `InvalidArgument` at the `DepositSol` CPI. Closing WSOL to the signer-owned system account, then depositing native SOL, is required. This is a representation constraint, not an SPM authorization bypass.

Full wire bytes, account keys, headers, instruction counts, CU, traces, inner instructions, and pre/post account images are in [composition evidence](./sanctum-splmulti-klend-v1.json); the deterministic builder is [here](./sanctum-splmulti-klend-v1.js).

## 5. Mutations and authorization result

| Mutation | Current-binary result | Security interpretation |
|---|---|---|
| Funding account not a signer | `PrivilegeEscalation`; unauthorized CPI signer | blocked before transfer |
| Different signed funding account with no funds | System transfer custom error 1 | no pool shares minted; atomic rollback |
| Wrong pool-token transfer authority | SPL Token owner mismatch, custom 4 | victim shares cannot be burned |
| Wrong withdraw PDA | program-address mismatch, custom 1 | derived authority enforced |
| Reserve aliased to user system account | program-address mismatch, custom 1 | stored reserve enforced |
| Stake CPI account changed to System Program | `IncorrectProgramId` | native Stake program enforced |
| WithdrawStake validator list changed to pool state | `Invalid validator stake list`, custom 8 | stored list enforced |
| WithdrawStake source/destination swapped | wrong Stake state, custom 11 | ordering/type enforced |
| WithdrawStake before destination account creation | native Stake `InvalidAccountOwner` | ordering enforced; rollback |
| Flash repay moved before rewrap/target | uninitialized repayment source, 3012 | order invalid; rollback |
| Flash repay borrow index changed | KLend `InvalidFlashRepay`, 6033 | paired instruction index enforced |
| Withdraw beneficiary changed to outsider while owner signs/burns own shares | succeeds | explicitly authorized redirection, not theft |
| Validator-list `start_index` changed 0→1 while leaving index-0 account pairs | instruction returns success but logs every PDA mismatch and leaves validator-list SHA-256 byte-identical | fail-closed no-op; no value or accounting change |

For value-moving target paths, the source first validates pool ownership/state, the stored validator list/reserve/mint/fee account, the derived withdraw PDA, current epoch, and native Stake/SPL Token program IDs. The token burn/fee transfer occurs before the native Stake split/withdraw CPI, but Solana transaction atomicity rolls all earlier writes back if a later CPI fails. The failed simulations returned no committed account images/deltas; positive controls establish that the same wire construction and accounts work when unmutated.

## 6. Assessment and residual boundaries

- **Verified vulnerability:** none.
- **Unauthorized net movement:** none observed across SOL deposit/withdraw, native Stake withdrawal, crank placement, aliasing, beneficiary changes, repeated cycles, threshold/rounding extremes, near-full zero-fee flash liquidity, or v1 envelope limits.
- **Expected value movement:** the 0.1% ceiling withdrawal fee leaves SOL in custody and fee shares with the configured manager fee account. A signed share owner may send withdrawal proceeds to any writable beneficiary; that is authorization by share burn, not a beneficiary-authentication defect.
- **Upgrade trust:** `47SND…` remains the live upgrade authority. This is a governance/control-plane trust boundary and means the hash conclusion is specific to the ELF deployed at slot 371,704,232.
- **Source reproducibility limitation:** the exact ELF hash was pinned and matched an independent fixture, and runtime behavior matches the official fork, but the local SBF build blocker prevented an independent byte-reproducible build.
- **Simulation limitation:** `sigVerify:false` proves runtime account/signature-meta enforcement, not possession of any private key. No result should be read as an ability to sign for the sampled mainnet actors.

On the requested standard—unauthorized net value movement rather than custody size or off-curve ownership—this audit does **not** support a drain finding.
