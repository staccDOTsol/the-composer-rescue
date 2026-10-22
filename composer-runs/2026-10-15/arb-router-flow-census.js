#!/usr/bin/env node
// Read-only, bounded census. Flow != custody; classify immediate token-transfer authority.
const fs = require('fs');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const programs = {
  dflow: 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH',
  propeller: 'proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u',
  titan: 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT',
  onchainDexV2: '1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE',
  flashMev: 'FMshA9tPqoxGAjkit6HhbRY7iPbgPDh87kaC8ErFk1eZ',
  jupiterV6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
};
const mintMeta = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: ['USDC',6,1],
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: ['USDT',6,1],
  So11111111111111111111111111111111111111112: ['wSOL',9,105],
};
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
let rpcId = 0;
async function rpc(method,params) {
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const j=await r.json(); if(j.error)throw Error(method+': '+JSON.stringify(j.error)); return j.result;
}
async function programFlow(name,program) {
  const sigs=await rpc('getSignaturesForAddress',[program,{limit:16,commitment:'confirmed'}]);
  const txs=await Promise.all(sigs.slice(0,12).map(async s=>{
    try{return await rpc('getTransaction',[s.signature,{encoding:'jsonParsed',commitment:'confirmed',
      maxSupportedTransactionVersion:1}])}catch{return null}
  }));
  const transfers=[];
  for(let i=0;i<txs.length;i++) {
    const t=txs[i];if(!t||t.meta.err)continue;
    const keys=t.transaction.message.accountKeys.map(k=>k.pubkey);
    const mintByTokenIndex=new Map([...(t.meta.preTokenBalances||[]),...(t.meta.postTokenBalances||[])]
      .map(b=>[b.accountIndex,b.mint]));
    for(const group of t.meta.innerInstructions||[]) {
      const stack=[t.transaction.message.instructions[group.index]?.programId];
      for(const ix of group.instructions) {
        const h=ix.stackHeight||2,parent=stack[h-2]||null;
        stack[h-1]=ix.programId;stack.length=h;
        const info=ix.parsed?.info;
        if(parent!==program || !/transfer/i.test(ix.parsed?.type||'') || !info?.source || !info?.destination)continue;
        const tokenIndex=keys.indexOf(info.source);
        const mint=info.mint||mintByTokenIndex.get(tokenIndex)||null;
        const amount=info.amount||info.tokenAmount?.amount||null;
        if(!amount)continue;
        transfers.push({signature:sigs[i].signature,slot:sigs[i].slot,
          root:t.transaction.message.instructions[group.index]?.programId,
          source:info.source,destination:info.destination,authority:info.authority||null,
          mint,amount});
      }
    }
  }
  const authorities=[...new Set(transfers.map(x=>x.authority).filter(Boolean))];
  const state=[];
  for(let i=0;i<authorities.length;i+=100){
    const group=authorities.slice(i,i+100);
    const r=await rpc('getMultipleAccounts',[group,{encoding:'base64',commitment:'confirmed'}]);
    state.push(...group.map((a,j)=>({address:a,accountOwner:r.value[j]?.owner||null,
      executable:r.value[j]?.executable||false,onCurve:PublicKey.isOnCurve(new PublicKey(a))})));
  }
  const byAuthority=new Map(state.map(s=>[s.address,s]));
  const classified=transfers.map(x=>{
    const auth=byAuthority.get(x.authority);
    const m=mintMeta[x.mint];
    return {...x,authorityAccountOwner:auth?.accountOwner||null,
      authorityOnCurve:auth?.onCurve??null,
      authorityClass:auth?.accountOwner===program?'programOwnedState':
        auth?.onCurve===false?'otherPdaOrMissing':'userOrUnknown',
      knownMajorUsd:m?Number(x.amount)/10**m[1]*m[2]:null};
  });
  const grossKnown=classified.reduce((s,x)=>s+(x.knownMajorUsd||0),0);
  const programOwnedGross=classified.filter(x=>x.authorityClass==='programOwnedState')
    .reduce((s,x)=>s+(x.knownMajorUsd||0),0);
  return {name,program,signatures:sigs.length,parsedTransactions:txs.filter(Boolean).length,
    successfulTransactions:txs.filter(x=>x&&!x.meta.err).length,
    directTransferCount:classified.length,knownMajorGrossUsdEstimate:grossKnown,
    programOwnedKnownMajorGrossUsdEstimate:programOwnedGross,
    authorityClasses:Object.fromEntries(['programOwnedState','otherPdaOrMissing','userOrUnknown']
      .map(c=>[c,classified.filter(x=>x.authorityClass===c).length])),
    sampledAuthorities:state,transfers:classified};
}
async function main(){
  const results=await Promise.all(Object.entries(programs).map(([name,id])=>programFlow(name,id)));
  const output={generatedAt:new Date().toISOString(),method:'Latest 16 program signatures, first 12 parsed transactions; successful immediate-parent SPL transfers. wSOL fixed $105 screening mark only. Gross may double count loops. PDA owner classification is heuristic.',
    noTransactionsSubmitted:true,results};
  fs.writeFileSync(__dirname+'/arb-router-flow-census.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(results.map(({name,parsedTransactions,directTransferCount,
    knownMajorGrossUsdEstimate,programOwnedKnownMajorGrossUsdEstimate,authorityClasses})=>
    ({name,parsedTransactions,directTransferCount,knownMajorGrossUsdEstimate,
      programOwnedKnownMajorGrossUsdEstimate,authorityClasses})),null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
