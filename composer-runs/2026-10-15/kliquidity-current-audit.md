# Kamino Liquidity current-mainnet adversarial audit

Observed 2026-10-15 (America/Toronto). Target: Kamino automated-liquidity program `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc`. This is not a KLend or Kamino Vault audit.

## Result

No confirmed exploitable vulnerability and no unauthorized net gain were found in the tested current state. In particular, a real atomic v1 KLend zero-fee flash-loan → Orca Whirlpool spot move → Kliquidity proportional deposit/share mint → Kliquidity withdrawal → Orca reversal → full KLend repayment simulation succeeded, but the modeled outsider finished with an independently valued loss of about **$0.2050**, not a gain.

The conclusion is deliberately narrower than “the program is safe.” One Orca producer path and one Kliquidity deposit/withdraw consumer path were exercised end to end. No Raydium or Meteora producer/consumer path is counted as covered, and the successful stable-pool route did not cross a tick boundary.

All testing was read-only: `getAccountInfo`, `getMultipleAccounts`, historical transaction reads, local decoding, and `simulateTransaction` with `sigVerify=false`. No transaction was signed or submitted, no team was contacted, and no exploit-dollar claim is made.

## Deployed identity and source boundary

| Item | Current observation |
|---|---|
| Program | `6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData | `8n11WGJCXqRe5pB4gBTo71YxyiZxEYm47r3LfdQiHYAj` |
| Last deployed slot | `445049632` |
| Upgrade authority | `3pAxu6C9ykZvyyzdknZvmz6CbWGZPTjRevjk4PRF5ib7` |
| Dumped ELF | `kliquidity-current.so`, 10,485,715 bytes |
| SHA-256 | `ada7cbbbe96aaf2508dcfa0bd5de4534df5173e1b18435ee585907fbaac7402e` |

The official `Kamino-Finance/kliquidity-sdk` was pinned at commit `369ed3ffd62338539a9beb4147d411a21489fd35` (v16.0.0, commit time 2026-10-05T17:49:15Z). It contains generated interfaces and transaction builders, not the deployed Rust program source, and no reproducible source-to-ELF identity was available. I therefore use the SDK only as source/interface evidence. Successful current-state simulations establish ABI compatibility on the exercised paths; they do not prove that SDK source is the source of the dumped ELF.

The SDK compiled with `tsc --noEmit`. Literal instruction discriminator bytes were not found as contiguous strings in the stripped ELF, which is not an identity test because compiled immediates need not survive in that form.

## Strategies and value directly controlled

The five highest-value live strategies returned by the official metrics endpoint were decoded from chain. Every sampled strategy was active, used Orca, had the expected strategy vault PDAs and base-vault authority, had token accounts bound to the recorded mint and authority, and held its position NFT in the expected ATA controlled by the strategy authority. The position accounts were Orca-owned and pointed back to the recorded pools.

Value below counts each strategy's idle token vaults plus only the amounts attributable to its controlled Orca position, calculated with an on-chain decrease-liquidity quote. It does not add full Orca pool vault balances or API TVL a second time.

| Strategy | Pair | Idle value | Controlled position value | Direct total |
|---|---:|---:|---:|---:|
| `Hmj82…UiGm` | pyUSD/USDC | $0.0819 | $16,741,741.67 | $16,741,741.75 |
| `ByPbo…mBdu` | USDG/USDC | $19.1240 | $10,506,932.55 | $10,506,951.68 |
| `C7HgB…j5zv` | SyrupUSDC/USDC | $9.7385 | $10,060,341.47 | $10,060,351.21 |
| `HCntz…ggXd` | SOL/JitoSOL | $16.3046 | $5,976,552.21 | $5,976,568.52 |
| `DzGJL…w5FG` | USDu/USDC | $0.0858 | $3,636,411.18 | $3,636,411.27 |
| **Total** |  | **$45.33** | **$46,921,979.09** | **$46,922,024.42** |

USD conversion in that inventory uses the contemporaneous official metric prices; token quantities and custody are chain-derived.

## Successful current-state controls

| Control | Result | Observable movement |
|---|---|---|
| Shareholder withdrawal of 1 share | Success, 234,792 CU | Burned 1,000,000 raw shares; received 1,638 raw pyUSD and 1,427 raw USDC |
| Permissionless fee/reward collection | Success, 216,680 CU | Strategy vaults received 43,390 raw pyUSD and 4,961,432 raw USDC; destinations stayed fixed |
| Executive position exit for rebalance | Success, 106,397 CU | Controlled position moved 8,947,382,448,488 raw token A and 7,798,135,419,382 raw token B into strategy vault custody |
| Full close/open replacement rebalance | Success in v1, 432,542 CU | 1,686 bytes, 41 inline accounts, 3 required signatures; replacement position opened after simulated rent funding |

The full rebalance initially exposed a useful tooling distinction: the equivalent v0 packet could not simultaneously carry rent funding and a compute-budget instruction under the 1,232-byte packet limit. The real v1 encoding (4,096-byte/64-inline-account limits with transaction compute configuration) fit and executed successfully. That was a transaction-format blocker, not a program failure.

## Authorization and account-substitution results

| Mutation | Result |
|---|---|
| Withdraw signer replaced while retaining victim share account | Rejected: `ConstraintTokenOwner` (2015) |
| Withdraw signer and beneficiaries replaced | Rejected: `ConstraintTokenOwner` (2015) on victim share ATA |
| Cross-strategy strategy / vault / position / mint substitutions | Rejected: `ConstraintHasOne` (2001) |
| Withdraw vault order swap or position-to-vault alias | Rejected |
| Withdraw pool CPI program changed | Rejected: `WrongDEXProgramID` (6081) |
| Fee collector signer replaced | **Succeeded**, as expected for maintenance; proceeds still went to fixed strategy/treasury accounts |
| Fee collector plus treasury beneficiaries replaced | Rejected: `RequireKeysEqViolated` (2502) |
| Fee position swapped cross-strategy | Rejected: `ConstraintHasOne` (2001) |
| Fee pool CPI program changed | Rejected: `WrongDEXProgramID` (6081) |
| Position-exit admin replaced | Rejected: `ConstraintHasOne` (2001) |
| Position-exit strategy replaced | Rejected: `ConstraintHasOne` (2001) |
| Position-exit pool CPI program changed | Rejected: `WrongDEXProgramID` (6081) |
| Replacement-position admin replaced | Rejected: `InvalidAdminAuthority` (6083) |
| Replacement-position pool CPI program changed | Rejected: `WrongDEXProgramID` (6081) |

Two sequential authorized withdrawals and fee-collection followed by withdrawal both succeeded. The former burned exactly 2,000,000 raw shares and returned twice the single-withdraw amounts. Failed simulations return unavailable post-state and are recorded as null, not misreported as zero balances.

## KLend zero-fee flash boundaries and composition

The selected current USDC reserve was `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`. Its decoded `flashLoanFeeSf` field at reserve offset 4904 was **exactly `0`** on the `2^60` fee scale. This is a configuration fact, not a conclusion inferred from fee rounding.

At the final snapshot it reported 8,010,116,695,096 raw USDC available. Atomic borrow/repay pairs succeeded for 1 raw unit, 2 raw units, the existing 7,789,632,497,552-unit control, `available-1`, and exactly `available`; `available+1` rejected with KLend `InsufficientLiquidity` (6008). Because reserve liquidity changes between slots, the exact boundary is snapshot-scoped.

Successful cross-program compositions included:

- flash borrow → Kliquidity fee collection → repay;
- Kliquidity fee collection → flash borrow → repay, with the repay index updated;
- flash borrow → authorized 1-share withdrawal → repay;
- flash borrow → two sequential authorized withdrawals → repay;
- flash borrow → fee collection → withdrawal → repay.

In every successful flash composition, the borrower's USDC, KLend liquidity-supply token balance, and KLend fee-vault balance reconciled exactly, and reserve available liquidity returned to its pre-transaction amount. KLend has no persistent flash-debt account; repayment is enforced by the indexed repay in the same transaction. A deliberately wrong repay index rejected with `InvalidFlashRepay` (6033).

## Spot-displacement/share-pricing hypothesis

Distinct paths actually executed, not merely assigned:

1. **Producer:** Orca Whirlpool v2 USDC → pyUSD spot swap in pool `9tXiuRRw7kbejLhZXtxDxYs2REe43uH2e7k1kocgdM9B`.
2. **Consumer:** Kliquidity proportional deposit → share mint → shareholder withdrawal in strategy `Hmj82e48X9LNW8LeMLk186iE4UKPoUwWuLwoiqMpUiGm`.

The small control swapped 200,000 raw USDC, made a ratio-correct deposit, withdrew 120.7 shares, and reversed 199,000 raw pyUSD. It succeeded but retained 1,513 raw shares and 766 raw pyUSD, with a 1,184 raw USDC loss. Valuing all three legs produced a loss, not a rounding gain.

The scaled atomic v1 path was:

`borrow 186,500,000 USDC raw → swap 100,000,000 USDC raw to pyUSD → ratio deposit → withdraw 60,300 shares → reverse 99,500,000 pyUSD raw to USDC → repay 186,500,000 USDC raw`

It succeeded in a 1,799-byte v1 message with 42 inline accounts, one signer, and 671,838 CU. Reconciliation at the end of the atomic simulation:

| Asset/state | Net change |
|---|---:|
| Borrower USDC | -662,454 raw |
| Borrower pyUSD | +301,351 raw |
| Borrower strategy shares | +50,810,157 raw (50.810157 shares) |
| Strategy share mint supply | +50,810,157 raw |
| KLend liquidity supply | 0 |
| KLend fee vault | 0 |
| KLend available liquidity | restored exactly |

An independent Jupiter Price API quote at block IDs 457354654/457354796 priced pyUSD at $0.9996744439 and USDC at $0.9996271349. Valuing the residual shares from the independently priced chain-derived strategy assets per outstanding share gives:

- USDC change: -$0.662207
- pyUSD change: +$0.301253
- residual shares: +$0.155909
- **total outsider change: -$0.205045**

The pool started and ended in tick 0; the final square-root price and liquidity differed slightly because the reversal was deliberately conservative and the outsider retained pyUSD and strategy shares. Thus this proves a real flash-funded producer/consumer/reversal path and complete repayment, but not a tick-crossing path. Larger trial sizing reached the withdrawal/reversal stages, but exact share output is state-sensitive and the modeled account needed working capital for swap losses. No tested size produced unauthorized value.

## Remaining limits

- Exact deployed Rust source identity was unavailable; analysis beyond runtime controls uses the official SDK only as interface evidence.
- The sampled high-value strategies were all Orca strategies. Raydium and Meteora strategy paths remain untested and are not counted as coverage.
- The successful displacement route stayed within tick 0. Multi-array tick-crossing and supplemental-tick-array behavior remain a separate unclosed branch.
- Simulation bypassed cryptographic signature verification so that authorization failures could be isolated. Successful privileged controls still require all indicated real signers and are not outsider capabilities.
- Public mainnet state is moving. Values and exact reserve boundaries are pinned to the recorded slots/artifacts, not asserted as timeless constants.

## Reproduction artifacts

- `kliquidity-current-audit.json` — deployment pin, custody/value inventory, v0 controls and mutations.
- `kliquidity-klend-v1.json` — atomic v1 controls, flash boundaries, account reconciliation, and manipulation routes.
- `kliquidity-current.so` — dumped deployed ELF.
- `kliquidity-sdk-official/scripts/kliquidity-current-audit.ts` — reproducible inventory/control/mutation runner.
- `kliquidity-sdk-official/scripts/kliquidity-klend-v1.ts` — reproducible v1 flash/manipulation runner.

