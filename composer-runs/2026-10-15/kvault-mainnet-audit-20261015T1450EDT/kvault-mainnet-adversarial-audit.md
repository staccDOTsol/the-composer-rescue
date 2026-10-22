# Kamino KVault mainnet adversarial audit

Date: 2026-10-15 (America/Toronto)  
Program: `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd`  
Outcome: no reportable unauthorized value-moving vulnerability found  
Execution policy: finalized/read-only RPC and `simulateTransaction` only; no transaction submitted and no team contacted

## Verdict

No simulated sequence produced an unauthorized net gain after repaying its flash loan. Current-state positive controls succeeded before mutations. Successful KVault deposit/withdraw cycles were adverse to the caller by 1,002 raw USDC for one cycle and 4,008 raw USDC for four cycles; large cycles that could not absorb the configured withdrawal penalty/rounding failed at flash repayment and rolled back atomically. Signer, destination, share-account, token-program, reserve-order, cToken-PDA, and reserve-substitution mutations all failed.

This is not a proof that the deployed binary has no vulnerability. The main remaining evidence gap is source-to-binary equivalence: the current ELF was dumped and identified, but the pinned source could not be rebuilt with the installed SBF toolchain because its pinned `ahash` dependency requests the removed `stdsimd` feature.

## Current deployed program and custody

- Upgradeable ProgramData: `GeZ7nkkcbJ6VVV1XVFbmFnLCY3F1LPBGk6cufDZvrbGn`
- Upgrade authority: `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW`
- Last deployed slot: `456460695` (`2026-10-13T13:36:00Z`)
- Current ELF SHA-256: `f7a9a62d71828bd8a89eafdbbfaf56bb2f010817bbb83018be7e94831b8eb140`
- Official KVault source revision reviewed: `2dadf9449d32cfaa2ad5d1540c8edff378512c8c`
- Pinned KLend integration revision reviewed: `a08760976f51a3a58c4a0c6ea27b4a0e565bca79`

At finalized slots `457345221`–`457345227`, the program owned 191 `VaultState` accounts spanning 19 underlying mints and 105 distinct KLend reserves. Program-controlled priced custody was `$512,715,844.61374027`; `$520,915.706875` of that total was direct uninvested underlying. KLend-backed collateral value is economically overlapping and is not additive ecosystem TVL. Four vaults had only six unpriced raw dust units.

All 191 vaults passed the checked controls: state owner, base-authority PDA and bump, token-vault PDA, shares-mint PDA, token-account authority and mint, cToken-vault PDA and authority, reserve owner, reserve collateral mint, and reserve underlying mint. Control violations: `0`.

The ten largest vaults represented approximately `$468,514,424.95` (about 91.4% of priced custody). The largest were Sentora PYUSD (`$110.452M`), Ethena PYUSD Prime (`$95.895M`), RWA USDC (`$58.589M`), wYLDS Allocator (`$55.073M`), Institutional Commodity Yield (`$53.373M`), and Steakhouse High Yield USDG (`$48.271M`).

## Exit and account-control review

Three independent source passes covered 61 KVault files: whole-program baseline, architecture/trust boundaries, and focused high-value exits. The user exit paths bind the signing user, user-owned share account, destination mint/owner, VaultState-derived authority, underlying token vault, share mint, per-reserve cToken PDAs, fixed SPL Token programs, and fixed KLend CPI program. Dynamic reserve accounts are consumed in VaultState order and checked against configured reserve identities. Share burns and post-CPI balance checks occur in the same transaction, so a later failure rolls back earlier movements.

Admin-only fee and reward exits remain trusted authority operations. Reward destinations may be any same-mint account selected by the authorized admin; that is an explicit authority model, not an unprivileged exit. A permissioning authority can affect exit liveness for the one currently permissioned `Earn Demo` vault (about `$1.0036` priced custody), which is a trust/configuration property rather than a demonstrated bypass. The public high-level interface not exposing a permissioning signer is an SDK usability gap, not evidence that the on-chain signer check can be bypassed.

