# Next liquid-major propAMM: bounded selection and price gate

The saved [propAMM activity census](propamm-live-census.json) and [new pool balances](new-amm-pool-owner-balances.json) did not establish an eligible new program with a meaningful, current, program-controlled USDC, USDT, or wSOL vault after the specified exclusions. Obric V2 and BisonPredict had no direct token outflow or source in the bounded 15-transaction census. A separate [40-transaction Obric screen](obric-v2-current-screen.json) found 36 successful transactions, zero top-level Obric calls, and zero direct Obric outflows. The remaining sampled TesseraV and Scorch pools had zero major-token accounts. These bounded results are **not** a proof that either program has no vault elsewhere.

An earlier [quote artifact](project0-v1-pricing.json) named a different TesseraV pool, `BDqQBspbipXxnTX2kw4FPM9pzfcf9kwieGCy4yUZ9tCC`. A targeted confirmed read at slot 457406517 showed that the pool state account is owned by TesseraV program `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`, but `getTokenAccountsByOwner` found zero SPL Token accounts naming that pool as authority. A recheck at slot 457406836 confirmed mainnet-beta genesis `5eykt4Us…`, the executable program, and the 1,264-byte program-owned pool state. This does not rule out a distinct vault authority. It does not prove a current liquid-major TesseraV vault.

The known pool nevertheless has a public direct Jupiter quote for USDC ↔ `Dz9mQ9...`. Read-only direct-route quote chaining against independent Scorch liquidity at slots 457406598–634 gave the following USDC changes, **before** transaction or flash fees:

| Route | $100 input | $1,000 input |
| --- | ---: | ---: |
| TesseraV → Scorch | −$0.118800 | −$1.703100 |
| Scorch → TesseraV | −$0.081701 | −$1.330627 |

The first economic screen is negative in both directions and sizes. No signed `simulateTransaction` was run because the liquid-major selection criterion remains unproved and the tested route already loses before fees. No transaction was sent. The [machine-readable evidence](propamm-next-liquid-major-screen.json) records the exact quote amounts and slots. A quote is not signed execution, and there is no claim of outsider profit, full flash repayment, or final equity gain.
