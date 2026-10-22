# SolFi V2 exact USDC/USDT pool — current defensive audit

**Date:** 2026-10-19  
**Network:** Solana mainnet-beta and an isolated current-state mainnet fork  
**Program:** `SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF`  
**Exact pool:** `FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32`

## Result

No outsider-profitable drain or nonlinear amplification was reproduced in the tested surface. A fresh, real-wallet, signature-verified mainnet simulation successfully exercised the exact pool. Fresh-outsider fork controls then showed that direct $100 USDC or USDT donations to either pool vault did not change the swap's gross output. At the practical upper edge, signed **$425,000** atomic compositions using two and three distinct flash-liquidity providers fully repaid every lender but left the outsider down **58.735710 USDC-equivalent** and **59.135710 USDC-equivalent**, respectively, after the quoted two-signature network fee.

This is a bounded negative result, not a proof that the stripped upgradeable program contains no vulnerability. No transaction was broadcast.

This audit supersedes the earlier quote-only bounded gate for this pool. It re-attested the deployed binary and custody, added a current landed outflow, executed a signed mainnet control, mutated inventory on a fresh-outsider fork, and completed atomic multi-lender repayment tests; it does not reuse the old gate as current proof.

## Current deployment and custody

A final read-only `solana program show` attestation returned:

| Field | Current value |
|---|---|
| Upgradeable ProgramData | `H6M3jMJCednoAr7BR9P6versKQmbo5kV3oi8R5JsWNKz` |
| Last deploy slot | **406030591** |
| Upgrade authority | `BQoUfnC2UGfzgv9joUhNZ9BoPaXbPifs3WDR7pV5DFXm` |
| ELF length | **248,272 bytes** |
| ELF SHA-256 | `1d8503647bd9d4982c5ac333f12c3b803c50dfa241b9e8d087983c1ec28c549b` |

The exact [deployed ELF](solfi-v2-current.so) matches that length and hash. The binary contains the source-path strings `swap_with_okx_sig.rs`, `update_big_blacklist.rs`, `update_fast_blacklist.rs`, `decision_tree.rs`, and `spline_u64.rs`, plus checked quote/base-atom conversion errors. These strings bind the tested state-sensitive pricing and signed-swap surface to this exact deployed artifact, but do not substitute for source-level review.

At confirmed slot **458754010**, the [current account snapshot](solfi-v2-current-accounts.json) showed that both SPL vaults were owned by the exact pool account:

| Role | Address | Mint | Amount |
|---|---|---|---:|
| USDC vault | `ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc` | native USDC | **356,945.928697 USDC** |
| USDT vault | `5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc` | native USDT | **393,422.493859 USDT** |

The later signed-mainnet control read the same vaults at its slot **458756806** as 271,042.266944 USDC and 479,407.252279 USDT. The large inventory movement between snapshots is why this audit used transaction-local balances rather than treating an earlier reserve ratio as fixed.

## Fresh successful outflow and learned interface validation

Composer was queried before constructing a control. `/idl/<program>` returned HTTP 400 because no IDL account is published. `/learn/<program>?limit=250` succeeded and reconstructed two one-byte selectors from 231 instruction samples:

| Selector | Samples | Shape |
|---:|---:|---|
| `0x07` | 227 | 13 accounts |
| `0x0e` | 4 | 13 accounts |

For selector `0x07`, Composer consistently placed the caller signer at account 0, the exact pool at account 1, USDT vault at account 4, USDC vault at account 5, USDT/USDC mints at accounts 8/9, the two token-program entries at 10/11, and the instructions sysvar at 12.

The confirmed [fresh outflow receipt](solfi-v2-current-outflow-receipt.json), signature `37kfk4jFeRwzsa4Tcak5HZLdpsjrrTMRu8BtEBPKR5kAMeeDUea8LD6J6W98D51mn4eWVSrRGXphaGQk9jrRQzNF`, landed at slot **458753897** (`2026-10-19T07:41:45Z`). Its SolFi inner instruction:

- decodes to selector `0x07` and 25 total data bytes;
- has exactly the 13-account positional layout Composer learned;
- places the signer, exact pool, USDT vault, USDC vault, mints, token programs, and instructions sysvar in those learned positions; and
- causes a pool-PDA-authorized transfer of **241.157252 USDT** from the exact USDT vault to the routed user's destination.

That receipt proves current-program outflow authority and validates the learned positional roles against a landed receipt. It is an input-paid trade, not evidence of a drain.

## Exact signed mainnet control

The [signed control evidence](solfi-v2-signed-control.json) used existing wallet `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` only in a `sigVerify: true` simulation. Private bytes and signed wire bytes were not persisted, and there was no send path.

