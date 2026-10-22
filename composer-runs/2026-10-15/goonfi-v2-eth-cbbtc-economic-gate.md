# GoonFi V2 USDC/ETH and USDC/cbBTC pool screen

Read-only Solana mainnet-beta screen on 2026-10-15. RPC genesis was `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. This covers GoonFi V2 pool states `5mHTXRU1bgBDo9vUoHKkCidbFRc2mLHSgTTdQyZBjMfg` (ETH) and `8TxrtAxqA5PA2Y1d2pxzCz9SoDhjrBcYqNAQKVv6p443` (cbBTC), distinct from the previously screened wSOL/USDC pool.

At confirmed slot **457412486**, each 2,048-byte, off-curve pool state was owned by GoonFi V2 program address `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE`. State bytes at offsets 80/112 bound the pair mints; offsets 144/176 bound the vault addresses. Each bound vault was an SPL Token account whose mint matched the state and whose token authority was that GoonFi-owned state. The ETH pool held **7.99275958 ETH** in `Eq4RXu6YteLSADZ7X3gxMimqGm98uUN9KMSzQjoUqSKP` and **180,975.584871 USDC** in `EQgSe7ekYKr8PoP3eyxiGvno2SKUvhqfqP2am8Gpyqyu`. The cbBTC pool held **0.64471910 cbBTC** in `FKKpxrDezYSw5JoP2k5xaABPk2De3xvsU7gXkfsdJw3f` and **161,094.310982 USDC** in `HQdab425TntryU9zwSzhkBSzkdUuyoKZX1y8sQvjTYmX`. The state is program owned; the vault accounts themselves are SPL Token owned. Exact PDA seeds were not established.

For each start size below, Jupiter Lite ExactIn direct quotes chained the exact GoonFi pool with a different, direct, non-GoonFi venue in both orders. Every accepted GoonFi leg had the target `ammKey`; every accepted independent leg excluded GoonFi V2. Quote slots were **457412487–511**. Values are **gross USDC change**, before base fee, priority, flash fee, slippage, and quote movement.

| USDC start | ETH: GoonFi first | ETH: GoonFi second | cbBTC: GoonFi first | cbBTC: GoonFi second |
|---:|---:|---:|---:|---:|
| 100 | −0.026639 | −0.007584 | −0.014004 | −0.004605 |
| 1,000 | −0.306150 | −0.194704 | −0.278474 | −0.063791 |
| 10,000 | −5.757437 | −6.686641 | −2.394445 | −1.813039 |
| 100,000 | no exact-pool first route | −373.684373 | no exact-pool first route | −80.826633 |

**Decision:** all executable chained quotes lost USDC before transaction costs. No thin-size or maximum-pressure extension was economically indicated. No flash source, signed `sigVerify:true` packet, or atomic simulation was attempted for these pools. No mainnet transaction was submitted, and the hooked signer file was not read. These quotes establish an economic stop for the tested direct route orders at these sizes, not a claim about every possible venue, route, or future price.

Raw vault images, quote keys and slots, and per-leg amounts: [JSON evidence](goonfi-v2-eth-cbbtc-screen.json). Read-only reproducer: [script](goonfi-v2-eth-cbbtc-screen.js).
