# marginfi / Project0 current-binary adversarial audit

Audit time: 2026-10-15 (evidence finalized 2026-10-15T18:55:41Z)  
Program: `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`  
Mode: read-only mainnet RPC and `simulateTransaction`; no transaction was signed or submitted

## Outcome

No novel, immediately exploitable, unprivileged fund-loss vulnerability was validated in the tested current binary and exact verified source.

- Demonstrated unauthorized value transfer: **none**.
- Demonstrated exploitable amount: **$0**. This means no exploit was demonstrated; it is not a claim that the program has no residual risk.
- Direct PDA custody observed: **328 unique nonzero vaults**, of which 277 were priced at a **$37,131,408.88754366 gross lower bound** and 51 were unpriced. Custody is not an exploitable-amount estimate.
- Reportable findings: **0**.

The already-known OtterSec GoonFi issue was explicitly excluded. Privileged/admin-only actions and the repository's documented `SECURITY.md` exclusions were not treated as novel unprivileged findings.

## Current deployment and source binding

The live program state observed during the audit was:

- BPF loader: `BPFLoaderUpgradeab1e11111111111111111111111`
- ProgramData: `4Q8u2ny8YYgytJEncwZQfVWbd5axZtfgDxYKHehvPQR7`
- Upgrade authority: `J3oBkTkDXU3TcAggJEa3YeBZE5om5yNAdTtLVNXFD47`
- Last deployed slot: `456093551`
- Program data length: `10,485,715` bytes
- ProgramData balance: `53.26831104 SOL`

The current Otter verification record reported `is_verified: true`, with both on-chain and executable hashes equal to `eb7618369bec08691a7a4003e04f8fb34d95e7301e2b3b0c5439528e2b38cdab`, last verified at `2026-10-14T12:01:08.831811`, and source commit `c5d440f62365de503c89cf6ec39fb6673494cc7c`. The checked-out source at `composer-runs/2026-10-15/marginfi-source` resolves exactly to that commit and was clean when inspected.

The deployed-source IDL is version `0.1.12` with 118 instructions. It decoded every current Bank account in the custody scan. No large local rebuild was performed: the audit relies on the current external verified-build record for binary/source identity, as requested, rather than independently reproducing the large build.

## Direct PDA custody census

Evidence: `marginfi-vaults-current.json`, observed at slot `457342801` (`2026-10-15T18:47:27.330Z`).

- 401 Bank accounts decoded: 236 accounts of 1,864 bytes and 165 accounts of 3,912 bytes.
- 328 unique direct PDA vaults had nonzero balances.
- For every counted row, the Bank was owned by the target program; vault address and bump matched the Bank-derived PDA; authority address and bump matched the Bank-derived PDA; and the vault mint matched the Bank mint.
- 277 vaults were priced. Their gross lower-bound custody was $37,131,408.88754366.
- 51 nonzero vaults were unpriced and excluded from the USD total, so the USD figure is deliberately a lower bound.

This census measures assets held by the program's Bank-derived vaults. It does not show that those assets are drainable.

## Dynamic controls and adversarial mutations

All current tests used `sigVerify: false` only inside simulation so historical callers could be replayed without possessing their keys. This does not make PDA signatures forgeable and was never used to submit a transaction.

### Borrow and custody binding

Evidence: `marginfi-current-simulations.json`.

The positive control replayed transaction `Vv6SMnzqaExN1dvLnPXVXRpp2yTC9T2GJD2rZUqNHePj3oZyBzVGojJh2vah2B6wDdqviYNzDCvMAKNXy48iYgQ` and an isolated copy of its borrow instruction against current state. Both returned `err: null`. For Bank `FDsf8sj6SoV313qrA91yms3u5b3P4hBxEPvanVs8LtJV` and mint `USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA`, the simulation debited exactly 100,000,000 raw units from bound liquidity vault `3WozDBEqbWJ7oe8CDd2MEJYAv4ZUaxNTuMesQ6kwTvki` and credited exactly 100,000,000 raw units to the selected destination.

