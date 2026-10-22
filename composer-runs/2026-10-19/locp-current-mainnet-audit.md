# Jupiter/Meteora Lock `Locp…Qqjn` current mainnet audit

Observed 2026-10-19. This is a defensive, bounded audit of the exact 21 escrow PDAs selected in the 2026-10-15 token-authority census. All chain calls were reads or `simulateTransaction`; no transaction was broadcast.

## Result

No outsider-accessible claim, recipient-redirection, cancellation, close, root-release, or pricing vector survived the reviewed controls. A fresh ephemeral outsider signed all current-fork mutation probes with `sigVerify:true`; claim failed the stored-recipient relation, while recipient update and cancellation failed their stored mode/party checks. The escrow and vault state remained unchanged.

This is a bounded negative result, not a claim that every Locp account or future upgraded ELF is safe. The balances are fragmented scheduled user vesting custody, not free protocol equity. Because no state-changing release or pricing vector survived, the user-specified condition for a maximal two- or three-provider flash composition was not met; constructing a funding-only packet would not add security evidence.

## Current deployment identity

At mainnet-beta slot **458,759,039**, program `LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn` remained executable under `BPFLoaderUpgradeable` and still pointed to ProgramData `7yXf8ZG1qdc6GdRUc6LxmwUJuUDUAqta84oPU7fsJ6Yy`.

| Field | Current value |
| --- | --- |
| Last deploy slot | `368684289` |
| Upgrade authority | `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ` |
| ELF length | 664,736 bytes |
| ELF SHA-256 | `e0ace82e092741fe0dfe9e5c8ec45dfdbc642bfc510bb9e126f1fb8a6142ab92` |
| Change since 2026-10-15 | None in ProgramData pointer, deploy slot, authority, length, or ELF hash |

The published Meteora `met-lock-sdk` snapshot at commit `c70db9516c2c8a42303d37d8313ea80e5ef1de0a` contains Locp's program ID and v0.5.0 IDL, including claim, claim-v2, cancel, close, recipient-update, and root-escrow flows. The readable Fogo fork remains corroborative only; it is not a verified build match for this ELF. The interface therefore was not unpublished, so a Composer-learn substitute was unnecessary.

## Exact 21 PDA proofs and present value

All **21/21** selected rows still pass every current binding:

- the 296-byte state is owned by Locp;
- `PDA(["escrow", stored_base], Locp)` reproduces the authority and stored bump;
- the controlled account is the ATA of that PDA for the stored mint and exact SPL Token/Token-2022 program;
- vault mint and token authority match the state.

The 21 rows span 11 mints. Eight had a current price mark, totaling **$389,236,036.26** at the captured token-registry prices. NYC, TOR, and CHI each had **45,499,999.999680** tokens in one selected escrow but no current price response, so they are excluded from that dollar subtotal. The largest current marked rows were:

| Asset | Selected escrow count | Current token amount | Current spot mark |
| --- | ---: | ---: | ---: |
| YZY | 3 | 630,000,000.000055 | $185.176m |
| DBR | 3 | 4,643,589,743.991206 | $87.918m |
| JUP | 4 | 188,829,535.001781 | $56.143m at $0.297322/JUP |
| WET | 3 | 770,000,000 | $38.160m |
| Verse | 1 | 450,000,000 | $8.949m |
| ZYLO | 2 | 315,000,000 | $6.733m |
| ARENA | 1 | 900,000,000 | $3.127m |
| MET | 1 | 8,962,500 | $3.030m |

These are spot marks of scheduled custody. They do not establish sale depth, liquid proceeds, protocol-owned TVL, or outsider-accessible value.

The five selected Token-2022 escrows use four unique mints. None currently has a permanent delegate, transfer hook, mint authority, freeze authority, mint-close authority, or default-account-state extension. NYC, TOR, and CHI have transfer-fee configurations with separate withheld-fee withdrawal authorities; that authority applies to withheld fees and is not a Locp principal-vault withdrawal path. ZYLO has only metadata extensions.

## Post-deploy program-signed outflow proof

