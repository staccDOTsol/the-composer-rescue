# SKR staking program: current binary, vault exit, and boundaries

Read-only investigation on 2026-10-15. No transaction was signed or submitted. All simulations used `simulateTransaction` with signature verification disabled, and therefore measure deployed program logic without establishing control of another party's signer.

## Deployed program and live state

- Program: `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ`, currently executable. ProgramData `7f1KoiGPFFouvAafZtVmtdpgGJuADprihB9Pdzut3gaJ`, last upgrade slot `393714625`. Current dumped binary: `current.so`, SHA-256 `46fc6f624531b035050552e3e885ffcbdb0d92b6ea4d1452a0419d7d90d5cf0c`.
- Config PDA `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw` derives from `['stake_config']` with bump 255. It owns token vault `8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8`, whose mint is `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (6 decimals). The config account itself is owned by the staking program.
- At slot `457347950`, config authority and loader upgrade authority were both `Hgbea5UFVXD3dQoL2mJbXLVnnFFRqyJJis9vfm69w5oQ`, an off-curve, system-owned, zero-data account. Config had minimum stake `1,000,000` raw SKR and cooldown `172,800` seconds.
- That authority is exactly Squads v4 vault index 0 (bump 253) for multisig `73qS84UTSpVjua5wuBME8PsSZUH4tV1C8641dWY1Vuoi`, derived under `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` from Squads' [published vault seeds](https://github.com/Squads-Protocol/v4/blob/main/sdk/multisig/src/pda.ts#L40-L55). Successful historical transaction `5t6vkLGMCDg7ELzj32MTkFn9zuqCXHZJAhg2rEfPxfk2ahfL4xadwL4kF6DgPDJrRzPqJ9pNRa2K6t3DDnnnGBEY` at slot `426622306` invoked Squads and made an inner SPL Token `transferChecked` with this vault PDA as authority. That demonstrates Squads can sign by CPI for the PDA; it does not grant an outsider its control. Evidence: `squads-vault-transfer-tx.json`, `config-authority-recent-history.json`.
- The Solana Mobile sample IDL in `official-sample-idl.json` was fetched from its exact historical commit `d7ae7b13a8fc280985d69244ea2c4eade30542a6`; it is no longer at repository HEAD. `anchor idl fetch` for current mainnet deployment returned missing IDL account `41dbUE3iG76Vx2iaDticXvpCcYDyw5jx23BtWRFbWVkM`. The binary's embedded instruction/error names and exercised deployed instructions match this sample's relevant layouts. The historical IDL is still secondary evidence, not proof of source-to-binary identity.

## Actual outgoing transfer

Mainnet transaction `3PuFGEogLMThkW55XvxBCjEJTyhywbbinfZQBJhpU6fHa3YZvGPp6XaXPi7uRWVJqoC3Mzb6qBxQimBYu8xiRtsM` succeeded at slot `457330039`. Its top-level SKR instruction data `Xd2GMpFXgQ1` decodes to `b712469c946da122`, the `Withdraw` discriminator. It invokes SPL Token to transfer **193,241,809 raw SKR** from the vault, with config PDA as authority, to the stored user's ATA `7PBpxnZXC23Fyz5DyPQutMJobaiKQNNgcSDc2JxHF7z2`. The vault's pre/post token balances fall by exactly that amount and the destination rises by exactly that amount. Raw RPC record: `withdraw-tx-3PuFGEog.json`. A second observed `Withdraw` is in `withdraw-tx-4SKjbUBo.json`.

## Current-state withdrawal simulation

At slot `457348363`, pending UserStake `AyTRxXrpfqcdbvujMnfYxAuHLxBvg2yHKA4pY6iojGYh` recorded `6,381,678,948,330` raw SKR pending, and its cooldown had expired. The simulated fee payer `5vwuHxvdfmiNWNXY38aLiroE9RBaXiVAft55vKMsUVaP` differs from stored user `HYfMMJgND4yuTLWTj67unqexHJjNpcGbc6SjYF4pBxsr`; the user account was not marked signer on the `Withdraw` instruction. The deployed instruction succeeded and the read-only returned accounts show:

| Raw field | Before | After | Change |
|---|---:|---:|---:|
| Vault SKR | 5,077,227,902,450,824 | 5,070,846,223,502,494 | −6,381,678,948,330 |
| Stored user's ATA SKR | 4,729 | 6,381,678,953,059 | +6,381,678,948,330 |
| Config `last_vault_amount` | 5,077,227,902,450,824 | 5,070,846,223,502,494 | −6,381,678,948,330 |
| Config total shares | 4,377,487,275,841,327 | 4,377,487,275,841,327 | 0 |
| Config share price | 1,154,206,571 | 1,154,206,571 | 0 |

The zero-share UserStake account closes on successful withdrawal. The instruction has no caller supplied amount argument: the transferred amount equals its existing `unstaking_amount`. This is a value-moving permissionless *settlement of that user's claim*, not a means to redirect the tokens.

Boundary cases exercised against the current binary:

| Case | First error |
|---|---|
| Redirect to another user's valid same-mint ATA | `Unauthorized` 6007 on `user_token_account` |
| Substitute caller as the stored user | `Unauthorized` 6007 on `user_stake` |
| Substitute user's ATA as vault | `InvalidVault` 6008 |
| Alias destination to vault | `Unauthorized` 6007 on `user_token_account` |
| Swap UserStake and StakeConfig account order | `AccountDiscriminatorMismatch` 3002 |
| Repeat successful withdrawal twice in one transaction | Second leg `AccountNotInitialized` 3012 after first closes UserStake; entire transaction fails atomically |
| Existing stake with pending amount zero | `NotUnstaked` 6018 |
| Pending amount `333,665,467,928` raw with cooldown not yet complete | `CooldownNotCompleted` 6004 |

Evidence and reproduction: `withdraw-simulations.json`, `withdraw-zero-pending-simulations.json`, `withdraw-immature-simulations.json`, `simulate-withdraw.js`.

## Update authority boundary

`UpdateStakeConfig` has a required authority signer linked to the stored config authority. A missing signer meta failed `AccountNotSigner` 3010; a different signer failed `Unauthorized` 6007; swapped config/authority account order failed `AccountOwnedByWrongProgram` 3007. Marking the stored off-curve authority as signed in an unsigned, `sigVerify:false` simulation allowed a no-op update, and a proposed zero cooldown then failed `InvalidCooldownPeriod` 6001. These last two runs are **hypothetical** as top-level transactions, though Squads can sign for the vault PDA by CPI under its own authorization rules. No SKR config update via this multisig was observed in the 50 recent authority-referencing transactions sampled. Evidence: `update-simulations.json`, `simulate-update.js`.

## Economic reconciliation and RPC freshness

A primary Helius `getProgramAccounts` census at slot `457349009`, filtered by 169-byte UserStake length, discriminator, and current config key, found `47,578` UserStake accounts, `2,740` with positive pending amounts, and **24,703,035,205,189 raw SKR** in aggregate pending claims. Adjacent slot `457349008` read showed vault `5,077,228,322,127,262` raw, config `4,377,487,629,916,967` shares, share price `1,154,206,571`, and floor(`shares × price / 1e9`) = `5,052,524,986,921,379` raw. Vault less that share calculation was `24,703,335,205,883` raw, only `300,000,694` raw SKR above the pending sum; the UserStake share aggregate differed from config by `866,396` shares amid active transactions. Adjacent slots are not an atomic snapshot, and the remaining difference is not proven withdrawable. Evidence: `pending-census-primary.json`, `census-pending.js`.

The secondary Flux RPC initially reported only `47,036` UserStake accounts from a stale slot (`457345387`), with a large mismatch to newer Helius state. The primary's near-reconciliation indicates this was RPC account-index freshness, not evidence of free capital or insolvency. Secondary provider evidence: `pending-census.json`.

## Practical conclusion

The vault has an actual outgoing path, but the tested path settles recorded user entitlements to the stored user's ATA. This audit found no redirect or amount-inflation route through `Withdraw`, and no demonstrated outsider authority for `UpdateStakeConfig`. The sampled vault's gross token mark must not be treated as freely extractable liquidity. Same-asset flashloan composition is analyzed separately from this SKR program audit.
