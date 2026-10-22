# Current-mainnet custody and outsider-mutation audit

Date: 2026-10-19  
Network: Solana mainnet-beta, read-only  
Program: `2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo`  
Pool: `9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb`

## Disposition

**No validated outsider path was found that moves program-controlled SOL, stake, LP value, inventory tokens, or the manager fee to an unauthorized beneficiary.** The concrete signed outsider mutation—replacing the stored manager-fee recipient in the active `LiquidUnstakeStakeAccount` route—fails on the current binary with Anchor `ConstraintHasOne` (custom 2001) before target value movement. The canonical positive control succeeds only by contributing a freshly created, attacker-authorized stake account and is economically negative to that caller after target gain, manager fee, and transaction fee.

This is a bounded negative finding, not a claim that the closed-source binary is vulnerability-free. It is based on current deployment identity, exact live custody queries, a current successful mainnet receipt, and signed `sigVerify:true` simulations on a current mainnet fork. No transaction was broadcast.

## Current deployment pin

At observation slot **458,748,691**:

| Property | Exact value |
|---|---|
| ProgramData | `DhUnAcd5CgwtvaS7ny1Epcgm6rR8zcQbJ1MpKmJHbUsP` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Last deploy slot | `419656198` |
| Upgrade authority | `F3yy3FVpwq9MV321AzALFcDWZp9XBBHbMas3t4AtEtCW` |
| Executable payload | 1,045,291 bytes |
| Executable SHA-256 | `e6baece94a5b408494967052d01c9f7457645a21756e18bc44ce49e477a6da99` |
| ProgramData account SHA-256 | `5672664d31409d64ef7285182be1ec547c28425c07b343c97944cc425a4a618e` |
| Pool account SHA-256 | `d6c2d89bc51ea21ebb99c72339c4ce461118c5682dbef0c23ff48e70b860049e` |

The executable hash is unchanged from the 2026-10-15 pinned binary, so the earlier control results and the new fork mutation address the same deployed code.

The live state binds:

- authority `32jvJYDZ2ZjSjqhWTope4fnNg8oh6btwrX2F23S7fWwS`;
- SOL vault `6RLKARrt6oPCyuMCdYdUHmJxd4wUa6ZeyiC8VSMcYxRv`;
- LP mint `EUWoTx5vQQrxaDFdeK2PLUVbnmRWjw4x6sBbmcxBaHjF`;
- manager fee account `F3yy3FVpwq9MV321AzALFcDWZp9XBBHbMas3t4AtEtCW`.

The exact PDA derivations match state: `find_program_address(["pool", authority], program)` gives the pool with bump 253; `find_program_address(["sol_vault", pool], program)` gives the vault with bump 251.

Current state fields include `withdrawSolFeeBps=1`, `withdrawStakeFeeBps=1`, `managerFeePercentage=20`, `flashLoanFee=0`, `flashBorrowed=0`, and **`flashEnabled=0`**. State records 4,018,342,311,523 vault lamports and 920,317,983,631 deactivating-stake lamports. The queried accounts differ by only 1,080,892 and 40,147 lamports, respectively. State `totalLpSupply=5,779,498,538,315`; mint supply is 5,779,497,553,563, a 984,752-raw-unit delta. These small drifts are reported, not interpreted as exploitable value.

## Exact native custody and the 48,493 / 1,285 discrepancy

The current finalized exact-authority census at slots **458,748,693–458,748,694** is:

| Component | Accounts | Lamports | SOL |
|---|---:|---:|---:|
| Stake accounts with pool as staker | 65 | 920,318,023,778 | 920.318023778 |
| Stake accounts with pool as withdrawer | 65 | 920,318,023,778 | 920.318023778 |
| Deduplicated union | 65 | 920,318,023,778 | 920.318023778 |
| Program SOL vault | 1 | 4,018,343,392,415 | 4,018.343392415 |
| **Gross native custody** | **66** | **4,938,661,416,193** | **4,938.661416193** |

