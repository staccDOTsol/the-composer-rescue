# @jup-ag/lend

TypeScript SDK for [Jupiter Lend](https://jup.ag/lend) on Solana: Earn (fTokens), Borrow vaults (including DEX-backed smart vaults), DEX swaps, flashloans and refinance.

The SDK builds instructions. It reads the chain to derive every account and to size each operation with the same integer math the programs use, and it returns an ordered instruction list plus the address lookup tables the transaction needs. It never signs or sends: your wallet or backend does that.

## Installation

```sh
npm install @jup-ag/lend
```

Peer libraries used in the examples: `@solana/web3.js` and `bn.js`.

## Entry points

| Import                   | Contents                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `@jup-ag/lend/earn`      | `getDepositIxs`, `getWithdrawIxs`, `getMintIxs`, `getRedeemIxs`, lending resolvers               |
| `@jup-ag/lend/borrow`    | `getOperateIx`, `getLiquidateIx` (T1 vaults); `getOperateDexIx`, `t2`, `t3`, `t4` (smart vaults) |
| `@jup-ag/lend/dex`       | `getSwapInIx`, `getSwapOutIx`, DEX math                                                          |
| `@jup-ag/lend/flashloan` | `getFlashloanIx`, `getFlashBorrowIx`, `getFlashPaybackIx`                                        |
| `@jup-ag/lend/refinance` | `getRefinanceIx`                                                                                 |
| `@jup-ag/lend/api`       | `Client`, an HTTP client for the Jupiter Lend API                                                |
| `@jup-ag/lend`           | PDAs and the package `version`                                                                   |

## Sending what the SDK returns

Every builder returns `ixs`, a complete ordered list of instructions for one transaction. Vault, smart-vault and DEX builders also return `addressLookupTableAccounts`. Add a compute-unit limit, compile a v0 message and sign it:

```ts
import {
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const { blockhash } = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: signer,
  recentBlockhash: blockhash,
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...ixs,
  ],
}).compileToV0Message(addressLookupTableAccounts);

const transaction = new VersionedTransaction(message);
// Sign with your wallet, then send.
```

Builders do not add compute-budget instructions. Smart-vault operations export `DEX_OPERATE_COMPUTE_UNITS` (1,400,000) as the recommended limit.

## Earn

```ts
import { getDepositIxs, getWithdrawIxs } from "@jup-ag/lend/earn";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const signer = new PublicKey("<wallet>");
const usdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Deposit 1 USDC (6 decimals). `includeATASetup` creates the fToken account if missing.
const { ixs: depositIxs } = await getDepositIxs({
  amount: new BN(1_000_000),
  asset: usdc,
  signer,
  connection,
  includeATASetup: true,
});

// Withdraw 0.01 USDC.
const { ixs: withdrawIxs } = await getWithdrawIxs({
  amount: new BN(10_000),
  asset: usdc,
  signer,
  connection,
});
```

## Borrow (T1 vaults)

`colAmount` and `debtAmount` are signed raw token amounts: `colAmount > 0` deposits, `< 0` withdraws; `debtAmount > 0` borrows, `< 0` pays back. `positionId: 0` opens a new position (a position NFT is minted in the same transaction).

```ts
import { getOperateIx } from "@jup-ag/lend/borrow";

// Open a position on vault 1: deposit 0.1 SOL and borrow 5 USDC.
const { ixs, addressLookupTableAccounts, nftId } = await getOperateIx({
  vaultId: 1,
  positionId: 0,
  colAmount: new BN(100_000_000),
  debtAmount: new BN(5_000_000),
  signer,
  connection,
  includeATASetup: true,
  includeWrapSol: true, // wraps the SOL collateral from the wallet
});

// Repay the whole debt of an existing position. Pass your estimate of the
// debt as a negative amount: with mode "max" the program settles the exact
// debt, and the estimate (plus a 0.01 SOL buffer for SOL debt) only sizes the
// wrap. Anything unspent is returned.
const repay = await getOperateIx({
  vaultId: 1,
  positionId: nftId,
  colAmount: new BN(0),
  debtAmount: new BN(-5_000_000),
  debtAmountMode: "max",
  signer,
  connection,
});
```

Use `colAmountMode: "max"` with a negative `colAmount` to withdraw all collateral.

## Smart vaults (T2, T3, T4)

Smart vaults back one or both legs with a DEX position. T2 has smart collateral and normal debt, T3 has normal collateral and smart debt, and T4 has both. The low-level builders take positive amounts and an explicit `action`:

```ts
import { getOperateDexIx } from "@jup-ag/lend/borrow";

// Pay back 0.165 SOL of normal debt on vault 92 (a T2 vault).
const { ixs, addressLookupTableAccounts } = await getOperateDexIx({
  vaultId: 92,
  positionId: 1,
  signer,
  connection,
  includeWrapSol: true,
  debt: { action: "payback", input: { amount: new BN(165_032_899) } },
});
```

The per-type builders `t2`, `t3` and `t4` (`operateDexIx`, `operatePerfectDexIx`) take signed token amounts and size the share bounds from pool state. Smart-vault builders create missing token accounts by default (`includeATASetup` defaults to `true`).

## DEX swaps

```ts
import { getSwapInIx } from "@jup-ag/lend/dex";

const { ixs, addressLookupTableAccounts } = await getSwapInIx({
  dexId: 1,
  swap0to1: true,
  amountIn: new BN(1_000_000),
  amountOutMin: new BN(0), // set a real minimum from your quote
  signer,
  connection,
  includeATASetup: true,
});
```

`getSwapOutIx` takes `amountOut` and `amountInMax` instead.

## Flashloan

```ts
import { getFlashloanIx } from "@jup-ag/lend/flashloan";

const { setupIxs, borrowIx, paybackIx, cleanupIxs, feeAmount } =
  await getFlashloanIx({
    amount: new BN(1_000_000),
    asset: usdc,
    signer,
    connection,
  });

// The payback pulls `amount + feeAmount`; your instructions must leave that much in the account.

const flashloanIxs = [
  ...setupIxs,
  borrowIx,
  // ...your instructions that use the borrowed funds
  paybackIx,
  ...cleanupIxs,
];
```

## Refinance

`getRefinanceIx` takes the same parameters as `getOperateIx` and returns the refinance-program `operateIx` with the pieces that go around it:

```ts
import { getRefinanceIx } from "@jup-ag/lend/refinance";

const refinance = await getRefinanceIx({
  vaultId: 1,
  positionId: 0,
  colAmount: new BN(100_000_000),
  debtAmount: new BN(5_000_000),
  signer,
  connection,
});

const refinanceIxs = [
  ...refinance.otherIxs,
  refinance.operateIx,
  ...refinance.cleanupIxs,
];
```

## Native SOL

Pass `includeWrapSol: true` to let the SDK handle wrapped SOL (WSOL) for any leg whose mint is SOL:

- **Paying SOL in** (supply, payback, deposit, swap input): the SDK wraps what the program will pull. For bounded operations (`getSwapOutIx`, `getMintIxs`, `"max"` payback) it wraps the maximum and returns the unspent part. It creates the WSOL account at most once per transaction.
- **Receiving SOL** (withdraw, borrow, swap output): the SDK creates the WSOL account before the instruction and closes it afterwards, so you end with native SOL.
- **After every wrap**: the SDK closes the WSOL account after the instruction, which refunds its rent and any unspent amount.
- **Closing returns the account's entire WSOL balance**, including WSOL the wallet held before.
- **A third-party `recipient` keeps WSOL**, because only the owner can close the account.

## Markets

Every builder accepts `market: "main" | "ethena" | "galaxy"` (default `"main"`) to target an isolated deployment with its own program ids.

## Wallet requirements

Building does not require the wallet to hold SOL: the read-only simulations the SDK runs fall back to a funded placeholder fee payer. The transaction itself still needs a fee payer, and accounts the SDK creates (token accounts, the WSOL account) are paid for by the wallet.

## HTTP API client

```ts
import { Client } from "@jup-ag/lend/api";

const client = new Client(); // or new Client({ apiKey: "<api key>" })

const lendingTokens = await client.earn.getTokens();
const vaults = await client.borrow.getVaults();
```

Without an API key the client uses `https://lite-api.jup.ag/lend`; with one, `https://api.jup.ag/lend`.

## Development

```sh
pnpm install
pnpm test   # tsc --noEmit, then vitest with coverage
pnpm lint   # eslint and prettier
```

Some tests read Solana mainnet through the public RPC.

Specifications for every module, written for contributors and coding agents, are in [docs/SPECS.md](docs/SPECS.md).

## License

MIT
