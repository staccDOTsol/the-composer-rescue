#!/usr/bin/env node
// Bounded, read-only mainnet scan for YOLO selectors absent from Composer's active sample.
const fs = require('fs');
const path = require('path');
const bs58m = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58m.default || bs58m;
const program = 'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA';
const common = new Set([
  '87802f4d0f98f031','7b86510031446262','bb4ae5956651dd44',
  '5eef84ddc1a309cb','08ef3dc15e9087a8','e445a52e51cb9a1d'
]);
const envText = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const rpcUrl = envText.split(/\r?\n/).map(x=>x.trim())
  .find(x=>x.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length)
  .trim().replace(/^['"]|['"]$/g,'');
if (!rpcUrl?.startsWith('https://')) throw new Error('RPC unavailable');
const max = Math.min(Math.max(Number(process.argv[2] || 10000),1),20000);
let requestId = 1;

async function post(payload) {
  for (let attempt=0; attempt<8; attempt++) {
    try {
      const response = await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
      const body = await response.json();
      if (response.ok && !(body?.error)) return body;
    } catch (error) { if (attempt===7) throw error; }
    await new Promise(resolve=>setTimeout(resolve,Math.min(500*2**attempt,8000)));
  }
  throw new Error('RPC retries exhausted');
}
async function rpc(method,params) {
  const body=await post({jsonrpc:'2.0',id:requestId++,method,params});
  if(body.error)throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function batchTransactions(signatures) {
  const reqs=signatures.map(signature=>({jsonrpc:'2.0',id:requestId++,method:'getTransaction',params:[signature,
    {encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]}));
  const body=await post(reqs);
  const byId=new Map(body.map(x=>[x.id,x]));
  return reqs.map(x=>byId.get(x.id)?.result || null);
}
function selectors(tx) {
  const out=[];
  const take=ix=>{
    if(ix?.programId!==program || typeof ix.data!=='string')return;
    const data=Buffer.from(bs58.decode(ix.data));
    out.push({selector:data.subarray(0,8).toString('hex'),dataHex:data.toString('hex'),accounts:ix.accounts||[]});
  };
  tx.transaction.message.instructions.forEach(take);
  (tx.meta?.innerInstructions||[]).forEach(group=>group.instructions.forEach(take));
  return out;
}
async function main() {
  const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('not mainnet-beta');
  let before,scanned=0,minSlot=null,maxSlot=null;
  const matches=[];
  const counts={};
  while(scanned<max){
    const page=await rpc('getSignaturesForAddress',[program,{limit:Math.min(1000,max-scanned),before,commitment:'confirmed'}]);
    if(!page.length)break;
    if(maxSlot===null)maxSlot=page[0].slot;
    minSlot=page.at(-1).slot;
    for(let offset=0;offset<page.length;offset+=100){
      const chunk=page.slice(offset,offset+100);
      const txs=await batchTransactions(chunk.map(x=>x.signature));
      for(let i=0;i<txs.length;i++){
        const tx=txs[i]; if(!tx)continue;
        const found=selectors(tx);
        for(const ix of found)counts[ix.selector]=(counts[ix.selector]||0)+1;
        const rare=found.filter(ix=>!common.has(ix.selector));
        if(rare.length)matches.push({signature:chunk[i].signature,slot:tx.slot,err:tx.meta?.err,
          signers:tx.transaction.message.accountKeys.filter(x=>x.signer).map(x=>x.pubkey),
          instructions:rare,logs:(tx.meta?.logMessages||[]).filter(x=>/Instruction:|Program log: AnchorError/.test(x))});
      }
    }
    scanned+=page.length;
    before=page.at(-1).signature;
    console.error(JSON.stringify({scanned,minSlot,matches:matches.length}));
    if(page.length<1000)break;
  }
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,program,
    scanned,maxSlot,minSlot,selectorCounts:counts,rareMatches:matches};
  fs.writeFileSync(path.join(__dirname,'yolov-rare-receipts.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({scanned,maxSlot,minSlot,selectorCounts:counts,rareMatches:matches.length}));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
