#!/usr/bin/env node
'use strict';
// Read-only Jupiter quote screen; prices are not proof of executable profit.
const fs=require('fs');
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL='So11111111111111111111111111111111111111112';
async function quote(inputMint,outputMint,amount,side){
  const p=new URLSearchParams({inputMint,outputMint,amount:String(amount),
    slippageBps:'100',onlyDirectRoutes:'true'});
  if(side==='bison')p.set('dexes','BisonFi');
  else p.set('excludeDexes','BisonFi');
  const response=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+p);
  const body=await response.json();
  return {httpStatus:response.status,inAmount:body.inAmount||String(amount),
    outAmount:body.outAmount||null,contextSlot:body.contextSlot||null,
    error:body.error||null,priceImpactPct:body.priceImpactPct||null,
    route:(body.routePlan||[]).map(x=>({label:x.swapInfo?.label,
      ammKey:x.swapInfo?.ammKey,percent:x.percent}))};
}
async function main(){
  const rows=[];
  for(const dollars of [100,1000,10000,100000]){
    const input=BigInt(dollars)*1000000n;
    for(const direction of ['bison-first','bison-second']){
      const firstSide=direction==='bison-first'?'bison':'independent';
      const secondSide=direction==='bison-first'?'independent':'bison';
      const first=await quote(USDC,WSOL,input,firstSide);
      const second=first.outAmount?await quote(WSOL,USDC,first.outAmount,secondSide):null;
      rows.push({dollars,direction,first,second,
        netUsdcRaw:second?.outAmount?(BigInt(second.outAmount)-input).toString():null});
    }
  }
  const output={observedAt:new Date().toISOString(),source:'Jupiter Lite quote API',
    method:'read-only exact-in direct-route quote chaining',
    noMainnetTransaction:true,rows};
  fs.writeFileSync(__dirname+'/bison-wsol-usdc-cross-venue-quotes.json',
    JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(rows.map(x=>({dollars:x.dollars,direction:x.direction,
    netUsdc:x.netUsdcRaw==null?null:Number(x.netUsdcRaw)/1e6,
    first:x.first.route.map(y=>y.label),second:x.second?.route.map(y=>y.label),
    slots:[x.first.contextSlot,x.second?.contextSlot],
    errors:[x.first.error,x.second?.error]})),null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
