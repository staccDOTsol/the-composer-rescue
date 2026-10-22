# XP1BR current-mainnet outsider-gain audit

## Verdict

No validated outsider-accessible unauthorized asset-gain vulnerability was found in the current deployed program `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy`.

The exploit bar for this review was a successful atomic transaction that left an unprivileged outsider with positive net assets after transaction fees, flash debt, and share liabilities. None of 60 current-mainnet simulation cases met that bar. Thirty-three cases succeeded, 27 intentionally adversarial cases failed, and every successful case had zero or negative outsider token delta. The exact 4,096-byte composition succeeded with zero BulkSOL and SY gain and a 5,000-lamport simulated base-fee loss.

This is a bounded negative result, not proof that no bug exists. Dynamic exploit work concentrated on BulkSOL because it was the highest-value custody asset for which a current same-asset, zero-origination-fee Project0 reserve was available.

## Safety and observation basis

- All chain interaction was read-only. Simulations used `simulateTransaction` with signature verification disabled; no private key was used and no transaction was broadcast.
- The current deployment, accounts, reserve state, and token deltas were re-read from mainnet for the final run. The inventory artifact was generated at `2026-10-15T19:50:45.384Z`; the simulation artifact was generated at `2026-10-15T19:48:41.985Z`.
- Failed atomic cases report no deltas because Solana rolled back their state. Successful cases include outsider BulkSOL, SY, and lamport deltas.
- A case is not a finding merely because it transfers value or passes program checks. It must produce unauthorized positive outsider net value after all obligations.

## Deployed program identity

| Property | Current value |
|---|---|
| Program | `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData | `54htmoqBdDQ3Bb3sc3Tbfuys2NLwBxsBXhLf154NGJHV` |
| Deployment slot | `456137922` |
| Upgrade authority | `2tX7aHkV1r7am6bnTPqQJNBbEkbqDpNWHBYPahSQb9TP` |
| ProgramData length | 960,586 bytes |
| Executable offset/length | 45 / 960,541 bytes |
| Executable SHA-256 | `a1f2fa4b17fc8fe8916b75af91e79bb13614b9913f641fc00dfa33e9228f33b3` |

The preserved ELF is byte-for-byte identical to the executable slice of the current ProgramData account. Its embedded paths and symbols identify the program family as `generic_standard` and expose the mint/redeem, deposit/withdraw, position, state, interface, hook, and administration code families.

The prior custody evidence is independently consistent with this deployment: BulkSOL authority `6XPT3FnRn3MBpBX3rAyBtd4AXBeGeCdChmTbfVPYnorN`, vault `69aN14j61zbYfJBTNv6yGD7yeVDYWZxzZkbMw6erbVwH`, and transaction `2r8LZwaDfxNPB8yTiPF8LTwizzzYecedvkrXJtpfoPQbBF7w51B9cWYZqXt6Lx5DshZKpMwUXd8hk4eJTALr3oPE` at slot `457333275`, where XP1BR immediately signed the BulkSOL outflow. That proves program control of the vault; by itself it does not prove an outsider drain.

## Source and IDL identification

The exact source repository and commit for the deployed ELF were not located. The current public Exponent application did contain the exact client IDL used for this program:

| Property | Evidence |
|---|---|
| Application | `https://app.exponent.finance/` |
| Bundle | `/_next/static/chunks/5020-0eb3e799a0b74124.js` |
| Bundle SHA-256 | `8c5af91f9a16ad70204332e41070abef54fc80a3325545619cab11e8736d4dd1` |
| IDL name/version | `generic_standard` / `0.1.0` |
| IDL SHA-256 | `c1450d923fa6977d161dd2fea5bfeaf80d63dccb35e66566c16f7aadab176917` |
| Instructions | 17: `add_emission`, `change_interface_type`, `collect_emission`, `collect_treasury_emission`, `deposit`, `get_position`, `get_state`, `init_sy`, `initialize_position`, `mint`, `modify_hook`, `modify_ore_interface_account`, `realloc_sy_meta`, `redeem`, `set_exchange_rate_limit`, `update_data_stream`, `withdraw` |

The canonical Program Metadata Program and legacy Anchor on-chain IDL addresses were empty at audit time. Therefore the client-bundled IDL is strong interface evidence, but not a reproducible-source claim or proof that the published client exactly covers every deployed branch.

## Controlled custody ranked by marked value

