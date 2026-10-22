# Wormhole Solana Token Bridge — current-deployment custody audit

Date: 2026-10-15 (America/Toronto)  
Program: `wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb`  
Network: Solana mainnet-beta  
Assessment type: read-only RPC inspection and `simulateTransaction` only; no transaction was submitted

## Executive result

**No novel, immediately exploitable at-risk-fund bug was demonstrated in the tested current deployment.** The established unauthorized-transfer amount is **$0**.

This is not a claim that the program is bug-free. It means that the reviewed custody-release invariants held in the live-state simulations performed here: every tested attempt to redirect a valid native-token redemption, substitute custody/mint/signer/claim/endpoint/program accounts, alias accounts, or replay the claim failed to move tokens to the attacker-controlled destination. The positive control moved exactly 101 USDC from the canonical custody account to the recipient encoded by the VAA; changing only the fee payer remained permissionless but did not change the recipient.

The bridge has substantial custody exposure. At the observation slots, 837 nonzero canonical custody accounts held a **priced gross lower bound of $53,760,002.42**, with 599 additional canonical custody accounts lacking a price. That number measures assets held, not assets proven exploitable.

## Deployment identity and trust boundary

Observed at slot `457342991`:

| Property | Value |
|---|---|
| Program owner | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Executable | `true` |
| ProgramData | `7ek4EpFaoForoFzzx8wBVQzN9oYP5reNK9JkYHMnTxo9` |
| Last deployment slot | `377952237` |
| Upgrade authority | `DHyAcRbFpRWTkcsAsfwQpbABXvtjs6bQ1dq5ScNhRDoQ` |
| Deployed ELF length | 1,198,528 bytes |
| Deployed ELF SHA-256 | `0eee4584fb7b8d2cb8718cc87b060843a5fe5c9a44899776ee7ded9d52c644a4` |
| Token Bridge config | `DapiQYH3BGonhN8cngWcXQ6SrqSm3cwysoznoHr6Sbsx` |
| Config data length | 32 bytes |
| Core bridge in config | `worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth` |
| Custody signer PDA | `GugU1tP7doLeTw9hQP51xRJyS8Da1fWxuiy2rVrnMD2m` (bump 254) |
| Authority signer PDA | `7oPa2PHQdZmjSPqvpZN7MQxnC7Dcf3uL4oLqknGLk2S3` |
| Mint signer PDA | `BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7` |

The program is upgradeable. The upgrade authority is therefore a privileged trust boundary capable of replacing program logic; this audit did not model key compromise or malicious governance as an unprivileged exploit.

The inspected official repository revision was `bb5957f321b0a9d168f52e906699ee77baa82a28`. Its current Token Bridge config layout includes newer pause/freeze fields and is 137 bytes, while the deployed config is 32 bytes. Consequently, the repository revision is useful for understanding invariants but is **not established as the exact source of the deployed ELF**. Runtime results and the deployed ELF hash above are the authoritative evidence in this report.

## Custody exposure

The census queried both the legacy SPL Token program and Token-2022 for accounts whose token authority is the Token Bridge custody signer, then independently derived the expected custody PDA from each mint. Observation spanned slots `457342963`–`457343017`.

| Measure | Result |
|---|---:|
| Token accounts under custody signer | 1,308 |
| Nonzero accounts with canonical `[mint]` custody PDA and expected authority | 837 |
| Canonical accounts with a price | 238 |
| Canonical accounts without a price | 599 |
| Priced gross custody lower bound | $53,760,002.42 |

Largest priced canonical holdings in the snapshot:

| Token | Custody account | Balance | Snapshot value |
|---|---|---:|---:|
| SOL / WSOL | `2nQNF8F9LLWMqdjymiLK2u8HoHMvYa4orCXsp3w65fQ2` | 441,755.17679562 | $46,706,275.69 |
| USDC | `9EhGiXJFGG7NGneq76Mfu6LCvGxHKmeq4tQv9HD4iBxV` | 3,217,895.64159 | $3,216,628.36 |
| BONK | `7csLUpezHQH7f5uha3s93ruKutcniNQmxjmapRsrfxaR` | 636,834,486,045.5701 | $1,965,334.23 |
| META | `FkaSeFfxtirb8U4NBYiG81JUH3jNffTMHNg73BpM13Mt` | 12,880,130.277676 | $638,530.56 |
| USDT | `AZnLiVRARbovELxrhJynFJTyp8irqmUURoyXBtyPWK6C` | 519,339.275885 | $518,885.03 |

