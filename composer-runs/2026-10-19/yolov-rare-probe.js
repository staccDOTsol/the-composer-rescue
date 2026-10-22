#!/usr/bin/env node
// Negative account-shape probe only. Simulates a freshly signed transaction;
// there is deliberately no sendTransaction or sendRawTransaction call.
const fs=require('fs');
const path=require('path');
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const labels={payout:'30c08139e6a1e994',fees:'c6d4ab6d90d7ae59'};
const mode=process.argv[2]||'payout';
const count=Number(process.argv[3]||0);
const argumentBytes=Number(process.argv[4]||0);
if(!(mode in labels)||!Number.isInteger(count)||count<0||count>20)throw new Error('usage: payout|fees [0..20]');
if(!Number.isInteger(argumentBytes)||argumentBytes<0||argumentBytes>64)throw new Error('invalid argument byte length');
const fixtures={
 payout:['6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX',process.env.YOLOV_FAKE_CLAIM||null,'GMn8j1EtUqtmDbS867b3gMS39E9HvXhJiqhzRvTRaWG3',null,'4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK','yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA'],
 fees:[null,'3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf','6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX','4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD','GMn8j1EtUqtmDbS867b3gMS39E9HvXhJiqhzRvTRaWG3','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK','yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA']
};
const rpcEndpoint=process.env.YOLOV_RPC||'https://api.mainnet-beta.solana.com';
const connection=new Connection(rpcEndpoint,'confirmed');
async function main(){
 const block=await connection.getLatestBlockhash('confirmed');
 const keys=Array.from({length:count},(_,i)=>({pubkey:new PublicKey(fixtures[mode][i]||payer.publicKey),isSigner:!fixtures[mode][i],isWritable:true}));
 const ix=new TransactionInstruction({programId:program,keys,data:Buffer.concat([Buffer.from(labels[mode],'hex'),Buffer.alloc(argumentBytes)])});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:[ix]}).compileToV0Message());
 tx.sign([payer]);
 const wire=tx.serialize();
 const sim=await connection.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed'});
 const out={observedAt:new Date().toISOString(),network:rpcEndpoint.includes('127.0.0.1')?'local-mainnet-fork':'mainnet-beta',syntheticClaim:!!process.env.YOLOV_FAKE_CLAIM,mode,metas:count,argumentBytes,payer:payer.publicKey.toBase58(),wireBytes:wire.length,
  slot:sim.context.slot,err:sim.value.err,logs:sim.value.logs?.slice(0,24)||[],unitsConsumed:sim.value.unitsConsumed,noSubmission:true};
 const filename=path.join(__dirname,`yolov-rare-${mode}-${count}-${argumentBytes}${rpcEndpoint.includes('127.0.0.1')?'-fork':''}-probe.json`);
 fs.writeFileSync(filename,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
