# Orca Whirlpools current-mainnet revalidation

Date: 2026-10-15  
Target: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`  
Mode: current-mainnet reads and `simulateTransaction` only; no transaction submission and no team contact

## Verdict

No validated security finding was produced. In particular, no test achieved an unauthorized asset transfer, an unpaid flashloan, or a positive attacker residual after repayment and after subtracting the legitimate value of the signer-owned position.

The highest-risk source hypothesis was a possible free-liquidity credit caused by Pinocchio token-transfer wrappers ignoring the return value of `invoke_signed_unchecked`. It is not exploitable on the tested current runtime: an insufficient-funds SPL Token CPI aborts the enclosing Whirlpool instruction before the credited state can be used, and an atomic increase-then-decrease transaction fails at the increase.

This is a bounded revalidation, not a claim that every Whirlpool account or instruction was exhaustively proven safe. The result applies to the current executable binding, the tested exits and mutations, and the current control pool/position described below.

## Current executable binding

The final binding read was taken at context slot `457351682` at `2026-10-15T19:19:27.597Z`.

| Property | Observed value |
| --- | --- |
| Program | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Executable | `true` |
| Loader owner | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData | `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD` |
| Deploy slot | `457152296` |
| Upgrade authority | `null` (immutable ProgramData) |
| Extracted executable bytes | `10,485,715` |
| Executable SHA-256 | `c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f` |

The executable bytes are retained as `whirlpool-current.so` in the stable evidence directory. The official Orca source snapshot is commit `cc683ec92acb5e7606caa3d8e514d9383e9c7c11` from `https://github.com/orca-so/whirlpools.git`; the retained IDL SHA-256 is `f3e95ddf321d24b71ce56f5ba842055899f32a1feee3be9f0d3ccf2bd6a55bb8`.

No reproducible SBF build was used to prove that this source commit is byte-identical to the deployed executable. Source review is therefore explanatory; current-runtime simulations and the executable hash are the authoritative evidence.

## Control pool and custody binding

The control pool was `2TAgfogn8JRwwTnsGKUa6WUT5Xdv1iMEzfEDMor68X9C` and the control position was `44pSCDrY8Ka6j5qyA7HJdx9cgCEkepjj9N6atrXSv79e`.

- The pool re-derived from the Whirlpool config, ordered mints, and tick-spacing seed.
- The position re-derived from position mint `GtFaQh7LgqMbKKfDikhyJgMpaBhPWqm2NEd7yJgXe4V`.
- Position-token account `AvTCVwfFPRqmdFHCipN3mwS6pXzaGb9ac21ycjyQmn5y` held exactly one matching position token and was controlled by `4i4rYMBihHVv4VwuGQmu2eu9FEPf5tqvHQFrbFpCwQP1`.
- Vault A `26NPUT2NWS8vbgdZuD4iMKXbypYb6SpZKvmi76ezaG35` held `19,932,773,551,307` raw WSOL units. Its mint matched WSOL and its token authority matched the pool.
- Vault B `AbPTQH3jPZUfZYfyPmMhEPvD2tMuWjcFsgVjMbMvdTZ6` held `171,715,778,700` raw units of mint `A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS`. Its mint and pool authority matched.
- The position's lower and upper tick arrays re-derived to `FiQBpg47ZcHjqCj6m47GMpzhCsATihFZCjMXqmYAkN4X` and `dBqmnuE7DJ7Dn5vemuLhdCHptc1rZAeRDGG31N8PdZe`.
- Pool fee configuration was the raw on-chain pair `feeRate=1600` and `protocolFeeRate=1300`: under the reviewed source denominators, a static swap fee of `0.16%`, with `13%` of that fee allocated to protocol fees.
- Configured protocol-fee authority was `CRQd5wvbf6FKVmjHC7on8w4pzFPzudij2BKXRcMCu7aK`.

The retained historical queue aggregate of `$259.11M` covered 200 authority-verified vaults in a 100-pool sample with five nonzero vaults unpriced. Its raw per-vault price derivation is absent, so it is retained only as historical prioritization context. It is not presented as current verified custody or exploitable value.

## Successful controls and adversarial mutations

The final harness first established successful value-moving controls, then mutated the relevant security boundaries.

