# Drift current-custody and deployed-exit audit

Date: 2026-10-15  
Program: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`  
Live custody snapshot: Solana slot `457345398` (`2026-10-15T18:56:50Z`)  
Recovered source revision: `13e8e9b8d614f3b62e3a65a8c372c819e6529aeb` (`sdk: release v2.163.0-beta.1`)  

## Result

No novel, permissionless, immediate fund-drain or fund-theft path was validated against the current deployed binary.

The material custody missed by the earlier bounded spot/insurance scan is the DLP `LPPool`: its two canonical Constituent vaults hold approximately **$66.38k** at the observation time. Adding the approximately **$14.82** in canonical SpotMarket vaults gives an indicative directly referenced token-custody total of approximately **$66.40k**. Custody is not itself a vulnerability.

The decisive current-binary fact is that ordinary Drift Anchor entrypoints are not reachable in the deployed ProgramData. A known historically successful, value-moving LP transaction and a newly assembled standard `withdraw` both reach the current program but fail at instruction dispatch with Anchor error `InstructionFallbackNotFound` (`101`). The deployed ProgramData contains zero byte occurrences of the tested Anchor selectors for `withdraw`, `deposit`, `lp_pool_swap`, `lp_pool_remove_liquidity`, `begin_lp_swap`, and `end_lp_swap`.

Consequently, a positive **current-binary value-moving exit control could not be produced**. This is a concrete reachability blocker, not a substitution of a historical or simulated path for the requested current implementation. The unchanged historical transaction, missing-end mutation, and in/out-account-alias mutation are all rejected before their account or atomicity controls execute.

A separate, positive funding control did succeed: a current-config, zero-fee KLend USDC flash borrow and indexed repayment, encoded as a real Solana v1 transaction. At slot `457348639`, reserve `AYL4...` stored an exact flash-loan fee rate of zero and `7,820,864,730,717` raw USDC of callable liquidity. Both a one-unit loan and the exact callable maximum completed with the lender supply, borrower token account, fee vault, and watched Drift USDC vault unchanged; maximum plus one failed with `InsufficientLiquidity`. Inserting a Drift `withdraw` at either one unit or the exact maximum reached Drift after a successful borrow and failed only at Drift's dispatcher. Thus large, same-mint, atomic funding is available, but it cannot cross the current Drift dispatch boundary.

An operational availability observation follows: the state-referenced LP tokens are presently not movable through any audited public exit selector in this deployed binary. That is not an attacker-exploitable drain finding. Moving them appears to depend on a future authorized upgrade or on a distinct path for which this review found no evidence.

## Scope and method

In scope:

- live, state-referenced SpotMarket spot and insurance vaults;
- live `LPPool`, `Constituent`, Constituent vault, and DLP fee-vault state;
- standard withdraw/borrow-related user exit logic;
- LP swap, add/remove-liquidity, and privileged begin/end swap logic;
- same-transaction end-removal and in/out-account aliasing where the deployed dispatcher allowed testing;
- real Solana v1 KLend USDC flash-loan composition at dust, exact-current-liquidity, repeated-leg, alias, and instruction-order boundaries;
- the current upgradeable ProgramData and current-state `simulateTransaction` behavior.

Out of scope:

- the known OtterSec GoonFi issue and other active audit tranches;
- compromise of admin, LP hot-wallet, upgrade-authority, mint-authority, or oracle-authority keys;
- permissionless dust sent to the Drift signer PDA without a canonical state reference;
- protocol-wide claims or economic solvency that are not represented by directly controlled, state-referenced token accounts.

All chain interaction was read-only. No transaction was submitted. No RPC credential or endpoint secret is included in this report.

## Live custody reconciliation

### Canonical SpotMarket vaults

The audit enumerated all **66 live `SpotMarket` state accounts by account discriminator**, rather than guessing market indexes. For each state it read the stored spot vault and insurance vault, producing **132 canonical references**.

Only two of those 132 accounts were nonzero:

| Market | Vault | Raw amount | Human amount | Indicative USD |
|---|---|---:|---:|---:|
| 57, syrupUSDC | `8KxSBpCt8Yqb554cMKejRJ1RwaELDuQiw2UjzAYTDGTa` | `6687298` | `6.687298` syrupUSDC | ~$7.94 |
| 58, LBTC | `5rMurLpHYzH2J4rd7ebUyYfJXcxse7GXZKKiHgyZfQFb` | `8375` | `0.00008375` LBTC | ~$6.88 |

Canonical spot/insurance custody was therefore approximately **$14.82**, corroborating the earlier approximately $14.84 bounded result while replacing its guessed-index method with a complete stored-reference census.

SpotMarket zero vaults do not imply zero user accounting. For example, quote market 0 retains large internal deposit and borrow balances while its canonical token vault is zero. Those internal claims are not extra direct token custody and were not added to the vault total.

### DLP LPPool and Constituents

The one live LP pool state is:

- `LPPool`: `ELgW8UwFRAUc7YpRMzJiuVVwSFmPHMW9knY6hBx9vRxa`
- DLP mint: `DLPCFKt6vewybznjHUqZxJcWFuJd4pbs6i73psT7TmSP`
- `lp_pool_id`: `1`
- `max_aum`: `75000000000` (approximately $75,000 at quote precision)
- `last_aum`: `38490439011` (approximately $38,490.439011)
- `last_aum_slot`: `410366325`
- recorded token supply: `68944047356` (68,944.047356 DLP)
- constituent count: `2`

The two state-derived Constituents and vaults are:

| Constituent | State | Vault | Raw amount | Human amount | Indicative USD at snapshot pricing |
|---|---|---|---:|---:|---:|
| USDC, market 0 | `CB87ZvrM3onYtg1uh27p6VLLyhW7sBkC9npY8xaKJoGk` | `3gQX7BSHfsFUFzy7E1kcdi9zNKt84UHiFwTw24DTvvon` | `56864375647` | `56,864.375647` USDC | ~$56,839.47 at USDC $0.999562 |
| SOL, market 1 | `3wUX7VAXauRypDawqwgFx8o4ngjiNXosM72bLb6f9gZd` | `AJANB8AVhUHJoNCe8jKercpG6aMxDzgHLRcSJVt7jtrz` | `90204499994` | `90.204499994` SOL | ~$9,543.64 at SOL $105.80 |

Both state PDAs and both vault PDAs re-derived exactly from the source seed schemes. Each vault's token authority is the vault PDA itself, matching the source's PDA signer seeds. Each Constituent's internal `spot_balance` currently resolves to zero, so this audit found no additional live program-vault or strategy balance behind the two Constituents; their current value is directly in the listed vaults.

The LP pool's canonical DLP token vault, `4fxh58wT1H6r2Mnvzn7pPGpE6fgixdHf6bSsXpocEQG3`, contains `20683210` raw units, or `20.683210` DLP. This is a protocol-fee LP-token claim on the same underlying pool assets, not additional underlying token custody, and is not double-counted.

The legacy `State.srm_vault` field is the system-program default address and is not a token account. DEX fulfillment configurations reference external exchange vaults, but those are not Drift-PDA-controlled custody and were not attributed to Drift.

### Dust exclusion

A program-wide scan found 870 token accounts whose token authority was the Drift signer PDA; 737 were nonzero. Most were permissionlessly created or funded dust/spam accounts, including nonsensical token supplies. Only canonical accounts referenced from Drift state were counted. Treating every signer-authorized token account as protocol custody would materially overstate value and was explicitly rejected.

## Current deployed binary

The upgradeable program points to ProgramData `7dLgmtcTavcguNoynVimF9ZNVb13FvhXVRfj2HyrDGaP`.

| Field | Value |
|---|---|
| Last deployment slot | `429731225` |
| Deployment block time | `2026-06-29T19:57:01Z` |
| ProgramData length | `6,673,114` bytes |
| ProgramData SHA-256 | `54d61c27d5b433d0c316d06e4246803a5bbabb1b3930e2027992c33080c4b2b4` |

The following default Anchor discriminators had zero byte occurrences in the deployed ProgramData:

| Instruction | Discriminator | Occurrences |
|---|---:|---:|
| `withdraw` | `b712469c946da122` | 0 |
| `deposit` | `f223c68952e1f2b6` | 0 |
| `lp_pool_swap` | `24a12731e30123e2` | 0 |
| `lp_pool_remove_liquidity` | `a424c1fcc49d8a2b` | 0 |
| `begin_lp_swap` | `402c18c7307d435b` | 0 |
| `end_lp_swap` | `637dd6a581affd87` | 0 |

This binary evidence agrees with live dispatch behavior. It also prevents silently assuming that the checked-in IDL or dormant handlers are callable.

### Source-to-binary status

The recovered official source is commit `13e8e9b8d614f3b62e3a65a8c372c819e6529aeb`, dated 2026-06-23, six days before the current ProgramData deployment. It is **not an authenticated, reproducible source-to-binary mapping**.

That source's `#[program]` functions, including standard user and LP entrypoints, are commented out. Its wrapper still contains a custom `program_entry` intended to route two `0xffffffff`-prefixed native oracle-update selectors before falling back to Anchor (`programs/drift/src/lib.rs:37-61`). A live simulation of the corresponding native prefix also returned `InstructionFallbackNotFound`, so even that source wrapper is not proven to match the current deployed ELF.