| Mutation | Result | Interpretation |
|---|---|---|
| Replace authority with another signer meta | Rejected: `Unauthorized` 6042 | No vault debit under substituted authority. |
| Replace liquidity vault | Rejected: `InvalidLiquidityVault` 6094 | Bank-to-vault binding held. |
| Replace Bank with another Bank in the same group while retaining original vault/oracles | Rejected: `InvalidLiquidityVault` 6094 | Cross-Bank account substitution did not pass. |
| Replace token CPI program with System Program | Rejected: `InvalidProgramId` 3008 | CPI program binding held. |
| Redirect destination while retaining the authorized account signer | Succeeded; 100,000,000 raw units went to the alternate same-mint token account | Expected interface behavior: the authorized borrower selects the destination and retains the debt. It is not an authority bypass. |
| Duplicate the authorized borrow instruction | Succeeded twice; vault `-200,000,000`, authorized destination `+200,000,000` | Each invocation performed normal liability/health accounting; duplication was not a free or unauthorized debit. |
| Append a guaranteed-failing System Program instruction after the borrow | Whole transaction failed with `InvalidInstructionData` after the borrow log | The value-moving instruction cannot be retained from a failed transaction. RPC returned no post-state accounts for the failed simulation; no live state was written. |

The source performs the PDA-signed transfer at `borrow.rs:145-158`, then requires initial health and circuit-breaker checks at `borrow.rs:206-276`. Its accounts require an authorized signer and exact group/vault relationship at `borrow.rs:281-335`.

### Withdraw and repay controls

Evidence: `marginfi-replay-controls.json` and `marginfi-replay-refresh.json`.

- A current-state successful integration transaction, `5EQ6gB6MoG8peoaJW48fgeaU2Lq1PubGNdtBxdVAjy2tKuuZ9iNyaqcmumnZZV7jp99oqFAKKKAWtcvrTY2NGKoE`, reached `LendingAccountWithdraw` through its outer integration program and returned `err: null`.
- Current-state replay sweeps also produced successful borrow/swap/repay/end-flashloan controls (`5ASUWucWSHnLoyUw8wanfcjGftm1pQUsYXzZzejVcJYydZWAMGwKD2kDmBkQjTWestjnyfHNP5kXgJeV4FG5D5gT`, then refreshed as `3ok9CzX7U7oAkgaqUxLx6zhjCC4sMe6EeqKQRNnwMMw4TteVFCAvxf7g9kGtQbNM6m4B9FN7x4MxXGFLuxFt7D8i`). Those controls later aged out at mutable swap state, failing in an external swap program rather than marginfi.

The direct withdraw handler moves tokens at `withdraw.rs:189-202`, applies ordinary post-withdraw health checks at `withdraw.rs:230-265`, and binds authority, group, Bank, liquidity vault, vault authority, and token program at `withdraw.rs:281-350`. Repay binds authority/group/vault/token program at `repay.rs:231-278` and transfers caller tokens into the bound liquidity vault at `repay.rs:149-183`. The risk-admin-only tokenless branch requires the risk-admin key, Bank flag, and `repay_all` at `repay.rs:82-89`.

Limitation: because the successful withdraw was an inner CPI of a third-party integration, I did not claim a direct account-meta mutation result for that instruction. The equivalent direct authority/vault/token-program mutations were demonstrated on borrow, and the withdraw path was reviewed statically, but this remains narrower than a successful mutated top-level withdraw control.

### Permissionless fee collection

Evidence: `marginfi-fee-simulations.json`.

The positive permissionless control used Bank `6Fk3bzhqmUqupk6sN5CbfYMdafvyzDdqDNHW5CsJzq8K` and returned `err: null`. It moved only the integer outstanding amounts recorded by the Bank:

- liquidity vault `DyEuAkiK13uZgDfAdz1fJxgryLKsuEHQvDd96dz6Dnmu`: `-2,478,848,283,964` raw units;
- configured group fee vault `4ZbBPFuTse67QkkeWUZXwv4NBsjhaACauEPGYwAfzB8X`: `+2,478,848,283,818` raw units;
- configured insurance vault `GoHXtVQeRKjwqDSZwf9YgrDzUeXKwRckzYM7urmTmX5J`: `+146` raw units;
- canonical global-fee ATA: no change because this Bank's current integer program-fee outstanding amount was zero.

The amounts balance exactly.

| Mutation | Result |
|---|---|
| Redirect global fee ATA to another valid same-mint token account | Rejected: `InvalidFeeAta` 6045 |
| Substitute liquidity vault | Rejected: `ConstraintSeeds` 2006 |
| Substitute same-group Bank while keeping the original vault set | Rejected: `ConstraintSeeds` 2006 |
| Substitute token CPI program | Rejected: `InvalidProgramId` 3008 |