Prices are point-in-time third-party quotes recorded in the custody artifact. Because 599 canonical custody accounts were unpriced, the USD total is deliberately labeled a lower bound. It must not be interpreted as loss exposure from a demonstrated vulnerability.

## Live-state redemption corpus

At slot `457343478`, the scanner enumerated all Token Bridge-owned accounts and decoded payload-ID-1 native/wrapped transfer VAAs addressed to Solana:

| Corpus measure | Result |
|---|---:|
| Posted payload-ID-1 transfers targeting Solana | 48,252 |
| Unclaimed transfers | 159 |
| Current-state viable native redemptions | 23 |
| Viable legacy SPL Token candidates | 15 |
| Viable Token-2022 candidates | 8 |

“Viable” means that the native Solana mint, intended destination token account, canonical custody, registered endpoint, and sufficient custody balance all existed when observed. It does not assert that the redemption must succeed.

## Current-binary simulation matrix

All cases used Solana RPC `simulateTransaction` with `sigVerify: false` and `replaceRecentBlockhash: true`. The constructed transactions were never sent. A valid, unclaimed 101 USDC redemption was used as the legacy SPL positive control:

- Posted VAA: `4nvh9h2tou4JhuRv5AH7PXcbTfioa9bZszSKwuT1Mg5s`
- Emitter: chain 22, address `11111111111111111111111111111112`, sequence 63452
- Mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Canonical custody: `9EhGiXJFGG7NGneq76Mfu6LCvGxHKmeq4tQv9HD4iBxV`
- VAA-designated destination: `8nt2UeTSNrftju56r5V6bPJnZXiMvtN5kg31fPhUN5cA`
- Claim PDA: `94sr4mxsCbcKP69GvcfQM8J6QDFdvgRRbm79e2d8q8MR`
- Registered endpoint: `96Hx7DhGHwVKWbdYePwSsD8uZJKd9Kc63ni83jV9h29k`

| Case | Result | Security interpretation |
|---|---|---|
| Positive control | Success; custody `-101,000,000`, intended destination `+101,000,000` raw units | Confirms the instruction/account encoding and live VAA are usable |
| Substitute arbitrary fee payer | Success; same custody and intended-destination deltas; attacker destination `0` | Redemption is permissionless, but value remains bound to VAA recipient |
| Substitute destination token account | Rejected: `InvalidRecipient` (`Custom(11)`) | Recipient binding held |
| Substitute fee destination on zero-fee VAA | Success; attacker destination `0` | No value redirection because encoded fee is zero |
| Substitute another same-mint custody account | Rejected: `InvalidDerive` | Custody PDA binding held |
| Substitute mint | Rejected: `InvalidDerive` | Mint/custody derivation binding held |
| Substitute custody signer | Rejected: `InvalidDerive` | Signer PDA binding held |
| Substitute VAA plus matching claim/endpoint from another transfer | Rejected: `InvalidMint` (`Custom(4)`) | Cross-transfer account splice did not release value |
| Substitute claim | Rejected: `InvalidDerive` | Claim is bound to emitter chain/address/sequence |
| Substitute endpoint | Rejected: `InvalidDerive` | Endpoint is bound to VAA emitter |
| Substitute CPI token program | Rejected: `MissingAccount`; unknown expected token program | CPI target substitution did not execute an attacker program |
| Alias claim to initialized destination | Rejected: `AlreadyInitialized` | Account alias did not bypass claim creation |
| Alias custody to destination | Rejected: `InvalidDerive` | Account alias did not bypass custody derivation |
| Duplicate valid redemption in one transaction | Second instruction rejected: `AlreadyInitialized`; whole transaction rolled back | Same-transaction replay did not commit value |
| Valid redemption followed by second use of same claim | Second instruction rejected: `AlreadyInitialized`; whole transaction rolled back | No partial commit under transaction atomicity |
| Invalid destination followed by valid redemption | First instruction rejected: `InvalidRecipient`; transaction aborted | Ordering did not create a bypass |

