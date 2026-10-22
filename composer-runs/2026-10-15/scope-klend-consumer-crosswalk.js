const fs=require('fs');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const census=require('./scope-live-mapping-census.json');
const reserveCensus=require('./klend-zero-fee-census.json');
const reserves=[...reserveCensus.activeZero,...reserveCensus.otherRows];
async function rpc(method,params){
  for(let a=0;a<4;a++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const obj=await response.json();
    if(!obj.error)return obj.result;
    if(obj.error.code===429||/rate limit/i.test(obj.error.message||'')){await new Promise(r=>setTimeout(r,800*(a+1)));continue;}
    throw Error(JSON.stringify(obj.error));
  }
  throw Error('RPC rate limit after retry');
}
async function main(){
  const mappings=census.mappings.map(m=>({...m,priceBytes:new PublicKey(m.oraclePrices).toBuffer()}));
  const rows=[];const slots=[];let examined=0;
  for(let i=0;i<reserves.length;i+=75){
    const batch=reserves.slice(i,i+75);
    const result=await rpc('getMultipleAccounts',[batch.map(r=>r.reserve),{encoding:'base64',commitment:'confirmed'}]);
    slots.push(result.context.slot);
    result.value.forEach((a,j)=>{
      if(!a||!a.data)return;
      const d=Buffer.from(a.data[0],'base64');
      if(d.length!==8624)return;
      examined++;
      for(const m of mappings){
        let offset=d.indexOf(m.priceBytes);
        while(offset>=0){
          const priceChain=Array.from({length:4},(_,k)=>d.readUInt16LE(offset+32+2*k));
          const twapChain=Array.from({length:4},(_,k)=>d.readUInt16LE(offset+40+2*k));
          const ammIndexes=new Set(m.ammEntries.map(e=>e.index));
          const directPriceAmm=priceChain.filter(x=>ammIndexes.has(x));
          const directTwapAmm=twapChain.filter(x=>ammIndexes.has(x));
          rows.push({reserve:batch[j].reserve,mint:batch[j].mint,name:batch[j].name,availableRaw:batch[j].availableRaw,feed:m.oraclePrices,mapping:m.address,offset,priceChain,twapChain,directPriceAmm,directTwapAmm});
          offset=d.indexOf(m.priceBytes,offset+1);
        }
      }
    });
  }
  const output={observedAt:new Date().toISOString(),reserveProgram:reserveCensus.programId,reservesListed:reserves.length,reservesExamined:examined,slotMin:Math.min(...slots),slotMax:Math.max(...slots),scopeFeedMatches:rows.length,directAmmReserveMatches:rows.filter(r=>r.directPriceAmm.length||r.directTwapAmm.length),rows};
  const path='composer-runs/2026-10-15/scope-klend-consumer-crosswalk.json';
  fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({path,examined,feedMatches:rows.length,directAmmMatches:output.directAmmReserveMatches.length,feedCounts:Object.entries(Object.groupBy(rows,r=>r.feed)).map(([feed,v])=>({feed,count:v.length})),matches:output.directAmmReserveMatches}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
