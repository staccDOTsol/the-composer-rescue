# Raydium CLMM remaining exits and atomic flash-composition audit

Date: 2026-10-15  
Program: `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`  
Outcome: **no validated unauthorized withdrawal, vault drain, or positive-residual flash composition**

This report closes the requested position fee/reward, protocol/fund-fee, account-substitution, atomicity, source-to-current-binary, and flash-funded boundary work. All chain interaction was read-only: `get*` RPC methods and `simulateTransaction` with `sigVerify:false`. No transaction was signed, submitted, or sent to mainnet, and the project team was not contacted.

The prior custody result remains context, not a loss claim: 352 sampled pool PDAs and 704 vault PDAs were authority-verified, with a **$151,535,445.06 priced gross custody lower bound** at slots 457,328,170-457,328,239. Gross custody is not exploitable value. Nothing in this report converts that inventory into an exploit claim.

## Result at a glance

- Authorized protocol-fee, fund-fee, remaining-reward, and position controls all transferred the expected tokens on the deployed binary.
- Removing or substituting the relevant signer, pool, config, vault, mint, recipient mint, token program, tick state, or NFT ownership failed before any committed unauthorized transfer.
- A valid instruction followed by an unauthorized instruction failed atomically; simulated post accounts were absent because the entire transaction rolled back.
- Native Solana v1 Kamino/KLend and Project 0 flash envelopes successfully funded Raydium CLMM swaps and complete same-asset round-trips. Successful lender vault/principal deltas were zero.
- The selected KLend reserve's configured flash fee field was the literal integer `0`; this is exact zero-rate configuration, not a small positive fee rounded down at the tested amount.
- Every successful round-trip had a negative USDC residual and zero non-USDC residual. No route produced net gain, let alone unauthorized gain.
- No security finding met the required bar of a successful unauthorized transfer.

## Deployment and source identity

Current deployment revalidation:

| Field | Value |
|---|---|
| ProgramData | `HzD2cCXXT3UQNjMMY6kDv9w6gZ9qquSdfoGXrLL3LXx` |
| Upgrade authority | `FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK` |
| Last deployed slot | 451,479,902 |
| Allocation | 1,700,160 bytes |
| Current executable SHA-256 | `b1e8b3eb1c0027b3c05b059dec773661cbe93e2b304c1166e575b502ee2ca6d2` |
| Official-source HEAD | `ed1eb41519d5355755f7df52b43fa9610938b60b` |
| HEAD timestamp | 2026-09-29 00:29:16 UTC |
| Rebuilt executable SHA-256 | `31b1abbd1d286502e3b267593738a4b089c32bffdf102ca83f7618c14a40a86b` |

The deploy block time was 2026-09-29 00:27:11 UTC, about two minutes before the reviewed HEAD timestamp. A pinned-toolchain rebuild matched the deployed `.text`, `.data.rel.ro`, dynamic, symbol, and relocation section sizes, but rebuilt `.rodata` was eight bytes larger (`0x65bc` versus deployed `0x65b4`) and the bytes were not identical. This is strong source-era evidence, **not exact reproducibility**. Source review below is corroborating evidence; deployed `simulateTransaction` results are decisive.

Three live spot-check pools (`3nMF...`, `3uc...`, and `HpgV...`) were rederived from their stored config/mints/bump. Both vault PDAs per pool rederived exactly, were owned by SPL Token, had the stored mint, and named the pool PDA as token authority at slot 457,346,053.

## Privileged protocol and fund-fee exits

Pool `3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF` had nonzero protocol and fund counters at the control snapshot. Each control requested 1,000 raw units from each vault.

| Case | Deployed result | Transfer evidence |
|---|---:|---|
| `collect_protocol_fee` | success, 15,837 CU | two transfers of 1,000; both protocol counters reduced by 1,000 |
| protocol fee twice atomically | success, 31,674 CU | four transfers of 1,000; two per mint |
| `collect_fund_fee` | success, 15,840 CU | two transfers of 1,000; both fund counters reduced by 1,000 |
| fund fee twice atomically | success, 31,680 CU | four transfers of 1,000; two per mint |

The config owner/admin gate for protocol fees and fund-owner/admin gate for fund fees were then mutated independently:

