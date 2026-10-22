# Sanctum INF current-mainnet adversarial revalidation

**Date:** 2026-10-15  
**Target:** `5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx`  
**Method:** read-only Solana RPC plus `simulateTransaction`; no transaction was signed or submitted; no team contact  
**Verdict:** **no validated unauthorized value-moving path**

## Executive result

I established current-state positive controls for V1/V2 swaps, INF share mint/burn, protocol-fee minting, Marginfi-funded wSOL flash composition, exact-zero-rate KLend-funded wSOL composition, and a same-asset KLend composition against a genuinely thin mSOL INF reserve. I then mutated signer/authority, destination, reserve/mint, CPI programs, account aliases, order, repetition, sync placement, repayment buffer, and terminal atomicity.

No test produced a successful unauthorized transfer, an unbacked residual INF balance, unpaid flash debt, lender-vault loss, or a profitable share-conversion round trip. Successful round trips retained value in INF reserves rather than extracting it. Gross custody and permissioned beneficiary withdrawals are therefore not reported as exploit value.

The strongest current controls were:

- Exact v1 transport limit: a KLend wSOL borrow → INF add/remove → full repay completed at exactly **4,096 wire bytes and 64 inline addresses** (slot `457352231`, 9 instructions, 134,971 CU, 16,274,199 loaded-account bytes, wire SHA-256 `5b756ee326a8a76e9791add9f2261dc5dfa7d1e4a16193513e1d348cf5070200`). KLend supply and fee vault deltas were zero; INF supply and the actor's INF balance ended at zero.
- Thin reserve: INF's mSOL reserve began with only **822 raw units**. A `99,999`-raw mSOL exact-zero-rate KLend flash loan completed add → remove → full repay with an exact `800`-raw repayment buffer. A `799`-raw buffer failed at repay and rolled back. Sync-before/mid/after and two repeated cycles also completed without residual shares or lender loss.
- wSOL: a `10,000,000`-raw add/remove required exactly `35,487` raw wSOL of spread buffer. `35,487` completed; `35,486` failed at repay and rolled back. The same threshold held with both Marginfi and exact-zero-rate KLend funding.

These are negative security results, not findings: the measured amounts are ordinary round-trip cost retained by INF, not attacker proceeds.

## Scope and safety

- Only `get*` RPC methods and `simulateTransaction` were used.
- All custom v1 messages used prefix `0x81`, no address lookup tables, a 4,096-byte ceiling, and a 64-inline-address ceiling.
- `sigVerify:false` and replacement blockhashes were used only for simulation. No private keys were obtained, no signatures were produced, and `sendTransaction`/equivalents were never called.
- Historical successful transactions supplied account ordering and executable controls. Every claimed result below was re-simulated against current mainnet state.
- No privileged-only path, hypothetical arbitrage, or gross-custody number is treated as a vulnerability.

## Deployment identity, ownership, and control

At slots `457349828`:

- The target account was executable and owned by `BPFLoaderUpgradeab1e11111111111111111111111`.
- ProgramData was `ALmAxhSP7TDWGMHWBLjD9qS71YjqxjN1ba6JLRdzdVy`, also loader-owned.
- Last deployment slot: `411884877` (`2026-04-08T16:13:02Z`).
- Upgrade authority: `47SND7bGKvNXrqfP1bjsLCbwTgZhFBzAgmZ42QSkRScz`; the program is upgradeable, not frozen.
- Pool PDA from seed `state`: `AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW`.
- LST-state-list PDA from seed `lst-state-list`: `Gb7m4daakbVbrFLR33FKMDVMHAprRZ66CSYt4bpFwUgS`.
- Raw ProgramData ELF-content SHA-256: `4d11d617b2be14a13cbb859b6a8afb7355e609b0fa14a054c4b127c4b2c93947`.

OtterSec's build status reported the current program as unverified, with normalized on-chain hash `25d3ade9efe70e40df16a1553c2cceac511a96e5a305046d273d884065e6e4`. Its last verified record was a prior executable/repository commit dated 2026-04-24. The source reviewed here is Sanctum's `inf-1.5` repository at commit `d4bfdd4d1d34985f8639433c0308941fc84bf1a2` (2026-09-22). Consequently, source semantics corroborate runtime behavior but are **not asserted to be an exact reproducible build of the live binary**. Runtime simulation against the deployed executable is the primary evidence.

## Current custody and priced exposure

Pool state at the custody snapshot:

- Version 2; `isDisabled = 0`; `isRebalancing = 0`.
- Recorded total SOL value: `1,870,227,724,854,883` lamports.
- Protocol-fee rate field: `50,000,000` nanos; accumulated protocol fee: `11,976,814,752` lamports.
- INF mint: `5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm`.
- Pricing program: `s1b6NRXj6ygNu1QMKXh2H9LUR2aPApAAm1UQ2DjdhNV`.
- Configured protocol-fee beneficiary: `2APFNdwEd3ymNhc1mG2iv5bT8vUB1nRvLf9yWnDJb91c`.

The list contained 199 entries and 153 nonzero reserves. All 153 nonzero entries passed mint, token-program, PDA-reserve, and pool-authority binding checks. Ninety-eight were priced and 55 were unpriced. Using 39 live prices plus 59 retained same-day prices, the priced reserve lower bound was approximately **$197,384,320.57**. Evidence digest: `e059a14098e1c8d653cf7bf73487c2bd97fce9c9d9e5c1c33a2b464b3f8c5d4d`.

That number is gross token-account custody, not exploitable value, and underlying LST exposure may overlap economically.

## Direct current-state value-moving controls

### Swap and share conversion

At slots `457349842`–`457349857`:

- V2 exact-in `1,000,000` raw wSOL → INF succeeded: destination `+685,334` INF, reserve `+1,000,000` wSOL, INF supply `+685,334` (34,231 CU, 701 bytes).
- The V1 adapter produced the same economic result (34,239 CU, 702 bytes).
- Add liquidity with `2,000,000` raw wSOL minted `1,370,668` INF.
- Atomic add then remove of all `1,370,668` newly minted shares ended with actor INF `0`, INF supply delta `0`, actor wSOL `1,992,902`, and INF reserve `+7,098` raw wSOL. This was a loss to the actor, not an extraction.
- Removing one share more than was minted failed. Remove-before-add failed.
- Two swaps succeeded only when both legs were funded. With one-leg funding, the second transfer failed and the transaction rolled back.
- A valid first leg followed by an invalid terminal System instruction failed atomically; no partial state was returned.

### Swap mutation matrix

| Mutation | Result |
|---|---|
| signer replaced by non-owner/non-signer | rejected by token owner check (`Custom 4`) |
| input/output token account alias | rejected (`Custom 10`) |
| reserve substituted | rejected by exact reserve binding (`InvalidArgument`) |
| mint substituted | rejected by list/mint binding (`InvalidArgument`) |
| token CPI program → System Program | rejected (`InvalidArgument`) |
| value-calculator CPI program → System Program | rejected (`InvalidArgument`) |
| pricing CPI program → System Program | rejected (`InvalidArgument`) |
| pool state and list aliased | rejected (`InvalidArgument`) |
| alternate INF destination with real spending signer | succeeded as an authorized gift; not unauthorized |
| duplicate, underfunded second leg | failed and rolled back |
| successful leg plus forced terminal failure | failed and rolled back |

### Protocol-fee minting

At slot `457349858`, the configured beneficiary successfully withdrew the then-current `11,976,814,752` fee lamports as `8,233,068,303` newly minted INF, and the accumulator became zero. This is the permissioned positive control.

- Beneficiary substitution was rejected before minting.
- Wrong destination mint, INF-mint substitution, and token-program substitution were rejected.
- The configured beneficiary could redirect output to another valid INF account. That is explicitly authorized by the interface and required the configured beneficiary signer.
- Two withdrawals in one transaction minted only once; the second observed the zeroed accumulator.
- Withdrawal followed by a forced terminal failure rolled back both minting and accumulator mutation.

## Flash-loan, boundary, and transport stress

### Exact-zero-rate KLend configuration

A current KLend census decoded the on-chain `flash_loan_fee_sf` field with scale `2^60`:

- 441 reserves were active with an exact zero stored rate.
- Across decoded configurations: 562 exact-zero-rate, 43 positive-rate, and 14 disabled.
- The selected wSOL reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` and mSOL reserve `FpuQaFELdfNy5EETntTBrNAMbduRvrGz1oKJKN1NBSfr` both stored `flash_loan_fee_sf = 0`.

This is exact configuration zero, not a small nonzero fee rounding to zero. For wSOL, pure borrow/repay controls of 1 raw unit, `10,000,000`, and reserve-available-minus-one all completed with supply-vault delta `0` and fee-vault delta `0`.

### wSOL composition

KLend current-state results at slots `457352221`–`457352231`:

| Test | Result | Envelope |
|---|---|---|
| 2 raw through INF | rejected at the rounding floor (`Custom 31`) | 1,009 bytes, 22 accounts |
| 3 raw through INF | completed; full flash repayment | 1,009 bytes, 22 accounts |
| 3, 4, 10, 100, 1,000, 10,000 raw dust sweep | all except 2 completed; no residual INF or lender loss | 1,009 bytes each |
| 10,000,000 add/remove | completed; INF reserve `+35,487`, INF supply `0`, actor INF `0` | 124,266 CU |
| exact `35,487` spread buffer | completed with actor wSOL ending `0` | 124,267 CU |
| `35,486` buffer | failed at repay and rolled back | 1,009 bytes |
| two add/remove cycles | completed; reserve `+70,974`, supply/share delta `0` | 165,201 CU, 1,089 bytes |
| sync before/between/after | completed with the same `+35,487` reserve result | 142,674 CU, 1,054 bytes |
| available-minus-one (`6,583,425,299,328`) with 40,000,000 buffer | reached repay, then failed insufficient funds and rolled back | 123,374 CU |
| exact v1 maximum envelope | completed at 4,096 bytes and 64 addresses | 134,971 CU |

The available-minus-one pure KLend pair succeeded, so the near-liquidity composition blocker was not KLend liquidity, v1 size, account count, or CU. The concrete blocker was that the supplied 0.04 SOL external buffer was smaller than INF's round-trip spread at that size. I did not substitute simulated capital or call that failure a finding.

The exact 4,096/64 successful wire contains its complete base64 message, ordered address list, instruction bytes, CU, trace, and pre/post state in the evidence artifact. Its wire SHA-256 is `5b756ee326a8a76e9791add9f2261dc5dfa7d1e4a16193513e1d348cf5070200`.

### Marginfi/Project 0 wSOL composition

The observed Marginfi wSOL vault held `11,208,583,873,143` raw units. A 43-step moving-state search observed:

- 1 raw failed the minimum/rounding gate; 2 raw succeeded.
- Highest observed success: `11,204,442,784,626` at slot `457348748`.
- Next raw unit, `11,204,442,784,627`, failed at slot `457348758`.
- Both later boundary rechecks failed because interest/utilization changed across processed slots; the pair is exact for the recorded slots, not an immutable ceiling.
- A stable 99% control of `11,096,498,034,411` succeeded as a pure flash pair.

The funded `10,000,000`-raw INF path completed at slot `457348770`: 1,074 bytes, 23 accounts, 10 instructions, 158,095 CU, 11,949,033 loaded-account bytes. The Marginfi vault delta was zero; the selected debt balance remained absent with no active balances; actor INF and INF supply ended at zero; INF's wSOL reserve gained `35,487` raw units. Wire SHA-256: `73dea9fd7493149c44a61848917d312761031d9bcf51f76b375954ded2628573`.

The exact `35,487` buffer completed and `35,486` failed at repayment. Two cycles and the sync-interleaved path completed. Remove-before-add, account alias, and add-without-remove mutations failed. A near-capacity INF round trip with a 70,000,000-raw buffer reached repayment and then failed insufficient funds, rolling back; again the blocker was spread capital, not transport or compute.

### Thin mSOL reserve and valuation-sync hypothesis

The third-smallest nonzero INF reserve by recorded SOL value was mSOL index 17:

- Reserve `4poUr2pTjTbBdbk9YvGcscQrJZrTutgGAPXGQnE1gpax`.
- Initial amount `822` raw mSOL; recorded value `1,158` lamports; approximate priced value `$0.00012276`.
- Mint, token-program, pool-authority, list index, reserve PDA, and calculator bindings were validated.
- Same-asset KLend reserve `FpuQaFELdfNy5EETntTBrNAMbduRvrGz1oKJKN1NBSfr` had `100,000` raw available and exact stored flash rate zero.

Current positive control:

- Borrowed `99,999` raw mSOL, routed all `99,999` through INF add/remove, and repaid in full.
- The route temporarily moved a reserve that began at 822 raw units through a much larger balance transition.
- Exact round-trip cost was `800` raw mSOL: buffer 800 completed with flash destination `0`, actor INF `0`, INF supply delta `0`, KLend supply-vault delta `0`, and fee-vault delta `0`; buffer 799 failed at repay and rolled back.
- Envelope: 1,321 bytes, 27 accounts, 8 instructions, 189,409 CU, 14,229,032 loaded-account bytes. Exact-buffer wire SHA-256: `62830221052ac55536924d7ac0f9ea4bf5ea1e833b438107cf9d9a224ada742f`.
- Adding `sync_sol_value` before mint, between mint/burn, and after burn completed (246,117 CU, 1,375 bytes) with the same `+800` reserve result, zero residual shares/supply, and full repayment.
- Two repeated cycles completed (309,423 CU, 1,409 bytes) with reserve `+1,600`, no residual shares, and full repayment.
- Remove-before-add failed. The smallest completed mSOL route was 4 raw; route 3 failed at remove's rounding floor.

This directly falsified the proposed stale-valuation/minimum-buffer extraction for the composable thin reserve tested: moving valuation/sync across mint and burn did not reduce the redemption rate or produce transferable surplus.

The absolute smallest reserve was index 11 (`GEJpt...`) with 3 raw units and 2 recorded lamports. No active exact-zero KLend reserve or Marginfi bank for that mint was present in the current inventories, so a same-asset funded atomic flash composition could not be constructed without changing the required technology or introducing a swap/arbitrage dependency. That is the concrete blocker; I did not substitute a synthetic lender.

## Source-level corroboration

The reviewed source explains the observed runtime gates:

- Swap verification rejects zero amount, disabled/rebalancing state, wrong pricing program, wrong calculator, wrong mint, wrong token program, wrong reserve PDA, same-mint aliasing, and wrong pool/list PDAs. User token accounts remain free, but the token CPI enforces the spending signer.
- Token movement transfers from the user's signed source, then mints/transfers with the pool PDA. There is no caller-selected custody authority.
- Every exact-in path releases yield, performs initial sync, obtains calculator/pricing returns, moves tokens, then performs final sync.
- Normal swaps reject any final pool-total-SOL decrease.
- Add/remove liquidity verifies that INF redemption rate does not decrease, allowing only a three-lamport quantization bound.
- Protocol-fee withdrawal binds pool PDA, configured beneficiary signer, INF mint, and mint owner/token program; it mints once and then zeros the accumulator.

Relevant reviewed locations:

- `controller/program/src/instructions/swap/v2/common.rs:143` — account and program binding.
- `controller/program/src/instructions/swap/v2/common.rs:334` — signed transfer/burn/mint/transfer.
- `controller/program/src/instructions/swap/v2/common.rs:465` — final sync and no-loss checks.
- `controller/program/src/instructions/swap/v2/common.rs:563` — share-redemption-rate invariant.
- `controller/program/src/instructions/swap/v2/exact_in.rs:34` — release → sync → quote → move → final-sync order.
- `controller/program/src/instructions/swap/v1/liquidity.rs:20` — V1 add/remove conversion into V2 semantics.
- `controller/program/src/instructions/protocol_fee/withdraw_protocol_fees/v2.rs:34` — beneficiary/mint/program binding and fee mint.

Because the live executable is not currently reproducibly verified, these lines are corroboration rather than proof of byte identity. The successful and rejected simulations above are evidence from the live program.

## Final assessment and residual limitations

**No reportable vulnerability was validated.** Every successful value-moving control was authorized and fully accounted. Every adversarial mutation either failed before value movement, required the legitimate signer, paid the ordinary INF spread, or was reverted by Solana transaction atomicity.

Residual limitations, stated narrowly:

1. The current deployed executable lacks a current reproducible-build match, so static claims cannot be elevated beyond the runtime evidence.
2. Fifty-five nonzero reserves lacked a price in the selected current/same-day price sources; they were ownership/binding-checked but excluded from the USD lower bound.
3. The absolute-smallest reserve lacked compatible same-asset zero-fee flash liquidity. The mSOL 822-unit reserve supplied the closest real, current, same-asset funded test and passed.
4. The near-entire wSOL-liquidity INF path needed more external spread capital than the selected simulation actor had. Pure near-entire KLend and Marginfi flash controls succeeded, so the failure was isolated to round-trip economics rather than lender or v1 constraints.

## Reproduction artifacts

- `sanctum-inf-current-evidence.json` — deployment, custody, direct controls, mutation matrices, fee controls.
- `sanctum-inf-flash-v1.json` — Marginfi/Project 0 threshold search, exact v1 wires, traces, and pre/post state.
- `sanctum-inf-klend-v1.json` — exact-zero-rate wSOL KLend controls, dust/boundary/repetition/sync tests, and exact 4,096-byte/64-address wire.
- `sanctum-inf-klend-msol-thin-v1.json` — thin mSOL reserve composition, exact buffer, sync and repetition tests.
- `klend-zero-fee-census.json` — decoded current KLend fee configuration census.
- `sanctum-inf-control-index.json` — current successful instruction controls used to derive account order.
- Harnesses: `sanctum-inf-current-revalidation.js`, `sanctum-inf-flash-v1.js`, `sanctum-inf-klend-v1.js`, `sanctum-inf-klend-msol-thin-v1.js`.

All four generated evidence files state `submittedTransactions: 0` or the equivalent read-only safety marker.
