# DAMM v1 outsider consumer / Alpha Vault continuation

Observed 2026-10-15. This is the requested continuation of `damm-v1-integration-audit.md`. It is limited to outsider-accessible consumers that could turn a same-transaction DAMM-v1 spot or LP-valuation move into unauthorized gain. Operator, protocol-fee, partner-fee, and other authority-gated withdrawal paths are excluded.

## Result

**No current permissionless consumer path completed with positive outsider net. Validated unauthorized gain: 0 raw units / $0.**

The strongest consumer candidate is Meteora Alpha Vault. Its DAMM-v1 fill surface is permissionless to crank, takes a maximum input amount without a caller-supplied minimum output, and routes the vault's quote asset through DAMM v1. That is the right architecture for a same-transaction front-run / victim fill / back-run test. Current state prevents the victim leg, however:

- 1,237 current Alpha Vault accounts were decoded; 135 target DAMM v1.
- Applying each vault's mode and `max_buying_cap`, only **3/135** retain real buying capacity.
- **0/3** are before their pool activation point now. Direct outsider calls on the current deployed binary fail Alpha Vault error 6004, `NotPermitThisActionInThisTimePoint`.
- Two remaining-capacity vaults quote USDG, but neither the 619 current KLend reserve mints nor the 401 current Project 0/Marginfi bank mints includes USDG.
- The only remaining-capacity WSOL vault has an exact-zero-fee KLend funding source, but its DAMM-v1 pool is disabled. Its full flash → spot → fill → reverse → repay wire fails the forward DAMM swap with `PoolDisabled` before Alpha Vault executes.

The full requested envelope fits comfortably—1,441 bytes, 34 inline accounts, 9 instructions, no address lookup table—so transaction size is not the blocker. The blocker is current on-chain lifecycle/pool state.

## Current binary identity and execution model

All mutations below are read-only `simulateTransaction` calls against mainnet with Solana transaction version 1, a 4,096-byte ceiling, 64-inline-account ceiling, 1.4M CU, and no ALTs. Nothing was signed or submitted. `sigVerify:false` modeled an ordinary on-curve outsider signer; signer flags and program checks remained active.

| Program | Current ProgramData | Last deployment slot | Executable SHA-256 |
|---|---|---:|---|
| DAMM v1 `Eo7W…5UaB` | `36Cv…vDL7` | 457,247,107 | `0856d35fa348f8d3570194ff9fe36095f34f0fa64c4286c0de5e207b1a788b22` |
| Alpha Vault `vaU6…9kd2` | `EHSL…XLC6` | 349,243,341 | `2e4540af0844bd8ef5d67e074f150554cc33f8de91f9d0771391c5c01ed81f7f` |
| KLend `KLend…mjD` | `9uSb…DQGA` | 440,486,775 | `9db16dd4b7bbfe4f13df850bf880bfc4522fcece06717c0626d625746a3cc85b` |

The Alpha hash is from the executable bytes in the current ProgramData account. The simulations themselves execute these deployed binaries, so the conclusions do not depend on treating published source as binary-equivalent.

## External-consumer census

At slots 457,355,756–457,355,809, a filtered `getProgramAccounts` census returned **69,926** program-owned, 952-byte DAMM-v1 Pool accounts and **69,926 unique LP mints**. Exact LP-mint equality was then tested against current external inventories:

| Consumer inventory | Current rows tested | Direct DAMM-v1 LP matches |
|---|---:|---:|
| KLend Reserve liquidity mints | 619 | 0 |
| Save Reserve liquidity mints | 1,829 | 0 |
| Project 0 / Marginfi Bank liquidity mints | 401 | 0 |
| Kamino Liquidity underlying mints | 191 | 0 |
| Meteora Dynamic Vault underlying mints | 72,511 | 12 |

The 12 Dynamic Vault matches are generic wrappers around a DAMM LP token, not a spot-price consumer. Six currently have nonzero underlying. All 12 have zero configured strategies, and each nonzero wrapper's accounted raw DAMM-LP amount equals its wrapper-LP supply exactly. Moving DAMM spot does not alter the wrapper's raw underlying quantity or 1:1 share ratio. A second-level join found **0** of the 12 wrapper LP mints accepted by KLend, Save, Project 0/Marginfi, Kamino Liquidity, or another Dynamic Vault.

A raw 32-byte DAMM-program-ID scan covered 115 local `.so` files. Matches were limited to DAMM itself, the Alpha Vault fixture, current Meteora DBC (two occurrences), and the DBC AMM fixture. DBC's DAMM reference is a migration/integration edge, not a permissionless consumer that pays an outsider from a transient DAMM valuation. This binary scan is a bounded local corpus, not a claim about every Solana program.

These joins test direct and one-wrapper-deep asset acceptance. Mint equality alone would not prove a protocol derives an oracle price from DAMM; the zero matches eliminate those direct lending/vault paths without making that stronger inference.

## Alpha Vault state intersection

The 135 DAMM-v1 Alpha Vaults were evaluated using the actual purchase target:

- pro-rata vault: `min(total_deposit, max_buying_cap) - swapped_amount`;
- FCFS vault: `total_deposit - swapped_amount`.

Only these three remain positive:

| Alpha Vault / pool | Quote | Actual remaining | Pool | Activation versus current state | Same-mint flash inventory |
|---|---|---:|---|---|---|
| `Auck…Gyu` / `GDwc…5DA` | USDG | 647,220,000,000 raw | enabled | slot 274,633,836; already passed | no current KLend or P0 mint |
| `HWk1…j2N` / `FZP1…Snd` | USDG | 113,480,000,000 raw | enabled | slot 274,633,992; already passed | no current KLend or P0 mint |
| `DBqF…YsJ` / `Cyzf…eC6` | WSOL | 315,000,000,000 raw | **disabled** | slot 277,698,784; already passed | KLend and P0 present |