| Mutation | Result |
|---|---|
| Attacker authority and attacker-selected destinations | `NotApproved` (6000) |
| Correct authority without signer privilege | `AccountNotSigner` (3010) |
| Foreign pool/config cross-wire | `ConstraintAddress` (2012) |
| Swap the two pool vaults | `ConstraintRaw` (2003) |
| Swap vault mint accounts | `ConstraintAddress` (2012) |
| Recipient aliases its source vault | `ConstraintDuplicateMutableAccount` (2040) |
| Swap recipient mints | SPL Token custom 3, mint mismatch |
| Swap Token and Token-2022 programs | `InvalidProgramId` (3008) |
| Valid collection followed by unauthorized collection | second instruction failed; whole transaction rolled back |
| Unauthorized collection followed by valid collection | first instruction failed; valid instruction did not run |

The destination is intentionally selectable by the valid privileged signer. That is administrative routing, not an attacker-controlled bypass.

## Remaining reward exit

Pool `3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv` reward index 0 was expired and fully updated:

- total emitted: 63,007,189,032 raw RAY
- already claimed: 62,453,576,793
- still owed to positions: 553,612,239
- reward-vault balance: 4,725,523,085
- legitimately reclaimable remainder: **4,171,910,846 raw RAY**

The correct reward authority control transferred exactly 4,171,910,846 to its selected RAY destination and left 553,612,239 in the vault. Invoking the instruction twice in one transaction succeeded; the second invocation was a no-op. A different RAY destination also succeeded when selected by the correct signer, as designed.

Attacker authority failed `RequireKeysEq` (2502); missing signature failed 3010; pool and reward-vault substitutions failed 2502; mint substitution failed 2012; self-aliasing the reward vault failed 2040; and token-program substitution failed 3008. A valid reclaim followed by an unauthorized reclaim failed atomically and rolled back the valid transfer.

Reward index 3 reaches a deployed bounds panic (`ProgramFailedToComplete`, source-era line 80). The abort affects only the caller's transaction and rolls back all writes. No persistent state change, third-party denial of service, or transfer was demonstrated, so this is a robustness defect rather than a reportable security finding.

## Position fees, rewards, and liquidity rounding

The live control position was:

- personal position: `FDZHJV8ktDRkxr8auQ47gajjeXinSjQJjhW7cm3Vkixj`
- pool: `3nMFwZXwY1s1M5s8vYAHqd4wGs4iSxXE4LRoUMMYqEgF`
- Token-2022 position NFT account: `D1VoQs4Korax4vYWNnHj2q2GjbahSE9FgtLejYzawFLP`
- NFT owner/signer: `4SzSQ4y9GoPjaPQhmCoEfoVU55u8boXJDWxUfPcZWkLa`
- position liquidity: 8,594,677,882 raw liquidity units

An owner-authorized `DecreaseLiquidityV2` with liquidity delta zero successfully collected 84,599,662 raw WSOL, 7,210,402 raw USDT, and 192,253 raw RAY in the observed state. Running the same zero-delta collection twice atomically succeeded and made the second collection a no-op.

The concentrated-liquidity analogue of LP burn rounding was tested explicitly:

| Requested liquidity decrease | Result | Token transfers |
|---:|---:|---|
| 0 | success | 84,599,662 WSOL; 7,210,402 USDT; 192,253 RAY |
| 1 | success; position liquidity -1 | identical to delta 0; added principal rounded to zero |
| 2 | success; position liquidity -2 | identical to delta 0; added principal rounded to zero |
| full 8,594,677,882 | success; position liquidity 0 | 84,599,662 WSOL; 260,992,170 USDT; 192,253 RAY |
| full + 1 | `RequireGteViolated` (2506) | no transfer; atomic rollback |

Raydium CLMM has position-NFT liquidity rather than a fungible pool LP mint, so there is no pool-wide LP-token supply to reconcile on these instructions. The 1- and 2-unit cases show owner-authorized dust burning through floor rounding, not value creation: no extra token was received, no other position was debited, and an attacker cannot invoke the path without the NFT owner signer.

Owner, NFT amount/owner, personal-position/pool, vault, tick-array, recipient-mint, and token-program mutations were rejected with 2015, 3010, 2003, 2012/2014, 2040, 3008, or 2502 as appropriate. Supplying a foreign reward vault failed after earlier simulated CPIs, but the complete transaction rolled back. A valid position collection followed by an attacker-owned collection likewise rolled back atomically.

