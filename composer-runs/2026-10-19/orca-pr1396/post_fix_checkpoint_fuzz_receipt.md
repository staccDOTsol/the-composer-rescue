# PR #1396 post-fix checkpoint boundary test

## Executed program and environment

- Source: `orca-so/whirlpools` commit `f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36` (the merge of PR #1396).
- Built from that source with `cargo build-sbf --manifest-path programs/whirlpool/Cargo.toml --offline`. Deployed ELF SHA-256: `d3cda1bcaef189b28aee377fb05106cef7ca51c714d1928ac9ba80d519d843ee`.
- Surfpool 1.6.0, offline, localhost RPC `http://127.0.0.1:64899`. The executable Program account was refreshed after `surfnet_writeProgram` to invalidate Surfpool's no-op program cache. ProgramData bytes were checked against the ELF file.
- The first confirmed transaction was `54ZD3pg6xPpgbqTVAe4St8SRx9JMtAAQg8KgE7pyzGXRyR98hKTUxbhpkLfq2LNEnM2bNc4Lrjds4CLy5DLCD4Ew` at local slot 137. Its Solana RPC `getTransaction` result had `err: null`, `computeUnitsConsumed: 7113`, and these program logs:

  ```text
  Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc invoke [1]
  Program log: Instruction: UpdateFeesAndRewards
  Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc consumed 7113 of 200000 compute units
  Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc success
  ```

The harness uses Surfpool's `surfnet_setAccount` to seed a pool, position, and tick arrays, then sends signed transactions to the **actual source-built Whirlpool SBF program**. It changes `fee_growth_global_a` directly between transactions to isolate checkpoint arithmetic. The 21% LP case uses the program's real one-unit fee-growth step, `floor(2^64 / 1,000,000,000)`.

## Oracle and coverage

For each update, with `L = position liquidity`, `g = inside growth`, `c = checkpoint`, and `o = fee owed`, the independent BigInt oracle applies:

1. `d = (g - c) mod 2^128`; `p = L × d`.
2. If `p > 2^128 - 1`, expect `(o, g)` because the program's checked multiplication overflows.
3. Otherwise `q = floor(p / 2^64)`. If `q = 0`, expect `(o, c)`.
4. If `q > 0`, expect `o' = (o + q) mod 2^64` and `c' = (c + ceil(q × 2^64 / L)) mod 2^128`.

The test read the on-chain position after each confirmed transaction and compared both `fee_owed_a` and `fee_growth_checkpoint_a` against this oracle. It covered eight named cases and 40 seeded cases, using deterministic xorshift seed `0x1396f2a3d13` and liquidity from `1` through `2^128 - 1`. Named cases include repeated subunit accrual, the 21% LP scenario, Q64/u128 wrap, u64 owed wrap, checked product overflow, and maximum liquidity.

For a nonoverflowing update with `L > 0`, `q = floor(Ld / 2^64)` implies `ceil(q × 2^64 / L) ≤ d`. The new checkpoint therefore cannot pass the observed growth. The remaining growth represents less than one whole owed token at the current liquidity, so the next partial update can accumulate it without crediting the same whole token twice. This argument does not apply when multiplication overflows or when liquidity changes; those paths have separate checkpoint rules.

**Result:** 48 cases, 168 confirmed transactions, 168 exact state comparisons, 45 expected checked-multiplication overflows, **zero discrepancies or failed transactions**. [Full pass log](./post_fix_checkpoint_fuzz.log).

This establishes that the compiled SBF instruction follows the stated checkpoint recurrence in these cases. It does not by itself prove whole-pool token conservation. The `owed_u64_wrap` and checked multiplication overflow cases confirm intentional existing edge behavior: owed counters wrap at 64 bits, while an overflowing 128-bit product credits zero and advances the checkpoint. Both can discard a claim at extreme values; reachability and economic impact require separate analysis.

## Reproduction files

- [Boundary harness](./post_fix_checkpoint_fuzz.cjs)
- [Account-layout and RPC helpers](./checkpoint_fuzz_helpers.cjs)

With the exact post-fix checkout and its Yarn dependencies installed, set `WHIRLPOOLS_REPO` to that checkout and run:

```sh
WHIRLPOOLS_REPO=/path/to/whirlpools-post node post_fix_checkpoint_fuzz.cjs http://127.0.0.1:64899 40
```

The URL must point to an offline Surfpool instance running the exact post-fix ELF. The harness uses new random account keys, so it can run again without reusing the original position state.

This receipt covers partial `update_fees_and_rewards` arithmetic. [The companion liquidity-boundary receipt](./liquidity-boundary.md) covers real swaps plus owner-signed `increase_liquidity` and `decrease_liquidity` instructions: after the fix, outsider updates collected the same two A units as the no-outsider control; before the fix, the corresponding counts were zero and two.
