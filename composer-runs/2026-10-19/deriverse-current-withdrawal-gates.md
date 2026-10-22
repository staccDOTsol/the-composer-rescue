# Deriverse v1 current withdrawal gates

Date: 2026-10-19

Scope: current deployed Deriverse v1 binary on mainnet-beta; signed simulations only; no broadcast.

## Current deployment and construction provenance

- Program: `DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD`
- ProgramData: `6DCXx7tbchQXv7WUgQ1u9STwPciWnwgyWU6DQitnLhh`
- Current deploy slot: `446965384`
- Acquired ProgramData ELF SHA-256: `13a87c3105475aeeb1fb7ddf3e89499d4dfbc79f3f5585703e4feceb55d84820`
- Composer published IDL: unavailable (HTTP 400); Composer `/learn` established the current live program and account surface.
- Instruction builder: official `@deriverse/kit` 1.0.76 at Git commit `5f17de893332d76fd04a01bc4a3fa9a4ed3581b5`.
- Fresh outsider signer had no Deriverse client-primary PDA at the tested slots, so its recorded Deriverse USDC balance was zero.

## Regular withdraw (tag 8)

The official SDK built a one-USDC withdrawal from live funded client
`43vSCPWAaLQdXTf7PDnnf1jPbyPCXwgjLHQe895B3dq2`. Only account indexes 0 and 1
were changed: the client wallet signer and its USDC destination ATA were replaced
with the fresh outsider signer and outsider ATA. The live victim client, vault,
mint, root, token-state account, and programs were retained.

- Simulation slot: `458752626`
- Envelope: v0, 493 bytes, 11 account keys, one verified signature
- Requested amount: `1000000` raw USDC
- Victim recorded USDC before: `13042520489` raw
- Program-vault USDC before: `143404471426` raw
- Result: instruction error custom `110` (`0x6e`)
- Exact program message: `Invalid wallet address`; actual signer was the outsider while the client header contained the victim wallet.
- Token-program CPI: none
- Program-vault transfer observed: none

The RPC returns null watched-account bodies on a failed simulation, so the receipt
does not invent zero post-state deltas. The transfer conclusion follows from the
explicit client-wallet rejection and the absence of any token-program invocation.

Evidence: `deriverse-outsider-withdraw-gate.json`; reproducer:
`deriverse-outsider-withdraw-gate.js`.

## VM direct withdraw (tag 80)

The official SDK built a one-USDC VM direct withdrawal from the same live client
and its live VM account. The permissionless caller slot and withdrawal destination
were changed to the outsider while the victim primary/VM state and all protocol
accounts remained unchanged.

- Simulation slot: `458753324`
- Envelope: v0, 518 bytes, 12 account keys, one verified signature
- Victim recorded USDC before: `12407700956` raw
- Program-vault USDC before: `140062882113` raw
- Result: instruction error custom `110` (`0x6e`)
- Exact program message: `Invalid wallet address`; the current binary rejected the outsider against the supplied victim client before evaluating a transfer.
- Token-program CPI: none
- Program-vault transfer observed: none
- Current VM whitelist: one tag-4 Kamino record; zero tag-1 withdrawal-address records
- Current pending VM withdrawal: zero raw amount; token-id sentinel `268435455`

Evidence: `deriverse-outsider-direct-withdraw-gate.json`; reproducer:
`deriverse-outsider-direct-withdraw-gate.js`.

## Disposition

No outsider-withdraw vulnerability was reproduced. Both high-value withdrawal paths
bind the supplied live client state to its recorded wallet before any token CPI.
The next distinct withdrawal surface is VM pending-withdraw finalization, but this
live fixture has no pending withdrawal, and its VM whitelist contains no withdrawal
destination. That is the current-state blocker; manufacturing either state would
not be a current-fork reproduction.