One intentional but sharp behavior remains: the valid NFT owner can set its reward recipient equal to the reward vault. The transaction succeeds, performs a token self-transfer, and clears the position's reward credit while the vault balance is unchanged. This can burn the owner's own claim, but no unprivileged party gains value.

## Exact-zero-fee KLend/Kamino evidence

The reserve census decoded all 619 current KLend reserve accounts at slots 457,347,933-457,347,944 using reserve offset 4904 and scale `2^60`:

- 562 reserves had the literal `flash_loan_fee_sf = 0`
- 43 had a positive rate
- 14 were disabled
- 441 were active, liquid, and exact-zero-rate

This distinction matters: the selected USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` had status 0, emergency mode 0, and `flash_loan_fee_sf` exactly `0`. It is not a positive fee that happened to round to zero for dust.

At slot 457,352,096 its current available-liquidity field was 8,011,866,795,993 raw USDC and its supply vault held 8,011,866,865,998. Native-v1 controls established the exact borrowing boundary:

| Amount | Result |
|---:|---|
| 1 raw USDC | success; borrower, supply vault, and fee vault net deltas all 0 |
| available - 1 | success; all three net deltas 0 |
| exact available | success; all three net deltas 0 |
| available + 1 | KLend `InsufficientLiquidity` (6008) |

Borrow without repay, repay before borrow, duplicate borrow, and repay amount minus one all failed the KLend flash envelope and rolled back. Permissionless Raydium `UpdateRewardInfos` before, between, after, and at all three placements around borrow/repay did not change principal or fee reconciliation.

## Atomic v1 swap stress

Every composition used a real native-v1 wire, inline accounts only, a 4,096-byte ceiling, and a 64-inline-account ceiling. The source payers `Dsg7...` (Kamino) and `MNGR...` (Project 0) are on-curve accounts from successful historical source transactions; there is no PDA signer seed. `sigVerify:false` suppresses cryptographic signature verification only for read-only simulation. Account signer flags and program signer checks remained active.

### Deep USDC/USDT pool

Pool `BZtgQEyS6eXUXicYPHecYQ7PybqodXQMvkjUbP4R8mUU` showed the exact CLMM dust threshold: 1 raw USDC failed `TooSmallInputOrOutputAmount` (6022), while 2 raw USDC succeeded and produced 1 raw USDT.

With Kamino/KLend funding, a 100,000-raw round-trip repaid the full flash principal, left USDT at zero, left both KLend vaults unchanged, and lost 22 raw USDC to the pool. Two complete round-trips lost 44 raw USDC. Interleaving reward updates produced the same 22-raw loss.

Project 0 independently reproduced the result in its start/borrow/repay/end envelope:

- its lender rejects a 1-raw borrow with 6040 but accepts 2 raw;
- 100,000-raw deep round-trip: lender delta 0, USDT residual 0, loss 22 raw USDC;
- two round-trips: lender delta 0, USDT residual 0, loss 44 raw USDC.

Project 0's successful 100,000 cases used 25 inline accounts and 1,140 bytes; two round-trips used 25 accounts and 1,258 bytes. The equivalent Kamino cases used 24 accounts and 1,076/1,194 bytes. Transaction shape was nowhere near either requested limit.

### Thin pool, repeated reverse legs, and tick boundary

Pool `121XWup4g8R2iFhN6jRMtx9W423JbfJk4AqA753sUExw` was selected from current state with 119,421,442 raw USDC and 115,210,262 raw partner-token units in its vaults, liquidity 1,412,880,182, current tick -2121, tick spacing 60, and only the current tick array (`start=-3600`) initialized in the tested direction.

Dust behavior differed from the deep pool: inputs 1 and 2 failed 6022; 3 succeeded and produced 1 raw partner token. The funded round-trip matrix was:

| Case | Result | Residuals and lender reconciliation |
|---|---:|---|
| Kamino 100,000 round-trip | success | -501 USDC; partner 0; supply/fee vaults 0 |
| Kamino reverse split into 3 legs | success | -505 USDC; partner 0; supply/fee vaults 0 |
| Kamino round-trip with reward updates interleaved | success | -501 USDC; partner 0; supply/fee vaults 0 |
| Kamino 50,000,000 round-trip | success | -245,862 USDC; partner 0; supply/fee vaults 0 |
| Project 0 100,000 round-trip | success | -501 USDC; partner 0; lender vault 0 |
| Project 0 two 100,000 round-trips | success | -1,002 USDC; partner 0; lender vault 0 |

Binary search pinned the tick-array capacity transition to one raw unit:

- **95,680,947 raw USDC** reaches the reverse instruction and produces 72,785,372 raw partner units.
- **95,680,948 raw USDC** fails the forward swap with deployed custom 6023, consistent with source-era `NotEnoughTickArrayAccount`.

The last valid Kamino amount completed the reverse, repaid the flash principal, left the partner-token residual at zero, and lost 464,176 raw USDC. Concentrated state reconciled as follows: liquidity remained 1,412,880,182; tick moved from -2121 to -2124; the current tick array and observation account changed; protocol fee counters changed by +28,704/+21,835; fund counters changed by +9,568/+7,278; the USDC pool vault gained exactly 464,176; and the partner vault returned to its starting balance. This is ordinary path-dependent fee/slippage state, not an invariant break or unauthorized extraction.

An independent Jupiter quote at slot 457,352,504 valued 464,176 raw USDC at 464,633 raw USDT (462,310 minimum at 50 bps, reported price impact 0). Because the only residual was **negative** USDC and every non-USDC residual was zero, no positive economic result exists to attribute to the composition.

Project 0 reached the same forward output at that boundary but its complete transaction failed at repay with SPL Token custom 1: the source authority's 17,229-raw USDC seed was smaller than the 464,176-raw round-trip loss. The entire transaction rolled back. This is the exact runtime blocker; it was not a v1 size, account-count, Raydium capacity, or lender-principal bypass.

For each successful Project 0 control, the lender vault delta was zero. Per-case Anchor decoding showed exact pre/post equality for bank total asset shares (`1802943862676219339430683594`), total liability shares (`1560977359111050704402109388`), and program fees (`0`). The margin account had no active persistent balance slot for the selected bank before or after, so no flash debt, asset share, liability share, or premium survived the transaction.

### Substitution and ordering

Inside a valid Kamino flash envelope, aliasing the Raydium output to the output vault failed 2040, aliasing input to the input vault failed 2040, and swapping Token/Token-2022 program accounts failed 3008. Repay-before-borrow, missing repay, duplicate borrow, and short repay were rejected by the lender. These failures returned no simulated account states, confirming atomic rollback rather than a partial transfer.

The CLMM does not consume an external price oracle for these swaps. Its observation account was updated on successful swaps, and explicit permissionless reward-crank transitions were placed before/between/after the swap and flash pair without changing the economic or lender reconciliation result.

## Evidence artifacts

- `raydium-clmm-remaining-exits-sim.json`: fee, fund-fee, remaining-reward controls and mutations
- `raydium-clmm-position-liquidity-rounding.json`: position collection, 1/2/full/full+1 liquidity exits, and position mutations
- `raydium-clmm-kamino-v1-flash.json`: exact native-v1 Kamino/KLend wires, hashes, limits, state, inner instructions, dust, capacity, order, alias, crank, and tick-boundary matrix
- `raydium-clmm-project0-v1.json`: independent native-v1 Project 0 envelope and CLMM compositions
- `raydium-clmm-project0-debt-shares.json`: decoded per-case debt/share reconciliation
- `klend-zero-fee-census.json`: exact current reserve fee-field census
- `raydium-clmm-residual-quote.json`: independent residual valuation

## Limitations

- The source rebuild is not byte-identical to the current binary. Deployed simulations are the primary evidence.
- Dynamic tests cover concrete current pools, vaults, positions, and reward schedules; they do not enumerate every live position, Token-2022 transfer-hook permutation, permissioned pool, or all possible multi-array price paths.
- `sigVerify:false` is required for non-submitting mainnet simulation of historical signers. It does not demonstrate possession of those keys and was never used to submit a transaction.
- Mainnet state changed during the audit. Every quantitative statement is tied to the slots recorded in its JSON evidence.
- The out-of-range reward-index panic and owner-authorized self-transfer/dust-burn behaviors are robustness or user-footgun observations. Neither provides an unauthorized beneficiary.

## Conclusion

The remaining exit paths transferred value under their intended authorities and rejected the tested signer, account, mint, pool, program, alias, order, and atomicity violations. Both exact-zero-fee KLend/Kamino and Project 0 funded genuine current-binary Raydium CLMM paths in real native-v1 transactions. The compositions repaid their lenders or rolled back, preserved debt/share accounting, and produced only normal losses and fee accrual. **No tested path produced a successful unauthorized transfer.**
