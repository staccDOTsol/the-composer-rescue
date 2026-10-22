# Hastra PRIME vault-stake mainnet security audit

Target: `97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY`  
Network: Solana mainnet  
Audit date: 2026-10-15  
Impact criterion: outsider-accessible unauthorized net asset gain  
Safety mode: public reads, `simulateTransaction(sigVerify=false)`, and isolated local forks only; no mainnet transaction was signed or submitted and no operator was contacted

## Verdict

One high-severity, high-confidence outsider asset-gain vulnerability was validated.

Permissionless users can deposit wYLDS after rewards have accrued or even after `publish_rewards` has placed them in the vault, receive PRIME at the still-old global price, wait for the routine global price update, and immediately redeem at the higher price. Shares carry no acquisition epoch, reward snapshot, holding period, or active unbonding delay. The reward and price transitions are separate transactions, and neither transition makes deposits/redeems ineligible or pending.

The latest observed cycle gave a confirmed 146-second post-publication window before the first higher price and 1,165 seconds before the full observed price step. An isolated fork using the exact deployed binary and exact observed prices produced this fully reconciled result:

| State | User wYLDS | User PRIME | Hastra wYLDS vault | PRIME supply |
|---|---:|---:|---:|---:|
| Initial | 1,000,000.000000 | 0 | 123,203,206.547039 | 115,710,551.966280 |
| After deposit at old price | 0 | 939,216.814165 | 124,203,206.547039 | 116,649,768.780445 |
| After redeem at later verified price | 1,000,006.606008 | 0 | 123,203,199.941031 | 115,710,551.966280 |

Final equity was user **+6.606008 wYLDS**, vault **−6.606008 wYLDS**, with user PRIME and total PRIME supply exactly restored. This is a temporal ordering exploit using two ordinary outsider transactions around routine operator activity. It is not an atomic flash-loan drain.

Atomic v1 flash compositions were tested separately. Both live exact-zero-fee KLend routes fit in 883 bytes and fully repaid, but same-price round trips lost one raw wYLDS unit (0.000001 wYLDS). Outsider attempts to insert `publish_rewards` or `verify_price` into the atomic packet were rejected by `InvalidRewardsAdministrator` in 1,213-byte and 1,605-byte packets respectively.

## Deployment and source binding

Public source/IDL were used only after binding them to the current executable:

- The public verifier identifies commit `121e4cc600b976a97faa018359e00bda48113ec2`, last verified 2026-08-12.
- That commit is exact tag `v0.0.6` in the official `provenance-io/hastra-sol-vault` repository.
- The current ProgramData payload is 673,840 bytes with raw SHA-256 `43d77f0feade4dbdca9df47c55d3aa551b0e2095ef03ebb73cb21bd5e9d8868d`.
- The official `v0.0.6` `vault_stake_prime.so` is byte-for-byte identical and has the same raw hash.
- The release checksum independently lists that same artifact hash. The release IDL hash is `ba0f04e750194ce6cba6e21370d41ecc694527bca7d90360d66aed825c79af34`.

The verifier's `340293e0...` executable hash and the raw-file SHA-256 use different hashing conventions; the byte-for-byte local artifact comparison is the relevant equality check here.

The current program is executable under the upgradeable loader. ProgramData is `6eJfxeJEXQqCAMJHECb1KxchE12E6MHjy1ypu5RznneH`; deploy slot is `438654674`; the live upgrade authority is `8fDTne6mBYfQXYHtsFWrBvrxUFqqXrFcJ83ZQwUBfmSD`. Upgrade authority behavior was mapped but is not an outsider finding.

## Live custody and liquidity

Fresh read at slot `457358055`, 2026-10-15 15:42:19 EDT:

| Item | Live value |
|---|---:|
| Canonical wYLDS vault | `FvkbfMm98jefJWrqkvXvsSZ9RFaRBae8k6c1jaYA5vY3` |
| Vault balance | 123,203,206.547039 wYLDS |
| PRIME supply | 115,710,551.966280 PRIME |
| Verified price | 1.064723917765092433 wYLDS/PRIME |
| Oracle-priced aggregate liability, floored | 123,199,792.216298 wYLDS |
| Vault less aggregate liability | 3,414.330741 wYLDS |
| Paused | false |
| Price age | 175 seconds of a 3,600-second maximum |

