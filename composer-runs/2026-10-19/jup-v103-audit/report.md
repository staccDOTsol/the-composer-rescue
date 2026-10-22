# Jupiter Lend DEX peg vault 103: current cross-pool gate

2026-10-19 UTC. Solana mainnet-beta accounts and quotes were read without value-moving submission. The only transaction simulations were a wallet-signed, read-only mainnet oracle read and wallet-signed local mainnet-fork DEX/oracle probes. No borrower transaction or full A→consumer→B→repay transaction was claimed.

## Decisive result

The independent Whirlpool B exit is live at 895.659732 sUSDai, but its quote turns a 1,000 USDC pool A buy into **998.470684 USDC**, a **1.529316 USDC quoted loss before fees**. Pool B gives `NO_ROUTES_FOUND` at 3,999 and 4,000 sUSDai. A signed `sigVerify:true` v1 local-fork pool A buy of the quoted 895.659732 sUSDai lowers the same-slot vault oracle by only **0.002171195 bps**. A larger diagnostic buy of 3,999 sUSDai lowers it by **0.009691399 bps**, but has no quoted B exit. The closest current borrower needs **288.80933886 bps** of oracle decline to reach the configured 90% liquidation threshold.

This is a price and independent-exit liquidity gate. A larger flash source does not change the B capacity. No profitable one-transaction unauthorized gain is validated. No full consumer-plus-exit v1 packet was built after this gate.

## Live state and ownership

- Target DEX, oracle, vault, lending, flashloan, and liquidity program binary SHA-256 values match the 2026-10-15 attestation. Current finalized target account context slot: `458744504`. Current vault state has **30 positions, 8 borrowing**. The oracle config has exactly one `DexSmartColPegOracle` source for DEX A (`G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF`).
- Signed v1 mainnet oracle read at slot `458746125`: `2.004183347767641` USDC per DEX share (`2004183347767641` X15), 456 bytes, 10 accounts, one instruction, one test-wallet signature, `sigVerify:true`, no execution error.
- Borrower position oracle mark: **$12,939,584.616384** collateral, **$10,552,445.697593** internal net debt, **$2,387,138.918791** residual oracle equity, using nine-decimal vault internal amounts, the current exchange prices, tick debt ratios, dust debt, and the signed oracle rate. These are marks and liabilities, not attacker-controlled funds or executable payouts. No tick required liquidation-branch resolution. The closest borrower is NFT 16 (`7DwdxvKm3GamPQ5YaZPNxKnfHGJw4Q5ipyvAByi4mxBm`): $2,087,272.396206 oracle collateral and $1,824,291.018116 debt; liquidation-rate boundary `1.946300661004661` USDC/share.
- The test wallet holds **zero** of the 30 current position NFTs; existing borrowing positions require their position-token/owner authorization for direct `operate_dex` actions. A self-owned new position would still carry its resulting debt and locked collateral.
- DEX A observed supply position amounts at the finalized snapshot: **11,749,112.508689 sUSDai** and **2,869.366382 USDC**. These are on-chain recorded balances, not a B exit quote or free liquid funds.
- Current KLend available amounts are 5,989,769.688962 and 3,597,061.299454 USDC, and 8,032,039.734424 sUSDai, each with on-chain `flash_loan_fee_sf=0`. Project0 USDC token vaults hold 394,641.688840 and 670.566907 USDC. These are observed source amounts, not transaction-level executable limits; Project0 bank controls were not needed beyond the gate.

## Bound and evidence limits

The signed local-fork size probe used the supplied test wallet, one v1 wire of **1,045 bytes/26 accounts/3 instructions**, and `sigVerify:true`. It read the oracle before and after the DEX A action. The 895.659732 sUSDai output cost exactly 1,000 USDC; the independent B quote for that exact amount returned 998.470684 USDC. The 3,999 sUSDai diagnostic output cost 4,464.868772 USDC and produced the 0.009691399 bps oracle decline; public B routing rejected that size. The B result is **quoted**, not a simulated B fill. No loan, repayment, borrower action, transaction fee, or position-debt change was in those probes, so there is **no validated full-route profit**.

Evidence: [current-finalized-state.json](current-finalized-state.json), [current-position-value.json](current-position-value.json), [wallet-position-authorization.json](wallet-position-authorization.json), [loan-inventory.json](loan-inventory.json), [route-quote-bound.json](route-quote-bound.json), [signed-oracle-size-gate.json](signed-oracle-size-gate.json). The prior 2026-10-15 signed cross-pool control in `jupiter-v103-signed-fork-audit/signed-multiflash-cross-pool.json` repaid a single KLend source but lost 56.176364 USDC at a larger 4,500 sUSDai size; it does not replace the current gate.
