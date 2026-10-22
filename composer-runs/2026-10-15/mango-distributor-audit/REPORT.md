# Mango MultiDistribute: current outsider gate

Bounded mainnet-beta defensive check, 2026-10-15. Fresh account observations were finalized at slots **457,409,468–457,409,765**. The program remained executable and its ProgramData upgrade slot remained **395,637,981**, matching the earlier captured ELF (`18b79b70…6c04b`). No mainnet transaction was submitted or simulated in this pass; no wallet secret was read. Existing claim tests were signed **local-fork** simulations with synthetic outsider MNGO, so they are not mainnet liquidity or profit proofs.

## Decision

The **927,559,196.868289 MNGO** collection vault `AgLqWkeqAVrQbj1tMuTAtAao1oRVXScVjrPRmBC5AxeY` has **no observed successful spend** in the prior 12-signature sample or the fresh latest-four-transaction sample. All four fresh transfers involving the vault were **inbound user deposits**. The live collection's `burnOnDeposit=false` and `burnInsteadOfWithdraw=true` flags mean deposits accumulate there and the published `WithdrawFromCollection` handler, if invoked by the configured collection authority `5tgfd6XgwiXB9otEnzFpXK11m7Q7yZUaAJzWK4oT5UGF`, burns the vault balance rather than transferring it to a recipient. The collection authority must sign. This is the first hard gate for an outsider MNGO-vault exit. It is a source-and-state conclusion, not a dynamic proof of every possible current-binary instruction.

The **11,234.007529767 mangoSOL** distribution vault `EukVHqQDMUy8La6R9KR7PHPh5YYmBZt8XoYNuYvmWXsE` does have direct program-signed spend proof: two latest successful transactions at slots **455,923,006** and **455,918,095** transferred **0.068298894** and **0.068452150 mangoSOL** from the vault, with `DisJzze…` as immediate Token-program CPI parent and distribution PDA `4NcjVs9x…` as authority. Both transactions postdate the current deployment slot. These are paid distribution claims, not arbitrary releases.

## Exact public claim gate

The published [MultiDistribute source at commit `0e90f9a`](https://github.com/ckamm/multidistribute/blob/0e90f9a910ebb1da3fa174d2256312dd43f6e283/programs/multidistribute/src/lib.rs#L160-L350) declares the deployed program ID and a public `UserCommitAndClaimStateless` instruction. The live collection requires:

1. The caller signs and the SPL Token program can debit the **caller's owned or delegated MNGO source** for the declared amount. That amount enters the MNGO vault; there is no free claim.
2. The supplied terms hash equals the collection's `caa45210e2028549922a81611f58408114d96af0999eb77d32e8b839370bb9cb`; cumulative deposits cannot exceed **1,054,240,918.337350 MNGO**. At the snapshot, **126,681,721.469061 MNGO** of that cap remained.
3. All **six registered distributions** are supplied in their stored order with their actual vaults. Each payout is `floor(input_raw × distribution_lifetime_deposited_raw / max_collectable_raw)` and is transferred by the distribution PDA. The claim also mints one replacement unit per deposited raw MNGO unit to the caller's replacement-token ATA.

The earlier [signature-verified local-fork probes](signed-outsider-claim.json) support this gate on the captured current ELF: a fresh outsider's 1 MNGO paid claim succeeded (1,122 bytes, 29 keys), foreign MNGO source rejected at SPL owner error 4, wrong terms rejected at 6013, and duplicate distribution layout rejected at 6008. A second claim in one transaction failed **insufficient source funds**, not a replay guard. Replacing only the mangoSOL payout destination with another outsider's same-mint ATA succeeded, but the caller still deposited their own MNGO and received only their pro-rata entitlement. No observed test released vault assets without the MNGO debit. The [collection withdrawal source](https://github.com/ckamm/multidistribute/blob/0e90f9a910ebb1da3fa174d2256312dd43f6e283/programs/multidistribute/src/lib.rs#L64-L106) and [signer constraint](https://github.com/ckamm/multidistribute/blob/0e90f9a910ebb1da3fa174d2256312dd43f6e283/programs/multidistribute/src/lib.rs#L402-L433) are published source, **not verified byte-for-byte against the ELF**; deployed ELF strings and claim error names match it.

## USDC exit depth and atomic economics

Fresh read-only Jupiter ExactIn route quotes at **2026-10-15 22:47 UTC**:

| Asset input | Quoted USDC output | Interpretation |
|---:|---:|---|
| 1,000,000 MNGO | 14,202.355906 | Already far below the earlier ~$32,183 spot mark for this size. |
| 10,000,000 MNGO | 23,562.025441 | Only ~$9,360 more for ten times the input. |
| 100,000,000 MNGO | 25,224.523230 | Route nearly saturated. |
| Entire 927,559,196.868289 MNGO vault | 25,402.204512 | Indicative full-size quote, **not** a sale or guaranteed fill. Prior ~$29.85m spot mark is not liquid loss. |
| Entire 11,234.007529767 mangoSOL vault | 1,393,550.581945 | Indicative multi-venue quote, not an outsider-accessible balance or atomic execution proof. |

For the last observed **770.181206 MNGO** deposit size, the previous [route check](route-economics.json) quoted **24.937771 USDC** to buy the input and only **21.017485 USDC** from all independently routable distribution/replacement outputs, a **3.920286 USDC shortfall before execution costs**. Two outputs had no usable USDC quote. Existing signed cross-mint lender controls show USDC funding can exist, but the collection claim does not close repayment at this sampled size. No same-mint MNGO or mangoSOL flash source was observed in the bounded lender census.

**Stop:** no concrete current outsider path to release MNGO from its vault or to claim/route mangoSOL profitably. A `sigVerify:true` hooked-wallet mainnet-beta simulation was not justified by these gates. Future upgrades, a new distribution state, or materially different exit liquidity would require a fresh check; this report does not claim whole-program safety.

Evidence: [fresh account/transfer sample](fresh-gate-snapshot.json), [live collection flags](fresh-collection-config.json), [fresh quote ladder](fresh-exit-depth.json), [current ELF metadata](current-binary.json), [signed fork probes](signed-outsider-claim.json), and [paid-claim route check](route-economics.json). All quote amounts are read-only estimates and may change with market state.
