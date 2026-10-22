# GoonFi V2 live major-token pool: signed outsider swap screen

Observed 2026-10-15 on Solana mainnet-beta (genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`). This is one bounded, wallet-signed `simulateTransaction` with `sigVerify:true`; no mainnet transaction was submitted. The signer came from `/Users/stacc/hooked.json` at runtime, and neither the secret nor the RPC endpoint is in the evidence artifact.

## Selection and control evidence

GoonFi V2 `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE` was absent from `breadth-first-current-triage.md`. The local [propAMM activity census](propamm-live-census.json) recorded recent immediate-parent token outflows. In the selected wSOL/USDC pool, the off-curve authority `GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC` is a 2,048-byte account owned by the executable GoonFi V2 program. Its current data binds wSOL and USDC mints at byte offsets 80 and 112 and their token vaults at 144 and 176. The SPL Token accounts both name that authority. At confirmed slot **457405829**, vault `8ncU5YW1CQwvr4gs7buH57bW58e86TDau4STrCJBuz8z` held **4,087.559245480 wSOL**, and vault `EunHLeqeJKvxnCPQSytnBP63HJVk2fbHceiKKpngyAo8` held **332,459.119307 USDC**. Exact PDA seed derivation was not established; the off-curve, program-owned state, state-to-vault bindings, and observed program-parent signer transfers establish operational program control of these vaults.

The deployed program's current ProgramData slot was **453915006**. The successful [wSOL-out source transaction](https://solscan.io/tx/sMjvq1VE5A6iMxWEQfTPzdyG7Qmast6PK4GAD3HjesC6vxFLc5ZDeysaG12kMXNQbuvjc7hUN5Ly3Q9JntQNLgt) at slot **457390509** and the successful [reverse-direction source](https://solscan.io/tx/4RK6fKuenDmQ5eUschoZpp6nHpyPpABS5JwbiJmH9KM6em8ujB2EWRg5F5kocDyRKhab6Nbk68VzmYfWwDHKMe7y) at slot **457390510** postdate that deployment. Both contain GoonFi CPIs. The screen reused the selected pool accounts and the observed reverse swap payload layout, replacing user accounts with the hooked wallet's existing wSOL and USDC ATAs. The GoonFi call was made **top level**, so its success establishes a directly reachable public value-changing handler for this pool.

## Signed mainnet-beta result

The hooked wallet wrapped **0.005 wSOL** inside the packet, then called GoonFi's direction-0 swap. The v0 wire was **641 bytes**, used **15 account keys**, and required **one signature**, which the hooked wallet supplied. Signature verification passed, the GoonFi call succeeded, and the simulation used **67,871 compute units**. The pool received **5,000,000 raw wSOL** and paid **528,167 raw USDC**; the wallet's USDC ATA gained **0.528167 USDC**. The wallet wSOL ATA ended at its original raw balance after the wrap and swap. No lender or synthetic balance was involved.

A separate confirmed account read at slot **457405830** found zero actual change in either pool vault. The simulated trade did not broadcast. This is an input-paid swap, not an unauthorized withdrawal or a demonstrated positive-equity cycle. It does not test other pools, larger amounts, reverse-unwind economics, or all GoonFi instructions. It does not re-report the known GoonFi issue mentioned elsewhere in the repository.

Full account images, transaction hash, simulation logs, and deltas: [JSON evidence](goonfi-v2-wsol-usdc-mainnet-signed.json). Reproducer: [signed simulation script](goonfi-v2-wsol-usdc-mainnet-signed.js).

The subsequent [exact-pool cross-venue quote screen](goonfi-v2-cross-venue-economics.md) found no stable gross spread above likely transaction costs across 10–250,000 USDC starts in either route order.
