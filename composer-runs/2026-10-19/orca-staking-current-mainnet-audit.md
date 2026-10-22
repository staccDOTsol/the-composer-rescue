# Orca xORCA staking: current mainnet outsider-value audit

Date: 2026-10-19  
Program: `StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT`  
Network: Solana mainnet-beta; read-only RPC and `simulateTransaction` only; no broadcast

## Result

No outsider-accessible immediate-at-risk value path was reproduced. This is a bounded negative result, not a universal safety proof.

The current binary bound stake inputs and xORCA outputs to the signer-owned token accounts, bound the vault and state to their canonical addresses, bound pending withdrawals to `PDA("pending_withdraw", signer, index)`, and required the recorded update authority for `Set`. A fresh outsider could not claim a live matured third-party pending withdrawal or redirect a payout. Mainnet-backed fork controls confirmed that the payout path works when the pending PDA is genuinely bound to the signer, and then rejects third-party and vault destinations.

The conditional flash stage was not entered. No outsider value-moving precursor survived `sigVerify:true`, so composing two or three lenders around a nonexistent primitive would not test the requested hypothesis. No `sigVerify:false` result is used as evidence.

## Exact deployment and interface

- At finalized slot `458784598`, the executable program pointed to ProgramData `7TdF3aLJXvwo24azTD3vBTMzr5ScscQUdHzdfcf41kbD`, last deploy slot `370039372`, upgrade authority `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`.
- Exact acquired ELF: 102,624 bytes, SHA-256 `44d5ac6e34b4584890c44d72ea3f9af5ab2f8fcf2874a5f3a78ab6bc264f786b`.
- Composer published-IDL lookup returned HTTP 400: no published IDL account.
- Composer `/learn` returned HTTP 200 after scanning 250 successful transactions. It identified one-byte selectors `0`, `1`, and `2`, respectively matching current successful `Stake`, `Unstake`, and `Withdraw` receipts. Canonical learned-body SHA-256: `190cc9f1de0dc6b04350b87b316a77f57e160975c4837adbb2d6dee2ab426022`.
- Orca's official [`orca-so/xorca`](https://github.com/orca-so/xorca/tree/05fe66b67c95271cb07aa42c83b9fdfd8a39b936) source at commit `05fe66b67c95271cb07aa42c83b9fdfd8a39b936` names selectors `0..4` as `Stake`, `Unstake`, `Withdraw`, `Initialize`, and `Set`, and defines the 2,048-byte `State` and 1,024-byte `PendingWithdraw` layouts used here. That commit post-dates the deploy; source-to-ELF byte equivalence was not established. Current receipts and simulations independently validated the relevant deployed layouts and checks.

Fresh successful receipt samples were finalized at slots `458660874`–`458771754`. They confirmed the positional account schemas, one-byte selectors plus fixed-width arguments, signer flags, canonical mints/vault/state, and actual token CPIs. The cited withdrawal `MY5Hq5…` transferred `140.982904` ORCA from the canonical vault to the signer's ORCA token account; it is evidence of the legitimate payout route, not unauthorized access.

## Assets, receipt liabilities, and share rate

Finalized account snapshot at slot `458785061`; pending-withdraw census at slot `458785063`:

| Item | Raw | UI amount |
|---|---:|---:|
| Canonical vault ORCA | `9703334436569` | 9,703,334.436569 ORCA |
| State escrowed ORCA | `580260564222` | 580,260.564222 ORCA |
| 303 live `PendingWithdraw` claims | `580260564222` | 580,260.564222 ORCA |
| Non-escrowed xORCA backing | `9123073872347` | 9,123,073.872347 ORCA |
| xORCA mint supply | `5386862822397` | 5,386,862.822397 xORCA |

The pending-claim census equals state escrow exactly: delta `0` raw ORCA. Of 303 live claims, 243 were mature and 60 were still cooling down. The current program rate, including its 100-raw-unit virtual offsets, was approximately **1.6935782798 ORCA/xORCA**. The vault is therefore fully partitioned between pending ORCA claims and xORCA backing; its gross 9.703M ORCA balance is not protocol equity and not an exploit amount.

## Fresh outsider-signed mainnet gates

All cases used a newly generated outsider key, v0 messages, current blockhashes, `sigVerify:true`, `replaceRecentBlockhash:false`, and simulation only. Envelopes were 351–698 bytes with at most 15 inline account keys.