The staker and withdrawer results are the same 65 addresses, with identical address digest `4ad8e8e79ff757fbc0458a55326116fe9ad45843e153f12a5d329409738c97ec`; they are counted once.

The earlier numbers reconcile as provider disagreement, followed by genuine later state change:

| Observation | Stake accounts / stake SOL | Vault SOL | Gross SOL | Interpretation |
|---|---:|---:|---:|---|
| 2026-10-15 first census, linked slots 457,355,254–255 | 2,542 / 47,801.553465614 | 691.991666709 | 48,493.545132323 | Later proven stale/inconsistent for current ranking |
| 2026-10-15 archive-provider rerun, slots 457,356,280–304 | 2,543 / 47,801.668248805 | not recomputed in that sample | — | Archive view still returned old accounts |
| 2026-10-15 live/public finalized, slots 457,358,593–610 | 63 / 593.391547041 | 691.991666729 | 1,285.383213770 | Live/public views agreed; sampled old accounts were absent |
| 2026-10-19 live finalized, slots 458,748,693–694 | 65 / 920.318023778 | 4,018.343392415 | 4,938.661416193 | Current snapshot |

Three stake accounts sampled from the old result were absent from both the live and public finalized views while the archive provider still returned them. One sample's most recent indexed signature was at slot 425,088,479, tens of millions of slots before the archive context. That establishes stale/provider-inconsistent account indexing; it does **not** establish the backend root cause or a recent 47k-SOL exploit. The increase from 1,285.38 to 4,938.66 SOL is a later live-state change and is not evidence that the old 48,493-SOL snapshot became current again.

## Program-controlled token accounts

At slot **458,748,694**, exact owner queries found 22 legacy Token Program accounts (18 nonzero) and one Token-2022 account (nonzero). Legacy address digest: `1cc7fdda7c5f5a1d99035ff04e4f04f406eed83103caa9081ce93b1dc8a29991`; Token-2022 digest: `842dfeb5ce152e8fae0a750f8fbb29ae176d9ed68e79f535967180565be15d37`.

These are raw mint units, intentionally **not** added to the SOL custody total or assigned an unverified price. The complete account/mint/raw-amount rows are in `current-mainnet-refresh.json`. Notable nonzero balances include:

| Token account | Mint | Raw amount |
|---|---|---:|
| `6jCF55xmiZJqshSUCARcJcS8AMpodavgecvNTHJQjamW` | `vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7` | 628,551,410,312 |
| `2nAbCHtnF6D9P6F7QcCunfJx7YKoDjPYVCN2m4ZyAEoY` | `Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B` | 58,950,726,513 |
| `AqJRdhHzdXCti6yEoAPnUz6SssuTg2LHbtUbGe3cPSRr` | `ELSoL1owwMWQ9foMsutweCsMKbTPVBD9pFqxQGidTaMC` | 20,648,472,181 |
| `7bXqhkznYVQSzoQY7VpQBmeFBLP8xcDUTAm9Kd65NJzj` | `hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u` | 7,474,134,223 |
| `5gE4BW24FjLSFDEy9PvZNnXRRWQxxXLErBif6y9oNykq` | `hySo1JDBhfEnkXuTtPRLXK9HZhkVEpYM8VoHGv9MUnN` | 5,891,171,986 |
| `GsnGvDeyxnPN5DMFEFrZdfaU3aj7P2bMDm3CDC4A6ahD` | `sctmWXGT7L75psrUHV2xxyTQKndE7ZcCQRHy2z6D5ER` | 4,402,992,584 |
| `5MrEdRshEUUeFKUyXAjDhFHawbAoJukWGPLrtMUF5Vsw` | `phaseZSfPxTDBpiVb96H4XFSD8xHeHxZre5HerehBJG` | 928,353 |
| `2o8ZoUW3Yoxj52oag8Vo7oiVWV3Rq4Wfj5sdTawWvDUp` | `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` (Token-2022) | 220,994,358 |

## Current eligible value path and signer-positive receipt

The newest confirmed signer-positive target invocation found is mainnet signature:

