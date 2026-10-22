#!/usr/bin/env node
// Read-only live Jupiter quote chaining, exact target pool and excluded independent exit.
const fs=require('fs');
const path=require('path');
const census=JSON.parse(fs.readFileSync(path.join(__dirname,'hadron-current-census.json')));
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pools=census.pools.filter(p=>p.state===1&&p.mintY===USDC&&BigInt(p.usdcRaw)>=100000000n)
  .sort((a,b)=>BigInt(a.usdcRaw)>BigInt(b.usdcRaw)?-1:1).slice(0,25);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function quote(inputMint,outputMint,amount,filter){
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');
  for(const [k,v] of Object.entries({inputMint,outputMint,amount:String(amount),slippageBps:'100',...filter}))u.searchParams.set(k,v);
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(u);
    const body=await response.json();
    if(response.status===429){await sleep(1000*(attempt+1));continue}
    return{status:response.status,inRaw:String(amount),outRaw:body.outAmount||null,slot:body.contextSlot||null,
      error:body.error||null,impact:body.priceImpactPct||null,
      route:(body.routePlan||[]).map(r=>({key:r.swapInfo.ammKey,label:r.swapInfo.label,outRaw:r.swapInfo.outAmount}))};
  }
  return{status:429,error:'rate limited'};
}
async function main(){
  const rows=[];
  for(const pool of pools){
    const first=await quote(USDC,pool.mintX,100000000n,{dexes:'Hadron',onlyDirectRoutes:'true'});
    const firstValid=first.status===200&&first.route.length===1&&first.route[0].key===pool.id;
    const exit=firstValid?await quote(pool.mintX,USDC,BigInt(first.outRaw),{excludeDexes:'Hadron'}):null;
    const exitValid=exit?.status===200&&exit.route.every(r=>r.label!=='Hadron'&&r.key!==pool.id);
    const netRaw=exitValid?(BigInt(exit.outRaw)-100000000n).toString():null;
    rows.push({pool:pool.id,mint:pool.mintX,usdcVaultRaw:pool.usdcRaw,first,firstValid,exit,exitValid,netRaw});
    console.log(JSON.stringify({pool:pool.id,usdc:Number(pool.usdcRaw)/1e6,firstValid,exitStatus:exit?.status,exitValid,netUsd:netRaw===null?null:Number(netRaw)/1e6}));
    await sleep(150);
  }
  const output={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',quoteSource:'Jupiter Lite',
    method:'100 USDC ExactIn forced Hadron direct leg, exact pool ammKey verification, chained base-to-USDC independent exit excluding Hadron; fees within quotes, flash fee and tx fee not yet applied',
    limitations:'Quotes at nearby slots are not an atomic executable packet and can be stale by execution time. This is a screen only.',noTransactions:true,rows};
  fs.writeFileSync(path.join(__dirname,'hadron-independent-exit-screen.json'),JSON.stringify(output,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
