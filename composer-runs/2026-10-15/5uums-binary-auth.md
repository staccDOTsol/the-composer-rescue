# 5UuMS bridge and 3LWzk multisig: current binary and signer boundary

Read-only Solana mainnet investigation on 15 October 2026. No transaction was submitted. The `simulateTransaction` calls used `sigVerify:false`, with zero placeholder signatures, solely to evaluate current program behavior. Thus the exploit conclusion is conditional on possession of **one** of the three historical authorized signer private keys; it is not a permissionless public drain.

## Bound executable and custody state

- Bridge program `5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9`: current executable at confirmed slot 457347256; ProgramData `58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY`, last deployment slot 320435332; ELF SHA-256 `80175fa9eb46209c394a9cae5f2e0c12de33100ab58d0d0b8d4d5c902650784f` (`5uums-current.so`). Upgrade authority `5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi`.
- Wrapper program `3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu`: current executable at confirmed slot 457347764; ProgramData `CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1`, last deployment slot 275216054; ELF SHA-256 `bbd7437755b21f6be894b036405469ef0d36b9c2966e9cb3bb07b172253d868c` (`5uums-wrapper.so`). Its upgrade authority is the same `5okKWzQ6...`.
- `5okKWzQ6...` is an **off-curve system-owned PDA**, exactly `findProgramAddress(["multisig"], 3LWzkFMDY...)` with bump 254. It is not a transaction signer in successful exits; the wrapper makes it a CPI signer via `invoke_signed`. Its current balance was 24,811,787,527 lamports at slot 457348676.
- Bridge state `Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK` is exactly `findProgramAddress(["bridge"], 5UuMS...)`, bump 252. Its 73 bytes at slot 457347660 decode as Anchor `BridgeInfo` discriminator `edfd43f1a23ee9ad`, stored bridge signer `5okKWzQ6...`, all-zero second pubkey, stored bump 252. The standard Anchor IDL account `9Z5Ns7aD3cGtxPRYEqXHamd1AQgiX8DQX5mcu2ScUo9a` was absent.
- Existing census confirms matching MIM, DOG, and PUPS vault token authority `Cst5bqk7...`. These are a gross price-times-balance mark, not liquid value. The earlier snapshot marked DOG at roughly $91.3 million with only about $12,293 quoted liquidity.

The bridge ELF exposes Anchor dispatchers `InitBridge`, `TransferBridgeNow`, `TransferBridge`, `AcceptBridge`, `Init`, `SetMintAuthority`, `Mint`, `Burn`, `Lock`, and `Unlock`. No published on-chain IDL was available. The observed `Unlock` discriminator is `659b28159ebd38cb`; its body is a little-endian `u64` amount. The wrapper ELF strings contain the three fixed authorized pubkeys below and the `deadlockmultisig` label. The exact authorization behavior is established by the current-state simulations below, rather than by a source-code reconstruction.

## Successful signer-controlled exits

Confirmed exit transaction `2HMjoo5om3t8ho8Ac3jT6DHwL5oFxwdaQGj5RCHBJARb41KPo6eh1YhGDgnaSRF9dkTuiA4whFkDoAgvG5pkzmZR` at slot 456397609 has wrapper `3LWzk...` at stack 1, bridge `Unlock` at stack 2, and Token `transfer` at stack 3. MIM vault `7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w` sent 1,501,075,607 raw MIM to `4rfDdc8xLDWBiqRKpVQS689ivWAqe6ae9ckfc9c8HNDi` under the bridge PDA `Cst5bqk7...`; a second fee leg sent 7,543,093 raw MIM. The CPI account order is `[5ok signer, bridge state, mint, vault, recipient ATA, recipient owner, System, Token, Associated Token]`. DOG and PUPS have the same direct bridge Token CPI control pattern in confirmed exit signatures `5oj19hPgME9PR1dbHtUrbiaG4hY5TjcZCa7ubYwZfYvqjWpsTg6WT7P1FfRmmmQUEC5oyi7dZ6g4qTfeQxUnAeC3` and `26hNmbXEiBoLdYBorWLMjb8NELX5hEQsXJthvXwbowDSfxvDLdpuyJuSfjgsmC4K6cDhqKzw1WJQ3AwKPkU2uaaQ`. These exits postdate the current bridge and wrapper deployment slots.

In the MIM transaction, the top-level true signers are the three hard-coded wrapper keys: A `FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N`, B `5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp`, and C `12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn`. PDA `5okKWzQ6...` is false as a top-level signer.

## Distinct signer bypass in current wrapper

