# Solana mainnet Token / Token-2022 authority census

Observed 2026-10-15. Read-only RPC and historical-transaction analysis only; no transaction was constructed, signed, or submitted.

## Result

This pass found materially important program-controlled token custody outside the original protocol shortlist. The strongest newly surfaced current-binary audit targets are:

1. `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS`: **$312.921m** of sampled stablecoin custody, current executable, successful program-signer outflows observed, no authoritative identity/source located, and a high-liquidity same-asset atomic envelope candidate.
2. `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy`: **$74.881m** sampled gross custody across 21 authorities, current executable, state references and recent program-signer outflows observed, no authoritative source/IDL located, and several strong same-asset liquidity candidates.
3. `EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC`: **$101.670m MOVEUSD**, current executable and directly proven to sign successful vault outflows. The MOVEUSD/program attribution is corroborated by a third-party risk registry, but no same-mint Kamino/Project 0 inventory was observed.
4. `97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY`: **$123.440m wYLDS**, current executable and directly proven to sign vault outflows. The public Hastra vault repository identifies the current Squads upgrade authority. Same-mint lending inventory was only about **$44.4k**.
5. Hylo Exchange `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn`: **$31.821m JitoSOL**, with direct signer provenance and about **$127.745m** of observed same-mint Kamino plus Project 0 inventory.
6. OnRe `onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe`: **$29.888m USDG**, with direct signer provenance, official public source/integration documentation, and about **$5.435m** of observed same-mint inventory.

These are custody/prioritization findings, not vulnerability findings. No unauthorized withdrawal, claim, settlement, or economic exploit was demonstrated.

## Exact bounded denominator

