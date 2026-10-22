#!/usr/bin/env node
// Read-only receipt comparison for two observed no-update swap opens.
const fs=require('fs');const path=require('path');
const bs58m=require('../2026-10-15/onre-harness/node_modules/bs58');const bs58=bs58m.default||bs58m;
const envText=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const rpcUrl=envText.split(/\r?\n/).map(line=>line.trim()).find(line=>line.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');
if(!rpcUrl?.startsWith('https://'))throw new Error('RPC unavailable');
async function rpc(method,params){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error?.message||String(r.status));return j.result;}
const pairs=[
 {open:'3Br2fXRG3the4TXoHQgdjvafupPV7YYuHumbBjqrYMiwdPqvaQe8kVHHXYmbXsBhDQQUqw4m7cnMqFk4xenzX4iy',update:'ZFgcNGjsfZxmANaDe8Ndo23diEubVezxfPZv9BuyqPfR6dFxuWcqz1ZVk6pgdgabVHgpkHNNq7bMj9nFKo3wWU5'},
 {open:'gZgoJANZXrXGda9SfsXhFFqiEbkZxUrqqFkWQe7nsxMx3bt3dv7XqCxFFqf1CPhssgvANhz6xaFmjGHtjDzScmg',update:'3j5bGHKxFUmRviyKHRQyF9JGMTCVv8zUHmbGJd6WD7g1YqXbkPWAjwJc2vf97aNwr7hgHiB2aAW9LRSt8kPMUdVh'}
];
(async()=>{
 const out={observedAt:new Date().toISOString(),network:'mainnet-beta',program:'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA',comparisons:[]};
 for(const pair of pairs){
  const [open,update]=await Promise.all([rpc('getTransaction',[pair.open,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]),rpc('getTransaction',[pair.update,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}])]);
  const ix=open.transaction.message.instructions.find(i=>i.programId===out.program && i.data && Buffer.from(bs58.decode(i.data)).subarray(0,8).toString('hex')==='08ef3dc15e9087a8');
  const data=Buffer.from(bs58.decode(ix.data));
  const requestTime=Number(data.readBigInt64LE(16));
  out.comparisons.push({openSignature:pair.open,openSlot:open.slot,openBlockTime:open.blockTime,updateSignature:pair.update,updateSlot:update.slot,updateBlockTime:update.blockTime,
   oracleAccount:ix.accounts[10],openInstructions:(open.meta.logMessages||[]).filter(x=>x.includes('Instruction: ')).map(x=>x.split('Instruction: ')[1]),updateInstructions:(update.meta.logMessages||[]).filter(x=>x.includes('Instruction: ')).map(x=>x.split('Instruction: ')[1]),
   swapOpenDataHex:data.toString('hex'),requestTime,requestToOpenSeconds:open.blockTime-requestTime,updateToOpenSeconds:open.blockTime-update.blockTime,
   updateToOpenSlots:open.slot-update.slot});
 }
 fs.writeFileSync(path.join(__dirname,'yolov-economics-oracle-age.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.message);process.exitCode=1});
