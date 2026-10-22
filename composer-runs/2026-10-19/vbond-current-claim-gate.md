# Validator Bonds current outsider claim gate — 2026-10-19

**Result:** No outsider withdrawal was demonstrated. A wallet-signed mainnet-beta simulation against a live, ready withdrawal request and 139.923860380 SOL stake account failed at the validator/bond-authority check, `InvalidWithdrawRequestAuthority` (6002), before the stake authority changed. No transaction was broadcast. This is a bounded result for `ClaimWithdrawRequest`, not a whole-program safety claim.

## Current deployment and value

- Program: `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4`; ProgramData: `8kiB8dpx2eB7CaHDvegbUzJLsEKjjBNA8rn2y3Th2d3S`; upgrade authority: `6YAju4nd4t7kyuHV6NvVpMepMk11DgWyYjKVJUak2EEm`; last deployed slot **410576659** ([current `solana program show` output](vbond-current-deployment.txt)).
- Fresh `solana program dump` ELF SHA-256: `3ab4353b6a5da93d494c443aa77b38b3f0a090cfe84da3fdffbc745cf9ad056a`, byte-identical to the 2026-10-15 local dump. The [current ELF](vbond-current.so) contains `ClaimWithdrawRequest` and `ClaimSettlementV2`; the dynamic result below is from this deployed program. The checked-in source is guidance, not a bit-for-bit source-build attestation.
- Composer's live [published IDL](vbond-composer-idl.json) returned version 2.2.1 and the `claim_withdraw_request` selector `30e8173414867a76`; that selector was used in the signed simulation. Composer's published IDL has 23 instructions; the local historical IDL includes one extra deprecated `claim_settlement_v1` entry.
- The fresh [read-only census](vbond-current-census.json) at epoch **1061**, slots **458746454–458746463**, found **2,363** Stake-program accounts controlled by the two nonzero `bonds_authority` PDAs across all 11 Config accounts: **9,428.599998982 SOL**. The previous 9.7k SOL ranking is stale. This is gross controlled stake, not realizable outsider gain. It also found **270** open funded settlements with **252.863111461 SOL** unclaimed (overlaps the custody total). The largest open settlement has **18.186932655 SOL** unclaimed.

## Signed live request test

The [receipt](vbond-signed-live-claim-gate.json) used withdraw request `HgjD8mWs1KyHAT7W2P1hysX3K7RuRMC2ZT5noMWctP3L` (created epoch 1032, ready at epoch 1061) and delegated stake `AWAxUgCzSmAsu15sh4rDBK3UDFGMSdC3cydZL3N5PnwY` with **139.923860380 SOL**. Its vote account `7sBYPueerpq3kKjmuimJkGr7jmiM8ZZ74pXPMEcBSxo5` was live and Vote-program-owned. The configured bond authority was `6vG7fgweSfvY7JRViG4HwKgV9u6JKhMpf2bqr6TKNjUW`; the vote node identity was `ApVnoa3r3okD1NbsHUCB7uGq32ph91o4KJVDxC41VSu6`. The signer/selected new withdrawer `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` matched neither.

The transaction was **643 bytes, 2 valid signatures**, with the wallet paying and a fresh signer for the required split-stake account. Mainnet-beta `simulateTransaction` used `sigVerify:true` and `replaceRecentBlockhash:false`; it returned `InstructionError[0].Custom=6002` and the explicit `ClaimWithdrawRequest` authority error at 35,658 CU. The System-program initialization invoked before the check is rolled back atomically. No stake transfer or authority change succeeded; observed outsider gain is **0 SOL**. `getFeeForMessage` estimated **10,000 lamports** if this failing transaction were actually submitted; no fee was paid because it was only simulated.

The [current source check](../2026-10-15/validator-bonds-deployed-1989b66/programs/validator-bonds/src/instructions/withdraw/claim_withdraw_request.rs) requires a signer matching either the bond authority or vote account node identity via `check_bond_authority`; the current ELF receipt confirms this gate for the exact live fixture. The earlier October 15 `WithdrawStake` operator test was not repeated.

## Scope limit

`ClaimSettlementV2` is public but, in the published IDL and [source](../2026-10-15/validator-bonds-deployed-1989b66/programs/validator-bonds/src/instructions/settlement/claim_settlement.rs), binds the claim amount and destination stake authorities to a Merkle proof and checks the destination's actual staker/withdrawer authorities. I did not call a live unclaimed settlement with a valid proof. The published GCS proof bucket rejected anonymous object listing (HTTP 401) and guessed object reads (HTTP 403), so a valid unclaimed proof was unavailable in this bounded pass. No conclusion about all settlement paths follows from the withdrawal simulation.

Reproduce the read-only census with `source ~/.config/stacc-ladder/rpc.env && node composer-runs/2026-10-19/vbond-current-census.js`; reproduce the signed, no-broadcast gate with the analogous `vbond-signed-live-claim-gate.js`. Neither script logs the RPC URL or wallet secret.
