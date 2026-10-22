# SVSP finalized-mainnet evidence audit

Observed 2026-10-15 20:00 UTC. This is a defensive, read-only live-mainnet snapshot of `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`. It used `RPC_URL` only, deliberately ignored `HEAVY_RPC_URL`, used `finalized` commitment, and made 125 successful read calls with zero failed calls. It did not construct, sign, simulate, or submit a transaction and does not emit an endpoint or credential.

## Result

No outsider-impacting vulnerability is validated by this live census alone.

There is a real current capability signal: 34 classic SPL token accounts across nine SVSP pools have the canonical mint-authority PDA as an active delegate with positive allowance. Twenty-one have positive balances. However, no individual account currently has enough burnable balance to reach the one-SOL successful stake-split threshold under the requested current-state calculation. A capitalized acquire/deposit/replenish/exit theory remains unvalidated until there is an exact source-compatible route, current independent source availability, and an end-to-end `sigVerify:true` result. This audit supplies none of those final validation steps.

The upgrade authority is recorded as a trust fact, not an outsider finding.

## Slot boundary and artifacts

- Finalized start/end slots: `457363054` / `457363107`.
- Context-slot range: `457363055..457363106`.
- Program and ProgramData: slot `457363055`.
- 57-pool scan: slot `457363056`.
- Linked stake/onramp/mint accounts: slot `457363057`.
- Stake-authority GPAs: slots `457363057..457363104`.
- Per-mint exhaustive token-account GPAs: slots `457363058..457363104`.
- Positive stake and token candidate `getMultipleAccounts` cross-check: slot `457363106`.
- Epoch: `1058` (`absoluteSlot=457363053`).

Artifacts:

- `svsp-live-finalized-evidence.json`, SHA-256 `c07da88cce0bb9554687eef7155735d11c51ec514ad9776e818b68477c33ee6e`.
- `svsp-live-finalized-evidence.js`, SHA-256 `3656e14e1a9988d3c5e74395218f476e5833f1ebb2a8cc61fa8fcc6cb1ccb418`.
- `svsp-active-onramp-envelope.json`, SHA-256 `07110beced02137b93e634682074db63849571de07bf68ed9c919ea5eec01106`.
- `svsp-active-onramp-envelope.js`, SHA-256 `9b7d8e9cddef740c3a6afdc5fa5625e7c38eee37d5badbba35579186c7134bd2`.

## Executable identity

- Program: `SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE`.
- Upgradeable loader: `BPFLoaderUpgradeab1e11111111111111111111111`; executable flag true.
- ProgramData: `CnA41uYcs8X64x4PAhoPooN1yo1vabvbb64eJe9H8SZJ`, same loader owner.
- Last deployed slot: `408388782`.
- Upgrade authority: `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz`.
- Allocated payload: 254,256 bytes, SHA-256 `b75b95e3837e6ebb9c15b3285c57a53f2721a1faf64d02e44ccff71e331375c4`.
- Nonzero payload prefix: 234,649 bytes, SHA-256 `fdc8ceb905a2a101c4f916ef4126c29ba14e826c89c04944639f7f3e42771e30`.
- Local `SVSP....so`: 254,256 bytes and the same `b75b...375c4` hash; exact allocated-payload match.
- Release pin: `program@v4.0.1`, commit `3921ea5f63198b9a4f8d1ac9fcf24d5ca612a10a`, asset `spl_single_pool-v4.0.1.so`, 234,664 bytes, SHA-256 `217300596e04cf21d9e613fdac3cfefa5ada9456a36b9fc79303fac5fe192f8d`. The deployed first 234,664 bytes have that exact hash and the remaining 19,592 bytes are zero.

## 57-pool state and custody correction

All 57 decoded 33-byte pool accounts are canonical `['pool', vote]` PDAs. All 57 canonical stake, onramp, and mint accounts exist. Every canonical/onramp stake account has the derived stake-authority PDA as staker and withdrawer. Every mint is an initialized 82-byte classic Token-program mint with nine decimals, the derived mint authority, and no freeze authority. Token-account sums equal mint supply for all 57 mints.

