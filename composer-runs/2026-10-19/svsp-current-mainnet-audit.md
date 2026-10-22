# SPL Single-Validator Stake Pool current-mainnet custody and value-release audit

Observed: 2026-10-19 03:44–04:00 EDT (07:44–08:00 UTC)

Program: `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`

## Bounded conclusion

No validated current-mainnet outsider drain survived the authority, Stake-program value, or atomic-funding gates. The strongest live delegated-token source is callable by an outsider through SVSP's PDA-signed burn, but its maximum priced output is only `298,636,401` lamports. The subsequent Stake `Split` therefore fails atomically with `StakeError::InsufficientDelegation` (`Custom: 12`) below the one-SOL minimum. Every watched balance remains unchanged; outsider and protocol equity deltas are both zero.

This result does **not** erase three source-level hazards: onramp stake is omitted from exchange-rate backing before permissionless `ReplenishPool`, and the deposit/withdraw flows consume pre-authorized accounts without requiring the beneficial owner to sign the SVSP instruction. They are not reported as current outsider drains because the complete live census and signed controls establish the missing preconditions precisely: no compatible third-party deposit stake exists, every exposed withdrawal source and every same-mint aggregate is below the Stake split floor, sources cannot be legally combined by an outsider, and current two- or three-provider flash capacity for the required assets is zero.

No mainnet transaction was submitted or broadcast.

## Current deployment and native-stake custody

The finalized census covered all 57 program-owned pools at slots `458754539`–`458754586`.

| Item | Current value |
|---|---|
| Program-data account | `CnA41uYcs8X64x4PAhoPooN1yo1vabvbb64eJe9H8SZJ` |
| Last deployment slot | `408388782` |
| Upgrade authority | `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz` |
| Allocated payload | `254,256` bytes; SHA-256 `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4` |
| Official release match | `program@v4.0.1`, commit `3921ea5f63198b9a4f8d1ac9fcf24d5ca612a10a`; exact `234,664`-byte asset prefix plus `19,592` zero bytes |
| Canonical main stake | `37,525.406076582 SOL`, of which `37,497.447194596 SOL` is delegated |
| Canonical onramp stake | `2.861700239 SOL`, of which `1.362992692 SOL` is delegated |
| Primary custody total | `37,528.267776821 SOL` (canonical stake PDAs plus onramp PDAs, each once) |
| Live onramp state | 11 active/merge-compatible, 7 inactive, 39 initialized |
| Noncanonical both-authority stake | 0 accounts / `0 SOL` |
| Noncanonical withdrawer-only stake | 2 accounts / `0.495391942 SOL`, excluded from primary custody |

All 57 pool, stake, onramp, mint, stake-authority, and mint-authority derivations were verified; all mint supplies reconciled against 2,461 Tokenkeg accounts. The finalized census made 125 RPC calls with zero failures. Full receipt: [`svsp-live-finalized-evidence.json`](svsp-live-finalized-evidence.json).

## Successful post-deploy program-signed value release

The latest bounded history scan listed 1,000 program signatures and fetched 48 successful transactions before finding the most recent `WithdrawStake`. The selected finalized transaction is `35r12Uv8EFagujgwmAMrMfkmp7YWD73Y9uF2Akd54oYQxUhv49DhSQRdv6zMoVXokNeAM3QwD78jamPjM7SQUece` at slot `455124599`, after deployment slot `408388782`.

Outer instruction 5 had this exact 11-account settlement shape:

| Role | Account |
|---|---|
| Pool | `HHZnib6n6X1fxa7UMV2zbzZGRNDZ7R1NaswjgRCFBxYD` |
| Canonical stake | `6Ff5x2bBDKXC3sdnMManfUjpKgtFSYTAGjfgEaW5CKrQ` |
| Onramp | `9s9fn5vAMFATDfcyNA2j1F115enPgLWvTZ47DrnMTvDi` |
| Mint | `98B1NMLYaNJQNxiQGr53vbjNFMNTYFmDqoCgj7qD9Vhm` |
| Stake-authority PDA | `cfFkgpeKSHKfhi1eyaaq4P3S1oNysuVpey2dDBznFqx` |
| Mint-authority PDA | `Dnyo5zjX8oTzqLvW4qUns3mmznhwWQL8DYSgtquR6tFA` |
| Temporary destination stake | `3TXspwu2Nea8ttjAG76V5r9DmF91K7D4GUPcWUSpVeMf` |
| Source receipt account | `8ttAsdfvAQerrZowWjXkcTm3EGHEa1fWwyjFixkMEG6U` |
| Clock | `SysvarC1ock11111111111111111111111111111111` |
| Token program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Stake program | `Stake11111111111111111111111111111111111111` |

