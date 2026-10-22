# PRIME Controller Current-Binary Asset-Gain Audit

## Verdict

**No reportable outsider asset-gain finding.** Across the current executable, live account state, exact matched source, and 27 current-mainnet read-only simulations, no unprivileged path finished with positive outsider PRIME equity after flash principal, fees, protocol balances, debt fields, and collateral-share supply were reconciled.

The exact 4,096-byte Solana v1 authorized control completes and returns every watched asset/debt/share field to its starting value. Replacing the authenticated OffRamp PDA with the outsider signer produces Anchor `ConstraintSeeds` (2006) and atomically rolls back.

## Scope and method

- Program: `8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC` (Chainlink `lockrelease-token-pool 1.6.2`).
- Mainnet observations: state slots 457353266/457353266; simulation pre-slot 457353278; individual simulation slots are recorded in the JSON evidence.
- Reporting rule: only positive outsider equity after all liabilities is a finding. Administrative owner, router, OffRamp, rebalancer, rate-limit-admin, and upgrade-authority actions are controls.
- Validation: current mainnet account reads plus `simulateTransaction` with `sigVerify:false`; no live transaction, operator contact, or state mutation.

## Program and source identity

The on-chain IDL account identifies `lockrelease_token_pool` version `1.6.2`, and the current binary's `type_version` simulation returns `lockrelease-token-pool 1.6.2`. The official `solana-v1.6.2` ELF (621,200 bytes; SHA-256 `f4bd641b36a76a2de6e06777001e806cf3e9380f1305b33386040431fd3e2347`) is byte-for-byte the prefix of the dumped mainnet allocation; all 2,524,528 remaining allocation bytes are zero. Reviewed source commit: `9546a59bd0a3cee4ddc8ae4042da533e62225b78`.

## Live custody and liquidity

| Item | Current value |
|---|---:|
| PRIME vault | `4pQktybtQuVmqavFui8rmC21CtEEZxtgM9q3YGFNwPDd` |
| Vault authority | `AjKrG87tF3rFNvW1U4Ja8pZ8KsQ1LLiDjiF79G9xj3a7` |
| Vault PRIME | 9455415.978148 (9455415978148 raw) |
| Vault delegate / delegated raw | none / 0 |
| Vault close authority | none |
| KLend reserve | `BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh` |
| Realistic flash liquidity | 84772939.811234 PRIME (84772939811234 raw) |
| Flash fee scaled fraction | 0 (exact zero) |
| Rebalancer / liquidity enabled | system default / false |

## All custody-relevant instructions

| Instruction | Asset effect | Outsider-relevant controls |
|---|---|---|
| `release_or_mint_tokens` | PRIME leaves the pool vault | OffRamp authority PDA, router-owned allowed-OffRamp PDA, pool state/mint/signer/vault and chain PDAs, RMN accounts, canonical receiver ATA, configured source pool, token, rate limit, and amount conversion |
| `withdraw_liquidity` | PRIME leaves the pool vault | configured rebalancer signer plus `can_accept_liquidity`; live values disable the path |
| `provide_liquidity` | PRIME enters the pool vault | same rebalancer and flag; not an outflow |
| `lock_or_burn_tokens` | locking/event path; no vault outflow in this program | configured router onramp authority and bound state/chain accounts |
| Administrative configuration / upgrade | may change future authority or policy | privileged owner, rate-limit admin, or upgrade authority; excluded unless outsider authority acquisition is shown |

The 25-instruction IDL exposes only `PoolConfig`, `State`, and `ChainConfig` accounts. There is no claim, receipt, share, debt, order, oracle, or price account in this program. PRIME's configured remote and local decimals are both six, so the live route does not enter a decimal down-rounding branch. Amounts above `u64::MAX` fail conversion (6009). A privileged double-release control confirms the pool itself owns no message nonce, but the same call with outsider authority fails immediately; replay/order authorization remains at the authenticated OffRamp boundary.

## Exact 4,096-byte flash composition

Sequence: KLend borrow → padding memo → SPL transfer to controller vault → controller release to receiver ATA → KLend full repay.

| Property | Authorized OffRamp control | Outsider signer attempt |
|---|---:|---:|
| Serialized v1 bytes | 4096 | 4096 |
| v0-equivalent bytes | 4083 | 4083 |
| Padding bytes | 2878 | 2974 |
| Addresses / instructions | 23 / 5 | 22 / 5 |
| Required signatures | 2 | 1 |
| Result | success | atomic `ConstraintSeeds` 2006 at release authority |
| Outsider token delta | 0 raw | none committed |
| Controller vault delta | 0 raw | none committed |
| KLend supply / fee delta | 0 / 0 raw | none committed |
| Reserve available / debt delta | 0 raw / 0 sf | none committed |
| Collateral-share / mint-supply delta | 0 / 0 raw | none committed |

