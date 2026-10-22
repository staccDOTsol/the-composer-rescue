# Solana mainnet executable-program universe

Snapshot: 2026-10-15 14:47 EDT (18:47 UTC). Read-only RPC only; no transaction was submitted. This report supplies the executable-program denominator and joins it to the existing authority-verified custody queue. It does **not** claim that every executable has been assigned a USD value or security-reviewed.

## Exact enumerated denominator

Two independent current-state RPCs returned the exact same set of **77,715 unique executable program IDs**. The sorted program-ID set SHA-256 is:

`7d18b6ca45d5fa592c5963290d2a4da97a1fd3d2497a31906cd2334550c97cdd`

| Live account owner/class | Owner rows returned | Executable IDs included | Non-executable rows excluded | Finalized observation slot |
|---|---:|---:|---:|---:|
| Upgradeable loader | 77,255 | **77,255** | 0 | 457,342,377 |
| BPF loader 2 | 504 | **314** | 190 | 457,342,396 |
| Deprecated BPF loader | 202 | **136** | 66 | 457,342,399 |
| Loader v4 | 0 | **0** | 0 | 457,342,400 |
| Native loader / builtins | 10 | **10** | 0 | 457,342,400 |
| **Deduplicated total** | 77,971 owner rows | **77,715** | **256** | slots 457,342,377–457,342,400 |

The Solana public endpoint independently returned the same counts, same IDs, and same set hash at finalized slots 457,342,403–457,342,420. There were no duplicate program IDs. All 77,255 upgradeable rows decoded with `UpgradeableLoaderState::Program` tag `2`, and all 77,255 referenced distinct ProgramData addresses.

The 10 current native-loader executables were:

- `11111111111111111111111111111111`
- `BPFLoader1111111111111111111111111111111111`
- `BPFLoader2111111111111111111111111111111111`
- `BPFLoaderUpgradeab1e11111111111111111111111`
- `ComputeBudget111111111111111111111111111111`
- `Ed25519SigVerify111111111111111111111111111`
- `KeccakSecp256k11111111111111111111111111111`
- `Secp256r1SigVerify1111111111111111111111111`
- `Vote111111111111111111111111111111111111111`
- `ZkE1Gama1Proof11111111111111111111111111111`

Core programs that have migrated to BPF, such as Stake, Config, and Address Lookup Table, appear in the upgradeable-loader class according to their live account owner; they are not missing from the census.

### Enumeration method

1. Query `getProgramAccounts` for each protocol-defined loader owner: upgradeable loader, BPF loader 2, deprecated BPF loader, Loader v4, and NativeLoader.
2. For the upgradeable loader, apply `dataSize: 36`, the fixed Program-state layout, and fetch the 36 bytes needed to check tag `2` and decode ProgramData. This excludes ProgramData and Buffer states by construction.
3. For older loaders, Loader v4, and NativeLoader, request zero data bytes and retain only rows whose live account metadata has `executable: true`.
4. Deduplicate by program ID, sort, and hash the newline-delimited ID set.
5. Repeat against an independent provider and require exact set equality.

The full enumerated set and per-program owner classification are in `mainnet-program-universe.csv`. The provider counts, slots, hash, and comparison are in `mainnet-program-universe-summary.json`.

### Provider/indexing blocker observed

Flux cannot be used as the current denominator in this environment. Its same-run responses were about 3,100–3,500 slots behind, returned only 66,612 upgradeable-loader rows, returned zero rows for both older BPF loaders, and marked every returned upgradeable/native row `executable: false`, including known executable accounts. This is a concrete provider/index view mismatch, not evidence that those programs disappeared.

`getProgramAccounts` does not return a server-side total, pagination cursor, or one atomic slot across five owner queries. Consequently, “77,715” is the **exact enumerated union for the five successful scans**, independently reproduced byte-for-byte as an ID set, rather than a cryptographic proof that no provider implementation omitted an account. Deployments can also land between the per-owner slots. The exact independent match and non-round result count are strong evidence against a silent result cap; a rooted Geyser/accounts-db export at one slot would be the stronger missing source for an atomic chain-wide denominator.

## Cross-reference to current high-value queue

Every one of the 20 existing custody/discovery candidates is present in the 77,715-ID executable universe, and every one is currently upgradeable-loader owned. Values below are earlier same-day, direct authority-verified **priced gross custody lower bounds**, not TVL proxies or exploit amounts. Unpriced balances are excluded. LSTs, bridge claims, LP tokens, and strategy claims can overlap underlying reserves, so these rows must not be summed into an ecosystem total.

