# High-liquidity fee test on the deployed Whirlpool ELF

On October 19, 2026, this test executed real swaps, permissionless fee updates, and SPL-token fee collections on an **offline Surfpool 1.6.0 ledger**. The executed Whirlpool program bytes matched the independently extracted, finalized mainnet ProgramData ELF. No transaction was sent to mainnet. [On-chain verification](onchain-verification.md) records the ProgramData account, deployment slot `457152296`, extraction, and match to Orca's archived binary.

| ELF | SHA-256 | Length | Use |
| --- | --- | ---: | --- |
| Source-built PR #1396 merge `f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36` | `d3cda1bcaef189b28aee377fb05106cef7ca51c714d1928ac9ba80d519d843ee` | 1,583,304 bytes | Create fresh pool and LP positions; production's `InitializeConfig` rejects a test funder. |
| Finalized mainnet ELF | `94da79f11a6c57646c7483cbee37dbb135d91dbe4c2a6200e3ef24f4ca776273` | 1,495,896 bytes | Execute every tested swap, update, and fee collection. |

After fixture creation, [the test](surfpool_high_liquidity_live_elf.test.ts) calls [the hot-swap helper](hot_swap_whirlpool_elf.py). It replaces ProgramData with exactly the new 45-byte loader header plus ELF, verifies byte equality and length, and refreshes the executable Program account so Surfpool executes the new bytes. A plain `surfnet_writeProgram` over the longer source ELF left trailing source bytes. The [run log](high-liquidity-live-elf.log) records the source and live SHA twice, once per scenario. The first live swap logged `Instruction: Swap` and consumed 31,114 CU; the first live update logged `Instruction: UpdateFeesAndRewards` and consumed 8,168 CU. Those logs rule out Surfpool's observed 138-CU `Hello from my program!` placeholder.

## Result

The pool held `2^64` liquidity units, split 75% target LP and 25% other LP. Each of 20 actual 334-unit A-to-B swaps generated two raw token-A fee units and advanced global fee growth by two Q64 units. The only difference between scenarios was how often an outsider called `update_fees_and_rewards` on the target position. The LP owner collected fees after the swaps.

| Target update schedule | Target owed / collected | Other LP collected | Total collected / vault debit | Total swap fees |
| --- | ---: | ---: | ---: | ---: |
| Outsider update after every swap | 20 | 10 | 30 | 40 |
| One target update at end | 30 | 10 | 40 | 40 |

The [full receipt](high-liquidity-live-elf.json) contains the 20 fee-growth steps, first swap/update signatures and logs, position owed/checkpoint values, collections, and matching vault debits. Each interleaved update credits `floor((3/4) × 2) = 1` target unit, then advances its checkpoint by `ceil(2^64 / (3·2^64/4)) = 2` growth units. The repeated checkpoint moves consume the fractional remainder, so the target collects **10 fewer raw units** than with one final update. Those 10 units stay in the Whirlpool token vault without a position credit; the outsider receives none. This is a positive-owed rounding case that survives PR #1396's zero-owed fix.

## Re-run on a fresh local ledger

The commands below use the existing post-PR checkout and binaries from this investigation. Build the checkout at the merge SHA first if they are absent. Use a free port pair in place of `49899`/`49900` if needed. Start Surfpool in one terminal:

```sh
/Users/stacc/.local/bin/surfpool start --offline --no-studio --no-tui \
  --no-deploy --yes --port 49899 --ws-port 49900 --log-level error
```

When the local RPC is ready, run this from another terminal to load and byte-check the setup ELF. The test hot-swaps to the live ELF after setting up each scenario and back to the source ELF before setting up the next one.

```sh
ROOT=/Users/stacc/the-composer-rescue/composer-runs/2026-10-19/orca-pr1396
POST=/private/tmp/whirlpools-1396-post
SOURCE=/private/tmp/whirlpools-1396-bin/post/whirlpool.so
LIVE="$ROOT/whirlpool-onchain-20261015.so"
shasum -a 256 "$SOURCE" "$LIVE"
python3 "$ROOT/deploy_and_verify.py" http://127.0.0.1:49899 "$SOURCE"
cp "$ROOT/surfpool_high_liquidity_live_elf.test.ts" \
  "$POST/legacy-sdk/whirlpool/tests/integration/v1-ix/"
cd "$POST/legacy-sdk/whirlpool"
SURFPOOL_RPC_URL=http://127.0.0.1:49899 \
LIVE_ELF_HOT_SWAP_SCRIPT="$ROOT/hot_swap_whirlpool_elf.py" \
SOURCE_POST_ELF="$SOURCE" LIVE_ONCHAIN_ELF="$LIVE" \
RESULT_PATH="$ROOT/high-liquidity-live-elf.json" \
node ../../node_modules/vitest/vitest.mjs run \
  tests/integration/v1-ix/surfpool_high_liquidity_live_elf.test.ts \
  --config vitest.config.mts
```

The saved run passed one test in about 38 seconds. Confirm the hot-swap log prints the two SHA-256 values above before each scenario's swaps, and that the transaction receipts show real `Swap` and `UpdateFeesAndRewards` logs with the collections in the table.
