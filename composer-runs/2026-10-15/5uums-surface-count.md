# Current one-key RuneMine wrapper control surface

Read-only Solana mainnet observations on 15 October 2026, principally confirmed/finalized slots 457351167–457351880. The [deduplicated JSON](./5uums-surface-count.json) names every account and mint in the completed classes, with raw balances, decimals, authorities, price blocks, and quote results. No transaction was signed or submitted. All positive transaction controls used `simulateTransaction` with `sigVerify:false`.

## Condition and exact counts

The wrapper `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu` accepts one existing authorized operator key twice in its nominal two-of-three signer slots. The validated `[A,A,C]` wire requires one signature and makes the wrapper sign PDA `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi`. A distinct-slot A-only control fails. This is a **one-operator-key threshold bypass**, conditional on possession of A, B, or C; it is **not** a permissionless outsider drain. [The original validation](./5uums-validation.md) provides the compiled account indexes and positive/negative controls.

| Current set | Exact observed count | Basis |
|---|---:|---|
| Upgradeable ProgramData naming `5ok...` as upgrade authority | **3** | Finalized loader authority filter; all three reverse-link to executable Program accounts |
| Program-owned state accounts across those three executables | **2** | Unfiltered finalized scans: wrapper 0, original bridge 1, second bridge 1 |
| SPL Token accounts directly owned by the verified PDAs | **35** | Six owner-indexed token-program/PDA queries |
| Token-2022 accounts directly owned by the verified PDAs | **1** | Same owner-indexed query; `ImmutableOwner` extension decoded |
| **Distinct current token-owner accounts / custody mints** | **36 / 34** | All 36 nonzero canonical ATAs; two wrapper-held mint types overlap bridge-held mint types |
| Additional currently reachable mint-authority PDA | **1 mint** | `3fov...` mint CPI simulated; outside the 34 custody mints |
| Stake staker/withdrawer matches; Vote authorized-withdrawer matches | **0; 0** | Exact field filters with live positive controls |
| Loader Buffer naming `5ok...` as authority | **1** | Exact loader-state filter; Close simulation succeeded |

These are complete **for the stated filters and observed slots**. Current global delegated-token, token close-authority, mint/freeze-authority, and durable-nonce totals remain unresolved below. Thus 36 is an exact direct-owner count, **not a complete total for every conceivable authority role**.

## Programs, signer chain, and state references

| Executable | ProgramData | Last deployed slot | Current consequence of one-key alias |
|---|---|---:|---|
| Original bridge `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9` | `58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY` | 320435332 | One-key loader `SetAuthority` and `Close` simulations succeeded; bridge `Unlock` simulations transferred MIM, DOG, and PUPS under its PDA |
| Generic wrapper `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu` | `CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1` | 275216054 | Same loader controls; generic CPI directly signs `5ok...` |
| Second bridge `3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8` | `DVZhisAzrAeQfV1NGA53UJzfrWLrh3xJxp13ePoCWL3z` | 275222934 | Same loader controls; one-key wrapper→bridge `Mint` of its own mint PDA succeeded |

The only current program-owned states are the original bridge's 73-byte `BridgeInfo` at `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK` (`['bridge']`, bump 252) and the second bridge's 73-byte `BridgeInfo` at `4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB` (`['bridge']`, bump 253). Both store `5ok...` as signer and an all-zero second pubkey. Their token vault references are the live canonical ATAs owned by their respective bridge PDA; the 73-byte state does not list each vault. The wrapper's signer is `['multisig']`, bump 254. [Program and state scans](./5uums-surface-programdata.md), [all program-owned accounts](./5uums-surface-program-owned-state.json), and [token census](./5uums-surface-token-census.md) preserve the exact derivations and account bytes.

The verified fourth signer PDA is SPL mint `3FciBENRK2uh2FtxQQ1mC9FUJk9qY7NSYpRNexH5L7YU`, derived under the second bridge from `['bridge','PRAY TO DEMO GODS']`, bump 255. It is its own mint and freeze authority. A current one-key wrapper→`3fov...` `Mint(1 raw)` simulation changed supply from 4,050,000 to 4,050,001 raw; the distinct-slot A-only control failed, and the real supply remained 4,050,000. It has 49 decimals, so that supply is approximately 4.05×10⁻⁴³ nominal tokens. Its existing recipient ATA's off-curve owner is not linked by a proven signer derivation, so that ATA is **excluded from directly transferable custody**. A current `FreezeAccount` instruction was not demonstrated. [Mint proof](./5uums-surface-programdata-third-mint.json).

## Token holdings and liquidity

The original bridge PDA owns **33 SPL + 1 Token-2022** positive ATAs; `5ok...` owns two small SPL ATAs; the second bridge PDA owns **zero** SPL/Token-2022 ATAs. Every owned account's mint, raw balance, decimals, mint supply, and current authority are in [surface-count JSON](./5uums-surface-count.json). All 36 currently have no delegate or close authority in their own token data. Of the 34 referenced mints, 32 have null mint and freeze authorities; one has an unrelated freeze authority, and one an unrelated mint authority. None names a verified PDA. The Token-2022 ATA holds 1,000 units of `6e2N14Anof9q5i4C8RCpDfAGBvhEC8wr5KEurRwNpump`; **the current legacy bridge `Unlock` has not been shown to accept Token-2022**. Ownership and possible post-upgrade control are distinct from a proven current `Unlock` path for that account.

