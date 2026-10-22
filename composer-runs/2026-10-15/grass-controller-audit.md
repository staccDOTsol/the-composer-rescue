# GRASS staking controller: current mainnet review

**Date:** 15 October 2026. **Target:** `EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc`. All transaction executions below used read-only `simulateTransaction`; no transaction was submitted or external contact made. Simulations used `sigVerify:false` to model existing users' signer flags, which does not confer those keys on an attacker.

## Result

The target is the current upgradeable **Grass Token Staking** executable. Its ProgramData is `HZyc3e9xuPRPXyVXti863VYUeMFKYgXRC4L3aMgx71vY`, deployed at slot **295594988**; the dumped current binary's SHA-256 is `529d17360d9850fd2e915bd54ddd8b46adf7b0bfd2b15554ca708f995065b8d2`.
The Program pointer and last-upgrade slot were rechecked after the simulations at confirmed slot **457349645** and remained the same; see [eyx-programdata-final-check.json](eyx-programdata-final-check.json).

The nine originally selected off-curve program-owned authorities control **200,440,059.771140603 GRASS** at a confirmed live read. Eight are StakingPool principal vaults and one is a RewardPool vault. Helius and the public Solana RPC independently agreed on all nine vault authority/mint/balance bytes. Every one of the nine had at least one successful recent outgoing transfer directly invoked by this program. The cited [GRASS exit](https://explorer.solana.com/tx/vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v) at slot **457215347** moved exactly **73.935167354 GRASS** from the top vault; that equals its exact pre/post vault delta. This establishes ordinary custody and PDA signer provenance, not attacker access.

At a contemporaneous Jupiter spot price of about **$0.6648**, the nine balances have a **$133.25 million gross spot mark**. Jupiter reported about **$280,915 in GRASS token liquidity**. Read-only GRASS→USDC quotes for 100,000, 1 million, 10 million, and 200 million GRASS had severe and non-monotonic large-size outputs. Neither the $133.25 million mark nor the large-size quote is a reliable immediately realizable liquidation value. A precise full-balance liquid value was **not established**.

## User exit and reward paths

Current successful history and binary selectors establish `stake_tokens`, `unstake_tokens`, `withdraw`, and `claim_rewards`. The user settlement path records an unstake request with the configured **604,800-second** cooldown, then `withdraw` moves matured principal from a StakingPool vault to the signer-owned GRASS account. `claim_rewards` moves accrued GRASS from the RewardPool vault to the user and router commission accounts. The binary has no separate `settle` instruction.

A current matured request on pool `2cBniUjRr8M9wbNp91SETKtJEdhuXb5fDi89sZYiN1DQ` was a positive `withdraw` control: the pool vault decreased by **33,000,006,416,685 raw GRASS** and the rightful user's token account increased by exactly that amount; the user's pending request slot was cleared. Repeating the same withdrawal in one transaction failed on the second leg. Wrong signer, foreign destination, crossed pool/vault, wrong request index, and account aliases failed current-binary checks.

A current `claim_rewards` control transferred **106,159 raw GRASS** from the reward vault: **101,913** to the rightful user and **4,246** to the router. Four distinct pool claims transferred **1,023,953 raw GRASS** in total, with the same exact outcome in forward and reverse order. A duplicate same-pool claim failed `NoRewards`; signer, destination, pool, and vault substitutions failed. The claim advanced only that user's per-pool reward checkpoint; its scaled stake remained unchanged.

The complete instruction/account matrix, state offsets, simulation errors and byte-level state diffs are in [paths-grass-current-binary.md](paths-grass-current-binary.md), [paths-grass-withdraw-sim.json](paths-grass-withdraw-sim.json), [eyx-claim-sim.json](eyx-claim-sim.json), and [paths-grass-state-diff.json](paths-grass-state-diff.json).

## Same-asset zero-fee flashloan composition

No Project 0 GRASS Bank was returned by the mint-field lookup at slot **457347491**. Kamino Lend has GRASS Reserve `edvzA1zGyCWqsgM2EBEPhLgn9dfiqrYwJM4VwLg4wBx`. Its *decoded current config* has `flash_loan_fee_sf = 0` exactly, and its accounted available and token-supply balances both equal **1,892,492,987,128 raw GRASS** (about 1,892.493 GRASS). This is a verified zero fee rate for this reserve, rather than a dust loan whose positive fee rounded down.

Real Solana **v1** messages with inline addresses, explicit compute/data limits, and no lookup table were accepted by mainnet read-only simulation. Borrow-and-full-repay controls succeeded at 0, 1, 2, and 1,000 raw units, at one unit below available liquidity, and at the exact available balance; one unit over available failed. Borrow → matured `withdraw` → repay, `withdraw` → borrow → repay, and borrow → repay → `withdraw` all succeeded. Each gave precisely the same **33,000,006,416,685-raw authorized user payout** as direct `withdraw`. The largest envelope control added a state-neutral Memo and was **exactly 4,096 bytes**; it also succeeded. A 62-instruction v1 control with 60 self-transfer legs succeeded without changing final financial state.

In the 4,096-byte run, the Kamino supply vault was **1,892,492,987,128 before and after**, fee vault **0 before and after**, Reserve `total_available_amount` **1,892,492,987,128 before and after**, `borrowed_amount_sf` **0 before and after**, and collateral share Mint supply **1,892,492,987,128 before and after**. The GRASS staking vault fell by **33,000,006,416,685**, the signer-owned destination rose by the same amount, and the existing request was cleared. The Reserve account's full byte hash changed during processing, but these economic fields returned to their preimages. No flash principal or collateral shares were retained.

Duplicate target withdrawal, repeated flash-borrow pairs, omitted/underpaid/wrong-index repayment, reserve-supply alias, and trying to repay from the program-controlled staking vault were rejected. A one-unit flash-funded transfer *into* the staking vault before authorized withdrawal was accounted as a one-unit contribution, reducing the signer's final payout by one. The detailed case matrix and exact same-slot pre/post images are in [flashloan-grass-v1.md](flashloan-grass-v1.md) and [flashloan-grass-v1.json](flashloan-grass-v1.json).

Fresh flash-funded staking cannot use the same transaction to bypass settlement time in the tested pool. One raw unit failed the program's 0.001-GRASS minimum stake; at 1,000,000 raw and near the Kamino reserve's available balance, `stake_tokens` then `unstake_tokens` created a new pending request, but immediate `withdraw` of that request failed `WithdrawalCooldownNotEnded` (6048). An inserted `claim_rewards` returned `NoRewards` (6025). When the owner instead withdrew an *older* matured request, the new request remained locked and the net payout fell by exactly the flash-funded amount staked. These tests distinguish new same-transaction entitlement from the pre-existing authorized request.

**Validated unauthorized value movement in the tested routes: zero.** That is a finding about these controls and mutations, not a proof that the entire program is safe. The Kamino flash liquidity available here is also far smaller than the nine vault balances.

## Admin drains and remaining limits

The binary names `drain_staking_pool` and `drain_reward_pool`, alongside setup, lock, and configuration instructions. An older successful `drain_reward_pool` was found at slot **297519674**: Squads v4 invoked this program, which transferred **1 GRASS (1,000,000,000 raw units)** from the reward vault to an admin-owned GRASS account. The off-curve admin address was the Squads vault signer; this is an observed authorized admin path, not evidence of public drain access. No `drain_staking_pool` was found among the oldest 1,881 fetched admin-key transactions or the most recent 1,000 admin signatures; intervening history was not scanned.

A current-state read-only replay of the historical reward-drain account layout with a simulated off-curve admin signer failed `RewardPoolUnlocked` (6006), leaving vault balances unchanged. Removing the admin signer failed `AccountNotSigner` (3010), while replacing the admin or pool creator with an unrelated key failed `Unauthorized` (6011). The current pool's unlocked state prevents a positive drain control or evaluation of checks after that gate. The standard Anchor IDL account is absent and the binary's source-repository URL is unavailable; the staking-drain account layout and locked-pool behavior remain unestablished. See [paths-grass-current-binary.md](paths-grass-current-binary.md), [paths-grass-admin-drain-sim.json](paths-grass-admin-drain-sim.json), and [paths-grass-admin-drain-jsonParsed.json](paths-grass-admin-drain-jsonParsed.json) for the current errors, historical trace, and search bounds.

## Evidence index

- [Custody and liquid-value proof](grass-custody-and-liquidity.md): two-provider account recheck, all-nine direct signer provenance, quoted depth and caveats.
- [Current executable and user paths](paths-grass-current-binary.md): ELF identity, selectors, state types, cooldown, successful exit controls and account mutations.
- [Current same-asset v1 flashloan tests](flashloan-grass-v1.md): zero-rate Reserve proof, full repayment and share accounting, 4,096-byte boundary, repeated legs and aliases.
- [Original old-claim replay](eyx-direct-sim.json): `InvalidWithdrawalAmount` on the cited historical claimant's now-empty request, with independent account mutations.
- [Cross-artifact exact-accounting check](grass-evidence-verify.json): independently recomputes nine-vault total, cited transfer delta, claim conservation, v1 lender restoration, and 4,096-byte control.

All quoted balances, liquidity, and transaction results are observations from 15 October 2026 and can change as new blocks or upgrades arrive.
