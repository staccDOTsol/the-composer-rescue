# Hylo Exchange outsider audit refresh — 2026-10-19

## Outcome

No validated outsider drain or positive net-asset gain was found in the exercised scope. Demonstrated unauthorized gain: **0 JitoSOL**.

The strongest exercised case was a signed, `sigVerify: true`, no-broadcast, three-provider JitoSOL envelope against the current deployed Hylo binary. It borrowed **847,067.633122034 JitoSOL**, completed the Hylo JitoSOL→xSOL→JitoSOL round trip, repaid every lender, ended with zero xSOL, and left the caller **17,339.178201267 JitoSOL worse off**. That loss reconciles exactly to Hylo protocol equity plus the external Save fee.

This is a scoped result, not a statement that all 77 public IDL instructions or every reachable economic state are safe.

## Current deployment and custody

The deployment was checked before reusing any prior source, IDL, or Oct 15 evidence.

| Item | Oct 19 observation |
|---|---:|
| Program | `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn` |
| ProgramData | `BA5b6FzvZ77m7MZbsMEVSCFW1x86f7jM98wjcecVwzYN` |
| Last deployment slot | `447625876` |
| Upgrade authority | `GzyhwK4y7EKPEevAMc2TEpgi1Y3znwj14FUzkHmCMiNP` |
| Executable length | `1,760,400` bytes |
| Executable SHA-256 | `c745eb73d5dfa951a6317bcd5ceef1e540f7367ff7165d12596835d0488f5719` |
| Oct 15 byte comparison | identical |
| Attestation observation slots | `458761171`–`458761172` |
| Verified-build registry | unverified; zero builds for the current hash |
| JitoSOL custody observation slot | `458755068` |
| Canonical JitoSOL vault | `229,462.861624420` JitoSOL |
| Canonical JitoSOL fee vault | `6.754710808` JitoSOL |

The public SDK checkout used on Oct 15 is commit `d5a989e1862b467d69e7f5b2e7d2ecc2aae966b0`. The current upstream HEAD is `5071a0eeb74d9c3ddff41cc71021a9ffa22fcc51` (Oct 17), so the source identity has changed even though the deployed binary has not. The upstream exchange IDL still has 77 instructions and the same program address, but its SHA-256 is now `23d4e33954803ed7ce7ee5d76332391db44d453be7391cf4d6629ca510f08b2f`. No reproducible source-to-current-binary match exists. Prior IDL names were therefore used only after binary identity was pinned and where live instruction bytes/accounts or successful runtime execution independently confirmed the route.

## Fresh successful-instruction replay

A successful mainnet `redeem_levercoin_exo` at slot `458751852` was replayed on the mainnet-backed fork with a newly generated outsider signer and newly controlled token accounts. No transaction was sent.

| Result | Raw delta |
|---|---:|
| Outsider levercoin | `-49,069,651` |
| Outsider collateral | `+120,251` |
| Canonical collateral vault | `-121,465` |
| Canonical collateral fee vault | `+1,214` |

`120,251 + 1,214 = 121,465`, so the value release conserved the canonical vault decrease exactly. The outsider was seeded with the redeemed levercoin plus one raw unit; that synthetic starting inventory is not profit. The signed replay used 630 bytes, 15 addresses, and 52,246 compute units.

Fresh mutations were rejected as follows:

- Third-party levercoin token account: Anchor `2015 ConstraintTokenOwner`.
- Substitute collateral vault: Anchor `2015 ConstraintTokenOwner`.
- Substitute Pyth feed: Anchor `2003 ConstraintRaw`.

These are observed account gates, not untested-route labels.

## Maximal JitoSOL envelopes

The exact fork snapshot was fixed at slot `458756722`. Caller seed funds were used only to pay protocol/lender fees and were excluded from profit. All cases were locally signed, used versioned transaction encoding, ran with signature verification enabled, and had no send path.

### Two providers: KLend + Project0

- KLend: `722,530.478236975` JitoSOL.
- Project0: `55,063.571679873` JitoSOL.
- Total: **777,594.049916848 JitoSOL**.
- Envelope: 1,523 bytes, 34 addresses, 9 instructions, 291,086 compute units.
- Final caller: `-15,898.583819054` JitoSOL; `0` xSOL.
- KLend supply/fee vault deltas: `0` / `0`.
- Project0 liquidity-vault delta: `0`; fresh margin account had no active balances.
- Hylo vault/fee deltas: `+428.749722937` / `+15,469.834096117` JitoSOL.
- Exact equity check: `428.749722937 + 15,469.834096117 = 15,898.583819054` JitoSOL.

### Three providers: KLend + Project0 + Save

Save was selected as the third source because its current runtime-validated JitoSOL capacity exceeds Jupiter Main's state-derived 5,900 JitoSOL bound; Mango's observed JitoSOL vault held only 493 raw units and its route was not runtime exercised.

