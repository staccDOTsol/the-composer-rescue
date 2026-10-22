# Loopscale outsider-drain audit — current deployed program

Date: 2026-10-15  
Program: `1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78`  
Attacker model: arbitrary outsider with fresh ordinary keypairs, no admin/borrower/lender keys, no prior LP position, and access to atomic flash liquidity.  
Scope: immediate unauthorized asset extraction from the two selected custody accounts. Governance compromise, stolen keys, malicious upgrades, and non-atomic economic attacks are out of scope.

## Result

**No immediate outsider drain was validated against the deployed program at the tested snapshots. Realized outsider gain was exactly `0`.**

The only permissionless asset-transfer path found in current history, `liquidate_ledger`, is a repay-for-collateral liquidation rather than a free withdrawal. Against the selected BONK loan, the deployed program rejected a fresh outsider at the `liquidator` raw constraint (`ConstraintRaw`, code `2003`) before transferring collateral. The rejection was unchanged with an asymmetric debt-covering `$900,000` USDC flash allocation and with the maximum validated direct-USDC three-provider allocation of `$12,474,220.202354`.

The other plausible exits independently require an authority the outsider cannot manufacture with capital:

- `withdraw_strategy`: the real lender is an off-curve Loopscale Vault PDA and must be a signer; the signed fork rejected it with `AccountNotSigner` (`3010`).
- `withdraw_collateral`: requires the protocol admin and the selected borrower relationship; the outsider failed `InvalidAuthority` (`6136`).
- `withdraw_user_vault`: requires the protocol admin and burns the withdrawing user's LP shares; the outsider failed `InvalidAuthority` (`6136`) and held no victim LP shares.

This is a snapshot-bounded negative result, not a claim that the code can never contain another vulnerability. The program is upgradeable and the selected loan's eligibility can change with time and prices.

## Selected exposure

| Target | Current units at snapshot | Relevant state | Snapshot value basis |
|---|---:|---|---:|
| USD.infra Strategy token account `F488bJXts4G2e5eeFqLCuT5A4ebifSqEZmwLX7qeKurV` | `8,494,282.242708` USD.infra (`8,494,282,242,708` raw) | Strategy `836SQM4FLXELjrSu2cLLvi32aiqn22uNbZsZvBNdDHFm`; lender Vault PDA `4rXteUmbxiXvgLqP14eQwtqkLyVNXVCBHnXyLQ9vZkSh`; market `6TBbDMm1uoVbxVrcs8bWnmoyuks4wzHNyQqX3GaEFcgB` | `$8,494,282.242708` if marked at `$1` |
| BONK Loan collateral account `9FXfaV6eVe5RfD8vLg137u8kzA1aNmNsV3kDHCZhdqzF` | `872,058,768,456.51877` BONK (`87,205,876,845,651,877` raw) | Loan `634QWfYYzXuqdDWoVtNgQisVYkTdBmfBbBPYZoNZyHwE`; borrower `DJTiaWW2osQwz4wwHJrzrK6U2vD7cRUGymgmVTHzuDAd`; USDC Strategy `6tv6XYnXUFjLSaAeap4T1GQusYeEw3nK6KTcVyyHf3ns`; market `5qjqX4YQL6HSQMagRfTVfFDXrwxzKpS6bHguCWPe768y` | `$2,704,690.27` in the Loopscale API snapshot at `2026-10-15T19:34:19Z` |

The API snapshot therefore repriced the gross selected exposure at approximately `$11,198,972.51`; the input ranking was approximately `$11.177m`. Neither figure is exploit proceeds. The tested realizable outsider drain was `$0`.

The selected BONK loan snapshot had principal due `885,349.904080` USDC, approximately `$117.58` accrued interest in the API view, `8.5%` APY, `40%` LTV, a `45%` liquidation threshold, and approximately `32.7%` current LTV. Its stated end time was `2026-10-16T05:53:01Z`. The collateral token account held `5,000,000` raw BONK more than the loan's recorded collateral amount; that dust did not change the authorization result.

The USD.infra Strategy snapshot reported `1,116,500` principal units deployed, about `7,273.271650` outstanding interest, `72.732709` fee claimable, 14 active loans, and 15 cumulative loans. Its Token-2022 account is owned by the Strategy; the corresponding Vault Token-2022 ATA `Gxrd8UFDBMLdFwFwAewXRHiDj6wvF9XCpF68C9qUWYqH` did not yet exist at the snapshot.

## Deployed program and authority state

