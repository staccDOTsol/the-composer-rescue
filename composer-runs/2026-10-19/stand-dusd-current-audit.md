# STAND DUSD controller: current value gate

Read-only Solana mainnet-beta work on 2026-10-19. No transaction was broadcast.

## Observations

- Program `STANDjrnkxme4tKsZSnW3WUQ9iKxbhJQj33dbW2F9sZ` remained executable at confirmed slot **458744082**. ProgramData `Di7W2yLiFmicRQhYRmy7SFuLPEWSidggZtX1bGZrr6Qi` records last deploy slot **384178804** and upgrade authority `8BRbk69F5dnPrxvnnWMhmWVyqECWnGcYDfMT8G96JzBh`. The current **383,968-byte ELF** SHA-256 is `5eeec702e3ff7bb5787b9eb46e2bd4cac868183028f3bb4cbc57d3ed28f5c665` ([snapshot and five spend receipts](stand-dusd-current-gate.json), [ELF](stand-dusd-current.so)).
- Vault `3GzZn1Qyzc6xzCgDn83teJysBW2bMCsK6DcRNhksMNo4` held **2,937,577.692107 DUSD** (`2,937,577,692,107` raw, six decimals). Its token authority `64TDz8bnvNb6RwKmJxZ24sQLTwJGLdw3T6Bmqs2F8JpK` is STAND-owned. This is custody balance, not free protocol equity or executable exit value.
- The five latest sampled vault outflows, slots **458643595–458676434**, each had a STAND invocation and token CPI. The signer was `7HeLPKWWKqw6ZwUv4wUu8snYiRjxYZ4R3dvmPRUNzYGy`; each moved DUSD from the vault to a recipient token account, with no offsetting token mint in that transaction ([decoded receipts](stand-dusd-receipts.json)).
- Composer `/idl/<program>` returned **no published IDL**. Its [frozen `/learn` artifact](stand-dusd-composer-learn-250.json) scanned 250 landed signatures and recovered three selectors: `447286d63adcdc30` = `ReqRemoteCall`, `7a068c57ad840711` = `AckRemoteCall`, and `e445a52e51cb9a1d` = Anchor event self-CPI. The first two names were checked against current ELF `Instruction:` strings and Anchor discriminator hashes. The ELF also contains administrative and `CloseRemoteCall` handlers; the learned history does not exhaust all callable selectors. A `limit=1000&refresh=true` request still reported 250 scanned signatures ([response](stand-dusd-composer-learn-1000.json)).
- Ten older postdeploy receipts at positions 251–260 of the program's newest-first signature list matched the frozen selector, account-count, constant-address, required-signer, and required-writable predictions: **0 unknown selectors and 0 mismatches**. The service does not reveal its sampled signature IDs, so strict train/holdout disjointness cannot be proved; these receipts are older than the latest 250 visible through RPC. Composer's inferred PDA and privilege fields remain hypotheses beyond these checks.

## Outsider-signed runtime checks

Both probes were signed by the local test wallet and run through mainnet `simulateTransaction` with `sigVerify: true` and no send ([full logs](stand-dusd-outsider-gate.json)).

| Probe | Size | Result |
| --- | ---: | --- |
| `AckRemoteCall`, historical payload redirected to test wallet and its DUSD ATA | 544 bytes, 11 keys | ATA creation executed inside simulation, then `signer` rejected with custom **VO 6001** before transfer. |
| `ReqRemoteCall`, test wallet supplied as both caller and message signer, with the caller-info PDA address shown as expected by an earlier runtime seed check | 419 bytes, 7 keys | `message_signer` rejected with **ConstraintAddress 2012**. Runtime named the required address `BTJYrtunM9GcKgeutuWDnfb9P1SAGNziZdHCmWX3jaD6`. |

The request had originally stopped at `caller_info` `ConstraintSeeds 2006`; using the runtime's expected address moved the check to the fixed message signer. A prior 2026-10-15 signed Ack probe had reached the same VO error, and the current deployment slot is unchanged.

## Value-path conclusion and limits

The observed DUSD payout is a remote-call acknowledgment signed by the fixed operator, and an independently signed request is blocked by a different fixed message signer. Composer's history and current ELF strings expose no deposit/redeem/share-rate instruction; the direct donation-then-redemption hypothesis therefore lacks an identified outsider claim path. This is a **cheap-gate stop**, not a claim that all hidden or unsampled handlers are safe.

No outsider-positive token delta, repayable flash path, or positive post-fee net was validated. The tested messages meet the 4,096-byte and 64-key ceilings individually, but there is no reachable value action to put between a flash borrow and repayment. No atomic flash composition was attempted. The prior bounded lender census found no same-mint DUSD source; cross-mint conversion would not remove the fixed signer checks. A complete outsider net after repayments and fees is therefore **unestablished**, not estimated from the vault balance.

Reproduce with `node stand-dusd-current-gate.js`, `node stand-dusd-receipt-analysis.js`, and `node stand-dusd-outsider-gate.js`. The scripts read the authenticated RPC and local test signer in process memory and write neither secret to their artifacts.
