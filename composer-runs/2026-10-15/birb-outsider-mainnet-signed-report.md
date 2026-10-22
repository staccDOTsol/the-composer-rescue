# BIRB staking Withdraw: outsider signed mainnet-beta screen

Observed 2026-10-15. The selected lower-use controller is
`tbg7LYoHuCogZ54p6z6BaALBiyXy9b7hN368EHGh3EE`, with a ~$798,987
top-holder spot mark in the earlier 76-program ranking. That mark is not a
liquid exit estimate. The controller's current BIRB vault contains
15,175,464.870338 BIRB. A post-deployment `Withdraw` at slot 457187700
transferred 4,345 BIRB directly from this vault, establishing a live public
value-changing path. ProgramData's current deployment slot is 442466831.

## Current authority and selected position

- The config account `GcqAvs4CsY86eWQzaEqEsg2CYSKYdLfkGtCrPUL9sjpJ`
  is program owned and derives from `["config"]` (bump 254). Its stored vault
  field points to `5xi165ttDbd1cN4ot4zLMWE59FMLM7dAeTECsGWqQcMz`.
- The vault is an SPL Token account for BIRB mint
  `G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG`; its token authority
  is the config PDA. The mint is initialized under the SPL Token program with
  six decimals.
- A recent depositor has a current 7,596.06 BIRB stake record at
  `FWbL7ozRuZpn8HAVgUEeuA1K9pWobzTLAPZ6Pr26SnLe`. It derives from
  `["stake", depositor]` (bump 255), is program owned, and stores that
  depositor's key. The hooked wallet's own derived stake PDA does not exist.
  The depositor's transaction was at slot 457054358, after the current
  deployment.

## One signed outsider mutation

Using `/Users/stacc/hooked.json` at runtime, a 494-byte, 11-key v0 packet
would create the wallet's BIRB ATA, then call the deployed `Withdraw` handler
with the wallet as signer and recipient, the depositor's live stake PDA, and
a 1 BIRB withdrawal amount. `simulateTransaction` ran on mainnet-beta at
slot 457404183 with `sigVerify:true`; no transaction was submitted and no
account balance was synthesized.

The program rejected the call with Anchor `ConstraintSeeds` 2006 on `stake`
before its token transfer. Because the failing RPC returned null simulated
post-account images, separate read-only confirmed-chain snapshots at slots
457404182 and 457404183 provide the pre/post reconciliation:

| Item | Before | After |
|---|---:|---:|
| Hooked wallet BIRB ATA | absent; 0 BIRB | absent; 0 BIRB |
| Hooked wallet SOL | 0.937809515 | 0.937809515 |
| Pool vault BIRB | 15,175,464.870338 | 15,175,464.870338 |
| Depositor recorded stake BIRB | 7,596.06 | 7,596.06 |
| Config account's stored account 2 SOL | 0.278866292 | 0.278866292 |
| Lender debt | 0 | 0 |

This tested outsider substitution yielded **zero BIRB or SOL gain** and no
observed custody change. The seed failure is explained by the stake PDA's
derivation from the original depositor, not by lack of vault liquidity. The
result covers this current `Withdraw` account shape and one funded depositor;
it does not prove that every BIRB controller instruction or position is safe.
The sampled spot mark is not proven immediately at risk.

Evidence: [signed simulation and snapshots](birb-outsider-mainnet-signed.json),
[source transaction and account inspection](birb-live-exit-inspect.json), and
[recent nonzero-position sample](birb-recent-position-sample.json).
