# Next Solana controllers outside the verified-token top-holder census

Read-only evidence refreshed at Solana slot **457,360,017** for executable status. Native-stake balances were independently rechecked by exact withdraw authority at finalized slots **457,358,593–457,358,610**. No transaction was submitted.

## Discovery scope

- Jupiter Token V2 top-100 traded lists across 5m, 1h, 6h, and 24h yielded **63 unique mints absent from the 3,987-mint verified registry**. Their top-20 read returned 1,220 token-account addresses, 1,120 current mint-bound accounts, and 111 off-curve authorities. All 8 direct executable state owners were already in the prior controller census; **zero new program IDs** from this bounded token lane.
- The earlier native Stake scan read 1,454,190 initialized/delegated accounts across 256 filtered shards. Its Helius archive endpoint disagreed materially with the fresh finalized live RPC. Rankings below use **only the fresh exact-authority recheck**.
- The optional dollar marks below use Jupiter wrapped-SOL spot $105.935506 at price block 457359884. They are price-times-native-balance signals only.

## New dedicated targets ordered by bounded native value

| Rank | Current executable controller | Selected controlling state | Bounded native custody | Historic direct Stake CPI evidence |
|---|---|---|---:|---|
| 1 | `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE` (Solana single-validator stake pool) | `Eip8KPQ2KcPxUoHHroccZQed4Qaz6Eqr9wf1nUTrnJh4`; authority `E7c64FTgM5hHHNk2t2BzikarqT36dxRSAyR1ac25uy28` | **37,508.017 SOL** (~$3.97M spot) | Successful inner Stake `moveLamports` from this program, slot 457043372, tx `4msXjLBsZPppwwEEnFnrPhZgYpjAAwr8ckvaWAvYnEpVLwJ7Ay8NrV55RMX1M41fJ9KdmoQsnnuF2BDYcraaBDiM` |
| 2 | `vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4` (validator bonds) | `vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU`; authority `7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH` | **9,755.660 SOL** (~$1.03M spot) | Successful inner Stake `withdraw` from this program, slot 457254708, tx `649NZbtHduLdJGdZNzwEUb5jWCa9NJSeiKXpa5h5fcarJu7VjWVFDG63U6YPtk93HKNA4GoZLgXYRWpg5a3g84t9` |
| 3 | `2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo` (2rU1o liquid unstaker) | `9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb`; authority `9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb` | **1,285.383 SOL** (~$0.14M spot) | Successful inner Stake `deactivate` from this program, slot 457346099, tx `5ioVybqKv68QGWvijbBLrmbZHSEKU8oZR23G6UH3M6rSj3VJN3Z6jLFXk5vqgE5fi6FD2V7kLRqJjie98RHnxA99` |

The single-validator controller has 57 canonical verified pool PDAs holding 37,505.293 SOL of stake plus 2.724 SOL in onramp stake accounts. Validator Bonds has 11 decoded configurations with 9,755.660 SOL of Stake accounts and a verified `bonds_authority` PDA. The 2rU1o pool PDA is program-owned and currently governs only 593.392 SOL across 63 stake accounts; its separate derived SOL vault held 691.992 SOL. Full account and seed evidence is in the machine file and `native-secondary-finalized-recheck.json`.

## Correction to earlier custody marks

The older archive-RPC snapshot reported 2rU1o at **48,493.545 SOL** (2,542 Stake accounts), but the current live-RPC exact-authority finalized query returns **1,285.383 SOL** (63 Stake accounts plus the SOL vault). The earlier Validator Bonds mark was **13,401.364 SOL** versus a fresh **9,755.660 SOL**; single-pool remains ~37,508 SOL. The older numbers must not be used as current custody marks.

The archive RPC still returned 2,543 2rU1o Stake accounts at finalized slot 457,356,280, while the live RPC returned 63 at slot 457,359,742. All three stored old 2rU1o examples are absent on both live and public RPC. One old example’s most recent indexed signature is slot 425,088,479; only 4 transactions mentioning the pool are indexed after the archive snapshot, and all four have zero inner Stake instructions. The evidence does not support assuming a recent 47,000 SOL withdrawal. Provider account-index lag or inconsistency is the leading explanation; the exact cause is not proven. The fresh finalized state is the ranking source.

Public Solana RPC independently matched the largest selected live stake-authority buckets: SVSPx 34,278.037 SOL across 2 accounts, and Validator Bonds 7,267.969 SOL across 1,388 accounts. These crosschecks confirm the main buckets, not every pool in those families.

A current executable owner, PDA derivation, and historical signed Stake CPI support **program control of those specific accounts**. The 2rU1 example is a `deactivate` (control) rather than a direct lamport spend; the single-pool `moveLamports` and Validator Bonds `withdraw` examples moved lamports. None shows that an unauthenticated caller can redirect or withdraw value. Stake timing, voter/depositor claims, guard conditions, and complete atomic transaction economics remain untested. The SOL spot marks can overlap LST receipt claims and are not estimates of realizable drain or liquid exit capacity.

## Remaining denominator gap

The token pass does not cover all unverified mints or token accounts below each mint’s top 20. The Stake census excludes System-owned native SOL accounts and cannot assign every off-curve withdraw authority to a program. A fresh finalized recheck resolved two formerly unattributed high-balance groups as **Squads v4 treasury vaults**: `FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm` governs one Stake account with **51,479.873529770 SOL** through vault index 1, and `9j7f4Y6MqauTRm9RRJwzQeMkqZ8GS3FsXF7hs4nD6ugA` governs 61 Stake accounts with **19,670.089836720 SOL** through vault index 0. Exact PDA derivations and historical Squads Stake CPIs establish those controllers; the separate Marinade Native authority on the second group is only its staker, not its withdrawer. These groups are not unattributed application escrow or outsider withdrawal candidates. Other small off-curve authorities may still lack attribution; a rooted chain-wide account/inner-CPI index would be required for exhaustive coverage. [Live recheck and controller proof](two-native-stake-groups-live-recheck.md).

## Evidence

- [`nonregistry-next-candidates.json`](./nonregistry-next-candidates.json): compact ranked rows and exact selected state/proofs.
- [`unverified-active-token-controller-census.json`](./unverified-active-token-controller-census.json): token-level and authority-level read-only data.
- [`native-stake-secondary-controllers.json`](./native-stake-secondary-controllers.json): older stake decoding and PDA seeds, preserved for provenance.
- [`native-secondary-finalized-recheck.json`](./native-secondary-finalized-recheck.json): fresh exact-authority finalized account sets and sums.
- [`native-secondary-provider-discrepancy.json`](./native-secondary-provider-discrepancy.json): archive/live/public finalized crosscheck.
- [`native-stake-residual-triage.json`](./native-stake-residual-triage.json): historical inner Stake CPIs.