- Canonical stake: `37,502,073,558,711` lamports = `37,502.073558711 SOL`.
- Onramp: `2,723,915,308` lamports = `2.723915308 SOL`.
- Correct primary custody, canonical + onramp once: `37,504,797,474,019` lamports = `37,504.797474019 SOL`.
- Canonical delegated stake: `37,474,174,570,598` lamports.
- Onramp delegated stake field total: `1,362,441,831` lamports.
- Aggregate mint supply across the 57 distinct nine-decimal mints: `34,964,170,136,839` raw.

The earlier `37,508.016... SOL` gross is wrong. Its secondary `stakeLamports` already included canonical, onramp, and two HHZn withdrawer-only accounts, and then onramp was added again.

The two excluded withdrawer-only accounts total `495,391,942` lamports (`0.495391942 SOL`). Both belong to pool `HHZnib6n6X1fxa7UMV2zbzZGRNDZ7R1NaswjgRCFBxYD`, whose canonical stake-authority PDA is `cfFkgpeKSHKfhi1eyaaq4P3S1oNysuVpey2dDBznFqx`:

- `41TqgSpiKqTSGJcNPWYSc9kUJPfEPeVu8oFNMdrMMroQ`: 393,041,619 lamports; staker `HYbxGkNvEwvZ14RzJHPB9h3dWfXjxwAEhkyzJRHx1hBf`; withdrawer the PDA.
- `61dUgdXRaBcgwrM8JrGA32fxUbv6mHMQ1dqttJsAeMLR`: 102,350,323 lamports; same staker and withdrawer.

They are not canonical/onramp custody and are excluded from the primary total. Including every account whose withdrawer is an SVSP stake-authority PDA produces `37,505.292865961 SOL`.

## PDA derivations and historical signer control

Seeds are:

- pool `['pool', vote]`
- canonical stake `['stake', pool]`
- onramp `['onramp', pool]`
- mint `['mint', pool]`
- stake authority `['stake_authority', pool]`
- mint authority `['mint_authority', pool]`
- metadata authority `['mpl_authority', pool]`

Every derived address for every pool is off-curve. The canonical 57-row address map SHA-256 is `f9740dcc5875a3556e07758b2414968218c5878a85b9f402d06f2f6fe12c20c8`; the JSON contains every address and bump.

Historical signature `4msXjLBsZPppwwEEnFnrPhZgYpjAAwr8ckvaWAvYnEpVLwJ7Ay8NrV55RMX1M41fJ9KdmoQsnnuF2BDYcraaBDiM`, slot `457043372`, block time `2026-10-15T00:47:57Z`, succeeded. Outer instruction 8 invokes SVSP `ReplenishPool`. Successful inner Stake CPIs move 430,664,791 lamports from `DsWBAjaADG52DS2Fi6vzoyNAGzbqNA9rNK53xqAHMjqT` to `CnSe1WoQhjn6iE21W99iE93YFqdh4V5Vf97yxjPYqN7Z` and delegate the destination to vote `abc1zP7ihWsgQW8z5YmfQNqMckJE5Dfx8fwUNMNVNkY`, using stake authority `E7c64FTgM5hHHNk2t2BzikarqT36dxRSAyR1ac25uy28`. That PDA is transaction-level `signer=false`; successful authority-gated Stake CPIs establish instruction-scoped PDA signing. They do not establish arbitrary outsider signing.

## Current mint-authority capability census

The live endpoint does not expose `getTokenAccountsByDelegate`, and its delegate-offset Token-program secondary index is unavailable. The audit therefore exhaustively enumerated all 2,460 classic token accounts by each of the 57 canonical mints using the supported mint-at-offset-zero index, parsed owner/delegate/allowance locally, and cross-checked every positive candidate with `getMultipleAccounts` at slot `457363106`.

- Active delegate = canonical mint-authority PDA with positive allowance: 34 accounts, nine pools.
- Token-account owner = canonical mint-authority PDA with positive balance: zero.
- Positive-balance delegated accounts: 21.
- Aggregate allowance: `45,566,933,698,044,543,330` raw; this is capability, not current value.
- Aggregate currently burnable `min(balance, allowance)`: `268,169,293` raw (`0.268169293` across distinct nine-decimal pool tokens).
- Individual accounts reaching the requested one-SOL successful split threshold: zero.

