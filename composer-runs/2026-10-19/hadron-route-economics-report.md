# Hadron route/economics branch — 2026-10-19

## Decision

No current, outsider-accessible, pre-flash-fee-positive route was established. Under the requested gate, no hooked-wallet signed local-fork packet was built or simulated.

## Current evidence

- `hadron-current-census.json` observed the unchanged deployment (slot `427502351`, binary SHA-256 `d08a1a5993212f5b858a371460a8b804896d139d47b6bb57f3755fb53a1d977a`) and 75 swap-enabled configs at slots `458741413–458741435`.
- DGLD pool `rQsUkc...` held `344.760190888 DGLD` and `485,840.092010 USDC`. A forced-Hadron `100 USDC` quote returned `23.869246 DGLD` at slot `458741694`, but the exact output had no Jupiter route back to USDC when Hadron was excluded. `hadron-dgld-exit-census.json` also shows Hadron held 84.6849% of DGLD supply at slot `458743407`; the mint's transfer fee was 0 bps and it was not paused.
- The three screened initialized xStock pools with valid independent exits were already negative before lender and transaction costs: `-$0.397939`, `-$0.355560`, and `-$0.448828` on `100 USDC` principals (quote slots `458741789–458741835`).
- The live USDC/USDT pool `GPHRA...` was the closest route to parity. Both direction orders were negative at `100–5,000 USDC`; Hadron-first was `-$0.000943` at `100 USDC` and `-$0.072209` at `5,000 USDC`. Extreme Hadron-first inputs of `7,500`, `10,000`, and `12,000 USDC` remained negative by `-$0.104845`, `-$0.183213`, and `-$0.385983`, respectively, before flash and transaction fees.
- `hadron-pending-curve-updates.json` decoded every queued update buffer for the top 16 live USDC pools at slots `458743933–458743946`: every `numOps` was zero. Therefore no current queued curve transition can be harvested on a next action in those pools.

## Unsolicited-vault-donation branch

The official SDK's inventory function explicitly consumes raw vault token amounts. This branch therefore tested the conservative assumption that an unsolicited token transfer immediately influences the same raw inventory inputs; it does not claim a separate accounted-balance ledger exists.

- DGLD's active risk factors stayed exactly `1 / 1` for donations from one atom through 10x each reserve. Donation changes raw inventory percentage but produces no pricing-factor benefit, and DGLD still lacks an independent exit.
- For `GPHRA...`, raw donation does move inventory factors, but far too weakly to recover the donation. A `0.505245 USDC` donation improves the most favorable factor by only `1.5763e-9`. Even granting that improvement across every unit of the entire larger post-donation vault yields at most `$0.000021568`, so the donation-only net is at most `-$0.505223432` before Hadron, exit, flash, priority, and transaction fees.
- Atom-level checks rule out a small-donation rounding pocket: at 1 atom the factors do not change; at 10 USDC atoms (`$0.00001`) the favorable delta is `3.73e-14`, worth less than `$4.4e-10` under the same deliberately generous full-vault bound.
- `hadron-donation-economics.json` covers 1 atom through 10x-reserve donations on both vault sides. Every bound is negative. This is stronger than a normal executable quote because it ignores curve depth and all route costs while granting the factor improvement over a whole vault.

## Scope limit

Jupiter chained quotes are current route/economics screens, not atomic state simulations. Several other live pools were unavailable through forced-Hadron or independent routes during the bounded quote window, so they are not asserted safe. They did not meet the prerequisite for a complete borrow → Hadron → independent-exit candidate.

Evidence files: `hadron-independent-exit-screen.json`, `hadron-stable-depth-screen.json`, `hadron-stable-extreme-screen.json`, `hadron-pending-curve-updates.json`, `hadron-dgld-exit-census.json`, `hadron-donation-risk-screen.json`, and `hadron-donation-economics.json`.
