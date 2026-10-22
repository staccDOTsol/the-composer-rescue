# Validated finding: RuneMine multisig counts one signer twice

**Date:** 2026-10-15. **Candidate:** `5UUMS-001`. **Disposition:** reportable. **Confidence:** high for the current deployed binaries and simulated state transition. **Severity:** high under a two-of-three operator-key threat model. The precondition is control of one of the three authorized keys; this is not a permissionless outsider drain. No transaction was signed or submitted, and no operator was contacted.

## Validation rubric

- [x] Bind the tested bridge, wrapper, vault, and upgrade authority to current executable mainnet accounts.
- [x] Show that distinct single-signer accounts fail, while two distinct authorized signer accounts pass.
- [x] Show one authorized key duplicated into two account slots compiles to one required signature and reaches the privileged sink.
- [x] Verify concrete token, SOL, and loader `SetAuthority` effects in read-only current-state simulations with unchanged chain state afterward.
- [ ] Establish realized USD proceeds or Bitcoin-side redemption for the reserve tokens. Only route quotes and custody attribution are available.

## Root cause and reachable control

Bridge `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9` owns state PDA `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK`, the token authority for the three sampled vaults. Its `Unlock` instruction requires signer `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi`: direct calls without that signer fail Anchor `AccountNotSigner` 3010, and substitution of an unrelated signer fails `Unauthorized` 6000. Confirmed historical MIM, DOG, and PUPS exits prove that bridge `Unlock` actually signs the outbound SPL Token transfer.

`5okKWzQ6...` is the off-curve `['multisig']` PDA of wrapper `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu`. The wrapper is a generic CPI proxy and supplies that PDA with `invoke_signed`. The same PDA is the **upgrade authority of both current programs**. The wrapper's three authorized historical signer keys are A `FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N`, B `5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp`, and C `12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn`.

Current-state simulations show that any two *distinct* signers work and one in distinct slots fails `InvalidArgument`. The wrapper nevertheless accepts `[A,A,C]` when only A is marked signer. Solana compiles those first two account references to the same key index `[0,0,...]`; the complete transaction requires exactly **one** signature. `[A,B,A]`, `[B,B,C]`, and `[A,A,A]` also pass. An arbitrary replacement key fails. This is an account-alias bug in the threshold check: it counts signed slots without enforcing distinct authorized public keys. A is on-curve, system-owned, and had 1,902,234,312 lamports when checked, so the one-required-signature wire has a feasible signer and fee payer if A's key holder chooses to sign. `sigVerify:false` does not prove that the investigator possesses A's key.

The deployed bridge ELF SHA-256 is `80175fa9eb46209c394a9cae5f2e0c12de33100ab58d0d0b8d4d5c902650784f`, and the wrapper ELF SHA-256 is `bbd7437755b21f6be894b036405469ef0d36b9c2966e9cb3bb07b172253d868c`. The standard Anchor IDL account was absent, so instruction and account layouts are grounded in deployed bytes, account state, confirmed history, and runtime controls. See [binary/auth report](5uums-binary-auth.md), [binary metadata](5uums-current-binary.json), [wrapper metadata](5uums-wrapper.json), and [state/PDA proof](5uums-state.json).

## Reproduced effects

| Read-only case | Result |
|---|---|
| Wrapper `[A,B,C]`, A only | `InvalidArgument`; no privileged CPI. |
| Wrapper `[A,A,C]`, A only | Success with one required signature, 588-byte wire; 1,501,075,607 raw MIM exits in the historical-sized control. |
| Same alias, full current MIM | Vault `2,032,443,364,232 → 0` raw; target recipient increases by the full amount. A separate run selected A's MIM ATA as recipient and also succeeded. |
| Same alias, full current DOG | Vault `9,709,562,711,505,337 → 0` raw. |
| Same alias, full current PUPS | Vault `716,632,732,762,402,445 → 0` raw. |
| Generic System CPI, same alias | PDA's full `24,811,787,527` lamports move to A in simulation; full amount plus one fails insufficient lamports. The 321-byte wire needs only A. |
| Loader `SetAuthority`, same alias | Both bridge and wrapper ProgramData post-images change upgrade authority from `5okKWzQ6...` to A. Independent 346-byte v0 wires need only A. Distinct-slot A-only controls fail. Both real ProgramData accounts still name `5okKWzQ6...` afterward. |

