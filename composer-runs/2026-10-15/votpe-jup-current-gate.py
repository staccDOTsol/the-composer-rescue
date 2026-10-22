#!/usr/bin/env python3
"""Read-only current-chain gate for candidate JUP controller; never submits transactions."""
import json, os, urllib.request, datetime, base64, hashlib

ROOT=os.path.dirname(__file__)
SRC=json.load(open(os.path.join(ROOT,'mainnet-token-authority-census.raw.json')))
PROGRAM='voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj'
P=next(p for p in SRC['programsByDirectStateAuthority'] if p['programId']==PROGRAM)
ROWS=[x for x in SRC['tokenAccounts'] if x.get('authority') in P['authorities']]
ENV={}
for line in open('/tmp/composer-helius-only.env'):
    k,sep,v=line.rstrip('\n').partition('=')
    if sep: ENV[k]=v
URL=ENV.get('HEAVY_RPC_URL') or ENV.get('RPC_URL')
if not URL: raise Exception('No RPC')
idx=0
ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(b):
    n=int.from_bytes(b,'big');s=''
    while n:n,r=divmod(n,58);s=ALPH[r]+s
    return '1'*(len(b)-len(b.lstrip(b'\0')))+s
def rpc(method,params=[]):
    global idx
    idx+=1
    req=urllib.request.Request(URL,json.dumps({'jsonrpc':'2.0','id':idx,'method':method,'params':params}).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as resp: data=json.load(resp)
    if 'error' in data: raise Exception(f'{method}: {data["error"]}')
    return data['result']
assert rpc('getGenesisHash')=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
keys=[PROGRAM]+P['authorities']+[t['address'] for t in ROWS]
accounts=rpc('getMultipleAccounts',[keys,{'encoding':'base64','commitment':'confirmed'}])
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'network':'mainnet-beta','slot':accounts['context']['slot'],'program':PROGRAM,'rows':[]}
for i,k in enumerate(keys):
    a=accounts['value'][i]
    item={'address':k,'exists':bool(a),'owner':a['owner'] if a else None,'executable':a['executable'] if a else None,'dataLen':len(base64.b64decode(a['data'][0])) if a else 0}
    if a and 1<=i<1+len(P['authorities']):
        b=base64.b64decode(a['data'][0])
        if len(b)==322:
            item['escrow']={'locker':b58(b[8:40]),'owner':b58(b[40:72]),'bump':b[72],
              'tokens':b58(b[73:105]),'amount':int.from_bytes(b[105:113],'little'),
              'startedAt':int.from_bytes(b[113:121],'little',signed=True),
              'endsAt':int.from_bytes(b[121:129],'little',signed=True),
              'voteDelegate':b58(b[129:161]),'isMaxLock':bool(b[161]),
              'partialUnstakingAmount':int.from_bytes(b[162:170],'little')}
    if i>=1+len(P['authorities']) and a:
        b=base64.b64decode(a['data'][0]);item['rawAmount']=int.from_bytes(b[64:72],'little');item['snapshotAmount']=int(ROWS[i-1-len(P['authorities'])]['rawAmount']);item['symbol']=ROWS[i-1-len(P['authorities'])]['symbol']
    out['rows'].append(item)
pd=b58(base64.b64decode(accounts['value'][0]['data'][0])[4:36])
pda=rpc('getAccountInfo',[pd,{'encoding':'base64','commitment':'confirmed','dataSlice':{'offset':0,'length':45}}])['value']
out['programData']={'address':pd,'owner':pda['owner'],'deploySlot':int.from_bytes(base64.b64decode(pda['data'][0])[4:12],'little')}
for t in ROWS:
    sigs=rpc('getSignaturesForAddress',[t['address'],{'limit':15,'commitment':'confirmed'}]);
    v={'address':t['address'],'sigs':sigs,'outflows':[]}
    for s in sigs[:8]:
        if s['err']: continue
        tx=rpc('getTransaction',[s['signature'],{'encoding':'jsonParsed','maxSupportedTransactionVersion':0,'commitment':'confirmed'}])
        if not tx:continue
        keys2=[z['pubkey'] if isinstance(z,dict) else z for z in tx['transaction']['message']['accountKeys']]
        top=[z['programId'] for z in tx['transaction']['message']['instructions']]
        inn=[]
        for z in tx['meta'].get('innerInstructions') or []:
            for ix in z.get('instructions',[]):
                p=ix.get('parsed') or {}; inf=p.get('info') or {}
                if inf.get('source')==t['address']:
                    inn.append({'programId':ix.get('programId'),'type':p.get('type'),'source':inf.get('source'),'destination':inf.get('destination'),'authority':inf.get('authority'),'amount':inf.get('amount')})
        if inn:v['outflows'].append({'signature':s['signature'],'slot':s['slot'],'top':top,'outflows':inn,'signers':[z['pubkey'] for z in tx['transaction']['message']['accountKeys'] if isinstance(z,dict) and z.get('signer')]})
    out.setdefault('history',[]).append(v)
path=os.path.join(ROOT,'votpe-jup-current-gate.json');json.dump(out,open(path,'w'),indent=2)
print(json.dumps({'slot':out['slot'],'balances':[{'a':z['address'],'raw':z.get('rawAmount'),'snapshotRaw':z.get('snapshotAmount')} for z in out['rows'] if 'rawAmount' in z],'outflows':[{'a':z['address'],'n':len(z['outflows']),'sample':z['outflows'][:2]} for z in out['history']],'path':path},indent=2))
