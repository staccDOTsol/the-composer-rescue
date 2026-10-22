# Solana outsider-risk campaign checkpoint — 2026-10-15 15:35 Toronto

**Validated permissionless outsider drains: 0.** No live transaction was submitted. A program controller's marked token or stake balance is not counted as extractable value without a current-binary unauthorized withdrawal and an executable unwind.

## Exact progress denominator

- **77,715** current executable mainnet program IDs in the independently matched loader census; this is an inventory, not an audit count.
- **3,987** Jupiter-verified mints, **69,054** token-account rows, and **334** directly mapped executable token controllers in a bounded top-20-account scan. The separate unverified active-token lane added 63 mints and no novel executable controller in its bounded sample.
- **59** separate Daybreak chats dispatched: 55 program/controller and four chain-wide discovery assignments. Dispatch is not completion.
- **14** distinct current-state AMM/flash composition classes with complete lender repayment and final accounting in the [atomic surface ledger](outsider-atomic-amm-surface.md). None demonstrated unauthorized net gain.

## Decisive complete transaction

A single actor controlling two fresh signed keys initialized a Project 0 marginfi account and executed Project 0 USDC plus exact-zero-fee KLend WSOL flash, Orca swaps, Kamino Liquidity deposit and withdrawal, both flash repayments, and the Project 0 flash end **inside one Solana v1 transaction**. The local mainnet-fork replay had `sigVerify:true`, **2,238 serialized bytes**, **51 addresses**, **14 instructions**, and **738,867 CU**. All minted shares were burned. The Project 0 lender vault and KLend supply/fee vault had zero token deltas; marginfi active balances ended empty. The actor lost **0.050071027 SOL and 7.351865 USDC**, with zero Kamino shares, before rent/transaction fees. [Signed-route report](p0-klend-single-attacker-feasibility.md) · [Machine evidence](p0-klend-single-attacker-full-route.json).

## Other completed boundaries

- A KLend/DAMM v2 route with an independent DLMM exit fit in **1,335 v1 bytes**, repaid fully, and lost approximately **197,383 raw USDC** after valuing remaining USDP dust at an executable quote. [Evidence](damm-v2-residual-assessment.md).
- Meteora DBC had 15 successful outsider-focused flash round trips among 21 attempted; all successful routes repaid and lost 2–9 raw USDC. Two apparent external venues routed back into DBC rather than independently consuming its price. [Evidence](meteora-dbc-custody-audit.md).
- Scope has 26 configured AMM entries across 25 distinct pools in five mapping accounts. A same-transaction prior swap or flash caused current-binary `RefreshWithUnexpectedIxs` 6014 in 25 tested entry cases, blocking that particular price-refresh path. [Evidence](scope-amm-consumer-current-audit.md).
- Akashi Vault `RefreshLeg` really passes an Orca PYUSD/USDC pool into Hastra adapter `AaiValue`; the deployed refresh replay succeeds. It makes no payout. The exact sampled refresh, Orca swap, and minimal KLend state need at least **68 unique accounts before a payout**, exceeding the tested 64-account v1 limit. No `ClaimWithdrawal` was seen in 915 returned successful Akashi transactions. This is an unresolved valuation dependency, **not** a drain. [Evidence](akashi-hastra-orca-consumer-triage.md).

## Current high-value gates

- JanusFI: current outsider wallet and buy/sell instruction semantics identified; complete lender-funded round trip and final equity pending.
- OnRe: permissionless zero-fee USDG-to-ONyc offer confirmed; reverse redemption/Prop AMM includes a 1 ONyc minimum plus 30 bps fee. Complete flash/unwind accounting pending.
- Hastra wYLDS: current binary matches published artifact; atomic deposit controls repay lenders. Final user equity is being rerun against a quiet account because the first wallet transacted independently during measurement.
- Hylo, PRIME, XP1BR, MOVEUSD, Solstice, and additional ranked controllers remain under current-binary review. Meteora Alpha Vault live-capacity checks eliminated the first WSOL candidates by exhausted purchase cap or disabled pool.
- Three newly dispatched native-stake controllers have bounded gross custody of 48,493.545, 37,508.016, and 13,401.364 SOL respectively; authority evidence and outsider withdrawal feasibility remain distinct questions. [Ranked evidence](nonregistry-next-candidates.md).

This is a time-stamped evidence checkpoint. It does not claim that all 77,715 executables or 59 assigned targets have completed audits.

## Later correction (15:41 Toronto)

The first dedicated 2rU1o audit re-queried current stake authority at finalized slots 457357589–457357598 and found **63 stake accounts / 593.391547041 SOL**, plus **691.991666709 SOL** in its vault: **1,285.383213750 SOL** current gross. This conflicts with the earlier bounded **48,493.545 SOL** queue estimate above. The old figure must **not** be used for current value ranking.

An independent exact-authority recheck across all 69 pool/config authorities at finalized slots 457358593–610 confirmed current ranking: **SVSPx 37,508.016781269 SOL**, **vBoNd 9,755.660449595 SOL**, **2rU1o 1,285.383213770 SOL**. The archive RPC still returns thousands of old 2rU1o stake accounts at an older slot, while live RPC returns 63; sampled archived accounts are absent from live and one is independently absent on public RPC. A stale archive account index is the leading explanation, not yet proved. [Recheck evidence](native-secondary-finalized-recheck.json).
