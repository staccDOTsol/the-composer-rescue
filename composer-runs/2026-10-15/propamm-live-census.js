#!/usr/bin/env node
// Bounded, read-only current activity census for proprietary Solana liquidity programs.
const fs=require('fs');
const programs={
 bison:'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi',
 goonfiV2:'goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE',
 humidifi:'9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp',
 alphaQ:'ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA',
 obricV2:'obriQD1zbpyLz95G5n7nJe6a4DPjpFwa5XYPoNm113y',
 bisonPredict:'2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh',
};
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
async function inspect(name,program){
 const sigs=await rpc('getSignaturesForAddress',[program,{limit:20,commitment:'confirmed'}]);
 const txs=await Promise.all(sigs.slice(0,15).map(async s=>{try{return await rpc('getTransaction',[s.signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}])}catch{return null}}));
 const out=[];
 for(let i=0;i<txs.length;i++){
  const t=txs[i];if(!t||t.meta.err)continue;
  for(const g of t.meta.innerInstructions||[]){
   const root=t.transaction.message.instructions[g.index]?.programId;
   const stack=[root];
   for(const ix of g.instructions){
    const h=ix.stackHeight||2,parent=stack[h-2]||null;stack[h-1]=ix.programId;stack.length=h;
    const info=ix.parsed?.info;
    if(parent===program&&/transfer/i.test(ix.parsed?.type||'')&&info?.source&&info?.destination)
     out.push({signature:sigs[i].signature,slot:sigs[i].slot,root,source:info.source,
      destination:info.destination,authority:info.authority,mint:info.mint||null,
      amount:info.amount||info.tokenAmount?.amount||null});
   }
  }
 }
 const sources=[...new Set(out.map(x=>x.source))];
 const states=[];for(let i=0;i<sources.length;i+=100){
  const chunk=sources.slice(i,i+100),data=await rpc('getMultipleAccounts',[chunk,{encoding:'jsonParsed',commitment:'confirmed'}]);
  states.push(...chunk.map((address,j)=>({address,owner:data.value[j]?.data?.parsed?.info?.owner||null,
   mint:data.value[j]?.data?.parsed?.info?.mint||null,
   amount:data.value[j]?.data?.parsed?.info?.tokenAmount?.amount||null})));
 }
 return {name,program,signatures:sigs.length,transactions:txs.filter(Boolean).length,
  directTokenOutflows:out.length,uniqueSources:sources.length,sources:states,
  examples:out.slice(0,12)};
}
async function main(){const results=await Promise.all(Object.entries(programs).map(([n,p])=>inspect(n,p)));
 const out={generatedAt:new Date().toISOString(),method:'Latest 20 program signatures, first 15 parsed transactions; Token CPI where immediate parent is target. Bounded sample, no absence proof.',results};
 fs.writeFileSync(__dirname+'/propamm-live-census.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({name:r.name,signatures:r.signatures,txs:r.transactions,
  outflows:r.directTokenOutflows,sources:r.uniqueSources,
  sampledCurrent:r.sources.slice(0,5).map(s=>({mint:s.mint,amount:s.amount,owner:s.owner}))})),null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
