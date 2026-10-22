# ZBC current-mainnet outsider-authorization audit

Observed 2026-10-15T19:49:43Z. Primary account snapshot: Solana mainnet-beta slot `457360082` (genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). Target program: `zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T`.

## Result

**No validated outsider-accessible unauthorized drain was found. Immediately realizable unauthorized value: `$0`.**

Both named ZBCN accounts are ordinary SPL associated token accounts whose token authorities are signer PDAs of separate live 3-of-4 multisigs. The target's arbitrary-account transfer path, `sendTokenDirectly`, requires the source authority to sign and verifies that the source token account is owned by it. The outer multisig's `executeTransaction` entry is permissionless only after the stored fixed transaction has reached its owner threshold. At the inventory snapshot, no open transaction referencing ZBCN or either scoped vault had reached threshold.

Signed local-fork v1 simulations reproduced all relevant gates for both vaults. Replacing the authority with an outsider failed `ConstraintTokenOwner` (2015); passing the real authority without its signature failed `AccountNotSigner` (3010); outsider approval failed `InvalidOwner` (6000); and outsider execution of a real pending transaction failed `NotEnoughSigners` (6002). A positive control moved synthetic attacker-owned ZBCN successfully through the same current executable.

No mainnet transaction was built, signed, simulated, or submitted. Mainnet use was read-only. Mutation and execution tests ran only against localhost Surfpool with ephemeral synthetic accounts and `simulateTransaction`; signature verification was enabled. RPC credentials are neither embedded nor reported.

## Deployed identity

| Component | ProgramData | Last deployed slot | Upgrade authority | Dumped payload SHA-256 |
|---|---|---:|---|---|
| ZBC target `zbcKGd…GQ2T` | `5WZptw8nX59K27Yir1N71dyzrYXVN3bjbmNZaz2eJGEm` | `159738421` | `5aUDpuNNbAvme6hPi4o2vBbzHMrF7h3xB4kfKNMk6V8h` | `7fc64c7d1b701afb6e865d3b5fbef4a846a0dbbf57b849c1e1ce64d0ec30ed85` |
| Multisig `b6ZPys…zbr` | `BKg2qeJAHAUjHHHNm2LEHAZK1D8k9ifZvmJqmB88aAoZ` | `248752486` | `5aUDpuNNbAvme6hPi4o2vBbzHMrF7h3xB4kfKNMk6V8h` | `5da49736551fcfc774ef014cb15ad8356aa4d8dc76a30e87e94a9cc097661754` |

The ZBC program/program-data reads were at slot `457360099`; multisig reads were at `457360103`. Both are executable upgradeable-loader programs. The common live upgrade authority is a trust/upgrade risk, not a current outsider-accessible path and is not counted as an exploit.

The target's derived Anchor IDL account `J3ngNZMSk5N9by4KSsu3UXtqM6yMMqgXAYDJjt11y4fV` does not exist. Interface recovery therefore used the current dumped executable plus the official `@zebec-protocol/stream@1.8.0` package IDL. The package names the exact deployed program. Every one of its 22 application instruction logs occurs in the current executable; live historical calls also match the recovered discriminator and account order. This establishes strong ABI agreement, but not reproducible Rust-source-to-ELF identity. The old source URL embedded in the executable is no longer publicly retrievable.

## Scoped vaults and authorization

Vault balances are raw chain values at slot `457360082`; ZBCN uses six decimals.

| Vault | ZBCN balance | Token authority | Multisig | Authority derivation |
|---|---:|---|---|---|
| `5L4EM1G2uTCrrXgvbwtQqrJkbU9qNDcpLbZ5yKCsb4yB` | `7,000,217,587.0862` | `H8Hr964ApEP3ie1rwRTT7wkSrgvUqJQb8oNAKspkDDfR` | `EoqY5nPYoL7zH1hWSh1T5Nsbq5q6hhtztU6JStDeVgjG` | exact multisig signer PDA, bump `255` |
| `CZMwajZAkdtPtDC3EfPokkzWmmoQo6jmZJPzDXG3DHR3` | `5,500,000,100` | `3J7n5Usmei8BqgUHan5xuBiJkAx6M1AQQhGwbKiVdQ17` | `GiiWgFNnkWbAGnKiDt7ohny1tTtb2pzxpJAXVZv3T1pt` | exact multisig signer PDA, bump `253` |
| **Total scoped inventory** | **`12,500,217,687.0862`** |  |  |  |