For `DBqF…YsJ`, the Alpha Vault token account currently holds 11,049,978,750 raw WSOL. Thus the immediate asset amount is about 11.049978750 WSOL, not the nominal 315 WSOL remaining capacity. A direct outsider fill nevertheless fails the lifecycle guard before spending any of it. The exact same 6004 guard appears with and without a flash loan.

An enabled-pool WSOL control, `5GU8…iVH` / `5gJr…bHr`, has 837,055,905,873 raw total deposits and only 200,000,000,000 raw marked swapped. That looks like 637.055905873 WSOL unfilled if the cap is ignored, but it is pro-rata with a 200,000,000,000 raw maximum buying cap. Its **actual remaining capacity is zero**. It was retained as the live-liquidity control because a real DAMM round trip can execute there; Alpha fill still rejects with 6004.

## Exact current-binary path results

Eight read-only v1 paths were tested at slots 457,356,428–457,356,434. Every consumer attempt was made by the ordinary outsider signer using the non-whitelisted crank form (Alpha program sentinel plus the fixed treasury receiver); no operator or privileged signer was modeled.

| # | Atomic path | Wire / accounts / instructions | Result | Committed outsider net |
|---:|---|---|---|---|
| 1 | Enabled-pool control: direct Alpha fill | 828 B / 21 / 1 | Alpha 6004 lifecycle guard | 0 tokens; atomic rollback |
| 2 | Enabled control: zero-fee flash → Alpha fill → repay | 1,323 B / 33 / 7 | Alpha 6004 | 0 tokens; atomic rollback |
| 3 | Enabled control: funded DAMM forward-swap quote probe | 843 B / 20 / 5 | success | ordinary swap output; not a consumer gain |
| 4 | Enabled control: zero-fee flash → DAMM forward → reverse → full repay | 1,207 B / 28 / 8 | success, 251,722 CU | **−395,991 raw WSOL**, base token 0; −400,991 aggregate lamports including modeled fee |
| 5 | Enabled control: zero-fee flash → DAMM spot move → Alpha fill → reverse → repay | 1,441 B / 34 / 9 | forward swap succeeds; Alpha 6004 | 0 committed tokens; atomic rollback |
| 6 | Actual-unfilled WSOL vault: direct Alpha fill | 828 B / 21 / 1 | Alpha 6004 | 0 tokens; atomic rollback |
| 7 | Actual-unfilled WSOL vault: zero-fee flash → Alpha fill → repay | 1,323 B / 33 / 7 | Alpha 6004 | 0 tokens; atomic rollback |
| 8 | Actual-unfilled WSOL vault: zero-fee flash → DAMM spot move → Alpha fill → reverse → repay | 1,441 B / 34 / 9 | DAMM `PoolDisabled` at forward swap | 0 committed tokens; atomic rollback |

The matched manipulated and unmanipulated Alpha calls therefore fail on the same lifecycle guard. The manipulation does not bypass the guard.

### Positive funding/round-trip control

The successful round-trip control proves that the lender and AMM legs are real, fit the required v1 format, and can fully repay:

- KLend Reserve `4oig…AzBM`, WSOL supply `3Sdr…BpnR`, fee vault `DW71…bGS`;
- decoded current `flashLoanFeeSf = 0` exactly;
- borrowed 10,000,000 raw WSOL;
- forward swap: 10,000,000 raw WSOL → 268,006,980,617 raw base; 160,000 LP fee and 40,000 protocol fee;
- reverse swap consumed 268,006,958,348 raw base and returned 9,604,010 raw WSOL;
- KLend supply-token delta 0; KLend fee-vault delta 0; owner base balance returned to 0;
- owner WSOL was 395,991 raw lower than the matched 100,000,000-raw prefund, and aggregate native lamports were 400,991 lower after the modeled 5,000-lamport transaction fee.

This is a negative-net baseline, not a finding. It shows that the absent Alpha victim leg—not flash availability, DAMM execution, repayment, or transaction-v1 transport—is the decisive blocker.

## Conclusion and limits

The requested outsider extraction does not exist in current tested state. Alpha Vault is a credible architecture to re-test during a future DAMM-v1 launch window, because it is externally crankable and routes vault funds through DAMM. Today, no DAMM-v1 Alpha Vault simultaneously has remaining capacity, an unexpired activation window, an enabled manipulable pool, and a tested zero-fee same-mint flash source.

No operator-authorized bypasses are included in the result. Failed simulations roll back token state; a real failed submission would additionally cost its ordinary transaction fee, so it cannot improve outsider net.

The consumer census is broad but not a formal proof over every deployed Solana program. It covers current pool LPs against the named large lending/vault inventories, one wrapper level, Alpha Vault state, a 115-binary local corpus, and the exact current Alpha candidate. A newly deployed or unindexed consumer, a future Alpha launch window, or a later program upgrade would require a fresh run.

## Reproduction artifacts

- `damm-v1-external-consumer-census-resume.json` — all denominators, current slots, exact LP joins, wrapper state, and Alpha capacity intersection.
- `scan-damm-v1-external-consumers-resume.js` — read-only census reproducer.
- `damm-v1-alpha-vault-flash-resume.json` — all eight v1 simulation results, wire hashes, account images, swap events, current executable identities, and exact guards.
- `sim-damm-v1-alpha-vault-flash-resume.js` — read-only current-binary v1 reproducer; contains no RPC credential and never submits.
- `damm-v1-integration-audit.md` — preceding DAMM-v1 binary/integration audit and broader AMM controls.