The handler validates the canonical fee ATA at `collect_bank_fees.rs:22-39`, caps each transfer to recorded outstanding amount and available liquidity at `collect_bank_fees.rs:54-164`, and derives all vaults and authorities from the Bank at `collect_bank_fees.rs:182-250`. Admin fee/insurance withdrawals require the group admin and PDA-bound vaults at `collect_bank_fees.rs:253-420`. The separate permissionless withdrawal path is bound to `Bank.fees_destination_account`, its Bank mint, and the Bank-derived fee vault at `collect_bank_fees.rs:467-550`. Premium collection likewise checks the configured premium wallet's canonical ATA and Bank-derived liquidity vault at `collect_bank_premium_fees.rs:16-78,94-141`; the current FeeState premium wallet was unset, so that path had no positive current value-moving control.

### Flashloan ordering, duplication, and same-transaction closure

Evidence: `marginfi-current-simulations.json`.

A compact start/end control built from a current transaction returned `err: null`. The following mutations all failed with `IllegalFlashloan` 6038:

- changing `end_index` to point at `LendingAccountRepay` rather than `LendingAccountEndFlashloan`;
- moving end before repay in the full composed transaction;
- duplicating the start instruction in the compact transaction.

The source requires the declared end to be later, to have the expected discriminator and target program, and to reference the same MarginfiAccount (`flashloan.rs:72-114`). Start and end are top-level-only; end requires the same group/authority and an active flashloan flag before final health validation (`flashloan.rs:117-183`).

### Classic and receivership liquidation

The 6,000-signature sweep found confirmed successful historical value-moving controls:

- classic liquidation: `fB8umhpEqtDtxBiHpW4w8G9vB1bxYU4TsKqCokJvHx9CkYrpMo6Wrf1N4nAqAnddpLaceAujJKbRumiJSGBQi9S`, slot `457310492`;
- receivership start/end: `1LsGx3HRtiMMgcS9P16SFjYP3gz2hLv6A7pfvhZb8Z78EeCRNdE7aqcBaWzJAPj546bfxEdopM77U2yZZzmzBV2`, slot `457238124`.

Neither was a valid current-state positive control by the time of replay: the target accounts now fail `HealthyAccount` 6068. Twelve recent classic-liquidation replay attempts and eleven receivership attempts produced no current successful replay. A current Surfpool fork would inherit the same now-healthy accounts; artificially rewriting their health would not prove an immediately exploitable current path, so no synthetic success was presented as real evidence.

Static review found that classic liquidation binds both Banks and both marginfi accounts to the same group, requires authorization over the liquidator account, derives the liability liquidity/insurance vaults, checks pre/post liquidatee health, and checks the liquidator's final health (`liquidate.rs:110-228,250-520,544-653,745-830`). Receivership start requires an actually unhealthy account, stores the receiver only for the transaction, constrains the permitted programs/instructions, requires start first and unique, end last, and top-level invocation (`liquidate_start.rs:32-73,106-227`; `ix_utils.rs:36-165,181-209`). End binds the liquidation record/receiver/group, applies cached-price final health and premium constraints, clears receivership, and caps extracted value (`liquidate_end.rs:30-98,132-253,256-325`).

Limitation: current-state liquidation account/destination/order mutations were not attributable because every candidate failed the precondition before the mutated path. This surface is therefore statically reviewed and historically controlled, but not fully dynamically mutated against a currently unhealthy account.

## Coverage and residual risk

Completed:

- current deployed program metadata and verified source commit;
- current Bank layouts and direct PDA custody census;
- borrow authorization, destination behavior, Bank/vault binding, token CPI binding, duplication, and transaction-failure behavior;
- permissionless fee collection, canonical destination, Bank/vault binding, and CPI program binding;
- flashloan declared-end, reordering, and duplication controls;
- source review of withdraw, repay, classic liquidation, receivership liquidation, admin/permissionless fee withdrawals, and premium fee collection;
- recent successful mainnet-control discovery and current-state replay attempts.

Not completed or intentionally excluded:

- No local reproducible build comparison was run; the current verified-build record was used for binary/source binding.
- No currently unhealthy account was available for a successful current classic or receivership liquidation mutation baseline.
- No standalone top-level withdraw mutation baseline was obtained; the current positive was an integration CPI.
- No premium-fee value-moving control existed because `FeeState.premium_wallet` was the default key.
- Oracle provider correctness, pure liquidity/availability issues, documented known issues, admin-only behavior without privilege gain, and the known GoonFi issue were outside scope.

These gaps prevent a claim of exhaustive absence. They do not supply evidence of an immediately exploitable unauthorized transfer.

## Evidence files

