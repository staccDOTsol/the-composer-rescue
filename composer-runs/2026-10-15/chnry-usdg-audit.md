# Chancery USDG mainnet outsider-gain audit — 2026-10-15

## Verdict

**No outsider-accessible unauthorized net asset gain was reproduced in the current mainnet program.**

The audit found no critical, high, medium, or low-severity outsider asset-loss issue. Five Chancery outsider cases all failed authorization or canonical-account checks and produced zero atomic balance change. The required real Solana v1 KLend flash-borrow composition succeeded only as an authorized-operator control and ended with zero USDG/USDv value delta, zero KLend fee, zero outstanding flash liability, and zero net equity. A 2.5M USDG near-liquidity stress also fully unwound to zero.

This is a point-in-time, evidence-backed security assessment, not a proof that no bug exists. The main residual trust assumption is privileged upgrade control: the program remains upgradeable under a non-null upgrade authority. That is an operator/governance trust boundary, not an outsider-accessible vulnerability in the audited executable.

| ID | Severity | Status | Result |
|---|---:|---|---|
| CHNRY-OUTSIDER-001 | — | Not found | No tested outsider path produced positive net equity after liabilities. |
| CHNRY-TRUST-001 | Informational | Open by design | ProgramData has a live upgrade authority, so a future upgrade can change all conclusions. |

## Scope and exact target

- Program: `ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz`
- Main vault: `6gXnsjMkrgC7zKsniUFPasEnPRVSecH3AwoKWjUTdXHg`
- Reserve authority PDA: `8anxfyoftY9hPwxdvReet2beFS2HXjcXraPEamo4nGyB`
- USDG mint: `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH`
- USDv mint: `USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk`
- Historical direct outflow: slot `456023812`
- Final state observation: `2026-10-15T19:49:25.980Z`, slot `457356505`
- Final simulation batch began: `2026-10-15T19:49:38.821Z`; each result records its own simulation and baseline slot.
- Safety boundary: read-only RPC calls and `simulateTransaction` only. No transaction was submitted and no project/operator contact was made.

## Executable, source, and IDL provenance

The current program is executable and owned by the upgradeable BPF loader. Its ProgramData account is `BWgWFgZxxF2ndC9PgKS5Fa8c2Nv3PUS34mGbvuBw95Ln`, deployment slot `444033132`, with upgrade authority `934modVoNj5TUV69Ub3YXJAvGxWvpqRiHAydTadJxA2L`.

The dumped ProgramData payload is 1,039,312 bytes with SHA-256:

`fda96ab287bbd8b17f795f49e24693a0354bde874a9cf5f66a2ac4b6022c9f71`

The published `chancery-v1.0.1` release artifact is 1,036,752 bytes with SHA-256:

`1460e69a8e0330a67d73556e6c7690a1b449d54e7e1c3f3f6ab638768c714830`

The deployed payload begins byte-for-byte with that artifact; its remaining 2,560 bytes are all zero loader padding. ProgramData address, deployment slot, upgrade authority, full payload digest, release digest, prefix equality, and zero padding all matched the published integrity record. This pins the reviewed source to commit `0dafa95d1aded954de098208f0f515d436aa496c`, tag `chancery-v1.0.1`. The checked-in IDL hash is `8a0bf05c739af32cb15dfec02be5680b9e28813185afebd0f90b4237019e1002`.

The exact source checkout's library suite passed: **1,005 passed, 0 failed, 0 ignored** (`cargo test -p chancery --lib`). Tests support, but do not replace, the live-state and adversarial simulation evidence.

## Live configuration and value at risk

