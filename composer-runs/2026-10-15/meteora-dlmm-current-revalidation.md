# Meteora DLMM current-mainnet adversarial revalidation

Date: 2026-10-15 (America/Toronto)  
Program: `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`  
Observed slots: 457346497–457354880  
Assessment type: read-only RPC inspection and unsigned `simulateTransaction` controls only

## Executive conclusion

**No validated unauthorized value-extraction path was found. There is no reportable security finding from this revalidation.**

The current program accepted owner-authorized `ClaimFee2` and `RemoveLiquidityByRange2` controls and ordinary `Swap2` controls. The same instructions rejected outsider signers, foreign same-mint vaults, token-program substitution, reserve/output aliasing, and mixed valid/invalid atomic orderings. Every failed atomic case returned empty simulated account deltas.

A real Solana transaction-version-1 composition also succeeded for:

`KLend zero-fee USDC flash borrow -> DLMM forward swap -> DLMM reverse swap -> exact KLend repayment`

The largest completed bin-traversing control borrowed and swapped 10,000 USDC. It repaid KLend exactly, left no residual TRUMP, left KLend's liquidity supply and fee vault unchanged, and cost the signer 20.216477 USDC, which the DLMM USDC reserve gained. At the independently observed USDC price, the residual was approximately **-$20.207874** to the signer. This is negative attacker P&L, not a drain.

The earlier fee-claim and liquidity-removal positives were independently recreated against current state. A current positive `WithdrawProtocolFee` control was **not** recreated: the permissioned operator reached `IncorrectATA` even when given the canonical operator-owned ATAs used by the current official CLI. That is recorded as a coverage blocker, not treated as a vulnerability or silently replaced with a different test.

## Scope and trust model

The target is upgradeable:

- ProgramData: `HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu`
- last deploy slot: `423977638`
- upgrade authority: `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`
- executable allocation: 2,229,776 bytes
- allocation SHA-256: `d296c6771cec945601027613ca637c1be6721044c5859009d41c453477844c1f`
- trailing-zero-trimmed executable: 2,198,017 bytes
- trimmed SHA-256: `cc25380fd0736b57d051f28cada432b35b01d9e24dc1d3e1b5d81773279eb772`
- current SDK / IDL used: `@meteora-ag/dlmm` 1.9.14 / IDL 0.12.0

The on-chain implementation source is not published with the SDK. This was therefore a control-first, black-box program audit using the current official IDL, SDK, account model, live account state, recent transaction discovery, and executable identity—not a source-complete proof over every internal branch.

No transaction was signed or submitted. Every mutation used `simulateTransaction` with `sigVerify:false`; signer account metas were preserved or deliberately replaced to exercise authorization checks. A successful control means the instruction accepts the named signer role when marked as a signer. It does not imply that the auditor possessed that private key. A real transaction would still need valid signatures.

## Custody and authority surface

The custody inventory started from the current Data API's top 100 non-blacklisted pools, then required pair ownership, state/API agreement, pair PDA recovery, reserve address agreement, token-account mint agreement, and pair authority over both reserves.

| Measure | Result |
|---|---:|
| Candidate pools | 100 |
| Strictly control-verified pools | 58 |
| Excluded from proof-backed totals | 42 |
| Verified token vaults | 116 |
| Priced verified vaults | 114 |
| Unpriced verified vaults | 2 |
| Gross priced custody | $94,106,437.78 |
| API TVL sum for the 58 verified pools | $96,975,198.44 |

The 42 exclusions were predominantly legacy pair-type-3 pools whose old preset seed could not be recovered from the current preset registry. Their pair owner, decoded state, and reserve bindings often still matched, but they were deliberately omitted because the stricter PDA proof was incomplete.

Gross custody is an impact ceiling and prioritization signal. It is **not** exploitable value and is not used as evidence of a vulnerability.

The main control pair was current TRUMP/USDC pool `9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2`:

- TRUMP vault: `AK93dERw7MJsGFBUPfV1bkXzDviJZM1K6vg2yGDugk7L`
- USDC vault: `81BadRGfaHFpAmuXpJ65k8tYtUWsZ54EFSmsVo1rbDTV`
- oracle: `6zpxLXnQxqJFpfyjUasgYKSK2w5KxSHjEDfbYWfXLoFF`

## Simulation construction and accounting

All material controls used an actual manually serialized Solana message version 1:

