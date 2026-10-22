# Smithii vesting `vesFcn...` current-program audit

**Program:** `vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K`  
**Network:** Solana mainnet  
**Audit date:** 2026-10-15  
**Method:** current-account RPC reads, current executable fetch, historical transaction reconstruction, local PDA derivation, and `simulateTransaction` only. No transaction was signed or submitted, and the project team was not contacted.

## Result

No reportable vulnerability or unauthorized GOHOME outflow was reproduced against the pinned executable. The reviewed Claim path binds the signer, Claim PDA, Vesting state, source vault, beneficiary token-account owner, and mint. Its amount is schedule-derived rather than caller-selected. Replays and mutated accounts failed closed, and a failed sibling instruction rolled back the atomic transaction.

The high gross marks are not realizable-loss estimates. The two sampled GOHOME vaults were marked at roughly **$698.76M** and **$36.88M**, but the contemporaneous token snapshot reported only about **$350,095 of spot liquidity**. The maximum unauthorized net gain demonstrated in this tranche is **0 GOHOME / $0**.

One important trust boundary remains: the program is upgradeable. These conclusions apply only to the exact executable pinned below; upgrade authority `CyTc1wUKbuDd8ba7bsJrFaqXbhnBPbCte8FxSs2p7KTC` can replace it.

## Current executable and interface

At observation slot `457347064`:

| Field | Value |
|---|---|
| ProgramData | `8AqtoCE2PmJWAokHWyKMq83NjDBK7G6gRr7AJpFrQeSi` |
| deployment slot | `318281477` |
| executable length | `344,544` bytes |
| executable SHA-256 | `f3c9838b9ea1cec46dbe54a4f2cfce6c8019f53d1ef31407a6997be224652985` |
| upgrade authority | `CyTc1wUKbuDd8ba7bsJrFaqXbhnBPbCte8FxSs2p7KTC` |

The stripped ELF identifies Smithii token vesting and retains Anchor paths for `init_vesting.rs` and `claim_vesting.rs`, PDA literals `smithii_vesting` and `smithii_claim`, and the `Init` and `Claim` instruction names. No on-chain Anchor IDL was present. No current admin/revoke/withdraw entrypoint was identified, so there was no lower-privilege admin method to exercise; the loader upgrade authority is the administrative control that remains outside Claim.

Reproduction: [`vesfcn-current.so`](vesfcn-current-audit-work/vesfcn-current.so), [`vesfcn-chain-evidence.json`](vesfcn-current-audit-work/vesfcn-chain-evidence.json), and [`collect-vesfcn-evidence.js`](vesfcn-current-audit-work/collect-vesfcn-evidence.js).

## Custody, PDA, and historical transfer reproduction

Both large GOHOME token accounts are canonical ATAs controlled by program-owned Vesting PDAs:

| Beneficiary/config identity | Vesting PDA derivation | Vault | Current sampled amount |
|---|---|---|---:|
| `ATzqChvNcqn92nM66HTSo33VBy9MmgPZCS57LwMAmzNL` | `findProgramAddress(["smithii_vesting", GOHOME mint, ATzq...], vesFcn...)` = `EL4CpiRgYZVmSs3SvAdJTAcnBogVUzrNDTyzWz2JNTk3`, bump 255 | `6hmV2nDeHQVxoa71C9HmvnYvg7zFck2s2YdGGSC3AYRM` | 9,000,000 GOHOME |
| `H771Wtz49Y9SE6Ghmn8JYYig4gqmceCcnSUHvzbm1EdM` | `findProgramAddress(["smithii_vesting", GOHOME mint, H771...], vesFcn...)` = `Ftk41smBgQ5tiFsDpBatfofHjYgpS4TcnzwDdw1CsaTC`, bump 255 | `C7J4nzXwVJpPRhSW43EUNomPci7tMjjzrGT93BYuMho` | 475,000 GOHOME |

The known successful Claim transaction is:

- signature `4Mu2FnrUCfkvbmVAwza1p1cGvgxQcy7Y2PgezY5xC7xLix2tbg95gDkm8VFdLL5dwKRoCWR5dqPmgvd9MxkKRmnn`;
- slot `337305045`, block time `1746177463`;
- 438-byte v0 transaction, raw SHA-256 `05bec589663a0071f6d70467027dbfa1e8161e365a756495683c52862e57d6c9`;
- 32,695 total CU, of which the vesting program consumed 32,395 CU;
- exact Claim bytes `3ec6d6c1d59f6cd200`: the Anchor `global:claim` discriminator plus the Borsh `None` marker for an absent Merkle proof. There is no caller-supplied amount;
- exact account order: beneficiary signer `H771...`, beneficiary ATA `ACNR...`, Vesting `Ftk41...`, Vesting ATA `C7J4...`, Claim `JW9g...`, GOHOME mint, SPL Token, ATA program, System program;
- inner SPL Token transfer of `25,000,000,000` raw units (25,000 GOHOME) from `C7J4...` to `ACNR...`, with `Ftk41...` as invoked-program signer authority;
- source vault `500,000 -> 475,000` GOHOME and destination `5,377.127728 -> 30,377.127728` GOHOME.

