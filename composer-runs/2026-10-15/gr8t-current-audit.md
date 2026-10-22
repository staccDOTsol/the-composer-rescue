# Current-mainnet audit: `gr8t…C9t` token migrator

Date: 2026-10-15 (America/Toronto)  
Target program: `gr8tqq2ripsM6N46gLWpSDXtdrH6J9jaXoyya1ELC9t`  
Target state/PDA: `4viadAyxnRpHyW2g2NEzjLwGGgLTQK2QBmniJJqXWpXN`  
Output vault: `Ew4FbaNqsh3dj6cWenCxbcsSKdiopxQ7Hnm9xMhYuJvX`

## Result

**No reportable unauthorized-outflow vulnerability was found. Observed unauthorized outflow: 0.**

All successful current simulations required a user signer and debited that signer's legacy-META token account by exactly the raw amount paid from the new-META vault. Account-owner, mint, vault-ATA, and state substitutions failed before value movement. The source exports no claim, release, admin-withdraw, update, sweep, or close path. Current same-mint flash-loan composition is blocked before the target call because the only observed Project 0 legacy-META bank is `ReduceOnly`.

This dismisses the candidate as an unprivileged vault-drain path at the pinned executable and observed state. It does not remove the ordinary trust placed in the non-null BPF upgrade authority.

## Executable and state pin

- Otter verification maps the deployed executable hash `32519bcaafee0c8146846a96c6f430812fe826a0c9f0a1e44674f49f8682342e` to official source commit `6b736cf65eb2296faf1f0af9bce0976715a6ba58` in `metaDAOproject/token-migrator`.
- A current raw `solana program dump` is retained as `gr8t-current-program.so`: 263,268 bytes, raw-file SHA-256 `3dfae55b2b3d90efd741ddc769855bf7df5adc905373bd3683d1b0e83fd5d01c`. The raw-file digest is distinct from the verifier's normalized executable digest.
- The program remains upgradeable. ProgramData is `2z8XURVpoAcatzB96YSCdutx4LBdhNho2obPNh2txJva`, last deployment slot `428855656`, and upgrade authority `6awyHMshBGVjJ3ozdSJdyyDE1CTAXUwrpNMaRGMsb4sf`.
- At observation slots `457348640–457348661`, the 100-byte state decoded to admin `ELT1uRmtFvYP6WSrc4mCZaW7VVbcdkcKAj39aHSVCmwH`, source mint `METADDFL6wWMWEoKTFJwcThTbUmtarRJZjRpzUvkxhr`, destination mint `METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta`, `Fixed { e: 0 }`, and bump `255`. State SHA-256: `2853bcf54963ab13f0fa41deb477c2ba76690077eeafdaa6e5f454e1ac366f88`.
- Re-deriving `PDA("vault", admin, mint_from, mint_to)` produced the exact state address and bump. Canonical vault ATAs were `HDAqKi…jz2i` (17,011,859,560,095 raw old META) and `Ew4Fba…uJvX` (3,851,269,441,143 raw new META), both controlled by the PDA.

## Authorization and value flow

The pinned program exposes only `initialize` and `migrate`. `initialize` is permissionless but creates a distinct PDA in the initializing signer's namespace; it cannot replace this state. `migrate` enforces:

1. `user` is a signer;
2. the source token account is owned by that signer and has `mint_from`;
3. the beneficiary token account is owned by the same signer and has `mint_to`;
4. both vault token accounts are the canonical ATAs of the validated state PDA;
5. the state PDA is re-derived from its stored admin/mints/bump; and
6. the program first deposits the user's input, then withdraws output under the PDA signer.

`Fixed { e: 0 }` means one raw input unit produces one raw output unit. Because old META has 9 decimals and new META has 6, the migration is a 1:1 raw-unit redenomination, not 1:1 UI units.

Historical signature `25f88VsGe8cHbdAdjxN5rKkWRNUxRGGW1evGEExw2So9h3JAeZCtRJFzbhVhigQB2vSvYYuyJJqZFV9TRWk1LBVt` at slot `451747420` is the signed positive control: signer `3V8n…T3im` deposited 11,873,427,952 raw old META and received exactly 11,873,427,952 raw new META. The input SPL transfer used the root signer; the output SPL transfer used non-transaction-signer `4viad…WpXN` under an immediate `gr8t…C9t` CPI. The only fee was the 5,000-lamport transaction fee.

## Current v1 simulations

All probes used real version-1 wire messages, inline accounts only, the 4,096-byte/64-address envelope, `simulateTransaction`, `sigVerify:false`, and no signing or submission. Full wire base64, SHA-256, account flags, logs, inner instructions, and pre/post snapshots are in `gr8t-current-probes.json`.

| Case | Result | CU | Wire / accounts | Exact token effect |
|---|---:|---:|---:|---|
| 1 raw unit | success | 27,103 | 490 B / 11 | user old −1; user new +1; old vault +1; new vault −1 |
| 0 | rejected: `ArithmeticOverflow` | 18,741 | 490 B / 11 | no movement |
| two repeated 1-unit migrations | success | 54,206 | 514 B / 11 | exact matched ±2 |
| holder's full 385,411,577,431 raw balance | success | 27,103 | 490 B / 11 | exact matched ±385,411,577,431 |
| beneficiary aliases output vault | rejected: owner constraint 2015 | 7,526 | 458 B / 10 | no movement |
| vault ATAs swapped | rejected: associated constraint 2009 | 14,650 | 490 B / 11 | no movement |
| foreign beneficiary owner | rejected: owner constraint 2015 | 7,707 | 490 B / 11 | no movement |
| foreign source owner | rejected: owner constraint 2015 | 7,629 | 490 B / 11 | no movement |
| foreign program state | rejected: owner constraint 2015 | 8,497 | 490 B / 11 | no movement |

