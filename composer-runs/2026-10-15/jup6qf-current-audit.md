# `jup6QF…` current-mainnet audit — 2026-10-15

## Result

No reportable unauthorized value-extraction path was validated in the current executable `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS`.

The deployment holds material assets and exposes exact-zero-fee flash liquidity, but the tested composition did not convert that capital into an unauthorized target action. The permissionless valuation instruction composed successfully at dust and extreme KLend sizes; every value-moving substitution was stopped by a protocol-position, mint/vault/token-program, claim-user, or admin-authority binding. Successful flash cases fully repaid and produced zero borrower, source-vault, fee-vault, and target-vault token deltas. Current validated extractable loss: **0**.

All work was read-only. Mainnet RPC reads and `simulateTransaction` were used; no transaction was signed, submitted, or sent to a team.

## Identity and source correspondence

- Target: Jupiter Lend **isolated Ethena liquidity** deployment, not legacy Jupiter Swap, main `jupeiUmn…` liquidity, Earn/Vaults, or Perps. Official `@jup-ag/lend@0.4.0` binds the Ethena suite as liquidity `jup6QF…`, vaults `jupo974…`, lending `jup97Z…`, flashloan `jupKxk…`, reward rate `jupGBU…`, and dex `jupZ4m…`.
- ProgramData: `3pCmHYrm5vyitCA1xQmgCm86V7ZgKNX17XXgcCohbvTo`; upgrade slot `419328808`; upgrade authority `A4CcB3kdi3w4fJgAim4sdN8DvadZnN4R4PPbECQqz6j7`.
- Current ELF: 737,184 bytes, SHA-256 `d8b4f841433f65fe3e9c8f9fa4e5a52865a4a570c6fea162f47ea6259bbd3c48`; the independent program dump and ProgramData ELF hashes match.
- Program-owned compressed IDL account `CUHz8jRKdeDq56hCdFHTHEzwwez5gP5z1gkUnLobLreX` expands to the exact target address, liquidity version `0.1.2`, 24 instructions, 7 account types, and 43 errors. Its decompressed SHA-256 is `ff459d359dc425604c711dfbdbdcb9471b2ca76d1ee4e8f76e474c2fbc3a80f4`.
- Flash program-owned IDL account `6aogr6JVXyuxeHSEuArwHqRkaxyPRYuZTT1fu6HWY3KV` identifies `jupKxk…` flashloan version `0.1.2`; decompressed SHA-256 `480303b2be49e1c39c43275f906192f9c1cbcd5cb5905c638d197037b8dfff49`.
- The public Fluid source at commit `626b177f235224bc5d074d39439cd2558f542886` is explicitly release `0.1.2`; the deployed IDLs, account decodes, discriminators, errors, and runtime behavior correspond to its core liquidity/flash semantics. The public source declares the main deployment IDs, not the isolated Ethena IDs, and a reproducible bit-for-bit build of this isolated ELF was not established. Accordingly, on-chain IDLs, current bytes, live state, and runtime traces are authoritative here.
- The separate integration repository IDL is newer (`liquidity 0.1.9`; flash reference `0.1.4`). For liquidity it additionally lists `pause_token`/`unpause_token`, which are absent from the deployed `0.1.2` IDL. Those later instructions were excluded from current-binary conclusions.

## Current state and custody

Snapshot slot: `457351470` (`2026-10-15T19:18:41Z` approximately, by block time).

- Liquidity PDA: `["liquidity"]` → `6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL`, bump `253`.
- Authorization list PDA: `["auth_list"]` → `FdCSMQ51V9A1xYbdRvMeQrBYapPMUSRKUM7jHvFmXKNQ`, bump `255`.
- Liquidity authority: `Df2CV9urF8fQw5dHdqpoSNcmv9J6B46LchG1Kkn8Uafu`; sole auth user: the same address.
- Guardians: `3H8C6yYTXUcN9RRRDmcLDt3e4aZLYRRX4x2HbEjTqQAA` and `Df2CV9…`.
- Revenue collector: `Cvnta5ecoiCgNbLEXYm6kvhJMmRv3JM3ksKgTLVPg4hk`.
- Global liquidity status is `false`, which release `0.1.2` interprets as unlocked.