The transaction created the 9-byte Claim account `JW9gztFCfsDunWDSPs6CLJQypMPkRZE957NfJ4Xouwy`. Its exact derivation is `findProgramAddress(["smithii_claim", Ftk41..., H771...], vesFcn...)`, bump 254. The account is an eight-byte Anchor discriminator plus a one-byte cumulative claimed-percentage value.

## Positive control and claim arithmetic

At pre-state slot `457350006` (block time `1792091605`), the five scheduled percentages for `Ftk41...` were 5%, 10%, 15%, 20%, and 50%. The first four were unlocked, totaling 50%. Claim state recorded 5% previously claimed.

The expected current claim was therefore:

`500,000 GOHOME × (50% unlocked − 5% claimed) = 225,000 GOHOME`.

A real v1-wire simulation of the unmodified Claim succeeded at slot `457350007`:

| Metric | Result |
|---|---:|
| wire size | 456 bytes |
| inline addresses | 10 |
| required signatures | 1 (`H771...`) |
| compute | 24,402 CU |
| loaded account data | 559,872 bytes |
| wire SHA-256 | `bac9b3d26603485ebea215daf2d2c687c50088e896224e1bd0058fd9dfa01041` |
| beneficiary delta | `+225,000,000,000` raw GOHOME |
| vault delta | `-225,000,000,000` raw GOHOME |
| Claim byte | `5 -> 50` |

This is an authorized positive control selected with `sigVerify:false`; it demonstrates program behavior under the specified signer meta, not possession of the beneficiary key.

## Mutation and replay matrix

All cases used accepted Solana v1 wire messages, stayed below 4,096 bytes and 64 inline addresses, and used no live submission.

| Test | Runtime result | CU | Security meaning |
|---|---|---:|---|
| outsider + existing `JW9g...` Claim PDA | `ConstraintSeeds` 2006 | 22,019 | Claim PDA is signer/vesting-bound |
| outsider + canonical outsider Claim PDA | `UserNotAllowed` 6002; outsider vs stored `H771...` | 52,506 | a fresh attacker-bound Claim PDA does not bypass beneficiary authorization |
| beneficiary + outsider-owned destination | `ConstraintTokenOwner` 2015 on `signer_ata` | 12,028 | destination must be owned by beneficiary signer |
| beneficiary + other Vesting PDA's vault | `ConstraintTokenOwner` 2015 on `vesting_ata` | 20,011 | source token account must be owned by selected Vesting PDA |
| Claim account aliased to Vesting state | `ConstraintSeeds` 2006 | 18,855 | writable alias does not bypass Claim PDA binding |
| destination/Vesting account order swapped | `AccountOwnedByWrongProgram` 3007 | 5,582 | positional substitution fails before value movement |
| Merkle option byte set without proof payload | `InstructionDidNotDeserialize` 102 | 4,423 | malformed proof encoding fails closed |
| two Claims in one transaction | second instruction: `NoClaimableToken` 6001 | 47,895 | first instruction updates the one-byte cumulative claim state; replay sees zero; transaction fails atomically |
| three Claims in one transaction | second instruction: `NoClaimableToken` 6001 | 47,895 | repeated replay has the same fail-closed boundary |

The larger `EL4Cpi...` state follows a Merkle-based branch. Substituting it with a proof-less Claim reached `NoMerkleProof` 6003; that is a branch-selection control, not an authorization bypass.

Full wire bytes, ordered account metas, data bytes, logs, CU, loaded-account sizes, and pre/post account images are retained in [`vesfcn-v1-simulations.json`](vesfcn-current-audit-work/vesfcn-v1-simulations.json). Reproduction code is [`vesfcn-v1-simulations.js`](vesfcn-current-audit-work/vesfcn-v1-simulations.js).

## Flash-loan and atomic v1 stress

### First concrete same-asset blocker

Fresh filtered program-account queries found **zero GOHOME markets** in both examined lenders:

| Probe | Slot | Matches |
|---|---:|---:|
| Project 0/marginfi Bank, mint at byte 8, 3,912-byte account | `457349512` | 0 |
| Project 0 positive control: USDS Bank | `457349514` | 4 |
| KLend Reserve, mint at byte 128, 8,624-byte account | `457349515` | 0 |
| KLend positive control: USDC Reserve | `457349515` | 160 |

The positive controls make the empty GOHOME results selective rather than evidence of a broken query. This blocks a direct same-mint GOHOME flash borrow from Project 0 or KLend at those slots. It does not assert that every possible off-target swap route is impossible. More importantly, Claim neither reads the caller's balance nor accepts an amount, so externally acquired GOHOME does not alter its stored entitlement, source, or destination.

Evidence: [`gohome-flash-inventory.json`](vesfcn-current-audit-work/gohome-flash-inventory.json) and [`check-gohome-flash-inventory.js`](vesfcn-current-audit-work/check-gohome-flash-inventory.js).

### Zero-fee KLend cross-asset control

