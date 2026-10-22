# Solana mainnet bridge / interop custody canvass and CCTP current-binary audit

Date: 2026-10-15 (America/Toronto)  
Mode: read-only mainnet RPC, historical transaction reads, and `simulateTransaction`; **zero submitted transactions**

## Scope status — not an exhaustive all-program denominator

This report does **not** claim that every Solana mainnet bridge program has been identified. Solana has no canonical registry that labels every deployed program by protocol role, and several bridge designs deliberately deploy one custom program or pool per token. Wormhole NTT, LayerZero OApps outside the canonical OFT program, Chainlink CCIP token pools, Hyperlane Warp Routes, and protocol-specific BTC bridges are examples. A scan of every executable address cannot decide from bytecode alone whether the program is a bridge, and program-owned state does not necessarily expose every PDA signer or per-order wallet.

The exact discovery denominator for this pass is the **15 family buckets** enumerated below. Exact denominators are stated for each enumerable registry. Where no registry or invertible on-chain index exists, the blocker is stated rather than treating a sample as exhaustive.

## Executive result

The largest newly verified direct bridge custody outside the separately audited Wormhole Token Bridge is Circle CCTP:

| Rank | Family / risk type | Verified live amount | USD basis | Denominator / qualification |
|---:|---|---:|---:|---|
| 1 | Circle CCTP V1 + V2 — locked USDC backing | 161,324,913.116182 USDC | **$161,255,195.32** | Exactly 2 `LocalToken` states and 2 live custody accounts; refreshed at slots 457348885–457348886 |
| comparison | Wormhole Token Bridge — locked backing | 837 nonzero custody accounts | **$53,760,002.42 priced lower bound** | Separately audited and excluded from the new-target audit; 238 priced, 599 unpriced |
| 2 | LayerZero OFT adapters — locked backing | 11 adapters, 9 positive | **$69,269.45 priced lower bound** | Exactly 37 canonical OFT configs: 11 adapters and 26 native/burn-mint; one positive adapter is unpriced |
| 3 | Allbridge Classic — locked backing | 2 distinct native vaults | **$38,225.43** | 104 exact asset records contain 4 native records, but route records reuse only 2 distinct vaults |
| lower bound only | Mayan family — sampled escrow owners | 8 positive token accounts observed | **$41.80 priced + 2 unpriced accounts** | Exact state-account counts, but only 500 owners per large program were inspected; cannot be ranked as a complete family total |
| inactive state | Allbridge Core legacy pools | 2 pool states | **$0 live custody** | Both derived bridge-token PDAs are closed/missing; stale accounting fields were not counted |

USD values use the contemporaneous DefiLlama price response. The CCTP value moved materially during the run as transfers settled; the table is a slot-specific snapshot, not a fixed TVL assertion.

No exploitable current-binary exit was validated. The highest-value exit, CCTP `receive_message → handle_receive_*`, was exercised through successful post-deployment historical controls and then replayed read-only against current state. V1 rejected the replay with `NonceAlreadyUsed`; V2 rejected it because the one-time nonce PDA already existed. Both custody balances were unchanged by the probes.

## Locked backing is not wrapped-mint risk

The ranking above includes only live token accounts actually controlled by a verified program-derived authority. It does not add wrapped supply to locked backing:

| Family | Mint-control denominator | Priced supply exposed to bridge mint authority | Unpriced positive supply |
|---|---:|---:|---:|
| Allbridge Classic | 50 distinct wrapped SPL mints, from 100 route records | $3,395,347.89 | 22 mints |
| LayerZero native OFT | 26 exact native configs | $2,741.54 | 15 configs |
| Wormhole NTT | No canonical global manager registry | unknown | unknown |
| Portal NFT Bridge | Separate direct-custody/mint-authority census below | NFTs intentionally not forced into fungible-token pricing | potentially material |

