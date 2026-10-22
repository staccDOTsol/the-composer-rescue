#!/usr/bin/env node
'use strict';
// Read-only current-state proof for closing the 5ok-authorized loader Buffer.
// Uses simulateTransaction with sigVerify:false. No key or transaction is sent.
const fs=require('fs'),path=require('path');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const dir=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const WRAPPER=new PublicKey('3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu');
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const BUFFER=new PublicKey('AXCknCf7KmCWAv4De6vg89hRBcZvBrAwinKSBipXgcSg');
const PDA=new PublicKey('5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi');
const A=new PublicKey('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N');
const B=new PublicKey('5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp');
const C=new PublicKey('12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn');
let id=0;
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}
async function snapshot(){const r=await rpc('getMultipleAccounts',[[BUFFER.toBase58(),A.toBase58()],{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:37}}]);const b=r.value[0]?.data?Buffer.from(r.value[0].data[0],'base64'):null;return {slot:r.context.slot,buffer:{lamports:r.value[0]?.lamports??null,owner:r.value[0]?.owner??null,loaderStateVariant:b?.readUInt32LE(0)??null,authorityOptionTag:b?.[4]??null,authority:b?.[4]===1?new PublicKey(b.subarray(5,37)).toBase58():null},recipientLamports:r.value[1]?.lamports??null};}
async function simulate(alias){
  const data=Buffer.concat([LOADER.toBuffer(),Buffer.from([4,0,0,0]),Buffer.from([5,0,0,0])]);
  const keys=[{pubkey:A,isSigner:true,isWritable:true},{pubkey:alias?A:B,isSigner:alias,isWritable:false},{pubkey:C,isSigner:false,isWritable:false},{pubkey:LOADER,isSigner:false,isWritable:false},{pubkey:BUFFER,isSigner:false,isWritable:true},{pubkey:A,isSigner:true,isWritable:true},{pubkey:PDA,isSigner:false,isWritable:false}];
  const ix=new TransactionInstruction({programId:WRAPPER,keys,data});
  const msg=new TransactionMessage({payerKey:A,recentBlockhash:'11111111111111111111111111111111',instructions:[ix]}).compileToV0Message();
  const wire=Buffer.from(new VersionedTransaction(msg).serialize());
  const out=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[BUFFER.toBase58(),A.toBase58()]}}]);
  return {alias,wireBytes:wire.length,requiredSignatures:msg.header.numRequiredSignatures,signerKeys:msg.staticAccountKeys.slice(0,msg.header.numRequiredSignatures).map(String),firstThreeCompiledAccountIndexes:Array.from(msg.compiledInstructions[0].accountKeyIndexes.slice(0,3)),slot:out.context.slot,err:out.value.err,unitsConsumed:out.value.unitsConsumed,postBufferLamports:out.value.accounts?.[0]?.lamports??null,postRecipientLamports:out.value.accounts?.[1]?.lamports??null,logs:out.value.logs,innerInstructions:out.value.innerInstructions};
}
async function main(){const before=await snapshot();const distinctControl=await simulate(false);const alias=await simulate(true);const after=await snapshot();const out={at:new Date().toISOString(),method:'get* and simulateTransaction only',instruction:'Upgradeable Loader Close bincode variant 5 on Buffer',before,distinctControl,alias,after,chainUnchanged:before.buffer.lamports===after.buffer.lamports};fs.writeFileSync(path.join(dir,'5uums-surface-native-buffer-close.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({...out,distinctControl:{...distinctControl,logs:distinctControl.logs?.slice(-8),innerInstructions:undefined},alias:{...alias,logs:alias.logs?.slice(-10),innerInstructions:undefined}},null,2));}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
