#!/usr/bin/env node
// Read-only quote-depth screen; chained quotes are not an executable atomic simulation.
const fs=require('fs');const path=require('path');
const census=require('./hadron-current-census.json');
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const target='DbQYhsmBypcxb23ruDmcWb1k43YjnaNR22yonCVeP7Ke';
const pool=census.pools.find(p=>p.id===target);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function quote(a,b,amount,side){
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');
  for(const[k,v]of Object.entries({inputMint:a,outputMint:b,amount:String(amount),slippageBps:'100',...(side==='hadron'?{dexes:'Hadron',onlyDirectRoutes:'true'}:{excludeDexes:'Hadron'})}))u.searchParams.set(k,v);
  for(let attempt=0;attempt<6;attempt++){
    const r=await fetch(u);const q=await r.json();
    if(r.status===429){await delay(3000*(attempt+1));continue;}
    return{status:r.status,inRaw:String(amount),outRaw:q.outAmount||null,slot:q.contextSlot||null,error:q.error||null,
      impact:q.priceImpactPct||null,route:(q.routePlan||[]).map(x=>({label:x.swapInfo.label,key:x.swapInfo.ammKey}))};
  }
  return{status:429,inRaw:String(amount),error:'rate limited',route:[]};
}
async function main(){
  const rows=[];
  for(const usd of [100,500,1000,2500,5000])for(const hadronFirst of [true,false]){
    const first=await quote(USDC,pool.mintX,BigInt(usd)*1000000n,hadronFirst?'hadron':'independent');
    const firstValid=first.status===200&&first.route.length>0&&first.route.every(r=>hadronFirst?r.key===pool.id:r.label!=='Hadron'&&r.key!==pool.id);
    const second=firstValid?await quote(pool.mintX,USDC,BigInt(first.outRaw),hadronFirst?'independent':'hadron'):null;
    const secondValid=second?.status===200&&second.route.length>0&&second.route.every(r=>hadronFirst?r.label!=='Hadron'&&r.key!==pool.id:r.key===pool.id);
    const netRaw=secondValid?(BigInt(second.outRaw)-BigInt(usd)*1000000n).toString():null;
    rows.push({usd,hadronFirst,first,firstValid,second,secondValid,netRaw});
    console.log(JSON.stringify({usd,hadronFirst,firstStatus:first.status,secondStatus:second?.status,netUsd:netRaw===null?null:Number(netRaw)/1e6}));
    await delay(250);
  }
  const report={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',pool:target,baseMint:pool.mintX,usdcVaultRaw:pool.usdcRaw,
    method:'ExactIn USDC→base→USDC chained quotes, Hadron exact pool key and independent route excluding Hadron, both orderings; quote fee included, lender and tx costs excluded.',
    limitations:'Quote snapshots at different slots are not a same-state or atomic packet. Hadron spread-config may charge custom callers more than Jupiter.',noTransactions:true,rows};
  fs.writeFileSync(path.join(__dirname,'hadron-xstock-depth-screen.json'),JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
