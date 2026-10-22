# Bison current outsider-route audit — 2026-10-19

## Verdict

No reportable immediate-value custody bug was validated.

The current Bison route is outsider-accessible through Jupiter: an ordinary on-curve wallet signer is carried into the Bison CPI. A current landed atomic Bison → independent-market cycle earned **46,034 raw wSOL gross** and **40,875 lamports net after the 5,159-lamport transaction fee**, but every Bison-side token movement conserved exactly. The gain came from the second venue's slightly better reverse price, not from an unpaid or unauthorized Bison withdrawal.

## Exact deployment

- Program: `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`
- ProgramData: `42snJ7ip4zKKsip3EtaMoBo8wzoRsQJSzgUSFXAVJFfG`
- Deployment slot: `456982351`
- Upgrade authority: `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS`
- Binary: 252,552 bytes
- SHA-256: `9b36724da2fa354f8fd89924f657add1e1c0a547dc5dc3028e8c327f544b1d5e`
- Refresh context slot: `458747155`

This is unchanged from the Oct. 15 binary.

## Composer and receipt agreement

Composer reported no published IDL. Its learned result was cached from 250 signatures / 243 instruction samples, with six one-byte selectors. The live swap selector is `0x02`.

The learned selector-02 sample `3iZaw2tCKtjAHVmT6ddWbYokYm18KhgejPaAG7VyTpAMdBM61hcXF5uEPnPgq8QzdSbUxi4BfQurppWPzYM8jEVU` exactly matches the live Bison CPI bytes:

`02 f625237700000000 0000000000000000 00`

The first u64 is `1,998,792,182` raw wSOL, matching the actual Bison input transfer.

## Current successful parent route

Receipt: `3iZaw2tCKtjAHVmT6ddWbYokYm18KhgejPaAG7VyTpAMdBM61hcXF5uEPnPgq8QzdSbUxi4BfQurppWPzYM8jEVU`

- Slot `458746708`, 2026-10-19 03:15:47 EDT, successful v0 transaction.
- Parent: Jupiter `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`.
- Wallet signer: `77777nPhGvFUVAj6uq8MGyLneBt4SMwCScYZDzzztdsa`, confirmed on-curve.
- That wallet is the first Bison CPI account and authorizes the user-side SPL transfer.

Bison leg:

- User/Bison wSOL vault debit/credit: exactly `1,998,792,182` raw.
- Bison/user USDC vault debit/credit: exactly `211,236,779` raw.
- Bison vaults: `ATRsNGv2nDw7hSMfkUTBoVUDsFDwN7po7KbecyiGWNB4` and `2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU`.

Independent reverse leg returned `1,998,838,216` raw wSOL. Gross spread was `46,034`; net of the transaction fee was `40,875` lamports (`0.000040875 SOL`). This is ordinary atomic price arbitrage, not a broken debit or missing repayment.

## ETH/USD1 vs wSOL/USD1

Literal ETH mint `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs` ↔ USD1 returned **No routes found** in both directions.

The executable current venue is wSOL/USD1:

- Pool `6b5LxeDVxqCGAhZjjjgieGP71c5GBt2cBwiafCFX6NMU`.
- At quote slot `458750559`, 1 wSOL quoted to `105.895490 USD1`.
- A newly generated on-curve user was marked signer in the 23-account Jupiter instruction; the instruction included both Bison and the exact pool.
- At slot `458750588`, pool vaults held `2,999.909838636 wSOL` and `370,794.632759 USD1`.

This establishes the current outsider route-construction gate. It was not broadcast.

## Bounded conclusion

The previously observed direct-call restrictions do not make the venue inaccessible: Jupiter provides the intended signer-bearing parent path. However, the concrete live accounting candidate did not reveal free output, unbalanced custody, or a repayment bypass. Realized unauthorized value attributable to a Bison accounting flaw: **0**.

Limitations: no source or published IDL was available; the analysis therefore binds Composer's learned selector shape to the exact unchanged deployed binary and current live receipt. The USD1 fresh-user test validates instruction construction and signer propagation, not a funded broadcast.

## Multi-provider flash-funding extension — later 2026-10-19 state

This extension tests the requested highest-valid two- and three-provider atomic envelope against a later current-mainnet fork. The replacement RPC was verified as mainnet-beta by genesis hash `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`; its URL and credentials were not recorded. The final fork baseline was slot `458757438`. All composed transactions were locally signed, used `sigVerify: true` with a current blockhash, and were submitted only to `simulateTransaction`. There is no send path and nothing was broadcast.

### Current WSOL capacity and fee controls

