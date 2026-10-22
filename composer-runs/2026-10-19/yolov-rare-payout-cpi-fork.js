#!/usr/bin/env node
// Read-only signed simulation against a local mainnet fork with synthetic
// claim/pool/destination state. No send RPC method is used.
const fs=require('fs');const path=require('path');
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const rpc='http://127.0.0.1:18999';const connection=new Connection(rpc,'confirmed');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const addresses=['6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX','HnwbVZnyABatwWdjuCJTKPuBR1aaGjp8wdXrQ5WQcnPn','GMn8j1EtUqtmDbS867b3gMS39E9HvXhJiqhzRvTRaWG3',payer.publicKey.toBase58(),'4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK',program.toBase58()];
async function main(){
 const block=await connection.getLatestBlockhash('confirmed');
 const keys=addresses.map((a,i)=>({pubkey:new PublicKey(a),isSigner:i===3,isWritable:i<5}));
 const ix=new TransactionInstruction({programId:program,keys,data:Buffer.from('30c08139e6a1e994','hex')});
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:block.blockhash,instructions:[ix]}).compileToV0Message());tx.sign([payer]);
 const q={jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[Buffer.from(tx.serialize()).toString('base64'),{encoding:'base64',sigVerify:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[addresses[0],addresses[1],addresses[2],addresses[4]]}}]};
 const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q)});const j=await r.json();if(j.error)throw Error(j.error.message);
 const v=j.result.value;const accountData=(v.accounts||[]).map(a=>a?Buffer.from(a.data[0],'base64'):null);
 const out={network:'local-mainnet-fork',syntheticAccounts:['pool','claim','destination'],noSubmission:true,slot:j.result.context.slot,error:v.err,logs:v.logs,innerInstructions:v.innerInstructions,units:v.unitsConsumed,
  claimBefore:{sequence:'17',owner:payer.publicKey.toBase58(),amount:'1'},poolBefore:{pending:'1',head:'17',tail:'18'},
  poolAfter:accountData[0]?.length>=56?{pending:accountData[0].readBigUInt64LE(32).toString(),head:accountData[0].readBigUInt64LE(40).toString(),tail:accountData[0].readBigUInt64LE(48).toString()}:null,
  claimAfter:accountData[1]?.length>=56?{lamports:v.accounts[1].lamports,sequence:accountData[1].readBigUInt64LE(8).toString(),amount:accountData[1].readBigUInt64LE(48).toString()}:{lamports:v.accounts?.[1]?.lamports??null,dataBytes:accountData[1]?.length??null},
  destinationAfter:accountData[2]?.length>=72?accountData[2].readBigUInt64LE(64).toString():null,
  vaultAfter:accountData[3]?.length>=72?accountData[3].readBigUInt64LE(64).toString():null};
 fs.writeFileSync(path.join(__dirname,'yolov-rare-payout-cpi-fork.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({slot:out.slot,error:out.error,innerInstructions:out.innerInstructions,poolAfter:out.poolAfter,claimAfter:out.claimAfter,destinationAfter:out.destinationAfter,vaultAfter:out.vaultAfter}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