Mint-risk supply is a liability/control surface, not additional backing. Adding it to a locked-vault total would double count claims. The same restraint applies to LST and LP tokens: their quoted market value can overlap underlying SOL or pool assets elsewhere in the ranking. Accordingly, this report does not publish a single cross-family “total value secured.”

Mayan MCTP and current Allbridge CCTP routes ultimately depend on Circle CCTP custody; those integrations are not counted again. The current Allbridge API advertises CCTP / intent routes while its legacy Core pool token accounts are closed.

## Exact family queue (15 / 15 buckets inspected or blocked explicitly)

| # | Family bucket | Current result | Exact denominator or concrete blocker | Next value-ordered action |
|---:|---|---|---|---|
| 1 | Circle CCTP V1/V2 | Complete custody census and current-binary exit validation | 1 V1 + 1 V2 `LocalToken`; both vault authorities equal the derived `token_minter` PDA | Continue monitoring balances and new `LocalToken` states |
| 2 | Wormhole Token Bridge | Separate complete artifact; excluded from new audit | 1,308 token accounts controlled, 837 nonzero; 599 unpriced | Keep as comparison; do not double count here |
| 3 | Wormhole Core + Portal NFT | Core is messaging only; Portal NFT executable and direct signer custody confirmed | Core fee collector is not backing. Portal NFT has 16,890 program-owned accounts; its `custody_signer` owned exactly 3,388 classic SPL token accounts, 2,981 positive. The resumable `mint_signer` scan reached 2.4 million accounts of page capacity and observed 26 controlled mints, but the provider applies the sparse authority filter after paginating the global Token Program keyspace, so this is only a lower bound | Resume the NFT mint census from its checkpoint; classify unsolicited fungible balances separately from canonical NFT custody |
| 4 | Wormhole NTT | Global census blocked | Each token deploys its own custom manager; no canonical on-chain manager registry. The official SDK’s Jito sample manager address is no longer deployed | Enumerate deployment manifests, token websites, and Wormhole registry inputs; classify every manager as Locking or Burning |
| 5 | LayerZero Endpoint + OFT/Adapter | Complete for the canonical OFT program | Exactly 195 program-owned accounts, including 37 `OftConfig` accounts: 11 adapters and 26 native | Resolve every OApp’s Endpoint/DVN/peer configuration before equating their security assumptions |
| 6 | Allbridge Classic | Complete for exact 220-byte asset state | 104 asset records: 4 native records → 2 distinct vaults; 100 wrapped route records → 50 distinct mint authorities | Protocol is deprecated but still has live custody/mint exposure |
| 7 | Allbridge Core and CCTP routes | Complete for legacy Core pools; CCTP backing counted under Circle | Exactly 2 legacy pool states; 0 live derived token PDAs | Monitor state closure and current route changes |
| 8 | deBridge DLN | Program census partial; active custody census structurally blocked | Destination: 1,777,961 program accounts; executor: 59,718. Source response exceeded the provider/string limit. More importantly, `GiveOrderState` omits `orderId`, so `give_order_wallet(orderId)` cannot be inverted from state alone | Build a complete create-order event/transaction index and derive every still-live order wallet |
| 9 | deBridge Gate / dePort | Program identity and state count verified; custody classification incomplete | Gate: 709,571 program accounts; settings: 1,470; immutable current programs | Decode exact Gate asset/state discriminators before valuing any signer-owned accounts |
| 10 | Mayan / MCTP / Fast MCTP / Swift v1/v2 / MPS | Exact state denominators; bounded owner scan only | 13,068 / 221,013 / 21,911 / 1,887,070 / 569,730 / 2 accounts. First 500 owners inspected for each large program; MPS 2/2 | Index escrow creation/settlement events, then scan every unresolved escrow ATA without double-counting CCTP |
| 11 | Chainlink CCIP | Enumeration blocked in this pass | Canonical Router plus per-mint burn/mint or lock/release pools; current addresses and token mappings are surfaced through the client-rendered CCIP Directory / TokenAdminRegistry rather than one completed local registry | Extract the current Solana Router, registry, and every registered pool; separate BurnMint from LockRelease |
| 12 | Hyperlane Warp Routes | Enumeration unresolved | Permissionless/custom route deployments; no verified complete Solana deployment registry was obtained | Ingest official registry manifests and derive every collateral vault / synthetic mint authority |
| 13 | Axelar ITS / Gateway | Enumeration unresolved | No verified complete current Solana program/pool registry was obtained | Resolve official current deployment manifests before any custody assertion |
| 14 | Across | Enumeration unresolved | No verified complete current Solana spoke-pool deployment registry was obtained | Confirm whether a current Solana deployment exists and enumerate spoke-pool custody if so |
| 15 | Protocol-specific / validator-vault bridges (Zeus BTC family, NeonPass, Chainflip/THORChain-like, other BTC wrappers) | Open expansion bucket, not a claim of one protocol | Heterogeneous signer, MPC, external-chain, and per-token models; no common on-chain registry | Split into named programs from current token mint authorities and bridge manifests, highest value first |

