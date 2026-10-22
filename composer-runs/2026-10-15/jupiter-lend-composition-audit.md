# Jupiter Lend composition audit — current deployed binaries

**Audit date:** 2026-10-15  
**Network:** Solana mainnet-beta, with destructive/state-seeding tests confined to a local Surfpool mainnet fork  
**Target:** Jupiter Lend Liquidity and the Jupiter programs that can affect its custody or accounting  
**Finding status:** **No novel, reproducible security flaw with immediate fund-loss impact was found.**

## Executive outcome

This pass started with the highest verified Jupiter Lend custody PDAs and tested composition surfaces that were not closed by the two earlier reports. The tested current binaries rejected multi-borrow flashloan layouts, CPI-wrapped flashloan calls, malformed Vaults remaining-account partitions, foreign-but-valid oracle configurations, underfunded and duplicate claim execution, and nearly-zero Lending/Earn operations. Successful deposit/withdraw round trips rounded against the caller. Inserting a complete Flashloan pair before, around, or after a Vaults borrow produced the same final state as the Vaults-only control plus exactly the authorized borrow. A real atomic v1 transaction funded by a current-config, verified zero-fee KLend USDC flashloan also completed Jupiter Earn cycles at the dust threshold and at the reserve's exact accounted-available boundary without leaving the caller or either protocol with an unauthorized gain or unpaid balance.

The follow-up identified the live Vaults price path that actually terminates in Jupiter DEX state rather than assuming an external spot-price account. Eleven active vault/oracle paths use `DexSmartColPegOracle` or `DexSmartDebtPegOracle`. On one active smart-collateral path, an atomic v1 transaction used a verified zero-fee KLend flashloan to remove 88.748% of one DEX-side reserve, consumed the manipulated rate in `OperatePerfectDex`, reversed the swap, borrowed the minimum permitted USDC delta, and fully repaid. The consumer rate rose only 1.0557 bps; scoped token equity fell by $0.799486 and the permissionless Tick-account setup also cost 1,798,240 lamports. The manipulated position gained at most 139 raw USDC of incremental credit capacity, below the 1,000-raw minimum borrow delta.

The result is a negative finding, not a proof that the programs are vulnerability-free. Black-box binary tests can establish concrete behavior for the exercised paths but cannot exhaust every instruction, asset, state transition, or future deployment.

No transaction was submitted to mainnet. Mainnet interaction was limited to read-only RPC methods and `simulateTransaction`. The only deployed test program was a 27,120-byte pass-through caller deployed to the local Surfpool ledger, never to mainnet.

## Priority and value boundary

The custody census used verified Liquidity vault relationships rather than merely grouping token accounts by a shared authority. At slot **457,320,031**, it identified:

- **42** verified Jupiter Lend vaults;
- **32** vaults with an available price and **10** unpriced vaults;
- **$1,121,471,637.54** in priced gross custody.

This dollar figure is the gross value boundary examined, not a claim that the entire amount was exploitable. Prices came from the snapshot's DefiLlama price source and are only as current and complete as that snapshot.

The largest priced verified vaults were:

| Rank | Asset | Vault | Approximate snapshot value |
|---:|---|---|---:|
| 1 | JLP | `EJ6CLvJPJErjkUnPQicVahzw4Q4NHLfpDV9knoP7iqfK` | $329.23M |
| 2 | JUPSOL | `B8yLjTzygXWWb5cedEDVE913kEoupPu7ioQNqCbThcHq` | $272.44M |
| 3 | dfdvSOL | `EfyyprEwpyK6PWpph3dJTeBxxDHWSJ8Y9ZLz8qe2aFef` | $150.20M |
| 4 | sUSDai | `GzjLtjeaaFBerWrpJx8VXwpXcdzkUFm9zsXgaedsbXsW` | $73.05M |
| 5 | PST | `9Z9k8YgGBSu4TLMmmjo7S6uFnAwSHZTRYzgBnED7XUuy` | $68.68M |
| 6 | INF | `CvttupFaA4DGGBcRFN9YLgvtVJLJACPwJGeDopebNqNY` | $58.95M |
| 7 | SOL | `5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr` | $43.25M |
| 8 | USDC | `BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB` | $40.72M |

