# Meteora DAMM v2 — current deployed-program audit

**Date:** 2026-10-15  
**Program:** `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`  
**Method:** read-only RPC, current-state `simulateTransaction`, deployed ELF inspection, and source review  
**Live transactions submitted:** none

## Result

No novel, reportable immediately-at-risk fund vulnerability was established in the reviewed scope. In particular, no simulation produced an unauthorized transfer to an attacker-controlled destination. This is not a claim that the current deployment is vulnerability-free: source-to-binary equivalence is unproven, the custody inventory is partial, and the external protocol-fee program is outside scope.

The known OtterSec/GoonFi issue was excluded as requested and is not restated as a finding.

## Deployment identity

The current executable was fetched from ProgramData account `AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH`.

| Property | Observed value |
|---|---|
| Program | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` |
| ProgramData | `AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH` |
| Upgrade authority | `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd` |
| Last-deployed slot | `457080014` |
| ELF size | `2,174,352` bytes |
| ELF SHA-256 | `967ff9fb161eec2e62f66d2c899100739fb747c445f697b8625c86b31b9a2022` |
| Reviewed source | commit `5398b5c7c534de014091132da37c6478cce671a8` |
| Exact source/build/binary match | **Unestablished** |

The binary contains source-path and instruction/error strings consistent with this repository, including the custom swap entrypoint and `Multiple swaps not allowed`, but string consistency is not a reproducible-build proof. No local build was performed, so no build cache or generated build artifact was created.

## Custody context

The supplied top-100 observation at slot `457333411` (`2026-10-15T18:26:24.996Z`) covered 100 pools and 200 nonzero vaults. Of those vaults, 156 were priced and 44 were unpriced. Priced gross custody was **$26,974,001.83594101**.

This figure is a gross, partial lower bound, not TVL and not an exploitable-loss estimate. The sample is explicitly far from the supplied 167,308-pool population. The original top-100 output artifact was lost during the earlier disk cleanup and was not recreated, so these numbers are retained as a recovered prior observation rather than a fresh canonical measurement. A later data-size query saw 1,646,118 program accounts of the pool account size; that query was used only to locate a nonzero protocol-fee fixture and was not reconciled into a pool-count or custody estimate.

## Current-binary simulation results

The final run was observed at `2026-10-15T18:58:35.952Z`. It used only `simulateTransaction(sigVerify=false, replaceRecentBlockhash=true)`. Temporary associated token accounts and wrapped SOL were created inside simulation; all effects were ephemeral. There were 33 current-fixture cases, plus 24 rejected historical-fixture replays in the same evidence file.

Raw token amounts below are deliberately not converted to USD.

### Positive controls

| Family | Positive value-moving result |
|---|---|
| Swap | Paid `1,000,000` raw WSOL into the input vault; output vault debited and user output account received `2,119,377,742` raw token-A units. |
| Remove liquidity | Withdrew 1% of an active position's unlocked liquidity: user destinations received `29,928,101,003` raw token-A and `97,596` raw token-B units; the recorded vaults decreased by the same amounts. |
| Claim position fee | User token-B destination received `311,119` raw units and the recorded token-B vault decreased by `311,119`; token-A fee delta was zero. |
| Claim protocol fee | With the required external PDA marked as a signer only under `sigVerify=false`, the recipient received `698,723,059,681,291,370` raw token-A units and the recorded vault decreased by the same amount. This proves the cp-amm transfer path, not live attacker control of that PDA. |

### Mutation matrix

| Mutation | Swap | Remove liquidity | Position fee | Protocol fee |
|---|---|---|---|---|
| Authority | Rejected (`Custom 4`) | Rejected (`InvalidAuthority`, 6053) | Rejected (`InvalidAuthority`, 6053) | Rejected (`ConstraintAddress`, 2012) |
| Destination | Output-vault alias succeeded but caller received zero output; see below | Vault alias rejected (duplicate mutable, 2040) | Vault alias rejected (duplicate mutable, 2040) | Vault alias rejected (duplicate mutable, 2040); unrelated-mint receiver rejected (6068) |
| Vault/account binding | Rejected (`ConstraintHasOne`, 2001) | Vault alias rejected (2040); pool-as-position rejected (3002) | Vault alias rejected (2040); pool-as-position rejected (3002) | Vault alias rejected (2040) |
| Token CPI program | Rejected (`ConstraintTokenTokenProgram`, 2021) | Rejected (3008) | Rejected (3008) | Rejected (3008) |
| Duplicate instruction | Two authorized swaps executed, with roughly twice the input/output movement | Two authorized partial removals executed, with exactly twice the single-removal token deltas | Second claim transferred nothing after fees were reset; total equaled one claim | Second claim transferred nothing after the counter was reset; total equaled one claim |
| Valid then invalid in one transaction | Transaction failed on the invalid authority and exposed no final token deltas | Same | Same | Same |

`claim -> remove` and `remove -> claim` both succeeded on the current position. Both produced the same aggregate token deltas: `29,928,101,003` raw token-A and `408,715` raw token-B units (`311,119` fee plus `97,596` liquidity output). No order-dependent excess was observed.

### Successful swap vault alias

Supplying the recorded output vault as both transfer source and destination is accepted by the custom swap path. The simulation debited `1,000,000` raw WSOL from the authorized payer into the input vault, gave the payer no output, and left the output vault's token balance unchanged while pool accounting advanced as if output had been paid.

This is an accounting-surplus/donation edge case, not an unauthorized withdrawal: the caller supplies the input, cannot redirect another principal's assets, receives zero output, and causes no vault balance to fall beyond an ordinary authorized swap. It may create actual-vault versus tracked-reserve divergence and may be relevant to integrator safeguards, but the evidence does not satisfy a fund-theft finding.

### Protocol-fee authority boundary

The successful protocol-fee control used pool `hcE7QZYBJq63GgM6zXzGwY5S7NPPC8yvbw5k6YKuM34`, whose token-A protocol-fee counter was `698723059681291370`. cp-amm requires PDA `FkU5rQCWQM131skHCpcEbK8P1JrQGsBgqXe55w525SSF`, derived under external program `pFee3tb7qh5z53jRF4PbLwmNd148Q8ypLNZbqsMeinA`.

Because simulation disabled signature verification, the harness could model that PDA as signed. That does not make the PDA forgeable on-chain. cp-amm permits the genuine external authority to choose any receiver of the matching pool mint; the external program's receiver policy, upgrade authority, and CPI construction were not reviewed. An exploit claim therefore cannot be made at this boundary without evidence against `pFee3...`.

## Atomic flashloan composition

All flashloan work used serialized Solana transactions and `simulateTransaction(sigVerify=false, replaceRecentBlockhash=true)` against current mainnet state. Nothing was submitted. The version-1 transactions used no address lookup table, stayed below the requested 4,096-byte packet limit, and used at most 41 inline addresses (22 in the Project 0/KLend DAMM fixture). The modeled borrower authorities are real accounts recovered from successful mainnet transactions; disabling signature verification tests program behavior but does not assert control of those keys.

Three independent lender compositions reached DAMM v2:

| Lender path | Successful atomic control | Wire / accounts / instructions | Repayment evidence |
|---|---|---|---|
| Project 0 / Marginfi account `5oxf...` | Borrowed USDC, swapped `100,000` raw USDC to `19,105,414` raw USDP and all USDP back to `92,159` raw USDC, repaid, ended flashloan | v1: `1,012` B / 22 / 7; `170,703` CU | Lender vault exact delta `0`; borrower USDP residual `0`; borrower lost `7,841` raw USDC to ordinary pool fees/slippage |
| KLend reserve `AYL4...` | Borrowed `1,000,000` raw USDC, forward Swap2, reverse exact-out for `300,000` raw USDC, repaid | v1: `948` B / 21 / 5; `107,309` CU; legacy: `931` B | Reserve supply exact delta `0`; fee vault exact delta `0`; both flash instructions and both Swap2 instructions succeeded |
| Marginfi source-shape replay | Re-encoded a real mainnet v0 transaction as v1, removed its profit guard, supplied a `0.001 SOL` repayment buffer, and completed borrow, cp-amm CPI, repay, and end | v1: `1,666` B / 40 / 13; `208,390` CU | Repay and `LendingAccountEndFlashloan` succeeded; lender-vault delta was `0`; without the buffer, repayment failed atomically |

The Marginfi composition came from successful mainnet signature `51rkcgayyihp2SC2ChuysU8FxVYE86yDFtH6jeoCwb693homZwq7dYFTrJVNsEe67jpkEg7aa6hdraGe4Th1sNrc` at slot `457346498` (v0, `1,086` B, 41 accounts, `233,812` CU). This provided an independent real transaction shape rather than a synthetic lender-only wrapper.

### Project 0 stress and integer boundaries

The Project 0 campaign recorded 140 cases: 96 successful RPC simulations, 43 failed RPC simulations, and one local v1 composition rejection before RPC. Its source-state window was approximately slots `457350985`–`457351067`.

- **Minimums:** a 1-raw-USDC borrow failed with `IllegalBalanceState` (6040); 2 raw succeeded with full repayment and zero lender/borrower USDC delta. The first composable DAMM output was also input `2`, producing `199` raw USDP. A forward/reverse dust cycle returned zero USDC from the pool and repaid from the borrower's pre-existing `17,229`-raw buffer.
- **Fee onset:** decoded `EvtSwap2` data isolated the fee from concurrent pool traffic. Input `99` produced claiming fee `4` and protocol fee `0`; input `100` produced claiming fee `4` and protocol fee `1`.
- **Lender capacity:** with `282,443,146,719` raw USDC observed in the lender vault, binary search found `281,384,064,747` as the largest accepted flash borrow at that snapshot; `+1` failed with `IllegalUtilizationRatio` (6026). A composed near-capacity borrow of `281,374,064,747`, plus the `100,000`-raw two-swap DAMM roundtrip, fully repaid with lender-vault delta `0`, no USDP residual, unchanged mint supplies, and a `7,841`-raw borrower loss.
- **Pool reserve:** against a `31,994,477,656`-raw USDC pool vault, a forward swap of reserve minus one was accepted and output `3,104,612,660,947` raw USDP. The reverse returned only `29,240,389,955` raw USDC. The resulting `2,754,087,700`-raw shortfall exceeded the borrower's buffer, so final lender repayment failed and the entire transaction rolled back. The first demonstrated blocker was economic repayment funding, not message size or compute.
- **Repetition:** two `100,000`-raw roundtrips succeeded in `1,098` B / 22 accounts / 9 instructions / `203,502` CU, fully repaid, and doubled the ordinary loss and protocol fees. Four through six cycles reached repayment with insufficient borrower USDC. Seven cycles were the first tested `MaxInstructionTraceLengthExceeded` case (`1,528` B, 19 instructions, `336,595` CU). Twenty-nine cycles encoded in `3,420` B but hit the same runtime trace limit; 30 cycles was rejected locally for exceeding the version-1 64-instruction index space before the 4,096-byte limit.
- **Ordering and aliasing:** the normal borrow → swaps → repay → end order succeeded. Moving a dust swap before borrow or after repay/before end allowed the swap leg to execute, but the overall transaction later failed and rolled back. Wrong-mint output and input-vault-as-user-source aliases failed atomically. Output-to-recorded-output-vault succeeded only as a payer-funded self-transfer: borrower USDC decreased `10,000`, borrower USDP stayed zero, physical output-vault delta was zero, and internal reserve accounting diverged. This did not credit the caller or bypass source authority.

### KLend zero-fee reserve

KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` was specifically selected because the live reserve account's `flashLoanFeeSf` field at offset 4904 decoded to **zero** at slot `457348038`. The zero fee was therefore configured at the reserve, not a dust-rounding artifact. This does not imply that other KLend reserves are fee-free.

