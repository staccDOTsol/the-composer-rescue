# JanusFI current-binary signer and exact-input cross-check

Observed 2026-10-15 19:36–19:43 UTC. Read-only RPC calls only; no transaction was submitted. The deployed JanusFI ELF at `JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP` had SHA-256 `197f8969043e378d47859d806c9d029f21921e65614844cd5ff37a9a3cea08db` (deploy slot 457,294,564). Source data and raw simulation outcomes are in `janusfi-current-inventory.json`, `janusfi-current-simulations.json`, and `janusfi-signer-probe.json` in this directory.

## Permissionless gate

An on-curve user `2PZHHAa1J2H2wHTtFW6Lm1qtwub3GJ1R9Wd5BFX3rgcV` owned funded CASH and matching outcome token accounts. Direct Janus buy and sell at 1,000,000 raw units both failed `MissingRequiredSignature` after about 379 CU, before state changes. Dust and huge amount variants hit the same gate after zero-amount validation. A historical DFlow wrapper replay also failed `InvalidInstructionData` (15999); the reason for that wrapper rejection is not established.

A controlled `sigVerify:false` diagnostic promoted one historical account at a time to signer. Promoting index **18**, `8xeaWCsJYxRoudEZGJWURdfrtFhLYZz9b4iHJnW5tb3d`, made the Janus buy succeed on two sampled market states. Promoting indices 1, 2, 3, 17, or 19 left the 379-CU signature failure. Index 18 is **off curve**, System-owned, and appeared in 299 sampled Janus routes, all inside DFlow outer instructions. Its fake top-level signature cannot exist in an executable outsider transaction. These signer-promoted simulations identify the gate and expose pricing arithmetic; they are **not exploit transactions**. The 300 fetched recent transactions contained 299 Janus inner instructions, zero Janus top-level instructions, and all 299 Janus-containing transactions included DFlow.

The exact-zero-fee CASH Kamino Lend reserve `GCRm26EuqzHtH8U3zTsXMEnq864qAGkkcAjMBL4dw9XC` had 3,070,529,773,614 raw available at slot 457,356,315. Borrow and repay controls from 1 raw through exact available succeeded in serialized v1 transactions of 531 bytes; available plus one failed 6008. This establishes usable same-asset liquidity but does not overcome Janus's signer gate.

## Diagnostic exact-input accounting

The active sample market was `5vQKTtZJp52mmAUCU2CJT48hvz1XbNXiLHcibJpbuwUi` and its observed user's CASH/outcome accounts were `81QnJkihJuSLZRyHaBhtcWgBRQkJbnBHccVDWpdbN12F` / `AxJbrrCzH1qZ5jYCkNT2Vb9BpUBqhDkzg6Mhqrmqn3DC`. Every row below used the **impossible off-curve signer** solely to reach Janus math. Sell input was the exact outcome received from the buy in the same simulated v1 transaction. No residual outcome remained after successful round trips.

| Buy CASH raw | Outcome received raw | Two-leg v1 bytes | Final caller CASH raw delta | Result |
|---:|---:|---:|---:|---|
| 1 | 3 | 890 | — | sell rejects zero rounded output (6310) |
| 100 | 362 | 890 | -8 | success |
| 1,000,000 | 3,629,698 | 890 | -76,228 | success |
| 4,000,000 | 14,518,536 | 890 | -304,946 | success |
| 8,000,000 | 29,036,346 | 890 | -609,990 | success |

Two and four repeats of the 1,000,000-raw buy/sell pair succeeded at 962/1,106 v1 bytes and lost 152,456/304,912 raw CASH respectively. Eight repeats serialized at 1,394 bytes but failed `MaxInstructionTraceLengthExceeded` at instruction 8; serialized size alone did not ensure execution. Larger standalone buys tested at 100/1,000/4,000 CASH failed Token-2022 `insufficient funds` because this sampled wallet did not own that much CASH; those are **not** pricing or reserve-limit tests. Sell-first with 100 through 16,000,000 raw outcome also failed Token-2022 `insufficient funds` because this sampled wallet's current outcome balance was zero; only buy-first sell was tested to completion.

## Conclusion and limit

No outsider-accessible Janus drain was validated. The current direct route is blocked before pricing by an off-curve signer requirement. Reaching Janus through a valid DFlow route would require separately establishing its quote and authorization path. In the signer-promoted diagnostic context, dust, 1–8 CASH, and four complete repeated cycles show loss or rejection rather than gain. No independent price-dependent payout consumer was identified among the 299 sampled routes; the sampled Janus calls are DFlow CPI routes, some followed by prediction-program instructions. That is a bounded sample, not an exhaustive consumer census.
