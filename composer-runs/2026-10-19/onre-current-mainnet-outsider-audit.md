# OnRe current mainnet-beta outsider audit

Date: 2026-10-19  
Program: `onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe`  
Attacker model: fresh unprivileged outsider  
Result: **no reportable outsider vulnerability reproduced**  
Safety: **no transaction was broadcast**

## Outcome

The highest-value post-deploy USDG payout located on the live redemption vault was an `OpenSwapSell` payment of **433,119.784833 USDG**. Replaying its exact instruction data in a signed current-mainnet-backed fork with a fresh outsider succeeded only when the ONyc debit ATA and USDG payout ATA were both replaced with that outsider's canonical accounts. Redirecting the payout to the historical recipient failed with OnRe error 6030, `InvalidUserTokenOutAccount`; retaining the historical debit and payout accounts while changing only the signer failed with error 6111, `InvalidAmount`.

The only surviving value path was therefore the intended permissionless USDG -> ONyc offer take followed by ONyc -> USDG prop-AMM sell. Its maximum successful sampled two-provider transaction used **12,613,844.350289 USDG**, fully repaid KLend and Jupiter, closed the outsider's transient ONyc and request state, and ended with outsider USDG equity **-2,862,135.646230** and protocol USDG equity **+2,862,135.646230**. Lender-vault delta and total USDG conservation residual were both zero.

This is a bounded no-finding result, not proof that every OnRe or ecosystem path is safe. The reviewed official source was not reproducibly matched byte-for-byte to the deployed ELF, and source outside the prioritized live payout, withdrawal, offer, prop-AMM, and token-account-binding surfaces was not exhaustively audited.

## Current deployment and liquidity

The read-only mainnet observation was recorded at slot **458,755,266**:

| Item | Current evidence |
|---|---|
| ProgramData | `91o8wFyxszM4DeQ5R6X6wJdyn9e8VRnsreVBTLb7Yrpg` |
| Deploy slot | `452310149` |
| Upgrade authority | `FvmhydbpHGQzMUp51GmhB1fwsrkyfmnRsTg7oPwDe25f` |
| Deployed ELF | 1,914,560 bytes; SHA-256 `4e4b35c8d3c747fb5c775635115cfc0ce91f1a995805cad4a3cb34d4881e2d6e` |
| Official source | `onre-finance/onre-sol` commit `c0490831f438074562ebf51e437ca5f8e027596b` |
| State | boss `45Yn...jaJ5`; worker `auth...krT`; kill switch off |
| Permissionless USDG offer | enabled; permissionless; 0 bp offer fee; no approval required |
| Current price | `1.157164052` USDG/ONyc |
| USDG redemption vault | `2XgTjcME2M18RgUzoJfaXbAeM5VGiigYCzYBegUSAGZC` |
| Redemption-vault balance | **29,899,026.662144 USDG** |
| Prop-AMM sell fee | 30 bp, with a minimum 1 ONyc input fee |

The deployed ELF embeds the official repository URL and reviewed OnRe module paths. A local build from the official commit produced SHA-256 `0187b08a...80bfe2`, not the deployed hash. This is a correspondence limitation: a non-reproducible local build mismatch neither attests nor disproves source equivalence.

## Exact post-deploy payout receipt

The receipt scan walked the live USDG redemption-vault history back to the deployment slot in one page: **430** post-deploy signatures, **428** successful transactions, and **415** identified payouts. The highest-value receipt was selected by observed positive USDG recipient delta paired with the equal negative vault delta.

