# Fragmetric JSOL instant-exit gate — 2026-10-15

Target core restaking program: `fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3`; fund `3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb`. This was a narrow read-only gate for an outsider's atomic JSOL deposit → receipt → JSOL/SOL withdrawal or unwrap. No transaction was constructed, signed, simulated on mainnet-beta, or broadcast. The read-only RPC used `/tmp/composer-helius-only.env` at runtime without saving the endpoint. See [current gate](instant-exit-current-gate.json) and [batch state](instant-exit-batches.json).

## Exact public handlers and ownership

The installed Fragmetric SDK 3.0.2 assembles `userDepositSupportedToken` for a supported JSOL deposit and `userRequestWithdrawal` for a receipt redemption request. The claim step is a separate `userWithdrawSupportedToken` (or `userWithdrawSol`) instruction carrying an existing `batchId` and `requestId`. In the SDK implementation (`sdk-3.0.2/dist/index.node.cjs`, lines 183061–183186 and 183188–183461), the claim builder first finds that request in the **signing user's** `withdrawalRequests`, then supplies its batch ID. Generated instruction code derives the `userFundAccount` PDA from `"user_fund"`, receipt mint, and user address (`sdk-3.0.3/src/generated/restaking/instructions/userWithdrawSupportedToken.ts`, lines 486–497). This is client and account-routing evidence, not an independently tested deployed-binary owner check.

The SDK's `unwrap` method invokes `userUnwrapReceiptToken` to turn **wrapped receipt tokens back into receipt tokens** (`sdk-3.0.2/dist/index.node.cjs`, lines 183555–183613); it does not return JSOL or SOL. Ordinary fund commands are callable by anyone, according to the official local release notes (`official-docs-source/dev/release-notes.mdx`, lines 57–66). The SDK selects the configured admin address when `forceResetCommand` is supplied, while normal `runCommand` uses the caller (`sdk-3.0.2/dist/index.node.cjs`, lines 46158–46226). The generated error list includes `FundOperationUnauthorizedCommandError` (6064). We did not signed-test the deployed authorization condition, so forced processing is an unproven outsider route.

## Current finalized gates

At finalized slot **457406634** (2026-10-15T22:37:37Z), the fund account SHA-256 `f68aefd500e0a4cf86bb4d325eec26fbde1cc1e7cf0a674cf92646f542707880` matched the earlier local snapshot. The JSOL reserve `5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa` held **36,616,676,915,546 raw = 36,616.676915546 JSOL**. The live decoded fund fields were:

| Field | Value |
| --- | ---: |
| Global withdrawal enabled / JSOL deposit enabled | 1 / 1 |
| **JSOL withdrawal enabled** | **0** |
| SOL withdrawal enabled | 1 |
| Withdrawal batch threshold interval | **72,000 seconds (20 hours)** |
| Withdrawal fee | **20 basis points** |
| JSOL pending batch / requests / last processed | 1 / 0 / 0 |
| SOL pending batch / requests / last processed | 572 / 1 / 564 |

At finalized slot **457406737**, the SOL account showed queued batches **565 through 571**, all unprocessed, with pending batch **572**. The latest SOL batch was enqueued at Unix `1792044098` (2026-10-15T06:01:38Z), so the configured 20-hour interval reaches its next point at **2026-10-16T02:01:38Z**. That is about 3 hours 24 minutes after the observation, before considering the seven queued batches. This is a configured timing screen; exact scheduling may depend on deployed program logic. The official local withdrawal guide states requests enter a queue and become claimable after **three epochs, up to approximately six days** (`official-docs-source/home/guides/restake-unstake.mdx`, lines 65–83).

## Result and limits

**The requested atomic deposit → receipt → direct JSOL exit stops at the live JSOL `withdrawable = 0` gate.** An SOL exit is a different, queued path requiring a processed request/batch; a receipt unwrap cannot return the borrowed JSOL. Thus no coherent same-transaction JSOL flash repayment or positive final equity is established, and a hooked-wallet signed mainnet simulation was not warranted. The roughly $5.22 million gross JSOL reserve mark from the earlier queue represents backing assets for receipt claims, not free incremental protocol equity.

Remaining unknowns are the exact deployed-binary checks for force reset, exceptional batch triggers, and any external market exit from receipt/wrapped receipt tokens. The SDK and official documentation are not a byte-for-byte attestation to the current ELF. This report is a negative gate for this narrow route, not a claim that all Fragmetric paths are safe or that a novel vulnerability exists.
