# Live recheck: two formerly unattributed native Stake authorities

Read-only finalized mainnet check on 2026-10-15. The private RPC's exact `getProgramAccounts` filter matched the 32-byte withdraw authority at Stake data offset 44; Solana public RPC `getMultipleAccounts` independently matched the balance and withdraw authority of every returned live account. No transaction was submitted.

| Withdraw authority | Current Stake accounts | Current SOL | Prior census | Current controller |
|---|---:|---:|---:|---|
| `FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm` | 1 | 51,479.873529770 | 1 / 51,479.873529770 SOL | Squads v4 vault index 1 of multisig `8M6Sgtn8QksPoBaNuoCmH3guhrYTaRRhVxvtZbgNmUKW` |
| `9j7f4Y6MqauTRm9RRJwzQeMkqZ8GS3FsXF7hs4nD6ugA` | 61 | 19,670.089836720 | 73 / 23,678.783787228 SOL | Squads v4 vault index 0 of multisig `7QCouqAACjz2LEynoSph8GzZ6yy5jYEnvvJGSDLGyLYw` |

The second group is **12 accounts and 4,008.693950508 SOL below** the prior snapshot. The two current groups total **71,149.963366490 SOL**. The private finalized context slots were 457360911 and 457360936, respectively. Public RPC matched 1/1 and 61/61 account balances and withdraw authorities. See [`two-native-stake-groups-live-recheck.json`](two-native-stake-groups-live-recheck.json).

## Controller proof

Both authorities match the [published Squads v4 vault PDA derivation](https://docs.squads.so/main/development/reference/accounts): `PDA(SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf, ["multisig", multisig_pubkey, "vault", u8(vault_index)])`. The FE1 vault uses index 1/bump 255; the 9j7 vault uses index 0/bump 253. Both multisig accounts are **currently owned by Squads v4**, and the Squads program is currently executable. Exact derivations and live account metadata are in [`two-native-stake-groups-squads-proof.json`](two-native-stake-groups-squads-proof.json).

The derivation is corroborated by historical Stake-program CPI from Squads v4:

- [FE1 current stake initialize/delegate](https://explorer.solana.com/tx/2ZGccyvH7eG8CmYRdHrNuqatKtvZjL6tjdSx3ctnLLyspQH5yW1CcjweTFoBKPoJt3i9SKMtubqABvLqgEBfnrb) at slot 335637414 names FE1 as both staker and withdrawer. A separate [withdrawal](https://explorer.solana.com/tx/C4haSvtZu61vw5wQ65gZYzi8jQrgKzXyqajyKYKeen6H86H4EnaRdDvXzzg2Pd3uEKBp25voLWQoLfXvyAcuhc4) from an older account also ran as a Squads CPI.
- [9j7 Stake initialization](https://explorer.solana.com/tx/q3KChPJJQDh5YhmhiPU2ZvBA2mdYrtHhBKNmZAfZE2uMmvTxSAUtftmVc5E2TwfMdTSQE4y4kimHWizPESXVx6A) at slot 290626444 names `9j7...` as withdrawer and `stWirq...` as staker, under Squads CPI. Another [Squads initialization/delegation](https://explorer.solana.com/tx/26pKqWmHfxPFQVbAXHdg8nFxm7hUj3LohnrYigx9UBLCFEsyDBwUsGwMUqZMei6asEzHz7xEMQHXyeJSx9MvrPJZ) names `9j7...` as both authorities for an earlier Stake account. Full read-only history sample: [`two-native-stake-groups-provenance.json`](two-native-stake-groups-provenance.json).

The `stWirq...` key on most current 9j Stake accounts is [Marinade Native's published staking authority](https://docs.marinade.finance/marinade-protocol/protocol-overview/marinade-native/marinade-native-api-and-sdk). Marinade manages delegation; the separate **Squads vault remains the withdrawal authority**. These two groups should therefore be classified as Squads organization/user treasury native stake, rather than application escrow or an unattributed program vault. The FE1 account is delegated to the Anza vote account `anza1Vgz2kcN9Qo6ECvf43v8RxBzQ7UpvxFoxJtLmGz`; that validator relationship alone does not establish the multisig owner's identity.

No outsider withdraw route was identified. Accordingly, the current stake balances are **not** an outsider-drain candidate by themselves; an atomic flash-loan wrapper would not supply the Squads authorization needed to move them. This is a controller attribution, not a Squads security audit.
