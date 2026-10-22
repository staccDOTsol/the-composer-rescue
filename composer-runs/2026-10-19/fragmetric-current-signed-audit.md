# Fragmetric core: current signed value-path audit

Date: 2026-10-19  
Network: Solana mainnet-beta  
Program: `fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3`  
Fund: `3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb`  
Normalized pool: `AkbZvKxUAxMKz92FF7g5k2YLCJftg8SnYEPWdmZTt3mp`  
JSOL reserve: `5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa`

## Result

No outsider-profitable or protocol-loss path survived the bounded current-state tests. This is a negative result, not a universal safety proof.

The highest-value historical route was a real `OperatorRunFundCommand` transfer of 24.059559458 JSOL from the normalized-pool reserve to the fund's JSOL reserve. Replaying its exact 26-account instruction on current state with a fresh outsider signer succeeds only as a no-op. Destination substitution and source/destination role swapping also succeed only as no-ops, with zero watched custody deltas. A well-formed forced-reset mutation is rejected by `FundOperationUnauthorizedCommandError` (6064).

A live successful `UserWithdrawSol` receipt was then mutated with the same outsider signer. The owner-substitution cases reach the withdrawal handler and are rejected by `ConstraintTokenOwner` (2015); an account-role swap is rejected by `AccountDiscriminatorMismatch` (3002). No transaction was broadcast.

The conditional flash stage was not entered: no value-moving outsider primitive survived, so wrapping a nonexistent route with two or three flash sources would not test the requested exploit hypothesis. No synthetic repayment buffer was used.

## Composer-first and exact deployment attestation

Composer returned the published IDL with HTTP 200: 66 instructions, 7 account types, canonical JSON SHA-256 `3e01c6819602ce02b65f78c16a8eb6ad70456d8e909bf4a339cbe54883993dd2`. It exposes the relevant command, deposit, withdrawal, normalized-pool, and slasher-ticket handlers. The supplementary Composer `/learn` request timed out; that limitation did not replace or alter the successfully retrieved IDL.

At finalized slot 458,764,500, the upgradeable program pointed to ProgramData `BUoMp38gkcjxguwowhhH5sxi5u7Abpi3wSZKkTkCGEFi`, deploy slot 391,854,457. The exact 3,347,120-byte ELF SHA-256 was `4bbf80bed4f322d818ed6c948467c5ef89bfa649e5549a34659f3cde018afef3`.

Composer decoded historical receipt `4P9C1bfRHu9SZnjCs853cRC3HRTkV8w8CFNaDezicAvMaN7AcRCmnMAqmsTa2o11HQ9KDLjgDGRYLwNohsRFGuXv` at slot 457,130,830 as `operator_run_fund_command`, selector `49741b177699c40e`, exact data `49741b177699c40e00`, 26 accounts.

Evidence: `fragmetric-composer-current.json`, `fragmetric-composer-idl.json`, and `fragmetric-composer-learn.json`.

## Receipt discovery and signed mutations

The receipt scan covered the latest 1,000 finalized successful program signatures. It decoded 692 `operator_run_fund_command`, 51 `user_request_withdrawal`, 18 `user_withdraw_supported_token`, 19 `user_withdraw_sol`, and one cancellation. It found no slasher initialize/withdraw handler in that window.

All new transaction tests used fresh outsider `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth`, v0 transactions, current blockhashes, `sigVerify: true`, `replaceRecentBlockhash: false`, and simulation-only RPC. The harness contains no send/broadcast path and persisted no new private key material.

| Test | Result | CU | Envelope | Value result |
|---|---:|---:|---:|---:|
| Exact operator receipt data/accounts; outsider replaces operator | success/no-op | 21,770 | 1,022 bytes / 27 keys | reserve, destination, fund, and pool deltas all 0 |
| Operator receipt; destination replaced by outsider JSOL ATA | success/no-op | 35,411 | 1,064 bytes / 28 keys | all watched custody deltas 0 |
| Operator receipt; source/destination roles swapped | success/no-op | 21,770 | 1,022 bytes / 27 keys | all watched custody deltas 0 |
| Operator forced reset `Initialize(New)` | rejected: 6064 unauthorized command | 14,108 | 1,028 bytes / 27 keys | atomic rejection |
| Live withdrawal batch 181/request 49,829; outsider replaces claimant | rejected: 2015 token owner | 12,304 | 1,062 bytes / 28 keys | atomic rejection |
| Same withdrawal; request id + 1 | rejected: 2015 token owner | 12,304 | 1,062 bytes / 28 keys | atomic rejection |
| Same withdrawal; batch/user-fund role swap | rejected: 3002 discriminator mismatch | 10,952 | 1,062 bytes / 28 keys | atomic rejection |

