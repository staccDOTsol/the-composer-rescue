# Solana mainnet native SOL / Stake-program custody census

**Observation date:** 2026-10-15  
**Network:** Solana mainnet-beta  
**Transport:** read-only `get*` RPC plus `simulateTransaction`; no transaction was signed or submitted

## Outcome

Beyond the standard SPL Stake Pool program, Marinade's main stake authority, and Jito's standard-pool deployment, I resolved seven material native-SOL/Stake custody families totaling exactly **21,113,203.762594904 SOL** (`21,113,203,762,594,904` lamports). At the observed Jupiter price of **$106.12859541990457/SOL**, that is **$2,240,714,660.14**. Every lamport in this primary sum is native SOL or a native Stake-program account, so priced coverage is **100%** and unpriced native lamports are **zero**.

This is a **gross backing/custody inventory**, not unique TVL, a redeemable balance, or an exploit amount. The classes below have different claimants and overlap rules. In particular, LST backing must not be added again to holdings of the corresponding pool token.

| Rank | Controller | Program | Economic class | Native SOL / Stake | USD at observed price |
|---:|---|---|---|---:|---:|
| 1 | Sanctum custom SPL Stake Pool | [`SP12…`](https://explorer.solana.com/address/SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY) | LST backing | 12,803,377.895878951 SOL | $1,358,804,512.72 |
| 2 | Sanctum SPL Multi | [`SPMB…`](https://explorer.solana.com/address/SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn) | LST backing | 6,034,747.129075525 SOL | $640,459,236.52 |
| 3 | `prestaking-solana` | [`5eSX…`](https://explorer.solana.com/address/5eSX5ApiNYaFSYWypf3MtBjVZD9axVHBAN4Pp4tLyNJk) | Program-operated validator stake; claimant/product identity unresolved | 1,257,194.781954166 SOL | $133,424,316.38 |
| 4 | Sanctum unstake.it | [`unpX…`](https://explorer.solana.com/address/unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ) | LP-backed liquid-unstake inventory | 644,023.559202736 SOL | $68,349,315.76 |
| 5 | BNSOL pending-unstake queue | [`bn1d…`](https://explorer.solana.com/address/bn1dUNRecofQLxcGp895mGmKEVtFLMjdvjxBjFqhFU7) | Post-burn redemption/cooldown inventory | 287,858.835135492 SOL | $30,550,053.85 |
| 6 | The Vault Liquid Unstaker | [`2rU1…`](https://explorer.solana.com/address/2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo) | LP-backed liquid-unstake inventory | 48,493.545132323 SOL | $5,146,551.83 |
| 7 | SPL Single-Validator Stake Pool | [`SVSP…`](https://explorer.solana.com/address/SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE) | LST backing | 37,508.016215711 SOL | $3,980,673.08 |

Separately, Marinade Validator Bonds controls **13,401.363921283 SOL** (**$1,422,267.93**) of validator-owned bond collateral/self-stake. I exclude it from the primary sum because it is not depositor custody or LST backing.

The price observation is recorded in [`5uums-surface-sol-price.json`](5uums-surface-sol-price.json): Jupiter Price API v3, block `457351880`, retrieved `2026-10-15T19:20:11.232548+00:00`. It is a point-in-time conversion only.

## Census coverage and reconciliation

The base census queried every initialized/delegated account owned by the native Stake program, sharded over all 256 first-byte values of the withdraw authority. All 256 shards completed and none failed:

- observation slots: `457345236` through `457347694`;
- initialized/delegated Stake accounts: **1,454,190**;
- all such Stake-account lamports: **502,801,103.501321500 SOL**;
- off-curve withdraw-authority groups: **6,486**;
- Stake controlled by those off-curve groups: **65,463,796.147180481 SOL**.

The following categories exactly sum to that off-curve Stake total:

| Category | Authorities | Stake accounts | SOL |
|---|---:|---:|---:|
| Standard SPL Stake Pool | 237 | 15,143 | 35,970,283.520005625 |
| Sanctum `SP12` | 1,551 | 3,118 | 12,803,377.895878951 |
| Sanctum `SPMB` | 56 | 247 | 6,034,747.129075525 |
| Jupiter Perps native stake | 1 | 35 | 3,718,074.737122306 |
| Marinade main native stake | 1 | 490 | 2,558,885.268452149 |
| Squads user/organization vaults | 39 | 218 | 2,414,235.536185308 |
| `prestaking-solana` | 1 | 51 | 1,257,194.781954166 |
| Unattributed long tail | 4,538 | 8,250 | 296,993.528975577 |
| BNSOL pending unstake | 1 | 10 | 287,857.827251996 |
| The Vault Liquid Unstaker | 1 | 2,542 | 47,801.553465614 |
| SPL Single-Validator Pool | 57 | 116 | 37,505.292300403 |
| Sanctum unstake.it | 1 | 369 | 23,437.712591578 |
| Marinade Validator Bonds | 2 | 2,160 | 13,401.363921283 |
| **Total** | **6,486** | **32,749** | **65,463,796.147180481** |

This is exhaustive for Stake accounts by recorded withdraw authority, but not a proof of every program-associated system account holding SOL. A Stake account stores an authority address, not its parent program or seed preimage, and Solana has no global reverse-PDA registry. I therefore include system-owned SOL reserves only when a decoded controller state or a canonical derivation links them. The 256 shards and later linked-account reads span multiple slots, so the result is also a rolling observation rather than one atomic bank snapshot. The 72-lamport change in an `SVSP` on-ramp between two reads demonstrates that boundary.

For context rather than addition to the new-controller total, the known parent lanes were **35,970,283.520005625 SOL** in standard SPL Stake Pools, **2,558,885.268452149 SOL** under Marinade's main authority, and **3,718,074.737122306 SOL** under Jupiter Perps. JitoSOL was the largest standard pool at **10,979,196.868559005 SOL**, followed by the standard BNSOL pool at **10,307,105.805321680 SOL**. [`standard-spl-stake-pools-current.json`](standard-spl-stake-pools-current.json) contains the current 238 decoded standard pools (237 nonzero withdraw authorities) and their full ranking.

## Controller proofs

### Sanctum `SP12` and `SPMB`

Both use the canonical SPL-style withdraw authority:

```text
PDA(program, [stake_pool_pubkey, "withdraw"])
```

For `SP12`, all **1,553** decoded pool states matched that derivation; 1,551 authorities were nonzero and controlled 3,118 Stake accounts. Direct live Stake balances total **12,803,377.895878951 SOL**. The states' aggregate accounting was 112,017.809770339 SOL lower, so direct Stake-account enumeration is primary. The largest pools were dSOL (2,785,889.459632068 SOL), cPQP (2,390,369.486850748), sctmB7 (1,936,942.047619021), SanctumSOL (1,746,000.726952358), bbSOL (1,414,965.601178455), and hSOL (947,167.956314917).

For `SPMB`, all **56** decoded states matched the withdraw-PDA derivation and were nonzero, covering 247 Stake accounts and **6,034,747.129075525 SOL**. JupSOL accounts for 5,242,876.649611240 SOL; the next largest are DEFINXS (316,771.890644716), BULK (213,345.462360761), hylo (193,781.035006164), and phaseSOL (30,147.800313590).

The complete state-to-PDA-to-Stake joins and the full long tail are in [`sanctum-spl-live-stake-custody-complete.json`](sanctum-spl-live-stake-custody-complete.json). The public implementation reference is [igneous-labs/sanctum-spl-stake-pool](https://github.com/igneous-labs/sanctum-spl-stake-pool). The current `SP12` and `SPMB` program payloads are byte-identical (`a8571c…`) and have the same upgrade authority, but I did **not** establish a reproducible source-to-deployed-binary match; see [`sp12-source-evidence-20261015.json`](sp12-source-evidence-20261015.json).

### `prestaking-solana` (`5eSX`)

Authority [`4qL62…`](https://explorer.solana.com/address/4qL62rxhqaYjXLzQNVJJ74iLhaXSZutQiQWSSiJjf19f) controls 51 delegated accounts totaling **1,257,194.781954166 SOL**. Exactly two 41-byte program-owned states link the controller:

- `4qL62…`: Anchor `StakeAuthority`, linked depositor `AtrLGnV14KfgAFNbVeuv7hiNsi39pNQ45ahdoM8xdxmN`, stored bump 255;
- `6JbSbe…`: Anchor `ProgramState`, linked vote `DumiCKHVqoCQKD8roLApzR5Fit8qGV5fVQsJV9sTZk4a`, stored bump 255.

Successful program calls prove live program-signed Stake CPI: [`DelegateStake`](https://explorer.solana.com/tx/3p5V9BxhXcZpsUwvRP8N2QahbjnpRm4PWCPNJvbcVpSumGZY5eoiqpBP6JR5HpEHYx1rMqLHMsETuGHDEmCbRy9H) at slot `457200872` and [`MergeStake`](https://explorer.solana.com/tx/VwU1VK2MzoWhZRKGnVXsAhU5kpEUXqhfjUgKSkhkyUuJ3Y9hKdDq8v6my9zz4yaYwB1JNvMHTrHzyvtqTW37MxK) at slot `457086187`. Both sampled successful top-level calls also require signer `aDmiNDx…`; no permissionless exit was established.

The current ELF embeds `programs/prestaking-solana`, but the public product identity and exact PDA seed preimage were not recovered. State linkage, off-curve status, stored bump, and successful signed CPI establish control; they do not justify inventing a seed formula. ProgramData is `9UqK…`, upgrade authority `EjH6…`, last deploy slot `344734170`; exact public-source binding remains unestablished. Full evidence: [`prestaking-solana-custody.json`](prestaking-solana-custody.json).

### Sanctum unstake.it (`unpX`)

The single Pool state [`FypP…`](https://explorer.solana.com/address/FypPtwbY3FUfzJUtXHSyVRokVKG2jKtH29FmK4ebxRSd) derives reserve/stake authority [`3rBnn…`](https://explorer.solana.com/address/3rBnnH9TTgd3xwu48rnzGsaQkSr1hR64nY71DrDt6VrQ) as:

```text
PDA(unpX, [pool_pubkey]) = 3rBnn… (bump 251)
```

That authority links **23,437.712591578 SOL** in 369 delegated Stake accounts plus a **620,585.846611158 SOL** system-owned reserve, gross **644,023.559202736 SOL**. The state's `incoming_stake` field was only 925.831104211 SOL, so live accounts again take precedence. Economically, the stake is purchased liquid-unstake inventory awaiting reclaim and, together with the SOL reserve, backs the pool LP token; it is not still backing the LST sold into the pool. Official source reference: [igneous-labs/sanctum-unstake-program](https://github.com/igneous-labs/sanctum-unstake-program). Exact current-binary reproduction was not performed.

### BNSOL pending-unstake controller (`bn1d`)

The sole program-owned config and native wallet verify exactly:

```text
PDA(bn1d, ["config"])     = CTmYR2… (bump 253)
PDA(bn1d, ["sol_wallet"]) = 59oXzz… (bump 255)
```

`59oXzz…` controls 10 delegated Stake accounts worth **287,857.827251996 SOL** and held **1.007883496 SOL** directly, gross **287,858.835135492 SOL**. It links to standard BNSOL pool `Hr9pz…`, BNSOL mint `BNso1…`, and standard withdraw PDA `75NPz…`.

The sampled [`WithdrawStakeFromPool`](https://explorer.solana.com/tx/eVcguCtJXSB7FU1WFDFfvmwJn58ppUcVTbmf9bvQzxYGF3vdNcFMv7ML2TSKLZ58iEjLLAPGqWN1JPVsuUgukxW) flow burns/transfers BNSOL, splits stake from the standard pool, reauthorizes it to `59oXzz…`, and deactivates it. A later [`WithdrawSolFromStakeAccount`](https://explorer.solana.com/tx/46ChwDMVxYjUyqZEdEdTiVBeTK3MXkdvBqmaH1yBccwuje4wK4gHPy94rbnxFP5GXBXSPHKrbKoSmfQAnskupKPC) withdraws cooled SOL to the same wallet. This queue is therefore downstream of, rather than overlapping with, current standard-pool backing. Full evidence: [`bnsol-unstake-custody.json`](bnsol-unstake-custody.json).

### The Vault Liquid Unstaker (`2rU1`)

The one current Pool state verifies both canonical addresses:

```text
PDA(2rU1, ["pool", authority_pubkey]) = 9nyw5… (bump 253)
PDA(2rU1, ["sol_vault", pool_pubkey])  = 6RLKA… (bump 251)
```

The program-owned Pool `9nyw5…` is itself the Stake authority: 2,542 delegated accounts hold **47,801.553465614 SOL**. Its linked program-owned native vault holds **691.991666709 SOL**, gross **48,493.545132323 SOL**. Live traces include successful authorize/deactivate Stake CPI. The pool's 316-byte current state decodes a published-IDL common prefix with `flashLoanFee=0`, `flashBorrowed=0`, and `flashEnabled=0`; the internal flash path is currently disabled. The client/source reference is [SolanaVault/liquid-unstaker-client](https://github.com/SolanaVault/liquid-unstaker-client), but the current binary has additional instructions/fields and no exact source build match was established.

### SPL Single-Validator Stake Pool (`SVSP`)

All 57 pool states verify the [official single-pool](https://github.com/solana-program/single-pool) derivations:

```text
pool            = PDA(SVSP, ["pool", vote_pubkey])
stake_authority = PDA(SVSP, ["stake_authority", pool_pubkey])
onramp          = PDA(SVSP, ["onramp", pool_pubkey])
```

The 57 authorities control 116 Stake accounts holding **37,505.292300403 SOL**; linked on-ramps held **2.723915308 SOL**, gross **37,508.016215711 SOL**. The largest pool is `Eip8…`, for vote `abc1…`, with stake authority `E7c64…`: 34,278.037211130 SOL of stake plus 1.341307422 SOL on-ramp. This is permissionless single-validator LST backing and overlaps its pool-token supply. See the [official documentation](https://www.solana-program.com/docs/single-pool).

### Marinade Validator Bonds (`vBoNd`), separate collateral lane

The canonical derivation is `PDA(vBoNd, ["bonds_authority", config_pubkey])`. Two configs were nonzero:

- standard config `vbMa…` → `7cgg…`, bump 254: 1,447 Stake accounts, **10,549.292682418 SOL**;
- institutional config `Vbin…` → `8CsA…`, bump 253: 713 Stake accounts, **2,852.071238865 SOL**.

These sum to **13,401.363921283 SOL**. The [Validator Bonds source](https://github.com/marinade-finance/validator-bonds) and deployed-binary security text agree on the repository identity, but this census classifies the assets as validator-owned collateral/self-stake, not user deposits or LST backing.

## Long tail and unknown triage

After removing every attributed category, **4,538** off-curve authorities controlling 8,250 Stake accounts and **296,993.528975577 SOL** remain unattributed:

| Bucket | Authorities | SOL |
|---|---:|---:|
| ≥10,000 SOL | 2 | 75,158.657316998 |
| ≥1,000 and <10,000 SOL | 58 | 176,000.770007125 |
| ≥100 and <1,000 SOL | 131 | 41,030.094438797 |
| <100 SOL | 4,347 | 4,804.007212657 |

The only unresolved groups above 10,000 SOL are:

- `FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm`: one Stake account, **51,479.873529770 SOL**;
- `9j7f4Y6MqauTRm9RRJwzQeMkqZ8GS3FsXF7hs4nD6ugA`: 73 Stake accounts, **23,678.783787228 SOL**.

Both authority accounts are system-owned off-curve addresses. A 65-signature recent-history sample found no direct Stake CPI or Squads proof, so assigning a program would be speculation. Of the other residual groups initially above 10,000 SOL, 25 were exact Squads vaults and four were the direct controllers `2rU1`, `SVSP`, `unpX`, and `vBoNd`; together with 14 Squads matches from the first pass, the Squads classification is 39 authorities and **2,414,235.536185308 SOL**. Exact published Squads formulas used were v4 `["multisig", multisig, "vault", u8(index)]` and v3 `["squad", multisig, u32_le(index), "authority"]`. Those are organization/user treasury vaults, not application escrow.

Every unattributed authority—not merely the two large entries—is retained in machine-readable form under `exactStakeAuthorityReconciliation.allUnattributedGroups` in [`native-stake-custody-ranking.json`](native-stake-custody-ranking.json). Triage evidence is in [`native-stake-residual-triage.json`](native-stake-residual-triage.json) and [`native-stake-squads-classification.json`](native-stake-squads-classification.json).

## Atomic flash-composition annotation

These are reachability and boundary observations, **not vulnerability or profit claims**.

| Controller/path | Same-asset evidence | v1 boundary / result | Interpretation |
|---|---|---|---|
| `unpX` liquid-unstake LP | Direct mainnet simulation: Kamino Lend borrowed wSOL, unwrapped/added liquidity, removed liquidity, rewrapped, and repaid | 1 SOL succeeded at 1,053 bytes, 19 accounts, 10 instructions, 117,622 CU. Exact 4,096-byte/64-account case succeeded at 11 instructions and 675,543 CU; 4,097 bytes and 65 inline accounts were rejected. Nine target round trips succeeded; ten hit `MaxInstructionTraceLengthExceeded`. | Current same-asset positive control. Loan repaid, user LP ended at zero, and no unauthorized gain appeared; reserve gained one lamport from rounding. Minimum target amount was 2 raw lamports; 1 failed normally. |
| `SP12` | Direct Kamino wSOL → SOL deposit/withdraw → wSOL repay | 1,028 bytes, 23 accounts, 10 instructions for one leg; 1,076 bytes/23 accounts/12 instructions for two legs. Minimum successful round trip was 3 lamports. | Normal fee/rounding behavior; no unauthorized gain. |
| `SPMB` | Current program payload is byte-identical to `SP12` | No direct per-state composition simulation in this run. | Instruction-code reachability can be inferred, but state-specific economics cannot. |
| The Vault `2rU1` | Borrowed SOL could fund ordinary LP deposit/withdraw | No composed simulation. Current state decodes `flashEnabled=0` for its own internal flash path. | A loan does not synthesize the user-owned active Stake/LST input required for liquid unstaking; an LP round trip alone is not a custody exit. |
| `SVSP` | No direct same-transaction SOL exit established | Not simulated as a flash target. | It accepts active stake and returns stake; wSOL is not active stake, and cooldown prevents immediate SOL realization. |
| BNSOL queue | No wSOL-only route | Not simulated as a flash target. | Entry requires BNSOL burn/split; SOL realization follows deactivation/cooldown. |
| `5eSX` | No permissionless route established | Not simulated as a flash target. | Sampled successful calls require an external signer; borrowed wSOL cannot create immediately active delegated stake and exit it in the same transaction. |
| Validator Bonds | No permissionless route established | Not simulated as a flash target. | Validator/operator authority and bond lockup semantics make this a collateral lane, not an LP-style flash surface. |

The `unpX` evidence is in [`sanctum-klend-flash-extremes-v1.json`](sanctum-klend-flash-extremes-v1.json); the `SP12` evidence is in [`sp12-flash-klend-v1-summary.json`](sp12-flash-klend-v1-summary.json). The selected current Kamino wSOL reserve `4oig…` had **6,583.425299329 SOL** available and decoded `flashLoanFeeSf=0` exactly—not a positive fee rounded to zero.

Marginfi Project 0 was also tested at the exact transaction envelope: its compact start/borrow/repay/end case was 564 bytes, 11 accounts, and four instructions, and the padded **4,096-byte/64-inline-account** transaction succeeded; 4,097 bytes and 65 inline accounts were rejected. However, that live test borrowed **USDT**, not wSOL. It is therefore transport/format evidence only and is **not** represented as same-asset SOL evidence. Kamino wSOL is the same-asset control for the native-SOL paths. See [`marginfi-flashloan-stress.json`](marginfi-flashloan-stress.json).

## Deployed-code status

Current upgradeable-loader metadata and hashes are recorded in [`native-stake-program-metadata.json`](native-stake-program-metadata.json), [`native-stake-secondary-program-metadata.json`](native-stake-secondary-program-metadata.json), and [`bn1d-program-metadata.json`](bn1d-program-metadata.json). Relevant payload hashes include:

| Program | Last deploy slot | Upgrade authority | Payload SHA-256 |
|---|---:|---|---|
| `2rU1…` | 419656198 | `F3yy…` | `e6baece94a5b408494967052d01c9f7457645a21756e18bc44ce49e477a6da99` |
| `SVSP…` | 408388782 | `AeLm…` | `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4` |
| `unpX…` | 220337978 | `47SND…` | `ec9e18d779372a96dbc9a1de5ba2a55244b721508aa8339c212ccb73a0cb3140` |
| `vBoNd…` | 410576659 | `6YAj…` | `3ab4353b6a5da93d494c443aa77b38b3f0a090cfe84da3fdffbc745cf9ad056a` |
| `bn1d…` | 285905464 | `64zL…` | `9dd3468a9f3941dcc7d9fe5a414ac22e325cb8180e2cc74afa4fc1894f9963fd` |

Repository identity or embedded `security.txt` is not the same as a reproducible build. Except where explicitly stated, the public repositories are semantic/source references, not claims that the checked-out source exactly reproduces the deployed ELF.

## Reproduction map

- [`enumerate-native-stake-authorities.js`](enumerate-native-stake-authorities.js): complete 256-shard Stake census.
- [`trace-stake-authority-controller.js`](trace-stake-authority-controller.js): recent transaction and Stake-CPI provenance.
- [`export-sanctum-stake-pools.js`](export-sanctum-stake-pools.js) and [`scan-sanctum-pool-stakes.js`](scan-sanctum-pool-stakes.js): standard/custom pool-state and withdraw-PDA joins.
- [`verify-prestaking-solana-controller.js`](verify-prestaking-solana-controller.js), [`verify-bnsol-unstake-controller.js`](verify-bnsol-unstake-controller.js), and [`verify-native-stake-secondary-controllers.js`](verify-native-stake-secondary-controllers.js): controller-specific state, PDA, reserve, and Stake joins.
- [`classify-squads-stake-authorities.js`](classify-squads-stake-authorities.js), [`join-offcurve-stake-programs.js`](join-offcurve-stake-programs.js), and [`triage-residual-offcurve-stake.js`](triage-residual-offcurve-stake.js): residual attribution and unknown handling.
- [`build-native-stake-custody-ranking.js`](build-native-stake-custody-ranking.js): exact reconciliation, overlap-aware ranking, price application, and complete unknown list.

The consolidated machine-readable result is [`native-stake-custody-ranking.json`](native-stake-custody-ranking.json). The linked-account evidence for `SVSP`, `2rU1`, `unpX`, and Validator Bonds is [`native-stake-secondary-controllers.json`](native-stake-secondary-controllers.json).