The vault authority, configured vault account, vault mint, PRIME mint authority, and every derived PDA/bump matched. The prior census's direct program-signer outflow was confirmed by decoded current transactions, including a 298,141.816799 wYLDS permissionless redeem at slot `457342016`.

Live KLend exact-zero-fee inventories at simulation pre-slot `457357921` were:

- wYLDS: 37,605.722307 available; reserve `34GJjXf7jGTdNL8Yw1HtqWSVvfX6JTsft3UsuFFUL7VU`; `flashFeeSf = 0`.
- PRIME: 84,772,939.811234 available; reserve `BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh`; `flashFeeSf = 0`.

KLend therefore supplied live same-asset and cross-asset test routes; Project 0 substitution was unnecessary. The finding's profit is already denominated in the vault's wYLDS asset, so no swap venue is required to realize the net gain. Flash liquidity cannot finance the temporal finding because its principal must be repaid atomically before an independently signed future price-update transaction.

## Finding HASTRA-01: Just-in-time deposits capture rewards accrued before entry

Severity: **High**  
Confidence: **High**  
CWE: **CWE-362 — Concurrent Execution using Shared Resource with Improper Synchronization**

### Security invariant

A position created after rewards accrued must not receive those historical rewards, and a share conversion must not cross an untracked reward/price epoch in a way that lets an outsider enter at the old price and exit at the new price.

### Root cause

`deposit` reads one global `StakePriceConfig`, computes `floor(assets × scale / price)`, transfers wYLDS, and immediately mints freely redeemable PRIME (`processor.rs:89-188`). `total_assets` and `total_shares` are observed only for events; they do not set or cap the conversion rate.

`publish_rewards` separately mints wYLDS into the canonical vault and updates reward guards but does not update, invalidate, or mark the price as pending (`processor.rs:429-570`).

`verify_price` later overwrites the same global price and timestamp after a Chainlink verification (`processor.rs:946-954, 989-1051`). This authenticates the report but does not identify which shares existed when its value accrued.

`redeem` immediately burns any signer-owned PRIME and pays `floor(shares × current_price / scale)` from the canonical vault (`processor.rs:194-305`). The active instruction has no holding period. The optional ticket is only a deprecated legacy account that may be closed; no new unbonding tickets are created (`state.rs:9-30`, `account_structs.rs:203-212`).

Deposit and redeem account contexts pin all canonical PDAs, mints, vaults, token owners, and authorities, but contain no position record, entry price, price version, or reward epoch (`account_structs.rs:82-252`). The IDL gives each permissionless instruction only an `amount`; there is no expected price timestamp, `min_shares_out`, or `min_assets_out`.

### Outsider attack sequence

1. Observe a successful reward publication, or predict the regular publication/update cadence.
2. While the stored price is still the prior value, permissionlessly deposit outsider-owned or durably borrowed wYLDS. The caller receives PRIME immediately.
3. Wait for the normal rewards administrator to submit the next signed Chainlink price report. The attacker does not sign, forge, or invoke this privileged transition.
4. Permissionlessly redeem the new PRIME at the higher price.
5. Keep the additional wYLDS withdrawn from the shared vault.

The attacker may also enter immediately before publication; coupling publication and price update alone would not prevent that variant without reward eligibility/snapshot logic.

### Live transition evidence

Five hundred recent target signatures were read; 86 target transactions were decoded, including 16 `publish_rewards`, 59 `verify_price`, two deposits, and nine redeems. The most recent reward cycle was:

| Event | Slot | Time (EDT / UTC) | Value |
|---|---:|---|---:|
| Prior verified price | 457345403 | 14:56:51 / 18:56:51 | 1.064716884235726713 |
| Rewards published | 457351954 | 15:20:25 / 19:20:25 | 813.853565 wYLDS |
| First higher verified price | 457352632 | 15:22:51 / 19:22:51 | 1.064718370320839103 |
| Later verified price in same reward cycle | 457357363 | 15:39:50 / 19:39:50 | 1.064723917765092433 |

The confirmed post-publication old-price window lasted 146 seconds. Waiting 1,165 seconds reached the later observed price. Across the 16 decoded reward cycles, reward publication and price verification were separate transactions; the first subsequent verify arrived 17–896 seconds later. No deposit was observed inside those sampled windows; absence of observed exploitation does not remove permissionless reachability.

Exact deployed formulas over the latest observed transition give:

```text
shares = floor(1,000,000.000000 × 1e18 / 1.064716884235726713)
       = 939,216.814165 PRIME

assets = floor(939,216.814165 × 1.064723917765092433 / 1e18)
       = 1,000,006.606008 wYLDS

net    = +6.606008 wYLDS
```

