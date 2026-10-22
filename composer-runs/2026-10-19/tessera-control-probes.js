#!/usr/bin/env node
'use strict';
// Signed, read-only outsider mutation probes, replaying recent payloads with outsider signer.
const fs=require('fs');
const web3=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {PublicKey,Keypair,Transaction,TransactionInstruction}=web3;
const pk=x=>new PublicKey(x);
const program=pk('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const wallet=key.publicKey;
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
async function main(){
 const receipts=JSON.parse(fs.readFileSync(`${__dirname}/tessera-receipt-shapes.json`));
 const selectors=['0d01','0d0a','1504'];
 const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
 const out={observedAt:new Date().toISOString(),wallet:wallet.toBase58(),cases:[]};
 for(const selector of selectors){
  const observed=receipts.receipts.find(r=>r.instructions.some(i=>i.discriminator===selector));
  const ix=observed.instructions.find(i=>i.discriminator===selector);
  const accounts=ix.accounts.map((a,j)=>({pubkey:pk(j===(selector==='1504'?1:0)?wallet.toBase58():a.address),isSigner:j===(selector==='1504'?1:0),isWritable:a.writable}));
  const tx=new Transaction({feePayer:wallet,recentBlockhash:blockhash});
  tx.add(new TransactionInstruction({programId:program,keys:accounts,data:Buffer.from(ix.dataHex,'hex')}));
  tx.sign(key);const wire=tx.serialize();
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'}]);
  out.cases.push({selector,sourceSignature:observed.signature,sourceSlot:observed.slot,target:accounts[selector==='1504'?2:1].pubkey.toBase58(),wireBytes:wire.length,accountKeys:tx.compileMessage().accountKeys.length,
   simSlot:sim.context.slot,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,logs:(sim.value.logs||[]).filter(x=>x.includes('TessVdML')||x.includes('failed:'))});
 }
 fs.writeFileSync(`${__dirname}/tessera-control-probes.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