The current inventory contains 47 `SyMeta` accounts, 48 principal vaults, and 102 token accounts controlled by those metas. Gross marked principal custody was `$74,893,949.96` using the retained price snapshot. This is a prioritization mark, not a liquidation-value claim. The earlier conservative strict/stable/LST subset was `$28.56M`.

| Rank | Asset | Meta / authority | Principal vault | Interface | Raw custody | Marked USD |
|---:|---|---|---|---|---:|---:|
| 1 | ONyc | `BmLiVHRb9ppTrEA5jhTgNJ2WFtjUZEkfzJZGswEidxzu` | `2bBGqb9qY7e2q6pFDKdsHqDoQiGmaeDKktezXJ2AcGDo` | Scope | `28866247970575361` | $33,306,240.20 |
| 2 | BulkSOL | `6XPT3FnRn3MBpBX3rAyBtd4AXBeGeCdChmTbfVPYnorN` | `69aN14j61zbYfJBTNv6yGD7yeVDYWZxzZkbMw6erbVwH` | SplStakePool | `134715203990639` | $15,646,815.10 |
| 3 | rkuSOL | `61Dz6DkjDbn1seiD2SgDGpQE8V81ip22RyYwVsB9CcNy` | `FcTYERGTnymbL1BDdXow9Z1RqZ1rE8AYbjs79d8hmGKq` | SplStakePool | `69317029571260` | $7,489,650.44 |
| 4 | USX | `xaMJ2ATJfWce7JZfwLeeZmBHmFadDUdLTqdpyn5hMiA` | `5bDGo8v7MbXKqiXoLDHUAC9e6a8d885srovGMoahQ2X` | One | `3410018321675` | $3,407,496.04 |
| 5 | eHYUSD | `A1miRE4nZkNDxwFzLyYm8yRNeYcgNtMHUaCS21qWvrXp` | `BzoZZhF5pBWbyZo8MpcP6qNVyT1spZeHa2t7DApuBUQr` | HyloLpToken | `2005263356755` | $2,999,710.41 |
| 6 | eUSX | `GTFtrJGtTfH3C8c3jpkuraHpbwdaRR2jWuKuyfMb4mYh` | `5hLYJaWYVqaU9p3Xs3UQAbG4mQLn5JCDa14PtKkHeeq1` | Solstice | `2686503655091` | $2,818,992.71 |
| 7 | STRCx | `9jfusCwF9WTU5QQdqGJSyCp51qsWeLMCo6RHSs7wK3dL` | `Djh8v5vbm6fT8gcnBJi3uu34NMJURxc3zmf81A1SwSpw` | ScaledUiAmount | `1755513170335` | $1,747,230.36 |
| 8 | hyloSOL | `9QReDA3ndt8FBQVJHGzM8h6NKojqyh2Ej8cqFn9dY6Hn` | `Bkw2EQ51xhqDRxwYgzSunBKEKyL4LZiMsyJPnH83hQB8` | SplStakePool | `9775720281866` | $1,118,628.45 |
| 9 | wfragSOL | `8EC8D6FG4ATRTScZvziTgtrcMv9Edvwv3hHmZNdnTCg` | `Aast2jB47UTXmeKLRTMQyxQo3agFF9uH5rzkDtBHdW7w` | Fragmetric | `8563405893342` | $997,795.30 |
| 10 | sUSD.infra | `2Xvo11jxrAGMU361emq4dKEW8hDHU7amaLpKvuy2mTLD` | `2sZ3rkFmT1wEisDFNVNBkzSEMpeLPKkQnSXrCGVCZPx4` | LoopscaleVaultLp | `984285529126` | $985,273.68 |

## BulkSOL custody and share model

BulkSOL was selected for dynamic attack construction because it combined material custody with a live same-asset Project0 reserve.

| Item | Current value |
|---|---|
| Yield-bearing mint | `BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn` |
| SY mint | `Fy7SiHCwMzNMXYgygQhpYvjSg23G8B9TfZm3mHNgy6Bu` |
| Internal SY escrow | `BMsiL6iSMkVZL9BEkt66VHCeNKxKVUiesdubsoZAXjNr` |
| SPL stake-pool interface | `3aUmJDNpMHjkxunQEkHTj2chzyryKoH2uQj6YACLD174` |
| Principal vault raw amount | `134715203990639` |
| SY mint raw supply | `134715201201088` |
| Internal SY escrow raw amount | `134555275781100` |
| Exchange-rate word / scale | `1104089630094` / `1000000000000` |
| Minimum mint / redeem | `0` / `0` |
| Maximum SY supply | `18446744073709551615` |

