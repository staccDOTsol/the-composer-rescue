# Jupiter YOLO candidate: Composer-first interface gate

Observed 2026-10-19 on Solana mainnet-beta. Target program:
`yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA`.

## Exact deployed target

- Upgradeable ProgramData: `86FJSZxQwcyUdWBzVknsfwm3qCVwK3Z7ocBXLVoSxA7z`.
- Last deploy slot: **458289770**; upgrade authority: `B4HN8cCrVdR19Zku9XPDPkYsGVTPHkWf6brncTT2d7vB`.
- Current dumped binary: **602512 bytes**, SHA-256 `c75637981b6731d8719d8521e93176e00dc5f74d861413ba1475a6af84c9d9c4`.
- [Program attestation](yolov-program-attestation.json) and [binary](yolov-current.so) are the target of all current-state conclusions.

## Composer recovery and correction

The live Composer `/idl/<program>` check returned `no published IDL account`. Its `/learn` result with 250 signatures reconstructed six distinct selectors from 613 sampled invocations. A `refresh=true` run with 1000 signatures still returned six selectors from 2466 sampled invocations. The latter run reported its seed search exhausted, so its PDA recipes and account privilege flags are hypotheses, not a complete program specification. The frozen 250-signature artifact SHA-256 is `c376dad885146443b14b796eba479134de663c0e2eafc6bfa5aea9697d02ba26`; the refreshed artifact SHA-256 is `6eea0a91f60c3abf8ba9e9786ee4d268efa59994d0d110eef1c0e5ef1ca86d19`.

| Selector | Composer name | Verified interpretation |
| --- | --- | --- |
| `87802f4d0f98f031` | `open_position` | Recent successful OpenPosition log |
| `7b86510031446262` | `close_position` | Recent successful ClosePosition log |
| `bb4ae5956651dd44` | `liquidate_position` | Recent successful LiquidatePosition log |
| `5eef84ddc1a309cb` | unnamed | `open_position_pre_swap`, Anchor name hash and matching live log |
| `08ef3dc15e9087a8` | unnamed | `open_position_with_swap`, Anchor name hash and matching live log |
| `e445a52e51cb9a1d` | unnamed | [Anchor `emit_cpi!` self-CPI event tag](https://solana.com/docs/programs/anchor-events), **not** an economic instruction |

The [50-receipt check](yolov-recent-50.json) sampled 50 successful transactions and 127 `yoLov` invocations across slots 458736056–458739865; all selectors were among these six. Of those, **16 transactions and 42 invocations** were strictly later than freeze slot 458738799. In two held-out `open_position_with_swap` receipts, `account_1` and `account_10` were read-only although Composer inferred `writable: true`. That is a concrete Composer privilege overapproximation. The recurring `A2rCQd…` account is a transaction signer in the observed open/close paths; whether it is a hard authorization key is a separate runtime question.

Those two held-out swap opens were also the only sampled transactions without an in-transaction `UpdateManyWithPythLazer` → `VerifyMessage` → `UpdateAgPrice2` log sequence (48 of 50 had it). They used an existing read-only oracle account and still had `A2rCQd…` as signer. Oracle age checks and the operator's willingness to sign a custom instruction sequence remain unproved, so this is a trace distinction rather than a stale-price exploit claim.

## Signed runtime authorization gate

Mainnet-beta `simulateTransaction` probes used `~/hooked.json`, `sigVerify: true`, and no broadcast. The frozen Composer account recipe alone was insufficient to test a custom owner because the position PDA changes with that owner. Two independent historical opens establish the position seeds as `["position", owner_pubkey, first_8_instruction_arg_bytes]` ([seed search](yolov-position-seeds.json)). With a correct new position PDA and a JupUSD ATA created earlier in the same simulated transaction, `OpenPosition` rejects the test wallet as `keeper` with Anchor `ConstraintAddress` (2012), showing the required address `A2rCQdCqQB4wu72x9Q7iq1QugtdZmcyWsiSPfgfZzu2u`. The result was identical for zero, one, and five million raw collateral units ([open probes](yolov-open-corrected-gate.json)).

The hooked wallet already owned a 120-byte position PDA `6fKnSCwzKPUFFATXGtxiXrUR9L7qkm2i4pe58JgaBv68`; its stored nonce reproduced the PDA. A signed `ClosePosition` simulation using that position and a JupUSD ATA created earlier in the same transaction also rejected the test wallet as `keeper` with the same `ConstraintAddress` and required `A2rCQd…` ([close probes](yolov-close-corrected-gate.json)). Earlier probes with an invalid position or missing token destination stopped before this address check and were not evidence that any signer could act as keeper. The ProgramData last-deploy slot was still **458289770** at RPC context slot **458743067**.

The current `LiquidatePosition` selector is callable in a signed outsider simulation, but the sampled closed position and a tested active position produced no token transfer or state change. An active-position test rejects another market's oracle with `InvalidOracle` (6013). The `WithdrawFees` path requires a fixed `fee_receiver` address of `A2rCQd…` in a signed mainnet simulation. These checks narrow the direct outsider routes; they do not establish complete program safety.

The rare-handler branch recovered `ProcessPayout`'s expected claim discriminator `59c9f09ad4ff485c` from the exact ELF. A full current program-owned-account census found no live account of that type. In a **local fork with explicitly synthetic claim and pool pending state**, a one-raw-unit payout transferred one micro-JupUSD from the pool vault to the claim owner's token account and advanced the queue; wrong destination owner and inadequate pending balance rejected. This is an account-check and settlement control, not a mainnet claim or drain ([rare-handler report](yolov-rare-handlers.md)).

## Value and scope

At confirmed slot 458738987, pool-controlled SPL account `4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP` held **127520.804415 JupUSD**, with token authority `6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX`. This is one verified account, not a priceable full protocol liability figure. The binary and receipts involve leverage and JupUSD collateral; [Jupiter's official home page](https://jup.ag/) advertises YOLO 500–1000× SOL/BTC/ETH trading, but a publicly signed program-ID attribution was not located in this pass.

## Disposition

This gate proves current executable identity, active instruction shapes, one bounded vault balance, and fixed-keeper runtime checks for open and close. It does **not** prove a profitable unauthorized transfer or exhaust every handler. The remaining YOLO uncertainty is how a real claim is created and whether an operator-signed flow can be made to authorize attacker-shaped transactions; no live outsider payout route survived these probes. No value-moving transaction was broadcast by this gate.

Reproduce the read-only receipt comparison with `node yolov-composer-holdout.js 458738799`; the script reads a locally configured mainnet RPC URL in process memory and does not write it to evidence.
