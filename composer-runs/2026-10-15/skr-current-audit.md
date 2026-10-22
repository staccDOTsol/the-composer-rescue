# Current SKR staking program audit — 15 October 2026

**Result:** a real SKR vault exit exists, but the tested current-binary paths did not move value to an unauthorized account. Validated unauthorized extraction is **0 SKR / $0**. The vault's approximately $72.95M spot mark is gross custody, with user share and pending-withdrawal claims and much thinner immediately quoted market depth. All transaction tests were read-only `simulateTransaction`; no transaction was signed or submitted and no person was contacted.

## Current deployment and custody

- Program: `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ`, executable at confirmed slot `457347579`.
- Current ProgramData: `7f1KoiGPFFouvAafZtVmtdpgGJuADprihB9Pdzut3gaJ`; upgrade slot `393714625`; deployed-byte SHA-256 `46fc6f624531b035050552e3e885ffcbdb0d92b6ea4d1452a0419d7d90d5cf0c`.
- Exact `['stake_config']` PDA: `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw`, bump 255, owned by the executable. It references SKR mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` and exact `['stake_vault']` PDA `8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8`, also bump 255. That token account is controlled by the config PDA.
- The [historical first-party Solana Mobile IDL](https://github.com/solana-mobile/react-native-samples/blob/d7ae7b13a8fc280985d69244ea2c4eade30542a6/skr-staking/program/idl.json) matches the current config discriminator, 193-byte layout, and observed instruction discriminators. `anchor idl fetch` did not find an on-chain IDL, so the archived IDL is a decoding aid, not proof of all current constraints. Simulations below executed the current deployed bytes.

## Demonstrated value-moving exit and boundaries

[Successful transaction `3PuFGEog...`](https://explorer.solana.com/tx/3PuFGEogLMThkW55XvxBCjEJTyhywbbinfZQBJhpU6fHa3YZvGPp6XaXPi7uRWVJqoC3Mzb6qBxQimBYu8xiRtsM) at slot `457330039` calls `Withdraw` and transfers `193,241,809` raw SKR from the named vault to the recorded user's associated token account, with the config PDA as SPL transfer authority. This is an authorized control. An older sample of 20 and an independent newer scan of 400 successful vault transactions had no outbound transfer; their narrow windows do not negate this exit.

A current-state read-only `Withdraw` simulation at slot `457348363` used a fee payer distinct from the recorded user, with the user **not** marked signer. A matured `UserStake` had `6,381,678,948,330` raw SKR pending and zero shares. The instruction has no amount argument; it withdraws that full pending amount. Exact simulated account changes were:

| Account/state | Before raw | After raw | Change raw |
|---|---:|---:|---:|
| Vault SKR | 5,077,227,902,450,824 | 5,070,846,223,502,494 | −6,381,678,948,330 |
| Recorded user's SKR ATA | 4,729 | 6,381,678,953,059 | +6,381,678,948,330 |
| Config `last_vault_amount` | 5,077,227,902,450,824 | 5,070,846,223,502,494 | −6,381,678,948,330 |
| Config `total_shares` | 4,377,487,275,841,327 | 4,377,487,275,841,327 | 0 |
| Config `share_price` | 1,154,206,571 | 1,154,206,571 | 0 |
| `UserStake` | 6,381,678,948,330 pending, zero shares | Closed | Claim consumed |

The fee payer's SKR ATA was unchanged. A redirected same-mint ATA or substituted user failed `Unauthorized` 6007; a different vault failed `InvalidVault` 6008; destination aliased to vault failed 6007; swapping `UserStake` and config failed an account-type check 3002. Repeating Withdraw in one transaction fails on the second leg because the stake account is closed (`AccountNotInitialized` 3012), so the atomic transaction commits neither leg. Zero pending failed `NotUnstaked` 6018; an immature pending claim failed `CooldownNotCompleted` 6004. These tests cover the available user, destination, vault, amount-state, account-order, alias, and repeated-leg boundaries without claiming exhaustive safety.

The config/upgrade authority is the same off-curve address `Hgbea5UFVXD3dQoL2mJbXLVnnFFRqyJJis9vfm69w5oQ`. It exactly derives as Squads v4 vault index 0 (bump 253) for multisig `73qS84UTSpVjua5wuBME8PsSZUH4tV1C8641dWY1Vuoi`, using [Squads' published PDA seeds](https://github.com/Squads-Protocol/v4/blob/main/sdk/multisig/src/pda.ts#L40-L55). A historical successful Squads transaction at slot `426622306` had an inner SPL transfer with this PDA as authority, proving the authorized Squads program can sign for it by CPI. This does not confer control on an outsider. `UpdateStakeConfig` without that signer failed 3010; a different signer failed 6007; account order swap failed 3007. With `sigVerify:false`, **hypothetically** marking the stored authority as signed made a no-op update succeed, but did not establish real control of this authority. A zero-cooldown update failed `InvalidCooldownPeriod` 6001. The current cooldown is 172,800 seconds (48 hours).

Exactly one current 188-byte guardian pool was found at slot `457348442`; it holds all outstanding shares, has a 0 bps commission rate, and zero accrued commission. A hypothetical-authority-signed `ClaimGuardianCommission` simulation succeeded as a no-op with **no SPL Token CPI**. Missing and wrong authority signers failed 3010 and 6007. Aliasing destination with vault or repeating the zero-accrual claim likewise moved no token; these no-op results cannot prove the destination behavior of a hypothetical positive-accrual state.

## Claims and economically liquid value

At confirmed slot `457349008`, vault balance was `5,077,228,322.127262` SKR. Outstanding shares × share price / 10^9 imply `5,052,524,986.921379` SKR of share claims. The remainder was `24,703,335.205883` SKR. An adjacent primary-RPC census of 47,578 `UserStake` accounts at slot `457349009` found 2,740 positive pending withdrawals summing to `24,703,035.205189` SKR. The roughly **300.000694 SKR** remainder and approximately 1 SKR share-count timing difference are unexplained across adjacent live slots; neither is shown withdrawable by an unauthorized account. A lagging secondary RPC index had omitted hundreds of UserStake accounts and produced a false larger discrepancy, so its sums are not used for conclusions.

At slot `457347509`, a Jupiter registry spot price near **$0.014367/SKR** marked the 5.077B SKR vault at about **$72.95M**, approximately 47.64% of minted supply. The same registry reported about **$611k** token liquidity. Read-only SKR→USDC quotes returned **$14,264 for 1M SKR**, **$63,588 for 5M**, **$111,502 for 10M**, and **$178,135 for 20M** (versus $287,347 at the spot mark). A 30M-SKR input returned `NO_ROUTES_FOUND`. Four public spot order books together displayed about **$127k** in bids within 10% of their venue-specific best prices. Quotes and visible bids are contingent and do not establish a full-vault liquidation value; off-chain books cannot settle atomically inside a Solana transaction. The asset has demonstrable small-trade value, but no tested path realizes the $72.95M vault mark.

## Same-asset atomic flashloan prerequisite

A full current-state census at slots `457347754–758` found **0 SKR mint matches** among **401 Project 0/marginfi Banks** and **647 Kamino Lend Reserves**. Direct discriminator-plus-mint RPC filters agreed, and WSOL/USDC positive controls validated the mint offsets. This is the first exact blocker: these venues have no SKR Bank/Reserve from which to construct a same-asset SKR flash-borrow leg. Therefore dust, near-liquidity, repeated-leg, full-repayment, 4,096-byte v1, and exact flash debt/share delta tests have **no executable case** in these venues. Existing zero-fee-rate KLend reserves of other mints cannot stand in for SKR, and SKR fee-rate versus fee-rounding behavior cannot be measured without an SKR reserve. A 48-hour pending withdrawal also cannot provide same-transaction repayment of a hypothetical SKR donation.

## Evidence

- `skr-program-audit/`: deployed `.so`, successful raw Withdraw transaction, current Withdraw and update simulations, primary UserStake census, reproducer scripts.
- `skr-ledger/`: archived first-party IDL, exact config and guardian accounting, current commission simulations, read-only reproducers.
- `skr-liquidity-value/`: custody and price/liquidity report, raw Jupiter quotes, public order-book snapshots, reproducers.
- `skr-flashloan/`: full lender census, direct-filter checks, read-only reproducer.

All evidence is under `composer-runs/2026-10-15`. The tests are bounded by the current deployed bytes, observed slots, available accounts, and liquid-quote routes. They establish an authorized exit and the listed rejected mutations; they do not validate an unauthorized drain.
