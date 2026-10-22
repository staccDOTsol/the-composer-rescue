# Jupiter Perps current-binary deep audit

**Observed:** October 15, 2026. **Program:** `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`.

## Result

No novel immediate fund-loss path was validated. The verified gross PDA-controlled balance remains **$751,371,312.94** at the 17:23 UTC custody snapshot; the validated exploitable amount is **$0**. Gross custody is not exploitable value.

This continuation added successful current-binary controls for `removeLiquidity2`, `withdrawFees2`, `redeemStake`, `unstake`, a cross-instruction remove-liquidity/collateral-withdraw sequence, and real Solana v1 KLend-flash-funded Perps compositions. It then tested owner substitution, receiver redirection, valid-account aliasing, oracle substitution, dust and near-liquidity boundaries, repeated instructions, and failure atomicity. The live binary rejected the unauthorized or mismatched variants before unauthorized movement. No prototype or source-only behavior is presented as the requested deployed-program result.

## Current deployment and controlled value

`solana program show` was rerun against current mainnet during this continuation:

- ProgramData: `C258LjtN8Q928yz2nJe5kwQycckGfWBSrhZBP2mTpLQt`
- Upgrade authority: `5myNNmEmPm3UAnJ2ggLEpnTFb9t9Gk8369wKw6n3uAKx`
- Last deployed slot: `413092478`
- Data length: `10,485,715` bytes
- Binary SHA-256 tied to that unchanged deployment: `a2891a9277f865eb96feaae67e03cd88efc128d43f6093cc70618ad63cb7d9ba`

The custody snapshot independently verified six Token-program vaults and 33 native Stake accounts under transfer-authority PDA `AVzP2GeRmqGphJsMxWoqjpUifPpCret7LqWhD8NWQK49`:

| Controlled asset group | Gross value |
|---|---:|
| Six token vaults | $378,590,378.04 |
| 33 Stake accounts (`3,511,509.562762933 SOL`) | $372,780,934.90 |
| **Combined gross** | **$751,371,312.94** |
| **Validated exploitable amount** | **$0** |

The March 2026 community IDL remains an interface aid, not a source-to-binary match. The current binary requires a 12-account AUM/oracle tail omitted from that IDL. Successful landed transactions supplied the exact current ordering: six pool custody accounts followed by six Doves aggregate price accounts. All conclusions below come from the deployed binary, not from assuming the IDL expresses every constraint.

## Test model and signature caveat

Every mutation was executed with mainnet `simulateTransaction`; no transaction was submitted. `sigVerify:false` was used only to reach authorization branches with public account keys taken from current state or successful transactions.

Accordingly, a successful keeper, operator, or owner control proves branch behavior and state transitions only. It does **not** prove that an outsider can create that signature, and no PDA or privileged-address phantom signature is treated as an exploit.

## `removeLiquidity2`: successful control and mutations

The successful control burned `1,000,000` raw JLP (1 JLP) from the legitimate holder and returned `4,565,440` raw USDC:

| State item | Before | Simulated after | Delta |
|---|---:|---:|---:|
| Holder JLP | `71,912,363,636,013` | `71,912,362,636,013` | `-1,000,000` |
| JLP mint supply | `191,812,392,808,486` | `191,812,391,808,486` | `-1,000,000` |
| Holder USDC | `33,638,384,840,117` | `33,638,389,405,557` | `+4,565,440` |
| USDC custody vault | `100,566,779,547,910` | `100,566,774,982,470` | `-4,565,440` |

The important adversarial variants were:

| Variant | Current-binary observation |
|---|---|
| Attacker signer and destination with another holder's JLP account | Rejected on `lp_token_account` with `ConstraintHasOne` (2001); stored token owner `B9sps…` did not equal signer `7s1da…`. |
| Legitimate holder with receiver owned by another address | Rejected on `receiving_account` with `ConstraintHasOne` (2001). |
| Selected-custody oracle replaced by another valid pool oracle | Rejected with `InvalidOracleAccount` (6002), including the expected and supplied keys. |
| USDC oracle slot in the 12-account AUM tail aliased to the WBTC oracle | Rejected with `InvalidOracleAccount` (6002). |
| `u64::MAX` JLP input | Rejected with `MathOverflow` (6000); no account poststate was returned. |

Two identical 1-JLP removals in one transaction both succeeded and each logged the same state-derived `4,565,440` raw-USDC output. A valid removal followed by the overflowing removal failed at the second instruction and returned no account poststate, consistent with whole-transaction rollback. The path therefore consumed updated state and did not expose a stale-supply/AUM replay.

Evidence: [`perps-remove-liquidity-deep-simulation.json`](./perps-remove-liquidity-deep-simulation.json), reproducer [`test-perps-remove-liquidity.js`](./test-perps-remove-liquidity.js).

