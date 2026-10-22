#!/usr/bin/env node
'use strict';
// Read-only history/exit reconstruction from confirmed Solana RPC.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const DIR=__dirname,PROGRAM='5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const ADDRESSES={program:PROGRAM,authority:'Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK',MIM:'7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w',DOG:'5yXSQmeFkxCYrfcPpgu8UBpy3gqThvXXGVAUyRPAvVWb',PUPS:'A7w8ytRtX225qiPmn52kMGsob5aR3obVfL4qcqVBHeK1'};
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let rpcId=0;
async function rpc(method,params){for(let tries=0;tries<4;tries++){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});if((r.status===429||r.status>=500)&&tries<3){await new Promise(f=>setTimeout(f,600*(tries+1)));continue;}if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}}
const instructionNames=['init_bridge','transfer_bridge_now','transfer_bridge','accept_bridge','init','set_mint_authority','mint','burn','lock','unlock'];
const discriminators=new Map(instructionNames.map(n=>[crypto.createHash('sha256').update('global:'+n).digest('hex').slice(0,16),n]));
function key(x){return typeof x==='string'?x:x.pubkey;}
function compactIx(ix,keys){
  const pid=ix.programId||keys[ix.programIdIndex];
  const accounts=ix.accounts?.map(x=>typeof x==='number'?keys[x]:x)||[];
  const b=ix.data?Buffer.from(bs58.decode(ix.data)):null;
  const info={programId:pid,accounts,parsed:ix.parsed||null,stackHeight:ix.stackHeight||null};
  if(b){info.dataBase58=ix.data;info.dataHex=b.toString('hex');info.discriminator=b.subarray(0,8).toString('hex');info.instruction=discriminators.get(info.discriminator)||null;info.bodyHex=b.subarray(8).toString('hex');}
  return info;
}
async function main(){
  const signatures={};
  for(const [label,address] of Object.entries(ADDRESSES)) signatures[label]=await rpc('getSignaturesForAddress',[address,{limit:100,commitment:'confirmed'}]);
  const unique=[...new Set(Object.values(signatures).flat().map(x=>x.signature))];
  const txs=[];
  for(let i=0;i<Math.min(unique.length,100);i++){
    const signature=unique[i];
    const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
    if(!tx)continue;
    const keys=tx.transaction.message.accountKeys.map(key);
    const top=tx.transaction.message.instructions.map(ix=>compactIx(ix,keys));
    const inner=(tx.meta.innerInstructions||[]).flatMap(group=>group.instructions.map(ix=>({...compactIx(ix,keys),outerInstructionIndex:group.index})));
    txs.push({signature,slot:tx.slot,blockTime:tx.blockTime,err:tx.meta.err,keys,top,inner,logs:(tx.meta.logMessages||[]).filter(x=>x.includes('Instruction:')||x.includes('Error')||x.includes('consumed'))});
    if(i%10===9)process.stderr.write(`fetched ${i+1}/${Math.min(unique.length,100)}\n`);
  }
  const report={fetchedAt:new Date().toISOString(),sources:Object.fromEntries(Object.entries(signatures).map(([k,v])=>[k,{count:v.length,first:v[0]||null,last:v.at(-1)||null}])),uniqueSignatures:unique.length,transactions:txs};
  fs.writeFileSync(path.join(DIR,'5uums-history.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({sources:report.sources,uniqueSignatures:unique.length,fetched:txs.length,instructions:txs.flatMap(x=>x.top.filter(y=>y.programId===PROGRAM).map(y=>({name:y.instruction,discriminator:y.discriminator,bodyHex:y.bodyHex,accounts:y.accounts,signature:x.signature,slot:x.slot,err:x.err}))),vaultExits:txs.flatMap(x=>x.inner.filter(y=>y.parsed?.info?.authority===ADDRESSES.authority && Object.values(ADDRESSES).includes(y.parsed?.info?.source)).map(y=>({signature:x.signature,slot:x.slot,outerInstructionIndex:y.outerInstructionIndex,parsed:y.parsed})))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
