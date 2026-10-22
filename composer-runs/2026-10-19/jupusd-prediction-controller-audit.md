# JupUSD prediction-market controller — current outsider audit

Read-only audit completed 2026-10-19. Target: Solana mainnet-beta program
`3ZZuTbwC6aJbvteyVxXUS7gtFYdf7AuXeitx6VyvjvUp`. No transaction was submitted
to mainnet or to the local fork, and no secret was read or written.

## Result

**No novel outsider-accessible immediate-at-risk loss was demonstrated.** The
current controller has real JupUSD custody and live claims, but every tested
fresh-outsider path stopped before value movement. This is a bounded result for
the account substitutions and handlers below, not a whole-program proof.

Atomic multi-provider flash composition was not run. None of the signed direct
tests produced an executable value-moving precursor, so adding borrowed funds
would only wrap a rejected authorization/account-binding path. Borrowed funds,
repayments, flash fees, attacker residual tokens/shares/positions, and attacker
net equity are therefore all zero in this audit. Failed simulations were atomic
and left protocol and wallet equity unchanged.

## Current deployment and interface pin

- The upgradeable program's ProgramData is
  `Ck9wWWkTrbeQD2B22Xo5N1zLQ7FQcxtvHnpdHmNC1dyM`, last deployment slot
  `450279404`, upgrade authority
  `5myNNmEmPm3UAnJ2ggLEpnTFb9t9Gk8369wKw6n3uAKx`.
- The downloaded deployed ELF is 1,039,432 bytes, SHA-256
  `2edcbc240cbb12006a8d679d94c1cf32b723a7040272a5fbc89e548ad77eb19c`.
- Composer's published IDL SHA-256 is
  `48650e202146b98a00ea4880f8332867083a7423eef2c0d403b30d40e2d0358e`.
  Its learned current interface scanned 250 transactions / 286 instruction
  samples, found eight observed discriminators, and has SHA-256
  `6acae30f41474c3f8022f50a56c58a9f348bfce338be1b172757c86aedf3eb0d`.
  Discriminators, account order, signer flags, and fixed vault/token accounts
  for `FillBuyOrder`, `FillSellOrder`, and `ClaimPayout` agree with successful
  current receipts. Published names remain hints where no current receipt was
  observed.
- A separately fetched finalized receipt at slot `458777300` confirms the
  correction: transaction `4qQGJw5...` is `FillSellOrder`, not a claim. Its two
  transaction signers are the fixed service/keeper keys; the controller's
  inner token CPI transfers `835860` raw JupUSD from vault
  `8zNY...Jnfy` to `HzBf...dtPN`, with program-owned vault state
  `2y9A...rBuJ` as the unsigned token authority. Receipt SHA-256:
  `82a9b2dfd995fde25b3e4074bc4a77282c9ee13873b26b0203726ef57661d885`.

## Custody and current liabilities

At finalized slot `458781402`, vault `8zNY...Jnfy` held `143365993875` raw
JupUSD = **143,365.993875 JupUSD**. At nearby finalized census slots:

- 3,472 Position accounts existed. Of them, 331 were unclaimed, settled,
  claims-enabled winning positions, totaling `6921780000` raw =
  **6,921.78 JupUSD** of immediately claimable position payout.
- 2,670 Ticket accounts existed. Six settled, unclaimed tickets were already
  claimable, totaling `157430000` raw = **157.43 JupUSD**.
- The directly observed matured claim liability is therefore
  **7,079.21 JupUSD**. This does not count unresolved contingent positions and
  is not a solvency proof.
- 62 extant Order accounts encoded `Pending` or `PartiallyFilled`; all were buy
  orders. At finalized slot `458781568`, 61 of their derived order ATAs held a
  combined **737.689069 JupUSD**. This is per-order escrow, separate from the
  major vault, and the vault's own decoded `current_open_orders` counter was
  zero; the extant accounts should not be treated as 62 executable live fills
  without further lifecycle proof.

