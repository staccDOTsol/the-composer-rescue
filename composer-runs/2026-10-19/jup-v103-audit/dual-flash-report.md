# Jupiter Lend Vault 103: two-provider atomic funding check

2026-10-19 UTC. This is a follow-up to [the current-state audit](report.md), using the exact deployed mainnet-beta accounts in a local Surfpool fork. The test signed versioned transactions with `sigVerify:true`; it did not broadcast a mainnet transaction. Synthetic signer token balances were installed **only in the fork**. Raw receipts, account balances, and packet metadata are in [dual-flash-current.json](dual-flash-current.json); the reproducible driver is [dual-flash-current.js](dual-flash-current.js).

## Self-contained independent exit: executable, loss making

The signed atomic packet executed Project0 margin-account initialization/start, a **3,400 USDC KLend flash borrow**, a **100 USDC Project0 flash borrow**, oracle reads, a Jupiter DEX A buy of **3,000 sUSDai**, an independent Whirlpool B sale of all 3,000 sUSDai, both repayments, and Project0 end. The Project0/KLend funding-only control also succeeded. The full packet succeeded at fork slot **458753487** with `err:null`, **2,251 serialized bytes, 53 account keys, 13 instructions, two signatures, and 653,891 CU**. It therefore fits the requested 4,096-byte/64-key envelope.

Exact final account deltas, in native token units:

| Account | Delta |
| --- | ---: |
| Actor USDC | **−20.598719 USDC** |
| Actor sUSDai | **0 sUSDai** |
| KLend supply vault and fee vault | **0 USDC each** |
| Project0 lending vault | **0 USDC** |
| DEX A USDC vault | +3,349.497671 USDC |
| DEX A sUSDai vault | −3,000 sUSDai |

The actor's initial synthetic 100 USDC absorbed the trading loss; it did not create the return. The DEX A leg spent 3,349.497671 USDC and the independent exit returned 3,328.898952 USDC. Both loans were fully repaid in the same successful packet. This is a measured **20.598719 USDC loss before SOL transaction fees**, not a drain or profitable flash route. The signed oracle value was effectively unchanged over this small route (read values `2004189023801498` then `2004187566561372`, X15 scale).

## Near-maximum source and pool boundary: diagnostic only

The fork's KLend reserve-account available amount was **11,014,651.074097 USDC**. The selected Project0 USDC bank vault held **391,459.082848 USDC**; a standalone Project0 borrow/repay probe succeeded through **390,392.577765 USDC** and failed at the next raw unit with `IllegalUtilizationRatio` (6026). To allow drift in a combined packet, the large diagnostic used Project0 **389,392.577765 USDC**, 1,000 USDC below that standalone limit, together with the full KLend available amount: **11,404,043.651862 USDC** in two provider programs. This is a near-maximum *attempted source mix*, not a proven concurrent maximum over every size.

The largest successful DEX A output in that diagnostic was **5,874,538.588470 sUSDai**; one raw unit more failed `WithdrawalLimitReached` (6028). Its successful signed packet at fork slot **458753517** was **1,768 bytes, 41 keys, 10 instructions, two signatures, 416,346 CU**. Both lender vaults returned to their starting balances. The oracle moved from `2004189023811856` to `2002835125142007` (X15), a **6.755344200388702 bps** decline. The closest current borrower requires **288.80933886 bps** to reach liquidation, so this maximum measured move reaches only about **2.34%** of that threshold.

**This large packet is not a self-funding executable attack.** Its fork actor started with a synthetic **10,000,000 USDC repayment buffer**. It ended with **6,568,763.575071 fewer USDC** and **5,874,538.588470 more sUSDai**. There was no independent B exit at that size in the packet; the observed independent public route was buildable at 3,000 sUSDai, while the larger probes did not establish a buildable route. The buffer let the lenders be repaid solely to measure the deployed DEX/oracle boundary. Its final token inventory cannot be described as realized profit or a repayable zero-capital arbitrage.

## Provider coverage and limits

The bounded [current USDC/sUSDai lending inventory](loan-inventory.json) found two KLend USDC reserves and two Project0 USDC banks. Multiple KLend reserve flashes in one transaction had already failed the deployed program's `MultipleFlashBorrows` (6035), so they cannot be counted as separate providers. The second Project0 bank is in another group, held only **670.566907 USDC** at the inventory slot **458745377**, and would require another margin account; it is a same-program supplement, not a third distinct provider. No third distinct compatible provider was established in this inventory. That is a bounded search result, **not** a claim that no third source exists anywhere on mainnet. Nor does the small successful packet establish that every large independent exit size was tested.

The exact Jupiter DEX binary was attested at account context slot **458744511**: program `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd`, deployment slot **449990119**, ELF SHA-256 `b259bef25bd37ce21a8bff502877a243d3e0663253523b5d4ceb447abde57646`. The Jupiter oracle binary was attested at context slot **458744509**: program `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc`, deployment slot **449989861**, ELF SHA-256 `ec80153d65a1eb3893eda320bddcde0c942351ef93e0c9771d19c7a4f42d037a`. See [the deployment snapshot](current-finalized-state.json). These hashes were recorded before the later fork simulation slots and were **not rehashed** during this run.

**Finding:** The executable two-provider cycle loses 20.598719 USDC with both lenders repaid. The near-maximum source/pool oracle test does not reach the current liquidation boundary and has no independently executed exit. No validated profit or drain was found for this Vault 103 route.