The USDC reserve/vault pair was selected for live cross-program ordering because both Flashloan and Vaults demonstrably reached the same mint, reserve, and token vault in successful mainnet controls.

## Deployment identity

The following upgradeable program data was read at finalized slots 457,342,445–457,342,452. Binary SHA-256 values identify the exact bytes tested or used as the current target reference.

| Component | Program | Deploy slot | Bytes | SHA-256 |
|---|---|---:|---:|---|
| Liquidity | `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` | 453,953,579 | 791,164 | `f7be679179291c719b204eb031cc134fe94a5299cd4bfdf705ba632863cffafe` |
| Vaults | `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi` | 449,989,995 | 2,187,996 | `2f2d6f759197ce02f27e4397a6674f18919bfb3c6704de19c308be6c8c415612` |
| Flashloan | `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` | 430,476,301 | 356,732 | `b9d57b914196fe34d7ec55b732d4f78d28f54e13d329141e7e0e7dac1c2b9c09` |
| Oracle | `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc` | 449,989,861 | 770,040 | `ec80153d65a1eb3893eda320bddcde0c942351ef93e0c9771d19c7a4f42d037a` |
| Lending/Earn | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` | 453,954,884 | 660,660 | `ff22d78619055ea05ebee369cab72f07656efb209974c2bbf2ce384afd91386c` |
| DEX | `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd` | 449,990,119 | 1,238,064 | `b259bef25bd37ce21a8bff502877a243d3e0663253523b5d4ceb447abde57646` |

All six program-data accounts reported upgrade authority `4MsgBB5VPoTrUSp5XnfbViV386C1UnsTdifLBw33ZMSJ`. Therefore, these conclusions are deployment-specific and must be revalidated after an upgrade.

## Earlier coverage treated as closed

The prior reports had already tested and rejected simple signer removal, instruction-sysvar substitution, missing and duplicate flashloan repayment, foreign vault/position/mint/destination substitution, malformed reserve/vault relationships, and representative dependency account-confusion attempts. This pass did not present those same mutations as new work. It concentrated on transaction composition, CPI reachability, partial claim semantics, rounding extraction, remaining-account partitioning, oracle binding, and a shared-reserve cross-program sequence.

## New test matrix and results

### 1. Flashloan transaction-introspection composition

The source was a successful current mainnet transaction at slot **457,333,656**, signature `4G9tPDpx1dcPpeZpb2MG5DyFLnZMuaUZgSpuSnXnXvrJDdUc4H5KeXfFG7XDbvjbhhZdDCctHof382JMUUStdWhp`, borrowing **12,397,467** base units. A direct borrow/payback replay succeeded at 75,711 compute units.

| Mutation | Result |
|---|---|
| two borrows, one payback | rejected with 6010 `FlashloanInvalidInstruction` |
| three borrows, one payback | rejected with 6010 |
| borrow, payback, second borrow | rejected with 6010 |
| payback before borrow | rejected with 6002 `FlashloanInvalidParams` |
| two distinct borrow amounts and two paybacks | rejected with 6010 |
| two borrows with only the first amount repaid | rejected with 6010 |
| two borrows with only the second amount repaid | rejected with 6010 |

These results close the tested shared-payback and multiple-borrow bypasses: the binary permits the valid single pair but rejects every tested attempt to make one repayment authorize more than one borrow.

### 2. CPI-wrapped Flashloan reachability

A minimal pass-through SBF program was deployed only to Surfpool at `3dUgRbXPp2NRiVLWry77hWTULfkUdYEQGELYNDJgh3X6`. Its binary SHA-256 was `eab8cc2c89c79ef0e92460f625d9b7ad7fc0c6de69f0f1444d4e4355cab799d1` and its size was 27,120 bytes. The current Flashloan and Liquidity programs were cloned from mainnet into the fork.

- Direct Flashloan borrow/payback control on the fork succeeded at 97,311 compute units.
- CPI borrow followed by direct payback failed at CPI depth 2 with 6002 `FlashloanInvalidParams`.
- CPI borrow alone failed with 6002.
- CPI payback alone failed with 6002.

The test establishes that this ordinary CPI wrapper cannot reach either value-moving Flashloan path. It does not source-prove which internal predicate produced 6002, so it should not be generalized to every conceivable runtime invocation mechanism without retesting.

### 3. Lending/Earn rounding and sequence extraction

The source was a successful USDC transaction at slot **457,341,502**, signature `znj3zX8BnVXSgwUCQdQxWqxUpb4sgWbhdGnhKcamymzbPzzN41oNQUVqtHApoTiAZsTMovX3MxCpZVUMBEe1qLH`. Balance deltas are caller token-account deltas returned by mainnet simulation.

| Sequence | Underlying delta | fToken delta | Result |
|---|---:|---:|---|
| deposit 1,000 | -1,000 | +938 | success |
| withdraw 1,000 | +1,000 | -940 | success |
| deposit then withdraw 1,000 | 0 | -2 | success; caller loses shares |
| deposit, update rate, withdraw 1,000 | 0 | -2 | success; caller loses shares |
| withdraw then deposit 1,000 | 0 | -2 | success; caller loses shares |
| two deposits, withdraw 2,000 | 0 | -3 | success; caller loses shares |
| two 1,000-unit round trips | 0 | -4 | success; loss compounds |
| deposit 1, withdraw 1 | — | — | rejected with 6030 `OperateAmountsNearlyZero` |
| deposit 1,000, redeem 1,000 shares | +64 | -62 | success; gain in underlying requires net burn of pre-existing shares |

No tested ordering created underlying without consuming equivalent user value. The repeated paths consistently rounded against the caller, not against the pool.

### 4. Vaults remaining-account partition and oracle substitution

A current successful borrow was used as the positive control. The instruction carries dynamic remaining-account counts, so the tests changed both the count header and the account identities.

| Mutation | Result |
|---|---|
| count overrun `[2,1,2]` | rejected with 6050 `VaultLiquidateRemainingAccountsTooShort` |
| extreme count `[255,0,0]` | rejected with 6050 |
| reclassify accounts with `[1,2,1]` | rejected with Anchor discriminator mismatch 3002 |
| omit oracle partition with `[0,1,2]` | rejected with discriminator mismatch 3002 |
| use a branch account as oracle source | rejected with Oracle 6005 `InvalidSource` |
| use an oracle source as branch | rejected with 6047 `VaultBranchOwnerNotValid` |
| use tick-debt account as oracle source | rejected with 6048 `VaultTickHasDebtOwnerNotValid` |
| substitute a valid oracle configuration from another real vault | rejected with 6042 `VaultInvalidOracle` |
| substitute that foreign oracle plus its valid source accounts | rejected with 6042 |

Count `[1,1,1]` succeeded while leaving one source-supplied account unused. That is a path-dependent ignored extra account, not an observed value-impacting reinterpretation. The apparent duplicate/swap tick-debt successes were also not independent bypasses: the source transaction already supplied the same tick-debt public key in both positions.

### 5. Claim accounting, partial liquidity, duplicate claim, and close

The reachable control was derived from a USDT borrow at slot **457,329,996** with claim amount **2,210,643,807** base units. Tests ran against the current Liquidity binary on Surfpool.

- `InitClaimAccount` plus claim-mode `Operate` created a user claim and increased the reserve's `total_claim` by exactly 2,210,643,807 without transferring to the recipient.
- A subsequent full `Claim` transferred exactly 2,210,643,807 and zeroed both the user claim and reserve liability.
- Full claim followed by close succeeded.
- Lowering the fork vault balance below the requested borrow before claim creation caused `Operate` to reject with 6013 `InsufficientBalance`; that tested route could not create an already-underfunded liability.

Additional seeded-state tests exercised handler behavior but **do not establish attacker reachability**:

| Seeded state | Result |
|---|---|
| claim 1,000,000; reserve liability 1,000,000; vault 1,000,007 | exact transfer; both liabilities zeroed |
| same claim/liability; vault only 500,000 | SPL Token insufficient-funds error; transaction failed atomically |
| claim twice in one transaction | second call rejected with 6020 `NoAmountToClaim`; transaction rolled back |
| close a nonzero claim | rejected with 6021 `AmountNotZero` |
| user claim 1,000,000 but reserve liability 500,000 | rejected with 6000 math error before transfer |

A fresh finalized census at slot **457,344,871** found **261** `UserClaim` accounts and **47** `TokenReserve` accounts, with no nonzero user claim and no nonzero reserve `total_claim`. Thus the tested all-or-nothing liveness edge was not active in the observed mainnet state.

### 6. Flashloan + Vaults + Liquidity shared-reserve ordering

The programs converged on the same current USDC objects:

- mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`;
- Liquidity reserve: `94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu`;
- custody vault: `BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB`.