## Fee withdrawal: successful control, receiver binding, and repeat behavior

A fresh successful landed `withdrawFees2` at slot `457342132` identified current keeper `DFZcDnmEYNUK1khquZzx5dQYiEyjJ3N5STqaDVLZ88ZU`, the five custody-specific receivers, and the omitted AUM tail. A direct USDC control against the current binary then succeeded:

- Custody `feesReserves` began at `426,698,409` raw USDC and ended at zero.
- The hardcoded-owner receiver gained `160,133,414` raw USDC and the custody vault decreased by the same amount.
- Logs recorded `Total token fees: 426698409`; the smaller receiver transfer is the observed protocol-share movement, not a claim that the entire reserve was externally transferred.

Mutations produced:

| Variant | Observation |
|---|---|
| Unrelated signer, correct receiver | `InvalidKeeper` (6034) at `withdraw_fees2.rs:88`. |
| Correct keeper, attacker-owned receiver | `ConstraintTokenOwner` (2015). |
| Correct keeper, wrong valid pool oracle | `InvalidOracleAccount` (6002). |
| Two fee withdrawals atomically | First logged `426698409`; second logged `0`; both succeeded without a second payout. |
| Correct withdrawal followed by outsider withdrawal | Second instruction failed `InvalidKeeper`; the transaction returned no poststate. |

This closes the simple replay, redirect, and oracle-alias hypotheses for the tested fee path.

Evidence: [`perps-fee-control-search.json`](./perps-fee-control-search.json), landed transaction [`perps-fee-control-4ucKCBSqgC2tnCqrjAwm4hJ6Y4bBxznB8X3VH34iSMgr4bh1E2v85QNPe8kw41b1MgfPZDbVwt636FAi2uUjTPkh.json`](./perps-fee-control-4ucKCBSqgC2tnCqrjAwm4hJ6Y4bBxznB8X3VH34iSMgr4bh1E2v85QNPe8kw41b1MgfPZDbVwt636FAi2uUjTPkh.json), [`perps-fee-withdrawal-deep-simulation.json`](./perps-fee-withdrawal-deep-simulation.json), reproducer [`test-perps-fee-withdrawal.js`](./test-perps-fee-withdrawal.js).

## Stake rewards, deactivation, and withdrawal

The same live keeper appeared in a successful `redeemStake` transaction. Direct current-state controls reached these branches:

- `redeemStake` succeeded and recorded `14,795,271,094` lamports of new rewards on StakeInfo `SvqK7…`. The record moved from `106,358,365,379,095` to `106,373,160,650,189` current lamports and from `6,358,361,056,935` to `6,373,156,328,029` total reward lamports.
- A second `redeemStake` in the same transaction recorded no additional reward and left both totals unchanged. This rejects the tested same-transaction reward replay.
- The unrelated signer failed `InvalidKeeper` (6034).
- Substituting a different real Stake account or a different valid StakeInfo failed `ConstraintHasOne` (2001).
- `unstake` with the configured operator reached the native Stake CPI `Deactivate`, succeeded, and set `deactivating = true` in simulated StakeInfo state.
- An unrelated operator failed `ConstraintAddress` (2012); a different Stake account failed `ConstraintHasOne` (2001).
- `withdrawStake` with the correct keeper against the still-active Stake account reached the native Stake CPI and failed `InsufficientFunds`; an outsider stopped earlier at `InvalidKeeper`.
- `unstake` followed immediately by `withdrawStake` in one transaction also failed at the Stake withdrawal, so deactivation did not bypass the native epoch/withdrawability condition atomically.

The successful operator and keeper controls are privileged simulations only. They do not establish that those signatures can be forged.

Evidence: [`perps-stake-control-search.json`](./perps-stake-control-search.json), landed transaction [`perps-stake-control-31AMVLKmBC5qnQZR7GpgCgCABaCasgX4uRrbCiDYUQhJYKTbbYRhse7BRUWbc6MDcXq5hzKRi69uVK7R4GL9BtHC.json`](./perps-stake-control-31AMVLKmBC5qnQZR7GpgCgCABaCasgX4uRrbCiDYUQhJYKTbbYRhse7BRUWbc6MDcXq5hzKRi69uVK7R4GL9BtHC.json), [`perps-stake-exits-deep-simulation.json`](./perps-stake-exits-deep-simulation.json), reproducer [`test-perps-stake-exits.js`](./test-perps-stake-exits.js).

## Borrow liquidation and account aliases

The currently active borrow position `B2sxy…` remained healthy. With the live keeper and the recovered AUM tail, both `liquidateBorrowPosition` and `partialLiquidateBorrowPosition` advanced through all price reads and rejected with `CannotLiquidate` (6063), logging `Left: 4979` and `Right: 9500`. This is a positive authorization/oracle control but not a successful liquidation control.

