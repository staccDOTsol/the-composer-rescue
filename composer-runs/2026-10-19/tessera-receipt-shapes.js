#!/usr/bin/env node
'use strict';
const fs=require('fs');
const bs58Module=require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const root=__dirname;
const program='TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH';
const envrow=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=envrow.slice(envrow.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const idl=JSON.parse(fs.readFileSync(`${root}/tessera-composer-learn.json`));
const census=JSON.parse(fs.readFileSync(`${root}/tessera-current-census.json`));
const learned=new Map(idl.instructions.map(x=>[Buffer.from(x.discriminator).toString('hex'),x]));
let id=0;
async function rpc(method,params=[]){for(let attempt=0;attempt<4;attempt++){
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
 const b=await r.json(); if(r.ok&&!b.error)return b.result;
 if(attempt===3)throw Error(`${method}: ${b.error?.message||r.status}`);
 await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
}}
function accountKeys(tx){return tx.transaction.message.accountKeys.map(x=>typeof x==='string'?{pubkey:x,signer:false,writable:false}:x)}
function tokenDeltas(tx,keys){
 const a=new Map((tx.meta?.preTokenBalances||[]).map(x=>[x.accountIndex,x]));
 const b=new Map((tx.meta?.postTokenBalances||[]).map(x=>[x.accountIndex,x]));
 return [...new Set([...a.keys(),...b.keys()])].map(i=>{
  const pre=a.get(i),post=b.get(i),row=post||pre;
  const before=BigInt(pre?.uiTokenAmount?.amount||'0'),after=BigInt(post?.uiTokenAmount?.amount||'0');
  return {address:keys[i]?.pubkey,mint:row.mint,owner:row.owner,delta:(after-before).toString(),before:before.toString(),after:after.toString()};
 }).filter(x=>x.delta!=='0');
}
function summarizeIx(ix,keys,source){
 const data=Buffer.from(bs58.decode(ix.data||''));const discriminator=data.subarray(0,2).toString('hex');const shape=learned.get(discriminator);
 const accounts=(ix.accounts||[]).map((address,i)=>({address,signer:!!keys.find(x=>x.pubkey===address)?.signer,writable:!!keys.find(x=>x.pubkey===address)?.writable,
   expected:shape?.accounts[i]?.address||null}));
 return {source,discriminator,name:shape?.name||null,dataHex:data.toString('hex'),dataBytes:data.length,accounts,
   shapeMismatch:shape?(accounts.length!==shape.accounts.length||accounts.some((a,i)=>a.expected&&a.expected!==a.address||shape.accounts[i]?.signer&&!a.signer||shape.accounts[i]?.writable&&!a.writable)):null};
}
async function main(){
 const sampleSignatures=[...new Set(idl.instructions.flatMap(ix=>ix.exampleSignatures.slice(0,2)))];
 const latest=await rpc('getSignaturesForAddress',[program,{limit:50,commitment:'confirmed'}]);
 const holdout=latest.filter(x=>x.slot>census.slot&&!x.err).slice(0,12).map(x=>x.signature);
 const out={observedAt:new Date().toISOString(),learnEvidence:idl.evidence,learnSampleCount:sampleSignatures.length,holdoutAfterSlot:census.slot,holdoutCount:holdout.length,receipts:[]};
 for(const signature of [...new Set([...sampleSignatures,...holdout])]){
  const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  if(!tx)continue;
  const keys=accountKeys(tx),ixs=[];
  tx.transaction.message.instructions.forEach((ix,index)=>{if(ix.programId===program)ixs.push(summarizeIx(ix,keys,`top:${index}`))});
  (tx.meta?.innerInstructions||[]).forEach(g=>g.instructions.forEach((ix,index)=>{if(ix.programId===program)ixs.push(summarizeIx(ix,keys,`inner:${g.index}:${index}`))}));
  out.receipts.push({signature,slot:tx.slot,version:tx.version,err:tx.meta?.err,holdout:holdout.includes(signature),
   signers:keys.filter(x=>x.signer).map(x=>x.pubkey),instructions:ixs,tokenDeltas:tokenDeltas(tx,keys),
   logs:(tx.meta?.logMessages||[]).filter(x=>x.includes(program)||x.includes('Instruction:')||x.includes('failed:'))});
 }
 out.summary={bySelector:Object.fromEntries([...new Set(out.receipts.flatMap(x=>x.instructions.map(i=>i.discriminator)))].map(d=>[d,out.receipts.flatMap(x=>x.instructions).filter(i=>i.discriminator===d).length])),
  shapeMismatches:out.receipts.flatMap(x=>x.instructions.filter(i=>i.shapeMismatch).map(i=>({signature:x.signature,selector:i.discriminator,accounts:i.accounts.length}))),
  holdoutInstructions:out.receipts.filter(x=>x.holdout).flatMap(x=>x.instructions).length,
  holdoutUnknown:out.receipts.filter(x=>x.holdout).flatMap(x=>x.instructions).filter(i=>!i.name).length};
 fs.writeFileSync(`${root}/tessera-receipt-shapes.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({summary:out.summary,receipts:out.receipts.length,holdoutCount:out.holdoutCount},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
