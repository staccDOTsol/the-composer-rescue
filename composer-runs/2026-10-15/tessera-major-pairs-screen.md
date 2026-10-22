# TesseraV cbBTC and WSOL direct-route gate

Checked 2026-10-15 on mainnet-beta (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). This is a bounded read-only route screen, not a finding or an executed arbitrage. Full exact amounts, quote slots, route keys, and RPC evidence are in [the machine-readable record](tessera-major-pairs-screen.json).

## Current custody

At confirmed slot **457413461**, the three token accounts used by the two pools had one authority, `8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF`. That authority is off curve and its account is owned by TesseraV program `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`. Successful swaps at slots 457412551 and 457412557 show TesseraV making Token Program transfers from the USDC and WSOL vaults with this authority even though it is not a transaction signer. The cbBTC vault was the input vault in the sampled cbBTC swap. This establishes live program-controlled custody for the exact vaults, without relying on pool-account ownership alone.

| Pool | Vault | Token | Confirmed balance |
| --- | --- | --- | ---: |
| `9NkuAWB4...` | `37hggNyT...` | cbBTC | 2.23891847 |
| Both pools | `9t4P5wMf...` | USDC | 4,272,860.140011 |
| `FLckHLGM...` | `5pVN5XZB...` | WSOL | 61,496.238676257 |

Balances move frequently; the slot is part of the measurement. Both target pool accounts and all independent exit pool owners were checked by confirmed RPC. The independent legs selected Whirlpool, BisonFi, GoonFi V2, or Kipseli, each with an owner other than TesseraV.

## Chained direct quotes

Jupiter Lite `ExactIn` quotes used `onlyDirectRoutes=true`, forced TesseraV for its leg, excluded TesseraV for the other leg, and passed the first exact output amount into the second request. Each TesseraV leg used the specified target pool. Net values below are in the **initial token**, before transaction costs and before execution or slippage risk.

| Order | Small | Medium | Near liquid |
| --- | ---: | ---: | ---: |
| USDC → TesseraV cbBTC → independent USDC | $100: **−0.005994 USDC** | $10,000: **−1.719323 USDC** | $75,000: **−49.426146 USDC** |
| cbBTC → independent USDC → TesseraV cbBTC | 0.001 cbBTC: **−0.00000004 cbBTC** | 0.1 cbBTC: **−0.00002254 cbBTC** | 1 cbBTC: **−0.00086794 cbBTC** |
| USDC → TesseraV WSOL → independent USDC | $100: **−0.003743 USDC** | $10,000: **−1.431657 USDC** | $3,000,000: **−51,557.412783 USDC** |
| WSOL → independent USDC → TesseraV WSOL | 1 WSOL: **+0.000008684 WSOL** | 100 WSOL: **−0.01741032 WSOL** | 30,000 WSOL: **−549.22290536 WSOL** |

The only positive snapshot was **8,684 lamports gross** at quote slots 457413065–066. A one-signature base fee of 5,000 lamports leaves just 3,684 lamports before any priority fee or other execution costs. Neighboring starts of 0.25, 0.5, 2, 5, and 10 WSOL all lost before costs. A fresh 1 WSOL recheck at slot 457413320 lost **42,929 lamports before costs**. The positive snapshot did not survive the price recheck, so there is no concrete after-cost candidate for the requested signed atomic simulation.

No transaction was signed, simulated, or broadcast. No secret or transaction wire was persisted.
