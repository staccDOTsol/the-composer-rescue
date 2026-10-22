#!/usr/bin/env node
'use strict';
// Read-only one-operator-key wrapper->loader Close simulations. No signing or send.
const fs=require('fs'),path=require('path');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const DIR=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const pk=s=>new PublicKey(s),wrapper=pk('3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu'),loader=pk('BPFLoaderUpgradeab1e11111111111111111111111'),
 A=pk('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N'),B=pk('5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp'),C=pk('12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn'),
 authority=pk('5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi');
const targets={bridge:{program:'5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9',programData:'58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY'},wrapper:{program:'3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu',programData:'CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1'},thirdBridge:{program:'3fovWrsrARaWdqJYnHRMntkSHUUmYsjYv6MFxEfoD4H8',programData:'DVZhisAzrAeQfV1NGA53UJzfrWLrh3xJxp13ePoCWL3z'}};
let id=0;
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(!r.ok||j.error)throw Error(`${method}: ${j.error?.message||r.status}`);return j.result;}
function summary(account){if(!account)return null;const data=Buffer.from(account.data[0],'base64');return {owner:account.owner,lamports:account.lamports,space:account.space,executable:account.executable,tag:data.length>=4?data.readUInt32LE(0):null};}
async function test(name,target,alias){
 const addresses=[target.programData,target.program,A.toBase58(),authority.toBase58()];
 const pre=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'processed',dataSlice:{offset:0,length:45}}]);
 const ix=new TransactionInstruction({programId:wrapper,keys:[
  {pubkey:A,isSigner:true,isWritable:true},{pubkey:alias?A:B,isSigner:alias,isWritable:false},{pubkey:C,isSigner:false,isWritable:false},
  {pubkey:loader,isSigner:false,isWritable:false},{pubkey:pk(target.programData),isSigner:false,isWritable:true},
  {pubkey:A,isSigner:true,isWritable:true},{pubkey:authority,isSigner:false,isWritable:false},{pubkey:pk(target.program),isSigner:false,isWritable:true}
 ],data:Buffer.concat([loader.toBuffer(),Buffer.from([4,0,0,0]),Buffer.from([5,0,0,0])])});
 const message=new TransactionMessage({payerKey:A,recentBlockhash:'11111111111111111111111111111111',instructions:[ix]}).compileToV0Message();
 const wire=Buffer.from(new VersionedTransaction(message).serialize());
 const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,accounts:{encoding:'base64',addresses}}]);
 const post=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'processed',dataSlice:{offset:0,length:45}}]);
 return {name,alias,wireBytes:wire.length,requiredSignatures:message.header.numRequiredSignatures,signerKeys:message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(String),compiledFirstThreeIndices:Array.from(message.compiledInstructions[0].accountKeyIndexes.slice(0,3)),simSlot:sim.context.slot,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,addresses,chainBefore:pre.value.map(summary),simulatedPost:sim.value.accounts?.map(summary),chainAfter:post.value.map(summary),logs:sim.value.logs};
}
async function main(){const results=[];for(const [name,target] of Object.entries(targets)){results.push(await test(name,target,false));results.push(await test(name,target,true));}const out={generatedAt:new Date().toISOString(),method:'getMultipleAccounts and simulateTransaction only; sigVerify:false; no signing or send',instruction:'BPF Upgradeable Loader Close variant 5, [ProgramData, recipient, authority, Program]',results};fs.writeFileSync(path.join(DIR,'5uums-surface-programdata-close.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(results.map(x=>({name:x.name,alias:x.alias,wireBytes:x.wireBytes,err:x.err,before:x.chainBefore,simulatedPost:x.simulatedPost,chainAfter:x.chainAfter,logTail:x.logs?.slice(-8)})),null,2));}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