The wrapper's wire layout observed in confirmed exits is `target_program: Pubkey` (32 bytes), `instruction_data_length: u32 LE`, then the inner instruction bytes; the target program and inner accounts are supplied after three signer slots. With distinct slot pubkeys A/B/C, any two signer flags succeed (A+B, A+C, B+C) and one signer flag fails `InvalidArgument`. An unknown signer substituted for B also fails. However, placing the same authorized key in two slots makes one transaction signature satisfy both slots:

| Current-state simulation | Compiled required signers | Result |
|---|---|---|
| `[A,B,C]`, only A signed | A | `InvalidArgument` before bridge CPI |
| `[A,A,C]`, only A signed | A, once; first wrapper account indices both `0` | **Success**, bridge `Unlock` and Token CPI |
| `[A,B,A]`, only A signed | A, once | **Success** |
| `[B,B,C]`, only B signed | B, once | **Success** |
| `[A,A,A]`, only A signed | A, once | **Success** |

For the `[A,A,C]` variant, the historical MIM leg's simulation moved 1,501,075,607 raw MIM out of the vault. A separate mutation changed the recipient to A's associated MIM token account `AzEMgXX9pA4GajiaKP5LpGA29uF1gK6yYEDa3fEYsRuL` and the amount to the vault's full observed 2,032,443,364,232 raw MIM; simulation succeeded with vault post-balance zero. One raw unit to the same recipient also succeeded. All are simulated post-states; on-chain MIM balance was unchanged across the probes. The same one-signature alias can be made with B as payer/signing key.

This establishes a one-key bypass of the intended two-key threshold. It does **not** establish that an outsider lacking A/B/C can act: A, B, and C are public keys controlled by unknown real parties. A confirmed historical transaction proves each has signed before, and Solana requires only one signature for a unique account key; repeated account metas refer to the same signed key.

## Generic CPI and program upgrade boundary

The wrapper is not restricted to `Unlock` or to the bridge program. With the same `[A,A,C]` one-signature alias, a read-only simulation changed the inner target to System Program and invoked `transfer(1 lamport)` from PDA `5okKWzQ6...` to A. It succeeded with System Program at stack 2 and a one-lamport lower simulated PDA balance. An independent simulation successfully transferred the PDA's full 24,811,787,527 lamports, while a one-lamport-over-balance control failed. The distinct-slot only-A control failed `InvalidArgument`. On-chain PDA balance was unchanged pre/post.

The same wrapper path can invoke the upgradeable loader with bincode `SetAuthority` variant `04000000`. For **each** of bridge ProgramData `58cPag...` and wrapper ProgramData `CyXQ9...`, `[A,A,C]` with only A as required signer succeeded at current state. The loader ran at stack 2, and each simulated ProgramData post-state changed `upgradeAuthority` from `5okKWzQ6...` to A. Distinct-slot only-A controls failed before loader CPI; A+B controls succeeded. A `[B,B,C]` variant with only B required also succeeded, setting authority to A. Both real ProgramData accounts retained `5okKWzQ6...` across the read-only probes. This directly demonstrates unilateral upgrade-authority takeover by one existing signer, without first preparing an upgrade buffer. A subsequent arbitrary upgrade was not executed or simulated here.

## Evidence files

- `5uums-fetch-current.js`, `5uums-current-binary.json`, `5uums-current.so`: exact current bridge bytes and loader metadata.
- `5uums-fetch-wrapper.js`, `5uums-wrapper.json`, `5uums-wrapper.so`: exact current wrapper bytes and loader metadata.
- `5uums-fetch-idl.js`, `5uums-idl-status.json`: standard Anchor IDL address probe.
- `5uums-state.js`, `5uums-state.json`: current BridgeInfo and PDA derivations.
- `5uums-history.js`, `5uums-history.json`: confirmed recent program/authority/vault transaction traces; `5uums-history-summary.json` is a compact summary.
- `5uums-wrapper-gates.js`, `5uums-wrapper-gates.json`: signer threshold, alias, self-recipient, and full MIM amount simulations.
- `5uums-wrapper-generic-cpi.js`, `5uums-wrapper-generic-cpi.json`: benign non-bridge generic CPI proof.
- `5uums-wrapper-generic-probe.js`, `5uums-wrapper-generic-probe.json`: independent one-lamport, full-balance, over-balance, and expanded-meta generic CPI checks.
- `5uums-wrapper-upgrade-boundary.js`, `5uums-wrapper-upgrade-boundary.json`: current loader `SetAuthority` CPI and post-state authority proof.
- `5uums-paged-history.json`: bounded 10,000-signature historical sample; it found active lock and burn calls but does not establish the semantics of the bridge's seldom-used signer-rotation dispatchers.

No liquid USD loss figure follows from these permissioning proofs. The prior ~$103.3 million gross custody mark must not be treated as executable cash value, especially given DOG's shallow quoted liquidity; realized value requires independent quote/depth or redemption analysis.