Every mainnet simulation succeeded:

- Flashloan borrow + payback control;
- Vaults borrow control for 1,000 base units;
- Flashloan borrow → Vaults borrow → Flashloan payback;
- Vaults borrow → complete Flashloan pair;
- complete Flashloan pair → Vaults borrow.

The simulation RPC's separately fetched pre-state was not bank-pinned and therefore was not used for the accounting conclusion. The returned **post-states** are directly comparable:

| Case | shared vault | Flashloan recipient | Vaults recipient |
|---|---:|---:|---:|
| Flashloan-only control | 33,693,229,147,085 | 19,083,743 | 100 |
| Vaults-only control | 33,693,229,146,085 | 19,083,743 | 1,100 |
| each of the three combined orderings | 33,693,229,146,085 | 19,083,743 | 1,100 |

Relative to the Flashloan-only control, the Vaults control and every combined ordering debit the shared vault by exactly 1,000 and credit only the Vaults recipient by exactly 1,000. The complete Flashloan pair contributes zero residual debit or recipient credit in every tested placement. No stale shared-reserve accounting, double debit, or repayment bypass was observed.

A second attempt to reproduce the Vaults ordering on the long-running local fork encountered an Oracle `LibraryMathError` from stale fork-time data and is retained only as diagnostic evidence. It was not used to support the conclusion above.

