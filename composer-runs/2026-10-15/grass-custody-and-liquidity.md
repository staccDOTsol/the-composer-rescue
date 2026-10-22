# GRASS controller custody and liquidity recheck — 15 October 2026

This is a read-only mainnet evidence note for `EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc`. No transaction was submitted. It establishes observed custody and ordinary successful outbound signer provenance. It does **not** establish an unauthorized withdrawal path or a drainable amount.

## Current account evidence

At Helius confirmed slot **457347521**, the target was executable under `BPFLoaderUpgradeab1e11111111111111111111111`; its 36-byte Program account had tag 2 and pointed to `HZyc3e9xuPRPXyVXti863VYUeMFKYgXRC4L3aMgx71vY`. That ProgramData account had tag 3, upgrade slot 295594988, and upgrade authority `31rYartQwHeBMjAe2MgGpffGV57fQY3kug4BDN8tLGqQ`. The GRASS mint had 9 decimals and raw supply `999992781513738795`; its mint authority was the same `31rYart...` key. The public Solana RPC corroborated executable status and all nine authority/vault pairs independently at confirmed slot **457347822**.

Each of the following nine addresses is off curve, is a live account owned by the target program, and is the exact token authority in one live SPL Token GRASS vault. The public and Helius providers agreed on the exact raw amount for every vault.

| Authority | Vault | GRASS at slot 457347521 |
|---|---|---:|
| `7AjmundYaTTcCu2ECnmsyAqqG4c5fWnJf3PYPCUUj8nN` | `9cgnBLaq9uzH63UyPbpXT3H6TEBqjTj2CiK1xebSgCAL` | 56,862,489.195823671 |
| `BSb68HCsLMsuq9BSTZHKhTfZSyTMhUfipgvwaUDjBmv1` | `5JwNA9W3SC5q8Ht23dGnWvixsaHkkbvmTX9eiZ9t9XUB` | 36,509,484.826606538 |
| `5s8yYn952CZLqcBKsoBosXkocg5fm3FPZhKkfK6FvcUz` | `9xapDKpzezvTUGoRqcUEcnf2BWdrUX1Vu4woCnW2wims` | 34,085,600.436275918 |
| `8jX6h76wzVMwdnbZ4fhXt7zEAriynbdLMExPipvHAWYW` | `7FZRSVR4Wf8p26cuNX86zy3FJA86xni1pXokbueuww5J` | 14,999,995.983497160 |
| `BaZipPqSWweDWf2uYotqYMog9nyN1km72axBRU7dVzrB` | `D1zow655E3AwXjDyFkjye9ac8Z7Dr6oqLk3zkQqoV5j2` | 12,739,074.925592507 |
| `2Xg37YZHcDcV92Wn3RRhVavBXSEPGY5z1FcesjMErj6Y` | `81VBQ3uRmjLnKdjuqQZrPKLZnNXDQSvMfqQDX6GVm2K8` | 12,726,418.579863585 |
| `2cBniUjRr8M9wbNp91SETKtJEdhuXb5fDi89sZYiN1DQ` | `GBSdbtzKg6A1a9HM99AvCUWpzXbDq4hbgAX5Q48N7VRK` | 11,551,187.227313213 |
| `58ssuF5tQEiwDpjwRYAv3Fn2to3XgPrG7JrojJczVLZU` | `7DGqSEZg6QcEeWC5yZJkaGraVCYRyExSFPXtdzFuYSQB` | 10,585,835.239056325 |
| `3vZUwZR1WUSBCH1zSGhEWZ7q2Pyh6emKRNypFCQVk8y5` | `BZKFsaFJyVx4aUJFAPq8kz1ey6N2yAS9onhMeXsjL57v` | 10,379,973.357111686 |

**Exact aggregate:** `200440059771140603` raw units = **200,440,059.771140603 GRASS**. This is about 20.044% of the observed mint supply. It is a bounded set originally selected from a top-20-per-mint census, not a claim that these are every account controlled by the program.

## Successful outbound provenance

For **all nine** vaults, a bounded scan of at most 20 recent successful signatures per vault found at least one successful outbound transfer. In each, the top-level instruction was the target program and the inner `Tokenkeg...` transfer had stack height 2, so the immediate invoking program was the target. The parsed SPL authority matched the vault's off-curve program-owned authority. Signatures and transaction-specific amounts are in `grass-vault-exits.json`.

The cited [top-vault transaction](https://explorer.solana.com/tx/vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v) succeeded at slot **457215347**. Its stack-2 `transferChecked` moved `73935167354` raw units (**73.935167354 GRASS**) from `9cgn...CAL` to `5V9zac...C1o`, with `7Ajmund...j8nN` as authority. The vault's exact pre/post amounts were `56862501574935138` and `56862427639767784`; their difference is exactly the transfer amount. Transaction signers were `G5DXoJ2F3aPa6R93gGLmSQy5PvAbzoEkzkNYgeyun5B9` and `TnSVKTNqvwX6uFaAhPxRkRcYTKHDSmNBuatE8ST2VW6`. The off-curve authority signed through the program invocation, not as a transaction signer.

The public Solana RPC independently returned that transaction at the same slot with `meta.err = null` and the identical stack-2 parsed transfer; its raw response is `grass-public-tx-recheck.json`.

## Economic value limits

The Jupiter token-search response updated at **2026-10-15 19:04:23 UTC** quoted `usdPrice = $0.6647977957803` and `liquidity = $280,914.8062`. Price times the aggregate balance is **$133,252,109.92**, a gross spot mark only. It is not a realizable liquidation value, claimable protocol value, or loss estimate.

Read-only Jupiter Metis GRASS→USDC exact-input quotes, collected at about **19:04:28 UTC**, show the current depth problem:

| GRASS input | Quoted USDC output | `priceImpactPct` as percent |
|---:|---:|---:|
| 100,000 | $65,455.928207 | 1.58% |
| 1,000,000 | $184,859.135865 | 72.20% |
| 10,000,000 | $165,125.722643 | 97.52% |
| 200,000,000 | $105,072.076622 | 99.92% |

These are route quotes before execution and slippage. The 10 million and 200 million outputs are **lower** than the one million output, and a 10,000 GRASS request returned `Oracle price out of date. Pair temporarily unavailable`. This non-monotonic result makes the huge-size route output unsuitable as a firm liquidation estimate. No transaction construction or execution was attempted. The defensible conclusion is that immediately quoted liquidity is orders of magnitude below the gross spot mark; a precise full-balance liquidation value was **not established**.

## Reproduction files and sources

- `grass-custody-recheck.js` and `.json`: fresh Helius confirmed `getMultipleAccounts`, parsed mint/vault/state bytes, `getTransaction` for the cited signature, current Jupiter token response, and read-only quotes. The RPC API key is not stored in the output.
- `grass-public-rpc-recheck.js` and `.json`: independent `https://api.mainnet-beta.solana.com` confirmed account recheck of all nine pairs.
- `grass-public-tx-recheck.json`: independent public RPC response for the cited successful outbound transaction.
- `grass-vault-exits.js` and `.json`: bounded, successful history for all nine observed vaults and exact top-level/immediate caller reconstruction.
- [Jupiter Tokens API documentation](https://developers.jup.ag/docs/tokens/token-information) describes mint search fields; [Jupiter quote documentation](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis) defines `outAmount` and clarifies that `priceImpactPct` is a decimal fraction.

The nine vault states and their rights still require current-binary path analysis. Ordinary authorized withdrawals are control samples, not evidence of a vulnerability.
