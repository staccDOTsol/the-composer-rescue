# 5UuMS / 3LWzk direct token-authority census

Read-only mainnet census generated 2026-10-15 19:19:12 UTC. The [JSON evidence](./5uums-surface-token-census.json) contains every returned token account, its exact raw balance, decimals, mint supply, owner, delegate, close authority, account state, extension types, canonical ATA check, and every RPC scan and slot. The [script](./5uums-surface-token-census.js) reproduces the calls. No transaction was built, signed, or submitted.

## Exact owner-indexed sets

`getTokenAccountsByOwner` with `commitment: confirmed` completed for each of three PDAs and both token programs. The six RPC responses span slots 457351588–457351608; each response is complete at its recorded slot. Their union is a near-current census, not an atomic single-slot snapshot.

| Token authority | SPL Token | Token-2022 | Total | Distinct mints |
| --- | ---: | ---: | ---: | ---: |
| Wrapper signer PDA `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi` | 2 | 0 | 2 | 2 |
| 5UuMS bridge PDA `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK` | 33 | 1 | 34 | 34 |
| 3fov bridge PDA `4kNkeveV4WoKYmncSe4KoUW9umwQHSA8prH7acM1uxwB` | 0 | 0 | 0 | 0 |
| **Deduplicated total** | **35** | **1** | **36** | **34** |

All 36 are canonical associated token accounts for their respective PDA, mint, and token program. All 36 are initialized, nonzero, and have no delegate or close authority in their decoded current account data. The 34 referenced mints were fetched separately at confirmed slot 457351612: 32 have neither mint nor freeze authority; one has an unrelated freeze authority (`4QmSC1C4...`), and one has an unrelated mint authority (`7DHJrhWB...`). None of these 34 mints has any of the three PDAs as mint or freeze authority.

The two wrapper-owned ATAs hold 1,000.000000 `GfbcPEhUcrMHJ2vqwbSvEAWVFR5owwAD8mRrKhUzpump` and 480,376.000000 `M1NEtUMtvTcZ5K8Ym6fY4DZLdKtBFeh8qWWpsPZiu5S`. Both mint types also have distinct bridge-owned ATAs; count those mint types once in the 34-mint union. The Token-2022 bridge ATA `J442s9EfZfwRyVgHnejqr2idnvzwep7azCPSuxvfkwPy` holds 1,000.000000 `6e2N14Anof9q5i4C8RCpDfAGBvhEC8wr5KEurRwNpump`; its account has `ImmutableOwner`, and its mint has `MetadataPointer` and `TokenMetadata`. The mint and freeze authorities are null. Its ownership alone does not establish that the legacy bridge `Unlock` path accepts Token-2022.

The known MIM, DOG, and PUPS vaults are among the 33 legacy bridge ATAs, not three additional accounts. The JSON lists the other 30 legacy bridge ATAs and their exact balances. This census establishes token-account ownership. Spending from the bridge PDA still depends on a reachable bridge-program instruction that signs its own PDA; generic wrapper CPI signs only the wrapper PDA `5okKWzQ6...`. Do not treat every owner-indexed balance as a demonstrated withdrawable amount or liquid dollar value.

## Incomplete global authority classes

- The [Solana indexed delegate method](https://solana.com/docs/rpc/http/gettokenaccountsbydelegate) returned zero for each PDA/program pair on the HEAVY RPC endpoint, but that endpoint was at slots 457348105–457348117, roughly 3,500 slots behind the owner-indexed responses. It returned those older slots even with `minContextSlot` set to the corresponding owner-response slot. The current-slot delegate count is therefore **unknown**. The main endpoint returned `Method not found` for `getTokenAccountsByDelegate`.
- Global token-account **close authorities** and global mint **mint/freeze authorities** cannot be asserted as zero. On both token programs, the main endpoint rejects selective `getProgramAccounts` filters with `Too many accounts requested (Large number of pubkeys)`. Its `getProgramAccountsV2` first page with a 10,000-account limit returned zero matches **with a non-null continuation key** for every PDA/field pair. Per [Helius pagination documentation](https://www.helius.dev/docs/api-reference/rpc/http/getprogramaccountsv2), the continuation must be exhausted before a zero claim. The HEAVY endpoint rejects `getProgramAccounts` as `Key excluded from account secondary indexes`.
- The bounded first pages confirmed no *additional* close-authority accounts or PDA-authorized mints, but the unvisited pages make their global totals **unknown**. The 36 owner-indexed accounts themselves have null close authorities, and their 34 mints' authorities were verified directly as above.

No live transactions, outside-party contact, or prices were involved in this token census.
