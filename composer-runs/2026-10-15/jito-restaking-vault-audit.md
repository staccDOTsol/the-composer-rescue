# Jito (Re)staking Vault — current-mainnet adversarial audit

Date: 2026-10-15  
Program: `Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8`  
Method: read-only mainnet RPC, deployed executable inspection, official-source comparison, account census, and `simulateTransaction`; no transaction was submitted.

## Result

**No novel, immediately fund-risk exploit was validated against the current deployed Vault binary in the reviewed surfaces.**

The result is deliberately narrower than “the program is safe.” It means that the tested withdrawal, receipt, ownership, epoch, account-aliasing, replay, reward, slasher-ticket, delegation, and asset-exit paths did not produce a current, permissionless, profitable custody break. Custody size is not treated as exploit value.

One source-reachable economic behavior remains: a depositor can mint before `UpdateVaultBalance` and share rewards that have reached the vault token account but are not yet included in `tokens_deposited`. This is **not novel**: Jito’s public [PR #192](https://github.com/jito-foundation/restaking/pull/192) identifies the same reward-sandwich issue as audit entry 36903 and lists duplicate reports. It was not immediately profitable at the live snapshot because the only positive surplus was 1.2946 bps of accounted assets, versus 20 bps of withdrawal charges before transaction costs and the 5% reward fee.

## Current deployment and source mapping

| Property | Current evidence |
|---|---|
| Program ID | `Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Programdata | `96nH6npzmaAWpmraLaN2F55h27TMEtJrsjo881dCc2Dt` |
| Upgrade authority | `5eosrve6LktMZgVNszYzebgmmC7BjLK8NoWyRQtcmGTF` |
| Last deploy slot | `333957056` |
| Deploy time | `2025-04-17T01:11:54Z` |
| Executable size | 864,704 bytes |
| Executable SHA-256 | `308b0d586b480464c0620ca4f2406ec099b8d860e8f03eae911b76847610e417` |
| Behaviorally aligned source | Official `jito-foundation/restaking` commit [`9ae127e32bcdfe670b9e784521be7c203776ca02`](https://github.com/jito-foundation/restaking/tree/9ae127e32bcdfe670b9e784521be7c203776ca02) |

The source mapping is strong but not byte-for-byte proven:

- The deployed binary contains the official Vault source paths, instruction names, program identity, and exact control messages, including `Vault must match the vault in the withdrawal ticket`.
- Commit `9ae127e...` predates the deployment by hours and is followed by a version-only commit after the deployment.
- Its instruction variants, account order, validation sequence, and errors match current-binary simulations.
- The ticket loader in this revision binds the stored ticket vault to the supplied vault and re-derives the exact ticket PDA ([source lines 145–181](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_core/src/vault_staker_withdrawal_ticket.rs#L145-L181)). The current binary emits the same vault-mismatch error under mutation.

An exact reproducible build was not completed. A build would require the historical Solana verification image/toolchain; after the workspace incident, the authorized recovery direction was to avoid Docker and large source/build caches. I therefore do **not** claim exact source equivalence.

## Custody-prioritized scope

The original read-only custody snapshot at slot `457334005` (`2026-10-15T18:28:34.241Z`) identified:

- 35 Vault state accounts, all with verified Vault PDAs.
- 31 canonical supported-mint token vaults with nonzero balances.
- 14 priced vaults and 17 unpriced vaults.
- Priced gross lower bound: **$17,789,942.31**.
- Approximately **$15.05M** was JitoSOL that overlaps SPL Stake Pool backing and must not be double-counted as independent economic exposure.

The host reclaimed the original census artifact during workspace cleanup. These figures are recovered from the already-completed RPC result retained in the task record. A later compact live pass independently re-confirmed 35 Vault states and checked stored-versus-actual balances for every canonical supported-mint ATA at slot `457343585`.

The program also had 1,677 withdrawal-ticket accounts in the live account census; 1,666 were mature at slot `457342934`. This count indicates a broad claim surface, not a claimable exploit value.

## Threat model

The modeled attacker can choose arbitrary account metas, alias accounts, create and sign attacker-owned accounts, donate tokens directly to a vault ATA, front-run permissionless updates, and compose multiple instructions atomically. The attacker does not possess a victim, vault-admin, mint/burn-admin, slasher-admin, delegate-asset-admin, or upgrade-authority private key.

The primary invariants were:

- supported-mint custody exits only through an authorized, correctly valued path;
- a withdrawal ticket cannot be forged, substituted across vaults, replayed, or burned before maturity;
- a permissionless claim cannot redirect value away from the recorded staker’s canonical ATA;
- fee/reward accounting cannot yield an immediately profitable unauthorized extraction;
- privileged delegation and slasher state changes remain signer-, epoch-, and PDA-bound;
- same-transaction composition cannot bypass account closure or state transitions.

## Current-binary simulation matrix

The positive control used a real mature ticket before any mutation:

- Ticket: `BKyBEHxeV7QbwGBScyQBWuHXtt2w92pJ9Tx3gthRTGNV`
- Vault: `ABsoYTwRPBJEf55G7N8hVw7tQnDKBA6GkZCKBVrjTTcf`
- Recorded staker: `7e7zujE9wwBzudwzmr275jzwRdHWwYkHPzTFSfSbi4ac`
- Ticket VRT amount: `64,000,000,000` raw units
- Unstake slot: `456368765`

| Test | Mainnet simulation result | Security conclusion |
|---|---|---|
| Positive mature withdrawal | Success at context slot `457345179`; 40,808 CU | Harness and account ordering reach the current value-moving path. |
| Substitute another live staker | `Custom(1042)`; `Staker is not the owner of the withdrawal ticket` | Recorded claimant binding enforced. |
| Alias destination to vault custody ATA | `InvalidAccountData`; `Account is not the associated token account` | Payout cannot be redirected by destination aliasing. |
| Substitute a ticket from another vault | `InvalidAccountData`; `Vault must match the vault in the withdrawal ticket` | Cross-vault receipt substitution rejected by the current binary. |
| Burn a premature ticket | `Custom(1030)`; `Vault staker withdrawal ticket is not withdrawable` | Two-full-epoch maturity enforced. |
| Burn the same ticket twice in one transaction | Instruction 0 succeeds; instruction 1 fails `InvalidAccountOwner` after the ticket is closed | Atomic transaction failure rolls back the first burn; no double claim. |
| Change ticket owner as a non-owner | `Custom(1042)`; `Staker is not the owner of the withdrawal ticket` | Old-owner authorization and recorded-owner binding enforced. |

The cross-vault mutation used foreign ticket `CctZZbTJdHMj1jQ1CjEd5ELp1i6La6YFppA6xWM1Gczf`. The premature test used ticket `EfDpXjxPRVGVRaVMdMmmjuKsapwRsTY7Pr52cxrgbBio` at unstake slot `457310897`.

Simulation used `sigVerify:false` and dummy cryptographic signatures, while preserving every instruction account’s signer bit. This is sufficient for the tested key-binding and program-control branches, but it is not evidence that a private-key signature can be forged. No live transaction was sent.

## Static and state review

### Withdrawals and queued claims

`EnqueueWithdrawal` requires both the staker and base signers, creates the ticket at the PDA derived from `("vault_staker_withdrawal_ticket", vault, base)`, and moves VRT into the ticket’s canonical ATA ([source](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/enqueue_withdrawal.rs)).

`BurnWithdrawalTicket` is intentionally permissionless: the recorded staker need not sign. This does not expose payout redirection because the instruction verifies the ticket’s recorded staker, requires the staker’s canonical supported-mint ATA, derives the ticket ATA, verifies fee ATAs, enforces maturity, burns VRT, closes ticket accounts to the recorded staker, and transfers the supported asset to that canonical ATA ([source lines 31–96](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/burn_withdrawal_ticket.rs#L31-L96)). An optional mint/burn administrator must sign when configured.

Ticket maturity is `current_epoch > unstake_epoch + 1`, which requires two epoch transitions ([source lines 73–87](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_core/src/vault_staker_withdrawal_ticket.rs#L73-L87)). `ChangeWithdrawalTicketOwner` requires the recorded old owner as signer before changing the staker field ([source](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/change_withdrawal_ticket_owner.rs)).

### Reward and share accounting

`MintTo` validates canonical vault/depositor/fee ATAs, the depositor signer, the VRT mint, capacity, pause state, and current epoch state. It prices the mint from stored `tokens_deposited` and VRT supply. The source merely says it is “strongly encouraged” to call `UpdateVaultBalance` first; it does not enforce that update ([source lines 24–95](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/mint_to.rs#L24-L95)).

`UpdateVaultBalance` is permissionless, reads the actual canonical vault-token balance, computes rewards, updates `tokens_deposited`, and mints reward-fee VRT to the canonical fee wallet ([source lines 12–94](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/update_vault_balance.rs#L12-L94)). This creates the known sandwich window between an external reward transfer and the update.

At slot `457343585`, all 35 vaults were compared against their canonical ATA balance. Only one had a positive unaccounted surplus:

| Field | Value |
|---|---|
| Vault | `ABsoYTwRPBJEf55G7N8hVw7tQnDKBA6GkZCKBVrjTTcf` |
| Supported mint | JTO, `jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL` |
| Actual vault balance | `1,738,217,794,869,380` raw |
| Recorded `tokens_deposited` | `1,737,992,794,025,111` raw |
| Surplus | `225,000,844,269` raw = 225.000844269 JTO |
| Surplus/accounted | 1.2946017 bps |
| Deposit fee | 0 bps |
| Withdrawal fee | 10 bps |
| Program fee | 10 bps |
| Reward fee | 500 bps |

Ignoring the reward fee and integer rounding gives the attacker the most favorable bound. A small deposit’s gross uplift is approximately `1 + surplus/accounted`; after the 20 bps exit charge, its return factor is about `0.9981292`. Break-even requires roughly 20.04008 bps of unaccounted surplus, **15.48×** the observed ratio. The 5% reward fee, compute fees, priority fees, and rounding only worsen the result. Thus this known issue is reachable but not an immediately profitable extraction at the snapshot. It can become exploitable again if a materially larger reward arrives before an update.

### Slashing, delegation, and other asset exits

The deployed Vault instruction surface exposes slasher-ticket initialization/warmup/cooldown state transitions, not a direct supported-mint slash transfer. The reviewed handlers bind the vault, NCN, slasher, and ticket PDAs; require the configured slasher administrator; require current epoch state; and respect pause state.

`DelegateTokenAccount` is the other relevant asset-control path. It requires the configured delegate-asset administrator, verifies the vault owns the token account and that its mint matches the supplied mint, and explicitly rejects the vault’s supported mint before approving a delegate ([source lines 33–57](https://github.com/jito-foundation/restaking/blob/9ae127e32bcdfe670b9e784521be7c203776ca02/vault_program/src/delegate_token_account.rs#L33-L57)). It can therefore delegate unsolicited/non-supported assets, but not the primary custody asset.

Permissionless update-state tracker initialization/cranking/closing was reviewed for fund movement and account substitution. Those instructions are PDA/index/state bound and do not directly transfer supported assets.

## Candidate dispositions

| Candidate | Disposition | Reason |
|---|---|---|
| Cross-vault withdrawal-ticket substitution | Rejected against current binary | Stored vault equality and exact ticket-PDA derivation are enforced; live mutation failed at the intended control. The excluded historical class was not treated as a current finding. |
| Wrong-owner claim or owner change | Rejected | Recorded staker check failed in both burn and owner-change paths. |
| Noncanonical/aliased payout account | Rejected | Canonical ATA validation failed before asset transfer. |
| Premature claim | Rejected | Two-full-epoch rule failed closed. |
| Same-transaction duplicate claim | Rejected | Ticket closure invalidated the second instruction; atomic rollback prevents the first from persisting. |
| Reward-update sandwich | Known/open design risk; not a novel finding; not immediately profitable at snapshot | Public PR #192 documents the same audit issue. Current surplus was far below exit costs. |
| Privileged supported-asset delegation | Rejected | Admin signer required and supported mint explicitly prohibited. |

## Recommendations

1. Eliminate the known reward window by settling the canonical token balance inside `MintTo` before share pricing, as proposed in public PR #192, or enforce an equivalent same-transaction freshness invariant.
2. Monitor `actual_balance - tokens_deposited` and trigger an update before the ratio approaches the all-in exit-fee threshold. This is an operational mitigation, not a substitute for the code fix.
3. Publish a reproducible-build attestation for the deployed programdata so auditors can upgrade the current strong behavioral/source-lineage mapping to an exact byte match.
4. Preserve the current explicit ticket-vault equality, exact ticket PDA derivation, canonical payout ATA, and duplicate-burn closure controls in future upgrades.

## Scope limits and exclusions

- No live transaction submission, private-key use, or destructive action.
- No byte-for-byte reproducible build.
- No claim that unpriced custody is valueless; the USD figure is a lower bound.
- No double-counting of the approximately $15.05M JitoSOL overlap as separate backing.
- Explicitly excluded: OtterSec’s GoonFi issue and the active CLMM, AMM v4, CPMM, PumpSwap, marginfi, DAMM v2, Wormhole Token Bridge, Meteora Dynamic Vault, Kamino, Save, Orca, Sanctum INF, Meteora DLMM, and Perps tranches.

## Local evidence

- Current executable: [`jito-vault-current.so`](./jito-vault-current.so)
- Re-runnable read-only simulation harness: [`jito-restaking-vault-probe.py`](./jito-restaking-vault-probe.py)

The harness reads only the authorized RPC environment files, never prints the endpoint or credentials, and issues only account reads, blockhash reads, and `simulateTransaction` calls.