The loader test proves immediate unilateral **upgrade-authority takeover** with one authorized key, without needing a prepared upgrade buffer. A subsequent arbitrary program upgrade was not executed. The direct `Unlock` tests also covered zero, one, full-vault, and full-plus-one amounts; full succeeds under counterfactual PDA signer privilege, while full-plus-one fails SPL insufficient funds. Alternate valid recipient passes; wrong mint and swapped mint/vault fail constraints; source/destination alias produces no net token change; two one-unit legs debit two units. The bridge checks themselves held—the wrapper's signer threshold is the broken boundary. See [independent alias wire and token deltas](5uums-wrapper-alias-independent.json), [direct mutation results](5uums-mutation-sim.json), [generic System CPI/full SOL boundary](5uums-wrapper-generic-probe.json), [independent v0 loader proof](5uums-wrapper-upgrade-independent.json), and [additional signer/loader controls](5uums-wrapper-upgrade-boundary.json).

## Value and flashloan limits

The three vaults' prior approximately **$103.31 million** spot-price mark is **not** liquid loss. They hold 96.8% of MIM, 97.1% of DOG, and 71.7% of PUPS Solana supply. A RuneMine-attributed MIM feed calls its vault an unbridged bridge reserve. Independent Jupiter exact-in quotes gave about $74,198 for the full MIM vault and $47,485 for the full PUPS vault; DOG quoted $8,420 for just 0.01% of its vault and returned no route at 0.012% or higher to USDC, SOL, or USDT. These are quotes, with overlapping route liquidity, not executions or additive proceeds. Bitcoin-side backing/redemption was not validated. The PDA's 24.811787527 SOL is a separate directly simulated liquid asset. The high-severity assessment rests on control of both upgrade authorities and custody instructions, **not** on treating the $103.31 million mark as realizable. See [liquid value report](5uu-liquid-value-audit.md), [live vaults](5uu-live-state.json), and [quote ladder](5uu-market-depth-quotes.json).

Fresh filtered mainnet scans found no Kamino Lend or Project 0/marginfi reserve for the MIM, DOG, or PUPS mints, so a direct same-mint flash borrow from those lenders was unavailable at the observed slots. A Kamino USDC reserve had `flash_loan_fee_sf = 0` in its current config (not merely a small rounded fee). Exact-available USDC borrow plus repayment succeeded, and repeated flash-borrow pairs were rejected by `MultipleFlashBorrows`. An atomic 963-byte transaction containing ATA creation, zero-fee USDC flash borrow, full DOG alias unlock, and full repayment succeeded in read-only simulation with one required signer and 132,864 CU. The DOG outflow matched the unlock-only and zero-borrow controls; the flash added no DOG funding or gain. The USDC account and vault returned to starting balances, reserve available and collateral shares returned, and no amount-dependent residual flash debt was seen. An underfunded repayment rejected the whole transaction despite earlier unlock logs. See [flashloan composition report](flashloan-5uu-composition.md), [atomic cases](flashloan-5uu-alias-v1.json), and [boundary cases](flashloan-extremes-5uu.json).

## Proof limits and repair target

Every active test used `simulateTransaction` with `sigVerify:false` and zero signature placeholders. The compiled account indexes, signer count, on-curve A/B/C keys, confirmed historical signatures, and program post-images establish a feasible **one-authorized-key** path; they do not establish that an external attacker currently controls such a key. No live state changed. The token quotes do not establish actual sale proceeds or Bitcoin redemption.

The wrapper should count **distinct approved public keys** with signer privileges and reject duplicate signer-slot addresses before invoking any CPI under `5okKWzQ6...`. A repair test should reject `[A,A,C]`, `[A,B,A]`, `[B,B,C]`, and `[A,A,A]` for token unlock, System transfer, and loader `SetAuthority`, while retaining valid A+B, A+C, and B+C execution. Because this PDA is the upgrade authority of both programs, remediation must cover the generic CPI path as well as token exits.

To reproduce the read-only evidence, run the scripts adjacent to this report with the existing `/tmp/composer-helius-rpc.env` file; each script uses only `get*` and `simulateTransaction`, writes JSON under this directory, and never calls a send RPC method. The cited JSON files preserve slots, account metas, errors, logs, transaction sizes, and before/simulated-post balances. On-chain accounts were re-read after simulations to verify unchanged real state.