Jupiter Price v3 returned spot prices for **20 of 34 distinct custody mints** (22 account rows); 14 account rows were unpriced. Multiplying those prices by balances yields **$107,595,606.16**, a partial arithmetic mark dominated by DOG. Some returned `blockId` values are stale, and most of each major mint's supply is in the bridge vault. This is **not** a current fair-value or liquid-loss estimate. Jupiter Metis exact-in, full-account quotes to USDC succeeded for **16 of 36 accounts** (15 mint types): 18 returned `TOKEN_NOT_TRADABLE`, DOG returned `NO_ROUTES_FOUND` at full, 1%, and 0.01% of its vault, and the added Token-2022 account hit HTTP 429. The isolated successful outputs sum to $137,791.68 USDC, but shared routes and liquidity make that sum **non-executable as a portfolio quote**. [Price snapshot](./5uums-surface-prices.json) and [raw quote results](./5uums-surface-quotes.json) include times, price blocks, context slots, route plans, and errors.

| Mint | Vault amount | Partial spot mark | Full-vault USDC quote |
|---|---:|---:|---:|
| DOG `dog1viw...N65u` | 97,095,627,115.05337 | $92.08m | No current Metis route at the tested sizes |
| MIM `M1M6...EC3h` | 20,324,433,642.32 | $9.61m | $74,192; 99.23% quoted price impact |
| PUPS `2oGL...asBfe` | 716,632,732.762402445 | $2.38m | $47,575; 98.00% quoted price impact |
| BDC `BDCs...CxDY` | 975,059,549.745329989 | $1.75m | `TOKEN_NOT_TRADABLE` |
| LOBO `1obo...8mic` | 20,871,282,864.537064 | $0.97m | $4,708; 99.51% quoted price impact |

MIM, DOG, and PUPS are included inside the 34 bridge ATAs; no historical transfer receipt, locked-backing claim, or wrapped supply was added a second time. The original bridge's current binary has a validated one-key `Unlock` route for those three mints. The other owner-indexed bridge ATAs are authority exposure, with individual current-binary withdrawal paths not all simulated. The separate `3fov...` 49-decimal mint power is not counted as a holding or dollar asset.

## Native SOL

Three **independent read-only simulated** exits under the one-key alias establish the following native amounts: `5ok...` System balance **24.811787527 SOL** via generic System CPI; one authorized loader Buffer `AXCknCf7KmCWAv4De6vg89hRBcZvBrAwinKSBipXgcSg` **3.105642680 SOL** via `Close`; three ProgramData rents **8.913226560 SOL** via separate `Close` simulations. Their independent-case sum is **36.830656767 SOL**, approximately **$3,909** at Jupiter's SOL price $106.1286 (price block 457351880). A full multi-close sequence was not simulated. Program-account rent and the two bridge-state rents are excluded; ProgramData closure disables the linked deployed code. [Native census](./5uums-surface-native.md), [Buffer close](./5uums-surface-native-buffer-close.json), [ProgramData closes](./5uums-surface-programdata-close.json), and [SOL price](./5uums-surface-sol-price.json) provide pre/post images and unchanged live-state checks.

## Incomplete classes and practical conclusion

- **Current global delegate, token close-authority, and mint/freeze-authority totals are unknown.** The owner-indexed 36 accounts and their 34 referenced mints were checked directly, but Helius rejects filtered Token-program `getProgramAccounts` as too large. Its V2 first 10,000-account page has a continuation key even with zero matches. The indexed delegate endpoint returned zero from a node roughly 3,500 slots behind the owner snapshots and ignored `minContextSlot`; the current main endpoint lacks that method. Those zero samples cannot close the global sets. [Token scan diagnostics](./5uums-surface-token-census.json).
- **Durable nonce authority is unknown.** Exact filtered System-program queries were rejected; two zero-match V2 pages still had a continuation key. Stake and Vote withdrawer zeros, by contrast, completed with positive controls. [Native scan diagnostics](./5uums-surface-native.json).
- **Other downstream signer seeds and post-upgrade assets are not a closed-world count.** The four signer PDAs above are verified current routes. One-key loader authority takeover was simulated for all three programs, but no malicious binary was uploaded. Current program-owned state and direct token owner sets are exact at their observed slots; arbitrary future code or another protocol's unindexed authority reference cannot be inferred from those sets.

The evidence establishes a material **operator-threshold failure** over three upgradeable programs, bridge custody, a working mint authority, and directly liquid native SOL. It does not establish control of an authorized operator key by an outsider, a permissionless drain, Bitcoin-side redemption proceeds, or executable sale of the spot-marked reserves. No parties were contacted.