The current RPC re-fetched successful transaction `Pp94BjG7zg9EGKKRRw2NGLJDQU2W8gEv6ac7RaVZnypcJLY98NDzrn2oSwibDWB5fCUhxXN5PvBLVKkfJVNc1Bz` at slot **380,739,286**, after deploy slot 368,684,289. Squads V4 was the top-level caller, Locp `ClaimV2` executed by CPI, and Locp was the immediate caller of the SPL `transferChecked` at stack height 3. The proved selected DBR vault `7zfsXz…N5AAy` transferred **256,410,256,410,275 raw DBR** under escrow authority `2V7DfG…1TC3`.

This proves the observed program-signed claim route. It is an authorized stored-recipient/Squads flow, not evidence of outsider authority.

## Fresh signed outsider mutation

The fork was backed by a current mainnet-beta endpoint and returned the mainnet genesis hash. The only synthetic state was 10 SOL-equivalent lamports for a fresh ephemeral outsider system account. Its private key was not saved. Every packet used a current fork blockhash, a valid outsider signature, `sigVerify:true`, and `replaceRecentBlockhash:false`.

Target: JUP escrow `6wsjaQ…eJe7`, vault `HG6XGe…TJDc`, stored creator/recipient `F4zqSu…LZ7o`.

| Mutation | Wire | Deployed-binary result |
| --- | --- | --- |
| Create fresh outsider JUP ATA, then `ClaimV2` one raw unit to it | 493 B / 11 keys / 1 signature | Fails Anchor **2001 `ConstraintHasOne`**; stored recipient is `F4zq…`, signer is the fresh outsider |
| Update stored recipient to the fresh outsider | 312 B / 5 keys / 1 signature | Fails **6005 `NotPermitToDoThisAction`** at `vesting_escrow.rs:170` |
| Cancel existing escrow as the fresh outsider | 445 B / 10 keys / 1 signature | Fails **6005 `NotPermitToDoThisAction`** at `vesting_escrow.rs:161` |

Persisted fork account digests before and after the simulations are identical. The temporary ATA creation in the failed claim packet rolls back atomically. Observed outsider token gain and escrow release are zero.

## Flash-composition decision

No tested outsider route passed the stored recipient/creator authorization boundary, and no share-price, debt, donation, or oracle-dependent release calculation exists in the reviewed vesting schedule. Temporary JUP or USDC cannot manufacture the required stored signature or Squads approval. Therefore the requested conditional two-/three-provider flash phase was **not run**: there was no surviving state-changing release/pricing vector to amplify, repay, or price. This avoids presenting a transport-only flash packet as exploit evidence.

## Evidence

- [`locp-current-refresh.json`](locp-current-refresh.json): current ProgramData/ELF proof, all 21 current PDA/ATA rows, current balances/prices, and re-fetched post-deploy receipt.
- [`locp-signed-outsider-fork.json`](locp-signed-outsider-fork.json): signed `sigVerify:true` claim/update/cancel mutations, wires, logs, and persisted before/after digests.
- [`locp-token2022-extensions.json`](locp-token2022-extensions.json): current extension and authority inventory for the selected Token-2022 mints.
- [`locp-current-refresh.js`](locp-current-refresh.js), [`locp-signed-outsider-fork.js`](locp-signed-outsider-fork.js), and [`locp-token2022-extensions.js`](locp-token2022-extensions.js): reproducers. None contains a send/broadcast path.
- Prior interface/source/control context: [`../2026-10-15/locp-source-audit.md`](../2026-10-15/locp-source-audit.md) and [`../2026-10-15/locp-current-binary-composition.md`](../2026-10-15/locp-current-binary-composition.md).

## Limits

- The exact 21 selected escrows are a bounded high-value set, not every Locp escrow.
- The deployed program remains upgradeable; conclusions bind to the recorded ELF hash.
- The readable Fogo source is not a verified build match; current-binary receipts and simulations carry the gate evidence.
- Price marks are non-atomic spot observations and are not realizable liquidation values.
- An approved Squads vault action, stored creator/recipient key compromise, Token-2022 withheld-fee authority, or loader upgrade authority is a separate privileged boundary, not a demonstrated permissionless Locp bypass.
