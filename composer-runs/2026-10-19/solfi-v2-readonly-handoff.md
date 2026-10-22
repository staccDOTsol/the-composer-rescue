# SolFi V2 USDC/USDT pool — current read-only handoff

Observed 2026-10-19 on Solana mainnet-beta. No transaction was signed, simulated, or broadcast in this pass.

## Current program and custody

SolFi V2 `SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF` is executable under the upgradeable loader. Public `solana program show` returned ProgramData `H6M3jMJCednoAr7BR9P6versKQmbo5kV3oi8R5JsWNKz`, last deploy slot **406030591**, upgrade authority `BQoUfnC2UGfzgv9joUhNZ9BoPaXbPifs3WDR7pV5DFXm`, and 248,272 ELF bytes. The freshly dumped [deployed ELF](solfi-v2-current.so) has SHA-256 `1d8503647bd9d4982c5ac333f12c3b803c50dfa241b9e8d087983c1ec28c549b`.

At confirmed slot **458754010**, pool `FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32` remained SolFi-owned (1,728 bytes). Its SPL vaults both named that pool as token authority:

| Vault | Exact mint | Raw amount | Human amount |
|---|---|---:|---:|
| `ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 356,945,928,697 | 356,945.928697 |
| `5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc` | USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 393,422,493,859 | 393,422.493859 |

[Raw current accounts](solfi-v2-current-accounts.json) establish about $750k gross stable custody at par, for candidate selection only. This is not an exploitable amount.

## Post-deploy signer outflow

Confirmed [transaction](solfi-v2-current-outflow-receipt.json) `37kfk4jFeRwzsa4Tcak5HZLdpsjrrTMRu8BtEBPKR5kAMeeDUea8LD6J6W98D51mn4eWVSrRGXphaGQk9jrRQzNF` at slot **458753897** succeeded. Its top-level Jupiter v6 route invoked SolFi V2 at inner stack height 2, followed by an SPL Token transfer at height 3 of **241.157252 USDT** from the listed USDT vault to `FbnBvCu7LXHeLwsqGhCRsSMfNh2ZxYoqHCHmb5EEdn8t`; transfer authority was the SolFi-owned pool. This proves that the *current deployed* SolFi program signs outflows from this live vault. It does not establish an outsider drain: the observed transfer was part of an input-paid routed trade, and the original transaction signer was `MenuxY5yMzJkeKZTvDTcovjh4fuJHMHhJyjJ5v5LzG6`.

The earlier [bounded pool gate](../2026-10-15/solfi-v2-current-gate.md) found an independent two-leg quote of only +0.000132 USDC gross at 100 USDC, below its measured base-fee estimate, and negative larger cases. Those quotes do not settle any other state or route. No signed outsider control for SolFi appears in the October 19 ledger; the next distinct audit should construct a current routed signed control and check exact input/output/authority deltas before any 2–3-provider flash envelope. This report is a read-only handoff, not exploit progress.

## Selection boundary

The prior Orca governance outsider-withdrawal signing attempt was rejected by automatic approval review because it would use a private wallet key for a third-party withdrawal without explicit credential authorization. It was not executed or retried. RateX RTX vesting has a real claim outflow but no independent liquid USD mark, so its 8 million raw-token units do not meet the ≥$100k stable/major priority. Neither is substituted for this SolFi handoff.