| Test | Result |
| --- | --- |
| Update and collect current position fees | Success, `34,889` CU |
| Decrease 1% of current position liquidity | Success, `25,115` CU |
| Reposition to an adjacent range with 1% liquidity | Success, `35,432` CU |
| Collect current protocol fees with configured authority | Success, `21,967` CU |
| Unauthorized position authority plus attacker destinations | Rejected, Whirlpool `6019` |
| Unauthorized protocol-fee authority plus attacker destinations | Rejected, constraint `2012` |
| Wrong-mint destination alias | Rejected, SPL Token `3` |
| Stored-vault substitution | Rejected, constraint `2012` |
| CPI token-program substitution | Rejected, constraint `3008` |
| Position-token alias to Position state | Rejected, constraint `3007` |
| Authorized signer redirects to same-mint third-party accounts | Success; expected authorized behavior, not a privilege gain |
| Two authorized decreases in one transaction | Success; liquidity decreases twice as requested |
| Valid decrease followed by invalid authority | Whole transaction fails at the invalid leg |
| Invalid authority followed by valid decrease | Whole transaction fails before the valid leg |

The control pool was actively changing on mainnet during the run. Error codes, instruction logs, per-simulation transfer records, PDA/mint/authority bindings, and transaction-local results are authoritative. Cross-simulation deltas against an earlier live snapshot can include unrelated intervening pool activity and are not used to support a finding.

## Critical source hypothesis: rejected by runtime

Official source commit `cc683ec9…` mutates liquidity state before owner-to-vault transfers in `programs/whirlpool/src/pinocchio/instructions/increase_liquidity_v2.rs:114-197`. Its transfer wrapper invokes `invoke_signed_unchecked` without using a returned value in `programs/whirlpool/src/pinocchio/cpi/token_transfer_checked.rs:46-59` and `:112-116`.

Two current-runtime tests used correct-mint but empty owner token accounts:

1. `increase_liquidity_v2` for the full current position liquidity failed at instruction 2 with SPL Token `InsufficientFunds` (`Custom 1`), `24,516` CU.
2. The atomic sequence `[empty-source increase, equal decrease]` failed at the same increase; the decrease was never entered.

The Token program failure was immediately followed by Whirlpool failure. No free position liquidity, vault withdrawal, or attacker balance increase was produced. The source pattern is worth maintaining carefully, but it does not satisfy the required current-runtime exploit condition.

## Real v1 flashloan composition

The composition harness used the retained custom v1 encoder with an exact maximum of 4,096 wire bytes and 64 inline addresses. It did not substitute a legacy or v0 transaction.

The primary WSOL KLend reserve was:

- Reserve: `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM`
- Market: `C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV`
- Supply vault: `3SdrFTt4Ye5yppzpT9axNMj8W1x71nDYXdjv7vDuBpnR`
- Fee vault: `DW718KwF5d9URykynv8dcmHSQNXKTv7V5VxW5ozckbGS`
- Current decoded available amount at the composition snapshot: `6,583,112,759,818` raw WSOL
- Current decoded `flashFeeSf`: exactly `0`, not a rounded approximation

Direct borrow/repay succeeded at 1 raw unit, `available-1`, and exact `available`; supply-vault, fee-vault, reserve-available, and wallet deltas were all zero. `available+1` failed with KLend `InsufficientLiquidity` (`6008`). Each direct pair used 606 bytes, 13 accounts, and 3 instructions.

The thinnest positive zero-rate WSOL reserve in the retained current census was independently tested:

- Reserve `6Cf6DF9HsuaioE6EZbyn16VmhwtqVvm1vDThht5BgDw`
- Exact current available amount `100,000` raw WSOL
- Exact current `flashFeeSf=0`
- 1, 99,999, and 100,000 raw units all borrowed and repaid with zero balance deltas
- 100,001 was rejected with `InsufficientLiquidity` (`6008`)

For cross-program same-asset composition, WSOL borrowed from KLend funded a one-sided WSOL Whirlpool add/remove cycle and then repaid KLend. Exact reserve availability succeeded in 1,217 bytes, 24 inline accounts, 7 instructions, and `127,192` CU. The nonzero wallet and vault deltas were the authorized withdrawal of the signer's pre-existing position, not flash-funded profit; KLend supply, fee, and reserve deltas were zero.

Repetition and ordering behaved as follows:

- Eight add/remove cycles succeeded in 2,022 bytes, 24 accounts, 21 instructions, and `304,633` CU. Relative to one cycle, the repeated pair was conservative by one raw WSOL per extra cycle.
- Nine cycles reached the first runtime blocker: `MaxInstructionTraceLengthExceeded` at instruction 21.
- Twenty-six cycles encoded to 4,092 bytes but hit the same instruction-trace blocker.
- Twenty-seven cycles were rejected locally at the exact v1 boundary: 4,207 bytes exceeds 4,096.
- `update_fees_and_rewards` before the flash leg and between add/remove legs succeeded with full repayment.
- Updating after the position was emptied failed with Whirlpool `LiquidityZero` (`6012`), and the transaction rolled back.
- A wrong flash-borrow index failed with `InvalidFlashRepay` (`6033`).
- Aliasing the Orca owner source to the pool vault failed with SPL Token owner mismatch (`Custom 4`).

