# Value-first breadth pass — current state

Updated 2026-10-15. These are bounded, read-only mainnet observations, signed
mainnet-beta `simulateTransaction` results, and localhost simulations. Only
the wallet ATA setup transactions described below were submitted on mainnet;
no flash, swap, or exploit transaction was submitted. Dollar marks are
selected custody balance times a spot or registry price; they overlap with
claims/receipt assets and are **not** liquid exit capacity or proven loss.
The 77,715 executable-ID inventory is a discovery denominator, **not** a list
of audited programs. The verified-token search sampled each mint's top 20
accounts, so it is not a chain-wide custody census.

## Large umbrella programs already covered by bounded reports

The older [top-20 cross-reference](mainnet-program-queue-crossref.json) still
labels several programs "not started." These reports now exist, so another
first-pass binary download or generic flash test would duplicate work. The
marks below are selected, overlapping custody signals, not additive TVL.

| Program | Gross signal | Existing bounded result |
|---|---:|---|
| [Kamino Lend](kamino-current-runtime-audit.md) | ~$1.406b selected | Current-binary flash, obligation borrow/withdraw, and same-transaction refresh tests rejected tested unbacked paths; sampled mainnet cases used `sigVerify:false`. |
| [Jupiter Lend Liquidity family](jupiter-lend-composition-audit.md) | ~$1.121b priced custody | Current-binary composition tested flash pairing, earning-rounding, account partitions, and one DEX oracle consumer; no positive unauthorized net. Coverage is bounded to tested vaults and paths. |
| [Jupiter Perps](jupiter-perps-deep-audit.md) | ~$751.4m | Current-binary exits and v1 flash compositions tested; no novel outsider gain. Mainnet branch simulations used `sigVerify:false`. |
| [Wormhole Token Bridge](wormhole-token-bridge-audit.md) | ~$53.8m priced lower bound | Redemption/claim/custody substitutions rejected in current-deployment `sigVerify:false` simulations. |
| [marginfi / Project 0](marginfi-current-audit.md) | ~$37.1m direct vault lower bound | Source/current-binary review found no novel unprivileged loss path; report simulations were unsigned. |
| [Meteora Dynamic Vault](meteora-dynamic-vault-current-binary-audit.md) | ~$35.2m selected | Owner LP burn and configured operator gates held in current-binary `sigVerify:false` controls. |
| [Raydium CPMM](raydium-cpmm-audit.md) | ~$30.5m priced lower bound | Current-binary swap/LP/flash variants found no unauthorized transfer; reported flash simulations used `sigVerify:false`. |
| [Meteora DAMM v2](damm-v2-current-audit.md) | ~$27.0m selected | Current ELF and 33 current-fixture cases found no unauthorized transfer; flash cases used `sigVerify:false`. |
| [Jito Restaking Vault](jito-restaking-vault-audit.md) | ~$17.8m selected | Tested withdrawal, receipt, epoch and reward paths found no outsider gain; signature modeling used `sigVerify:false`. |

These are **not** whole-program proofs. Signed current-fork work below is
specifically identified; a `sigVerify:false` positive control does not prove
that an outsider can supply its modeled signer.

## Triage decisions from the largest selected custody rows