| Field | Result |
|---|---:|
| Quote context | slot 458756804 |
| Input / output | 0.005000 USDC / 0.005003 USDT |
| Simulation | slot 458756806, `err: null` |
| Compute | 68,611 CU |
| Fee | 5,000 lamports |
| Envelope | v0, 441 bytes, 16 keys, 1 signature |
| Wallet delta | -5,000 raw USDC; +5,003 raw USDT |
| Pool delta | +5,000 raw USDC; -5,003 raw USDT |

The pool baseline and target were read from the same simulation bank at slot 458756806. The wallet-only baseline was one slot earlier (458756805), so the artifact's aggregate `sameBankBaseline` is false; no third party can move those wallet accounts, and the exact wallet/pool conservation still reconciles. SolFi executed at inner depth 2 under Jupiter and succeeded.

## Donation / raw-inventory extreme

The [donation-fork evidence](solfi-v2-donation-fork.json) used a new, ephemeral outsider on an isolated mainnet-beta fork (`sigVerify: true`; custom v1; no broadcast). Every case swapped exactly **100 USDC** through this exact SolFi pool from the same baseline and quote. A **100 USDC** donation to the input vault and a **100 USDT** donation to the output vault were each placed immediately before the same swap.

| Case | Gross SolFi swap output | Difference from clean |
|---|---:|---:|
| Clean | 100.096120 USDT | — |
| Donate 100 USDC to input vault | 100.096120 USDT | **0** |
| Donate 100 USDT to output vault | 100.096120 USDT | **0** |

The output-vault case's wallet net is only +0.096120 USDT because the wallet first donated 100 USDT; the SolFi transfer itself remained 100.096120 USDT. Thus raw vault balance aliasing/inventory alone did not feed the priced output in these tested directions. Envelopes were 773–789 bytes, 18 addresses, and one signature; all completed with `err: null`.

## Two- and three-provider atomic flash funding

The [multi-flash evidence](solfi-v2-multiflash-extremes.json) used an isolated current-state fork, a newly generated outsider and margin account, and real current lender/pool program state. The outsider received synthetic fork-only starting balances of 1,000 USDC, 1 USDT, and 20 SOL so that an economically losing route could still prove full lender repayment. Keys and signed wire bytes were not persisted.

Both cases borrowed **100,000 USDC total**, swapped the full amount through the exact SolFi pool, and independently exited USDT through Manifest pool `8sjV1AqBFvFuADBCQHhotaRq5DFFYSjjg1jMyVWMqXvZ`. To tolerate the quote service being a few slots ahead of the nested fork, the exit consumed 99.99% of quoted SolFi output and retained the residual USDT in final wallet equity.

| Result | Two providers | Three providers |
|---|---:|---:|
| Allocation | KLend 50,000; Project0 50,000 USDC | KLend 49,500; Project0 49,500; Save 1,000 USDC |
| Save fee | n/a | **0.400000 USDC** |
| Simulation | `err: null` | `err: null` |
| Compute | 356,319 CU | 444,548 CU |
| v1 envelope | 1,680 bytes / 36 addresses | 1,915 bytes / 42 addresses |
| Instructions / signatures | 13 / 2 | 15 / 2 |
| KLend supply delta | 0 | 0 |
| Project0 vault delta | 0 | 0 |
| Save supply / fee-vault delta | n/a | 0 / +0.400000 USDC |
| Wallet USDC delta | -14.822524 USDC | -15.222524 USDC |
| Wallet USDT delta | +9.956383 USDT | +9.956383 USDT |
| Wallet stable delta at par | **-4.866141** | **-5.266141** |
| Quoted 2-signature network fee | 0.001054 USDC | 0.001054 USDC |
| Final wallet equity after fee | **-4.867195 USDC-equivalent** | **-5.267195 USDC-equivalent** |
| SolFi vault delta | +100,000 USDC / -100,093.639450 USDT | same |
| SolFi nominal stable delta at par | **-93.639450** | **-93.639450** |

Every lender was fully restored, Save received its exact 4 bp fee, and both signed envelopes were within the required **4096-byte / 64-address** bounds. The SolFi nominal delta is not an outsider profit: the independent exit repriced the acquired USDT and the outsider finished negative. No tested composition exhibited positive or increasing outsider equity.

The small mainnet control, $100 donation controls, and flash compositions occurred at different banks and therefore cannot be used as a strict single-curve derivative measurement. Within each same-bank fork comparison, however, donations caused zero output change, and through the $425,000 complete atomic edge the outsider result remained negative.

