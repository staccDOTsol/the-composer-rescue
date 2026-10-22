#!/usr/bin/env python3
"""Read-only executable Jupiter quotes for the DAMM v2 USDP residual."""
import json, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

BASE='https://lite-api.jup.ag/swap/v1/quote'
USDP='usdpq7K6oUzDm8JCF1qAVmTUmG3WTw3g9uTkznTHBAE'
USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
WSOL='So11111111111111111111111111111111111111112'
POOL='AiA5MSW5yKYKrmHY2zqRVxiS9QFtJFPTx6dkVqZp2o3x'
queries=[(USDP,USDC,128860687,None),(USDP,USDC,128860687,'Meteora DAMM v2'),(USDP,WSOL,128860687,None),(USDP,USDC,1000000,None),(USDP,USDC,10000000,None),(USDP,USDC,128860687,'Meteora DAMM V2')]
results=[]
for inp,out,amount,exclude in queries:
 params={'inputMint':inp,'outputMint':out,'amount':str(amount),'slippageBps':'100'}
 if exclude: params['excludeDexes']=exclude
 url=BASE+'?'+urllib.parse.urlencode(params)
 req=urllib.request.Request(url,headers={'User-Agent':'composer-readonly-audit/1.0'})
 try:
  with urllib.request.urlopen(req,timeout=20) as res:
   status=res.status; raw=res.read()
 except urllib.error.HTTPError as err: status=err.code; raw=err.read()
 except Exception as err:
  results.append({'inputMint':inp,'outputMint':out,'inputRaw':amount,'excludeDexes':exclude,'error':str(err)});continue
 try: body=json.loads(raw)
 except: body={'raw':raw.decode(errors='replace')[:300]}
 steps=[{'label':x.get('swapInfo',{}).get('label'),'ammKey':x.get('swapInfo',{}).get('ammKey'),'inAmount':x.get('swapInfo',{}).get('inAmount'),'outAmount':x.get('swapInfo',{}).get('outAmount'),'feeAmount':x.get('swapInfo',{}).get('feeAmount'),'feeMint':x.get('swapInfo',{}).get('feeMint'),'percent':x.get('percent')} for x in body.get('routePlan',[])]
 results.append({'inputMint':inp,'outputMint':out,'inputRaw':amount,'excludeDexes':exclude,'httpStatus':status,'outRaw':body.get('outAmount'),'otherAmountThresholdRaw':body.get('otherAmountThreshold'),'priceImpactPct':body.get('priceImpactPct'),'contextSlot':body.get('contextSlot'),'timeTaken':body.get('timeTaken'),'routePlan':steps,'error':body.get('error'),'errorCode':body.get('errorCode'),'usesTargetPool':any(x.get('ammKey')==POOL for x in steps)})
 time.sleep(0.15)
result={'observedAt':datetime.now(timezone.utc).isoformat(),'endpoint':BASE,'scope':'read-only exact-in quotes; no swap submitted','targetPool':POOL,'quotes':results}
outfile=Path(__file__).with_suffix('.json');outfile.write_text(json.dumps(result,indent=2)+'\n')
for r in results: print(json.dumps({k:r.get(k) for k in ('inputRaw','outputMint','excludeDexes','httpStatus','outRaw','contextSlot','usesTargetPool','routePlan','error')}))