### 7. Current-config zero-fee KLend → Jupiter Earn v1 extremes

This matrix used a real atomic Solana v1 message: no address lookup tables, at most 64 inline addresses, a 4,096-byte wire limit, a 1,400,000 compute-unit request, and a 64 MiB loaded-account-data limit. The simulations used `sigVerify: false` and were never signed or submitted.

The funding reserve was KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, with token supply account `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB` and fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`. At slot **457,348,144** its decoded configuration and balances were:

- token-account supply: **7,868,315,654,093** raw USDC;
- reserve-accounted available liquidity: **7,868,315,584,088** raw USDC;
- decoded `flash_loan_fee_sf`: **0**.

The zero fee is therefore an actual current reserve configuration, not a nonzero fee rounded down on a small borrow. No zero-fee assumption is made for any other KLend reserve.

The cross-program instruction sequence was:

1. KLend `FlashBorrowReserveLiquidity` to the real Jupiter Earn user's USDC account;
2. Jupiter Earn `Deposit` of the same amount;
3. Jupiter Earn `Withdraw` of the same amount;
4. KLend indexed `FlashRepayReserveLiquidity` of the full principal.

The exact accounted-available cycle succeeded for **7,868,315,584,088** raw USDC (approximately $7.868M at par) in a **1,054-byte** v1 wire with **25** inline accounts, **4** top-level instructions, one required signature slot, **146,831** compute units, and 12,168,680 bytes of loaded account data. The same-slot post-state comparison was:

| Account/state | Flash pair control | Flash + Jupiter cycle | Difference |
|---|---:|---:|---:|
| caller USDC | 1,109,081 | 1,109,081 | 0 |
| caller fToken | 469,684,654 | 469,684,652 | -2 |
| Jupiter underlying vault | 33,671,568,501,446 | 33,671,568,501,446 | 0 |
| KLend flash supply | 7,868,315,654,093 | 7,868,315,654,093 | 0 |
| KLend fee vault | 0 | 0 | 0 |
| fToken mint supply | 453,407,896,588,634 | 453,407,896,588,632 | -2 |
| KLend accounted available | 7,868,315,584,088 | 7,868,315,584,088 | 0 |

KLend flashloans do not create a borrower obligation/debt account. Complete repayment is demonstrated by the successful indexed repay, unchanged flash supply, unchanged accounted available liquidity, and unchanged fee vault. Jupiter's exact-amount deposit/withdraw burned two caller shares and two units of fToken supply while returning the underlying balance exactly; it did not create value for the caller.

Boundary results:

| Stress case | Result |
|---|---|
| KLend flash borrow/repay of 1 raw USDC | success, 531 bytes, 11 accounts, 55,219 CU |
| Jupiter cycle at 1–9 raw USDC | rejected with 6030 `OperateAmountsNearlyZero` |
| Jupiter cycle at 10 raw USDC | success; exact observed lower threshold |
| cycle at reserve accounted available - 1 | success |
| cycle at exact reserve accounted available | success |
| flash borrow at accounted available + 1 | rejected with KLend 6008 `InsufficientLiquidity` |
| full token-account supply, supply + 1, and `u64::MAX` | rejected with 6008 because accounted available was lower |

Rate-update placement before the flash borrow, between deposit and withdraw, and after withdraw all succeeded and preserved the same conservative two-share loss. Two through six repeated $1 deposit/withdraw legs also completed with full flash repayment. Six rounds fit in **1,429 bytes**, **25 accounts**, **14 top-level instructions**, and **614,205 compute units**; the caller and mint each lost 12 fToken units, while caller USDC, KLend supply, fee vault, and reserve-accounted availability were restored. Seven rounds used only 1,504 bytes and 25 accounts but failed at instruction index 14 with `MaxInstructionTraceLengthExceeded`. Thus the first concrete repetition ceiling was the runtime instruction-trace limit, not the v1 byte, account, loaded-data, or compute limit.

Ordering and alias checks remained conservative:

- withdraw-before-deposit completed but still burned two caller shares;
- an outsider attempting to withdraw the owner's fTokens failed `ConstraintTokenOwner` 2015;
- aliasing the Jupiter deposit source to the protocol underlying vault failed `ConstraintTokenOwner` 2015 before state change.

Project 0 was also exercised in the same real v1 format. Its current borrow/repay control succeeded in 671 bytes and 14 accounts; 1 raw unit was rejected with 6040 `IllegalBalanceState`, 2 raw units succeeded, and a 90%-of-vault control at 10,087,725,485,828 raw units succeeded. Near-total utilization was rejected with 6026 `IllegalUtilizationRatio`. Independent Project 0 and Jupiter Vault borrow legs composed successfully, but directing Project 0's borrowed token account into the Jupiter Vault supply leg was blocked by `ConstraintTokenOwner` 2015 before state change; transfer-owner variants either left repayment short or hit `VaultInvalidOperateAmount` 6009. The live KLend route above is the stronger same-account, same-mint funding proof because the borrowed USDC actually traversed Jupiter Earn and returned for full repayment.

### 8. Zero-fee KLend → Jupiter DEX peg → Vaults consumer → unwind

The current price-input census at slot **457,355,431** found **107** VaultConfig accounts, **104** Oracle accounts, and **14** `DexPegOracleConfig` accounts. The live joins were:

- **11** VaultConfig → Oracle → DEX-peg paths, all with at least one position;
- **11** distinct Jupiter DEX pools;
- **9** `DexSmartColPegOracle` paths and **2** `DexSmartDebtPegOracle` paths;
- **431** positions across those vaults, including **112** borrowing positions.

For vault 98, the exact current path was:

`Vaults OperatePerfectDex` → Oracle `GetBothExchangeRate` → `DexSmartColPegOracle` config `422W6h…` → DEX `4XGHBk…` → DEX Liquidity supply positions `8kJRta…` / `7WH7pp…` and token reserves `8QaoQw…` / `94vK29…`.

This is a pool-NAV/share-rate path, not a raw constant-product spot-price read. A swap changes the DEX's Liquidity positions and therefore can reach the Oracle in the same transaction, but the returned smart-collateral rate moved far less than the transient reserve imbalance.

The tested signer owned the position NFT and both swap token accounts. `sigVerify: false` models that one legitimate user signature; no admin, keeper, protocol signer, CPI wrapper, or nonsigner protocol-account substitution was used. Thus the surface is available to an ordinary user with their own position, but the simulation does not claim that an outsider can mutate someone else's position.

The thin boundary used a zero-fee KLend USDC flash pair around `SwapOut → OperatePerfectDex → reverse SwapIn → GetBothExchangeRate → FlashRepay`. Exact output **999** raw token0 was rejected with DEX 6060 `DexLimitingAmountsSwapAndNonPerfect`; **1,000** raw token0 was the exact first passing tested value. The 1,000-raw case completed in **2,120 bytes**, **51** inline accounts, and **6** top-level instructions, fully restored KLend, and reduced scoped caller equity by **105 raw USDC**.

The large control requested **4,000,000,000** raw token0 against a starting DEX Liquidity position of **4,507,137,506** raw, or **88.748124%** of that side. A second variant also initialized the required next Vault tick accounts permissionlessly and borrowed the minimum accepted **1,000 raw USDC** from the live position. Its exact sequence fit in a **2,232-byte** v1 wire with **53** inline accounts, **8** top-level instructions, one required signer, and **592,659** compute units:

1. borrow **1,000,000,000,000** raw USDC from the zero-fee KLend reserve;
2. initialize the calculated final Tick and TickIdLiquidation accounts;
3. execute USDC → token0 `SwapOut` for 4,000,000,000 raw token0;
4. call `OperatePerfectDex`, depositing 1,000,000 perfect shares and borrowing 1,000 raw USDC;
5. reverse with token0 → USDC `SwapIn` for the exact token0 amount;
6. read the post-unwind oracle rate and repay the complete KLend principal.

The same-transaction rate observations were:

| Point | Oracle rate, 1e15 scale | Change from atomic pre-rate |
|---|---:|---:|
| before forward swap | 2,001,802,788,097,201 | — |
| consumed inside Vaults at maximum imbalance | 2,002,014,108,967,744 | +1.055653 bps |
| after reverse swap | 2,001,885,800,884,830 | +0.414690 bps |

The residual increase is consistent with value left in the pool by the lossy round trip; it is not a free transient rate that disappears after unwind. At the manipulated rate, the tested position's **13,197,560 raw-USDC** collateral value increased by **1,393 raw USDC**. With vault 98's stored 10% collateral factor, that adds at most **139 raw USDC** of borrowing capacity—below the binary's **1,000-raw** minimum accepted borrow delta.

Full scoped equity counted the user's token0 at the configured 1:1 peg, USDC, Vault position collateral at the observed Oracle rate, position debt, and native lamports as a separate asset. The no-borrow consumer variant lost **799,564 raw USDC**. The minimum-borrow variant lost **799,486 raw USDC** after counting the 1,000 raw USDC received and the increased position debt, plus **1,798,240 lamports** paid to create the two protocol-owned Tick accounts. A signed network fee was not charged by simulation and would only worsen the live outcome. In the latter case, KLend's supply account returned exactly to its pre-state balance and its fee vault remained zero. The unmanipulated minimum-borrow control also succeeded and lost 26 raw USDC plus the same Tick-account rent, so the 1,000-raw borrow was not enabled by the manipulation.

This tested path therefore demonstrated real atomic price-state reachability but no outsider-accessible unauthorized net gain. The user's cost exceeded the maximum added credit by more than three orders of magnitude, the borrow quantum prevented consuming even that small capacity increase on this position, and full flash repayment left the caller poorer.

## Security conclusion

No tested hypothesis produced unauthorized token transfer, liability reduction without payment, excess share minting, duplicate claim payment, foreign-oracle acceptance, or a residual Flashloan debit. Accordingly, there is no reportable novel immediate-fund-risk vulnerability from this pass.

No unauthorized net gain remained after complete repayment in any successful funded control, so the drain criterion was not met and no drain action was called.

The strongest affirmative observations are:

1. Flashloan instruction introspection constrained the transaction to one valid top-level borrow/payback pair in all tested layouts.
2. A normal CPI wrapper could not reach the Flashloan value-moving handlers.
3. Lending/Earn round trips were conservative and user-adverse at the tested boundary amounts.
4. Vaults bound oracle configuration to the intended vault even when supplied a structurally valid foreign oracle and its real sources.
5. Claim payment was full-or-fail, with liability checks and atomic rollback on duplicate or underfunded execution.
6. Flashloan/Vaults composition against a shared USDC reserve produced exactly the single authorized Vaults borrow and no additional value movement.
7. A zero-fee KLend USDC flashloan composed through Jupiter Earn from 1 raw unit up to the reserve's exact accounted-available limit; every successful case fully repaid, and Jupiter rounding only burned caller shares.
8. A real Jupiter DEX smart-collateral rate could be moved and consumed atomically, but removing 88.748% of one reserve shifted the rate only 1.0557 bps; after swap unwind, minimum Vault borrow, and complete flash repayment, the caller lost 799,486 raw USDC plus 1,798,240 lamports of Tick-account rent.

## Residual limitations and next useful work

- This was dynamic black-box testing of deployed binaries, not a source-level proof or formal verification.
- Representative live paths used USDC and USDT. The 42 verified vaults include different token programs, oracle sources, decimals, and asset behaviors that were not all replayed.
- The DEX-peg census covered all 11 current VaultConfig joins, but the flash-funded extreme replay covered one active smart-collateral pool and one position. The other eight smart-collateral and two smart-debt paths may have different reserve depth, conversion sources, buffers, collateral factors, or economic response.
- Seeded claim states prove handler behavior only; they do not prove an attacker can create those states.
- The account census is a point-in-time observation. Claims, vault balances, configuration, and program binaries can change after the cited slots.
- Ten verified custody vaults were unpriced, so the $1.121B figure is a priced lower boundary rather than total custody.
- Revalidation should be triggered by any program-data deploy-slot or binary-hash change. The highest-value follow-up would be a systematic per-asset replay matrix across Token and Token-2022 mints, especially assets with transfer extensions or unusual oracle adapters.

## Reproduction artifacts

All paths below are relative to `composer-runs/2026-10-15/`.

- `jupiter-current-deployments.py` / `.json` — finalized program-data identities and hashes.
- `jupiter-current-claims.py` / `.json` — finalized user-claim and reserve-liability census.
- `jupiter-flashloan-composition.py` / `.json` — mainnet Flashloan instruction-layout simulations.
- `jupiter-flashloan-cpi-surfpool.py` / `.json` — local CPI reachability tests.
- `flashloan-cpi-caller/` — minimal local-only pass-through caller source and SBF artifact.
- `jupiter-lending-composition.py` / `.json` — Lending/Earn sequence and rounding tests.
- `jupiter-vaults-remaining-accounts.js` / `.json` — remaining-account and oracle-binding mutations.
- `jupiter-partial-claim-surfpool.py` / `.json` — reachable and explicitly marked synthetic claim tests.
- `jupiter-flash-vault-ordering.js` / `.json` — mainnet shared-reserve ordering simulations.
- `jupiter-flash-vault-ordering-surfpool.json` — discarded stale-fork diagnostic, retained for transparency.
- `klend-jupiter-v1-extremes.js` / `.json` — current-config zero-fee KLend funding, real v1 wire boundaries, full pre/post accounting, repetition limits, update ordering, and alias tests.
- `project0-v1-composition.js` / `.json` — Project 0 v1 amount extremes, Jupiter Vault composition, ownership barriers, and full-repayment controls.
- `jupiter-dex-peg-path-census.js` / `.json` — current Oracle/VaultConfig/DEX-peg joins and per-path position counts.
- `jupiter-dex-peg-klend-v1.js` / `.json` — thin boundary, 88.748%-reserve atomic manipulation, real Vault state consumer and borrow, v1 sizing, Oracle pre/manipulated/post rates, full flash restoration, and scoped pre/post equity.

The earlier baseline reports remain at:

- `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/jupiter-lend-security-scan.md`
- `/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/jupiter-lend-dependent-programs-followup.md`

