# 5UuM…tSf9 reserve inventory and liquid value

Read-only observations taken 2026-10-15 19:03–19:06 UTC. No transactions were prepared or sent. Program `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9` is executable; state account and off-curve vault authority `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK` is owned by it. At confirmed slot 457347502, each sampled SPL Token account still has that authority. The sampled balances are unchanged from the earlier census.

| Mint / vault | Amount at slot 457347502 | Share of SPL mint supply | Jupiter spot mark | Jupiter token liquidity | Jupiter exact-in quote to USDC |
|---|---:|---:|---:|---:|---:|
| MIM `M1M6…EC3h` / `7Lzp…Q83w` | 20,324,433,642.32 | 96.784% | $9,607,315 | $82,220 | Entire vault: $74,198 (99.23% price impact) |
| DOG `dog1v…N65u` / `5yXS…PAvVWb` | 97,095,627,115.05337 | 97.096% | $91,332,946 | $12,293 | 0.01% of vault: $8,420; 0.012% and larger: no route to USDC, SOL, or USDT |
| PUPS `2oGL…asBfe` / `A7w8…BHeK1` | 716,632,732.762402445 | 71.678% | $2,370,165 | $49,985 | Entire vault: $47,485 (98.00% price impact) |

The $103.31 million sum is an arithmetic spot-price mark on nearly entire mint supplies. It is not an exit valuation. Jupiter Metis `/swap/v1/quote` returned these amounts at context slots 457347293–334 using exact-in routes and 50 bps slippage setting. Full-vault MIM and PUPS quote outputs sum to about $121,683 in independent snapshots, but the full MIM route uses a MIM/PUPS pool and both routes touch shared PUPS liquidity. The two outputs therefore cannot be added as a portfolio-execution result. DOG's largest tested successful USDC quote is $8,420 for only 0.01% of its vault; no route for 0.012%, 0.1%, 1%, or all of the vault was found. A failed quote does not establish a hard maximum across all venues or a long sequence of trades. Quotes also do not prove that any route can be funded from these vaults or executed atomically by an unauthorized caller.

The [MIM supply feed](https://data.mimwizards.com/mim-sol.json), generated at slot 457343376, explicitly identifies `Cst5…1obRGK` and vault `7Lzp…Q83w` as **RuneMine bridge reserve** controlled by `5UuM…tSf9`. It reports 20,324,433,642 MIM minted on Solana but not bridged in, versus 675,363,454 circulating Solana MIM. This matches the independently decoded on-chain vault balance and mint supply. The [RuneMine site](https://www.runemine.com/) describes a Bitcoin Runes bridge supporting DOG and PUPS. DOG and PUPS are held under the same authority and dominate their mint supplies; the exact off-chain backing and exit rights for those reserves still need program/bridge verification. The ticker `MIM` here refers to mint `M1M6…EC3h`, a Bitcoin-themed Rune bridged to Solana, not a generic stablecoin ticker.

**Assessment limit:** Do not infer a severity or dollar amount lost from the $103.31 million mark. An unauthorized transfer path and signer-controlled exit have not been shown by this valuation work. Even if token custody were bypassed, contemporaneous Solana routed liquidity supports only far smaller one-shot sale quotes, with substantial price impact and route overlap. Cross-chain redemption economics are separate from selling reserve inventory on Solana and were not tested here.

## Evidence and reproduction

- [Current mint and account state](5uu-live-state.json), produced by [read-only RPC script](probe-5uu-live-state.py). It records exact raw balances, supply, decimals, mint and freeze authority, account authority, account owner, and slot.
- [Jupiter quote ladder](5uu-market-depth-quotes.json), produced by [quote script](probe-5uu-market-depth.py). Raw API responses include quote URLs, route plans, context slots, expected outputs, and impact values.
- [DOG route boundary](5uu-dog-route-boundary.json) and [DOG alternative output quotes](5uu-dog-cross-output-quotes.json) record the `NO_ROUTES_FOUND` responses.
- [MIM source extract](5uu-mim-bridge-reserve-source.json) records the third-party feed's exact matching reserve address, account, amount, program attribution, and source slot.

The token liquidity and spot price fields above come from the Jupiter verified-token registry captured in `long-tail-current-check.json` at 18:30–18:55 UTC; they are metadata estimates, not hard exit limits. The current live RPC and quote responses are the stronger evidence for this note. Jupiter [documents](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis) that `/quote` provides route/output estimates; no swap instruction or transaction was built for this check.
