#!/usr/bin/env python3
"""Summarize read-only stake-controller evidence beyond the token census."""
import json
from datetime import datetime, timezone
from pathlib import Path
import requests

DIR = Path(__file__).parent
secondary = json.loads((DIR / 'native-stake-secondary-controllers.json').read_text())
fresh = json.loads((DIR / 'native-secondary-finalized-recheck.json').read_text())
discrepancy = json.loads((DIR / 'native-secondary-provider-discrepancy.json').read_text())
traces = json.loads((DIR / 'native-stake-residual-triage.json').read_text())
unverified = json.loads((DIR / 'unverified-active-token-controller-census.json').read_text())

env = dict(line.split('=', 1) for line in Path('/tmp/composer-helius-rpc.env').read_text().splitlines() if '=' in line)
rpc_url = env['RPC_URL']
ids = [secondary[k]['programId'] for k in ('vaultLiquidUnstaker', 'singlePool', 'validatorBonds')]
rpc = requests.post(rpc_url, json={'jsonrpc':'2.0','id':1,'method':'getMultipleAccounts','params':[ids,{'encoding':'base64','commitment':'confirmed','dataSlice':{'offset':0,'length':0}}]}, timeout=30).json()
if 'result' not in rpc:
    raise RuntimeError('program RPC read failed')
program_read = {pid: {'executable': info['executable'], 'owner': info['owner']} for pid,info in zip(ids,rpc['result']['value']) if info}
slot = rpc['result']['context']['slot']

verified = requests.get('https://lite-api.jup.ag/tokens/v2/tag?query=verified',timeout=20).json()
wrapped = next(x for x in verified if x['id']=='So11111111111111111111111111111111111111112')
sol_price = wrapped['usdPrice']

specs = [
  ('vaultLiquidUnstaker', '2rU1o liquid unstaker', '9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb', 'deactivate'),
  ('singlePool', 'Solana single-validator stake pool', 'E7c64FTgM5hHHNk2t2BzikarqT36dxRSAyR1ac25uy28', 'moveLamports'),
  ('validatorBonds', 'validator bonds', '7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH', 'withdraw'),
]
rows=[]
for name,label,authority,ix_type in specs:
    x=secondary[name]
    current=fresh['family'][name]
    residual = next(y for y in traces['results'] if y['authority']==authority)
    proof = next(y for y in residual['directControllerProofs'] if y['stakeInstructionType']==ix_type and y['outerProgramId']==x['programId'])
    pools = x.get('pools',[])
    config = x.get('configs',[])
    row = {
      'programId':x['programId'],'label':label,'currentExecutable':program_read[x['programId']]['executable'],
      'loaderOwner':program_read[x['programId']]['owner'],'programReadSlot':slot,
      'nativeGrossSolAtFinalizedRecheck':current['grossNativeSol'],
      'stakeSolAtFinalizedRecheck':current['stakeSol'],
      'nativeGrossSolAtOlderProviderCensus':x.get('grossNativeSol',x['stakeSol']),
      'stakeSolAtOlderProviderCensus':x['stakeSol'],
      'freshStakeAccountCount':current['stakeAccountCount'],
      'freshPoolOrConfigCount':current['poolOrConfigCount'],
      'freshFinalizedSlotRange':[fresh['contextSlotMin'],fresh['contextSlotMax']],
      'grossSpotMarkUsd':current['grossNativeSol']*sol_price,
      'valueScope':'fresh exact-authority finalized Stake scan plus current SOL vault/onramp, bounded known pools/configs; not realizable loss',
      'selectedAuthority':authority,
      'selectedStateAtOlderCensus':(pools or config)[0],
      'selectedFinalizedAuthority':next((z for z in fresh['authorities'] if z['family']==name and z['authority']==authority),None),
      'historicalDirectStakeCpi':proof,
      'signerEvidence':'successful inner Stake CPI from this program with the selected off-curve authority as Stake instruction authority; signer attribution is specific to this historical instruction, not arbitrary spend access',
      'outsiderDrainValidated':False,
      'dedicatedDaybreakAssignmentSeen':False,
      'uncertainty':'Archive RPC and live RPC materially disagree on old Stake accounts. The fresh finalized value is used. Current-binary outsider-callable withdrawal accounting and transaction-v1 full composition have not been established.',
    }
    rows.append(row)