The 32-case focused KLend set included 21 primary simulations and 11 threshold/capacity probes. The positive v1 wire SHA-256 was `023710054da7e5fe4cf45881043b8b8ed2130c27eed4e1fb004a7db442e2c04a`; the equivalent legacy wire SHA-256 was `b11e17d56ae56ab5d00e06cdbbb41d7d751114ba60034df903dc057131dfe1f0`. In both, supply vault `8BkQ...` and fee vault `5iLR...` had zero delta after full repayment.

At the lower boundary, 1 raw USDC borrowed, crossed the DAMM instruction, and repaid with zero lender fee; its pool output rounded to zero. Input 2 produced 199 raw USDP and still fully repaid. At matched state, protocol fee was zero at input 100 and one raw unit at input 110, bracketing the observed onset in `(100, 110]`; inputs 120–124 each produced one.

Repeated reverse Swap2 instructions also stayed fully repaid: seven extra reverses fit legacy in `1,225` B and used `233,470` CU; eight fit v1 in `1,292` B and used `251,878` CU. The equivalent eight-repeat legacy encoding was `1,267` raw bytes and was rejected by RPC's 1,232-byte legacy/v0 packet limit. Near-pool cases at `100,000,000`, `1,000,000,000`, `10,000,000,000`, and `31,000,000,000` raw USDC all failed atomically at the reverse swap because accumulated fees/slippage left too little USDP to reacquire the exact repayment amount from the borrower's `716,825`-raw seed. No fully repaid near-reserve KLend path was demonstrated.

