# Oracle-consumer check for two small WSOL/USDC Whirlpools

Checked 2026-10-19. Scope: pool `C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd` (C7) and pool `3PRT79bw3hoMd9S4uC8mPTKvJVgqGa2NuS7ZLX92RFNn` (3PRT). This check made no mainnet state changes.

## Result

**No current, value-transferring protocol was identified that binds either exact pool as its price oracle.** Consequently there is no demonstrated oracle-extraction victim or profitable transaction to report from the zero-liquidity price movement alone. This is an evidence limit, not proof that no private or dynamically configured integration exists.

The local mainnet-backed fork's [config and pool snapshot](config-authority-scan.json) at slots 458879677–458879678 records C7 at liquidity `607354963`, fee rate `2500`, and config `35VNM…` (not the user's `12Nq…` authority); 3PRT at liquidity `301845`, fee rate `0`, protocol fee rate `0`, and config `FBb9…` whose fee and collection authorities are `12Nq…`. The [C7 upper-boundary receipt](upper-one-sided-boundary.json) demonstrates that its stored `sqrt_price` can move 112 ticks through zero active liquidity after a 2-raw-USDC boundary swap, with no further token transfer during the empty-range move. That supplies a price-manipulation primitive, not a consumer or extraction proof.

## Exact-address consumer search

| Candidate | Primary-source evidence | Classification |
| --- | --- | --- |
| `grooviegermanikus/arbi-mango-bot1` | Its [price-swap source, lines 27–75](https://github.com/grooviegermanikus/arbi-mango-bot1/blob/c363dc7e0a446440d6a707324a1110f7658e8d59/src/services/asset_price_swap.rs#L27-L75), calls Jupiter for a route quote. The C7 address occurs only in a commented example of a returned route at line 70. | Historical example of a pool appearing in a router quote; no hard-coded C7 oracle binding, on-chain victim instruction, or current runtime use established. |
| `staccDOTsol/yet-another-searcher` | A [C7 pool-state JSON snapshot](https://github.com/staccDOTsol/yet-another-searcher/blob/1e62cbb5f5fc73b3ee0761ff8cf7aa91229825ee/pools/whirlpools/C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd.json) records the pool address and state. | Search/index data, not an oracle consumer or payout path. |
| `guidebee` quote service | Its [January 2026 design log, lines 190–218](https://github.com/guidebee/guidebee.github.io/blob/0d6c9a8879eee11f134fd4c5cc5e5035efe95d7a/_docs/30.7-QUOTE-SERVICE-DESIGN-UPDATE.md#L190-L218) cites a truncated C7 address as an example of an incorrect CLMM quote (~70×), attributes that to using a constant-product calculator, and documents a correction. The [same log, lines 18–37](https://github.com/guidebee/guidebee.github.io/blob/0d6c9a8879eee11f134fd4c5cc5e5035efe95d7a/_docs/30.7-QUOTE-SERVICE-DESIGN-UPDATE.md#L18-L37) says quote-service development was paused. | Off-chain quoting development record; no verified live service that transfers value based on current C7 spot. The reported pricing bug is not this zero-liquidity behavior. |
| 3PRT | Exact full-address and `3PRT79bw` prefix searches returned no GitHub code results; ordinary web results were pool-market pages, not protocol source. | No identified consumer. Search coverage does not exclude runtime configuration. |

Searches used GitHub's code-search connector for both full addresses and prefixes, plus public web searches pairing the addresses with `oracle`, `sqrt_price`, and Solana protocol terms. Exact C7 results were the first two repositories above; the prefix search added the `guidebee` document. The linked code and docs were read rather than treating snippets as evidence of a live integration.

## A plausible architecture that does **not** establish a target

The `Fusion-Core-Finance/fusion-core` repository really does describe an on-chain `sample_twap` instruction that parses an Orca Whirlpool `sqrt_price`, stores observations in a `DexTwap` ring, and aggregates them with Pyth and Switchboard data ([technical reference, §§6.3–6.4](https://github.com/Fusion-Core-Finance/fusion-core/blob/master/docs/fusion-docs.md#L744-L793); [CLMM layout](https://github.com/Fusion-Core-Finance/fusion-core/blob/master/docs/clmm-pool-layouts.md#L190-L230)). That is an example of the kind of external price consumer required for an oracle attack. It does **not** identify C7 or 3PRT in its source or docs. Its own [reference calls its program ID a dev ID](https://github.com/Fusion-Core-Finance/fusion-core/blob/master/docs/fusion-docs.md#L250-L254), [names a different Whirlpool](https://github.com/Fusion-Core-Finance/fusion-core/blob/master/docs/clmm-pool-layouts.md#L193-L207) for its decode proof, and [lists launch wiring as planned](https://github.com/Fusion-Core-Finance/fusion-core/blob/master/docs/fusion-docs.md#L1364-L1367). The cited design also has a time-series TWAP, feed corroboration, and validation gates; an atomic one-sample spot move is not demonstrated to pass them.

## What remains unproved

To claim extractable oracle mispricing, identify a deployed victim program and a specific market/config account storing C7 or 3PRT as its oracle pool; show a victim instruction reads that pool's changed `sqrt_price` in the attack window; demonstrate its freshness, TWAP, liquidity, and independent-feed checks pass; and measure victim assets gained net of swaps, external exit, flash repayment, fees, and price restoration. A router's displayed price or a stale off-chain code comment does not satisfy that chain.

I attempted a read-only `getSignaturesForAddress` call to the supplied Helius endpoint for both pools. This shell's network sandbox failed DNS resolution before reaching the RPC endpoint, so I did **not** perform an independent live transaction-history or account-reference scan. The existing local fork snapshots and receipts support the pool-state and movement claims above, but they cannot certify absence of dynamically configured oracle consumers on current mainnet.
