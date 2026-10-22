# 5ok-linked native SOL and stake authority surface

Read-only mainnet observations on 15 October 2026. No transaction was signed or submitted. Simulations used `sigVerify:false`, so one-key results are conditional on possession of one existing authorized operator key. This report counts current account authority, not any hypothetical authority gained by uploading new code after a program upgrade.

## Direct PDA accounts

At confirmed slot 457351290, exact PDA derivations and live state established three relevant addresses:

| Address | Exact derivation and owner | Lamports | Current direct native control |
|---|---|---:|---|
| `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi` | `['multisig']` of wrapper `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu`, bump 254; System-owned, zero data | 24,811,787,527 | Wrapper generic CPI signs this PDA. Prior read-only full-balance System transfer succeeded with one aliased operator key. |
| `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK` | `['bridge']` of `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9`, bump 252; bridge-owned 73-byte `BridgeInfo` | 1,721,786 | Program-state rent. The wrapper does not sign this PDA directly. Existing bridge token-unlock logic signs it for a Token CPI, but no arbitrary System transfer from it was established. Excluded from directly liquid SOL. |
| `4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB` | `['bridge']` of second bridge `3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8`, bump 253; bridge-owned 73-byte `BridgeInfo` | 1,398,960 | Program-state rent; likewise excluded from directly liquid SOL. |

Both bridge states store `5okKWzQ6...` as their authorized bridge signer. The current wrapper's tested generic CPI signer is `5okKWzQ6...`; merely deriving the two bridge PDAs does not grant a direct wrapper System CPI signer for those addresses.

## Exact authority-filtered current accounts

`getProgramAccounts` scanned the canonical Stake account `staker` bytes at offset 12 and `withdrawer` bytes at offset 44 for all three PDAs. All **six** scans returned **zero** accounts at confirmed slot 457351290. A live delegated-stake positive control returned its known account through the same withdrawer filter, with decoded state matching the filter. This is an exact zero for those six authority-field sets at the observed slot, subject to normal RPC indexing correctness and between-slot chain change.

For Vote-program accounts, exact authorized-withdrawer filters at offset 36 returned **zero** for all three PDAs at slot 457351291. A live vote account positive control returned its known address from the same filter at slot 457351301. This count concerns the vote *withdrawer* field only, not historical or dynamic authorized-voter entries.

Upgradeable-loader Buffer authority filters at offset 5 returned **one** account for `5okKWzQ6...`, and zero for the two bridge PDAs, at slot 457351291. The one account is `AXCknCf7KmCWAv4De6vg89hRBcZvBrAwinKSBipXgcSg`: loader Buffer variant 1, authority option tag 1, authority exactly `5okKWzQ6...`, with **3,105,642,680 lamports (3.105642680 SOL)**. In a read-only wrapper→loader `Close` simulation, `[A,A,C]` with one required A signature closed the Buffer and increased A's balance by exactly 3,105,642,680 lamports. The distinct-slot `[A,B,C]` A-only control failed `InvalidArgument`; the live Buffer remained intact afterward. This is an additional directly liquid SOL account, distinct from the 5ok System account and from the three ProgramData accounts.

The separate exact ProgramData census found three loader ProgramData accounts whose upgrade authority is `5okKWzQ6...`; one-key `Close` simulations released a combined **8,913,226,560 lamports (8.913226560 SOL)**. Those closures disable the linked executables and are documented in `5uums-surface-programdata.md`. Executable Program-account rent and both bridge-state rents are excluded from this spendable figure. The three independently demonstrated native amounts are 24.811787527 SOL at 5ok, 3.105642680 SOL in the Buffer, and 8.913226560 SOL in ProgramData, totaling **36.830656767 SOL as a conditional independent-case sum**; an end-to-end sequence of all three classes was not simulated.

## Durable nonce uncertainty

System-owned durable nonce accounts can store an authorized pubkey at offset 8 and may hold withdrawable lamports. For each of the three PDAs, a `getProgramAccounts` query with exact 80-byte account size and authority bytes failed at Helius with `Too many accounts requested`. Helius `getProgramAccountsV2` returned zero matching rows in each of the first two cursor pages requested at limit 1,000 **but supplied a further pagination key**, so those zero samples do not establish a zero account count. Flux rejected the filtered System-program query with `Key excluded from account secondary indexes: getProgramAccounts disabled for this endpoint`. Thus the durable-nonce authority class is **unresolved**; it is not included in any exact account total or SOL estimate. Completing it requires an indexed System-account export/query or exhausting the provider's much larger underlying cursor stream. Native SOL accounts with no separable authority field are controlled by their own address; the exact directly signed System-owned PDA here is 5ok.

## Evidence

- `5uums-surface-native.js` and `.json`: PDA derivations, live accounts, six Stake scans, three Vote withdrawer scans, loader Buffer scans, positive controls, and bounded nonce pagination evidence.
- `5uums-surface-native-buffer-close.js` and `.json`: positive and negative wrapper→loader Buffer-close simulations and unchanged chain re-read.
- `5uums-wrapper-generic-probe.json`: earlier full-balance System transfer from 5ok under the same one-key alias.
- `5uums-surface-programdata.md` and `5uums-surface-programdata-close.json`: separate exact ProgramData census and close simulations.