For each account the JSON calculates `M=max(canonical delegated stake - 1 SOL, 0)`, `withdraw=floor(burnable*M/S)`, `minimum=ceil(1 SOL*S/M)`, strict-more-than-one-SOL as `floor(1 SOL*S/M)+1`, and shortfall. This table shows the largest positive-balance account per affected pool; `accounts` is standing approvals / positive balances.

| pool | mint | supply S | available M | accounts | largest account | burnable | withdraw lamports | minimum raw | shortfall |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| `29HkYUS72wz4QsiUfEs8FkwcWCcAMq3VL3eZPXBkGPK6` | `BDsEuxFWznAP5cUCannnfjyjDtTwqN57CkGfDbjx2nNZ` | 47933247 | 60346473 | 3/2 | `BwL8cWnaT1htTdq66bC7K7DEadjk64HcoZRQQhCA7mFB` | 2 | 2 | 794300721 | 794300719 |
| `5MajYJn3isL5S5bZ1rnvjnMaq4UtbceoKtg52V2UHojo` | `5FGcgMtpjZXvrSqrXu8ehE43MLrKQoxBs6JPgk164vBc` | 436491547 | 504296728 | 1/1 | `E7JJ8wGLjMHEgZpVMRcxkNZP5Qny7cvuUitUbz16a15s` | 258169258 | 298273616 | 865545071 | 607375813 |
| `6KyZ4p16cih53oE1zhzwum3aQNPjzBbCW6xieC5xtR6c` | `38ZUTefZnKSUJU3wxpUe3xpiw2j5WQPnmzSTNbS1JqLA` | 31040128 | 193603574 | 1/1 | `5S8zeR3Kcqw8nSJHqJsHThk8APSqsJNrkSNbtvRn7SB2` | 1 | 6 | 160328280 | 160328279 |
| `AJuDKVWD9WmLbwyR69ydU6EixidNoMfdyteykbZLeJj2` | `9yQLxEzusZ7QiZNafDNdzbEaTCPuJToGjMhLRJtZbgsd` | 13169247263 | 15667581125 | 5/2 | `DiGe3QcBZR7aSRVBYYWQc7q9u9Yr4WAn1NX7Pfbq4GhK` | 2 | 2 | 840541189 | 840541187 |
| `BnnjRBpecqkxGp276rNf6CP1x8cDb6CojjmeXd2WCwXu` | `2k79y8CApbU9jAvWhLS2j6uRbaVjpLJTUzstBTho9vGq` | 165141829641 | 184123975854 | 8/4 | `2tRGyBbrKjBcKRiDMs72gBbSZt866t7FKe8NqWk7wrGS` | 5 | 5 | 896905626 | 896905621 |
| `ERopCT8C74dnpYyc9TJEjbYFXCDFdp81qZs8pwnDL2da` | `PhxXAYTkFZS23ZWvFcz6H6Uq4VnVBMa6hniiAyudjaW` | 97717114 | 139594984 | 1/1 | `2aaAmQqHMwND74rdccuHT8EJfcebrEoebLRrigFR8AJp` | 1 | 1 | 700004479 | 700004478 |
| `EX9cdHB6s6YfzXDkKVRzh15i5NL5AvPW6vXTL5eMcqu9` | `C1KwBJZNwUaodUcP5kXqD52NCuZzThNAG2cw3vt5H6iE` | 97717114 | 136815440 | 2/2 | `9ykS5NRSSCgTcLu4m5SYNJyd1v5xY92GLNpsWQghnk8J` | 10000000 | 14001174 | 714225778 | 704225778 |
| `GarzsmM8cZ5ginjk4sMc7kkXXqobJeJ1QmT7vwG5iT1i` | `2pMCRTPxF355vC56r6mL8vfnqa24up5CfZmcX1HkFj7i` | 1832467582803 | 1936865881492 | 4/4 | `C4TNuKzsSmdLMKdJYSNxANkztDtCX9EcBydK5wjLNb2d` | 5 | 5 | 946099367 | 946099362 |
| `HHZnib6n6X1fxa7UMV2zbzZGRNDZ7R1NaswjgRCFBxYD` | `98B1NMLYaNJQNxiQGr53vbjNFMNTYFmDqoCgj7qD9Vhm` | 383062107240 | 491834859134 | 9/4 | `2Uga7qyJnzUZcgb32oxUjYr7XfkHcRZTsYqJNbJd7yHL` | 1 | 1 | 778842940 | 778842939 |