The source is therefore useful for dormant control review and state decoding, but current reachability was decided from ProgramData and live simulation, not inferred from source.

## Positive control and mutation results

### Historical value-moving control

Transaction `3RWdj4gFg58gkcxMM6ehW38TY8rRMWSgSSsSfaqfsTqhVKmxXGSXGibk3ab6YtrGjKTr1aXRPRGpg4YcZbuEuLQz` succeeded at slot `405607772`. It executed:

1. `BeginLpSwap` using discriminator `402c18c7307d435b`;
2. a Jupiter route with SPL token transfers;
3. `EndLpSwap` using discriminator `637dd6a581affd87`;
4. a final SPL token transfer back into LP custody.

This is a real historical positive value-moving control, not a mock transaction. It does not establish current reachability because the program was later upgraded.

### Current replay and mutations

The historical serialized transaction was replayed with `sigVerify: false` and a replacement recent blockhash against current state. Two transaction-level mutations were then applied to the same payload:

- remove the terminal `EndLpSwap` instruction;
- alias the in/out Constituent vault and Constituent state account indexes in both Drift instructions.

| Case | Current result | Compute units before rejection |
|---|---|---:|
| Unchanged historical control | `InstructionFallbackNotFound` at outer instruction 2 | 5,127 |
| Remove `EndLpSwap` | `InstructionFallbackNotFound` at outer instruction 2 | 5,127 |
| Alias in/out vault and Constituent accounts | `InstructionFallbackNotFound` at outer instruction 2 | 4,687 |