`rrjH9bUcMiQeEQ7K97cMSStP5Dc8gXZmDNvpMJik2Q8Uorw65gS6nKTUatYn37cZMBj8WzuYkEUA3MYAG6oqG6B`

It executed `LiquidUnstakeStakeAccount` at slot **458,733,846**. Its sole signer, `AYdDXRcgPxkxoE7EEE1ip2RYERkoyUxzZN74hUa3Uqv1`, was both authority over the 11,531,528-lamport stake input and the SOL recipient. Inner Stake instructions authorized both staker and withdrawer from that signer to the pool, then the pool deactivated the stake. The fixed manager account received 622 lamports.

Exact reconciliation:

```text
mainnet account deltas:
  signer/user              +11,521,984
  stake-info PDA            +1,056,640
  fixed manager fee               +622
  SOL vault                -12,585,055
  transaction fee               -5,809

11,521,984 + 1,056,640 + 622 - 12,585,055 = -5,809

value surrendered to target custody:
  input stake               11,531,528
  new stake-info rent        1,056,640
  less vault payout        -12,585,055
  target gain                    3,113

signer economic delta after relinquishing stake:
  11,521,984 - 11,531,528 = -9,544
  = target gain 3,113 + manager fee 622 + tx fee 5,809
```

This is a current-binary mainnet spend proof, but it is fully value-backed; it is not an outsider drain.

The relevant route graph is:

1. `LiquidUnstakeStakeAccount`: the input stake authority must sign; the instruction reauthorizes the supplied stake to the pool, pays SOL from the canonical vault, creates the canonical stake-info account, and pays the manager share only to the pool's stored fee account.
2. `WithdrawSol`: the user must control and burn the supplied LP. On the unchanged current binary, the 2026-10-15 signed positive accepted the signer's own LP, while foreign LP, foreign vault, and foreign inventory mutations rejected.
3. `UnstakePoolLsts`: the outsider mutation rejected with `InvalidAuthority`; direct router use still required its signer.
4. Permissionless update/sync paths do not confer withdrawal authority and remained bound to the fixed vault/canonical inventory accounts.
5. No enabled redelegation instruction or successful redelegation trace was identified. The current stake path observed here performs authorize/authorize/deactivate, not redelegation.

## Signed current-fork outsider mutation

