# Perena Numéraire major-stable pool validation

Observed 2026-10-19 against Solana mainnet-beta. This was an authorized, non-broadcast validation. No exploit transaction was sent.

## Assessment

**Finding title:** Outsider-controlled account substitution might release value from the major-stable Perena pool

**Candidate ID:** `PERENA-2W4A-OUTSIDER-VALUE-RELEASE`

**Disposition:** Suppressed / not reportable on the tested current deployment

**Confidence:** High

**Method:** Exact ProgramData attestation, successful post-deploy receipt reconstruction, fresh-key `sigVerify:true` mainnet `simulateTransaction` positive control, account-role mutations, and sibling checks for `skim`, `remove_liquidity`, and `remove_all_liquidity`.

The current deployment does not expose an outsider-accessible free-value release through the tested swap, recipient, vault, pool, signer/source-authority, skim, or LP-removal paths. The legitimate outsider swap succeeds, but every attempted value-bearing account substitution is rejected before an unauthorized vault release. `skim` is owner-only. Liquidity removal requires LP tokens owned by the signer.

The focused follow-up nevertheless entered the economic composition stage to bound nonlinear stable-curve behavior independently of the account-substitution negatives. Signed v1 packets combined two providers (KLend + Project0) and three providers (KLend + Project0 + Save), the exact Perena pool, and an independent stable-pair venue. Seeded construction controls proved that both lender layouts, both swap directions, and all repayments fit and execute. The same routes with zero token seed failed at repayment because route proceeds were insufficient. At the forward high edge, the route lost `708303141` raw stable units before network fee with two providers and another `400000` raw USDC with Save. The disclosed construction seed is therefore counterevidence, not profit and not part of any finding.

## Validation rubric

- [x] Pin the executable to the exact current ProgramData bytes and deployment slot.
- [x] Reconstruct a successful post-deploy instruction and validate its current account/argument shape.
- [x] Run a fresh outsider-signed positive control with `sigVerify:true` and no broadcast.
- [x] Mutate recipient, vault, pool, signer/source-authority, skim, and LP-removal roles through the real program interface.
- [x] Compose signed two- and three-provider v1 flash packets through both stable-pair pricing vectors, with small controls and a forward near-vault-edge run.
- [x] Reconcile wallet stable deltas, target-protocol vault deltas, independent-venue conservation residuals, lender fees, and network-fee equivalents.
- [ ] Demonstrate a surviving unauthorized protocol outflow with positive final outsider equity and complete repayment. No such effect survived.

## Exact deployment and custody

At finalized slot `458760508`:

- Program: `NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P`
- ProgramData: `64h2hsxpnUprJu87bwH7HcYxoVtbidw95bZ7m5JTXGp`
- Last deployment slot: `329553166`
- Upgrade authority: `CPJo7euWKrEETLmGJsctRnrXxbikFsb6KLN59moNN88K`
- Current ELF length: `1,100,691` bytes
- Current ELF SHA-256: `f45357b0b8273edacf1ca3f497edf7c7a008fc3896de4f477d6a9bf9e31f5e04`
- Pool: `2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ`
- Pool/config owner: `CPJo7euWKrEETLmGJsctRnrXxbikFsb6KLN59moNN88K`
- LP mint decoded from the pool: `BenJy1n3WTx9mTjEvy63e8Q1j4RqUc6E4VBMz3ir4Wo6`
- USDC vault: `6B8k8At9879r5EsZAWg8W6DEpxzJ798Cwj48twu3pq4b`, `119749570190` raw USDC
- USDT vault: `DJfYbGicp4AFXWsragNWv1baugqcdFhw6eFTcK2YWdyK`, `113060453734` raw USDT

The current Composer IDL names the eleven-account instruction `swap_exact_in` and defines arguments `(in_index, out_index, exact_amount_in, min_amount_out)`. The current ELF independently contains the matching Anchor instruction names, account names, error strings, and source paths including `processors/swap_in.rs`, `processors/remove_liquidity.rs`, and `processors/skim.rs`. The live simulations then exercised that shape successfully, which is stronger correspondence evidence than the IDL alone.

## Legitimate receipt and positive control

The cited transaction `5W1xG3qU1GK7ddDkZeKX9xADsbgrSjNsmpycKPQAXKkRW6bsBcWhu2EJEpXv2xb7cPvvckz46cQkzt35173SraGE` landed at slot `458756684` and contains a Perena `swap_exact_in` invocation with:

