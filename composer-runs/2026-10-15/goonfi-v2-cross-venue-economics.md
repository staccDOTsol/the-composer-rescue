# GoonFi V2 wSOL/USDC exact-pool economic gate

Read-only Jupiter Lite direct-route quotes on 2026-10-15. Every GoonFi leg was accepted for this screen only when its route `ammKey` equaled **`GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC`**, the same live pool as the [hooked-wallet signed swap](goonfi-v2-major-vault-signed-mainnet-report.md). The independent leg excluded the whole `GoonFi V2` venue and was also checked to use a different `ammKey`. Both `USDC → GoonFi wSOL → independent USDC` and `USDC → independent wSOL → GoonFi USDC` were screened with `onlyDirectRoutes=true`. Quote slots for each two-leg row matched or were adjacent. These quotes are not an atomic executed route.

| USDC start | GoonFi first, best independent exit | GoonFi second, best independent buy |
|---:|---:|---:|
| 10 | −0.001135 | −0.000457 |
| 25 | −0.002836 | −0.001767 |
| 50 | −0.035624 | −0.002036 |
| 75 | −0.009761 | −0.003053 |
| 100 | −0.013062 | **+0.000658** |
| 125 | −0.014785 | −0.004759 |
| 150 | −0.109176 | −0.005864 |
| 200 | −0.022394 | −0.002217 |
| 300 | −0.036537 | −0.009934 |
| 500 | −0.057933 | −0.018221 |
| 1,000 | −0.168031 | −0.038591 |
| 10,000 | −2.737793 | −1.103237 |
| 100,000 | −75.943967 | −66.515513 |
| 250,000 | −349.813447 | −467.334551 |

The 100-USDC **+0.000658** gross quote at slot **457406261** used independent Quantum pool `2SixkjMjaLqXcEEJZfeth7qjH711R2uvp6TrUaHNMB65` first. None of the 18 fine-size rows at slots **457406333–339** was positive. A 100-USDC recheck at slot **457406388** shifted to GoonFi first and BisonFi second, yielding only **+0.000384 USDC** gross; the reverse order was **−0.010115 USDC**.

At a read-only 1-wSOL quote of **105.922555 USDC** at slot **457406455**, the 5,000-lamport single-signer base fee alone is about **0.000529613 USDC**. The recheck's positive quote is below that fee. The earlier one-off +0.000658 exceeds this absolute minimum by only **0.000128387 USDC**, leaving no credible margin for priority, quote movement, or the additional flash and swap execution. For fee context, the two successful historical GoonFi source transactions used **5,000** and **25,000 lamports** respectively, and the queried recent prioritization-fee sample for this pool included **9,073–10,001 lamport** nonzero slots. This is a quote-level cost screen, not an assertion that a zero-priority packet cannot ever land.

**Decision:** no stable spread above likely transaction costs emerged. No atomic flash packet was built or simulated for this economic branch. The prior direct hooked-wallet swap remains the one signed mainnet-beta test; no mainnet transaction was sent.

Raw direct-route results and per-leg pool keys/slots: [broad pass](goonfi-v2-cross-venue-quotes.json), [fine pass](goonfi-v2-cross-venue-fine-quotes.json), [100-USDC recheck](goonfi-v2-100-recheck.json). Reproducer: [quote script](goonfi-v2-cross-venue-quotes.js).
