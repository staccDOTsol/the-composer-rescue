# Hadron v2 SDK / atomic-envelope gate

Observed 2026-10-19 at mainnet-beta slots 458743310–458743313. All RPC work was read-only. No transaction was signed, simulated, or broadcast.

## Result

No complete hooked-wallet simulation was authorized in this branch because no current after-cost-positive route with an independent DGLD exit was supplied. The complete borrow → Hadron → independent exit → repayment transaction was therefore not constructed.

Static sizing of the non-exit prefix/suffix (optional DGLD ATA creation, zero-fee KLend USDC borrow, one official-SDK Hadron USDC→DGLD swap, and KLend repayment) is recorded in `hadron-sdk-envelope-audit.json`. It is not an exploit transaction and cannot establish executability or profit. Its v1 encoding is 1,133 bytes, 28 unique accounts, four instructions, one signer, leaving at most 2,963 bytes and 36 accounts for an independent exit under the requested 4,096-byte/64-account caps. This proves only that the Hadron/flash scaffolding is not itself the packet-size blocker; exit-specific accounts, data, compute, fees, and repay coverage remain unproven.

## Current SDK and state observations

- Official SDK package: `@hadron-fi/sdk-v2` 0.1.9. A DGLD swap is a 26-byte instruction with 17 account metas. Only the user is a signer. The DGLD mint is appended because Token-2022 transfers use checked transfer semantics.
- The hooked wallet's USDC ATA exists; its DGLD ATA did not exist at the observed slot, so a complete path needs an idempotent Token-2022 ATA creation unless it is created beforehand. The wallet had 289,459,598 lamports, sufficient for that setup in principle.
- DGLD mint extensions are `PermanentDelegate`, `TransferFeeConfig`, and `PausableConfig`. Both current and older transfer-fee schedules are exactly 0 bps with maximum fee 0; the mint-level and pool-vault withheld amounts are zero. There is no transfer-hook extension. The mint is not paused.
- The DGLD vault carries `ImmutableOwner`, `TransferFeeAmount`, and `PausableAccount`; its withheld amount is zero. Therefore no current outsider-positive route can be justified from Token-2022 fee/withheld accounting alone. Permanent-delegate and pause authority are privileged mint controls, not outsider capabilities.
- The current DGLD curve-update PDA had sequence 0 and `numOps = 0`. Although swaps pass that PDA writable (so pending ops matter when nonzero), there was no queued update to trigger on the next swap at the observed slot.
- The SDK deterministically derives the user's source/destination ATAs and the pool vaults. Its account slot 6 is explicitly documented as an unused `_authority` slot; aliasing that slot changes no SDK-level value flow. The signer slot cannot be aliased to a pool PDA by an outsider. Raw-instruction alias validation remains an on-chain binary question, not something the SDK alone proves.

## Hard blockers before signed simulation

1. A fresh, executable independent DGLD→USDC exit quote/instruction set whose conservative output exceeds Hadron input plus AMM fee, external venue fees/slippage, flash fee, priority/base fee, Token-2022 effects, and ATA rent if not reclaimed.
2. Exact exit account list and instruction data showing the complete v1 transaction stays within 4,096 bytes, 64 accounts/instructions, and the compute/data limits.
3. Exact repayment coverage with nonzero `minOut` values and fresh blockhash/state. Only then should the hooked wallet sign and call `simulateTransaction` with `sigVerify:true`; the transaction must never be broadcast.

Evidence: `hadron-sdk-envelope-audit.json` and reproducible read-only/static script `hadron-sdk-envelope-audit.js`.
