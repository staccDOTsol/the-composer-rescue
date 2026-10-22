# @hadron-fi/sdk-v2

TypeScript client SDK for the v2 [Hadron](https://hadron.fi) AMM program on Solana.

> [!WARNING]
> **We strongly encourage you to use a Hadron SDK — this `@hadron-fi/sdk-v2`
> TypeScript package or the `hadron-sdk-v2` Rust crate — not the raw IDL — to
> interact with Hadron.**
> Hadron is a pinocchio (non-Anchor) program with a custom, **non-Borsh** instruction
> wire format (1-byte discriminators, length-prefix-free vecs with explicit count
> args, length-based optional trailing fields, and empty account discriminators).
> A generic Anchor/IDL/Borsh client will **mis-encode instructions** and can produce
> malformed transactions. The IDL is intended for **structural/read** use (explorers,
> account decoding, Surfpool); to **build and send** instructions, use a Hadron SDK
> (`build*` functions / the `Hadron` class in TypeScript, or the Rust crate).

## Install

```bash
npm install @hadron-fi/sdk-v2 @solana/web3.js @solana/spl-token
```

`@solana/web3.js` and `@solana/spl-token` are peer dependencies; install them alongside.

## Quickstart

```ts
import { Hadron, HADRON_PROGRAM_ID, Q32_ONE } from "@hadron-fi/sdk-v2";
import { PublicKey, Connection } from "@solana/web3.js";

const payer = new PublicKey("...");
const authority = new PublicKey("...");
const mintX = new PublicKey("...");
const mintY = new PublicKey("...");

const { instructions, poolAddress, seed } = Hadron.initialize(payer, {
  mintX,
  mintY,
  authority,
  initialMidpriceQ32: Q32_ONE * 100n,
});
// Sign and send `instructions` via your web3.js connection: the allocate
// ix(s) first in their own tx, then initialize + setPoolState together.
// New pools land in RejectSwaps (deposits work, swaps don't) until the
// authority flips them to Initialized — pass
// `initialPoolState: PoolState.Initialized` to skip that and go live at init.
```

The package exposes:

- `build*` instruction builders for every program ix
- `decode*` decoders for every on-chain state account
- PDA derivation helpers (`getConfigAddress`, `derivePoolAddresses`, ...)
- A `Hadron` convenience class for orchestrating common flows
- Fixed-point math helpers (`toQ32`, `fromQ32`, `spreadBpsToQ32`)

## Program ID

```
HADRoNbLovyqhCsocfYQYB7QdfCAAinN9HTePvBCVDQ8
```

Currently deployed on Solana devnet.

## License

Apache-2.0.