The live withdrawal source was receipt `5D3zsE9CjKZsN1CMuK5EG7Sg1G8es9hyrMhZQgFKRtBZMLCevrmki2mFx9S5ijpwWr4M9TBuCSdAaPuiK8wKdYVT` at slot 458,605,060. Its receipt-token account, batch, user-fund, and user-reward accounts were all still live, so the owner error is meaningful rather than an artifact of a closed historical account.

Evidence: `fragmetric-receipt-scan.json`, `fragmetric-live-withdraw-candidate.json`, `fragmetric-signed-receipt-mutations.json`, and `fragmetric-signed-user-withdraw-mutations.json`.

## Asset, liability, and equity accounting

Finalized accounting snapshot at slot 458,765,325:

- JSOL reserve balance and program-recorded locked amount both equal 36,599,900.537176 JSOL. Withdrawal-reserved amount is zero.
- JSOL value is 1.381729172 SOL/JSOL from both the program record and the current SPL stake-pool floor calculation.
- At that recorded rate, pool backing is 50,571.150264514 SOL-equivalent.
- nSOL on-mint supply and program-recorded supply both equal 44,437,726.106118 nSOL. At 1.138022907 SOL/nSOL, recorded liability is 50,571.150243754 SOL-equivalent.
- Recorded target-pool backing minus liability is +20,760 lamports. This is a rounding-scale surplus, not an exploitable withdrawal balance.
- fragSOL on-mint supply and program-recorded supply both equal 42,509,096.684387 fragSOL. At 1.142549310 SOL/fragSOL, recorded fund receipt liability is 48,568.739085469 SOL-equivalent. This audit does not claim whole-fund solvency because it did not independently value every fund position.
- Fund withdrawals are enabled, but direct JSOL withdrawal is disabled, JSOL pending request count is zero, withdrawal batch interval is 72,000 seconds, and withdrawal fee is 20 bps.
- The target pool's finalized slasher-ticket census found zero live tickets and zero normalized-token amount. Combined with zero reserved JSOL, there is no current slasher entitlement to redirect.

For the historical operator receipt, the pool reserve lost 24.059559458 JSOL and the instruction transferred that exact amount to the fund JSOL reserve. At the current observed JSOL rate this is 33.243795168 SOL-equivalent, but it was an internal pool-to-fund asset movement, not outsider gain. The successful current outsider mutations produced 0 asset change, 0 liability change, 0 protocol-equity change, and 0 attacker gain. Rejected simulations commit no state. Because nothing was broadcast, attacker fees paid were also 0.

For the historical live withdrawal receipt, the fund reserve fell 1.105363652 SOL and the original claimant's net lamport balance rose 1.105355605 SOL; it is evidence of the real payout path, not evidence of outsider access. All outsider variants were atomically rejected.

Evidence: `fragmetric-residual-readonly-gate.json` and `fragmetric-slasher-ticket-census.json`.

## Cross-program and queue conclusions

- The historical Token Program transfer used normalized pool `AkbZ…` as authority even though that PDA was not a transaction signer, consistent with Fragmetric-authorized PDA signing inside the invocation.
- On current state, permissionless command execution cannot invent a command: exact replay, destination substitution, and role swapping were all no-ops.
- Attempting to introduce a forced command crosses the explicit runtime authorization gate and fails with 6064.
- A live withdrawal cannot be claimed with another wallet's receipt-token account because the Token-2022 owner constraint fails before payout.
- Swapping typed queue/user state is rejected by the account discriminator constraint.
- Mint supplies equal their corresponding program-recorded supplies, and pool locked assets reconcile to nSOL liabilities at the same current JSOL rate. No share-supply mismatch was observed.

## Limitations and stop condition

- Mainnet simulation evaluates the historical instruction against current accounts. The old active command has completed, so the exact current-state replay is necessarily a no-op. Reproducing the transient historical active-command state would require an archival fork at slot 457,130,830; none was available in this run. The report does not pretend that current-state no-op behavior is a historical-state replay.
- Composer's supplementary learned-schema endpoint timed out. The full published IDL succeeded and the exact deployed ELF was independently attested.
- The latest-1,000 receipt window and zero-current-ticket census do not prove that no slasher ticket has ever existed; they establish that no live target-pool ticket was available for a present-value mutation.
- The fund-level liability number is reported without asserting complete fund equity because all external positions were not repriced. The target normalized pool itself was reconciled asset-for-liability.

The authorized stop condition was reached with a bounded negative: no outsider value path survived signed mutation, therefore no two- or three-source flash-loan transaction was constructed.
