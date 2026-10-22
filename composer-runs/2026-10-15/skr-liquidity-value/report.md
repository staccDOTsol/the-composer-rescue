# SKR staking vault: custody and market-liquidity check

Read-only observations on 15 October 2026. No transaction, order, or transfer was submitted. Raw responses and reproduction scripts are in this directory.

## Custody and token accounting

- The [official Solana Mobile SKR announcement](https://solanamobile.com/blog/skr-is-live) identifies `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` as the SKR mint and `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ` as the staking program.
- At confirmed slot **457347509**, the token account `8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8` held **5,077,227,509.428822 SKR**, with mint matching SKR and token authority `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw`. This is **47.6378%** of the on-chain **10,657,978,620.332743 SKR** supply. The token mint has no freeze authority. `snapshot.json` contains the raw and parsed RPC responses.
- The authority is an exact `["stake_config"]` PDA owned by the currently executable staking program. The vault is an exact `["stake_vault"]` PDA. Both derivations have bump **255**. The 193-byte config's discriminator and fields decode against the [historical first-party Solana Mobile IDL at commit `6ae3d4`](https://github.com/solana-mobile/react-native-samples/blob/6ae3d418bedfcf1b982b18ce8078d57d9c536ad0/skr-staking/program/idl.json). That sample was removed from the repository's current branch; the live bytes independently confirm the mint, vault, PDA, and layout. `decoded-config.json` has all fields.
- Config records **4,377,486,847,822,725 raw outstanding shares**, share price **1,154,206,571** on a 1e9 scale, **172,800 seconds** cooldown, and `last_vault_amount` exactly equal to the observed vault balance. These fields indicate a pooled user-claim liability. The difference between share-price-implied tokens and vault balance is **not** evidence of freely extractable surplus; it can include pending withdrawal accounting or other program state.
- The broader audit's newest-20-transaction sample found no outbound vault transfer. My independent scan checked the newest **400 successful transactions** from a 1,000-signature vault page and likewise found no outbound SPL transfer. This narrow recent sample cannot establish that the program lacks an exit. The main program audit found an older successful Withdraw exit at slot **457330039**. My `exit-search.json` records the bounded negative recent sample.

## Spot mark versus executable market depth

At the Jupiter token registry's approximately contemporaneous price of **$0.014367354242/SKR**, multiplying by the vault balance yields **$72,946,326**. This is a **gross spot-price mark**, not proceeds from liquidating the vault. The same registry reported approximately **$611,213** token liquidity and **$654,269** combined 24-hour on-chain buy and sell volume. Those registry metrics are descriptive, not executable bids. The raw registry response is in `snapshot.json`.

Read-only Jupiter `ExactIn` quote requests from SKR to USDC, with `slippageBps=100` and `restrictIntermediateTokens=true`, returned:

| SKR input | USDC output | Output / spot mark | Quoted price impact |
|---:|---:|---:|---:|
| 1,000,000 | $14,264 | 99.28% | 0.76% |
| 5,000,000 | $63,588 | 88.52% | 11.52% |
| 10,000,000 | $111,502 | 77.61% | 22.42% |
| 20,000,000 | $178,135 | 61.99% | 38.03% |

The 20M quote represented only **0.394%** of the vault and split among HumidiFi, Byreal, and Whirlpool pools at quote context slot **457347515**. The 30M, 40M, 75M, 100M, 1B, and full-vault inputs returned `NO_ROUTES_FOUND`; a 50M request returned `ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT` with `partialInAmount` of 22M SKR. These are quote-service results, **not proof of a universal upper bound** on eventual sale proceeds. A request for unrestricted intermediate tokens was rejected by Jupiter's free tier with `NOT_SUPPORTED`; subsequent quote requests hit HTTP 429. `snapshot.json` and `unrestricted-quotes.json` preserve the exact responses.

To check that the gap is not merely a Jupiter routing artifact, I fetched public spot books for [Kraken SKR/USD](https://api.kraken.com/0/public/Depth?pair=SKRUSD&count=500), [KuCoin SKR/USDT](https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=SKR-USDT), [Gate SKR/USDT](https://api.gateio.ws/api/v4/spot/order_book?currency_pair=SKR_USDT&limit=1000&with_id=true), and [Bybit SKR/USDT](https://api.bybit.com/v5/market/orderbook?category=spot&symbol=SKRUSDT&limit=200). At about **19:07:32 UTC**, their combined displayed bids were about **3.70M SKR / $52,955** within 1% of each venue's best bid, **8.25M SKR / $117,472** within 5%, and **9.00M SKR / $127,389** within 10%. The computation approximates 1 USDT as 1 USD. All four books returned levels past the 10% threshold, so this threshold sum was not cut off by a 100-level venue response. `cex-depth.json` includes raw books and per-venue depths.

As a small-trade price control, Kraken's best bid/ask at that snapshot was **$0.014364 / $0.014379**, around the Jupiter registry spot price; Bybit's was **0.014393 / 0.014395 USDT**. This supports a real traded asset near the spot mark for small size, while the depth figures limit what was visibly bid at those prices.

Exchange bids can be cancelled, are not synchronized, may include common market makers across venues, and require venue-specific deposits and access. They cannot be counted as liquidity available to one atomic Solana transaction. The DEX quotes and spot books establish meaningful **small-trade** value for SKR, while showing that the **$72.95M mark vastly exceeds demonstrated immediate depth**. They do not establish a precise recoverable or exploitable dollar amount for the whole vault.

## Exact remaining economic blocker

No tested single on-chain route converts the full vault, or even 30M SKR, to USDC in one quote. The quote service's restricted routes and rate limit prevent a complete on-chain market-depth bound, while off-chain exchange liquidity cannot be used inside an atomic Solana transaction. Any loss estimate beyond the demonstrated sizes requires a specific unauthorized vault exit, a realizable settlement path, and accounting for share claims, slippage, venue access, and market response. A successful authorized Withdraw exit is a control sample, not an unauthorized value-moving finding.