At capital equal to the pre-publication vault balance, the same exact integer formulas produce 813.876119 wYLDS of gain, approximately the entire 813.853565 wYLDS publication plus the small additional rate movement. The path scales with capital and is bounded in practice by available durable capital and vault liquidity.

### Executable fork proof

`hastra-temporal-fork.js` created two isolated `solana-test-validator` phases with the exact 673,840-byte deployed `.so` and current canonical program accounts:

- Phase 1 recreated the observed post-reward vault/supply state and old price, then signed a deposit only as a fresh synthetic outsider.
- Phase 2 preserved all post-deposit token and mint states, advanced only `StakePriceConfig.price` to the subsequently observed mainnet-verified value, and signed the ordinary redeem as that outsider.
- Mainnet was used only to read fixtures. Both submitted signatures were local-only. For repeatability after the real report becomes stale, local timestamp anchors are rebased inside the configured freshness window; timestamps do not enter either conversion formula.

The executable result exactly matched the integer model: +6,606,008 raw wYLDS to the outsider and −6,606,008 raw wYLDS from the canonical vault, with zero residual PRIME and zero PRIME-supply delta.

### Impact and practical constraints

This transfers previously accrued yield or backing from the shared vault to a just-in-time entrant and can reduce solvency for incumbent PRIME holders. The opportunity recurs with discrete price/reward updates and has no on-chain deposit cap.

Practical exploitation requires capital that persists across separate transactions. An atomic zero-fee flash loan cannot cross the normal admin price transition. The latest live wYLDS flash inventory, if treated only as a scale reference, corresponds to 0.248423 wYLDS of modeled gain over the full observed price step; it is not itself a financing route for the temporal attack.

### Remediation

Enforce reward eligibility and the reward/price lifecycle on-chain:

1. Snapshot eligible share supply/positions per reward epoch, use a time-weighted reward accumulator, or require shares to span a minimum eligibility interval so new shares cannot receive prior accrual.
2. Make `publish_rewards` enter a pending-price state that blocks deposits and redemptions until a bound, newer report is applied. This closes the confirmed post-publication gap but must be combined with eligibility logic to stop just-before-publication entry.
3. Bind price reports to a recorded asset/supply/reward epoch and require a monotonic price-version argument in deposit/redeem.
4. Add `min_shares_out` / `min_assets_out` and expected price timestamp/version arguments for user execution safety. These controls do not replace reward eligibility.
5. Add adversarial tests for deposits immediately before publication, after publication but before verification, and immediately before a scheduled report, including pool-scale amounts and solvency reconciliation.

## Atomic v1 flash and instruction-order testing

All packets used custom atomic version-1 messages, `sigVerify=false`, current mainnet accounts, and a quiet system-owned holder. No simulation was sent.

| Case | Bytes / addresses | Result | Exact caller equity / guard |
|---|---:|---|---|
| Permissionless deposit positive control | 562 / 13 | success | −1.000000 wYLDS, +0.939210 PRIME at then-current price |
| Deposit → redeem, no flash | 594 / 13 | success | −0.000001 wYLDS; PRIME restored |
| KLend wYLDS 1.000000 flash → deposit → redeem → repay | 883 / 20 | success | −0.000001 wYLDS; lender restored |
| KLend wYLDS 37,605.722306 near-available flash | 883 / 20 | success | −0.000001 wYLDS; lender restored |
| KLend PRIME 1.000000 cross-asset flash → redeem → deposit → repay | 883 / 20 | success | −0.000001 wYLDS; PRIME restored |
| KLend PRIME 84,772,939.811233 near-available cross-asset flash | 883 / 20 | success | −0.000001 wYLDS; PRIME restored |
| Flash repay ordered before Hastra redeem | 883 / 20 | success | −0.000001 wYLDS; no ordering gain |
| Floor-only cross-asset redeposit before repay | 883 / 20 | success | consumes 0.000001 pre-existing PRIME; no gain |
| Program vault substituted as user source | 530 / 12 | rejected | `InvalidTokenOwner` (6029) |
| Flash → deposit → outsider `publish_rewards` → redeem → repay | 1,213 / 29 | rejected | `InvalidRewardsAdministrator` (6025) at instruction 2 |
| Flash → deposit → outsider `verify_price` → redeem → repay | 1,605 / 24 | rejected | `InvalidRewardsAdministrator` (6025) at instruction 2 |

