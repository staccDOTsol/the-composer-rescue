# Kipseli current-route bounded audit

Observed 2026-10-19 on Solana mainnet-beta (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). This is a narrow audit of the live WSOL/USDC Kipseli route, not a whole-program safety assessment. No transaction was broadcast and no secret material was written to evidence.

## Target correction and custody

The supplied pool identifier was inconsistent with the cited quote artifact. `FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n` is the already-audited TesseraV pool owned by `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH`. The artifact's 100-WSOL Kipseli leg, and a fresh forced Kipseli quote, instead resolve to pool `7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG`. Tessera was excluded from this review.

At confirmed slot **458747081**, `7yD7…` was an 864-byte non-executable account owned by executable program `3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU`. Its two route vaults were:

- WSOL `HgFLBWQugxt6qbPaWiwXjrqauXdQmcpMV6H6t8ttD8s1`: authority `7yD7…`, raw amount **485,349,465,838** (**485.349465838 WSOL**).
- USDC `FzvRbXDdrsYVMa9KohXyQytWNAZAo4PsF8yujDH7KCfG`: authority `7yD7…`, raw amount **295,046,398,209** (**295,046.398209 USDC**).

This is material controlled value. Successful receipt `9KKX9XEombu6WGXPX2wrB12DyLi7nbCP5ANFUtQt6rQhTBPhy4nGuHPTzwTQvjGmZ3yTPKQZd5LKgMkSsRvgKh2` at slot **458747083** invoked `3TK9…` successfully while the pool's USDC vault increased **6,070,970 raw** and its WSOL vault decreased **57,410,117 raw**. Receipt `4qwqYKqSRTsWPMsHUY2Zg8zXp1noUcM6PyB8C21gwSdsgSCTNFxXHd95yHypWJv4eXgJdMC8Z5Ayhm5LhjPD5yVr` at slot **458747079** shows the opposite direction: pool USDC decreased **11,979,826 raw** and pool WSOL increased **113,295,995 raw**. See `kipseli-current-census.json`.

## Deployed executable and Composer validation

The upgradeable program points to ProgramData `7UnpT4Zk1kWzKszWkX58jToMXAXayUXghKvjQD67yQA5`, last deployed at slot **458662440**, with upgrade authority `8vfidczMKnpCvL9vPWQRqiNAdPeRJUWksbirM2KzERhn`. The **644,912-byte** deployed ELF has SHA-256 **`8174ab0da3cb1a137beabfba42b0725f264bc5f66ec2593b4e07f1b3e6e9e6a2`**; the saved `kipseli-current.so` hashes identically.

Composer's published-IDL endpoint returned HTTP 400: no published IDL exists for this program. `GET /learn/3TK9…?limit=150` parsed 250 transactions and recovered two 8-byte Anchor selectors. The observed swap selector is **`f0e02621b01ff1af`**, labelled `swap_v3` from another program's published IDL, so only the selector and observed shape are treated as authoritative. Composer observed **119** samples with **15 accounts**.

A held-out successful receipt after the Composer query, `oc7NG9JiTUTK2iUd5M1PAXnn3ttywF4Yzro7WQQaShCp9hPw8hnuiB2gmJNzuGrW1ev3FsqpP3CzNMm3aPxQgei` at slot **458748186**, contained that exact selector and 15-account shape. Positions 1–5 matched the pool, WSOL vault, USDC vault, WSOL mint, and USDC mint; positions 8, 9, and 14 matched the SPL Token program, System program, and Instructions sysvar. The signed current-state simulations then executed `3TK9…` successfully, which validates this route against the deployed executable rather than only against inferred names. See `kipseli-composer-learn.json`, `kipseli-composer-idl-error.json`, and `kipseli-donation-sim.json`.

## Raw-vault donation control

The concrete test compared the same wallet-signed Kipseli swap on one frozen current-mainnet-backed Surfpool state:

1. Control: swap **5,000,000 lamports** of WSOL to USDC.
2. Donation case: first transfer **1,000,000 lamports** directly into the pool WSOL vault and call SPL `SyncNative`, then execute the identical swap.

Both v0 transactions were signed by the controlled wallet and simulated with `sigVerify:true`; neither was submitted. The control was **589 bytes / 18 keys** and the donation case **611 bytes / 18 keys**, within the requested v1 envelope. Both returned `err:null` and produced exactly **528,886 raw USDC** to the user. The donation changed output by **0 raw**, so this route's price was not sensitive to the tested raw-vault donation.

The fork also exposed **762,693** pre-existing unsynced lamports in the native vault above its SPL-recorded amount (after its rent reserve). `SyncNative` materialized that amount in the token record, but did not create economic value. Accounting by actual lamports closes exactly:

- Control: user SOL **−5,105,000**, pool WSOL lamports **+5,000,000**, combined **−105,000**, exactly the transaction fee. User USDC **+528,886**, pool USDC **−528,886**, combined **0**.
- Donation: user SOL **−6,105,000**, pool WSOL lamports **+6,000,000**, combined **−105,000**, again exactly the fee. User USDC **+528,886**, pool USDC **−528,886**, combined **0**.

See `kipseli-donation-fork.json`. The earlier mainnet simulation succeeded too, but the pool moved between its pre-read and simulation; its cross-slot vault deltas are therefore not used for equity claims.

## Independent exit and disposition

At quote slots **458748186–458748187**, **100 WSOL** through Kipseli returned **10,565,888,783 raw USDC**. A direct independent return quote excluding both Kipseli and TesseraV routed through BisonFi pool `8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo` and returned **99,977,804,441 lamports**. That is **−22,195,559 lamports** before transaction costs and **−22,405,559 lamports** after a conservative two-transaction fee of 210,000 lamports, using the signed control's measured 105,000-lamport fee per transaction.

This bounded control was self-funded; it did not use or claim a flash lender, so lender repayment is not applicable. The independent exit screen is time-separated quote evidence, not an atomic execution claim. Because the tested donation produced no price/output change and the clean independent round trip was already decisively negative, the audit stopped at the requested economic gate instead of constructing a larger flash route.

**Disposition:** no validated outsider-profit vulnerability in the tested raw-vault donation path. Remaining uncertainty includes untested selectors/state transitions, other trade sizes and directions, and future upgrades. The upgradeable binary and the absence of a published IDL make this a bounded negative result, not a whole-program safety claim.
