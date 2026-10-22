# Major-pair value controller: PancakeSwap

Observed 2026-10-19 07:53 UTC. This is a **read-only target-discovery result**, not a vulnerability or drain claim.

## Screen and selection

- New lane: 10 selected real stable/major Jupiter direct-route pairs, one nominal input size per pair, iteratively excluding the previous winning venue label to sample up to five venues per pair. This yielded **42 quote rows, 37 unique route pool keys, and 18 distinct current pool-account owners**. It is a venue sample, not a census of every pool within a venue.
- Three distinct current executable owner programs and five pool keys were gated for custody and signer provenance: PancakeSwap, Perena Numéraire, and JupLend AMM. PancakeSwap is the selected lead. Local text search found broad census references to its program, but no focused PancakeSwap audit/report in `composer-runs` before this check. This does not establish whether anyone outside this workspace has audited it.
- Jupiter's sampled direct route at context slot **458756114** labels pool `22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w` **PancakeSwap** on **USDT/WSOL**. The live account is owned by executable program `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq`.

## Current custody and deployment gate

At RPC context slot **458757017**, the pool controls these real major-token vaults, each with token authority equal to the pool key:

| Mint | Current vault | Raw amount | Human amount |
| --- | --- | ---: | ---: |
| WSOL `So11111111111111111111111111111111111111112` | `7YcR78PKBHE5divhPVJ668kmmaDzove2d9msY9NpAJL2` | `1931251434063` | **1,931.251434063 WSOL** |
| USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `FCBauqNLbEBUci1v3NT4gWyFZXS4YUGnX7ZsPmWVzrvV` | `43911048177` | **43,911.048177 USDT** |

The nearby sampled USDC→WSOL direct quote returned 9.4761479 WSOL for 1,000 USDC at context slot **458755718**, implying about **105.53 USDC/WSOL** for this rough valuation. That makes the WSOL vault about **203,801 USDC** and the combined WSOL plus USDT about **247,712 USD-equivalent** if USDT is near par. The WSOL balance alone exceeds the $100,000 custody gate at that sampled major-pair quote. This is a value estimate, not an executable liquidation quote for the whole balance.

The program account is currently executable, has Upgradeable Loader Program state tag `2`, and points to ProgramData account `66S4Bs8HVyaPdQ5JGfKixEZMf5CczcfnLGgGYEKnvi3Z`. The ProgramData state tag is `3`; its recorded last deployment slot is **432564695**. Both were read at context slot **458757016**.

## Post-deployment signer receipt

Successful mainnet-beta transaction [`35edy8JF1qt7n6MFvWbLumb2oi61cRarFeeCsSPiiignthyu4Vz8sAUUBfA7wveZrqkGc5p84wvP1LLCZ4xbeD2`](https://solscan.io/tx/35edy8JF1qt7n6MFvWbLumb2oi61cRarFeeCsSPiiignthyu4Vz8sAUUBfA7wveZrqkGc5p84wvP1LLCZ4xbeD2) executed at slot **458757009**, after the deployment slot. In outer instruction 0, the PancakeSwap program is the immediate parent at stack height 2 of a Tokenkeg transfer at stack height 3. The transfer source is the **same current WSOL vault** `7YcR78PKBHE5divhPVJ668kmmaDzove2d9msY9NpAJL2`; the authority is the pool key; amount is `152756153` raw WSOL units (**0.152756153 WSOL**). The pool key is **not** an outer transaction signer. This establishes a recent pool-authorized, program-signed child Token CPI outflow. It does not show any unauthorized withdrawal condition.

## Evidence and scope

- [Route sample JSON](./volume-route-discovery.json) and [read-only route screen script](./volume-route-discovery.js).
- [Current RPC gate JSON](./volume-route-gates.json) and [read-only gate script](./volume-route-gates.js). The JSON preserves all sampled parsed inner instructions, stack heights, vault records, signer flags, program metadata, signatures, and context slots.
- The gate sampled the newest 12 pool-key signatures and up to five successful parsed transactions per pool. Pool-key indexing may omit relevant transactions; this receipt only verifies one live outflow path. No wallet key was used, and no transaction was simulated, signed, or broadcast.

Next audit step: obtain PancakeSwap's current IDL or decompile the exact on-chain binary, map its pool-state and swap/withdraw constraints, and test only bounded atomic hypotheses against a mainnet-beta fork with this current pool fixture.
