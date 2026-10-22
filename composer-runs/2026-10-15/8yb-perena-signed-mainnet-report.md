# 8ybMhmt Perena withdrawal: signed mainnet-beta outsider test

At current account slot **457400159**, the live `8ybMhmtJb1VS6cqV4bPapvEUCRg3EGGrjpNhkLBPezA7` vault `BjKKdPEyPNJ9bx7RWVtCJYG3e13jjzT6kLaLgRg9mESq` held **342,316.246992** Perena `star9ag...` external receipt units. This is controller custody, not an independently available withdrawal. I reconstructed a successful historical `PerenaWithdraw` at slot 457355907, kept its 86-byte payload and 31-account list, and replaced only the user signer and the two user ATAs with the runtime signer from `/Users/stacc/hooked.json` and its derived ATAs. No transaction was broadcast.

## Account constraints checked

- The historical discriminator matches the published on-chain IDL, the `vault` PDA derives from its `vault_id`, and all four historical signer/vault ATAs derive from the listed mint, owner and token program. The only required user signer in the exit is the historical user, replaced with the runtime signer.
- Current vault state stores the exact USDC output mint, Token-2022 internal LP mint `8ARQDiMfCHsPZDpVNjoJPmRom8Mp2peE8k1dZntSZ7RP`, and Perena external mint `star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM`. The internal LP mint authority is the vault PDA. The historical user's LP ATA is owned by that user and currently has zero balance. The runtime signer's LP ATA did not exist at the read slot.
- The published IDL describes a 56-byte argument payload, while both sampled successful historical withdrawals have 86 bytes. I preserved all original payload bytes because the extra 30 bytes are not decoded or assumed safe to alter.

## Signed simulations

Both calls were **mainnet-beta `simulateTransaction` with `sigVerify:true`** and a fresh blockhash. The first direct exit failed at `signer_internal_ata` with Anchor `AccountNotInitialized` (3012). In the second 1,130-byte packet, an idempotent Token-2022 ATA creation succeeded, then `PerenaWithdraw` reached a successful Perena `ExecuteWithdrawFromExternal` CPI. Its subsequent Token-2022 `BurnChecked` failed **`insufficient funds`** (`InstructionError[1, Custom:1]`), so the atomic packet did not complete and no withdrawal was realized. This demonstrates the tested outsider cannot redeem this vault's underlying without the receipt balance; it does **not** establish that every 8ybMhmt adapter or all possible instructions are safe.

Evidence: [on-chain IDL](8yb-onchain-idl.json), [IDL metadata](8yb-onchain-idl-metadata.json), [direct signed simulation](8yb-perena-outsider-signed-mainnet.json), [signed ATA plus exit simulation](8yb-perena-outsider-signed-mainnet-with-ata.json). Reproduction scripts: [IDL fetch](8yb-fetch-idl.js) and [Perena exit](8yb-perena-outsider-sim.js).

## Funded deposit and complete receipt redemption

The runtime signer had **zero USDC** and no internal LP ATA in the current read. A receipt requires a legitimate deposit: a successful same-vault historical deposit spent 356.014127 USDC and minted 322.713595 internal LP units to its signer. I then built a real, signed **mainnet-beta** version 1 packet using the same live deposit and withdrawal account layouts: create the runtime signer's Token-2022 LP ATA, borrow **1,000 USDC** from zero-fee KLend USDC reserve `AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z`, deposit all 1,000 USDC, redeem every newly minted LP unit, and repay the flash loan. It fit at **1,537 bytes, 36 addresses, five instructions**, with `sigVerify:true`; the runtime key was used only to sign the simulation.

At simulation slot **457401420**, the deposit minted exactly **906.459267** internal LP units to the runtime signer. The withdrawal burned all **906.459267** units and returned **999.499999 USDC**. The last KLend repayment failed at the SPL transfer because the signer was **0.500001 USDC short** of the 1,000 USDC principal. The loan's fee rate was zero. The earlier 900 LP burn returned 992.377740 USDC and left 6.459267 LP, so partial redemption did not cure the shortfall. These are observed CPI transfer and mint/burn amounts, not a quoted price.

| Account or supply | Before packet (raw units) | After successful deposit and withdrawal, before failed repay | Committed result |
|---|---:|---:|---|
| Signer USDC | 0 | 999,499,999 | unchanged; packet reverted |
| Signer internal LP | ATA absent | 0 after mint and full burn | ATA creation reverted |
| Route vault USDC | 0 | 0 | unchanged |
| Route vault external `star9ag` LP | 342,316,246,992 | 342,316,246,992 | unchanged |
| Internal LP mint supply | 342,165,292,697 | 342,165,292,697 | unchanged |
| Perena yielding USDC vault | 213,677,442,065 | 213,677,942,066 | unchanged; 500,001 raw unit intermediate gain reverted |
| KLend USDC supply vault | 8,214,445,013,524 | 8,213,445,013,524 after borrow; repay transfer failed | unchanged |
| KLend fee vault | 0 | 0 | unchanged |

The economic bound for this tested size and state is **−0.500001 USDC before transaction costs** when redeeming all newly minted receipts. The wallet would need at least that much independent USDC to finish this exact flash packet; adding it would turn the round trip into a loss. The simulation failure rolls back every intermediate change. This does not rule out a different size, adapter, or changing price state.

A larger signed mainnet-beta size check used a **1,000,000 USDC** zero-fee KLend flash in the same 1,537-byte / 36-address packet. The deposit minted **906,459.267419** internal LP units; redeeming all of them returned **999,500 USDC**. KLend repayment was **500 USDC short**, so the entire simulation reverted. The observed shortfall was about 0.05% at both tested deposit sizes; this does not prove behavior at every size or market state. Evidence: [million-USDC full redemption](8yb-perena-flash-sim-1000000000000-906459267419.json).

Follow-up evidence: [historical deposit/exit deltas](8yb-perena-historical-flows.json), [funded partial redemption](8yb-perena-flash-sim-1000000000-900000000.json), [funded full redemption](8yb-perena-flash-sim-1000000000-906459267.json), and [reproduction script](8yb-perena-flash-roundtrip.js).
