# Heuristic atomic attack-path graph

Observed 2026-10-15T20:10:05.487855+00:00. Read-only evidence merge from the 77,715 executable census, 334 bounded direct controllers, current DEX-peg vaults, five Kliquidity strategies, and live transaction/RPC controls. **No outsider unauthorized gain validated; $0 proven at risk.**

The ranking unit is a path through a price or share consumer into an independently executable exit, not a program or gross vault balance. `reachableValueUsd` and `independentExitQuoteUsd` are null for all 20 because no deep independent market B plus full signed max-flash settlement has been proven. A source vault balance is an inventory upper bound, never an executable maximum.

## Highest-priority path tests

| Rank | Path | Current consumer evidence | Attributable capital / blocker |
|---:|---|---|---|
| 1 | `jup-dex-vault-103-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 8; B exit unquoted |
| 2 | `kliq-Hmj82e48-cross-pool` | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`; public ratio deposit/share mint then own-share withdrawal | $16.74m controlled strategy assets; B exit unquoted |
| 3 | `jup-dex-vault-97-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 16; B exit unquoted |
| 4 | `jup-dex-vault-96-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 22; B exit unquoted |
| 5 | `jup-dex-vault-93-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 10; B exit unquoted |
| 6 | `jup-dex-vault-91-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 20; B exit unquoted |
| 7 | `kliq-C7HgBuY7-cross-pool` | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`; public ratio deposit/share mint then own-share withdrawal | $10.06m controlled strategy assets; B exit unquoted |
| 8 | `kliq-ByPbo7yG-cross-pool` | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`; public ratio deposit/share mint then own-share withdrawal | $10.51m controlled strategy assets; B exit unquoted |
| 9 | `jup-dex-vault-95-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 9; B exit unquoted |
| 10 | `jup-dex-vault-90-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 13; B exit unquoted |
| 11 | `jup-dex-vault-105-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 4; B exit unquoted |
| 12 | `jup-dex-vault-98-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 1; B exit unquoted |
| 13 | `kliq-HCntzqDU-cross-pool` | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`; public ratio deposit/share mint then own-share withdrawal | $5.98m controlled strategy assets; B exit unquoted |
| 14 | `jup-dex-vault-94-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 2; B exit unquoted |
| 15 | `jup-dex-vault-92-cross-pool` | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`; owner-signed operate/borrow using same-slot GetBothExchangeRate | positions 7; B exit unquoted |
| 16 | `kliq-DzGJLoq3-cross-pool` | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`; public ratio deposit/share mint then own-share withdrawal | $3.64m controlled strategy assets; B exit unquoted |
| 17 | `fragmetric-jsol-receipt-cross-market` | `fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3`; routed swap or public receipt/share exit; exact auth to verify | gross mark only; B exit unquoted |
| 18 | `bison-eth-routed-cross-market` | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`; routed swap or public receipt/share exit; exact auth to verify | gross mark only; B exit unquoted |
| 19 | `xp1br-rkusol-adapter-cross-market` | `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy`; routed swap or public receipt/share exit; exact auth to verify | gross mark only; B exit unquoted |
| 20 | `hylo-stability-hyusd-cross-market` | `HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ`; routed swap or public receipt/share exit; exact auth to verify | gross mark only; B exit unquoted |

## Cross-program filters

- Eleven Jupiter vaults have live `DexSmartColPegOracle` or debt-peg sources and successful current oracle returns; two paths have deeper current operate/flash controls. Each vault ID is distinct, but they share the same oracle/controller executable. Their position debt metric is not a dollar payout estimate.
- Five Kamino Liquidity Orca strategies have $46.922m aggregate directly attributable controlled positions, without adding the surrounding Orca pool TVL. The existing pyUSD/USDC flash loop unwound in pool A and lost about $0.205. Independent B exits for all five are untested.
- Bison ETH, XP1BR rkuSOL, Fragmetric JSOL, and Hylo Stability hyUSD are lower confidence edges. Their control evidence establishes program spending or own-share operation, not unauthorized payout. The graph spells out the auth and independent-exit tests.
- Scope has 18 KLend reserves whose price chain depends on an AMM entry, and 56 with TWAP dependencies. Its current refresh instruction refuses a preceding swap/flash or CPI; these edges are blocked for the required same-transaction ordering until a direct reader is found.
- RaTEZ RTX and the Helium IOT routed reward path were downgraded after live finalized checks: the observed payouts go to claimant-owned ATAs, and IOT requires an oracle-signed reward update.

## Selection rule and decisive gate

score = 6*evidenceScore + 4*valueEvidenceScore + 2*min(flash source count,4) - 3*barrier count; evidence priority, not estimated profit. No source inventory is executable max until proven.

For each path, use attacker-only signatures, `sigVerify:true`, one Solana v1 transaction ≤4,096 bytes and ≤64 account keys. Borrow literal route-valid maxima from one, two, or three compatible KLend/Project0/other sources, test ±1 at each boundary, manipulate pool A, execute the value-moving consumer, settle through **independent** pool B, repay every lender, and include all user tokens, receipt shares, debt and protocol reserves in final equity. If no B pool, no permissionless consumer, or no viable transport envelope exists, record that exact blocker.

Machine-readable path details: `heuristic-atomic-attack-graph.json`.