- version byte `0x81`
- maximum wire size enforced at 4,096 bytes
- maximum inline account keys enforced at 64
- no address lookup tables
- 64 MiB loaded-account-data setting, required for these large DLMM/KLend accounts
- each wire payload deserialized back through `MessageV1` / `VersionedTransaction` before RPC simulation

Because the target pool is live, one old pre-snapshot can falsely absorb intervening mainnet swaps. The final harness therefore took a fresh account snapshot for every case and recorded both pre-slot and simulation context slot. Value reconciliation uses paired user/pool and borrower/supply deltas from the same simulated result. State hashes cover the pair, oracle, relevant bin arrays, KLend reserve, and token accounts.

## Positive current controls

| Surface | Current control result | Reconciled value movement |
|---|---|---|
| `Swap2`, 1,000 raw USDC forward | success; 49,938 CU; 821-byte v1 wire | user -1,000 USDC; pool +1,000 USDC; pool -532 TRUMP; user +532 TRUMP |
| `Swap2`, 1,000 raw round trip | success; 84,137 CU; 907 bytes | user -5 USDC; pool +5 USDC; TRUMP residual 0 |
| `ClaimFee2` | success; 104,860 CU; 783 bytes | vaults -12,791 TRUMP / -145,485 USDC; position-owner ATAs gained exactly those amounts |
| `RemoveLiquidityByRange2`, one basis point | success; 294,248 CU; 818 bytes | TRUMP vault -3,120; owner ATA +3,120; USDC 0 |
| repeated two 1,000-raw round trips in one flash loan | success; 217,043 CU; 1,306 bytes, 28 keys | user -10 USDC; pool +10 USDC; TRUMP residual 0; KLend final delta 0 |

The fee/liquidity position was `WngGWbYJ3KfpFdXKbiRWyEj4353noapRMhpgjefzr3w`, owner `3DKBbsxztQNuGGQg7JzCfrEEBgdcj5nikAaAGNFKsPie`, range 490–558, with 69 nonzero liquidity-share bins. The controls used the current position owner, current pair reserves, current mint programs, and derived bin arrays.

## KLend funding: zero-fee configuration and boundaries

The funding reserve was the current KLend USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`. Its decoded `flashLoanFeeSf` was exactly `0`; this is a configured zero fee, not a small fee rounded down. Both direct and composed controls left fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj` unchanged.

At pre-slot 457353535, the liquidity supply token account contained 8,011,866,865,998 raw USDC. Direct version-1 borrow/repay controls succeeded at:

- 0, 1, 2, 10, and 100,000 raw units;
- 4,005,933,432,999 raw units;
- 7,789,632,497,552 raw units (7,789,632.497552 USDC).

All successful direct controls ended with zero token deltas. Amounts equal to raw supply minus one, raw supply, raw supply plus one, and `u64::MAX` rejected with KLend custom error 6008 (`InsufficientLiquidity`) and no deltas. The difference between the raw token-account balance and internal available liquidity is therefore enforced; the supply balance alone is not a borrowable-limit oracle.

Ordering and alias controls also rejected and rolled back:

| Mutation | Result |
|---|---|
| two sequential borrow/repay pairs | custom 6035 |
| borrow, borrow, repay, repay | custom 6035 |
| repay before borrow | custom 6033 |
| wrong repay instruction index | custom 6033 |
| repay amount one raw unit short | custom 6033 |
| destination aliases liquidity supply | custom 6006 |
| fee-vault substitution | custom 6033 |

The zero-fee conclusion applies only to this decoded reserve/configuration at the observed slot. It is not generalized to other KLend reserves or future governance changes.

## Atomic flash-loan swap matrix

The ordinary signer account had only a small pre-existing USDC buffer, so the matrix distinguishes protocol behavior from the signer's ability to pay the DLMM round-trip loss.

| Flashed/swap input, raw USDC | Result | Signer USDC delta | Pool USDC delta | TRUMP residual |
|---:|---|---:|---:|---:|
| 1–2 | forward rejected, custom 6039 | 0 | 0 | 0 |
| 3–4 | reverse rejected, custom 6039 | 0 | 0 | 0 |
| 5 | success | -4 | +4 | 0 |
| 1,000 | success | -5 | +5 | 0 |
| 10,000 | success | -24 | +24 | 0 |
| 100,000 | success | -205 | +205 | 0 |
| 1,000,000 | success | -2,002 | +2,002 | 0 |
| 10,000,000 | success | -19,994 | +19,994 | 0 |
| 100,000,000 | success | -199,921 | +199,921 | 0 |
| 300,000,000 | success | -599,763 | +599,763 | 0 |
| 400,000,000–10,000,000,000 with the small-buffer signer | repay token transfer rejected; full rollback | 0 | 0 | 0 |
| 100,000,000,000 and 772,167,161,008 | reverse leg reached `NotEnoughAccountKeys`; full rollback | 0 | 0 | 0 |