| Controller or route | Selected gross mark | Current evidence | Next spend |
|---|---:|---|---|
| [jup6QF Ethena custody](jup6qf-current-audit.md) | ~$312.9m | Outsider value-changing paths rejected by signer or position checks; USDe/PYUSD/USDG flash controls explored. | Low until a reachable exit appears. Some mainnet simulations used `sigVerify:false`; do not claim complete signed-fork coverage. |
| [GRASS staking](paths-grass-current-binary.md) | ~$132.7m | Owner-bound pending withdrawal and reward claim; seven-day withdrawal delay; wrong owner/destination and double claim rejected. Current-path simulations used `sigVerify:false`. | Revisit management/drain routes only if an outsider-reachable admin/lock change is found. |
| [Pyth staking](pyth-staking-outsider-signed-fork.json) | ~$123.6m | Fresh outsider signed the deployed `WithdrawStake` shape on a current fork; metadata `has_one=owner` failed before transfer. This is staking custody, not an unattributed treasury. | Low for this withdrawal path; other instructions are not exhaustively covered. |
| [MetaDAO token migrator](gr8t-current-audit.md) | ~$108.1m selected old/new META gross | Verified source and current ELF expose a 1:1 raw-unit user-signed migration. Historical signed transfer and current `sigVerify:false` mutations showed exact input/output accounting; the observed same-mint Project 0 bank is `ReduceOnly`, and full-vault exit quotes show severe slippage. | Low for the tested migration path; selected old/new token balances are inventory for an exchange, not additive loss. |
| [XP1BR](xp1br-audit-report.md) | ~$74.9m | 60 tested cases, including atomic flash/share paths; no positive outsider net. | Low unless a new reachable share accounting edge emerges. |
| [PHY governance](gover-phy-audit/REPORT.md) | ~$45.3m | Current-binary signed outsider tests fail at governance/signature gates; no approved pending spend of these vaults. | Low without a valid governance bypass. |
| [Lifinity LFNTY locker](lfnty-outsider-signed-fork.json) | ~$42.4m | Current deployed `Withdraw` with fresh attacker signer and destination fails stored escrow-owner comparison (`KeyMismatch` 1100) before transfer. | Low for tested withdrawal; `Unlock` and tokenization lifecycle are not dynamically covered. |
| [Mango MultiDistribute](mango-distributor-audit/REPORT.md) | ~$29.85m prior spot mark on MNGO collection vault | Fresh 927,559,196.868289-MNGO vault sample has inbound deposits but no observed spend; configured authority withdrawal burns. Signed local-fork public claims require caller-paid MNGO. A full-vault Jupiter ExactIn quote returned only 25,402.204512 USDC, and a sampled buy→claim→quoted exits lost 3.920286 USDC before costs. | Low for tested release/paid-claim paths. The large spot mark is not liquid loss; published source is not verified byte-for-byte against the current ELF. |
| [ZBCN](zbc-current-audit/zbc-current-audit.md) | ~$28.1m | Vault authorities are signer PDAs of separate 3-of-4 multisigs; signed outsider transfer/approval/execution attempts reject. | Low unless threshold state changes. |
| [Orca xORCA staking](orca-xorca-v1-simulations.json) | ~$18.1m | 26 current-state cases, 22 signed on a fork, produced no positive outsider equity; direct ORCA flash inventory is unavailable. A [cross-asset wrapper](orca-xorca-cross-asset-flash-v1.json) was blocked at quote collection and simulated zero packets. | Revisit if a concrete independent ORCA buy/repay route is found. |
| [Magna Airlock](magna-current-audit.md) | ~$14.4m credible | Current-binary claim mutations bind payment to Merkle-proof beneficiary and vesting counter; exact same-mint flash does not redirect value. Tests used `sigVerify:false`, including synthetic admin branch controls. | Low for selected allocation; no blanket claim about every vesting state. |
| [Loopscale](1oop-current-audit.md) | ~$11.2m | Signed current-fork outsider liquidation fails liquidator raw constraint even when wrapped with ~$12.47m combined USDC flash; withdrawals are authority/share bound. | Low for selected live loan; loan state may change. |
| [Solstice YieldVault](solstice-usx-signed-v1-fork.json) | ~$10.0m | 52 signed current-fork cases accepted by signature verification; zero successful outsider target transactions and no positive post-debt equity. | Low for tested USX/eUSX withdrawal and flash variants. |
| [FOXY staking](foxy-controller-audit/foxy-controller-defensive-audit.md) | ~$9.9m | Signed outsider claim and unstake paths reject owner/NFT or configured signer. | Low for scoped reward vault. |
| [Solayer restaking](solayer-signed-v1-guard-probes.json) | ~$9.8m | Signed outsider receipt substitution and admin probes reject. [Signed bnSOL flash cycles](solayer-bnsol-klend-signed-v1.json) repay lender with zero observed token-account deltas at the tested sizes. | Low for these branches; no entire-program conclusion. |
| [Render bridge circuit breaker](circiq-render-route-gate-report.md) | ~$9.39m prior spot mark | Corrected vault balance is 4,737,097.36923809 RENDER, 10× the old human-unit queue figure; dollar mark had correct units. All 51 sampled postdeploy outflows came through the bridge. A hooked-wallet signed mainnet-beta direct `TransferV0` failed `ConstraintHasOne` 2001 on the bridge-owned breaker owner before transfer. Existing signed-fork claim tests paid the verified message recipient and rejected consumed claims. | Low for direct outsider transfer; bridge proof/recipient and upgrade paths are only bounded, not exhaustively proved. |
| [JanusFI CASH AMM](janusfi-current-math-crosscheck.md) | ~$4.4m | [95 signed outsider cases](janusfi-signed-multiflash-fork.json), including ten full flash repayments, found no positive attacker equity; direct buy/sell requires its DFlow signer. | Low for the tested CASH path. |
| [USDu](usdu-controller-audit-VALT7/REPORT.md) | ~$4.3m | Unstake requires caller-owned receipt shares and cooldown; tested outsider branch rejects. | Low for scoped vaults. |
| [SVSP native stake](svsp-current-mainnet-audit.md) | ~37,508 SOL (~$3.97m spot) | Current checks did not produce a complete outsider stake exit; same-mint flash inventory/DEX route was unavailable for selected active onramps. | Revisit only upon a real same-mint funding route or account-state change. |
| **Bison ETH/USDC venue** | ~$1.06m selected | Post-deploy Jupiter CPI spent the ETH vault. A [direct signed fork screen](bison-direct-signed-screen.json) with fresh attacker and 96, 1k, 10k, 100k, 300k USDC inputs returned success but **zero token deltas** in every case. The cause is unknown; the Jupiter-routed call may require route context. | Reconstruct the routed v1 call and independent ETH exit only if a public, value-moving candidate survives. Direct replay is not a drain. |
| **Validator Bonds native stake** | ~9,756 SOL (~$1.03m spot) | Post-deploy Stake CPI proves controller custody. A [signed current-binary fork attempt](validator-bonds-outsider-operator-screen.json) against `WithdrawStake` failed `InvalidOperatorAuthority` 6003 at config, before value moved (457 B / 10 keys). Candidate [source](validator-bonds-deployed-1989b66/programs/validator-bonds/src/instructions/withdraw/claim_withdraw_request.rs) requires bond/vote authority for request claims; [settlement claim source](validator-bonds-deployed-1989b66/programs/validator-bonds/src/instructions/settlement/claim_settlement.rs) binds recipient stake authorities to a Merkle proof. Source is **not** proved bit-for-bit equal to current ELF here. | Exact current-binary mutation against a live eligible request or settlement; do not classify the whole controller as closed yet. |
| **2rU1o native stake** | ~1,285 SOL (~$0.14m spot) | [Fresh exact-authority snapshot](nonregistry-next-candidates.md) supersedes a materially larger stale archive mark. [Current outsider `SyncInventory` tests](2ru1-sync-inventory-signed-screen-wgeKre55.json) reject with `UnauthorizedSyncInventory` 6066. A four-epoch future fork passes the time gate but historical inventory lists then fail `InvalidStakePoolState` 6047, so no payout branch was reached. | Conditional stale branch remains unproven; historical inventory cannot serve as a positive control after time travel. |

