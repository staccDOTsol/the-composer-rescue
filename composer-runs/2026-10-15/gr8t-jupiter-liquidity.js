#!/usr/bin/env node
// Read-only Jupiter quote snapshots for realizable-liquidity bounding.
const fs=require('fs');
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const inputs={
  newMeta:{mint:'METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta',amounts:['1','1000000','385411577431','3851269441143']},
  oldMeta:{mint:'METADDFL6wWMWEoKTFJwcThTbUmtarRJZjRpzUvkxhr',amounts:['1','1000000000','20016003335','17011859560095']},
};
(async()=>{const quotes=[];for(const [asset,cfg] of Object.entries(inputs))for(const amount of cfg.amounts){const u=new URL('https://lite-api.jup.ag/swap/v1/quote');u.searchParams.set('inputMint',cfg.mint);u.searchParams.set('outputMint',USDC);u.searchParams.set('amount',amount);u.searchParams.set('slippageBps','100');const r=await fetch(u);let body;try{body=await r.json()}catch{body={text:await r.text()}}quotes.push({asset,requestedRaw:amount,httpStatus:r.status,body});}const out={generatedAt:new Date().toISOString(),source:'Jupiter Lite Quote API; read-only; ExactIn; 100 bps slippage',outputMint:USDC,inputs,quotes};fs.writeFileSync(__dirname+'/gr8t-jupiter-liquidity.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(quotes.map(q=>({asset:q.asset,inRaw:q.requestedRaw,status:q.httpStatus,outRaw:q.body.outAmount||null,priceImpactPct:q.body.priceImpactPct||null,error:q.body.error||null,slot:q.body.contextSlot||q.body.routePlan?.[0]?.swapInfo?.updateContextSlot||null})),null,2));})().catch(e=>{console.error(e.stack||e);process.exit(1)});
