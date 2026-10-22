# Long-tail custody attribution, 15 October 2026

Read-only candidate discovery for Solana mainnet. **No unauthorized value movement was demonstrated; validated drain amount is $0.** Balances below are gross custody marks used to choose binaries for review. Token spot marks do not account for depth, vesting, redemption rights, receipt overlap, or the fraction reachable by any bug.

## Method and bounded coverage

The input executable census contains 77,715 unique current executable IDs. The token authority census sampled the largest 20 accounts for each of 3,987 Jupiter-verified mints, found 68,885 live mint/program-bound token accounts and 7,046 off-curve authorities. It is **not** an exhaustive token-account census. The concurrent native-stake withdraw-authority scan had completed 249 of 256 filtered shards when the SP12 proof below was saved. These two censuses are complementary; stake is not added to token custody.

For each high-value off-curve authority, I required a live token account whose 32-byte authority field equals that pubkey, then checked the authority account's current owner and the owner's current executable status through Helius. For stronger signer evidence, I fetched successful vault transactions from Helius and followed inner-instruction `stackHeight`; an outbound SPL transfer naming the off-curve authority and immediately invoked by its owning executable demonstrates that the executable can sign for that vault in an ordinary successful transaction. For native stake, I rederived the canonical withdraw PDA from a program-owned pool state and checked its stored bump. All RPC access was read-only. No transaction was submitted.

The initial token-balance census used Flux and is a bounded candidate source. Flux's address-history index returned only 5/120 successful histories for the top token sample and 1/17 for the top off-curve stake groups, while Helius returned 118/120 and 16/16 respectively. The selected token authority, vault, executable, and balances were rechecked at Helius confirmed slots in `long-tail-current-check.json`; transaction attribution used Helius. Values can move between observation slots.

## New executable targets, ordered by observed gross mark