- The USDG vault held `8,082,639.810000` USDG and is a Token-2022 account owned by the derived reserve-authority PDA.
- Reserve-authority derivation matched the expected address.
- Global pause bits were zero. Core, events, permissions, pathway, settlement, limits, evidence, fees, reserve, control, and issued-token-control modules were active. Migration and cross-chain modules were disabled.
- The direct pathway is active and binds the USDG and USDv mints.
- Deposit and redeem rates are both `1,000,000,000` e9, i.e. 1:1.
- Minimum mint/redeem amount: `1,000` tokens (`1,000,000,000` raw units).
- Maximum single settlement: `500,000` tokens (`500,000,000,000` raw units).
- No fee policy is attached to this pathway.
- Pathway limits include 2M per transaction, 6M per hour, 50M per day, 750M per seven days, and 1.45B per thirty days. The stricter asset-config 500k single-settlement cap wins for each tested controller action.
- The permission census found 20 current permission records and exactly one record scoped to this pathway. Subject `GLKCuotKSjPtQhxHmf6q8GUkw6tUZnzs8W5vEbxdaBdK` holds `CAN_MINT_DIRECT | CAN_REDEEM_DIRECT`; an arbitrary outsider does not.

## Historical slot 456023812

Signature `32sBxLB3zYh4efsMnBPnsCNdEenL2zfnjk48q8YVxAV9cXDZT44AFHiyHnvbypwq724uy94Jg9k2qRjKpiwqovXX` invoked discriminator `04 02`, decoded as `redeem_direct`, for `20,808` USDv with a `20,808` minimum USDG output.

Observed token deltas were exact and value-neutral at the configured 1:1 rate:

| Account role | Token delta |
|---|---:|
| Operator USDv source | -20,808 USDv |
| Chancery USDG vault | -20,808 USDG |
| Operator USDG destination | +20,808 USDG |

The principal signed, used the canonical pathway-scoped permission record, and is the sole current subject with direct mint/redeem roles for this pathway. This is an authorized conversion/control, not evidence of outsider extraction.

## Reverified zero-fee KLend inventory

The prior census had 28 candidate USDG reserves. At slot `457356505`, all 28 still passed the current checks: KLend ownership, USDG mint, active status, emergency mode off, exact zero flash-fee scaled fraction, canonical supply/fee vault addresses, and matching vault mints.

- Aggregate current available and conservative borrowable ceiling: `5,690,289.663674` USDG.
- Selected reserve: `ESCkPWKHmgNE7Msf77n9yzqJd5kQVWWGy3o5Mgxhvavp`.
- Lending market: `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`.
- Supply vault: `DGBo8HmL7pBWBZLGePjHQ73JKRE37HVZ7ZbjA2FYUZHZ`.
- Fee vault: `39M8hy7EUypjxsHqsZQmNQqXGpknCwoCXzF7r8WMBbAs`.
- Selected reserve current available/borrowable: `3,153,959.608819` USDG.
- Flash-fee scaled fraction: exact zero.

Live liquidity changes between state capture and individual simulations. Each result therefore records its own pre/post token amounts and same-slot no-op baseline rather than treating the census number as immutable.

## Adversarial simulation results

All 35 cases used real current mainnet accounts and program executables. Failed Solana transactions are atomically rolled back; the accounting layer explicitly assigns their committed deltas as zero. Every case values USDG and USDv at the program's configured 1:1 conversion rate and subtracts any unpaid flash principal/fee before deciding whether net equity is positive.

