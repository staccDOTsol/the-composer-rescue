# Defensive Solana mainnet audit: `GovER...` selected PHY vaults

Date: 2026-10-15  
Scope: immediate, permissionless outsider drain only  
Primary finalized snapshot: slot `457354754`, block time `2026-10-15T19:30:26Z`

## Verdict

**No validated immediate outsider unauthorized-drain path was found. Finding count: 0.**

At the observed state, an arbitrary external signer cannot debit either selected PHY vault, cannot attach or execute a foreign transaction record, cannot create/approve the governance state needed to make the governance PDA sign, and cannot upgrade the current executable. The exact deployed binary was exercised on a current-mainnet local fork. It successfully transferred each vault's complete live balance only after the fork was deliberately given a synthetic, internally consistent approved proposal/transaction pair. The same binary rejected every live-state outsider attempt before any balance changed.

This is a point-in-time conclusion. Council-authorized governance or upgrade activity is real operator authority, not an outsider exploit, and is outside the requested finding class.

## Assets and binary identity

Program: `GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw`

- Upgradeable-loader ProgramData: `BZYjZ2ZbtAawP9WPt5yXszcoMWTvNFFX4AMbnDojtSGL`
- ProgramData SHA-256: `4883f3d5a000a52c6e82cb903479c74809e014dd834761a66c4822bb121e781a`
- ELF length: `1,319,856` bytes
- ELF SHA-256: `68e0654bc6be35a99b244ddc6d6f37ee963671a375b503e87d27a61ed565dd03`
- Embedded runtime version: `3.1.7`
- Last deployment: slot `453601996`, `2026-10-05T14:09:33Z`
- Current upgrade authority: `HF7gCq7BMB6cFfhharTGGm31sqDdpmvLTgF4WEoW8y9n`

PHY mint: `EswgBj2hZKdgovX2ihWSUDnuBg9VNbGmSGoH5yjNsPRa`, legacy SPL Token, 9 decimals.

| Governance authority | Vault | Raw amount | PHY | Prior nominal USD |
|---|---|---:|---:|---:|
| `6Va7K51FRbnPcYZTUwkoFfoYtnfh8qyJaZqT4W1GGxVi` | `C2KKuAq4UaUFYtm3zcxZMSDUuSEfPSk4yLcq5XaBr4wM` | `450000000000000000` | 450,000,000 | $25,194,630.43 |
| `2jfAMh48b37bBTKkoNwmvNZAqVQc1G7gh5vYv5FoWTUR` | `8vXYj8B567R8Di7BUvquiGC7usyPMtL756xx6KERfW9K` | `359127679505000000` | 359,127,679.505 | $20,106,864.81 |
| **Combined** | | `809127679505000000` | **809,127,679.505** | **$45,301,495.24** |

Both vaults have the listed governance PDA as their exact token authority, with no delegate and no close authority. The dollar values reproduce the supplied/prior nominal valuation (~$0.055988/PHY); they are **not** claimed as realizable proceeds. No current executable exit route, depth, slippage, reverse swap, or net-equity realization was demonstrated.

## Authorization map

```text
PHY vault
  -> exact SPL-token authority: GovernanceV2 PDA
     -> executable only through an approved program-owned proposal transaction
        -> target realm council vote/owner-or-delegate signatures

GovER program upgrade
  -> upgrade authority: native-treasury PDA HF7g...
     -> controller GovernanceV2 6rFUn... under GoVERLM...
        -> controller realm council vote/owner-or-delegate signatures
```

The selected authorities are exact PDAs of `GovER...`:

- `6Va7...`: realm `DsWWtZrqXBcqTTPoEyFH793Euq82r95CuXWTwqo3JZur`, governed-account seed `8nu1MannRGCWRY2KL1R8oJDvDEu9BfQeJEAH9DWjnu2W`, bump `255`.
- `2jfA...`: the same realm, governed-account seed `KbEVSvezVUUNJX153r9sBu7E5GNJZwL5sFdkbTUkdPE`, bump `254`.

Both re-derived addresses match exactly. They are not externally signable keys.

The target realm is `DsWW...`, named `Physis Foundation Quorum`:

- Community mint `ibCiJd3QA5uDpbzcrSQqotpBfevosSXaWoFa6ak4Z8j`: supply `0`; community voting disabled; minimum community proposal weight `u64::MAX`.
- Council mint `7XenHd1YS1ae6BzUwEnDWiX1E3KR9aje5HcGdVJD4gPp`: supply `8`; council proposal minimum `1`; approval threshold `60%`.
- All eight council units are in realm holding `CRJS6HHAmrtL8KjC5XPBn1oYgQdcQs5vCeKcPSBCDvYF`. Eight TokenOwnerRecords each have deposit `1`; the remaining record has deposit `0`. Every governance delegate is null.
- Both governance accounts report `activeProposalCount = 0`.

Seven target proposals exist. Five are `Succeeded` but contain zero transactions. Two are `Completed` and contain one legacy transaction each, already executed with `Success`:

