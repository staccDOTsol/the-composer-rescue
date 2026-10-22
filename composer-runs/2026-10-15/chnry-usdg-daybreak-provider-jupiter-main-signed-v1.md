# Jupiter main USDG flash and Chancery signed v1 composition

Observed 2026-10-15 on an isolated Surfpool fork of current Solana mainnet state. The harness only called local `simulateTransaction` with `sigVerify:true`; no live transaction was submitted. A fresh outsider signer and empty USDG/USDv Token-2022 accounts were created only on the fork. The private key was held in memory and not saved.

The flash wrapper `jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS` is bound to the liquidity program `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC` for USDG `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH`. The live admin has an exact zero flash fee; USDG and the provider vault use Token-2022. The provider's current vault held 292,555.649602 USDG, while decoded lending accounting indicated about 287,664.050707 USDG available, so vault balance alone is an overstatement of immediate lending capacity. These state values and larger unsigned boundaries are in `chnry-usdg-daybreak-provider-jupiter-main-state.json` and `chnry-usdg-daybreak-provider-jupiter-main-flash.json`. The signed route harness independently tested 100,000 USDG.

| Signed v1 case | Result | Exact wire | Accounts | CU | Net committed USDG/USDv and watched vault deltas |
| --- | --- | ---: | ---: | ---: | --- |
| Flash borrow → repay, 1,000 USDG | Success | 662 bytes | 15 | 91,436 | All zero |
| Flash borrow → repay, 100,000 USDG | Success | 662 bytes | 15 | 91,444 | All zero |
| Flash borrow → outsider Chancery mint → redeem → repay, 1,000 USDG | Rejected at Chancery instruction 1, `AccountOwnerMismatch` (514) | 1,536 bytes | 37 | 90,340 | Atomic rollback; all zero |
| Flash borrow → outsider Chancery redeem → mint → repay, 1,000 USDG | Rejected at Chancery instruction 1, `AccountOwnerMismatch` (514) | 1,536 bytes | 37 | 90,338 | Atomic rollback; all zero |

Every case has a locally verified Ed25519 signature, was accepted by `sigVerify:true`, and fits Solana v1's 4,096-byte and 64-account limits. The wrapper's borrow actually ran before Chancery's failure. The fresh outsider's canonical permission-record PDA was absent; Chancery's deployed IDL identifies error 514 as `AccountOwnerMismatch` (`invalid account owner`). Failed transactions have zero committed deltas by Solana atomicity; simulator account images for those failures were absent, so the harness explicitly uses the prior account images as the committed-equivalent state.

The authorized historical Chancery operator's private key is unavailable. Therefore an authorized Chancery conversion cannot be fully signed by this outsider harness, and the signed results establish route envelope and outsider authorization behavior rather than successful authorized Chancery conversion. The earlier unsigned authorized control in `chnry-usdg-v1-simulations.json` is separate evidence and does not satisfy `sigVerify:true` for that signer.

Reproduce by starting an isolated Surfpool mainnet fork on port 9167, then running `node composer-runs/2026-10-15/chnry-usdg-daybreak-provider-jupiter-main-signed-v1.js`. Raw slots, signed-wire hashes, logs, balances, and net deltas are in `chnry-usdg-daybreak-provider-jupiter-main-signed-v1.json`.
