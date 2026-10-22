# One-attacker Project0 + KLend atomic composition

Observed on a fresh local Surfpool mainnet fork at slots 457354901 and 457355118, 2026-10-15 19:31–19:33 UTC. These are **local simulations** of the current imported binaries and accounts. The only remote RPC call for construction fetched the public historical Project0 instruction template. No mainnet transaction was submitted. The two ephemeral keypairs were generated in memory; no private key was printed or saved.

## Question resolved

The earlier [`klend-project0-orca-kliquidity-v1.json`](./klend-project0-orca-kliquidity-v1.json) declared two unrelated historical signers with `sigVerify:false`. That replay established program reachability but not that one caller could sign it. The new controls declare exactly two signers: **one freshly generated attacker authority and one freshly generated marginfi account keypair**. Both are controlled by the same test caller. Both signatures were produced locally with Ed25519 and accepted by the fork with `sigVerify:true`. The marginfi account was initialized by Project0 in the same v1 transaction before its flash borrow.

| Signed v1 case | Instructions | Wire bytes | Inline addresses | Compute units | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Fresh marginfi init; KLend 1 SOL borrow/repay; Project0 1,000 USDC borrow/repay | 9 | 1,083 | 22 | 219,596 | Success |
| Fresh marginfi init; KLend 100 SOL flash; Project0 10,000 USDC flash; Kamino Liquidity deposit; Orca WSOL→USDC; **all minted Kamino shares withdrawn**; Project0 repay; Orca USDC→WSOL; KLend repay | 14 | 2,238 | 51 | 738,867 | Success |

The first signed wire has SHA-256 `256319d975d0a25546e5603de7ddb241dbec9ddadb9be63a62b2b4fdd4df4fed`. The all-shares-burn route has SHA-256 `523dc2fd5522d99263ea271b02e04abe7290630b807473bfac3b8e`. Their exact signed v1 wires, signer order, full logs, public account images and instruction traces are retained as Base64 in the evidence JSONs below. Both fit the 4,096-byte and 64-address v1 bounds.

## Conservation

In **both** successful simulations, the Project0 USDC lender vault, KLend WSOL supply vault, and KLend fee vault had exactly zero raw-token change. KLend reserve `availableRaw` returned to its initial value, and its configured flash fee was exactly zero. The new marginfi account ended with no active balances or outstanding liability shares. Project0 Bank total asset and liability shares were unchanged; its share values and accrued group-fee field advanced during execution, which is interest accounting rather than borrower debt.

The full-route fork fixture gave the caller 10 SOL and 5,000 USDC of **synthetic starting inventory** in its own token accounts; this is a disclosed liquidity buffer, not value taken from any protocol. It minted 5,131,919,758 Kamino shares and withdrew/burned all 5,131,919,758 within the atomic transaction. Relative to the starting inventory, the final attacker token changes were **−50,071,027 raw WSOL (−0.050071027 SOL), −7,351,865 raw USDC (−7.351865 USDC), and zero shares**. The native-wallet change, including rent paid to create fresh attacker-owned accounts, is recorded separately in the JSON; rent locked in those accounts remains attacker equity. The complete liquid token result is negative before any other transaction cost. The original historical-signer replay also reported no positive completed cash result; it must not be presented as outsider-accessible without this fresh-key check.

The signer requirement is therefore feasible for a single attacker. No unauthorized fund-loss finding follows from the tested route: lender principal was restored, the caller supplied its own starting inventory, all Kamino shares were burned, and the final liquid token balance fell in both mints.

## Reproduction and evidence

- [`p0-klend-single-attacker-control.js`](./p0-klend-single-attacker-control.js) and [JSON](./p0-klend-single-attacker-control.json): local fresh-account dual-flash conservation control.
- [`p0-klend-single-attacker-full-route.js`](./p0-klend-single-attacker-full-route.js) and [JSON](./p0-klend-single-attacker-full-route.json): same fresh-account signer model through Orca and Kamino Liquidity.

The scripts use `surfnet_setAccount` only to fund the generated attacker wallet and, for the full route, project attacker-owned token-account starting amounts into the fork. Project0, KLend, Orca, and Kamino program/state accounts are imported from current mainnet. Both scripts call `simulateTransaction` against the local fork with `sigVerify:true`; neither sends any transaction.
