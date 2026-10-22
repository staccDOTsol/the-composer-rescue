# Jupiter YOLO mainnet-beta audit disposition

Observed 2026-10-19. Target program: `yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA`.

## Result

**No outsider-accessible, immediately realizable net-positive flaw was verified in the deployed program.** The tested open, close, liquidation, payout, fee-withdrawal, oracle-substitution, and close-replay paths did not produce value for an unauthorized caller. This is a bounded negative finding for the exact binary and state snapshots below, not a proof that the program is free of every defect.

No value-moving transaction was broadcast. Mainnet probes used reads or `simulateTransaction`; the one positive `ProcessPayout` control ran only on a local fork after explicitly synthesizing claim and queue state.

## Exact target and attribution

- Deployed binary: `yolov-current.so`, 602,512 bytes, SHA-256 `c75637981b6731d8719d8521e93176e00dc5f74d861413ba1475a6af84c9d9c4`.
- ProgramData: `86FJSZxQwcyUdWBzVknsfwm3qCVwK3Z7ocBXLVoSxA7z`; last deployment slot **458289770**; upgrade authority `B4HN8cCrVdR19Zku9XPDPkYsGVTPHkWf6brncTT2d7vB`.
- Jupiter's production YOLO client asset contains this exact program ID and uses `https://yolo-api.jup.ag`; the official product page describes 500–1,000× SOL/BTC/ETH positions. This independently identifies the program as Jupiter YOLO, not Jupiter Prediction.
- Pool PDA: `6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX`; JupUSD vault: `4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP`. At slot 458740168 the vault held **127,477.994338 JupUSD**, exactly matching the sum of the pool's three observed accounting fields.

## Composer-first interface recovery

No published IDL was available. Composer recovered six selectors from recent receipts: open, close, liquidate, pre-swap open, swap open, and Anchor `emit_cpi!`. The refreshed 1,000-signature sample contained 2,466 invocations and no additional selector. A held-out post-freeze set contained 16 transactions and 42 invocations, all among the same six selectors. Composer overapproximated writable privileges for two swap-open accounts, so its account flags were treated as hypotheses rather than authorization facts.

Static dispatcher analysis of the exact ELF additionally recovered the rare `ProcessPayout` and `WithdrawFees` handlers and the migration/admin surface.

## Authorization and value-path checks

### Open and close

- Fresh, correctly derived outsider position PDAs reached the real `OpenPosition` keeper check and failed `ConstraintAddress` (2012). The required keeper address was `A2rCQdCqQB4wu72x9Q7iq1QugtdZmcyWsiSPfgfZzu2u` for collateral amounts 0, 1, and 5,000,000 raw units.
- An outsider-owned live-format position and a destination ATA created in the same simulation reached the same fixed-address check in `ClosePosition`.
- Replays based on recent successful open/close receipts, with the owner replaced and the fixed keeper left non-signing, failed `keeper AccountNotSigner` (3010).
- The official build API returned unsigned messages requiring exactly two signatures: the user and `A2r…`. The production client verifies that the wallet-signed message bytes equal the server-built message before execution. The submit endpoint was not called.

These controls block a direct outsider open/close construction and are not bypassed merely by adding flash liquidity.

### Double close

An official API-built close for active position `3aC4wZSd8qqXDMU3ENDjepCarw75k16p7exu1kwWPJPR` was simulated with signature verification disabled solely to exercise handler state transitions. One close transferred **50,318,597 raw JupUSD** from the vault to the owner's destination. Appending an identical second close caused instruction index 6 to fail `PositionClosed` (6015, `program/src/state.rs:194`). Solana transaction atomicity rolled back the first close as well, yielding zero effective token and state deltas. No replay payout was observed.

### Liquidation and oracle substitution

- `LiquidatePosition` is permissionless at the program boundary. A current successful receipt paid no token reward; the outer payer's exact net was **0 JupUSD and -60,001 lamports** (60,000 transaction fee plus the one-lamport Pyth verification transfer).
- Correct-oracle simulations against inactive or non-liquidatable positions were idempotent no-ops. One-, two-, and three-call atomic compositions left market, pool, position, and token balances unchanged.
- Substituting a BTC or system account for the SOL oracle, or a SOL/ETH oracle for an active-format BTC position, failed `InvalidOracle` (6013). Recent economic receipts used the Pyth Lazer verification/update path. A manipulable AMM spot account could not be substituted as the mark oracle in the tested path.

### ProcessPayout

- `ProcessPayout` is permissionless and uses claim discriminator `59c9f09ad4ff485c`. A current full program-account census found no live claim of this type, so no genuine positive mainnet payout could be simulated.
- On a clearly labelled local mainnet fork, a synthetic one-unit claim transferred exactly **1 micro-JupUSD** to the claim owner's token account, advanced the FIFO queue, closed the claim, and reduced pool pending accounting by one.
- Wrong discriminator, wrong queue index, wrong destination owner, and insufficient pending balance each failed. Static parsing also binds the supplied owner key to the owner stored in the claim.

This proves permissionless settlement of a valid claim, not outsider redirection or claim creation. The synthetic payout's recipient was the claim owner, not an attacker-selected third party.

### WithdrawFees and migrations

- `WithdrawFees` can be triggered without the fixed receiver signing, but the parser requires `fee_receiver == A2r…` and requires the destination token owner to match that receiver. An outsider substitution failed `fee_receiver ConstraintAddress` (2012). The handler also rejects amount zero and a nonempty payout queue. No caller-controlled fee destination was found.
- `MigratePosition` is admin-bound. The current config layout does not pass the legacy-layout gate needed by `MigrateConfig`; no current-state outsider mutation path was demonstrated.

## Economic conclusion

No tested composition yielded positive outsider-denominated value after fees:

- outsider liquidation: **0 JupUSD, -60,001 lamports** in the observed successful receipt;
- repeated liquidation: no state or token delta;
- duplicate close: `PositionClosed`, atomic rollback, zero effective delta;
- payout: only a synthetic fork claim paid its bound owner;
- fee withdrawal: fixed receiver and destination owner, no attacker redirection;
- open/close: fixed keeper address and signer gates.

Accordingly, there is no exploit transaction or profitability calculation to report. The strongest remaining uncertainty is server/operator authorization policy around `A2r…`, plus handler/state combinations absent from current mainnet state. Those are trust and coverage limits, not verified outsider-profit findings.

## Evidence index

- Interface and held-out validation: `yolov-composer-interface-gate.md`, `yolov-composer-learn.json`, `yolov-composer-learn-1000.json`, `yolov-composer-holdout.json`
- Exact deployment: `yolov-program-attestation.json`, `yolov-current.so`
- Custody and account census: `yolov-auth-custody.md`, `yolov-auth-snapshot.json`, `yolov-economics-type-census.json`
- Open/close gates: `yolov-open-corrected-gate.json`, `yolov-close-corrected-gate.json`, `yolov-position-seeds.json`
- Official client binding: `yolov-official-client-evidence.json`
- Liquidation/oracle/economic controls: `yolov-economics-report.md`, `yolov-economics-active-liquidate-control.json`, `yolov-economics-oracle-binding.json`, `yolov-economics-oracle-age.json`, `yolov-economics-traces.json`
- Rare handlers: `yolov-rare-handlers.md`, `yolov-rare-fees-9-8-probe.json`, `yolov-rare-claim-type-fork.json`, `yolov-rare-claim-layout-fork.json`, `yolov-rare-payout-cpi-fork.json`