This is an exact **queue denominator**, not proof that the open-world set contains only 15 families.

## Custody proofs

### Circle CCTP V1 and V2

Program IDs:

- V1 MessageTransmitter: `CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd`
- V1 TokenMessengerMinter: `CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3`
- V2 MessageTransmitter: `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`
- V2 TokenMessengerMinter: `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe`

The exact account rule was the Anchor discriminator for `LocalToken`. Each program had one state, for the canonical USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. The state’s `custody` field and mint were decoded, and the live SPL token account authority was compared to PDA `["token_minter"]` under the corresponding TokenMessengerMinter program.

| Version | Token-minter PDA | Custody account | Live USDC | Authority match |
|---|---|---|---:|---|
| V1 | `DBD8hAwLDRQkTsu6EqviaYNGKPnsAMmQonxf7AH8ZcFY` | `FSxJ85FXVsXSr51SeWf9ciJWTcRnqKFSmBgRDeL3KyWw` | 121,453,054.761941 | yes |
| V2 | `E1bQJ8eMMn3zmeSewW3HQ8zmJr7KR75JonbwAtWx2bux` | `6xTBTqJMBr5m7BKqVxmW2x11DfqUwtD3TJsqpxELx72L` | 39,871,858.354241 | yes |

These are prefunded USDC release vaults. CCTP does **not** hold the USDC mint authority; Circle’s canonical USDC mint authority is separate. The bridge risk is release of locked backing, while the cross-chain trust assumption is Circle’s Attestation Service and the correctness/finality of the source-chain burn message.

### LayerZero OFT

Canonical Solana Endpoint: `76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6`  
Canonical OFT program: `HRPXLCqspQocTjfcX4rvAPaY9q6Gwb1rrD3xXWrfJWdW`

Every `OftConfig` discriminator under the canonical OFT program was enumerated. For an Adapter config, the decoded escrow account had to be live and its SPL owner had to equal that exact `OftConfig` PDA. For Native configs, the mint’s current mint authority had to equal the config PDA. All 11 adapter escrows matched; 9 were positive, 8 priced and one unpriced. All 26 native configs observed the state PDA as the mint authority.

The Endpoint and OFT binaries are immutable (`upgradeAuthority: null`), at deploy slots 268607546 and 268618701. Their ELF SHA-256 values are:

- Endpoint: `ebda3d7051d2f4547f604d564b4006f08916319650d429bbd7096569492f067e`
- OFT: `938d5a70744bf09132b9f44033123ff28130a8d94f1bf9cb8a464b3e4b23cf7f`

The per-OApp DVN, executor, peer, and admin configuration remains a distinct security assumption. Exact OFT custody does not imply every config has the same verifier set.

### Allbridge Classic and Core