| Asset | Mint | Reserve / rate model | Bound vault | Current vault balance | Utilization / max |
|---|---|---|---|---:|---:|
| USDe | `DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT` | `GSadisGhwK2bokEHa6ZyEJsXLXmCYAJreeJ4Wo9NL5Uw` / `vNiLDiUi6ur36mF2UxcNDzWNgV8xHmzR6jc4bTHbfLY` | `3V949ufzT2viNuvTNHNmJyRMeof9JBSxZ4qQ3XsHTrb3` | 297,716,276.674928468 | 6 / 10,000 |
| PYUSD | `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo` | `7ehGZQfyz4fVJpEUupKhhjgewXkayKbAHCR3JjmC45iL` / `48nirZRGdUqXo9y7Bknx4vVAMR14ndDNyuJa1DKXbiLv` | `2zwY48mkxKezb5w3mGZDM5QEje5ibTNf5FA8oaEJAVej` | 9,483,081.686827 | 9,623 / 9,500 |
| USDG | `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` | `EcKLyKWMJAUnsv3MMGGHrjVMDm9KtuCzdz8wNV3JpGsp` / `3iKXNjuDkTRstxggkarMS81FNzxgyFgDGNQAmmEcqMEu` | `8DesAbtAabk7s2YdPX5P3Bs5QpHFps5H35mWuzbLYRZX` | 5,982,957.456119 | 8,655 / 10,000 |
| JupUSD | `JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD` | `4csbbVZBVDoyRFjHAYj1wr8LGymdvGZdHxRN5vS4fkDU` / `FS4wA1T8eaJGktoXbPTthEGSrhruBX3jX1X32hKhGcnU` | `EbwPRXSHmRPfnV1AiPnd8uVYpE19pg9p7kbzsVJXrEQM` | 4.849426 | 4,543 / 10,000 |
| WSOL | `So11111111111111111111111111111111111111112` | `5y28pocm3gDCJkZWZk1FwqvkZVPuNctHgw4kirEja2xW` / `EjfdXUzHSFg68wJtaWyN9Tuv2GUFGFUmtJYZY2VnTGoz` | `Cnq547WvMSyWLWKqWm2PVNMjg991iuthUwSpKgmZuGr9` | 3,000.461181711 | 0 / 10,000 |

Every vault is the canonical ATA for its reserve mint, the correct SPL or Token-2022 program, and the `6GjquP3…` liquidity PDA. These balances are custody/mark exposure, not an extractable-loss claim.

The 34 position accounts bind ten protocol PDAs:

- Six owned by Ethena vaults `jupo974…`: `6TXKei…`, `3Lekyr…`, `BF4zrL…`, `NQm5XP…`, `3MceG8…`, `9xcZL4…`.
- Three owned by Ethena lending `jup97Z…`: `AynUbh…`, `81RgWx…`, `9H6QkE…`.
- Native Ethena flash admin `G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn`, owned by `jupKxk…`.
- A legacy/main flash binding `ALXWtv2P4GqH1B7Lq731joag52yRBRqmHV4naiXPTYWL`, owned by `jupgfS…`, has zeroed/disabled positions.

The native flash admin is `["flashloan_admin"]` under `jupKxk…`, bump `252`; it is active, not in a flashloan, has active amount `0`, binds liquidity program `jup6QF…`, and has configured fee **exactly 0 bps**.

## Proven current value-moving paths

Post-upgrade successful mainnet transactions prove the deployed binary, not merely the reference source:

- `3ErRtqsh…` at slot `457308464`: Ethena vault CPI `pre_operate` → token transfer → `operate`, depositing `51,045,772,158` raw USDG.
- `sYSrcD3W…` at slot `457252387`: Ethena lending CPI `operate`, transferring `2,998,663` raw USDG from the bound target vault to a user ATA.
- `3YBu…`: PYUSD withdrawal of `2,000,000` raw.
- `2nVY…`: USDe withdrawal of `50,000,000,000,000` raw.
- `3KfjDUU…` at slot `457272732`: native Ethena flash borrow → router/vault legs → native flash payback. It borrowed and returned exactly `127,720,338,684,899` raw USDe while the vault leg moved `135,931,537,220,143` raw USDe out and `126,153,391,986` raw PYUSD in. The target trace was `operate`, then paired `pre_operate`/`operate` calls, and exact repayment.

Release `0.1.2` and runtime establish these controls:

- `operate` requires the protocol signer and `has_one protocol` on each supplied position. Reserve→mint→vault, rate→mint, canonical ATA destination, token program, and optional claim accounts are independently bound.
- Deposit/payback additionally requires same-bank-timestamp `pre_operate` state and a measured vault increase within the exact requested amount to +1% bound.
- Borrow/withdraw updates accounting first and transfers only under the liquidity PDA. A direct wallet cannot substitute for the protocol PDA attached to a position.
- `claim` binds claim user and mint, and only transfers to the canonical ATA of the explicit recipient. The only current claim account has amount `0`.
- `collect_revenue` is auth-list gated and can only pay the configured revenue collector ATA. Status/config mutations are auth/authority/guardian gated.
- `update_exchange_price` is intentionally permissionless, but only updates the supplied reserve from its mint-bound rate model; it does not select a destination or move tokens.
- Native flash borrowing is top-level only, scans the instruction sysvar for one exact later payback with the identical account list and amount, rejects CPI and duplicate/mismatched paybacks, and uses its own bound target position as PDA signer.

## Atomic v1 flash composition

### KLend exact-zero-rate controls

The three matching KLend reserves have on-chain `flashFeeSf == 0`; this is the integer configuration, not a small nonzero fee rounded to zero. The current exact-availability cases all succeeded as top-level Solana v1 `borrow → jup6QF update_exchange_price → repay`:

| Asset | Raw amount | Human amount | v1 bytes / inline accounts / ix | CU | Final token deltas |
|---|---:|---:|---:|---:|---|
| USDe | `139267814352708639` | 139,267,814.352708639 | 673 / 14 / 3 | 62,112 | borrower 0; KLend supply 0; fee 0; target vault 0 |
| PYUSD | `10313787521790` | 10,313,787.521790 | 673 / 14 / 3 | 79,008 | borrower 0; KLend supply 0; fee 0; target vault 0 |
| USDG | `3165416168587` | 3,165,416.168587 | 673 / 14 / 3 | 78,790 | borrower 0; KLend supply 0; fee 0; target vault 0 |

For each mint, one raw unit, one whole token, 99% availability, exact current availability, refresh-before-borrow, refresh-after-repay, and three repeated refresh legs were also exercised. All successful cases remained well below v1 limits of 4,096 bytes, 64 inline addresses, and 64 instructions. Repeating two KLend flash cycles in one transaction was rejected as `MultipleFlashBorrows`; missing repay, repay-before-borrow, amount/index mismatch, and duplicate repay also failed atomically.

Across the exact cases, target raw interest-bearing supply shares, interest-free supply, interest-bearing borrow shares, interest-free borrow, and claim totals were bit-for-bit invariant before/after. Only legitimate time-dependent exchange-price/timestamp fields advanced.

### Native Ethena exact-zero-fee controls

The current `jupKxk…` admin has `flashloan_fee = 0` bps, so native repayment is also exact principal rather than a rounded fee. Successful v1 cases were 708 bytes, 15 inline accounts, 3 instructions:

- USDe: minimum `1,000` raw succeeds; `10,000,000,000,000,000` raw (10,000,000 USDe), the exact flash-position ceiling, succeeds at 95,207 CU; ceiling + 1 fails `BorrowLimitReached`.
- USDG: minimum, one token, large/accounting-bound, and repeated-refresh cases succeed. `5,691,489,268,916` raw succeeded, while `5,691,490,268,916` raw failed `MaxUtilizationReached`, bracketing the live edge within one USDG despite clock-driven interest movement.
- PYUSD: even `1,000` raw currently fails `MaxUtilizationReached` because stored utilization `9,623` already exceeds configured maximum `9,500`. This is an exact current-state liveness blocker, not a composition limitation; same-mint KLend PYUSD flash composition still succeeded.
- `999` raw fails the wrapper minimum. Two cycles, missing/mismatched/duplicate repayments, reordered repayment, account-list mismatch, and all tested vault/rate/position/destination/liquidity/program/token-program substitutions fail atomically.

Every successful native case ended with borrower and target-vault token deltas `0`, the native target borrow-position amount `0`, and FlashloanAdmin `is_flashloan_active=false` / active amount `0`. Raw target supply/borrow/claim accounting was restored; legitimate price/timestamp fields advanced.

## Substitution and authorization results

| Attempt | Runtime result |
|---|---|
| KLend-funded wallet directly calls target `operate` using native-flash position | `ConstraintHasOne` (`2001`): position protocol is `G1qKid…`, not wallet |
| Cross-mint target rate model | `ConstraintHasOne` (`2001`) |
| KLend source-vault alias to target vault / wrong mint | account-address constraint (`2012`) |
| KLend destination alias to target vault | flash repayment validation failure (`6033`) |
| Wrong KLend token program | token-program constraint (`2022`) |
| Native wrong vault / rate / position / destination / liquidity / program / token program | corresponding has-one, mint, ATA-owner, executable, or program constraints; no successful mutation |
| Outsider `claim` against the only claim PDA | claim `has_one user` failure (`2001`); current amount is also zero |
| Outsider `collect_revenue` | `OnlyAuth` (`6005`) |
| Outsider global status change | `OnlyAuth` (`6005`) |
| Outsider revenue-collector update | `OnlyLiquidityAuthority` (`6004`) |

The requested funded `operate`/`claim`/`collect` exploit leg therefore has a concrete blocker: KLend lends to a wallet ATA, but target value movement is authorized by a protocol signer already bound into program-owned position state. Flash capital cannot manufacture that signer or replace the position’s `protocol`, and the native wrapper’s PDA signer is only exercised through a top-level borrow/payback pair whose exact accounts and repayment are prevalidated.

## Observations, not vulnerabilities

- Exact-zero flash fees materially lower composition cost, but no unauthorized gain primitive was found. Fee-free capital alone is not target loss.
- PYUSD is presently above its max-utilization setting, blocking new native target borrows. Existing successful withdrawal history and the current invariant behavior do not support an extraction finding; this is operational/configuration state.
- The upgrade authority and compact auth set are governance/trust concentration. No authority bypass was validated.
- The large vault balances are maximum custody exposure, not a loss estimate. Successful simulations show no residual borrower gain or vault deficit.

## Evidence

- `jup6qf-current-inventory.json`: slot-bound program, PDA, reserve, vault, position, protocol-owner, and historical value-flow evidence.
- `jup6qf-onchain-idl.json`, `jup6qf-onchain-idl-evidence.json`: deployed liquidity IDL and provenance.
- `jup6qf-onchain-flash-idl.json`, `jup6qf-onchain-flash-idl-evidence.json`: deployed flash IDL and provenance.
- `jup6qf-klend-v1-simulations.json`: 39 KLend/target cases with wire size, account/ix count, CU, logs, and full pre/post accounting.
- `jup6qf-native-flash-v1-simulations.json`: 50 native-flash cases with current admin, boundary tests, mutations, logs, and full pre/post accounting.
- `jup6qf-current.so`: current executable dump matching ProgramData ELF hash.

Simulation used `sigVerify:false` solely to replay existing on-curve System-account token owners without private keys; no result assumes that an arbitrary PDA can sign a top-level instruction. Current-state amounts and timestamps will naturally move after this snapshot.
