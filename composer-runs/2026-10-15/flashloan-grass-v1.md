# Same-asset GRASS flashloan composition on current mainnet binaries

Observed 2026-10-15 at confirmed simulation slots 457348519–457349989. All transactions below were **read-only `simulateTransaction` calls**. The harness made no signature and submitted no live transaction. `sigVerify: false` models the legitimate GRASS claimant's signature; it does not give that key to an attacker. No unauthorized GRASS extraction was demonstrated.

## Funding source and exact v1 transaction

- The Project 0 `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` Bank lookup at mint field offset 8 returned **no GRASS Bank** at slot 457347491. Thus Project 0 cannot supply this same-asset GRASS flash loan in the observed state.
- Kamino Lend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` has GRASS Reserve `edvzA1zGyCWqsgM2EBEPhLgn9dfiqrYwJM4VwLg4wBx`, active status 0 and emergency mode 0. Its decoded, live `config.fees.flash_loan_fee_sf` was **exactly zero**, rather than a positive rate that happened to round to zero. At slot 457347572, its supply vault held exactly **1,892,492,987,128 raw GRASS**; the fee vault held zero. The reserve's `total_available_amount` matched that supply balance and its `borrowed_amount_sf` was zero.
- The composed target is an actual matured `Withdraw` on `EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc`, using a current pending request on user state `3q5npT5PAsivpj1KPCK6sfazGiUgEKLQdcYgMaQAuuK7`. Its authorized signer is `GYWTJ88vpxGh8WZRygxUByH39ufi34RNuB3nRKPVQjUD`; the existing destination token account belongs to that signer. Request 0 held exactly **33,000,006,416,685 raw GRASS** and had matured. The harness copied the current successful same-pool Withdraw instruction from signature `2p1huVXX3pS2Dq5ShaZP25M5J7dcAhg5HPMEPu4gFvEXUJJANM2piZZ6vF8RmmJtkj4xyoNwar3RXAnrzBHAS1xa`, then substituted the live claimant state, token destination, and signer. The original recent exit `vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v` independently established the target instruction shape; replaying that old claimant now returns `InvalidWithdrawalAmount` 6050 because its pending amount is zero.
- The harness encoded **real Solana v1 wire transactions**, with version byte `0x81`, no lookup tables, explicit config mask `0x0c`, compute limit 1,400,000, and loaded-account data limit 64 MiB. The mainnet RPC accepted and executed them. The ordinary `flash borrow → Withdraw → flash repay` transaction was 808 bytes. To exercise the actual v1 ceiling, the harness inserted a 3,252-byte Memo between borrow and Withdraw. That **4,096-byte** transaction had 18 inline addresses, 2 modeled signatures, 4 instructions, consumed 1,216,883 CU and loaded 11,161,607 account-data bytes. It succeeded at slot 457349989. The Memo only fills the wire envelope and has no effect on financial state.

## Exact accounting from same-slot preimages and simulation postimages

For the successful 4,096-byte composition, the preimage and simulation postimage were both at slot **457349989**:

| Account or state | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Kamino GRASS supply vault | 1,892,492,987,128 | 1,892,492,987,128 | 0 |
| Kamino GRASS fee vault | 0 | 0 | 0 |
| Claimant GRASS destination | 0 | 33,000,006,416,685 | +33,000,006,416,685 |
| GRASS staking vault `GBSdbtzKg6A1a9HM99AvCUWpzXbDq4hbgAX5Q48N7VRK` | 11,551,187,227,313,213 | 11,518,187,220,896,528 | −33,000,006,416,685 |
| Kamino Reserve `total_available_amount` | 1,892,492,987,128 | 1,892,492,987,128 | 0 |
| Kamino Reserve `borrowed_amount_sf` | 0 | 0 | 0 |
| Kamino Reserve `collateral.mint_total_supply` | 1,892,492,987,128 | 1,892,492,987,128 | 0 |
| Kamino collateral share Mint supply | 1,892,492,987,128 | 1,892,492,987,128 | 0 |
| Kamino Reserve accumulated protocol/referrer/pending fees (each, scale-factor units) | 0 | 0 | 0 |
| Kamino cumulative borrow-rate big-fraction words | `[1152921504606846976,0,0,0]` | `[1152921504606846976,0,0,0]` | 0 |
| Claimant pending Withdraw request 0 | 33,000,006,416,685 | 0 | −33,000,006,416,685 |

The successful direct Withdraw control produced the **same** claimant increase, staking-vault decrease, and request clearing. It needed the claimant signature and already-matured request. The flashloan changed neither the target payout nor Kamino principal, fee balance, debt, fees, cumulative borrow rate, or collateral share supply. The Reserve account byte hash changed only at offsets 16–17, 24–25, and 28–29, inside `last_update`: its slot advanced from 457342045 to 457349989, `stale` changed 0→1, `price_status` changed 63→0, and timestamp advanced. All other Reserve bytes matched the preimage. The Reserve IDL has no separate stored collateral exchange-rate field; the observed available liquidity, debt, fees, and both share-supply measures were unchanged. The 1-raw borrow, near-available borrow (**1,892,492,987,127** raw), and full-available borrow (**1,892,492,987,128** raw) all repaid in full with identical net lender accounting.

## Boundary and adversarial cases

| Case | Current-binary result |
| --- | --- |
| Borrow 0, 1, 2, 1,000, near-available, or full-available raw units; repay the same amount | Succeeded; lender supply, fee, available, debt, and collateral share supply returned exactly to baseline. Zero-amount borrow was accepted but transferred nothing. |
| Borrow available + 1 raw unit | Rejected at borrow: `InsufficientLiquidity` 6008. |
| Borrow → Withdraw → repay; Withdraw → borrow → repay; borrow → repay → Withdraw | All succeeded with the same 33,000,006,416,685-raw authorized payout. |
| Borrow 1 → SPL transfer 1 from claimant to staking vault → Withdraw → repay | Succeeded. Claimant ended with 33,000,006,416,684 raw and staking vault lost 33,000,006,416,684 raw: the one-unit contribution was accounted for exactly. Lender state returned to baseline. |
| Borrow → same Withdraw twice → repay | Second Withdraw rejected `InvalidWithdrawalAmount` 6050; no postimages were returned for the failed atomic transaction. |
| Two, five, or ten flash-borrow/repay pairs; duplicate borrow or duplicate repay | Rejected by Kamino `MultipleFlashBorrows` 6035. |
| One flash pair with 20 or 60 claimant self-transfer legs | Both succeeded with zero net balance/debt/share changes. The 60-leg case was 62 instructions and 1,707 v1 bytes, beyond a v0 packet, and consumed 122,430 CU. |
| Omit repay; wrong repay index; repay wrong amount | Rejected with `NoFlashRepayFound` 6032 or `InvalidFlashRepay` 6033. |
| Alias borrow destination and repay source to Kamino supply vault | Rejected at borrow: `InvalidAccountInput` 6006. |
| Borrow to GRASS staking vault, repay from that vault using claimant signer | Rejected at repayment by SPL Token owner check (`OwnerMismatch` 4). |

## Fresh stake and seven-day exit path

The same owner and user stake state were used for actual `StakeTokens` and `UnstakeTokens` instructions from current successful same-pool transaction layouts. The claimant's GRASS token account held zero before the simulations. A standalone 1,000,000-raw-unit StakeTokens call failed SPL Token `InsufficientFunds` 1; the flash borrow made this leg executable. StakeTokens at 1 raw unit failed the program's `MinimumStakeAmount` 6033 (0.001 GRASS, or 1,000,000 raw units). This is the first concrete blocker at the dust boundary.

At both the 1,000,000-raw minimum and the 1,892,492,987,127-raw near-liquidity size, `flash borrow → StakeTokens → UnstakeTokens` executed. Withdrawing the **new** request in the same transaction then failed `WithdrawalCooldownNotEnded` 6048 at instruction 3. The simulation returned no postimages because the entire transaction was rejected. Inserting `ClaimRewards` between StakeTokens and UnstakeTokens failed earlier at instruction 2 with `NoRewards` 6025 for both sizes; a direct ClaimRewards control for this user also returned 6025. Thus same-slot staking did not produce a claimable reward in the tested account configuration.

Replacing the fresh Withdraw with the owner's **old, already-matured** request 0 gave a successful five-instruction v1 transaction at both sizes. At the minimum size, new request 1 retained exactly 1,000,000 raw GRASS with unlock timestamp `1792696315`, exactly 604,800 seconds after creation, while the old request was cleared. The claimant gained 33,000,005,416,685 raw GRASS, exactly the old 33,000,006,416,685-raw entitlement less the 1,000,000 raw now locked. At the near-liquidity size, new request 1 retained exactly 1,892,492,987,127 raw with unlock timestamp `1792696372`, likewise 604,800 seconds after creation; the claimant gained 31,107,513,429,558 raw, exactly the old entitlement less the locked amount. In both cases the staking vault fell by that same net claimant gain, Kamino's supply/fee/available/debt/share fields returned to baseline, and the flash loan was fully repaid. The matured request supplied the repayment liquidity; the newly created request did not settle inside the transaction.

These results cover this one current GRASS Reserve, this one matured target request, and the listed mutations. The configured zero fee is verified for this Reserve only. The target's staking request is a claim of existing user entitlement, not collateral shares; the only shares in this composition are Kamino's collateral Mint, whose supply remained unchanged. A failed simulation returned no committed postimages, so its recorded errors are not treated as partial state changes.

Reproduction and raw evidence: `flashloan-grass-v1.js` / `flashloan-grass-v1.json` for actual v1 transactions, logs, sizes, pre/post images and slots; `flashloan-grass-v1-4096-exact.json` for the same-slot 4,096-byte Reserve byte comparison; `flashloan-grass-stake-cycle-1.json`, `-min.json`, `-near.json`, `-old-min.json`, `-old-near.json`, `flashloan-grass-stake-claim-min.json`, `-near.json`, and `flashloan-grass-stake-without-flash.json` for the fresh-stake path; `flashloan-grass-reserve.js` / `.json` for live fee and Reserve decode; `flashloan-grass-market-check.js` / `.json` for the Project 0 and Kamino mint lookups; `flashloan-source-introspect.js` / `.json` for historical instruction shapes. All scripts use local RPC configuration without embedding its credential.