SVSP burned `817,905,674` raw receipts as its mint-authority PDA, split exactly `1,049,439,546` lamports from canonical stake, then authorized both stake roles to `7YnLSN4QMSTzAtVegZmCtWguCX1bmkQUkX3uonSXy9m6`. Outer instruction 6 merged the temporary stake into `2aHKsdaTz32tvZxZ65NrjgLaYkpk1mwjumP7V6MyBuFU`, whose balance increased by `1,051,105,786` lamports: the split plus the `1,666,240`-lamport temporary-account rent.

This receipt is legitimate owner spend, not evidence of outsider theft. The source token owner `7YnLS...` signed the transaction and is also the new stake authority. The PDA's authority to burn delegated receipts is distinct from an outsider's ability to spend or transfer the owner's receipts. Full reconstruction: [`svsp-postdeploy-withdrawal-receipt.json`](svsp-postdeploy-withdrawal-receipt.json).

## Fresh outsider-signed controls

### Maximum live delegated source

An exact local fork cloned current mainnet state at upstream anchor slot `458757029`; only a fresh 10 SOL fee-payer/destination pair was synthetic. The strongest exposed account, `E7JJ8wGLjMHEgZpVMRcxkNZP5Qny7cvuUitUbz16a15s`, permits the SVSP mint-authority PDA to burn `258,169,258` raw receipts. That prices to `298,636,401` lamports, while the token threshold for a one-SOL split is `864,493,601` raw, leaving a `606,324,343`-raw shortfall.

The signed, signature-verified, single atomic v0 transaction was 728 bytes, used 14 keys, two instructions, and two signatures. It reached the PDA burn and then failed at Stake `Split` with `Custom: 12`, consuming 40,319 compute units. Atomic rollback left the outsider wallet, destination, canonical stake, mint, and exposed token account unchanged. Final outsider equity: `0`; final protocol equity: `0`. Receipt: [`svsp-outsider-signed-fork.json`](svsp-outsider-signed-fork.json).

### Can multiple delegated sources be combined?

No current same-mint aggregate reaches its pool's split threshold even hypothetically. A separate exact fork tested the legal-composition question with two live third-party sources in pool `Bnnj...`:

| Signed atomic control | Size / keys | Exact result |
|---|---:|---|
| Direct Tokenkeg transfer using the PDA delegate as a nonsigner | 279 bytes / 5 | `MissingRequiredSignature` |
| One withdrawal asks the 5-raw source to cover the 6-raw aggregate | 728 bytes / 14 | SPL Token insufficient funds (`Custom: 1`) |
| Two sequential withdrawals | 968 bytes / 16 | First burn succeeds in simulation, then its independent 5-lamport Stake split fails `InsufficientFunds`; source two is never reached |

All three are within the requested 4,096-byte / 64-key envelope. All state and outsider/protocol equity deltas are zero. SVSP's PDA burn authority over third-party holdings therefore does not become caller-owned receipt spend, transfer authority, or cross-account aggregation. Receipt: [`svsp-delegated-source-combine-fork.json`](svsp-delegated-source-combine-fork.json).

## Maximal two- and three-provider atomic funding gate

The finalized provider census covered every one of the 57 exact SVSP mints and validator-matched active Stake:

| Provider family | Inventory / target receipt | Current usable capacity |
|---|---|---:|
| Save/Solend | 1,829 reserves; 0 SVSP targets | 0 |
| Kamino Lend | 620 reserves; 0 SVSP targets | 0 |
| Project 0 / Marginfi | 165 banks; 26 targets, 18 positive vaults; all 26 have `borrow_limit=0` | 0 |
| Jupiter main | 47 reserves / 163 positions; 11 targets, 10 positive vaults; 0 flash-admin-bound target positions | 0 |
| Jupiter isolated | 5 reserves / 17 positions; 0 targets | 0 |
| Mango v4 | 80 banks; 0 targets | 0 |
| Direct validator-active Stake | no provider primitive transfers a matching active Stake account | 0 |

Consequently, sourceable exact mints are `0/57`, active-onramp sourceable mints are `0/11`, and direct validator-active Stake providers are zero. The maximal two-provider principal and maximal three-provider principal are both exactly zero for every target. An honest borrow/repay transaction cannot be constructed, so the transaction-size/key envelope is not the blocker and inventing a loan would not be an exact fork. Lender principal, repayment due, and actual repayment are all zero; outsider/protocol equity deltas are zero. Inventory and per-target allocations: [`svsp-flash-provider-crosswalk.json`](svsp-flash-provider-crosswalk.json) and [`svsp-two-three-provider-gate.json`](svsp-two-three-provider-gate.json).

## Source hazards and current disposition

| Source-level candidate | Current-mainnet disposition |
|---|---|
| Onramp pricing discontinuity | `DepositStake` and `WithdrawStake` price only canonical delegated stake, while permissionless `ReplenishPool` can move active onramp stake into canonical backing. Eleven live onramps satisfy the merge prerequisite. The state-changing sequence remains a real latent design hazard, but no current validator-matched active-Stake or exact-mint provider supplies an honest atomic input/repayment path. No current funded outsider drain was validated. |
| Deposit preauthorization as bearer capability | `DepositStake` checks that both stake authorities equal the pool PDA and then merges without an owner signer bound to the output accounts. The complete current stake-authority census found zero noncanonical stake accounts with both required authorities, so no third-party current source exists. |
| Withdraw delegate approval as bearer capability | `WithdrawStake` burns through the mint-authority PDA without a token-owner signer. There are 34 delegated accounts across 9 pools (21 positive), but zero owner-path exposures; every individual and every per-mint aggregate is below the split threshold. Signed controls prove outsider consolidation is unavailable, and provider capacity for a top-up is zero. |

The exchange-rate math itself uses checked `u128` multiplication/division and the signed controls found no separate arithmetic route that bypasses these preconditions.

## Stop gate and limitations

Stop at this state because every current bearer source fails before value can settle and no exact-input provider allocation exists for a two- or three-provider transaction. Reopen on any of these changes:

1. an exposed delegated receipt account (or legally outsider-combinable same-mint set) crosses its pool's Stake split threshold;
2. a borrowable SVSP mint or validator-matched active-Stake provider becomes available;
3. a noncanonical stake account grants both authorities to a pool PDA;
4. an onramp becomes large enough and a funded, repayable input route appears;
5. the executable hash or deployment slot changes.

Limitations:

- Mainnet state is temporal; the authority and provider gates are exact only for the recorded finalized slots.
- The historical scan is bounded to 1,000 listed program signatures and 48 fetched successful transactions, not all history.
- The local fork preserved exact protocol accounts but synthetically funded only the fresh attacker fee payer; it did not fabricate protocol tokens, Stake accounts, provider liquidity, or approvals.
- The no-finding conclusion is bounded to a current outsider value-release path. It is not a claim that the documented latent source hazards are safe under future state.
- No wallet secret or RPC credential is stored in any evidence file.

Reproduction scripts are [`svsp-postdeploy-withdrawal-receipt.js`](svsp-postdeploy-withdrawal-receipt.js), [`svsp-outsider-signed-fork.js`](svsp-outsider-signed-fork.js), [`svsp-delegated-source-combine-fork.js`](svsp-delegated-source-combine-fork.js), [`svsp-flash-provider-crosswalk.js`](svsp-flash-provider-crosswalk.js), and [`svsp-two-three-provider-gate.js`](svsp-two-three-provider-gate.js).
