# Meteora Dynamic Vault current-binary audit — 2026-10-15

**Result:** No validated third-party drain in the tested instruction families. Reproducible exploit amount: **$0**. This is a bounded current-binary audit, not a completeness claim for all vaults and strategies.

## Deployed target and custody

- Program: `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi`.
- Upgradeable ProgramData: `9DaJrXBFQemCwapdEJkTRCe7S9irpvPHG7gk18sRsdR`; last deployment slot `457247303` before and after testing; authority `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`.
- Dumped program SHA-256: `2ca789753622df50bd4eb5d7a07769943d6795349196f7420657951875b827fd`; 1,930,560 bytes.
- Official [Dynamic Vault product description](https://github.com/MeteoraAg/docs/blob/main/legacy-products/dynamic-vault/what-is-dynamic-vault.mdx) and [access model](https://github.com/MeteoraAg/docs/blob/main/legacy-products/dynamic-vault/access-and-limits.mdx) identify this program. The published `@meteora-ag/vault-sdk@2.4.0` IDL (`version: 0.9.5`) decoded sampled current accounts and produced instructions accepted by the deployed binary. We did **not** establish a byte-identical source build.
- Sampled rebalance vaults: USDC `3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ`, USDT `5XCP3oD3JAuQyDpfBFFVUxsBxNjPQojpKuL4aVhHsDok`, WSOL `FERjPVNEa7Udq8CEv68h6tPL46Tq7ieE49HrE2wea3XT`, plus WSOL idle vault `2xqqwsYDPG8stqyksxgeCdNMWKwdvpJw88gGpaiy4m8p`. Decoded state and underlying token-account bytes are in [vault-samples.json](./dynamic-vault-current/vault-samples.json).
- At the sampled context, the USDC vault reported `9,767,572.022141` USDC of total accounting amount, `8,347,135.193616` USDC in its direct token vault, and a listed JupLend strategy `3MTLAqftgkfxEhPCVBKfT5PwLsEprYpQv7JX6MkpPQ1g` with `1,420,436.848641` USDC current liquidity. These are **custody/accounting quantities, not exploitable value**. The Dynamic Vault layer is used by DAMM v1 and other integrations, so summing it with underlying pool TVL would double count value.

## Current-binary read-only simulations

All synthetic transactions were sent only to RPC `simulateTransaction` with `sigVerify: false`; no transaction was submitted. Synthetic signer flags model an authorized holder or operator. They do not imply possession of those keys. The two scripts and full logs are [simulate-controls.js](./dynamic-vault-current/simulate-controls.js), [simulations.json](./dynamic-vault-current/simulations.json), [simulate-strategy.js](./dynamic-vault-current/simulate-strategy.js), and [strategy-simulations.json](./dynamic-vault-current/strategy-simulations.json).

| Path | Current-binary result | Security inference |
| --- | --- | --- |
| USDC `withdraw`, holder `B36gY...` burns 1,000,000 raw LP from `EB2N1...` | Success; LP decreases 1,000,000; holder's USDC destination receives 1,165,019 raw USDC | Positive owner-authorized control; 1 LP is worth ~1.165019 USDC at the sampled state |
| Same LP account with outsider signer and outsider destination | `InvalidLpOwner` 6022 | Outsider cannot redeem the holder's LP in this shape |
| Holder-signed withdrawal to another USDC account | Success | Destination can be selected by the **authorized** LP owner; this is not a third-party drain |
| Another vault's underlying reserve or another LP mint | `ConstraintHasOne` 2001 in each case | Vault's reserve and LP mint are bound to decoded state |
| Two holder withdrawals in one atomic transaction | Both succeed; LP decreases 2,000,000 and USDC output is 2,330,038 raw, exactly 2× the single-withdraw control | No repeated-claim amplification in this sample |
| Outsider `enableVault` | `ConstraintHasOne` 2001 against configured admin | Admin binding holds in this path |
| `depositStrategy` using configured operator `2nGpQ...` and current JupLend accounts | Success | Positive operator control on current binary; historical successful signature `2xBSwsUhAD6Qej3aAnsKWVygzMZdCpfhytuzL3CdgGLX9VR4JfH6vr8TdN3RTFSw4nS4SJKeMGAZ6fg5VSb3sZK1` at slot `457249364` was after current deployment |
| Same strategy deposit with outsider operator | `ConstraintRaw` 2003 on `operator` | Outsider rebalance blocked |
| Same strategy deposit using strategy from WSOL vault | `ConstraintRaw` 2003 on `collateral_vault` | Cross-vault strategy swap blocked at account checks |
| `withdrawStrategy` 1 USDC using configured operator | Success, including Jupiter Lend `Withdraw` and `Operate` CPIs | Current deployed cross-program withdrawal path has a positive control; source historical transaction `2MBg4UGVEXGVrkpQAfmK1Sgz91jzbVryR2evs449GKz1t7ae8KMCccwXwJDRBi3RTL1wFVXJ2iQT6Lif3T33x9Qy` predates the latest deployment, so the fresh simulation is the current-binary evidence |
| `withdrawDirectlyFromStrategy` with synthetic holder signer and LP account | Success | Positive user withdrawal control. This small withdrawal was fully covered by idle reserve and did not invoke Jupiter Lend |
| Same direct-strategy instruction with outsider signer and victim LP | `InvalidLpOwner` 6022 | LP ownership checked on the user path |

Current sampled on-chain activity was also inspected in [transactions-3MTLAqft.json](./dynamic-vault-current/transactions-3MTLAqft.json). The recent strategy history contained 99 `depositStrategy` and one `withdrawStrategy` among 100 signatures at the selected strategy address. The large volume of Dynamic Vault `deposit` and `withdraw` CPIs through DAMM transactions was decoded using the published IDL, but those are historical confirmations rather than controlled adversarial simulations.

## Limits and next focus

The tests cover one high-value USDC rebalance vault, its listed JupLend strategy, three additional sampled vault states, and selected instruction branches. The direct strategy user withdrawal was not forced through Jupiter Lend because the sampled vault had sufficient idle USDC. A complete review would need all vaults and strategy configurations, large user exits that cross the idle/strategy boundary, profit-lock accounting under loss and same-transaction rebalance, and fee-vault/reward-account paths. No result here should be extrapolated into a general absence of vulnerabilities.
