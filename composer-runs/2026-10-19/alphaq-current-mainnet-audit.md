# AlphaQ CASH/USDC current-mainnet route/value gate

Observed: 2026-10-19 03:21–04:22 EDT (07:21–08:22 UTC)

## Bounded conclusion

An ordinary outsider can make a value-moving AlphaQ CASH/USDC call through a current public parent route, but the observed call is an input-paid swap, not a drain. A contemporaneous signed mainnet-beta simulation of the current Jupiter v6 route spent 5,000 raw USDC and received 5,000 raw CASH. Signature verification was enabled, the transaction required only the outsider signer, and no transaction was broadcast. Separate held-out receipts provide the pool-side matched-delta evidence; the live control's pool pre-read and simulation were two slots apart and are not misrepresented as a same-slot pool delta.

No concrete thin-reserve, unsolicited-donation, account-alias, or atomic-flash composition survived the economic gate. The only positive current two-leg quote was +32 raw USDC at a 10 USDC start. The signed control's one-signature transaction fee was 5,000 lamports, worth 529 raw USDC at the contemporaneous SOL/USDC quote. The candidate's upper bound is therefore **−497 raw USDC before any lender fee**, and every lender fee is nonnegative. At the maximum observed 20,000-USDC route, completed signed mainnet-beta v1 simulations were −8.364679 USDC-equivalent with two sources and −11.027450 with three after residual CASH marking and network cost.

This is a bounded no-valid-drain result, not a whole-program proof.

## Current deployed identity

| Item | Current value |
|---|---|
| Program | `ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA` |
| Loader | Upgradeable BPF loader |
| Program-data account | `BVSfZyEjqJsfcGn5qq1VKhxSCJ7JCR2ypFXsXY8yUdRK` |
| Last deployment slot | `422791798` |
| Executable size | `500000` bytes |
| Executable SHA-256 | `3d7bc173c67ba1858eacc69b5c504af8e160dbd38aea93779c3c65b6b011d877` |
| Program-data SHA-256 | `429af6af031f4c5dbf8f7badd000491dbd3dac6226da5d1c05ea85abbb252eaf` |
| Embedded build marker | `0.0.1 [main-8b47eb6]` |

The exact current executable is saved at [`evidence/alphaq-current-mainnet.so`](evidence/alphaq-current-mainnet.so). The loader state, hashes, and parent identities are recorded in [`alphaq-current-receipts.json`](alphaq-current-receipts.json).

Composer was tried first as requested. `GET /idl/<program>` returned HTTP 400 and `GET /learn/<program>?limit=150` did not return within 30 seconds. No Composer-supplied IDL or learned interface was therefore available. The current binary is not source-verified in this audit.

## Recovered live parents and held-out receipts

The latest bounded CASH/USDC vault sample contained eight successful held-out receipts at slots `458748862` through `458749009`. Every one invoked AlphaQ at CPI depth 2 with immediate parent `DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH`. Calls used the current 12- or 14-account AlphaQ swap form and produced matched CASH/USDC token-account deltas. This is the current successful DFlow envelope; it is materially fresher than the Oct. 15 historical wrapper whose serialized route data failed with 15999.

The independent signed control was built from a fresh Jupiter quote constrained to the exact AlphaQ market `2YR8bXXn4tTnq8nVjvpYnBiQ7ZKjN3G16wxE8ShL3KaB`. Its immediate parent was Jupiter v6, `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`.

Signed-control facts:

- mainnet-beta genesis verified;
- `sigVerify: true` and one required signer;
- 485 serialized bytes and 17 account keys;
- simulation succeeded with no error at 54,878 compute units;
- wallet delta: −5,000 raw USDC, +5,000 raw CASH;
- pool pre/post reads were at slots `458758756` and `458758758`, so concurrent pool movement is excluded from the control accounting;
- fee: 5,000 lamports;
- no `sendTransaction` call and no broadcast.

Full evidence: [`alphaq-current-signed-control.json`](alphaq-current-signed-control.json).

## Economic gate

At state slot `458750771`, the sampled AlphaQ vaults held:

- `25,148.330669` CASH;
- `364,420.612421` USDC.

Twenty current direct two-leg screens covered both orderings of AlphaQ and an independent Manifest exit/entry at 1, 10, 100, 1,000, 5,000, 10,000, 20,000, 25,000, 50,000, and 100,000 USDC starts.

| Result | Observation |
|---|---|
| Best quote-only edge | +32 raw USDC at 10 USDC, AlphaQ first |
| Fee floor | 5,000 lamports = 529 raw USDC at the contemporaneous quote |
| Best after-fee upper bound | −497 raw USDC before lender cost |
| 100 USDC | −31 raw USDC AlphaQ first; −670 raw USDC AlphaQ second, before costs |
| 1,000 USDC | −12,987 / −12,842 raw USDC before costs |
| 10,000 USDC | −1,192,902 / −1,172,090 raw USDC before costs |
| 20,000 USDC | −8,483,471 raw USDC AlphaQ first; reverse ordering had no complete route |
| 25,000+ USDC | no complete AlphaQ round trip in the tested direction(s) |

The +32-raw row is not treated as profit: it is a quote and is smaller than the observed base transaction cost even with a zero-fee lender. Exact rows and route identities are in [`alphaq-current-economic-gate.json`](alphaq-current-economic-gate.json).