## Active-onramp envelope

Epoch-field classification finds 11 active, seven inactive, and 39 initialized/nondelegated onramps. `getStakeActivation` is unavailable on the live endpoint (`-32601`), and StakeHistory was not independently evaluated. “Prerequisite” below means activation/deactivation epoch fields, same vote, main active epoch fields, and identical authority/lockup meta; it is not a successful Replenish simulation.

For the 11 prerequisite rows, total pending delegated `R` is `1,350,755,502` lamports (`1.350755502 SOL`). For a simplified deposit-before-merge model, gross capture is bounded by `R*X/(M+X)` and asymptotically by `R`. The aggregate asymptotic gross ceiling is therefore only `1.350755502 SOL`, before capital costs, fees, rounding, ordering, and execution constraints. Eip8 contributes `1.339641182 SOL` of that total. The highest `R/M` is 2.912624897% at `2A172...`, but its absolute ceiling is only `0.001726740 SOL`.

| pool | mint | supply S | pricing M | pending R | R/M |
| --- | --- | ---: | ---: | ---: | ---: |
| `Eip8KPQ2KcPxUoHHroccZQed4Qaz6Eqr9wf1nUTrnJh4` | `BNisp3omkr6Rg5nHESWafjUbeCpGPy6MYq1iRJRgSAsh` | 32183277560267 | 34275674246674 | 1339641182 | 0.003908431% |
| `8L6366uKkfVXfymWgbURNu2TxbxvacPDb2hR4YR8c39F` | `6Mt7tBWLUJfDxqCFTsjoRXF9wD55g4Lhs5nAyYp244pX` | 2402357545 | 2810122907 | 4223987 | 0.150313247% |
| `BATMoW8FMJio6H3nDTHhpkWBLdwVw3dWndVpNaAizNaP` | `9yF8pXctzicum2P73uuk4Dhqf2MVz6tzRAe8THGXCJcp` | 15668238 | 76503762 | 1737918 | 2.271676522% |
| `2A172EkPfeQchU4uKuTd3e6Mk2LqwsTZF6sALRCQbzZj` | `77YLpVLQXr2KU66GM2JykbT9g5du7LarWgehbWD3CJaB` | 18554276 | 59284668 | 1726740 | 2.912624897% |
| `E524AY3cdkmzFra5Sc2sr8ZYm1qeDMLk2MnY4fGEBq7S` | `9M7oMo4oL6RDPG7WbAX3Zz4dPzbMgpiCzwrQPMwG4Wgq` | 2659776557 | 6010009300 | 1394602 | 0.023204656% |
| `AvS4oXtxWdrJGCJwDbcZ7DqpSqNQtKjyXnbkDbrSk6Fq` | `BADo3D6nMtGnsAaTv3iEes8mMcq92TuFoBWebFe8kzeA` | 69506749476 | 157934438073 | 795836 | 0.000503903% |
| `CrpYNnXiaRRe2tKmpAZQoZsB11DuXESDXKdJw9jnhRYM` | `F1XPjtpsEy23Q7po4JkWjp1jkDZcvFYSrqD8TR1YL3EF` | 1316972 | 377850931 | 731988 | 0.193724017% |
| `GZcQzJ2Ai1gBvLk6Lr3Sc1sd3ik7RkcDEnvvpP4N8SHR` | `DKPvRV4dxUejjGpr2XwFmzZbbbTD7vx9Jmt1kk43n4d5` | 53318160 | 161209500 | 282628 | 0.175317211% |
| `9Y4irMvZAn49LVCxpQuQtrXDB7V8YxhtVV1XM9U1RESq` | `Akib1NYJzzh9HkiDH41S2LUefUmR1bKsk65xgqUcW5C5` | 1088066240 | 1235995164 | 187214 | 0.015146823% |
| `AcYTFzeuaR4PZ2QoFQH8t5otN1sjobEzoakgLFJLQq7M` | `96rXgCFy1Er49169XoKHkeLiKC2k4bTy1641q1TVrMm2` | 11997717154 | 13448084175 | 33104 | 0.000246161% |
| `7br6p7ynCs5hkTzuDagM2xBedkxxCjY1Ey9xQuCiDiq1` | `FcXEwHku68ZquqtSj1eSWS1SVWkhAZSyb4usfpiuEJAL` | 40266832 | 123558039 | 303 | 0.000245229% |

