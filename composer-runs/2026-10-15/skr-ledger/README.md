# SKR staking ledger snapshot, 15 October 2026

This is a read-only account and published-IDL check for `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ`. No transaction was submitted.

## Provenance

- The current executable points to ProgramData `7f1KoiGPFFouvAafZtVmtdpgGJuADprihB9Pdzut3gaJ`, upgrade slot `393714625`. The deployed program bytes have SHA-256 `46fc6f624531b035050552e3e885ffcbdb0d92b6ea4d1452a0419d7d90d5cf0c` at confirmed slot `457347579`.
- `anchor idl fetch` did not find an on-chain IDL (`Account not found` at `41dbUE3iG76Vx2iaDticXvpCcYDyw5jx23BtWRFbWVkM`). `official-sample-idl.json` is from the Solana Mobile sample at [commit `d7ae7b1`](https://github.com/solana-mobile/react-native-samples/blob/d7ae7b13a8fc280985d69244ea2c4eade30542a6/skr-staking/program/idl.json). It matches the current 193-byte `StakeConfig` layout and instruction names present in the binary, but cannot establish every current runtime constraint on its own.
- The sample was removed from the repository in commit `b8dd8e9` on 8 October 2026; the pinned historical commit is intentionally used.

## Exact current state

`live-accounting.json` is one consistent `getMultipleAccounts` response at confirmed slot `457347579`:

| Field | Value |
|---|---:|
| Stake config | `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw` |
| Config authority | `Hgbea5UFVXD3dQoL2mJbXLVnnFFRqyJJis9vfm69w5oQ` |
| SKR mint | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |
| Vault | `8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8` |
| Vault balance | `5,077,227,521,436,622` raw = `5,077,227,521.436622` SKR |
| Last recorded vault balance | `5,077,227,521,436,622` raw |
| Total shares | `4,377,486,858,226,234` |
| Share price | `1,154,206,571` at `10^9` scale |
| Shares × price, floored | `5,052,524,096,230,864` raw = `5,052,524,096.230864` SKR |
| Vault less share claim | `24,703,425,205,758` raw = `24,703,425.205758` SKR |
| Minimum stake | `1,000,000` raw = 1 SKR |
| Cooldown | `172,800` seconds = 48 hours |

The matching guardian pool `DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr` holds all current outstanding shares and has `0` commission basis points and `0` accrued commission. The vault surplus over live share claims is **not free value**: pending withdrawals are recorded in individual `UserStake` accounts and were removed from outstanding shares when unstake began. The sampled matured `UserStake` in the companion program audit has `6,381,678,948,330` raw SKR pending, independently showing such a liability.

An independent `getProgramAccounts` census at confirmed slot `457348442` found exactly one 188-byte guardian pool owned by the SKR program. Its discriminator and config reference match the IDL, and its accrued commission is zero. Thus there is no other current guardian pool with an accrued commission claim in this data-size class. The census result is `guardian-census.json`.

The published IDL lists `withdraw` and `claim_guardian_commission` as the two token-moving exits. `withdraw` takes no user signer account flag; its destination and stored-user checks must therefore be verified by current-binary simulation. The companion program audit performs those checks. The guardian commission route requires an authority signer and currently has no accrued commission in the only guardian pool with shares.

`commission-simulations.json` verifies this current zero-accrual boundary. With `sigVerify: false`, a hypothetical stored-authority signature lets `claim_guardian_commission` return success, but its inner trace has **no SPL Token transfer** and the guardian accrual remains zero. An unsigned stored authority fails `AccountNotSigner` (3010); a different signer fails `Unauthorized` (6007). Repeating the no-op claim or aliasing destination with vault still produces no token transfer. The authority is off-curve, so simulated signer status does not demonstrate an attacker can control it. Baseline reads and individual simulations use different confirmed slots; cross-slot vault changes are not attributed to the simulated instruction.

## Reproduction

Run `node composer-runs/2026-10-15/skr-ledger/live-accounting.js`, `node composer-runs/2026-10-15/skr-ledger/guardian-census.js`, and `node composer-runs/2026-10-15/skr-ledger/simulate-commission.js` with the existing local `/tmp/composer-helius-rpc.env`. The scripts read RPC accounts or call `simulateTransaction`, write their JSON evidence, contain no credential, and never call `sendTransaction`.
