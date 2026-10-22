# XP1BR ONyc adapter — current mainnet outsider audit

Date: 2026-10-19  
Program: `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy`  
Safety: read-only mainnet collection and signed local-fork simulation only; no broadcast.

## Result

No validated outsider-profitable path was found. The decisive control was locally signed and executed on a mainnet-backed fork; it was not a landed mainnet transaction. It borrowed, used XP1BR mint/redeem, and fully repaid 133,559,754.277156568 ONyc atomically. Outsider ONyc/SY, principal vault, SY supply, SY escrow, and lender token deltas were all zero; outsider wallet equity was -5,000 lamports.

## Current identity and accounting

| Item | Observation |
|---|---|
| Executable SHA-256 | `a1f2fa4b17fc8fe8916b75af91e79bb13614b9913f641fc00dfa33e9228f33b3` |
| Executable size | 960,541 bytes |
| ProgramData / deploy slot | `54ht...GJHV` / 456,137,922 |
| Upgrade authority | `2tX7...b9TP` |
| 2026-10-15 comparison | Byte-for-byte identical |
| Composer IDL | HTTP 400; no published IDL |
| Composer Learn | HTTP 200; 26 instruction shapes |
| Principal vault | 28,801,050.362754990 ONyc |
| Issued SY supply | 28,801,050.362754619 SY |
| Vault surplus | 371 raw units |
| Protocol SY escrow | 28,666,198.852046383 SY, a subset of supply |

Composer was queried first. With no published IDL, learned shapes were checked against fresh receipts: mint `4YK21...29BL` at slot 458,773,706 increased the vault by 1,038,499,999 raw units, and redeem `2tnv...LZKr` at slot 458,773,596 decreased it by 41,228,245,417 raw units.

## Signed controls

The locally signed mainnet-backed-fork exact-cap KLend transaction borrowed 133,559,754,277,156,568 raw ONyc, XP1BR minted and redeemed 115,419,895,775,639,397 raw units, and repaid the lender in full. It was 871 bytes with 19 accounts, used 171,670 compute units, and has wire hash `ff31b671393dec41f2c5038fa4669f63b2798bbbe920bf77c3462d453570fa01`. Cap plus one raw unit failed with KLend error 6008.

A separate dust reserve had only 100,000 raw units (0.0001 ONyc) of live capacity. Its two-raw-unit preserved-account control also ended with zero token/protocol deltas and -5,000 lamports after treating owned account rent as wallet equity. No further dust-only runs were performed.

Authorization and mutation checks rejected protocol escrow as outsider redeem source, the principal vault as outsider mint source, and over-redemption. An unrelated rate/interface account caused `ProgramFailedToComplete` with full rollback. Two- and four-cycle repetitions succeeded with zero token/protocol deltas and only the fee.

## Rounding, alias, and exit checks

Synthetic funding was used only as a precursor screen and excluded from profit. Fifteen successful cases covered raw amounts 1, 2, 3, 999, 1,000, 1,000,000,000, vault fractions, vault minus one, the full vault, and 2/4/8 repetitions. None produced positive token equity. Destination aliasing succeeded only as a donation of 864,181 raw ONyc to the vault.

The independent current ONyc-to-USDG exit test was also negative: its largest fully repaid KLend-plus-Jupiter cycle lost the outsider 2,862,135.646230 USDG.

No multi-provider escalation was warranted because there was no positive precursor and one live reserve already exceeded the entire principal vault. Two KLend reserve borrows in one transaction failed before XP1BR with `MultipleFlashBorrows` error 6035; the inventoried providers contained no Project0 ONyc route.

## Limitations

- Conclusions are pinned to the executable hash above; the program is upgradeable.
- Composer provided learned shapes but no published IDL.
- Public RPC HTTP 429 responses prevented duplicate refreshes after the successful finalized snapshot at slots 458,776,710–458,776,778.
- The unrelated-rate-account panic demonstrates transaction-local failure, not extraction.
- Codex Security workbench registration failed: “The selected scan target changed while the scan was starting. Try again.” It was not silently substituted or retried.

## Evidence

- [Current refresh](xp1br-onyc-current-refresh.json)
- [Composer Learn response](xp1br-composer-learn.json)
- [Current executable](xp1br-onyc-current.so)
- [Signed live-state control](xp1br-onyc-signed-control.json)
- [Synthetic extremes](xp1br-onyc-synthetic-extremes.json)
- [Independent stable-exit audit](onre-current-mainnet-outsider-audit.md)

No RPC credential, private key, or broadcast transaction is present in the artifacts. Complete for the tested current executable and routes; no finding to file.
