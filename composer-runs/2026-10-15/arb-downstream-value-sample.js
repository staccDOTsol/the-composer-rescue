#!/usr/bin/env node
// Read-only route-throughput screen. Counts major-token transfers anywhere below sampled invocations.
const fs=require('fs');
const programs={
 dflow:'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH',
 propeller:'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u',
 titan:'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT',
 flashMev:'FMshA9tPqoxGAjkit6HhbRY7iPbgPDh87kaC8ErFk1eZ',
};
const majors={
 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:['USDC',6,1],
 Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:['USDT',6,1],
 So11111111111111111111111111111111111111112:['wSOL',9,105],
};
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const j=await(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})})).json();
 if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
function decode(t,signature,target){
 if(!t)return {signature,missing:true};
 const keys=t.transaction.message.accountKeys.map(k=>k.pubkey);
 const mintByIndex=new Map([...(t.meta.preTokenBalances||[]),...(t.meta.postTokenBalances||[])]
  .map(x=>[x.accountIndex,x.mint]));
 const roots=t.transaction.message.instructions.map(x=>x.programId);
 const transfers=[];
 for(const group of t.meta.innerInstructions||[]){
  const stack=[roots[group.index]];
  for(const ix of group.instructions||[]){
   const h=ix.stackHeight||2,parent=stack[h-2]||null;
   stack[h-1]=ix.programId;stack.length=h;
   const z=ix.parsed?.info;
   if(!/transfer/i.test(ix.parsed?.type||'')||!z?.source)continue;
   const mint=z.mint||mintByIndex.get(keys.indexOf(z.source));
   const m=majors[mint];if(!m)continue;
   const amount=z.amount||z.tokenAmount?.amount;if(!amount)continue;
   transfers.push({parent,mint,symbol:m[0],amount,usd:Number(amount)/10**m[1]*m[2]});
  }
 }
 return {signature,slot:t.slot,rootIsTarget:roots.includes(target),err:t.meta.err,
  knownMajorTransferCount:transfers.length,knownMajorGrossUsdEstimate:transfers.reduce((a,b)=>a+b.usd,0),
  immediateParentTargetUsdEstimate:transfers.filter(x=>x.parent===target).reduce((a,b)=>a+b.usd,0),
  topTransfers:transfers.sort((a,b)=>b.usd-a.usd).slice(0,8)};
}
async function one(name,program){
 const sigs=await rpc('getSignaturesForAddress',[program,{limit:1000,commitment:'confirmed'}]);
 const picks=[...new Set(Array.from({length:12},(_,i)=>Math.floor(i*(sigs.length-1)/11)))];
 const rows=await Promise.all(picks.map(async i=>{
  try{return decode(await rpc('getTransaction',[sigs[i].signature,
    {encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]),sigs[i].signature,program)}
  catch(e){return {signature:sigs[i].signature,error:String(e)}}}));
 const good=rows.filter(x=>!x.err&&!x.error&&!x.missing);
 return {name,program,populationSignatures:sigs.length,sampled:rows.length,
  successful:good.length,rootInvocations:good.filter(x=>x.rootIsTarget).length,
  sampleKnownMajorGrossUsdEstimate:good.reduce((a,b)=>a+b.knownMajorGrossUsdEstimate,0),
  sampleMaxTransactionUsdEstimate:Math.max(0,...good.map(x=>x.knownMajorGrossUsdEstimate)),
  sampleMedianTransactionUsdEstimate:good.map(x=>x.knownMajorGrossUsdEstimate).sort((a,b)=>a-b)[Math.floor(good.length/2)]||0,
  sampleDirectUsdEstimate:good.reduce((a,b)=>a+b.immediateParentTargetUsdEstimate,0),rows};
}
async function main(){const results=await Promise.all(Object.entries(programs).map(([n,p])=>one(n,p)));
 const out={generatedAt:new Date().toISOString(),method:'12 evenly spaced signatures from latest 1000 per program. Gross known-major transfers across all inner instructions; duplicates/counts both swap legs; wSOL fixed $105 screening mark. No inference of program custody.',
  noTransactionsSubmitted:true,results};
 fs.writeFileSync(__dirname+'/arb-downstream-value-sample.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(results.map(({name,populationSignatures,sampled,successful,rootInvocations,
  sampleKnownMajorGrossUsdEstimate,sampleMaxTransactionUsdEstimate,sampleMedianTransactionUsdEstimate,
  sampleDirectUsdEstimate})=>({name,populationSignatures,sampled,successful,rootInvocations,
   sampleKnownMajorGrossUsdEstimate,sampleMaxTransactionUsdEstimate,
   sampleMedianTransactionUsdEstimate,sampleDirectUsdEstimate})),null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