- Proposal `G5zTYYmtjMuossZZ2QUUKX11sMXXBJYLoJpYsDGKYvo7` / transaction `2yh3srnymhEnfJt2aQ8FCuSBgpPzpq3BgnwEX3ZKSGdG`.
- Proposal `AsFXq3TDNn174eMfcQg8nmisMJeogmgWzFwJ1kY9x9zt` / transaction `GGudseLF1TaepTx8PvTQybbowXb7QiE5Lzm6f6BiYVHh`.

There are zero live `ProposalVersionedTransaction` children. An outsider cannot write a program-owned proposal record, and insertion requires a draft proposal plus the governing token owner/delegate authorization. Consequently, neither the legacy nor versioned permissionless execute entry point supplies outsider discretion over the stored message.

## Exact-current-binary fork results

The local fork loaded a ProgramData image whose full and ELF hashes exactly matched the finalized snapshot. The final replay baseline was slot `457362030`. Every packet was a signed atomic v1 packet with `sigVerify: true`, a fresh ephemeral attacker, no address lookup table, and no mainnet submission. All cases were below the requested `4096` bytes / `64` accounts; the maximum was `581` bytes / `14` accounts.

| Case | Packet | Exact result | Balance effect |
|---|---:|---|---|
| Direct full-balance transfer, vault 1 | 290 B / 5 accts | `MissingRequiredSignature` | none |
| Direct full-balance transfer, vault 2 | 290 B / 5 accts | `MissingRequiredSignature` | none |
| Both full-balance transfers in one atomic v1 packet | 402 B / 8 accts | `MissingRequiredSignature` at instruction 0 | none |
| Permissionless retry of each completed transaction | 514 B / 12 accts | custom `524`: `Invalid State: Can't execute transaction` | none |
| Splice each live zero-transaction `Succeeded` proposal to a foreign transaction | 514 B / 12 accts | custom `510`: `Invalid Proposal for ProposalTransaction` | none |
| Synthetic authorized full-balance control, vault 1 | 382 B / 8 accts | success, 19,937 CU | `-450000000000000000` / `+450000000000000000` |
| Synthetic authorized full-balance control, vault 2 | 382 B / 8 accts | success, 19,922 CU | `-359127679505000000` / `+359127679505000000` |
| Retry controller's only executable-error record without its fixed signer | 581 B / 14 accts | `PrivilegeEscalation`, 30,589 CU | none |

The two successful controls are deliberately synthetic fork-only state mutations. They prove that the **current deployed ELF can spend the complete live balances when its real authorization invariant is satisfied**. They do not assert that such authorization exists live. Each simulation rolled back, and the synthetic records were restored.

## Upgrade path

`HF7g...` is a system-owned, zero-data, off-curve PDA, not an EOA. It re-derives as the `["native-treasury", 6rFUn...]` PDA (bump `250`) of controller program `GoVERLMGbGF8kwAwhyNgF1BQ2uyQPawHCWbnFRmLZCf`.

The controller's ProgramData is `88BR3U9Hy27JvUVZjuHEATABq4dnKJew1jv8B7kgBXuN`, ELF SHA-256 `412d9f905040649fce8d6b88c73c0925ae69fb951d9c874ff29dcd3fa8222984`, and has the same PDA as upgrade authority. Its governance is `6rFUnQik5dhUsxJaxN2dKGJRD3cX8kQM3cyLD1kbaoCF` in realm `2r7VSeKzyepHbdGUsZir94fpZgxBRG2xqgaMnbEALL6r` (`Realms Security council 8`). Community voting is disabled. Its community mint has supply `0`; all `7` council units are in realm holding `8vnzBvoHLzWwGzTeHP78tXRAQLYsq5vpytFKnGrPszck`.

The current target deployment is transaction `AQvkNBnifPJJw9Ye2edZkjxYUucokWZUwmdVTEhCZe6p5soWYQFS4H1jVVAxjDB3kUmGXV7yssSaonvs5mjdRgD`, controller proposal `AcKFVDpM5PMsyxHYwTtvJ2gf4ig7CUTzQC61j4KSJdMz`, and transaction record `GiNdPQiW5jiLJMYsPMkc47eZwdS6PBa6mrDDb5r84Q3g`. The outer controller invocation caused the native-treasury PDA to sign the inner loader upgrade; the PDA was not a transaction signer.

The controller has 34 proposals: 23 `Completed`, 9 `Cancelled`, 1 `Defeated`, and 1 `ExecutingWithErrors`. The sole remaining executable-state record is proposal `6cxVviQHwZd9119zbraPkohtJxNmsCrsGLA3qwohXzeW`, transaction `4XT3sX2DC6LFYrE4iiK7DbXhMLciAfifxU3YUyMZccWP`. Its fixed message adds a member, does not reference the target program or vaults, and requires external signer `GJdRQcsyz49FMM4LvPqpaM2QA3yWFr8WamJ95hkwCBAh`. The outsider replay failed with signer privilege escalation. No unexecuted loader upgrade exists in an executable proposal state.

