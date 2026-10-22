# Flash-route harvest check

**Result:** The tested flash routes move substantial value through Whirlpool, but do not demonstrate an attacker harvest of another LP's rounded-away fees. The largest committed local route spends SOL and receives USDC through the swaps; the separate genuine attacker-owned LP deposit/withdraw route earned no collectable fees. All execution below was on mainnet-backed **local Surfpool forks**, with no mainnet submission.

## 26,230 SOL route: exact conservation

The [signed v1 local ledger transaction](economic-max-two-adjacent-prepared-send.json) borrowed 26,229 SOL from Save and 1 SOL from KLend. It completed two Whirlpool swaps, one fee update, and both repayments in 1,397,368 CU.

| Movement | WSOL/SOL | USDC |
| --- | ---: | ---: |
| First swap: actor to pool / pool to actor | −26,230 SOL | +2,685,062.550760 USDC |
| Reverse swap: pool to actor / actor to pool | +25,705.4 SOL | −2,632,721.072872 USDC |
| Save flash fee from actor's native SOL | −10.4916 SOL | 0 |
| **Actor inventory change after loan principals net to zero** | **−535.0916 SOL** | **+52,341.477888 USDC** |

The actor began the flash transaction with only 524.60001 wrapped SOL, less than the first swap's 26,230 SOL input; the borrowed funds were genuinely routed. The pool WSOL vault gained 524.6 SOL and the pool USDC vault lost 52,341.477888 USDC. Save and KLend principal vault deltas were both exactly zero; the Save fee vault gained 10.4916 SOL. Setup rent and transaction fees add further cost. This is a two-token inventory change, **not** a realized USDC profit or a transfer of a victim's lost claim.

## Attacker-owned LP negative control

The [owned-liquidity local ledger receipt](real-flash-owned-liquidity.json) opened a real position NFT for the actor, then deposited and withdrew 1,000,000,000 liquidity units inside one three-provider flash-loan transaction with real swaps. The deposit transferred 18,095,002 raw WSOL lamports and 3,765,023 raw USDC units into the pool. The withdrawal returned 18,095,132 raw WSOL lamports and 3,765,008 raw USDC units: **+130 WSOL lamports and −15 raw USDC units** on that liquidity leg. The position ended at zero liquidity with `feeOwedA=0` and `feeOwedB=0`.

Across the full owned-position transaction, the actor's token accounts changed by **−20,399,870 WSOL lamports and +1,987,246 raw USDC units**; the Save fee vault gained 400,000 WSOL lamports. These are exact token deltas, with no external price assumption. A separate [signed v1 `CollectFees` simulation](economic-harvest-collect-control.json) for the actor's NFT position succeeded (`err=null`) but transferred **zero** WSOL and **zero** USDC, confirming that the tested position had no claim to collect.

## Missing payout path

`CollectFees` requires authority over the position NFT and transfers precisely that position's `fee_owed_a/b`; it does not distribute the pool vault's excess balance. For a newly added or changed position, liquidity modification fully advances its fee-growth checkpoint before changing its liquidity, preventing it from inheriting earlier unclaimed growth. `UpdateFeesAndRewards` after PR 1396 preserves fractional growth when the owed amount rounds to zero. An outsider can still update a victim position, but cannot redirect its fees to their own position or wallet through the tested instructions. Pre-fix fractions erased from a victim's claim remain in the pool vault; no tested deposit, withdrawal, or collection instruction converts that surplus into the attacker's claim.

This is a **negative result for these tested paths**, not proof that every possible Whirlpool instruction combination is unexploitable. A positive harvest claim would require a reproducible increase in the attacker's token receipts **relative to the same swaps and liquidity moves without the victim update**, traceable to the lost claim. Any profitability claim would also need to value the final token inventory and subtract swaps, loan fees, and transaction costs. No victim-sourced increase was observed.

## Zero-fee two-lender follow-up

After the zero-fee-only constraint, a separate [signed v1 local fork transaction](ZERO-FEE-OWNED-LP-MAX.md) borrowed 5,742.317260340 SOL from a zero-fee KLend reserve and 529.03 SOL from Project0, then executed four Whirlpool swaps, two separated updates, an actor-owned liquidity deposit/withdrawal, `CollectFees`, and both repayments. The KLend supply vault, KLend fee vault, and Project0 vault all ended at their starting token balances; the transaction paid a 10,000-lamport two-signature network fee. `CollectFees` transferred **9 raw WSOL lamports and 0 USDC** to the actor's own position. That position began with zero liquidity, so this was its share of fees generated during the actor's route, not a victim's rounded-away claim. The actor's total token inventory changed by **−125.426917329 WSOL and +12,576.792005 USDC**; no victim-sourced payout was isolated. The [existing-pool after-grief deposit control](REAL-POOL-DIFFERENTIAL.md) remains the direct differential test of whether the lost claim can be captured by a new LP, and its attacker collection was zero in both branches.
