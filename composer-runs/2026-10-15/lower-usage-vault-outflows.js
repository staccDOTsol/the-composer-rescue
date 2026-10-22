#!/usr/bin/env node
// Bounded read-only source-vault outflow provenance for lower-usage controllers.
const fs=require('fs');
const source=require('./mainnet-token-authority-flash-crosswalk.json');
const ids=(process.env.PROGRAM_IDS||'').split(',').filter(Boolean);
if(!ids.length)throw Error('PROGRAM_IDS required');
const perVault=Math.min(50,Math.max(1,Number(process.env.SAMPLE_SIGS||15)));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;
let rpcId=0;
async function rpc(method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
async function inspectVault(program,asset,vault){
 const sigs=await rpc('getSignaturesForAddress',[vault,{limit:perVault,commitment:'confirmed'}]);
 const transfers=[];let errors=0;
 for(let i=0;i<sigs.length;i+=10){
  const batch=await Promise.all(sigs.slice(i,i+10).map(async sig=>{
   try{
    const t=await rpc('getTransaction',[sig.signature,
     {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
    if(!t||t.meta.err)return [];
    const rows=[];
    for(const group of t.meta.innerInstructions||[]){
     const root=t.transaction.message.instructions[group.index]?.programId;
     const stack=[root];
     for(const ix of group.instructions){
      const h=ix.stackHeight||2;
      const parent=stack[h-2]||null;
      stack[h-1]=ix.programId;stack.length=h;
      const info=ix.parsed?.info;
      if(info?.source===vault&&/transfer/i.test(ix.parsed?.type||''))
       rows.push({signature:sig.signature,slot:sig.slot,root,parent,
        destination:info.destination,authority:info.authority,amount:info.amount||info.tokenAmount?.amount,
        targetIsImmediateParent:parent===program});
     }
    }
    return rows;
   }catch(e){errors++;return []}
  }));
  transfers.push(...batch.flat());
 }
 return {programId:program,mint:asset.mint,symbols:asset.symbols,
  sampledCustodyUsd:asset.sampledCustodyUsd,vault,sampledSignatures:sigs.length,
  errors,transfers};
}
async function main(){
 const selected=source.targets.filter(x=>ids.includes(x.programId));
 if(selected.length!==ids.length)throw Error('program id not found in crosswalk');
 const jobs=[];
 for(const target of selected)for(const asset of target.assets.slice(0,3))
  for(const vault of asset.sampledTokenAccounts.slice(0,1))jobs.push({target,asset,vault});
 const rows=[];
 for(let i=0;i<jobs.length;i+=5){
  rows.push(...await Promise.all(jobs.slice(i,i+5).map(j=>
   inspectVault(j.target.programId,j.asset,j.vault))));
 }
 const out={generatedAt:new Date().toISOString(),method:'First sampled top-holder vault of up to three assets per target; latest '+perVault+' signatures per vault. Successful outgoing Token CPI parent only; absence is not no-exit proof.',
  selectedProgramCount:selected.length,selectedVaultCount:rows.length,rows};
 fs.writeFileSync(__dirname+'/lower-usage-vault-outflows.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({programs:selected.length,vaults:rows.length,
  rows:rows.map(x=>({program:x.programId.slice(0,10),asset:x.symbols?.[0],
   sampledUsd:Math.round(x.sampledCustodyUsd),sigs:x.sampledSignatures,
   outflows:x.transfers.length,ownParent:x.transfers.filter(t=>t.targetIsImmediateParent).length,
   latest:x.transfers[0]?.slot}))}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
