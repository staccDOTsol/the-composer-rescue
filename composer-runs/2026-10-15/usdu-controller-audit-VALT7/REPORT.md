# USDu controller current-binary outsider-drain audit

Date: 2026-10-15  
Target program: `VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj`  
Target config: `ENcCimzGPU6dNih1qnsSShTYBu9rRERnF4Wwx7BVVt7h`

## Result

No immediately exploitable outsider path to an unauthorized drain was validated.

Immediately at-risk value attributable to a validated outsider path: **0 USDu (approximately $0)**.

The current binary can spend the large stake-pool token account. A confirmed current-binary transaction proves that path, but it is a share-backed unstake: it burns the sole signer's sUSDu and moves the corresponding USDu from the stake pool into a seven-day, signer-bound cooldown in the silo. It does not pay the signer immediately and is not an unauthorized drain.

Authorized `vault_admin`, Guardian-role, and upgrade-authority powers remain trust assumptions. They are not classified as outsider findings.

## Point-in-time state and binary identity

Mainnet state was observed at slot `457359468`:

- Stake-pool account `CFgrWjb9DYKVqf7QyQfmwjboDDkXpFHQ6292rnYxrjsa`: `4,218,191.379170` USDu.
- Cooldown silo `xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb`: `64,654.384680` USDu.
- Combined selected custody: `4,282,845.763850` USDu nominal.
- Both Token-2022 accounts are controlled by the exact VaultConfig PDA, have no delegate, no close authority, and are unfrozen.
- Config accounting exactly equals the two token balances: `total_staked_usdu_supply = 4,218,191.379170` and `total_cooldown_usdu_amount = 64,654.384680`.
- Cooldown duration is `604800` seconds (seven days).
- `has_initial_deposit = true`; the live pool and share supply are nonzero.

ProgramData `9so6E1Nb1AAv7koX1N3cAQ8jteDJGohbDPLk5xi8VZei` reports last deployment slot `350866586`. Its executable payload SHA-256 is:

`88a46040909ad72745b9eea4a7d2e962d44325156dcaa99b6347ab49eb929693`

That hash exactly matches the locally dumped `valt-current.so` (`912136` bytes). The current upgrade authority is `3UWMx8oCchy53x48aSb25SeSobqLfqF8U6eiCyUSdeVB`.

The public IDL at commit `17ed34217eb5b280c13a0e80b1727bc681070b3c` was treated as untrusted input. There is no fetchable canonical Anchor IDL account. Its 21 instruction names were cross-checked against the current executable's instruction log strings, live account discriminators, confirmed instruction discriminators, and current-binary local-fork behavior. Every one of the 21 instruction log names is present in the current executable. The IDL SHA-256 is `072a6776993b7073c71146680ce1341b5d28056482e1cb6f82523fa8475d5b96`.

## Confirmed current-binary spend from the large pool

Transaction:

`2dumusSLNbym6dcEhdzATaFpJeuFV7CUnFQitzEvd2JyS8XNsXEAqGywMqnijhN323TAqxdCPLSfjvwetNTRcsXw`

- Slot: `457317719` (`2026-10-15T17:17:12Z`).
- The slot is after the still-current deploy slot `350866586`; no later deployment exists in current ProgramData.
- Successful versioned transaction, `483` serialized bytes, `20` resolved accounts, one signer: `Gjx4kgtUQu5hJbpot35XKfFEKaBr8UZCfLiVqdKSFnPK`.
- Current vault instruction: `unstake_susdu`; discriminator `b29495c793865ea8`.
- The signer's sUSDu ATA transferred and burned `573.772124` sUSDu.
- The VaultConfig PDA then transferred `678.247599` USDu from the large stake pool to the silo.
- No USDu was transferred to the signer.
- Cooldown PDA `FgeJ4vL828wDVa2StPsUer6twkhxYR8f7JxSFAR3Z4y1` currently decodes to owner `Gjx4...FnPK`, amount `678.247599` USDu, and end time `2026-10-22T17:17:12Z`.

This establishes current-binary spending from the large pool and simultaneously disproves this transaction as an outsider drain: the movement is backed by burned signer-owned shares and remains inside controller custody during cooldown.

The previously observed silo outflow is also caller-bound. For example, transaction `34Q6HtE2wagf7aTxScwaNYFp6Py2Xn4rXJgT4xt6HnDyGSJsnPwNVmtfKKMcdahwe1ckFJ8RLmh2A1nmnR8TehEn`, slot `456286935`, withdrew `166.441088` USDu from the silo. Its cooldown account `CwvmHoxFsokWBSrwnKm72sfdFUkbeBy1bnH43g6nEG4z` is the exact PDA derived from the sole signer `D9rxvB1k71AGBLdyx8VkwNTXi7CN1FsLive1fbn1hjuc`; it is not a generic signer withdrawal from the large pool.

## Permissionless and privileged paths

The externally relevant permissionless lifecycle is:

1. `stake_usdu_mint_susdu`: caller signature and caller-owned USDu ATA are required; USDu enters the stake pool and shares are minted.
2. `unstake_susdu`: caller signature and caller-owned sUSDu ATA are required; shares are transferred and burned; USDu moves only from the stake pool to the silo; the cooldown PDA is derived from `("vault-cooldown", USDu mint, caller)`.
3. `withdraw_usdu`: caller signature and that caller-derived cooldown PDA are required; withdrawal is rejected until the seven-day end time.

The arbitrary emergency withdrawal path requires a signer plus an existing Guardian `vault_admin` role account. The live role is `oP4sSaAo9XGpQL8MM8f3h6tY6Px7RNZTr1XFj6paW2b`, owned by authority `2QfKMyrkFNACCmPw1EHCAxcH7MHvsChuR9MduWk6TfD6`. Other mint/redeem/reward/collateral paths similarly require their live Guardian role accounts. Initialization accounts are already initialized at their canonical PDAs.

The sUSDu mint's permanent delegate is the sUSDu mint PDA itself, not an outsider key. The vault's sUSDu redeem CPI uses the VaultConfig PDA signer and live `susdu_redeemer` role. A direct external signer cannot sign for either PDA.

## Local-fork mutation evidence

All writes below were confined to a disposable Surfpool fork. No live transaction was signed or submitted. The ephemeral test signer was `HFGTeybucHmCe32iGqfPHTEKyeGM9dXeARoUxKJRjREY`; its funding and token balances existed only in the local fork.

| Case | Wire/accounts | Current-binary result |
|---|---:|---|
| Outsider emergency withdrawal from stake pool | 559 bytes / 13 | Rejected: `vault_admin` `AccountNotInitialized` (3012) |
| Outsider unstake using another user's sUSDu ATA | 757 bytes / 19 | Rejected: `ConstraintTokenOwner` (2015) |
| Outsider withdrawal using another user's active cooldown | 518 bytes / 12 | Rejected: cooldown `ConstraintSeeds` (2006) |
| Outsider direct Token-2022 transfer from stake pool | 321 bytes / 6 | Rejected: Token-2022 `OwnerMismatch` (4) |

The victim-cooldown mutation used the live `FgeJ...Z4y1` account described above, not a fabricated account.

## Atomic v1 composition, accounting, and flash relevance

A successful positive control used `1,000.000000` synthetic local-only USDu:

- Stake minted `845.937012` sUSDu.
- The composed unstake burned `844.937012` sUSDu and retained exactly `1.000000` sUSDu.
- `998.817878` USDu moved to the caller-owned cooldown.
- `1.182122` USDu remained in the stake pool as backing for the retained share.
- `998.817878 + 1.182122 = 1,000.000000` USDu. No equity was created.

The requested one-atomic v1 sequence `stake -> unstake -> withdraw` was locally signed and simulated against current fork state:

- Wire version: v1.
- Wire size: `852` bytes, below `4096`.
- Accounts: `20`, below `64`.
- Instructions: `3`; required signatures: `1`.
- Compute consumed before rejection: `197157` units.
- `stake` succeeded, then `unstake` succeeded, then `withdraw` failed at instruction index 2 with `CooldownActive` (6040).

At fork slots `457359981`-`457359982`, exact-mint censuses returned:

- KLend reserves for USDu mint `9ckR...HrSy`: `0`.
- Project0/marginfi banks for that mint: `0`.

Therefore there is no demonstrated zero-fee same-mint KLend, Project0, or marginfi flash source to prepend. An indirect stablecoin-flash route would have to perform `borrow -> forward swap to USDu -> stake -> unstake -> withdraw -> reverse swap -> repay`. The current guard aborts at `withdraw` while the USDu is still in the seven-day silo, leaving no USDu for the reverse swap and no proceeds for atomic repayment. Adding lender and swap wrappers cannot change that clock/ownership result; the whole transaction would roll back. No fake flash source or unrepayable route is counted as evidence or value.

## Reproduction artifacts

- `current-state-snapshot.json`: decoded current accounts, roles, mint extensions, ProgramData, hashes, and observation slot.
- `target-transaction-evidence.json`: confirmed transaction account metas, signers, token deltas, inner instructions, and logs.
- `current-interface-evidence.json`: all 21 instruction surfaces and current-binary string cross-check.
- `local-fork-outsider-probes.json`: full locally signed v1/v0 wire metadata, pre/post simulation images, errors, logs, cooldown decode, and flash census.
- `snapshot-current-state.js`, `inspect-target-transactions.js`, `summarize-current-interface.js`, and `local-fork-outsider-probes.js`: reproducible read/simulation harnesses.

## Limits

This is a point-in-time current-binary audit, not a proof about future upgrades or compromised authorized keys. It does not classify operator-authorized emergency withdrawal, Guardian role assignment, or upgrade-authority action as an outsider vulnerability. The full lifetime transaction history was not reconstructed; targeted confirmed transactions were sufficient to prove the current-binary large-pool spend and the caller-bound withdrawal semantics. No profitability is attributed to synthetic fork balances.
