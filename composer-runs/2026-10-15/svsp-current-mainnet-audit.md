# Exact-current mainnet security audit: SPL Single-Validator Stake Pool

Program: `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`  
Observation date: 2026-10-15 (America/Toronto)  
Threat model: unprivileged outsider; one atomic Solana v1 transaction; all required signatures valid; flash principal, fees, and temporary positions fully repaid/reconciled; no mainnet submission.

## Executive result

**No current outsider drain was validated under the required signed-and-repayable standard.** The validated net exploitable amount is therefore `0 SOL` in this audit—not because the program is free of dangerous behavior, but because neither plausible behavior could be completed with current authorization and liquidity state.

| ID | Behavior | Current status | Why it is not a validated drain |
|---|---|---|---|
| SVSP-CAND-01 | `ReplenishPool` moves value that v4 pricing excludes | Accounting transfer reproduced; outsider flash route not validated | The successful diagnostic used two unavailable live user signatures. Fresh SOL cannot become already-active same-validator stake in the same transaction; current exact-mint flash capacity is zero; Jupiter returned no entry or exit quote for any of 57 mints. |
| SVSP-LATENT-02 | `DepositStake` and `WithdrawStake` consume pre-existing bearer authorizations | Real design hazard; current exposed state is below executable conditions | There are no noncanonical Stake accounts with both required authorities. All 34 delegated token accounts are individually below the one-SOL Stake split threshold, and no exact-mint flash top-up source exists. |
| TRUST-01 | Program remains upgradeable | Trust fact, not an outsider finding | The upgrade authority is `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz`. |

This report deliberately does **not** promote the 1.350755502 SOL theoretical onramp ceiling, the 1,726,736-lamport diagnostic transfer, vault custody balances, or failed multi-provider envelopes into a reportable outsider drain.

## Validation standard and safety boundary

A route counts as validated only if it has all of the following:

1. exact current deployed program and account state;
2. valid Ed25519 signatures (`sigVerify:true`) or a precise proof that the unavailable signature is the blocker;
3. a single signed Solana v1 transaction within 4,096 bytes and 64 total addresses;
4. current, independently sourceable assets—not merely tokens visible in a vault;
5. complete borrow, exploit action, unwind, fee payment, repayment, and state reconciliation;
6. positive outsider net value after rounding and fees.

No transaction was submitted to mainnet. Mainnet interaction was read-only RPC plus `simulateTransaction`; signed execution was confined to an isolated Surfpool exact-account clone. No RPC endpoint, API key, or private key is persisted in the evidence.

## Deployed program and source provenance

