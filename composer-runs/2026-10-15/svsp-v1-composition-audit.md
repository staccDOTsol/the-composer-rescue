# SVSP exact-current Solana v1 composition audit

Program: `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`

Scope: outsider-only, simulation/fork execution only. No transaction was sent to mainnet. The deployed binary was 254,256 bytes, SHA-256 `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4`.

## Bottom line

- The dangling-authority DepositStake candidate is blocked. Both live HHZn stake accounts with the canonical withdrawer have a noncanonical user staker. An exact-account signed Surfpool test of `41Tq...` failed `custom 12` before merge.
- The 34 live token accounts delegated to mint-authority PDAs are not presently withdrawable by an outsider. All 21 positive-balance accounts failed at their individual maximum; aggregate maximum burnable balance is 268,169,293 raw, but each `WithdrawStake` takes exactly one source and each positive source is below its pool's one-SOL stake-split threshold.
- A real-state diagnostic `DepositStake -> Replenish -> WithdrawStake` did capture 1,726,736 delegated lamports from a 1,726,740-lamport active onramp. This demonstrates the accounting effect, not a validated outsider drain: it used two unavailable live user signatures and no compatible signed flash acquisition/unwind route was established.
- Direct same-mint flash liquidity was unavailable for the tested routes. KLend had no reserve for any of 57 SVSP mints. Project0's HHZn bank showed 8,050,308 raw in its vault but had borrow limit zero; its actual borrowable maximum was zero. The onramp-harvest mint's Project0 liquidity vault held zero at slot 457,364,430.

## Signed `sigVerify:true` exact-clone controls

Only a fresh local attacker system account was funded on Surfpool. Target program, pool, stake, mint, and victim-token data/hash/owner/lamports matched upstream exactly. `replaceRecentBlockhash:false` was required with real Ed25519 signatures; all execution was confined to the local fork.

| Case | Upstream/fork slot | v1 dimensions | CU | Exact result |
|---|---:|---:|---:|---|
| HHZn `41Tq...` withdrawer-only DepositStake | 457,362,216 / 457,361,991 | 655 B, 16 addresses, 2 ix, 1 sig | 33,027 | ix 1 `custom 12`, “Stake account is not in the state expected”; staker is not canonical PDA |
| Outsider approval of real victim HHZn token | 457,362,216 / 457,361,991 | 756 B, 14 addresses, 3 ix, 2 sigs | 394 | ix 1 Token `custom 4`, owner mismatch |
| Dominant delegated E7JJ maximum withdrawal | 457,362,903 / 457,362,351 | 740 B, 14 addresses, 2 ix, 2 sigs | 40,319 | ix 1 `custom 12` at Stake Split |

There is no signed `sigVerify:true` mainnet-path success because the required live private keys are unavailable; forging those signatures is the exact cryptographic blocker. The earlier `sigVerify:false` cases are diagnostic controls only.

## Delegated victim-token boundary

The live observation spanned slots 457,362,507–457,362,563; simulations used blockhash context slot 457,362,705. All 34 transactions were 740 bytes, 14 addresses, 2 instructions, and 2 required signatures.

| Token / pool | Max burnable | One-SOL share threshold | Calculated stake output | Slot / CU | Result |
|---|---:|---:|---:|---:|---|
| `E7JJ...` / `5Maj...` | 258,169,258 | 865,545,071 | 298,273,616 | 457,362,709 / 41,083 | ix 1 `custom 12` at Stake Split |
| `9ykS...` / `EX9...` | 10,000,000 | 714,225,778 | 14,001,174 | 457,362,720 / 36,619 | ix 1 `custom 12` at Stake Split |

Zero-balance cases failed `custom 9`; every positive-balance case failed `custom 12`. Failed simulation post-account images were returned as null by the upstream RPC, but transaction failure is atomic; the signed fork controls independently exercised the same rollback path. No state was submitted.

