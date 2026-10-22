#!/usr/bin/env node
// Read-only mainnet Jupiter quotes for current Hadron USDC/USDT pool.
const fs=require('fs');const path=require('path');
const pool='GPHRA3MJGT4ERmsq3sgt9Mcf3WVdG81oJia7yuLZ6ixU';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT='Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const out=path.join(__dirname,'hadron-stable-depth-screen.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function quote(a,b,amount,side){
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');
  for(const[k,v]of Object.entries({inputMint:a,outputMint:b,amount:String(amount),slippageBps:'100',onlyDirectRoutes:'true',...(side==='hadron'?{dexes:'Hadron'}:{excludeDexes:'Hadron'})}))u.searchParams.set(k,v);
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(u);const q=await r.json();
    if(r.status===429){await sleep(4000*(attempt+1));continue}
    return{status:r.status,inRaw:String(amount),outRaw:q.outAmount||null,contextSlot:q.contextSlot||null,error:q.error||null,
      impact:q.priceImpactPct||null,route:(q.routePlan||[]).map(x=>({label:x.swapInfo.label,key:x.swapInfo.ammKey,inRaw:x.swapInfo.inAmount,outRaw:x.swapInfo.outAmount}))};
  }
  return{status:429,inRaw:String(amount),outRaw:null,error:'rate limited',route:[]};
}
async function main(){
  const report={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',pool,quoteSource:'Jupiter Lite',
    method:'ExactIn direct Hadron USDC/USDT quote with exact pool key plus direct independent exit excluding Hadron; both route orders; varying USDC principal.',
    limitations:'Quotes from adjacent slots do not show intra-transaction state change. Hadron may charge a flash wrapper a different spread. No lender or transaction fees applied.',noTransactions:true,rows:[]};
  for(const usd of [100,500,1000,2500,5000])for(const hadronFirst of [true,false]){
    const first=await quote(USDC,USDT,BigInt(usd)*1000000n,hadronFirst?'hadron':'independent');
    const firstValid=first.status===200&&first.route.length===1&&first.route.every(r=>hadronFirst?r.key===pool:r.label!=='Hadron'&&r.key!==pool);
    const second=firstValid?await quote(USDT,USDC,BigInt(first.outRaw),hadronFirst?'independent':'hadron'):null;
    const secondValid=second?.status===200&&second.route.length===1&&second.route.every(r=>hadronFirst?r.label!=='Hadron'&&r.key!==pool:r.key===pool);
    const netRaw=secondValid?(BigInt(second.outRaw)-BigInt(usd)*1000000n).toString():null;
    const row={usd,hadronFirst,first,firstValid,second,secondValid,netRaw};report.rows.push(row);
    fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({usd,hadronFirst,firstStatus:first.status,secondStatus:second?.status,netUsd:netRaw===null?null:Number(netRaw)/1e6,firstRoute:first.route?.[0]?.label,secondRoute:second?.route?.[0]?.label}));
    await sleep(1500);
  }
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