- `in_index = 1`, `out_index = 0`
- `exact_amount_in = 13076042` raw USDT
- `min_amount_out = 0`
- USDT user source and USDC user destination
- the exact current USDT/USDC vaults
- pool signer authority exercised only inside the program's Token CPI

The fresh-key positive control at simulation context slot `458760744` used the opposite direction with `5000` raw USDC. It succeeded with `sigVerify:true`, two real signatures, a 795-byte v0 transaction, 17 account keys, and no broadcast. Versus a same-setup baseline:

| Account leg | Delta |
|---|---:|
| Fresh outsider USDC | `-5000` |
| Fresh outsider USDT | `+5003` |
| Pool USDC vault | `+5000` |
| Pool USDT vault | `-5003` |
| Funding wallet token accounts | `0` / `0` |

This is a normal funded swap: the output is paired with the signer's input. Simulation charges no network fee and persists no state.

## Mutation results

All mutations were independently signed by a fresh ephemeral outsider key whose secret was not persisted. All were sent only to `simulateTransaction` with `sigVerify:true` and `replaceRecentBlockhash:false`.

| Test | Result | Deployed control reached |
|---|---|---|
| Recipient role aliased to the input-mint account | Rejected, custom `2014` | `ConstraintTokenMint` |
| USDC/USDT vault roles swapped | Rejected, custom `2012` | `ConstraintAddress` on `in_vault` |
| Output vault replaced with outsider destination | Rejected, custom `2012` | `ConstraintAddress` on `out_vault` |
| Pool replaced with another current Perena-owned pool | Rejected, custom `2003` | `ConstraintRaw` on `out_mint` |
| Fresh outsider authority over the funding wallet's token source | Rejected, custom `2015` | `ConstraintTokenOwner` |
| Valid signer redirects its own purchased output to another valid account | Succeeds | Expected recipient flexibility; signer still funds the input |
| Fresh outsider calls `skim` | Rejected, custom `6000` | `OnlyOwner` at deployed `processors/skim.rs:18` |
| Fresh outsider removes one raw LP token with zero balance | Rejected, custom `6015` | `InsufficientBalance` at deployed `processors/remove_liquidity.rs:36` |
| Outsider substitutes a victim LP account for partial removal | Rejected, custom `2015` | `ConstraintTokenOwner` |
| Outsider substitutes a victim LP account for full removal | Rejected, custom `2015` | `ConstraintTokenOwner` |

The largest test envelope was 952 bytes with 20 account keys, below both the requested 4 KB and 64-key ceilings.

## Multi-provider flash and pricing extremes

All economic packets were version-1 wire messages, independently signed with ephemeral keys, submitted only to `simulateTransaction` with `sigVerify:true`, and never persisted as signed wire bytes. Provider principals exactly summed to the Perena-route input. KLend and Project0 charged zero stable-token fee in these observed templates; Save charged `ceil(principal * 4 / 10000)`, or `400000` raw USDC on its fixed `1000000000`-raw leg.

The forward vector was `USDC flash -> exact Perena USDC/USDT -> independent USDT/USDC exit -> repayments`. The quote service accepted `$113000` as the highest tested whole-$1000 input and returned `HTTP 400 No routes found` at `$114000`. The `$113000` quote produced `112400766912` raw USDT from Perena, exited `112389526835` raw USDT for `112280456782` raw USDC, retained `11240077` raw USDT, and still lost `708303141` raw stable units before lender or network fees.

| Forward control | Providers | Seed disclosed | Packet | All repayments | Wallet stable delta | Perena vault-sum delta | Independent-venue residual | Lender fee | Wallet delta after network fee |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|
| `$2000` small | KLend + Project0 | `1000000000` USDC + `1000000` USDT | 1780 bytes / 39 keys | Yes | `-299512` | `-1595451` | `+1894963` | `0` | `-300569` |
| `$2000` small | KLend + Project0 + Save | same | 2015 bytes / 45 keys | Yes | `-699512` | `-1595451` | `+1894963` | `+400000` to Save | `-700569` |
| `$113000` upper edge | KLend + Project0 | `2000000000` USDC + `1000000` USDT | 1679 bytes / 36 keys | Yes | `-708303141` | `+599233088` | `+109070053` | `0` | `-708304197` |
| `$113000` upper edge | KLend + Project0 + Save | same | 1914 bytes / 42 keys | Yes | `-708703141` | `+599233088` | `+109070053` | `+400000` to Save | `-708704197` |