- ProgramData: `CnA41uYcs8X64x4PAhoPooN1yo1vabvbb64eJe9H8SZJ`.
- Last deployment slot: `408388782`, block time `2026-03-23T19:19:23Z`.
- Allocated payload: 254,256 bytes, SHA-256 `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4`.
- The locally captured `.so` is byte-identical to that deployed payload.
- Official source: [solana-program/single-pool](https://github.com/solana-program/single-pool), release [`program@v4.0.1`](https://github.com/solana-program/single-pool/releases/tag/program%40v4.0.1), commit `3921ea5f63198b9a4f8d1ac9fcf24d5ca612a10a`.
- The deployed first 234,664 bytes exactly match the official v4.0.1 release asset, SHA-256 `217300596e04cf21d9e613fdac3cfefa5ada9456a36b9fc79303fac5fe192f8d`; the remaining 19,592 deployed bytes are zero padding.

This is strong deployed-binary/release provenance, not a locally reproducible-build proof. `cargo test -p spl-single-pool --lib` was blocked before compilation by the installed Rust toolchain: `missing manifest in toolchain '1.90.0-aarch64-apple-darwin'`. The source worktree remained clean and detached; the toolchain was not replaced or silently substituted.

## Finalized live census and custody

The authoritative census used finalized commitment over slots `457363054..457363107`, with 125 successful reads and zero failed reads.

- 57/57 pool accounts are canonical vote-derived PDAs.
- All 57 canonical main Stake accounts, onramps, mints, stake authorities, and mint authorities exist and derive correctly; every PDA is off-curve.
- Every main/onramp Stake account has the canonical stake-authority PDA as both staker and withdrawer.
- All 57 mints are classic `Tokenkeg` mints, initialized, nine decimals, canonical mint authority, null freeze authority, and no Token-2022 transfer-fee extension.
- 2,460 token accounts were enumerated by mint; every mint supply reconciles exactly to its token accounts.
- Canonical Stake custody: `37,502.073558711 SOL`.
- Onramp custody: `2.723915308 SOL`.
- Correct canonical-plus-onramp custody, counted once: **`37,504.797474019 SOL`**.
- Aggregate mint supply: `34,964.170136839` nine-decimal pool tokens.

Two HHZn accounts totaling `0.495391942 SOL` have only the withdrawer set to the canonical PDA and a user staker. They are not canonical/onramp custody and cannot pass the program's exact requirement that both authorities equal the PDA. The earlier `37,508.016... SOL` figure is rejected because it double-counted onramp value and included those partial-authority accounts.

## Relevant program behavior

The seven-instruction dispatcher is exhaustive. The security-relevant paths are:

- `ReplenishPool`: permissionless after canonical account checks. It may move fully effective onramp stake into the main Stake account, move main excess lamports back to the onramp, and delegate/re-delegate canonical custody.
- `DepositStake`: rejects canonical main/onramp aliases, requires both source Stake authorities to equal the pool stake-authority PDA, requires active/activating parity, and relies on native Stake merge checks for validator and lockup compatibility. It mints pool tokens to an arbitrary supplied token account and returns only source-contributed excess lamports to an arbitrary supplied lamport account.
- `WithdrawStake`: burns from one supplied token account using the pool mint-authority PDA, immediately splits main stake into one blank Stake account, then assigns both new Stake authorities to the arbitrary pubkey encoded in instruction data.

The library helpers create atomic authorization sequences, but the on-chain program does not prove that the grants were issued adjacently or in the same transaction:

- Deposit helper: Stake authorize staker, Stake authorize withdrawer, then `DepositStake`.
- Withdraw helper: SPL approve, then `WithdrawStake`.

A later official commit, [`e9aeda0c`](https://github.com/solana-program/single-pool/commit/e9aeda0ce752e44ed23fc5858d966b4a7b6faec8), explicitly documents both theft cases and tells integrators to keep authorize/approve atomic. That corroborates the bearer-capability interpretation; it does not make the present live capabilities executable.

## SVSP-CAND-01: Replenish changes value outside v4 pricing

Let:

- `S` be current mint supply;
- `M` be main delegated stake minus the one-SOL bootstrap exclusion;
- `D` be deposited delegated stake;
- `R` be fully effective onramp stake moved into main by Replenish;
- `T` be minted/burned pool tokens.

The v4 formulas are:

```text
T = floor(D * S / M)
W = floor(T * (M + D + R) / (S + T))
```

Ignoring floors, `W - D = D*R/(M+D)`, approaching `R` as capital grows. The pricing denominator excludes both onramp value and main-account excess lamports. A later official change, [`7a180647`](https://github.com/solana-program/single-pool/commit/7a180647336b0a1fceafdeb7d0168e38184e8ce0), changes accounting to main plus onramp lamports less rent; this corroborates the boundary, although the commit is not labeled as a security fix.

### Current envelope

Epoch-field screening found 11 same-vote, compatible-meta onramps with active-looking fields, totaling `R = 1.350755502 SOL`. That total is an asymptotic gross ceiling, not available profit. At `D = 1 SOL` per pool, the 11 separate floor-adjusted profits total only `0.005457055 SOL`.

The highest current ratio is pool `2A172EkPfeQchU4uKuTd3e6Mk2LqwsTZF6sALRCQbzZj`, mint `77YLpVLQXr2KU66GM2JykbT9g5du7LarWgehbWD3CJaB`:

- `M = 0.059284668 SOL`;
- `R = 0.001726740 SOL`;
- `R/M = 2.912624897%`;
- `S = 0.018554276` tokens;
- a one-SOL modeled deposit returns `1.001630099 SOL` after Replenish and withdrawal;
- absolute asymptotic ceiling: `0.001726740 SOL`.

The 11-pool screen used activation/deactivation epoch fields because the live endpoint lacked `getStakeActivation`; it is not a claim that every row can merge. The exact `2A172...` path below did successfully execute Replenish in simulation and therefore supersedes that limitation for this one pool at its simulation slot.

### Exact accounting diagnostic

At slot `457363403`, an exact-state `DepositStake -> ReplenishPool -> WithdrawStake` transaction succeeded under `sigVerify:false`:

- v1 wire: 1,106 bytes, 19 addresses, seven instructions, three required signatures;
- compute: 239,519 CU inside a 1,400,000-CU envelope;
- source delegated stake `D`: `30,760,853,747,897` lamports;
- minted then burned `T`: `9,627,200,247,357` raw;
- onramp before: `1,726,740` delegated lamports;
- destination delegated gain: **`1,726,736` lamports**;
- user token balance and mint supply: exact zero net change;
- combined main/onramp lamport loss: exactly `1,726,736`, matching the destination gain.

The source's excess-lamport refund is separately reconciled and is not counted as accounting profit.

This proves the pricing effect and instruction path. It does not prove outsider exploitability: the exact live source required signatures from `6iQKfEyhr3bZMotVkW6beNZz5CPAkiwvgV2CTje9pVSS` and `8ZYkgY8vux63VKDv65gcbqrakM3k1DLBqUYtzoZmX7sd`, whose private keys were unavailable. The destination Stake signer is attacker-generatable and is not the blocker.

### Flash-wrapped route analysis

Every plausible same-transaction wrapper was evaluated:

1. **Flash SOL -> create/delegate Stake -> Deposit.** Blocked: newly delegated stake cannot become fully active with the required historical activation state in the same transaction/epoch.
2. **Flash native Stake account.** Blocked in the enumerated provider set: the providers transfer SPL-token amounts, not authority over an already-active exact-validator Stake account. Direct provider count is zero.
3. **Flash the exact SVSP mint -> Withdraw -> redeposit -> repay.** Not a positive-value loop for Replenish capture. Redemption burns the loan; redepositing the resulting post-Replenish stake at the same NAV mints no more, and generally fewer, tokens than are owed, before any fee.
4. **Flash SOL/other asset -> buy SVSP mint -> Replenish -> sell -> repay.** Blocked at route discovery: Jupiter returned `TOKEN_NOT_TRADABLE` in both directions for all 57 canonical mints, including all 11 onramp candidates, at `2026-10-15T20:11:47Z`.
5. **Direct exact-mint flash.** Current independently substantiated capacity is zero; the complete provider census is below.

Because no wrapper reaches successful acquisition, unwind, and repayment, the diagnostic transfer is classified as **plausible accounting capture, not a validated outsider drain**.

## SVSP-LATENT-02: non-atomic bearer authorizations

### Deposit side

The live scan found zero noncanonical Stake accounts with both staker and withdrawer equal to an SVSP stake-authority PDA. The two HHZn withdrawer-only accounts fail exact `Authorized` equality. A signed `sigVerify:true` exact-clone test of `41Tq...` failed `custom 12` before merge at 33,027 CU.

This path is authorization-limited, not capital-limited; adding flash liquidity cannot change the live staker field.

### Withdraw side

The finalized per-mint scan found:

- 34 token accounts across nine pools with active mint-authority-PDA delegation and positive allowance;
- 21 with positive balances;
- zero positive-balance owner-path accounts;
- aggregate currently burnable balance `268,169,293` raw;
- zero individual sources reaching the one-SOL Stake split threshold.

For one source, `A` is burnable tokens and `W=floor(A*M/S)`. Successful active-Stake splitting currently requires at least one SOL, so `A_min=ceil(1 SOL*S/M)`.

The dominant account, `E7JJ8wGLjMHEgZpVMRcxkNZP5Qny7cvuUitUbz16a15s`, has:

- `A = 258,169,258` raw;
- `M = 504,296,728` lamports;
- `S = 436,491,547` raw;
- calculated output `W = 298,273,616` lamports;
- `A_min = 865,545,071` raw;
- shortfall `607,375,813` raw.

Its signed `sigVerify:true` exact-clone withdrawal failed at native Stake Split with `custom 12`, 740 bytes / 14 addresses / two instructions / two signatures / 40,319 CU. Mainnet `sigVerify:false` diagnostics independently produced the same blocker for both positive material balances: E7JJ at 41,083 CU and `9ykS...` at 36,619 CU.

Balances cannot be pooled through repeated SVSP calls. Each call burns one source then immediately performs one split; a subthreshold split rolls back the burn. A successful split initializes its destination, so that destination cannot be reused as the next blank split. The PDA delegate cannot sign a generic transfer to consolidate victim accounts. A hypothetical 21-source construction would already require 102 addresses and 42 instructions, exceeding the 64-address ceiling before any flash legs.

The economically relevant flash wrapper would top up a victim account with the *same* SVSP mint, burn victim plus borrowed tokens, redeposit enough returned stake to remint principal, repay, and retain victim value. Current exact-mint capacity is zero and Jupiter offers no buy/sell route, so this remains a latent capability rather than a current drain.

## Exact-mint provider and allocation census

The target-specific finalized crosswalk joined every one of the 57 canonical mints against the independently inventoried providers over slots `457367056..457367066`.

| Provider | Current inventory | Exact target intersection | Effective capacity/blocker |
|---|---:|---:|---|
| Save/Solend `So1end...` | 1,829 reserves | 0 | No exact-mint reserve |
| Kamino Lend `KLend...` | 619 reserves | 0 | No exact-mint reserve |
| Project0/Marginfi `MFv2...` | 165 banks | 26 target banks; 18 have positive vault balances | **0**: all 26 have hard-zero `borrow_limit=0` |
| Jupiter main liquidity/flash | 47 reserves, 163 borrow positions | 11 target reserves; 10 positive custody balances | **0**: no target `UserBorrowPosition` is bound to the flash admin |
| Jupiter isolated Ethena | 5 reserves, 17 positions | 0 | No exact-mint reserve |
| Mango v4 | 80 banks | 0 | No exact-mint bank |

Result: **0/57 sourceable exact mints, 0/11 sourceable active-onramp mints, zero direct native-Stake sources.** Therefore the optimized target allocation vector across single, dual, triple, and max-source compositions is exactly zero. There is no positive capacity to allocate or repeat-borrow.

The vault/capacity distinction is decisive:

- Project0's 26 matching banks all report `borrow_limit=0`. In the pinned source, `u64::MAX` disables the cap; zero is a hard zero. Positive liabilities are rejected by `Bank::change_asset_shares`. Runtime controls for HHZn amounts 1, 2, and 3 raw fail `BankLiabilityCapacityExceeded` with `borrow lim: 0.0` even though the vault holds 8,050,308 raw.
- Jupiter main controls real target custody, but its native flash route additionally requires a configured reserve and a flash-admin-bound borrow position. All 11 target reserves lack that position, so custody cannot be treated as borrowable capacity.

Target-bank Project0 origination fees are zero, but fee-free capacity of zero remains zero. Both Jupiter flash admins are enabled with zero-bps fees and no active loan, but the target binding is absent. Save uses ceil-rounded 4 bps on the unrelated control reserve and permits one indexed borrow/repay. The selected unrelated KLend reserve has zero flash fee and permits one indexed borrow/repay; multiple flash borrows are rejected. Jupiter permits one active wrapper, minimum 1,000 raw, exact later repayment, and a position ceiling. None changes the target intersection.

The separate Daybreak provider-stack artifact was used only for provider semantics and wire-size evidence; it was not substituted for target-specific capacity.

## Dual, triple, and maximum-source v1 envelopes

Generic signed `sigVerify:true` provider envelopes show that serialization is not an automatic blocker in isolation:

| Envelope | Providers | Bytes | Addresses | Instructions | Signatures | Result |
|---|---:|---:|---:|---:|---:|---|
| Dual | Save + KLend | 897 | 20 | 7 | 1 | Failed before complete repayment |
| Triple | Save + KLend + Project0 | 1,374 | 29 | 13 | 1 | Failed before complete repayment |
| Maximum inventoried stack | Save + KLend + Project0 + Jupiter Flash | 1,773 | 39 | 16 | 2 | Failed before complete repayment |

All fit the requested 4,096-byte / 64-address envelope. All recorded compositions fail before complete borrow/unwind/repay, principally at the Save leg with `custom 14`/math overflow; capacity ±1 and asymmetric probes do too. They are size/blocker evidence, not positive controls and not proof of aggregate liquidity. A target-specific composition cannot even begin because every exact-target provider capacity is zero.

## Signed and diagnostic execution matrix

| Case | Signature mode | Wire / CU | Outcome |
|---|---|---:|---|
| HHZn withdrawer-only Deposit | signed exact clone, `sigVerify:true` | 655 B, 16 addresses, 2 ix, 1 sig / 33,027 CU | `custom 12`; staker is not PDA |
| Outsider approves real victim token | signed exact clone, `sigVerify:true` | 756 B, 14 addresses, 3 ix, 2 sigs / 394 CU | Token `custom 4`; owner mismatch |
| E7JJ maximum delegated withdrawal | signed exact clone, `sigVerify:true` | 740 B, 14 addresses, 2 ix, 2 sigs / 40,319 CU | Stake Split `custom 12` |
| Replenish accounting sequence | exact live state, `sigVerify:false` | 1,106 B, 19 addresses, 7 ix, 3 required sigs / 239,519 CU | succeeds; 1,726,736-lamport transfer, but unavailable signers/no flash route |
| Project0 HHZn 1/2/3 raw | exact live state, `sigVerify:false` | 670 B, 14 addresses, 5 ix, 1 sig / ~34,257 CU | `BankLiabilityCapacityExceeded`; capacity 0 |
| Four-provider generic stack | signed fork, `sigVerify:true` | 1,773 B, 39 addresses, 16 ix, 2 sigs | early Save failure; no complete repayment |

Only a fresh local attacker wallet was funded in the exact-clone signed tests. Target program/account bytes, hashes, owners, and lamports matched upstream. Unavailable user signatures were not forged or replaced with a simulation presented as an exploit.

Additional positive controls established:

- exact split boundary: 778,842,939 raw produced 999,999,999 lamports and failed; 778,842,940 produced 1,000,000,001 and succeeded;
- permissionless Replenish succeeds on the exact account layout (480 B / 11 addresses / one instruction / 27,777 CU);
- four accounting roundtrips fit at 1,914 B / 18 addresses / 24 instructions / 600,556 CU; five cycles hit `MaxInstructionTraceLengthExceeded` at outer instruction 26;
- canonical main/onramp aliases fail `custom 18`; a wrong optional onramp fails `custom 2`;
- a normal unrelated Project0 USDC borrow/repay control succeeded with zero net borrower, lender-vault, and liability-share delta, validating the instruction encoding without making a target bank borrowable.

## Final assessment

- **Validated current outsider drain:** none.
- **Validated signed, fully repaid flash profit:** `0`.
- **Mainnet transactions submitted:** `0`.
- **Current exact-mint flash sources:** `0/57`.
- **Current exact-mint sources for active-onramp candidates:** `0/11`.
- **Direct exact-validator active-Stake flash sources:** `0`.
- **Unresolved program concern:** v4 Replenish pricing boundary, with an exact accounting transfer reproduced but no current signed outsider acquisition/unwind route.
- **Latent integration concern:** authorization grants are bearer capabilities unless approve/authorize and consumption are atomic.

This is a slot-bounded result. A new target bank cap, Jupiter flash-bound position, DEX listing, delegated token balance, preauthorized Stake account, or onramp movement can change exploitability and should trigger revalidation.

## Evidence and reproduction

Authoritative artifacts:

- [`svsp-live-finalized-evidence.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-evidence.json) — finalized 57-pool/account census; SHA-256 `c07da88cce0bb9554687eef7155735d11c51ec514ad9776e818b68477c33ee6e`.
- [`svsp-live-finalized-report.md`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-report.md) — live census narrative.
- [`svsp-active-onramp-envelope.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-active-onramp-envelope.json) — 11-pool accounting envelope; SHA-256 `07110beced02137b93e634682074db63849571de07bf68ed9c919ea5eec01106`.
- [`svsp-v1-composition-audit.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-v1-composition-audit.json) — signed controls, simulations, wire hashes, logs, and reconciliations; SHA-256 `e2a7544bebdcba8d1b5b9b1504acfd16072b81c8e00ec118cd53331ce63c5e51`.
- [`svsp-v1-composition-audit.md`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-v1-composition-audit.md) — execution report; SHA-256 `e3422dbfaeae16e1bd094bdf7ee9ba1eec5b37d32061a8119a38c85628a47043`.
- [`svsp-flash-provider-crosswalk.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-flash-provider-crosswalk.json) — all 57 mints against finalized provider state; SHA-256 `243ce72b362aa906efec5f086cb95191ba6fc391af8580881b101aa28a68a6ab`.
- [`svsp-flash-provider-crosswalk.md`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-flash-provider-crosswalk.md) — compact target-provider report; SHA-256 `284806df742eea9cefe95289c4cb005aac59dfb2031280543f1e1fb8994c169a`.
- [`svsp-jupiter-route-probe.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-jupiter-route-probe.json) — 57-mint bidirectional route discovery; SHA-256 `d2ccfdf40bac2e0b612dc1c03b4f54f775e4f10eb1655a7bcadf69e3b5ac12f4`.
- [`current-flash-provider-stack-signed-v1.json`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/current-flash-provider-stack-signed-v1.json) — separate generic signed provider-stack evidence; SHA-256 `8761d9f85a311f45fc956df6b565038cda29755f23a40d77c99279960df2147c`.
- [`SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE.so`](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE.so) — deployed payload; SHA-256 `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4`.

Reproduction scripts sit beside the artifacts and are syntax-checked. The finalized collectors require an already configured primary `RPC_URL`, use read-only calls, and never print it. The v1 finalizer refuses endpoint/key markers. No archive/HEAVY endpoint was used for the authoritative provider or pool census.