| Provider | Current capacity evidence | Fee | Exact blocker above the tested boundary |
|---|---:|---:|---|
| Save | `77,708.541838779 WSOL` (`77,708,541,838,779` raw) succeeded; `+1` raw failed | 4 bps, rounded up | Instruction 1, custom error `20` |
| KLend | `6,226.042554623 WSOL` (`6,226,042,554,623` raw) succeeded; `+1` raw failed | exactly zero (`flashLoanFeeSf = 0`) | Instruction 3, custom error `6008` |
| Project0 | vault `508.996841665 WSOL`; `504.000000000 WSOL` is a repeatable conservative usable amount | zero protocol flash fee | Full-vault borrow fails at instruction 4 with `IllegalUtilizationRatio`, custom error `6026` |

Project0's exact utilization edge is slot-sensitive because interest accrues. A same-fork binary sweep validated `504,760,797,122` raw at slot `458756615`; the same amount failed 110 slots later at `458756725`. This is why the composed maximum controls use the stable lower bound of `504,000,000,000` raw rather than presenting a moving edge as timeless capacity.

Funding-only signed controls establish that provider composition itself works:

- KLend + Project0: `6,730.042554623 WSOL`, 1,008 bytes, 20 keys, 8 instructions, all principal repaid, both lender-vault deltas zero.
- Save + KLend + Project0: `84,438.584393402 WSOL`, 1,267 bytes, 26 keys, 12 instructions, all principal repaid. Total Save fee was `31,083,416,736` raw: the Save fee vault gained `31,083,416,735` and the remaining 1 raw followed Save's host-fee account path. KLend and Project0 lender-vault deltas were zero.

The three-provider maximum is a provider-composability control, not a profitable Bison claim; its Save fee was supplied by synthetic fork-only wallet lamports.

### Exact Bison → HBV route envelope

The exact landed Jupiter route instruction was reused, with only the outsider signer/token accounts and the input/minimum-output u64 values remapped. “transactionv1” is treated here as one atomic transaction, not as a mandatory Solana message-version requirement. The harness's signed wire encoder labels its accepted format version 1; the security conclusion depends on atomic composition and the measured byte/key limits, not that label.

At the landed size of `1.998792182 WSOL`:

| Envelope | Borrow allocation | Planned lender fee | Wire envelope | Result |
|---|---|---:|---|---|
| Two provider | KLend `1.898792182` + Project0 `0.100000000 WSOL` | `0` | 1,542 bytes, 34 keys, 10 instructions, 2 verified signatures | Bison succeeds; HBV reverse fails at outer instruction 6, custom error `4` |
| Three provider | Save `0.000000003` + KLend `1.898792179` + Project0 `0.100000000 WSOL` | Save `1` raw; others `0` | 1,777 bytes, 40 keys, 12 instructions, 2 verified signatures | Bison succeeds; HBV reverse fails at outer instruction 7, custom error `4` |

Both envelopes are well below 4,096 bytes and 64 keys. They are construction successes followed by a protocol/runtime rejection, not build failures.

The same two-provider envelope was tested at `0.2`, `0.5`, `1.0`, and `1.5 WSOL`. Every size reached and completed the Bison leg, then HBV failed immediately with custom error `4`. As an independent control, replaying the original landed transaction unchanged against the later fork state also made Bison succeed and HBV fail with custom error `4`. That control used signature verification disabled only because the historical blockhash/signature cannot be current; it isolates the failure to the current HBV route state rather than the new signer mapping or flash-provider composition.

### Repayment and final equity reconciliation

No positive full route currently validates. The highest tested positive size that completed `borrow → Bison → independent reverse → all repayments` is therefore **none**; the exact current blocker is the HBV reverse-leg rejection described above.

Because each failing envelope is atomic, the runtime rolls back the successful Bison and lender-borrow writes before any state commits:

- actually charged lender fees: `0`;
- final outsider WSOL/USDC token-equity delta in the simulation: `0`;
- final Save, KLend, Project0, Bison, and HBV committed token-equity delta: `0`;
- unpaid committed lender principal: `0`.

The planned three-provider Save fee of 1 raw is never charged because execution fails earlier and rolls back. Simulation does not charge a network fee, and no real wallet transaction was sent, so real-wallet equity also remained unchanged. A failed broadcast would separately pay the network transaction fee, but no such broadcast was attempted.

Validation rubric result: current capacity and fee semantics for three distinct providers are established; signed two-/three-provider atomic envelopes fit the requested size/key limits; however, the required successful Bison + independent reverse + all-repayments criterion fails at HBV. This extension therefore does **not** upgrade the earlier ordinary-arbitrage observation into a currently executable multi-provider exploit.

Persistent evidence:

- `bison-wsol-flash-envelope-2026-10-19.json` — signed wires, hashes, account counts, logs, capacity boundaries, token deltas, and all route-size probes.
- `bison-wsol-flash-envelope-2026-10-19.js` — simulation-only harness; no send path.
- `original-route-current-replay-2026-10-19.json` — unchanged historical-route current-state control showing the same HBV failure.