## Practical upper edge: $425,000 complete; $425,291 no longer routable

The focused [upper-edge execution evidence](solfi-v2-multiflash-upper-current-fresh-425k.json) refreshed a direct mainnet-backed fork immediately before construction. It then ran **425,000 USDC** through the same exact SolFi-to-Manifest route using both provider sets. The fork-only caller baseline was explicitly **1,000 USDC + 1 USDT + 20 SOL**; all equity figures below are deltas from that seeded baseline, not gross wallet balances.

The route quote itself was separate from caller equity: 425,000 USDC quoted 425,221.683823 USDT from SolFi; 99.90% of that quote (424,796.462139 USDT) quoted 424,356.266271 USDC through Manifest, leaving 425.221684 quoted USDT in the wallet. Runtime pool transfers differed slightly from the quote, so the reconciled account deltas—not quote arithmetic—are the final equity evidence.

| Upper-edge result | Two providers | Three providers |
|---|---:|---:|
| Allocation | KLend 212,500; Project0 212,500 USDC | KLend 212,000; Project0 212,000; Save 1,000 USDC |
| Simulation | `err: null` | `err: null` |
| Compute | 395,483 CU | 484,475 CU |
| v1 envelope | 1,680 bytes / 36 addresses | 1,915 bytes / 42 addresses |
| KLend token-supply delta | 0 | 0 |
| Project0 token-vault delta | 0 | 0 |
| Save token-supply / fee-vault delta | not invoked | 0 / +0.400000 USDC |
| Seeded caller USDC delta | -643.767120 USDC | -644.167120 USDC |
| Seeded caller USDT delta | +585.032467 USDT | +585.032467 USDT |
| Seeded caller stable-equity delta at par | **-58.734653** | **-59.134653** |
| Combined caller + margin SOL delta | **-10,000 lamports** | **-10,000 lamports** |
| Separately quoted SOL-fee equivalent | 0.001057 USDC | 0.001057 USDC |
| Final equity after that fee | **-58.735710 USDC-equivalent** | **-59.135710 USDC-equivalent** |
| SolFi actual vault delta | +425,000 USDC / -425,381.494606 USDT | same |
| SolFi nominal stable delta at par | **-381.494606** | **-381.494606** |

Only the invoked lender token accounts are repayment evidence. In particular, unrelated Save accounts included in the two-provider watch list were not used and their lamport/rent observations are not treated as token repayment.

The [quote-boundary probes](solfi-v2-upper-quote-boundary.json) accepted 425,000 USDC at context slot 458763820 and returned `No routes found` for 450,000, 500,000, and 600,000 USDC. A moving-market bisection briefly accepted 425,291 USDC near slots 458763967–458763968, but the final adjacent recheck was internally non-monotonic as pool state moved. On a newly refreshed fork at slot 458764576, the requested 425,291-USDC construction again stopped at Jupiter HTTP 400 `No routes found`, before any signed packet could be built. Therefore **425,000 USDC is the highest complete executable amount demonstrated**, while 425,291 USDC is an exact current route-availability blocker rather than a SolFi runtime failure. No static one-dollar maximum is claimed for a moving live pool.

## Blockers and limitations

- Initial fresh Surfpool starts against three mainnet RPC endpoints panicked at `crates/core/src/surfnet/svm.rs:908:53` with `called Option::unwrap() on a None value`. The $100,000 and donation controls used a new isolated instance nested read-only from a current local mainnet fork. Later direct starts recovered, and the $425,000 upper-edge result used a freshly started direct mainnet-backed fork. Every audit-owned fork was stopped after testing.
- An equal three-way $100,000 split initially made current Save reject its approximately 33,333 USDC borrow with `Math operation overflow` (`Custom: 14`). Reducing only Save's leg to 1,000 USDC allowed the full $100,000 three-provider atomic case to complete. This is a current-provider feasibility limit, not a SolFi finding.
- Composer did not publish an IDL and gave positional names only. The `0x07` role mapping is validated by the landed receipt and successful signed execution; selector `0x0e` was not independently exercised here.
- The ELF is stripped and no authoritative source/IDL was available. Binary strings, deployed hash, receipt roles, and runtime behavior constrain the conclusions but do not prove every handler safe.
- The mainnet signed control was limited by the authorized wallet's existing USDC inventory. Larger experiments used synthetic balances only on the isolated fork.

## Safety statement

No mainnet transaction was sent. All fresh signed controls were simulation-only with signature verification enabled. The flash and donation harnesses contain no `sendTransaction` path, persisted no private keys or signed wire bytes, mutated only newly generated outsider accounts on the private fork, and were shut down after use.

