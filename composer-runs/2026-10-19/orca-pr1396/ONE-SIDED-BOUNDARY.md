# Whirlpool one-sided boundaries: executed local-fork receipts

These tests used signed Whirlpool instructions against isolated, mainnet-backed Surfpool forks on 19 October 2026. The forks fetched the existing WSOL/USDC pool accounts and Whirlpool program from mainnet; every transaction listed here committed **only to a local fork**. Local token funding is identified below. Pool and position state can change on mainnet after these snapshots.

## Pool and ranges

Pool `C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd` has token A = WSOL (9 decimals), token B = USDC (6 decimals), tick spacing 8, and fee rate 2,500/1,000,000 = 0.25%. A finalized position-account query found five nonzero ranges:

| Position prefix | Liquidity | Lower tick | Upper tick |
| --- | ---: | ---: | ---: |
| `5V7ugV...` | 100,857,234 | −29,920 | −27,912 |
| `AsRXu3...` | 50,842,714 | −29,920 | −27,920 |
| `E5ctAC...` | 506,497,729 | −29,920 | −27,912 |
| `HTHq85...` | 13,979,561,927 | −39,120 | −29,952 |
| `HgWkzx...` | 268,241,582,817 | −38,168 | −34,416 |

The active liquidity at starting tick −27,913 was 607,354,963. In particular, the gap between −29,920 and −29,952 has zero active liquidity, but two real positions exist beyond it. Crossing that first gap does **not** exhaust the pool.

## Sell WSOL through every existing lower band

[The full-boundary test](full-one-sided-boundary.js) used a fork-only 500 SOL WSOL prefund and then committed **nine Whirlpool A→B swaps in one signed transaction v1**. Its [receipt](full-one-sided-boundary.json) records 17 pre-existing initialized tick arrays, 1,459 wire bytes for the nine-swap transaction, 330,177 compute units, and no error. The last lower tick was −39,120. The actor paid exactly **346,808,000,069 lamports** (346.808000069 SOL) and received **9,375,321,549 raw USDC** (9,375.321549 USDC). This is within the previously verified roughly 6,271 SOL zero-fee flash-principal envelope, although this test itself used fork-only prefunding and did not include lenders or an external return leg.

| State | Before | After nine swaps |
| --- | ---: | ---: |
| Pool active liquidity | 607,354,963 | 0 |
| Current tick | −27,913 | −39,121 |
| WSOL vault, lamports | 612,287 | 346,808,612,356 |
| USDC vault, raw units | 9,375,384,212 | 62,663 |

The remaining 62,663 raw USDC is **not a free attacker claim**. The pool recorded 1,021 raw USDC protocol fees. In a further [signed local position update](full-boundary-claims.json), the five existing positions accrued 51,440 raw USDC in recorded B fee claims. Those fields explain 52,461 of the 62,663 raw balance; 10,202 raw remains unattributed by these fields alone. Collection requires position authority and transfers only recorded owed amounts. This test did not treat the residual as extractable by a new LP.

At an illustrative external 104.50 USDC/SOL benchmark, the 9,375.321549 USDC output would buy roughly 89.716 SOL *before* router impact and fees, far short of the 346.808 SOL input. The separately composed Jupiter/lender test determines its exact executable return. The full boundary is feasible in transaction limits; it is economically expensive in this pool.

## Buy WSOL through the top boundary

The same pool's highest nonzero upper tick was −27,912, just one tick above the starting price. On a fresh local fork, [the upper-boundary test](upper-one-sided-boundary.js) used a fork-only USDC token-account prefund, then committed a B→A swap for **2 raw USDC** and received **8 WSOL lamports**. Active liquidity became zero at tick −27,912. The WSOL vault fell from 612,287 to 612,279 lamports, so zero active liquidity did not mean an empty token vault. The [receipt](upper-one-sided-boundary.json) records 34,058 compute units and no error.

The next signed B→A instruction specified one raw USDC input and an explicit price limit at tick −27,800. It succeeded while moving the pool tick from −27,912 to −27,800 with **zero actual token input and zero output**: actor and vault token balances were identical before and after. The onchain swap loop traverses a zero-liquidity interval without a token delta. A displayed spot can therefore move without a tradable quote. It still costs a transaction fee and requires the appropriate initialized tick arrays.

At the *lower* gap, a separate [follow-up receipt](one-sided-boundary-followup.json) shows a one-lamport A→B swap from zero active liquidity at −29,921 entering the existing lower position at tick −29,953 with zero USDC output. A subsequent reverse B→A swap crossed the same initialized tick, restoring active liquidity to 658,197,677. The pool was not bricked; opposing swaps can reactivate a previously exited range.

## Can a new tiny LP collect the correction?

The [actor-owned LP test](tiny-lp-after-boundary.js) started after the upper zero-liquidity move at tick −27,800. The actor opened a range [−27,480, −27,464] with liquidity 1,000,000,000 in an existing tick array. Because the current price was below the position's lower tick, the deposit was **A-only**: 3,159,260 WSOL lamports, zero USDC. The pool's active liquidity remained zero. A separate trader then traversed the empty gap to −27,480 at zero token movement, activating only that new LP. The trader's next B→A swap paid 203,067 raw USDC and took 3,159,259 WSOL lamports from the new position, after which active liquidity returned to zero. The owner accrued **502 raw USDC** in fees after a permissionless update; protocol B fees rose by 5 raw units. All these steps committed locally with [account-state receipts](tiny-lp-after-boundary.json).

The owner then performed `decrease_liquidity` and `collect_fees` **in one signed v1 while global active liquidity was zero**. Both succeeded, position liquidity went to zero, and the owner's USDC token account gained exactly **203,060 raw USDC**, including the 502 raw fee claim; its WSOL account gained zero. The vault B debit matched that 203,060 raw credit, per the [withdrawal receipt](tiny-lp-withdraw-collect.json). At an illustrative 104.50 USDC/SOL benchmark, the deposited 0.003159260 SOL was worth 0.33014267 USDC, versus 0.203060 USDC recovered: a **0.12708267 USDC inventory loss** before rent and transaction fees. The trader's correction consumed the new LP's A inventory at the bad quote. The fee was far too small to offset that adverse price. A new LP does not inherit old positions' principal or fee claims.

Finally, the [official Whirlpool SDK quote test](sdk-zero-liquidity-quote.json) ran after that LP had been removed, when the pool again had zero active liquidity. `swapQuoteByInputToken` for a 1,000,000-raw-USDC B→A trade threw `Swap input value traversed too many arrays ...`, while a reverse A→B quote found older liquidity below the displayed price. The moved spot alone did not produce an executable outward quote.

## Mechanism and limits

The program's [swap loop](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/manager/swap_manager.rs#L45-L260) moves through initialized ticks and can traverse a zero-liquidity gap without an output amount. [Liquidity math](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/manager/liquidity_manager.rs#L192-L223) makes a position below its range A-only and above its range B-only. The vaults are shared token accounts holding principal, accrued LP fees, protocol fees, and rounding residuals; active liquidity is a separate number. Position authority is required for deposit, withdrawal, and fee collection. The receipts prove operations on local forks at those account snapshots; they do not show a mainnet broadcast or a profitable exploit.
