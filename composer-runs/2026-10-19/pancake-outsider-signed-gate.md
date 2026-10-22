# PancakeSwap USDT/WSOL outsider signed gate

Observed 2026-10-19 08:08 UTC. This is a defensive, non-broadcast mainnet-beta simulation result. **No outsider-accessible value bug was validated in the tested current routes.**

## Exact target

- Program: `HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq`
- Pool: `22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w`
- ProgramData: `66S4Bs8HVyaPdQ5JGfKixEZMf5CczcfnLGgGYEKnvi3Z`
- ProgramData deployment slot: `432564695`
- Current ELF: 1,330,256 bytes, SHA-256 `5227d6ae48e15c1703aa2fc341b8184a56499ed9695edcd5d2550ee6a61da84f`
- Successful post-deployment source receipt: `35edy8JF1qt7n6MFvWbLumb2oi61cRarFeeCsSPiiignthyu4Vz8sAUUBfA7wveZrqkGc5p84wvP1LLCZ4xbeD2`, slot `458757009`

The decoded live pool binds AMM config `HZzqEWHEvSiqYt6PxxLs7zXETmqGuryqfmvggjAkqisp`, WSOL vault `7YcR78PKBHE5divhPVJ668kmmaDzove2d9msY9NpAJL2`, USDT vault `FCBauqNLbEBUci1v3NT4gWyFZXS4YUGnX7ZsPmWVzrvV`, and observation account `AsRbHvJA4a5DujNA6dx3VPWYvd3KkgfK8KWuBRV7YuK3`.

## Composer and route recovery

Composer was queried first. Its published 27-instruction `amm_v3` IDL has SHA-256 `2f2c013900ea893a562e1044425b3ede12d9d66f1253432fe046d49e29b00973`. Its cached learned artifact covers 250 parsed transactions, 239 instruction samples, two discriminators, and 12 account-count variants; the learned artifact SHA-256 is `5ef8aca63bbeb044ed1fa8fdec027e49b5fddbe4c40d10a4ca54b578850b26d7`.

A fresh Jupiter direct route resolved only to this exact pool. A newly generated outsider was funded inside the simulated transaction, signed it, and used fresh outsider-owned WSOL/USDT accounts. The Jupiter-wrapped control succeeded and exposed the current 13-account Pancake `swap` CPI. Replaying that recovered instruction directly also succeeded under `sigVerify:true` at slot `458761324`.

- Outer control: 794 bytes, 22 addresses, two signatures.
- Direct control: 756 bytes, 20 addresses, two signatures.
- Both are below the requested 4 KB/64-address envelope and Solana's 1,232-byte packet limit.
- Neither transaction was sent or broadcast.

## Guard mutations

| Signed probe | Result |
| --- | --- |
| Swap signer changed to a second fresh signer while retaining the outsider-owned input | Rejected by Tokenkeg: owner mismatch (`0x4`) |
| Recipient changed to the fee-payer's USDT ATA | Succeeded; this is signer-authorized recipient flexibility, not an unauthorized release |
| Pool state changed to outsider account | Rejected: account owner mismatch (`3007`) |
| AMM config aliased to pool state | Rejected: discriminator mismatch (`3002`) |
| Input vault changed to outsider WSOL account | Rejected: `InvalidInputPoolVault` (`6025`) |
| Output vault changed to outsider USDT account | Rejected: `InvalidInputPoolVault` (`6025`) |
| WSOL/USDT vault roles swapped | Rejected by Tokenkeg: mint association mismatch (`0x3`) |
| Observation account aliased to pool state | Rejected: discriminator mismatch (`3002`) |
| First tick array aliased to pool state | Rejected: discriminator mismatch (`3002`) |
| Outsider `collect_protocol_fee`, canonical pool/config/vaults, outsider recipients | Rejected: `NotApproved` (`6001`); live config owner is `ETdJM9JkL1m3QvwxKpjaMViRRfUVKQGHmQD14mCRiSsd` |
| Outsider `collect_fund_fee`, canonical pool/config/vaults, outsider recipients | Rejected: `NotApproved` (`6001`); live fund owner is `B8QbApqemf987jBEusvtc9vFnpsnDFNm1mQRmZtjv4wV` |

## Equity reconciliation and flash decision

The successful direct control's parsed Tokenkeg ledger is exact:

- Outsider-authorized input: `10,000,000` raw WSOL from the outsider WSOL account to the canonical pool WSOL vault.
- Pool-PDA-authorized output: `1,054,685` raw USDT from the canonical pool USDT vault to the outsider USDT account.
- The output equals the fresh direct quote and exceeds its `1,044,139` raw-USDT minimum. No third-party or synthetic token balance is counted.

No pool/config/vault/observation/tick substitution or privileged fee collection survived. The only successful mutation was an explicitly signer-authorized recipient change. A quote was used only to construct the control and is not treated as a finding.

## Reopened three-source flash-route extreme (08:25 UTC)

The flash requirement was reopened independently of the failed account-role substitutions. The bounded harness selected three compatible, current WSOL sources—Save, KLend and Project0—and prepared to compose `flash borrows -> exact Pancake WSOL/USDT swap -> non-Pancake USDT/WSOL exit -> all repayments` in signed v1 format (4,096-byte/64-address ceiling). No broadcast path exists.

Current mainnet-backed fork capacity reads were:

- Save available: `77,688,327,630,060` raw WSOL; fee is `ceil(principal * 4 / 10,000)`.
- KLend available/supply: `6,226,048,761,096` raw WSOL; selected reserve `flashLoanFeeSf` is exactly zero.
- Project0 WSOL vault: `507,499,987,163` raw WSOL; the planned per-case allocation stayed below the previously validated conservative usable bound.

Fresh direct-Pancake boundary probes observed `198,000,000,000`, `197,500,000,000`, and `197,000,000,000` raw WSOL rejected with `NO_ROUTES_FOUND`; `195,000,000,000` raw WSOL was accepted at Jupiter context slot `458766086`. Thus `195` WSOL was the near-edge candidate for this run, alongside the `0.01` WSOL control.

Both complete packets were blocked before construction by the same current routing dependency: the fresh independent USDT-to-WSOL exit request exhausted the deliberately capped Jupiter retries with HTTP `429`, `[API Gateway] Too many requests`. Without a fresh exit quote and its current swap-instruction response, the harness could not create, size, sign, or execute an honest atomic packet. Cached quote math was not substituted, and no quote-only result is treated as an executed finding. The exact blocked receipts and source-capacity snapshot are in `pancake-multiflash-extremes.json`; the no-send harness is `pancake-multiflash-extremes.js`.

## Evidence

- `pancake-outsider-signed-gate.json`: full signed simulation receipts, logs, account roles, wire hashes, transfer ledger, current deployment hashes, and conclusions.
- `pancake-outsider-signed-gate.js`: bounded harness; RPC allowlist contains only reads and `simulateTransaction` and has no send path.
- `pancake-current-idl.json`: Composer-published IDL.
- `pancake-composer-learn.json`: Composer learned receipt schema.
- `pancake-multiflash-extremes.json`: capped fresh route probes, three-provider capacity snapshot, and exact independent-exit construction blockers.
- `pancake-multiflash-extremes.js`: bounded signed-v1/no-broadcast three-provider composition harness.

Scope limitation: this gate validates the current swap path, its highest-risk account substitutions, and both core fee-collection exits. It is not a proof that all 27 published instructions or every historical state transition are vulnerability-free.
