# Meteora DAMM v1 current-binary integration audit

Observed 2026-10-15. Target: `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` on Solana mainnet.

## Executive result

**No validated unauthorized drain or positive-net extraction was found. Demonstrated exploitable amount: $0.** I found no attacker-controlled callback edge from DAMM v1 into Dynamic Vault, no stale-state reuse in repeated same-transaction swaps or balanced exits, and no account substitution that redirected custody without the required owner or fee authority. A real zero-fee KLend USDC flash loan composed through DAMM v1 and both Dynamic Vault legs in a native Solana v1 transaction, repaid completely, and lost value to normal fees/rounding rather than gaining value.

No drain was called because the drain definition was not met: there is no unauthorized net gain after full flash repayment.

The most important distinction is custody versus exploitability. The 100-pool sample references 104 shared Dynamic Vault states with **$35.318 million of priced idle underlying custody**, but that amount is shared infrastructure custody, not DAMM-exclusive TVL and not an amount shown extractable through DAMM. The sampled DAMM pools' priced attributable Dynamic Vault claims were **$1.726 million**, and priced direct DAMM protocol-fee token custody was **$3,498**.

## Scope, binary identity, and limits

- Current program data account: `36CvGf4Db6N8ApGkh1F6PLGXK1SYFFBUiEDkJjPEvDL7`; upgrade authority: `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`; last deployment slot: **457,247,107**.
- Downloaded current program: 1,924,896 bytes; SHA-256 `0856d35fa348f8d3570194ff9fe36095f34f0fa64c4286c0de5e207b1a788b22`.
- Latest published SDK checked: `@meteora-ag/dynamic-amm-sdk@2.0.0`, AMM IDL metadata `0.5.7`, 30 instructions; saved IDL SHA-256 `3b914cf53b58608eba49d3ca31afa622e4437da992a6b04a26ebb9c237320d9f`.
- The on-chain Anchor IDL is stale (`0.5.2`, 26 instructions) and omits current-binary surfaces including `claim_protocol_fee2` and operator accounts. Current binary strings, live transactions, and the 0.5.7 SDK agree on the 30-instruction surface, but **exact source-to-current-binary equivalence is not established**. This is a current-binary/state/integration audit, not a source proof.
- Flux was preferred but no `flux` executable was available. I used throttled read-only RPC, historical transaction reads, and `simulateTransaction`; no transaction was signed or submitted.
- Simulations used `sigVerify:false`. For ordinary on-curve owners this models an authorized signature. It does not grant an attacker a key. For off-curve fee authorities it can manufacture a signer bit that a top-level transaction cannot produce; those direct successes are constraint probes, not exploit proofs.
- Official interface references: [DAMM v1 instructions](https://docs.meteora.ag/developer-guides/damm-v1/program/instructions.md), [DAMM v1 accounts](https://docs.meteora.ag/developer-guides/damm-v1/program/accounts.md), and [pool API](https://docs.meteora.ag/api-reference/damm-v1/pools/pools.md).

## Denominators and custody census

The API query was explicit and reproducible: page 1, size 100, `sort_key=tvl`, descending. It returned 100 pools from `total_count = 86,326`: **0.116% of listed pools**, selected as the API's top-TVL page, with $2.687 million aggregate API TVL.

| Measure | Result | Denominator / interpretation |
|---|---:|---|
| Decoded, program-owned, enabled pools | 100 | 100/100 sampled |
| Distinct Dynamic Vault states | 104 | Deduplicated across 200 pool legs |
| Required binding checks | 3,500 passed; 0 failed | 100 pools and their 200 legs |
| Canonical mint derivations | 201 matched; 99 did not | 300 derivations; 98 legacy vault LP mints and one permissioned pool LP mint were nevertheless explicitly state-bound |
| Priced pool legs | 129 | 129/200; 71 unpriced |
| Priced distinct Dynamic Vaults | 33 | 33/104; 71 unpriced |
| Priced DAMM-attributable vault claim | $1,725,713.87 | Only priced sampled legs |
| Priced direct DAMM fee-token custody | $3,498.14 | Only priced sampled legs |
| Priced distinct shared-vault idle custody | $35,318,016.80 | Deduplicated shared Dynamic Vault token accounts; not DAMM-exclusive and must not be added to pool claims |
| Priced distinct shared-vault total accounting | $40,735,068.83 | Includes strategy accounting; not all idle token custody |
| Vaults with non-default strategies | 2 | 2/104 distinct states |

Every sampled pool bound its API mints, two Dynamic Vault states, two pool-held vault-LP accounts, two protocol-fee accounts, and pool LP mint to decoded state. Token mints/owners, Dynamic Vault ownership, vault/token-vault PDAs, state-declared LP mints, token-vault authority, pool vault-LP authority, protocol-fee authority, pool LP mint authority, and tracked versus actual LP supply all matched. The single permissioned noncanonical pool LP mint and 98 legacy noncanonical Dynamic Vault LP mints are compatibility observations, not unbound authority.

## Swap and Dynamic Vault CPI binding

The current swap interface pins `vault_program` to `24Uqj9…` and the classic SPL Token program. It exposes no remaining-account callback list, arbitrary downstream program, transfer hook, or user-selected callback. Replacing the Dynamic Vault program with DAMM itself failed Anchor `ConstraintAddress` (3008). A true `DAMM → Dynamic Vault → attacker callback → DAMM` edge therefore was not reachable from the current interface.

A fresh successful swap was replayed at slots 457,345,968–971:

- One swap consumed 81,093 CU and moved 81,526 input raw units for 261,355 output units. The source decreased 81,526, the destination increased 261,355, the source-side protocol fee increased 40, and the two vault/token-account legs reconciled.
- Two identical swaps in the same transaction consumed 162,186 CU. Source and protocol-fee deltas doubled; output was 521,752 rather than a blindly duplicated 522,710, showing the second call used the first call's post-state.
- Wrong pool vault, cross-aliased vault token account, cross-aliased pool vault-LP account, wrong protocol-fee destination, identical source/destination, wrong Dynamic Vault program, and wrong user/owner all failed atomically (`InvalidVaultAccount`, `InvalidPoolVault`, `MismatchedTokenMint`, `IdenticalSourceDestination`, address constraint, or SPL owner mismatch).

No current evidence supports stale reserve reuse, caller-controlled CPI substitution, or cross-pool vault aliasing.

## Balanced LP exit

A real on-curve holder in pool `4Amz…69aT` held 154,794,336 raw pool LP. A balanced exit of 15,479 LP succeeded:

- pool LP: −15,479;
- token A delivered: 22,445,024 raw;
- token B delivered: 16 raw;
- pool-held vault LP and underlying Dynamic Vault balances decreased consistently;
- 91,567 total CU including idempotent destination-ATA setup.

Two exits in one transaction succeeded at 165,182 CU and doubled all relevant burns and outputs exactly. Wrong LP mint, substituting a pool vault-LP account as the user's LP, wrong pool vault, token-vault alias, pool-vault-LP alias, destination-mint alias, wrong Dynamic Vault program, and a signer that did not own the LP account all failed atomically. The current binary's explicit `InvalidLpOwner` (6064) check rejected both LP-account substitution cases.

This validates balanced exit and burn rounding for one constant-product pool and one holder. It does not cover every curve. No successful single-side exit appeared in the recent-history window, so `remove_liquidity_single_side` remains a stated gap.

## Fee withdrawal and claims

### Protocol fee

The live protocol-fee wrapper `pFee3t…` invoked current-binary `claim_protocol_fee2` successfully at slot 457,296,347, after the current deployment. A fresh replay moved exactly 284,906,660 raw wSOL from the bound DAMM protocol-fee account to the wrapper's treasury receiver. Receiver-as-source was rejected by the wrapper's `IncorrectATA` (6000); wrong pool, wrong `a_vault_lp`, and protocol-A/protocol-B aliasing failed DAMM `ConstraintHasOne` (2001).

Direct `claim_protocol_fee2` also succeeded when simulation forged the fixed authority `FkU5rQ…` as a signer. That is **not exploitable**: the key is an off-curve PDA (bump 253), so a real top-level transaction cannot sign as it. The observed wrapper's `invoke_signed` path is the live authorization boundary.

### Partner fee

For pool `7ns3…1cYZ`, the state-bound partner authority `67zLs…vic6` is also off-curve and has no account. Under a forged signer bit, the current binary transferred exactly the two recorded pending amounts—928,565,746,272 token-A units and 805,465,226,027 token-B units—and a second claim in the same transaction moved zero additional value. Replacing the authority with the payer failed `InvalidFeeOwner` (6038); wrong pool, `a_vault_lp`, or protocol-fee account failed `ConstraintHasOne`.

The authorized partner can choose any same-mint receiver, including its own fee source (a self-transfer that consumes its pending accounting) or another token account. That is receiver flexibility held behind the state-bound partner signature, not an outsider redirect. No unauthorized authority passed.

### Remaining fee gaps

The 6,000-signature history window contained 13 successful `claim_fee` calls, but the observed owners were off-curve locker authorities and their transient destinations later closed; I did not present a forged direct replay as an authorization result. The operator-style `withdraw_protocol_fees` and `zap_protocol_fee` paths had no positive current-state example in this sample. Conclusions for those surfaces are limited to static/current-IDL relations and the sampled state census; the active `claim_protocol_fee2` wrapper path received the dynamic test coverage above.

## Real v1 zero-fee flashloan stress

I composed current KLend program `KLend2g…` with DAMM pool `4Amz…69aT`, whose B mint is USDC. The source reserve was `AYL4L…VR2Z`, supply token account `8BkQ…eKjB`, and flash fee vault `5iLR…8cj`.

The current reserve bytes decode `flashLoanFeeSf = 0`. This is an **exact configured zero rate**, not a small nonzero fee rounded to zero. At pre-slot 457,348,632 the SPL supply held 7,820,864,800,722 raw USDC while reserve accounting reported 7,820,864,730,717 raw available.

| Atomic v1 case | Result |
|---|---|
| Borrow/repay 1 raw USDC | Success; owner, supply, and fee vault each net 0 |
| Borrow/repay available − 1 | Success; principal fully restored, fee vault net 0 |
| Borrow/repay exact available | Success; principal fully restored, fee vault net 0 |
| Borrow available + 1 | `InsufficientLiquidity` (6008), atomic failure |
| Flash borrow 100,000 → DAMM B→A→B → repay | Success; 1,172-byte v1, 28 addresses, 5 instructions, 237,830 CU, 14,584,529 loaded-account bytes |
| Same with `get_pool_info` before/between/after | Success; 1,264 bytes, 29 addresses, 8 instructions, 316,676 CU; identical economic deltas |
| Two small reverse-swap cycles → repay | Success; 1,258 bytes, 352,140 CU |
| Four small reverse-swap cycles → repay | Success; 1,430 bytes, 11 instructions, 635,649 CU |
| Six cycles | Atomic failure at instruction 10: `MaxInstructionTraceLengthExceeded`; 1,602 bytes and 676,956 CU |
| Source = destination alias | `IdenticalSourceDestination` (6019), atomic failure |

The positive 100,000-raw round trip started with 897 raw USDC owned by the signer. The loan supply and flash fee vault ended unchanged; the user ended **501 raw USDC lower** and with zero residual token A. DAMM protocol fees rose by 50 raw USDC and 65,266,535 raw token A. The Dynamic Vault idle balances, pool vault-LP balances, and Dynamic Vault LP supplies reconciled to the emitted swap events. DAMM pool LP supply remained unchanged, as expected for swaps. The wire SHA-256 is `0c67281773345272d3c1cc970b88dd6b90cc681428863418ad54339271b96215`; full wire Base64 and the ordered 28-account list are in the JSON artifact.

At the dust boundary, 1 raw USDC failed in the Dynamic Vault with `AmountMustGreaterThanZero`; 2 failed `ZeroTradingTokens`; and 3 reached the forward swap but its reverse rounded to zero. Exact-output reverse amounts were slot-sensitive because the shared Dynamic Vault share price moved between simulations: a four-raw exact quote could fail SPL insufficient funds. Using a conservative reverse amount, however, two and four repeated four-raw cycles completed and repaid. Four cycles left 3,777,482 raw token A and lost 16 raw USDC. At the independent DefiLlama price used in the census (approximately $0.0000007635 per whole token A, 6 decimals), that residual is worth about $0.0000029 versus $0.000016 lost. These are ordinary dust/share-rounding outcomes and an integration warning against stale exact-output reuse, not unauthorized extraction.

The sampled pool's priced USDC claim was 18,155,737,579 raw. Forward probes at claim − 1, claim, and claim + 1 all executed, but a full reverse at the claim amount returned 18,105,763,924 raw and could not repay 18,155,737,579; the transaction rolled back. At the KLend near-available amount, the reverse returned 7,816,872,492,392 versus 7,820,864,730,716 borrowed, so repayment likewise failed and rolled back. These are slippage/fee capacity limits, not a reserve-accounting bypass.

The first composition ceiling was the runtime instruction-trace limit at six cycles, well before Solana v1's 4,096-byte, 64-address, or configured 1.4M-CU limits. DAMM v1 is not CLMM/DLMM and has no tick arrays or bins, so tick-crossing and zero-liquidity-bin tests are inapplicable. Its current swap surface also has no permissionless oracle refresh or crank. `get_pool_info` observation barriers before, between, and after both swaps did not change the outcome.

## Recent instruction denominator

The history scan fetched 6,000/6,000 target-program transactions from slots 457,343,761 down to 457,319,163 with zero nulls. It found 4,588 swaps (2,520 successful) and 13 `claim_fee` calls (all successful). It found no balanced exit, single-side exit, protocol-fee claim, or partner-fee claim in that window. This is a bounded activity window, not proof that those instructions are unused; positive current-state balanced-exit and protocol-fee controls came from other live state/history.

The protocol-fee wrapper scan covered 3,000 wrapper signatures and fetched 600 transactions before finding current-binary `claim_protocol_fee2` successes at slots 457,296,347 and 457,279,747. The older success at 457,246,449 predates the current deployment and was not used as current-binary proof.

## Conclusion and residual risk

The tested current binary consistently enforces pool-to-vault, vault-to-token-account, vault-LP, protocol-fee, mint, program-ID, and owner/authority bindings. Sequential same-transaction calls consume updated state. A real, maximum-accounted-liquidity zero-fee loan repays exactly, while DAMM-funded round trips reconcile to normal loss and fail atomically when underfunded. No unauthorized net gain remains after repayment.

Residual risk is concentrated in untested breadth rather than a demonstrated defect:

- only 100/86,326 API pools were state-censused, although they were the explicit top-TVL page;
- 71/104 distinct vaults and 71/200 pool legs lacked an independent USD price;
- single-side stable exits, operator withdrawal, zap, and a live locker-authority `claim_fee` mutation were not dynamically covered;
- exact source equivalence to the current binary is unavailable;
- the program remains upgradeable by `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`, so future deployments invalidate this snapshot;
- true callback reentrancy was not constructed because the current account interface exposes no attacker-selected callback edge; this conclusion should be rechecked after any binary/interface change.

## Reproduction artifacts

- `damm-v1-current-resume.so` — current deployed binary.
- `damm-v1-sdk-2.0.0-resume.idl.json` — published current SDK IDL used for account layout/instruction naming.
- `damm-v1-top100-resume-api.json` — exact API page and denominator.
- `damm-v1-integration-census-resume.json` — pool/vault bindings, custody, pricing, and per-pool evidence.
- `damm-v1-recent-instructions-resume.json` — 6,000-signature instruction census.
- `damm-v1-swap-composition-simulation-resume.json` — swap controls, aliases, and same-tx double execution.
- `damm-v1-balanced-exit-simulation-resume.json` — balanced LP exit controls and mutations.
- `damm-v1-protocol-fee-wrapper-history-resume.json` and `damm-v1-protocol-fee-simulation-resume.json` — live wrapper history and current-state protocol-fee tests.
- `damm-v1-partner-fee-simulation-resume.json` — partner authority/binding/accounting tests.
- `damm-v1-kamino-flash-stress-resume.json` — exact v1 wire bytes, ordered accounts, CU/data usage, dust/capacity/repetition cases, and pre/post account images.
- Corresponding `scan-*.js` and `sim-*.js` files are read-only reproducers and contain no RPC credential.