## Smaller live value movers sampled after the umbrella pass

The [76 lower-use custody leads](lower-usage-executable-screen.json) are all still
executable, but their top-holder spot marks are only ranking signals. A [nine
program, 15-vault outflow sample](lower-usage-vault-outflows.json) identified
direct current program-parent outflows for BisonFi CASH, Perena Numéraire,
JupUSD prediction markets, a uniBTC venue, RIV staking, and Archer. Other
selected vaults showed no outflow in the last 15 sampled signatures, which is
not a proof of no withdrawal path.

| Controller / sampled custody | Bounded signed or liquidity result | Next spend |
|---|---|---|
| **JupUSD prediction market**, ~$186k selected | [Fresh-signer `ClaimPayout` test](jupusd-claim-outsider-signed-screen.json) failed Anchor `ConstraintSeeds` 2006 on the position with both original and attacker-owned destination. The source position was previously claimed, so this only rejects the tested mutation. | Low for this replay; other market paths remain. |
| **Perena Numéraire AUSD thin pool**, ~5,375 AUSD current vault | [Five outsider-signed direct swaps and four completed round trips](perena-thin-pool-signed-fork.json) used synthetic fork USDC inventory. At 1,000 USDC, first leg yielded 1,001.557226 AUSD; same-pool unwind ended **−0.199872 USDC** (lender absent). First leg used 528 B / 12 keys, full cycle 568 B / 12 keys. A 10,000 USDC first leg failed 6013. Jupiter quote offered no AUSD→USDC route at tested sizes once Perena was excluded. | Low for AUSD until an independent liquid exit appears; the synthetic inventory is not a funded flash route. |
| **BisonFi CASH prediction AMM**, ~$428k current CASH vault | Historical DFlow CPI moved CASH directly from its vault. Independent CASH→USDC quotes exist. [Fresh-signer direct CPI-shape test](bison-cash-direct-signed-screen.json) with synthetic trader token accounts failed program error 36 before transfer, 721 B / 18 keys. The error cause is unresolved; historical flow uses DFlow and temporary accounts. | Reconstruct a full DFlow route only if a specific accounting defect emerges. Do not label error 36 an authorization gate without proof. |
| **RIV staking**, ~$988k stale selected mark | [Fresh-signer `ClaimRewards` tests](riv-reward-outsider-signed-screen.json) failed Anchor `ConstraintSeeds` 2006 on `lock` with both original and attacker destination; original claim moved 2,108.635264 RIV, but the outsider mutations moved none. Current Jupiter quotes gave about $3,526 USDC for 1m RIV and $30,345 for 10m RIV, showing the registry mark is not realizable exit value. | Low for tested claim; lock creation and release have separate rules. |
| **BIRB staking `tbg7LYo`**, ~$799k sampled token mark | A [wallet-signed mainnet-beta `Withdraw` test](birb-outsider-mainnet-signed-report.md) against a current 15,175,464.870338-BIRB vault and funded 7,596.06-BIRB stake position failed Anchor `ConstraintSeeds` 2006 on the stake PDA before transfer. The stake PDA derives from the original depositor, and the watched chain accounts remained unchanged. | Low for this outsider mutation; other handlers and positions remain untested. The sampled mark is not proven loss. |
| **SwissBorg MEX proxy**, ~$683k sampled token mark | The [current MEX screen](mex-swissborg-proxy-signed-mainnet-report.md) found a PDA-owned BORG vault with a quoted full-balance exit of 199,064.711617 USDC. Published IDL/live state bind `withdraw` to a treasurer and `swap_route_with_whitelisted_mint` to a trader. A hooked-wallet signed mainnet-beta one-unit BORG withdrawal failed `NotTreasurer` 6002 before transfer. | Low for outsider-controlled exit at current roles. The full-vault quote is not realizable profit or loss. |
| **8ybMhmt USD* route controller**, ~$377k selected | Current on-chain IDL exposes external-protocol deposit/withdraw adapters. A [wallet-signed mainnet-beta Perena withdrawal](8yb-perena-signed-mainnet-report.md) without receipts failed `BurnChecked`. A stronger signed atomic KLend flash/deposit/full-receipt-burn/withdraw/repay packet fit at 1,537 B / 36 keys: 1,000 USDC minted 906.459267 internal LP; burning all of it returned 999.499999 USDC, **0.500001 USDC short** of zero-fee lender principal. A larger **1,000,000 USDC** flash deposited and redeemed all 906,459.267419 LP, returning 999,500 USDC, **500 USDC short**. Both packets reverted at repayment. The receipt mint authority is the route vault PDA. The published IDL payload length differs from the historical live payload, so coverage is limited to the exact tested calls. | Low for the tested Perena cycle at these sizes; other adapters and market states remain untested. |
| **BisonFi current wSOL/USDC pool**, ~2.44m USDC and 21,113 wSOL in the sampled pool | [Seven fresh-signer direct calls](bison-wsol-usdc-current-signed.json) all fail `MissingRequiredSignature` at 213 CU before transfer. [Account-flag diagnostic](bison-wsol-usdc-signer-flags.json) isolates required signer to off-curve account 8; marking it signer only with `sigVerify:false` executes, so this is not an outsider-executable positive. | Check a reachable DFlow wrapper only if it exposes a specific accounting defect; more direct input-size sweeps cannot cross this signer gate. |
| **AlphaQ CASH/USDC pool**, ~300k USDC in sampled self-authorized vault | A [fresh signed direct replay](alphaq-cash-usdc-signed.json) of the 99.02 CASH→USDC call failed `InvalidAccountOwner` before transfers (534 B, 12 keys). [Repeating with the historical user-account extension layout](alphaq-cash-usdc-signed-source-template.json) failed identically. | Root cause of this direct failure remains unresolved; test an outer DFlow route only if the current pool math or account substitution supplies a concrete gain candidate. |
| **Archer USDv/USDC orderbook route**, ~80k of each side | [Fresh-signer direct tests](archer-usdv-direct-signed.json) can swap, but the independent Jupiter USDv→USDC exit returns less than the direct input at tested sizes; the 39,812 USDv output yielded ~39,808.757 USDC, about $5.065 short after both legs. | Low until a better independent exit or crossed order exists; this is an orderbook route, not CPMM inventory. |

