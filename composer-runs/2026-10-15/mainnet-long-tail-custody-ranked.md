# Mainnet long-tail custody and flash-route triage

Observed 2026-10-15 using read-only Solana mainnet RPC. No transaction was
submitted. The machine-readable evidence is in
`mainnet-long-tail-custody-ranked.json`; the flash-liquidity overlay is in
`mainnet-long-tail-flash-overlay.json`.

## Scope and denominator

- Exact current executable universe: **77,715** program IDs. See
  `mainnet-program-universe-summary.json` and `mainnet-program-universe.csv`.
- Token-authority discovery is a bounded census of the top 20 token accounts
  for each of **3,987** current Jupiter verified-registry mints: 69,054 unique
  top-account rows, 68,885 live mint-bound token accounts, 36,618 authorities,
  7,046 off-curve authorities, and 334 directly mapped executable state owners.
- This is not an exhaustive token-account census. It excludes below-top-20
  accounts, mints absent from the registry, native SOL/stake, and compressed
  assets.
- `grossUsd` is a price-times-balance signal without a liquidity check.
  `credibleUsd` only admits strict-, stable-, or LST-tagged assets. Neither is
  an exploitable-value estimate.

## Strongest emerging custody controllers

The controller proof used here is stronger than account ownership alone. For
each cited exit, the exact off-curve authority is the SPL transfer authority in
a successful inner instruction. The immediate caller reconstructed from CPI
`stackHeight` is the cited program, proving that program supplied PDA signer
privileges. PDA seed tuples remain unknown where no source/IDL was located.

