# Security Review: PRIME Wormhole NTT Manager

## Executive conclusion

No reportable public-outsider vulnerability was validated for Solana program `4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT`.

The impact gate for this review was strict: a case counts only if an unprivileged outsider can finish an atomic transaction with positive realizable equity after repaying the PRIME flash loan and every other liability. Across 40 current-binary v1 simulations, including two exact 4,096-byte transactions, no case met that gate. Seven positive controls succeeded, 33 adversarial or boundary cases failed as expected, no simulation had a transport/local failure, and the computed outsider net-equity result was zero in every case.

This is a bounded no-findings result, not a claim that the program is vulnerability-free. The principal assurance limitation is that no matching Rust source tree, exact source commit, or reproducible-build attestation for the deployed ELF was present locally. The current executable, target-owned on-chain IDL, decoded state, historical transactions, and current-binary runtime behavior were reviewed directly; IDL metadata was not treated as source-equivalence proof.

## Scope

| Field | Value |
|---|---|
| Program | `4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT` |
| ProgramData | `BCYEL6HugHiaey8gd9hNvPqW2Uo6Rkx7p9hMvD5XTW7e` |
| PRIME mint | `3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7` |
| Token-authority PDA | `XcVU4Nhzjzg69VRcpybnoFWT98oQANV58F7guE6mRza` |
| Custody | `7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC` |
| Supplied exit | `5NAJ7FJSTjscmTRiNSYKh5KdJKCESRAxcQAF45VePoJfjAafW3kR9xgcjy5vugHdnLPZfcszxyBtSMB57CFoFX2D`, slot `457342319` |
| KLend PRIME reserve | `BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh` |
| Validation mode | Read-only mainnet state collection and `simulateTransaction`; `sigVerify=false`; no submission |
| Finding gate | Positive outsider net equity after complete flash repayment and all other liabilities |

The review covered the deployed program identity, config and program-owned state, inbound receive/redeem/release path, outbound lock evidence, custody CPI authority, replay and account substitution, same-transaction ordering, amount boundaries, and KLend flash composition.

The separate `8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC` PRIME controller and `97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY` Hastra vault are not the authorized target and were not substituted for it.

## Threat model

The attacker is an ordinary public Solana user who can:

- choose the fee payer, instruction order, account metas, candidate peer/message/inbox/recipient/mint/custody accounts, and CPI-capable wrappers;
- place KLend PRIME flash borrow, target calls, and flash repayment in one atomic v1 transaction;
- create and sign for accounts the attacker controls; and
- relay an existing valid Wormhole message.

The attacker does not begin with the config-owner signature, ProgramData upgrade authority, PRIME mint/freeze authority, Wormhole guardian authority, another user's signature, or the target's PDA signing capability. Processing a valid message for its authenticated recipient is a rightful-recipient flow, not outsider impact.

The security invariant is:

> Custody may move only for the amount and recipient bound to an accepted, uniquely identified inbound NTT message, and no public composition may leave the outsider with positive net assets after liabilities.

## Deployment and state identity

The live upgradeable-loader chain resolved as:

`4T5m5...` → ProgramData `BCYEL6...` → deployed ELF.

| Property | Observed value |
|---|---|
| Deploy slot | `436157138` |
| Upgrade authority | `EJADfinBBZ49yBMQcRmkCDm5f8Z9M64GpjP4KhfA4JM9` |
| ELF length | `926560` bytes |
| ELF SHA-256 | `a265ecb67d98e38d8ebe9950e843ad26bc298b16cd08515f34bb14dddc21703d` |
| Target-owned IDL | `example_native_token_transfers` `3.0.0` |
| IDL-account SHA-256 | `e6ba124959ac31e33fe2ad5c94e5c01eab9b074c078f214a3f38183e59d78d2b` |

The current config PDA is `BH8E4JJJs3RGWAzQB6AQpzPdmHAGWjffxChatt8Tvi4Q` with bump 255. It decodes to:

- owner `EJADfinBBZ49yBMQcRmkCDm5f8Z9M64GpjP4KhfA4JM9`, no pending owner;
- PRIME mint and legacy SPL Token program;
- `Locking` mode, Solana chain ID 1;
- one registered/enabled transceiver, threshold 1;
- not paused; and
- custody `7ND1...`.