| Mutation | Current-binary result |
|---|---|
| Stake 1 raw ORCA from empty canonical outsider ATA | `6009 InsufficientFunds` |
| Substitute another user's ORCA source | `6007 InvalidAccountData`; token owner did not match signer |
| Substitute another user's xORCA destination | `6007 InvalidAccountData`; token owner did not match signer |
| Substitute canonical vault with outsider ATA | `6005 InvalidSeeds` |
| Alias ORCA source as xORCA destination | `6007 InvalidAccountData`; mint mismatch |
| Unstake 1 raw xORCA from empty canonical outsider ATA | `6009 InsufficientFunds` |
| Substitute another user's xORCA source | `6007 InvalidAccountData`; token owner did not match signer |
| Claim a live mature victim pending withdrawal to outsider ATA | `6005 InvalidSeeds` |
| Same victim pending withdrawal with victim destination retained | `6005 InvalidSeeds` |
| Use correctly derived but nonexistent outsider pending PDA | `6004 IncorrectOwner` |
| Substitute outsider for state update authority | `6006 IncorrectAccountAddress` |
| Substitute a pending account for state | `6007 InvalidAccountData`; 1,024 vs 2,048 bytes |
| Substitute outsider for initialize deployer | `6019 UnauthorizedDeployerAccess` |

No failed simulation reached a token payout CPI or produced a committed account delta.

## Mainnet-backed fork controls, rounding, rewards, and destination binding

The isolated Surfpool fork started from mainnet slot `458785821`. Fork-only writes funded one fresh signer, seeded its canonical ORCA/xORCA accounts, and created one explicitly synthetic outsider-bound pending fixture. Every tested transaction still used a real signature and `sigVerify:true`; simulations rolled back.

- Stake controls succeeded for `100`, `1,000,000`, `1,000,000,000,000`, and `5,000,000,000,000` raw ORCA. A 1-raw-unit stake was rejected because it would mint zero shares (`6014`).
- Atomic stake→unstake controls at those four accepted sizes minted then burned the predicted shares and created pending claims with only `1`, `2`, `1`, and `1` raw ORCA of rounding loss, respectively. No size returned more ORCA than supplied.
- Reward injection is a direct SPL Token transfer into the canonical vault. Donation→stake→unstake tests at 1 ORCA and 5,000,000 ORCA donation scales both succeeded but reduced outsider equity by the donation plus 2 raw units. The donation accrued to existing xORCA holders; the donor could not recapture it profitably.
- A synthetic mature pending account whose PDA and embedded unstaker were both changed to the fresh signer paid its exact 1-raw-ORCA entitlement to the signer-owned ORCA account. Changing only the destination to a third party, or aliasing it to the vault, failed with `6007` because the token-account owner did not match the signer.

These fork controls are diagnostic current-binary tests, not claims that synthetic balances or the cloned pending entitlement exist on mainnet.

## Current ORCA→USDC exit depth

Read-only Jupiter ExactIn quotes used 100 bps slippage and restricted intermediate tokens. They are liquidity indications, not fills or signed swap simulations.

| ORCA input | Quoted USDC | Average USDC/ORCA | Reported price impact |
|---:|---:|---:|---:|
| 1,000 | 1,766.966757 | 1.76697 | 0.21% |
| 10,000 | 17,547.142885 | 1.75471 | 0.90% |
| 100,000 | 161,600.186006 | 1.61600 | 8.74% |
| 1,000,000 | 645,531.395658 | 0.64553 | 63.54% |
| 5,000,000 | 831,703.618321 | 0.16634 | 90.61% |
| 9,703,334 | 819,719.030486 | 0.08448 | 95.23% |

This confirms that the earlier ~$17.17m spot mark is not realizable depth for the gross vault. Even the vault-scale aggregator quote was only about $0.82m before its 1% slippage threshold, and it was not built or simulated as a transaction. Because the outsider precursor gate was negative, no exploit-linked executable exit packet was warranted.

## Disposition and limits

No finding is reported. The observed controls defeat the tested signer substitution, pending-PDA theft, destination redirection, state/vault aliasing, authority substitution, donation, and rounding hypotheses under current state.

Coverage limits: the source commit was not proven byte-identical to the ELF; the audit used bounded receipt samples and the complete current 1,024-byte pending-account census, not all historical transactions; the Jupiter results were quotes rather than signed swaps; privileged upgrade-authority behavior was outside the outsider threat model. None of those limits is converted into a risk claim.

## Evidence

- `orca-staking-current-attestation.json` / `orca-staking-current.so`
- `orca-staking-composer-idl.json` / `orca-staking-composer-learn.json`
- `orca-staking-current-state.json`
- `orca-staking-signed-mainnet-mutations.json`
- `orca-staking-signed-fork-controls.json`
- `orca-staking-exit-quotes.json`
- Reproducers: corresponding `.js` files in this directory
