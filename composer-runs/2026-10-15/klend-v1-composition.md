# Kamino flash loan → Meteora Dynamic Vault in a Solana v1 transaction

Observed 2026-10-15, mainnet simulation slots 457346354–457346359. **No validated unauthorized drain; demonstrated exploitable amount $0.** The harness makes read-only `simulateTransaction` RPC calls with `sigVerify: false` and never signs or submits a transaction. The owner signer in the positive controls is a simulation assumption, not an attacker-held key.

## Exact transaction format and positive control

[Solana's v1 format](https://solana.com/docs/core/transactions/versioned-transactions) is active on mainnet, permits 4,096 bytes, carries compute and loaded-account limits in its message config, and has no address lookup tables. The locally installed `@solana/web3.js` 1.99 compiler does not emit v1, so the harness uses its no-ALT v0 account ordering and encodes the documented v1 wire format directly. The mainnet RPC **accepted and executed** the message against the current deployed programs; this is stronger than a static size estimate.

- Kamino Lend: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`.
- Meteora Dynamic Vault: `24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi`.
- Flash reserve: `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, USDC supply `8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB`.
- Vault: `3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ`; vault token account `C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA`.
- The owner `B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1` held LP in `EB2N1HtcsFhx1MLs9VgiExoU2AsrMxPbZvCGD7s2yihQ` but its USDC token account `3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf` held zero before this simulation. A vault deposit without the flash borrow failed for insufficient funds.

The one-cycle sequence `flash borrow 100,000 raw USDC → vault deposit 100,000 raw USDC → vault withdraw 100,000 raw LP → flash repay 100,000 raw USDC` succeeded. The flash borrow/repay-only control also succeeded with zero net USDC changes. Omitting the vault withdrawal left the repay underfunded and rejected the whole transaction.

## v1-only repeated composition

The same transaction repeated `deposit → withdraw` using the holder's existing LP, then repaid the flash loan. The 10-cycle case executed all 22 instructions in one **1,391-byte v1 transaction**, with 16 inline addresses, 9 writable accounts, 1 required signer, 413,139 compute units, and 12,550,723 loaded-account data bytes. It used config mask `0x0c` with explicit 1,400,000 CU and 64 MiB data limits. The equivalent no-ALT v0 wire layout would be **1,359 bytes**, exceeding v0's 1,232-byte limit. The 9-cycle case also succeeded at 1,321 v1 bytes; its equivalent v0 layout is 1,291 bytes.

Ten cycles ended with 165,010 raw USDC in the user's token account and 141,650 fewer raw LP shares. Comparing the seven- and eight-cycle successful simulations **at the same bank slot** gives an exact incremental control: user USDC **+16,501**, user LP **−14,165**, vault USDC **−16,501**, LP mint supply **−14,165**, Kamino reserve supply **unchanged**, Kamino flash fee vault **unchanged at zero**. The same per-cycle deltas continued through the tenth cycle. The USDC output was therefore paired with a real share burn; flash liquidity was repaid. This is the holder redeeming their own vault equity, not an unbacked vault withdrawal or attacker profit.

The 11-cycle version was below 4,096 bytes (1,461 bytes) and below the 1.4M CU setting, but failed at instruction 21 with `MaxInstructionTraceLengthExceeded`. This CPI-heavy path hits the runtime trace limit before size or compute becomes the binding constraint. The transaction was rejected as a whole.

After eight valid cycles, an additional withdrawal with a different signer against the holder's LP account failed `InvalidLpOwner` (6022) at instruction 17. A wrong flash repayment instruction index failed `InvalidFlashRepay` (6033) at instruction 0. Failed simulations returned no post-account images, so the report does not infer committed deltas from them.

## Scope and reproduction

These tests cover one USDC flash reserve, one Dynamic Vault, one holder, specific deposit/withdraw amounts, same-transaction ordering, duplicate cycles, and two adversarial mutations. They do not prove all Kamino reserves or Meteora vaults safe. The positive controls require the legitimate LP owner's signature, which `sigVerify: false` models but does not provide. No unauthorized transferable amount was demonstrated.

Run `node composer-runs/2026-10-15/klend-v1-composition.js` from the workspace, with the existing local RPC env file. The script contains no RPC credential. Full case outcomes, slots, logs, sizes, resource measurements, and account images are in `klend-v1-composition.json`.