| Test family | Result |
|---|---|
| Outsider direct mint and redeem | Both rejected at canonical permission ownership/PDA validation; zero delta. |
| Outsider principal + operator permission | Rejected with `PermissionScopeMismatch`; zero delta. |
| Operator principal + outsider-derived permission | Rejected with `AccountOwnerMismatch`; zero delta. |
| Destination substitution | Rejected with `AccountKeyMismatch`; operator cannot redirect redemption to an outsider. |
| Reserve-vault substitution | Rejected with `InvalidPda`; KLend's USDG supply vault cannot replace Chancery's canonical reserve ATA. |
| Reserve/mint PDA substitution | Rejected by `PrivilegeEscalation` or `AccountKeyMismatch`; CPI signing authority cannot be swapped. |
| Mint aliasing and protocol-state principal | Rejected with `AccountAliasNotAllowed`; source also forbids all 12 protocol signer PDAs as external identities. |
| Missing instruction signer | Rejected with `AccountNotSigner`. |
| Dust: 0, 1 raw unit, minimum−1 | Rejected with `AmountBelowMinimum`. |
| Maximum+1 and vault-scale values | Rejected with `AmountExceedsMaximum`. |
| Authorized mint→redeem and redeem→mint controls | Succeeded, but all subject/vault/mint-supply value deltas were zero. |
| KLend missing repay | Rejected with custom error 6032; atomic zero delta. |
| Repay before borrow / wrong borrow index | Rejected with custom error 6033; atomic zero delta. |
| Two flash cycles in one transaction | Rejected with custom error 6035; atomic zero delta. |
| Mint→repay→redeem ordering | Repay failed for insufficient funds; entire transaction rolled back. |

No tested success created value. No tested failure left a partial transfer, mint, burn, usage-window mutation, or unpaid-liability gain committed.

## Required real Solana v1 composition

The builder serializes exact Solana transaction **version 1** wire messages directly, with the 4,096-byte limit enforced and no address lookup table. It uses the live KLend instruction/account shape and Chancery's current accounts; it is not a mock or a v0 substitute.

| Composition | Wire / accounts / instructions | Compute | Outcome after liabilities |
|---|---:|---:|---|
| KLend flash → authorized mint → authorized redeem → repay, 1,000 USDG | 1,437 bytes / 34 / 4 | 282,083 CU | Success; all watched token and mint-supply deltas 0; liability 0; net equity 0. |
| KLend flash → authorized redeem → authorized mint → repay, 1,000 USDG | 1,437 / 34 / 4 | 282,173 CU | Success; net equity 0. |
| Same path at exact 500,000 controller cap | 1,437 / 34 / 4 | 282,141 CU | Success; net equity 0. |
| Same path at cap+1 | 1,437 / 34 / 4 | 91,833 CU | `AmountExceedsMaximum`; atomic zero delta. |
| KLend flash → outsider mint → outsider redeem → repay | 1,437 / 34 / 4 | 81,946 CU | Rejected at controller permission; atomic zero delta. |
| 2.5M flash → five 500k mints → five 500k redeems → repay | 2,117 / 34 / 12 | 1,052,331 CU | Success; full unwind; fee 0; liability 0; net equity 0. |

The required composition is comfortably below 4,096 bytes. The stress case temporarily moves 2.5M USDG into the Chancery vault, remains below selected KLend liquidity, exercises the per-action maximum five times, and still cannot manufacture equity.

Simulation used `sigVerify: false` with blank signature bytes because no signer secrets were requested or used. This preserves instruction-level signer metadata and all Chancery/KLend authorization checks, but it does not prove possession of the operator key. Accordingly, every successful operator path is classified only as a positive control. The outsider actor is an existing on-curve System-owned address with USDG accounts; granting that actor transaction signer metadata models what a real outsider can sign for themselves and does not grant the canonical permission PDA.

## Source review

The current binary/source pin makes the following static checks attributable to the live executable:

- Direct redemption requires an external signer, the canonical active direct pathway, argument/pathway binding, a canonical pathway-scoped `CAN_REDEEM_DIRECT` record, the canonical reserve ATA, and principal-owned source/destination token accounts before value leaves the vault.
- Direct mint applies the symmetric signer/permission/account bindings, measures actual reserve credit, and only then mints USDv under the fixed mint-authority PDA.
- Asset conversion uses checked `u128` multiplication/division and checked narrowing. Configuration enforces `deposit_rate_e9 × redeem_rate_e9 ≤ 10^18`, preventing a profitable mint/redeem round trip by construction. Current rates are exactly 1:1.
- Redemption burns USDv before the PDA-signed USDG transfer. Any later error reverts the whole Solana transaction.
- Reserve withdrawal is a separate privileged surface: governance/operations authority or an exact destination-scoped `CAN_WITHDRAW_RESERVE` signer is required; the destination, mint, owner, canonical vault, per-transaction cap, and daily cap are all bound before the PDA-signed transfer.
- The protocol explicitly rejects its 12 `invoke_signed` PDA identities as external principals/authorities, closing the generic CPI-PDA-as-user class.
- Delegated and trilateral settlement paths add executor/principal permissions and signers; they do not remove the canonical bindings.
- There is no share-price or claim-token accounting surface in the active direct pathway. The analogous issuance claim is USDv, covered by the checked rate invariant and mint/redeem simulations. Cross-chain claim/reclaim code is present but the module is currently disabled; static review found canonical policy, nonce, recipient, message-hash, quorum, and one-shot reclaim bindings.

Key reviewed source locations:

- `chnry-usdg-source/programs/chancery/src/account_security.rs`
- `chnry-usdg-source/programs/chancery/src/modules/permissions/auth.rs`
- `chnry-usdg-source/programs/chancery/src/modules/settlement/instructions/mint_direct.rs`
- `chnry-usdg-source/programs/chancery/src/modules/settlement/instructions/redeem_direct.rs`
- `chnry-usdg-source/programs/chancery/src/modules/core/state/asset_config.rs`
- `chnry-usdg-source/programs/chancery/src/modules/reserve/instructions/withdraw_reserve.rs`
- `chnry-usdg-source/programs/chancery/idl/idl.json`

## Reproduction and evidence files

From `/Users/stacc/the-composer-rescue`:

```sh
node composer-runs/2026-10-15/chnry-usdg-current-state.js
node composer-runs/2026-10-15/chnry-usdg-v1-composition.js
```

Both scripts read the endpoint from `/tmp/composer-helius-rpc.env`, never print the RPC key or full URL, use only read/simulate RPC methods, and set `noSubmission: true` in their outputs.

- `chnry-usdg-current-state.js` — ProgramData/ELF, live configuration, permissions, historical transaction, and KLend census collector.
- `chnry-usdg-current-state.json` — final machine-readable state snapshot.
- `chnry-usdg-v1-composition.js` — exact v1 wire builder and 35-case simulation harness.
- `chnry-usdg-v1-simulations.json` — full transaction hashes, dimensions, slots, errors, logs, pre/post accounting, liabilities, and conclusions.
- `chnry-usdg-current.so` — exact padded current ProgramData payload.
- `chnry-usdg-source/` — pinned official source and IDL at `chancery-v1.0.1`.
- `chnry-usdg-integrity-records/` — pinned official deployment/integrity records.
- `chnry-usdg-audit-receipt.json` — compact conclusion and artifact hashes.

## Limitations

- Results apply to the executable and state observed on 2026-10-15. Upgrades, permissions, rates, limits, module activation, token extensions, and lending liquidity can change.
- Read-only simulation cannot establish private-key possession and cannot reproduce validator/network effects outside Solana execution semantics. It is appropriate here for authorization, account binding, arithmetic, atomicity, ordering, and balance-delta testing.
- The 35 cases are targeted adversarial coverage, not exhaustive state-space exploration or formal verification.
- An app-backed standard security-scan entry point was attempted twice but aborted because its selected target changed while starting. This report therefore relies on the independently captured binary, pinned source/IDL, live state, source review, tests, and direct mainnet simulations described above.

## Final assessment

The current mainnet Chancery USDG/USDv pathway presents a large operator-authorized conversion surface, but the tested outsider cannot borrow authorization by substituting accounts or PDAs, cannot exploit dust/capacity arithmetic, cannot keep a KLend flash loan unpaid, and cannot use same-transaction ordering to retain value. The only successful high-value compositions were authorized controls and every one ended at zero net equity after liabilities. **No reportable outsider-accessible unauthorized net asset gain was found.**
