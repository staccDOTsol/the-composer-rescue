# MOVEUSD Solana mainnet controller — outsider net-asset-gain audit

Observed 2026-10-15. Scope: current Solana mainnet executable
`EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC`, with the sole finding
criterion being an outsider-accessible path to unauthorized positive net
equity after repaying every debt and accounting for every residual claim.

All chain interaction was read-only. No live transaction was constructed,
signed, or submitted, and no operator was contacted.

## Result

**No outsider-accessible unauthorized net asset gain was demonstrated. There
are no reportable outsider findings in this pass.**

The current value-creating `Mint` path and the current value-moving `Transfer`
path both enforce an operator-specific `access_control_v3` PDA and require the
corresponding operator account to be a signer. Account substitution, omission
of signer status, completed-id replay, and amount extremes failed before any
asset delta. Successful simulations retained the known operator as a declared
signer and are privileged logic controls, not outsider paths.

This is evidence against the tested attack hypotheses, not a proof that the
upgradeable executable contains no bug.

## Current program and token identity

The current-chain snapshot was taken at slots `457352859–457352860`. A final
identity check at slot `457358333` reproduced the same ProgramData address,
deployment slot, upgrade authority, payload size, and payload hash. The vault
balance was also unchanged. Supply had moved through ordinary controller
activity to 115,794,133.639254 MOVEUSD, which is why point-in-time values below
retain their observation slots.

| Item | Current observation |
|---|---|
| Program | `EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC` |
| Loader | Upgradeable BPF Loader; executable |
| ProgramData | `DybKXmycEuZDF4u8EVxr21Ljza9dEHKF6CKJ9G91zMMY` |
| Last deployed slot | `449520764` |
| Upgrade authority | `AiWGaHWRrSAizfXRPGypvxGoMgH714yr6cpRZgdKq2tr` |
| ProgramData payload | 1,180,400 bytes |
| Payload SHA-256 | `68374147fe8a5038882db50120cf61a242394aa8caf6da27d15d1c2ea9210a81` |
| Nonzero payload SHA-256 | `78f075b25861e7a0a0a2a76b864ad4c97c5aeff675b11ca53ea23a3db13789cb` |
| Embedded program name | `mintfx` |
| MOVEUSD mint | `3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm` |
| Token program | SPL Token |
| Decimals | 6 |
| Snapshot supply | 115,793,431.659254 MOVEUSD |
| Mint authority | The mint address itself, an off-curve controller PDA |
| Freeze authority | The same controller PDA |