The last two very-large failures were produced with four forward and two reverse bin-array accounts. They establish safe rollback, but do not establish a protocol-wide size cap: a production builder supplying more bin arrays could cover a longer path.

### Successful bin traversal

To separate the 10,000-USDC path from the small-buffer limitation, a recent on-curve swap signer with a 407.398198-USDC balance at the case snapshot was used as the signer meta in an unsigned simulation. The five-leg version-1 transaction was 1,292 bytes with 29 inline keys and consumed 155,323 CU:

1. borrow 10,000 USDC from KLend;
2. idempotently create the TRUMP ATA;
3. swap 10,000 USDC to TRUMP;
4. swap all received TRUMP back to USDC;
5. repay exactly 10,000 USDC.

The SDK's isolated forward quote moved end price from the small-control value `1.8746654754113663252` to `1.8840388027884231568`, with nonzero quoted price impact, exercising traversal across individual DLMM bins within the first bin-array account. Final reconciliation was:

- signer USDC: -20,216,477 raw (-20.216477 USDC)
- DLMM USDC vault: +20,216,477 raw
- signer TRUMP ATA: 0
- DLMM TRUMP vault: 0 net
- KLend liquidity supply: 0 net
- KLend fee vault: 0 net

The pair, oracle, and first bin-array account hashes changed through the successful path; no external oracle refresh or crank instruction was present. This confirms the swap path updates its own observed oracle state. It does not, by itself, prove every oracle-manipulation bound.

Using the custody snapshot's independently fetched USDC price of `$0.999574443510565`, the signer's loss was approximately `$20.207873747`. Smaller successful cases were also losses. Static forward/reverse quotes are not treated as final accounting because the second leg executes after the first leg has changed pool state; simulated post-account reconciliation is authoritative.

## Thin and one-sided reserve control

Pool `HqLAEAU9AzZYoGejDmCd4yTXjcgKPR1oAfSbEtQCnCLG` (SCS/USDC) had only 46,274 raw USDC (0.046274 USDC) in its USDC reserve at the custody snapshot, while its SCS reserve held 7,595,035,876,612 raw units.

Direct version-1 USDC-to-SCS controls were tested at 1, 2, 3, 4, 5, 10, 100, 1,000, 10,000, reserve−1, reserve, reserve+1, and 100,000 raw USDC. One raw unit rejected with custom 6039. Every amount from two through 100,000 succeeded and conserved both sides exactly; for example:

- 46,273 raw USDC: user -46,273 / reserve +46,273; SCS reserve -452,752 / user +452,752;
- 46,274 raw USDC: user -46,274 / reserve +46,274; SCS reserve -452,762 / user +452,762;
- 46,275 raw USDC: user -46,275 / reserve +46,275; SCS reserve -452,772 / user +452,772.

The reverse SCS-to-USDC direction returned `SWAP_QUOTE_INSUFFICIENT_LIQUIDITY` for the current active liquidity, so a same-pool atomic round trip was not fabricated. This is a current one-sided-liquidity condition, not evidence of value creation.

## Unauthorized mutation and rollback results

For flash-composed swaps:

| Mutation | Observed rejection |
|---|---|
| swap owner replaced by outsider | token custom 4 (owner mismatch) |
| pool USDC reserve replaced with another verified same-mint vault | Anchor custom 2001 (`ConstraintHasOne`) |
| token program replaced with System Program | Anchor custom 3008 |
| user output aliases the pool reserve | Anchor custom 2040 |
| valid swap followed by outsider swap | rejection; all deltas empty |
| outsider swap followed by valid swap | rejection; all deltas empty |

For `ClaimFee2` and `RemoveLiquidityByRange2`:

| Mutation | Observed rejection |
|---|---|
| position owner replaced by outsider | Anchor custom 2003 (`ConstraintRaw`) |
| either reserve replaced by a same-mint vault from another pool | Anchor custom 2001 |
| token program replaced with System Program | Anchor custom 3008 |
| valid control then invalid control | rejection; all deltas empty |
| invalid control then valid control | rejection; all deltas empty |

These controls cover signer binding, pair-to-vault binding, mint/program binding, alias constraints, instruction ordering, and transaction atomicity. They did not reveal an authorization bypass.

