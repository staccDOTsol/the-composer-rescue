#!/usr/bin/env node
'use strict';
// Read-only direct-route screen; quote output is not atomic execution.
const fs=require('fs');const path=require('path');
const WSOL='So11111111111111111111111111111111111111112';
const JUP='JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const target='7T5BKFBFLGSgVBKKcBwrrUTHPtpVGvorKfmYuS4TzdfV';
async function quote(inputMint,outputMint,amount,side){
  const p=new URLSearchParams({inputMint,outputMint,amount:String(amount),
    slippageBps:'100',onlyDirectRoutes:'true'});
  if(side==='scorch')p.set('dexes','Scorch');else p.set('excludeDexes','Scorch');
  const r=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+p);const v=await r.json();
  const route=(v.routePlan||[]).map(x=>({label:x.swapInfo?.label||null,ammKey:x.swapInfo?.ammKey||null}));
  const matched=side==='scorch'?route.length===1&&route[0].ammKey===target:
    route.length===1&&route[0].ammKey!==target&&route[0].label!=='Scorch';
  return {status:r.status,inAmount:v.inAmount||String(amount),outAmount:v.outAmount||null,
    slot:v.contextSlot||null,error:v.error||null,route,matched};
}
async function main(){const rows=[];
  for(const wsolRaw of ['100000000','1000000000','10000000000','100000000000']){
    for(const order of ['scorch-first','scorch-second']){
      const firstSide=order==='scorch-first'?'scorch':'independent';
      const secondSide=order==='scorch-first'?'independent':'scorch';
      const first=await quote(WSOL,JUP,wsolRaw,firstSide);
      const second=first.outAmount&&first.matched?
        await quote(JUP,WSOL,first.outAmount,secondSide):null;
      const valid=!!(first.matched&&second?.matched&&second.outAmount);
      rows.push({wsolRaw,order,first,second,valid,
        netWsolRaw:valid?(BigInt(second.outAmount)-BigInt(wsolRaw)).toString():null});
    }
  }
  const out={observedAtUtc:new Date().toISOString(),source:'Jupiter Lite direct quote API',
    method:'Scorch exact pool-key versus independent direct route, both orders; no lender, fees, or signed execution',
    targetPool:target,noTransaction:true,rows};
  const file=path.join(__dirname,'scorch-wsol-jup-cross-venue.json');
  fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({output:file,rows:rows.map(x=>({wsol:Number(x.wsolRaw)/1e9,
    order:x.order,valid:x.valid,netWsol:x.netWsolRaw==null?null:Number(x.netWsolRaw)/1e9,
    first:x.first.route[0],second:x.second?.route[0],slot:x.first.slot}))}));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
