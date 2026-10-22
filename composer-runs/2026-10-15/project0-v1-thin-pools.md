# Project 0 flashloan → Raydium CPMM, actual mainnet v1 simulations

Observed 2026-10-15. All transaction execution here used read-only `simulateTransaction` against current mainnet state with `sigVerify: false`; no transaction was signed or submitted. The wire format is Solana **v1** (`0x81`, inline account keys, explicit compute and loaded data limits), never v0 relabelled as v1. The [official Solana v1 specification](https://solana.com/docs/core/transactions/versioned-transactions) allows 4,096 bytes, 64 inline accounts, and no address lookup tables. The [Project 0 flashloan guide](https://docs.marginfi.com/guides/flashloans) requires a direct top-level start, one flashloan per transaction, and a final end, and states no protocol flashloan fee. The script follows that order.

The saved artifacts contain **108 current-binary v1 simulation variants**: 61 completed and 47 rejected. They cover P0 standalone controls, P0 with Jupiter Vault, and P0 with six Raydium CPMM pools, including three distinct thin-pool types and two LP-backed WSOL/USDC pools. The count is a test count, not a coverage claim for all mainnet programs.

## Reproduction and evidence

- [`project0-v1-composition.js`](./project0-v1-composition.js) and [`project0-v1-composition.json`](./project0-v1-composition.json): baseline P0 format, borrow bounds, Jupiter Vault action, and larger CPMM cycle.
- [`project0-v1-thin-pools.js`](./project0-v1-thin-pools.js), [`project0-v1-thin-pools.json`](./project0-v1-thin-pools.json), and [`project0-v1-thin-pool-repeats.json`](./project0-v1-thin-pool-repeats.json): current on-chain pool/vault/mint reads and 50+ v1 simulations covering raw-unit boundaries, token-2022 output fees, repeated swaps, reverse legs, and full flash repayment.
- [`project0-v1-pricing.json`](./project0-v1-pricing.json): independent Jupiter Dz9 quote and lack of an FtBG route. These are indicative quotes, not executed trades or proofs of realizable proceeds.
- [`project0-v1-usdc-hx6.json`](./project0-v1-usdc-hx6.json), [`project0-v1-usdc-evbf.json`](./project0-v1-usdc-evbf.json), [`project0-v1-usdc-hx6-lp.json`](./project0-v1-usdc-hx6-lp.json), and [`project0-v1-usdc-pricing.json`](./project0-v1-usdc-pricing.json): LP-backed thin WSOL/USDC pools, same-transaction LP mint/burn, and independent USDC exits.
- Historical source P0 transaction `2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG`, slot 457340229, provided real deployed-binary account metas and discriminators. The source read can use public Solana RPC; simulations used the configured mainnet RPC.

The script's seed is **2,000,000 raw WSOL** transferred from the existing P0 signer into its WSOL ATA and synchronized before borrowing. The seed is the attacker's own capital, so every wallet comparison subtracts it. The P0 bank WSOL vault starts and finishes at **11,208,583,873,143 raw** in every successful route below. ATA creation rent and transaction fees were not included in net valuation; including them would worsen the measured results. Every successful route checks `P0 start → borrow → CPMM action(s) → exact repay → P0 end`.

## Flashloan controls

| Case | v1 bytes / keys / CU | Result |
| --- | ---: | --- |
| Borrow 2 raw WSOL, repay 2 | 671 / 14 / 105,614 | Success, vault conserved. |
| Borrow 1 raw, repay 1 | 671 / 14 / 48,854 | Rejected at P0 borrow, `IllegalBalanceState` 6040. |
| Borrow 10,087,725,485,828 raw (~90% observed vault), repay same | 671 / 14 / 106,718 | Success. |
| Borrow 11,208,583,873,142 raw (vault minus one), repay same | 671 / 14 / 52,123 | Rejected at P0 borrow, `IllegalUtilizationRatio` 6026. |

The one-unit lower bound means an apparent 1-raw CPMM rounding edge cannot be reached through this P0 flashloan. The near-vault-capacity test was a full exact repayment control and did not transfer any residual P0 funds.

## Thin CPMM pool with one raw WSOL of LP reserve

Pool `23C8LwwGWtg4TcnG1tj42pC6Tq6qwMuAFZbCrT4Zahhh` has WSOL vault **942,001** raw, including **706,500** protocol fees and **235,500** fund fees. Effective swap reserve is therefore **x = 1** raw WSOL. The opposite `FtBGZxy7yEF6QzjLCmpAKpQzBfVCVDHYda52ziSobQM1` vault holds **y = 97,705** raw, without booked fees; effective **k = 97,705**. The pool state records `lpSupply = 100`, while the actual LP mint's supply is **0**. There are no outstanding minted LP tokens to claim this dust. The reference snapshot was at finalized slot 457346193, and the subsequent simulation slots were 457349661–457349671. Their exact CPI transfers reconcile against the observed post-state; slot drift is a limit on strict same-slot pre/post inference.

| Full v1 route after 2,000,000 raw WSOL seed | bytes / keys / CU | Final wallet WSOL, FtBG | Effective pool x, y, k | P0 repay |
| --- | ---: | ---: | ---: | --- |
| Borrow 2; buy 2; repay 2 | 1035 / 23 / 146,639 | 1,999,998; 48,852 | 3; 48,853; 146,559 | Exact 2 |
| Borrow 2; buy 2; sell all 48,852; repay 2 | 1076 / 23 / 170,768 | 1,999,999; 0 | 2; 97,687; 195,374 | Exact 2 |
| Borrow 400; buy 400; sell all 97,460; repay 400 | 1076 / 23 / 170,753 | 1,999,999; 0 | 2; 97,667; 195,334 | Exact 400 |
| Borrow 401; buy 401; sell all 97,460; repay 401 | 1076 / 23 / 170,755 | 1,999,999; 0 | 2; 97,667; 195,334 | Exact 401 |
| Borrow 4; buy 2 twice; sell all 61,065; repay 4 | 1117 / 23 / 194,899 | 1,999,999; 0 | 2; 97,681; 195,362 | Exact 4 |
| Borrow 20; buy 2 ten times; repay 20 | 1404 / 23 / 363,890 | 1,999,980; 80,486 | 21; 17,219; 361,599 | Exact 20 |

The 2-raw round trip returns **1 raw WSOL** from CPMM after spending 2, so the wallet loses **1 raw WSOL**, and all 48,852 FtBG returns to the pool. The WSOL pool vault gains exactly 1 raw. The FtBG vault ends unchanged at 97,705 raw, with its protocol/fund fee claims rising by 14/4 raw FtBG; subtracting those claims gives the effective y of 97,687. The pool's k rises, so this is consistent with fee collection and rounding, not a drain. The repeated cases also increase k; the ten-buy case leaves FtBG in the wallet, not a demonstrated profit.

The **400/401 raw input** fee boundary is exact: with a 0.25% trade fee and ceiling, both have 399 raw effective input, so both return 97,460 FtBG. On the reverse full sale, each route ends with the same **1 raw WSOL wallet loss**. At 1,000,000 raw input, the FtBG vault retains 1 raw and P0 still gets full repayment from the seed. None of these paths extract booked protocol/fund fees or reduce LP invariant.

There is no independent liquid exit demonstrated for FtBG: the Raydium mint lookup yielded only this CPMM pool, and Jupiter's quote endpoint returned `not tradable` for a 48,852-raw FtBG input. This limits any interpretation of a forward-only paper gain.

## Two other tiny-reserve pools

At `AJUTQY17wZHv9sYJAw7FtU4DB7aMP4TYJUqkFfUXZjz2`, after booked fees the effective reserves were **59,529,944 raw WSOL / 1 raw output token**. Inputs from 2 through 1,000,000 raw WSOL produced zero raw output and failed at CPMM `RequireGtViolated` 2505 (source `swap_base_input.rs:149`).

At token-2022 pool `C4PfFwR6pDjQ5DfZwAeptrZuwBzJeqQaz8Syq15HDcSW`, effective reserves were **2,353 raw WSOL / 35 raw output token**. The output mint's current transfer fee is **9,900 basis points**, capped above these tiny outputs, so the transfer fee equals the entire 34- or 35-raw output. The same deployed CPMM guard at line 149 requires net received output > 0; every tested 2–1,000,000 raw WSOL swap failed 2505 before a token transfer. This is a fail-closed token-2022 boundary, not a gain.

The official [Raydium CPMM source](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/instructions/swap_base_input.rs#L142-L153) subtracts the output mint's transfer fee and requires positive amount received at that line. This source explains the observed error, while the on-chain mint extension supplied the actual 99% fee.

## LP-backed thin WSOL/USDC pools and atomic LP action

Two other pools have actual minted LP claims and an independently tradable USDC output:

| Pool | Effective x WSOL / y USDC, raw | LP state / actual mint supply | 1,000,000 raw WSOL flash-funded buy and 99% USDC reverse, after exact repayment |
| --- | ---: | ---: | --- |
| `Hx6EoXCzvYzcdtTvEm2QsXUFVe9pJzhH9FuMxmLw589D` | 2,826,093 / 294,586 | 15,583 / 15,483 | Wallet 1,962,363 raw WSOL +759 raw USDC vs 2,000,000 raw WSOL seed; k rises. |
| `EVbfagf5FXQta7z3774WgXRVqSKttL2CNzitv7gY4SQN` | 16,357,368 / 1,721,718 | 5,000,000 / 4,999,900 | Wallet 1,977,451 raw WSOL +986 raw USDC; k rises. |

Both v1 routes were 1,076 bytes, 23 accounts, about 151,000 CU. There is a 100-unit gap between pool-state LP supply and actual minted LP supply; none of those 100 units are counted as attacker-owned. Independent Jupiter indicative quotes, through routes excluding either tested pool, valued the leftover 759/986 raw USDC at about 7,159/9,306 raw WSOL. Both complete wallets were below the starting seed even before transaction costs. Inputs below 50 raw WSOL yielded no USDC and failed CPMM's positive-output check; the **400/401 raw** pair in Hx6 each yielded 40 raw USDC because the fee ceiling crossed a raw-unit boundary.

The Hx6 pool also accepted a single **1,273-byte, 27-account, 192,409-CU v1** route: P0 borrow 100,000 raw WSOL → swap to USDC → deposit 100 LP → withdraw the same 100 LP → exact P0 repay → end. The deposit consumed 18,776 raw WSOL and 1,828 raw USDC; the withdrawal returned 18,775 and 1,827 respectively. Final LP mint supply returned to 15,483, the user's new LP ATA held zero, and the P0 vault returned to its exact initial balance. The wallet finished at **1,899,999 raw WSOL +9,871 raw USDC**, versus a 2,000,000 raw WSOL seed. A separate same-transaction deposit without obtaining USDC failed SPL Token `insufficient funds`. The mint/burn leg cost the wallet 1 raw WSOL and 1 raw USDC compared with the equivalent forward swap alone, while the fee-adjusted pool k increased. An independent current quote for 9,871 raw USDC was about 93,060 raw WSOL; the complete wallet was roughly 6,941 raw WSOL below seed before execution costs. This is a permissionless AMM-state consumer with a demonstrated loss, not an unauthorized payout.

## Larger CPMM and Jupiter Vault context

The larger WSOL/Dz9 pool `Q2sPHPdUWFMg7M7wwrQKLrn619cAucfRsmhVJffodSp` supports a 10,000,000 raw WSOL P0 flash borrow, forward swap, reverse swap, exact full P0 repayment, and final health check in **1076 bytes, 23 keys, 169,440 CU**. With 1,000,000 raw WSOL seed, wallet finishes with **850,559 raw WSOL and 61,898 raw Dz9**, against initial 1,000,000 raw WSOL. The 149,441-raw WSOL drop cannot be called a net loss without pricing Dz9. Independent Jupiter indicative quotes for 61,898 raw Dz9 returned roughly **100,708–101,952 raw WSOL** via routes excluding the tested `Q2s` pool. At those observed quotes, the complete wallet is approximately **47,489–48,733 raw WSOL below the seed**, before execution fees/rent. Quote snapshots were later than the mainnet simulation and are not guaranteed executable outputs; they are sufficient to reject a claim of a demonstrated gain. The `project0-v1-pricing.json` file captures a route and context.

An existing Jupiter Vault `operate` action can also be placed between P0 start and end in a 1691-byte / 41-key v1 simulation, including before or after P0 borrow/repay. This merely demonstrates instruction compatibility in simulation. The historical Jupiter Vault signer differs from the P0 source signer; `sigVerify: false` does not prove one actor can authorize both. Double Jupiter Vault borrow ran in the same simulated transaction but no debt under-accounting was established. Delegate-based supply was rejected `ConstraintTokenOwner` 2015; changing the token owner enabled supply but prevented full P0 repayment, while a stale-meta withdraw attempt failed `VaultInvalidOperateAmount` 6009.

## Conclusion

The deployed P0 flashloan and Raydium CPMM binaries execute inside a real 4,096-byte-capable Solana v1 transaction. The tested thin-pool integer boundaries, repeated swaps, token-2022 transfer fee edge, atomic LP mint/burn, and larger cycle did **not** produce verified unauthorized net assets after exact P0 repayment. The one-raw pool is an abandoned dust case whose visible vault balance is mostly accrued protocol/fund fees; treating the entire vault as LP liquidity would create a false exploit claim. P0's current `OracleSetup` enum has no direct Raydium/AMM spot-price setting. A `Scope` setting exists, but no live Scope feed that permissionlessly refreshes from these CPMM pools and then pays out inside the same transaction was verified. No live transaction was sent, and no claim is made about untested programs or all possible routes.