- Upgradeable ProgramData: `8KbXd8ATqDQQTozYv2TsCzHUDoiRyWe4DmzHdmJLgdNj`
- Deployment slot: `440130674`
- Upgrade authority: `DwBXwJDZ4Av4miT62sEssWJUinkzwkmPPB4Fg3fKEfft`
- Downloaded deployed binary: `3,451,632` bytes, SHA-256 `f32f9176793f31c9fb561662aa940cbb1b9506254d3064a670f965d6525edb9d`
- IDL package: `@exponent-labs/loopscale-deserializer@0.9.30`, published 2026-10-14; 40 instructions
- IDL file SHA-256: `85677b353b35e30f4c27dd50c15b168c32568555136501ab05180215e03a622b`
- Protocol admin state: `HcgXEnEsgvGowVnSjMmrzSewdx9yGvfXixiuMJPhyW2z`
- Protocol/refinance admin: `CyNKPfqsSLAejjZtEeNG3pR4SkPhSPHXdGhuNTyudrNs`
- Operations admin: `BBEPbsJAM5ecjXEKzcSK7XNdJ4JfEkiauJRgRcybQeoA`, an off-curve Squads vault PDA
- Frozen flag at snapshot: `false`

A program-account census near slot `457355288` found 5,825 Loan, 96 MarketInformation, 1 ProtocolAdminState, 1,960 Strategy, 5 Timelock, 29,948 UserRewardsInfo, 53 Vault, 52 VaultRewardsInfo, and 9,601 VaultStake accounts. Both selected markets used Beam oracle account `E22Z2nKBdA3RpJhM8G2mB35zFA95Qdbs3WGbMNxFhmuH` in the reconstructed health suffix.

## Historical behavior check

A bounded read-only scan decoded 4,975 successful transactions among the latest 5,000 signatures, down to slot `456539524`. Anchor logs include nested self-CPI, so instruction counts are invocations rather than unique transactions. Relevant counts were:

| Instruction | Invocations |
|---|---:|
| `refinance_ledger` | 6,690 |
| `withdraw_user_vault` | 487 |
| `withdraw_collateral` | 166 |
| `borrow_principal` | 111 |
| `execute_timelock` | 29 |
| `withdraw_strategy` | 6 |
| `liquidate_ledger` | 1 |

The sampled direct withdrawal, refinance, and timelock transactions included the current admin alongside the relevant user/manager. The sole successful `liquidate_ledger` in the window is a useful positive control:

- Signature: `2rQzpZa1JtmVPesFVq8RySWXD2NqDsGvixVR9WAzZy3uBH3qJWsUCcmVGGwaBiW5SmQANKQ6npGTH4zzHF18bMkt`
- Slot: `456839274`
- Sole signer/liquidator: `rektbdF5r7HnWrPDRvD76pC1V9rVfaGmbSY3Dsrj8Kx`
- Wire: 850 bytes; SHA-256 `8cd56bbd56363ae31817f312472537f9f5a071ab7ffd224dd511553a9d99a6b4`
- Log: `Processing time-based liquidation for SPL token`
- Liquidator paid `395,512,090` raw wSOL to the Strategy and received `395,116,553` raw WFR collateral.

That transaction demonstrates the instruction is permissionless only when its live eligibility and asset constraints pass. It does not demonstrate a free drain, and its closed loan cannot be replayed against the selected loan.

## Flash-liquidity inventory and exact boundaries

All figures below were validated on the frozen fork at slot `457365396` with custom signed Solana v1 wire transactions and `sigVerify:true`.

