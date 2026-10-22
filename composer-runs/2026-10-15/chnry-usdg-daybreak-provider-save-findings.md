# Save/Solend exact-mint flash liquidity check

Observed on Solana mainnet-beta on 2026-10-15 at 20:06 UTC (16:06 EDT). Read-only RPC only. No transaction was signed, simulated, or submitted for this provider check.

## Decision

**Save/Solend has no current same-mint USDG or USDv flash source.** A direct Save flash loan cannot fund the specified Chancery USDG route. Current usable same-mint capacity is **zero**, regardless of Save's TVL in other assets. There is no exact-asset Save borrow/repay pair to combine with Chancery in a signed Solana v1 transaction, so a byte/account-budget or `sigVerify:true` composition result is not applicable to this provider.

## Current chain state

- The official [Save address documentation](https://docs.save.finance/architecture/addresses) identifies mainnet program `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo`. At slot `457360857`, RPC returned it as executable and owned by the BPF Upgradeable Loader.
- Exact USDG mint `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` is Token-2022 owned, six decimals, 866 data bytes. Exact USDv mint `USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk` is Token-2022 owned, six decimals, 617 data bytes.
- Save's [reserve layout](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/reserve.rs#L1231-L1307) has 619 bytes and stores the liquidity mint at byte offset 42. A full 619-byte reserve census returned **1,770** Save-owned accounts at context slot `457361015`: **zero USDG** and **zero USDv**. Independent exact-mint account filters at offset 42 without a size restriction also returned zero for both mints at slots `457360921` and `457360982`.
- The 1,770 reserve-layout accounts referenced 199 distinct market addresses. Of these, 195 were existing, Save-owned 290-byte lending markets, and **all 195 configured the legacy SPL Token program** `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`; none configured Token-2022. The other four references were one system address and three nonexistent accounts, and offer no usable market.
- Because no exact-mint reserve exists, there is no reserve `available_amount`, verified matching supply vault, or fee setting for USDG or USDv to quote. A token balance held elsewhere is not Save flash capacity.

## Protocol terms and compatibility

The pinned official [Save lending source](https://github.com/solendprotocol/solana-program-library/tree/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending) documents the mechanisms; the current chain census above decides this exact-asset availability independently of whether that source commit matches the deployed ELF byte for byte.

- [Flash borrow](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/program/src/processor.rs#L2599-L2776) checks the reserve's configured supply and market, rejects `flash_loan_fee_wad = u64::MAX`, requires a matching later repay in the same transaction, rejects CPI, and rejects another Save flash borrow. [Flash repay](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/program/src/processor.rs#L2777-L2952) verifies the indexed borrow and transfers principal plus any assessed host/origination fees. This is one indexed borrow/repay pair per transaction, with no borrower obligation or bank-mode account for the flash loan.
- [Fee calculation](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/sdk/src/state/reserve.rs#L1124-L1212) uses the reserve's `flash_loan_fee_wad` over 10^18. Exact zero config yields zero fee; a positive rate has a minimum fee of one raw unit, or two when a host fee is required. These are protocol terms, **not a finding that an exact USDG or USDv zero-fee reserve exists**.
- [Reserve initialization](https://github.com/solendprotocol/solana-program-library/blob/d04ce00bbf4356c4fd32b3be38eb9760b696bb3e/token-lending/program/src/processor.rs#L351-L399) requires its mint owner to match the market's configured token program. Current existing markets are all configured for legacy SPL Token while the two requested mints are Token-2022. The source also uses legacy `spl_token::state::Mint::unpack` for reserve initialization. The live market configuration and absent reserves are sufficient to rule out this direct route.

## Evidence

- [Read-only census script](chnry-usdg-daybreak-provider-save-census.js)
- [Current RPC result](chnry-usdg-daybreak-provider-save-census.json)
- [Pinned official source checkout](chnry-usdg-daybreak-provider-save-source/) at commit `d04ce00bbf4356c4fd32b3be38eb9760b696bb3e`

The census script reads credentials from `/tmp/composer-helius-rpc.env` at runtime and writes no endpoint or credential values to evidence.
