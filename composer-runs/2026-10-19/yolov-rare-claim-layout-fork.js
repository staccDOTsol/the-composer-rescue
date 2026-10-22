#!/usr/bin/env node
// Local mainnet fork only. Vary a synthetic claim's u64 fields to identify
// the InvalidQueue guard. Every transaction is simulated, never submitted.
const fs=require('fs');const path=require('path');
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const rpc='http://127.0.0.1:18999';const connection=new Connection(rpc,'confirmed');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const claim='HnwbVZnyABatwWdjuCJTKPuBR1aaGjp8wdXrQ5WQcnPn';
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const addrs=['6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX',claim,'GMn8j1EtUqtmDbS867b3gMS39E9HvXhJiqhzRvTRaWG3',payer.publicKey.toBase58(),'4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK',program.toBase58()];
async function call(method,params){const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}
async function main(){
 const block=await connection.getLatestBlockhash('confirmed');
 const keys=addrs.map((a,i)=>({pubkey:new PublicKey(a),isSigner:i===3,isWritable:i<5}));
 const ix=new TransactionInstruction({programId:program,keys,data:Buffer.from('30c08139e6a1e994','hex')});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:[ix]}).compileToV0Message());tx.sign([payer]);
 const results=[];
 for(const off of [null,...Array.from({length:30},(_,i)=>8+i*8)]){
  const data=Buffer.alloc(256);Buffer.from('59c9f09ad4ff485c','hex').copy(data,0);if(off!==null)data.writeBigUInt64LE(17n,off);
  await call('surfnet_setAccount',[claim,{lamports:3000000,owner:program.toBase58(),executable:false,rentEpoch:0,data:data.toString('hex')}]);
  const sim=await connection.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed'});
  const entry={offset:off,err:sim.value.err,lastLog:(sim.value.logs||[]).find(x=>x.includes('AnchorError caused by account:'))||(sim.value.logs||[]).at(-1),units:sim.value.unitsConsumed};
  results.push(entry);if(off===null||!entry.lastLog?.includes('InvalidQueue'))console.log(JSON.stringify(entry));
 }
 fs.writeFileSync(path.join(__dirname,'yolov-rare-claim-layout-fork.json'),JSON.stringify({network:'local-mainnet-fork',syntheticClaim:true,results},null,2)+'\n');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