The test ran on a local Surfpool fork backed by a public keyless current-mainnet RPC. Its genesis hash is mainnet-beta `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. Fresh ephemeral keys were not saved. The only synthetic funding was the fresh attacker's system balance; the stake account itself was created, initialized, delegated, and signed in the tested Solana transaction. Both cases used `sigVerify:true`; no send method was called.

### Canonical positive control

At fork slot 458,747,797, the transaction created and delegated a 1,002,282,880-lamport stake account, then called the target with the stored manager account.

| Property | Exact value |
|---|---:|
| Result | success |
| Compute | 87,116 CU |
| Solana message version | v1 |
| Serialized signed transaction | 925 bytes |
| Addresses / instructions / signatures | 16 / 5 / 2 |
| Vault delta | -1,003,459,944 lamports |
| Fixed manager delta | +54,123 lamports |
| Attacker delta | -334,739 lamports |
| Retained stake custody | 1,002,282,880 lamports |
| New stake-info custody | 1,447,680 lamports |

Full value reconciliation:

```text
target gain = 1,002,282,880 + 1,447,680 - 1,003,459,944 = 270,616
attacker loss = 334,739 = target gain 270,616 + manager 54,123 + tx fee 10,000
```

There are no LP shares in this route. The caller contributes the entire stake value and ends negative.

### Mutation: substitute the manager-fee recipient

At fork slot 458,747,798, the otherwise equivalent signed v1 transaction replaced the manager fee account with attacker `217MpL2pAfGVoW3vuz6pRF51r9UyXYX6u9F2HEZ51mVd`.

| Property | Exact value |
|---|---:|
| Result | rejected at target instruction index 4 |
| Error | Anchor `ConstraintHasOne`, custom 2001 |
| Logged expected (`Left`) | `F3yy3FVpwq9MV321AzALFcDWZp9XBBHbMas3t4AtEtCW` |
| Logged supplied (`Right`) | `217MpL2pAfGVoW3vuz6pRF51r9UyXYX6u9F2HEZ51mVd` |
| Compute | 37,112 CU |
| Solana message version | v1 |
| Serialized signed transaction | 893 bytes |
| Addresses / instructions / signatures | 15 / 5 / 2 |

The failure is atomic. The simulator does not return meaningful post-account snapshots for this failed case, so none are invented. The runtime log itself identifies the decisive gate: the supplied fee recipient must equal the pool's stored manager account.

## Flash, share, and transaction-size accounting

Both test transactions are far below the requested Solana v1 ceilings of 4,096 bytes and 64 addresses. The successful control uses 925 bytes/16 addresses; the mutation uses 893 bytes/15 addresses.

No stake-share or LP-share issuance occurs in `LiquidUnstakeStakeAccount`; all stake lamports and rent are explicitly reconciled above. No flash repayment is present because the tested route requires the caller to surrender an authority-signed stake account, and the candidate fee-redirection mutation is rejected before payout semantics. Wrapping that account-constraint failure in external flash liquidity cannot change `has_one(manager_fee_account)`.

The target's own flash path is disabled in current state (`flashEnabled=0`, `flashBorrowed=0`). A separate 2026-10-15 read-only quote screen of target `VaultLiquidUnstake` inventory through independent Sanctum unwind routes was negative at 1, 10, and 100 JitoSOL-equivalent raw trade sizes; at 500 and 1,000 the best route no longer used the target. That quote evidence is not presented as a signed execution, but it supplied no reason to expand past the now-decisive authority gate.

## Findings

No reportable security finding was validated. Specifically, the covered paths did not demonstrate:

- an unauthorized SOL-vault beneficiary;
- fee-recipient substitution;
- use of foreign LP or foreign inventory as the signer's own value;
- a redelegation-based custody escape;
- a target-internal flash bypass; or
- a profitable value-unbacked stake/liquid-unstake cycle.

## Evidence and reproduction

- `current-mainnet-refresh.json` — deployment, PDAs, pool state, exact stake/vault/token custody, and current successful mainnet receipt.
- `refresh-current-mainnet.js` — read-only refresh and receipt decoder.
- `signed-fee-route-mutation.json` — complete signed positive/mutation metadata, logs, account snapshots, deltas, and wire measurements.
- `signed-fee-route-mutation.js` — fork setup and reproducible signed cases; it does not broadcast.
- `../../2026-10-15/native-stake-secondary-controllers.json` — original 48,493.545-SOL census.
- `../../2026-10-15/native-secondary-provider-discrepancy.json` — provider disagreement and sampled old accounts.
- `../../2026-10-15/native-secondary-finalized-summary.json` — later finalized 1,285.383-SOL live/public census.
- `../../2026-10-15/vault-liquid-unstaker-route-gate.json` — bounded route quote screen.
- `../../2026-10-15/2rU1o-current.so` — pinned deployed executable payload.

## Limits

- Mainnet state is live. Every quantity is a snapshot at its recorded context slot, not a permanent balance.
- No live target transaction was submitted. The mainnet receipt is historical current-binary evidence; the controlled positive and mutation are signed current-fork simulations.
- A live IDL and a source revision cryptographically matching the executable were not available. Published client/source material was used only to recover candidate layouts; conclusions rest on the pinned executable, live accounts/transactions, and runtime behavior.
- This was the requested decisive-gate audit, not a full binary decompilation or an exhaustive economic search across every external protocol.
- Composer-first scan startup was attempted on 2026-10-15, but the workbench repeatedly returned `selected scan target changed while scan was starting`. This standalone artifact is the degraded-path report; no canonical Composer report is claimed.
- Public/archive RPC disagreement proves inconsistent indexed state for the old census but does not prove the provider's internal root cause.