## Flash-liquidity and composition closure

Every plausible outsider candidate was classified before wrapping:

- Direct token spend needs the existing governance-PDA signature; borrowed capital cannot provide it.
- Stored-transaction execution needs a program-owned, proposal-bound record in an executable state; borrowed capital cannot create or rewrite it.
- New proposal/insertion/voting needs the exact council membership mint and owner/delegate signatures.
- Upgrade-controller retry needs a fixed external signer and fixed stored accounts; it is not capital-sensitive.

Provider inventory was performed for PHY plus all four governing mints against KLend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` and Project0/marginfi `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`, at finalized slots `457362191`–`457362202`. Matching reserves/banks were `0` for every mint.

The stronger blocker is total-supply conservation, which covers AMMs and every other possible provider, not just those two lenders:

| Required authorization asset | Supply | Positive external provider inventory |
|---|---:|---:|
| Target community mint `ibCi...` | 0 | 0 |
| Target council mint `7Xen...` | 8, all in realm holding | 0 |
| Controller community mint `EtHc...` | 0 | 0 |
| Controller council mint `ACVq...` | 7, all in realm holding | 0 |

Therefore there is no exact-governing-mint reserve, bank, pool, lender, or other positive token account from which a single-, dual-, tri-, or maximum-source route can borrow or buy authorization. Exact available, available−1, available+1, asymmetric, and max-joint tests have no provider account or nonzero capacity to parameterize. Minting new units requires the existing mint-authority signature and is operator-only. PHY itself is not a governing token; unrelated USDC/wSOL/PHY flash capital cannot manufacture a PDA signature, external fixed signature, or program-owned proposal state.

For that concrete reason, full repayment, reverse-swap, and net-equity tests are **not applicable and were not fabricated**. There is no capital-sensitive live outsider action to place between borrow and repay. This is an authorization/no-source blocker, not a packet-size or compute-limit blocker.

## Bounded vault history

Every finalized signature returned for each vault (limit requested: 1,000) was fetched and decoded:

- `C2KK...`: 3 signatures, slots `189510112`–`189510588`; creation, then `+300000000000`, then `+449999700000000000` raw PHY. No successful debit.
- `8vXY...`: 2 signatures, slots `189677291`–`189677633`; creation, then `+359127679505000000` raw PHY. No successful debit.

This is complete for the RPC-returned account history and bounded by those oldest/newest slots; it is not presented as an archival guarantee beyond what the RPC returned.

## Reproducible evidence

Principal artifacts:

- `current-snapshot.json`: finalized program, ProgramData, mint, and vault bytes/hashes.
- `spl-governance-current.so` and `current-binary-evidence.json`: exact current ELF and embedded version/guard evidence.
- `governance-graph-raw.json` / `governance-graph-decoded.json`: target realm, governance, proposals, owner records, and children.
- `upgrade-path.json` and `upgrade-control-graph-*.json`: loader authority and controller governance chain.
- `vault-history-traces.json`: all returned vault transactions and token deltas.
- `lender-relevance.json`: lender/bank results and total-supply inventories.
- `local-fork-current-binary.json`: signed v1 packets, byte/account counts, exact errors/logs, compute, pre/post states, and rollback proof.

The decoders use the public v3.1.3 account schemas at commit `00fa982b1555abc80f7ce1a22dbd14c4d3d0fe8d`; the maintained public SPL repository was also pinned at `5afaf6f5c85700277a54584d85ef737fda0a8903`. Neither public tree is asserted to be source-equivalent to the deployed v3.1.7 ELF. Runtime conclusions come from the exact hash-matched ELF on the fork. Public references: [maintained SPL repository](https://github.com/Mythic-Project/solana-program-library), [v3.1.3 source snapshot](https://github.com/Mythic-Project/spl-governance-v3.1.3), and the [original SPL Governance README](https://github.com/solana-labs/solana-program-library/blob/master/governance/README.md). External prose was treated as untrusted context, not proof.

Core rerun order from this directory:

```sh
node snapshot-current.js
node fetch-governance-graph.js
cargo run --release --manifest-path decoder/Cargo.toml
node trace-vault-history.js
node map-upgrade-path.js
node fetch-upgrade-control-graph.js
cargo run --release --manifest-path decoder/Cargo.toml -- upgrade-control-graph-raw.json upgrade-control-graph-decoded.json
node lender-relevance.js
node inspect-current-binary.js
cargo build --release --manifest-path decoder/Cargo.toml --bin make_fixture
# Start a private current-mainnet Surfpool fork on 127.0.0.1:8997.
node local-fork-current-binary.js
```

The mainnet collection scripts issue read-only RPC methods. The fork harness calls only local `simulateTransaction` and local Surfpool state mutation APIs. No live transaction was constructed for mainnet, signed for mainnet, or submitted. Retained artifacts contain no RPC endpoint or API key. A standard Codex Security Cloud scan was attempted first but its local service failed with `sqlite3.OperationalError: database is locked`; the evidence-driven manual audit above was completed as the fallback, without representing it as a successful service scan.