Recent-mainnet discovery examined 100 signatures (96 successful): 45 deposits, 4 full withdrawals, 6 withdrawals from available liquidity, 4 invests, and 29 `invest_with_max` calls. Successful transactions supplied current account tuples for the simulations.

## Atomic v1 flash-loan stress results

The selected KVault was Solana Mobile USDC Earn Vault, `3SMNuqK7m13KorY9gX8DzjQAVXGbhgRVni65Pk6LTBgC`, with one configured KVault-side KLend reserve `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`. Its configured minimum deposit was `100000` raw USDC, minimum withdrawal `10`, fixed withdrawal penalty `1` raw unit, and withdrawal penalty `1` basis point.

Flash funding used KLend USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`. Its current on-chain `flashLoanFeeSf` was exactly `0`; this was not a nonzero fee rounded to zero. Current available liquidity was `8,033,161,134,261` raw USDC. The selected KVault-side reserve had a nonzero fee field, so the zero-fee conclusion is specific to the funding reserve.

Every case used a real serialized Solana v1 transaction with no address lookup table, bounded by 4,096 wire bytes, 64 inline addresses, 64 instructions, 1.4M requested compute units, and 64 MiB loaded-account data. The evidence records exact message base64, SHA-256, account metas, instruction data, compute consumed, runtime trace, and pre/post decoded state for all 35 cases.

| Positive control | Exact instruction order | Wire / accounts | CU | Result |
|---|---|---:|---:|---|
| 1 raw flash pair | borrow → repay | 531 B / 11 | 55,211 | success; wallet, supply, fee vault and reserve available liquidity unchanged |
| User-provided `7,789,632,497,552` raw flash pair | borrow → repay | 531 B / 11 | 55,213 | success; exact repayment, no fee and no gain; wire SHA-256 `7a105f37ff9e1e6d9a7a28e71a628ec378db9244e4d6a703cb9532013db615fa` |
| Threshold + 1 | borrow → deposit → withdraw-from-available → repay | 922 B / 21 | 242,256 | success; wallet `1,031,473→1,030,471`, shares `0→0`, share supply unchanged, KVault underlying `+1,002`; wire SHA-256 `806cd31141400c6d3ba50224d80121ea97e31ef494b059fac51118d43963cd2e` |
| 1 USDC full exit | borrow → deposit → full withdraw → repay | 1,061 B / 25 | 267,592 | success; wallet `-1,002`, shares return to zero, share supply unchanged, funding supply/fee/available unchanged; wire SHA-256 `556ac17d94674b410b304043f265268083ba758b2def0f4f841f9892f660298f` |
| 1 USDC invest/full exit | borrow → deposit → invest-with-max → full withdraw → repay | 1,100 B / 25 | 430,717 | success; invest logged `999,999` liquidity and `829,421` collateral with rounding loss `1`; wallet `-1,003`, shares `0`, full flash repayment; wire SHA-256 `1e73f213772b4d1f68fc0137dca5f962f7f23281d3ea7ed5e5fff399e3385f60` |
| Four repeated cycles | borrow → 4×(deposit → withdraw-from-available) → repay | 1,135 B / 21 | 765,908 | success; wallet `-4,008`, KVault underlying `+4,008`, shares and supply return to baseline |
| Exact full available liquidity | borrow `8,033,161,134,261` → repay | 531 B / 11 | 55,212 | success; supply, fee vault and reserve available liquidity restored exactly |

The base successful one-cycle post-state kept the funding supply at `8,033,161,204,266`, funding fee vault at `0`, and funding reserve available liquidity at `8,033,161,134,261`. KLend flash loans create no obligation/debt account; the reserve's borrowed fixed-point accumulator can refresh with the simulation slot, while available liquidity and token balances demonstrate full principal repayment.

Threshold behavior was exact and caller-adverse. `99,999` raw failed because the effective deposit became `99,998`; configured threshold `100,000` failed because it became `99,999`; `100,001` succeeded. This one-unit shift came from KVault share/deposit rounding, not the funding reserve's flash fee.

Large KVault cycles at 1,000,000 USDC, 99%, and 99.9% of current flash liquidity reached KLend repayment but failed with SPL Token `insufficient funds`: the legitimate KVault penalty/rounding left less than the borrowed principal. The same happened after investing and fully withdrawing 1,000,000 USDC. Because repayment failed, the entire transaction rolled back; none is a value-moving result. Borrowing exactly all current flash-reserve liquidity and immediately repaying succeeded, while available liquidity plus one failed at borrow with KLend `InsufficientLiquidity` (`6008`).

Two and four deposit/withdraw repetitions succeeded with linear caller losses (`2,004` and `4,008` raw USDC). Eight repetitions fit in 1,419 bytes and 21 inline addresses but failed at instruction 11 with `MaxInstructionTraceLengthExceeded` after 964,148 CU, before the 4,096-byte or compute ceilings; the transaction rolled back.

Refresh instructions placed before borrow, between borrow/deposit, between deposit/withdraw, after withdraw, before invest, and after invest all succeeded without changing the caller-negative result. Repaying before the exit also succeeded, but did not create value: the caller first deposited borrowed-plus-owned funds, repaid the flash principal from the wallet, then performed an authorized share burn/withdraw and ended `1,002` raw USDC lower.

Adversarial mutations failed as follows:

- withdraw before deposit: `CannotWithdrawZeroShares` (`7040`)
- deposit or withdrawal destination aliased to the KVault token vault: `ConstraintTokenOwner` (`2015`)
- missing withdrawal user signature: `AccountNotSigner` (`3010`)
- wrong share account: `InvalidAccountData`
- wrong token program: `InvalidProgramId` (`3008`)
- reversed refresh accounts: `AccountDiscriminatorMismatch` (`3002`)
- wrong cToken vault or reserve substitution: PDA seed constraint (`2006`)

These failures occurred inside an atomic transaction, so the earlier flash borrow/deposit did not persist.

## Source/binary limitation and non-findings

The dumped binary is a valid stripped eBPF ELF, and embedded identifiers/security text are consistent with the reviewed source surface. That is corroboration only. A single reproducibility attempt failed in the installed `cargo-build-sbf` platform tools because the pinned dependency graph requires a removed feature. No source-binary match or mismatch is asserted without a reproducible build.

The deployed upgrade authority can replace program logic. Admin, allocation-admin, reward-destination, and permissioning powers are therefore explicit trust assumptions. They were not treated as unprivileged exploits. No finding is labeled a drain because no unauthorized value-moving simulation ended with positive net value after repayment.

## Evidence

- `evidence/mainnet-custody-inventory.json` — finalized custody, pricing, PDA and reserve controls
- `evidence/kvault-mainnet-current.so` — dumped deployed ELF
- `evidence/recent-kvault-transactions.json` — recent instruction census and transaction selection
- `evidence/source-deposit-2QUH.json`, `source-deposit-517H.json`, `source-withdraw-3RHy.json`, `source-withdraw-available-2bcs.json`, `source-withdraw-available-4VyB.json` — current successful source transactions
- `evidence/kvault-klend-v1-extremes-v2.json` — authoritative 35-case simulation matrix, exact wire messages, traces and pre/post state (`kvault-klend-v1-extremes.json` is superseded)
- `kvault-klend-v1-extremes.js` — reproducible read-only simulator
- `inventory-kvault.js`, `discover-exit-transactions.js`, `inspect-source-transaction.js` — evidence collectors

## Bottom line

Within the reviewed source and the current representative USDC runtime surface, KVault's exits remained signer/share/PDA/reserve bound, flash-funded share and collateral accounting was caller-adverse or atomic-failing at the tested extremes, and no unauthorized net-gain path survived repayment. Coverage remains partial only because exact deployed-binary equivalence was not established and the runtime matrix did not execute every one of the 191 vault configurations.