The sampled KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` is USDC, not GOHOME. Its current decoded `flash_loan_fee_sf` is exactly `0`; this is not a positive fee rounded to zero. The broader census contains positive-rate and disabled reserves, so the result is reserve-specific.

Two combined Claim controls succeeded:

| Flow | Borrow | v1 bytes / addresses / signatures | CU | Final USDC borrower / supply / fee-vault deltas | Final GOHOME beneficiary / vault deltas |
|---|---:|---|---:|---|---|
| KLend borrow → Claim → repay | 1 raw USDC | 905 / 20 / 2 | 80,879 | `0 / 0 / 0` | `+225,000 / -225,000` GOHOME |
| KLend borrow → Claim → repay | `7,789,632,497,552` raw USDC, about 99% of the decoded available amount | 905 / 20 / 2 | 80,874 | `0 / 0 / 0` | `+225,000 / -225,000` GOHOME |

The near-liquidity wire SHA-256 is `5db55ddc805d2fc4253d54fe8176e443ecbeb3d8a8c68d589937e94d7be945a5`; loaded account data was 11,060,109 bytes. The instruction trace was exactly `FlashBorrowReserveLiquidity -> Claim -> FlashRepayReserveLiquidity`. Borrowed USDC was fully repaid, the fee vault was unchanged, and Claim produced only its normal authorized schedule release. There was no unauthorized residual.

Moving Claim before the borrow pair or after repayment also succeeded with the same GOHOME and zero-USDC net deltas (79,612–80,874 CU). This rules out a relative-order dependency between these independent paths. Neither Claim nor the selected KLend flash pair exposes a required refresh/crank/update instruction, so there was no applicable refresh placement to permute.

Negative atomic controls behaved as follows:

- wrong encoded repay index: `InvalidFlashRepay` 6033 at the borrow instruction, 22,581 CU;
- two flash-borrow legs in one transaction: `MultipleFlashBorrows` 6035, 24,275 CU;
- borrow → Claim → duplicate Claim → repay: second Claim returned `NoClaimableToken` 6001, and the 927-byte transaction failed atomically after 84,002 CU.

The successful combined controls require two signer metas: the historical USDC account owner and the GOHOME beneficiary. `sigVerify:false` is appropriate for constraint simulation but cannot turn the flash borrower into the beneficiary. The composition therefore proves transport and repayment behavior, not an attacker-reachable Claim.

## Finding disposition

No security finding met the reporting threshold.

- **Unauthorized claimant:** rejected by Claim PDA seeds and explicit stored-beneficiary comparison.
- **Alternate payout address:** rejected by destination token-owner binding.
- **Foreign or aliased source:** rejected by token-owner, account-owner, and PDA constraints.
- **Caller-controlled amount/rounding:** absent; Claim data contains an optional proof, while the amount is derived from total allocation, unlocked percentages, and the cumulative claimed percentage. The reproduced arithmetic is exact at six token decimals.
- **Replay:** duplicate invocation observes updated claim state and returns `NoClaimableToken`; the containing transaction fails atomically.
- **Flash-funded drain:** direct same-asset lender inventory is absent. Zero-fee USDC dust and near-liquidity compositions fully repay with no fee-vault change and do not change Claim behavior.
- **Admin drain:** no current application-level admin/withdraw entrypoint was identified. Upgrade authority remains an explicit operational trust assumption, not an outsider vulnerability in the pinned ELF.

## Limitations

- The program is closed-source for this review, stripped, and has no on-chain IDL. Conclusions combine current binary strings, exact account bytes, historical execution, and current simulations rather than source-to-binary verification.
- Simulations used `sigVerify:false`; they validate runtime account/program logic under specified signer metas, not private-key possession.
- The Merkle proof branch for `EL4Cpi...` was not reconstructed with a valid beneficiary proof. A missing-proof negative control was exercised.
- Project 0 and KLend were checked for direct GOHOME inventory. A generic swap route was not needed to test Claim's fixed authorization/accounting path and is not claimed impossible.
- Gross token marks and quoted liquidity are volatile snapshots. They are included only to prevent gross balances from being presented as realizable loss.

## Evidence index

- [`vesfcn-chain-evidence.json`](vesfcn-current-audit-work/vesfcn-chain-evidence.json): pinned loader/program data, account bytes, and exact parsed/raw historical transactions.
- [`vesfcn-current.so`](vesfcn-current-audit-work/vesfcn-current.so): current 344,544-byte ELF.
- [`vesfcn-v1-simulations.json`](vesfcn-current-audit-work/vesfcn-v1-simulations.json): full v1 wire Base64, hashes, instruction metas, logs, CU, pre/post images, and token deltas.
- [`gohome-flash-inventory.json`](vesfcn-current-audit-work/gohome-flash-inventory.json): same-mint lender queries and positive controls.
- [`klend-jupiter-v1-extremes.json`](klend-jupiter-v1-extremes.json): independently reproduced zero-fee reserve decode and broader dust/near-liquidity KLend controls.
- [`mainnet-token-authority-state-proofs.json`](mainnet-token-authority-state-proofs.json) and [`mainnet-token-authority-flash-crosswalk.json`](mainnet-token-authority-flash-crosswalk.json): original custody attribution, gross-mark calibration, and lender crosswalk.