### Economic conclusion and non-applicable edges

No composition produced evidence of unauthorized net gain after mandatory lender repayment. The Project 0 roundtrips were explicitly loss-making in raw USDC. The KLend positive path left `16,825` raw USDC and `128,860,687` raw USDP, but that USDP was not independently priced; it is ordinary output from a highly imbalanced pool, so it is not treated as profit, arbitrage, or a drain.

DAMM v2 liquidity is position-NFT based, not fungible-LP mint/burn. Add liquidity uses `Rounding::Up`, remove liquidity uses `Rounding::Down`, and position creation/closure mints/burns exactly one Token-2022 position NFT. The real lender authorities used here had no demonstrated authorized position, so an LP add/remove flashloan composition was not fabricated. Tick-array/CLMM cases are not applicable to this constant-product Swap2 path.

## Source-control review

The reviewed source uses two execution paths: Swap/Swap2 are intercepted by a custom Pinocchio entrypoint, while other instructions use Anchor dispatch. The Anchor `swap` handlers are stubs, making deployed build configuration part of the security boundary.

Controls traced end to end include:

- Swap account validation in `programs/cp-amm/src/instructions/swap/ix_swap.rs:100-199`: fixed pool authority, pool-recorded vaults, vault/mint and token-program relationships, writable token accounts, payer signer, event authority, and referral shape.
- Swap execution in `programs/cp-amm/src/instructions/swap/ix_p_swap.rs:45-245`: validation, access/activation checks, direction, optional same-transaction rate limiter, state application, checked input/output transfers, and referral processing.
- Liquidity removal in `programs/cp-amm/src/instructions/ix_remove_liquidity.rs:27-191`: position/pool/vault/mint binding, position authority, destination restrictions, liquidity and slippage bounds, state update, and vault transfer.
- Position-fee claim in `programs/cp-amm/src/instructions/ix_claim_position_fee.rs:13-127`: equivalent bindings and authority checks, fee update, checked transfer, and fee reset.
- Protocol-fee claim in `programs/cp-amm/src/instructions/operator/ix_claim_protocol_fee2.rs:10-140`: pool-recorded vaults, fixed external PDA, receiver mint/token program, counter reset, and checked transfer.
- Position authorization in `programs/cp-amm/src/state/position.rs:544-612`: NFT owner or explicitly permissioned delegate, zero delegated amount, and owner-ATA enforcement for restricted delegate permissions.