## Maximum two- and three-provider atomic compositions

The final flash test uses one atomic **Solana v1** transaction built and signed with the official `@solana/kit` 8.5.0 encoder. Per the [current Solana transaction-format documentation](https://solana.com/docs/core/transactions/versioned-transactions), v1 is the 4,096-byte/64-inline-account format and does not use address-lookup tables. Both compositions use the runtime-loaded outsider wallet, a fresh Project0 margin signer, signature verification, real current provider instructions, the AlphaQ USDC→CASH leg, an independent Manifest CASH→USDC exit, and every repayment instruction. The mainnet-beta RPC received `simulateTransaction` only; no state was mutated, no signed wire or private key is persisted, and nothing was broadcast.

Current provider headroom exceeded every tested share:

| Provider | Current USDC capacity used for the bound |
|---|---:|
| KLend, exact-zero flash fee | 11,472,833.229831 USDC |
| Project0 vault balance | 391,075.735383 USDC |
| Save available liquidity | 4,986,720.479672 USDC |

The maximum observed AlphaQ quote accepted exactly `20,000,000,000` raw USDC; `20,000,000,001` returned `No routes found`. The final transaction reserved 10,000 raw CASH between legs so small quote/execution drift could not make the second exact-in leg overdraw the first. AlphaQ quoted `19,994,453,206` raw CASH; the independent Manifest exit took `19,994,443,206` raw CASH and quoted `19,991,590,822` raw USDC.

| Atomic case | Official v1 envelope | Signed mainnet-beta receipt | Final outsider equity |
|---|---|---|---|
| KLend + Project0, 10,000 USDC each | 1,671 bytes, 36 inline keys, 12 instructions, 2 signers | `err:null`, 300,112 CU; both lender vault deltas exactly zero; AlphaQ parent Jupiter v6 | −8,412,650 raw USDC, +49,035 raw CASH; residual CASH marked at 49,028 raw USDC and 10,000-lamport fee marked at 1,057 raw USDC: **−8,364,679 raw USDC-equivalent** |
| KLend + Project0 + Save, ~6,666.666667 USDC each | 1,906 bytes, 42 inline keys, 14 instructions, 2 signers | `err:null`, 383,651 CU; all principal-vault deltas exactly zero; Save fee receiver +2,666,666 raw; AlphaQ parent Jupiter v6 | −11,079,292 raw USDC, +52,907 raw CASH; residual marked at 52,899 raw USDC and network fee at 1,057 raw: **−11,027,450 raw USDC-equivalent** |

The outsider entered each simulation with existing USDC inventory, but profit is measured strictly as post-minus-pre at the same simulation context. That inventory enabled repayment of a losing trade; it is not counted as flash profit. Both cases complete all repayments yet reduce outsider equity, so neither is a self-funding positive atomic route.

Full receipt: [`alphaq-multiflash-extremes.json`](alphaq-multiflash-extremes.json). Reproducible no-broadcast harness: [`alphaq-multiflash-extremes.js`](alphaq-multiflash-extremes.js).

## Candidate-class disposition

| Candidate class | Disposition |
|---|---|
| Thin reserve | No positive completed cycle. The route becomes unavailable near the CASH-side inventory boundary, and the last completed large cycle is already materially negative before costs. |
| Unsolicited donation | No concrete positive differential was identified. A donation is attacker-paid inventory; without a demonstrated pricing/accounting discontinuity it only worsens the capital requirement. No donation is claimed safe program-wide. |
| Account alias/substitution | No current profitable alias candidate was identified. The Oct. 15 direct mutation stopped at `InvalidAccountOwner`; current successful receipts instead supply valid parent-route context. This audit did not generalize that rejection to every 12/14-account permutation. |
| Atomic flash composition | Official v1 signed mainnet-beta simulations completed all repayments. Two-source ended −8.364679 USDC-equivalent; three-source ended −11.027450 after the Save fee, residual-CASH mark, and network cost. Existing outsider inventory covered the losses. |

## Precise stop gate and limitations

Stop at the current state because **no candidate is positive after the minimum observed transaction cost with lender cost bounded below by zero**. Reopen only if at least one of these changes:

1. a current independent round trip exceeds all swap slippage plus the actual one-transaction fee and lender fee;
2. the AlphaQ executable hash or program-data deployment slot changes;
3. the CASH/USDC vault or external-liquidity state changes enough to create a fee-positive route;
4. a concrete donation or alias mutation demonstrates a state-dependent output differential that remains positive after restoring/replaying the full transaction economics.

Limitations:

- The receipt windows are bounded to the latest 100 sampled program/vault signatures, not all historical activity.
- The exact executable was hashed and inspected as a stripped SBF ELF; no matching verified source or Composer IDL was recovered.
- The signed mainnet control proves outsider reachability and ordinary value movement, not every AlphaQ instruction or account permutation.
- v1 simulation used `@solana/kit` 8.5.0 with all accounts inline; the older local web3.js 1.99 path was used only to decompile Jupiter's v0 quote transaction and read v1 receipts, not to build the final v1 wire.
- Residual CASH is marked with a contemporaneous independent CASH→USDC quote. It is not presented as realized second-transaction proceeds.
- Quote rows are candidate discovery only; none is presented as realized mainnet profit.
- No transaction was broadcast, and no wallet or RPC secret is stored in the evidence.