## Arb and routing program flow screen

[Activity density](arb-router-signature-density.json) counted the latest 1,000
address signatures: DFlow ~1,000/min, Propeller ~476/min, Titan ~104/min,
and a sampled MEV route ~34/min. These are signature rates, not economic volume.
The [12-of-1,000 downstream-transfer sample](arb-downstream-value-sample.json)
found only small major-token transfers in its bounded window; it cannot
establish daily value-at-risk. The [immediate-parent transfer screen](arb-router-flow-census.json)
separates direct program-controlled sends from delegated/user sends.

| Route | Current authority/custody observation | Triage |
|---|---|---|
| **DFlow** | Four direct token transfers in 12 latest parsed transactions; no transfer authority in this sample was an account owned by the DFlow program. The two [off-curve source accounts](arb-unresolved-pda-sources.json) currently held only 0.087730 and 0.223392 USDC. Sampled major-token route gross was ~$848 across 11 successful, spaced transactions, mostly downstream venue transfers. | High call frequency, but no large standing program-controlled vault yet identified. |
| **Propeller** | Nineteen direct transfers in 12 latest parsed transactions; none had a program-owned authority account. Ten off-curve transfer observations resolved to the same token authority with [current sources](arb-unresolved-pda-sources.json) of ~1,928.44 USDC and 6.6601 wSOL. Sampled major-token downstream gross ~$1,239 across 11 successful, spaced transactions. | Current sampled source balances are small; seek larger authority sources before a costly route reconstruction. |
| **Titan** | Eight direct transfers in the latest sample were signed by one program-owned PDA. That PDA owns 132,049 token accounts, but only 2,210 had nonzero balances and each of those held a distinct mint. Current major balances there were ~3,227 USDC, ~1,350 USDT and 9.206 wSOL; [balance summary](arb-router-authority-balances-summary.json). | Genuine program-directed token movement; material current major-token custody is much smaller than the account count suggests. Outsider invocation gate remains under test. |
| **Onchain DEX V2 / 1qb** | Eleven direct transfers in 12 sampled transactions used program-owned PDA accounts. Sampled PDAs currently hold ~73,314 USDT plus ~12,902 USDC and ~8,466 USDS, among smaller balances. Its latest 1,000 address signatures span ~10.5 days. A [fresh signed outsider swap](onchaindexv2-signed-gate.json) paid 0.892432 USDC and received 0.893142 USDT, with vault deltas matching. A [signed size probe](onchaindexv2-size-probe.json) found 100 USDC→100.012438 USDT and 1,000→1,000.104212, but 10k and 50k inputs already yield less USDT than USDC spent; 70k aborts with program OOM. [Independent read-only exits](onchaindexv2-independent-usdt-exit-quotes.json) return 99.915625 USDC for 100.012438 USDT and 999.135781 USDC for 1,000.104212 USDT. A [signed vault-as-user-source substitution](onchaindexv2-vault-source-substitution.json) rejects with `UserVaultXMismatch` 6028 before transfer. A [wallet-signed mainnet-beta zero-fee KLend flash test](onchaindexv2-mainnet-signed-gate.md) funded the public 892,432-raw-USDC swap; it paid 893,142 raw USDT, while the independent exit quoted only 892,280 raw USDC. Repayment failed and rolled back. | The tested swaps are input-paid trades, not a drain. The 0.892432 USDC mainnet flash route was 152 raw USDC short of principal before costs; the tested 100 and 1,000 USDC round trips also lose 0.084375 and 0.864219 USDC before fees. Vault-source spoofing fails. Stop this pair unless market quotes or account state change. |
| **Sampled MEV route** | No immediate-parent token transfers in the latest 12 parsed transactions; downstream swap transfers exist. | Treat as composition/orchestration until a program-signed balance is identified. |