The earlier already-claimed fixture is no longer the claim gate. The new claim
fixture was position `9nZ1...HtEH`, a settled/unclaimed winning NO position for
`759870000` raw JupUSD, with recorded owner `5tYT...ZpLv` and market result
`3SYA...Do82`.

## Signed outsider tests

All outsider cases used a fresh local keypair, current mainnet-backed accounts,
`sigVerify:true`, and read-only `simulateTransaction`. Packets were 213–484
bytes with 3–11 inline keys, below the requested v1 limits of 4,096 bytes and
64 inline addresses.

| Surface | Mutation | Result before value movement |
| --- | --- | --- |
| `ClaimPayout` | Fresh owner signer; original destination | `ConstraintSeeds` 2006 on `position` |
| `ClaimPayout` | Fresh owner + attacker ATA | `ConstraintSeeds` 2006 on `position` |
| `ClaimPayout` | Second live position alias + attacker ATA | `ConstraintSeeds` 2006 on `position` |
| `ClaimPayout2` | Fresh authority; original owner ATA | `InvalidKeeper` 6002 |
| `ClaimPayout2` | Fresh authority + attacker ATA | `InvalidTokenAccount` 6037 |
| `ClaimRefund` | Fresh authority; original owner ATA | `InvalidKeeper` 6002 |
| `ClaimRefund` | Fresh authority + attacker ATA | `InvalidTokenAccount` 6037 |
| `ClaimTicket` | Fresh authority; original ticket owner ATA | `InvalidKeeper` 6002 |
| `ClaimTicket` | Attacker destination / owner / ticket aliases | destination ownership or ticket seeds reject |
| `FillBuyOrder` | Both required signer roles aliased to the outsider on an extant pending buy | `InvalidKeeper` 6002 |
| `Withdraw` | One raw unit to attacker ATA | `InvalidAdmin` 6000 |
| `SetVaultConfig` | Current config values signed by outsider | `InvalidAdmin` 6000 |

A non-adversarial `sigVerify:false` positive control used the real recorded owner
on the fresh unclaimed fixture. It succeeded and moved exactly `759870000` raw
JupUSD from the major vault to that owner's ATA (vault
`143302559545 -> 142542689545`; owner ATA
`2725630458 -> 3485500458`). This proves the fixture was truly claimable and
the payout branch was reached; it is **not outsider proof** because the owner
signature was not verified.

## Evidence

- [`jupusd-prediction-current.so`](jupusd-prediction-current.so)
- [`jupusd-prediction-composer-idl.json`](jupusd-prediction-composer-idl.json)
- [`jupusd-prediction-composer-learn.json`](jupusd-prediction-composer-learn.json)
- [`jupusd-prediction-fill-sell-current-receipt.json`](jupusd-prediction-fill-sell-current-receipt.json)
- [`jupusd-prediction-current-state-census.json`](jupusd-prediction-current-state-census.json)
- [`jupusd-prediction-current-orders-tickets-census.json`](jupusd-prediction-current-orders-tickets-census.json)
- [`jupusd-prediction-current-order-escrow-census.json`](jupusd-prediction-current-order-escrow-census.json)
- [`jupusd-prediction-claim-mutations.json`](jupusd-prediction-claim-mutations.json)
- [`jupusd-prediction-ticket-control-mutations.json`](jupusd-prediction-ticket-control-mutations.json)
- [`jupusd-prediction-current-vault-balance.json`](jupusd-prediction-current-vault-balance.json)
- [`jupusd-prediction-current-core-accounts.json`](jupusd-prediction-current-core-accounts.json)

The transient 89 MB market-result RPC response was condensed and removed after
derivation. Its SHA-256 was
`da587713195e64039eec7870aeefe5a956a3cadb3c5f7971aa25a1237b20adce`;
the compact state census retains its finalized slot, decoded fixture evidence,
counts, and liability totals.
