# Zero-fee flash route with actor-owned Whirlpool liquidity

This is a **local mainnet-backed Surfpool fork execution**, not a mainnet transaction. The largest committed passing sample on this fork routed **6,271.347260340 SOL** through the first Whirlpool swap. It used two genuine zero-fee WSOL flash loans: **5,742.317260340 SOL from KLend** and **529.030000000 SOL from Project0**. The first swap's inner SPL-token transfer is exactly `6,271,347,260,340` raw WSOL, equal to the sum borrowed. The separately wrapped actor cushion was `128,426,945,206` lamports, less than the first swap input, and paid for the route's inventory loss and setup needs.

The signed transaction is Solana transaction version **1**, 16 top-level instructions, 31 accounts, 1,740 wire bytes, 2 signatures, and **518,152 compute units**. The successful local signature is `5rYCTmJbL7GkvFFTLbmiqJiAKDKJP86ksxhBgzy4nGj7cb78zAkURWvMhdPR25rrcRc3dpkPMZGUCUx61SJcknTE` at fork slot `458874345`. `getTransaction` reports `err: null`; the native transaction fee is **10,000 lamports**.

| Top-level index | Executed operation | Inner SPL token transfers |
| --- | --- | --- |
| 4 | First Whirlpool exact-input swap | Actor → pool: `6,271,347,260,340` raw WSOL; pool → actor: `652,738,362,890` raw USDC |
| 5 | Increase actor-owned position liquidity by `10,000,000,000` | Actor → pool: `188,999,819` raw WSOL and `146,991,416` raw USDC |
| 6–9 | Two 1-SOL swaps, each followed by UpdateFeesAndRewards on that actor-owned position | Both 1-SOL transfers confirmed |
| 10 | Decrease all actor-owned liquidity | Pool → actor: `189,027,688` raw WSOL and `146,988,521` raw USDC |
| 11 | CollectFees for the actor-owned position | Pool → actor: **9 raw WSOL lamports**, **0 raw USDC** |
| 12 | Reverse Whirlpool swap | Actor → pool: `640,369,164,457` raw USDC; pool → actor: `6,147,920,315,133` raw WSOL |
| 13–15 | Project0 repayment, KLend repayment, Project0 flash end | KLend supply vault, KLend fee vault, and Project0 vault net deltas all **0** |

The position NFT belonged to the actor. Its liquidity was 0 before and after the transaction, and feeOwedA/feeOwedB were 0 after collection. Because the position had zero liquidity before this transaction, its 9-lamport collection came from fees during this actor's route. This receipt does **not** show a victim-fee harvest. Actor inventory changed by **−125,426,917,329 raw WSOL** and **+12,576,792,005 raw USDC**; the two Whirlpool vaults had the exact opposite changes. These are token inventory deltas, not a verified USD profit calculation.

The actor's native lamports also fell by `16,992,400` in the main transaction: `10,000` was the transaction fee and `16,982,400` funded the newly initialized Project0 margin account. That rent deposit is an account balance, not a flash-loan fee. The separate local setup transactions funded the actor's token accounts and NFT position.

The limit is specific to this pool, lender selection, fork snapshot, and route. KLend's supply vault held `5,742,317,260,340` lamports; borrowing one lamport above that failed `InsufficientLiquidity` (6008). With KLend at that amount, Project0 at **529.04 SOL** failed before the swap with `IllegalUtilizationRatio` (6026). A near-edge 529.032890625-SOL Project0 simulation passed once and failed on later retry after fork slot changes, so the utilization boundary is not a stable exact cap. **6,271.347260340 SOL is the largest committed passing sample**, not a global maximum.

Evidence: [signed local ledger receipt](./economic-max-zero-fee-owned-lp-adjacent-send.json), [committed pass simulation](./economic-max-zero-fee-owned-lp-adjacent-committed-pass.json), [Project0 failure](./economic-max-zero-fee-owned-lp-adjacent-utilization-52904-fail.json), [KLend one-lamport failure](./economic-max-zero-fee-owned-lp-adjacent-klend-bound.json), and [reproduction script](./economic-max-owned-lp.js).

To reproduce on a *fresh isolated mainnet-backed Surfpool fork* with the repository's Node dependencies available, set `ORCA_NODE_MODULES` or `WHIRLPOOLS_REPO`, then run:

```sh
ORCA_ECONOMIC_FORK=http://127.0.0.1:63331 \
ORCA_ECONOMIC_TICK_MODE=adjacent \
ORCA_ECONOMIC_P0_AMOUNT_LAMPORTS=529030000000 \
node composer-runs/2026-10-19/orca-pr1396/economic-max-owned-lp.js 6271347260340
```

Adding `ORCA_ECONOMIC_SEND_LOCAL=1` commits the main transaction to that localhost fork only. The script rejects non-localhost fork URLs. Setup transactions create the actor's token accounts and NFT position on the fork before the signed v1 flash transaction.