The executable contains `programs/mintfx/src/...` paths, and the decoded
on-chain Anchor IDL identifies the program as `mintfx` at the same program
address. CFX describes its product as tokenized bank deposits, one token per
deposited dollar, rather than a permissionless DeFi-native reserve pool
([CFX](https://cfx.to/)). The independent Pharos record maps this exact program,
mint, and current upgrade authority to MOVEUSD
([Pharos](https://pharos.watch/stablecoin/moveusd-cfx/)).

The current executable is newer than its on-chain IDL. The IDL uses
`access_control_v2` and contains `mint_via_swap`; the deployed binary contains
`access_control_v3`, newer withdrawal/external-redemption families, and no
`MintViaSwap` instruction name. I therefore used the IDL only as historical
layout context and derived live discriminators and account shapes from the
current binary and successful current transactions.

## Custody and authority accounting

The census's approximately $101.670 million observation reconfirms as follows:

| Item | Observation |
|---|---:|
| Token account | `9LbzSsqxTyaa9dA9nVv7oBaZy85qJuAonX7wCuEaXoXX` |
| Raw balance | `101776167770000` |
| MOVEUSD balance | 101,776,167.77 |
| Share of snapshot supply | 87.8946% |
| Token authority | `F42zAoH6HGZqrXroPWTXP9fHujFc2mLrycMgn3kJkMrr` |
| Jupiter mark used by the census | $0.9989562719 |
| Gross marked balance | $101,669,941.12 |

This token account is not proof of $101.8 million of liquid backing. Its
authority derives exactly as
`PDA([5e28cfa7694256d4aaf0b3e4ae275847, "redemption_wallet"])`, and the token
account is the exact MOVEUSD associated token account of that PDA. It is a
controller ledger/redemption wallet. CFX describes the actual backing as cash
deposits at partner banks; that off-chain backing is outside the Solana token
account balance and was not independently reserve-audited here.

Current transaction `4LzzHMY8...Y5Drxq` at slot `457268830` proves the
controller signed a checked transfer of 212,123.42 MOVEUSD from this account.
The source and target wallet PDAs, their associated token accounts, the
operator permission PDA, and the idempotency PDA all reproduce exactly. In the
bounded 70-transaction controller corpus, ten successful transfers moved a
total of 422,533.41 MOVEUSD from this account to the observed target ledger
wallet. That establishes real controller custody and outflow capability; it
does not establish outsider access.

The current authorization tuple for the witness transaction is:

- token ID `FXUSD`;
- operator `HAeqpi3coL6PCALPg1QkfdJexK2MBFfy2sx6FeVbxTN4`;
- permission PDA
  `PDA(["FXUSD", operator, "access_control_v3"]) = 2wwUmY5...dQQQ`;
- the 48-byte permission state embeds that operator and permission bits `3879`;
- transfer idempotency PDA
  `PDA([idempotency_key, "transfer"]) = BJ3kLA59...433Rg`.

## Current transaction and binary surface

The latest 70 successful controller transactions resolve to four current wire
shapes:

| Instruction | Count | Data bytes | Accounts | Asset operation |
|---|---:|---:|---:|---|
| `Transfer` | 45 | 87 | 14 | checked token transfer |
| `Mint` | 15 | 46 | 12 | checked mint plus checked transfer |
| `CommitRedeem` | 9 | 38 | 10 | checked burn |
| `Redeem` | 1 | 57 | 13 | checked token transfer |

The only programs invoked in that bounded corpus were the MOVEUSD controller,
SPL Token, Associated Token, System, Memo, and Compute Budget programs. No DEX,
lender, oracle, or bridge CPI occurred. The current binary's printable strings
contain no `oracle`, `Pyth`, `Switchboard`, or `MintViaSwap` reference. This is
negative, bounded evidence: raw binary inspection cannot prove the absence of
every possible indirect consumer, but the current value paths and recent
account shapes do not expose a price account or a cross-asset pricing leg.

## Read-only current-mainnet simulations

The harness constructs custom Solana v1 wires and calls only
`simulateTransaction` with `sigVerify=false`; it never calls
`sendTransaction`. With signature verification disabled, a transaction that
marks the known operator as a signer can exercise live program logic without
possessing that key. Such successes are explicitly operator-equivalent
controls. Conversely, the live program still checks signer metadata and the
operator-bound permission PDA.

### Transfer path

Simulated at slots `457355327–457355330` from current witness wire data:

| Case | Result |
|---|---|
| Known operator, fresh id, 1 raw unit | Success: source −1, destination +1 |
| Outsider substituted for operator while retaining operator permission | Rejected: `ConstraintSeeds` 2006 |
| Operator account not marked signer | Rejected: `AccountNotSigner` 3010 |
| Completed transfer id replay | Rejected when the existing idempotent account was recreated |
| Token-info replaced with System Program | Rejected: wrong owner 3007 |
| Source account aliased to destination | Rejected: token-owner constraint 2015 |
| Destination account aliased to source | Rejected: invalid ledger destinations 6006 |
| Token program replaced with System Program | Rejected: invalid program 3008 |
| Zero amount | Success with zero balance delta |
| Source balance + 1 | Rejected: SPL insufficient funds |
| `u64::MAX` | Rejected: SPL insufficient funds |
| Exact 4,096-byte v1 envelope, known operator, 1 raw unit | Success: source −1, destination +1 |

### Mint path

Simulated at slots `457357111–457357114` from current witness transaction
`5voEfq87...w9mGDQ`:

| Case | Result |
|---|---|
| Known operator, fresh id, 1 raw unit | Success: supply +1 and destination +1 |
| Outsider substituted for operator while retaining operator permission | Rejected: `ConstraintSeeds` 2006 |
| Operator account not marked signer | Rejected: `AccountNotSigner` 3010 |
| Completed mint id replay | Rejected when the existing idempotent account was recreated |
| Token-info replaced with System Program | Rejected: wrong owner 3007 |
| MOVEUSD mint replaced with USDC | Rejected: mint seed constraint 2006 |
| Mint escrow replaced with System Program | Rejected: wrong owner 3007 |
| Token program replaced with System Program | Rejected: invalid program 3008 |
| Zero amount | Success with zero supply and balance delta |
| `u64::MAX` | Rejected: SPL arithmetic overflow |

These active paths move exact integer base units. With the stale cross-asset
instruction absent, there is no controller-side quote calculation or decimal
conversion on these paths in which a rounding gain could be exercised.

## Realistic liquidity, cross-asset routing, and flash feasibility

The spot mark is not liquid at custody scale. A read-only Jupiter token lookup
reported approximately $97,952.81 of aggregate liquidity versus a
$101,669,941 gross mark for the controller ledger balance—a roughly 1,038×
gap. Quote probes found:

- MOVEUSD → USDC: a 90,000 MOVEUSD Whirlpool quote existed, returning
  89,547.774474 USDC; 100,000 MOVEUSD and larger probes returned no route.
- USDC → MOVEUSD: a 5,000 USDC quote existed, returning 5,000.215639 MOVEUSD;
  10,000 USDC and larger probes returned no route.

These are quote-availability observations, not guaranteed execution or
redemption capacity. Even the largest quoted outward probe is only 0.0884% of
the custody balance; the reverse-direction probe is 0.0049%.

The latest 1,000 mint-address transactions, spanning
`2026-10-09T18:08:55Z` through `2026-10-15T19:33:43Z`, add a bounded
cross-asset check:

- 197 `mintToChecked` and 64 `burnChecked` operations were observed, all in
  controller transactions;
- one independent 10,885-raw-unit holder burn used SPL Token directly;
- eight transactions involved DEX/router programs, including Whirlpool;
- none of those eight composed with the MOVEUSD controller;
- Wormhole Core and Wormhole Wrapped Token Transfer programs did not appear.

A true flash-repayment transaction was therefore **not feasible as a meaningful
security test** under the requested positive-equity criterion:

1. the captured Kamino/Project 0 sets contain no same-mint MOVEUSD source;
2. the current controller has no observed cross-asset or price-consuming leg;
3. its value-creating and custody-moving legs reject an outsider before value
   movement;
4. the available cross-asset pool is shallow; and
5. a USDC borrow → MOVEUSD swap → reverse swap would add fees and repayment
   debt without an unauthorized value source, yielding negative rather than
   positive outsider equity.

The exact 4,096-byte v1 operator control proves transport headroom only. It is
not presented as a flash test or an outsider exploit.

## Bridge accounting

Wormhole announced that MOVEUSD uses Native Token Transfers across Solana,
Base, and Ethereum and described the integration as burn-and-mint while CFX
retains token-contract control
([announcement](https://wormhole.com/blog/moveusd-stablecoin-chooses-wormholes-ntt-standard-for-multichain-expansion)).
Generic NTT relies on Guardian-signed VAAs and deployment-specific access
control, rate limits, and threshold configuration
([Wormhole documentation](https://wormhole.com/docs/products/token-transfers/overview/)).

I did not resolve a current asset-specific MOVEUSD NTT Manager, Transceiver,
peer, rate-limit, pause, or ownership state from primary chain data. This is
also the unresolved point in the current Pharos bridge record. The current
controller binary does not expose a Wormhole instruction family, its recent
controller corpus contains no Wormhole CPI, and the bounded mint history shows
issuer-controller mint/burn operations rather than atomic NTT/controller
composition. Accordingly:

- the public bridge description is not counted as an on-chain liquid reserve;
- generic VAA security is not misrepresented as a tested MOVEUSD deployment;
- the unresolved external/issuer-mediated bridge surface is not treated as an
  outsider-accessible controller route; and
- no bridge replay or unbacked cross-chain mint finding is claimed without the
  missing asset-specific deployment state.

## Outsider equity accounting

| Tested outsider class | Gross unauthorized assets | Debt/claims | Net outsider equity |
|---|---:|---:|---:|
| Permission-account/authority substitution | 0 | 0 | 0 |
| Missing operator signature | 0 | 0 | 0 |
| Completed-id replay | 0 | 0 | 0 |
| Token/mint/account/program substitution | 0 | 0 | 0 |
| Amount extremes | 0 | 0 | 0 |
| Cross-asset/flash composition | Not feasible; no value-producing controller leg | N/A | No positive equity demonstrated |

The operator-equivalent controls created or moved one raw unit in simulation,
but those deltas require the existing operator permission and signer identity.
Per scope, they are privileged controls and are excluded from outsider equity.

## Limitations

- No verified source/build was available for the current executable. The audit
  used current account bytes, current transaction wires, exact PDA/ATA
  derivations, deployed-binary strings, and live read-only simulation.
- The on-chain Anchor IDL is stale.
- The controller corpus (70 transactions) and mint corpus (1,000 signatures)
  are bounded recent samples, not lifetime history.
- Public MOVEUSD NTT claims could not be tied to a current asset-specific
  manager/transceiver configuration, so no bridge-state security conclusion is
  made beyond the bounded negative observations above.
- Jupiter quote availability is not guaranteed executable liquidity, and no
  swap was requested or submitted.
- The Codex Security provider scan did not start because the provider reported
  that the selected target changed while the scan was starting. Per the scan
  tool contract it was not retried; this report is the direct audit fallback,
  not a provider scan result.

## Reproduction artifacts

- `moveusd-snapshot.js` → `moveusd-current-state.json`,
  `moveusd-recent-transactions.json`, `moveusd-current.so`
- `moveusd-final-check.js` → `moveusd-final-check.json`
- `moveusd-decode-idl.js` → `moveusd-onchain-idl.json`
- `moveusd-binary-analysis.js` → `moveusd-binary-analysis.json`
- `moveusd-transaction-analysis.js` → `moveusd-transaction-analysis.json`
- `moveusd-simulate.js` → `moveusd-simulations.json`
- `moveusd-mint-simulate.js` → `moveusd-mint-simulations.json`
- `moveusd-liquidity.js` → `moveusd-liquidity.json`
- `moveusd-mint-history.js` → `moveusd-mint-history.json`
- Machine-readable conclusion: `moveusd-summary.json`

Each networked script reads `/tmp/composer-helius-rpc.env` without printing the
RPC key or full URL. None contains a live submission path.