The token-authority seed derives `XcVU4...` with bump 253. Its PRIME associated token account derives exactly to custody `7ND1...`. The custody account has no delegate or close authority.

At the captured state slots:

- custody held `7,951,242.525996` PRIME;
- total PRIME supply was `115,710,551.966280`;
- KLend reserve availability was `84,772,939.811234` PRIME;
- KLend `flashLoanFeeSf` decoded to exactly zero;
- KLend borrowed amount decoded to zero; and
- the KLend fee-vault token balance was zero.

## Supplied exit analysis

The supplied transaction used one public signer/fee payer and executed:

1. `ReceiveWormholeMessage`;
2. `Redeem`; and
3. `ReleaseInboundUnlock`.

It created the validated-message and inbox state in the same atomic transaction, then transferred exactly `78,828.020615` PRIME from custody to `EGvPQGPJhQbZnjMCBEYPtT8J6gC7r12zxtA5SKLLkkCR`. That token account is owned by `B3fKwFboee4XZDVJNzJcVo7ms9W8VwYwmQ2gSojLCMR9`, which exactly matches the persisted inbox item's recipient address. The inbox amount is exactly `78,828,020,615` raw units and its final release status is `Released`.

This is consistent with permissionless relaying of a message-authorized release. It is not evidence that the fee payer selected an arbitrary recipient.

## State and history census

The target owned 567 accounts at the captured census slot. Relevant counts included 251 `InboxItem` accounts, 251 `ValidatedTransceiverMessage` accounts, 57 `OutboxItem` accounts, one config, one NTT peer, one transceiver peer, one registered transceiver, and the two rate-limit accounts.

All 251 decoded inbox items were released; none was pending. Their authenticated raw amounts were:

| Statistic | Raw PRIME units | PRIME |
|---|---:|---:|
| Minimum | `100000` | `0.1` |
| Median | `4286883679` | `4,286.883679` |
| Maximum | `211517120000` | `211,517.12` |
| Sum | `2553319853277` | `2,553,319.853277` |

There were six claims below one PRIME, no one-raw-unit claim, and 229 distinct amounts.

The 25 classified recent transactions contained 24 inbound receive/redeem/release flows and one outbound lock. Every observed inbound destination owner matched the corresponding inbox recipient, every token delta matched the stored amount, and the outbound flow moved the user's exact authorized amount into custody.

## Runtime validation

The simulation artifact contains the complete zero-signature v1 wires, account blueprints, logs, returned-account deltas, wire hashes, and liability accounting. Only read-only RPC methods were used. No transaction was sent. Every successful economic control and every inbound exploit probe relies only on the attacker-controlled signer. Two exploratory outbound replays retain historical signer metas, fail at already-created outbox state, and are not treated as proof of an outsider-reachable authorization check.

### KLend boundaries and composition

| Case | Result | Outsider net PRIME |
|---|---|---:|
| Borrow/repay 1 raw unit | Success | `0` |
| Borrow/repay 1 PRIME | Success | `0` |
| Borrow/repay 99% of observed availability | Success | `0` |
| Borrow/repay all `84,772,939.811234` PRIME | Success | `0` |
| Borrow observed availability + 1 raw unit | Rejected: KLend `InsufficientLiquidity` (`6008`) | `0` |
| Borrow → target `Version` → repay | Success | `0` |

The successful cases left the attacker token balance, reserve supply vault, fee vault, custody, mint supply, and decoded reserve available/borrowed fields with zero economic delta. Reserve bookkeeping bytes changed during a successful flash operation, but available liquidity and borrowed liability both returned to their pre-simulation values.

### Exact 4,096-byte v1 compositions

Two target-specific, no-ALT Solana v1 wires were emitted and simulated:

| Composition | Wire SHA-256 | Result | Outsider net PRIME |
|---|---|---|---:|
| PRIME flash borrow → target `Version` → 3,485-byte memo padding → repay | `911b8a4460a3ea83451b505121cd12b0f3352cca0c31ac8a2c1f495bb20a9314` | Success, `1,278,664` CU | `0` |
| PRIME flash borrow → target `ReleaseInboundUnlock` replay → padding → repay | `432599f73f588bf6013f89edf6306af90910c44425e8025347875a2a355f2e33` | Rejected at target instruction with `TransferAlreadyRedeemed` (`6007`) | `0` |

