# HANDOFF: Backwards engineering with the Composer

This file explains how to run "backwards engineering" using the Composer in
`~/the-composer-rescue`. It states only facts found in the repository files.
Anything that could not be confirmed from a file is marked "(inferred)".

## 1. What the Composer is

The Composer is a hosted read-only service that recovers the callable interface
of a deployed Solana program. From `composer-runs/2026-10-19/composer-service-access.md`:

- Non-secret service base URL: `https://the-composer-svc.fly.dev`
- `GET /idl/{program_id}` returns a program's published (Anchor) IDL if one is
  stored in a published IDL account on chain.
- `GET /learn/{program_id}?limit={bounded_count}` returns a "learned" transaction
  schema that the service infers from on-chain transaction samples when no
  published IDL exists.
- These reads need no credential.

The learned response is documented inside the data itself
(`composer-runs/2026-10-20/flashx-idl/flashx-composer-learn-1000.json`). It
contains, per instruction: a discriminator, positional accounts
(`account_0`, `account_1`, ...), signer flags, PDA derivation blocks where the
service could reproduce them, and the raw argument bytes observed after the
discriminator (`argsHex`). The file's own `howToUse` field says the whole object
can be passed as `idl` to the service endpoints `/tx/build` or `/tx/batch`, and
its `caveats` field warns that:

- instruction names from a learned response may come from another program that
  declared the same discriminator, so a name is a hint, not a fact;
- an instruction shown as `ix_<hex>` means no published IDL anywhere declares it;
- argument layout is NOT decoded; `argsHex` must be passed back verbatim or the
  program rejects the transaction with an empty payload.

"The composer" is therefore two things in this repo (inferred from usage):
1. the Composer service above, and
2. the body of work in `composer-runs/`, which is a reverse-engineering and
   auditing workflow that uses the Composer service plus direct Solana RPC.

Note: the repo root `package.json` is a placeholder (`the-composer-rescue`,
version `1.0.0`, `test` script just errors). There is no local Composer program
to build here; the Composer runs as the remote service above. (inferred)

## 2. What "backwards engineering" means here

The exact phrase "backwards engineering" was not found in any file in this repo,
so the following definition is inferred from what the runs actually do:

Backwards engineering here means starting from the deployed end-state artifact
(the live mainnet program's executable and its current on-chain custody/state)
and working back to a usable interface and a reproducible call, rather than
starting from source. Each run in `composer-runs/` does, in order (inferred from
the file set and the audit write-ups):

1. Pin the current deployed identity of a program (program id, loader,
   program-data account, last-deployment slot, executable size, and SHA-256 of
   the executable and program-data). Example recorded in
   `composer-runs/2026-10-19/alphaq-current-mainnet-audit.md`.
2. Recover the interface. Try the Composer `GET /idl/{program}` first; if there
   is no published IDL, fall back to `GET /learn/{program}?limit=N`.
3. Validate the recovered interface against a real successful transaction
   ("receipt") from chain: confirm discriminators, positional accounts, signer
   flags, and token-account relationships match. `composer-service-access.md`
   states a Composer quote or schema inference is not by itself a finding.
4. Build, sign, and simulate transactions (never broadcast) to test whether an
   ordinary outsider can move value, and record the economic result.

This is the opposite direction from the forward build in `secretsfun/` and the
`LIQUID-CULTS-SPEC.md` spec, which go spec -> source -> deployed program.

## 3. Prerequisites and setup

From the files:

- A Solana mainnet-beta RPC endpoint. The audit scripts read it from an env file,
  not from the repo. `composer-runs/2026-10-19/fragmetric-composer-current.js`
  reads `/private/tmp/codex-mainnet-rpc-2026-10-19.env` and requires that file to
  be mode `0600`, then reads one of the variable names
  `SOLANA_RPC_URL`, `SOLANA_RPC`, `HELIUS_RPC`, or `RPC`. Never commit this file.
- Node.js with `fetch` (the scripts use `AbortSignal.timeout`). Some scripts also
  use local `node_modules` such as `bs58` and `@solana/kit` 8.5.0 (see the
  alphaq audit). (inferred: install per-run as needed; there is no root install)
- Network note from `composer-service-access.md`: direct sandboxed network calls
  can fail, so use approved network access; a cold Composer request can take
  longer than 30 seconds, so set an explicit 60 to 180 second timeout. The
  scripts use a 180000 ms timeout for Composer reads and 60000 ms for RPC.

For the separate `secretsfun/` Next.js app (forward build, included here for
context), from `secretsfun/README.md`:

- Node.js 20.9 or later; `npm ci`, then `npm run dev`, `npm run typecheck`,
  `npm run build`.
- Runtime env variable names only (do not print values):
  `HELIUS_RPC_URL` (or `RPC_URL`), optional `BLOB_READ_WRITE_TOKEN`, optional
  `CRON_SECRET`, and `NEXT_PUBLIC_SECRETS_PROGRAM_ID`. A `.env.local` exists and
  must never be copied or printed.
- `.claude/launch.json` defines run configs: `secretsfun` = `npx next start -p 3011`,
  `secretsfun-dev` = `npx next dev -p 3013`, `secretsfun-start-3012` = port 3012,
  each run from inside `secretsfun/`.

## 4. Exact commands to run the Composer

Interface recovery (reads, no credential). Use a 60 to 180 second timeout:

```
curl --max-time 180 https://the-composer-svc.fly.dev/idl/<PROGRAM_ID>
curl --max-time 180 "https://the-composer-svc.fly.dev/learn/<PROGRAM_ID>?limit=1000"
```

Save and hash the returned JSON (the runs store the raw response and its SHA-256;
see `retrieval-status.json` in the flashx run, which records a `sha256` per file).

Worked, real values from `composer-runs/2026-10-20/flashx-idl/`:

```
curl --max-time 180 https://the-composer-svc.fly.dev/idl/FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9
curl --max-time 180 "https://the-composer-svc.fly.dev/learn/FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9?limit=1000"
```

To then build a transaction from the learned schema, the learned JSON's own
`howToUse` says to pass the whole object as `idl` to `/tx/build` or `/tx/batch`
on the same base URL. (The exact request body for those two endpoints is not
shown in any file in this repo; treat the call shape as unconfirmed.) (inferred)

The per-program attestation scripts (for example
`composer-runs/2026-10-19/fragmetric-composer-current.js`) are run with plain
Node once the RPC env file exists:

```
node composer-runs/2026-10-19/fragmetric-composer-current.js
```

## 5. Backwards-engineering workflow, step by step

Worked example: the FlashX run in `composer-runs/2026-10-20/flashx-idl/`, whose
summary file is `retrieval-status.json` (program
`FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9`).

1. Pin identity. Record program id, Solscan last-deployed slot (458174909 here),
   and compare against any receipt slot you rely on. The run notes the
   independent receipt slot 456867177 predates the last-deployed slot, so the
   receipt validates historical execution, not the current bytecode.
2. Try the published IDL. `flashx-composer-idl-response.json` returned
   `{"error":"no published IDL account ... for program FLASHX..."}`, and the
   Solscan UI likewise showed "This program does not have a public IDL".
3. Fall back to learn. `GET /learn/...?limit=1000` returned a cached learned
   schema saved as `flashx-composer-learn-1000.json`. Its evidence counters:
   250 signatures scanned, 250 transactions parsed, 357 instruction samples,
   2 distinct 1-byte discriminators, 0 instructions named, encoding
   "not anchor: selector inferred from the data".
4. Read the instruction shapes. `retrieval-status.json` lists shapes such as
   `ix_00` (discriminator [0], 44 accounts, 22 arg bytes) and `ix_01`
   (discriminator [1], 5 accounts, 9 arg bytes). Arguments were not decoded.
5. Validate against a real receipt. `hook-swap-receipt.json` and
   `hook-swap-interface-check.json` capture a successful on-chain hook-swap
   (signature `J4r7D8FRF...`, slot 456867177, selector 0, 34 accounts). The run
   flags `coveredByLearnedAccountShapes: false`: the receipt's 34-account
   hook-swap did not match the learned 44-account `ix_00` shape, so the learned
   schema was not confirmed as a usable call for that instruction. This is the
   key backwards-engineering check: the recovered interface is only trusted when
   a real receipt confirms it.
6. Record limitations and stop. `retrieval-status.json` states plainly the
   learned response is not a complete or authoritative IDL, argument types are
   undecoded, and the receipt predates current bytecode.

A fuller end-to-end example that reaches the economic stage is
`composer-runs/2026-10-19/alphaq-current-mainnet-audit.md`: there the Composer
`GET /idl` returned HTTP 400 and `GET /learn?limit=150` timed out past 30s, so no
Composer interface was available; the auditor then pinned the executable hash,
recovered live parent routes from successful receipts, built and signed (not
broadcast) a mainnet v1 transaction with `@solana/kit` 8.5.0, simulated it, and
concluded the outsider call was an input-paid swap with a negative after-fee
bound. That run shows the workflow still completes when the Composer yields
nothing: you fall back to receipts plus signed-but-unbroadcast simulation.

## 6. Where outputs land

- Everything lives under `composer-runs/<DATE>/`, with dated run directories
  `2026-10-15`, `2026-10-19`, and `2026-10-20`.
- Per target, the run writes a `.js` probe/harness, its `.json` output, and a
  `.md` audit or gate write-up (for example `alphaq-current-economic-gate.js`
  plus `.json`, and `alphaq-current-mainnet-audit.md`).
- Recovered executables are saved as `<tag>-current.so` at the run root or under
  an `evidence/` subfolder (for example `evidence/alphaq-current-mainnet.so`).
- Composer interface captures are kept as raw JSON next to a
  `retrieval-status.json` that records SHA-256 for each file (flashx run).
- A run-level index is kept in `current-audit-ledger.md`.

## 7. How to verify results

From `composer-service-access.md` and the audit files:

- Save and hash (SHA-256) every Composer response; retain the raw output because
  cached evidence counters do not always enumerate appended entries consistently.
- Independently validate discriminators, positional accounts, signer flags, and
  token-account relationships against a successful current receipt. A Composer
  quote or schema inference is not itself a finding.
- Confirm the receipt's slot is at or after the program's last-deployed slot, or
  state that it only proves historical execution (the flashx limitation).
- For value claims, require, in the ledger's words: current deployed-binary
  identity, outsider authority, a successful value-moving control, a complete
  atomic transaction if flash funding matters, and net user/protocol accounting.
  Interim quotes, fork-only states, and transaction-local aborts are not findings.
- For `secretsfun/`, verification scripts named in its README:
  `npx tsx scripts/restoration-guards.test.ts` (program availability and legacy
  rejection) and `scripts/restoration-e2e.ts` (requires a localhost validator;
  it refuses a remote RPC endpoint). The index smoke test is
  `npx tsx scripts/check-index.ts [url]`.

## 8. Known issues and gotchas

From the files:

- Learned names can be borrowed from another program sharing a discriminator; an
  `ix_<hex>` name means no IDL declares it. (flashx learn caveats)
- Learned argument layout is undecoded. Pass `argsHex` back verbatim or the
  program rejects an empty payload. (flashx learn caveats)
- Learned account shapes may not cover the real call (flashx:
  `coveredByLearnedAccountShapes: false` for the 34-account hook-swap vs learned
  44-account shape).
- The Composer can be slow or unavailable: `GET /idl` returned HTTP 400 and
  `GET /learn?limit=150` exceeded 30s in the alphaq run; the fragmetric learn
  response was `{"error":"The operation was aborted due to timeout"}`. Use a 60
  to 180 second timeout and be ready to fall back to receipts.
- Direct sandboxed network calls can fail; use approved network access.
- A receipt can predate current bytecode, so it proves history, not the live
  program. Always compare slots.
- RPC credentials live only in a `0600` env file outside the repo; the attestation
  scripts refuse to run if the file is not mode `0600`.

Gotchas carried in `.claude/wiki.md` that touch this repo's broader work
(summarized, inferred relevance): the fork program id must be passed explicitly to
every token-wrap client because upstream `TwRap...` is not deployed; confidential
provers need `solana-zk-sdk >= 6` (`spl-token-cli` 5.6.1 at `~/.cargo/bin/spl-token`,
not the Agave-bundled 5.5.0); the dev-fee branch adds a dev-fee ATA at account
index 8 of Wrap/Unwrap so stock clients fail with `NotEnoughAccountKeys`; and
Mollusk tests need `SBF_OUT_DIR` set to `target/deploy` plus a `cargo build-sbf`
of the test hook/metadata programs first.

## 9. Next steps

- For any new target: run the Section 4 commands, save and hash the output, then
  do the Section 5 validation against a fresh current receipt before trusting the
  interface.
- Where the Composer returns no usable interface, follow the alphaq pattern: pin
  the executable hash, recover parents from successful receipts, and build and
  simulate (do not broadcast) a signed transaction to test outsider reach.
- Confirm the exact request body for the Composer `/tx/build` and `/tx/batch`
  endpoints, which are referenced by the learned JSON but not demonstrated by any
  file in this repo.
- The newest run (`2026-10-20/flashx-idl`) left FlashX with an unconfirmed
  interface (learned shape not matched by the receipt); re-run `learn` against a
  current-slot receipt to close that gap.

## 10. Security

- Do not print, copy, or include any secret value. Only variable names appear in
  this file: `HELIUS_RPC_URL`, `RPC_URL`, `SOLANA_RPC_URL`, `SOLANA_RPC`,
  `HELIUS_RPC`, `RPC`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`,
  `NEXT_PUBLIC_SECRETS_PROGRAM_ID`, `SBF_OUT_DIR`.
- `secretsfun/.env.local` and any keypair files exist on disk; never read their
  values into any output, and never commit or push anything.
- The audit workflow builds and signs transactions but never broadcasts them, and
  never persists an RPC endpoint or private key in the evidence.