## Immediate token owners, fees, and source availability

The census found 149 nonzero token accounts and 117 immediate owners. “Owner” here means SPL token-account authority, not necessarily the end user or economic beneficiary.

- Marginfi liquidity vault `EfL6qsvqvkpjvDc5d7VxEhLoUkAmUgKVfh6Q7S8nvKmi`, authority `2sGbripDDDunRUPxbQwwPTqfxBWYhRitzV8r8fAYijZd`, holds `32,183,277,560,267` raw Eip8 mint `BNisp3...` (`32,183.277560267`). Existing `marginfi-vaults-current.json` binds it to bank `3VCkXWAmE5DSwYRpqGFnkUz7vvD2RKbhFvrhzLuE8msu`.
- Jupiter liquidity PDA `7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z` holds `2,133,582,226,504` raw across ten distinct SVSP mints. Existing `mainnet-token-authority-state-proofs.json` binds the off-curve state to program `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC`.
- Marginfi liquidity vault `22LC9j3n1npMwipmkNokqWzH6L5c1rzgtGBVQLQnFWy1`, authority `HGc1McWoMaqY1bLF7mKRffqBLPCFAQZyZLWvxayCTgSu`, holds `184,757,475,853` raw Dskme mint `Cq9S...` (`184.757475853`), bound to bank `G46aHuakgStymbE2WsLbja61mH5UXBPdSdpwf6Ci3saG`.

These are custody balances, not evidence of flash-borrow compatibility or available inventory. The current KLend zero-fee census (`457347934..457347944`) contains no reserve whose liquidity mint equals any of the 57 SVSP derivative mints. That does not rule out an underlying SOL/WSOL capital route, multi-provider composition, or later state movement. No exhaustive current Project 0/KLend/other-provider flash crosswalk was performed here, and no final source-availability conclusion should be drawn from these holdings.

Pool state contains only the one-byte type plus vote key; it has no manager/protocol fee or beneficiary field. All 57 mints are classic 82-byte Token-program accounts, so there is no Token-2022 transfer-fee extension. The older locally vendored source/README also describes zero fees, but it is design corroboration rather than proof that it is the exact v4.0.1 source tree.

## Reproduction

From `/Users/stacc/the-composer-rescue`:

```sh
node --check /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-evidence.js
node /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-evidence.js /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-evidence.json
node /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-active-onramp-envelope.js
jq '{observation,executable,summary,accountingCorrection,historicalStakeCpi,withdrawalExposuresByPool,epochFieldMergePrerequisitePools}' /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/svsp-live-finalized-evidence.json
shasum -a 256 /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE.so
git -C /Users/stacc/the-composer-rescue/composer-runs/2026-10-15/gover-phy-audit/source-mythic-spl show HEAD:single-pool/program/src/processor.rs
```

The collector requires an already configured `RPC_URL` but never prints it. The JSON is the authoritative exact account list; this Markdown report intentionally abbreviates the 34-account delegate list and the full 57-row PDA/state map.

## Limitations

- Multi-call snapshot, not one atomic bank snapshot; exact category slot ranges are above.
- Live endpoint only. The HEAVY/archive endpoint was excluded because existing discrepancy evidence shows it can return stale GPA rows.
- No StakeHistory calculation and no `getStakeActivation`; onramp labels are epoch-field prerequisites only.
- No transaction was built or simulated, so there is no `sigVerify:true` validation.
- No end-to-end flash-source compatibility or available-inventory proof; custody holdings cannot substitute for it.
- No user/end-beneficiary attribution beyond immediate token-account owners and specifically corroborated protocol PDAs.
- Upgradeability is a trust fact, not an outsider exploit finding.
