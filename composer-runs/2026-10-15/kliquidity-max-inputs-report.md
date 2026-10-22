# Kamino Liquidity max-flash input and existing-share checkpoint

Observed on 2026-10-15 from current mainnet accounts and deployed binaries imported into local Surfpool forks. No mainnet transaction was submitted. The five strategies are the highest directly valued Kamino Liquidity positions in `kliquidity-current-audit.md` (about $46.92 million combined at the inventory snapshot). This pass varied the input size, used the exact currently available zero-rate KLend flash principal, and accounted for the full Orca/Kamino/reverse/repay sequence. The strategy values and reserve availability are snapshot-specific.

## Max source and live consumer routes

At captured slots the selected KLend USDC reserve had 8,011,084.472352–8,011,118.700944 USDC available and its configured flash fee was exactly zero. Borrow/repay at `available−1` and `available` succeeded with unchanged borrower balance, reserve supply vault, fee vault, and reserve-accounted availability. `available+1` rejected `InsufficientLiquidity` (6008). The selected WSOL reserve similarly succeeded at its exact 6,582.664950015 SOL availability and rejected `+1` with 6008. These are reserve limits, not amounts that the AMM or Kamino necessarily accept as a swap/deposit.

| Strategy (controlled value at inventory) | Current route with exact-max KLend flash | Last successful tested forward input and net caller result | Larger-input boundary |
| --- | --- | ---: | --- |
| Hmj82…UiGm pyUSD/USDC ($16.74m) | USDC→pyUSD Orca SwapV2, proportional deposit, withdraw all minted shares, pyUSD→USDC, repay | $2m input; **−3,880.287572 USDC**; 1,783-byte/42-key signed v1 | Full ~$8.011m swap succeeded; deposit rejected `OrcaPriceTooDifferentFromScope` (6059) |
| ByPbo…mBdu USDG/USDC ($10.51m) | Same complete route with its own pool | $2m input; **−4,078.791032 USDC**; 1,770-byte/42-key v1 | Full ~$8.011m deposit rejected 6059 |
| DzGJL…w5FG USDu/USDC ($3.64m) | Same complete route; Token2022 account created in transaction | $100k input; **−211.202347 USDC**; 1,750-byte/41-key v1 | $500k deposit rejected 6059; $2m one-swap attempt rejected Orca `TickArraySequenceInvalidIndex` (6038) |
| C7HgB…j5zv SyrupUSDC/USDC ($10.06m) | Deposit path | None: configured `depositCapUsd=0` | Deposits through $1m rejected `CollateralTokensExceedDepositCap` (6041); $2m rejected 6059; full ~$8.011m one-swap rejected 6038 |
| HCntz…ggXd SOL/JitoSOL ($5.98m) | Deposit path | None: configured `depositCapUsd=0` | Deposits from 0.01 through exact 6,582.664950015 SOL flash rejected 6041 |

Hmj's signed control used a freshly generated, fork-funded attacker key on a fork without signature-verification bypass. The Token2022 pyUSD ATA was created within the v1 transaction. The message was signed by that key and simulated with `sigVerify:true` and `replaceRecentBlockhash:false`. Every complete Hmj case from $1 through $2m burned all newly minted shares, left no pyUSD, repaid the exact KLend principal, and returned the lender supply and fee vaults to their starting balances. Net USDC ranged from −0.002076 to −3,880.287572 before rent and transaction fees. The quote-only calibration used a separately disclosed local borrower-owned balance; each final route reset the borrower's USDC starter to $100k. The signed route and all losses are in `kliquidity-top5-usdc-signed-Hmj82e48X9LNW8LeMLk186iE4UKPoUwWuLwoiqMpUiGm.json`.

ByPbo and DzGJ used the same current-binary composition pattern with historical virtual signer slots and `sigVerify:false`. The purpose of those runs is executable account/amount and post-state evidence, not independent proof of a cryptographically owned outsider signer. Their results are in `kliquidity-top5-usdc-sweep-ByPbo7yGcsfrEXet3ip3DcMKf4hwhUv71b6aAU9umBdu.json` and `kliquidity-top5-usdc-sweep-DzGJLoq3FnSN4VJyTbbNUWsN8syRQzxvDZX3iTmnw5FG.json`.

## Cap-zero existing-share controls

The cap does not block withdrawal by a holder who already owns strategy shares. To compare manipulation with an ordinary exit, each fork moved the exact balance of an existing token holder to the test holder and reduced the source holder by the same amount. Share mint supply was not increased. This models a prior authorized acquisition; its purchase price cancels between the matched baseline and manipulated exits. It does not assert that the test holder acquired those shares on mainnet.

| Strategy | Shares in matched control | Baseline withdraw, then sell other token | Max-flash manipulated withdrawal versus baseline |
| --- | ---: | ---: | ---: |
| C7HgB…j5zv | 187,254.616784 | 508.750328 USDC | $1–$2m swaps all completed and fully repaid; incremental **−0.000199 to −399.920257 USDC**. Signed owned-key v1, 1,622 bytes/39 keys. Exact ~$8.011m one-swap rejected 6038. |
| HCntz…ggXd | 16,437,265.713709 | 47.075601931 SOL | 0.01–6,582.664950015 SOL swaps all completed and fully repaid; incremental **−0.000002 to −1.315834429 SOL**. Historical-signer v1, 1,601 bytes/39 keys. |

Evidence: `kliquidity-existing-share-C7Hg.json` and `kliquidity-existing-share-HCnt.json`. The C7Hg run used `sigVerify:true` with a freshly generated holder signer. HCnt used `sigVerify:false`, so its completed route does not independently establish an owned-signer transaction.

## Scope of the multi-lender conclusion

An independent Project 0 USDC plus KLend WSOL signed route already exists in `p0-klend-single-attacker-full-route.json` (2,238-byte/51-key v1) and loses 0.050071027 SOL plus 7.351865 USDC before rent/fees. Jupiter Lend Flashloan is a third independent USDC source candidate, with a successful current-binary borrow/payback control in `jupiter-flashloan-composition.json`, but this pass did **not** construct a signed tri-source Kamino route or validate its current fee and maximum usable amount. Thus no tri-source exploit or fit is claimed.

For the tested one-swap proportional-deposit paths, the exact-zero-rate KLend principal already exceeds the route-valid input: Kamino's 6059 guard or Orca's 6038 tick-array limit stops a full-source move, while every smaller complete route above lost caller value. More flash liquidity by itself does not make those rejected transactions execute. Distinct token funding or a different instruction order remains a separate hypothesis, not covered by this negative result.

**Validated permissionless outsider gain in these tested paths: zero.**
