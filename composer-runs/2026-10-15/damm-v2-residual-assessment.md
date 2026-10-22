# DAMM v2 / KLend USDP residual valuation

**Observed:** 2026-10-15, Solana mainnet confirmed slots 457354065–457354095. All transaction tests used the current deployed binaries through `simulateTransaction(sigVerify=false, replaceRecentBlockhash=true)`. No transaction was submitted. The modeled payer is the legitimate historical borrower authority `Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM`; the simulation does not claim this key is forgeable.

## Exact starting equity and lender repayment

At the tested state, the payer started with **716,825 raw USDC** in `C5D9...` and no USDP account. An atomic KLend zero-fee borrow of **1,000,000 raw USDC**, DAMM v2 forward Swap2, reverse exact-out Swap2 for **300,000 raw USDC**, and full KLend repayment succeeded. The payer finished with **16,825 raw USDC** and **128,849,344 raw USDP** in a fresh ATA. The payer therefore spent **700,000 raw USDC**, not zero; KLend's supply and fee vaults each had exact net delta **0**. The original report's residual of 128,860,687 raw USDP was another current-state simulation of the same route and differs because pool state moved.

The USDP mint is `usdpq7K6oUzDm8JCF1qAVmTUmG3WTw3g9uTkznTHBAE`. It cannot be valued at $1 from its ticker. A read-only Jupiter exact-in quote for **128,860,687 raw USDP** returned **502,303 raw USDC** from *independent* Meteora DLMM pool `4oo4Kdmz716F4qxLQZNzrKBYY3Wz7NveBZHXNbNjBNED` at slot 457353668 with `Meteora DAMM v2` excluded. That marks the original simulated end state at **519,128 raw USDC**, a **197,697 raw USDC loss** before network fees. A route back through the *same* tested DAMM pool quoted 621,665 raw USDC, still a 78,335 raw USDC loss. These are executable-size quotes, not a USDP peg assumption; quotes are point-in-time and unexecuted.

## Independent venue in the same v1 transaction

I reconstructed the KLend flash pair and the two DAMM swaps, then generated an independent Jupiter route through the DLMM pool. Its address lookup table keys were inlined into a real Solana **version-1** message, with no ALT needed. The tested instruction sequence was borrow → create USDP ATA → DAMM forward → DAMM reverse exact-out → Jupiter/DLMM USDP-to-USDC → KLend repay.

| Measure | Current-binary result |
|---|---:|
| Simulation slot | 457354067 |
| Wire size | **1,335 bytes** of 4,096 allowed |
| Inline accounts | **31** of 64 allowed |
| Instructions | **6** |
| Compute used | **332,931** of 1,400,000 configured |
| DLMM USDP input | **128,749,344 raw** |
| Payer USDC delta after all legs | **−197,871 raw** |
| Payer USDP residual | **98,806 raw** |
| KLend supply-vault / fee-vault delta | **0 / 0** |
| Transaction error | **none** |

The DLMM quote immediately before simulation predicted 502,129 raw USDC for the independent leg; the successful simulation's actual user USDC change includes all preceding swaps and repayment. The residual 98,806 raw USDP subsequently quoted for 488 raw USDC at slot 457354095 through that same independent DLMM pool. Marking it at that quote gives **−197,383 raw USDC** to the payer, before transaction fees. Even giving the residual full quoted value leaves a loss. Nearly all residual USDP was converted atomically within the requested v1 limits; the final dust quote is a separate point-in-time observation.

This is authorized flash borrowing and ordinary AMM trading. The lender is repaid in full and no unauthorized vault balance is debited. A profitable cross-pool case, if later found in different state, would be ordinary market arbitrage unless independent evidence showed a broken protocol authorization or accounting invariant. **This tested route is loss-making and does not establish immediately at-risk outsider funds.**

## Evidence

- [`damm-v2-residual-v1-sim.js`](./damm-v2-residual-v1-sim.js): read-only v1 reconstruction and independent third leg.
- [`damm-v2-residual-v1-sim.json`](./damm-v2-residual-v1-sim.json): pre/post balances, current-binary logs, wire hash, exact size, keys and compute.
- [`damm-v2-residual-quotes.json`](./damm-v2-residual-quotes.json): independent and same-pool executable quotes for the original residual.
- [`damm-v2-residual-swap-instructions.json`](./damm-v2-residual-swap-instructions.json): independent DLMM Jupiter route instruction returned by the read-only API.
