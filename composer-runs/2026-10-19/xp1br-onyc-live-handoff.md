# XP1BR ONyc live branch — selection handoff

Observed 2026-10-19 by read-only Solana public mainnet-beta RPC. This is a candidate, not a vulnerability finding. No transaction was submitted.

- Program: `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy`.
- ONyc principal vault: `2bBGqb9qY7e2q6pFDKdsHqDoQiGmaeDKktezXJ2AcGDo`.
- Vault token authority / `SyMeta`: `BmLiVHRb9ppTrEA5jhTgNJ2WFtjUZEkfzJZGswEidxzu`.
- Finalized `getTokenAccountBalance` at slot `458774908`: `28801050362754990` raw ONyc, 9 decimals = **28,801,050.362754990 ONyc**.
- Finalized successful vault outflow receipt: `2tnvGujdVCUzijtSgMzcwfTSPGioVYMNBpB6y6mJfNokHpg2nAuRMYmQw5dmDenxQseBTw54YApBxHBQkMpQLZKr`, slot `458773596`. Vault token balance fell by `41228245417` raw ONyc (41.228245417 ONyc). Its parsed inner `transferChecked` used the meta as authority. Execution logs show `XP1BR… invoke [2]` immediately followed by `Tokenkeg… invoke [3]` for the outflow, establishing XP1BR as the immediate signer program for this selected transfer.
- In the bounded latest-20-signature sample, additional current outflows were observed at slots `458771045`, `458769428`, `458766862`, `458766707`, and `458763095`; their signer-parent attribution should be checked before use as evidence.

The [Oct 15 XP1BR audit](../2026-10-15/xp1br-audit-report.md) identified 47 `SyMeta` accounts and tested BulkSOL mint/redeem, account-role substitutions, position ownership, and Project0 flash extremes. Its ONyc row was ~$33.3m at an older mark, **not** a current liquidation-value estimate. Dynamic ONyc mint/redeem, current executable identity, ordinary outsider reachability, rate/fee math, independent exit depth, and exact usable same-mint flash liquidity remain unverified.

Next gate: pin current deployed ELF and Composer IDL/learned schema; reconstruct a successful ONyc mint/redeem receipt; replay a tiny fresh-outsider signed `sigVerify:true` paid control against current mainnet or an exact current fork. Only test multi-source atomic flash economics if an outsider-reachable value-moving route and executable ONyc exit survive, and reconcile all lender, wallet, vault, and receipt liabilities. No broadcast.
