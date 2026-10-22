# Jupiter Vault 94 cross-pool oracle lead

Disposition: **deferred, medium confidence**. This branch was paused before transaction construction. No mainnet transaction was submitted, and no `sigVerify:false` result is used as proof.

## Validation rubric

- [x] Confirm the currently deployed vault/oracle/DEX topology and binary identities.
- [x] Confirm that pool A is thin and that live borrower exposure exists.
- [x] Identify a real exit that is independent of manipulated pool A and remains route-valid at useful size.
- [ ] Decode each borrowing position's current health, credit headroom, and liquidation boundary.
- [ ] Reproduce profitable `flash -> manipulate A -> borrow/liquidate/withdraw -> exit B -> repay` in one attacker-signed `sigVerify:true` v1 transaction within 4,096 bytes and 64 accounts.

## Current evidence

At slots 457355431-457362047, vault 94 uses DEX smart-collateral oracle source `FCA47...WNWz` over Jupiter DEX `85Mm...3mhh`, whose underlying mints are reUSD `2uxa...iirT` and USDC `EPjF...Dt1v`. The DEX-side positions held only `64,955,646` raw USDC (about $64.96) opposite `37,412,150,837` raw reUSD. The vault had five positions, including two borrowing positions, with `43,026,844,360` raw total position supply and `3,396,632` raw aggregate dust debt.

The relevant deployed binaries were attested at finalized slot 457363986: vaults SHA-256 `2f2d6f...415612`, oracle `ec8015...d037a`, DEX `b259be...57646`, and flashloan `b9d57b...b9c09`.

An exact-zero-rate reUSD Kamino/KLend source was live at the census: reserve `8ZTw...p52`, market `45MB...Unds`, with `9,929,955,938,930,694` raw reUSD available and `flashFeeSf = 0`.

## Independent exit route

The public Jupiter quote API returned an exit that does not touch pool A:

`reUSD -> JupLend AMM AM8r...XDgT -> USD -> independent USD/USDC venues -> USDC`

At quote context slot 457365300:

| reUSD in | USDC out | effective USDC/reUSD | API priceImpactPct |
|---:|---:|---:|---:|
| 37,000 | 40,983.428497 | 1.1076602296 | `0` |
| 50,000 | 55,382.290268 | 1.1076458054 | `0.0000024065919300314772130356` |
| 1,000,000 | 1,106,784.205331 | 1.1067842053 | `0.00078027073524278676916367` |

The 37k route split USD/USDC over Manifest and GoonFi V2; nearby quotes also used AlphaQ. At 1m reUSD, the route used Raydium CLMM, Manifest, and Whirlpool. This establishes a route-valid lower bound of at least 1,000,000 reUSD, far above vault 94's current collateral inventory. Individual pool-B reserve liquidity was not decoded before the branch pause, so this is route-capacity evidence rather than a reserve-level liquidity claim.

## Exact blocker / next proof step

The economic prerequisite is present: thin oracle pool A, live borrowers, zero-fee same-asset flash inventory, and a deep independent multihop exit. But profitability is **not proved**. Per-position health/credit, the manipulation needed to cross CF/LT, instruction/account packing, and the full signed fork equity ledger remain outstanding. Attacker gain and protocol loss are therefore `unknown`, not zero.

To resume, decode the two borrowing positions first, then build the smallest signed local-fork v1 chain and sweep from one raw unit through the route-valid maximum while recording every lender repayment and attacker/protocol token delta.

Primary machine-readable evidence: [`jupiter-v94-current-lead.json`](./jupiter-v94-current-lead.json).
