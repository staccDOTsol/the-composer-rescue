#!/usr/bin/env python3
"""Fresh read-only exact-withdrawer native Stake census for three controllers."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64
import json
from pathlib import Path
import time
import requests

DIR=Path(__file__).parent
old=json.loads((DIR/'native-stake-secondary-controllers.json').read_text())
env=dict(x.split('=',1) for x in Path('/tmp/composer-helius-rpc.env').read_text().splitlines() if '=' in x)
url=env['RPC_URL']
STAKE='Stake11111111111111111111111111111111111111'
spec=[]
for p in old['vaultLiquidUnstaker']['pools']:
    spec.append(('vaultLiquidUnstaker',p['pool'],p['pool']))
for p in old['singlePool']['pools']:
    spec.append(('singlePool',p['pool'],p['stakeAuthority']['address']))
for p in old['validatorBonds']['configs']:
    spec.append(('validatorBonds',p['config'],p['bondsWithdrawerAuthorityPda']['address']))

def rpc(method,params):
    err=None
    for attempt in range(5):
        try:
            r=requests.post(url,json={'jsonrpc':'2.0','id':1,'method':method,'params':params},timeout=60)
            r.raise_for_status(); body=r.json()
            if 'error' in body: raise RuntimeError(str(body['error']))
            return body['result']
        except Exception as e:
            err=e;time.sleep(.3*2**attempt)
    raise err

def fetch(specrow):
    family,state,authority=specrow
    result=rpc('getProgramAccounts',[STAKE,{'commitment':'finalized','encoding':'base64','withContext':True,'filters':[{'dataSize':200},{'memcmp':{'offset':44,'bytes':authority}}],'dataSlice':{'offset':0,'length':76}}])
    accounts=[]
    for row in result['value']:
        d=base64.b64decode(row['account']['data'][0]);kind=int.from_bytes(d[:4],'little')
        if len(d)!=76 or kind not in (1,2): continue
        accounts.append({'address':row['pubkey'],'lamports':row['account']['lamports'],'stateKind':kind})
    return {'family':family,'state':state,'authority':authority,'slot':result['context']['slot'],
            'accountCount':len(accounts),'delegatedCount':sum(x['stateKind']==2 for x in accounts),
            'stakeLamports':sum(x['lamports'] for x in accounts),'accounts':accounts}

with ThreadPoolExecutor(max_workers=6) as pool:
    futures=[pool.submit(fetch,s) for s in spec]
    rows=[f.result() for f in as_completed(futures)]

by={(x['family'],x['state']):x for x in rows}
extra=[p['onramp']['address'] for p in old['singlePool']['pools']]+[old['vaultLiquidUnstaker']['pools'][0]['solVaultPda']['address']]
res=rpc('getMultipleAccounts',[extra,{'commitment':'finalized','encoding':'base64','dataSlice':{'offset':0,'length':0}}])
extra_map={k:v for k,v in zip(extra,res['value'])}
families={}
for family in ('vaultLiquidUnstaker','singlePool','validatorBonds'):
    subset=[r for r in rows if r['family']==family]
    oldfamily=old[family]
    stake=sum(r['stakeLamports'] for r in subset)
    if family=='vaultLiquidUnstaker':
        vault=oldfamily['pools'][0]['solVaultPda']['address']; extra_lamports=extra_map[vault]['lamports'] if extra_map[vault] else 0
        extra_kind='solVaultLamports'
    elif family=='singlePool':
        extra_lamports=sum((extra_map[p['onramp']['address']]['lamports'] if extra_map[p['onramp']['address']] else 0) for p in oldfamily['pools'])
        extra_kind='onrampLamports'
    else:
        extra_lamports=0;extra_kind='extraLamports'
    families[family]={'programId':oldfamily['programId'],'poolOrConfigCount':len(subset),'stakeAccountCount':sum(r['accountCount'] for r in subset),
      'stakeLamports':str(stake),'stakeSol':stake/1e9,extra_kind:str(extra_lamports),'grossNativeLamports':str(stake+extra_lamports),'grossNativeSol':(stake+extra_lamports)/1e9,
      'oldStakeAccountCount':sum(p.get('stakeAccountCount',0) for p in oldfamily.get('pools',oldfamily.get('configs',[]))),
      'oldGrossNativeSol':oldfamily.get('grossNativeSol',oldfamily['stakeSol'])}

out={'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rpcCommitment':'finalized','rpcProgram':'Stake','method':'exact 32-byte withdrawer getProgramAccounts dataSize=200; current getMultipleAccounts for SOL vault/onramps; read only',
     'contextSlotMin':min(r['slot'] for r in rows),'contextSlotMax':max([r['slot'] for r in rows]+[res['context']['slot']]),'extraAccountsSlot':res['context']['slot'],
     'family':families,'authorities':rows}
(DIR/'native-secondary-finalized-recheck.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'slotRange':[out['contextSlotMin'],out['contextSlotMax']],'families':families}))