Classic program: `BBbD1WSjbHKfyE3TSFWF6vx1JV51c8msKSQy4ess6pXp`  
Bridge authority: `CYEFQXzQM6E5P8ZrXgS7XMSwU3CiqHMMyACX4zuaA2Z4`

The exact Classic discriminator/layout yielded 104 asset records. Four records were native/locking entries, but they reused two vaults. Both live token-account authorities matched the bridge PDA. One vault held only 0.049495 ORCA; the other held 12,236,100.047907889 units of mint `5JnZ…`, worth approximately $38,225.33 at the sampled price. The remaining 100 route records collapsed to 50 distinct wrapped mints controlled by the same bridge authority.

Core program: `BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB`

Two Pool states remain, for USDC and USDT. The official SDK derives the bridge token account as `["token", mint]`, but both derived accounts were absent. Pool accounting fields were therefore treated as historical/stale state and valued at zero, rather than pretending they were tokens under program control.

### Mayan lower bound

The six exact program-account counts are recorded above. The direct owner scan found eight positive SPL accounts in the first 500 legacy Mayan state owners, with a $41.80 priced lower bound and two positive unpriced accounts. This is **not** a Mayan family total. The large Swift and MCTP programs require an indexed escrow/event traversal; arbitrary first-500 state order is only a bounded discovery probe.

MCTP releases rely on Circle CCTP. Any USDC observed in Circle custody is counted only under CCTP.

### Wormhole Core and Portal NFT variant

Wormhole Core `worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth` is the guardian/message layer. Its `["fee_collector"]` PDA is a native-lamport fee account, not token backing.

The legacy Portal NFT program `WnFt12ZrnzZrFZkt2xsNsaNWoQribnuQ5B5FrDbwDhD` is a live executable with exactly 16,890 program-owned accounts. Its `["custody_signer"]` PDA is `D63bhHo634eXSj4Jq3xgu2fjB5XKc8DFHzDY9iZk7fv1`. At slot 457352281, `getTokenAccountsByOwner` returned exactly 3,388 classic SPL token accounts under that signer, 2,981 with positive balances. Most observed accounts are zero-decimal NFT-like mints, but the owner set also contains fungible balances and can accept unsolicited transfers; it is therefore reported as a signer-control denominator rather than assigned a fungible USD value. The bridge’s `["mint_signer"]` PDA is `3iBi3CaSBMR72MB5RGqwAu2CsgQVEFUrmTEHBvym8f9i`. Its resumable global Token Program crawl completed 240 pages with 2.4 million accounts of page capacity and observed 26 matching mint authorities. The provider paginates the global Token Program keyspace before applying this sparse filter, so the result is explicitly a lower bound, not an exact mint-authority denominator; the preserved pagination key permits continuation.

### deBridge / DLN structural blocker

Current official package program IDs were verified on mainnet:

- deBridge Gate `DEbrdGj3HsRsAzx6uH4MKyREKxVAfBydijLUF3ygsFfh`
- settings `DeSetTwWhjZq6Pz9Kfdo1KoS5NqtsM6G8ERbX4SSCSft`
- DLN source `src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4`
- DLN destination `dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo`
- executor `exe59FS5cojZkPJVDFDV8RnXCC7wd6yoBjsUtqH7Zai`

DLN is an intent/per-order escrow design, not one pooled bridge vault. The source client derives `GiveOrderState` and `GiveOrderWallet` independently from `orderId`. The state stores status and PDA bumps but not the original `orderId`, so a program-account scan cannot invert an order state address into its token wallet. An exact active-custody denominator therefore requires a complete create-order event or transaction index followed by closed/claimed-state reconciliation. This concrete blocker is why no deBridge USD figure appears in the rank table.

## Highest-value current-binary exit audit: CCTP

### Current deployments