| Program / ID | Bounded mark | Exact custody evidence | Exit evidence and caveat |
|---|---:|---|---|
| Magna vesting `magnaSHyv8zzKJJmr8NSz5JXmtdGDTTFPEADmvNAwbj` | ~$1.569B across 32 off-curve states / 35 sampled vaults | Current executable; top TRUMP authority `2RH6rUTPBJ9rUDPpuV9b8z1YL56k1tYU6Uk5ZoaEFFSK` is program-owned; live vault `HkykUVWTctptXZmRTWearMsH4SaQNmE4Ku3tMJe5v2mH` matches, ~$1.341B mark | [Successful direct program CPI exit](https://explorer.solana.com/tx/4PsZspiPdUWY5Lf2Himv6PWJMDCmahghaviXHWMYfmwCnLd5fLyU6vQ1h5SjXBmbfpnp9MWXqoWHMJe6JQ9TtDoH): 8,730,816 TRUMP moved from that vault under the authority at stack 2. TRUMP quoted liquidity was ~$26.3M, far below the mark. |
| SPL Stake Pool `SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY` | 7,113,200.994 SOL across **three** pools, ~$752.49M at a $105.7882 SOL spot quote | Exact `[pool, b"withdraw"]` PDAs with bump 255; all three 611-byte pool states owned by currently executable SP12, account type 1, stored bump 255. Successful direct/nested SP12 invocations contain `[pool, withdraw authority]`. | Active successful reference transactions at slots 457331268, 457232056, 457338667. This is only three of its pools, and may overlap LST/receipt claims. |
| Ves vesting `vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K` | ~$735.68M across 6 sampled authorities/vaults | Current executable; top two GOHOME authorities/vaults match current state; top one ~$698.76M | [Successful direct program CPI exit](https://explorer.solana.com/tx/4Mu2FnrUCfkvbmVAwza1p1cGvgxQcy7Y2PgezY5xC7xLix2tbg95gDkm8VFdLL5dwKRoCWR5dqPmgvd9MxkKRmnn) from a different ~$36.9M GOHOME vault. GOHOME quoted liquidity was only ~$350k, so the gross mark is a poor loss proxy. |
| Lockup controller `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn` | ~$473.85M across 308 sampled authorities/vaults; largest tokens YZY ~$202.7M, DBR ~$90.2M, JUP ~$58.4M | Current executable; top three state authorities and vaults rechecked and match; top three ~$183.18M | The highest YZY vault had two successful historical signatures and no outgoing transfer. Controller mapping is by live state ownership and vault authority; outgoing signer usage for this pool remains unproven. |
| Jupiter `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS` | ~$312.92M in 3 distinct vaults | Current executable; authority `6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL` is program-owned; live USDe/PYUSD/USDG vaults all match | Successful outbound CPI transfers from **all three** vaults, with `jup6QF...` the immediate Token/Token-2022 caller at stack 2 inside Jupiter router transactions. Asset breakdown below. |
| GRASS controller `EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc` | ~$132.74M across 9 sampled states/vaults | Current executable; top three current authorities and vaults match, ~$84.27M | [Recent direct CPI exit](https://explorer.solana.com/tx/vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v) from top vault, token caller exactly the state owner. GRASS quoted liquidity ~$280k. |
| META controller `gr8tqq2ripsM6N46gLWpSDXtdrH6J9jaXoyya1ELC9t` | ~$108.12M across 3 states / 4 vaults | Current executable; top state/vault ~$106.57M current mark | [Successful direct CPI exit](https://explorer.solana.com/tx/25f88VsGe8cHbdAdjxN5rKkWRNUxRGGW1evGEExw2So9h3JAeZCtRJFzbhVhigQB2vSvYYuyJJqZFV9TRWk1LBVt) from META vault with matching off-curve authority. META quoted liquidity ~$1.43M. |
| `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9` | ~$103.3M across MIM/DOG/PUPS vaults | Current executable; one program-owned off-curve authority and all three live vaults match | No outgoing signer trace checked. DOG contributes ~$91.3M mark with only ~$12k quoted liquidity; prioritize after more liquid or active targets. |
| SKR `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ` | ~$72.65M live SKR vault | Current executable and matching program-owned authority `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw` | Active account history, but no outbound transfer in the latest 20 successful transactions sampled. |

The sampled values in the table are not whole-program TVL. The current live recheck covered top authorities for each program, not all 308 lockup authorities or all 32 Magna authorities. The top-20-per-mint census can miss larger *aggregate* holdings spread across small vaults. Multiple priced receipt tokens may represent the same underlying assets.

### Jupiter stablecoin custody detail

The single `jup6QF...` authority holds three current matching vaults: USDe `3V949ufzT2viNuvTNHNmJyRMeof9JBSxZ4qQ3XsHTrb3` ~$297.46M mark (Jupiter quoted mint liquidity ~$7.98M); PYUSD `2zwY48mkxKezb5w3mGZDM5QEje5ibTNf5FA8oaEJAVej` ~$9.48M (liquidity ~$28.69M); and USDG `8DesAbtAabk7s2YdPX5P3Bs5QpHFps5H35mWuzbLYRZX` ~$5.98M (liquidity ~$33.91M). The [USDe exit](https://explorer.solana.com/tx/2nVYPjfdxcyHEsa8yfEtn5LpdpdWGyx6rkDn7GRywFAPwGpvx31vrTiZz9TWCgKyg2WK1gaHgUtzHSGwZ6yeh4kK) at slot 457308314 has top-level `jupo974...`, inner `jup6QF...` at stack 2, then SPL Token transferChecked at stack 3 naming the matching authority and vault as source. The [PYUSD exit](https://explorer.solana.com/tx/3YBuNne56dXvZHXLgqmJchphp9uJtHrez2YdbNWtUn4Xx4sVizzicnp6Hmk8akeoFhjjjVrgDCpBJmXcYuLLdaKW) and [USDG exit](https://explorer.solana.com/tx/sYSrcD3W5zgy6VxMbvzztPYYmg6K8mqBhnX6PGsT4L4oCxLhuBUSHqXEuANeXsoDgphCJNDgHuXAQUht1qMmxWZ) show the same immediate caller. This is a separate executable from Jupiter Lend liquidity and deserves a separate current-binary review.

### Same-asset atomic-funding context

The independent authority-verified lending-vault snapshot `current-lending-vaults.json` at slot 457320031 showed KLend liquidity-reserve balances of approximately **139.47M USDe, 25.38M PYUSD, and 5.43M USDG**. The corresponding Project0/marginfi liquidity vault snapshot showed approximately **1.11 USDe, 9,799 PYUSD, and 3,223 USDG**. These are observed reserve balances, **not verified flash-borrow limits or permission to combine these programs atomically**. They make Jupiter `jup6QF...` the strongest new same-mint composition candidate: its high-value stablecoin vaults have successful recent exits and a deep independent same-asset reserve. For Magna's TRUMP vault, the sampled KLend reserve held only ~67 TRUMP and no Project0/marginfi same-mint liquidity vault appeared; economic exit would depend mainly on market depth or another source. The sampled KLend GRASS reserve held ~1,892 GRASS, also small relative to its custody. SP12 holds native SOL stake, with separate SOL liquidity paths and stake withdrawal rules; its exact-PDA proof is stronger than any token price estimate.

### SP12 PDA proof

The [stake-pool source at commit `54cdced`](https://github.com/solana-program/stake-pool/blob/54cdceda5d77b06ea7cea6e18c99560212755ab1/program/src/lib.rs#L103-L110) derives the withdraw authority from `[stake_pool_address, b"withdraw"]` under the program ID. Independent current-state and successful transaction checks give:

| Pool state (all owned by SP12) | Exact derived withdraw PDA | Partial-census stake |
|---|---|---:|
| `9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn` | `6727ZvQ2YEz8jky1Z9fqDFG5mYuAvC9G34o2MxwzmrUK` | 2,785,889.460 SOL |
| `2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa` | `3ndMuPC9Cz5VC4RJkpoPaZz6Px6eVXtRenw9Yi1o2xnA` | 2,390,369.487 SOL |
| `pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP` | `7cWNhDsHe1m36ttDkJVBgbee1hRFvPqWZT2iWaBAyYGW` | 1,936,942.048 SOL |

All three state accounts had stored bump 255, exactly matching the derivation, at Helius confirmed slot 457346121. Transaction references are in `long-tail-sp12-proof.json`. This attributes the stake authority to SP12 even when T1TAN wraps the transaction.

## Confidence and next audit handoff

- **Verified direct controller and active exit:** Magna TRUMP, SP12, Jupiter `jup6QF...`, GRASS, META, and the smaller GOHOME vesting vault. These are worthwhile independent current-binary/IDL reviews. A successful authorized exit is a control sample, not a vulnerability.
- **Live authority/state mapping, exit still to prove:** largest GOHOME vault, Locp, `5UuMS...`, and SKR. Locked or rarely touched balances should not be presented as immediately withdrawable.
- **Price anomaly retained, not treated as economic value:** `quXSYkeZ8ByTCtYY1J1uxQmE36UZ3LmNGgE3CYMFixD` has a tSAT vault with ~$17.25B raw price-times-balance mark but only ~$62k Jupiter quoted liquidity and zero organic score. It remains in the raw census; pricing or redemption proof is needed before ranking it as money at risk.

The active audit should bind each candidate to its current ProgramData and deployed binary, find its current published IDL/source if available, reproduce an authorized value-moving instruction in simulation, then mutate signer, vault, state, destination, amount, and same-transaction composition. Count only unauthorized value movement from the **current binary** as a finding.

## Reproduction artifacts

- `mainnet-program-universe.csv`: executable denominator and ProgramData addresses.
- `mainnet-token-authority-census.raw.json`: original bounded top-holder balance/authority census; 61 MB, shared input.
- `native-stake-authority-census.json`: continuing sharded stake-authority census.
- `long-tail-attribution.js` / `long-tail-attribution-stake-sample.json`: top off-curve stake authority sampler and recent transaction lookup.
- `long-tail-token-signers.js` / `long-tail-attribution-token-signers.json`: top off-curve token authority sampler and transaction lookup.
- `long-tail-current-check.js` / `long-tail-current-check.json`: Helius current account/executable/balance/upgrade-slot recheck.
- `long-tail-exit-search.js` / `long-tail-exit-search.json`: bounded current transaction search with immediate CPI caller reconstruction.
- `long-tail-sp12-proof.js` / `long-tail-sp12-proof.json`: exact stake-pool withdraw PDA derivation and live pool-state proof.

The census is one day's snapshot, and program upgrades can change the audit target. No program in this report has a validated drain.
