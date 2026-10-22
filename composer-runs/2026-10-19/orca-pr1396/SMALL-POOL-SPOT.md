# Tiny zero-fee WSOL/USDC SplashPool: executed spot movement

Pool `3PRT79bw3hoMd9S4uC8mPTKvJVgqGa2NuS7ZLX92RFNn` is WSOL (A)/USDC (B), with fee rate **zero** and protocol fee rate **zero**. A finalized position scan found one nonzero full-range position: liquidity 301,845 from tick −427,648 to +427,648; four other full-range positions had zero liquidity. This full-range position remains active at normal prices, including the tested 2× and 10× spots.

The [reproducible script](small-pool-spot.js) used a fork-only USDC token-account prefund and committed two real signed Whirlpool v1 B→A swaps to a mainnet-backed Surfpool fork. It chose exact square-root price limits equal to √2 and √10 times the starting square-root price. The [receipt](small-pool-spot.json) records both successful local transaction signatures and account states:

| Pool state | Start | 2× spot | 10× spot |
| --- | ---: | ---: | ---: |
| Tick | −22,492 | −15,560 | +535 |
| Active liquidity | 301,845 | 301,845 | 301,845 |
| Cumulative actor USDC paid, raw | 0 | 40,611 | 211,995 |
| Cumulative actor WSOL received, lamports | 0 | 272,185 | 635,429 |
| WSOL vault, lamports | 932,618 | 660,433 | 297,189 |
| USDC vault, raw | 100,786 | 141,397 | 312,781 |

The first swap used 23,746 compute units; the second 23,650. Neither generated a Whirlpool LP fee or protocol fee. The 10× displayed spot required only **0.211995 USDC** because the pool's inventory was tiny. At an illustrative 104.50 USDC/SOL external benchmark, the actor received roughly 0.0664 USDC of WSOL value, so that manipulation lost roughly 0.1456 USDC before transaction fees. A router that treats the displayed spot as deep liquidity would be misleading; the vault held only 297,189 WSOL lamports afterward. The full-range LP prevented any nearby transition to zero active liquidity or a one-sided quoted state.

All funding and transactions occurred only on the isolated local fork. This receipt does not include a flash loan, Jupiter route, or mainnet submission.