All relevant PDA relationships reproduced exactly:

- Meta: seeds `["meta", [1], BulkSOL mint]`, bump `255`.
- SY mint: seeds `["generic_token", [1], BulkSOL mint]`, bump `254`.
- SY escrow: seeds `["sy_escrow", [1], BulkSOL mint]`, bump `252`.
- The SPL principal vault token authority is exactly the meta PDA.

The position census found 12 BulkSOL positions, seven funded, and all position owners off-curve PDAs. Their raw balances sum to `134555275781100`, exactly equal to the internal SY escrow amount. The largest position, `FUFDpDezLofQM3kpbQm8j4yoBZ2ACKMMi5QzmDseCDM2`, holds `126258545641990` raw shares and belongs to `3Uf9ukCCFdpLpqiUUrG9b7pAz2cdgDTru4c3TuXq7S3i`. This reconciliation is evidence that deposited SY liabilities were fully represented at the observation slot.

## Same-asset flash composition

No exact-zero-rate KLend BulkSOL reserve was present in the retained reserve census. A relevant Project0 bank was present and its decoded protocol origination fee was exactly zero:

| Item | Value |
|---|---|
| Project0 program | `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` |
| Group | `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8` |
| BulkSOL bank | `9p1TiAeTc6FSiNHhnR6BgmwRq49zywczAY4m77BbKGer` |
| Liquidity vault | `6BFcjj5u9knynMQGKRpa519PMmpik5WiuJRPjVfpRxzy` |
| Vault raw liquidity at construction | `1327854797779` |
| Highest successful live binary-search sample | `1327842164640` |
| First adjacent failing sample | `1327842164641` |

The adjacent failure was Project0 `IllegalUtilizationRatio` (`6026`), so the observed maximum is a slot-specific utilization boundary, not a permanent limit. At the dust edge, borrowing one raw unit failed with `IllegalBalanceState` (`6040`); two raw units completed the full round trip and repayment.

The successful atomic path was:

1. Project0 account-health start and zero-origination-fee BulkSOL borrow.
2. XP1BR mint using the borrowed BulkSOL.
3. XP1BR redeem of the exact floor-rounded SY output.
4. Full Project0 BulkSOL repayment and account-health end.
5. Close of the temporary SY token account.

The padding composition is a real serialized 4,096-byte atomic wire with 64 addresses and 10 instructions. It simulated successfully against current mainnet state. Its SHA-256 is `2d17bd5a0d963b9ccedb77b70d334b01c7a654f08a26e14a34b9ac0dd266bee5`; the complete base64 wire is retained in the JSON artifact. Final outsider deltas were:

| Asset | Delta |
|---|---:|
| BulkSOL | `0` raw |
| XP SY | `0` raw |
| Lamports including simulated base fee | `-5000` |

An independent repetition artifact ran 17 additional rounding/composition cases. Twelve succeeded, including repeated two- and four-cycle routes and a separate exact 4,096-byte composition; eight- and sixteen-cycle variants reached Solana's instruction-trace limit. No successful repetition had positive token gain.

## Adversarial account, authority, and edge tests

