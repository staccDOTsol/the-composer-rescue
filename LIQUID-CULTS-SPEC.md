# Liquid Cults

**Confidential, appreciating wrapped tokens on Solana mainnet-beta**

Draft spec, 2026-10-19. Author: stacc (@STACCoverflow). Target cluster: mainnet-beta.

---

## 0. Thesis

> "Stop chasing ghosts and build Liquid Cults. If communities are dead, create infrastructure where financial alignment *is* the community. Don't look for loyalty, code it into the yield loop."

A Liquid Cult is a wrapped token with two properties:

1. **Confidential.** Balances and transfer amounts are encrypted on-chain. Members can't see each other's stakes; outsiders can't see anyone's.
2. **Monotone.** The redemption rate (escrow per wrapped token) can only go up. Anything that flows into the pot accrues pro rata to whoever is still wrapped.

Holding is membership. Leaving is `Unwrap` at today's rate, forfeiting tomorrow's. No lockups, no vesting, no governance snapshots. The pot is public; the members are not.

Anything that grows over time can be the base asset: an LST, an LP token, a launchpad token with fee routing, a plain SPL mint that someone keeps tithing into.

---

## 1. Building blocks

All of the "live" claims below were verified directly against mainnet-beta on 2026-10-19, not taken from articles.

| Block | Role | State on mainnet-beta |
|---|---|---|
| Token-2022 `ConfidentialTransfer` extension | Encrypted balances and amounts (twisted ElGamal + Pedersen, sigma proofs + Bulletproofs range proofs) | Live. Token-2022 was redeployed at slot 427147035 (2026-06-17 20:57 UTC), which is when confidential transfers came back after the June 2025 disable. |
| ZK ElGamal Proof program `ZkE1Gama1Proof11111111111111111111111111111` | Verifies the proofs | Live. Enable gate SIMD-0153 active since epoch 731. Invoked hundreds of times a day. |
| `solana-program/token-wrap` | Wraps any SPL or Token-2022 mint into a Token-2022 mint. The default mint customizer adds `ConfidentialTransferMint` to every wrapped mint (merged 2025-07-30, PR 167). Audited by Zellic and Runtime Verification (x2). | Program exists, but the declared ID `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR` is **not deployed** on mainnet, devnet or testnet. We deploy our own instance. |
| PR 694 (`rs-economics` branch of `staccDOTsol/we-all-eat-wrap`) | Prices `Wrap`/`Unwrap` at escrow/supply instead of 1:1 | Open upstream. This is the fork we deploy. |
| Prover | Client-side proof generation must match the on-chain transcript | Requires `solana-zk-sdk >= 6` (spl-token-cli >= 5.6.1, `spl-token-confidential-transfer-proof-generation >= 0.6`). Proofs from zk-sdk 4 are rejected with `SigmaProof(PubkeyValidity, AlgebraicRelation)`. spl-token-cli 5.5.0, which ships with the Agave 3.1.10 installer, does not work. |

---

## 2. Mechanics

### 2.1 Mint creation

`CreateMint(unwrapped_mint, wrapped_token_program = Token-2022)`