Both wires are exactly 4,096 bytes and use the specified target program, PRIME mint, KLend reserve, market, supply vault, fee vault, and attacker-owned PRIME account. The first proves that packet capacity and target/KLend composition are not hidden controls. The second places the real custody-release instruction inside the exact-size flash composition and demonstrates atomic rollback at the replay guard.

### Release controls

| Mutation | Runtime result |
|---|---|
| Replay with original recipient | `TransferAlreadyRedeemed` (`6007`) |
| Substitute attacker-owned token destination | Anchor `ConstraintTokenOwner` (`2015`); expected inbox recipient vs attacker differ |
| Substitute another inbox with original target recipient | Anchor `ConstraintTokenOwner` (`2015`) |
| Other inbox with its matching attacker-owned destination, replayed | `TransferAlreadyRedeemed` (`6007`) |
| Substitute token-authority PDA with KLend market authority | Anchor `ConstraintSeeds` (`2006`) |
| Substitute custody with KLend supply vault | Anchor `ConstraintAddress` (`2012`) |
| Substitute PRIME mint with USDC | Anchor `ConstraintAssociated` (`2009`) |
| Substitute SPL Token program with System Program | Anchor `InvalidProgramId` (`3008`) |
| Substitute config with System Program | Anchor `AccountOwnedByWrongProgram` (`3007`) |
| Remove required payer signature | Anchor `AccountNotSigner` (`3010`) |

The smallest observed claim (`0.1` PRIME) and largest observed claim (`211,517.12` PRIME) were both tested. Redirecting either to the attacker failed recipient-owner binding; using each claim's matching associated token account reached and failed the replay guard.

### Message, inbox, and ordering controls

- Redeeming the supplied message again failed with target `TransferCannotBeRedeemed` (`6008`).
- Cross-pairing either validated message with the other inbox failed PDA seed constraints (`2006`).
- Peer/transceiver substitutions failed account discriminator checks (`3002`).
- Mint substitution failed the executable's raw config/mint constraint (`2003`).
- Cross-pairing a posted VAA and validated-message account failed PDA seed constraints (`2006`).
- Config and peer substitutions failed owner/discriminator constraints.
- Re-running `ReceiveWormholeMessage` against its already-created state failed System Program re-initialization atomically.
- Receive/redeem/release replay and release-before-redeem ordering both failed before value movement.
- The same ordering cases inside PRIME flash borrow/repay transactions failed atomically with zero outsider equity.

The historical supplied exit proves that the intended fresh-state receive → redeem → release order succeeds under this deployed ELF. The current-state simulations prove that replay, reordering, and the tested cross-account substitutions do not turn that flow into an outsider payout.

## Findings

### No findings

No candidate survived all reportability gates:

1. attacker-controlled path;
2. current deployed executable reachability;
3. unauthorized asset movement or liability avoidance;
4. atomic end-state accounting; and
5. positive outsider net equity after complete repayment.

Public relaying of the supplied exit was not treated as unauthorized. KLend's large zero-rate balance was not treated as profit. Failed simulations were treated as atomic rollbacks, not partial gains. Privileged owner/upgrade operations and rightful-recipient flows were excluded from outsider impact.

## Control conclusions

- **Recipient binding:** directly observed across recent history and enforced in negative simulations before token movement.
- **Replay protection:** release, redeem, receive-account recreation, and exact-size flash replay all failed atomically. Historical outbox reuse also failed at account initialization, but was not counted as outsider authorization proof.
- **PDA/custody binding:** token authority, config, mint, token program, custody, message, and inbox substitutions hit concrete executable constraints.
- **Same-transaction safety:** the intended sequence historically succeeds; current replay and wrong-order variants fail; wrapping them in zero-rate flash liquidity creates no entitlement or net equity.
- **Amount behavior:** inbound release is a fixed authenticated u64 amount, not a share-price claim. Dust and maximum observed claims retained recipient/replay controls. KLend exact availability succeeds and availability + 1 fails.
- **Price manipulation:** the target interface has no oracle, AMM, exchange-rate, share-price, or balance-dependent claim calculation. A flash balance can fund an outbound lock but cannot synthesize an accepted inbound Wormhole message.

