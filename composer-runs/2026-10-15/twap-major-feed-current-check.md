# Current major-asset AMM and Scope TWAP dependency check

Observed 2026-10-15. This was a read-only current-account graph joined to earlier same-day reserve snapshots; no live transaction was sent. It does not establish an outsider drain.

## Exact graph

- At confirmed slot **457365024**, all **five** correctly sized live Scope `OracleMappings` accounts were fetched. They contain **26** unfrozen Orca/Raydium AMM entries across **25** pool addresses and zero Meteora DLMM entries.
- The earlier same-day KLend census had **619** 8,624-byte reserves, of which **535** directly reference these five Scope feeds. Direct price/twap-chain matching alone had identified **one** AMM reserve (CTALS). Decoding Scope composite entries and following their source indexes changes that result to **18 reserve accounts / 11 distinct mints** with a *possible* AMM-derived price-chain dependency. They are ONyc, oTFY, PT-ONyc, AUTO, PRIME, PST, EUROP, STRCx, apyUSD, CTALS, and USD1. Composite dependencies are possible input paths, not proof that an AMM candidate is selected by the current `MostRecentOf`/cap logic or accepted by KLend risk checks.
- Among the sampled Scope-fed KLend reserves, **none** of the major mints USDC (128 reserves), USDT (19), SOL (56), JitoSOL (4), mSOL (7), bSOL (1), INF (2), PYUSD (19), ETH/WETH (5), or WBTC/cbBTC (8) had an AMM entry in its recursive price-chain dependency. The 56 reserves with Scope TWAP-derived entries include USDC, SOL, JitoSOL, mSOL, and PYUSD, but their source indexes are external feeds or stake-pool state. In the large main Scope feed, USDC TWAP index 11 reads index 7 (Chainlink type 26); SOL TWAP index 5 reads index 1 (Chainlink 26); PYUSD TWAP index 356 reads index 145 (Chainlink 26). JitoSOL and mSOL also use stake-pool exchange-rate state plus the SOL feed, not an Orca/Raydium pool for those KLend prices.
- Separate Jupiter Vaults DEX smart-peg paths are **direct same-transaction pool-state consumers**, not Scope TWAPs. The current census has 11 active Vault→Oracle→DEX paths; major pairs include vault 92 SOL/JitoSOL and vault 96 USDC/USDT. Their recorded DEX-side supply positions are approximately 705.5 SOL / 454.9 JitoSOL and 2.2846m USDC / 592.9k USDT respectively. An independent market can be used for exit in principle, but neither of those two vaults was exercised in this branch. No profitability claim follows from the dependency graph alone.

## Atomic temporal boundary

The deployed Scope binary was previously tested on five AMM entries. `refresh_price_list` succeeded before a swap/flash instruction but failed **6014 `RefreshWithUnexpectedIxs`** after any tested preceding non-Compute-Budget instruction, including a zero-fee KLend flash borrow. Therefore a one-transaction `flash → AMM move → Scope refresh → KLend payout → independent-market exit → repay` cannot deliver that AMM move into Scope under the observed deployed rule. Scope's EMA implementation additionally rejects samples less than **30 seconds** apart and validates minimum sample counts of **10/24/48/60** over its 1h/8h/24h/7d windows. The current binary ordering test is the decisive atomic blocker; the EMA timing is a separate TWAP constraint. Two-transaction prepositioning was outside this one-atomic-transaction test.

## Evidence and limits

- [Machine-readable graph](twap-producer-consumer-graph.json) and [read-only generator](twap-producer-consumer-graph.js).
- [Deployed Scope ordering controls](scope-amm-consumer-current-audit.md), including successful `refresh → flash → repay` and failed `flash → refresh → repay`.
- [Jupiter current path liquidity](jupiter-dex-path-liquidity.json); #92 and #96 need an independent exit route and full signed flash/consumer/repay simulation before any net gain can be asserted.

This crosswalk covers configured Scope entries, their decoded local composite links, KLend reserve configurations, and the one marginfi direct-feed scan in the earlier report. It does not enumerate every oracle used by perps, every direct spot reader, or every on-chain controller.
