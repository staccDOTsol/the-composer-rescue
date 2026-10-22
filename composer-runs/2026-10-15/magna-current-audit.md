# Magna Airlock V2 current-binary audit

Date: 2026-10-15  
Target: `magnaSHyv8zzKJJmr8NSz5JXmtdGDTTFPEADmvNAwbj`  
State / token authority: `2RH6rUTPBJ9rUDPpuV9b8z1YL56k1tYU6Uk5ZoaEFFSK`  
TRUMP vault: `HkykUVWTctptXZmRTWearMsH4SaQNmE4Ku3tMJe5v2mH`

## Result

**No reportable lower-privilege vulnerability was validated. Severity: IGNORE.** The measured unauthorized outflow and attacker net gain are both **0**.

The current executable still accepts the supplied historical claim proof, but every successful transfer went only to the proof-bound beneficiary token account. Proof, allocation-state, Merkle-instance, destination, vault-alias, and admin mutations did not redirect value. Amount and repetition tests advanced the allocation's on-chain claimed counter and stopped at the currently vested total. A real same-mint, exact-zero-fee KLend flash borrow could be placed before, around, or after the claim, but it was repaid in full and did not alter the only value movement: the authorized payment to the beneficiary.

This is a targeted current-binary attack-path assessment, not a proof that the closed-source program has no bugs. Confidence is high for the exercised claim, amount/repetition, destination, admin, and exact same-mint composition paths; confidence in the entire program is moderate because the deployed Solana source was not available, state is dynamic, and the program remains upgradeable.

## Scope and target identity

Magna's own deployment page identifies this address as its Solana Airlock V2 deployment: [Magna Contract Deployments](https://docs.magna.so/admins/privacy-and-security/magna-contract-deployments).

The executable was pinned again immediately before the final simulations:

| Property | Observed value |
|---|---|
| Program observation slot | `457351347` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Program executable | `true` |
| ProgramData | `FcD2fLEvoCrKk6XYKkWueKFvFbpsFTUzyrBfze3Fx7FW` |
| Last deployment slot | `393518261` |
| Upgrade authority | `Byszjb2ZNy8oPYDxRP47RFDEURGUin4c97NCttn5ANZ3` |
| ELF length | `447,896` bytes |
| ELF SHA-256 | `8abdb7f74b0831b2f691580b733288ad7096c0e5c9dac823a8461c1b433c16e4` |

The ProgramData ELF hash independently matched a `solana program dump` made during the review. No byte-identical public source build was established. Binary strings identify an Anchor/Rust `programs/airlock` implementation and instruction modules including `withdraw`, `defund`, `add_root`, `cancel`, `revoke`, `revoke_all`, and `transfer_beneficiary`; conclusions below therefore rely on current bytecode behavior and live account state, not source-equivalence assumptions.

The target state was observed at slot `457351348`, was owned by the target program, was 6,593 bytes, and had SHA-256 `3a299f29af9964ae90e10956cf37d226d07c2f952b7f10150579fad11cfbd729`. Independent decoding and derivation established:

- Allocation group ID `accdf9def2bf4e8683f5123bceb2c6f1`.
- Exact PDA: `findProgramAddress(["merkle_instance", TRUMP mint, ID], Magna)`, bump `255`.
- Stored mint `6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN` and stored vault `Hkyk...`; both match the live accounts.
- The vault is the exact associated token account for the off-curve state and the TRUMP mint. Its SPL authority is the state PDA.
- One current Merkle root and one admin, `5e2qRc1DNEXmyxP8qwPwJhRWjef7usLyi7v5xjqLr5G7`.

At the final observation the vault held `718132063712366` raw units, or **718,132,063.712366 TRUMP**. This is gross custody, not demonstrated loss.

## Method

All activity was read-only:

- RPC account reads and historical transaction reads;
- local parsing, PDA/ATA derivation, and current ProgramData hashing;
- `simulateTransaction` with `sigVerify:false` and `replaceRecentBlockhash:true`;
- no transaction signing, submission, live state mutation, or contact with users/admins.

The final simulation range was slots `457351572` through `457351588`. Every generated message records exact Solana v1 wire bytes in base64, SHA-256, byte length, account and instruction counts, compute units, full logs, and watched pre/post account images in `magna-current-probe.json`.

`sigVerify:false` does not create evidence that an attacker can forge a signature. It lets the runtime exercise account privilege and program checks. Public-claim tests need only an arbitrary funded relayer; admin-positive cases are branch/layout controls because the real configured admin is off-curve and cannot be a top-level transaction signer. The lower-privilege admin negatives used a distinct on-curve signer and reached the program's explicit membership check.

## Positive control and claim boundary