## Historical propAMM wrapper replay gates

The [AlphaQ DFlow replay](alphaq-dflow-signed-route.json) used one fresh signer,
replaced its four user token accounts, and fit at 2,197 B / 57 keys. DFlow
rejected `InvalidInstructionData` 15999 before AlphaQ CPI. Removing the
historical RecordId action [also rejected](alphaq-dflow-signed-route-no-recordid.json).
A [replay signed by the user's `~/hooked.json` wallet](alphaq-dflow-hooked-signed-route.json)
hit the same DFlow error at 2,197 B / 57 keys. The secret key was loaded at
runtime and was not written into either artifact. These failures may reflect
stale route data or account conditions; they do not establish an AlphaQ drain.

The first [Bison DFlow replay](bison-dflow-fresh-signed.json) used a fresh
signer but kept the old Pump user-volume PDA, so Pump rejected its seeds
before Bison CPI. The user's wallet has its own derived Pump PDA. A
[wallet-signed replay](bison-dflow-hooked-signed.json) using that PDA passed
the seed check but found it 498,200 lamports below current rent exemption.
Adding an ordinary wallet-signed System transfer of 498,200 lamports inside
the same 1,583 B / 37-key packet [passed that check](bison-dflow-hooked-renttop-signed.json),
then Pump `SellV3` rejected with `Overflow` 6024 before Bison CPI. This is a
historical route on an earlier-slot fork; neither result proves a current
outsider gain. No mainnet transaction was submitted.

A [Bison JUP6 replay on a newer fork](bison-jup6-hooked-freshfork-signed.json)
used the wallet signer and its own Pump PDA. The two venue swaps and BisonFi
token CPIs executed, then Jupiter returned custom 6001. Atomic rollback left
all watched token balances unchanged. This establishes reachability of the
Bison CPI through this historical wrapper, but no completed gain.

## Wallet ATA and flash controls on mainnet-beta

The six wallet ATAs needed across selected routes are WETZ, PUMP_B, wSOL,
Jupiter's `6p6x` intermediate mint, PUMP_A, and CASH. WETZ is
`WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U`; `6p6x` is a distinct
Jupiter route mint. The wallet was funded after an initial six-ATA simulation
failed for insufficient lamports. The saved
[signed six-ATA mainnet-beta simulation](hooked-mainnet-ata-init-sim.json)
then passed. The
[ATA-only transaction](hooked-mainnet-six-ata-creation.json) was then submitted
on mainnet-beta and finalized with signature
`2tDLC8CBkE5utHQBsFRjJ4UQ8AXmQAADo7UPWFLfFbSHCiqAk3s7cvaTWwetTHbSD4vqoLUws1EGHSqstoRx21wr`.
All six expected mint/owner ATAs existed after confirmation. Rent was
9,032,240 lamports and the fee 5,000 lamports; the wallet fell from
145,244,648 to 136,207,408 lamports. The resulting ATAs are empty.
The user later used the wallet and its wSOL ATA was closed in a separate
transaction. At the user's request, a [second ATA-only transaction](hooked-mainnet-wsol-recreation.json)
recreated **only wSOL**; signature
`39fzgXVgBimTwHkToLxtHHPkK9LXy4dyyvD8bgQP97hc64EzuauK5EG6Bw2PsHf1Y42hRAaFL3q6s1kPPzUp1y5h`
finalized. The post-check again found all six ATAs. This later transaction
locked 1,488,440 lamports as recoverable rent and paid a 5,000-lamport fee.

A [signed zero-fee KLend control](hooked-mainnet-klend-3ata-close-flash-sim.json)
created the `6p6x`, PUMP_B, and wSOL ATAs, borrowed 1 USDC, repaid exactly 1
USDC, and closed the empty ATAs inside one mainnet-beta simulated transaction.
It succeeded with signature verification, 858 wire bytes, 20 keys, and
107,972 compute units; user and lender token balances remained unchanged.
The three-ATA variant [without closes](hooked-mainnet-klend-ata-flash-sim.json)
reached repayment but rolled back for payer rent insufficiency. These are
earlier execution controls, not AMM trades or profit. Neither flash simulation
changed the real chain. They were run **before** the permanent ATA creation.

The [HumidiFi WETZ/USDC signed local-fork swap](humidifi-wet-focused-screen.md)
did move value, but an independent Meteora DAMM v2 exit quoted a loss. A later
read-only Jupiter quote screen at mainnet slots 457397502–529 found both
directions negative before fees at 2.5, 100, 1,000, and 10,000 USDC input.
The tested HumidiFi-buy/independent-sell deltas were −0.024890, −1.023531,
−12.812845, and −388.367909 USDC, respectively; the reverse direction lost
−0.034956, −1.427673, −16.988281, and −433.052995 USDC. There is no
positive candidate from this pair at those quotes.

Fresh read-only direct-route quote chaining also screened the major BisonFi
wSOL/USDC pool against independent direct exits in [both directions](bison-wsol-usdc-cross-venue-quotes.json).
At 100, 1,000, 10,000, and 100,000 USDC starts, every USDC→wSOL→USDC route
was negative before flash and transaction fees: the closest was −0.004831
USDC at 100 USDC, and the 100,000 USDC tests lost 58.590236–91.239600 USDC.
An [AlphaQ CASH/USDC direct-route screen](alphaq-cash-usdc-cross-venue-quotes.json)
was likewise negative in both directions at 100, 1,000, and 10,000 USDC;
the closest lost 0.000506 USDC at 100 USDC. Jupiter returned no direct AlphaQ
route at 100,000 USDC. These quote screens are not signed transaction tests;
they reject these immediate cross-venue price candidates at the sampled
slots rather than establish program-wide safety.

The [Numeraire sUSD entry/exit quote screen](numeraire-susd-entry-exit-quotes.json)
found a Raydium CLMM quote of 110.141337 USDC for 100 sUSD, but no quoted
USDC→sUSD route at 1, 100, or 1,000 USDC and no USDC↔BenJy route at 100
USDC. Numeraire's [current onchain IDL](numeraire-current.idl.json) and
[finalized pool account](numeraire-susd-pool-accounting-snapshot.json) show
this public two-asset pool has sUSD and BenJy vaults. The quoted premium is
one-way and small in executable depth: Jupiter returned no sUSD→USDC route
at 1,000 sUSD. There is no verified way in this screen to acquire and repay
sUSD inside one flash-funded packet, so this is a price lead only, not a
profit or drain result.

A separate [Numeraire USDS pool gate](numeraire-usds-quote-gate.json) found a
live program-controlled vault of 59,413.390398 USDS. Its sampled token
outflow came from an LP-holder-signed `remove_liquidity` call. USDC↔USDS
quotes existed at the tested sizes, but the needed USDS→sUSD route returned
`NO_ROUTES_FOUND` at 100 USDS. This is a read-only quote and authority gate
for another pool of the already-covered controller, not a new-program audit.

A [read-only Obsidian venue screen](obsidian-wsol-usdc-cross-venue-quotes.json)
checked direct wSOL/USDC routes against independent exits at 10, 100, 1,000,
and 10,000 USDC starts. Every completed cycle was negative before fees; the
closest lost 0.012389 USDC at 10 USDC. Jupiter selected two different
Obsidian pool keys by direction, so this is a venue price screen rather than
a single-pool invariant test.

A [targeted TesseraV route screen](propamm-next-liquid-major-screen.md)
found public direct swaps but no program-controlled major-token vault in the
bounded pool-owner check. Direct TesseraV/Scorch round trips at 100 and
1,000 USDC lost 0.081701–1.703100 USDC before fees across both directions.
This is a selection and price gate, not a whole-program audit.

Two distinct [TesseraV major-pair pools](tessera-major-pairs-screen.md)
were then traced to a shared off-curve, TesseraV-owned token authority with
current vaults holding 4,272,860.140011 USDC, 61,496.238676257 wSOL,
and 2.23891847 cbBTC at slot 457413461. Recent pool transactions include
direct TesseraV-parent token outflows. Eleven of twelve specified-pool
round-trip quotes against independent venues lost before costs. A lone
1-wSOL quote showed +8,684 lamports gross; the same size rechecked at
−42,929 lamports, and five neighboring sizes also lost. No persistent
after-cost candidate reached signed atomic simulation. Vault balances
are custody signals, not proven extractable equity.

The current GoonFi V2 wSOL/USDC pool has a program-controlled authority with
4,087.559245480 wSOL and 332,459.119307 USDC in its vaults at confirmed
slot 457405829. A [hooked-wallet signed mainnet-beta top-level swap](goonfi-v2-major-vault-signed-mainnet-report.md)
wrapped and paid 0.005 wSOL for 0.528167 USDC; the 641 B / 15-key packet
succeeded with `sigVerify:true`. This proves public swap reachability for
that pool, not a completed flash cycle or unauthorized gain. The actual
mainnet vaults were unchanged after the simulation. An [exact-pool economic
screen](goonfi-v2-cross-venue-economics.md) at 10–250,000 USDC starts
found only tiny, unstable positive quotes near 100 USDC. One was
+0.000658 USDC gross; the recheck was +0.000384 USDC, below the sampled
minimum 5,000-lamport base fee of ~0.000530 USDC. A flash packet was not
justified by those quotes; other GoonFi instructions remain untested.

Two further [GoonFi V2 major pools](goonfi-v2-eth-cbbtc-economic-gate.md)
were independently mapped to current program-owned states and SPL vaults:
USDC/ETH held 180,975.584871 USDC and 7.99275958 ETH; USDC/cbBTC held
161,094.310982 USDC and 0.64471910 cbBTC. Exact-pool direct GoonFi swaps
chained with independent direct exits in both orders at 100, 1,000, 10,000,
and 100,000 USDC starts were all negative or had no first-leg route. The
closest gross result was −0.004605 USDC before fees. These are quote-level
price gates, not signed flash simulations or whole-program proofs.

A [fresh Byreal CRCLx/USDC gate](byreal-current-gate-report.md) corrected the
earlier queue's CRCLx human-unit count: the mint has 8 decimals, so the
current vault's 1,455,385,637,578 raw units are **14,553.85637578 CRCLx**.
The prior dollar mark had already used the correct decimals. The current
Byreal/Raydium gross spot gap was only 0.40279 basis point before costs.
Earlier complete signed fork packets borrowed KLend USDC, swapped on Byreal,
sold on Raydium, repaid, and lost 0.816609–13,318.943176 USDC across
200–200,000 USDC inputs. This closes that specific route at the tested
states; other Byreal pools and liquidity paths remain open questions.

The STAND DUSD controller's public `AckRemoteCall` was replayed with the
historical post-deployment payload but the hooked wallet as signer and
recipient in a [signed mainnet-beta simulation](stand-ack-hooked-mainnet-sim.json).
The 555 B / 11-key packet failed its `signer` VO role check (custom 6001)
before a vault transfer. A prior fresh-signer fork case reached the same
role check; this does not rule out other STAND handlers or bridge-proof flaws.

A [current Fragmetric JSOL instant-exit gate](fragmetric-core-current-audit/instant-exit-gate-report.md)
found the fund accepts JSOL deposits but has direct JSOL withdrawal disabled.
Its SOL withdrawal route requires a user-owned request, queued batch
processing at a 72,000-second interval, and a 20-basis-point fee. Receipt
unwrap returns another receipt rather than JSOL. These live settings block
the tested same-transaction deposit→JSOL/SOL exit needed to repay a flash;
no signed mainnet packet was run. Exceptional admin or force-reset paths
remain outside this gate.

The selected [Loopscale USD.infra Strategy vault](1oop-current-recheck-20261015.md)
now holds 8,494,382.242708 USD.infra and is still controlled by the same
deployed program state. The recent five-transaction sample found a 100-unit
deposit and no outflow. The [existing deeper audit](1oop-current-audit.md)
already tested outsider withdrawal variants on a signed local fork and hit
signer/admin gates, so this recheck did not repeat them.

For the separate Helium [HNT/IOT circuit breaker](circab-helium-owner-gate-report.md),
the onchain IDL and live breaker states bind vaults to required owner accounts
controlled by other programs. A hooked-wallet signed mainnet-beta replay of
a successful IOT `TransferV0`, with the owner replaced, failed
`ConstraintHasOne` 2001 on the breaker in a 331 B / 6-key packet before
transfer. This rejects that outsider substitution, not every upstream
distribution or configuration path.

The selected [LYC8 USD* bank holding](lyc8-usdstar-route-report.md) held
137,186.896099 USD* at confirmed slot 457408651. Its token authority is an
off-curve, program-owned `YieldingBank` with USDC base and USD* default
redemption. The onchain IDL permits user minting against a `Token` state's
configured collateral and synchronous burning back to that same collateral;
asynchronous redemption needs manager processing. A targeted live-state
filter, checked against a known positive control, found **no USD*-collateral
Token**. The sampled bank shareholders instead use four other collateral
mints, so a same-mint USD* flash cannot enter the proposed direct
mint→redeem route. No signed flash simulation was run after this account
configuration gate. This does not cover account substitution or other bank
instructions.

A further [Kipseli wSOL/USDC pool screen](kipseli-wsol-usdc-cross-venue-quotes.json)
started from a live pool authority holding ~272,368 USDC and 558 wSOL
([account snapshot](new-amm-pool-owner-balances.json)). Direct Kipseli swaps
followed by an independent exit, and the reverse order, quoted negative at
100, 1,000, and 10,000 USDC input; the closest was −0.025539 USDC before
transaction costs at 1,000 USDC. At 100,000 USDC, one direction had no direct
route and the other quoted −41.108329 USDC. This is a price screen only; no
signed Kipseli instruction was run.

A fresh [major-pair direct-route discovery](major-direct-route-discovery.json)
and [second batch](major-direct-route-discovery-batch2.json) used 32
read-only Jupiter quotes and pool-account owner reads. They surfaced a
distinct SolFi V2 USDC/USDT pool and further GoonFi V2 and TesseraV
major-token pools for current vault/economic gates. The best direct route
alone does not enumerate every pool or establish program-signed custody.
The newly surfaced Scorch wSOL/JUP pool was separately
[screened against independent exits](scorch-wsol-jup-cross-venue.json) in
both orders at 0.1, 1, 10, and 100 wSOL. All eight completed quote chains
were negative before fees; the closest lost 0.000070938 wSOL at 0.1 wSOL.
No signed Scorch packet was justified by that price screen.
One later independent wSOL/USDC quote identified a Flux-labeled pool
`F3ds62W3NNEBQrwi2ZFy2vX3xu5fxL6f7VMtRdmKjoCv`. A bounded current
read found its program-owned pool account and pool-authorized SPL accounts
with 107.172038105 wSOL and 17,157.581602 USDC at slot 457413782.
No postdeploy Flux-signed outflow or profitable route was established in
this small selection check, so it is not counted as a tested controller.

The new [SolFi V2 USDC/USDT pool gate](solfi-v2-current-gate.md) verified
current program-controlled vaults with 278,311.684364 USDC and
472,162.607117 USDT and a postdeploy SolFi-signed USDT outflow. Exact-pool
SolFi→independent direct quotes returned only **+0.000132 USDC gross** on a
100-USDC start, below the sampled one-signature base fee of about
0.000529 USDC. At 1,000 and 10,000 USDC, both route orders lost before
fees. A signed flash packet was stopped at this economic gate; this is a
pool-specific price result, not a whole-program conclusion.

The authority census raw snapshot was compressed to
[JSON.gz](arb-router-authority-balances.json.gz) after writing the compact
summary. Gross transfer marks include both legs of a route and are not
profit, TVL, or an upper bound on loss.

## Atomic price-movement leads still needing an independent consumer

| Route | Signed, `sigVerify:true` one-transaction result | Decision |
|---|---|---|
| [Jupiter DEX v93 PST/USDC reverse](jupiter-dex-v93-reverse-signed-fork.json) | Borrowed and repaid the exact 31,300,411.590350 PST zero-rate KLend flash. At $3.45m USDC output, first oracle +10.727 bp; completed unwind left attacker **−605.833432 PST**, lender delta zero, 1,391 B / 33 keys. | Oracle can move; no independent B consumer/repay route or profitable equity demonstrated. |
| [Jupiter DEX v97 reUSD/USD](jupiter-dex-v97-signed-fork.json) | Borrowed/repaid exact 9,929,955.938930694 reUSD zero-rate KLend flash. $3m USD output first oracle +2.962 bp; completed unwind **−1,083.066653 reUSD**, lender delta zero, 1,357 B / 32 keys. [Larger probes](jupiter-dex-v97-boundary-signed-fork.json) reached +7.11 bp on the first swap at $3.97m but reverse swap failed 6028, rolling back the atomic packet. | Only the ≤$3m full route is an executable negative control; larger intermediate quotes are not value realized. |

No tested outsider path above produced a validated unauthorized drain. The
supported statement is **$0 proven immediately at risk in these tests**, not
that all programs or routes are safe. A finding needs a current deployed-binary
path, outsider-controlled inputs, full v1 packet under 4,096 B / 64 keys,
every lender repaid, and final attacker/protocol equity reconciled. Flash
capital does not replace a missing owner/admin signature or Merkle proof.

## Throughput and evidence limits

The account's weekly plan usage is at 100%, although credits are available.
Three subagents originally errored at the limit; two were restarted after the
user's top-up and completed narrow BisonFi and 1qb checks. The remaining
errored assignment is **not** a completed review. Breadth triage prioritizes public
value-changing handlers and independent exits before expensive binary
reconstruction. Historical CPI success, vault marks, and packet-size
estimates alone are leads, never exploit results.
