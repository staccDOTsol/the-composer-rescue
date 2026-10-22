# Byreal CLMM current mainnet-beta gate — 2026-10-15

Target: `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2`. This is an outsider-accessible immediate-value screen, not a repository-wide audit. No transaction was constructed, signed, simulated on mainnet-beta, or broadcast in this pass. The read-only evidence is in [byreal-current-readonly-gate.json](byreal-current-readonly-gate.json); its collection script reads `/tmp/composer-helius-only.env` at runtime and stores no RPC URL.

## Current finalized state

At finalized slot **457405536** (2026-10-15T22:33:41Z), the executable program still pointed to ProgramData `6YDesqidNpd8H4pWThk3yzT1aYaHLK4XYDXJcwbgMxdq`, whose loader header records deploy slot **438767271**. The program account SHA-256 was `9a9972c5b46f3da3ecde0aca516ed8d53b0e35e9c3908f9bdc097ad7649246a4`. Only the first 165 ProgramData bytes were read; there was no fresh ELF hash or source/build attestation.

| Pool | Vaults, exact raw units | Human units |
| --- | --- | --- |
| WSOL/bbSOL `87pbGHxigtjdMovzkAAFEe8XFVTETjDomoEFfpSFd2yD` | WSOL `6kY53...`: `12,258,798,445,817`; bbSOL `Auxmbn...`: `11,604,559,753,341` | 12,258.798445817 WSOL; 11,604.559753341 bbSOL |
| CRCLx/USDC `Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa` | CRCLx `8feVD...`: `1,455,385,637,578`; USDC `5Jcnt...`: `238,554,134,467` | **14,553.85637578 CRCLx**; 238,554.134467 USDC |

Both pools are 1,544-byte Byreal-owned accounts. Both named vault pairs are controlled by their respective pool PDA. Parsed mint/vault fields agree with the token accounts. The published source layout was used to read pool prices, but the published source has **not** been proven byte-for-byte equivalent to the deployed ELF.

**Unit correction:** CRCLx mint uses **8 decimals**, confirmed independently by the pool state and a finalized `transferChecked` fixture (`3Pd2Li7YKLJfQC3HDqi48TBu1P5zg52V8UNczoL2u5tha2ErcCMXceHvVtDmM7hTroZEgEt9j6n96DmRRj9Sdvq3`). The queue's earlier “1,428,245.769417 CRCLx” for `1,428,245,769,417` raw units is **14,282.45769417 CRCLx**. This is a 100-fold error in the *human token count*. Its prior approximately **$1.23 million** gross mark does **not** fall 100-fold: the custody census used approximately **$85.85–$86.12 per CRCLx**, consistent with 8 decimals. At the current Byreal pool mid-price of $86.1740686977, the current CRCLx vault has an indicative $1,254,165 spot mark, plus $238,554 USDC. This is an indicative inventory mark, not executable proceeds or attacker profit.

## Public route screen and atomic economics

The current Byreal CRCLx/USDC square-root price is `17124110506431457445` Q64.64. At finalized slot **457405805**, the independent Raydium CLMM CRCLx/USDC pool `GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV` was live, 1,544 bytes, with the same mints and square-root price `17124455375121613243`. These imply mid-prices **$86.1740686977** and **$86.1775397144** per CRCLx. Buying CRCLx on Byreal and selling it on Raydium has only a **0.0040279% (0.40279 basis point) gross spot gap** before swap fees, price impact, token extension effects, transaction fees, and lender costs. The reverse direction has a negative starting gap. A spot comparison is a screening bound, not an executable quote.

The pre-existing [signed current-mainnet-backed Surfpool fork run](byreal-signed-cross-pool-maxflash-v4.json) at slot **457374387** tested one complete `KLend USDC flash borrow → Byreal USDC/CRCLx exact-in swap → Raydium CRCLx/USDC exact-in swap → KLend repay` packet. The signer started with **300,000 USDC** and zero CRCLx, and the loan was `8,229,043,891,243` raw USDC in each row. Each row had `sigVerify: true`, `err: null`, **zero lender supply/fee-vault delta**, **zero final CRCLx**, and the exact final attacker USDC loss shown below. The seed capital means these rows do not prove a zero-capital route, but they do prove the tested atomic route ended below its starting equity after full repayment on that fork.

| Byreal input USDC | CRCLx received | Raydium USDC received | Final attacker USDC delta | Compute units |
| ---: | ---: | ---: | ---: | ---: |
| 200 | 2.30106316 | 199.183391 | **−0.816609** | 166,396 |
| 10,000 | 114.76461987 | 9,929.066968 | **−70.933032** | 205,754 |
| 100,000 | 1,121.26048271 | 96,561.675617 | **−3,438.324383** | 625,032 |
| 200,000 | 2,178.21802890 | 186,681.056824 | **−13,318.943176** | 1,154,656 |

Each tested packet had **four instructions, 36 addresses, one signature, and 1,456 bytes** in transaction-v1 form, within the format's 64-account and 4,096-byte bounds. The maximum tested compute was below 1.4 million. [Solana's v1 documentation](https://solana.com/docs/core/transactions/versioned-transactions) describes those format bounds. Fork acceptance is not a direct mainnet-beta simulation or proof of landing.

The WSOL/bbSOL pool's current square-root price `17022362359569644011` implies about **1.174356 WSOL per bbSOL** at the pool mid-price. The two previously identified bbSOL lender/bank vaults currently hold `65,314,645,932` and `70,894,930,305` raw bbSOL, a combined **136.209576237 bbSOL** of vault inventory, far below the Byreal bbSOL vault. This is only account inventory; public borrowing capacity and an independent profitable exit for a WSOL/bbSOL flash route were not established. No signed mainnet-beta simulation was warranted by the present route screen.

## Finding status and limits

**No immediate drain or novel vulnerability is demonstrated.** Public exact-in swaps exist, but the tested complete USDC/CRCLx route repaid and lost equity, and today's independent spot gap is much smaller than the losses in that test. The bbSOL path remains an untested candidate, not a finding. This screen does not cover all Byreal pools, liquidity/NFT operations, dynamic fee boundary behavior, or all independent exits.

**Published bug versus novel candidate:** the [maintainer repository's public advisory page](https://github.com/byreal-git/byreal-clmm/security/advisories) lists no published advisories. Its [public issue #2](https://github.com/byreal-git/byreal-clmm/issues/2) requests reproducible deployment/source and fee evidence; it does not publish an exploitable bug. We therefore identify no established published Byreal bug here, and we do not relabel ordinary pool price movement or the unit correction as a novel exploitable bug.