Failed simulations returned no post-account snapshots for the requested accounts. The “rolled back” statements rely on Solana transaction atomicity and the failed transaction result, not on fabricated balance deltas.

## Atomic v1 flash-loan composition follow-up

The follow-up built 52 unsigned, no-ALT Solana v1 transactions and passed their exact wire bytes only to current-mainnet `simulateTransaction`. Every encoded transaction stayed under the requested 4,096-byte and 64-inline-address limits. The evidence artifact records, per case, the complete base64 wire message, SHA-256, compiled account order and privileges, instruction data and account metas, bytes, accounts, instruction count, compute units, loaded-account bytes, invocation count/depth, complete logs/inner instructions, and pre/post wallet, vault, custody, reserve, claim, and message snapshots. No transaction was signed or submitted.

### Lender configuration and amount boundaries

At slot `457350553`, the selected KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` decoded as USDC with supply vault `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`, fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`, `total_available_amount = 8,011,866,795,993`, and `flash_loan_fee_sf = 0`. The configured scaled fee is exactly zero; the one-raw-unit repayment is therefore not a rounded-down positive fee.

| Boundary | Result | Exact execution evidence |
|---|---|---|
| KLend 1 raw USDC | Success, fully repaid | 531 bytes, 11 accounts, 2 instructions, 55,210 CU; borrower/supply/fee-vault/reserve-available deltas all zero |
| KLend 8,011,866,795,993 raw USDC (decoded available amount) | Success, fully repaid | Same 531-byte shape and zero lender/token deltas |
| KLend available + 1 | Rejected | `InsufficientLiquidity` / `Custom(6008)` at instruction 0; immediate chain re-read matched every pre-snapshot |
| Project 0 1 raw WSOL | Rejected | `IllegalBalanceState` / `Custom(6040)` during borrow |
| Project 0 2 raw WSOL | Success, fully repaid | This was the smallest successful nonzero amount; 1,250 bytes, 27 accounts, 8 instructions, 189,629 CU; vault delta zero |
| Project 0 99.9% of observed vault (11,197,375,289,269 raw WSOL) | Success, fully repaid | 190,816 CU; Project 0 vault and Wormhole custody deltas zero for the one-unit truncated bridge leg |
| Project 0 99.99% (11,207,463,014,755 raw WSOL) | Rejected | `IllegalUtilizationRatio` / `Custom(6026)` during borrow; rollback re-read matched pre-state |

The KLend flash path has no obligation or debt-share account. Full repayment was established by the flash supply vault returning to its exact pre-balance, fee vault delta zero, and decoded reserve available-liquidity delta zero. KLend reserve state may still update interest/accrual fields during a successful instruction, so a whole-account hash or borrowed fixed-point field is not itself a flash-debt balance. Project 0 likewise creates no persistent flash obligation/share account; its successful cases returned the bank vault to the exact pre-balance.

### Same-asset Wormhole compositions and funded controls

| Case | Result | Exact value flow and limits |
|---|---|---|
| KLend near-liquidity USDC + 1 raw outbound USDC | Success, fully repaid | Borrow `7,931,748,128,033`; borrower `-1`, canonical Wormhole custody `+1`, KLend supply/fee/reserve-available `0`; 1,142 bytes, 25 accounts, 5 instructions, 156,765 CU, 13 invocations, depth 3 |
| Positive funded outbound control | Success, fully repaid | One-unit loan plus 716,825 raw pre-funded USDC; borrower `-716,825`, custody `+716,825`, lender deltas `0`; 1,142 bytes, 156,763 CU |
| Funded amount + 1 | Repay rejected and transaction rolled back | Borrower lacked exactly one raw unit at repay; `Custom(1)` from SPL Token; all immediate post-simulation chain snapshots matched pre-state |
| KLend near-liquidity USDC + valid inbound `CompleteNative` | Success, fully repaid | Wormhole custody `-101,000,000`, VAA recipient `+101,000,000`, borrower `0`, lender deltas `0`; 902 bytes, 22 accounts, 3 instructions, 169,888 CU, 10 invocations, depth 2 |
| Same inbound VAA with borrower substituted as recipient | Rejected and rolled back | Token Bridge `Custom(0)`; no account changed on immediate re-read |
| Same inbound VAA with borrower as zero-fee recipient | Success, fully repaid | Encoded fee was zero; borrower delta remained `0`; the intended recipient still received exactly 101,000,000 raw USDC |

