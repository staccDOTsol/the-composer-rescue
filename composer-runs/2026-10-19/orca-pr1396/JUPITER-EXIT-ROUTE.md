# Atomic Jupiter exit after a one-sided Whirlpool boundary

## Result

One signed Solana transaction-v1 **committed on an isolated mainnet-backed Surfpool fork**. It borrowed 300 WSOL from KLend and 50 WSOL from Project0 at zero lender fee, executed nine real Whirlpool swaps against pool `C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd`, routed all received USDC to WSOL through Jupiter Router V2 on the independent Raydium pool `58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2`, and repaid both lenders. **No mainnet transaction was sent.**

The route lost **257.483336497 WSOL** from the actor's starting 260 WSOL. The 350 WSOL flash principal was fully repaid; the loss required actor-owned capital. This is a one-sided pool control, not an observed profitable harvest. It also does not validate a PR #1396 fee-accounting exploit.

| Measure | Committed local-fork result |
| --- | ---: |
| Transaction signature | `2qhxDcaLiMyupzVh3w2guGqfSujkBCD8ub3pNTXm1uAoWCPT9WhF83fEzKXY8BvZY4qhodzTgSwEaYBhkTtmGpsT` |
| Version / fork slot / error | v1 / 458879733 / `null` |
| Wire size / accounts / top-level instructions | 2,532 bytes / 50 / 17 |
| Compute units / transaction fee | 515,653 / 10,000 lamports |
| Whirlpool WSOL input | 346.808000069 WSOL |
| Whirlpool USDC output | 9,375.321549 USDC |
| Jupiter Raydium WSOL output | 89.324663572 WSOL |
| Actor WSOL before → after | 260 → 2.516663503 WSOL |
| KLend / Project0 vault delta | 0 / 0 WSOL |
| Pool after | active liquidity 0, tick −39121; USDC vault 0.062663 USDC |

The actor's native SOL balance also fell 16,992,400 lamports: 10,000 transaction fee plus 16,982,400 for creation of the Project0 margin account. The latter is account rent, not a lender fee. The Raydium route returned 2,720,061 lamports less than its read-only Jupiter quote; this was within the Router slippage threshold.

## Route provenance and scope

The official [Jupiter Router V2 `/swap/v2/build` API](https://developers.jup.ag/docs/api-reference/swap/build) supplied raw `RouteV2` instructions with `transactionVersion=1`, no lookup tables, and `dexes=Raydium`. The exact input was the separately measured full Whirlpool output: 9,375,321,549 raw USDC. The [saved build response](./jupiter-router-v2-full-exact-raydium.json) quoted 89,327,383,633 WSOL lamports out, minimum 88,880,746,715; its only route-plan AMM was the Raydium pool above. The build response file was saved 2026-10-19 15:18 UTC; the fork's transaction was at slot 458879733. The quote is a live-mainnet Router build, whereas execution and final balances are from the local fork. The two must not be conflated.

The earlier Kipseli route for the small, two-swap boundary reached Jupiter but failed with `PriceExpired` in its venue CPI; see [partial signed simulation](./jupiter-atomic-boundary.json). The nine-swap BisonFi route likewise reached Jupiter and failed custom 6001 in its venue CPI; its attempted build is [here](./jupiter-router-v2-full-exact-bisonfi.json). These failed simulations were superseded by the committed Raydium route. The initial two-swap boundary was only a zero-liquidity *gap* at tick −29921; deeper LP bands remained. The nine-swap [full boundary receipt](./full-one-sided-boundary.json) and the combined atomic receipt below reach tick −39121, where tested A→B active liquidity is zero.

The current official Jupiter CLI package is `@jup-ag/cli`, but it was not installed locally; an attempted local npm installation failed with registry DNS `ENOTFOUND` under the sandbox. The requested atomic Router execution is evidenced by the actual Jupiter program invocation and Raydium CPI in the committed fork transaction. The CLI was not used for this run.

## Reproduction and receipts

- [Atomic builder and local sender](./jupiter-atomic-boundary.js): set `ORCA_JUPITER_ATOMIC_SCOPE=full` on a **fresh** mainnet-backed Surfpool fork. Uses the exported nine Whirlpool swap instructions from [full-one-sided-boundary.js](./full-one-sided-boundary.js), the saved exact Jupiter Router build, and the dual zero-fee [flash envelope](./real-flash-envelope.js). It accepts only localhost fork RPC URLs and has no public-RPC send path.
- [Committed atomic receipt](./jupiter-atomic-full-boundary.json): v1 wire stats, quote, simulation, local signature, final pool and actor images, and `verification` from ledger `getTransaction`/`getSignatureStatuses`.
- [Ledger verifier](./jupiter-atomic-verify.js): checks `meta.err=null`, v1, nine Whirlpool swaps, one RouterV2 and Raydium invocation, both lender vault deltas zero, and computes the realized actor loss.

Fork preparation seeded an actor-owned WSOL account with **260 WSOL of explicit fork-only capital**, an empty actor USDC account, and an actor SOL account for transaction fees and account rent. The harness materialized only accounts that the fork returned as absent before local `sendTransaction`; it did not alter real Whirlpool, lender, Raydium pool, or venue vault state. This funding is essential: the Jupiter return alone cannot repay the 350 WSOL flash principal after spending 346.808 WSOL in Whirlpool.

The result establishes feasibility of fitting the full one-sided swap path and an unrelated Router exit with two zero-fee flashes into **one v1 transaction**, while showing a large negative return for this tested path and fork state. A later tiny LP ladder, changed venue prices, or a different pool requires its own atomic test before claiming fee capture or profit.