Both multisigs have threshold `3` and four unique owners:

- `EoqY5…VgjG`: `FNuqKqgJLzJExhZQo1r8ZjQDQRp7hJX2j4bvE2hjcgtM`, `G82tVZ6eu2YRPfGFFnPYs3qLz8HtAQXnsnmNKpqfMnx7`, `EsDV3m3xUZ7g8QKa1kFdbZT18nNz8ddGJRcTK84WDQ7k`, `6enQZWHkQ5ayxyFbJXgrNdUwDZpcUon98SNCuVNSRbd2`.
- `GiiWg…T1pt`: `9Sq2nZ481aiEkoDB9gavcfD6v7pr4LEcPnUdky4TEine`, `6enQZWHkQ5ayxyFbJXgrNdUwDZpcUon98SNCuVNSRbd2`, `G82tVZ6eu2YRPfGFFnPYs3qLz8HtAQXnsnmNKpqfMnx7`, `EsDV3m3xUZ7g8QKa1kFdbZT18nNz8ddGJRcTK84WDQ7k`.

The two scoped accounts are not target-program custody ATAs. For the respective authorities, the target-derived custody PDAs/ATAs are `9m4SS85ndU8kD7pfyj1eY7WF8GmMPK6KFaa43NwYThx3` / `ChCZHh5LsYYqayjrFCE8kcGsdpjiRfKUac8WVWoSekrr` and `46mSFKvQ8xf6xkCM9vur1LrFzEV2kWCftex4bqgS62Ec` / `7NForFxNSSmyzD5oW2zhKJN2NHXxtEi6nzpgvqTKg7Fx`. Consequently, the target's stream/vault withdrawals do not address these accounts; the minimal applicable value-moving instruction is the arbitrary-account `sendTokenDirectly`, whose source token owner and signer checks were exercised directly.

Two known successful withdrawals confirm the complete live authorization chain:

| Vault | Mainnet signature / slot | Stored multisig transaction | Target instruction | Owner approvals | Amount raw |
|---|---|---|---|---:|---:|
| `5L4E…b4yB` | `bKKdrJV7kBSTozJiVJGCoHTLp27JSsA1ex1mCY7ytPfmUgNquLeH5mWGpLKZsT3zoNkQ8Tx3BJUWhXs8NBXFbhU` / `453127523` | `BDZGaijXeKxq2zrrr4CQXUNJDN8DmJvWQS1ybRGncqqh` | `sendTokenDirectly` (`3ff3b1cd51adc2b2`) | `3` | `318000000000000` |
| `CZMw…DHR3` | `3waNh14q2e839J9HuVU9CUupqUQEw9y7fHUDGCHSHKjuKnkdE2DxRqyv2ZKdCdWyHosapJWJkeE7ycUXRig9y67V` / `440722549` | `7DjzTwgsDqFkQzty9dkm3U7yZfoSrqLYe73ZJW5c4ubD` | `sendTokenDirectly` (`3ff3b1cd51adc2b2`) | `3` | `500000000000000` |

## Exact recovered application surface

Every application instruction has at least one signer. Discriminators are Anchor `sha256("global:<snake_case_name>")[0..8]` and were matched against the current executable's instruction logs.