| Program | Last deployed slot | Upgrade authority | ELF SHA-256 |
|---|---:|---|---|
| V1 MessageTransmitter | 312515728 | null | `091f843d5287ff8ecf078fcfb5317c357e29666b8f1467400ab0080b155754c8` |
| V1 TokenMessengerMinter | 262177984 | null | `1c48a53d95e12547f49f01cb2bc3c16c1fba8ba65ac102999fa0f71ade8e851b` |
| V2 MessageTransmitter | 343321624 | null | `72021bdabcda528726f65189db421234808ff21a3af74a3e15a69a91d975a392` |
| V2 TokenMessengerMinter | 343322709 | null | `7493e02a34935898883671581de90d733e1f52a1a7820c699d9398e179898359` |

All four binaries are immutable. Circle’s current repository identifies source commit `4b9da71265997e1f29e109837da34e6f783f1a22` for V1 and `b37d577fc1dc317ce9bc0316c5063afe38744ce3` for V2. Per the no-build/no-Docker constraint, I did not reproduce the verifiable builds; the source-to-ELF match remains dependent on Circle’s published verification mapping. The on-chain hashes, deploy slots, and immutability were read independently.

### Exit authorization reviewed

The release path requires:

1. MessageTransmitter attestation validation over the full message.
2. Correct source domain, nonce, destination/receiver, and one-time nonce state.
3. A MessageTransmitter-derived authority PDA signing the CPI into TokenMessengerMinter.
4. A registered remote token messenger matching the message sender/domain.
5. A linked local/remote token pair, intended recipient, and the exact custody PDA for that mint.
6. Token transfer signed by the `["token_minter"]` PDA.

V2 additionally splits finalized/unfinalized receive paths and binds expiration, executed fee, maximum fee, and finality threshold behavior. The reviewed source did not expose an arbitrary caller path to make the custody signer transfer without the authenticated message chain.

### Positive and replay controls

| Version | Successful control | Why it is current-binary evidence | Replay result | Custody effect of probe |
|---|---|---|---|---|
| V1 | Signature `2igvKX…PMP`, slot 457344007; `ReceiveMessage → HandleReceiveMessage → SPL transfer` | Transaction postdates both current deploy slots, and both programs are immutable | Custom 6023, `NonceAlreadyUsed`; 131,744 CU | unchanged at 123,572,680.766837 USDC during probe |
| V2 | Signature `4zT1QR…4bv`, slot 457344316; `ReceiveMessage → HandleReceiveUnfinalizedMessage → SPL transfers` | Transaction postdates both current deploy slots, and both programs are immutable | System allocate failed because used-nonce PDA already existed; 22,188 CU | unchanged at 40,056,940.775743 USDC during probe |

This establishes one intended success path and one negative anti-replay control for each live version. It is not a proof that every possible attestation, admin, parsing, or cross-chain finality failure mode is safe. No unauthorized exit or reportable vulnerability was produced.

## Flashloan-extreme reachability screen

The custody finding was also screened for an atomic 4,096-byte / 64-inline-account composition:

- Kamino’s inspected USDC reserve supply account held **7,820,864.800722 USDC** at slot 457348887. A read-only same-reserve `FlashBorrowReserveLiquidity → FlashRepayReserveLiquidity` control succeeded at 55,210 CU. This demonstrates mechanics, not that the entire token-account balance is borrowable after reserve rules and fees.
- Project 0 / marginfi had exactly 14 verified positive USDC liquidity vaults totaling **282,167.452159 USDC** at slot 457342801. That is custody availability, not proof each bank permits an uncollateralized flash route. The positive Project 0 flash composition used wSOL, not USDC.
- Project 0’s standalone v1 flash control succeeded at 671 bytes / 14 accounts / 105,813 CU. A composed Project 0 + Jupiter vault control succeeded at 1,691 bytes / 41 accounts / 202,954 CU.
- The successful CCTP V1 receive used 18 resolved accounts / 183,295 CU; V2 used 22 resolved accounts / 206,547 CU. A simple worst-case account union with the 41-account Project 0 composition is 63 resolved accounts before overlap, so the account envelope is mechanically plausible. I did not present that arithmetic as a successful combined route: instruction data, writable duplication, fees, and exact inline/lookup placement still require a constructed simulation.