- Wrapped mint address: PDA of `(unwrapped_mint, Token-2022, our program id)`. One wrapped mint per base asset, permissionless to create.
- Mint authority and escrow owner: PDA `wrapped_mint_authority(wrapped_mint)`.
- Decimals and freeze authority are copied from the unwrapped mint. (The base asset's freezer can therefore freeze wrapped accounts. Pick base assets accordingly.)
- Extensions initialized before the base mint, via `DefaultToken2022Customizer`:
  - `ConfidentialTransferMint { authority: None, auto_approve_new_accounts: true, auditor: None }`. Immutable: nobody can later turn privacy off or add an auditor.
  - `MetadataPointer` pointing at the mint itself; `TokenMetadata` is synced from the unwrapped mint (`SyncMetadataToToken2022`).
- The `compliance` customizer (PR 257) is the alternative if a cult wants a designated auditor key that can decrypt amounts. Fork-time decision, per deployment, not per mint.

### 2.2 Rate

Let `E` = escrow balance (raw units of the unwrapped mint), `S` = wrapped supply (raw units).

```
R        = E / S                       (R = 1 while the mint is empty)
Wrap(a)  : escrow += a ; mint floor(a * S / E) wrapped
Unwrap(w): burn w    ; pay  floor(w * E / S) unwrapped
```

- Rounding is always down, in favor of remaining holders, so `R` never decreases.
- An amount that rounds to zero is rejected.
- While `E == S` (every mint that has only ever been wrapped and unwrapped) this is exactly 1:1 before the dev fee, byte-identical to upstream behavior.
- Instruction names and instruction data are unchanged from upstream. Since the dev fee (2.2a) `Wrap` and `Unwrap` take one extra account, so the stock JS client and CLI must be updated (the fork's CLI is).

### 2.2a Dev fee: 0.1 bps

Every `Wrap` and `Unwrap` pays a dev fee of 0.1 basis point (1 / 100,000, i.e. 0.001%) of the unwrapped-side amount, rounded down, so anything under 100,000 raw units pays nothing.

```
Wrap(a)  : dev = floor(a / 100000); escrow += a - dev; dev_ata += dev
           mint floor((a - dev) * S / E) wrapped   (1:1 while the mint is empty)
Unwrap(w): payout = floor(w * E / S); dev = floor(payout / 100000)
           user receives payout - dev; dev_ata += dev; escrow -= payout
```

- Fee destination: the associated token account of the dev authority `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` (hooked.json) for the unwrapped mint, under the unwrapped mint's token program. One fee account per base asset, so fees accrue in wSOL, USDC, USDT and so on, never in the wrapped token.
- The fee account is account index 8 of both instructions; transfer authority moves to 9 and multisig signers to 10 and up. The program checks the address is exactly that ATA and the token program checks the mint, so a wrong account fails the instruction.
- The fork's CLI prepends an idempotent create-ATA instruction, so the fee account never has to be pre-created.
- With a Token-2022 base asset that has a transfer fee, both legs (escrow and dev) pay that mint's fee separately.
- `R` is unaffected: the escrow only ever receives `a - dev` and only ever pays out `payout`, so the escrow-per-wrapped-token invariant still never falls.

Routing the fee somewhere (buy-and-burn, locked liquidity) is not done on-chain by this program. The fee simply accrues in the dev ATAs; what happens to it is a separate transaction signed by the dev authority. An atomic CPI into a pump.fun AMM from inside `Wrap` is a different and much larger change (pool accounts, slippage, MEV exposure, audit scope) and is deliberately not part of this patch.

### 2.3 What makes R grow

| Source | Mechanism | Visible on-chain? |
|---|---|---|
| Tribute | Anyone sends unwrapped tokens straight to the escrow token account. No instruction, just a transfer. `E` rises. | Yes, amount and sender are public (it is an ordinary transfer on the unwrapped side). |
| Burn | Any holder burns wrapped tokens (Token-2022 `Burn`). `S` falls. | Yes, burn amount is public. |
| Fee routing | A launchpad, AMM, x402 gateway or any protocol the cult runs sends a cut of its revenue to the escrow. | Yes. |
| Appreciating base asset | If the base asset itself gains value per raw unit (LSTs, LP tokens), the wrapped token inherits it 1:1. Note: `R` is measured in raw units; an interest-bearing-extension mint whose UI amount grows does **not** move `R`. | n/a |

Flows into the pot are public. Who holds how much of the pot is not. That is the intended shape: the cult's books are auditable, its members are anonymous.

### 2.4 Confidential layer (per wrapped token account)

```
ConfigureAccount      ElGamal pubkey + AE key, PubkeyValidity proof (inline)
Deposit(a)            public balance -> pending balance (a is public here)
ApplyPendingBalance   pending -> available (client decrypts and re-encrypts)
Transfer(x)           3 proofs: ciphertext-commitment equality,
                      batched grouped-ciphertext (3 handles) validity,
                      batched range proof U128.
                      Delivered via proof context-state accounts
                      (about 0.0085 SOL locked, refunded when closed).
ApplyPendingBalance   on the recipient
Withdraw(x)           available -> public, equality + range proof U64 (optional)
```

Hidden: transfer amounts, available and pending balances.
Public: that a transfer happened, which accounts, the ciphertexts, `E`, `S`, and therefore `R`.
Optional: `auditor` ElGamal key (compliance customizer only) that can decrypt every amount.

Hard limits that shape product decisions:

- A single confidential transfer amount is at most `2^48 - 1` raw units (16-bit low + 32-bit high split). With 0 decimals that is 281 trillion; with 9 decimals it is 281,474 whole tokens per transfer.
- The pending balance accepts at most 65,536 credits (default) before the owner must `ApplyPendingBalance`.
- Anything that needs to *read* an amount cannot be a program: AMMs, lending, escrows all require `Withdraw` to public first. The DEX is the privacy boundary.
- Wallet support: no mainstream wallet generates these proofs, so secrets.fun ships its own browser prover, `secretsfun/zk-wasm` (wasm-bindgen over `solana-zk-sdk` 7.0.1 and `spl-token-confidential-transfer-proof-generation` 0.6.1). The page derives the ElGamal + AE keys from one wallet `signMessage` over `"solana-conf-bal/v1" || wallet_pubkey` (the zk-sdk 7 HKDF scheme), builds the PubkeyValidity proof, the AE ciphertexts and the pending-balance decryption in wasm, and Phantom / Solflare / Backpack only sign. Verified on mainnet 2026-10-19 (section 10). Other working clients: spl-token-cli 5.6.1+. The May 2026 `@staccoverflow/zk-proofs-wasm` 0.4.0 build (zk-sdk 4.0.0) is superseded and must not be used.

### 2.5 The loyalty loop

- Join: wrap base asset, `ConfigureAccount`, `Deposit`, `Apply`. Your stake is now invisible.
- Stay: every tribute, burn and fee flow raises `R` for you without any action.
- Tithe: send base asset to the escrow (public act of faith) or burn wrapped (public amount, anonymous-ish holder).
- Leave: `Withdraw` to public, `Unwrap` at `R_now`. You keep what you earned up to now; everything after goes to the ones who stayed.
- No multiplier, no points, no snapshot. The only number that matters is `R`, and it is public, so the cult can be judged by its pot and nothing else.

---

## 3. Messaging rail (optional module)

Lifted from Staccana `agent-messaging` / `agent-mail`: the hidden `u64` transfer amount is treated as a packet word. Text is alphabet-packed into packets, each packet is permuted into an amount, Token-2022 encrypts the amount, and only sender, recipient (and auditor, if any) can decrypt it back to text.

- Budget: 48 bits, so 6 bytes of payload per confidential transfer. A DM is a short burst of small transfers.
- Every message also moves value, so DMs are tribute by construction.
- Group chat stays public (memo instruction) to skip proof cost. DMs are confidential transfers of the cult token.
- Packets that encode to amount 0 are retried with a new nonce (amount 0 is rejected on-chain).

---

## 4. Deployment plan (mainnet-beta)

| Item | Value |
|---|---|
| Program ID | `BDFzgK2BjLoZbV6SEewxQyf9eaXyvqKo4JPMsSybsmMs` (keypair `~/.config/solana/we-all-eat-wrap-program.json`) |
| Source | `github.com/staccDOTsol/we-all-eat-wrap`, branch `rs-economics`, commit `350e8db` (PR 694 head) |
| Patch | `program/src/lib.rs` `declare_id!` set to the program ID above; nothing else changed |
| Build | `cargo build-sbf --manifest-path program/Cargo.toml` (platform-tools v1.52, Agave 3.1.10) |
| Deploy | **Done 2026-10-19.** `solana program deploy --program-id <keypair> --upgrade-authority ~/hooked.json --use-rpc --max-len 500000`. Binary 455,712 bytes; programdata 500,000 bytes holding 2.5409 SOL rent. Slot 458759166, signature `31KG5NEiJt7Rii25F9GKFAHLxrQsiwxvbCNq74V14wU8KAY7Yp1JSu3zsu6BjiBNeFXPoqJibtSXw7ghaiinBaoy`. |
| Upgrade authority | `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` (hooked.json) |
| Clients | `@solana-program/token-wrap` JS and the Rust CLI hardcode `TwRap…`; pass our program address explicitly, and derive PDAs with `get_wrapped_mint_address_for_program` / `get_wrapped_mint_authority_with_seed_for_program`. |
| Dev fee upgrade | Built and tested (branch `dev-fee-0.1bps`, commit `6354605` on top of `350e8db`; diff in `token-wrap-dev-fee.patch`). Binary 457,944 bytes written to upgrade buffer `Gw4eSiW9j8hynVtvkQDkZkBSCjvpuKLBepDceXcbvygt` (2.327 SOL, moves into programdata on upgrade). **Upgrade landed** at slot 458766053, signature `2reVQGougRkJZVWro2jHJwrFDXyYtTDwZThqoiwEQoGmY3aya8inbMFAaz1xXGyeNZ63V272NNyRShc9RHSBQsU9`; buffer consumed, programdata still 500,000 bytes. The live program now charges the 0.1 bps fee and expects the 10-account Wrap/Unwrap layout (section 2.2a). |

First cult, suggested order of operations:

1. `CreateMint` for the chosen base asset (Token-2022 wrapped side).
2. Seed the escrow with a tribute so the first wrapper does not capture a pre-existing pot (see risk 1).
3. Wrap, `ConfigureAccount`, `Deposit`, `ApplyPendingBalance`.
4. First confidential transfer between two members.
5. Publish `E`, `S`, `R` on a page; that page is the cult.

---

## 5. Proof of life (mainnet-beta, 2026-10-19)

Done today with spl-token-cli 5.6.1 against mainnet-beta, fee payer hooked.json:

| Thing | Address |
|---|---|
| Token-2022 mint, `ConfidentialTransfer` auto-approve, 0 decimals | `FqsRsiUMo6SsMbidtv1NwEKdHLiRpgBf9setZzc4jbRf` |
| Sender token account | `7Bdz5jrJQXxXX9y3ZNT2VV21qVzcuFeX3yMRLmiYUqPs` |
| Recipient token account (throwaway owner) | `6bqTdV1dYun1gJyZbMeFA73Mpk8U4nXqaegUjsjT4jer` |
| Hidden transfer amount | 26477, which is `gm` in ASCII |

Every step above landed on mainnet-beta. Signatures are in section 7.

---

## 6. Risks and open questions

1. **First-wrapper capture.** An empty wrapped mint mints 1:1, so if tribute lands in the escrow before the first `Wrap`, the first wrapper gets the whole pot. Seed the escrow and wrap in the same transaction, or accept it as the founder's cut.
2. **Unaudited delta.** The three audits cover 1:1 pricing. PR 694 is small (two arithmetic changes plus tests) but it is the part that moves money. Worth a focused review before real size lands.
3. **Freeze authority inheritance.** The base asset's freeze authority is copied to the wrapped mint. A frozen base asset means a frozen cult.
4. **Prover drift.** The on-chain transcript changed between zk-sdk 4 and 6 and silently broke every old client. Pin the prover version and watch Agave releases. Status 2026-10-19: the browser prover (`secretsfun/zk-wasm`, zk-sdk 7.0.1) verifies on mainnet; rebuild it (`wasm-pack build --target web`) whenever Agave bumps the ZK ElGamal program's zk-sdk major. Two residual risks: (a) key derivation is the zk-sdk 7 HKDF scheme (`solana-conf-bal/v1`), not the legacy SHA3 one spl-token-cli used, so an account configured by the CLI cannot be driven by the site and vice versa (the site refuses with "configured with a different ElGamal key"); (b) the derivation signature must be deterministic per wallet. Phantom, Solflare and Backpack sign ed25519 deterministically (RFC 8032); a wallet that randomises `signMessage` would derive a new key every session and lock the user out of their own ciphertext.
5. **No composability on confidential balances.** Anything that must read an amount (AMM, lending, escrow, bonding curve) needs a public balance. Decide where the privacy boundary sits for each product.
6. **Transfer hooks and transfer fees on the base asset.** token-wrap handles transfer-hook base mints in tests; verify per asset before `CreateMint`.
7. **Confidential burn is not enabled.** The default customizer does not add `ConfidentialMintBurn`, so burns are public amounts. Fine for tribute, not fine if burns must be private.
8. **Clients lie about the program ID.** Every off-the-shelf client assumes `TwRap…`. Until a fork of the JS client is published, PDAs derived by third-party tools will be wrong.

---

## 7. Appendix: today's on-chain runs

### 7.1 Confidential transfer, end to end (spl-token-cli 5.6.1, fee payer hooked.json)

| Step | Signature |
|---|---|
| Create sender token account | `9acBAhjpXxdLuUTfAb9w97HE1DnhsN5Uij7osJuVSdNo8UQudbhYj4xLwivojX8jeMqNswmz28SVEs5Pt773aKf` |
| Create recipient token account | `5nr27pyMEFXV7z65TAMCKtLPM5NDxduVX7eaKivmg3JgfWkihVXT3cSiyb87H8jnRPJof9bzPbswg5oVLQNVXZ8h` |
| Mint 100000 (public) to sender | `3g62j3gv37WTfGYRE2gJrwtHdqrUrTvXnKst1HMLWbc1dbkM4sGFnBvWk9if7XsJLgEJct1vXG67EfrxmRRLCWJs` |
| ConfigureAccount sender (PubkeyValidity proof) | `5AgDupfkjBCRVPx2pKf5xkKnB472g61oSMwZGv14Bhf6v26dcJbdoBooPCPCwY6q4QSDiBDu7isNyswieW4LwLK4` |
| ConfigureAccount recipient | `4Xa3U7hgcaouGVNdrHc5vAv4ftJQ37WBXjFiXVudcPM2aaRSfs8XzmL4vDfZVghjXpawKA9rbMxmLLG9uUqYbYtQ` |
| Deposit 100000 public to pending | `5vaMBEB432a7L9yWmTUF6ohvaxJ9WZ6Ujs9XiWvdbbPbMZp99AkrqTxYguTHQgvc9qE25Y4CGaHSug7iGZXnupKj` |
| ApplyPendingBalance sender | `mvE41KsqdA5ykEJLrt3agG8uT68GvVAqYk3FVsVWoR2LgPWmqdiwWnEvmwcULUNPXHyV5trgXoABRLCdvEAte4x` |
| **Confidential Transfer 26477** (equality + validity + range proofs via context accounts) | `3FJLPAMjN3BpuJ5zUVBotomiAviku7AQPXorGGHngiV933Ch5mEwHwdGEdPwB5AuMYjZ6qK7YSRFVz7hNVR1DUq4` |
| ApplyPendingBalance recipient | `4X8d38GkeWpjJscYQCztUQYfE4BHpVc918xhzF9vf9shVRWRVpHPie9fAZieDt3C2Gb1sJSDcqgPnGUk4dRuorvx` |
| Withdraw 26477 to public on recipient | `4iW5s4rgSaSr8dpWxutPKRQkCYDah6E5rfK9ZuDYRqnoJrTBHCBQSevVjiPHB5ncpfzYzRKgSkP97syfWurAmhuN` |

Result: recipient public balance 26477, sender public balance 0, sender confidential available balance 73523 (hidden on-chain).

What failed first: the same `ConfigureAccount` with spl-token-cli 5.5.0 (zk-sdk 4) was rejected at preflight with `proof verification failed: SigmaProof(PubkeyValidity, AlgebraicRelation)`. One confidential transfer attempt with 5.6.1 timed out at confirmation and left three proof-context accounts behind (closed afterwards with `CloseContextState`, rent refunded).

### 7.2 Program deploy

| Item | Value |
|---|---|
| Program | `BDFzgK2BjLoZbV6SEewxQyf9eaXyvqKo4JPMsSybsmMs` |
| Upgrade authority | `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` (hooked.json) |
| Source | `staccDOTsol/we-all-eat-wrap` @ `350e8db` (branch `rs-economics`, PR 694), `declare_id!` patched |
| Binary / max_len | 455,712 bytes / 500,000 bytes (room for ~10% growth; `solana program extend` for more) |
| Slot / signature | 458759166 / `31KG5NEiJt7Rii25F9GKFAHLxrQsiwxvbCNq74V14wU8KAY7Yp1JSu3zsu6BjiBNeFXPoqJibtSXw7ghaiinBaoy` |
| Wallet | 6.2727 SOL before, 3.7224 SOL after deploy (2.5409 SOL rent + fees) |
| Dev fee upgrade | Slot 458766053, `2reVQGougRkJZVWro2jHJwrFDXyYtTDwZThqoiwEQoGmY3aya8inbMFAaz1xXGyeNZ63V272NNyRShc9RHSBQsU9`; binary 457,944 bytes from branch `dev-fee-0.1bps` (commit 6354605). Net cost: fees only, the buffer rent came back to the wallet. |

Not yet done on the deployed program: `CreateMint` for a first base asset, a `Wrap`, and a confidential transfer of the wrapped token. The deployed binary is untested on mainnet beyond the deploy itself.

---

## 8. First cults on mainnet-beta (2026-10-19)

Run against the deployed fork `BDFzgK2BjLoZbV6SEewxQyf9eaXyvqKo4JPMsSybsmMs` (not redeployed, not upgraded). Fee payer and signer for everything: `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` (hooked.json), through the user's Helius RPC. The user picked wSOL, USDC and USDT as the first base assets; the Token-2022 test mint `FqsR…` was not wrapped (1250 public units were minted to `7Bdz…` before that decision, signature `29PxrJFHjxxRKBhEpmRMJCjGSQf3yoeMYiuikU44ZinAwFAZgu7vm9qTQALKpvMxTs1oJuX7VdBqGP2jPzD8F1WW`, and are unused).

Tooling:

- `CreateMint`, `Wrap`, `Unwrap` and the rate reads: a 260-line TypeScript client (`liquid-cults.ts`, scratch) on `@solana/kit` 8.5.0 and the published `@solana-program/token-wrap` 2.8.0. Every generated instruction builder and PDA helper is called with `{ programAddress: BDFzgK2B… }`, the JS equivalent of the Rust `*_for_program` helpers. The Rust CLI in `clients/cli` has no program-id flag (it calls `spl_token_wrap::id()` everywhere), which is why it was not used. The wrapped-mint PDA was cross-checked with `solana find-program-derived-address BDFzgK2B… string:mint pubkey:<mint> pubkey:TokenzQd…`.
- Confidential layer: spl-token-cli 5.6.1 (zk-sdk 6 prover), the same build as section 7.
- Every transaction was simulated first; all 27 landed, none failed on-chain.

### 8.1 Wrapped mints created

All three wrapped mints are Token-2022, 303 bytes, with exactly the extensions the `DefaultToken2022Customizer` initializes: `ConfidentialTransferMint { authority: None, auto_approve_new_accounts: true, auditor: None }` (immutable, confirmed by `spl-token display`: "authority disabled / approve policy: auto / audits are disabled") and `MetadataPointer { authority: wrapped mint authority, metadata_address: the mint itself }`. `TokenMetadata` was not synced (no `SyncMetadataToToken2022` was run). Decimals and freeze authority are copied from the base mint, so wrapped USDC and USDT can be frozen by Circle and Tether respectively (risk 3).

| | wSOL | USDC | USDT |
|---|---|---|---|
| Base mint | `So11111111111111111111111111111111111111112` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| Base token program | SPL Token | SPL Token | SPL Token |
| **Wrapped mint** | `DkkjdsGrzFGvyhjwk7cCtWJ4UMPdtWxLQaBf2krL9oAD` | `DyZQhaYGLK7LQRM34rqGdWDWGWEbUgyfWhV3kAtTzjva` | `5f6R23cqLNqTE3wQFfEvfVVSADWLW8LhqccU4HHtQGp6` |
| Wrapped mint authority (PDA) | `DigKAoxezqFt4667xYHGpJYxD2CM5DoGvVD1NZwdPGTd` | `3EJcqaFZCd9F6QGvMbyaXWpY15rXGMp7PKEdLJLJgPm1` | `2PSwsHAiCMgr2MAhEBrZnPnx9hKQxQYvMRsjqk6ytakQ` |
| Backpointer (PDA) | `AThDAXwZzYgbRSNCtweAnYmUZAdKi4hUxd5NvdtKfzKa` | `B5nBANamSa6SyJg5Y7xpks54pUwwxFAGDSzkXHAYAWL6` | `2K7b7vKTTMS5NMe9d5HdArJKSqsDkZBKWUhQNYJzoLht` |
| **Escrow** (ATA of the authority, SPL Token) | `H1doCCYjjZonSjHefWzkZdiE77jh1AZN6CMNNi4A2Rcv` | `EaxjKCVSPBSTgvoKND4H12cxyCV5tP3zknW5N8gHQFsY` | `3VLxRy1Y7nFtkvZ3aeCgwp1q6TFa4hjeqgHXq658vRv8` |
| Decimals | 9 | 6 | 6 |
| Freeze authority (inherited) | none | `7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar` | `Q6XprfkF8RQQKoQVG33xT88H7wi8Uk1B1CC7YAs69Gi` |
| `CreateMint` + escrow ATA (one tx) | `3dscKVau2TGhnc5j5jRyaYkH8W5jikTeFB9e9Cr7JKo2frTaoqFmDQiWF3ASUWbhdvD4BzHkamYpDxJodJ6d7kZm` | `4WWRb9Wvvxa5n7jpT5XCcbzsivUpRRtitBZScqZimJfb2dRTm31r2dStoRAHJJBSaoKtJDLiLmz3VoG2cPeCyZP1` | `619yYpTjkkXmQWyhM9ojJeEj4WUZeUV16myrkvkfmsweJRUYyaVk9oaXXdNWBpdDfGB5XXQkLhb3Mj7XkkVy8X34` |
| Slot | 458762968 | 458763135 | 458763148 |
| Cost (mint 2,189,480 + backpointer 812,800 + escrow 1,488,440 + fee 5,000) | 4,495,720 lamports | 4,495,720 lamports | 4,495,720 lamports |

Each `CreateMint` tx is: two `SystemProgram::Transfer` to pre-fund the mint and backpointer PDAs, `CreateMint { idempotent: false }`, then `CreateAssociatedTokenIdempotent` for the escrow. 46,057 CU for the Token-2022 base-mint simulation, 40,607 CU for the SPL Token ones.

### 8.2 Wraps (R = 1, byte-identical to upstream behavior while E == S)

| Asset | Source account (hooked) | Amount (raw) | Wrapped token account (hooked ATA, Token-2022) | Signature | Slot |
|---|---|---|---|---|---|
| SOL to wSOL (`spl-token wrap 0.02`) | `DrfWXM7aEjsYNBCYHWRv57aor2etiuum97HedhcPmPdu` created, 0.01851156 wSOL after rent | 20,000,000 lamports in | | `4vPpQdc9aETwUXAsuRqGF9jmH9JTG4vb8k8wWhRRcuuqyHEnbUyWez5oehNDkUXo2NtAgoiASUBpJRi2sRe1kJNE` | 458763162 |
| wSOL `Wrap` | `DrfWXM7…` | 10,000,000 (0.01) | `8TqrZM2GfJ4txQVSvP2RmRMYNw9v7UBuZwnRWMFxUKcj` | `2wTvbrpsrYRM4cpWvceQod89wcxLXNbiz6GjZYqH1nA7EGdaB85ggi2rtAkBx5c9TBiG71TsD1ZQwmS6iRM4e6Qi` | 458763421 |
| USDC `Wrap` | `BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ` | 2,000,000 (2.00) | `4VPb96GywS1WnFZ4YYTQfgoc3MeQbQcVznFnmkoE4Aoz` | `3vBEWKzEzVJh1cJhDzA5kq9etA389MLd6qiYqqQ3qnumHGjzG9EzC7iChviNRFtW5yFVD5AbmRv3RuiwL7upsgFe` | 458763434 |
| USDT `Wrap` | `8b9z6sBryaZBSiSV8zrXkKoWdvhYMcksaZemjTXdkaz3` | 2,000,000 (2.00) | `576wsPPVZtJy236u5gKi1C5XYLPbNHYrbhmpmwiaBKpN` | `AZrdz9cV8RREsJ9WfdCp1Y3Y1pf9KaG9z5Pfga3SCsWXQhRm7UsNXS87Hiak2T3fBAyEW2wXDiAPtunZjSDdfF8` | 458763448 |

After each `Wrap` the client read `E == S` (10,000,000 for wSOL, 2,000,000 for USDC and USDT), i.e. R = 1. USDC and USDT stop here: wrapped, public balance, rate 1. Each `Wrap` tx (ATA create + `Wrap`) cost 1,513,840 lamports of rent plus the 5,000 fee.

### 8.3 Confidential layer on wrapped wSOL

Sender: hooked's wrapped-wSOL ATA `8TqrZM…`. Recipient: `BwRkbNj8GHm1XihTJtgfUyk6VkoPkRvvgTiQRSxgg2Mf`, ATA of a throwaway owner `7iBLGyXuaVpg4Bnpgfwy3DEH5SXDPQ92UGKAuf5amNwB` (keypair in scratch, not funded; hooked paid every fee).

| Step | Signature | Slot |
|---|---|---|
| Reallocate sender for `ConfidentialTransferAccount` (CLI-internal) | `2AoeDZTJE5mcDNV2wARUZueZufnMb6yJ2Y8EBq7t1rfs9pkNn6dLTyibpsC2sWrkLPPuV2Fe2E12UwPzWGFdUVxj` | 458763601 |
| `ConfigureAccount` sender (PubkeyValidity proof, inline) | `ra1X9TxHRhqd4w4DzN6t9HhzRJnie8oF3xh5LJUHTd9zM9HNSuaZAz9LCM5cGUwLk6kefhQgne9WQdfeFGsmfZB` | 458763605 |
| `Deposit` 0.006 (6,000,000) public to pending | `4E5ecbvZ1X1eBes3bh74ftbXwZnsYvaeU1bUEKdsmiSK6aqV4Cg3FBWm4yp6NCir4DSEqJkaBT35hLTWWAGooG4C` | 458763610 |
| `ApplyPendingBalance` sender | `54mZzUkgLpPAnjwa8ws7zjF8i4XHt3NQrZNukHU9qXS1wy2hhgwBbG36geARuAYwSwnzxRcVh8CGBJsu1my3GKcY` | 458763615 |
| Create recipient account `BwRkbN…` | `v9RZDwmcJsLMrYQ5HtrVjogV6RYs6hBNtofAW8tsjYJ1GRWSFS17aL1x5i75r4io9t9ZL3XDjnX5uRsTBTcjFaQ` | 458763627 |
| Reallocate recipient (CLI-internal, owner + payer signed) | `YwK3v1tnj2VgBgfo2qfLxdsVShkssbMbC5s2YM9n5E5rsQD6KxTuLrCKHVtkxiuYJjW6fF5TPoUNTLsW1ayp255` | 458763632 |
| `ConfigureAccount` recipient | `MWs4Fa1UzWyuQ61WG1kbFVcfHPneAn7B65jS2GYoUXJqrWteZB5miLNtrDtv8yrAM32oxZ5JP7E3wgHLFxVVFRd` | 458763635 |
| Proof context accounts: create range-proof account | `ud7mJ7KoUk6LVMB54RFZ1XhNgiTfsLB39v7H2T4axNy4dcvN8CchHo169jB9Et3jGCpqmzLaEYeRKpnyD27Ud4N` | 458763726 |
| Create + verify equality proof | `4eMhEgCag5iwYhteDGwoLUquGUHyZ7ZKwottornF3iyT9NeCwbo7UviSDEGRYBdD94jR3LGRqUhKHgPaqH1WcdMn` | 458763726 |
| Create + verify ciphertext validity proof | `52KWpxctih44RwSP2Y81tUdjxa1AYbLs7y4msoL2DYJPMMa5eXB9zgHyVfbnkNN4nhD8hNB3NY1kGVDwGEgLz1XA` | 458763726 |
| Verify range proof (U128) | `2bZkGBTu28gNKyeyFrQisht9iqahsym1ZkU9U3ymh8yGVhKBr92LG8qVuGLA2HNjoU1dm8zUwy2eofAVsJHgKyxy` | 458763729 |
| **Confidential `Transfer` 0.001 (1,000,000) sender to recipient** | `k3Aei1gVAtumckamRbknjT5sfM3WBoi1PCG29dX1tDvZZuxGgR1zCfhZrkMPHZCcWHikZb6YFCXdsFwgPvcEqgU` | 458763733 |
| `CloseContextState` x3 | `B4nGvAemskZ2Sa1SSihqfXZUdRu2dFFmQvNx1KJSyUk4j8Df4Ezc7Yhe2HiDbwEpyghwFj4JsknARjvyTzsc2vh`, `2TR5yfAZWLyXYwEvnFoQy97MqRjE4NouT7QLzRDEFwrVYHXv4nvs8tRJoiR6JMzofpMDSNGmYqQ8wMDzBP8AzuBW`, `2Ngdgvc4814DPhXb9XbJWH7dmCWbZ9zNVFLMtdDwEqLBhHu8kH8Ywqj8nFpRoEeidM3Zn2HL8q3gv9B7V7WqgFs9` | 458763736 |
| `ApplyPendingBalance` recipient | `2sWEHTbYTof2U591vy3fjGvXQf6U8jfBUup4upY68sgKEjdoRRJxNnCwWa7wEvJZnd3Qmjdh2ireaxvCpw1mEUVQ` | 458763741 |
| `WithdrawExcessLamports` sender account to wallet (see 8.5) | `3kvzs1rikUQR6QQEh4n9TzstoGb2KZFiPh9WKrQenpJ1KFH61aqfbUg4JjBFopEPM2PGEQLWsUWwcR9u7ocfiHtF` | after 458764145 |

State after: sender `8TqrZM…` public 0.004 (then unwrapped, see 8.4), confidential available 0.005; recipient `BwRkbN…` public 0, confidential available 0.001, pending credit counter applied. The 1,000,000 amount appears nowhere on-chain in the clear. No proof-context accounts were left behind (`getProgramAccounts` on `ZkE1Gama1…` filtered by authority = hooked returns nothing).

### 8.4 Rate: tribute and Unwrap above 1:1

| Event | Signature | E (escrow, lamports of wSOL) | S (wrapped supply) | R = E/S |
|---|---|---|---|---|
| After `Wrap` 0.01 | | 10,000,000 | 10,000,000 | **1.00** |
| Tribute: plain SPL transfer of 0.0025 wSOL from `DrfWXM7…` straight to escrow `H1doCC…` | `5B44cgybUg6TvtwK28aRAw4t1yTfAhk596YZ9pUWXQKTS2peK61VVx2L58UKuiMdjrpJUcKLwQg6bdnE95xtoriW` (slot 458763938) | 12,500,000 | 10,000,000 | **1.25** |
| `Unwrap` 4,000,000 wrapped from `8TqrZM…` to `DrfWXM7…` | `2H5kWd87PzAqXZcdcLQ854H85ne3q2tjhj1xN4Rugzp4kEPnDNPe8QyZMGffijrtWr8Nxrf58Sx4h5SxBNAjUATn` (slot 458764145) | 7,500,000 | 6,000,000 | **1.25** |

`Unwrap` burned 4,000,000 wrapped and paid 5,000,000 wSOL (`DrfWXM7…` went from 0.00601156 to 0.01101156): an effective 1.25, above 1:1, exactly `floor(4,000,000 * 12,500,000 / 10,000,000)`. R did not move on the unwrap because the division was exact. The remaining 6,000,000 wrapped (hooked 5,000,000 and the recipient 1,000,000, both confidential) are backed by 7,500,000 in the escrow.

### 8.5 SOL accounting (exact, from wallet balance deltas and `getTransaction` fees)

| | Lamports | SOL |
|---|---|---|
| Wallet before the run (slot 458762386) | 3,052,222,069 | 3.052222069 |
| Wallet after the run | 3,009,491,709 | 3.009491709 |
| **Net out of the wallet** | **42,730,360** | **0.04273036** |
| of which transaction fees, 27 txs (21 x 5,000 + 6 two-signer x 10,000) | 165,000 | 0.000165 |
| of which rent now locked in 14 new accounts (3 wrapped mints 6,568,440; 3 backpointers 2,438,400; 3 escrows 4,465,320; hooked wSOL ATA 1,488,440; hooked wrapped ATAs 3,032,760 + 1,513,840 + 1,513,840; recipient account 3,032,760) | 24,053,800 | 0.0240538 |
| of which SOL that became wSOL and is still wSOL (11,011,560 in `DrfWXM7…`, 7,500,000 in the escrow backing the 6,000,000 wrapped) | 18,511,560 | 0.01851156 |

Sum of the three parts is 42,730,360, matching the wallet delta to the lamport. The cap was 0.1 SOL; gross outflow was 0.0427 SOL, of which only fees and rent (0.0242 SOL) are not recoverable by unwrapping and closing accounts. Rent on mainnet today is 5,080 lamports per (byte + 128): a 165-byte token account is 1,488,440 lamports, not the 2,039,280 of the old 6,960 x 2 schedule.

One thing to know about the 5.6.1 CLI: after the confidential transfer it closed the three proof-context accounts with the *sender token account* as lamport destination, so 6,233,160 lamports sat in `8TqrZM…` above its rent and the wallet looked that much poorer. `spl-token withdraw-excess-lamports 8TqrZM… <wallet> --program-2022` returned them (the flag is required; without it the CLI assumes SPL Token and preflight fails with `IncorrectProgramId`). `spl-token create-account <mint> --owner <pubkey>` likewise needs an explicit `--fee-payer`.

What section 7 called "not yet done" is done: the deployed program has created three wrapped mints for real base assets, wrapped all three, moved one wrapped balance confidentially, and paid out above 1:1 after a tribute.

**Note added after the run:** the program was upgraded at slot 458766053 (signature `2reVQGougRkJZVWro2jHJwrFDXyYtTDwZThqoiwEQoGmY3aya8inbMFAaz1xXGyeNZ63V272NNyRShc9RHSBQsU9`) to add a 0.1 bps dev fee. Every transaction in this section ran on the pre-upgrade binary with the upstream 9-account `Wrap`/`Unwrap` layout. On the live program, `Wrap` and `Unwrap` take the dev-fee token account at index 8 (hooked's ATA for the unwrapped mint under the unwrapped token program) and the transfer authority at index 9; the scratch TypeScript client used here has not been updated for that. The three wrapped mints, their escrows, the confidential balances and the tribute path are unaffected.

### 8.6 Dev fee live (after the upgrade at slot 458766053)

First `Wrap` through the fork's own CLI (which now targets `BDFzgK2B…` and the 10-account layout), 1,000,000 lamports of wSOL from `DrfWXM7…`, signature `3neCVTWVDkuzF433MDmTgzmV5vQDY6SuRzrsEayy7RqeQjeffCKYmZLPznW7BTLmqwWKxUKJEeoiVSMtzXBPaciG`, slot 458766605.

| | Before | After | Delta | Expected |
|---|---|---|---|---|
| Escrow `H1doCC…` | 7,500,000 | 8,499,990 | +999,990 | amount minus 0.1 bps = 1,000,000 - 10 |
| Wrapped supply | 6,000,000 | 6,799,992 | +799,992 | floor(999,990 x 6,000,000 / 7,500,000) at R = 1.25 |
| Wrapper's wrapped balance `8TqrZM…` | 0 | 799,992 | +799,992 | same |
| Source wSOL `DrfWXM7…` | 11,011,560 | 10,011,570 | -999,990 | the 10-lamport fee leg was a self-transfer: the dev authority is the wrapper here, so the dev ATA for wSOL is the source account itself |

R after: 8,499,990 / 6,799,992 = 1.25 (unchanged, as designed: the fee never touches the escrow-per-wrapped-token ratio). With a third-party wrapper the 10 lamports land in the dev ATA instead of staying with the wrapper.

First `Unwrap` on the upgraded binary, sent from the scratch TypeScript client with the dev-fee token account inserted at index 8 (`DrfWXM7…`, which for wSOL is both the dev ATA and the recipient) and the transfer authority at index 9: 100,000 wrapped from `8TqrZM…` to `DrfWXM7…`, signature `2PTvT3QyAi4FccHtDiLuZnuEjMivikSAczE8hMyWsVu9bF2p5wP21GusFF7mChc3iHV9TXJV4rLh6yW1k1hxPDgi`, slot 458767475, 21,495 CU in simulation, 5,000 lamports fee.

| | Before | After | Delta | Expected |
|---|---|---|---|---|
| Escrow `H1doCC…` | 8,499,990 | 8,374,990 | -125,000 | gross payout floor(100,000 x 8,499,990 / 6,799,992) = 125,000 exactly, because 8,499,990 / 6,799,992 is exactly 5/4 |
| Wrapped supply | 6,799,992 | 6,699,992 | -100,000 | burn |
| Unwrapper's wrapped balance `8TqrZM…` (public part) | 799,992 | 699,992 | -100,000 | burn |
| Recipient wSOL `DrfWXM7…` | 10,011,570 | 10,136,570 | +125,000 | 124,999 payout leg + 1 lamport dev-fee leg (floor(125,000 / 100,000)); both legs land in the same account here |

R after: 8,374,990 / 6,699,992 = 1.25, unchanged, as the fee comes out of the payout and never out of the escrow-per-wrapped ratio. Both post-upgrade paths (`Wrap` via the Rust CLI above, `Unwrap` via the TypeScript client here) work against the mint created before the upgrade; seeds, PDAs and the escrow ATA are unchanged. Wallet after this transaction: 3,007,069,988 lamports. Nothing else was wrapped or unwrapped.

### 8.7 Culted up: names, seed tributes, hidden stakes (2026-10-19, after the fee upgrade)

Three things turned the wrapped mints from bare wrappers into cults. Fee payer and signer: hooked.json.

**Seed tributes** (plain SPL transfers straight into the escrows, no instruction):

| Asset | Tribute | Signature | E / S after | R |
|---|---|---|---|---|
| USDC | 0.10 to `EaxjKC…` | `21tERdqk9AASr2HYycU7h9g6wJMzoEwbnUEGzKKPJ9GqWUviVvSC3fnJSNDFGurvwjP5rpdePGeevGUGHGjD5VS9` | 2,100,000 / 2,000,000 | **1.05** |
| USDT | 0.10 to `3VLxRy…` | `4ATMF2F1GrKLVcQDQkMqYDGByCYW7WJxNFNE6NM4Enx4ypMMWJRq7PmSgyx15eapVprET5S1YLqvTVPFKrBUy443` | 2,100,000 / 2,000,000 | **1.05** |
| wSOL | (8.4) | | 8,374,990 / 6,699,992 | **1.25** |

**Hidden stakes.** hooked's 2.00 wrapped USDC and 2.00 wrapped USDT moved from public to confidential available balance (ConfigureAccount, Deposit, ApplyPendingBalance each): USDC `4VPb96…` `39cqqxBk…`, `2wUppHbk…`, `2vthyyoj…`; USDT `576wsP…` `3f9o4eP5…`, `5tfrdfuU…`, `yf3ccahq…`. Both accounts now show public balance 0 and an applied pending-credit counter of 1. Together with 8.3, every wrapped balance hooked holds is now confidential; the only public numbers per cult are E, S and R.

**Names.** `SyncMetadataToToken2022` copied each base mint's Metaplex metadata into a `TokenMetadata` extension on the wrapped mint (mint accounts grew from 303 to 764 bytes; each had to be topped up with 0.004 SOL first because the fork's CLI does not pre-fund the growth, and the first attempt failed preflight with `InsufficientFundsForRent`).

| Wrapped mint | Name / symbol | Sync signature |
|---|---|---|
| wSOL `Dkkjds…` | Wrapped SOL / SOL | `3xaYbrMeQkFoAaSP16XhHQsejqdaeMtWeZqRgwKz39mXpVFWLMKR5ABL2rnPucBCwk39G3WasCtexj8avfHKDRjk` |
| USDC `DyZQha…` | USD Coin / USDC | `3LEwovqc5R8RUucf4mMDwVVtYhtnKTcZDhRwW6HxH4uUMSmu97SEi2uJ6ihJ291Fnj8eCvCJKuLfL139W34Dww76` |
| USDT `5f6R23…` | USDT / USDT | `2fiGeW9EhPh6NSZh1gBzZTTRwbTNm32CcYRXo3bp9cA4gGDwhnNsK7RVz4kSbgH7yHhowahLcuQgZcSgLYumEnhY` |

Quirk inherited from token-wrap's Metaplex reader: the name, symbol and URI are copied with Metaplex's fixed-width null padding intact (e.g. `"Wrapped SOL\0\0…"`), and the Metaplex header fields land as additional metadata (`key`, `seller_fee_basis_points`, `primary_sale_happened`, `is_mutable`, `edition_nonce`). Wallets trim the nulls; a client that compares strings exactly should trim too. Update authority is the wrapped-mint-authority PDA, so only the program can change these.

Wallet: 3.007079988 SOL before this section, 2.991952837 after (0.012 SOL of mint growth and rent, 0.2 USDC/USDT of tribute, fees).

## 9. JS client for the upgraded program (2026-10-19)

The published `@solana-program/token-wrap` 2.8.0 client emits the upstream 9-account `Wrap`/`Unwrap` and hardcodes `TwRap…`, so every wrap or unwrap it builds fails against the live program with `NotEnoughAccountKeys` (or `DevFeeAccountMismatch` if account 8 happens to be filled). The replacement is the fork's own JS client, regenerated from the fork's IDL.

### 9.1 Where it is

| | |
|---|---|
| Scratch clone | `/Users/stacc/the-composer-rescue/tmp/we-all-eat-wrap` (staccDOTsol/we-all-eat-wrap `rs-economics` @ `350e8db` + `token-wrap-dev-fee.patch`, branch `dev-fee-0.1bps-js`, changes uncommitted, nothing pushed) |
| Package | `clients/js` in that clone: `@staccoverflow/token-wrap-client` **0.1.0** |
| Built output | `clients/js/dist/src/index.js` (CJS), `index.mjs` (ESM), `clients/js/dist/types/` |
| Tarball | `clients/js/staccoverflow-token-wrap-client-0.1.0.tgz` (from `pnpm pack`; install with `pnpm add file:<path>` or `npm i <path>.tgz`) |
| npm | **not published** |
| Peer dependency | `@solana/kit` ^8.3.0 |

### 9.2 What changed against upstream

- **IDL.** The source of truth is `program/idl.ts` (Codama node builders); `idl.json` and `clients/js/src/generated/**` are outputs of `pnpm generate:clients` at the repo root. Program id is now `BDFzgK2BjLoZbV6SEewxQyf9eaXyvqKo4JPMsSybsmMs`. `Wrap` and `Unwrap` gain `devFeeTokenAccount` at index 8 (writable, non-signer); `transferAuthority` is 9; optional multisig signers 10 and up. Error 16 `DevFeeAccountMismatch` is added. The dev fee account is modelled as a PDA of the Associated Token program with seeds `[331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth, unwrapped_token_program, unwrapped_mint]`, which is exactly `get_dev_fee_address` in `program/src/lib.rs`.
- **Generated builders.** `getWrapInstructionAsync` / `getUnwrapInstructionAsync` derive account 8 from `unwrappedMint` + `unwrappedTokenProgram` when it is not passed; the sync `getWrapInstruction` / `getUnwrapInstruction` require it explicitly. `findDevFeeTokenAccountPda({ unwrappedMint, unwrappedTokenProgram })` is exported. `parseWrapInstruction` / `parseUnwrapInstruction` expect 10 accounts. `TOKEN_WRAP_PROGRAM_ADDRESS` and every `find*Pda` default to the fork; all of them take `{ programAddress }` to target anything else, and the upstream id is exported as `UPSTREAM_TOKEN_WRAP_PROGRAM_ADDRESS`.
- **Hand-written helpers.** New `src/dev-fee.ts`: `DEV_FEE_AUTHORITY`, `DEV_FEE_NUMERATOR` / `DEV_FEE_DENOMINATOR` (1 / 100,000), `calculateDevFee(amount)`, `createDevFeeTokenAccount(...)` (idempotent ATA create). `singleSignerWrap`, `singleSignerUnwrap`, `multisigOfflineSignWrap`, `multisigOfflineSignUnwrap` now prepend that idempotent create-ATA, like the fork's Rust CLI, so their `ixs` hold two instructions and the fee account never has to exist beforehand. `createMint`, `createEscrowAccount` and all wrap/unwrap helpers accept `programAddress`. `singleSignerWrap` / `singleSignerUnwrap` results also return `devFeeTokenAccount`.
- **Tests.** `pnpm test` was `exit 0` upstream; it is now `tsc -p tsconfig.test.json && tsx --test test/*.test.ts` (node:test). `test/instructions.test.ts` has 13 cases: both builders emit 10 accounts with index 8 writable non-signer and index 9 the readonly-signer authority (readonly when a multisig, with signers at 10 and 11), full account order and roles match `program/src/instruction.rs`, discriminators 1 and 2 with little-endian u64 amount, parse round trips, sync builder + upstream override, helpers prepend the ATA create. Mainnet vectors pinned: wrapped wSOL mint `DkkjdsGrzFGvyhjwk7cCtWJ4UMPdtWxLQaBf2krL9oAD`, escrow `H1doCCYjjZonSjHefWzkZdiE77jh1AZN6CMNNi4A2Rcv`, wSOL dev fee ATA `DrfWXM7aEjsYNBCYHWRv57aor2etiuum97HedhcPmPdu` (the account that received the fee legs in 8.6).

Verification run: `pnpm build` (tsc under `@tsconfig/strictest` + tsup), `pnpm test` 13/13, `pnpm lint` (oxlint), `pnpm format:check` (oxfmt), all green; both bundles build a 10-account `Wrap` against the fork id. No mainnet transaction was sent for this.

### 9.3 Usage

```ts
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
    singleSignerWrap,
    singleSignerUnwrap,
    getWrapInstructionAsync,
    findDevFeeTokenAccountPda,
    calculateDevFee,
    TOKEN_WRAP_PROGRAM_ADDRESS, // BDFzgK2B…
} from '@staccoverflow/token-wrap-client';

const rpc = createSolanaRpc(process.env.RPC_URL!);
const payer = await createKeyPairSignerFromBytes(/* hooked.json bytes */);

// Wrap 0.001 wSOL into wrapped wSOL (Dkkjds…). 10 lamports go to the dev fee ATA, 999,990 to the escrow,
// and the wrapped amount is floor(999,990 * S / E) at the current rate.
const wrap = await singleSignerWrap({
    rpc,
    payer,
    unwrappedTokenAccount: address('DrfWXM7aEjsYNBCYHWRv57aor2etiuum97HedhcPmPdu'),
    wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    amount: 1_000_000n,
});
// wrap.ixs = [create dev fee ATA (idempotent), Wrap]; wrap.escrowAccount, wrap.devFeeTokenAccount are filled in.

// Unwrap 100,000 wrapped wSOL from a wrapped token account back to a wSOL account.
const unwrap = await singleSignerUnwrap({
    rpc,
    payer,
    wrappedTokenAccount: address('8TqrZM2GfJ4txQVSvP2RmRMYNw9v7UBuZwnRWMFxUKcj'),
    amount: 100_000n,
    recipientUnwrappedToken: address('DrfWXM7aEjsYNBCYHWRv57aor2etiuum97HedhcPmPdu'),
});

// Lower level: the generated builder. Pass the eight upstream accounts; account 8 is derived for you.
const ix = await getWrapInstructionAsync({
    recipientWrappedTokenAccount, wrappedMint, wrappedMintAuthority,
    unwrappedTokenProgram, wrappedTokenProgram, unwrappedTokenAccount, unwrappedMint, unwrappedEscrow,
    transferAuthority: payer, // devFeeTokenAccount omitted: derived from unwrappedMint + unwrappedTokenProgram
    amount: 1_000_000n,
});
// Sync variant needs it explicitly; both take a program override:
// getWrapInstruction({ ...accounts, devFeeTokenAccount, transferAuthority: payer, amount }, { programAddress: UPSTREAM_TOKEN_WRAP_PROGRAM_ADDRESS })

const [usdcDevFeeAta] = await findDevFeeTokenAccountPda({
    unwrappedMint: address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    unwrappedTokenProgram: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
}); // BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ
calculateDevFee(125_000n); // 1n
```

Append `wrap.ixs` / `unwrap.ixs` to a transaction message, sign with `payer`, send. Rebuild after IDL changes with `pnpm generate:clients` (repo root) then `pnpm build` in `clients/js`.

### 9.4 Dev fee token accounts per base asset

| Base | Unwrapped token program | Dev fee ATA (owner `331nEBz4…`) | Status |
|---|---|---|---|
| wSOL `So111…112` | SPL Token | `DrfWXM7aEjsYNBCYHWRv57aor2etiuum97HedhcPmPdu` | exists; received the fee legs in 8.6 |
| USDC `EPjFW…Dt1v` | SPL Token | `BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ` | derived; not checked on-chain, created idempotently by the helpers on first use |
| USDT `Es9vM…wNYB` | SPL Token | `8b9z6sBryaZBSiSV8zrXkKoWdvhYMcksaZemjTXdkaz3` | derived; same |

(The `4VPb96Gy…` and `576wsPPV…` accounts in 8.2 are hooked's *wrapped* USDC/USDT token accounts, not dev fee accounts.)

### 9.5 Not done / open

- Not published to npm and not committed in the clone; the diff is the working tree of branch `dev-fee-0.1bps-js`.
- `clients/js/src/examples/*.ts` compile but still point at localhost and upstream-era fixtures; they were not run.
- The Rust program tests in the clone were not run here (that was covered when the patch was written; see the wiki note about `SBF_OUT_DIR`).

## 9. The 100x cult and secrets.fun (2026-10-19)

A fourth cult for `Fr28jEWz2msSCKLaHzus2nCKrwqbpTx2EyDYtsVVpump` ("Your Next 100x Broker", symbol `100xbroker`, a Token-2022 mint with on-mint TokenMetadata, 6 decimals, no mint or freeze authority), created through the deployed fork after its dev-fee upgrade (slot 458766053). Fee payer and signer: hooked.json. Dev fee authority is hooked itself, so the 0.1 bps fee on Wrap landed back in hooked's own 100X ATA.

Since the upgrade, `Wrap` and `Unwrap` require the dev-fee ATA (dev authority `331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth` for the unwrapped mint, under the unwrapped mint's token program) at account index 8; the pre-upgrade TS client fails with `NotEnoughAccountKeys`. The scratch client was patched to insert it and to prepend an idempotent create-ATA. `SyncMetadataToToken2022` on a Token-2022 base works with just `wrappedMint, wrappedMintAuthority, unwrappedMint` after topping the wrapped mint up with 0.003 SOL for the TLV growth.

```json
{
 "key": "100x",
 "name": "Your Next 100x Broker",
 "symbol": "100xbroker",
 "baseMint": "Fr28jEWz2msSCKLaHzus2nCKrwqbpTx2EyDYtsVVpump",
 "baseProgram": "token-2022",
 "decimals": 6,
 "wrappedMint": "4XiALZXT8jG9zH8JCJXkc8iRQshR7U3X1rtadEmd6q6d",
 "authority": "CxLaRsLgBSJEiUziDBdG7hH1AxfAnieqSbsxj4rUNxDR",
 "backpointer": "4UBtAxE9kufWJ68nUFZBE4ELChzeaznut1TNTF4RDqNz",
 "escrow": "7xxxAq3FyzA8soz4WEE2z1xxdHCGVg7GC3tdUJYYSPkg",
 "E": "3849965000000",
 "S": "3499965000000",
 "R": 1.100001,
 "holders": 1,
 "visible": "3499965000000"
}
```

| Event | Detail | Signature | Slot | Time |
|---|---|---|---|---|
| CreateMint | Wrapped mint, backpointer and escrow created. ConfidentialTransferMint: auto-approve, no auditor, immutable | 5MDth2aeaT4VFZwraKXK5T1gfzdCQG1PTQrqaAoC1dz9nixvsbM7ScBeJeodrezcr6YHXBt7ANHbQbRCH2bnuP7g | 458774733 | 2026-10-19T08:56:53.000Z |
| Wrap | Wrapped 3,499,965 100X; 3,499,965 wrapped minted | 4tRubQotiG1xPV9PeKEvoLxrMTskymTzti56GBLgYD5MARuam9GuEsjjbXh7ixxGYYUQzTFXQzEgf8gEhHSv6ncF | 458776776 | 2026-10-19T09:04:16.000Z |
| Tribute | 350,000 100X sent straight to the escrow. R rose for every holder | 36pANwC1ttKchUUebtsb4V8sf9iGnYbwVWZUaUHzx6ZTrvjNJbZT8LgKpxXQws8sPoCsQFYpcwY9xVq1kYW7782d | 458776788 | 2026-10-19T09:04:18.000Z |
| Metadata | Token metadata synced from the base mint | 2WpzTMLaL98LtZnJryjfkagGManM7WPzXEJJbM9iWFGthniV7f3htFN8FqgmVQjSKuZc1wy6pSoNKnq7NLw9Ewr | 458777681 | 2026-10-19T09:07:31.000Z |

The public page for every cult is https://secretsfun.xyz (Next.js on Vercel, project `secretsfun`, source `secretsfun/` in this folder). It discovers cults from the program's backpointer accounts and indexes new signatures lazily on each request through the Helius RPC in `HELIUS_RPC_URL`; `/api/index` is the JSON it serves.

### 9.1 Confidential stake on wrapped 100X (spl-token-cli 5.6.1, `~/.cargo/bin/spl-token`)

hooked's wrapped-100X account `CcRPxuLuEDxnWQcz6rWirpo1RRJjapnc2rpsaYfr6nB5`: public balance 3,499,965 → 0, all of it in the confidential available balance.

| Step | Signature |
|---|---|
| ConfigureAccount (PubkeyValidity proof) | `4uXvEXTjpMeAKLM1Jnv533sEBbmBFy6tr1WLZoyxLQJ2tpLQdhEhw2itSqiDzL6CFjTaRsU5pZxnrnt5WTEery1P` |
| Deposit 3,499,965 public → pending | `4aLDvvYntGCTexhR5ZhtnttcdrLVCmca8FAfdZnRWBZyLc57EMa26vzsBHJcka5o3skwADD8qVypaT2LtdNUEd3d` |
| ApplyPendingBalance | `2oW5LFpih867Epd32ZDgrE1ZwU8JUuutLvfyHosehix4JeijAFmYLtSFGFGUhLp1qSUj1Xz98nJpmBwtoxRGdMgQ` |

State after: E = 3,849,965, S = 3,499,965, R = 1.10; the only holder account shows public 0 and an ElGamal ciphertext. The 100x cult is the featured hero on https://secretsfun.xyz.

---

## 10. Browser prover and the live join on secrets.fun (2026-10-19)

The /join flow on https://secretsfun.xyz is real end to end and confidential only. There is no public-only or demo path.

### 10.1 What runs where

| Piece | Where | Notes |
|---|---|---|
| Wallet | `secretsfun/lib/wallet.tsx`, `lib/wallet-heavy.tsx`, `components/WalletButton.tsx` | `@solana/wallet-adapter-react` 0.15.40 with Phantom and Solflare adapters; Backpack and other Wallet Standard wallets self-register. The adapter tree is loaded lazily (idle or first click) so pages paint first. |
| RPC | `app/api/rpc/route.ts` | JSON-RPC proxy to `HELIUS_RPC_URL` with a method allowlist (reads, `sendTransaction`, `simulateTransaction`, `getSignatureStatuses`). The browser `Connection` points at `/api/rpc`; the key never ships. Confirmation is by polling, no websocket. |
| Wrap | `lib/wrap.ts` | Hand-encoded `Wrap { discriminator 1, amount u64 LE }` against `BDFzgK2B…` with the ten-account layout: dev-fee ATA at index 8, transfer authority at 9. The tx prepends idempotent create-ATA for the wrapped ATA and the dev-fee ATA, and for the wSOL cult tops the wSOL ATA up from native SOL (`SystemProgram.transfer` + `SyncNative`). |
| Confidential instructions | `lib/confidential.ts` | `Reallocate` (spl-token JS), `ConfigureAccount` (ix 27/2, proof offset +1), `VerifyPubkeyValidity` (ZK program ix 4, 96-byte proof data inline), `Deposit` (27/5), `Withdraw` (27/6), `Transfer` (27/7, see 10.5), `ApplyPendingBalance` (27/8), verify-into-context and `CloseContextState`, plus the `ConfidentialTransferAccount` and `ConfidentialTransferMint` TLV parsers. |
| Prover | `secretsfun/zk-wasm/` → `lib/zk/pkg/` + `public/zk/zk_bg.wasm` | `wasm-pack build --target web --release --out-dir ../lib/zk/pkg --out-name zk`. Exports `derivation_message`, `elgamal_pubkey`, `pubkey_validity_proof_data`, `ae_encrypt`, `ae_decrypt`, `elgamal_decrypt_u32`, `apply_pending_balance`, `withdraw_proof`, `transfer_proof`. 2.4 MB wasm (the u32 discrete-log table is embedded). `getrandom` needs `features = ["js"]`. |
| Runner | `lib/join.ts` (`runJoin`), `lib/leave.ts` (`runLeave`, `applyPending`), `lib/transfer.ts` (`runTransfer`), hooks `useRealJoin` / `useRealLeave` / `useRealTransfer` in `lib/wallet.tsx` | One code path for the site and for `scripts/join-burner.ts`, `scripts/leave-burner.ts`, `scripts/transfer-burner.ts`. |

### 10.2 Key derivation

`ikm = wallet.signMessage("solana-conf-bal/v1" || wallet_pubkey)` (64 bytes), then `derive_confidential_keys_from_ikm(ikm)`: HKDF-SHA512 with salt `solana-conf-bal/v1`, info `elgamal` (64 bytes → scalar mod order) and `ae` (16 bytes). Nothing is stored; the wallet is asked to sign the same message whenever a decryption or proof is needed. Public seed = wallet pubkey, so one ElGamal key per wallet across all cults.

### 10.3 Mainnet proof (burner `5rqTh6FzEuPHsYtppXGJATnrSfcHAG5GEnHQLV6ADMqG`, 100X cult, 2.5 100X)

| Step | Signature | Result |
|---|---|---|
| fund burner from hooked | `4JCm1nMqShe8kuPwJffqSooATkfFbG1sWNFevfe5Sb1e12q6wtBXfvkZdR6umQL2Jum5Dbpdzz27YoT4JTtqtAuf` | 0.02 SOL + 3 100X |
| Wrap | `2Xbjt1Vk3Z5hs4KJ4E39EzmMWva9fLYhZnKcrNropHoJSMAQHw3oYPMXeLG3cXGWXsxwPApj8r5p53qAVVn9bbde` | 2,500,000 raw in, 2,272,702 w100X minted (R = 1.1, fee 25 raw) |
| ConfigureAccount + VerifyPubkeyValidity | `vU7NcQvH2fJJALFHm2C844zk3SPKybagS1VPn3cTE7MTykfv2Tz3KZnKKagR4a2sqxkTLYbTKV1W7dfvL9TLLoK` | proof from the wasm accepted; ElGamal pubkey on chain = derived key |
| Deposit | `5ukqajcJiJrz9FDDrb9EPmJaTiNgpBB7hEQ7Z7VPVce8YTkiBWCHaXqQzwj2svZ7RiNFhk7siPh3dZHwoFraJf94` | whole public balance → pending |
| ApplyPendingBalance | `4ihjoy5YQi3HUr5EXnHaGYB4YG38J6ZN1cAyxMUX9ofRTAh1sH97WiphjCqNwrjub59zHTie6MGVB7pgHWQwvWte` | pending decrypted in wasm, available = 2,272,702, decryptable balance re-encrypted |

Token account `D7f59ZV8X3tJJcVNZbdkmUrr5uLjFNMqyF3QcXYiZkEn`. Whole sequence 6.2 s wall clock including four confirmations.

### 10.4 Mainnet proof of the leave path (same burner, 1 w100X)

`lib/leave.ts` (`runLeave`): the wasm builds the CiphertextCommitmentEquality and BatchedRangeProofU64 proofs (`withdraw_proof`). The range proof (~940 bytes) cannot share a transaction with `Withdraw` nor with its own account allocation (1346 > 1232 bytes), so the leave is four wallet signatures plus one message:

| Step | Signature | Result |
|---|---|---|
| allocate range-proof context account (297 bytes, owner = ZK ElGamal program, ephemeral keypair co-signs) | `2XzAhHu74hLzuug7ENAHYXssGsLEw448qqwK5Q6jXPeLUhGCVReWxX1aE7s291N1m11dXzi5uga6Mv9BVVvwFkdc` | |
| VerifyBatchedRangeProofU64 into that account | `3jom1md5RiSj58g2jbZDcWwPTZ2JpJn9VganMGpR2eRuhdAXXcC1PjxVqiTu929EARmFCdibFgNLHVnB9mBrkFET` | |
| Withdraw (equality proof inline at offset +1, range proof from the context account) + CloseContextState (rent back) | `2XfTvS39V7eGVs8zrRcmQ6qHZjVJkvkaPoi2Z797yAyeZ8T9GAYueeiVEeRMoxGcRFJYBe9WKcemV2zddCjt8d49` | 1,000,000 raw to the public balance; available 2,272,702 → 1,272,702 (decrypted on-device before and after) |
| Unwrap | `45mjiUNXVK1eAjwQNHM2nCQeVqsXBmv3s55Vg7evwXVqjpsujq661Kh8k9ztmjWgxdRBJEaa11qvYujRnWpA8E2z` | 1,099,990 raw 100X received (R = 1.1, dev fee 10 raw) |

6.0 s wall clock. Reproduce with `npx tsx scripts/leave-burner.ts 1`. `ApplyPendingBalance` on its own is `applyPending` in the same file (used by /me when the pending counter is non-zero). Reproduce with `npx tsx scripts/join-burner.ts 2.5` in `secretsfun/` (needs `HELIUS_RPC_URL` in `.env.local` and `~/hooked.json`).

### 10.5 Mainnet proof of the confidential Transfer (member → member, 0.1 w100X, amount hidden)

`lib/transfer.ts` (`runTransfer`), driven by `useRealTransfer()` in `lib/wallet.tsx` (same shape as the leave hook: `run(amountUi, cultKey, recipientWallet)`). The wasm export `transfer_proof` wraps `spl_token_confidential_transfer_proof_generation::transfer::transfer_split_proof_data` (0.6.1) and returns the CiphertextCommitmentEquality (320 B), BatchedGroupedCiphertext3HandlesValidity (544 B) and BatchedRangeProofU128 (1000 B) proof data, the new source decryptable balance and the auditor lo/hi ciphertexts the `Transfer` data carries (zero-key auditor: the mints have none). `Transfer` (ConfidentialTransferInstruction 7) is encoded per `inner_transfer` in spl-token-2022-interface 3.1.2: source, mint, destination, instructions sysvar, one context account per non-inline proof (validity, range), owner. The recipient must already be a member (its wrapped ATA configured with the extension and allowing confidential credits).

Transaction plan, 1232-byte limit: (1) create both context accounts and verify the validity proof into one of them, 1107 bytes with three signatures; (2) the range proof alone, 1205 bytes, with **no compute-budget instruction**: the 1001-byte payload leaves no room for one, and none is needed because the ZK ElGamal program is not in Agave's builtin-cost table, so a lone instruction gets the default 200,000 CU, exactly `VERIFY_BATCHED_RANGE_PROOF_U128_COMPUTE_UNITS` (spl-token-cli 5.6.1 sends it the same way); (3) `Transfer` with the equality proof inline at offset +1, the two context accounts, then `CloseContextState` × 2, ~960 bytes. 0.00476504 SOL of context rent is parked between (1) and (3) and refunded in (3); on a failure in between the runner closes whatever context accounts exist.

Sender: burner `5rqTh6FzEuPHsYtppXGJATnrSfcHAG5GEnHQLV6ADMqG` (account `D7f59ZV8…`, available 1,272,702 before). Recipient: new burner `4ejvDohYZwEiUgCqi3K1uq3ztnWesSv6bpZGmajBbV2X`, wrapped ATA `ByZZ1g5TQrNd28N7v5MF9qUrso9EQTtv8NPGQeySWnKc`, funded with 0.01 SOL (`5CkgwEQx8Ym1WnrYN6rhZFCWsPdZ6gLbq5fMxbYYbChVq7oMTqvKVF9R712ii6ATYvAMJJhjH8qrDtuPq7bUJz9M`) and configured without a Wrap (create ATA + Reallocate + ConfigureAccount with the PubkeyValidity proof: `3hdrp8tZzSMvX2inzFgXNccnY21KUubzKTQVyCxSYFjbGASM4VnLT3ugegkvBQ4GLG8YPnEyMU7PbvmJAowhkebo`).

| Step | Signature | Result |
|---|---|---|
| create validity (385 B) + range (297 B) context accounts, VerifyBatchedGroupedCiphertext3HandlesValidity into the first | `4cHE2gwryxR4awaEThRFLfu8mdqXhdJrEcPPzA28ctnP6sUNB7mqdkL4FwRpGkuknXVynj7bMme5MmuessgkmzGm` | |
| VerifyBatchedRangeProofU128 into the second (no compute-budget ix) | `3CvP4HMDu4viauN7F8PXb1fFesa6VbXfUfGztZW6zUPXqtN9nRn2ZMsn7UzRGmG3TzQ7QrPgjkPiGVdMM6qmphTi` | |
| Transfer (equality inline, validity + range from context accounts) + CloseContextState × 2 | `2Qt7zMJUfP6GCrbQ7C7q5iCSzvUnVHKL9eNuhsqo3hxWVtaq6wZhtSAMEtwaMPGSARE5QHTpZMCYse9PEWBmjSn8` | sender available 1,272,702 → 1,172,702 (decrypted on-device); the amount is nowhere in clear |
| recipient decrypts its pending balance on-device | | pending_lo/hi decrypt to 100,000 raw, credit counter 1 |
| recipient ApplyPendingBalance | `4YWX1WY1cCycFd84zJwwnURcLNEKLGTty9ZFKNtJGTxMW89LcMDZAAQ1Cf9hk1k15U9fNaLySFrpirPiYugpAYeE` | recipient available 0 → 100,000 |

4.6 s wall clock for the three transfer transactions. Sender SOL 0.01689184 → 0.01685764 (fees only; the rent came back). Reproduce with `npx tsx scripts/transfer-burner.ts 0.1` in `secretsfun/` (sender = the join burner, recipient keypair generated into the scratchpad as `burner2.json`).

### 10.6 Full loop through the site's libraries, one fresh member (2026-10-19, `scripts/e2e-member.ts`)

Member wallet `` (funded with 0.03 SOL and 10 100X by hooked: `XfaAtLd14gTAGghU5sxLyjSRErwGZvHFYX7D86oit5DHBRmEahW6N33526AKSRzaDAum1PQnQiDBbi77yiS6iwP`, `4FKBdQ541bFux4dbTRSMCycP5U6oggMpeipWS5hSVUeHzPJj1XUHEAKnRfsEkHmjJQMH6objVqYB2n6a1CyYVgik`). Everything below is exactly what the site runs from a connected wallet (lib/join.ts, lib/transfer.ts, lib/leave.ts, proofs from lib/zk).

- Join 10 100X: {"join":{"tokenAccount":"Gki9HtomdvUeHmD13XpLARdUgBk3e99UeJZUHvHZUzkH","sigs":{"wrap":"3JGGcff1YnctEfdXfv3DaFu1y2f5xT27GJtdk3z36ZDfx92eCSuuEWNhHJobECsbLgbrnEiPmmkGRwW2M7pDeomv","configure":"5MZLQjPTRD97C3WB9cT3Zs9sDAy82ZjbSgfscp2msKTqQPeh6eLX4tif9hvFrEGTEHc3uLprxBYtM6E8oZRQLGss","deposit":"c3nFEiJEM7PVoXYHi3UArbMavyiYrjCjmZT7x7ec2ooLzxZj6565RZtgzVw5D8GBWr9d2AydQ2QRcZth3MMpqxu","apply":"2onpwKR9zU3fsSjPrRLPtaAejEdXh7XS3eRuADimtYNU5auAozjbs2gU2MSAGuV9W892EJ84m2zVmdHvZxbKqnzr"},"minted":"9090809","available":"9090809","seconds":6.2}}
- Send 1 w100X hidden to member `4ejvDohYZwEiUgCqi3K1uq3ztnWesSv6bpZGmajBbV2X` (account `ByZZ1g5TQrNd28N7v5MF9qUrso9EQTtv8NPGQeySWnKc`): validity `3aqz7EvcnYsgZiWxQTD92rVxd4CV6KvMrYS1nQVRTf4ykoLW8Fjs55674tPUA8yPsTQg5jM9mRLqbT2mz3F4nj5y`, range `4hYw5oRRz7seiEsnQdCLKgDrdjBX217DMH1M1vnz71J3fndqegGAdj9o4rnC1pbkvU81LDzzkn9P2cCzk7EVLVZ3`, transfer `5XK9aVuBnJ6gzNboEugwXRXCD5uK1ygeVMFk8a25ndP6PJw2RWg6n7y5211poJXtaqGuv7dkVbMkqGTtyB4p2sst` (4.7 s, 0.00476504 SOL parked in proof accounts and refunded).
- Reveal 2 w100X and unwrap: allocate `2JAPPzmxhH3htQH7vYk1kT3JxYJKWLmdGLkcNYSaQVUKpfupRzEPqFQ1fWXrpHbaZwc9dtQLZhNTi3M6X5AY7Foi`, range `54XmzFyCuzLqmLUCtkde28W7iEsC47L17RjpgHLws3tw67V96apFiTkkUSfUC17CXcwr94pKiK9K2wbPw6ubbWk1`, withdraw `7qK29LxQBRGwTNwdQ4YLtfJtCE7d6YmE7V3wtGKqTDJ3TZQdzN1XimaMLpRjAevuGve3eLFgRJ3vG7JUyBMxeri`, unwrap `2fnHRhspBg4SiVCm8PXtty73poqZRZ2Rj9ay5TEARcTy1fbkFKXn8Mby1p8KSLBXfEY6q8rKuwU4p5dGrex2xP1b` (5.8 s). Withdrawn 2,000,000 raw, received 2,199,980 100X (R 1.10 minus the 0.1 bps fee).
- After: hidden available 6,090,809 raw, pending 0, 2.19998 100X back in the wallet, balances conserved.

Known gap: hooked's own wrapped-100X account (`CcRPxuLuEDxnWQcz6rWirpo1RRJjapnc2rpsaYfr6nB5`) was configured by spl-token-cli, whose ElGamal key derivation differs from the site's `solana-conf-bal/v1` wallet-signature scheme, so the site cannot decrypt or spend that stake; a wallet joining through the site gets a compatible account.
