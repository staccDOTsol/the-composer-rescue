#!/usr/bin/env node
// Read-only independent receipts and historical holdout for Composer's learned interface.
const fs=require('fs');
const bs58mod=require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58=bs58mod.default||bs58mod;
const e=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!e)throw Error('SOLANA_RPC unavailable');
const url=e.slice(e.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const program='STANDjrnkxme4tKsZSnW3WUQ9iKxbhJQj33dbW2F9sZ';
const vault='3GzZn1Qyzc6xzCgDn83teJysBW2bMCsK6DcRNhksMNo4';
const learned=JSON.parse(fs.readFileSync(__dirname+'/stand-dusd-composer-learn-250.json','utf8'));
const byDisc=new Map(learned.instructions.map(i=>[Buffer.from(i.discriminator).toString('hex'),i]));
let id=0;
async function rpc(method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
 const b=await r.json();if(!r.ok||b.error)throw Error(`${method}: ${b.error?.message||r.status}`);return b.result;
}
function decode(tx,signature,holdout){
 const m=tx.transaction.message,h=m.header,keys=[...m.accountKeys,...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
 const writable=idx=>idx<h.numRequiredSignatures?idx<h.numRequiredSignatures-h.numReadonlySignedAccounts:
  idx<m.accountKeys.length?idx<m.accountKeys.length-h.numReadonlyUnsignedAccounts:
  idx<m.accountKeys.length+(tx.meta?.loadedAddresses?.writable?.length||0);
 const instructions=[...m.instructions.map((ix,i)=>({ix,location:'top',index:i})),
  ...(tx.meta?.innerInstructions||[]).flatMap(g=>g.instructions.map((ix,i)=>({ix,location:`inner_${g.index}`,index:i})))];
 const stand=instructions.filter(x=>keys[x.ix.programIdIndex]===program).map(x=>{
  const data=Buffer.from(bs58.decode(x.ix.data||''));const selector=data.subarray(0,8).toString('hex');const l=byDisc.get(selector);
  const ac=x.ix.accounts.map(i=>keys[i]);const mismatches=[];
  if(l){
   if(ac.length!==l.accounts.length)mismatches.push(`count_${ac.length}_${l.accounts.length}`);
   l.accounts.forEach((spec,j)=>{if(j>=ac.length)return;
    if(spec.address&&spec.address!==ac[j])mismatches.push(`address_${j}`);
    if(spec.signer&&x.ix.accounts[j]>=h.numRequiredSignatures)mismatches.push(`signer_${j}`);
    if(spec.writable&&!writable(x.ix.accounts[j]))mismatches.push(`writable_${j}`);
   });
  }
  return {location:x.location,index:x.index,selector,name:selector==='447286d63adcdc30'?'ReqRemoteCall':selector==='7a068c57ad840711'?'AckRemoteCall':selector==='e445a52e51cb9a1d'?'event_cpi':null,accounts:ac,signers:ac.filter((_,j)=>x.ix.accounts[j]<h.numRequiredSignatures),dataBytes:data.length,argsHex:data.subarray(8).toString('hex'),composerMismatches:mismatches};
 });
 const ib=new Map((tx.meta?.preTokenBalances||[]).map(x=>[x.accountIndex,x]));
 const ia=new Map((tx.meta?.postTokenBalances||[]).map(x=>[x.accountIndex,x]));
 const tokenDeltas=[...new Set([...ib.keys(),...ia.keys()])].map(i=>{
  const a=ia.get(i),b=ib.get(i),x=a||b;return {account:keys[i],mint:x.mint,owner:x.owner||null,delta:(BigInt(a?.uiTokenAmount.amount||0)-BigInt(b?.uiTokenAmount.amount||0)).toString()};
 }).filter(x=>x.delta!=='0');
 const logs=(tx.meta?.logMessages||[]).filter(x=>x.includes('Instruction: ')||x.includes('AnchorError')||x.includes('Program data:'));
 return {signature,slot:tx.slot,blockTime:tx.blockTime,holdout,version:tx.version,signers:keys.slice(0,h.numRequiredSignatures),stand,tokenDeltas,logs};
}
async function main(){
 const gate=JSON.parse(fs.readFileSync(__dirname+'/stand-dusd-current-gate.json','utf8'));
 const listed=await rpc('getSignaturesForAddress',[program,{limit:300,commitment:'confirmed'}]);
 const recent=gate.recentSpends.map(x=>x.signature);
 const held=listed.slice(250,260).map(x=>x.signature);
 const output={observedAt:new Date().toISOString(),program,vault,composerTrainingSignaturesScanned:learned.evidence.signaturesScanned,listed:listed.length,holdoutSelection:'positions 251–260 in newest-first program signature list, disjoint from Composer first 250 latest if its sampling follows the documented count',transactions:[]};
 for(const [i,s] of [...recent,...held].entries()){
  const tx=await rpc('getTransaction',[s,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  if(tx)output.transactions.push(decode(tx,s,i>=recent.length));
 }
 output.summary={recentSpends:output.transactions.filter(t=>!t.holdout).length,holdoutTransactions:output.transactions.filter(t=>t.holdout).length,
  holdoutUnknown:output.transactions.filter(t=>t.holdout).flatMap(t=>t.stand).filter(x=>!byDisc.has(x.selector)).length,
  holdoutMismatch:output.transactions.filter(t=>t.holdout).flatMap(t=>t.stand).filter(x=>x.composerMismatches.length).length,
  byName:Object.fromEntries([...new Set(output.transactions.flatMap(t=>t.stand.map(x=>x.name)))].map(n=>[n,output.transactions.flatMap(t=>t.stand).filter(x=>x.name===n).length]))};
 fs.writeFileSync(__dirname+'/stand-dusd-receipts.json',JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({summary:output.summary,recent:output.transactions.filter(x=>!x.holdout).map(t=>({signature:t.signature,slot:t.slot,signers:t.signers,names:t.stand.map(x=>x.name),deltas:t.tokenDeltas})),holdout:output.transactions.filter(x=>x.holdout).map(t=>({signature:t.signature,slot:t.slot,names:t.stand.map(x=>x.name),mismatches:t.stand.flatMap(x=>x.composerMismatches)}))}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
