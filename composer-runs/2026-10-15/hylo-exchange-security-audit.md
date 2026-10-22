# Hylo Exchange current-mainnet outsider-gain audit

Date: 2026-10-15  
Target: `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn`  
Primary asset: JitoSOL `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`

## Result

**No validated outsider-accessible unauthorized net asset gain was found in the tested JitoSOL/xSOL exchange surface. There are zero reportable findings.**

The strongest same-state test was a real, no-ALT Solana v1 transaction against the current mainnet executable and accounts:

`ATA idempotent create -> zero-fee KLend JitoSOL flash borrow -> Hylo mint xSOL -> Hylo redeem all minted xSOL -> exact KLend repay`

The successful wire was 1,063 bytes, 25 accounts, and 5 instructions under the 4,096-byte v1 limit. It fully repaid at dust, ordinary, 90%-of-liquidity, liquidity-minus-one, and exact-current-liquidity sizes. In every successful full unwind:

- KLend supply-vault delta was exactly zero.
- KLend fee-vault delta was exactly zero.
- Caller xSOL delta was exactly zero.
- Caller JitoSOL delta was negative.

At the exact available flash amount of 721,263.424102624 JitoSOL, the caller ended **14,607.854379973 JitoSOL down** after complete repayment. This is not an outsider-gain finding.

The important limitation is provenance: the current executable was dumped and hashed, but a reproducible source-to-current-binary match could not be established. That is a verification gap, not proof of an exploitable path.

## Scope and safety

This pass used current-mainnet account reads and `simulateTransaction` only. It did not sign or submit a transaction and did not contact an operator. The simulated caller was an on-curve, System-owned, non-operator account. Signature verification was disabled only because this was a read-only simulation; the instruction privileges and current executable behavior were still exercised.

Operator or upgrade-authority behavior is deliberately excluded from the finding standard. A result would require positive outsider equity after complete lender repayment and all liabilities. None was observed.

## Live custody confirmation

At slot 457,356,939, the Hylo JitoSOL vault was live with the same custody identity recorded by the census:

| Field | Live value |
|---|---|
| Vault | `2Y3TLkdGoJwbdizxqrZmQwNLYJyGKTgzC4tbetbkvQ43` |
| SPL owner program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token authority | `82MNhUCha26wY4kohTUEC965b4ypEe7RPa4itp9UMrKK` |
| Mint | JitoSOL |
| Raw balance | `230893431670961` |
| Decimal balance | 230,893.431670961 JitoSOL |
| Nominal pool backing before withdrawal fee | 301,644.513408627 SOL |

The census's approximately $31.821 million mark is price-dependent; the raw custody amount above was independently refreshed. The census's approximately $120.158 million Kamino plus $7.587 million Project 0 same-mint inventory remains routing context, not proof that all inventory is flash-borrowable. The exercised KLend reserve exposed 721,263.424102624 JitoSOL as current available liquidity and an exact zero flash-fee rate.

The historical provenance transaction decoded under the current public IDL as `redeem_levercoin_lst`, and recent sampled successful Hylo calls continued to decode under that IDL. This corroborates that the vault PDA is used for permissionless exchange redemptions; it does not by itself imply an unauthorized exit.

## Atomic full-unwind results

All amounts below are from successful single-transaction simulations. Each row includes borrow, Hylo mint, Hylo redeem, and exact lender repayment in one bank state.

| Flash size | Wire | Lender supply delta | Lender fee delta | Caller xSOL delta | Caller JitoSOL delta | Outcome |
|---:|---:|---:|---:|---:|---:|---|
| 10 raw | 1,063 B / 25 accts | 0 | 0 | 0 | -4 raw | Fully repaid; loss |
| 1 JitoSOL | 1,063 B / 25 accts | 0 | 0 | 0 | -0.020906648 | Fully repaid; loss |
| 100 JitoSOL | 1,063 B / 25 accts | 0 | 0 | 0 | -2.090586843 | Fully repaid; loss |
| 90% current liquidity | 1,063 B / 25 accts | 0 | 0 | 0 | -13,152.339289842 | Fully repaid; loss |
| Current liquidity minus 1 raw | 1,063 B / 25 accts | 0 | 0 | 0 | -14,607.854379973 | Fully repaid; loss |
| Exact current liquidity | 1,063 B / 25 accts | 0 | 0 | 0 | -14,607.854379973 | Fully repaid; loss |

The stablecoin branch did not furnish a second unwind path:

- Small JitoSOL -> hyUSD mint succeeded, but same-transaction full redemption rejected with Hylo error 13035, `NoValidStablecoinRedeemFee`, because the projected collateral ratio was above the redeem-fee curve domain. The transaction rolled back.
- Near-liquidity stablecoin mint rejected with error 13034, `NoValidStablecoinMintFee`, because the projected collateral ratio was below the mint-fee curve domain. The transaction rolled back.

Those are exact blockers, not substituted prototype behavior.

## Arithmetic and same-transaction ordering

The public SDK's conversion implementation uses bounded fixed-point arithmetic and contains a property test asserting `token_to_lst(lst_to_token(x)) <= x`. `cargo test -p hylo-core` completed with 221 passed, 0 failed, and 2 ignored. The live round trips independently showed protocol-favoring loss rather than caller-favoring accumulation.

Ordering controls produced these current-binary outcomes:

- Redeem before mint failed for insufficient token funds and rolled back.
- Repay before redeem succeeded only by using the caller's existing JitoSOL balance, then redeemed; lender balances returned exactly and caller JitoSOL still fell by 0.020906648.
- Two sequential mint/redeem cycles in one 1,136-byte transaction fully repaid. It left 0.070083 xSOL dust and lost 0.042253639 JitoSOL. Valuing the dust at the observed one-JitoSOL mint rate gives at most 0.000034172 JitoSOL, for an upper-bound net of **-0.042219467 JitoSOL**. A real redeem would charge fees, so this deliberately overvalues the residual.

No same-transaction stale-state or rounding accumulation produced positive complete-repayment equity.

## PDA substitution and oracle freshness

The public IDL supplies PDA seeds or relations for the Hylo state, fee/vault authorities, fee/vault token accounts, LST header, protocol-token mint authority/mint, token program, and event authority. Live negative controls showed that the current executable also enforces the expected runtime constraints:

| Control | Current-binary result |
|---|---|
| Replace Hylo JitoSOL vault with KLend JitoSOL supply vault | Rejected: Anchor owner/associated-account constraint, error 2015 |
| Replace LST header with Hylo state | Rejected: discriminator mismatch, error 3002 |
| Replace Pyth account with a Hylo-owned account | Rejected: Pyth Receiver owner mismatch, error 3007 |
| Replace canonical SOL/USD account with a real, verified historical account carrying the same feed ID | Rejected: static address constraint, error 2012 |

The last control is material. The public IDL names `sol_usd_pyth_feed` but does not encode its static address. The deployed executable nevertheless compared the supplied `GGdMnioYUC8qFWrWXJP2n3YHAns49MJW87CeuT7sgvrf` account against canonical `7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE` and rejected it before freshness evaluation. This is direct current-binary evidence that the high-severity historical same-feed substitution issue described in the public audit remains blocked on this path.

The published oracle math additionally checks positive price, supported exponent, confidence tolerance, publish-time freshness, posted-slot freshness, and future-slot rejection. Transient `PythOracleOutdated` or `PythOracleSlotInvalid` results occurred when an RPC simulation bank lagged the loaded price account; fresh-bank retries succeeded. No stale oracle was accepted.

## JitoSOL backing and exit liquidity

The canonical Jito stake-pool account was current for epoch 1058 and owned by the published SPL Stake Pool program. Its live state showed:

| Metric | Value |
|---|---:|
| Total stake-pool backing | 10,478,732.138756046 SOL |
| JitoSOL supply | 8,020,932.970859628 JitoSOL |
| Direct reserve SOL before fee | 8,065.831886468 SOL |
| Direct-reserve coverage of Hylo vault backing | 267 bps (2.67%) |
| SOL withdrawal fee | 1/1000 |
| Explicit SOL withdraw authority | None |

The reserve cannot immediately redeem Hylo's entire JitoSOL balance into liquid SOL. SPL stake-pool `withdraw-stake` can instead return delegated stake from validator inventory, but realizing that stake as liquid SOL requires the ordinary deactivation/cooldown process. This liquidity limitation does not change the atomic exploit result because the borrow, Hylo operation, and repayment were all denominated in JitoSOL; no JitoSOL-to-SOL exit was assumed.

Jito's published deployment list identifies the same stake-pool program, pool account, and JitoSOL mint used in the live checks. SPL's published processor documents the reserve-limited SOL withdrawal and stake-account alternative.

## Current executable versus public source and audit

The current deployment was independently fetched and hashed:

| Field | Value |
|---|---|
| Loader | BPF Upgradeable Loader |
| ProgramData | `BA5b6FzvZ77m7MZbsMEVSCFW1x86f7jM98wjcecVwzYN` |
| Last deployment slot | 447,625,876 |
| Upgrade authority | `GzyhwK4y7EKPEevAMc2TEpgi1Y3znwj14FUzkHmCMiNP` |
| Executable length | 1,760,400 bytes |
| Current executable SHA-256 | `c745eb73d5dfa951a6317bcd5ceef1e540f7367ff7165d12596835d0488f5719` |
| Local dump matches freshly fetched executable | Yes |

The December 2025 public audit names audited commit `0c3c6d34c5c50d94425f150f86913e2be7431cb7` and build hash `7d4e5ff843530aeeefb44e3356edec81999ee0f71bf0516b6c9ab16cb577d0fa`. The current hash does **not** match that attestation.

The public SDK checkout was commit `d5a989e1862b467d69e7f5b2e7d2ecc2aae966b0`, workspace version 2.6.5. Its IDL metadata version is 2.0.5, contains 77 instructions, names the correct program, and hashes to `7d3c25be6a8d60151f3e876ac994457be1a389e35811fa8576916eab55d524fd`. It provides IDL, clients, quotes, and math, but not the full on-chain processor needed to rebuild and match the current executable.

The public verified-build registry returned `is_verified: false`, no program builds, and no build resolving the current hash. Therefore:

**Current source/binary equivalence is not established.** Public source review supports hypotheses and test design, while the security conclusion relies on direct current-binary simulations and live account constraints.

The public audit's relevant constraints were also treated conservatively:

- Its high-severity historical-Pyth-account substitution issue was marked fixed; the current runtime canonical-address rejection was tested directly.
- Its slippage issue was marked fixed, but this pass did not rely on slippage for safety: even with optional slippage omitted, complete xSOL round trips lost value.
- Its projected stability-mode gross/net observation was marked wont-fix. The tested stablecoin extremes were gated by the live fee-curve domain and yielded no complete-repayment gain.

## Limitations

- This is a focused audit of permissionless JitoSOL exchange entry/exit, arithmetic, oracle/PDA substitution, and same-transaction ordering. It is not proof that all 77 IDL instructions or every market state are safe.
- The current on-chain processor could not be reproducibly matched to public source.
- Each successful exploit attempt is internally atomic and same-state, but separate rows necessarily observed nearby changing mainnet slots.
- Read-only simulation used `sigVerify=false`; no private key was used and no transaction was submitted.
- The JitoSOL dollar values in the input census are market marks, not guaranteed liquidation proceeds.
- Upgrade-authority behavior is outside the outsider finding model.

## Reproduction and artifacts

Run from `/Users/stacc/the-composer-rescue`; the scripts read the configured RPC environment without printing it:

```sh
node composer-runs/2026-10-15/hylo-exchange-klend-v1-sim.js
node composer-runs/2026-10-15/hylo-exchange-jitosol-liquidity.js
node composer-runs/2026-10-15/hylo-exchange-deployment-attestation.js
node composer-runs/2026-10-15/hylo-exchange-build-summary.js
cd composer-runs/2026-10-15/hylo-exchange-sdk-source
cargo test -p hylo-core
```

Principal artifacts:

- `hylo-exchange-audit-summary.json`: compact machine-readable conclusion.
- `hylo-exchange-klend-v1-sim.js` / `.json`: full atomic harness, logs, token movements, and exact account deltas.
- `hylo-exchange-v1-wire.js`: standalone 4,096-byte transaction-v1 encoder used by the harness.
- `hylo-exchange-live-probe.js` and `hylo-exchange-instruction-map.json`: IDL mapping, current accounts, and sampled live/historical instructions.
- `hylo-exchange-jitosol-liquidity.js` / `.json`: backing and direct-reserve liquidity calculation.
- `hylo-exchange-deployment-attestation.js` / `.json`: ProgramData, executable hash, audit-hash comparison, and registry responses.
- `hylo-exchange-current.so`: current executable dump.
- `hylo-exchange-sdk-source/`: pinned public SDK checkout used for IDL/math review.

Public references:

- Hylo public SDK: https://github.com/hylo-so/sdk
- Accretion December 2025 audit: https://hylo-audits.s3.us-east-2.amazonaws.com/Accretion-Hylo-Dec2025.pdf
- Solana verified-build documentation: https://solana.com/docs/programs/verified-builds
- JitoSOL deployed programs: https://github.com/jito-foundation/jito-omnidocs/blob/master/jitosol/jitosol-liquid-staking/security/deployed-programs/index.md
- SPL stake-pool processor: https://docs.rs/crate/spl-stake-pool/latest/source/src/processor.rs
