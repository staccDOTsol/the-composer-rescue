# Current Solana pool/TWAP manipulation branch

Observed 2026-10-15 against deployed mainnet programs and current accounts. No transaction was submitted. **Disposition: no validated profitable one-transaction exit.** The only signed current-state fork result in this branch proves a transient pool-derived oracle response and a loss after unwind; it does not prove a value-moving consumer payout.

## Direct producer → oracle → consumer graph

| Rank | Assets / producer | Oracle read | Direct value-moving consumer | Capital / reachable payout | Disposition |
|---:|---|---|---|---|---|
| 1 | Jupiter DEX vault 98, USX/USDC (`4XGHBk…`) | `DexSmartColPegOracle` reads current DEX Liquidity positions/reserves in the same transaction; this is pool NAV/share rate, **not TWAP** | Jupiter Vaults `OperatePerfectDex` | A 1,000,000 USDC KLend flash moved 88.748% of token0-side liquidity. The distorted rate was consumed, but added credit was only 139 raw USDC, below the 1,000-raw minimum. The completed 2,232-byte/53-account route borrowed 1,000 raw USDC and ended down 799,486 raw USDC plus rent. | Direct and reachable, but economically negative. Cross-pool exit was not completed in a signed route. |
| 2 | Jupiter DEX vault 103, sUSDai/USDC (`G41Dqz…`) | `DexSmartColPegOracle`, same-transaction pool-state read, **not TWAP** | Jupiter Vaults positions (26 total, 8 borrowing) | Fresh attacker, `sigVerify:true`, current-program local fork: KLend USDC flash → pool move → oracle read → same-pool unwind → repay. Maximum successful tested displacement was 2,500,000 sUSDai-equivalent raw units; 1,389 bytes, 33 accounts, 6 instructions, 384,477 CU. Oracle moved from `2002155642630428` to `2001601601810517` during the move; lender and fee vault reconciled, sUSDai ended zero, and attacker lost 1,116,709,177 raw USDC. | Strong signed oracle-response lead, but no consumer action/payout. A current independent Orca Whirlpool exit (`2JwiWq…`) quoted 1,000 sUSDai to 1,115.758482 USDC; 10,000 sUSDai returned no route when JupLend AMM was excluded. This is far too shallow to unwind the multi-million-unit distortion used in the signed test. |
| 3 | Jupiter DEX vault 92, WSOL/JitoSOL (`Etb72A…`) | `DexSmartColPegOracle`, same-slot pool state, **not TWAP** | Jupiter Vaults | 67 positions / 7 borrowing; direct zero-fee lenders exist for both sides. | Live direct graph, but no signed consumer→independent-exit proof in this branch. |
| 4 | Jupiter DEX vault 95 USDG/USDC, vault 96 USDC/USDT debt, plus vaults 90/91/93/94/97/105 | DEX smart-collateral or smart-debt peg oracle; current pool state, **not TWAP** | Jupiter Vaults | Eleven direct Vault→Oracle→DEX paths serve 431 positions, 112 borrowing. | Configuration and current-state joins are real; none yielded a profitable signed exit here. |
| 5 | Orca PYUSD/USDC → Kamino Liquidity | Kamino reads its strategy valuation from Orca plus Scope guard; direct spot/NAV dependency, **not a Scope TWAP-only claim** | Permissionless deposit/withdraw and fee collection | Signed dual-flash controls fit 2,238 bytes/51 accounts and lost 0.050071027 SOL + 7.351865 USDC; larger moves hit `OrcaPriceTooDifferentFromScope` 6059. | Direct consumer, tested negative. |
| 6 | Scope Orca/Raydium CLMM mappings | Scope spot plus EMA/TWAP state | Directly joined current consumers: only KLend CTALS among 619 reserves; one marginfi Bank used a Scope feed with no AMM entries | 26 configured AMM entries / 25 pools. CTALS available liquidity was 120.487670088 CTALS and its refreshed price remained stale/invalid. | No high-value USDC, USDT, USDG, USX, sUSDai, pyUSD, WSOL, or JitoSOL consumer was directly joined to these AMM entries. Generic Scope use is not counted. |

## Why an intra-transaction TWAP cannot persist here

Scope is the only actual time-averaged branch established in this slice. Its EMA samples require at least 30 seconds between updates and use 1h/8h/24h/7d windows. More decisively for a single Solana transaction, deployed Scope rejects `refresh_price_list` after any prior non-Compute-Budget instruction. Current-binary controls returned 6014 `RefreshWithUnexpectedIxs` after Memo and after KLend flash borrow, while refresh-first and ComputeBudget→refresh succeeded. Wrong pool binding returned 6004 `UnexpectedAccount`.

Therefore the necessary atomic order `flash/swap → Scope refresh → consumer → unwind → repay` is impossible through this adapter. `Scope refresh → flash/swap` cannot include the later pool change, and a cross-slot manipulation cannot satisfy the requested one-transaction objective. Jupiter DEX and Kamino paths can consume same-slot state, but they are spot/NAV reads, not a TWAP that persists through reversal.

## Validation rubric and result

- [x] Direct producer account bound to the oracle source, not a generic integration reference.
- [x] Same-slot behavior distinguished from time-windowed TWAP behavior.
- [x] Current staleness/order/source-account controls checked.
- [x] At least one attacker-owned `sigVerify:true` current-program fork transaction reconciled lender and attacker balances.
- [ ] Profitable consumer payout followed by an independent pool-B/multihop unwind and all repayments.

The missing final item is dispositive. The sUSDai route is the strongest surviving lead, but its separately quoted Whirlpool exit was only demonstrated at 1,000 sUSDai and failed to quote at 10,000 sUSDai, versus a 2.5 million-unit signed pool-A displacement. No reportable fund-loss finding is claimed.

Machine-readable facts and input digests: [`twap-cross-pool-current-evidence.json`](twap-cross-pool-current-evidence.json).
