# Hadron current mainnet screen — 19 October 2026

## Result

No validated drain or positive atomic flash-funded route. The largest live USDC vault is in DGLD, whose token currently has no independent Jupiter return route. The live USDC/USDT pool does have independent exits, but every exact-pool chained route tested through $12,000 principal loses money before lender and transaction costs. No transaction was broadcast, and no exploit simulation was attempted against mainnet.

## Exact deployed target and inventory

- Hadron core: `HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8`; mainnet-beta genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`.
- Deployed binary lastDeploySlot `427502351`; SHA256 `d08a1a5993212f5b858a371460a8b804896d139d47b6bb57f3755fb53a1d977a`.
- At confirmed slots 458741413–458741435, all 994 program-owned 724-byte accounts decoded with official `@hadron-fi/sdk-v2@0.1.9` and matched their derived config PDAs. All 1,988 derived vault token accounts had the expected mint, config authority and token-program owner.
- State counts: 75 Initialized, 1 Paused, 47 RejectSwaps, 871 Closed. 56 Initialized and 9 RejectSwaps pools held nonzero tokens. The observed USDC side across all pools was $583,536.317852; that is **not TVL** because 26 non-USDC pools and all base vaults are not dollar-valued here.
- The DGLD pool `rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs` held 344.760190888 DGLD and $485,840.092010 USDC. Forced direct Hadron USDC→DGLD quote succeeded, but DGLD→USDC excluding Hadron returned `NO_ROUTES_FOUND` with both direct-only and unrestricted Jupiter routing. Its pool oracle price updated during this run, so stale dollar marks are unsuitable as proof of independent exit value.
- A separate current mint-account census found 84.6849% of the 407.109 DGLD supply in that Hadron vault. The separate SDK packet audit built only a **static** USDC flash-borrow → Hadron swap → repayment scaffold: 1,133 bytes and 28 unique accounts, leaving 2,963 bytes and 36 accounts under the requested 4,096-byte/64-account caps. It contains no exit instruction and proves no profit or executability.
- The three Oct 15 examples ANTHROPIC, FIGUREAI and KALSHI are currently `RejectSwaps` with zero base and USDC vault balances.

## Independent exit and flash-size economics

- The initial active USDC-pair screen checked 15 pools with at least $100 USDC. Seven yielded an exact-target Hadron quote; three yielded a valid independent return quote on the first pass, all negative on $100 principal: -$0.397939, -$0.355560, -$0.448828. Four rows encountered public Jupiter 429 rate limits and are inconclusive. Eight rows got no forced Hadron route at that size; this is an API result, not proof the binary cannot swap.
- The separate live USDC/USDT pool `GPHRA3MJGT4ERmsq3sgt9Mcf3WVdG81oJia7yuLZ6ixU` held 5,052.452437 USDC and 13,682.342323 USDT. Current spread was approximately 0.03 bps, pair fee 2 ppm, oracle mode Authority, and `spreadConfigInitialized=false` with zero triggers. Its price curve is flat until a 75% clip and inventory risk curve adjusts gradually around the balanced inventory point.
- For Hadron-first USDC→USDT→USDC, exact pool key checked and independent exit excluding Hadron, quote PnL before lender/tx fees was: $100 -$0.000943; $500 -$0.004559; $1,000 -$0.009440; $2,500 -$0.032619; $5,000 -$0.072209; $7,500 -$0.104845; $10,000 -$0.183213; $12,000 -$0.385983. The $7,500 and $10,000 legs shared a Jupiter context slot; the $12,000 pair was 56 slots apart and is weaker evidence.
- For independent-first USDC→USDT→USDC through Hadron, quote PnL was negative at $100, $500, $1,000, $2,500 and $5,000; the $5,000 result was -$0.463129. No positive route remained to justify building a signed flash-loan packet or measuring its 4 KB/key footprint. The negative quote numbers are screening evidence; they are not an atomic simulation.
- A separate $12,435 USDC X-stock pool `DbQYhsmBypcxb23ruDmcWb1k43YjnaNR22yonCVeP7Ke` gave a $100 Hadron-first independent return loss of about $0.127784 after a rate-limit retry. Its current spread was ~13.3 bps and fee 400 ppm. No large positive lead arose there.

## Raw-vault donation, queued curves, Token-2022 and aliasing

- The official SDK's inventory helper consumes raw vault token-account amounts, so unsolicited transfers were treated as potentially price-relevant rather than dismissed as harmless accounting noise. `hadron-donation-risk-screen.json` tested both vault sides from one atom through 10x-reserve donations. DGLD's active risk factors remained exactly `1 / 1` at every sample, so a donation changed inventory percentage but conferred no inventory-price advantage; it also still lacked an independent exit.
- The USDC/USDT pool was measurably donation-sensitive but economically non-viable. At 10 USDC atoms (`$0.00001`), the best favorable factor change was `3.73e-14`; even granting that change across the entire larger vault produced less than `$4.4e-10` of benefit. At a `0.505245 USDC` donation, the deliberately generous whole-vault benefit bound was only `$0.000021568`, leaving at most `-$0.505223432` before Hadron, exit, flash, priority, and transaction fees. Every sampled donation bound was negative.
- `hadron-pending-curve-updates.json` decoded the pending-update PDAs for the top 16 live USDC pools at slots 458743933–458743946; all had `numOps = 0`. DGLD's dedicated recheck at slot 458743086 likewise had sequence 0 and no ops, so there was no current update-on-next-swap transition to harvest.
- DGLD's Token-2022 mint had `PermanentDelegate`, `TransferFeeConfig`, and `PausableConfig`, but both fee schedules were 0 bps with maximum fee 0, mint/vault withheld amounts were zero, no transfer hook existed, and the mint was not paused. These privileged mint controls were not outsider capabilities and created no present fee-accounting surplus.
- The official SDK derives both user ATAs and both pool vaults deterministically; a DGLD swap uses one signer, 17 account metas, and 26 data bytes. Its documented `_authority` meta is unused, so aliasing it cannot redirect SDK-level value flow. The current binary exposes explicit vault-address, vault-mint, and user-token-account validation errors. A bespoke malformed raw-instruction alias bypass was not established; without a positive independent-exit path it did not pass the economic gate for a signed full-route simulation.

## Atomic simulation gate

No hooked-wallet `sigVerify:true` simulation was run because no candidate was positive even before flash, priority, and base transaction costs. The static non-exit scaffold (optional DGLD ATA creation, zero-fee KLend USDC borrow, one SDK Hadron swap, and repayment) encoded to 1,133 bytes, 28 unique accounts, four instructions, and one signer. It leaves 2,963 bytes and 36 accounts under the requested limits, but contains no independent exit and therefore proves neither executability nor profit.

## Limits and policy

The official [Hadron security policy](https://hadron.fi/security) scopes the core program but asks for local validator/LiteSVM/devnet testing, forbids exploiting mainnet pools, and excludes operator-set bad prices or curves as protocol vulnerabilities. The official [Hadron product page](https://hadron.fi/) describes per-caller spread controls; the USDC/USDT and $12.4k X-stock pools inspected here had no such triggers at the observed state. No reportable issue is established by these quote screens.

## Evidence

- `hadron-current-program.json`, `hadron-current.so`, `hadron-current-census.json`: deployed program attestation, exact binary, and full current config/vault census.
- `hadron-live-pools.json`, `hadron-top-configs.json`: decoded current state, oracle, fee, spread, authority and risk data.
- `hadron-independent-exit-screen.json`, `hadron-stable-depth-screen.json`, `hadron-stable-extreme-screen.json`: exact-pool route screens and negative after-swap PnL.
- `hadron-donation-risk-screen.json`, `hadron-donation-economics.json`, `hadron-pending-curve-updates.json`: raw-vault donation bounds and current empty update queues.
- `hadron-dgld-exit-census.json`, `hadron-binary-state-snapshot.json`, `hadron-sdk-envelope-audit.json`, `hadron-sdk-simulation-gate.md`: companion current binary, supply/Token-2022 review and static packet sizing; these do not include a complete atomic route.

All scripts in this directory are read-only and keep the RPC key in process memory.