rows.sort(key=lambda x:-x['nativeGrossSolAtFinalizedRecheck'])
output={
 'generatedAt':datetime.now(timezone.utc).isoformat(),'readOnly':True,
 'sources':['native-stake-offcurve-census.json','native-stake-secondary-controllers.json','native-secondary-finalized-recheck.json','native-secondary-provider-discrepancy.json','native-stake-residual-triage.json','unverified-active-token-controller-census.json'],
 'providerCrosscheck':discrepancy,
 'unverifiedActiveTokenScan':{k:unverified[k] for k in ('intervalRows','verifiedMintCount','uniqueUnverifiedTradedMintCount','queriedTokenAccountCount','liveMintBoundTokenAccountCount','offcurveAuthorityCount','contextSlotRange')},
 'unverifiedActiveTokenDirectControllerCount':len(unverified['controllers']),
 'novelUnverifiedActiveTokenDirectControllerCount':sum(not x['priorVerifiedCensusController'] for x in unverified['controllers']),
 'solSpotPrice':{'source':'Jupiter Token V2 verified registry, wrapped SOL','usdPrice':sol_price,'priceBlockId':wrapped['priceBlockId'],'updatedAt':wrapped['updatedAt']},
 'rankedNewDedicatedCandidates':rows,
 'limits':['The 63 unverified mints are only the top 100 traded in each of four windows, not every unverified mint.',
           'A program owning a state account or signing one historical CPI does not establish an outsider withdrawal path.',
           'The SOL USD marks are separate, non-atomic spot marks and must not be added to LST receipt custody.',
           'The older archive-RPC Stake census materially overstated 2rU1 and validator-bonds custody relative to a fresh exact-authority finalized live-RPC recheck. The old values are retained only for provenance.',
           'These IDs were not separately assigned among the 56 dedicated Daybreak tasks at the assignment snapshot; broad native-stake discovery already observed them.'],
}
(DIR/'nonregistry-next-candidates.json').write_text(json.dumps(output,indent=2)+'\n')

def n(v): return f'{v:,.3f}'
md = [
 '# Next Solana controllers outside the verified-token top-holder census',
 '',
 f'Read-only evidence refreshed at Solana slot **{slot:,}** for executable status. Native-stake balances were independently rechecked by exact withdraw authority at finalized slots **{fresh["contextSlotMin"]:,}–{fresh["contextSlotMax"]:,}**. No transaction was submitted.',
 '',
 '## Discovery scope',
 '',
 f'- Jupiter Token V2 top-100 traded lists across 5m, 1h, 6h, and 24h yielded **{unverified["uniqueUnverifiedTradedMintCount"]} unique mints absent from the 3,987-mint verified registry**. Their top-20 read returned {unverified["queriedTokenAccountCount"]:,} token-account addresses, {unverified["liveMintBoundTokenAccountCount"]:,} current mint-bound accounts, and {unverified["offcurveAuthorityCount"]} off-curve authorities. All {len(unverified["controllers"])} direct executable state owners were already in the prior controller census; **zero new program IDs** from this bounded token lane.',
 '- The earlier native Stake scan read 1,454,190 initialized/delegated accounts across 256 filtered shards. Its Helius archive endpoint disagreed materially with the fresh finalized live RPC. Rankings below use **only the fresh exact-authority recheck**.',
 f'- The optional dollar marks below use Jupiter wrapped-SOL spot ${sol_price:.6f} at price block {wrapped["priceBlockId"]}. They are price-times-native-balance signals only.',
 '',
 '## New dedicated targets ordered by bounded native value',
 '',
 '| Rank | Current executable controller | Selected controlling state | Bounded native custody | Historic direct Stake CPI evidence |',
 '|---|---|---|---:|---|',
]
for i,r in enumerate(rows,1):
    p=r['historicalDirectStakeCpi']; state=r['selectedStateAtOlderCensus']; auth=r['selectedAuthority']
    anchor=state.get('pool') or state.get('config')
    md.append(f'| {i} | `{r["programId"]}` ({r["label"]}) | `{anchor}`; authority `{auth}` | **{n(r["nativeGrossSolAtFinalizedRecheck"])} SOL** (~${r["grossSpotMarkUsd"]/1e6:.2f}M spot) | Successful inner Stake `{p["stakeInstructionType"]}` from this program, slot {p["slot"]}, tx `{p["signature"]}` |')
