# Jupiter Vault 95 current-state lead

Disposition: **deferred, medium confidence**. This secondary branch was paused before deep simulation. No mainnet transaction was submitted, and no same-pool reverse trade is treated as an independent exit or as evidence of safety.

## Established from retained current-state evidence

- At slot `457362048`, Vault 95 was a type-2 smart-collateral vault using `DexSmartColPegOracle` over Jupiter DEX pool `AH9S...rYqy`, with USDG mint `2u1t...jGWH` against USDC. The vault had 41 positions, 9 borrowing positions, a 92% collateral factor, and a 94% liquidation threshold.
- Pool A's two DEX supply positions held `21,761.231184` USDG and `22,096.638397` USDC. This is a thin price source relative to the vault's `22,727,125.893752` raw-unit-adjusted total position supply. A recent live `swap_in` fixture at slot `457292360` confirms the deployed pool path was active.
- The direct oracle control attempted at slot `457362740` returned `InvalidParams` because the generic read omitted path-specific dynamic accounts. That result is a harness limitation, not a healthy-price result and not proof that the consumer is unreachable.
- Existing zero-fee USDG flash evidence includes KLend reserve `ESCk...vavp` with `3,165,411.467527` USDG available at the census, and Jupiter's native wrapper with about `287,664.050707` USDG decoded available. A fresh outsider signer already completed signed `sigVerify:true` v1 borrow/repay controls for 1,000 and 100,000 USDG through the Jupiter wrapper in 662 bytes and 15 accounts, with zero net watched deltas.
- The deployed Jupiter liquidity, vault, flashloan, oracle, lending, and DEX programs were upgradeable at slots `457342445`-`457342452` under the same program upgrade authority, `4Msg...ZMSJ`. This records program authority only; it does not establish a Vault 95-specific administrative exploit.

## Exact blocker

No retained artifact proves an exit through an **independent** USDG/USDC pool B or multihop path. The only mapped USDG/USDC DEX in this branch is pool A itself. The nine borrowing positions' current health, credit headroom, liquidation boundaries, and outsider-callable monetization were not decoded. Project0 capacity for this exact USDG path was also not established.

Accordingly, the evidence establishes a manipulation lead and compatible flash inventory, but not extractable gain. There is no fresh-attacker, current-state local-fork transaction implementing `flash -> manipulate pool A -> borrow/liquidate -> independent exit -> repay` with `sigVerify:true`, one v1 envelope at most 4,096 bytes/64 accounts, full repayment, and positive attacker equity alongside measured protocol loss. Attacker and protocol equity remain **unknown**, not zero.

Machine-readable companion: [`jupiter-v95-current-lead.json`](./jupiter-v95-current-lead.json).

