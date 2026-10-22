# SVSP target-specific flash-provider crosswalk

Program: `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`  
Scope: 57 pool mints, including 11 active-onramp pools.  
Evidence: primary live finalized RPC only; slots `457367056..457367066`. No transaction was sent.

## Result

Current independently substantiated exact-mint flash sources: **0 / 57**. Active-onramp exact-mint sources: **0 / 11**. Direct exact-validator native Stake-account flash sources: **0**.

| Provider | Live inventory | Exact SVSP matches | Current blocker |
|---|---:|---:|---|
| Save/Solend `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo` | 1,829 reserves @ `457367056` | 0 | No exact-mint reserve |
| Kamino Lend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | 619 reserves @ `457367057` | 0 | No exact-mint reserve |
| Project0/Marginfi `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | 165 Banks @ `457367057` | 26 | Every target Bank has `borrow_limit=0`, a hard zero; state-derived capacity is 0 |
| Jupiter main `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` / flash `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` | 47 reserves / 163 positions @ `457367062..457367064` | 11 reserves, 0 flash-admin-bound positions | Custody is not borrowability; no bound position |
| Jupiter isolated `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS` / flash `jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF` | 5 reserves / 17 positions @ `457367064..457367065` | 0 | No exact-mint reserve |
| Mango v4 `4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg` | 80 Banks @ `457367066` | 0 | No exact-mint Bank |

Jupiter main's liquidity authority held positive balances for 10 target mints at slot `457367066`, but none had a `UserBorrowPosition` bound to its flash admin; these are custody-only matches. Both Jupiter flash admins were enabled with fee 0 bps and no active loan, but the route-specific target binding was absent.

Project0 correction: `borrow_limit=0` is not unlimited. The pinned program source treats every value other than `u64::MAX` as active and rejects a positive liability when total liability reaches the limit. Existing signed/runtime HHZn controls for raw amounts 1, 2, and 3 returned `BankLiabilityCapacityExceeded` with `borrow lim: 0.0`. Therefore the 26 target Banks, including all target Banks with positive vault custody and all active-onramp overlaps, are not currently borrowable.

No `sigVerify:true` success exists for a target flash route because the live state yielded zero eligible routes. The JSON contains all accounts, raw balances, control classifications, acquisition slots, source semantics, and limitations. Reproduce with `RPC_URL=<primary-finalized-endpoint> node svsp-flash-provider-crosswalk.js`; the script never prints the endpoint and does not submit a transaction.
