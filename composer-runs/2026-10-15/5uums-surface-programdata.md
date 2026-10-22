# 5ok upgrade authority: complete ProgramData census and third bridge

Read only, 15 October 2026. No transaction was signed or submitted. Simulations used `sigVerify:false`; they model the one-operator-key signature and are not live chain mutations.

## Exact current loader census

At finalized slot **457351167**, a `getProgramAccounts` scan of the upgradeable loader filtered ProgramData authority bytes at offset 13 to `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi`. Each hit was validated as loader-owned `ProgramData` tag 3 with option tag 1 and the exact authority, and reverse-linked via a loader-owned `Program` tag 2 account pointing to it. The result is **3 ProgramData, 3 executable programs, zero orphan ProgramData**:

| Program | ProgramData | Last deployment slot | ProgramData space | Lamports |
|---|---|---:|---:|---:|
| Bridge `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9` | `58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY` | 320435332 | 818810 | 5699808480 |
| Wrapper `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu` | `CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1` | 275216054 | 63509 | 442913520 |
| Second bridge `3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8` | `DVZhisAzrAeQfV1NGA53UJzfrWLrh3xJxp13ePoCWL3z` | 275222934 | 397933 | 2770504560 |

The second bridge's current ELF has 397888 bytes, SHA-256 `5b2dd047c9e5198fcdf208cf5049b5180ef38baba119332240d5b292364adaa9`; direct current-state ProgramData reads confirmed the 5ok authority. Its current program-owned account census at finalized slot 457349998 is exactly one 73-byte `BridgeInfo`: `4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB`, the canonical `['bridge']` PDA of 3fov, bump 253. That state stores 5ok as bridge signer. The first bridge's corresponding `BridgeInfo` is `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK`, also storing 5ok, giving **2 distinct verified bridge states**. No SPL Token or Token-2022 accounts were returned for owner `4kN...` at finalized slots 457350096–457350098.

## One-key reachability and liquid rent

One-key `[A,A,C]` wrapper calls to loader `SetAuthority` simulated successfully for the third ProgramData: its authority post-image changed from 5ok to signer A. A distinct-slot `[A,B,C]` call requiring only A failed in the wrapper with `InvalidArgument`; direct chain re-read remained 5ok.

The same alias using loader `Close` variant 5 with `[ProgramData, recipient A, authority 5ok, Program]` succeeded for **all three** ProgramData. Each simulated ProgramData became uninitialized with zero lamports; A received exactly its previous balance. Per-program increases were **5.699808480 SOL**, **0.442913520 SOL**, and **2.770504560 SOL**: total **8.913226560 SOL** directly liquid by loader closure under the one-key condition. Distinct-slot A-only controls all failed. Post-simulation chain reads showed all three ProgramData unchanged. The linked executable Program accounts retained their 1,141,440 lamports each in simulations, so those lamports are excluded from the liquid-rent figure. Closing an actual ProgramData would also disable its program; this is a destructive control consequence, not an extra spendable balance.

## Second bridge mint and custody boundary

Complete returned signature history for 3fov showed 17 signatures back to its deployment, 12 successful, including 10 historical `MintTo` CPIs for **one mint**, `3FciBENRK2uh2FtxQQ1mC9FUJk9qY7NSYpRNexH5L7YU`. This address is exactly the `['bridge', 'PRAY TO DEMO GODS']` PDA of 3fov, bump 255, and is both its own SPL mint and freeze authority. At finalized slot 457350806, its supply was **4,050,000 raw units at 49 decimals** (4.05 × 10^-43 display units). The seen ATA `F2mD3WUxb14fJTFUqgV5THj3rvdet85Wy8hf7SD9ujS2` held 4,050,000 raw units. Its off-curve owner `3E79iUiqADpX14GNsrVmu5k1F9MKe3To3FTA2LoSAaub` has not been derived as a reachable PDA and its ATA is **not counted as directly transferable custody**.

A current-state one-key `[A,A,C]` wrapper→3fov `Mint(1 raw)` simulation succeeded: mint supply and that ATA's balance each rose 4,050,000→4,050,001 in the simulated post-image; the distinct-slot A-only control failed. Actual chain reads stayed at 4,050,000. This proves current mint authority reachability, but supplies no market-liquidity value. Current code's ability to freeze via this mint PDA was not tested; the freeze-authority field alone is not a demonstrated freeze operation. The second bridge state PDA currently has zero direct token accounts.

The exact ProgramData census is complete for authority 5ok at the recorded finalized slot. Mint accounts that were externally initialized with an arbitrary 3fov-derived self-authority before being passed to the bridge are not exhaustively discoverable from 3fov owner-state or invocation history alone; the one observed mint is the only mint established by that history. Future mint creation is outside the current-account count.

## Evidence

- `5uums-surface-programdata.js` and `.json`: full loader authority census and executable reverse links.
- `5uums-surface-programdata-third-binary.json` and `.so`: current second bridge ELF and ProgramData metadata.
- `5uums-surface-programdata-third-state.json`: entire 3fov-owned state and canonical PDA derivation.
- `5uums-surface-programdata-third-vaults.json`: owner query for both token programs, zero results.
- `5uums-surface-programdata-third-upgrade.js` and `.json`: third ProgramData authority-change positive and negative simulations.
- `5uums-surface-programdata-close.js` and `.json`: three ProgramData closure positive and negative simulations, pre/post and chain unchanged.
- `5uums-surface-programdata-third-history.js` and `.json`: historical invocation and mint evidence.
- `5uums-surface-programdata-third-mint.js` and `.json`: current one-key mint simulation and exact mint PDA derivation.