The independent-venue column is the exact conservation residual after the observed wallet, Perena, and lender-fee deltas; each stable-token row sums to zero. The network-fee equivalent is separately quoted from the observed two-signature `10000`-lamport debit (`1056` or `1057` raw USDC depending on the adjacent quote slot).

The construction seeds are deliberately larger than the measured losses so the entire packet can reach every repayment. They are not counted as acquired value. With both token accounts initialized to zero, the same `$2000` and `$113000` forward packets executed both swaps, repaid KLend, and then failed at Project0 repayment in the two-provider case or Save repayment in the three-provider case with Token Program `insufficient funds` (`Custom:1`). Solana atomic rollback left all stable-token deltas at zero; only the simulated transaction fee remained. Thus the zero-seed economic attempts do not fully repay and cannot be findings.

The reverse vector was `independent USDC/USDT entry -> exact Perena USDT/USDC -> USDC repayments`. Its `$2000` Deriverse/Perena construction controls also completed all repayments but lost `484552` raw stable units with two providers and `884552` with Save; after the network-fee equivalent the losses were `485608` and `885608`. The zero-seed versions again rolled back at lender repayment. Read-only best-route quotes accepted a whole-$1000 boundary of `$87000` (quoted loss `464812978` raw stable units) and rejected `$88000` at the Perena leg. The best-depth upper-band entry venue did not reproduce as a current executable fork route, while the independently executable Deriverse route had prohibitive depth at that size. This is an explicit upper-band execution blocker, not a substituted or simulated profit claim.

Across the successful packets, the largest observed envelope was 2015 bytes with 45 addresses; the forward upper-edge three-provider packet was 1914 bytes with 42 addresses. Both remain below the requested 4096-byte and 64-address limits.

## Source, control, sink, and boundary

- **Attacker source:** signer-controlled instruction arguments and account metas for recipient, token source, vaults, pool, and LP account.
- **Controls:** Anchor token-mint, token-owner, fixed-address, raw pool/mint binding, owner-only skim, and LP balance checks in the deployed binary.
- **Sink:** PDA-signed Token Program transfers out of the pool's stable vaults.
- **Boundary:** permissionless Solana transaction submission by an unprivileged outsider.
- **Counterevidence:** every tested mismatch failed at a concrete deployed guard before an unauthorized Token CPI; the only successful recipient redirection remained paired with the signer's own funded input.

## Remaining uncertainty

This is a targeted validation of the current major-stable pool's externally reachable swap, pricing, and liquidity-release surfaces, not a proof that every instruction or every future upgrade is vulnerability-free. The forward economic boundary is a whole-$1000 quote boundary rather than an integer-raw binary search. The reverse high-edge signed execution remains limited by the independent venue mismatch described above, although the small signed control and high-edge read-only quotes were both negative. The program remains upgradeable. A new deployment changes the ELF hash and invalidates this conclusion. No authoritative public source tree was required for the conclusion; current ProgramData, the live Composer IDL/transaction reconstruction, embedded binary metadata, and successful signed simulations were sufficient for the tested paths.

## Reproduction artifacts

- `perena-current-attestation.js` / `perena-current-attestation.json`: exact deployment, current custody, IDL/Composer reconstruction, and cited receipt
- `perena-current-mainnet.so`: exact extracted current ELF
- `perena-signed-mainnet-mutations.js` / `perena-signed-mainnet-mutations.json`: successful control and swap account-role mutations
- `perena-remove-receipt.js` / `perena-remove-receipt.json`: successful recent removal account order
- `perena-liquidity-sibling-mutations.js` / `perena-liquidity-sibling-mutations.json`: owner/LP sibling gates
- `perena-multiflash-extremes.js`: deterministic Perena adapter for the reviewed v1 multi-provider harness; supports forward and reverse vectors
- `perena-multiflash-small-control.json` / `perena-multiflash-small-zero-seed.json`: forward small controls and zero-seed attempts
- `perena-multiflash-upper-edge-control.json` / `perena-multiflash-upper-edge-zero-seed.json`: forward `$113000` construction control and zero-seed attempt
- `perena-multiflash-reverse-small-control.json` / `perena-multiflash-reverse-small-zero-seed.json`: reverse small controls and zero-seed attempts
- `perena-flash-pricing-boundary.json`: both-direction quote boundary and exact limitation ledger

Each harness verifies the mainnet-beta genesis hash, emits only public keys and hashes, and has no `sendTransaction` or broadcast path.
