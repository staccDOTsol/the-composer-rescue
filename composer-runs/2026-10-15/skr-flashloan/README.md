# SKR same-asset atomic flashloan feasibility

Observed 2026-10-15 at current mainnet slots 457347754–457347758. Read-only RPC only. No transaction was signed or submitted.

The exact SKR mint in the target vault is `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`. The first prerequisite for a same-asset Project 0/marginfi or Kamino Lend flash composition is a Bank or Reserve whose liquidity mint equals that address.

| Lender | Current state census | Verified mint layout | SKR matches | Independent direct SKR filter |
|---|---:|---|---:|---:|
| Project 0/marginfi `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | 401 Bank accounts, 175 distinct mints | Bank Anchor discriminator at bytes 0–7; mint at bytes 8–39. Current `CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh` decoded as WSOL, matching known control; direct WSOL filter returned 11 Banks. | **0** | **0**, slot 457347755 |
| Kamino Lend `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | 647 Reserve accounts, 205 distinct mints | Reserve Anchor discriminator at bytes 0–7; liquidity mint at bytes 128–159. Current `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z` decoded as USDC, matching known control; direct USDC filter returned 160 Reserves. | **0** | **0**, slot 457347758 |

The census used the Anchor account discriminator to enumerate every current account of the relevant type, sliced the account data through the mint offset, and decoded every mint. A separate RPC `getProgramAccounts` call filtered directly by both discriminator and exact SKR mint. The two methods agreed. Full account addresses, mints, slots, positive controls, and a row digest are in [`lender-census.json`](./lender-census.json); the read-only reproducer is [`check-skr-lenders.js`](./check-skr-lenders.js).

**First exact blocker:** no current SKR Bank in Project 0/marginfi and no current SKR Reserve in Kamino Lend. Available same-asset SKR liquidity from these two lenders is therefore zero. There is no valid SKR borrow leg to assemble in a 4,096-byte v1 transaction, at dust size or near available liquidity. Fee rate, repeated legs, full repayment, and pre/post balance/debt/share deltas have no executable same-asset case to measure. We do not substitute an existing WSOL or USDC positive control for the requested SKR composition.

For the proposed donation path, a hypothetical borrowed SKR quantity sent into the target vault must still be returned to its lender within the same atomic transaction. A pending withdrawal with a 48-hour cooldown does not supply SKR for that immediate repayment. This is an accounting observation, not an execution result or a claim that every target-program exit is safe.
