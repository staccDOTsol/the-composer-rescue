# New major-route controller screen — 2026-10-15

Mode: read-only Solana mainnet-beta RPC and Jupiter ExactIn quotes. No transaction was signed, simulated, or broadcast in this screen.

## Denominator and result

The two saved [direct-route discovery batches](major-direct-route-discovery.json) and [batch 2](major-direct-route-discovery-batch2.json) contain **32 quote rows**, representing best direct quotes for **16 chosen major-token pair/size inputs in both directions**. They exposed **11 non-null executable program owners**, plus one Sanctum route whose `ammKey` was not an existing account at the queried slot. This is a bounded best-route screen, not all mainnet programs or all pools. Of these owners, the only newly routed controller outside the existing focused queue was The Vault Liquid Unstaker `2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo`. Manifest is already covered by the [orderbook audit](orderbook-dex-custody-audit.md). AlphaQ was covered for CASH/USDC, but its major-token pairs had not yet received this quote gate.

**No route produced an independent-exit gross gain at sampled sizes; no outsider-accessible value extraction was validated.** A signed flash-loan composition was not justified by the observed price gate.

## The Vault Liquid Unstaker: current program control and exit gate

At confirmed slot **457421731**, the executable program owned its 316-byte Pool `9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb`, 144-byte Jupiter-routed market `HYvsj7UMAt2tE4QQfDwXiegogwtVJ13fuucjtZw1bf8E`, and native SOL vault `6RLKARrt6oPCyuMCdYdUHmJxd4wUa6ZeyiC8VSMcYxRv`. The vault held **588.555474163 SOL**. The earlier full native-custody census verified another **47,801.553465614 SOL** in 2,542 Stake accounts under the Pool PDA; that is a prior snapshot, not a fresh current balance or free equity.

The live ProgramData is `DhUnAcd5CgwtvaS7ny1Epcgm6rR8zcQbJ1MpKmJHbUsP`, last deployed at slot **419656198**. Successful transaction `EdTvE8TRt3DynLbcRTmoctTf7CeGoe8hrkdKKPzm71XDninVDvmmUdPkAhatVjX2u1TKUi7ZxFujtSEmyujd6RZ` at slot **457402425** postdates that deployment. Its top-level 2rU1 instruction reduced the program-owned SOL vault by **24.994306640 SOL**, while the signing unstaker's account gained **24.991889918 SOL**; the same parent invoked Stake `deactivate` with the Pool PDA as stake authority. That demonstrates live value movement by the deployed controller, not an unauthorized withdrawal. See [deployment/outflow](vault-liquid-unstaker-deploy-outflow.json), [40 recent vault deltas](vault-liquid-unstaker-recent-vault-deltas.json), and [current gate](vault-liquid-unstaker-route-gate.json).

Jupiter's best direct first leg selected this exact `2rU1` market at 1, 10, and 100 JSOL. The independent direct reverse leg used Sanctum, and each round trip lost JSOL **before** signature, compute, priority, or flash costs:

| First-leg input | Net JSOL raw after independent reverse | JSOL loss |
|---:|---:|---:|
| 1 JSOL | −4,120,180 | 0.004120180 |
| 10 JSOL | −41,196,984 | 0.041196984 |
| 100 JSOL | −451,415,315 | 0.451415315 |

At 500 and 1,000 JSOL the best direct first leg switched to Sanctum, so those quote rows do not measure the target controller. The pool's current state in the earlier [native stake audit](mainnet-native-stake-custody.md) decoded `flashEnabled=0`; an external flash lender could fund a route but cannot turn these observed negative exchange cycles into an observed gain.

## AlphaQ newly quoted major pools

At confirmed slot **457421970**, the current `ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA` executable owned three 672-byte pool states routed by Jupiter: USDS/USDC `6R3LknvRLwPg7c8Cww7LKqBHRDcGioPoj29uURX9anug`, JitoSOL/WSOL `hKH9LFREBm3TxTx5Ex6D1nHTKEA8ii3CWfhEkB9s21u`, and mSOL/WSOL `DbTYuFpdELAgyZBhX7TaTVDGYq1dJSQqdnAhtWHjxPjP`. The prior [propAMM activity sample](propamm-live-census.json) observed 10 direct AlphaQ token outflows in 15 transactions, but did not prove each of these particular pool states had a PDA-signed vault outflow.

The new [quote gate](alphaq-major-route-gate.json) sampled **12 first-leg sizes**, one input direction per pair. Six selected the exact AlphaQ pool. Five had an independent Manifest reverse exit, all negative before costs: 100 USDS lost **0.001075 USDS**; 1 and 10 JitoSOL lost **0.000007695** and **0.000076942 JitoSOL**; 1 and 10 mSOL lost **0.000017745** and **0.000187297 mSOL**. The 1,000-USDS reverse selected AlphaQ itself and was excluded as a non-independent cycle. Larger first legs selected other venues. Reverse AlphaQ-first directions were not completed after the public quote endpoint began rate limiting; this result is limited to the stated sampled directions.

## Interpretation

The 2rU1 controller has real postdeployment value exits and substantial stake/SOL inventory, but the priced public JSOL path lost value against an independent exit. AlphaQ's three new major pools likewise gave no positive sampled independent cycle. Neither quote screen rules out a different instruction path or transient prices; neither establishes a drain. Any future candidate needs a fee-positive route, then a hooked-wallet `sigVerify:true` current mainnet-beta simulation of the entire atomic borrow→action→independent exit→repay packet with final balances reconciled.