All three cases fail on `BeginLpSwap` dispatch. The current binary never reaches the historical same-transaction scan or account-equality checks. The equal failure is therefore evidence of an unreachable surface, not evidence that the deeper atomicity controls accepted either mutation.

### Standard withdrawal control attempt

A current `withdraw` was assembled for a live market-57 depositor, using its signer-bound `User`, `UserStats`, existing syrupUSDC token account, canonical market vault, market/oracle remaining accounts, Drift signer, token mint, and SPL Token program. The amount was one raw token unit. Simulation returned `InstructionFallbackNotFound` at instruction 0 after 5,456 compute units, before Anchor account constraints or margin logic.

No withdrawal, borrow, liquidation, settlement, LP swap, or LP redemption transaction could therefore serve as a positive current-binary value-moving control. Mutation testing beyond dispatch is not technically meaningful against this binary.

## Solana v1 zero-fee flash-loan stress

### Funding control and transaction envelope

The lender was KLend program `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`, using its USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, liquidity supply `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`, fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`, borrower token account `C5D9cS5gAtuSipZJXacjgdpaBhed39GMeMr5CNom8zDw`, and simulated payer `Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM`. The instruction templates came from successful transaction `588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd` at slot `457338071`.

The simulations used the real Solana v1 wire layout accepted by `simulateTransaction`: version byte `0x81`, v1 configuration mask `0x0c`, compute limit `1,400,000`, loaded-account-data limit `67,108,864`, at most 64 inline addresses, no address lookup tables, one required signature placeholder, `sigVerify: false`, and replacement blockhash. Nothing was signed or submitted. The positive borrow/repay controls were 531 bytes, 11 inline accounts, five writable accounts, and two instructions—well inside the 4,096-byte/64-address v1 bounds.

At slot `457348639`, the reserve account stored:

- internal available liquidity: `7,820,864,730,717` raw USDC;
- supply-token account balance: `7,820,864,800,722` raw USDC;
- flash-loan fee rate: exactly `0` in the protocol's 2^60-scaled field.

The zero fee is therefore a verified current configuration, not a small nonzero fee rounding down. It is specific to this reserve; this audit does not generalize zero fees to other KLend reserves.

| Case | Amount (raw USDC) | Result | CU | Wire/accounts/instructions |
|---|---:|---|---:|---|
| Borrow + repay, dust | `1` | success | 55,213 | 531 B / 11 / 2 |
| Borrow + repay, exact internal available | `7,820,864,730,717` | success | 55,213 | 531 B / 11 / 2 |
| Borrow + repay, available + 1 | `7,820,864,730,718` | KLend `InsufficientLiquidity` (`6008`) at instruction 0 | 32,644 | 531 B / 11 / 2 |
| Borrow + Drift `withdraw` + repay, dust | `1` | Drift `InstructionFallbackNotFound` (`101`) at instruction 1 | 35,573 | 575 B / 12 / 3 |
| Borrow + Drift `withdraw` + repay, exact available | `7,820,864,730,717` | Drift `InstructionFallbackNotFound` (`101`) at instruction 1 | 35,566 | 575 B / 12 / 3 |
| Borrow + repay + Drift, exact available | `7,820,864,730,717` | borrow and repay succeed; Drift fallback at instruction 2 | 57,190 | 575 B / 12 / 3 |
| Drift + borrow + repay, exact available | `7,820,864,730,717` | Drift fallback at instruction 0; lender never invoked | 1,345 | 575 B / 12 / 3 |

The 12-account composed envelope contained the payer, KLend reserve, liquidity supply, borrower USDC account, fee vault, KLend program, reserve authority `FsvTiXTUFDc4aLbrov4PrvDTjXCWCniL1dxTUkZ1T2ss`, lending market `47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8`, USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, instruction sysvar, SPL Token program, and Drift program. No ALT hid additional accounts.

For both successful controls, the simulated pre/post balances were exact: payer lamports `53,084,785 -> 53,079,785` (the simulated transaction fee), borrower USDC `716,825 -> 716,825`, lender supply `7,820,864,800,722 -> 7,820,864,800,722`, fee vault `0 -> 0`, and watched Drift USDC Constituent vault `56,864,375,647 -> 56,864,375,647`. KLend flash loans do not create an obligation/debt account; the successful indexed repayment plus restored token balances proves complete repayment. The reserve state hash changed because the simulation updates reserve state, not because principal remained outstanding.

### Full-account Drift mutations

A separate full-account composition used a live Drift USDC user/account set rather than the zero-account dispatcher probe. At `100,000` raw USDC, the funded control succeeded first; the composed transaction was 821 bytes with 19 inline accounts, nine writable accounts, three instructions, one signature, and no ALT. Its trace was `FlashBorrowReserveLiquidity -> Drift withdraw -> FlashRepayReserveLiquidity`; the Drift leg failed at instruction 1 with fallback error `101` after 39,831 CU. Because the transaction failed, RPC correctly returned null post-account images and the runtime rolled the whole transaction back.

The following mutations all preserved the v1 envelope and failed at the first Drift dispatch point, before account parsing or value movement:

| Mutation | Result | CU / envelope |
|---|---|---|
| Alias Drift destination to its canonical USDC vault | fallback `101` at Drift | 39,611 CU; 821 B / 19 accounts / 3 ix |
| Reverse Drift remaining-account order | fallback `101` at Drift | 39,831 CU; 821 B / 19 accounts / 3 ix |
| Repay before Drift | KLend borrow and repay succeed, then fallback `101`; whole transaction rolls back | 61,457 CU |
| Drift before flash borrow | fallback `101`; KLend never invoked | 4,828 CU |
| Five repeated Drift deposit/withdraw legs between borrow and repay | first Drift deposit falls back | 51,901 CU; 1,122 B / 19 accounts / 12 ix |
| Native update prefix before / between / after flash pair | fallback at placements 0 / 1 / 2 | 2,634 / 37,212 / 58,838 CU; 688 B / 15 accounts |

This establishes a positive, current, value-moving funding control before every attempted target mutation. It also isolates the first blocker precisely: KLend can atomically provide the exact same USDC asset at dust through full-current-liquidity sizes, but the current Drift binary rejects the target selector before its account constraints, balance logic, or repayment interaction can execute. No unauthorized gain was observed; exploit value is `$0`.

## Dormant source control review

The following controls exist in the recovered source but are not currently reachable through the tested deployed selectors:

### Standard withdraw

`handle_withdraw` loads writable spot markets and oracles, updates interest, applies reduce-only bounds, updates spot balances, enforces initial-margin requirements and valid liability oracles, checks spot-margin rules, and only then performs the PDA-signed vault transfer (`programs/drift/src/instructions/user.rs:866-1035`). The account context binds `User` and `UserStats` to the signer authority, derives the spot vault from `market_index`, binds the Drift signer to `State.signer`, requires matching token mints, and uses the supplied token interface (`programs/drift/src/instructions/user.rs:4731-4760`).

No source-level public authority or destination-account substitution was found in this path. Current dispatch rejection supersedes deeper exploitability.

### Public LP swap

The dormant handler:

- rejects identical in/out market indexes;
- requires the LP-swap feature flag;
- requires AUM freshness;
- binds target/correlation data to the selected LP pool;
- loads the requested markets and validates both oracle states;
- calculates fees and enforces user slippage;
- caps output by the recorded Constituent vault balance;
- receives user input before making the PDA-signed output transfer;
- reloads and synchronizes both vault balances.

See `programs/drift/src/instructions/lp_pool.rs:238-518` and its account context at `programs/drift/src/instructions/lp_pool.rs:1850-1914`.

### LP redemption

The dormant remove-liquidity handler requires the mint/redeem feature, synchronizes DLP supply, enforces same-slot AMM settlement for nonzero cache rows, requires a current AUM slot, derives the output against supply/AUM, applies minimum-output slippage, sources any shortfall from the canonical program vault through accounting, receives and burns the user's DLP, and transfers the output from the Constituent vault with its PDA signer seeds (`programs/drift/src/instructions/lp_pool.rs:981-1213`). Its account context binds the authority-owned input/output accounts, LP mint and LP token vault, selected Constituent, spot vault, and AMM cache (`programs/drift/src/instructions/lp_pool.rs:2043-2112`).

No supply/AUM rounding or account-alias bypass survived the reachability gate.

### Privileged begin/end LP swap

The historical flash-style path is admin-wallet gated. The begin handler requires distinct markets and a nonzero amount, records pre-swap balances, transfers from the Constituent vault, scans the transaction instruction sysvar for a terminal Drift `EndLpSwap`, compares the signer token accounts, Constituent vaults, Constituent states, and LP pool between begin and end, restricts intermediate programs, and forbids later writable accounts. The end handler returns residual tokens, reloads vaults, synchronizes balances, and clears the flash state (`programs/drift/src/instructions/lp_admin.rs:624-903`).

This path is both privileged and absent from the current dispatcher. It is not a permissionless current exploit surface.

## Finding disposition

### Reportable immediate fund-risk findings

None.

The review did not convert the following observations into vulnerabilities:

- approximately $66.40k of state-referenced direct custody, because custody alone is not a broken control;
- the lack of current public exit entrypoints, because it establishes a present availability/upgrade dependency but not a permissionless attacker path;
- source-only LP or withdrawal concerns, because current ProgramData and simulation reject those selectors before the relevant code executes;
- signer-authorized dust accounts, because they are not canonical protocol custody;
- privileged LP rebalancing, because it requires the configured privileged wallet and the current selector is absent.

## Limitations and required follow-up

Coverage is partial in a precise sense:

1. The source commit and current ProgramData are not cryptographically mapped by a verified, reproducible build.
2. No local build or validator fork was produced after the host disk incident; the audit intentionally avoided recreating large build caches.
3. Because the current binary rejects every audited value-moving selector at dispatch, a positive current-binary value-moving control and deeper same-transaction mutation cannot be honestly claimed.
4. Failed `simulateTransaction` calls return null requested post-account images; rollback follows Solana transaction atomicity, while only successful controls support exact post-balance comparison.
5. USD values are indicative snapshot prices; raw token amounts and addresses are the authoritative custody evidence.

The highest-value follow-up is to obtain authenticated build inputs for ProgramData SHA-256 `54d61c27d5b433d0c316d06e4246803a5bbabb1b3930e2027992c33080c4b2b4`. If a later upgrade restores `withdraw`, `lp_pool_swap`, `lp_pool_remove_liquidity`, or `begin_lp_swap`/`end_lp_swap`, rerun the same positive-control, end-removal, and account-alias suite against that new ProgramData before making a safety claim.

## Bottom line

The current material Drift PDA custody is approximately $66.40k and is concentrated in the USDC and SOL DLP Constituent vaults. The currently deployed program does not expose the audited value-moving selectors, so no current permissionless drain path—and no valid positive current value-exit control—was demonstrated. The result is **no reportable immediate fund-risk exploit found, with a build/reachability-dependent validation gap explicitly preserved**.