| Order | Program ID | Priced gross lower bound | Custody coverage | Current-binary campaign status |
|---:|---|---:|---|---|
| 1 | SPL Stake Pool `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` | $3,514.36M | Complete canonical pool-state census; 99.0032% underlying authority spot coverage | Complete; 0 novel reportable findings |
| 2 | Kamino Lend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | $1,406.09M | 271 nonzero verified vaults; 18 unpriced | Complete static/current-binary mapping; runtime build blocked; 0 novel reportable findings |
| 3 | Jupiter Lend `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` | $1,121.47M | 42 nonzero verified vaults; 10 unpriced | Partial current-binary review; 0 novel reportable findings |
| 4 | Jupiter Perps `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu` | $751.37M | 6 token vaults + 33 native stake accounts tied to transfer-authority PDA | **Not started** |
| 5 | Marinade Liquid `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` | $302.61M | 488 stake accounts + native reserve/liquidity PDAs; mSOL leg excluded | Focused partial review; no validated unauthorized exit |
| 6 | Orca Whirlpools `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | $259.11M | 200 vaults in 100-pool sample; 5 unpriced | Focused partial review; no validated unauthorized exit |
| 7 | Raydium AMM v4 `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | $251.63M | 482 sampled pools / 964 verified vaults; 187 unpriced | Focused partial review; no validated unauthorized exit |
| 8 | Sanctum INF `5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx` | $197.03M | 168 nonzero pool-state-authorized accounts; 124 unpriced; LST overlap | Focused partial review; no validated unauthorized exit |
| 9 | Meteora DLMM `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | $170.28M | 200 vaults in 100-pool sample; 5 unpriced | Focused partial review; no validated unauthorized exit |
| 10 | Raydium CLMM `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | $151.54M | 352 sampled pools / 704 verified vaults; 170 unpriced | Focused partial review; no validated unauthorized exit |
| 11 | PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | $111.82M | 1,000 sampled pools / 2,000 verified vaults; 560 unpriced; 1,506,649 pool states discovered | Limited partial checks; no validated exploit |
| 12 | Save/Solend `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo` | $85.48M | 711 nonzero reserve vaults; 127 unpriced | Focused partial review; no validated unauthorized exit |
| 13 | Wormhole Token Bridge `wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb` | $53.49M | 837 canonical nonzero custody accounts; 599 unpriced; bridge overlap | **Not started** |
| 14 | marginfi/Project0 `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | $37.33M | 328 nonzero derived vaults; 51 unpriced; strategies excluded | **Not started**; current binary reported source-verified |
| 15 | Meteora Dynamic Vault `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi` | $35.21M | 104 underlying vaults referenced by sample; 71 unpriced; 72,511 states discovered | **Not started** |
| 16 | Raydium CPMM `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | $30.49M | 164 sampled pools / 328 verified vaults; 87 unpriced | **Not started** |
| 17 | Meteora DAMM v2 `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | $26.97M | 200 vaults in 100-pool sample; 44 unpriced; 167,308 pools listed | **Not started** |
| 18 | Jito Restaking Vault `Vau1t6sLNxnzB7ZDsef8TLbPLfyZMYXH8WTNqUdm9g8` | $17.79M | 31 nonzero canonical vaults; 17 unpriced; JitoSOL overlap | **Not started** |
| unranked | Drift `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` | $14.84 in direct-vault sample | Full custody graph unresolved; this value does not rank Drift | Custody discovery incomplete |
| unranked | Meteora DAMM v1 `Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB` | unknown | Sampled underlying value belongs to Dynamic Vault; LP/control layer unresolved | **Not started** |

The exact current ProgramData address for every row is in `mainnet-program-queue-crossref.json`. The validation column records the evidence state entering this pass; it is not an assignment tracker. Several formerly unreviewed rows are now actively assigned elsewhere: Jupiter Perps, Wormhole/bridge families, marginfi, Dynamic Vault/DAMM v1, Raydium CPMM, DAMM v2, Jito Vault, and Drift, along with active follow-ups for Marinade, Jupiter Lend, PumpSwap, native stake, and related families. They must not be redispatched from this report.

### Top three verified-custody programs not in an active exact-controller target

After excluding the 14 active controller IDs/shared dependencies recorded in `mainnet-active-target-exclusions.json`, the highest remaining program-specific custody lower bounds are:

1. **Orca Whirlpools** — `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`; current ProgramData `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD`; **$259.11M** sampled priced gross lower bound from 200 program-bound vaults in 100 pools, with five nonzero vaults unpriced. A focused current-binary review found no validated unauthorized exit, but coverage was partial.
2. **Raydium AMM v4** — `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`; current ProgramData `A7ZG7ByDi8DpzT9Ab7CiXhvgYTJQmaDPJkMDoPitaCQV`; **$251.63M** sampled priced gross lower bound from 482 live program-owned pool states and 964 authority-verified vaults, with 187 unpriced. The active Raydium assignment is CPMM, a distinct executable; AMM v4 had only focused partial exit checks.
3. **Sanctum INF** — `5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx`; current ProgramData `ALmAxhSP7TDWGMHWBLjD9qS71YjqxjN1ba6JLRdzdVy`; **$197.03M** sampled priced gross lower bound from 168 nonzero accounts whose token authority is the derived INF pool-state PDA, with 124 unpriced. The active Sanctum assignment covers unstake custody, a distinct controller; INF's current-binary review remained focused and partial.

This ranking uses exact controller program IDs, not organization-wide brand exclusion: separate Raydium and Sanctum executables have separate binaries, state layouts, authorities, and exploit surfaces. The machine-readable result and exclusion semantics are in `mainnet-unassigned-top3.json`. Custody magnitude remains prioritization evidence only; none of these values is a demonstrated exploitable amount.

## Why the program denominator is not yet a USD denominator

The executable census is complete as an enumerated ID set, but ordinary Solana RPC cannot answer “which assets does each program-derived authority control?” chain-wide:

- A token account stores its authority pubkey, not the program and seeds that can sign for that pubkey. PDA derivation is not invertible without seeds or a program-state reference.
- A program can move value through PDAs owned by System, Stake, SPL Token, Token-2022, or another protocol. Scanning accounts owned by the executable therefore misses most custody.
- Token/stake account queries expose balances but not an authenticated `program -> signer PDA -> vault` attribution edge.
- LP tokens, LSTs, wrapped bridge assets, lending receipts, and strategy shares create economic overlap even when addresses are distinct.
- Unpriced mints must remain unpriced; dashboard TVL cannot replace live authority proof.
- Closed-source or changed layouts require program-specific state decoding before a vault reference can be proven.

Accordingly, no claim that “all 77,715 programs are ordered by USD” is made. The exact blocker is the absence of a current, rooted, chain-wide index that joins inner-instruction signer provenance to token/stake authorities and balances.

## Repeatable scalable expansion process

1. **Universe diff:** rerun `enumerate-mainnet-programs.py`; require Helius/public set equality; diff the set hash and newly executable IDs.
2. **Signer-edge extraction:** from a rooted Geyser/Yellowstone or equivalent warehouse export, parse inner instructions and record `(invoking program, signer PDA)` edges where a program invocation supplied signer privilege.
3. **Live custody join:** join signer PDAs to SPL Token, Token-2022, native Stake authorized-withdrawer, and System-account balances at one rooted slot. This generates candidates, not final attribution.
4. **Authority proof:** for each material candidate, obtain a live program-owned state reference and rederive the PDA from current program ID/seeds; reject stale, foreign, and merely coincidental authorities.
5. **Valuation and deduplication:** price live mints, retain unpriced balances separately, dedupe exact vault addresses, and tag look-through LST/LP/bridge/receipt overlaps rather than summing them.
6. **Audit queue:** order programs by non-overlapping direct priced custody lower bound; bind each review to current ProgramData/binary; dynamically validate a successful value-moving control before interpreting adversarial failures.

The next missing data source is therefore a rooted account/transaction warehouse or Geyser feed with inner CPI signer metadata and full Token/Token-2022/Stake state. Without it, expanding from the current high-value protocols to all 77,715 executable IDs requires program-by-program seed and layout discovery and cannot honestly be called exhaustive.

## Artifacts and provenance

- `enumerate-mainnet-programs.py` — read-only loader-owner enumerator with retry/backoff, independent-provider comparison, CSV export, and set hash.
- `mainnet-program-universe.csv` — all 77,715 executable program IDs, loader class, owner, ProgramData where applicable, and observation slot.
- `mainnet-program-universe-summary.json` — counts, slots, provider fingerprints, and Flux mismatch evidence.
- `mainnet-high-value-queue.json` — custody-ranked queue input with coverage and validation status.
- `cross-reference-mainnet-programs.py` — deterministic queue/universe join.
- `mainnet-program-queue-crossref.json` — joined live executable and ProgramData proof for all 20 candidates.
- `mainnet-active-target-exclusions.json` — active exact-controller/shared-dependency exclusions used to avoid duplicate assignments.
- `rank-unassigned-mainnet-programs.py` and `mainnet-unassigned-top3.json` — deterministic top-three unassigned custody ranking.
- Surviving primary custody sources: `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/solana-pda-value-canvass.md`, `solana-pda-value-inventory.json`, `work/amm-canvass/raydium-summary-1p.json`, and `work/amm-canvass/pumpswap-summary-10p.json`.

Some pre-cleanup per-program raw evidence files were removed during disk recovery. Their already-recorded counts/statuses were carried forward from this task's evidence context; they were not silently recomputed or upgraded to complete coverage. The current executable status and ProgramData references were freshly rechecked in this run.