The historical successful transaction [`4PsZspi...9TtDoH`](https://explorer.solana.com/tx/4PsZspiPdUWY5Lf2Himv6PWJMDCmahghaviXHWMYfmwCnLd5fLyU6vQ1h5SjXBmbfpnp9MWXqoWHMJe6JQ9TtDoH), slot `448858522`, directly invoked `Withdraw` and transferred `8,730,816` TRUMP from the target vault to `PBNRanKsUPjUqUxNRM7YnNqZ7jdW3NYSCwBMtDugap6`. The latter is owned by beneficiary `2JEPvvG1kACwDJgacgEABnY3uiL7RLRncPW3APjNPNme`.

Replaying that exact 346-byte Magna instruction against the current deployment succeeded in simulation:

| Message | Bytes | Accounts | CU | Vault delta | Beneficiary delta |
|---|---:|---:|---:|---:|---:|
| Exact positive control | 728 | 8 | 24,569 | `-8730816000000` | `+8730816000000` |

The allocation-specific 127-byte distribution-state account changed while the Merkle-instance state did not. Its little-endian claimed counter at offset 77 moved from `30999588000000` to `39730404000000`, exactly the transfer delta. This is the anti-overclaim state boundary.

That permissionless trigger is consistent with Magna's documented behavior: a trigger transaction may be signed by any wallet, but tokens go to the allocation wallet. See [How to trigger a claim for a stakeholder](https://docs.magna.so/admins/product-guides/admin-post-fund-allocation-actions/how-to-trigger-a-claim-for-a-stakeholder) and [How to claim your tokens](https://docs.magna.so/admins/product-guides/admin-post-fund-allocation-actions/how-to-claim-your-tokens).

## Adversarial claim mutations

| Mutation | Current result | Security consequence |
|---|---|---|
| Bit-flipped Merkle proof | `ProofVerificationFailed` / 6000 | No movement |
| Bit-flipped allocation ID | Anchor constraint / 2006 | No movement |
| Different valid Magna state | Anchor constraint / 2006 | No movement |
| Different distribution-state account | Anchor constraint / 2006 | No movement |
| Attacker-owned TRUMP destination | `NotSender` / 6001 | No movement |
| Destination aliases source vault | `NotSender` / 6001 | No movement |
| Zero requested amount | Success, zero token delta | Harmless no-op |
| Maximum `u64` requested amount | Success, clipped to current entitlement | Only beneficiary paid |

The attacker-owned alternate destination was the live TRUMP token account `7DaumTmUaK3xcpd8XJXAjUzDrCqPuj3S1Sc2cbootBUN`, authority `9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`. It is not a dummy or wrong-mint account. Rejection therefore demonstrates beneficiary binding rather than incidental token-account failure.

The `u64::MAX` case transferred `64116850356164` raw units—**64,116,850.356164 TRUMP**—and advanced the claimed counter from `30,999,588` to `95,116,438.356164` TRUMP. A second ordinary claim in the same message then transferred zero. This observed behavior is a cap, not a raw unchecked amount.

Repeated calls behaved the same way:

- Two ordinary claims transferred twice the requested `8,730,816` TRUMP while remaining below the current vested cap and updating the claimed counter twice.
- Ten repeated claims fit in a real 3,950-byte v1 message, used 245,729 CU, and transferred only the same capped `64,116,850.356164` TRUMP in aggregate—not the nominal `87,308,160` TRUMP requested.
- Eleven repeated claims required 4,308 bytes, proving the first local composition blocker is the specified 4,096-byte v1 limit.

This repetition is not a replay drain: the allocation-state counter advances after every successful instruction, and all value remains bound to the beneficiary. Magna's product documentation also explicitly describes a trigger action that can force delivery of currently unlocked tokens to the stakeholder.

## Admin and release controls

The current configured admin is off-curve. An admin-flagged `AddRoot` control succeeded and an admin-flagged one-raw-unit `Defund` control transferred exactly one raw TRUMP unit to the admin's TRUMP token account. These writes existed only inside simulation and rolled back.

Lower-privilege and destination mutations failed:

| Path | Result |
|---|---|
| `AddRoot` with on-curve outsider signer | `NotAdmin` / 6013 |
| `Defund` with on-curve outsider signer and outsider token account | `NotAdmin` / 6013 |
| `Defund` with configured admin but attacker-owned destination | Anchor token-owner constraint / 2015 |

The successful controls establish that the synthesized instruction layouts reached live program logic; the paired failures show the checked boundaries. A historical successful `AddRoot`/`Fund` operation was also observed through a Squads `VaultTransactionExecute` at slot `456895280`, consistent with an off-curve administrative signer being supplied through authenticated CPI rather than a forgeable top-level signature.

Magna documents cancellable, revocable, and immutable allocations and says changing an active recipient requires cancellation and re-initiation: [How To Fund Allocations](https://docs.magna.so/admins/product-guides/how-to-fund-allocations). The exercised destination and admin checks match that intended separation.

## Exact same-mint flash-loan composition

The live KLend TRUMP reserve was decoded at slot `457351348`:

| Field | Value |
|---|---|
| Reserve | `GA6bM6mampbrYcsnjkUHUjEMJ2kKQJW3LowZWBKY6gf3` |
| Market | `ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5` |
| Supply vault | `D9NFkCuNsj8VbnSPMpiYxnmkSjBC8sz8gFmkv3jf6n2` |
| Fee vault | `8J8QhEKXYbCK7t4tfYH38AfG6Y9mjsUE6cncPHt9GMLE` |
| Available | `67108317` raw = **67.108317 TRUMP** |
| Flash-fee scaled fraction | `0` (exact-zero-rate) |

This is not an assumption that KLend reserves generally charge zero fees; it is the decoded current configuration of this specific TRUMP reserve.

Boundary pairs at 1 raw unit, `available - 1`, and exact available all succeeded. For each, the borrower account, reserve supply vault, and fee vault had net delta zero. `available + 1` failed with `InsufficientLiquidity` / 6008. Repeated flash borrows in one transaction failed with `MultipleFlashBorrows` / 6035, and a mismatched repay index failed with `InvalidFlashRepay` / 6033.

Real atomic order variants all fit well below v1 limits:

| Composition | Bytes | Accounts | CU | Net result |
|---|---:|---:|---:|---|
| Borrow → claim → repay | 1,145 | 17 | 79,858 | KLend net zero; `8,730,816` TRUMP to beneficiary |
| Claim → borrow → repay | 1,145 | 17 | 78,673 | Same |
| Borrow → repay → claim | 1,145 | 17 | 79,860 | Same |

The flash borrow and repay used the beneficiary-owned token account so the exact same mint could co-mingle with the claim output. Full repayment left that account with only the authorized claim delta. In the adversarial variant, both flash authority and destination were changed to the live attacker-owned TRUMP account; Magna rejected the claim with `NotSender`, and Solana atomic rollback left no token delta. A borrow with two claims and a full repay also succeeded, but again only the beneficiary received its authorized claimed amount and KLend's supply/fee balances returned exactly to their pre-state.

No obligation or debt-share account is part of KLend's atomic flash pair. No borrowed amount survived repayment, no fee-rounding residue appeared, and no attacker-controlled destination received Magna funds. Accordingly, this is not a flash-loan drain.

## Economic exposure

The vault's gross balance was about **$1.341 billion** at the contemporaneous saved Jupiter spot mark of `$1.8671385514` per TRUMP. That is not realistic extractable value. The same saved token snapshot reported only about **$26.29 million** of Jupiter liquidity, roughly 2% of the gross mark, and large point quotes showed sharply increasing price impact. The exact same-mint KLend reserve added only 67.108317 TRUMP—roughly $125 at that mark—so it does not materially change liquidation capacity.

These figures bound exposure; they do not convert an authorized beneficiary payment into a loss. Across all lower-privilege paths tested:

- unauthorized vault outflow: **0 TRUMP**;
- unauthorized attacker receipt: **0 TRUMP**;
- post-repayment flash-loan gain: **0 TRUMP / $0**;
- reportable loss: **$0**.

## Candidate disposition

| Candidate path | Preconditions / attacker control | Counterevidence | Disposition |
|---|---|---|---|
| Reuse a valid claim proof | Public relayer and historical proof | Destination is proof-bound; claimed counter advances; vested cap enforced | IGNORE |
| Inflate requested amount | Public amount input | `u64::MAX` clipped exactly to current unclaimed vested total | IGNORE |
| Repeat in one v1 message | Public instruction composition | Ten calls cap at entitlement; eleventh exceeds 4,096 bytes | IGNORE |
| Redirect to attacker ATA | Attacker owns valid same-mint ATA | `NotSender`, atomic rollback | IGNORE |
| Swap state/distribution state | Attacker supplies accounts | PDA/Anchor constraints fail before transfer | IGNORE |
| Invoke admin release path | Attacker supplies real signer | Explicit `NotAdmin`; destination owner also bound | IGNORE |
| Same-mint zero-fee flash composition | Public KLend reserve, atomic v1 | Exact repayment, zero residue, no destination bypass | IGNORE |

## Residual risk and blind spots

- The program is upgradeable. This assessment applies only to ELF SHA-256 `8abdb7...c16e4`; any later ProgramData change invalidates it.
- No byte-identical Solana source build or published IDL was established. Binary strings, historical transactions, account layouts, and live behavior supported reconstruction, but this is not a full source audit or formal verification.
- Coverage was deep for the selected TRUMP Merkle instance and its live allocation proof. It was not an exhaustive enumeration of every Magna instance, root transition, cancellation/revocation configuration, fee configuration, or Token-2022 edge case.
- `sigVerify:false` simulations faithfully exercised runtime account privileges and program logic but cannot prove possession or forgery of off-curve administrative authority. This limitation weakens only the admin-positive control, not the outsider failures or public claim tests.
- Prices, liquidity, vesting time, roots, claimed amounts, and reserve availability are live state and can change after the cited slots.

## Reproduction artifacts

- `magna-current-probe.js` — read-only account decoder and Solana v1 simulation harness.
- `magna-current-probe.json` — full executable/state identity, exact message bytes and hashes, full logs, CU, and pre/post account evidence for every case.
- `klend-zero-fee-census.json` — current reserve census that identified the exact-zero-rate TRUMP reserve.
- `long-tail-current-check.json` — saved custody, price, liquidity, and ProgramData snapshot.
- `long-tail-attribution-token-signers.json` — historical successful vault transfer attribution.

