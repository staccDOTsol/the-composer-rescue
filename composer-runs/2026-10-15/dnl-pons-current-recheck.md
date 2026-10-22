# DNL PONS/USDC current mainnet gate — 2026-10-19

**Result:** No credible positive atomic path survives. The independent exit returns less USDC than the DNL first leg costs at every completed size from $1 through $5,000, before network costs. The latest quoted $1,000 cycle loses **18,223,555 raw USDC ($18.223555)** after only a 5,000-lamport base signature fee. No signed simulation or transaction broadcast was performed.

## Current deployment and state

- Mainnet-beta genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` verified. At confirmed slot **458,737,728**, `DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4` was executable, its PONS pool `J5vn…Xraj` was DNL-owned (517 bytes), and the pool's PONS vault `BSev…PbFb` held **27,483,846,628,962 raw PONS**. PONS has 8 decimals.
- ProgramData `5VRH…i5` remained at deploy slot **454,575,418**. At slot **458,738,603**, its onchain account SHA-256 was `c781287898988778344b135355562dbcb110686e3202625b55e86de7429b3d7c`; the 577,760-byte ELF SHA-256 was `a27dd365372b0603c623fd8b034c22ad39107fe0ffbba4e3546095460e7bb271`.
- KLend USDC reserve `AYL4…VR2Z` was present with **9,744,970,249,351 raw USDC available** and `flashFeeSf = 0`. This is ample for the tested sizes; the loan fee is zero.

## Exact-in first leg and independent exit

Quotes are in raw units, with 6 USDC decimals. First legs were restricted to the DNL pool. Exits excluded Denali; the $100, $1,000, and $5,000 exits also used `maxAccounts=24`.

| USDC in | PONS out from DNL | USDC out from independent exit | Gross USDC delta | After base fee upper bound |
|---:|---:|---:|---:|---:|
| 1,000,000 | 379,600,083 | 994,557 | −5,443 | −5,973 |
| 10,000,000 | 3,796,000,839 | 9,931,520 | −68,480 | −69,010 |
| 100,000,000 | 37,961,629,022 | 99,209,163 | −790,837 | −791,367 |
| 1,000,000,000 | 379,647,607,881 | 987,308,213 | −12,691,787 | −12,692,317 |
| 5,000,000,000 | 1,898,456,923,256 | 4,824,388,401 | −175,611,599 | −175,612,129 |

These are five distinct completed sizes. The $100 quote first met a transient HTTP 429 and succeeded on retry. $10,000 and $100,000 DNL first-leg quotes returned `NO_ROUTES_FOUND`. The slot for each completed first and exit is recorded in `dnl-pons-live-recheck.json` (range **458,737,730–458,738,014**). The post-base-fee column values a 5,000-lamport fee with the separate 1 SOL to USDC quote of **105.820070 USDC** at slot **458,738,773**, rounded up to 530 raw USDC.

## Full atomic v1 envelope

A fresh $1,000 DNL quote at slot **458,738,711** gave **377,509,121,942 raw PONS**. A separately built Raydium CLMM exit at slot **458,738,718** gave **981,776,975 raw USDC**, or **−18,223,025 raw USDC gross**. Jupiter built one setup instruction and one swap instruction for each leg. Combining both setups, a KLend borrow, the two swaps, and KLend repayment yields **6 instructions, 39 accounts, 1,585 bytes, one required signature**, within the [v1 4,096-byte and 64-account limits](https://solana.com/docs/core/transactions/versioned-transactions). Borrow index is 2. Adding a PONS ATA close, conditional on zero PONS dust, yields **7 instructions, 39 accounts, 1,593 bytes**.

At the same SOL price, the 5,000-lamport base fee costs 530 raw USDC rounded up. The fresh route's optimistic post-base-fee net is therefore **−18,223,555 raw USDC**. A missing PONS ATA would require 1,488,440 lamports of rent; if it remains open, the cash delta worsens to approximately **−18,381,062 raw USDC**. Rent can be recovered by closing an empty ATA, but that does not make the route positive. Slippage and any nonzero landing priority fee only worsen these upper bounds.

The blocker is **negative exit economics**, not the v1 account or byte envelope and not KLend liquidity. Quotes are estimates and no execution success is claimed. Because no post-cost positive route survived, `~/hooked.json` was not loaded and no `sigVerify: true` mainnet simulation was sent. No transaction was broadcast.

Evidence: [live account and quote JSON](dnl-pons-live-recheck.json), [atomic envelope and fee JSON](dnl-pons-envelope.json), and the corresponding read-only scripts `dnl-pons-live-recheck.js` and `dnl-pons-envelope.js`.
