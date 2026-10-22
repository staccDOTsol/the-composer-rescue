# Defensive mainnet audit: FOXY staking controller

Audit date: 2026-10-15  
Program: `FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP`  
Selected vault: `32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h`  
Vault authority: `Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m`  
FOXY mint: `FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq`

## Outcome

**No immediate outsider-accessible unauthorized drain was found in the deployed program and current state examined.** Under the requested one-atomic-transaction constraints, the realizable unauthorized result is **0 FOXY / $0**. I am not providing an exploit transaction because no tested outsider branch reaches a vault transfer.

The only live FOXY outflow handlers found are `Claim` and `AuthUnstakeFox`:

- `Claim` binds the staking position to the signing owner, the NFT mint, the selected config, the config-derived authority PDA, the config-derived reward vault, the FOXY mint, and the owner's FOXY token account.
- `AuthUnstakeFox` additionally requires the configured authorization key `3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA` to sign. A caller-supplied substitute fails the stored-authority comparison.
- `UpdateConfig` cannot be used by an outsider to replace those authorities or payout parameters: the real update authority is `JDmUXLx1DKhz18UrEgMDwADyeixfNMWs8VepbM8gfipf`, and the deployed account validation requires its signature.

Every conclusive outsider test used a freshly generated local signer, an isolated current-mainnet fork, a signed versioned wire, `sigVerify: true`, and `replaceRecentBlockhash: false`. No transaction was submitted to mainnet or to the fork ledger. The ephemeral private keys were not persisted.

## Deployed artifact and live state

The upgradeable-loader program points to ProgramData `BZGG4GPFP9tDKyWiF1FLSNnBXHVn2w9XY3SRfiCA9VyK`.

| Property | Observed value |
|---|---|
| Executable observation slot | `457351268` |
| Last deployed slot | `415920556` |
| Upgrade authority | `3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA` |
| Program payload length | `1,030,480` bytes |
| Program payload SHA-256 | `c41b21bdfc88d9c6629445eb0a9a0e07cb0cac806c9a6b373ca537933637d7e8` |
| Nonzero payload bytes | `561,353` |
| Nonzero payload SHA-256 | `592e02ede2482379a29827047fe8a32679c257f4c6227fc58e1f5b73e772f303` |
| Program-owned census slot | `457352387` |
| Program-owned accounts | `6,984`: `6,982` 104-byte staking accounts and `2` 120-byte configs |
| Selected config | `7N7M1H2CK51ip7sNtPgKhhv2eScx6BokLgHi1Ke3ZLiq` |
| Other config | `6kW1byGh9RaeJGQNTDx8UWKuajD8u1tv83vrLzn7GSN7` |

The selected vault held `9,268,009,525` raw FOXY at the current-state snapshot used for simulation (`457354822`). FOXY has zero decimals. The authority is an accountless PDA derived from `[config, "auth"]` with bump `255`; the vault is the config-bound `reward_account`, not an arbitrary recipient account.

The live account constraints establish the staking PDA as `[owner, "stake", nft_mint]` and the authorized-migration main PDA as `[config, "auth", original_owner]`. For the supplied victim position, NFT token account `4vVePW9hcGZwRw83fnXeFJGegAzGRVZq2SzFoxzd2fzJ` held one token, was frozen, and delegated one token to main PDA `6iBKo7k1bxxJggBDqFvc2VmLxRiGt5JRom9EScUdgPGo`; this confirms the tested position was live rather than synthetic.

The current config stores:

- update authority: `JDmUXLx1DKhz18UrEgMDwADyeixfNMWs8VepbM8gfipf`
- `AuthUnstakeFox` signer authority: `3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA`

Both are on-curve public keys. Their authorized behavior and the upgrade authority are privileged controls, not outsider reachability, and were excluded from the exploit conclusion.

## Confirmed outflow surfaces

The supplied outflow was independently reconstructed:

- signature: `mcGyLQrXVogQvJZYWkiismSnjnXCf6MiTqpH2eiaxRDTV76VfPJUomemnBvMJbkRKu7UsJiPnJj3tsk7K52ANRg`
- slot: `457344744`; block time: `1792090468`
- handler discriminator: `3ec6d6c1d59f6cd2` (`Claim`)
- SPL transfer: `640` FOXY from the selected vault to `BH8BkxJgP5VZ4cHazTD2VvNxTTJFh7zdgq85g1EQUZPq`, signed by the authority PDA
- vault: `9,268,010,165 -> 9,268,009,525`
- destination: `6,726 -> 7,366`
- required owner signer: `BNF1uzrS9XUyjUYJ89X3QAhmJZLU7GyXXpMSp96pSx3X`
- staking account: `5ouUMrQuhr7n2241g4q9Ddq7FesgTGCgBgWZHeKUrxxM`
- NFT mint: `3YqCz8eNJDhW3boSQdyCVmtpL9CzNmyPkyapF2qdBDwD`

