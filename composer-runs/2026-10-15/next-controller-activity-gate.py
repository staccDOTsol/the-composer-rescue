#!/usr/bin/env python3
"""Bounded, read-only mainnet-beta activity screen for uncovered PDA token controllers."""
import json,os,urllib.request,datetime,base64,sys
root=os.path.dirname(__file__)
data=json.load(open(os.path.join(root,'mainnet-token-authority-census.raw.json')))
env={}
for line in open('/tmp/composer-helius-only.env'):
 k,sep,v=line.rstrip('\n').partition('=')
 if sep:env[k]=v
url=env.get('HEAVY_RPC_URL') or env.get('RPC_URL')
if not url:raise Exception('No RPC')
i=0
ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(b):
 n=int.from_bytes(b,'big');s=''
 while n:n,r=divmod(n,58);s=ALPH[r]+s
 return '1'*(len(b)-len(b.lstrip(b'\0')))+s
def rpc(method,params=[]):
 global i;i+=1
 req=urllib.request.Request(url,json.dumps({'jsonrpc':'2.0','id':i,'method':method,'params':params}).encode(),{'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=45) as r:y=json.load(r)
 if 'error' in y:raise Exception(f'{method}: {y["error"]}')
 return y['result']
assert rpc('getGenesisHash')=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
ps=data['programsByDirectStateAuthority'];ts=data['tokenAccounts']
pref=sys.argv[1:] or ['FL3X2p','oreV3EG','BRGv9mx','RaTEZ3R']
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'network':'mainnet-beta','programs':[]}
for name in pref:
 p=next((p for p in ps if p['programId'].startswith(name)),None)
 if not p:print('skip unknown',name);continue
 rows=sorted([t for t in ts if t.get('authority') in p['authorities']],key=lambda t:-(t.get('usdValue') or 0))[:3]
 q={'program':p['programId'],'pricedGrossUsdOld':p['pricedGrossUsd'],'totalVaultsInTopCensus':p['tokenAccounts'],'selected':[]}
 pa=rpc('getAccountInfo',[p['programId'],{'encoding':'base64','commitment':'confirmed'}])['value']
 if pa and pa['owner']=='BPFLoaderUpgradeab1e11111111111111111111111' and len(base64.b64decode(pa['data'][0]))==36:
  pd=b58(base64.b64decode(pa['data'][0])[4:36]);pda=rpc('getAccountInfo',[pd,{'encoding':'base64','commitment':'confirmed','dataSlice':{'offset':0,'length':45}}])['value']
  q['programData']={'address':pd,'deploySlot':int.from_bytes(base64.b64decode(pda['data'][0])[4:12],'little') if pda else None}
 for t in rows:
  vault=t['address'];a=rpc('getAccountInfo',[vault,{'encoding':'jsonParsed','commitment':'confirmed'}])
  v=a['value'];info=v['data'].get('parsed',{}).get('info',{}) if v else {}
  item={'address':vault,'symbol':t.get('symbol'),'mint':t.get('mint'),'authority':t.get('authority'),'authorityOwner':None,'pricedUsdOld':t.get('usdValue'),'slot':a['context']['slot'],'currentRaw':info.get('tokenAmount',{}).get('amount'),'history':[]}
  au=rpc('getAccountInfo',[t['authority'],{'encoding':'base64','commitment':'confirmed'}])['value'];item['authorityOwner']=au['owner'] if au else None;item['stateLen']=len(base64.b64decode(au['data'][0])) if au else None
  sigs=rpc('getSignaturesForAddress',[vault,{'limit':10,'commitment':'confirmed'}])
  item['signatureSlots']=[s['slot'] for s in sigs]
  for s in sigs[:10]:
   if s['err']:continue
   tx=rpc('getTransaction',[s['signature'],{'encoding':'jsonParsed','maxSupportedTransactionVersion':1,'commitment':'confirmed'}])
   if not tx:continue
   top=[x['programId'] for x in tx['transaction']['message']['instructions']]
   outflows=[]
   for block in tx['meta'].get('innerInstructions') or []:
    for ix in block.get('instructions') or []:
     info=(ix.get('parsed') or {}).get('info') or {}
     if info.get('source')==vault:outflows.append({'type':(ix.get('parsed') or {}).get('type'),'amount':info.get('amount'),'destination':info.get('destination'),'authority':info.get('authority')})
   item['history'].append({'slot':s['slot'],'signature':s['signature'],'parentPresent':p['programId'] in top,'topPrograms':top,'outflows':outflows,'signers':[x['pubkey'] for x in tx['transaction']['message']['accountKeys'] if isinstance(x,dict) and x.get('signer')]})
  q['selected'].append(item)
 out['programs'].append(q)
print(json.dumps([{'program':p['program'],'grossOld':p['pricedGrossUsdOld'],'selected':[{'symbol':x['symbol'],'balance':x['currentRaw'],'state':x['authorityOwner']==p['program'],'nSigs':len(x['signatureSlots']),'nOut':sum(len(y['outflows']) for y in x['history']),'parentOut':sum(len(y['outflows']) for y in x['history'] if y['parentPresent'])} for x in p['selected']]} for p in out['programs']],indent=2))
fname=os.path.join(root,'next-controller-activity-gate.json');json.dump(out,open(fname,'w'),indent=2);print(fname)