| Field | Receipt |
|---|---|
| Signature | `1rRX1GpfdxFm6aikrKz3r2krjBCjhLkUk2tvtPRPyhVjv5gAYyPK4Mkav9BqNNAvqQJ53B2XpaFgQkeq8cxgYLp` |
| Slot / UTC | `454852733` / `2026-10-09T11:27:33Z` |
| Handler | `OpenSwapSell` |
| Historical signer | `ASQ4kYjSYGUYbbYtsaLhUeJS6RtrN4Uwp4XbF4gDifvr` |
| ONyc debit ATA (account 12) | `FKYixac9jrwVixJcn9JekueGsyJSg6TeJveeQVw55KUF` |
| USDG payout ATA (account 13) | `6XgLBiH2A7jZyZmsqxQeLLYwErD8CTvEh4VLfKCcNXy` |
| Signer account position | account 26 |
| Input | **376,159.000000000 ONyc** |
| Minimum output | **432,686.665048 USDG** |
| Observed payout | **433,119.784833 USDG** |
| Redemption-vault delta | **-433,119.784833 USDG** |
| Exact Base58 instruction data | `9Z1W5EPwhCCQzCFJFNYjs9rgopkUqtrgo` |

The recipient ATA owner was the transaction signer, and the vault debit exactly matched the recipient credit.

## Fresh-outside signed mutation

All four mutation cases were freshly signed by outsider `8nR76d6TJP4oANQaVUvEv156Rde1PHFu59w3UXFa9Kwd` and simulated with signature verification enabled. Each was a one-instruction v1 transaction of 1,197 bytes and 32 accounts. Synthetic fork seed balances are excluded from gain and every simulation rolled back.

| Case | Result | Economic meaning |
|---|---|---|
| Exact historical data; accounts 12, 13, and 26 remapped together to the fresh outsider | Success | Outsider paid **376,159 ONyc**, including **1,128.477 ONyc** sell fee, and received **433,918.040869 USDG** at the current price. This is an intended paid sell. |
| Fresh signer and debit ATA; payout redirected to historical recipient ATA | Rejected: 6030 `InvalidUserTokenOutAccount` | The payout cannot be redirected away from the signer's canonical USDG ATA. |
| Only signer changed; historical debit and payout ATAs retained | Rejected: 6111 `InvalidAmount` | The debit ATA also remains canonically bound to the signer. |
| Fresh signer/accounts, historical amount, minimum output set to zero | Success | Positive control confirms the current paid path works; it does not release free protocol value. |

The decisive source control is direct: `user` is a required signer in `prop_amm/sell.rs:154-155`; the ONyc input is loaded only after canonical ATA derivation against `user` at lines 234-240; the USDG output is created or loaded as the same signer's canonical ATA at lines 241-252. The shared helper derives the ATA from authority, mint, and token program and rejects a different address in `utils/token_utils.rs:15-27`.

Other prioritized payout/withdraw routes had independent gates:

- `fulfill_redemption_request` derives the request PDA from the stored offer, redeemer, and request ID, checks the supplied redeemer against stored state, requires the configured worker, and pays the redeemer's canonical ATA (`fulfill_redemption_request.rs:209-270`).
- Reserve-vault withdrawal requires the state-bound boss signer and pays the boss's canonical ONyc ATA (`withdraw_reserve_vault.rs:11-51,70-78`).
- Configurable-vault withdrawal is permissionless to trigger, but its destination must equal the boss-configured non-default destination and its token account is the canonical ATA for that destination (`configurable_vault/withdraw.rs:28-57,75-100`).

## Maximum two-provider flash composition

The intended offer/sell cycle survived account-binding checks, so it was tested with real currently configured USDG flash providers. All composed transactions were signed v1 messages, simulated with `sigVerify: true`, and stayed below the requested 4,096-byte/64-key envelope.

Provider boundaries observed on the current-mainnet-backed fork:

| Provider | Usable boundary | Boundary evidence |
|---|---:|---|
| KLend reserve `ESCk...avp` | **3,230,501.637473 USDG** | Exact available amount succeeded; +1 raw USDG unit failed with KLend 6008 `InsufficientLiquidity`; flash fee scalar was zero. |
| Jupiter, standalone | **9,383,343.586676 USDG** | Maximum standalone signed roundtrip; Jupiter fee was 0 bp. |
| Jupiter with full KLend, provider-only shape | **9,383,343.516798 USDG** | +1 raw unit failed with Jupiter 6035 `MaxUtilizationReached`. |
| Project0 bank `Dj2C...Tva` | no usable standard roundtrip | Its vault displayed **3,224.058164 USDG**. Probes from 0.001 through 1,000 USDG and half-vault failed with 6008 `InvalidBankAccount`; exact displayed liquidity failed with 6026 `IllegalUtilizationRatio`. |

Project0 is therefore a concrete third-provider blocker in the tested current state. It was not replaced by a prototype or synthetic lender; the maximum real composition used the two usable providers.

The complete transaction-shape search included both borrows, permissionless offer take, prop-AMM sell, ONyc account close, and both exact repayments. Its maximum successful sample was:

| Measurement | Result |
|---|---:|
| KLend allocation | **3,230,501.637473 USDG** |
| Jupiter allocation | **9,383,342.712816 USDG** |
| Total routed | **12,613,844.350289 USDG** |
| Adjacent Jupiter failure | **9,383,342.712817 USDG** |
| Wire | v1; 2,066 bytes; 52 accounts; 8 instructions; 1 required signer |
| Compute | 495,722 units |
| ONyc sold after fee | **10,867,951.519494776 ONyc** |
| ONyc sell fee | **32,701.960439804 ONyc** |
| USDG returned by prop-AMM sell | **9,751,708.704059 USDG** |
| Final outsider USDG equity | **-2,862,135.646230 USDG** |
| Final protocol USDG equity | **+2,862,135.646230 USDG** |
| KLend supply-vault delta | **0** |
| Jupiter vault delta | **0** |
| USDG conservation residual | **0** |

Both repayment instructions were logged, both lender vaults were conserved, the outsider ONyc account was closed or zero, and the redemption request was closed. The signed wire SHA-256 was `b5bf40ea1725550ed224378d39e84e0370e6dade4131435cfe873320c0a7c324`.

Jupiter's maximum utilization boundary moves with Clock-accrued interest. Accordingly, `9,383,342.712816` is the maximum **successful sampled** amount and the adjacent failure was observed later; it is not presented as a timeless mainnet constant. This dynamic movement does not affect the economic conclusion: every successful fully repaid sample was outsider-negative.

## Classification and exact blockers

No reportable outsider vulnerability was demonstrated.

1. Payout substitution is blocked by signer-derived canonical ATAs for both the debit and payout legs.
2. Worker redemption is blocked by the stored request/redeemer identity and configured-worker check.
3. Direct reserve withdrawal is boss-only; configurable withdrawal cannot redirect the stored destination.
4. The permissionless same-price cycle is economically negative after the 30 bp/minimum ONyc fee and prop-AMM pricing haircut.
5. KLend and Jupiter repayments are atomic and reconciled to zero lender delta; Project0 supplied no valid third-provider roundtrip in current state.

## Evidence artifacts

- `onre-mainnet-audit.json` — current program, ELF, source identity, configuration, price, vaults, and initial current-state cycles.
- `onre-payout-receipts.json` and `onre-payout-receipt-scan.js` — post-deploy receipt census and exact selected payout.
- `onre-payout-mutation-signed.json` and `onre-payout-mutation-signed.js` — fresh-outsider signer/recipient/debit mutations.
- `onre-focused-multiflash-signed.json` and `onre-focused-multiflash-signed.js` — provider inventories, exact/provider-only boundaries, Project0 blocker, and asymmetric controls.
- `onre-max-shape-cycle-signed.json` and `onre-max-shape-cycle-signed.js` — complete OnRe transaction-shape maximum successful sample and final equity reconciliation.
- `onre-current.so` — exact downloaded deployed program bytes used for the Oct 19 hash.

No RPC URL, credential, or private key is stored in these artifacts. The deterministic outsider private key was not persisted. No operator was contacted and no transaction was submitted.