The decisive blocker is authorization, not transport size. Flash liquidity cannot create a Circle attestation bound to a chosen amount and recipient. Reusing the only available completed message fails the current binary’s nonce control. Therefore no atomic flash-funded unauthorized CCTP withdrawal/claim/settlement path was reached.

For other families, the same distinction applies: LayerZero receive requires an authenticated Endpoint/OApp packet under that config’s verifier stack; Allbridge receive requires its bridge-message authorization; Mayan and DLN settlement require a valid escrow/order/message state. Flash liquidity can fund a legitimate outbound or fulfillment leg, but is not itself an exit authorization.

## Method and limitations

- Only live SPL token accounts whose authority matched a derived program signer were counted as custody.
- Pool/accounting fields without a live token account were rejected as custody evidence.
- Native/burn-mint deployments were reported separately from lock/release vaults.
- Duplicate route records were collapsed by live token-account or mint address.
- Unpriced tokens and NFTs remain explicit counts, never silently valued at zero.
- No dashboard TVL was used as custody proof.
- No transaction was submitted. Simulations used existing signed transactions with signature verification disabled by RPC simulation, and all pre/post custody reads were unchanged.
- Prices, vault balances, active orders, and bridge registries are time-sensitive.
- The global all-mainnet bridge denominator remains blocked by the lack of a canonical role registry and permissionless per-token deployments.

## Artifacts

- [`mainnet-bridge-custody.json`](./mainnet-bridge-custody.json) — CCTP, Allbridge, Mayan, and registry census
- [`bridge-expansion-custody.json`](./bridge-expansion-custody.json) — exact LayerZero OFT configs, NTT sample check, and deBridge program counts/metadata
- [`bridge-ranked-summary.json`](./bridge-ranked-summary.json) — deduplicated values and flash reachability evidence
- [`cctp-current-binary-validation.json`](./cctp-current-binary-validation.json) — successful post-deployment controls, replay simulations, deploy slots, and ELF hashes
- [`portal-nft-custody.json`](./portal-nft-custody.json) — exact Portal NFT direct custody plus an explicitly incomplete 26-mint authority lower bound
- [`portal-nft-custody.json.mint-checkpoint.json`](./portal-nft-custody.json.mint-checkpoint.json) — resumable 240-page mint-authority checkpoint
- [`wormhole-token-bridge-custody.json`](./wormhole-token-bridge-custody.json) — separately audited comparison family
- [`scan-mainnet-bridge-custody.js`](./scan-mainnet-bridge-custody.js)
- [`scan-bridge-expansion.js`](./scan-bridge-expansion.js)
- [`summarize-bridge-custody.js`](./summarize-bridge-custody.js)
- [`probe-cctp-current-binary.js`](./probe-cctp-current-binary.js)
- [`scan-portal-nft.js`](./scan-portal-nft.js)

Primary implementation/deployment references:

- Circle Solana CCTP: <https://github.com/circlefin/solana-cctp-contracts>
- Wormhole Solana NTT manager: <https://wormhole.com/docs/products/token-transfers/native-token-transfers/reference/manager/solana/>
- Wormhole mainnet contract addresses: <https://wormhole.com/docs/reference/contract-addresses/>
- LayerZero v2 Solana programs: <https://github.com/LayerZero-Labs/LayerZero-v2>
- Chainlink CCIP v1.6 on Solana: <https://docs.chain.link/changelog/ccip-v1-6-on-solana>
- Helius paginated program-account semantics used for very large registries: <https://www.helius.dev/docs/api-reference/rpc/http/getprogramaccountsv2>
