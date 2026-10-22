#!/usr/bin/env node
'use strict';
// Read-only current-state simulation of benign System transfer through the
// multisig wrapper. Only RPC reads and simulateTransaction are called.
const fs=require('fs'),path=require('path');
const {PublicKey,SystemProgram,Transaction,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR=__dirname,WRAPPER='3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu',PDA='5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi',A='FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N',B='5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp',C='12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let n=0;async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++n,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}
async function balances(){const r=await rpc('getMultipleAccounts',[[PDA,A],{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);return{slot:r.context.slot,pda:r.value[0]?.lamports,a:r.value[1]?.lamports};}
async function main(){
  const [blockhash,before]=await Promise.all([rpc('getLatestBlockhash',[{commitment:'confirmed'}]),balances()]);
  const systemIx=SystemProgram.transfer({fromPubkey:new PublicKey(PDA),toPubkey:new PublicKey(A),lamports:1});
  const data=Buffer.concat([SystemProgram.programId.toBuffer(),Buffer.from([systemIx.data.length,0,0,0]),systemIx.data]);
  const variants=[
    {label:'reference_A_B',signerSlots:[A,B,C],signers:new Set([A,B])},
    {label:'only_A_distinct_slots',signerSlots:[A,B,C],signers:new Set([A])},
    {label:'one_A_aliased_twice',signerSlots:[A,A,C],signers:new Set([A])},
  ];
  const results=[];
  for(const v of variants){
    const keys=v.signerSlots.map(x=>({pubkey:new PublicKey(x),isSigner:v.signers.has(x),isWritable:x===A}));
    keys.push({pubkey:SystemProgram.programId,isSigner:false,isWritable:false});
    keys.push({pubkey:new PublicKey(PDA),isSigner:false,isWritable:true});
    keys.push({pubkey:new PublicKey(A),isSigner:true,isWritable:true});
    const tx=new Transaction({feePayer:new PublicKey(A),recentBlockhash:blockhash.value.blockhash}).add(new TransactionInstruction({programId:new PublicKey(WRAPPER),keys,data}));
    const msg=tx.compileMessage();
    const b64=tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
    const sim=await rpc('simulateTransaction',[b64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[PDA,A]}}]);
    results.push({label:v.label,signerSlots:v.signerSlots,requiredSigners:msg.accountKeys.slice(0,msg.header.numRequiredSignatures).map(x=>x.toBase58()),numRequiredSignatures:msg.header.numRequiredSignatures,compiledAccountIndices:msg.instructions[0].accounts,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,logs:sim.value.logs,innerInstructions:sim.value.innerInstructions,postPdaLamports:sim.value.accounts?.[0]?.lamports??null,postALamports:sim.value.accounts?.[1]?.lamports??null});
  }
  const after=await balances();
  const out={at:new Date().toISOString(),targetProgram:SystemProgram.programId.toBase58(),targetInstruction:'SystemProgram.transfer 1 lamport',targetInstructionHex:systemIx.data.toString('hex'),wrapperDataHex:data.toString('hex'),before,after,noChainPdaBalanceChange:before.pda===after.pda,results};
  fs.writeFileSync(path.join(DIR,'5uums-wrapper-generic-cpi.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({...out,results:results.map(x=>({label:x.label,requiredSigners:x.requiredSigners,compiledAccountIndices:x.compiledAccountIndices,err:x.err,unitsConsumed:x.unitsConsumed,postPdaLamports:x.postPdaLamports,postALamports:x.postALamports,logs:x.logs?.filter(y=>y.includes('invoke')||y.includes('failed'))}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
