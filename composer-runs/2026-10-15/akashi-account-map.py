"""Read-only account ownership/balance map for one current Akashi RefreshLeg."""
import base64, json, os, struct, urllib.request

RPC=os.environ.get('HEAVY_RPC_URL') or os.environ['RPC_URL']
HOME='composer-runs/2026-10-15/'
trace=json.load(open(HOME+'amm-consumer-candidate-traces.json'))
row=next(r for r in trace['rows'] if r['program'].startswith('11pvmug'))
keys=list(dict.fromkeys(row['top'][2]['accounts']))
body=json.dumps({'jsonrpc':'2.0','id':1,'method':'getMultipleAccounts','params':[keys,{'encoding':'base64','commitment':'confirmed'}]}).encode()
resp=json.load(urllib.request.urlopen(urllib.request.Request(RPC,body,{'Content-Type':'application/json'})))
if 'error' in resp: raise RuntimeError(resp['error'])
vals=resp['result']['value']; mapped=[]
for i,(key,account) in enumerate(zip(keys,vals)):
    if not account: mapped.append({'index':i,'address':key,'exists':False}); continue
    raw=base64.b64decode(account['data'][0]); owner=account['owner']
    out={'index':i,'address':key,'owner':owner,'lamports':account['lamports'],'size':len(raw),'executable':account['executable']}
    is_token_account = (owner == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' and len(raw) == 165) or (owner == 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' and (len(raw) == 165 or (len(raw) > 165 and raw[165] == 2)))
    if is_token_account:
        out['tokenAmountRaw']=str(struct.unpack_from('<Q',raw,64)[0])
    mapped.append(out)
out={'slot':resp['result']['context']['slot'],'sourceSignature':row['signature'],'pool':trace['pool'],'accounts':mapped}
open(HOME+'akashi-current-account-map.json','w').write(json.dumps(out,indent=2))
print(json.dumps({'slot':out['slot'],'owners':{o:sum(x.get('owner')==o for x in mapped) for o in sorted({x.get('owner') for x in mapped if x.get('owner')})},'first':mapped[:12],'tokenAccounts':[x for x in mapped if 'tokenAmountRaw' in x]}))