State writes performed before token CPIs remain transaction-atomic under Solana rollback. The current-binary valid-then-invalid simulations independently confirmed that no earlier token deltas survived a later instruction failure.

The duplicate-swap guard applies only when the relevant rate limiter is enabled. Two ordinary authorized swaps in one transaction are otherwise permitted; this was not treated as a double-claim condition. Unchecked instruction-data slicing/account indexing identified in rate-limiter/event parsing can abort the caller's own transaction, but no persistent cross-user denial of service or value movement was found.

## Exact coverage

### Repository/source

- Repository inventory: 195 files.
- Security-target inventory: 122 files under `programs/cp-amm/src` and `rust-sdk/src`.
- On-chain program inventory: 110 files under `programs/cp-amm/src`.
- Fully reviewed baseline: 71 repository files, including 65 of 110 on-chain program source files.
- Architecture mapping additionally covered build/features, constants, initialization variants, reward and admin boundaries, and the Rust SDK quote boundary.
- Files not fully reviewed line by line remain uncovered; no whole-repository completeness claim is made.

Fully reviewed files:

```text
Anchor.toml
Cargo.toml
README.md
keys/local/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json
package.json
programs/cp-amm/Cargo.toml
programs/cp-amm/src/access_control.rs
programs/cp-amm/src/const_pda.rs
programs/cp-amm/src/entrypoint.rs
programs/cp-amm/src/instructions/admin/auth.rs
programs/cp-amm/src/instructions/admin/ix_close_operator_account.rs
programs/cp-amm/src/instructions/admin/ix_create_operator_account.rs
programs/cp-amm/src/instructions/initialize_pool/ix_initialize_customizable_pool.rs
programs/cp-amm/src/instructions/initialize_pool/ix_initialize_pool.rs
programs/cp-amm/src/instructions/initialize_pool/ix_initialize_pool_with_dynamic_config.rs
programs/cp-amm/src/instructions/ix_add_liquidity.rs
programs/cp-amm/src/instructions/ix_claim_position_fee.rs
programs/cp-amm/src/instructions/ix_claim_reward.rs
programs/cp-amm/src/instructions/ix_close_position.rs
programs/cp-amm/src/instructions/ix_create_position.rs
programs/cp-amm/src/instructions/ix_fund_reward.rs
programs/cp-amm/src/instructions/ix_lock_inner_position.rs
programs/cp-amm/src/instructions/ix_lock_position.rs
programs/cp-amm/src/instructions/ix_permanent_lock_position.rs
programs/cp-amm/src/instructions/ix_refresh_vesting.rs
programs/cp-amm/src/instructions/ix_remove_liquidity.rs
programs/cp-amm/src/instructions/ix_split_position.rs
programs/cp-amm/src/instructions/ix_split_position2.rs
programs/cp-amm/src/instructions/ix_update_delegate_permission.rs
programs/cp-amm/src/instructions/ix_withdraw_dead_liquidity_reward.rs
programs/cp-amm/src/instructions/ix_withdraw_ineligible_reward.rs
programs/cp-amm/src/instructions/operator/ix_claim_protocol_fee2.rs
programs/cp-amm/src/instructions/operator/ix_close_config.rs
programs/cp-amm/src/instructions/operator/ix_close_token_badge.rs
programs/cp-amm/src/instructions/operator/ix_create_dynamic_config.rs
programs/cp-amm/src/instructions/operator/ix_create_static_config.rs
programs/cp-amm/src/instructions/operator/ix_create_token_badge.rs
programs/cp-amm/src/instructions/operator/ix_fix_config_fee_params.rs
programs/cp-amm/src/instructions/operator/ix_fix_pool_fee_params.rs
programs/cp-amm/src/instructions/operator/ix_fix_pool_layout_version.rs
programs/cp-amm/src/instructions/operator/ix_initialize_reward.rs
programs/cp-amm/src/instructions/operator/ix_set_pool_status.rs
programs/cp-amm/src/instructions/operator/ix_update_pool_fees.rs
programs/cp-amm/src/instructions/operator/ix_update_reward_duration.rs
programs/cp-amm/src/instructions/operator/ix_update_reward_funder.rs
programs/cp-amm/src/instructions/swap/ix_p_swap.rs
programs/cp-amm/src/instructions/swap/ix_swap.rs
programs/cp-amm/src/instructions/swap/mod.rs
programs/cp-amm/src/instructions/swap/swap_exact_in.rs
programs/cp-amm/src/instructions/swap/swap_exact_out.rs
programs/cp-amm/src/instructions/swap/swap_partial_fill.rs
programs/cp-amm/src/lib.rs
programs/cp-amm/src/liquidity_handler/compounding_liquidity.rs
programs/cp-amm/src/liquidity_handler/concentrated_liquidity.rs
programs/cp-amm/src/liquidity_handler/mod.rs
programs/cp-amm/src/math/safe_math.rs
programs/cp-amm/src/math/u128x128_math.rs
programs/cp-amm/src/math/utils_math.rs
programs/cp-amm/src/pool_action_access/base.rs
programs/cp-amm/src/pool_action_access/mod.rs
programs/cp-amm/src/pool_action_access/permissionless.rs
programs/cp-amm/src/state/config.rs
programs/cp-amm/src/state/fee.rs
programs/cp-amm/src/state/operator.rs
programs/cp-amm/src/state/pool.rs
programs/cp-amm/src/state/position.rs
programs/cp-amm/src/state/token_badge.rs
programs/cp-amm/src/state/vesting.rs
programs/cp-amm/src/utils/alpha_vault.rs
programs/cp-amm/src/utils/p_helper.rs
programs/cp-amm/src/utils/token.rs
```