The second payout surface is `AuthUnstakeFox` (`57670f4c408a0d12`). Five successful instances were found shortly after the current deployment. Representative evidence:

- signature: `3on4huYPaJxFQgjJztjVVUVhdmWDjEFz6twPYhE7ZPU8G6oZvwe1VtaHNb3CCdUkfDUdNUw79egmdxbP44KThytz`
- slot: `415924526`
- configured signer: `3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA`
- transfer: `20,993` FOXY from the selected vault, followed by thaw/transfer of the staked NFT

`Deposit`/`InitDeposit` are inflow paths. The observed `UnstakeFox` and `UnstakeFoxV2` paths thaw/revoke/return the NFT and do not transfer FOXY from the reward vault. No third vault-outflow discriminator appeared in the deployed handler inventory or the sampled history.

## Signed outsider tests

Anchor errors used below are `2003 ConstraintRaw`, `2006 ConstraintSeeds`, `3010 AccountNotSigner`, and `6009 Unauthorized`. All rows were signed by the fresh outsider only; all state hashes and balances were unchanged after simulation.

| Candidate | Simulation slot | Wire / accounts / instructions | Result | Signed-wire SHA-256 |
|---|---:|---:|---|---|
| Claim victim position as fresh outsider | `457358339` | `598 B / 14 / 2` | staking PDA seed check, `2006` | `3c754acf7c2acd37a28b9a7d8e826b2e471bc072290da8923a9ba50b3697ab2f` |
| Use victim owner without victim signature | `457358340` | `619 B / 15 / 1` | owner is not signer, `3010` | `36da2c904aa2206088103700313e4a2be92dd2279f96fa6091f41ca115665406` |
| Substitute attacker for authority PDA | `457358341` | `566 B / 13 / 2` | authority PDA seed check, `2006` | `18073bf1aabd4a80e7496913e966d466c420633b17ab281a228f3a972f9e5525` |
| Cross the other config into selected vault | `457358342` | `598 B / 14 / 2` | reward-vault seed/binding check, `2006` | `c298de73139df7a42e78dd58c3979bebff412bae649244b031d320cbb88f82c8` |
| Repeat victim claim twice as outsider | `457358343` | `623 B / 14 / 3` | first claim fails staking PDA seeds, `2006`; no partial commit | `52f7d08ca3e6c11f81ee6d79cefefce00e9895de217bd9115a9e5d9b35304b70` |
| `AuthUnstakeFox` with outsider as configured authority | `457358344` | `797 B / 20 / 2` | stored-authority comparison, `6009` | `60a31b0d78020f366af6746a6efa4e2bdfc50f439ade5c8a4e31b08ed7379963` |
| Pass configured authority but omit its signature | `457358344` | `829 B / 21 / 2` | configured authority is not signer, `3010` | `42e2c9aeb9bfad5b84a808a000fe04b34ae1b95fe34c44c0fb6e22bfd1e18f4a` |
| Outsider `AuthUnstakeFox -> Claim` atomically | `457358345` | `822 B / 20 / 3` | first target instruction fails `6009`; no partial commit | `884ac8a097a05f080a953b200bdc50db45aa28c21bebd4c8f57fb585af5db228` |

The largest target test was `829` bytes and `21` accounts, below the requested `4,096`-byte and `64`-account ceilings. Size was therefore not used as a reason to dismiss an exploit candidate.

The signed `UpdateConfig` probe found that a 56-byte zero payload is the first deserializable shape. At slot `457358546`:

- outsider as authority: `280` bytes, `3` accounts, fails config `ConstraintRaw` (`2003`), wire SHA-256 `361ed8932b28586b9701857bf3d2df55812a72d75ad5cc408f0c006e7545a438`
- real authority account supplied without its signature: `312` bytes, `4` accounts, fails `AccountNotSigner` (`3010`), wire SHA-256 `36c8a52ec7577d9c5f18c3e4f43a0450042c2ec50c662adc4e0856de15c4f3b1`
- config hash before and after: `b742548e27a89f455cbb0b34dd14360a8fe1eb206552dc4b8475e1af40064d72`

Unsigned `sigVerify: false` simulations were used only as layout/branch reconnaissance and positive controls. They are not the basis for the outsider conclusion.

## Max-source atomic flash analysis

A same-mint census was performed against the live FOXY mint. No FOXY lending bank/reserve exists in the audited outsider-usable provider state:

| Provider state | Program | Mint field | Observation slot | FOXY matches |
|---|---|---:|---:|---:|
| Project 0 / marginfi bank | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | offset `8` | `457360293` | `0` |
| Kamino Lend reserve | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | offset `128` | `457360316` | `0` |
| Save/Solend reserve, size 619 | `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo` | offset `42` | `457360343` | `0` |
| Jupiter isolated liquidity reserve | `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS` | offset `8` | `457360343` | `0` |
| Jupiter Lend liquidity state (protocol-bound completeness check) | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` | offset `8` | `457360343` | `0` |

The Jupiter isolated flash wrapper is usable only for reserves configured in its liquidity program; no FOXY reserve was found. Drift's begin/end flash facility is swap-only and restricts intervening instructions, so it cannot wrap these arbitrary target calls. Save permits one flash borrow per transaction; Kamino repeat borrowing is reserve-constrained; those semantics do not change the missing-FOXY-state result.

This makes the current FOXY boundary concrete:

- `capacity - 1`: invalid because there is no nonnegative provider capacity/account to decrement.
- `0`: no borrow leg and no flash instruction.
- `+1` raw FOXY: cannot be constructed; every audited provider lacks the required FOXY bank/reserve/vault state.
- joint two-, three-, and max-source capacity: **zero compatible sources**, so there is no signed multi-source FOXY transaction to assemble. This is an account-state blocker, not a message-size blocker.

Borrowing WSOL, USDC, USDe, USDG, or another unrelated mint cannot affect any tested authorization predicate. `Claim`, `AuthUnstakeFox`, and `UpdateConfig` take no caller-funded amount whose size changes the owner signature, PDA seeds, stored authority, config binding, or token-owner checks. Such a wrapper would repay/unwind to zero or negative equity while the target instruction still aborts. Therefore it cannot make an outsider payout route-valid, and fabricating a cross-mint flash wrapper would not be an exploit validation.

Because no compatible FOXY borrow leg exists, there is no meaningful repayment, reverse-swap, or capital-size sweep to run for this target. The failure occurs before liquidity can enter the candidate. This result is point-in-time: a future FOXY bank/reserve or a program upgrade would require revalidation.

## History coverage and repeatability guards

The mainnet history pass enumerated `147,000` program signatures from slot `457350458` back through slot `415793738`, crossing the current deployment slot. It decoded a stratified/current-deployment-focused sample of `11,765` transactions:

- first 50,000 signatures: 5,900 sampled; `3,958` Claim, `3,294` StakeFoxV2, `2,637` UnstakeFoxV2, and `1` legacy UnstakeFox instructions
- next 97,000 signatures: 5,865 sampled; `3,962` Claim, `2,958` StakeFoxV2, `2,873` UnstakeFoxV2, and `5` AuthUnstakeFox instructions

Counts are instruction counts and may exceed sampled transaction counts when a transaction contains multiple target instructions.

Reconnaissance positive controls also established the expected state guards:

- a legitimate claim succeeds, but an immediate second claim returns `NoReward` (`6004`), causing atomic rollback of the whole repeated transaction
- a legitimate `AuthUnstakeFox` succeeds, but a second use of the consumed staking state returns `AccountNotInitialized` (`3012`), again with atomic rollback
- redirecting a payout to a token account not owned by the bound beneficiary fails `ConstraintTokenOwner` (`2015`)

These guards are secondary. The outsider attempts already fail on seeds or signatures before payout.

## Limitations and privileged risk

- This is a point-in-time mainnet audit of the deployed executable and selected vault, not a proof against future upgrades, configuration changes, or newly created FOXY lending markets.
- No verified source tree or published Anchor IDL was available. Handler/account behavior was reconstructed from the deployed executable, live accounts, successful mainnet transactions, and execution against the executable on the fork.
- History was enumerated broadly but transaction bodies were sampled as described above; the deployed handler inventory and current-state execution supplied the primary reachability evidence.
- The program is upgradeable, and `3pMvTLUA9NzZQd4gi725p89mvND1wRNQM3C8XEv1hTdA` is both the observed upgrade authority and the configured `AuthUnstakeFox` signer. Compromise or intentional use of that key is a substantial privileged risk, but not an outsider-accessible exploit under this scope.
- The approximate dollar value came from the audit request; no price oracle was used. The outsider result is zero independent of valuation.

## Evidence and reproduction

Primary artifacts:

- `foxy-controller-current.so`: exact deployed payload, SHA-256 `c41b21bdfc88d9c6629445eb0a9a0e07cb0cac806c9a6b373ca537933637d7e8`
- `program-metadata.json`: ProgramData identity, deployment slot, authority, and hashes
- `evidence.json`: live accounts, census, supplied outflow reconstruction, and recent history
- `history-map.json` and `auth-unstake-history.json`: history population, sampling rules, discriminators, and successful examples
- `signed-fork-outsider.json`: complete signed wires/base64, hashes, logs, slots, errors, CU, and before/after state
- `update-config-signed-probe.json`: signed config mutation probes and unchanged state hash
- `lender-check.json`: current same-mint provider census and provider semantics

Re-run syntax checks:

```sh
cd /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/foxy-controller-audit
for f in *.js; do node --check "$f"; done
shasum -a 256 foxy-controller-current.so program-metadata.json evidence.json history-map.json auth-unstake-history.json signed-fork-outsider.json update-config-signed-probe.json lender-check.json
```

The simulation scripts intentionally have no mainnet transaction submission path. They require a separately started isolated current-mainnet Surfpool endpoint and use `simulateTransaction` only.