| Instruction | Discriminator | Required signer | Arguments | Accounts |
|---|---|---|---|---:|
| `createFeeAccount` | `4a3e7cbc73f91314` | `feeOwner` | `feePercentage:u64` | 5 |
| `withdrawFeesToken` | `a48d1a8af1c90be8` | `feeOwner` | — | 10 |
| `withdrawFeesSol` | `31488dd3ab77add3` | `feeOwner` | — | 5 |
| `updateFees` | `e11b0d064554acbf` | `feeOwner` | `feePercentage:u64` | 5 |
| `depositSol` | `6c514e757d9b38c8` | `sender` | `amount:u64` | 3 |
| `nativeStream` | `352c484b3580a7e3` | `sender` | `startTime:u64, endTime:u64, amount:u64, canCancel:bool, canUpdate:bool` | 8 |
| `nativeStreamUpdate` | `51fd6ca1455eb65b` | `sender` | `startTime:u64, endTime:u64, amount:u64` | 5 |
| `withdrawStream` | `d3155a5cb9d6589d` | `receiver` | — | 9 |
| `pauseStream` | `f51f76e5006ca652` | `sender` | — | 4 |
| `cancelStream` | `dadd2619b1cfbc5b` | `sender` | — | 9 |
| `instantNativeTransfer` | `ea0d384ed53e509f` | `sender` | `amount:u64` | 5 |
| `nativeWithdrawal` | `2a9e431635c36664` | `sender` | `amount:u64` | 4 |
| `sendSolDirectly` | `702f0f09a99088db` | `sender` | `amount:u64` | 3 |
| `depositToken` | `0b9c60da27a3b413` | `sourceAccount` | `amount:u64` | 9 |
| `tokenStream` | `6ca33b85add0e680` | `sourceAccount` | `startTime:u64, endTime:u64, amount:u64, canCancel:bool, canUpdate:bool` | 11 |
| `tokenStreamUpdate` | `29f43931ae20d984` | `sourceAccount` | `startTime:u64, endTime:u64, amount:u64` | 5 |
| `withdrawTokenStream` | `b94a2faf47c43bc4` | `destAccount` | — | 16 |
| `pauseResumeTokenStream` | `6ba161510cc27e04` | `sender` | — | 5 |
| `cancelTokenStream` | `3a0e9f3e8cabe606` | `sourceAccount` | — | 16 |
| `instantTokenTransfer` | `1f1d4c4b30e0fefb` | `sourceAccount` | `amount:u64` | 11 |
| `tokenWithdrawal` | `0b4f357132a43a39` | `sourceAccount` | `amount:u64` | 10 |
| `sendTokenDirectly` | `3ff3b1cd51adc2b2` | `sourceAccount` | `amount:u64` | 9 |

The full ordered account lists and argument schemas are in `zbc-current-audit.json` and `zebec-idl-1.8.0.json`. Five Anchor IDL administration dispatchers are also embedded: `IdlCreateAccount`, `IdlCreateBuffer`, `IdlWrite`, `IdlSetAuthority`, and `IdlSetBuffer`; they are not scoped value-moving paths.

The multisig executable exposes seven application instructions: `CreateMultisig`, `CreateTransaction`, `Approve`, `SetOwnersAndChangeThreshold`, `SetOwners`, `ChangeThreshold`, and `ExecuteTransaction`, plus the same five Anchor IDL administration dispatchers. `ExecuteTransaction` accepts an outsider fee payer/caller, but its stored signer bitmap is checked against the current threshold before its fixed target program, accounts, and data are invoked.

## Current stored-transaction inventory

Inventory reads were at slots `457360082`–`457360084`.

| Multisig | Total / executed / open | Open scoped ZBCN transactions | Approval counts | Threshold-met scoped ZBCN |
|---|---:|---:|---|---:|
| `EoqY5…VgjG` | `62 / 49 / 13` | 10 | nine at `1/3`; one at `2/3` | **0** |
| `GiiWg…T1pt` | `6 / 2 / 4` | 4 | one at `1/3`; three at `2/3` | **0** |

The only two open transactions already at `3/3` are `2e6ji5xrWrr7TKrRYq47M82FHPm4ahxkovUrgVRNYLNA` and `GHpVVvWhZvff6d5YHU6qvQDgVM69ojVZWChsG94YEdhp`. Both are fixed to the old mint `zebeczgi5fSEtbpfQKVZKCJ3WgYXxjkMUkNNx7fLKAF`, source `7VnMaCsfzCyfoMDDfj4bgq6B6E8QC6vdsEMfkybjGu1B`, and destination `88743sXwaPFs9f1dSxRptKEGN2hcbPvHR8d5zTN8M1pY`; neither references ZBCN or either scoped vault. Both source and destination currently hold zero raw units at slot `457360084`.

The local-fork outsider execution control for one of those fixed `3/3` transactions passed the multisig gate, entered `SendTokenDirectly`, and reached SPL Token before failing token error `0x1`, consistent with its current zero source balance. That is expected permissionless execution of an already authorized fixed instruction, not outsider authorization or an arbitrary-call primitive.

