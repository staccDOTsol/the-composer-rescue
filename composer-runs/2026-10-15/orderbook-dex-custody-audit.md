# Mainnet orderbook / exchange custody audit

Date: 2026-10-15 (America/Toronto)  
Mode: read-only RPC enumeration and `simulateTransaction`; no transaction was submitted  
Result: **no permissionless custody drain was validated**

## Outcome

Within the explicit denominator below, Manifest is the largest newly uncovered exchange program by priced, directly controlled token custody: **$17,680,400.05 across 2,560 verified nonzero unique vaults**, of which 2,072 were priced and 488 were unpriced. Serum DEX v3 follows at **$10,601,566.80**. The larger **$22,619,769.22** Ember row is a backing/support program for Phoenix Perpetuals, not an independent exchange balance, and overlaps the unpriced PhUsd claim held by Phoenix; it is not added to Phoenix or Manifest.

The current Manifest binary accepted an owner-authorized USDC `GlobalWithdraw` positive control, rejected over-withdrawal, missing-signer, wrong-destination, alias, and account-order mutations, and rolled back a duplicate full-withdraw transaction when the second instruction failed. A real current KLend USDC reserve with an exact zero flash-loan fee also funded Manifest deposit/withdraw cycles from 1 raw unit through the reserve's full available liquidity. Every successful flash-funded cycle fully repaid and left all tracked economic balances unchanged. **Observed exploitable value: $0.**

This is custody exposure, not TVL, solvency, or proof of vulnerability. A token account is included only when its live state reference, mint, token authority, and derived program control all matched.

## Scope and denominator

The completed denominator is eight named mainnet exchange deployments plus one support program:

| Family | Program ID | Coverage source |
|---|---|---|
| Phoenix Perpetuals | `EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih` | canonical global state; [first-party source](https://github.com/Ellipsis-Labs/rise-public) |
| OpenBook v2 | `opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb` | all Flux-discovered current market states; [first-party repository](https://github.com/openbook-dex/openbook-v2) |
| Phoenix Legacy | `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` | all Flux-discovered current market states; [first-party repository](https://github.com/Ellipsis-Labs/phoenix-v1) |
| Manifest | `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms` | all Flux-discovered current market/global states; [first-party repository](https://github.com/Bonasa-Tech/manifest) |
| OpenBook v1 | `srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX` | all 18 entries in the [first-party market registry](https://github.com/openbook-dex/resources/blob/main/markets.json) at commit `8696c613fb21792d26b300e0f1e3ee42d2a06185` |
| Serum DEX v3 | `9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin` | all 168 v3 entries in the [first-party market registry](https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json) at commit `ec11b30fd373336806cd8e2df1873ac887c4e6e2` |
| Mango v4 | `4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg` | all Flux-discovered current Bank and Group states; [first-party repository](https://github.com/blockworks-foundation/mango-v4) |
| Mango v3 | `mv3ekLzLbnVPNxjSKvqBpU3ZeZXPQdEC3bp5MDEBG68` | all Flux-discovered current groups and reachable root/node banks; [first-party repository](https://github.com/blockworks-foundation/mango-v3) |
| Ember support | `EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy` | canonical Phoenix backing state/vault; [first-party source](https://github.com/Ellipsis-Labs/rise-public) |

All eight exchange deployments and the support program completed under those bounds. Six exchange deployments use state-account discovery; the two legacy DEX deployments use 186/186 official registry markets. This is **not an exhaustive enumeration of every Solana program**: there is no authoritative complete registry/classification for all deployed exchanges, and a venue absent from the named first-party set can be missed. Raydium, Orca, and Meteora AMMs were explicitly out of scope. Drift was audited under a separate assignment and is not duplicated here; see [`drift-custody-current-audit.md`](./drift-custody-current-audit.md).

For the six discovery-based deployments, Flux was used for bulk `getProgramAccounts`, then every discovered address was re-read from the current endpoint before inclusion. Census slots were Flux 457347298–457347858 and current 457350706–457351315; Flux lagged by 3,408 slots at the start. Consequently, accounts created after the Flux snapshot can be absent even though every included account was current-verified. Full legacy program scans were not substituted for the registry bound: providers returned tens of megabytes of spam/full payload despite zero-length slices, while a Helius v2 probe exceeded 100,000 exact-flag candidates. The first-party registries give a reproducible material-market denominator, not a claim of full program-account exhaustiveness.

## Ranked direct custody

Prices are point-in-time DefiLlama `coins.llama.fi/prices/current` quotes embedded per row. “Priced gross” sums verified nonzero **unique** vault balances and does not net liabilities. Unpriced vaults are retained in the denominator rather than treated as zero.

| Rank | Deployment | Verified nonzero unique vaults | Priced / unpriced | Priced gross USD |
|---:|---|---:|---:|---:|
| support | Ember (Phoenix backing) | 1 | 1 / 0 | $22,619,769.22 |
| 1 | Manifest | 2,560 | 2,072 / 488 | $17,680,400.05 |
| 2 | Serum DEX v3 | 270 | 248 / 22 | $10,601,566.80 |
| 3 | Phoenix Legacy | 366 | 308 / 58 | $1,255,926.10 |
| 4 | OpenBook v1 | 32 | 31 / 1 | $607,992.53 |
| 5 | OpenBook v2 | 314 | 245 / 69 | $163,228.82 |
| 6 | Mango v4 | 17 | 17 / 0 | $14,782.64 |
| 7 | Mango v3 | 7 | 7 / 1 | $102.31 |
| 8 | Phoenix Perpetuals direct PhUsd vault | 1 | 0 / 1 | unpriced |

Mango v3 had eight verified nonzero references but seven unique vaults; the unique figure removes one duplicate reference. At the census snapshot, Phoenix Perpetuals held `22,628,166,330,587` raw PhUsd units and Ember separately held `22,628,175,290,280` raw USDC units as backing. These represent claim and backing sides of the same design, so summing them would double-count.

### Control verification

- OpenBook v2: decoded 283 program-owned market states and checked the stored market authority/bump, base/quote mint references, authority ATAs, and token-account authority.
- Phoenix Legacy: decoded 252 market states and checked both stored vaults against `['vault', market, mint]` PDAs, stored bumps, mint, and self-authority.
- Manifest: decoded 4,016 markets and 563 globals, followed 8,595 state references, and required the market/global vault PDA, stored reference, mint, and vault self-authority to match.
- OpenBook v1 and Serum v3: decoded every official-registry market live, checked initialized/market flags and own-address field, derived the market-vault signer from the stored nonce, then verified vault authority and mint. Availability was 18/18 and 168/168 respectively.
- Mango v4: followed 80 Bank and eight Group accounts and verified Bank or insurance-vault PDA structure, mint, and group authority.
- Mango v3: followed five groups through 34 root banks and 34 node banks and verified the stored/derived group signer plus the vault authority and mint.
- Phoenix Perpetuals and Ember: checked canonical state and vault PDAs, program ownership, stored references, mint, and token authority.

## Manifest current-binary exit validation

The Manifest exit path selected for direct current-binary validation was its USDC global:

| Field | Value |
|---|---|
| Global | `4SMRzaLXsuvTi2B5cSVs4LuCUUqQhB2uByTWUvbixjfF` |
| Global vault | `6KzHa7L1MDTkaUb4qGiJqMvnmAy1qztGDeLvSHdS9ooU` |
| Mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC) |
| Live pre-simulation vault balance | 1,865,192,704,364 raw = 1,865,192.704364 USDC |
| Parsed global account | 14,560 bytes; 113 reachable deposit nodes at slot 457352079; 37 positive and 76 zero |
| Test trader credit | 1,432,039,766,461 raw = 1,432,039.766461 USDC |
| Test trader | `qz3xsMziyYAPgiVnpCkzfLgQteFr9EHZAnvTNNhwEc6` |
| Empty destination ATA | `t5HwUUXMbpvtJzqJtQenouYMT4jPpv4Tw4czJFZe9Uh` |

The selected source checkout was first-party commit `f3fca2708a2fcb3e6c924934b26bac7a83c9058b` at 2026-10-15 17:38:22Z. It is **newer than the current deployment**, so its source review is corroboration only, not an exact build mapping. The current ProgramData and simulations are authoritative:

| Binary identity | Value |
|---|---|
| ProgramData | `G92J4ZFggKZ9LbsQ2zBpajRvRto7ed7uRuJJqWsX4BhJ` |
| Deployment slot / time | 457253117 / 2026-10-15 13:24:16Z |
| Upgrade authority | `CDFU8tEWsVU2ZMiek57Sgk3Huha2yBNcSHLAts3V3Cbf` |
| ProgramData SHA-256 | `5fe1237da78a248881bcd04962e5e69e4102a35bd97d6befd82b039b40648e74` |
| Executable bytes | 486,624 bytes; SHA-256 `8a935584237bfa8d8d36cc1620009342a73ac0b44e065f3329f596a431494fb5` |

The reviewed source's [`GlobalWithdrawContext`](https://github.com/Bonasa-Tech/manifest/blob/f3fca2708a2fcb3e6c924934b26bac7a83c9058b/programs/manifest/src/validation/loaders.rs#L894-L958) requires the payer to be a signer; verifies the program-owned global PDA and stored vault; requires the destination token account's mint and owner to match the payer; and validates the token program. [`process_global_withdraw_core`](https://github.com/Bonasa-Tech/manifest/blob/f3fca2708a2fcb3e6c924934b26bac7a83c9058b/programs/manifest/src/program/processor/global_withdraw.rs#L43-L91) debits the payer-keyed tree entry before a vault-PDA-signed token transfer. Current-binary behavior matched these controls.

All simulations used `sigVerify:false`; therefore “signer” means the message signer privilege was presented to the runtime, not that this audit possessed or validated the user's private key. No result is represented as a live attack.

| Direct case | Exact envelope | Current-binary result |
|---|---|---|
| Withdraw 1 raw | 357 B, 7 accounts, 1 ix, 1 required signature | success; 3,759 CU; wallet +1, vault −1, credit −1 |
| Withdraw full credit | 357 B, 7 accounts, 1 ix | success; 3,779 CU; wallet 1,432,039,766,461, credit 0 |
| Withdraw zero | 357 B, 7 accounts, 1 ix | success; 3,770 CU; no economic movement (tree layout/hash can change through remove/reinsert) |
| Full credit + 1 | 357 B, 7 accounts, 1 ix | rejected at ix 0, `Custom(14)` / Manifest `Overflow`; 1,355 CU |
| Duplicate full withdrawals | 376 B, 7 accounts, 2 ix | first executes, second rejects at ix 1 with `Custom(14)`; transaction fails atomically; 5,030 CU; wire SHA-256 `28f51fc7f771a9676e2d1b4dd572de351f73d92f5020fd901dec1a319e52bddb` |
| Victim not a signer | 389 B, 8 accounts, 1 ix | `MissingRequiredSignature`; 6,761 CU |
| Destination owned by another signer | 357 B, 7 accounts, 1 ix | `IllegalOwner`; 1,093 CU |
| Alias global vault as destination | 325 B, 6 accounts, 1 ix | `IllegalOwner`; 1,093 CU |
| Swap global and vault account order | 357 B, 7 accounts, 1 ix | `IllegalOwner`; 13,253 CU |

For failed transactions the simulator returned null post-account images and a failing transaction result; there is no committable partial first-withdraw state. The duplicate case therefore does not create a double withdrawal or partial debit.

## Real KLend USDC flash composition

The flash lender was the current KLend program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`, reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, liquidity supply `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`, and fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`. The reserve's current `flashLoanFeeSf` field at offset 4,904 was exactly `0`, not a rounded display value. The source instruction layout came from successful mainnet transaction `588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd` at slot 457338071.

The current KLend ProgramData was `9uSbGW1y9H5Av6H5TKxQ1wnFApSq2t3oEpfF2YfjDQGA`, deployment slot 440486775, executable SHA-256 `9db16dd4b7bbfe4f13df850bf880bfc4522fcece06717c0626d625746a3cc85b`.

The v1 encoder enforced 4,096 wire bytes, 64 inline addresses, 64 instructions, no address lookup tables, 1,400,000 CU, and 64 MiB loaded-account data. The full run had 24 cases: 14 successes and 10 expected/controlled failures.

| Flash case | Bytes / accounts / ix | CU | Result |
|---|---:|---:|---|
| Borrow + repay 1 raw | 531 / 11 / 2 | 55,213 | success, full repayment |
| Borrow → Manifest deposit → withdraw → repay, amounts 1, 2, 9, 10 raw | 665 / 14 / 4 | 64,596–64,597 | all success, full repayment |
| Same cycle at available − 1 | 665 / 14 / 4 | 64,597 | success, full repayment |
| Same cycle at exact available, 8,010,117,695,096 raw | 665 / 14 / 4 | 64,597 | success, full repayment; wire SHA-256 `e3cb2bf309435b18db38a5f3e949f9f0e185344a514cc633b092622114c7c4ba` |
| Available + 1 | 531 / 11 / 2 | 32,644 | borrow rejected, KLend `Custom(6008)` |
| 2 / 4 / 8 Manifest cycles inside one flash pair | 703 / 779 / 931 B; 14 accounts; 6 / 10 / 18 ix | 73,879 / 92,442 / 129,562 | all success, full repayment |
| One cycle with exactly 64 inline addresses | 2,365 / 64 / 4 | 71,862 | success, full repayment; wire SHA-256 `2de9e51cfbc2d69047bf3f66451bfffc0ca8ba076828f40f15670442a9f0655f` |
| 13 cycles, 64 addresses, 4,021 B | 4,021 / 64 / 28 | 79,820 | failed at KLend borrow ix 0: `ProgramFailedToComplete`; log says `memory allocation failed, out of memory`; no movement |
| Alias destination inside funded cycle | 665 / 14 / 4 | 40,414 | Manifest ix 2 rejected `IllegalOwner`; whole transaction failed |
| Wrong KLend repay index | 665 / 14 / 4 | 23,463 | KLend borrow ix 0 rejected `Custom(6033)` |

The 4,021-byte / 64-address case establishes a current KLend-side composition boundary, not a custody drain: it fails before Manifest or a token movement. A 64-address cycle succeeds at 2,365 bytes. Reaching the nominal 4,096-byte ceiling with full repayment was therefore concretely blocked by the current KLend borrow path's SBF heap failure; it was not silently replaced with a mock lender.

For the exact-available successful case, the pre/post economic fields were identical:

| Tracked field | Pre raw | Post raw |
|---|---:|---:|
| Owner USDC | 0 | 0 |
| Manifest global vault | 1,865,192,704,364 | 1,865,192,704,364 |
| Manifest trader credit | 1,432,039,766,461 | 1,432,039,766,461 |
| KLend liquidity supply | 8,010,117,765,101 | 8,010,117,765,101 |
| KLend fee vault | 0 | 0 |
| KLend reserve available liquidity | 8,010,117,695,096 | 8,010,117,695,096 |

KLend flash loans do not create an obligation/debt account; successful indexed repay plus unchanged liquidity supply, fee vault, and reserve availability is the repayment proof. Manifest's tree and KLend's reserve account hashes may change through remove/reinsert or reserve updates even when these economic fields return exactly. Manifest `GlobalDeposit`/`GlobalWithdraw` has no price refresh, crank, or update account dependency, so a refresh-order mutation is not applicable to this path.

## Conclusions and limits

1. No tested current-binary path allowed an unsigned user to withdraw another trader's Manifest global deposit, exceed their credit, redirect proceeds, alias the vault, reorder state/vault accounts, or keep KLend liquidity after a flash-funded cycle.
2. The duplicate-withdraw sequence failed transaction-wide at the second debit; no partial first debit/transfer can commit.
3. A real, exact-zero-fee KLend reserve funded full-liquidity and repeated-cycle tests. Successful cases fully repaid; the near-maximum v1 case exposed a non-persistent KLend heap/liveness boundary at 4,021 bytes and 64 addresses.
4. This does not prove all Manifest instructions or all Solana exchanges safe. The census is complete only for the stated eight-deployment/186-registry-market denominator, subject to Flux's 3,408-slot discovery lag and missing-price rows. Source-to-current-binary reproducibility was not established for Manifest, so source observations are secondary to current ProgramData hashes and current-binary simulation.

## Evidence

- [`orderbook-dex-custody-summary.json`](./orderbook-dex-custody-summary.json): authoritative compact census, corrected official legacy IDs/registries, denominator, control proofs, and top vaults.
- [`legacy-dex-official-registry.json`](./legacy-dex-official-registry.json): all 18 OpenBook v1 and 168 Serum v3 registry markets with current vault evidence.
- [`manifest-klend-v1-sim.json`](./manifest-klend-v1-sim.json): exact wire Base64, addresses, byte/account/instruction counts, CU, logs, binary hashes, and pre/post account images for all 24 cases.
- [`manifest-usdc-global-deposits.json`](./manifest-usdc-global-deposits.json): parsed reachable Manifest USDC global deposit tree.
- [`scan-orderbook-dex-custody.js`](./scan-orderbook-dex-custody.js), [`scan-legacy-dex-official-registry.js`](./scan-legacy-dex-official-registry.js), [`compact-orderbook-custody.js`](./compact-orderbook-custody.js), and [`manifest-klend-v1-sim.js`](./manifest-klend-v1-sim.js): reproducible read-only collectors and simulator.

The large preliminary `orderbook-dex-custody.json` is retained as raw discovery evidence, but its two provisional legacy rows were superseded by `legacy-dex-official-registry.json` and the corrected compact summary. The report and compact summary use the official Serum v3 program ID and must be treated as authoritative for the legacy rows.
