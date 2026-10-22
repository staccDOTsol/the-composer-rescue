# Whirlpool PR 1396: large flash-funded round trips

These are **local Surfpool mainnet-backed fork** results. No transaction was submitted to Solana mainnet. The largest completed route observed with fee-charging Save was **26,230 SOL** through one signed transaction-v1 with real Save and KLend flash borrows, two real Whirlpool swaps, one outsider `UpdateFeesAndRewards`, and both loans repaid. A separate setup transaction created and funded the actor's token accounts before the flash transaction. Under the later **zero-fee-lenders-only** constraint, the qualifying largest committed passing sample is **6,271.347260340 SOL** with KLend + Project0, four swaps, two separated updates, genuine actor-owned deposit/withdrawal, and collection. Its [separate report](ZERO-FEE-OWNED-LP-MAX.md) records exact transfers and limits.

| Route | Fork snapshot | Result | CU / 1.4m | Signed v1 |
| --- | --- | --- | ---: | --- |
| Save 21,638.9 + KLend 1 + Project0 0.1 = **21,640 SOL** | `:56899` | Simulation passed; 2 swaps, 2 updates, all three principals repaid | 1,395,344 | 1,896 bytes, 40 accounts, 19 instructions, 2 signatures |
| Save 23,079 + KLend 1 = **23,080 SOL** | `:56899` | **Committed locally**; 2 swaps, 1 update, both principals repaid | 1,398,893 | 1,368 bytes, 31 accounts, 9 instructions, 1 signature |
| Save 26,229 + KLend 1 = **26,230 SOL** | fresh `:57899` | **Committed locally**; 2 swaps, 1 update, both principals repaid | 1,397,368 | 1,368 bytes, 31 accounts, 9 instructions, 1 signature |

For the 21,640 SOL three-provider simulation, Save, KLend, and Project0 principal vault deltas were each exactly `0` raw WSOL; the Save fee vault gained `8,655,560,000` lamports. For the two committed two-provider cases, Save and KLend principal vault deltas were each exactly `0`; the Save fee vault gains were `9,231,600,000` and `10,491,600,000` lamports, respectively.

## Largest committed ledger receipt

The 26,230 SOL flash transaction has local fork signature `4w4YaJMpSzua9YpzvdMnGp7kF73XycCcZvakhdNcYDrs6mAnfSd6EW8CsWZkEkJTatHV4CTMTsVfhYtFbSeNw8gV`, slot `458871164`, `getTransaction.version=1`, `meta.err=null`, and 1,397,368 consumed CU. Its transaction was 1,368 bytes, well below size limits; compute was the binding limit for this route.

Surfpool's `getSignatureStatuses` returned `null` for this local signature. The `getTransaction` metadata and independently queried post-ledger token balances are the execution evidence.

- The Save and KLend **principal vault token deltas were both zero** after the transaction. The Save fee vault gained `10,491,600,000` raw WSOL lamports, matching the 0.04% fee on the 26,229 SOL Save borrow.
- The pool WSOL vault gained `524,600,000,000` lamports and its USDC vault lost `52,341,477,888` raw units. The actor's USDC account gained the same raw USDC amount.
- The actor's WSOL account held only `524,600,010,000` lamports before the flash transaction, strictly less than the first swap's `26,230,000,000,000`-lamport input. After the transaction it held `10,000` lamports. The first swap therefore required the borrowed WSOL; this was not a large idle loan beside a tiny swap.
- Ledger logs contain two Whirlpool `Swap` instructions and one `UpdateFeesAndRewards` instruction. The position's fee-owed fields changed, but that change can include earlier uncollected growth and is **not** an isolated profit measurement.

The [full 26,230 SOL ledger receipt](economic-max-two-adjacent-prepared-send.json) contains its signed wire, exact instruction indexes, transaction logs, account images, and token deltas. The [23,080 SOL ledger receipt](economic-max-two-adjacent-prepared-23080-send.json) documents the first fork snapshot. The [three-provider sweep](economic-max-combined-adjacent.json) contains the 21,640 SOL simulation and its 21,645 SOL failed neighbor.

## Higher samples and limit

On fresh fork `:57899`, 26,240–26,500 SOL (10–100 SOL increments) failed at the 1.4m CU limit during Save repayment; 26,600–27,000 SOL failed at the KLend repayment or reverse Whirlpool swap. 30,000 SOL also exhausted compute inside the reverse swap. These are **sampled bounds for this precise route and fork snapshot**, not a proof of a global maximum: CU changes with tick crossings, account state, and the pool's live snapshot. The [fresh-fork grid](economic-max-two-adjacent-prepared-fresh-grid.json) records the near-bound cases. The earlier `:56899` snapshot passed 23,080 SOL, then 23,081–23,089 SOL exhausted CU at Save repayment; the two snapshots had different pool vault balances.

The independent `:56899` fork initially gave Save `MathOverflow` before any Whirlpool instruction. For comparable tests, the harness copied four **mainnet-derived Save account images** (reserve, supply, fee vault, config) from the separately running local fork `:48899` into each test fork. Thus the receipts are fork experiments using mixed-time mainnet-derived account images, not evidence that this exact combined state existed on live mainnet.

## Reproduce

Set `ORCA_NODE_MODULES` to an installed checkout's `node_modules` (or set `WHIRLPOOLS_REPO` to the checkout). With independent Surfpool mainnet forks already running on `:48899` and `:57899`, the simulation command is:

```sh
ORCA_NODE_MODULES=/absolute/path/to/node_modules \
ORCA_ECONOMIC_FORK=http://127.0.0.1:57899 \
ORCA_ECONOMIC_SAVE_SOURCE=http://127.0.0.1:48899 \
ORCA_ECONOMIC_PROVIDERS=two \
ORCA_ECONOMIC_ALLOCATION=save \
ORCA_ECONOMIC_TICK_MODE=adjacent \
ORCA_ECONOMIC_PREPARE_ATAS=1 \
node composer-runs/2026-10-19/orca-pr1396/economic-max-sweep.js 26230000000000
```

The script's `ORCA_ECONOMIC_SEND_LOCAL=1` switch additionally commits **only to the selected `127.0.0.1` fork**, then writes the ledger receipt. Omit that switch for a signed v1 simulation. The setup token-account transaction remains fork local in either mode.