## Limitations and open questions

1. **No matching source/reproducible build.** No exact Rust source commit or build attestation was available in the authorized local material. The IDL, ELF strings, PDA derivations, state, logs, and runtime tests strongly identify the deployment as `example_native_token_transfers` 3.0.0, but they do not prove source-to-ELF equivalence. This is the primary unresolved assurance gap, not a vulnerability finding.
2. **Consumed inbound state.** Every current inbox item is released. A current-state simulation cannot recreate an unconsumed version of the supplied claim without altering program-owned state. The successful historical transaction, which post-dates the current deploy slot, supplies the corresponding fresh-state success evidence; negative constraints were tested against the current binary.
3. **Wormhole trust root.** Guardian-signature cryptography and guardian-set compromise were not re-audited. The review tests the NTT manager's handling of posted VAA/message accounts, not the security of the Wormhole network itself.
4. **Outbound fresh initialization.** The observed legitimate outbound transfer conserves value. Current replay attempts stop when the historical outbox account already exists, so a fresh outbound session-authority lifecycle was not exhaustively reconstructed. No outsider-profit hypothesis depended on that path.
5. **Privileged administration.** Upgrade-authority, config-owner, mint-authority, and intended operator actions are separate privileged domains and outside the public-outsider impact model.
6. **Simulation is not formal proof.** The 40-case matrix targets the high-value state/account/order/amount boundaries. It does not enumerate every possible Solana account tuple or Wormhole message.

## Artifacts

- [`prime-second-results-summary.json`](./prime-second-results-summary.json) — compact outcome, identity, state, simulations, and limitations.
- [`prime-second-adversarial-v1.json`](./prime-second-adversarial-v1.json) — complete v1 wires, hashes, blueprints, logs, account deltas, and accounting for all 40 simulations.
- [`prime-second-adversarial-v1.js`](./prime-second-adversarial-v1.js) — read-only v1 composer and simulator; contains no send path.
- [`prime-second-live-evidence.json`](./prime-second-live-evidence.json) — deployment, vault, mint, reserve, exit, and recent-signature evidence.
- [`prime-second-state-snapshot.json`](./prime-second-state-snapshot.json) — decoded config, PDA derivations, program-account census, rate limits, inboxes, peers, and transceivers.
- [`prime-second-history.json`](./prime-second-history.json) — classified recent transaction and token-delta history.
- [`prime-second-exit-transaction.json`](./prime-second-exit-transaction.json) and [`prime-second-exit-transaction.raw.json`](./prime-second-exit-transaction.raw.json) — normalized and raw supplied exit.
- [`prime-second-onchain-idl.json`](./prime-second-onchain-idl.json) and [`prime-second-idl-status.json`](./prime-second-idl-status.json) — target-owned IDL and authority/hash metadata.
- [`prime-second-current.so`](./prime-second-current.so) — captured deployed ELF.
- [`prime-second-collect-current.js`](./prime-second-collect-current.js), [`prime-second-decode-state.js`](./prime-second-decode-state.js), [`prime-second-classify-history.js`](./prime-second-classify-history.js), and [`prime-second-summarize.js`](./prime-second-summarize.js) — reproducible read-only collectors/decoders/projection.

## Reproduction and safety

From the repository root:

```sh
node composer-runs/2026-10-15/prime-second-collect-current.js
node composer-runs/2026-10-15/prime-second-decode-state.js
node composer-runs/2026-10-15/prime-second-classify-history.js
node composer-runs/2026-10-15/prime-second-adversarial-v1.js
node composer-runs/2026-10-15/prime-second-summarize.js
```

The scripts load the authenticated RPC endpoints from `/tmp/composer-helius-rpc.env`, never print or serialize the URLs, and use only `get*` and `simulateTransaction` methods. There is no `sendTransaction`, `sendRawTransaction`, signing, operator contact, or live state mutation.
