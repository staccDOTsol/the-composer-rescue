# Jupiter Vault 95 current-state validation

Date: 2026-10-19  
Mainnet submission: **none**  
Verdict: **not exploitable from the tested current state; reject the live-monetization lead**

## Result

The exact deployed Vault 95 path was rechecked on a current mainnet-beta fork at
slot `458744031` with transactions signed from `~/hooked.json` and
`sigVerify:true`. All nine borrowing positions are healthy. The riskiest
position is 369.8012 bps of oracle-price decline away from liquidation.

`liquidate_perfect_dex` is outsider-callable, but both the direct signed call and
every signed manipulation-plus-liquidation probe through 23,000 USDG fail at the
deployed consumer gate:

`VaultInvalidLiquidation` / custom error `6027`.

The causal blocker is stronger than insufficient probe size: the
`DexSmartColPegOracle` values perfect-share pool equity. A pool-A swap adds fee
equity and moves the oracle **up**, not down. The largest successful screen moved
the rate from `2017994830939202` to `2019496424794093` (+7.4410193 bps), while
liquidation requires approximately -369.8012 bps.

Borrowing against an existing position is independently gated by position-NFT
authority. The hooked signer has no associated account and a zero balance for
the riskiest position NFT. A fresh attacker-owned position does not rescue the
economics: even granting the attacker ownership of every pool share, the
23,000-USDG swap increased total oracle-valued pool equity by only 34.141928
USDC, permitting at most 31.410573 USDC of additional borrowing at the 92% CF,
while the swap itself lost 34.888496 USDC. The best-case bound is therefore
**-3.477923 USDC before flash fees, exit costs, priority fees, or network fees**.

Because neither a liquidation consumer nor a positive owner-borrow consumer is
reachable, the requested flash-funded final packet was not built. This follows
the explicit “build only if reachable” condition; adding lenders would not turn
the fee-backed oracle uplift into positive attacker equity.

## Exact deployment attestation

The current extracted executable hashes match the earlier exact deployed
binaries for all five components:

| Component | Program | Current executable SHA-256 |
|---|---|---|
| Vaults | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` | `2f2d6f759197ce02f27e4397a6674f18919bfb3c6704de19c308be6c8c415612` |
| Oracle | `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc` | `ec80153d65a1eb3893eda320bddcde0c942351ef93e0c9771d19c7a4f42d037a` |
| DEX | `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd` | `b259bef25bd37ce21a8bff502877a243d3e0663253523b5d4ceb447abde57646` |
| Liquidity | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` | `f7be679179291c719b204eb031cc134fe94a5299cd4bfdf705ba632863cffafe` |
| Flashloan | `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` | `b9d57b914196fe34d7ec55b732d4f78d28f54e13d329141e7e0e7dac1c2b9c09` |

Vault 95 remains a T2 smart-collateral USDG/USDC vault with CF parameter 920
(`92%`), LT parameter 940 (`94%`), pool A
`AH9SPk4p2BJJA4WdgJsagpd1D4sAnwL2Tj2gUSM5rYqy`, and oracle
`9JfwVjFMDpSVSKWt9sGXkPEsGKCLNtYo6YWvs9BAvs9h`.

## Current borrower state

| Position | Tick | Debt USDC | Collateral USDC | CF headroom | LT headroom | Drop to liquidation (bps) |
|---|---:|---:|---:|---:|---:|---:|
| `44LQ…8DR` | 402 | 9,039.550155 | 9,987.444778 | 148.899040 | 348.647936 | 369.8012 |
| `31Bk…3Jy` | 388 | 385.047005 | 434.419556 | 14.618986 | 23.307377 | 569.7783 |
| `J2nS…Mxp` | 336 | 1.091466 | 1.332121 | 0.134085 | 0.160727 | 1,276.8706 |
| `iQYS…WWz` | 316 | 229.039396 | 288.206408 | 36.110499 | 41.874627 | 1,534.4878 |
| `8Rt7…gKo` | 260 | 14.959465 | 20.467500 | 3.870635 | 4.279985 | 2,216.0536 |
| `5K1Z…jsx` | -2 | 14.783500 | 29.925277 | 12.747754 | 13.346260 | 4,744.0650 |
| `4UZ4…fhp` | -3 | 49.719473 | 100.836454 | 43.050064 | 45.066793 | 4,751.9371 |
| `B5hP…anY` | -38 | 11.686472 | 24.979154 | 11.294349 | 11.793932 | 5,020.1569 |
| `5YkH…SNK` | -1474 | 10.444236 | 192.193387 | 166.373680 | 170.217547 | 9,421.3096 |

None is currently liquidatable. The signed oracle control returned
`2017995781910098` X15; the CF and LT boundary ticks were 412 and 427.

## Independent exit

The exit condition is real but does not establish a source-side exploit. With
JupLend AMM excluded, Jupiter returned the independent Manifest market
`EXMcKF76kmBUH8xZ5fi1jv3ezh3eVQCeL4rQbpjCRxvF` for 100,000 USDG -> USDC.
A hooked-signer local-fork execution succeeded with `sigVerify:true`:

- input: `100000000000` raw USDG
- output: `99999902707` raw USDC
- error: `null`
- v1 wire: 690 bytes
- addresses: 16
- instructions: 1
- compute: 54,230 CU

This is independent of pool A, so no same-pool reverse was credited as an exit.

## Evidence

- `jupiter-v95-current-health.json`: current deployment hashes, signed oracle
  control, all nine borrower states, DEX state, and NFT-authority check.
- `jupiter-v95-liquidation-screen.json`: signed pool-A manipulation and exact
  `liquidate_perfect_dex` consumer results.
- `jupiter-v95-independent-exit.json`: current quote plus signed Manifest route
  execution.

Synthetic token balances used only to make fork simulations executable are
reported in the evidence and excluded from profit. No private key bytes are
stored or printed.
