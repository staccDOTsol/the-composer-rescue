# Locp bounded-census economics, 2026-10-15

Program: `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn` (Jupiter Lock vesting escrow, also used by Meteora and its `met-lock-sdk`). This is a **bounded** set of token accounts from the prior verified-token top-20-holder census, not every Locp escrow. The [Meteora Lock SDK](https://github.com/MeteoraAg/met-lock-sdk) identifies the program and its create/fund/claim flow. No transaction was submitted for this analysis.

## Current assets and scheduled release

At confirmed slots 457347564–457347567 (block time 19:04:36 UTC), read-only `getMultipleAccounts` returned all 308 state accounts and all 308 distinct vaults. Every state owner/discriminator/mint and vault mint/authority/token-program matched the census; 82 distinct mint accounts also matched their expected token program and decimals at slot 457348498. The 308 vaults have a **$473,761,103.72 mark using the earlier census spot prices**. One `$CWIF` vault had declined by 301,543,847,074,168 raw units (3,015,438,470,741.68 tokens at two decimals) since the census, explaining the ~$83,942 difference from the original $473.85 million figure. This mark is neither a liquid liquidation value nor an exploit outcome.

Decoding the published `VestingEscrow` fields and applying its reference `get_max_unlocked_amount` / `get_claimable_amount` arithmetic at the snapshot block time gives **$182,589,275.24 of scheduled claimable token balances at those same spot prices**, across 156 escrows. An [independent state decode](locp-source-current-state.json) at slot 457347815, 52 seconds later, agrees on the custody mark and gives a claimable mark $0.06 higher as schedules advance. It still requires the specified recipient signer and successful token transfers. The other $291,171,828.47 of current vault balances is not scheduled claimable then. The public [Meteora claim flow](https://github.com/MeteoraAg/met-lock-sdk) and [reference claim instruction](locp-fogo-reference/programs/locker/src/instructions/escrow_instructions/claim2.rs) require the recipient as signer; the Fogo reference uses a different program address, so the arithmetic remains a reference interpretation until matched to the current binary or simulation.

Cancellation is a separate, signer-controlled path. `cancelMode` is 0 for 231 escrows (~$367.84 million current-balance spot mark), creator-only for 38 (~$94.59 million), recipient-only for one (~$9.74 million), and either for 38 (~$1.59 million). The [reference cancel instruction](locp-fogo-reference/programs/locker/src/instructions/escrow_instructions/cancel_vesting_escrow.rs) sends currently claimable tokens to the recipient and the remaining vault balance to the creator. Thirty-four escrows (~$50.25 million current-balance mark) have the same creator and recipient and an enabled cancellation mode. Three of these are JUP escrows totaling ~$48.69 million; an authorized creator could cancel them despite their February 2027 cliffs. The fourth JUP escrow (~$9.74 million) has a distinct creator and recipient and a recipient-only cancellation mode. None of this establishes access by an unrelated actor, and the cancellation mark overlaps with the custody mark.

| Mint | Vault spot mark | Scheduled claimable spot mark | Vault share of current mint supply | One-trade full scheduled claim quote to USDC |
|---|---:|---:|---:|---:|
| YZY | $202.67m | $117.86m | 69.7% | No route for full amount; $1m marked input quoted ~$881k out |
| DBR | $90.15m | $37.77m | 47.4% | ~$2.78m out, 92.7% quoted impact |
| JUP | $58.43m | $0 | 2.8% | No amount scheduled claimable; full vault hypothetical quote ~$1.00m out, 98.3% impact |
| WET | $41.86m | $10.47m | 77.0% | ~$353k out, 96.6% impact |
| Verse | $18.04m | $7.99m | 90.0% | ~$274k out, 96.6% impact |
| ZYLO | $17.80m | $1.32m | 79.0% | No route for full amount |
| NYC | $10.19m | $1.05m | 95.3% | ~$18.3k out, 98.3% impact |
| TOR | $9.75m | $1.01m | 95.3% | ~$16.6k out, 98.3% impact |
| CHI | $9.66m | $1.00m | 95.3% | ~$17.6k out, 98.2% impact |
| ARENA | $4.24m | $0 | 90.1% | No amount scheduled claimable; full vault hypothetical quote ~$93.7k out, 97.8% impact |
| MET | $3.36m | $2.11m | 0.9% | ~$1.61m out, 24.3% impact |
| QUEST | $2.29m | $0.11m | 14.8% | No route for full amount |
| PAYAI | $1.25m | $0.61m | 15.6% | ~$207k out, 65.5% impact |
| jlUSDS | $0.69m | $0.15m | 23.6% | ~$153k out, negligible impact |

The first four mints contain ~$393.11 million, or 83.0% of the mark. The 14 shown contain ~$470.37 million, or 99.3%. Mints for which these vaults hold at least half of total mint supply account for ~$315.65 million of the mark. Supply concentration means that multiplying locked tokens by a small-float spot price is especially misleading.

## Market depth and what remains unknown

The quote data are read-only, independent, exact-in Jupiter Swap v1 queries to USDC, sampled between about 19:05 and 19:09 UTC. [Jupiter documentation](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis) describes `outAmount` as a route quote and `priceImpactPct` as a decimal fraction; it also warns that quotes go stale quickly and that Swap v1 has been superseded. Full-amount `NO_ROUTES_FOUND` means this router did not produce a single route for that exact size and time. It does **not** prove the token has zero value or that staged trades are impossible through newer routers or other venues. Conversely, even successful large quotes were not built, simulated, or executed and are not guaranteed cash proceeds. They cannot be summed across mints because routes may share liquidity. Rates and reserves can change when selling, and Token-2022 fees/hooks are not fully modeled.

Accordingly, the evidence supports distinct statements: $473.76 million is a **spot mark on custody**; $182.59 million is a **vesting-schedule mark that recipients may claim with authorization**; the observed one-trade USDC quotes imply severe immediate liquidity limits for most large mints; **no total realizable cash value or attacker profit has been established**. A single verified liquid-dollar total needs a specified selling horizon, authorized withdrawal path, route execution assumptions, and current-binary validation.

## Reproduction files

- `locp-economics-snapshot.js` / `.json`: account bytes, hashes, decoded schedules, exact raw balances, and claimable calculations. Set `RPC_URL` or use the existing `/tmp/composer-helius-rpc.env`.
- `locp-economics-supply.js` / `.json`: mint bytes, raw supply, and vault/supply fractions.
- `locp-economics-quote-depth.js`, `.json`, `-YZY.json`, `-ARENA.json`: query inputs, output amounts, routes, price impacts, context slots, `NO_ROUTES_FOUND`, and rate-limit observations. Quotes are not transactions.
- `locp-economics-summarize.py` / `locp-economics-summary.json`: exact aggregation over the public account snapshot and quote evidence.