The outbound funded control is important: it proves the constructed Token Bridge instruction actually moved value, while the +1 case proves that value consumed by Wormhole cannot also repay the lender. The inbound control independently proves that a large same-mint flash balance does not relax the VAA-designated recipient binding. No successful case left unauthorized net gain after repayment.

### Decimal truncation boundary

Wormhole normalizes native tokens to at most eight decimals using `divisor = 10^(max(decimals, 8) - 8)`. USDC has six decimals, so its divisor is 1 and no sub-unit truncation exists. WSOL has nine decimals, so its divisor is 10:

| Project 0 / Wormhole amount | Result |
|---|---|
| Borrow 2–9 raw WSOL; bridge 1 raw | Success; Token Bridge posted a zero-amount message, custody delta `0`, Project 0 vault delta `0`, full repayment |
| Borrow and bridge 9 raw WSOL | Success; largest sub-threshold value, custody delta `0`, full repayment |
| Borrow and bridge 10 raw WSOL | Wormhole moved 10 raw to custody; repay then failed for insufficient funds; atomic rollback matched all pre-snapshots |
| Borrow and bridge 11 raw WSOL | Wormhole moved the truncated 10 raw and left one raw dust; repay still lacked 10; atomic rollback matched all pre-snapshots |

This is an exact rounding boundary, but it is not a drain. Amounts 1–9 create zero-value messages without removing loan principal; amounts 10 and above remove real principal and cannot complete repayment unless independently funded.

### Repetition, refresh, alias, and ordering limits

- Eight one-unit KLend-funded Wormhole outbound legs succeeded and fully repaid: 2,346 bytes, 32 accounts, 12 instructions, 854,257 CU, 62 invocations, depth 3. Nine legs reached 64 logged invocations and failed with `MaxInstructionTraceLengthExceeded`; the transaction rolled back. A 12-leg message was still only 3,034 bytes with 36 accounts and 16 instructions, but RPC/runtime sanitization rejected its account offsets before execution.
- Seven Project 0-funded sub-threshold Wormhole legs succeeded and fully repaid: 2,282 bytes, 33 accounts, 14 instructions, 747,926 CU, 57 invocations, depth 3. Eight legs failed with `MaxInstructionTraceLengthExceeded` and rolled back.
- A real KLend `RefreshReserve` immediately before borrow, between borrow and Wormhole, between Wormhole and repay, and after repay succeeded in every placement. Each shape was 1,192 bytes, 26 accounts, 6 instructions, 170,970–172,058 CU, and fully repaid with only the intended one-unit USDC custody movement.
- Aliasing Wormhole custody to the KLend supply vault failed in Token Bridge derivation checks; aliasing Wormhole source to the KLend supply vault failed in SPL Token authorization. Both rolled back. Wormhole before the correctly indexed flash pair and Wormhole after the flash pair both succeeded only as ordinary pre-funded one-unit transfers; the loan still fully repaid. Repay-before-borrow failed `InvalidFlashRepay` / `Custom(6033)`.

For all 18 executed runtime failures, the simulator returned null requested post-accounts; the harness therefore immediately re-read every watched account from confirmed mainnet, and all exact snapshots matched their corresponding pre-reads. The separately rejected 12-leg encoding never entered execution. These checks reinforce, rather than change, the audit disposition: the tested flash liquidity increased transient capital and exercised hard runtime limits, but did not produce an unauthorized residual asset gain.

## Source-level checks

The auxiliary source review covered the principal custody exits and replay controls:

- `solana/modules/token_bridge/program/src/api/complete_transfer.rs`: registered endpoint derivation, canonical custody derivation from mint, destination/mint/custody binding, custody signer PDA, VAA token address/chain/recipient checks, and claim consumption before CPI transfers; analogous checks were reviewed for wrapped transfers.
- `solana/modules/token_bridge/program/src/api/complete_transfer_payload.rs`: recipient/redeemer binding, including the recipient-program `"redeemer"` PDA route, and token-account owner binding before transfer.
- `solana/bridge/program/src/accounts/claim.rs`: claim PDA seeds include emitter address, big-endian emitter chain, and big-endian sequence, with one-time account creation.
- `solana/modules/token_bridge/program/src/api/governance.rs`: governance emitter/chain and governance-action claim checks.

No source-only hypothesis from these paths survived as a demonstrated unauthorized custody release in the current-binary legacy SPL matrix. Because source-to-ELF equivalence was not established, source review alone was not used to assert current-deployment safety.

## Token-2022 diagnostic

Three of the eight current-state Token-2022 candidates were attempted as positive controls. All three failed before token transfer after consuming 20,247 compute units, logging:

`IoError(Custom { kind: Other, error: InvalidAccountData })`

The three cases used Token-2022 destination and canonical custody accounts for mint `Ckit5s1Cpc3RdMh1HrhfW2nAy4PnkkgjXgXMeykbpump`. This result proves neither theft nor permanent loss. It is retained as an **unresolved compatibility/liveness lead** because there was no successful Token-2022 positive control and the exact deployed source/ABI was unavailable. No at-risk-fund amount is assigned to it.

## Findings and disposition

### Actionable fund-loss findings

None.

### Informational trust and coverage observations

1. The upgrade authority remains a privileged control plane for the upgradeable program. This is custody/governance trust, not an unprivileged exploit demonstrated here.
2. The available official source revision did not match the deployed config layout, so exact source-to-binary correspondence remains unverified.
3. Token-2022 positive controls failed with `InvalidAccountData`; the route remains unvalidated for liveness and untested for adversarial mutations.
4. Payload-ID-3 “transfer with payload” and wrapped-asset minting were source-reviewed but did not receive current-binary positive-control and mutation matrices in this run.
5. Core Bridge guardian-signature verification and upgrade-authority compromise were treated as upstream/trusted-boundary assumptions, not tested attack primitives.

These limitations prevent a blanket assurance over every bridge route. They do not change the narrower result: no tested path produced an unauthorized custody transfer.

## Reproduction artifacts

All artifacts are local, contain no private key material, and were generated without submitting transactions:

| Artifact | SHA-256 |
|---|---|
| `wormhole-token-bridge-current.js` | `15e43a2f5790c059caf2f48f8a6eb426ee08c4ee587b04a6a5f4550087141186` |
| `wormhole-token-bridge-deployment.json` | `241d93d59b350999c432c62f1f604ffa304915ccde7644374be10c8f2617edeb` |
| `wormhole-token-bridge-custody.json` | `2b2166a38206592e5e60d704e941db96de986b98d916ec0ab2a77a9688fbbfb3` |
| `wormhole-token-bridge-unclaimed.json` | `99ba23418c62f6923c88a3e776757f33f645ac79d5f615060ba63d5638b78893` |
| `wormhole-token-bridge-redeem-simulations.json` | `fea56532650bcfd827c948598593fc3e25afc24daf5478a1cb807d16b5ae026a` |
| `wormhole-token-bridge-token2022-diagnostics.json` | `d832095642830c699a3bfaf688ec697482cdbd940b5aa3c513f6f1d0bd6b40db` |
| `wormhole-token-bridge-flashloan-v1.js` | `aa138c9d307797b70468cc3d16647b2e5dc24a9556b2ebb2c173e733e4dbf97e` |
| `wormhole-token-bridge-flashloan-v1.json` | `bc51f82ffe9784121e6f125337cc6a080f4f1c7e55c4f81ce9af4341cb605bd1` |

## Bottom line

The live custody surface is large, but custody is not exploitability. The assessed unprivileged attacker hypotheses did not redirect or replay a valid legacy SPL redemption, and the only successful simulations paid the VAA-designated recipient. **Proven immediately exploitable amount: $0. Priced assets observed in canonical custody: at least $53.76 million, plus 599 unpriced nonzero vaults.**
