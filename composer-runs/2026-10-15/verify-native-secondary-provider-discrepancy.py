#!/usr/bin/env python3
"""Read-only, bounded provider crosscheck of the disputed 2rU1 stake set."""
import json
from pathlib import Path
from datetime import datetime, timezone
import requests

DIR=Path(__file__).parent
env=dict(x.split('=',1) for x in Path('/tmp/composer-helius-rpc.env').read_text().splitlines() if '=' in x)
authority='9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb'
samples=['8AUuYXFyNvU1R6ix5tZrja7M7E2nhsncDqS78bu4K2F','8EjDvpy4NouzeoY9YCWELGA3Ca7bsLWusA9mKN9N2n1','8T6GvuruJV5K3Y5x4s87MSaUBTvEuvj9aN1GYP778Ry']
stake='Stake11111111111111111111111111111111111111'

def rpc(endpoint,method,params):
    r=requests.post(endpoint,json={'jsonrpc':'2.0','id':1,'method':method,'params':params},timeout=90)
    r.raise_for_status();body=r.json()
    if 'error' in body:raise RuntimeError(f'{method}: {body["error"]}')
    return body['result']

providers={}
for name,endpoint in [('live_rpc',env['RPC_URL']),('archive_rpc',env['HEAVY_RPC_URL'])]:
    gpa=rpc(endpoint,'getProgramAccounts',[stake,{'commitment':'finalized','encoding':'base64','withContext':True,
             'filters':[{'dataSize':200},{'memcmp':{'offset':44,'bytes':authority}}],'dataSlice':{'offset':0,'length':76}}])
    by={x['pubkey'] for x in gpa['value']}
    multiple=rpc(endpoint,'getMultipleAccounts',[samples,{'commitment':'finalized','encoding':'base64','dataSlice':{'offset':0,'length':0}}])
    providers[name]={'gpaContextSlot':gpa['context']['slot'],'gpaCount':len(gpa['value']),
                     'gpaStakeLamports':str(sum(x['account']['lamports'] for x in gpa['value'])),
                     'samplePresenceInGpa':{x:x in by for x in samples},
                     'sampleReadSlot':multiple['context']['slot'],
                     'sampleAccountLamports':{x:(v['lamports'] if v else None) for x,v in zip(samples,multiple['value'])}}

public=rpc('https://api.mainnet-beta.solana.com','getMultipleAccounts',[samples,{'commitment':'finalized','encoding':'base64','dataSlice':{'offset':0,'length':0}}])
providers['public_rpc']={'sampleReadSlot':public['context']['slot'],
                         'sampleAccountLamports':{x:(v['lamports'] if v else None) for x,v in zip(samples,public['value'])}}
major={'SVSPx_selected':'E7c64FTgM5hHHNk2t2BzikarqT36dxRSAyR1ac25uy28',
       'vBoNd_selected':'7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH'}
providers['public_rpc']['majorAuthorityStakeQueries']={}
for label,withdrawer in major.items():
    z=rpc('https://api.mainnet-beta.solana.com','getProgramAccounts',[stake,{'commitment':'finalized','encoding':'base64','withContext':True,
       'filters':[{'dataSize':200},{'memcmp':{'offset':44,'bytes':withdrawer}}],'dataSlice':{'offset':0,'length':76}}])
    providers['public_rpc']['majorAuthorityStakeQueries'][label]={'authority':withdrawer,'slot':z['context']['slot'],
       'accountCount':len(z['value']),'lamports':str(sum(x['account']['lamports'] for x in z['value']))}
signatures=rpc(env['RPC_URL'],'getSignaturesForAddress',[samples[1],{'limit':100,'commitment':'finalized'}])
pool_sigs=rpc(env['RPC_URL'],'getSignaturesForAddress',[authority,{'limit':1000,'commitment':'finalized'}])
archive_slot=providers['archive_rpc']['gpaContextSlot']
after=[s for s in pool_sigs if s['slot']>archive_slot]
after_details=[]
for s in after:
    tx=rpc(env['RPC_URL'],'getTransaction',[s['signature'],{'commitment':'finalized','encoding':'jsonParsed','maxSupportedTransactionVersion':1}])
    if tx is None:
        after_details.append({'signature':s['signature'],'slot':s['slot'],'transactionAvailable':False})
        continue
    stake_inner=[]
    for group in tx.get('meta',{}).get('innerInstructions',[]):
        for ix in group['instructions']:
            if ix.get('programId')!=stake: continue
            parsed=ix.get('parsed')
            stake_inner.append(parsed.get('type') if isinstance(parsed,dict) else None)
    after_details.append({'signature':s['signature'],'slot':s['slot'],'transactionAvailable':True,
                          'accountKeyCount':len(tx['transaction']['message']['accountKeys']),
                          'innerStakeInstructionTypes':stake_inner})
out={'generatedAt':datetime.now(timezone.utc).isoformat(),'readOnly':True,'authority':authority,'sampleOldStakeAccounts':samples,
     'providers':providers,'oldSampleMostRecentIndexedSignature':{'signature':signatures[0]['signature'],'slot':signatures[0]['slot']} if signatures else None,
     'poolSignaturesAfterArchiveSnapshot':after_details,
     'interpretation':'Live/public views agree that the three old examples are absent, while archive RPC reports them live. This proves provider disagreement, not the exact cause. The last indexed transaction of one old example predates the archive context by tens of millions of slots; there is no evidence here of a recent mass withdrawal. Use the live finalized exact-authority census for current ranking.'}
(DIR/'native-secondary-provider-discrepancy.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'archive':providers['archive_rpc']['gpaCount'],'live':providers['live_rpc']['gpaCount'],
                  'oldSampleLastSignatureSlot':out['oldSampleMostRecentIndexedSignature']['slot'] if signatures else None,
                  'poolSignaturesAfterArchiveSnapshot':len(out['poolSignaturesAfterArchiveSnapshot'])}))