## Swap, tick crossing, thresholds, and residuals

Forward and reverse exact-input swaps used the same zero-rate KLend WSOL reserve and the real v1 encoder. Every successful case restored KLend supply, fee-vault, and reserve-available balances to zero delta.

The authorized position-withdrawal-only control returned `9,360,367,131` raw WSOL and `124,715,383` raw token-B units to the signer. Swap residuals were compared against this control so the signer's existing LP equity was not mislabeled as profit.

| Flash input | Forward B output | Reverse A output | Incremental WSOL vs authorized baseline | Incremental token B | Repayment |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1,000 | 8 | 817 | -183 | 0 | Complete |
| 1,000,000 | 8,546 | 996,655 | -3,345 | 0 | Complete |
| 1,000,000,000 | 8,546,909 | 996,802,424 | -3,197,576 | 0 | Complete |
| 9,000,000,000 | 76,920,258 | 8,971,223,331 | -28,776,669 | 0 | Complete |
| 65,834,252,993 | 562,565,293 | 65,623,773,374 | -210,479,619 | 0 | Complete |

Inputs of 1, 2, and 10 raw WSOL produced zero token-B output and no positive residual. At 1 SOL, an output threshold equal to the observed 8,546,909 raw token-B output succeeded; `8,546,910` failed with `AmountOutBelowMinimum` (`6036`).

An exact-reserve input of `6,583,425,299,329` raw WSOL moved the approximate tick from `-47609` to `-48177`, crossing the `-47872` tick-array boundary. The reverse leg used the newly required arrays starting at `-49280` and returned `6,562,650,733,122` raw WSOL, bringing the approximate tick back to `-47609`. Repayment then failed atomically because:

`6,562,650,733,122 + 9,360,367,131 = 6,572,011,100,253`, which is `11,414,199,076` raw WSOL short of the borrowed amount.

Thus the exact first blocker after correcting the tick-array sequence was repayment insufficiency, not a profitable accounting residual. Because the transaction failed, none of the simulated intermediate transfers committed.

Additional swap controls:

- Reversing the swap order succeeded only by using the legitimate token-B value withdrawn from the signer's position; it did not cross an authorization boundary.
- Four repeated 1-SOL forward/reverse pairs succeeded in 1,686 bytes and `346,334` CU. The result was lower than the authorized baseline, with a one-raw-unit token-B rounding loss.
- A noncanonical order for an unused tick-array account was accepted when the required current array was still supplied. This is permissive unused-account handling, not a custody bypass.
- Omitting/substituting the current tick array failed with `InvalidTickArraySequence` (`6023`).
- Aliasing the expected oracle PDA to the pool failed the seed constraint (`2006`). The correct derived oracle address was uninitialized at the snapshot but was accepted by the real swap path.
- Aliasing the swap source to the pool vault failed with SPL Token owner mismatch (`Custom 4`).

All successful round trips had a negative WSOL residual and zero token-B residual versus the authorized baseline. There was therefore no positive residual to price and no basis for a gain or drain claim.

## Limitations

- This revalidation used one actively changing current pool and one signer-controlled position. It does not reproduce all pool types, Token-2022 hooks, rewards, locked positions, or every Whirlpool instruction.
- The official source snapshot was not proven byte-identical to the deployed executable. Runtime evidence is bound to the executable hash above.
- Failed `simulateTransaction` responses do not return post-account images from this RPC provider. Failure logs identify the aborting instruction; Solana transaction atomicity and the absence of any submission mean no mainnet state was written.
- The historical `$259.11M` aggregate could not be independently reconstructed from retained per-vault pricing rows and is not promoted as current custody.
- This report makes no statement about changes after the stated observation slots or after the executable hash changes.

## Evidence artifacts

Primary evidence is retained under:

`/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation`

Key files:

- `orca-current-revalidation.json`: executable/PDA/custody binding and authority/alias/atomicity controls
- `orca-klend-v1-extremes.json`: exact-rate flash boundaries, one-sided liquidity composition, ordering, and v1 repetition limits
- `orca-swap-v1-extremes.json`: dust, threshold, tick crossing, reverse swaps, repetition, and residual reconciliation
- `klend-thin-wsol-v1.json`: exact boundary for the thinnest current zero-rate WSOL reserve
- `whirlpool-current.so`: current extracted executable bytes
- `harnesses/`: the read-only simulation scripts and v1 encoder
- `official-source-cc683ec92acb5e7606caa3d8e514d9383e9c7c11/`: retained official source and IDL snapshot

All four harness outputs declare `simulateTransactionOnly=true`, `submitted=false`, and `sigVerify=false`; the harnesses contain no send path.
