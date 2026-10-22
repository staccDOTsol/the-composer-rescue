#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const dir=__dirname;
const gate=JSON.parse(fs.readFileSync(path.join(dir,'unreviewed-controller-spend-gate.json')));
const xo=gate.programs.find(x=>x.programId.startsWith('C64AAG'));
const sigs=[...new Set(xo.authorities.flatMap(a=>a.selectedVaults.flatMap(v=>v.outgoingTransfers.map(t=>t.signature))))];
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;let seq=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const v=await r.json();
  if(v.error)throw Error(v.error.message);return v.result;}
function pid(ix){return typeof ix.programId==='string'?ix.programId:ix.programId?.toString?.()||null}
async function main(){const out=[];for(const sig of sigs.slice(0,3)){
  const tx=await rpc('getTransaction',[sig,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  const keys=tx.transaction.message.accountKeys;
  out.push({signature:sig,slot:tx.slot,version:tx.version,fee:tx.meta.fee,
    signers:keys.filter(x=>x.signer).map(x=>x.pubkey),
    instructions:tx.transaction.message.instructions.map((ix,i)=>({index:i,programId:pid(ix),
      parsed:ix.parsed||null,data:ix.data||null,accounts:ix.accounts||null})),
    logs:(tx.meta.logMessages||[]).filter(x=>x.includes('Program log:')||x.includes('invoke')),
    inner:(tx.meta.innerInstructions||[]).map(g=>({index:g.index,
      instructions:g.instructions.map(ix=>({programId:pid(ix),type:ix.parsed?.type||null,
        info:ix.parsed?.info||null,data:ix.data||null,accounts:ix.accounts||null,
        stackHeight:ix.stackHeight||null}))})),
    preTokenBalances:tx.meta.preTokenBalances,postTokenBalances:tx.meta.postTokenBalances});
}const file=path.join(dir,'xo-controller-live-shapes.json');fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.map(t=>({sig:t.signature,slot:t.slot,signers:t.signers,
  top:t.instructions.map(x=>({programId:x.programId,data:x.data,accounts:x.accounts?.length,parsed:x.parsed?.type})),
  logs:t.logs.filter(x=>x.includes('Program log:')).slice(0,10)}))))}
main().catch(e=>{console.error(e.message);process.exitCode=1});
