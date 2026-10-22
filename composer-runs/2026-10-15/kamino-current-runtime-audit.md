# Kamino Lend current binary: mainnet atomicity replay

Observed 2026-10-15 18:48–18:53 UTC. Program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`. **Validated exploitable value: $0.** These are read-only `simulateTransaction` calls; no transaction was submitted. The sampled reserve vaults control value, but their balances are not an estimate of exploitable value.

## Deployment and method

- The deployed upgradeable programdata account is `9uSbGW1y9H5Av6H5TKxQ1wnFApSq2t3oEpfF2YfjDQGA`, last upgrade slot `440486775`. At review, the trimmed nonzero ELF payload SHA-256 was `b1344d1979daec34bea862a3ed5c44ca5dc8b8e72ec32f1a90ac5150229c22d9`, matching the locally saved deployed ELF. A prior exact-binary review mapped the deployment to Kamino `klend-v1.25` source revision `a08760976f51a3a58c4a0c6ea27b4a0e565bca79` in `outputs/kamino-lend-security-scan.md`.
- Successful landed mainnet transactions supplied real account shapes and positive controls. We replayed and mutated them against the live program using fresh state and `sigVerify: false`, `replaceRecentBlockhash: true`. That setting permits a third-party historical transaction to be simulated. It does not show that an attacker can produce another account owner's signature. The adversarial signer variants replaced the owner key with a distinct funded signer and still failed the program's ownership checks.
- Flash source transaction: `588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd` (slot `457338071`). Borrow source: `4YGu6QkK3XBm2E5dNc8E6Xx3j56uvErJVuTaYKPuF72mxLZvqfs1DXYDGPwJmo8Tk1FTVRBzc7yGVSjUrjm42iLe` (slot `457339517`). Withdrawal source: `5L5HMERwc3f9iT3BxkAK2KvErJ7cED45ENtb2bQ3D6w9x9vjBNyayZjgiweyNdV2yiqnnVkmphbW4ejMNvtesAmA` (slot `457339294`).
- FluxRPC account reads lagged the simulated bank on one run. Consequently, the accounting comparisons below use *successful simulation against successful simulation* with near-adjacent slots, not a stale pre-read. Each cited incremental balance change is exact and matches the instruction amount.

## Positive controls and rejected mutations

| Path | Current-binary result |
| --- | --- |
| Direct 100,000 raw USDC flash borrow and repay | Succeeds; net supply vault, user token, and fee vault changes are each zero. |
| Flash borrow without repay | Fails `NoFlashRepayFound` 6032. |
| Repay before borrow, wrong borrow index, amount one unit short, or different repay destination/fee vault | Fails `InvalidFlashRepay` 6033. |
| Duplicate flash borrow or duplicate flash repay | Fails `MultipleFlashBorrows` 6035. |
| Borrow destination aliases its reserve supply | Fails `InvalidAccountInput` 6006. |
| Transfer the flash liquidity away, then leave repay unfunded | Fails token `insufficient funds` during repay; no transaction can commit. |
| Existing 408,000,000 raw USDT `BorrowObligationLiquidityV2` | Succeeds and transfers the loan to the owner's token account. A distinct signer fails `InvalidObligationOwner` 6019; an unrelated destination fails `ConstraintTokenOwner` 2015. |
| Existing `WithdrawObligationCollateralAndRedeemReserveCollateralV2` | Succeeds, burning 43,230,552 cTokens and transferring roughly 50,000,070 raw WSOL at the later simulation slot. A distinct signer fails `ConstraintHasOne` 2001; unrelated destination fails `ConstraintTokenOwner` 2015. |

## Same-transaction refresh tests

`RefreshReserve` before, between, twice between, or after a matched flash-loan pair all succeed. The user token, reserve supply, and fee vault end with zero net change. The reserve's `total_available_amount` and scaled borrowed amount match the clean pair. An oracle price update and `last_update` fields can change as expected; this did not create unbacked liquidity. Evidence: `kamino-refresh-interleave.json` (slots `457343642–457343643`).

The second regular borrow or withdrawal can succeed when both reserve and obligation are refreshed between actions. This is a legitimate composition with cumulative accounting:

| Two calls in one transaction | Second call relative to single-call simulation | Binding observation |
| --- | ---: | --- |
| Borrow V2 | User destination **+408,000,000 raw USDT**; reserve vault **−408,000,000**; reserve `total_available_amount` **−408,000,000**; scaled borrowed amount **+408,000,000** | Obligation state changes. Reserve-only refresh fails `ObligationStale` 6017; obligation-only or no refresh fails `ReserveStale` 6009. |
| Withdraw and redeem V2 | User destination **+50,000,070 raw WSOL**; reserve vault and `total_available_amount` **−50,000,070**; user collateral account **−43,230,552 cTokens** | Obligation state changes. Reserve-only refresh fails `ObligationStale` 6017; obligation-only or no refresh fails `ReserveStale` 6009. |

The failed simulations return null account snapshots from RPC, so no failed-case balance delta is inferred from those fields. Solana transaction atomicity means a failed simulation's prior instructions cannot commit. The successful cases show that the second value transfer is paired with the expected collateral or debt change. No unauthorized withdrawal or unbacked borrow survived these tests.

## Evidence and reproduction

- Flash pairing and mutation: `kamino-flash-mutation.js`, `kamino-flash-mutation.json`.
- Obligation signer/destination/alias replay: `kamino-obligation-mutation.js`, `kamino-obligation-mutation.json`.
- Interleaved flash reserve refresh: `kamino-refresh-interleave.js`, `kamino-refresh-interleave.json`.
- Repeated regular borrow with refresh: `kamino-borrow-refresh-composition.js`, `kamino-borrow-refresh-composition.json` (slots `457344135–457344137`).
- Repeated withdraw and redeem with refresh: `kamino-withdraw-refresh-composition.js`, `kamino-withdraw-refresh-composition.json` (slots `457344342–457344344`).
- Historical sample restorers and source JSON: `kamino-restore-samples.js`, `kamino-flash-history.json`, `kamino-obligation-history.json`, `kamino-direct-refresh-samples.json`.

This coverage is limited to the sampled USDC flash reserve and USDT/WSOL obligation exits. It does not prove every Kamino reserve, token extension, oracle configuration, liquidation, or queued withdrawal safe. No currently exploitable fund-loss finding was validated here.
