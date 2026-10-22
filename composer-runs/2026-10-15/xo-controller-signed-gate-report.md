# XO Cash controller: current signed outsider gate

Observed on mainnet-beta, 2026-10-15. This is a bounded defensive authorization check of `C64AAGzJxsFwzQZaS1t8Yis5UCVTTAchTwG2QZj1kSRi`, whose current program-controlled XO vault is `UbBRVUaN2GXo2Huz3Q5SPmmHi8ZgEK9ekPYAopD6Kr3`. No transaction was submitted.

## Current custody and exit proof

- At confirmed slot **457,422,709**, `getTokenAccountBalance` returned **2,740,041.702112 XO** (2,740,041,702,112 raw, six decimals) for that vault. The token authority `EznfmrkPUNtDhicN9AYHKyBDYqbYB83VpFi98fVSKxQv` is currently owned by the executable controller program.
- The current ProgramData deploy slot is **438,488,805**. Eight token transfers in three sampled successful transactions after that slot show `C64AAGz...` as the immediate CPI parent and that authority as the signer. One observed `SendToken` released 500,000 XO plus a 1-XO transfer; a later call paid three recipient token accounts and a 1-XO transfer. These are **spend proofs**, not proof that an outsider can invoke them. [Read-only provenance](unreviewed-controller-spend-gate.json), [sample transaction shapes](xo-controller-live-shapes.json).
- The historical payout calls included four independent transaction signers. Logs name the controller instruction `SendToken`; no legacy Anchor IDL account was found for this program at the derived IDL address. [IDL availability check](unreviewed-controller-idl-gate.json).

## Hooked-wallet mainnet-beta simulations

I replayed the observed `SendToken` data, vault, mint, authority and destination accounts. The source signer roles were replaced with outsider-held keys. All simulations used a real hooked-wallet signature and `sigVerify:true` on mainnet-beta; they were not broadcast.

1. Replacing all four source signers with the hooked wallet failed Anchor `ConstraintSeeds` **2006** on `payer_token_account`: the historical payer token account was not the hooked wallet's derived XO account. [First gate](xo-outsider-signed-mainnet-gate.json).
2. Creating the hooked wallet's XO Token-2022 ATA idempotently in the same simulated transaction and supplying it as `payer_token_account` reached the controller, but using one wallet for all four signer roles failed `TooManyWritableSigners` **6000**. [ATA gate](xo-outsider-signed-mainnet-ata-gate.json).
3. Keeping the hooked wallet as payer and using three *distinct fresh outsider keys* for the other signer roles passed those layout checks. The **847-byte, 15-key**, correctly signed v0 packet failed `UnknownCosigner` **6007** at `programs/exodus-multisig/src/guards.rs:29` before any XO transfer. [Distinct-signer gate](xo-outsider-signed-mainnet-distinct-gate.json).

The distinct-signer result is a concrete current-binary authorization rejection for the observed payout shape. The copied historical data may carry an old request ID or expiry, and no other controller instruction was dynamically tested; this is **not** a whole-program safety proof. The selected XO balance is a custody amount, not a validated loss or realizable DEX exit value. XO Cash is described by [Exodus](https://www.exodus.com/support/en/articles/12626651-getting-started-with-exodus-pay) as its Solana stablecoin.