| Independent provider | Mint | Validated route maximum | Fee / limiting rule | Exact boundary evidence |
|---|---|---:|---|---|
| Project 0 / marginfi `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | USDC | `281,112.340442` | No principal fee observed; maximum limited by bank utilization, not displayed vault balance | `max-1` pass; exact pass; `max+1` fails `IllegalUtilizationRatio` (`6026`). The displayed available `282,171.498456` and its ±1 raw probes all fail. |
| KLend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | USDC | `8,009,393.732715` | Live flash fee scalar exactly `0`; one flash borrow per transaction | `available-1` pass; exact pass; `available+1` fails `InsufficientLiquidity` (`6008`). |
| Save/Solend `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo` | USDC | `4,183,714.129197` | `0.05%` decoded fee; 20% host share; one flash borrow per transaction | `available-1` pass; exact pass; `available+1` fails `InsufficientLiquidity` (`20`). |

Provider identities:

- Project 0 group `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8`, Bank `2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB`, liquidity vault `7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat`.
- KLend reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, market `47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8`, supply vault `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`, fee vault `5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj`.
- Save reserve `BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw`, market `4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY`, authority `DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby`, supply vault `8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf`, fee receiver `5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP`.

The maximum successful direct-USDC control borrowed and repaid all three sources atomically:

```text
Project 0       281,112,340,442 raw
KLend         8,009,393,732,715 raw
Save          4,183,714,129,197 raw
Combined     12,474,220,202,354 raw = 12,474,220.202354 USDC
```

The control was 1,200 bytes, 25 inline accounts, 9 instructions, and 257,895 compute units. Signed-wire SHA-256: `e243f58355b11c2f68f0cd7da8f1592ce461220fc2f8be8774dcbdd5c64b6729`. Project 0 and KLend vault/fee deltas were exactly zero. Save's supply delta was zero; its fee receiver gained `1,673,485,652` raw USDC and the attacker lost the same amount. The control used the attacker as Save's host receiver, so the 20% host share returned to the attacker and the external cost was 80% of the decoded fee. Persisted fork state matched the byte-for-byte baseline after simulation.

Repeat borrowing was not used to overstate capacity:

- A signed duplicate-KLend pair failed immediately with `MultipleFlashBorrows` (`6035`), 596 bytes / 11 accounts / 4 instructions, hash `63cd54c42e2418713c9aacae98194fb83023f74ab0ce780fa06bd5f36dada551`.
- A signed duplicate-Save pair failed immediately with code `51`, 520 bytes / 10 accounts / 4 instructions, hash `5c7b02ae0e77943df43c945643a22d2505806f5eea99327fc89368fe9a5420ea`.
- Project 0 had six current USDC Banks in the group, but the non-selected nonzero vaults totaled only 179 raw USDC at inventory time.

The wider inventory identified Jupiter Lend's isolated Ethena flash wrapper `jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF` as an additional independent zero-fee facility for USDe/USDG, with PYUSD currently utilization-gated. It has no native USDC reserve. It was therefore not added to the selected loan's direct-USDC ceiling: converting its assets requires an external stable-swap route, while every selected Loopscale candidate rejects at an account/authority constraint before capital or price can affect target state. A separate signed mixed-mint provider inventory remained in progress and was not treated as completed target evidence.

Mango v4 and Drift flash/swap-style facilities were not counted as validated capacity: they require protocol account/health or two-market swap state not reconstructed for this target. Excluding them cannot change the observed authorization failures, but it is a limitation on any claim about an ecosystem-wide economic-liquidity ceiling.

## Signed target-candidate matrix

Every row used the same fresh outsider `FgtCxrHz6cMx16XRTqYyAcUYtmrrTZ8YDD3r4pHgz4yS`, a fresh marginfi account `FqwGLcW83rWEcoq1Czsp7NPddWRPBrcn3Ru4aHNipaqn`, Solana v1, `sigVerify:true`, and the frozen slot `457365396`. All were under 4,096 bytes and 64 accounts. No transaction was broadcast.

| Candidate | Flash envelope | Wire / compute | Deployed-program result | State / gain |
|---|---|---|---|---|
| BONK `liquidate_ledger`, asymmetric debt cover | P0 `123,456.789123` + KLend `543,210.987654` + Save `233,332.223223` = `900,000` USDC | 1,702 bytes; 39 accounts; 11 instructions; 220,350 CU; hash `c8ab6189ec35729ad6c159d28db67286e944d3a85ce1f0852b98e419e1934978` | Instruction 6 rejects account `liquidator`: `ConstraintRaw` (`2003`) | No BONK transfer; atomic rollback; persisted state equals baseline; gain `0` |
| BONK `liquidate_ledger`, maximum direct-USDC sources | P0 `281,112.340442` + KLend `8,009,393.732715` + Save `4,183,714.129197` = `12,474,220.202354` USDC | 1,702 bytes; 39 accounts; 11 instructions; 220,358 CU; hash `340d1fa3d387e843bc8e1059dfd29c3e48c3468e59e86d6c68d69c7374f4d50a` | Same instruction/account/error: `liquidator`, `ConstraintRaw` (`2003`) | No BONK transfer; atomic rollback; persisted state equals baseline; gain `0` |
| USD.infra `withdraw_strategy` | Three independent sources, 1,000 raw USDC each | 1,598 bytes; 36 accounts; 11 instructions; 208,051 CU; hash `05092d788a1047ee5b090723f349358890ae5872d8720dc935e6a678bae8794c` | Instruction 6 rejects `lender`: `AccountNotSigner` (`3010`) | No transfer; rollback; gain `0` |
| BONK `withdraw_collateral` | Three independent sources, 1,000 raw USDC each | 1,537 bytes; 33 accounts; 11 instructions; 216,589 CU; hash `bc9a3ba0e0696369e934315014eff0728d1b156fb84dc9577b7c26d043331b16` | Instruction 6 rejects `protocol_admin`: `InvalidAuthority` (`6136`) | No transfer; rollback; gain `0` |
| USD.infra `withdraw_user_vault` | Three independent sources, 1,000 raw USDC each | 1,703 bytes; 38 accounts; 13 instructions; 245,065 CU; hash `13ac49cd500960001cfc5d1243f9941e43e63baf0872e7225322410d712b2ad0` | Instruction 8 rejects `protocol_admin`: `InvalidAuthority` (`6136`); outsider also has no victim LP to burn | No transfer; rollback; gain `0` |

The liquidation transactions encoded every lender repayment after the Loopscale instruction. Those repayment instructions are unreachable because Loopscale rejects first, but Solana atomicity restores all prior flash-borrow state. The separate successful maximum control proves that the same three lender routes do fully repay when the target instruction is omitted. No reverse swap was inserted into the failed liquidation cases because Loopscale transferred zero BONK.

## Fork integrity and synthetic state

- Scope string in the harness: `local Surfpool fork only; signed simulations with sigVerify:true; no sendTransaction`.
- Fork baseline slot: `457365396`.
- The harness has no live-submission path.
- The outsider received synthetic `20 SOL` only for local fees/rent and `2,000 USDC` only to pay Save's real fee in successful positive controls. The USDC seed was excluded from proceeds and reconciled by raw balance delta.
- Every target-candidate simulation left persisted fork state byte-for-byte equal to baseline.
- Surfpool's rent model required `2,136,720` lamports for the copied 179-byte USD.infra token account, while the copied mainnet account held `1,944,231`. Only the failed `withdraw_user_vault` test included a normal signed System transfer of `192,489` lamports to remove this emulator-only precondition. The transaction failed and rolled that transfer back.

## Limitations

- Mainnet state can change after the cited slots. In particular, loan maturity, oracle prices, balances, admin state, program upgrades, and lender utilization are time-dependent.
- The 5,000-signature history scan did not reach deployment slot `440130674`; absence outside that window was not inferred.
- `ConstraintRaw` establishes that the selected current loan rejected the outsider, but the report does not invent a more specific semantic cause than the deployed log proves.
- IDL-assisted decoding was checked against current deployed behavior, but an IDL is not itself an enforcement boundary.
- A formal Codex Security scan registration was attempted once and failed with `sqlite3.OperationalError: database is locked`; it was not retried or replaced. The evidence here comes from the deployed binary/IDL, read-only RPC history/state, and signed local-fork simulations.

## Reproducibility artifacts

| Artifact | Purpose | SHA-256 |
|---|---|---|
| `1oop-current.so` | Downloaded deployed program binary | `f32f9176793f31c9fb561662aa940cbb1b9506254d3064a670f965d6525edb9d` |
| `1oop-loopscale-idl-0.9.30.json` | Current published IDL used for decoding | `85677b353b35e30f4c27dd50c15b168c32568555136501ab05180215e03a622b` |
| `1oop-current-probes.json` | Unsigned mainnet diagnostics; not treated as final signer proof | `1b11e00aa0f72612d9315c66e507d727d42e7ffe279a0ca3fa9ddd9af89e048f` |
| `1oop-history-scan.json` | Bounded current history census and samples | `b11d08a6ee486677ad1d9021c642ea86755f526fb8db83ce349b13567c9a1f05` |
| `1oop-liquidation-positive-control.json` | Successful historical repay-for-collateral control | `7bc861cfc9c19fa7587fd79867d0fe0f4aac5f757785aebb50a585d762816885` |
| `1oop-signed-fork-flash-matrix.js` | Signed fork test harness | `f8b612e6f585bccb9e93a906dbf06ca649889633580ee7ba23569239cb4ec19b` |
| `1oop-signed-fork-flash-matrix.json` | Full boundaries, signed-wire hashes, logs, deltas, and baseline checks | `161397a4a75cdfec8775dfd25c36dddb69d6725e8b40384dbbe230b80c228e94` |

## Final assessment

No Critical, High, Medium, or Low outsider-drain finding was validated for the two selected accounts at the tested current-state snapshots. The direct-USDC capital ceiling was exercised beyond the entire selected marked exposure, the candidate liquidation was tested both at a debt-covering asymmetric allocation and at the maximum validated three-provider allocation, and all direct withdrawal candidates were wrapped with three independent lenders. Each target path failed before an unauthorized asset transfer, and the realized outsider gain was exactly zero.