Balances cannot be aggregated by repeated SVSP instructions: each instruction burns one SPL source and immediately attempts one stake split. The mint-authority PDA is the delegate, but an outsider cannot sign as that PDA to consolidate victim balances. A hypothetical 21-source transaction would also require 102 addresses and 42 instructions, exceeding the 64-address v1 ceiling before flash/swap legs are added.

## Project0 exact-zero target boundary

Target HHZn bank `9QWUatjtJtc98yts4ufWnmNeaWQRmaaLjFwbK3iMdS47`, mint `98B1NMLYaNJQNxiQGr53vbjNFMNTYFmDqoCgj7qD9Vhm`, liquidity vault `7yjXeo9S9aBD7fLQTs8kSuv81iPydar8RDsMqQA6DXNS`, authority `9tPKLywMcmnxa3H7VTkHfBW9NJ1jUQu11tMBejS157jr`.

At blockhash slot 457,363,552 the displayed vault balance was 8,050,308 raw, but configured borrow limit and current borrow-position count were both zero. Amounts 1, 2, and 3 raw each failed at the borrow with `BankLiabilityCapacityExceeded` (`custom 6027`); the 2/3 cases were 670 bytes, 14 addresses, 5 instructions, 1 signature, and consumed 34,253/34,257 CU. Therefore maximum actually borrowable was **0**, not the displayed balance.

The same quartet succeeded for an unrelated live USDC bank at 2 raw with exact repayment and zero protocol fee: 563 bytes, 11 addresses, 4 instructions, 1 signature, 124,653 CU; borrower token, lender vault, and liability shares all had zero net delta. This proves the Project0 encoding, while not making the SVSP target bank borrowable.

## Provider and maximum-combination matrix

| Provider | Tested asset/capacity | Fee/mode/repeat rule | SVSP-route status |
|---|---|---|---|
| KLend | Full current census: 619 decoded reserves; zero matches across 57 SVSP mints | Selected WSOL reserve has exact zero flash fee; one borrow/transaction; indexed repay | Direct same-mint capacity 0 |
| Project0 | HHZn SVSP vault 8,050,308, but borrow cap 0; onramp-mint vault 0 at slot 457,364,430 | No protocol flash fee; start/end session; authority-owned margin account | Direct capacity 0 for both exact tested mints |
| Save | Selected WSOL available 71,655,947,907,574 | 4 bps, ceil fee; minimum stated 3 raw; one borrow/transaction | Unrelated asset; signed stack attempts failed at Save `custom 14` math overflow |
| Jupiter Flash | Selected USDe vault 297,716,276,674,928,468; bound position ceiling 10,000,000,000,000,000 | 0 bps, minimum 1,000 raw, one active wrapper, exact repay | Unrelated asset; no validated SVSP buy/sell route |
| Project0 stack leg | Selected USDC vault 282,172,161,669 | No protocol flash fee; start/end session | Unrelated asset; cannot by itself alter bearer-authority predicates |
| KLend stack leg | Selected WSOL available 6,582,664,950,015 | Exact zero fee; one indexed borrow/repay | Unrelated asset; cannot activate fresh stake in the same epoch |

The signed dual, triple, and maximum four-provider envelopes fit the requested limits: 897 B/20 addresses/7 ix, 1,374 B/29/13, and 1,773 B/39/16 respectively. The four-provider transaction used two signatures and `sigVerify:true`. Every recorded multi-provider case failed before complete borrow/unwind/repay—principally at the Save leg with `custom 14`—so these are composition/blocker evidence, **not positive controls** and not proof of available aggregate capital. Capacity ±1 and asymmetric envelopes likewise failed before full repayment.

For the authorization candidates a flash wrapper is a no-op: borrowing unrelated SOL/USDC/USDe cannot change the stake staker/withdrawer equality check or authorize a victim SPL token source. A same-mint top-up would be economically relevant to delegated victim accounts, but none of the checked direct lenders supplied the relevant SVSP mint.

