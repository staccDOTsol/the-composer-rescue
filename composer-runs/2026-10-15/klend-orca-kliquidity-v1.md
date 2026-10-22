# Zero-fee KLend flash through Orca and Kamino Liquidity

Read-only simulation on a local Surfpool fork of mainnet, observed 2026-10-15 19:17–19:21 UTC at fork slots 457350078–457350664. No transaction was submitted to mainnet. The tests use the current KLend, Orca Whirlpool, and Kamino Liquidity account and program state imported from mainnet by Surfpool. The virtual borrower is `ES2ncXxvrpW8eTa74cjCask9uX6Vg59pbo9KPQpDBDbT`; simulations use `sigVerify:false`. Its own WSOL account was seeded in the fork with the amounts reported below. This is a funded control, not proof that an unfunded outsider can transact.

The KLend WSOL reserve `4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM` has an on-chain `flash_loan_fee_sf` of exactly zero. The flash borrow and repay instruction layouts were taken from a real KLend transaction and adapted to the live reserve, market, vault, borrower, and instruction index. Every successful complete test below repaid the exact borrowed WSOL and left both the KLend supply vault and flash fee vault with zero net change.

## Extended tick-array path: SOL/WIF pool

The Orca pool `D6NdKrKNQPmRZCCnG1GqXtF7MMoHB7qR6GU5TkG59Qz1` backs Kamino strategy `H8h7ZyS5qJR2cwLxvZQdPaNzLik17cRxB5pDvjdXeuBg`. A single legacy Orca swap over 200 SOL fails `TickArraySequenceInvalidIndex` 6038 because it can traverse only the three supplied tick arrays. The deployed legacy swap interface does not accept supplemental arrays. A real eight-swap sequence re-indexes each subsequent tick-array triple from the tick reached by the preceding swap.

| Step | Result |
| --- | ---: |
| Borrow | 200 SOL, exact-zero flash fee |
| Forward swaps | Four 50 SOL swaps; ticks −6470 → −6876 → −7292 → −7780 → −8390 |
| Consumer | Kamino `collectFeesAndRewards` between forward and reverse swaps |
| Reverse swaps | Four WIF swaps; ticks −8390 → −7733 → −7254 → −6850 → −6470 |
| Repay | 200 SOL |
| Serialized v1 message | 2,165 bytes; 46 inline addresses; 749,876 compute units |
| Borrower net | −153,418,767 lamports; 0 WIF |

The fork seeded 201 SOL in the borrower's own WSOL account for this case. WSOL net deltas in raw units were borrower −153,418,767, Orca pool +104,957,218, Kamino strategy vault +42,403,855, Kamino treasury +6,057,694: sum zero. WIF net deltas were borrower 0, pool −867,559, strategy +759,114, treasury +108,445: sum zero. The strategy fee collection is authorized by the current program; no outsider gain occurred.

Kamino's WIF strategy has `depositCapUsd = 0` at the fork slot. Its sub-basis-point swap attempts followed by deposit fail `CollateralTokensExceedDepositCap` 6041. Larger moves fail the price guard `OrcaPriceTooDifferentFromScope` 6059 before reaching that cap. This strategy therefore does not provide a currently funded deposit baseline.

## Positive deposit control: SOL/USDC pool

The separate Orca pool `FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q` backs deposit-enabled Kamino strategy `5EfeGn1h7m6Rx9mGEmamDoxMtdhRmUh2N9fYRiDQqteS`, with nonzero deposit cap and a 10 bps configured deviation guard. The local fork seeded 3 SOL into the borrower's own WSOL account. A complete 1 SOL flash transaction swapped 0.1 SOL into USDC, deposited the resulting assets, withdrew all newly minted shares, reversed all remaining USDC through the same pool, and repaid the flash. It succeeded in 1,825 v1 bytes, 44 inline accounts, and about 597,500 compute units. The deposit minted 7,961,210 raw shares; withdrawal burned them all. Final borrower balances changed by **−226,280 lamports, zero USDC, zero shares**. The pool tick returned to −22444.

Raw complete-transaction deltas, 0.1 SOL control:

| Holder | WSOL lamports | USDC micro-units |
| --- | ---: | ---: |
| Borrower | −226,280 | 0 |
| Orca pool vault | −76,954,870 | −10,606,693 |
| Kamino strategy vault | +77,104,032 | +10,596,094 |
| Kamino treasury | +77,118 | +10,599 |
| KLend supply and fee vaults | 0 | 0 |
| **Total** | **0** | **0** |

A 0.01 SOL swap also completed with −22,686 lamports, zero USDC, zero shares. A 1 SOL swap immediately before deposit succeeded as an Orca operation, but Kamino deposit failed its `OrcaPriceTooDifferentFromScope` 6059 guard. A one-asset deposit with no USDC fails `NotEnoughTokensForRatio` 6116, as expected.

## Deposit before manipulating the pool

To test the alternate instruction order, a 10 SOL zero-fee flash and a 20 SOL disclosed borrower bankroll acquired USDC with an initial 0.1 SOL swap, deposited into Kamino at that price, then made a second Orca swap, withdrew the newly minted shares while the pool was displaced, reversed all remaining USDC, and repaid. All seven complete v1 cases succeeded with zero residual USDC and shares and negative WSOL net:

| Second swap SOL | Borrower net lamports |
| ---: | ---: |
| 0.01 | −230,288 |
| 0.1 | −266,274 |
| 0.5 | −426,221 |
| 1 | −626,116 |
| 2 | −1,025,814 |
| 5 | −2,223,985 |
| 10 | −4,217,941 |

Each complete transaction was 1,882 v1 bytes and approximately 628,500–629,500 compute units, under the 4,096-byte v1 cap and configured 1.4 million compute-unit limit. The successful displaced withdrawal alone is not a drain: the full atomic unwind loses WSOL after shares are burned and the flash loan is repaid.

## Two flash lenders fund both deposit assets

The current KLend binary rejects a second KLend flash borrow from a distinct USDC reserve with `MultipleFlashBorrows` 6035. The rejected trace is in `klend-orca-kliquidity-dual-flash-v1.json`. A separate Project 0 USDC flash **does** compose with a KLend WSOL flash in one v1 transaction. This was independently repeated after restarting the fork to refresh a cached Scope price; the final observations are at slots 457353737–457353739 on 2026-10-15 19:26 UTC. A stale fork had temporarily produced `PriceTooOld` 6031, so the fresh-fork result is the relevant current-state control.

The complete path uses the Project 0 bank `2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB` and its existing marginfi account, a 10,000 USDC Project 0 flash, and a 100 SOL exact-zero-rate KLend flash. Project 0's borrower transfers USDC to the Kamino depositor. The depositor puts approximately 50 SOL and 6,881.183016 USDC into the deposit-enabled SOL/USDC Kamino strategy at the initial pool price, then moves the Orca pool, withdraws all 5,165,688,215 newly minted raw shares, returns 10,000 USDC to the Project 0 borrower, repays Project 0, reverses the residual USDC on Orca, repays KLend, and ends the Project 0 flash. The final fork seeded only 1 SOL into the Kamino depositor's own WSOL account and **zero USDC**; the quoted deposit and price movement were funded by the two flashes. A separate quote phase seeded temporary borrower-owned balances solely to learn the exact share mint and reverse-swap amounts, then reset them before each final simulation.

| Orca displacement | v1 bytes | Inline accounts | CU | Depositor net WSOL |
| ---: | ---: | ---: | ---: | ---: |
| 0.1 SOL | 2,306 | 53 | 735,400 | −120,179,556 lamports |
| 1 SOL | 2,306 | 53 | 734,592 | −120,525,085 lamports |
| 10 SOL | 2,306 | 53 | 736,125 | −123,976,820 lamports |
| 50 SOL | 2,242 | 51 | 839,457 | −139,235,195 lamports |

Every complete case had two virtual signature slots, 14 top-level instructions, **zero net USDC and zero net shares** for the Kamino depositor, unchanged Project 0 borrower USDC and lender-vault balances, unchanged KLend supply/fee vault balances and reserve-accounted available liquidity, and zero net share supply. The selected Project 0 bank balance was inactive in the source marginfi account both before and after; total bank asset and liability shares were unchanged. The bank's share values and accrued group fees changed with the local Clock, so its overall account hash is expected to change without leaving a flash debt.

For the 50 SOL case, WSOL raw deltas were depositor −139,235,195, Orca vault −44,156,222,971, Kamino vault +44,241,413,288, treasury +54,044,878: sum zero. USDC micro-unit deltas were depositor 0, Project 0 borrower and lender vault 0, Orca vault −6,095,126,046, Kamino vault +6,088,666,296, treasury +6,459,750: sum zero. The larger depositor also lost value after the complete atomic unwind. The Project 0 bank account in this reproduction belongs to a different on-curve authority than the Kamino depositor. `sigVerify:false` proves execution with both signer roles present; it does not establish that a single outsider possesses those two particular keys. An attacker-controlled Project 0 marginfi account would need its own successful funding control before making any outsider claim. The fork locally initialized the depositor's USDC associated token account at a zero balance before the final simulation, so the included idempotent ATA-create instruction took its already-created path; first-time ATA creation was not separately measured.

## Reproduction and limits

Run fixture capture using `./node_modules/.bin/tsx scripts/klend-orca-kliquidity-fixtures.ts` inside `kliquidity-sdk-official`, then run `node composer-runs/2026-10-15/klend-orca-kliquidity-v1.js` from the workspace root for the WIF matrix. Run `KLIQ_DEPOSIT_CONTROL=1 KLIQ_STRATEGY=5EfeGn1h7m6Rx9mGEmamDoxMtdhRmUh2N9fYRiDQqteS node composer-runs/2026-10-15/klend-orca-kliquidity-v1.js` for the USDC matrix. These scripts only call `simulateTransaction` and local Surfpool `surfnet_setAccount` for borrower-owned WSOL bankroll, and never call mainnet `sendTransaction`.

Machine-readable evidence is in `klend-orca-kliquidity-v1.json`, `klend-kliquidity-deposit-control-5EfeGn1h7m6Rx9mGEmamDoxMtdhRmUh2N9fYRiDQqteS.json`, and `klend-project0-orca-kliquidity-v1.json`. Run the Project 0 combination with `KLIQ_PROJECT0_COMPOSE=1 KLIQ_STRATEGY=5EfeGn1h7m6Rx9mGEmamDoxMtdhRmUh2N9fYRiDQqteS node composer-runs/2026-10-15/klend-orca-kliquidity-v1.js`. Successful simulation is tied to the observed fork state and is not a proof for later state or other strategies. No permissionless unauthorized drain was validated in these tested compositions.