### Runtime and transaction coverage

- Current ELF fetched and hashed; deployment metadata recorded.
- 8,000 recent successful program transactions canvassed to obtain representative Swap/Swap2, add/remove-liquidity, and position-fee-claim fixtures. The canvass found 8 Swap, 8 Swap2, 1 add-liquidity, 1 partial remove, 8 remove-all, 8 position-fee claims, 0 protocol-fee-2, and 0 reward cases.
- Historical user token accounts had since closed, so 24 direct historical replays were rejected as stale and were not counted as controls.
- A current active position was reconstructed from successful add-liquidity transaction `3Ffif3K277BveQxbUy6GcniP8YiWbS3nKFSG4Ndp9feMReqPdF6atpn5CuQwZmLqtQ3ypau6u3YKmrudxNNXMRft`.
- 33 current-fixture simulations covered positive controls and the requested authority, destination, vault/account, token-program, duplication, ordering, and atomicity mutations.
- 140 Project 0 records covered minimum borrow/input, exact fee onset, maximum lender utilization, near-capacity full repayment, near-pool-reserve rollback, repeats, ordering, aliases, transaction size, compute, and instruction-trace boundaries. Of these, 96 were successful RPC simulations, 43 were failed RPC simulations, and one was a local composition-limit rejection.
- 32 focused KLend simulations covered the live zero-fee reserve, dust and fee thresholds, v1/legacy equivalence, repeated swaps, legacy packet size, and four near-pool-reserve attempts.
- 3 Marginfi source-shape v1 simulations covered the real cross-program instruction sequence with its original profit guard, without the guard, and with a repayment buffer. In total, the current-state campaigns recorded 208 main and flash-composition cases, plus the 24 stale historical replays kept separate above.
- No reward-claim positive control or reward mutation matrix was run; rewards were not one of the three required value-moving families.

