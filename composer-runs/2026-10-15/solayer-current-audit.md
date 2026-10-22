# Solayer restaking current-binary outsider audit

Date: 2026-10-15  
Program: `sSo1iU21jBrU9VaJ8PJib1MtorefUV4fzC9GURa2KNn`  
Mode: read-only mainnet evidence plus isolated local-fork simulation; no live transaction submitted

## Outcome

**No unauthorized outsider drain or share-rounding extraction was validated. Demonstrated exploitable amount: $0.**

The current program has a real, permissionless, atomic exit: a caller burns its restaked receipt token and receives the corresponding underlying LST from the pool vault. That exit is actively composed with flash liquidity and external markets. It is not a free vault withdrawal: the current binary binds the receipt token account to the transaction signer and burns the same raw amount that leaves the backing vault.

The large `70,923.230883178` LP-SOLAYER balance is therefore backing for sSOL liabilities, not extra protocol equity. It must not be added to the receipt-token value as separate wealth.

## Current deployment and state

- Upgradeable program data: `FnmSeb1dMCabCoReuaqq8B52KsNab2MeAbkkrsvrFP3i`
- Upgrade authority: `GcYvLKKEWpxQMqFe9HUcDJYMGvXt7kwf8gfBvjnW4wnm`
- Last deployed slot: `287,889,238`
- Current ELF length: `517,996` bytes
- Current ELF SHA-256: `5ad648b75990f0377c624d7063371091859e650187a9f9c8291272d7a529cf3f`
- The ELF exposes four Anchor instructions: `Initialize`, `Restake`, `Unrestake`, and `BatchThawLstAccounts`.
- Fourteen 74-byte pool states were present at finalized slot `457,367,583`. Each binds one LST mint to one receipt mint. The BNSOL pool is `7RJP…2Kpg`; the LP-SOLAYER/sSOL pool is `3sk5…w9GQ`.

Finalized balance observations at slot `457,367,528`:

| Account | Role | Balance |
|---|---|---:|
| `4eim…bCsB` | LP-SOLAYER backing vault | 70,923.230883178 LP-SOLAYER |
| `9Qj3…A771` | BNSOL backing vault | 3,689.824359553 BNSOL |
| `DvB1…Hjgw` | KLend BNSOL supply | 9,830.475126805 BNSOL |
| `3PwE…KS4v` | Project 0 BNSOL liquidity vault | 25.575404027 BNSOL |

The bounded same-mint lender census found no third BNSOL flash source. Project 0 insurance (`0.012357739` BNSOL) and fee (`0.244324798` BNSOL) vaults are custody, not flash-liquidity inventory.

## Recent value-moving proof

Finalized transaction `2ayRFPmJovc9U517ykaWxQfRMyi6Fro4uJNi6DEBVJW4Xt6CjniFH9xDWdjZVvkESFpt6pV93BiWMtT2vM6dgsgm` at slot `457,269,047` proves the live composition:

1. Jupiter Lend `FlashloanBorrow` for `7,000,000,000` raw SOL.
2. Jupiter market routing buys sSOL.
3. Solayer `Unrestake(5,965,208,072)` burns/consumes the caller-controlled sSOL flow and releases exactly `5,965,208,072` raw LP-SOLAYER from `4eim…bCsB`.
4. A separate Jupiter route performs `LiquidUnstakeLstWithWrappedSeed` through the stake-pool path.
5. Jupiter Lend `FlashloanPayback(7,000,000,000)` succeeds.

The caller's wSOL token balance increased by `6,112,588` raw (`0.006112588` SOL). This is evidence of a permissionless market-arbitrage consumer path, not evidence that Solayer released unbacked value: the Solayer leg was exactly one raw underlying unit per burned receipt unit.

## Signed current-binary local-fork tests

All simulations used an attacker-generated keypair, a Solana v1 message, `sigVerify:true`, at most 4,096 bytes and 64 account keys, and the current mainnet accounts/current Solayer ELF. No transaction was sent.

| Test | Result | Envelope | Equity result |
|---|---|---|---|
| KLend BNSOL flash → Solayer restake → unrestake → repay, 1 raw | Success | 826 bytes, 18 keys, 5 instructions | Attacker BNSOL/receipt end at zero; lender, fee vault, Solayer vault and receipt supply deltas all zero |
| Same cycle at the full observed KLend supply, `9,830.475126805` BNSOL | Success | 826 bytes, 18 keys, 5 instructions | Full repayment; every observed token-equity delta zero |
| Four repeated restake/unrestake cycles at the same full amount | Success | 1,006 bytes, 18 keys, 11 instructions | Full repayment; every observed token-equity delta zero |

The amount-1 and full-supply cases establish exact 1:1 raw-unit arithmetic at both edges. Four repetitions did not accumulate rounding value. The route used the literal observed KLend supply-vault balance, not the nominal LP-SOLAYER backing balance.

## Exact guards

- **Receipt ownership:** substituting another user's receipt account into `Unrestake` failed before value movement with Anchor `ConstraintTokenOwner`, error `2015` / `0x7df`, on `rst_ata`. The logged left value was the victim token-account owner; the right value was the attacker signer.
- **Receipt balance:** an attacker-owned zero-balance receipt account reached the SPL Token burn and failed with `insufficient funds`, custom error `1`. The backing vault was not debited.
- **Administrative thaw:** supplying the attacker as `solayer_admin` failed with Anchor `ConstraintRaw`, error `2003` / `0x7d3`, on `solayer_admin`.
- **Pool and mint binding:** each public restake/unrestake instruction uses the pool PDA `['pool', lst_mint]`; the pool state binds `lst_mint` and `rst_mint`, and the current successful transactions use the pool-owned associated backing vault.
- **Cooldown:** Solayer's current four-instruction interface has no cooldown state or delayed claim path. Cooldown belongs to downstream stake-account exits when that route chooses delayed native unstaking; it is not a bypass of Solayer receipt ownership. The sampled profitable route used an independent liquid exit and repaid atomically.
- **Size/compute:** the successful four-cycle, full-KLend route consumed `424,852` units and stayed far below the v1 byte/key limits. Size was not the security control; receipt ownership, burn balance, mint/pool binding, and lender repayment were.

## Scope boundary

This was the requested short heuristic, not an exhaustive input matrix. It established one recent full market exit, tested the strongest same-mint flash amplifier at its observed liquidity edge and under repetition, and tested the direct receipt-substitution and administrative paths. Project 0's `25.575404027` BNSOL liquidity was inventoried but not added to the KLend route because the full `9,830.475126805` BNSOL KLend cycle already exercised the same 1:1 Solayer arithmetic by roughly 384× more notional.

Official integration material used only to label the account interface: [Solayer CLI and restaking IDL](https://github.com/solayer-labs/solayer-cli). Current behavior and conclusions above come from the deployed ELF, finalized transactions/state, and signed local-fork execution.

## Evidence

- `solayer-current.so` — exact current deployed ELF
- `solayer-current-reachability.json` — current state, pool census, balances, and recent finalized value-moving transactions
- `solayer-signed-v1-guard-probes.json` — signed v1 owner/balance/admin guard failures
- `solayer-bnsol-klend-signed-v1.json` — signed v1 full-liquidity and repeated KLend BNSOL cycles with equity images
- `solayer-current-reachability.js`, `solayer-signed-v1-guard-probes.js`, `solayer-bnsol-klend-signed-v1.js` — reproducible collectors/probes