Security-relevant mutations were rejected earlier:

| Variant | Observation |
|---|---|
| Unrelated signer | `InvalidKeeper` (6034) on both full and partial borrow liquidation. |
| Attacker-owned JLP account substituted for the collateral vault | `ConstraintSeeds` (2006), with expected vault `2XYP…`. |
| Different valid custody with the same borrow position | `ConstraintRaw` (2003) on `borrow_position`. |
| Custody account aliased as `borrow_position` | `AccountDiscriminatorMismatch` (3002). |

A bounded scan of the 40,000 most recent JLP-mint-touching successful transactions down to slot `457261468` found no `LiquidateBorrowPosition`, `PartialLiquidateBorrowPosition`, or `LiquidateFullPosition4` control to replay. This bounds the result; it does not prove that no historical liquidation exists. A non-borrow `liquidateFullPosition4` need not touch JLP and is an explicit coverage gap.

Evidence: [`perps-liquidation-search.json`](./perps-liquidation-search.json), [`perps-borrow-liquidation-deep-simulation.json`](./perps-borrow-liquidation-deep-simulation.json), reproducer [`test-perps-borrow-liquidations.js`](./test-perps-borrow-liquidations.js).

## Cross-instruction oracle and margin interaction

The active borrow position held `852,059,656` raw JLP collateral at the observation state:

| Atomic sequence | Observation |
|---|---|
| Withdraw `300,000,000` raw JLP collateral | Succeeded. |
| Withdraw `400,000,000` raw JLP collateral | Rejected with `WithdrawExceedsMarginLimits` (6062). |
| Remove 1 JLP liquidity, then withdraw `300,000,000` collateral | Both instructions succeeded. |
| Withdraw `300,000,000` collateral, then remove 1 JLP liquidity | Both instructions succeeded. |
| Remove 1 JLP liquidity, then withdraw `400,000,000` collateral | Removal logged a valid output; the second instruction still failed 6062, and the transaction returned no poststate. |

The remove-liquidity AUM/supply update did not relax the tested margin boundary in either ordering, and a later margin failure reverted the preceding liquidity exit atomically. The two owners were phantom-signed only to exercise their legitimate paths, so this is accounting evidence rather than an attacker transaction.

Evidence: [`perps-cross-instruction-deep-simulation.json`](./perps-cross-instruction-deep-simulation.json), reproducer [`test-perps-cross-instruction.js`](./test-perps-cross-instruction.js).

## Atomic v1 zero-fee KLend flash funding into Perps

A real Solana transaction-v1 encoder was used with the current v1 limits requested for this test: no address lookup tables, at most 4,096 wire bytes, 64 inline addresses, and 64 instructions. All transactions were simulated on current mainnet with `sigVerify:false`; none was signed or submitted.

The selected KLend reserve was a same-mint USDC source:

- KLend program: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`
- Reserve: `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`
- Liquidity supply: `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`
- Flash fee vault: `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`
- Current liquidity-supply balance: `7,820,864,800,722` raw USDC
- Current reserve-accounted available liquidity: `7,820,864,730,717` raw USDC
- Current decoded `flashLoanFeeSf`: **exactly `0`**

This is a verified zero fee rate, not a small nonzero fee rounded down. A 1-raw-USDC flash pair and a `7,820,864,730,717`-raw-USDC pair both succeeded, restored the flash supply to `7,820,864,800,722`, and left the flash fee vault at zero. `available + 1` failed `InsufficientLiquidity` (6008). KLend creates no persistent flash-loan obligation account; successful execution of the indexed repay plus restored reserve/supply balances is the repayment control.

The positive cross-program control used on-curve owner `HnSDB6…`, with live USDC and JLP accounts, so the transaction had a genuine fee cushion. The owner signature remains phantom under `sigVerify:false`; this demonstrates runtime feasibility, not possession of that wallet's key.

| Atomic v1 sequence | Bytes / accounts / instructions | CU | Result and pre/post accounting |
|---|---:|---:|---|
| Borrow exact accounted available, add `400,000,000,000` raw USDC ($400,000) to Perps, repay full loan | `1,226 / 31 / 3` | `179,571` | Succeeded. Perps vault `+400,000,000,000`; owner JLP `+87,014,692,537`; KLend supply restored exactly; fee vault remained `0`. |
| Borrow 100 USDC, add to Perps, burn the exact `21,782,058` raw JLP minted, repay | `1,280 / 31 / 4` | `296,253` | Succeeded. Remove returned `99,581,606` raw USDC; owner lost `418,394` raw USDC, Perps vault gained the same, and owner JLP/JLP supply returned exactly to prestate. No gain. |
| One flash loan with two 1-USDC add/remove cycles, then repay | `1,389 / 31 / 6` | `530,018` | Succeeded; KLend restored, JLP unchanged, expected aggregate Perps fee loss only. |
| One flash loan with four 1-USDC add/remove cycles, then repay | `1,607 / 31 / 10` | `997,472` | Succeeded; owner lost `16,740` raw USDC, Perps vault gained `16,740`, JLP and KLend balances restored. |
| Eight cycles | `2,043 / 31 / 18` | `1,400,000` | Hit the configured compute ceiling at instruction 12; no poststate, hence atomic rollback. |
| Sixteen cycles | `2,915 / 31 / 34` | `106,355` before abort | KLend borrow aborted with an SBF memory-allocation failure; no poststate. |
| Thirty-one cycles | would be `4,550` bytes | — | Rejected locally because it exceeds the required 4,096-byte v1 maximum. |

The 100-USDC round trip is larger than the legacy 1,232-byte packet (`1,280` bytes) and therefore materially exercises v1 rather than merely relabeling a legacy-sized transaction. The successful four-cycle case further demonstrates repeated Perps legs consuming updated state inside one flash envelope.

### Dust, aliases, and exact blockers

The smallest flash borrow itself was 1 raw USDC and repaid successfully. When that single raw unit was routed into `addLiquidity2`, Perps rejected it with `InsufficientTokenAmount` (6019). Inputs of 2–5 raw USDC succeeded with `minLpAmountOut = 0` but rounded the minted amount to zero, donating only the caller's 2–5 raw units to the custody vault. Six raw USDC was the first tested amount to mint 1 raw JLP. This is not a drain: the caller loses the dust, existing LPs gain it, and a caller can reject it by setting a nonzero minimum output.

Cross-program account substitutions also failed safely:

| Mutation | Observation |
|---|---|
| Flash destination and repayment source both aliased to the Perps USDC vault | Borrow transfer could enter the vault, but repayment failed SPL Token `owner does not match` (custom 4); the failed transaction returned no poststate. |
| Perps funding account aliased to its custody vault | `ConstraintHasOne` (2001): vault owner was the transfer-authority PDA, not the simulated user. |
| Perps JLP destination aliased to another holder's valid JLP account | `ConstraintHasOne` (2001) on `lp_token_account`. |

Project0/marginfi was also evaluated as the preferred fee-free source. Its replayed reserve was WSOL (`2eicb…`, mint `So111…`), but borrower `3zdXw…` had no live WSOL or JLP token account/balance and its derived destination `8BNDY…` did not exist outside the simulated create-ATA path. A Perps add/remove round trip necessarily incurs Perps fees, so that exact historical borrower could not repay after routing all borrowed WSOL through Perps without importing an unrelated funded signer. KLend avoided that concrete asset/account blocker with a same-mint USDC reserve and an on-curve owner holding both USDC and JLP.

Evidence: [`klend-perps-v1-stress.json`](./klend-perps-v1-stress.json), reproducer [`klend-perps-v1-stress.js`](./klend-perps-v1-stress.js). Independent v1 lender controls: [`klend-jupiter-v1-extremes.json`](./klend-jupiter-v1-extremes.json), [`project0-v1-composition.json`](./project0-v1-composition.json).

## Coverage limits and remaining risk

This is materially deeper current-binary coverage, but it is still not a complete source audit:

- No exact public source-to-current-binary mapping was established. The community IDL omits at least `depositExternalReward` and the AUM remaining-account tails.
- No currently liquidatable borrow position or successful full-position liquidation was found, so liquidation payout arithmetic and terminal state transitions lack a successful replay.
- `swap2`, position increase/decrease/request execution, `createAndDelegateStakeAccount`, CPI callers, Token-2022 permutations, and every arithmetic boundary remain incomplete.
- The 40,000-transaction liquidation search is bounded to JLP-touching history; it is not an exhaustive program-history index.
- Mainnet RPC simulations are point-in-time observations. Concurrent live activity can change balances between separate calls, so conclusions rely on within-simulation deltas and logs, not cross-call balance differences.
- Privileged positive controls use `sigVerify:false`; no positive result is evidence that an off-curve PDA, keeper, operator, or unrelated wallet can sign in a real transaction.
- The flash-funded controls cover USDC `addLiquidity2`/`removeLiquidity2`, dust, repetition, capacity, and aliases. They do not exhaustively compose flash liquidity through `swap2`, position instructions, every other custody mint, or every third-party lender reserve.

Within the tested highest-risk exits, repeated calls consumed updated state, later failures rolled back earlier movement, recipient and source ownership were bound, custody and oracle substitutions were rejected, and outsider signer substitutions stopped before transfer. Therefore no immediate novel fund-risk finding is supportable from this evidence.