## Active-onramp accounting diagnostic

Pool `2A172EkPfeQchU4uKuTd3e6Mk2LqwsTZF6sALRCQbzZj`, vote `Simpj3KyRQmpRkXuBvCQFS7DBBG6vqw93SkZb9UD1hp`, source stake `HXvYeAbVsXJLiHNFKhYarva3mPrmGWijD77ry35d4Y9G`, stake authority `6iQKfEyhr3bZMotVkW6beNZz5CPAkiwvgV2CTje9pVSS`, token owner/payer `8ZYkgY8vux63VKDv65gcbqrakM3k1DLBqUYtzoZmX7sd`.

At slot 457,363,403, the seven-instruction diagnostic succeeded: 1,106 bytes, 19 addresses, 3 required signatures, 239,519 CU, `sigVerify:false`, `replaceRecentBlockhash:true`. Logs exposed a 1,400,000-CU envelope, leaving 1,160,481 CU headroom; compute was not the blocker.

- Deposit `D` = 30,760,853,747,897 delegated lamports from an already-active same-vote stake.
- Mint and later burn `T` = 9,627,200,247,357 raw LST shares.
- Main pool available stake before pricing = 59,284,668; active onramp `R` = 1,726,740; supply `M` = 18,554,276.
- New destination stake ended with 30,760,857,140,873 lamports and 30,760,855,474,633 delegated lamports: delegated gain 1,726,736.
- User token amount and mint supply each returned exactly to their starting value, 18,554,276 raw.
- Main pool delegated stake moved 1,059,284,668 -> 1,059,284,672 (+4); onramp delegated stake moved 1,726,740 -> 0.
- Main/onramp lamports moved 1,118,195,424 -> 1,060,950,912 and 4,014,839 -> 59,532,615. Their combined loss was exactly 1,726,736 lamports, matching the new stake gain.
- The source stake closed. The payer gained 143,289,261 lamports due to source excess-lamport return net of rent/fee mechanics; this is separately reconciled in JSON.

The missing live signers are exactly `6iQK...` (source stake authority) and `8ZY...` (token owner/payer). A fresh destination-stake signer is attacker-generatable. Fresh flash-borrowed SOL cannot replace the source because new stake cannot become fully active with the required activation epoch in the same transaction. No direct same-mint lender was available and no signed DEX `borrow -> buy SVSP LST -> replenish -> sell -> repay` route was established. Accordingly this is an accounting candidate, not a validated outsider drain.

## Other exact v1 controls

The core diagnostic blockhash context was slot 457,359,592; trace boundaries used slot 457,359,853. Positive controls included exact-threshold withdrawal (756 B/14 addresses/3 ix, 71,328 CU), legacy optional-onramp omission (723 B/13/3, 75,854 CU), authorized third-party beneficiary (756 B/14/3, 71,328 CU), two/three/four accounting roundtrips (1,238/1,576/1,914 B and 300,278/450,417/600,556 CU), and permissionless Replenish (480 B/11/1, 27,777 CU). Five cycles and above hit `MaxInstructionTraceLengthExceeded` at outer instruction 26 even while under 4,096 bytes and 64 addresses. Alias destinations for canonical pool/onramp failed `custom 18`; wrong optional onramp failed `custom 2`; wrong vote failed `IncorrectProgramId`; a late forced failure rolled the whole transaction back.

Operator-authorized metadata/update paths are excluded as outsider findings.

## Evidence

- `svsp-v1-composition-audit.json`: full logs, slots, wire hashes, pre/post images, and reconciliation.
- `svsp-v1-composition-audit-finalize.js`: validates and materializes the evidence while refusing endpoint/secret markers.
- `svsp-live-finalized-evidence.json`: live 57-pool and delegated-account census.
- `current-flash-provider-stack-signed-v1.json`: independent signed provider-stack compositions; failed controls only.
- `klend-v1-composition.js`: shared exact Solana wire-v1 encoder.

