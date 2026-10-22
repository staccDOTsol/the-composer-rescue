# Next value-first Solana controller queue

**Historical assignment snapshot.** Several rows below have since been tested;
use the [current breadth-first triage](breadth-first-current-triage.md) for
their observed gates and remaining work. "Unassigned" below describes the
earlier dispatch state, not the current audit state.

Observed 2026-10-15. Read-only mainnet account refresh at slot **457353222**;
16 executables and 28 selected token vaults were checked, and all 28 live
token authorities and mints matched the prior custody inventory. No transaction
was submitted. The [machine-readable queue](./next-value-first-unassigned-queue.json)
contains full vault/authority addresses, raw balances, signer-outflow
signatures, deployment slots, and lending-reserve IDs.

## Denominator and assignment exclusion

The exact executable-program census contains **77,715** IDs. The token
discovery pass is bounded to the top 20 accounts of 3,987 Jupiter-verified
mints; this is not a chain-wide custody census. The assignment snapshot
contains **48 Daybreak chats**, including the recently dispatched Hylo
Exchange, OnRe, Hylo Stability Pool, Orca xORCA staking, Solstice YieldVault,
both PRIME controllers, and Chnry USDG. Those eight exact controllers appear
in the JSON only as an assigned overlay and are excluded from the queue below.

The USD figures are live vault balances multiplied by a prior registry price.
They are **not realizable liquidation amounts or proven outsider losses**.
The "current signer vault mark" counts only vaults with a successful outgoing
Token CPI whose immediate caller was the candidate program **after its current
ProgramData deployment**. It proves that the deployed program can sign that
particular outflow, not that a different caller can withdraw the full balance.
No full-balance executable swap quote or atomic flash+exit+repay simulation
exists for these eight.

## Unassigned, with current-binary signer evidence

| Order | Program / exact ID | Live selected mark | Current signer vault mark | Custody and proof | Flash / 4,096-byte v1 status |
|---:|---|---:|---:|---|---|
| 1 | LFNTY controller `LLoc8JX5dLAMVzbzTNKG6EFpkyJ9XCsVAGkqwQKUJoa` | **$42.431m** | **$42.431m** | Authority `AvtfUvU3byPXgp6Dpw3mgKB2BbVwQvGyry9KeMzD9BLc`, vault `7h4m5Qggvp44FV8KDFv4NoiQtm1hTkCzhHp1t8MuANTk`; post-deploy signer outflow at slot 456588704. Program identity, claim rules, and market depth remain unresolved. | No same-mint zero-rate KLend reserve in the census; exact composition unbuilt. |
| 2 | ZBCN controller `zbcKGdAmXfthXY3rEPBzexVByT2cqRqCZb9NwWdGQ2T` | **$28.144m** | **$28.144m** | Two vaults under distinct authorities; both sampled signer outflows postdate deployment. Larger: authority `H8Hr964ApEP3ie1rwRTT7wkSrgvUqJQb8oNAKspkDDfR`, vault `5L4EM1G2uTCrrXgvbwtQqrJkbU9qNDcpLbZ5yKCsb4yB` ($15.761m mark). Second vault/authority are in JSON. | No same-mint zero-rate KLend reserve in the census; exact composition unbuilt. |
| 3 | FOXY controller `FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP` | **$9.922m** | **$9.922m** | Authority `Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m`, vault `32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h`; signer outflow at slot 457344744. | No same-mint zero-rate KLend reserve in the census; exact composition unbuilt. |
| 4 | USDu controller `VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj` | **$4.280m** | **$0.0646m** | Authority `ENcCimzGPU6dNih1qnsSShTYBu9rRERnF4Wwx7BVVt7h` owns both USDu vaults. Sampled post-deploy signer outflow is only from the smaller `xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb`; the $4.216m vault's exit is not yet proved. | No same-mint zero-rate KLend reserve in the census; exact composition unbuilt. |
| 5 | Bison venue `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | **$1.058m** selected | **$0.489m** | Program-signed ETH exit from `GgSbe8Pbbh2n35gLxB3yjCW8WVUtBQMcLR7Vc2a1Mrnu` via a Jupiter-rooted route at slot 457347644. The selected $0.569m USD1 vault has no sampled exit. | Same-mint KLend/Project 0 ETH inventory exists. Adding a whole observed exit to the Project 0 flash control yields **2,705 B / 64 accounts**; the actual combined route is unbuilt. |

These five deserve program-specific authorization and economic-path tests. The
LFNTY/ZBCN/FOXY marks have no measured full-size liquidation depth, so the
table does not order them by immediately extractable dollars. Shared lending
inventory and token claims are not added across programs.

## High-value leads needing a current-binary spend proof

| Program / exact ID | Live selected mark | Concrete gap |
|---|---:|---|
| `pytS9TjG1qyAZypk7n8rw8gfW9sUaqqYyMhJQ4E7JCQ` | **$123.574m PYTH** | Seven program-owned authority vaults; all sampled signer exits occurred **before** the current deployment at slot 452251334. This resembles distribution/treasury custody, and no outsider claim path is established. |
| `GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw` | **$45.301m PHY** across two selected vaults | Live token authority states are program-owned, but the bounded recent-history scan found no successful signed outflow. Prior broader census mark was $58.795m; the refreshed two-vault subset is lower. |
| `1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78` | **$11.177m** selected, including $8.490m USD.infra | No sampled USD.infra outflow. The sampled Bonk outflow predates the current deployment at slot 440130674. Prior broader census mark was $38.620m. |

These are high-value mapping tasks, not current exit candidates. Mint
authority or ownership of an authority-state account was not treated as
permission to spend a token vault.

## Reproduction and limits

- [Account refresh](./next-value-queue-current-accounts.json) was produced by
  [refresh-next-value-queue.py](./refresh-next-value-queue.py) using only
  `getMultipleAccounts`.
- [Queue JSON](./next-value-first-unassigned-queue.json) was produced by
  [build-next-value-queue.py](./build-next-value-queue.py) from live token
  accounts, post-deployment transaction provenance, [active zero-rate KLend
  reserves](./klend-zero-fee-census.json), and [the 48-chat assignment
  snapshot](./daybreak-assignment-snapshot-current.json).
- Zero-rate reserve availability is a read-only state snapshot, not a tested
  borrow limit. A transport estimate under 4,096 bytes / 64 accounts is not
  an authorized withdrawal or economic exploit.
- Accounts below the top 20 per verified mint, unverified mints, native SOL
  and stake, and compressed assets are outside this queue's token denominator.