## Signed local-fork v1 evidence

The fork ran at local slots `457357884`–`457357887`. Every case was a real signed version-1 wire message with prefix `0x81`, `sigVerify:true`, no address lookup tables, and one controlled ephemeral fee-payer signature.

| Case | Runtime result | Bytes / accounts |
|---|---|---:|
| Positive control: attacker moves one synthetic unit from its own ZBCN ATA | Success; source `100→99`, destination `0→1` | `463 / 10` |
| Vault 1: outsider substituted as source authority | `ConstraintTokenOwner` 2015 | `463 / 10` |
| Vault 1: real authority supplied without signing | `AccountNotSigner` 3010 | `495 / 11` |
| Vault 1: outsider approves real pending transaction | `InvalidOwner` 6000 | `257 / 4` |
| Vault 1: outsider executes real under-threshold transaction | `NotEnoughSigners` 6002 | `587 / 14` |
| Vault 2: outsider substituted as source authority | `ConstraintTokenOwner` 2015 | `463 / 10` |
| Vault 2: real authority supplied without signing | `AccountNotSigner` 3010 | `495 / 11` |
| Vault 2: outsider approves real pending transaction | `InvalidOwner` 6000 | `257 / 4` |
| Vault 2: outsider executes real under-threshold transaction | `NotEnoughSigners` 6002 | `587 / 14` |
| Outsider executes fixed old-mint transaction already at `3/3` | Multisig auth passed; SPL Token `0x1` on zero source | `587 / 14` |

All messages are below the requested `4096`-byte and `64`-account limits. The JSON records signed-wire SHA-256 hashes, signer order, compute usage, full logs, fixed transaction data, and watched account images. The successful synthetic control demonstrates that the harness reached and executed the deployed target instead of merely failing during message construction.

## Flash liquidity, unwind, and net equity

- KLend census at slot `457360084`: **no live ZBCN reserve**, so no same-mint KLend flash capacity to price or repay.
- Project0/marginfi at slot `457360082`: bank `47Naxnhy3YnT4Mbpb1QnvPHZzuwW5ruUXBRiK5584yBQ` is live, but ZBCN liquidity vault `GHBqxtyV52WM53siZEJSFMxgU97NpjVtT8bMWMSCcZDT` held exactly `0` raw ZBCN.
- No unauthorized principal was obtained before either flash source would matter. Therefore no reverse-swap/repayment/unwind is presented, and no hypothetical mark-to-market is promoted to an exploit claim. Outsider net equity from the tested unauthorized paths is `0`; every such transaction failed atomically before value moved.

## Limits

- This is a slot-pinned current-state audit, not a proof about future upgrades, later approvals, compromised owners, or operator behavior.
- The deployed Rust source was not reproducibly available. The official package IDL is used only where corroborated by current executable strings, current accounts, historical executed transactions, or local execution.
- The local fork tested the minimal applicable direct-transfer path and the live outer authorization gates for both scoped vaults. It does not claim exhaustive semantic coverage of every stream lifecycle transition unrelated to these two non-custody token accounts.

## Reproduction artifacts

- `zbc-current-audit.json` — complete slot-pinned account decodes, instruction/account schemas, current transaction inventory, flash-liquidity checks, and simulation evidence.
- `audit-zbc.js` — read-only mainnet collector and signed localhost v1 simulator.
- `zbc-current.so` — current target payload, SHA-256 `7fc64c7d1b701afb6e865d3b5fbef4a846a0dbbf57b849c1e1ce64d0ec30ed85`.
- `multisig-current.so` — current outer-authority payload, SHA-256 `5da49736551fcfc774ef014cb15ad8356aa4d8dc76a30e87e94a9cc097661754`.
- `zebec-idl-1.8.0.json` — official package IDL, SHA-256 `5aeb6cddcce0d3b8f906d76ff0fc0f9bfcaee815f3b6ab31fcd5f2cb64cc3459`.

Re-run from the workspace after starting a localhost Surfpool fork on port `9007` with a read-only mainnet upstream:

```sh
node composer-runs/2026-10-15/zbc-current-audit/audit-zbc.js
```

The runner writes only the JSON artifact, uses no mainnet send/simulate method, and intentionally omits configured RPC URLs from output.
