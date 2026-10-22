# PR #1396: deposit and withdrawal checkpoint receipt

This receipt covers real Whirlpool swaps, `increase_liquidity`, `decrease_liquidity`, `update_fees_and_rewards`, and `collect_fees` on isolated local Surfpool validators. It uses locally built program ELFs from the exact PR parent (`fb19ae2c894d7d4d8025d6e530c52ef6cc579859`) and merged revision (`f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36`). It does **not** claim that these local ELFs are byte-identical to the live mainnet ELF; that independent byte comparison is recorded in `onchain-verification.md`.

| Binary | SHA-256 | RPC used |
| --- | --- | --- |
| Before | `ef62f419e32360a3b950d8f20a7b7e8137810673182b16bd66c5621e8011db8b` | `http://127.0.0.1:60899` |
| After | `d3cda1bcaef189b28aee377fb05106cef7ca51c714d1928ac9ba80d519d843ee` | `http://127.0.0.1:59899` |

The [runnable test](surfpool_pr1396_liquidity_transition.test.ts) initialized a pool with a target position holding 210,000,000 of 1,000,000,000 liquidity (21%). Each A-to-B swap of 333 input units generated one LP fee unit. In each of two separate pool fixtures per binary, it performed four swaps; an owner-signed increase from 210,000,000 to 420,000,000; four more swaps; an owner-signed decrease back to 210,000,000; then five more swaps. One fixture had an independent outsider call `update_fees_and_rewards` after every swap; the other had no intermediate outsider calls. It then updated the target and collected its fees. The [before JSON](liquidity-transition-pre.json) and [after JSON](liquidity-transition-post.json) contain account states and transaction compute-unit receipts.

| Binary | Outsider intermediate updates | A units owed before collection | Actual owner credit | Actual vault debit |
| --- | --- | ---: | ---: | ---: |
| Before | Yes | 0 | 0 | 0 |
| Before | No | 2 | 2 | 2 |
| After | Yes | 2 | 2 | 2 |
| After | No | 2 | 2 | 2 |

The after-binary deposit boundary is especially clear. Following four swaps and four outsider updates, the target had `feeOwedA=0`, checkpoint `0`, and fee growth `73,786,976,292`. Its ideal fractional A fee was `210,000,000 × 73,786,976,292 / 2^64 ≈ 0.84`, which had not become a whole token. The owner-signed increase credited zero, set the checkpoint to `73,786,976,292`, and raised liquidity to 420,000,000. Thus about 0.84 of a token-equivalent claim was deliberately discarded at this authorized liquidity boundary. Without the full checkpoint, applying the old growth to the doubled liquidity would give `floor(420,000,000 × 73,786,976,292 / 2^64) = 1`, a retroactive credit from growth earned before the deposit.

Before withdrawal in the after-binary outsider fixture, the target had one whole unit owed, checkpoint `117,707,795,516`, and growth `134,767,948,436`. With old liquidity 420,000,000, the remaining fractional accrual was `≈ 0.38843`, so the owner-signed decrease credited zero additional units and moved the checkpoint fully to `134,767,948,436`. Five subsequent swaps at the restored 21% share yielded one more whole fee unit. The target collected two units; the SPL token vault fell by exactly two. The matching no-outsider fixture also collected two.

This is the intended distinction in [the merged position manager](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/manager/position_manager.rs#L16-L107): a zero liquidity delta uses Partial checkpointing, retaining subunit growth; a nonzero delta uses Full checkpointing, settling at the old liquidity and resetting to current growth. Both fee mints and reward checkpoints follow that rule. [The liquidity manager](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/manager/liquidity_manager.rs#L90-L164) passes the nonzero delta to that function; the production Pinocchio path [mirrors the same mode switch](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/pinocchio/ported/manager_liquidity_manager.rs#L257-L315).

For nonoverflowing growth, Partial computes `q = floor(L × (G − C) / 2^64)`. If `q=0`, it keeps `C`; otherwise it advances by `ceil(q × 2^64 / L)`. Since `q × 2^64 / L ≤ G − C`, the next checkpoint cannot exceed current growth, and the still-uncredited residual is less than one whole fee/reward unit at that liquidity. Full computes the same whole-unit `q` using **old** liquidity, then sets `C=G` before changing liquidity. The test confirms there is no observed double credit from the deposit or withdrawal in this sequence.

An outsider can call [`update_fees_and_rewards`](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/instructions/update_fees_and_rewards.rs#L8-L43) without a position authority signer. However, [v1 increase](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/instructions/increase_liquidity.rs#L15-L62), [v1 decrease](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/instructions/decrease_liquidity.rs#L20-L36), and their v2 counterparts require a signed position authority validated against the position NFT owner or authorized delegate. The outsider cannot trigger this Full-mode rounding boundary for another position through the standard deposit/withdraw routes. Fee collection also requires that authority and transfers only `fee_owed` from the vault; the tested outsider receives no token transfer.

## Re-run

Place the test file in `legacy-sdk/whirlpool/tests/integration/v1-ix/` of a checkout with the SDK dependencies and generated IDL. Start two offline Surfpool instances with distinct RPC and websocket ports, load the corresponding ELFs with `load_verified_elf.py` (its executable-cache refresh is required on Surfpool 1.6.0), then from `legacy-sdk/whirlpool` run:

```sh
SURFPOOL_RPC_URL=http://127.0.0.1:59899 EXPECT_EQUAL=true RESULT_PATH=/tmp/liquidity-post.json node ../../node_modules/vitest/vitest.mjs run tests/integration/v1-ix/surfpool_pr1396_liquidity_transition.test.ts --config vitest.config.mts
SURFPOOL_RPC_URL=http://127.0.0.1:60899 RESULT_PATH=/tmp/liquidity-pre.json node ../../node_modules/vitest/vitest.mjs run tests/integration/v1-ix/surfpool_pr1396_liquidity_transition.test.ts --config vitest.config.mts
```

Both tests passed. The test asserts the Full-mode arithmetic and exact owner-credit/vault-debit equality; the pre-binary run deliberately does not assert equal fees across outsider/no-outsider fixtures because that is the bug being demonstrated.
