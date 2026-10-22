# Jupiter YOLO rare payout and fee handlers (2026-10-19)

Program: `yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA` on Solana mainnet-beta. Inspected ELF SHA-256: `c75637981b6731d8719d8521e93176e00dc5f74d861413ba1475a6af84c9d9c4`. All transactions below used `simulateTransaction` with signature verification; none was broadcast.

## Mainnet evidence

- The current ELF dispatcher recognizes `ProcessPayout` selector `30c08139e6a1e994` and `WithdrawFees` selector `c6d4ab6d90d7ae59`. Neither appeared among the six selectors in Composer's latest 1,000 parsed transactions (`yolov-rare-composer-10000.json`: 1,000 transactions / 2,465 instruction samples; the endpoint capped the requested 10,000 signatures at 1,000).
- `WithdrawFees` deserializes an eight-byte argument and expects nine accounts, in this order: `fee_receiver`, `config`, `pool`, `vault`, `usd_mint`, `destination`, `token_program`, `event_authority`, `program`. A signed simulation at slot 458741836 supplied genuine config/pool/vault/mint, an initialized JupUSD destination, and our wallet as `fee_receiver`. Account validation failed before business logic: `fee_receiver ConstraintAddress` (2012), with expected address `A2rCQdCqQB4wu72x9Q7iq1QugtdZmcyWsiSPfgfZzu2u`. Evidence: `yolov-rare-fees-9-8-probe.json`. This rules out a straightforward outsider fee withdrawal by substituting the receiver; it does not analyze a valid operator-signed call.
- `ProcessPayout`'s nine accounts are `pool`, `claim`, `destination`, `owner`, `vault`, `usd_mint`, `token_program`, `event_authority`, `program`. The unfiltered account census at slot 458741977 found 43,957 YOLO-owned accounts: 43,952 Positions (two sizes), three Markets, one Config, and one Pool. It found no live payout claim. Evidence: `yolov-economics-type-census.json`. Thus there was no genuine claim on which to run a positive mainnet payout simulation at that snapshot.

## Local mainnet-fork experiment (synthetic state)

These results are control-flow evidence only. A local Surfpool fork fetched the deployed program and real pool/vault/mint, then `surfnet_setAccount` altered only the local fork:

1. Created a synthetic YOLO-owned claim at `HnwbVZnyABatwWdjuCJTKPuBR1aaGjp8wdXrQ5WQcnPn` with the expected discriminator `59c9f09ad4ff485c` (also present in the ELF near the Pool account discriminator). Its queue index at byte offset 8 was set to 17, owner pubkey at offset 16 to our wallet, and amount at offset 48 to 1 micro-JupUSD.
2. Set the local pool's pending amount at offset 32 to 1 and queue tail at offset 48 to 18; queue head at offset 40 was already 17. Its real mainnet pending amount and head/tail were 0 and 17/17.
3. Changed one initialized JupUSD token account's local owner field to our wallet, so it could serve as a valid destination. The mainnet account was not changed.

The guard progression was informative: a claim with the wrong discriminator failed `AccountDiscriminatorMismatch`; a queue index different from pool head failed `InvalidQueue`; a destination owned by someone other than the claim's owner failed `ConstraintTokenOwner`; an amount of 1 with pool pending balance 0 failed `InsufficientFunds`. With consistent synthetic values, the signed local simulation succeeded and emitted an SPL Token `transferChecked` CPI for **exactly 1 micro-JupUSD** from the real vault to the synthetic destination, authorized by the Pool PDA. The post-simulation pool pending amount was 0, head/tail 18/18, the claim was closed, destination balance increased by 1, and vault balance decreased by 1. Evidence: `yolov-rare-claim-type-fork.json`, `yolov-rare-claim-layout-fork.json`, `yolov-rare-payout-9-0-fork-probe.json`, `yolov-rare-payout-cpi-fork.json`.

The synthetic success does not establish that outsiders can create a valid claim or redirect payout on mainnet. In the observed path, destination ownership and pending-balance/queue checks prevented those simple variants. No validated drain was found in these two rare handlers. An actual claim creation path and a genuine operator-signed fee withdrawal remain untested.
