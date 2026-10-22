# KLend exact zero-fee flash reserve check

Observed on Solana mainnet on 2026-10-15, account slots 457347933–457347944 and later simulation slots 457348764–457348920. Program: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`. **Validated exploitable value: $0.** All runtime tests used read-only `simulateTransaction` with `sigVerify: false`; no transaction was submitted.

## On-chain fee census

`getProgramAccounts` located **619** current program-owned Reserve accounts with 8,624-byte length and Anchor discriminator `2bf2ccca1af73b7f`. Each was decoded independently through `getMultipleAccounts`. The little-endian `ReserveConfig.fees.flash_loan_fee_sf` at byte offset **4904** (including the Anchor discriminator) is **exactly zero on 562 reserves**, positive on 43, and `u64::MAX` (disabled) on 14. The rate uses a `2^60` scale; the deployed-matched source charges zero when the rate is zero, while a positive rate enters a path with a one-raw-unit minimum fee (`programs/klend/src/state/reserve.rs:2280–2315`). The zero results are therefore **zero configured fee rates**, not small fees rounded to zero.

**441** of the 562 zero-rate reserves were status-active, outside emergency mode, and had nonzero recorded available liquidity at the census slots. This is a *configuration and availability count*. Only **five distinct reserves/mints** below received live flash borrow/repay simulations; the remaining **436** active, liquid zero-rate reserves have not been flash-tested. A larger raw token amount does not by itself imply a high USD value or deep market liquidity.

| Mint | Tested reserve | Config rate | Recorded available at census | Pair controls |
| --- | --- | ---: | ---: | --- |
| USDC | `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` | 0 | 7,868,315.584088 USDC | 1 raw, 1 USDC, 1M USDC, 99% of census available succeeded |
| USDe | `2erD9GTGcaQbLsVSQweg3HvMpfKxScmz95raWv8H4iPN` | 0 | 139,267,514.568516695 USDe | 1 raw, 1 USDe, 1M USDe, 99%, full census available succeeded |
| PYUSD | `6bR98MJTH68s7eV8ssyBgfuuH5oR2bEt58P9rZPLpBrC` | 0 | 10,313,838.195286 PYUSD | 1 raw, 1 PYUSD, 1M PYUSD, 99%, full census available succeeded |
| USDG | `ESCkPWKHmgNE7Msf77n9yzqJd5kQVWWGy3o5Mgxhvavp` | 0 | 3,165,411.467527 USDG | 1 raw, 1 USDG, 1M USDG, 99%, full census available succeeded |
| wrapped SOL | `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` | 0 | 6,550.155560273 SOL | 1 raw, 1 SOL, 90% live or 1M-unit cap, 99%, full census available succeeded |

Each successful pair fit in a **531-byte Solana v1 transaction** with 11 addresses. For all five mints and all successful cases, the watched user token account, reserve supply vault, and fee vault had **zero net token change** after full repayment. PYUSD and USDG are Token-2022 mints; their token program account was changed accordingly. The tested matched pairs do not include a middle target-protocol instruction, so they establish availability and fee behavior, not cross-program exploitability.

Boundary tests must use a fresh reserve read. The USDC reserve fell from the census amount to 7,820,864.730717 USDC before simulation; 99% of the earlier census amount succeeded, while the old census maximum correctly failed `InsufficientLiquidity` 6008. PYUSD census maximum succeeded and one raw unit more failed 6008. USDG and SOL had gained available liquidity since census, so the old maximum plus one also succeeded.

USDe's census maximum plus one succeeded for a specific, accounted reason. On flash borrow, KLend refreshes the reserve and distributes prefunded rewards before the availability check. A pre-read and matched one-unit simulation both ran at slot **457348918**. The simulation logged `Reserve rewards distributed: units=1242 amount=254498951739 remaining=197337630051849` raw USDe. The reserve's available amount rose **exactly 254,498,951,739 raw** from `139267514568516695` to `139267769067468434`; its reward budget fell by the same amount, from `197592129003588` to `197337630051849`. The user token, supply vault, and fee vault still returned to baseline. This is a prefunded reward distribution, not extra principal created by the flash pair.

The largest verified same-mint target in the current long-tail custody ranking is `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS`, with sampled vaults holding approximately $297.46M USDe, $9.48M PYUSD, and $5.98M USDG at the registry spot prices. The tested KLend zero-rate reserves supply up to approximately 139.27M USDe, 10.31M PYUSD, and 3.17M USDG before live-state changes. Those figures prioritize cross-program composition; they are **not** an estimated loss or evidence that the target will transfer its funds without authorization.

## Reproduction

- `klend-zero-fee-census.js` / `.json`: all 619 on-chain Reserve config values, status, mint, market, vault, and available fields.
- `klend-zero-fee-simulate.js` / `klend-zero-fee-simulations.json`: 30 v1 read-only pair attempts across five mints. The results include amount, slot, error, wire bytes, account count, account balances, and reserve post-state.
- `klend-zero-fee-simulations-USDe.json`: later USDe simulation that records the reward budget and program log explaining the availability increase.
- Historical positive-control flash instruction layout came from successful mainnet transaction `588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd` at slot 457338071. Existing initialized token accounts with on-curve, System-owned authorities were used as simulated signer controls. `sigVerify: false` does not grant anyone those signing keys.

No unauthorized transfer, unrepaid loan, or fee-vault loss was observed in this pass.