## Blockers and residual uncertainty

1. **Exact binary/source match:** no verified build, locked toolchain/dependency attestation, or reproducible ELF comparison ties commit `5398b5c...` to SHA-256 `967ff9fb...`. Binary strings are supporting evidence only.
2. **External protocol-fee policy:** the live receiver-policy path in `pFee3tb7...` was not in the authorized source scope. The cp-amm simulation modeled its PDA signer but did not prove an attacker can obtain that signature.
3. **Partial source review:** 65/110 on-chain source files were fully reviewed line by line; architecture mapping is broader but not equivalent to complete review.
4. **Partial custody:** top-100 priced custody plus 44 unpriced vaults is not full exposure. The original observation artifact was lost and the supplied population count was not reconciled with the later account-size query.
5. **Point-in-time state:** all simulations depend on mutable mainnet account state at their context slots. They do not prove behavior for every pool, mint extension, position/delegate state, or fee configuration.
6. **Signature modeling:** `sigVerify=false` is appropriate for read-only branch testing, but a simulation success under a modeled signer proves program behavior only; it does not prove that signer is forgeable live.
7. **Economic residuals:** no independent same-slot price source was used for cross-mint residuals. The report therefore makes no profit claim from a positive non-borrowed-token balance and no drain claim without unauthorized net gain after full repayment.
8. **Position liquidity composition:** LP mint/burn is not a fungible-LP operation here. The selected real lender authorities had no demonstrated authorized position NFT, so add/remove-liquidity flash composition was not exercised.

