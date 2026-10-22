# Marinade Liquid current-binary gap audit

Date: 2026-10-15  
Deployment: `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`  
Method: offline binary/source review plus unsigned, read-only current-mainnet `simulateTransaction`; no transaction was sent.

## Result

One **Medium** economic vulnerability was validated: an unprivileged user can atomically add temporary SOL liquidity, receive LP shares, liquid-unstake mSOL at a fee computed from the transiently inflated SOL leg, and immediately redeem the new LP shares. A real Solana v1 transaction funded by a currently configured zero-fee Kamino wSOL flash loan completed the sequence, fully repaid the lender, and retained **7.301913110 SOL more than an economically normalized direct liquid-unstake control** across two legs.

This is not evidence that all Marinade custody is drainable. The prior sampled **2,873,282.234792613 SOL (about $302.61M at that report's price)** is gross PDA/native-stake custody, not the exploitable amount. The observed exploitable differential is 7.301913110 SOL in the two-leg test. Total repeatable capacity was not measured.

## Finding: transient liquidity suppresses the dynamic liquid-unstake fee

Severity: **Medium**  
Class: transient-balance / economic fee manipulation; CWE-682

`add_liquidity` prices and mints immediately redeemable LP shares, then transfers the caller's SOL into the pool (`add_liquidity.rs:101-149`). `liquid_unstake` calculates its fee from the pool's live SOL balance after the proposed withdrawal (`liquid_unstake.rs:75-96`). It does not distinguish durable liquidity from SOL added earlier in the same transaction. `remove_liquidity` permits immediate proportional redemption of the newly minted LP shares (`remove_liquidity.rs:78-164`).

Attack sequence:

1. Borrow wSOL and close the token account to unwrap it to native SOL.
2. Add the temporary SOL to Marinade and receive LP shares.
3. Liquid-unstake mSOL; the inflated SOL leg pushes the dynamic fee to its 0.03% minimum in the tested configuration.
4. Burn the newly minted LP shares and recover a proportional mixture of SOL and mSOL.
5. Rewrap the exact principal and repay the flash loan.

The direct control liquid-unstaked exactly the attack's **net** mSOL reduction, not its larger gross sale, so mSOL returned during LP redemption was not misclassified as profit.

### Real Solana v1 proof

Kamino reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` was decoded from current state as wSOL with `flashLoanFeeSf = 0`; this is an exact configured zero rate, not a rounded fee. Available liquidity was 6,583.112759818 wSOL.

| Case | v1 bytes | Inline accounts | Instructions | CU | Result |
|---|---:|---:|---:|---:|---|
| Borrow/unwrap/rewrap/repay 1 lamport | 657 | 13 | 8 | 80,878 | success |
| Borrow/unwrap/rewrap/repay 0.000001 SOL | 657 | 13 | 8 | 80,880 | success |
| Borrow/unwrap/rewrap/repay exact 6,583.112759818 SOL available | 657 | 13 | 8 | 80,878 | success |
| Borrow available + 1 lamport | 657 | 13 | 8 | 42,839 | expected `InsufficientLiquidity` (6008) |
| 3,000 SOL add + 1,000 mSOL sale + remove + repay | 1,118 | 24 | 13 | 208,879 | success; +2.988050243 SOL vs normalized direct control |
| Two repeated 3,000 SOL / 1,000 mSOL legs + repay | 1,208 | 24 | 16 | 320,792 | success; +7.301913110 SOL vs normalized direct control |

The two-leg pre/post accounting was:

| Balance | Pre | Attack post | Direct-control post |
|---|---:|---:|---:|
| User native SOL, lamports | 83,970,407,035,689 | 85,944,164,375,794 | 85,936,862,462,684 |
| User mSOL, raw | 12,937,617,076,654 | 11,754,376,356,128 | 11,754,376,356,128 |
| Marinade SOL leg, lamports | 6,905,166,115,629 | 5,234,855,125,359 | 5,242,157,038,469 |
| Marinade mSOL leg, raw | 10,136,661 | 1,182,950,857,187 | 1,180,411,079,458 |
| Marinade treasury mSOL, raw | 419,399,827,779 | 419,699,827,779 | 422,239,605,508 |
| Kamino wSOL supply vault, raw | 6,583,112,759,818 | 6,583,112,759,818 | 6,583,112,759,818 |
| Kamino fee vault, raw | 0 | 0 | 0 |

The attack spent 1,183.240720526 net mSOL and received 1,973.757340105 SOL after loan repayment. The direct control spent the same net mSOL and received 1,966.455426995 SOL. Each attack leg logged a 0.3 mSOL fee and 0.15 mSOL treasury cut; the direct control logged a 5.679555458 mSOL fee and 2.839777729 mSOL treasury cut.

The Kamino reserve account bytes changed because normal interest and last-update fields advanced during simulation. Attack and direct controls at the same slot produced the same reserve accounting changes. `totalAvailableAmount`, supply-vault tokens, fee-vault tokens, and pending/referrer fee fields returned to their pre-borrow values, proving no flash debt remained.

Independent flash-pair mutations also failed closed: missing repay (`NoFlashRepayFound` 6032), repay-before-borrow, wrong borrow index, amount-minus-one, changed destination or fee vault (`InvalidFlashRepay` 6033), duplicate borrow/repay (`MultipleFlashBorrows` 6035), supply-vault destination alias (`InvalidAccountInput` 6006), and transfer-away followed by unfunded repayment. The composed proof used one enclosing borrow/repay pair and recomputed the actual top-level borrow index after inserting the Marinade legs.

### Remediation

Do not calculate an economic fee from a spot balance that the same transaction can inflate and reverse. Base the fee on a manipulation-resistant prior-slot/epoch liquidity observation, or explicitly exclude liquidity added in the current slot from the fee base. Add regression tests that compose add-liquidity, liquid-unstake, and remove-liquidity in one transaction and require the result to be no better than a direct sale at the same net mSOL reduction. Test multiple legs and both self-funded and flash-funded paths.

## Other gap results

- **Cranks and record binding:** current successful controls were observed for `update_active`, `update_deactivated`, `stake_reserve`, canonical creation, and merge. Update account substitution and wrong stake/validator indices failed with ownership/index errors. Repeating a current `update_active` after the stake was current produced zero reward and no double count.
- **Deposits:** 211 recent successful `deposit` and 15 `deposit_stake_account` executions exercised the current binary. A 1,000 SOL positive deposit minted 708.090641981 mSOL. Both deposit-before-update and update-before-deposit round trips were identical on current state because the selected canonical stake had no unrecognized reward; each lost 3.5 SOL to the configured immediate-exit fee. No current profitable stale-reward capture was shown.
- **Stake deposits:** source and current-binary strings bind the acquired stake account's ownership, authorities, delegation, vote record, balance, and list entry. The program acquires both stake authorities before minting proportional mSOL. No under-collateralized mint was found.
- **Merges/canonical staking:** five recent merge successes and one canonical-creation success provided current controls. Source/index/vote/canonical PDA checks fail closed; returned rent is bound to the operational account. No caller value sink was found in duplicate/alias hypotheses.
- **Tickets:** two recent order successes and one claim success provided current controls. Order records `created_epoch = current` unless stake-delta already ran, then `current + 1`; claim requires at least the next epoch and, in the first eligible epoch, 1,800 seconds after epoch start. A same-transaction order/claim cannot satisfy the epoch gate. Current source differs from `Docs/Backend-Design.md`, which still describes two epochs plus four hours.
- **Rounding/fees:** ordinary deposit/withdraw, LP mint/burn, and ticket conversions round against the caller. Tiny fee floors avoid less than one raw unit per operation and did not yield a profitable cycle. LP/mSOL token-account aliasing was rejected by mint constraints.
- **Stale slash/reward ordering:** source supports conditional timing hypotheses, but current rewarded-stake controls did not produce positive completed-exit gain. They are not reported as vulnerabilities without that proof.
- **Permissionless liveness:** `stake_reserve` can consume an extra-run counter before a later no-work return. This can affect keeper liveness but has no caller value sink, so it is informational and not a custody finding.

## Binary/source correspondence

At fresh observation slot 457,351,359, the audited binary was 2,009,338 bytes with SHA-256 `296fd550ce78a556ba05dbaff8f8fd6c04fa538bc99f9a0a836e5e430645a3ac`. The live Program account pointed to ProgramData `4PQH9YmfuKrVyZaibkLYpJZPv2FPaybhq2GAuBcWMSBf`, deploy slot 433,290,841, with upgrade authority `551FBXSXdhcRDDkdcb3ThDRg84Mwe5Zs6YjJ1EEoyzBp`. The prior report's different ProgramData string, `4PQH9z11H2tHffS6cLjKMVJSpqavwswQcETe48MEAMfy`, was not present at the fresh read; its other deployment fields and ELF digest were correct.

Official `mainnet` commit `47a002ee941db20ee3fa20d2b465076b665bd012` is source-identical for the program and manifests to tag v2.1.0 (`3e7c090`). The binary embeds the matching release metadata, program ID, source paths, account names, errors, seeds, and distinctive log strings. This is strong semantic source-to-current-binary correspondence, but not byte-for-byte reproducible-build proof: the source pins Anchor 0.27/Solana 1.14.29, while the installed toolchain is Anchor 1.0.2/Solana 3.1.10; the legacy `solana-install` verifier is absent and the installed Docker daemon is unavailable.

## Evidence

- `marinade-klend-wsol-v1.json`: full v1 messages, ordered accounts, wire hashes, logs, CU, and pre/post accounts.
- `marinade-klend-wsol-v1.js`: deterministic unsigned simulation harness.
- `marinade-v1-liquidity-fee.json`: non-flash normalized liquidity-fee matrix.
- `marinade-v1-stale-accounting.json`: current reward/update/deposit controls and account substitutions.
- `recent-instructions.json`: 1,000 current successful-transaction classifications and representative traces.