| Test | Result | Economic interpretation |
|---|---|---|
| Mint/redeem 1 raw borrowed BulkSOL | Failed: Project0 `IllegalBalanceState` (`6040`) | Lender dust constraint; no state committed. |
| Mint/redeem 2 raw borrowed BulkSOL | Success; BulkSOL `0`, SY `0`, lamports `-5000` | Smallest completed flash round trip was unprofitable. |
| Near-liquidity `1327842164640` raw | Success; token deltas `0`, lamports `-5000` | Extreme size produced no rounding gain. |
| Near-liquidity `1327842164641` raw | Failed: `IllegalUtilizationRatio` (`6026`) | Atomic rollback; no gain. |
| Protocol SY escrow supplied as outsider redeem source | Failed: token owner mismatch (`4`) | Outsider cannot burn escrowed shares as their own. |
| Project0 vault substituted as XP principal vault on redeem | Failed: `ConstraintTokenOwner` (`2015`) | Principal-vault authority binding held. |
| Project0 vault substituted as XP principal vault on mint | Failed: `ConstraintTokenOwner` (`2015`) | Same binding held on mint. |
| XP principal vault supplied as outsider mint source | Failed: token owner mismatch (`4`) | Outsider cannot transfer program custody as source. |
| Cross-meta principal-vault substitution | Failed: `ConstraintTokenOwner` (`2015`) | A valid vault from another meta did not satisfy authority binding. |
| Redeem destination aliased to the principal vault | Success; outsider BulkSOL `-905723`, SY `0`, lamports `-5000` | Self-donation/loss, not a drain. |
| Redeem more than freshly minted shares | Failed: insufficient funds (`1`) | Share liability could not be bypassed. |
| Withdraw largest foreign position with outsider signer | Failed: `ConstraintHasOne` (`2001`) | Position-owner binding held. |
| Withdraw zero from foreign position with outsider signer | Failed: `ConstraintHasOne` (`2001`) | Zero amount did not bypass owner validation. |
| Deposit then withdraw a foreign position | Failed at withdrawal: `ConstraintHasOne` (`2001`) | Deposit did not confer withdrawal authority. |
| Deposit one raw unit to a foreign position | Success; outsider BulkSOL `-1`, SY `0`, lamports `-5000` | Permissionless gift only; no gain. |
| Zero deposit inside repaid flash route | Success; token deltas `0`, lamports `-5000` | No zero-amount state/accounting exploit. |

The aggregate matrix contains no successful case with positive outsider token gain. Fully repaid flash debt, burned/reconciled shares, temporary-account closure, and base-fee accounting leave `validatedFindingCount: 0`.

## Limitations and concrete blockers

- Exact deployed source was unavailable. Analysis used the byte-verified ELF, binary strings, live account layouts, the current client IDL, and dynamic simulation. Source-only branches or invariants may therefore be harder to enumerate exhaustively.
- The provider pruned Project0 control transaction `3ok9CzX7U7oAkgaqUxLx6zhjCC4sMe6EeqKQRNnwMMw4TteVFCAvxf7g9kGtQbNM6m4B9FN7x4MxXGFLuxFt7D8i` at slot `457310970` during the audit. The harness used the locally preserved successful current-mainnet wire, SHA-256 `f4077ff614ef3d124232ca55beef6c15a682af508fcdd0c574e9796fa5717955`, only as the Project0 instruction/account schema. All target accounts and final simulations were fetched from live current state.
- Prices are ranking inputs and do not establish executable liquidation value. Thin or permissioned assets may realize materially less than the gross mark.
- Dynamic flash tests focused on BulkSOL. The remaining 46 metas received live custody/PDA/state inventory and interface-level static review, but not an equivalent same-asset flash matrix where no relevant reserve was established.
- The program remains upgradeable. Compromise or misuse of the upgrade authority is outside an unprivileged-outsider exploit model and was not assumed.
- The Codex Security workbench could not start because its selected scan target changed during startup. Per the scanner contract it was not retried or silently replaced; this report records the completed direct binary/account/simulation audit.

## Reproduction

The scripts read the endpoint from `/tmp/composer-helius-rpc.env` and do not print its value.

```sh
NODE_PATH=/Users/stacc/the-composer-rescue/node_modules \
  node /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/xp1br-extract-app-idl.js

NODE_PATH=/Users/stacc/the-composer-rescue/node_modules \
  node /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/xp1br-collect-current.js

NODE_PATH=/Users/stacc/the-composer-rescue/node_modules \
  node /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/xp1br-current-simulations.js
```

Artifact checksums for the final run:

| Artifact | SHA-256 |
|---|---|
| `xp1br-current.so` | `a1f2fa4b17fc8fe8916b75af91e79bb13614b9913f641fc00dfa33e9228f33b3` |
| `xp1br-generic-standard-idl.json` | `c1450d923fa6977d161dd2fea5bfeaf80d63dccb35e66566c16f7aadab176917` |
| `xp1br-idl-source-evidence.json` | `bf9b5780d04caecf293659ade187f56f22bf19fe04f845a5cfb01760c61a8951` |
| `xp1br-current-inventory.json` | `8343a4257e5ee95eeed39a9a466a7d25b57859ca688d75335fc25adab6016df9` |
| `xp1br-current-simulations.json` | `5affc56728ff89bca03dc1d1b1cfec0c0ef89a23537fe8bcf8078bdfc638fdd6` |
| `xp1br-bulksol-rounding-audit.json` | `6f4cba9c40bfb411f0cda40a1b0577ac744790b102e3e1fc58110cf508c8b098` |