- `marginfi-vaults-current.json` — full current Bank/vault custody rows and derivation proofs.
- `marginfi-current-simulations.json` — borrow, atomicity, duplication, and flashloan mutation results.
- `marginfi-fee-simulations.json` — permissionless fee positive control and destination/vault/program mutations.
- `marginfi-replay-controls.json` — 6,000-signature historical controls and current replay attempts.
- `marginfi-replay-refresh.json` — refreshed current positive controls.
- `scan-marginfi-current-vaults.js`, `marginfi-replay-scan.js`, `marginfi-current-mutations.js`, and `marginfi-fee-simulations.js` — read-only reproduction harnesses.

## Flashloan extreme-stress extension

Evidence finalized at `2026-10-15T19:17:35.396Z`: `marginfi-flashloan-stress.json`. Reproduction harness: `marginfi-flashloan-stress.js`.

The verdict is unchanged: no unauthorized token gain, unpaid debt, or reportable drain was demonstrated. The extension ran 98 read-only current-mainnet v1 simulations; 55 succeeded and 43 failed at intended protocol/runtime controls. These are test outcomes, not security pass/fail counts. No transaction was signed or submitted, and the requested drain action was not called because no gain remained after repayment.

### Exact Solana v1 runtime boundary

This extension used a direct version-1 message encoder, not a legacy/v0 1,232-byte substitute.

| Case | Exact envelope | Result |
|---|---:|---|
| Maximum requested boundary | 4,096 wire bytes, 64 inline addresses, 5 instructions | Success; 134,242 CU; SHA-256 `7cf0b00bada6c209aa4ffeb59d78da9be8678455fc13e048615df43a3c4da511`. The Project0 2-raw borrow was fully repaid and wallet/vault/debt/share custody returned to the preimage. |
| One byte over | 4,097 bytes, 64 addresses | RPC `-32602`: `decoded solana_transaction::versioned::VersionedTransaction too large: 4097 bytes (max: 4096 bytes)`. |
| One address over | 2,350 bytes, 65 addresses | RPC `-32602`: `invalid transaction: Transaction failed to sanitize accounts offsets correctly`. |

The evidence JSON retains the exact wire and unsigned-message base64, SHA-256, ordered account list with signer/writable privileges, full logs, inner instructions, CU, loaded-account data size, and decoded pre/post images for every case.

### Fee-free Project0 dust and liquidity boundaries

The positive Project0 path used USDT mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, Bank `HmpMfL8942u22htC4EMiWgLX931g3sacXFR6KjuLgKLV`, and liquidity vault `77t6Fi9qj4s4z22K1toufHtstM8rEy7Y3ytxik7mcsTy`. The Bank's decoded `protocol_origination_fee` was exactly zero I80F48 raw, not a nonzero rate rounded away at a small amount.

- Zero raw reached repay and failed with `NoLiabilityFound` 6024.
- One raw failed borrow with `IllegalBalanceState` 6040.
- Two raw was the smallest success: 564 bytes, 11 addresses, 4 instructions, 124,511 CU. Pre/post user USDT stayed `0`; the liquidity vault stayed `297,639,423,187`; the account had no selected balance afterward; total asset and liability shares were unchanged. Only normal time-based Bank share-value/group-fee accrual moved.
- Direct `vault−1`, `vault`, and `vault+1` requests failed `IllegalUtilizationRatio` 6026. A live binary search last observed a successful fully repaid amount of `297,395,487,758` raw at slot `457351123` (564 bytes, 11 addresses, 4 instructions, 125,343 CU; SHA-256 `830f5892625c41afba9b694e34a6dc556896a4209c01f2ff9810ceb55d5a67a4`). The wallet and vault were unchanged and no account liability remained. This is an observed sample, not a timeless maximum: Clock-driven interest accrual shifts the utilization boundary between simulation slots.

The source constants are `EMPTY_BALANCE_THRESHOLD = 1` native/raw unit and `ZERO_AMOUNT_THRESHOLD = 0.0001` native/raw unit. The latter is below one indivisible token atom; the live one-raw/two-raw transition therefore supplies the meaningful token boundary.

### Repetition, updates, aliases, and order

- Twelve Project0 borrow/repay pairs succeeded inside one envelope: 26 instructions, 1,213 bytes, 1,085,187 CU, with no remaining debt or custody delta. Sixteen pairs reached the 1,400,000-CU limit and failed atomically at instruction index 31 (`ProgramFailedToComplete`); 24 and 30 pairs failed at the same execution frontier.
- `LendingPoolAccrueBankInterest` succeeded before start, after start, between borrow/repay, after repay, and after end. `LendingAccountPulseHealth` succeeded in the same five placements. Successful cases left no token gain or liability.
- Declared-end substitution, duplicate start, borrow-before-start, repay-before-borrow, end-before-repay, destination/vault aliasing, repayment-from-vault, and wrong-vault substitution all failed. Observed controls included `IllegalFlashloan` 6038, `RiskEngineInitRejected` 6009, `BankAccountNotFound` 6018, duplicate-mutable-account 2040, account mismatch 3007, and SPL authority error 4. Atomic failure preserved state.