Every successful flash case restored the lender supply token balance, reserve available-liquidity field, fee-vault balance, and zero fee scalar. The user/vault wYLDS deltas summed to zero; user PRIME delta equaled PRIME total-supply delta; price data was unchanged. Reserve account byte hashes changed because KLend updates internal reserve metadata, but all observed economic fields and custody accounts reconciled.

The unchanged-price result also follows mathematically: `floor(floor(A × S / P) × P / S) ≤ A`. Both directions round down, so repetition cannot create dust gain.

## Other reviewed attack surfaces

- **PDA/account substitution:** rejected. StakeConfig, price config, vault config, vault, mints, user token ownership, and mint/vault authorities are pinned by typed accounts, stored keys, or canonical seeds.
- **Direct vault CPI redirection:** rejected. Redeem always transfers from the configured vault to a signer-owned wYLDS account after burning signer-owned PRIME.
- **Direct reward-mint CPI abuse:** rejected. `publish_rewards` requires the vault-stake rewards administrator; supporting vault-mint independently checks its rewards administrator, caller-program PDA, executable identity, and allow-list. The destination is the configured stake vault.
- **Oracle report forgery through target accounts:** rejected within scope. Target code pins the configured Chainlink program/verifier/controller, checks CPI return-data provenance, feed ID, validity ordering, nonfuture time, and strictly increasing observation timestamp. The external verifier implementation was not audited.
- **Testing-only arbitrary price setters:** absent from the production binary. They are `cfg(feature = "testing")`; the byte-matched production release was built without that surface.
- **Receipt/claim replay:** PRIME redemption burns signer-owned shares immediately. The optional unbonding ticket is legacy-only. No active per-position claim exists to replay. Supporting vault-mint Merkle claims bind user, amount, and epoch and create an uncloseable per-user ClaimRecord; no outsider proof bypass was found.
- **State/CPI partial completion:** transfer-then-mint, burn-then-transfer, and counter-before-CPI paths rely on Solana atomic rollback. Failed composed simulations returned the whole transaction as failed; no partial economic state was observed.
- **Conversion views without freshness:** views check positive price but not staleness. No in-scope security-sensitive consumer of stale return data was found, so this was not promoted.
- **Operator-only behavior:** upgrade, pause/freeze, reward publication, price verification, and configuration powers were mapped only as trust dependencies. No operator-only issue is reported as a finding.

## Methodology and limitations

The prior token-authority census was used as discovery evidence, then every deployment-sensitive fact was refreshed. Work included exact binary/release comparison, IDL-bound live account decoding, custody and lender inventory reads, 500-signature transaction/event reconstruction, full target source review, supporting CPI review, two independent fresh-context reviews, current-state v1 simulations, deterministic integer modeling, and exact-binary local fork execution.

No repository `SECURITY.md` was present. A standard Codex Security workbench scan was attempted once, but registration failed with: “The selected scan target changed while the scan was starting. Try again.” Per the scan workflow, it was not retried or replaced with a different workbench target; the evidence-backed manual and independent reviews continued.

External implementations not audited here include the Solana runtime/loader, SPL Token, Chainlink verifier, and KLend. The assessment does not assert historical exploitation; no deposit was found in the sampled reward-to-price windows. It establishes current outsider reachability and exact net gain under state transitions actually observed on mainnet.

## Evidence index

- `hastra-build-verification.js` / `.json` — public verification status, exact source/tag, and byte equality.
- `hastra-current.so` / `hastra-current-binary.json` — current deployed executable dump and digest.
- `hastra-live-state.js` / `.json` — fresh canonical configuration, custody, price, reward caps, PDAs, and authorities.
- `hastra-history-analysis.js` / `.json` — decoded recent instruction and Anchor-event history.
- `hastra-reward-window-analysis.js` / `.json` — exact observed-window arithmetic.
- `hastra-v1-simulations.js` / `.json` — current mainnet atomic v1 positive, negative, same-asset, cross-asset, and ordering simulations.
- `hastra-temporal-fork.js` / `.json` — exact-binary local two-phase gain proof and account reconciliation.
- `hastra-holder-discovery.js` / `.json` — read-only selection of a quiet current holder for simulation.
- `hastra-deployed-source/` — detached exact verified revision.
- `hastra-release-v0.0.6/` and `hastra-release-v0.0.6.zip` — official release binary, IDL, clients, and checksums.