The authorized simulation's inbound rate bucket increased because the stale pre-snapshot bucket refilled by elapsed time before consuming the one-PRIME release. That rate-limiter bookkeeping is not an asset, liability, or outsider gain.

## Simulation matrix

| Case | v1 bytes | Result |
|---|---:|---|
| `flash_pair_zero` | 531 | Success; exact asset/debt/share deltas zero |
| `flash_pair_one_raw` | 531 | Success; exact asset/debt/share deltas zero |
| `flash_pair_one_prime` | 531 | Success; exact asset/debt/share deltas zero |
| `flash_one_raw_no_repay` | 498 | Atomic failure: NoFlashRepayFound (6032) |
| `flash_one_prime_underpay` | 531 | Atomic failure: InvalidFlashRepay (6033) |
| `flash_one_prime_wrong_repay_index` | 531 | Atomic failure: InvalidFlashRepay (6033) |
| `flash_pair_near_available` | 531 | Success; exact asset/debt/share deltas zero |
| `flash_pair_exact_available` | 531 | Success; exact asset/debt/share deltas zero |
| `flash_pair_over_available` | 531 | Atomic failure: InsufficientLiquidity (6008) |
| `controller_roundtrip_one_raw_control` | 1182 | Success; exact asset/debt/share deltas zero |
| `controller_roundtrip_one_prime_control_v1_4096` | 4096 | Success; exact asset/debt/share deltas zero |
| `controller_roundtrip_one_prime_outsider_authority_v1_4096` | 4096 | Atomic failure: ConstraintSeeds (2006) |
| `controller_roundtrip_wrong_offramp_program` | 1086 | Atomic failure: ConstraintSeeds (2006) |
| `controller_roundtrip_allowed_offramp_substitution` | 1150 | Atomic failure: ConstraintSeeds (2006) |
| `controller_roundtrip_state_substitution` | 1182 | Atomic failure: AccountDiscriminatorMismatch (3002) |
| `controller_roundtrip_pool_signer_substitution` | 1150 | Atomic failure: ConstraintSeeds (2006) |
| `controller_roundtrip_pool_vault_substitution` | 1182 | Atomic failure: ConstraintAddress (2012) |
| `controller_roundtrip_receiver_account_mismatch` | 1182 | Atomic failure: ConstraintAddress (2012) |
| `controller_roundtrip_invalid_source_pool` | 1182 | Atomic failure: InvalidSourcePoolAddress (6007) |
| `controller_roundtrip_wrong_chain_selector` | 1182 | Atomic failure: ConstraintSeeds (2006) |
| `release_zero_amount_control` | 875 | Success; exact asset/debt/share deltas zero |
| `release_u64_overflow_control` | 875 | Atomic failure: InvalidTokenAmountConversion (6009) |
| `release_double_control_no_pool_nonce` | 1110 | Success; exact asset/debt/share deltas zero |
| `release_double_outsider_authority` | 1014 | Atomic failure: ConstraintSeeds (2006) |
| `withdraw_liquidity_outsider` | 397 | Atomic failure: Unauthorized (6002) |
| `withdraw_liquidity_configured_rebalancer_control` | 493 | Atomic failure: LiquidityNotAccepted (6020) |
| `provide_liquidity_outsider` | 397 | Atomic failure: Unauthorized (6002) |

Missing repayment fails with `NoFlashRepayFound` (6032). Underpayment and wrong borrow-index repayment both fail with `InvalidFlashRepay` (6033). Borrowing exactly the live realistic liquidity succeeds with full reconciliation; one raw unit more fails `InsufficientLiquidity` (6008).

## Conclusion and limitations

Account/PDA substitutions, receiver mismatch, source-pool mutation, wrong chain selector, outsider replay, liquidity exits, integer overflow, missing repay, underpay, wrong repay index, and the full-liquidity boundary did not produce positive outsider equity. The conclusion is target-specific and current-state-specific, not a guarantee about future upgrades or privileged configuration changes.

- Simulations use `sigVerify:false` so an authorized-PDA positive control can be modeled without operator keys. The outsider case requires only the outsider signer and fails in current-binary account validation.
- No live submission occurred. Failed simulations have no committed post-state by Solana atomicity.
- The broad repository snapshot outside this executable, exact source, relevant live accounts, and target-specific tooling was not audited.
- The user-supplied USD mark was not needed for exploitability and was not independently repriced.

## Evidence

- `prime-controller-validation.json`: machine-readable verdict, assertions, exact composition, and all case results.
- `prime-controller-identity.json`: binary, IDL, release artifact, and source-commit binding.
- `prime-controller-state.json`: live state, vault authority details, KLend reserve, chain config, and successful historical exits.
- `prime-controller-simulations.json`: full logs, pre/post snapshots, and reconciled deltas for all 27 cases.
- `prime-controller-identity.js`, `prime-controller-runtime-probe.js`, `prime-controller-state.js`, and `prime-controller-simulate.js`: reproducible read-only/offline tooling.
