#!/usr/bin/env node
// Local Surfpool fork only: override a synthetic account and simulate signed
// ProcessPayout. No sendTransaction or sendRawTransaction calls.
const fs=require('fs');
const crypto=require('crypto');
const path=require('path');
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const rpc='http://127.0.0.1:18999';
const claimKey=new PublicKey('HnwbVZnyABatwWdjuCJTKPuBR1aaGjp8wdXrQ5WQcnPn');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const names=['raw:59c9f09ad4ff485c','raw:689139dd78c93ecb'];
async function call(method,params){
 const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const j=await r.json(); if(j.error)throw new Error(method+': '+j.error.message); return j.result;
}
async function main(){
 const connection=new Connection(rpc,'confirmed');
 const block=await connection.getLatestBlockhash('confirmed');
 const keys=[
  {pubkey:new PublicKey('6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX'),isSigner:false,isWritable:true},
  {pubkey:claimKey,isSigner:false,isWritable:true}
 ];
 const ix=new TransactionInstruction({programId:program,keys,data:Buffer.from('30c08139e6a1e994','hex')});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:[ix]}).compileToV0Message());tx.sign([payer]);
 const results=[];
 for(const name of names){
  const disc=name.startsWith('raw:')?Buffer.from(name.slice(4),'hex'):crypto.createHash('sha256').update('account:'+name).digest().subarray(0,8);
  const data=Buffer.concat([disc,Buffer.alloc(248)]);
  await call('surfnet_setAccount',[claimKey.toBase58(),{lamports:3000000,owner:program.toBase58(),executable:false,rentEpoch:0,data:data.toString('hex')}]);
  const sim=await connection.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed'});
  const logs=sim.value.logs||[];
  const entry={name,discriminator:disc.toString('hex'),err:sim.value.err,lastLog:logs.find(x=>x.includes('AnchorError caused by account:'))||logs.at(-1),slot:sim.context.slot};
  results.push(entry);console.log(JSON.stringify(entry));
 }
 fs.writeFileSync(path.join(__dirname,'yolov-rare-claim-type-fork.json'),JSON.stringify({network:'local-mainnet-fork',syntheticAccount:true,programSha256:'c75637981b6731d8719d8521e93176e00dc5f74d861413ba1475a6af84c9d9c4',results},null,2)+'\n');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