## Evidence artifacts

- `damm-v2-current.so` — fetched deployed ELF.
- `damm-v2-current-probe.js` — read-only simulation harness; contains no send path.
- `damm-v2-current-simulations.json` — complete simulation inputs/results and token-account deltas.
- `damm-v2-current-probe.stdout` / `damm-v2-current-probe.stderr` — execution transcript.
- `damm-v2-protocol-fee-discovery.js` — read-only fixture discovery.
- `damm-v2-project0-flash-stress.js` / `.json` — 140-case real-v1 Project 0 flashloan stress harness and evidence; JSON SHA-256 `058a9aa8da72885ca234f7d9737f5aaeb6288775352637c7aa9018fe784ce36f`.
- `damm-v2-marginfi-v1-composition.js` / `.json` — real-mainnet Marginfi composition reconstruction and current v1 simulations.
- `marginfi-damm-v2-real-composition-source-51rk.json` — captured source transaction for the independent Marginfi path.
- `kamino-flash-history.json`, `damm-v2-usdc-usdp-source-WDcr.json`, `klend-v1-composition.js`, and `klend-zero-fee-simulations.json` — KLend source fixtures, v1 encoder reference, and live zero-fee reserve evidence. The final 32-case focused extension was run ephemerally and is recorded in this report; no additional transaction was submitted or cache created.
- `damm-v2-source/` — clean source checkout at commit `5398b5c7c534de014091132da37c6478cce671a8`.

## Final assessment

The requested current-binary mutation campaign produced valid positive controls for swap, liquidity withdrawal, position-fee withdrawal, and protocol-fee withdrawal. Authority, vault/account binding, and token-program mutations were rejected; duplicate and order tests behaved as authorized sequential execution; later failure rolled back earlier effects. The one permissive destination alias caused a caller-funded donation/accounting surplus, not an unauthorized vault debit.

Project 0, KLend, and Marginfi compositions also proved that real atomic lender → DAMM → repayment paths fit current Solana v1 limits and can complete with full repayment. Boundary failures rolled back, and successful repeats accumulated ordinary loss/fees rather than unauthorized gain. KLend's selected reserve was genuinely configured with zero flash fee; this did not create a demonstrated profitable or unauthorized extraction path.

Accordingly, this tranche has **zero reportable findings**. It would be unsound to convert that result into a “no vulnerabilities” or “no drain possible” claim because the exact deployment build, external fee-authority program, complete source inventory, and full custody population remain unresolved.
