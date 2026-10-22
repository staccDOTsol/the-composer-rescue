# the composer

> point it at a live mainnet program. it hands you back the interface.
> then you build the atomic route, sign it, simulate it — and find out, with receipts,
> whether the vault actually leaks. spoiler for the ~20 protocols in here: it didn't.

this repo is two things:

1. **the Composer** — a hosted read-only service that recovers the *callable interface* of any
   deployed Solana program, even when there's no published IDL.
2. **`composer-runs/`** — the receipts. every target we pointed it at, every route we built,
   signed, and simulated, and the honest number that came out the other end.

nothing in here was broadcast. no funds moved. this is backwards-engineering + simulation,
not a trading bot and not alpha. keep reading before you ape anything.

---

## what "backwards engineering" means

you don't start from source. you start from the thing that's already deployed and work back to
a call you can actually make:

1. **pin the binary** — program id, loader, program-data, last-deploy slot, SHA-256 of the ELF.
   if a receipt you trust predates that slot, it proves *history*, not the live bytecode.
2. **recover the interface** — `GET /idl/{program}` first; no published IDL? fall back to
   `GET /learn/{program}?limit=N` and let the service infer the schema from on-chain samples.
3. **validate against a real receipt** — discriminators, positional accounts, signer flags,
   token-account wiring all have to match a successful current tx. a learned schema is a *hint*
   until a receipt confirms it.
4. **sign + simulate, never send** — build the full atomic route (flash borrow → act → repay),
   sign it, simulate it on a mainnet-backed fork, and read the net accounting.

full method, gotchas, and verification checklist: **[HANDOFF.md](HANDOFF.md)**.

## run it

reads need no credential. cold starts are slow — give it 60–180s:

```sh
curl --max-time 180 https://the-composer-svc.fly.dev/idl/<PROGRAM_ID>
curl --max-time 180 "https://the-composer-svc.fly.dev/learn/<PROGRAM_ID>?limit=1000"
```

worked example (FlashX, no published IDL → learned schema):

```sh
curl --max-time 180 https://the-composer-svc.fly.dev/idl/FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9
curl --max-time 180 "https://the-composer-svc.fly.dev/learn/FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9?limit=1000"
```

save the raw JSON, hash it, then do the step-3 validation before you trust a single field.
learned argument layout is **not** decoded — pass `argsHex` back verbatim or the program bounces
an empty payload. a learned name can be borrowed from another program that shares a
discriminator, so a name is a hint, not a fact.

## the scoreboard

we pinned the live binary, recovered the interface, and built signed atomic routes against
real custody across ~20 mainnet controllers — hundreds of millions in vault TVL, including a
$389m Meteora lock, ~$30m in OnRe USDG, 28.8m ONyc in XP1BR, 37.5k SOL in SVSP stake pools.

**result: zero outsider-accessible, net-positive drains.** every complete route either lost
money after fees or died on an authority gate before anything moved. a representative slice
(full table: [`composer-runs/2026-10-19/current-audit-ledger.md`](composer-runs/2026-10-19/current-audit-ledger.md)):

| target | what we tried | outcome |
| --- | --- | --- |
| **Hylo** JitoSOL/xSOL | 847,067 JitoSOL KLend+Project0+Save atomic round trip | fully repaid, caller **−17,339 JitoSOL**, exactly matching protocol+Save fees |
| **OnRe** USDG/ONyc | 12.6m USDG KLend+Jupiter atomic cycle | repaid, caller **−2.86m USDG**, both lender vaults conserved |
| **Jupiter** DEX-peg v103 | KLend+Project0 → DEX → Whirlpool → dual repay | fits 2,251 accts / 53 keys, **−20.60 USDC** before SOL fees |
| **Meteora** Lock `Locp…` | outsider claim / recipient-update / cancel on $389m vesting | all failed stored-authority constraints, **zero persisted change** |
| **AlphaQ** CASH/USDC | official v1 two/three-provider compositions @ 20k USDC | full repayment, **−8.36 / −11.03 USDC** after residual + fees |
| **Validator Bonds** `vBoNd…` | signed claim vs a live 139.9 SOL request | `InvalidWithdrawRequestAuthority` before any movement |

the whole point: *interim quotes, fork-only states, and tx-local aborts are not findings.* a
target only counts if you've got live binary identity, outsider authority, a successful
value-moving control, a complete atomic tx where flash funding matters, and net accounting.
none of these cleared that bar. the vaults held.

## the other 70,000+

here's the part nobody should gloss over: the discovery inventory has **77,715 executable
program IDs on Solana mainnet**, and this repo has thoroughly tested roughly **twenty** of them.

that's not ~20 out of 20. that's ~20 out of 77,715. **70,000+ live programs have not been
pinned, not had their interface recovered, not had a single signed route built against them.**
the ledger says this out loud — it is "a work index, not a claim that the 77,715 executable IDs
in the older discovery inventory were audited."

so read the scoreboard for what it is: a clean sheet on a *tiny, hand-picked* sample, not a
verdict on the chain. the Composer is the tool that makes the other 70k tractable — one at a
time, binary → interface → receipt → signed sim. the map is almost entirely unexplored. the
doors we checked were locked; nobody has even walked up to the rest.

## layout

- **[HANDOFF.md](HANDOFF.md)** — the full howto.
- **`composer-runs/<date>/`** — per target: a `.js` probe/harness, its `.json` output, a `.md`
  audit, recovered `<tag>-current.so` binaries, and `retrieval-status.json` with SHA-256s.
- **`composer-runs/2026-10-19/current-audit-ledger.md`** — the master scoreboard.
- **[LIQUID-CULTS-SPEC.md](LIQUID-CULTS-SPEC.md)** — the forward-build spec (spec → source → deploy),
  the opposite direction from everything above.

## the fine print (read it)

- **not financial advice. not an exploit kit. not alpha.** this is security research. every
  route here came back negative or gated.
- **nothing was broadcast.** the workflow builds and signs transactions and simulates them on
  mainnet-backed forks. no mainnet value-moving tx came out of these runs (one documented ATA
  setup aside).
- recovered `.so` files are just the on-chain bytecode anyone can pull from a validator.
- RPC endpoints and keys live in a `0600` env file **outside** this repo. there are none in here.
  don't add any.
- live protocols change. a receipt can predate current bytecode. re-pin before you trust anything.

dyor. this is a map of doors that were all locked.