## Protocol fees, rewards, and migration

### `WithdrawProtocolFee`

Three current `Operator` accounts were enumerated. The first two operator signers rejected with custom 6096 (`InvalidPermission`). Operator `Gmdg2HkLtawm68JcjwqVQNWdpZKiuhiCPw6EQsjMCPCk`, signer `Aa8oCaj5BFY5jFSCCNGkFQXcbQYvy2WbeKH73m7ABcsn`, permission value `0x3000`, passed that check but rejected with custom 6097 (`IncorrectATA`).

The tested receivers were the signer's canonical ATAs for the current mints and token programs, created idempotently in the same v1 transaction—the construction used by the current official CLI. The pair then reported 16,886,955 raw TRUMP and 32,637,463 raw USDC in protocol-fee counters. Outsider, foreign-vault, token-program, and alias variants also rejected without value movement.

Because no current successful control could be formed, this surface remains incomplete. The result may reflect an additional receiver policy or a CLI/program mismatch, but it is not an unauthorized-withdrawal finding.

### Rewards

Across the 58 strictly verified pools, only two nondefault reward slots existed:

- JUP/JitoSOL vault `FD7ydpv3Yi9SsX72aafGuzfP8TsVdBRRTtKn9tW8piUr`, end time `1709188086`;
- JUP/bSOL vault `9uj65DWvKvgYS4K2jTxQ43LffN1PAb7m65Stn3LDxAcN`, end time `1709188363`.

Both were expired; active reward slots in the verified sample were zero. Recent instruction discovery found no `ClaimReward2` hit. A positive current reward-claim mutation suite therefore could not be formed without inventing state.

### Migration

`migratePosition` is absent from current IDL 0.12.0, was absent from the recent-history scan, and its legacy discriminator `0f843b32c706fb2e` rejected directly with Anchor error 101, `InstructionFallbackNotFound`. No current migration entry point was substituted.

## Limitations and residual risk

- The program is upgradeable; all conclusions are tied to the executable hashes and observed slots above.
- This is black-box current-state testing against a closed implementation. It cannot prove absence of every internal arithmetic or state-machine flaw.
- Strict custody totals cover 58 of the sampled top 100 pools, not every historical DLMM pool.
- No active reward campaign existed in the verified sample, and current protocol withdrawal could not be positively controlled.
- The 100,000-USDC and near-reserve round trips need more reverse bin-array accounts than this fixed account set supplied.
- `sigVerify:false` is appropriate for read-only authorization-path simulation but is not evidence that any private key is available to an attacker.
- The KLend result is reserve- and slot-specific. It demonstrates real atomic composability and capacity, not a promise of permanent zero-cost funding.

Within those limits, the tested current authorization, custody-binding, accounting, fee, rounding, dust, thin-reserve, bin-traversal, repeat-leg, oracle-update, alias, ordering, and atomicity controls did not produce positive unauthorized P&L.

## Evidence artifacts

- [Custody inventory and executable identity](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-custody.json)
- [Current top-pool swap construction and quotes](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-current-swap-built.json)
- [Atomic KLend/DLMM version-1 simulations](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-flash-v1.json)
- [KLend direct amount/order/alias boundaries](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-klend-v1-extremes.json)
- [Current fee and liquidity controls](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-position-controls-v1.json)
- [Current protocol-withdraw attempt](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-protocol-withdraw-v1.json)
- [Thin-pool quotes](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-thin-swap-built.json)
- [Thin-reserve version-1 simulations](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-thin-reserve-v1.json)
- [Verified reward-slot inventory](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-rewards.json)
- [Recent instruction discovery](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-control-signatures.json)
- [Reproduction harness: current state controls](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-simulations.js)
- [Reproduction harness: flash composition](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-flash-v1.js)
- [Reproduction harness: thin reserve](/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-thin-reserve-v1.js)

## Primary references

- [Meteora DLMM developer guide](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx)
- [Meteora DLMM program instructions](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/instructions.mdx)
- [Meteora DLMM account definitions](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx)
- [Meteora DLMM events](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/events.mdx)
- [Official DLMM IDL](https://github.com/MeteoraAg/dlmm-sdk/blob/main/idls/dlmm.json)
- [Official current protocol-fee withdrawal CLI implementation](https://github.com/MeteoraAg/dlmm-sdk/blob/main/cli/src/instructions/operator/withdraw_protocol_fee.rs)
- [Meteora DLMM Data API](https://dlmm.datapi.meteora.ag)

