# ORE V3 mining reward gate — mainnet-beta

Observed 2026-10-19 06:48 UTC at confirmed slot 458739088. This is a read-only, bounded gate for `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv`; no transaction or simulation was submitted.

## Result

No outsider-directed reward-vault withdrawal or same-transaction flash-amplified positive net was established. The public claim path pays only the claiming miner authority's associated ORE account, based on that miner PDA's accrued accounting. A third party may checkpoint another miner after the round is complete and, during the last 12 hours before expiry, collect that miner's stored 10,000-lamport keeper fee. The checkpoint does not direct the miner's ORE to the keeper.

## Live custody and binary gate

The treasury PDA is `45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG`. Its ORE ATA `GwZS8yBuPPkPgY4uh7eEhHN5EEdpkf7EBZ1za6nuP3wF` held **125,179.77257595884 ORE** (11 decimals). Its only other SPL Token account was a zero-balance WSOL ATA. The treasury account held 2,409.992955776 SOL in lamports, which the ORE claim handler does not use for miner SOL claims. The current round PDA `Em6wVWR1BzBiKdb13H1Ppowby9wFSDvMJFYCFpCmoBhG` held 14.675180829 SOL near this snapshot; this escrow changes every round.

Treasury state recorded 94,888.41820390352 unrefined ORE, 29,913.58184007371 refined ORE, and 369.4 ORE motherlode. These three fields total 125,171.40004397723 ORE. The 8.37253198161 ORE difference from the ATA balance is not exposed by the claim path as a generic withdrawable surplus; round minting and uncheckpointed rewards can affect the difference.

The upgradeable program still pointed to ProgramData `GXa6JV9AwsccP3hxvKFcZGp4w3MMtf7PJ6HYuTSyokfJ`, deployed at slot 452682055 (2026-10-02 17:48:28 UTC). The current dumped ELF SHA-256 is `b16a10029a35e709956cfe42c4dc51cf2c59522f477eba10816a40bcaa7dd5bd`; it contains the `claim_ore.rs`, `checkpoint.rs`, `buyback.rs`, and `wrap.rs` runtime strings observed in transactions. The source checkout at commit `48c203bd75db3cc45105ec29d8f8db719e5a2263` predates deployment by about 17 minutes and names the same program ID. The [published IDL](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/api/idl.json) confirms the claim discriminator and accounts, but omits the optional claim BPS field present in the source and live instruction data. **The source was not reproduced byte for byte against the ELF**, so source-only conclusions are bounded by the runtime/account evidence.

## Postdeployment parent outflows

The 2026-10-15 gate's three parent outflows all resolve to named handlers:

| Signature prefix | Vault outflow | Handler and destination |
| --- | ---: | --- |
| `3EqTFF4…` | 0.00224479360 ORE | `ClaimORE` discriminator 4; signer `DzTwz…`, miner PDA `2Ymt…`, recipient `AJpd…` is that signer's ORE ATA. |
| `51rcqF4…` | 0.00677650864 ORE | Same signer, miner PDA, recipient, and handler. |
| `3sZdASz…` | 0.51722959692 ORE | `Buyback` discriminator 13; signer is configured bury authority `HNWh…`; 5.95 WSOL became 5.1722959692 ORE, 10% went to the staking treasury `BHnZ…`, and the remainder was burned. |

The 12 latest sampled vault signatures at the live gate include further miner claims and no unexplained ORE-vault outflow. The first two historic claim transactions' ORE account deltas match their inner token transfers exactly. The third transaction's swap, staking distribution, and burn logs match the published buyback handler.

## Reachability and flash economics

`ClaimORE` requires the signer, derives the miner PDA from `["miner", signer]`, checks the stored miner authority equals the signer, fixes the treasury PDA and its ORE ATA, and requires the recipient to be the signer's ORE ATA. `Miner::claim_ore` can pay only recorded `refined_ore` and `rewards_ore`, less the refining fee on unrefined rewards. `ClaimSOL` likewise derives the signer's miner PDA and transfers from that miner account to the signer. The permissionless `Checkpoint` credits previously deployed miner accounting and returns SOL to the miner authority, miner account, or that miner's automation account; only the bounded keeper fee can go to another signer. [Claim handler](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/claim_ore.rs), [miner accounting](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/api/src/state/miner.rs), [checkpoint handler](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/checkpoint.rs), [SOL claim handler](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/claim_sol.rs).

Flash-borrowed ORE is not an input to the miner reward ledger: `bury` transfers the sender's ORE, distributes 10% to stakers, and burns 90%; `buyback` and `wrap` require `HNWh…`. Flash-borrowed SOL deployed into a new round cannot be returned through reset/checkpoint in the same transaction: live config has **300 round slots plus 60 intermission slots**, while `Deploy` requires `clock.slot < board.end_slot` and `Reset` requires `clock.slot >= board.end_slot + intermission_slots`. A Solana transaction has one fixed slot. At slot 458739088 the board tracked round 445856, start 458738838, end 458739138. [Deploy](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/deploy.rs), [reset](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/reset.rs), [bury](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/bury.rs), [buyback](https://github.com/regolith-labs/ore/blob/48c203bd75db3cc45105ec29d8f8db719e5a2263/program/src/buyback.rs).

Independent ORE→USDC Jupiter quotes near slot 458738100 showed an external DEX route for 1 ORE at 112.00 USDC, 1,000 ORE at 105,250.42 USDC (~6.1% quoted impact), 5,000 ORE at 421,197.33 USDC (~24.8%), and 10,000 ORE at 521,053.96 USDC (~53.5%). The full vault amount was quoted at ~99.3% impact and is not a credible liquidation mark. These are read-only routing estimates, not executable settlement or flash-profit proof. An earlier authority crosswalk showed only ~408.336 ORE in a same-mint marginfi vault, and no ORE reward amplification path to use it.

## Evidence and limits

- [Live RPC snapshot and sampled parsed transactions](ore-v3-readonly-gate.json); [read-only collector](ore-v3-readonly-gate.js); [current ELF](ore-v3-current.so).
- [Independent exit quotes](ore-v3-exit-quotes.json); [original parent activity gate](next-controller-activity-gate.json); [same-mint flash crosswalk](mainnet-token-authority-flash-crosswalk.json).
- This is a current-state/source gate, not exhaustive formal verification. The program is upgradeable; a new deployment, another program's vulnerable CPI authority, or a different liquidity route would require a new gate. No `hooked.json` simulation was run because no concrete outsider-controlled profit path passed the source and live-account gates.
