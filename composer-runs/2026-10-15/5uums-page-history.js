#!/usr/bin/env node
'use strict';
// Read-only signature paging and targeted instruction census.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=__dirname,PROGRAM='5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const names=['init_bridge','transfer_bridge_now','transfer_bridge','accept_bridge','init','set_mint_authority','mint','burn','lock','unlock'];
const disc=Object.fromEntries(names.map(n=>[crypto.createHash('sha256').update('global:'+n).digest('hex').slice(0,16),n]));
let n=0;async function rpc(method,params){for(let i=0;i<5;i++){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++n,method,params})});if((r.status===429||r.status>=500)&&i<4){await new Promise(f=>setTimeout(f,500*(i+1)));continue;}if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}}
async function main(){
  let before,all=[];const pages=[];
  for(let i=0;i<50;i++){
    const x=await rpc('getSignaturesForAddress',[PROGRAM,{limit:1000,commitment:'confirmed',...(before?{before}:{})}]);
    if(!x.length)break;
    all.push(...x);pages.push({page:i,count:x.length,firstSlot:x[0].slot,lastSlot:x.at(-1).slot});
    before=x.at(-1).signature;
    if(i%5===0)process.stderr.write(`pages ${i+1}, total ${all.length}, last slot ${x.at(-1).slot}\n`);
    if(x.length<1000||x.at(-1).slot<320435332)break;
  }
  const sample=[];
  for(let i=0;i<all.length;i+=Math.max(1,Math.floor(all.length/100))){
    const sig=all[i].signature;
    const tx=await rpc('getTransaction',[sig,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
    if(!tx)continue;
    const instructions=tx.transaction.message.instructions.filter(ix=>ix.programId===PROGRAM).map(ix=>{const b=Buffer.from(bs58.decode(ix.data));return{discriminator:b.subarray(0,8).toString('hex'),name:disc[b.subarray(0,8).toString('hex')]||null,accounts:ix.accounts,bodyHex:b.subarray(8).toString('hex')}});
    sample.push({signature:sig,slot:tx.slot,err:tx.meta.err,instructions});
  }
  const out={at:new Date().toISOString(),pages,totalSignatures:all.length,earliest:all.at(-1)||null,sample};
  fs.writeFileSync(path.join(DIR,'5uums-paged-history.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({pages,totalSignatures:all.length,sampleInstructions:sample.flatMap(x=>x.instructions.map(y=>({slot:x.slot,name:y.name}))).reduce((a,x)=>(a[x.name]=(a[x.name]||0)+1,a),{})},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