- KLend: `722,530.478236975` JitoSOL.
- Project0: `55,063.571679873` JitoSOL.
- Save: `69,473.583205186` JitoSOL.
- Total: **847,067.633122034 JitoSOL**.
- Envelope: **1,758 bytes, 40 addresses, 11 instructions**, 375,387 compute units — below 4,096 bytes and 64 addresses.
- Final caller: **`-17,339.178201267` JitoSOL**; `0` xSOL.
- KLend supply/fee vault deltas: `0` / `0`.
- Project0 liquidity-vault delta: `0`; fresh margin account had no active balances.
- Save supply-vault delta: `0`; Save fee receiver: `+27.789433282` JitoSOL.
- Hylo vault: `+459.336231167` JitoSOL.
- Hylo fee vault: `+16,852.052536818` JitoSOL.
- Exact final-equity check:
  `459.336231167 + 16,852.052536818 + 27.789433282 = 17,339.178201267` JitoSOL.

The Save exact-capacity borrow succeeded; capacity plus one raw unit failed with custom error `20`, “Borrow amount cannot exceed available amount.” The configured 5 bps Save fee was split between the protocol receiver and the caller-aliased optional host receiver; the net external fee leaving the caller was the observed `27.789433282` JitoSOL.

Across 15 successful full round trips in the final harness, no case left the outsider with a positive JitoSOL balance delta or residual xSOL gain.

## Blocked versus untested

| Route or mutation | Classification | Evidence |
|---|---|---|
| Fresh outsider EXO redemption | Exercised; no issue found | Successful signed replay and exact vault/fee conservation. |
| Third-party user token account | Blocked by account gate | Anchor `2015`. |
| Substitute collateral/Jito vault | Blocked by account gate | Anchor `2015`. |
| Substitute oracle/feed | Blocked by account gate | Anchor `2003` in the fresh EXO replay; prior Jito path controls also rejected wrong owner/address. |
| Project0 1-raw borrow | Blocked by state gate | `6040 IllegalBalanceState`; 2 raw succeeds. |
| Project0 usable max + 1 | Blocked by state/math gate | `6026 IllegalUtilizationRatio`. |
| Each KLend reserve max + 1 | Blocked by liquidity gate | `6008 InsufficientLiquidity`. |
| Multiple KLend flash borrows in one transaction | Blocked by semantic gate | `6035 MultipleFlashBorrows`, even at one raw each. The failing envelope was only 2,162 bytes/49 addresses, so size was not the blocker. |
| Save max + 1 | Blocked by liquidity gate | Custom `20`, exact max succeeds. |
| KLend + Project0 + Save maximal triple | Exercised; no issue found | Full repayment and exact negative caller-equity reconciliation. |
| Jupiter Main JitoSOL wrapper | **Untested route** | Exact-mint reserve/position exists with a 5,900 JitoSOL state-derived bound, but no Oct 19 signed runtime receipt was produced. Do not describe it as blocked. |
| Mango v4 JitoSOL flash route | **Untested route** | Exact-mint bank exists, but only 493 raw units were in its vault and the bank was `reduceOnly`/`forceWithdraw`; no signed runtime receipt was produced. Do not describe it as blocked. |
| Stablecoin mint/redeem and swap paths | **Untested on Oct 19 state** | Oct 15 fee-curve errors were state-dependent and are not promoted to current blockers. |
| Remaining lower-priority public IDL routes | **Untested** | No blanket safety claim. |
| Privileged administration/upgrade paths | Excluded/account-gated | Outside the unprivileged-outsider model; no authority compromise assumed. |

## Conclusion and limits

The current binary is unchanged from Oct 15, but the public source HEAD is newer and remains unmatched to the deployed executable. Confidence is high for the exercised EXO release, account substitutions, and JitoSOL/xSOL two- and three-provider round trips. Confidence is limited for unexercised stablecoin, Jupiter, Mango, and other public routes.

No validated finding survived this focused pass. The maximal demonstrated outsider gain is zero; the maximal exercised three-source route instead produced an exactly reconciled loss.

## Evidence

- `hylo-exchange-current-state.json`: current deployment bytes, custody, and recent live activity.
- `hylo-exchange-deployment-attestation.json`: current binary hash and verified-build registry response.
- `hylo-exchange-live-replay.json`: fresh outsider replay and account substitutions.
- `hylo-exchange-current-jitosol-provider-inventory.json`: current exact-mint provider inventory and explicit untested-provider labels.
- `hylo-exchange-signed-multisource-v1.json`: signed capacity boundaries, two-/three-provider envelopes, repayments, and equity reconciliation.

Safety: all chain access was read-only except isolated fork account setup; all transaction execution was simulation-only; no mainnet transaction was submitted.