An exact chain-wide Token plus Token-2022 account census was not feasible through the available RPC interfaces. Flux explicitly disallows `getProgramAccounts` for both token programs because of their size ([Flux documentation](https://fluxrpc.com/docs/guides/get-program-accounts)). Helius provides cursor-paginated `getProgramAccountsV2` ([SDK documentation](https://github.com/helius-labs/helius-sdk)), but live probes showed `changedSinceSlot` filtering after cursor pagination: pages could contain only 12–22 matching rows while the cursor continued through the underlying program universe. There was no trustworthy total, so an exact all-account denominator would require exhausting both enormous cursor streams.

Rather than imply completeness, this run uses a precise bounded denominator: **every mint in the current Jupiter verified registry**, and the **top 20 token accounts returned for every one of those mints**.

| Measure | Exact count |
|---|---:|
| Jupiter verified-registry entries fetched | 3,987 |
| Successfully queried mints | 3,987 |
| Failed or unsupported registry mints | 0 |
| SPL Token mints | 1,608 |
| Token-2022 mints | 2,379 |
| Priced mints | 2,640 |
| Unpriced mints retained in raw census | 1,347 |
| Returned top-account rows | 69,054 |
| Unique returned token accounts | 69,054 |
| Live, mint-bound token accounts | 68,885 |
| Distinct token authorities | 36,618 |
| Off-curve authorities | 7,046 |
| Authority accounts mapped to an executable owner, raw | 6,349 |
| Executable owners in the raw map | 334 |
| Semantically usable direct-state owners after excluding System, Token and Token-2022 | 331 programs / 3,272 authorities / 3,704 token accounts |

Registry fetch began at `2026-10-15T18:46:03Z`; the census completed at `2026-10-15T18:55:04Z`. Largest-account slots were `457338864–457338992`; live token-account reads were `457338992–457341090`; authority and owner reads were `457341128–457341377`.

This denominator excludes token accounts below each mint's top 20, mints absent from the Jupiter verified registry, native SOL and stake accounts, and compressed assets. It is therefore a broad, reproducible top-holder census, not a claim to have enumerated every mainnet token account.

## Evidence rules

The raw field `directExecutableOwner` is not sufficient by itself: the System and token programs are executable too. All rankings below exclude `11111111111111111111111111111111`, SPL Token, and Token-2022 as controllers.

Evidence is graded as follows:

- **Exact PDA**: the program ID and seeds reproduce the authority, and the controlled vault/mint are state-bound.
- **Signer provenance**: a confirmed successful historical transaction contains an outgoing Token/Token-2022 CPI from the sampled vault, with the candidate authority and the immediately enclosing program recorded. This proves the program could sign that observed outflow.
- **State reference**: the off-curve authority account is owned by a current executable and its data contains the controlled token-account and/or mint bytes. This is strong mapping evidence but not a full seed proof.
- **State owner only**: the authority account is program-owned, but the selected state layout did not expose the vault/mint bytes. This remains a lead, not a complete control proof.

For the top 120 direct program-owned authorities, all 120 owner programs were executable at slot `457342444`; 90 authority states contained a controlled vault or mint reference; 22 had exact seed proofs. For the 40 highest-valued null-account off-curve authorities, 34 produced signer provenance in the bounded history sample: 350 transfer matches across 249 unique confirmed signatures. Absence in that history sample is not evidence of absence.

## Program-controlled custody surfaced by direct state

| Program | Sampled gross mark | Evidence | Interpretation |
|---|---:|---|---|
| Magna Airlock V2 `magnaSH…NAwbj` | $1.5686b | 32 authorities; 15/15 selected high-value states reference vault/mint; current executable | Vesting/lock custody, dominated by $1.3370b marked TRUMP. Official deployment ID: [Magna docs](https://docs.magna.so/admins/privacy-and-security/magna-contract-deployments). Not protocol TVL or liquid exploit value. |
| Smithii vesting `vesFcn…wxQ2K` | $735.676m | Six states; top two reference controlled vault/mint; current executable | Officially identified as a token vesting locker in [Smithii docs](https://docs.smithii.io/products/smart-contracts/solana). $735.642m is GOHOME at a registry mark backed by only about $350k reported liquidity; quarantined from credible ordering. |
| Jupiter/Meteora Lock `LocpQg…Qqjn` | $473.845m | 308 authorities; exact seed and ATA proof for all 21 selected top states | The public [Meteora Lock SDK](https://github.com/MeteoraAg/met-lock-sdk) identifies the mainnet program and the create/claim flow. This is fragmented scheduled vesting custody, not a single pooled vault. |
| Unknown `jup6QF…BvNS` | $312.921m | One 74-byte state authority; separate recent signer-outflow evidence; current executable | $297.460m USDe, $9.480m PYUSD, $5.981m USDG. Exact-ID search found no authoritative identity/source; the prefix is not treated as attribution. Highest-priority new binary target. |
| Sanctum INF `5ocnV…x9kx` | $193.497m | Known existing controller | Overlaps the existing protocol queue and LST accounting. |
| Unknown `EyxPPo…yc6kc` | $132.740m | Nine program-owned GRASS authorities, but no selected state byte reference or sampled outflow | Current executable; control mapping remains lower confidence. |
| Circle CCTP v1 + v2 | $165.633m | $125.194m + $40.439m USDC in current executable state authorities | Known bridge custody; separate bridge work found attestation and replay gates, so this is not promoted as a new unauthorized-exit finding. |
| MetaDAO migrator `gr8tqq…LC9t` | $108.120m full sample | State reference plus recent program outflow | Mostly META; current executable and separately source-attributed in the long-tail queue. |
| Unknown `XP1BRL…UYVZy` | $74.881m | 21 authorities; 4/4 selected states reference vault/mint; recent signer outflows | Recent current deployment, no authoritative source/IDL located. Strong binary-first target. |
| SKR staking `SKRskr…94BZ` | $72.721m | Exact PDA and state reference | Solana Mobile identifies this program as staking and as accepting user deposits ([launch post](https://solanamobile.com/blog/skr-is-live), [VDP](https://lgl.solanamobile.com/th/vulnerability-disclosure-policy-and-bug-bounty)). |

Known high-value baselines also reappeared rather than being silently excluded: Jupiter Lend had a $1.0480b token-only top-holder lower bound; Jupiter Perps had $550.985m token-only (before its separately measured native stake); and the prior exact Kamino reserve census measured $1.4061b. Ten of the null-account authorities in this pass reconciled exactly to prior PDA-proved Kamino vault rows.

## Exact PDA proofs

For Jupiter/Meteora Lock, all 21 selected 296-byte authority states matched this layout and derivation:

- stored mint at bytes `40..72`;
- base public key at `104..136`;
- stored bump at byte `136`;
- authority PDA: `findProgramAddress(["escrow", base], LocpQg…Qqjn)`;
- controlled vault: ATA of that escrow PDA for the stored mint and its token program.

Every derived authority and bump matched, and every controlled token account matched its derived ATA.

For SKR staking, `findProgramAddress(["stake_config"], SKRskr…94BZ)` reproduced authority `4HQy82…`; the state references vault `8isViK…` and the SKR mint. The exact seed was directly checked against current chain state; no legacy on-chain Anchor IDL was available through `anchor idl fetch`.

## Executable programs proven by outgoing signer CPI

All 15 distinct caller programs were still executable at slots `457343339–457343350`. ProgramData was decoded directly; 14 were upgradeable and Squads v4 was immutable.

| Caller program | Sampled attributed gross | Authorities | Current status |
|---|---:|---:|---|
| Kamino Lend `KLend2…mjD` | $543.327m | 10 | Executable, upgradeable; known protocol |
| `pytS9T…7JCQ` | $123.574m PYTH | 7 | Executable, upgradeable; distribution/treasury-shaped, not independently attributed here |
| Hastra vault `97V7Js…EGxY` | $123.440m wYLDS | 1 | Executable, upgradeable; public [Hastra repository](https://github.com/provenance-io/hastra-sol-vault) |
| MOVEUSD controller `EmiytJ…A1KC` | $101.670m | 1 | Executable, upgradeable; third-party [MOVEUSD control attribution](https://pharos.watch/stablecoin/moveusd-cfx/) |
| Squads v4 `SQDS4e…52pCf` | $81.284m | 4 | Executable and immutable; official [v4 source](https://github.com/Squads-Protocol/v4/) |
| Hylo Exchange `HYEXCH…G4hn` | $31.821m JitoSOL | 1 | Executable, upgradeable; named and build-verified at audit time in the [Hylo audit](https://hylo-audits.s3.us-east-2.amazonaws.com/Accretion-Hylo-Dec2025.pdf) |
| OnRe `onreuG…Fcwe` | $29.888m USDG | 1 | Executable, upgradeable; official [integration/source reference](https://docs.onre.finance/technical-resources/onre-smart-contract-integration) |
| `zbcKGd…GQ2T` | $28.144m ZBCN | 2 | Executable, upgradeable; identity not independently established |
| Hylo Stability Pool `HysTab…DSQQ` | $20.806m hyUSD | 1 | Executable, upgradeable; named and build-verified at audit time in the Hylo audit |
| `8eqh8w…GiqC` | $10.061m PRIME | 1 | Executable, upgradeable; identity unresolved |
| `FoXpJL…mfpP` | $9.922m FOXY | 1 | Executable, upgradeable; identity unresolved |
| `4T5m5N…CNRT` | $8.664m PRIME | 1 | Executable, upgradeable; identity unresolved |
| `ChnryP…11Sz` | $8.080m USDG | 1 | Executable, upgradeable; identity unresolved |
| Project 0 / marginfi `MFv2hW…VacA` | $5.393m bSOL | 1 | Executable, upgradeable; known protocol |
| `RaTEZ3…yotb` | $5.381m RTX | 1 | Executable, upgradeable; identity unresolved |

Squads balances are smart-wallet treasury custody. They must not be reclassified as permissionless pooled protocol value merely because the program signs the transfer.

## Flash-loan-extreme routing

The same-mint crosswalk joins custody assets to current PDA-proved nonzero Kamino and Project 0/marginfi liquidity vaults. A nonzero vault balance is only inventory evidence; it is not proof that the entire amount is flash-borrowable.

The independent Project 0 v1 control successfully simulated `start → borrow → repay → end` in **671 bytes / 14 accounts**. For each target below, the table conservatively adds that entire control envelope to an entire observed successful target transaction. This deliberately over-counts shared accounts and message overhead. A fit therefore establishes transport headroom under the specified **4,096-byte / 64-account** v1 ceiling, but does not establish an authorized or unauthorized economic path.

| Target / same mint | Sampled custody | Observed same-mint inventory | Observed target tx | Conservative sum | Conclusion |
|---|---:|---:|---:|---:|---|
| `jup6QF…` / USDe | $297.460m | Kamino $139.375m | 811 B / 20 accts | 1,482 B / 34 | Strongest new program-specific simulation candidate; transport fits, semantics untested |
| `XP1BR…` / ONyc | $33.305m | Kamino $153.181m | 1,005 B / 38 accts | 1,676 B / 52 | Strong candidate; exact combined withdrawal simulation still required |
| Hylo Exchange / JitoSOL | $31.821m | Kamino $120.158m + Project 0 $7.587m | 872 B / 43 accts | 1,543 B / 57 | Fits with seven-account headroom; LST value overlaps underlying SOL |
| OnRe / USDG | $29.888m | Kamino $5.432m + Project 0 $0.003m | 1,196 B / 32 accts | 1,867 B / 46 | Fits; official offer/pricing/permission checks remain the security question |
| CCTP v1 / USDC | $125.194m | Kamino $20.415m + Project 0 $0.282m | 1,180 B / 19 accts | 1,851 B / 33 | Transport fits, but attestation/replay authorization prevents treating liquidity as an exit |
| Hastra / wYLDS | $123.440m | Kamino $0.044m | 517 B / 12 accts | 1,188 B / 26 | Fits but amplifier is small and wYLDS is a claim-like asset |
| PYTH controller / PYTH | $123.574m | Kamino $0.006m + Project 0 $0.251m | 419 B / 9 accts | 1,090 B / 23 | Fits; likely distribution custody and limited amplifier |
| Hylo Stability / hyUSD | $20.806m | Project 0 $0.046m | 1,092 B / 48 accts | 1,763 B / 62 | Fits narrowly on account count; semantic combined sim required |
| Magna / SANC | $8.127m | Project 0 $0.061m | 1,094 B / 9 accts | 1,765 B / 23 | Vesting claim flow and small amplifier; lower exploit priority |

`EmiytJ…` MOVEUSD had no same-mint Kamino/Project 0 inventory in the captured vault sets. `EyxPPo…` had only about $1.3k of GRASS inventory and no sampled exit proof. Jupiter/Meteora Lock had about $1.51m of same-mint JUP inventory, but its claim flow was not combined with a flash envelope in this pass.

All 30 candidates for which both same-mint inventory and a historical outflow envelope were available fit under the conservative transport sums. That means the v1 envelope is not, by itself, a useful exclusion. Program-specific read-only simulations must still establish the exact target instruction, state freshness/oracle requirements, signer/recipient constraints, repayment, and post-state deltas.

## Price, overlap, and custody controls

- Jupiter `verified` is a registry inclusion signal, not a liquidity guarantee. The `quXSY…` tSAT authority produced a **$17.253b** mark from a huge balance at a thin-token mark and is excluded from credible priority ordering.
- Smithii GOHOME custody has a **$735.642m** mark against about **$350k** registry liquidity. The raw token balance is real; the liquidation-value interpretation is not.
- Magna's $1.337b TRUMP entry is a locked allocation. It may exceed circulating supply-based intuition and is not additive with market capitalization or protocol TVL.
- wYLDS, JitoSOL, BulkSOL, rkuSOL, hyloSOL, bSOL and other yield/LST assets can overlap their underlying collateral. Gross marks must not be added to native SOL or lending collateral totals.
- LP, receipt, bridge and vault tokens can represent claims on assets already counted elsewhere. This report does not compute a deduplicated ecosystem TVL.
- The 1,347 unpriced registry mints remain in raw balance evidence but cannot enter USD ordering.

## Unresolved high-value authorities

Five non-burn null-account authorities remained unattributed after checking up to ten recent successful signatures for each sampled token account:

| Authority | Sampled mark | Asset | History checked |
|---|---:|---|---:|
| `H932pw…UGHe` | $249.290m | PST | 10 signatures |
| `3i8TH5…c4Go` | $91.413m | wYLDS | 10 signatures |
| `9Da76V…SNTnq` | $58.545m | 2Z | 1 signature available |
| `APcNbW…RsPv4` | $13.162m | BIRB | 2 signatures available |
| `DvgTXQ…ns7G` | $5.265m | BIRB | 2 signatures available |

`1nc1nerator11111111111111111111111111111111` held about $26.5m of marked tokens but is the burn/incinerator address, not program custody.

## Reproduction artifacts

- `census-mainnet-token-authorities.js` → `mainnet-token-authority-census.raw.json`
- `prove-top-state-authorities.js` → `mainnet-token-authority-state-proofs.json`
- `trace-top-unknown-authorities.js` → `mainnet-token-authority-signer-provenance.json`
- `verify-signer-caller-programs.js` → `mainnet-token-authority-caller-programs.json`
- `build-token-authority-crosswalk.js` → `mainnet-token-authority-flash-crosswalk.json`
- `analyze-token-authority-atomic-envelopes.js` → `mainnet-token-authority-atomic-envelopes.json`

The JSON files preserve full addresses, slots, raw amounts, state references, seed derivations, signatures, current loader/ProgramData metadata, and same-mint vault evidence. USD figures are sampled gross marks at nearby, non-atomic slots and are lower bounds within the top-20-per-mint census, not exploitable-value estimates.
