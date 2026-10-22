# Confirmed transaction reconciliation

Transaction: [61RssnjK1QjLW3dyLM6yfJVHqbDJSHXvNyJ4ngbRMbCWbd2xMSPew88sP2QySv7xQ9u6GnVhiYp4HTpV4cDXJYZf](https://solscan.io/tx/61RssnjK1QjLW3dyLM6yfJVHqbDJSHXvNyJ4ngbRMbCWbd2xMSPew88sP2QySv7xQ9u6GnVhiYp4HTpV4cDXJYZf), slot 458746408, 2026-10-19 03:14:43 America/Toronto. Confirmed success. All quantities below come from the confirmed transaction's token balances, inner transfers, and emitted Raydium swap events; no simulation figures are used.

## Wallet outcome

| Item | Exact change |
| --- | ---: |
| Wallet native SOL, including fee | −0.269781811 SOL |
| Native SOL consumed by WSOL wrapping | −0.269776811 SOL |
| Signature/network fee | −0.000005000 SOL |
| Wallet USDC ATA | +0.010492 USDC |
| Jupiter WSOL and KLend USDC principal | Both fully repaid, vault net deltas zero |

The wallet's WSOL and LP token accounts were closed at the end of the transaction; their account rent returned to the wallet. The USDC ATA is `BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ`, account index 10, owner `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth`: 0→10,492 raw USDC units.

Wallet WSOL balance through the route: 0.275 after wrapping; 14,990.275 after Jupiter borrow; 7,490.275 after LP deposit; 7,477.817731257 after six swaps; 14,990.095037746 after LP withdrawal; 14,990.005223189 after Meteora top-up; 0.005223189 after Jupiter repay. That last balance was unwrapped on close, so the exact wrap consumption is 0.275−0.005223189=0.269776811 SOL.

Wallet USDC balance through the route: 1,300,000 after KLend borrow; 503,862.408134 after LP deposit; 505,054.086287 after six swaps; 1,299,990.519378 after LP withdrawal; 1,300,000.010492 after Meteora top-up; 0.010492 after KLend repay.

## Pool and lender custody changes

| Token account | Asset | Pre | Post | Exact delta |
| --- | --- | ---: | ---: | ---: |
| Raydium WSOL vault `v3YN4d7JRhKFcwtex7qNtyg2r5hKYW96Cayb6GivSvY` | WSOL | 0.278543819 | 0.458506073 | +0.179962254 |
| Raydium USDC vault `HG2WgeYsjqQhnjhwHj7QdTVvjyWpFRk6VREAQ8MURv2u` | USDC | 28.775423 | 38.256045 | +9.480622 |
| Meteora WSOL reserve `H7j5NPopj3tQvDg4N8CxwtYciTn3e8AEV6wSVrxpyDUc` | WSOL | 1,491.016284713 | 1,491.106099270 | +0.089814557 |
| Meteora USDC reserve `HbYjRzx7teCxqW3unpXBEcNHhfVZvW2vW9MQ99TkizWt` | USDC | 119,538.548787 | 119,529.057673 | −9.491114 |
| Jupiter WSOL flash vault `5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr` | WSOL | 386,976.300828408 | 386,976.300828408 | 0 |
| KLend USDC vault `UBSsE59MB1TKtADobD8spRgMGhMFoYaLDmkN3MFQmkp` | USDC | 2,123,097.168133 | 2,123,097.168133 | 0 |

These deltas conserve both assets exactly: wallet −0.269776811 WSOL + Raydium +0.179962254 + Meteora +0.089814557 = 0; wallet +0.010492 USDC + Raydium +9.480622 + Meteora −9.491114 = 0. Meteora's WSOL receipt is consideration for 9.491114 USDC used to fill the flash-loan repayment shortfall, not an entirely lost fee.

## Raydium fee accounting

All six emitted `SwapEvent` records show 7,480 WSOL input three times and 397,136.992440, 396,828.726717, and 396,520.754902 USDC input on the three reverse swaps. The configured trade fee was 0.5 basis point; the protocol and fund splits were 12% and 4% of that fee. Applying the program's exact ceil/floor rules gives:

| Fee accrual | WSOL | USDC |
| --- | ---: | ---: |
| Total trade fees | 1.122000000 | 59.524325 |
| Protocol counter increment | 0.134640000 | 7.142918 |
| Fund counter increment | 0.044880000 | 2.380972 |
| LP share of trade fees | 0.942480000 | 50.000435 |

Raydium leaves protocol and fund fees in the same token vaults and tracks them in pool-state counters; no separate fee-account transfer occurred here. The raw Raydium vault delta therefore is not solely protocol/fund fee. Subtracting those counter increments leaves +0.000442254 WSOL and −0.043268 USDC in effective LP/curve reserves. That residual is a combined pool inventory and rounding effect, not a direct payment to one named LP. The relevant on-chain fee code is [Raydium Fees::trading_fee / protocol_fee / fund_fee](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/curve/fees.rs), and [PoolState::vault_amount_without_fee](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/states/pool.rs) subtracts the accrued counters from curve reserves.

The public confirmed transaction JSON used for token balances is `confirmed-tx-61Rss.json` in this directory. `getTransaction` truncated logs near the sixth swap; a `getBlock` read of the same confirmed slot returned all six swap events.