### Exact-zero-rate KLend → marginfi → KLend composition

The same-mint external lender was KLend USDT reserve `4nY1w21fR8GQTARbkmT4Cauz2gQerubp5NnBvsuEQg7J`, market `5o3y37r1VuRXTaG5APnp76re1pWXyV7K7158ppEfqJhn`, supply vault `5nnTgWzLfRrgBx5k2bYvMwDLYdKaffZocRf3JxnKUAQh`, and fee vault `HL8QDyky5Kd6GfwxqTTd6aVRFkZyUpiM5LEWDyb2eaTS`. The live reserve was active (`status = 0`, `emergencyMode = 0`) with `flashLoanFeeSf = 0` at the `2^60` scale: an exact zero rate, not dust-fee rounding. Available liquidity was `47,918,437` raw and the fee vault held zero.

A naïve `borrow P → marginfi deposit P → withdraw_all → KLend repay P` sequence failed repayment with SPL error 1 because marginfi's full-withdraw flooring returned one atom less. The exact composition retained one atom outside marginfi, deposited and explicitly withdrew `P−1` with `withdraw_all = false`, then repaid `P`.

- Buffered principals `3`, `101`, `1,000,001`, and the exact full reserve `47,918,437` all succeeded.
- The full-reserve case was 816 bytes, 18 addresses, 4 instructions, 162,616 CU; SHA-256 `733e8280582469873c9c7e4b489cb3416c3e152b2e6d7e3dd1dde6cd2854faaa`.
- Eight repeated buffered marginfi deposit/withdraw rounds also succeeded in one transaction: 18 instructions, 1,243 bytes, 710,425 CU; SHA-256 `dc6fb35a1319359acf4fee4f6b912c99eb67555473b0c64463c7437efd3effb4`.
- Accrue before the external borrow, accrue between deposit/withdraw, and pulse between deposit/withdraw all succeeded without a gain or unpaid principal.

For the full-reserve and repeated cases, pre/post amounts were identical: user token `0`, marginfi vault `297,639,423,187`, KLend supply vault `47,918,437`, and KLend fee vault `0`. Liability shares and premium outstanding were zero. Marginfi retained one I80F48 least-significant asset-share bit and total asset shares increased by the same single bit. That is `1 / 2^48 ≈ 3.55×10^-15` shares, far below one raw token atom and the one-native-unit empty-balance threshold; it was not extractable token value and did not accumulate across the eight-round case.

### Exact-zero liability-share hypothesis

Static review found an asymmetry worth checking: a positive withdraw explicitly rejects conversion to zero asset shares, while borrow lacks the analogous local zero-result check before the outer dust test. For a fee-free one-raw-unit borrow, fixed-point division returns `floor(2^96 / liability_share_value_raw)` share bits. A zero result therefore requires `liability_share_value_raw > 2^96`, equivalently a numeric liability-share value greater than `2^48`.

All 401 live Bank addresses from the verified custody census were re-read at slots `457351092`–`457351094` and decoded. Zero banks met the condition. The maximum observed value was only `7.881064631925905672` (raw `2,218,322,483,726,519`) at Bank `9yNnhJ8c1vGbu3DMf6eeeUi6TDJ2ddGgaRA88rL2R3rP`; even there, one raw converts to `35,715,349,366,684` nonzero I80F48 share bits. Together with the live fee-free one-raw rejection, this closes the candidate for current mainnet. Adding a symmetric zero-share guard remains sensible defense in depth.

The other hardening observation is `unchecked_end_fl_ix.data[..8]` in `flashloan.rs`: 0–7 bytes can abort the authority signer's malformed transaction. Because start requires the stored authority and Solana rolls back the atomic transaction, no persistent or cross-user impact was established; it is not a reportable fund-loss issue.

### Extension evidence

- `marginfi-flashloan-stress.json` — 98 exact v1 cases with full messages, account privileges, logs, CU, and decoded pre/post state; also contains the 401-Bank exact-zero-share census.
- `marginfi-flashloan-stress.js` — read-only reproduction harness; only current-mainnet `get*` methods and `simulateTransaction`, never `sendTransaction`.
- `klend-zero-fee-census.json` — current reserve configuration evidence distinguishing exact zero rates from rounded-to-zero fees.