| Priority | Program | Current custody signal | Exact authority / vault evidence | Deployment identity | Recent exit evidence |
|---|---|---:|---|---|---|
| 1 | `jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS` (identity/source not located) | **$312.92M credible**, all stable-tagged USDe/PYUSD/USDG | authority `6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL`; USDG vault `8DesAbtAabk7s2YdPX5P3Bs5QpHFps5H35mWuzbLYRZX` | ProgramData `3pCmHYrm5vyitCA1xQmgCm86V7ZgKNX17XXgcCohbvTo`; deploy slot 419,328,808; upgrade key `A4CcB3kdi3w4fJgAim4sdN8DvadZnN4R4PPbECQqz6j7` | signature `sYSrcD3W5zgy6VxMbvzztPYYmg6K8mqBhnX6PGsT4L4oCxLhuBUSHqXEuANeXsoDgphCJNDgHuXAQUht1qMmxWZ`, slot 457,252,387; `jup6QF…` immediately called Token-2022 with the authority as signer |
| 2 | `XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy` (identity/source not located) | **$28.56M credible**, $74.88M gross, principally LSTs | authority `6XPT3FnRn3MBpBX3rAyBtd4AXBeGeCdChmTbfVPYnorN`; BulkSOL vault `69aN14j61zbYfJBTNv6yGD7yeVDYWZxzZkbMw6erbVwH` | ProgramData `54htmoqBdDQ3Bb3sc3Tbfuys2NLwBxsBXhLf154NGJHV`; deploy slot 456,137,922; upgrade key `2tX7aHkV1r7am6bnTPqQJNBbEkbqDpNWHBYPahSQb9TP` | signature `2r8LZwaDfxNPB8yTiPF8LTwizzzYecedvkrXJtpfoPQbBF7w51B9cWYZqXt6Lx5DshZKpMwUXd8hk4eJTALr3oPE`, slot 457,333,275; `XP1BR…` immediately signed the BulkSOL outflow |
| 3 | `JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP` (JanusFI / World market-maker AMM; no public IDL located) | **$4.38M CASH** | authority `4H6mGpUjmqMkHesdZim6AhrNkWtjqxPSBkjpM5LTGLw4`; vault `GL3sSqDgKN46xGyUfLQwECRseiSHXqL9UGZ2Qe1RPrRp` | ProgramData `58nG8TtbNdy3rnsTvR1JSNE3ab3cFbUQpiXB1MiuaLL6`; deploy slot 457,294,564; upgrade key `6YrRV52Eq3qmWYyMsq9Wn3kCTokk1xYQJgpKQTWrKj7b` | live sampled exits show Janus as the immediate signer program inside the World/DFlow route |
| 4 | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` (Bison / World pay-in venue; no public IDL located) | **$1.06M credible**, $2.29M gross | exact authority/vault pairs are retained in the JSON | ProgramData `42snJ7ip4zKKsip3EtaMoBo8wzoRsQJSzgUSFXAVJFfG`; deploy slot 456,982,351; upgrade key `6dDjBZdpafRKe7WuVHYTF1HphW1BWiKqioMD5eBGYipS` | same-program signer outflows are live, but one sampled route already uses 50 accounts / 2,034 serialized bytes before flash instructions |
| 5 | `magnaSHyv8zzKJJmr8NSz5JXmtdGDTTFPEADmvNAwbj` (Magna vesting / Airlock) | **$14.37M credible**, $1.568B gross; gross is dominated by issuer allocations and must not be treated as liquid TVL | SANC authority `How2rJVQCFKP8iabjBXHoJqvFHCmHUHmFUj6HE9on8hs`; vault `6Xe1e45BYUG8HcwJ9gVr98TRm6T6TbKqTmadVgJGZbY2` | ProgramData `FcD2fLEvoCrKk6XYKkWueKFvFbpsFTUzyrBfze3Fx7FW`; deploy slot 393,518,261 | direct vesting-program outflows are current; ordinary beneficiary/schedule authorization remains an expected blocker |
| 6 | `eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3` (Solstice YieldVault) | **$10.02M USX** | authority `2aHdm37djj4c21ztMRBmmo4my6RtzN5Nn58Y39rpWbRM`; vault `2SGicAhchh23nsrtWrur7zPAdb4hHtnyThQVPfza8CHA` | ProgramData `BVDochYTcRGvCYmmdtsiX9qT63fy5dmGSB5hNgxMTbJY`; deploy slot 416,855,566 | direct YieldVault signer outflow at slot 457,264,439 |

Public-source controls also surfaced Circle CCTP V1/V2 (**$125.19M** and
**$40.44M** USDC), Orca xORCA staking (**$18.05M** ORCA), and Solayer restaking
(**$9.78M**). They remain in the ranked JSON, but source/IDL availability lowers
their long-tail discovery priority.

## Flashloan-extreme overlay

The following balances are fresh lending-vault/reserve **upper bounds**. A
marginfi/Project 0 Bank balance does not prove that the full amount is available
inside a flashloan account flow. A Kamino Reserve `available_amount` does not
prove a non-USDC reserve's flash configuration; only the existing USDC Kamino
flash control is mint-specific. These rows identify which exact compositions
are worth constructing and simulating next.

| Target | Same-asset liquidity observed | Existing exit envelope | v1 assessment |
|---|---|---:|---|
| `jup6QF…` | USDG: Kamino ≤5.696M, marginfi ≤3,223; PYUSD: Kamino ≤25.387M, marginfi ≤9,799 | USDG exit: 20 accounts, 811 bytes | Strongest next simulation. Exit alone fits 64/4,096; exact flash+exit+repay message is not yet constructed. |
| `XP1BR…` | BulkSOL: marginfi ≤1,327.85 | 38 accounts, 1,005 bytes | High priority, but 26-account headroom is materially tighter. Exact Exponent/XP route and repayment still need construction. |
| JanusFI | CASH: Kamino ≤3.138M, marginfi ≤1,916 | 31 accounts, 661 bytes | High priority because same-asset inventory exits are active and no public IDL was located. Authorization/quote semantics are not bypass evidence. |
| Bison | USD1: Kamino ≤13,857, marginfi ≤1,863; sampled ETH asset also appears in both | 50 accounts, 2,034 bytes | Likely envelope pressure: only 14 inline-account slots remain before adding lender instructions; simulate only after exact meta deduplication. |
| Magna | SANC: marginfi ≤975,126 | 9 accounts, 802 bytes | Envelope is easy; vesting authorization makes economic reachability doubtful absent a separate state flaw. |
| Solstice YieldVault | USX: Kamino ≤2.875M | 26 accounts, 810 bytes | Worth exact withdraw/redeem composition; receipt ownership, conversion, and repayment are expected binding constraints. |

Circle CCTP V1/V2 have large same-asset USDC liquidity and small exits, but
their public bridge state machines and attestation/burn requirements make them
lower-priority than the sparse-source controllers. Flash capital alone does not
replace an attestation.

For every row, `observedExitAloneWithinLimits` means only that the historical
exit transaction fits the requested 4,096-byte / 64-inline-account envelope.
It is **not** a claim that the union of flash borrow, state refreshes, target
withdrawal/claim/settlement, and repay fits or succeeds. The overlay marks all
such routes `candidate_not_constructed_or_simulated` until an exact read-only
simulation exists.

## Reproduction

```text
node rank-long-tail-custody.js --program-limit 30 --authorities-per-program 2 \
  --accounts-per-authority 3 --signatures-per-account 12 \
  --max-transactions-per-authority 18
node build-long-tail-flash-overlay.js
```

Both scripts use only the approved temporary RPC environment file and do not
print its contents. The source/IDL identity notes are isolated in
`long-tail-program-annotations.json` so unverified names never become on-chain
facts.
