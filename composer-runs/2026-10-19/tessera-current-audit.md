# TesseraV current-binary, vault-donation audit

Checked 2026-10-19 on Solana mainnet-beta (`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). This is a bounded audit of the largest observed USDC and WSOL vault path, not a whole-program safety assessment. Every transaction described below was signed locally and passed only to `simulateTransaction` with `sigVerify:true`; none was broadcast. Transaction wire and secret key material were not saved.

## Deployment and custody

At confirmed slot **458744212**, the executable TesseraV program `TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH` pointed to ProgramData `BzSXM6KLDpHQQChzr7Fdgbzwp8r8zRYWFFrHK2uZmDYV`, last deployed at slot **446053401**. The executable ELF bytes had SHA-256 **`82fd37995fcece47a253b1a00c1dd7e4c3fff706b2e42384110e2cbabf4201b3`**. The program's upgrade authority was `7bJ9xu9UGVZPtYzH1fMwdaKdvfhqeSJtoFc2eGrXBPhK`. [Raw account snapshot](tessera-current-census.json).

| Shared-authority vault | Mint | Raw balance | Human balance |
| --- | --- | ---: | ---: |
| `37hggNyT4Ec8GEcxMLrWrZyrMSSFMSiFT6VBayRYceZH` | cbBTC | 254,015,399 | 2.54015399 |
| `9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx` | USDC | 3,780,408,046,711 | 3,780,408.046711 |
| `5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV` | WSOL | 16,173,061,045,106 | 16,173.061045106 |

All three token accounts designate off-curve `8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF` as token authority. This account is TesseraV-owned. Current successful swap receipts and our signed simulations show TesseraV making vault outflows with that authority. The two target pool accounts are TesseraV-owned, 1,264 bytes each. The global `BAT1Ndpu5gbLTp2AZkSXP79LJBZfCH4B3zGhi6LtvdhK` account is TesseraV-owned, 2,048 bytes; `4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs` is owned by `tickUcsEQegChaAuo9VYQQztB4ZGApY6ZT4FkULWY6N`.

## Interface and controls

Composer's [published-IDL endpoint](https://the-composer-svc.fly.dev/idl/TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH) returned no published IDL. Its [learned interface](tessera-composer-learn.json) scanned 250 current transactions and recovered 17 observed two-byte selectors from 245 instruction samples. Names are unknown. Swap selectors `1000`, `1001`, `1100`, and `1101` used 14 positional accounts; `0d01` and `0d0a` wrote the WSOL and cbBTC pools respectively with 782-byte payloads; `1504` wrote the global `BAT1...` account with an 87-byte payload. The pool/global update receipts used system-account signer `FVnv5qH7dsrBzEDwJ8dN2m9PFtKTBAQFtqWF3M9LpwMg`. Twelve newer held-out instructions matched Composer's selector and account shape. Two other sampled swap receipts differed on Composer's inferred transaction-level signer bit at account 2 because CPI authorities need not appear as top-level transaction signers. [Receipt evidence](tessera-receipt-shapes.json).

Exact update payloads with that signer replaced by the outsider `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` failed in signed, read-only simulation with custom error `0x3`: `0d01` on the WSOL pool, `0d0a` on the cbBTC pool, and `1504` on `BAT1...`. These are bounded authority checks; they do not decode every control field or establish all possible mutations. [Control probes](tessera-control-probes.json).

A direct 14-account `1001` swap signed by the outsider failed with custom `0xffff` before any token CPI, including with a zero minimum-out field. The same WSOL→USDC path supplied through current Jupiter `swap-instructions` succeeded as a Jupiter→Tessera CPI. Thus a learned account shape alone is insufficient to replay this route; the direct failure's exact guard is not established. [Direct probes](tessera-donation-sim.json), [routed probes](tessera-jupiter-donation-sim.json).

## Same-slot donation controls

I compared signed v0 transactions built from the current Jupiter Tessera route, holding swap inputs and all route accounts fixed. Each case stayed within the requested v1 envelope, at **642–711 wire bytes and 19 account keys**. All cases returned `err:null` under `sigVerify:true` and executed TesseraV successfully.

| Bank slot | Donated directly to vault before swap | Tessera swap input | Output to caller | Effect of donation |
| ---: | ---: | ---: | ---: | --- |
| 458745673 | 0 / 0.01 / 0.05 WSOL | 0.1 WSOL | 10.574254 USDC in all three cases | WSOL vault rose by precisely the donation; USDC output was identical. |
| 458745478 | 0 / 1 / 10 USDC | 10 USDC | 0.094600410 WSOL in all three cases | USDC vault rose by precisely the donation; caller's residual USDC fell by precisely the donation. |

The USDC-side test first swapped **0.2 WSOL for 21.139146 USDC** in the same atomic transaction, then donated USDC and made the 10 USDC reverse swap. The zero/1/10 USDC cases finished with 11.139146/10.139146/1.139146 USDC respectively, plus identical 0.094600410 WSOL. [WSOL donation evidence](tessera-jupiter-donation-sim.json), [USDC donation evidence](tessera-usdc-donation-sim.json).

This demonstrates that a direct change to either raw token-vault balance did **not** change the observed swap payout at these sizes and token precision. It is consistent with a stored pool quote, an external price input, or a raw-balance effect smaller than one output unit. The pool update selector and signer give evidence of separately writable pool state, but the closed binary's exact pricing formula is not established. These small controlled donations cannot rule out behavior at flashloan scale or on cbBTC pools.

The payout destination is caller-selected within an input-paid swap: a paired signed simulation at slot **458746189** changed both Jupiter route occurrences of the USDC destination from the payer's ATA to an unrelated existing USDC token account. The swap still consumed the payer's 0.1 WSOL and produced **10.567306 USDC** to whichever destination was supplied. This is not an unpaid vault outflow; it shows that recipient ownership is not bound to the payer in this route. [Destination probe](tessera-destination-probe.json).

## Independent exits and stopping point

Fresh `ExactIn` direct-route quotes chained the first leg's exact raw output into the second. The independent leg excluded TesseraV, and pool owners were checked by confirmed RPC. For **0.1 WSOL → independent BisonFi USDC → TesseraV WSOL**, the quote net was **−11,530 lamports before fees**, or at most **−16,530 lamports after a 5,000-lamport one-signature base fee**. For **100 WSOL → independent Kipseli USDC → TesseraV WSOL**, it was **−18,665,021 lamports before fees**, or at most **−18,670,021 lamports after that base fee**. The BisonFi pool owner was `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`; the Kipseli pool owner was `3TK9D8aoBFYjYZtKCjciPrVrRStsnvo7KmpcJqDavpaU`. These are time-separated quotes, not signed atomic execution. [Current exit screen](tessera-current-exit-quotes.json).

The 10,000 WSOL second quote and subsequent USDC/cbBTC extremes received HTTP **429** from Jupiter Lite. I did not construct an atomic flashloan route or claim a complete after-cost extreme-size result: the tested donation paths gave no extra output while consuming donated assets, the two completed independent exits were already negative before costs, and the remaining extreme quote chain was rate-limited. The earlier 2026-10-15 [direct-pair screen](../2026-10-15/tessera-major-pairs-screen.md) is older bounded evidence, not a substitute for current extreme-size execution. There is no demonstrated profitable outsider route or whole-program safety conclusion from this audit.

## High-input continuation

The continuation re-pinned the same deployed program at confirmed slot **458775950**. ProgramData, deploy slot, upgrade authority, and ELF SHA-256 were unchanged: ProgramData `BzSXM6KLDpHQQChzr7Fdgbzwp8r8zRYWFFrHK2uZmDYV`, deploy slot `446053401`, upgrade authority `7bJ9xu9UGVZPtYzH1fMwdaKdvfhqeSJtoFc2eGrXBPhK`, and ELF SHA-256 `82fd37995fcece47a253b1a00c1dd7e4c3fff706b2e42384110e2cbabf4201b3`. The refreshed Composer response was byte-identical to the earlier learned schema (SHA-256 `9255b7db6ef74543d96ddb1579c45389369385f703ee1d8c9a678d7414c64d8d`). [Fresh census](tessera-current-census.json), [Composer refresh](tessera-composer-learn-refresh.json).

A held-out successful receipt at slot **458775988** supplied a current 14-account WSOL/USDC template (`1100`). It executed under a transaction signer, debited the USDC side, increased the Tessera USDC vault by 5,589,826 raw units, and reduced the Tessera WSOL vault by 53,030,120 lamports. This held-out receipt was not part of Composer's learned examples. [Held-out receipts](tessera-receipt-shapes.json).

### Exact-state fork blocker and live control

An isolated fixed-bank fork at slot **458779291** continued to reject the small Jupiter→Tessera control with `0xffff`, even after eight target pool/global/price/vault/mint account images were captured atomically at mainnet slot **458778571** and applied byte-for-byte to the fork. The same current route succeeded in signed live-mainnet simulation at slot **458777839**. Consequently, the fork failures are treated as a simulator/state-coherence incompatibility, not as Tessera counterevidence, and no fork high-input result is claimed. [Pinned state](tessera-fixed-state.json), [invalid fork control](tessera-high-input-sweep.json), [successful live control](tessera-jupiter-donation-sim.json).

The live high-input precursor instead used a zero-fee KLend flash borrow, the current Jupiter→Tessera instruction, and an indexed KLend repay later in the same signed v1 transaction. The one-way probes intentionally reached repay with the borrowed input converted into the other asset; except for the 10-USDC case, repay therefore failed and rolled the transaction back. Exact executed SPL Token CPIs nevertheless showed the borrow, Tessera input, and Tessera output before rollback. Every packet was **1,044 bytes / 24 inline accounts / 6 instructions**, used `sigVerify:true`, and was never broadcast.

| Direction | Input | Executed Tessera output | Effective Tessera price | Independent exact-output exit | Net before network fees |
| --- | ---: | ---: | ---: | --- | ---: |
| WSOL→USDC | 0.1 WSOL | 10.563818 USDC | 105.638180 USDC/WSOL | Obsidian | −0.000083793 WSOL |
| WSOL→USDC | 100 WSOL | 10,566.413092 USDC | 105.664131 USDC/WSOL | BisonFi | −0.074784696 WSOL |
| WSOL→USDC | 1,000 WSOL | 105,659.361555 USDC | 105.659362 USDC/WSOL | GoonFi V2 | −1.226972996 WSOL |
| WSOL→USDC | 5,000 WSOL | 528,204.157327 USDC | 105.640831 USDC/WSOL | Whirlpool | −17.076293047 WSOL |
| USDC→WSOL | 10 USDC | 0.094601766 WSOL | 105.706272 USDC/WSOL | Kipseli | +0.003716 USDC quoted only |
| USDC→WSOL | 100,000 USDC | 945.771437903 WSOL | 105.733791 USDC/WSOL | Kipseli | −2.473249 USDC |
| USDC→WSOL | 1,000,000 USDC | 9,445.949377585 WSOL | 105.865484 USDC/WSOL | Whirlpool | −6,093.288904 USDC |
| USDC→WSOL | 3,000,000 USDC | 24,466.473635221 WSOL | 122.616771 USDC/WSOL | Whirlpool | −441,853.191233 USDC |

The independent legs were fresh direct quotes on the exact raw Tessera outputs and excluded TesseraV, but they were time-separated from the precursor simulations. [Signed precursors](tessera-mainnet-flash-precursor.json), [100 WSOL](tessera-mainnet-flash-wsol-100.json), [1,000 WSOL](tessera-mainnet-flash-wsol-1000.json), [5,000 WSOL](tessera-mainnet-flash-wsol-5000.json), [10 USDC](tessera-mainnet-flash-usdc-10.json), [100,000 USDC](tessera-mainnet-flash-usdc-100000.json), [1,000,000 USDC](tessera-mainnet-flash-usdc-1000000.json), [3,000,000 USDC](tessera-mainnet-flash-usdc-3000000.json), [exit screen](tessera-mainnet-flash-exit-screen.json).

### Atomic positive-precursor resolution

The isolated +0.003716-USDC quote at 10 USDC triggered full construction. By construction time the fresh direct quote had already turned negative. The signed **KLend + Project0** atomic v1 packet nevertheless completed end-to-end at **1,642 bytes, 35 inline accounts, 13 instructions, and 2 required signatures**. Both lender vaults were restored, all instructions returned `err:null`, and the caller's pre-existing USDC was measured before and after rather than treated as route proceeds. The caller lost **13,991 raw USDC (0.013991 USDC)** before network cost and **15,049 raw USDC (0.015049 USDC)** after the quoted 10,000-lamport two-signature base-fee equivalent. The transaction consumed 328,455 compute units.

The **Save + KLend + Project0** packet also fit the requested envelope at **1,877 bytes, 41 inline accounts, and 15 instructions**, but Tessera panicked with `memory allocation failed, out of memory` before the route completed. This is a construction/runtime blocker for that exact three-provider shape, not evidence of profit or a drain. [Atomic evidence](tessera-full-atomic-v1.json).

The high-input continuation therefore found no positive signed atomic route. It closes the prior HTTP-429 gap for the tested WSOL/USDC sizes, but it does not establish whole-program safety, cover cbBTC, or prove that every future market state is unprofitable.