md += [
 '',
 f'The single-validator controller has 57 canonical verified pool PDAs holding {fresh["family"]["singlePool"]["stakeSol"]:,.3f} SOL of stake plus 2.724 SOL in onramp stake accounts. Validator Bonds has {fresh["family"]["validatorBonds"]["poolOrConfigCount"]} decoded configurations with {fresh["family"]["validatorBonds"]["stakeSol"]:,.3f} SOL of Stake accounts and a verified `bonds_authority` PDA. The 2rU1o pool PDA is program-owned and currently governs only {fresh["family"]["vaultLiquidUnstaker"]["stakeSol"]:,.3f} SOL across {fresh["family"]["vaultLiquidUnstaker"]["stakeAccountCount"]} stake accounts; its separate derived SOL vault held 691.992 SOL. Full account and seed evidence is in the machine file and `native-secondary-finalized-recheck.json`.',
 '',
 '## Correction to earlier custody marks',
 '',
 f'The older archive-RPC snapshot reported 2rU1o at **48,493.545 SOL** (2,542 Stake accounts), but the current live-RPC exact-authority finalized query returns **{fresh["family"]["vaultLiquidUnstaker"]["grossNativeSol"]:,.3f} SOL** (63 Stake accounts plus the SOL vault). The earlier Validator Bonds mark was **13,401.364 SOL** versus a fresh **{fresh["family"]["validatorBonds"]["grossNativeSol"]:,.3f} SOL**; single-pool remains ~37,508 SOL. The older numbers must not be used as current custody marks.',
 '',
 f'The archive RPC still returned {discrepancy["providers"]["archive_rpc"]["gpaCount"]:,} 2rU1o Stake accounts at finalized slot {discrepancy["providers"]["archive_rpc"]["gpaContextSlot"]:,}, while the live RPC returned {discrepancy["providers"]["live_rpc"]["gpaCount"]} at slot {discrepancy["providers"]["live_rpc"]["gpaContextSlot"]:,}. All three stored old 2rU1o examples are absent on both live and public RPC. One old example’s most recent indexed signature is slot {discrepancy["oldSampleMostRecentIndexedSignature"]["slot"]:,}; only {len(discrepancy["poolSignaturesAfterArchiveSnapshot"])} transactions mentioning the pool are indexed after the archive snapshot, and all four have zero inner Stake instructions. The evidence does not support assuming a recent 47,000 SOL withdrawal. Provider account-index lag or inconsistency is the leading explanation; the exact cause is not proven. The fresh finalized state is the ranking source.',
 '',
 f'Public Solana RPC independently matched the largest selected live stake-authority buckets: SVSPx {int(discrepancy["providers"]["public_rpc"]["majorAuthorityStakeQueries"]["SVSPx_selected"]["lamports"])/1e9:,.3f} SOL across {discrepancy["providers"]["public_rpc"]["majorAuthorityStakeQueries"]["SVSPx_selected"]["accountCount"]} accounts, and Validator Bonds {int(discrepancy["providers"]["public_rpc"]["majorAuthorityStakeQueries"]["vBoNd_selected"]["lamports"])/1e9:,.3f} SOL across {discrepancy["providers"]["public_rpc"]["majorAuthorityStakeQueries"]["vBoNd_selected"]["accountCount"]:,} accounts. These crosschecks confirm the main buckets, not every pool in those families.',
 '',
 'A current executable owner, PDA derivation, and historical signed Stake CPI support **program control of those specific accounts**. The 2rU1 example is a `deactivate` (control) rather than a direct lamport spend; the single-pool `moveLamports` and Validator Bonds `withdraw` examples moved lamports. None shows that an unauthenticated caller can redirect or withdraw value. Stake timing, voter/depositor claims, guard conditions, and complete atomic transaction economics remain untested. The SOL spot marks can overlap LST receipt claims and are not estimates of realizable drain or liquid exit capacity.',
 '',
 '## Remaining denominator gap',
 '',
 'The token pass does not cover all unverified mints or token accounts below each mint’s top 20. The Stake census excludes System-owned native SOL accounts and cannot assign every off-curve withdraw authority to a program. A 51,479.9 SOL residual authority (`FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm`) has no verified direct signer-program proof in the sampled history; it is therefore **not** listed as a controller candidate. A rooted chain-wide account/inner-CPI index would be required for exhaustive control attribution.',
 '',
 '## Evidence',
 '',
 '- [`nonregistry-next-candidates.json`](./nonregistry-next-candidates.json): compact ranked rows and exact selected state/proofs.',
 '- [`unverified-active-token-controller-census.json`](./unverified-active-token-controller-census.json): token-level and authority-level read-only data.',
 '- [`native-stake-secondary-controllers.json`](./native-stake-secondary-controllers.json): older stake decoding and PDA seeds, preserved for provenance.',
 '- [`native-secondary-finalized-recheck.json`](./native-secondary-finalized-recheck.json): fresh exact-authority finalized account sets and sums.',
 '- [`native-secondary-provider-discrepancy.json`](./native-secondary-provider-discrepancy.json): archive/live/public finalized crosscheck.',
 '- [`native-stake-residual-triage.json`](./native-stake-residual-triage.json): historical inner Stake CPIs.',
]
(DIR/'nonregistry-next-candidates.md').write_text('\n'.join(md)+'\n')
print(json.dumps({'programReadSlot':slot,'candidateCount':len(rows),'topProgram':rows[0]['programId'],'newUnverifiedTokenPrograms':output['novelUnverifiedActiveTokenDirectControllerCount']}))
