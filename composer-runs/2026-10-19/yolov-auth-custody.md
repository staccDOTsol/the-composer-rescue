# `yoLov` current custody and signer map

Observed on Solana mainnet-beta, 2026-10-19. This is a read-only account and receipt map, not a finding of unauthorized value movement.

## Program identity

Program `yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA` was last deployed at slot **458289770**; the dumped current ELF is 602,512 bytes, SHA-256 `c75637981b6731d8719d8521e93176e00dc5f74d861413ba1475a6af84c9d9c4`. The program's Anchor strings include `OpenPosition`, `OpenPositionWithSwap`, `ClosePosition`, `LiquidatePosition`, `ProcessPayout`, `WithdrawFees`, `InvalidLeverage`, and `RiskCap`. Jupiter's [own site](https://jup.ag/yolo/) markets a YOLO product with 500–1,000× SOL/BTC/ETH positions. The binary, JupUSD vault, and three asset markets are consistent with that product; an official publication explicitly mapping this program ID to YOLO was not found in this pass. The program is not identified as Jupiter Prediction merely because it uses JupUSD.

## Exact current custody

At slot **458740168**, the `["pool"]` PDA `6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX` owned exactly one SPL token account: `["vault"]` PDA `4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP`. It held **127,477,994,338 raw JupUSD**, or **127,477.994338 JupUSD** at six decimals. The 58-byte pool state has three little-endian `u64` fields at offsets 8, 16, and 24. Their values summed to **127,477,994,338**, exactly the vault balance. An earlier snapshot near slot 458738987 also matched: **127,520,804,415 raw**. The meanings of the three accounting buckets have not been established. Equality across these two snapshots is an accounting observation, not a solvency or safety proof.

The `["config"]` PDA is `3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf`. Its 134-byte state contains pubkeys `mQBipzeneXqnAkWNL8raGvrj2c8dJv87LXs2Hn7BeXk` at offset 8 and `A2rCQdCqQB4wu72x9Q7iq1QugtdZmcyWsiSPfgfZzu2u` at offsets 40 and 72. Role names for these fields require source or dynamic proof; `A2r…` is demonstrably a recurrent transaction signer. The BPF upgrade authority shown by `solana program show` is a distinct `B4HN8cCrVdR19Zku9XPDPkYsGVTPHkWf6brncTT2d7vB`.

The program-owned-account census at slot **458739206** returned **43,944** accounts: one pool (58 bytes), one config (134), three markets (121), 43,451 position records of 120 bytes, and 488 older position records of 114 bytes. Both position lengths have the same `aabc8fe47a40f7d0` discriminator, with position owner at offset 8 and market at offset 40 in sampled accounts. The three market PDAs reproduce from `["market", assetMint]`, with wrapped SOL and two wrapped major-asset mints at offset 8. The census accounts held **55.347306120 SOL of rent in aggregate**, mainly user position records; this is not additive free pool liquidity. No assertion is made that the sole pool vault captures every program-related asset outside the sampled/accounted account types.

## Authorization evidence

Composer's recovered `open_position` and `close_position` examples each pass **two transaction signers**: the position owner or user at account 0 and recurrent `A2r…` at account 1. A sampled `ClosePosition` receipt has position `E1qZuFjEyp7nXK1dJjMmQRxH8v7mCCGqorkuK4qNNr42`, which remains program-owned and stores the user signer `F4XNcF3koLsi3jmHufvcPwjoQ27ZTUZCJtbS5HkbD5tR` at offset 8 and SOL market at offset 40. This validates the observed owner relationship, but it does not by itself prove every required runtime check. Composer's inferred writable flags are known to overapproximate two held-out `OpenPositionWithSwap` receipts and must not be treated as authorization evidence.

Composer's `liquidate_position` examples have no signer meta among the eight accounts passed to `yoLov`. One successful receipt, signature `2SmZATrmkmouspBeEG6paTT4Mr5YP4UJwMMyQzsKgKmXbitBgvuoBB3EoYRuk5eyGib9jMfMpQ9fv8vzT1DSU6vC` at slot **458735992**, used `A2r…` only as the outer fee payer; the vault was read-only and there was no token transfer. This does not establish arbitrary-caller liquidation or a value extraction path. Payout and fee-withdrawal instruction authorization remain to be checked separately.

## Reproduction artifacts

- `yolov-auth-snapshot.js` collects the current pool, vault, three markets, sampled positions, PDA derivations, and count/lamport histogram with read-only public RPC.
- `yolov-auth-snapshot.json` contains the slot-tied compact result.
- `yolov-auth-program-accounts-zero.json` is the complete program-owned account key/lamport census with zero-byte data slices.
- `yolov-auth-liquidate-receipt.json` preserves the sampled liquidation receipt.
- `yolov-current.so` is the exact dumped ELF; `yolov-composer-learn.json` is the recovered interface that directed the account map.

No signing, transaction simulation, or broadcast was performed by this branch.
