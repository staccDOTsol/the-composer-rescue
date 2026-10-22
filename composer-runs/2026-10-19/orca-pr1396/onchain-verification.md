# Independent mainnet and live-bytecode check

Checked on October 19, 2026 with finalized Solana mainnet state through a
user-supplied Helius RPC endpoint. The endpoint's API key is not stored here.

## Chain evidence

| Field | Observed value |
| --- | --- |
| Whirlpool Program | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Program owner | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData account | `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD` |
| ProgramData state | Upgradeable loader `ProgramData` (tag 3) |
| Finalized ProgramData deployment slot | **`457152296`** |
| Slot block time | October 15, 2026, 07:22:05 UTC |
| Finalized RPC context slot for byte extraction | `458863517` |
| ProgramData account capacity | `10,485,760` bytes including 45-byte metadata |
| Active ELF length | `1,495,896` bytes |
| Active ELF SHA-256 | `94da79f11a6c57646c7483cbee37dbb135d91dbe4c2a6200e3ef24f4ca776273` |

The [successful transaction at the deployment slot](https://solscan.io/tx/2Z156jvtGjumG6tAEqfMqctBRuh8YmNb5UbQzkqbnAw6xR4TtFgUC4DW8tykwgcibPfeyiEigZQ3x1Pp1kHNwzGT)
has a Squads top-level instruction and an inner
`BPFLoaderUpgradeab1e11111111111111111111111` `upgrade` instruction. Its
parsed accounts identify exactly the Whirlpool Program and ProgramData listed
above. The transaction succeeded (`meta.err = null`). This also independently
explains the ProgramData metadata slot.

The active ELF is the first `1,495,896` bytes after the 45-byte ProgramData
metadata; the rest of the 10 MiB account is reserved capacity. These bytes
match Orca's archived
[`whirlpool-20261015-457147740.so`](https://github.com/orca-so/whirlpool-tx-replayer/blob/55e3e2022ea8e85253e5254d7b10affaeb8b824a/replay-engine/src/programs/whirlpool/whirlpool-20261015-457147740.so)
byte for byte. Both have the SHA-256 above; the archive's Git blob SHA-1 is
`d944761a663fe2eab1b48845575849c48c24b1a4`. The local
`whirlpool-onchain-20261015.so` is the extracted active ELF.

Orca's [replayer changelog](https://github.com/orca-so/whirlpool-tx-replayer/blob/55e3e2022ea8e85253e5254d7b10affaeb8b824a/replay-engine/src/programs/whirlpool/CHANGELOG.md#L1-L10)
lists PR #1396 in this October 15 binary. The archive **filename** uses slot
`457147740` (07:05:37 UTC), while the on-chain upgrade transaction and
ProgramData metadata give `457152296` (07:22:05 UTC), 4,556 slots later.
The binary identity is independently confirmed despite that label mismatch.

## Live binary in Surfpool

An isolated Surfpool 1.6.0 instance used local RPC `127.0.0.1:58899` and
WebSocket port `58900`. The local loader wrote the extracted mainnet ELF,
verified Surfpool's ProgramData bytes, and refreshed the unchanged executable
Program account. The refresh is necessary here: without it, Surfpool's VM
executed a 138-compute-unit placeholder that logged `Hello from my program!`
even though `getAccountInfo` showed the correct ELF. That initial 0/0 output
was discarded. The refreshed VM logged `Instruction: UpdateFeesAndRewards`
and consumed 7,848 compute units on the first replay transaction.

The 20-round synthetic fee-growth replay used the same
`minimal_checkpoint_replay.cjs` fixture as the source-commit comparison:

| Round | Fee A owed | Fee A growth checkpoint |
| ---: | ---: | ---: |
| 1–4 | 0 | 0 |
| 5 | 1 | 87,841,638,447 |
| 10 | 2 | 175,683,276,894 |
| 15 | 3 | 263,524,915,341 |
| 20 | **4** | **351,366,553,788** |

The first local replay transaction was
`3NYo5Z8b5uXfPvDo53ZZ26NNzSoMUxnWW1ZEw3dFTijCJ56A9ssHSWAjppNrL4LzGxF1bUoJvhuDAbx6BsdgQ5eD`.
Its receipt showed `meta.err = null`, the real instruction log, and 7,848
compute units. This is a local synthetic account replay of the actual deployed
binary; it does not itself perform swaps or fee collection.

## Re-run locally

From a shell with Surfpool 1.6.0 and Node dependencies for the adjacent
replay script, start a fresh **offline** instance in a separate terminal:

```sh
surfpool start --offline --no-studio --no-tui --no-deploy --yes \
  --port 58899 --ws-port 58900 --log-level error
```

Then, from this folder:

```sh
python3 load_verified_elf.py http://127.0.0.1:58899
node minimal_checkpoint_replay.cjs http://127.0.0.1:58899 20
```

Confirm the first receipt logs `Instruction: UpdateFeesAndRewards`, rather
than the placeholder string. The source comparison and full token-flow test
are documented separately in `README.md`.