The direct output-vault `available ± 1` boundary could not be run with a current holder because the selected on-curve funded holder had 385,411,577,431 raw input while the output vault held 3,851,269,441,143 raw. This was not papered over with invented funds.

## Atomic flash-loan extremes

### Positive lender controls

The separately retained current KLend/USDC control demonstrates that v1 flash borrowing is functional rather than generically broken:

- reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`;
- current decoded flash fee rate `0`;
- current accounted available liquidity `7,868,315,584,088` raw USDC at slot `457348144`;
- borrow+full-repay succeeded at 1 raw, at accounted-available-minus-one, and at accounted available; available-plus-one failed with `InsufficientLiquidity` 6008;
- a 10-raw deposit/withdraw cycle, order variants, rate-refresh variants, and repeated cycles succeeded through full repayment; seven or more repeated round trips hit Solana's instruction-trace limit rather than producing excess tokens;
- the basic flash pair was 531 bytes; composed cycles were 1,054 bytes, below both requested message limits.

KLend is not a same-mint lender for either target META mint: its tested zero-fee reserve is USDC. Supplying USDC directly to `migrate` cannot pass the hard `mint_from` constraint. A USDC→old-META→migrate→new-META→USDC sequence is a market round trip, not a same-mint borrow of the asset the target consumes.

### Same-mint Project 0 attempt and exact blocker

Project 0 currently has a bank for the required old-META mint:

- bank `H6bfRmfZPoxDDs8eoVBgouTPowwyv7opfBbHd5KUmuUz`;
- liquidity vault `HXmvwXgqet7uSAg4csm7tUr5sWkFBRouXDArYx89vUca`;
- observed liquidity `20,016,003,335` raw old META.

Real atomic v1 messages were built for 1, 2, 1,000, 90%-available, and available-minus-one raw units, plus repeated borrow/repay, borrow→migrate→repay, repay-before-migrate, and a destination-alias variant. The controls were 778 bytes/17 addresses; the target-composed cases were 962 bytes/22 addresses. Every case reached `LendingAccountBorrow` and failed there after about 60,004 CU with `BankReduceOnly` / custom error 6017. Therefore the first concrete current-state blocker is lender configuration, before the target program executes. There is no honest funded same-mint positive control for this bank, and no result is represented as one.

Even absent that configuration block, consuming borrowed old META in `migrate` creates an old-META repayment deficit: the target deposits old META irreversibly and pays new META. Full same-asset repayment would require buying old META back. No source path returns deposited old META, and Solana atomicity rolls back the target transfer if later repayment fails.

## Realizable liquidity, not gross marks

Read-only Jupiter ExactIn quotes at slots `457349684–457349686`, 100-bps slippage setting:

| Sale | Quoted USDC | Price impact |
|---|---:|---:|
| 1 new META | 5.164949 | 0.5867% |
| 385,411.577431 new META (funded-holder test output) | 805,739.573291 | 59.7609% |
| entire 3,851,269.441143 new-META output vault | 1,290,539.975742 | 93.5502% |
| 1 old META | 5,122.059694 | 0% reported |
| 20.016003335 old META (Project 0 vault scale) | 96,174.968438 | 5.8018% |
| entire 17,011.859560095 old-META input vault | 209,630.352899 | 99.7584% |

These route quotes show why gross snapshot marks (about $19.83M for the output vault and $86.74M for the input vault) are not realizable loss. More importantly, no unauthorized token outflow was found to liquidate.

## Limitations and disposition

- Simulations with `sigVerify:false` validate runtime program behavior and exact deltas but do not establish possession of sampled users' keys. The historical signed transaction supplies the positive authorized control.
- State, balances, quotes, lender flags, and upgrade authority can change after the recorded slots.
- The same-mint Project 0 path was tested until its first deterministic current blocker. It was not replaced with a fabricated flash-loan or a non-META asset.
- No transaction was signed or submitted, no production state was mutated, and no team was contacted.

**Disposition: no finding.** The successful paths are authorized exchanges with exact accounting; all adversarial substitutions were rejected; the current same-mint flash-loan route is disabled at the lender; and measured unauthorized net gain after full repayment is zero.

## Evidence index

- `gr8t-current-probes.json` / `.js`: current state decode, exact v1 messages, direct positive and mutation matrix.
- `gr8t-project0-v1-extremes.json` / `.js`: current same-mint Project 0 composition attempts and `BankReduceOnly` traces.
- `klend-jupiter-v1-extremes.json`: current zero-fee funded KLend controls, boundaries, ordering, refresh, and repetition cases.
- `gr8t-positive-control-tx.json`: successful signed historical migration and CPI signer provenance.
- `gr8t-jupiter-liquidity.json` / `.js`: current route-level realizable-liquidity quotes.
- `gr8t-current-program.so`: current raw program dump.
- `gr8t-token-migrator-source/`: exact verified source checkout.

Official source: <https://github.com/metaDAOproject/token-migrator>  
Verification status: <https://verify.osec.io/status/gr8tqq2ripsM6N46gLWpSDXtdrH6J9jaXoyya1ELC9t>
