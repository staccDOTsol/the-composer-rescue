#!/usr/bin/env node
// Independent v0 read-only proof of upgrade-authority takeover with one
// authorized key aliased into two wrapper signer slots. No signing or send.
const fs=require('fs'),path=require('path');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=
  require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const dir=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL;
const wrapper=new PublicKey('3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu');
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const A=new PublicKey('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N');
const B=new PublicKey('5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp');
const C=new PublicKey('12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn');
const pda=new PublicKey('5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi');
const targets={bridge:'58cPagxAqtJzSnxi1yCWr9UVugj4jo25UX8eA5ctc1xY',
  wrapper:'CyXQ9V7xyAaXZSQXuqHHYgaRML6peJWtne5F2Cyav8D1'};
let id=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();
  if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
function authority(info){if(!info?.data)return null;const raw=Buffer.from(info.data[0],'base64');
  return {owner:info.owner,tag:raw.readUInt32LE(0),slot:raw.readBigUInt64LE(4).toString(),
    upgradeAuthority:raw[12]===1?new PublicKey(raw.subarray(13,45)).toBase58():null};}
async function sim(target,alias){
  const address=targets[target];
  const data=Buffer.concat([loader.toBuffer(),Buffer.from([4,0,0,0]),Buffer.from([4,0,0,0])]);
  const keys=[
    {pubkey:A,isSigner:true,isWritable:true},
    {pubkey:alias?A:B,isSigner:alias,isWritable:false},
    {pubkey:C,isSigner:false,isWritable:false},
    {pubkey:loader,isSigner:false,isWritable:false},
    {pubkey:new PublicKey(address),isSigner:false,isWritable:true},
    {pubkey:pda,isSigner:false,isWritable:false},
    {pubkey:A,isSigner:true,isWritable:true},
  ];
  const before=await rpc('getAccountInfo',[address,{encoding:'base64',commitment:'processed',dataSlice:{offset:0,length:45}}]);
  const ix=new TransactionInstruction({programId:wrapper,keys,data});
  const message=new TransactionMessage({payerKey:A,recentBlockhash:'11111111111111111111111111111111',instructions:[ix]}).compileToV0Message();
  const tx=new VersionedTransaction(message);const wire=Buffer.from(tx.serialize());
  const out=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,
    replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:[address]}}]);
  return {target,alias,wireBytes:wire.length,requiredSignatures:message.header.numRequiredSignatures,
    signerKeys:message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(String),
    compiledFirstThreeIndices:Array.from(message.compiledInstructions[0].accountKeyIndexes.slice(0,3)),
    currentSlot:out.context?.slot,err:out.value?.err,unitsConsumed:out.value?.unitsConsumed,
    before:authority(before.value),simulatedPost:authority(out.value?.accounts?.[0]),
    logs:out.value?.logs};
}
async function main(){
  const tests=[];
  for(const target of Object.keys(targets)){
    tests.push(await sim(target,false));tests.push(await sim(target,true));
  }
  const after=await rpc('getMultipleAccounts',[Object.values(targets),{encoding:'base64',
    commitment:'processed',dataSlice:{offset:0,length:45}}]);
  const chainAfter=Object.fromEntries(Object.keys(targets).map((name,i)=>[name,authority(after.value[i])]));
  const output={generatedAt:new Date().toISOString(),transport:'get* and simulateTransaction only; no signing or send',
    loaderInstruction:'SetAuthority bincode variant 4',caveat:'sigVerify:false and a zero signature model the only-A key signing; no chain state changed',
    tests,chainAfter};
  fs.writeFileSync(path.join(dir,'5uums-wrapper-upgrade-independent.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({tests:tests.map(t=>({target:t.target,alias:t.alias,wireBytes:t.wireBytes,
    requiredSignatures:t.requiredSignatures,signerKeys:t.signerKeys,
    compiledFirstThreeIndices:t.compiledFirstThreeIndices,err:t.err,
    before:t.before?.upgradeAuthority,simulatedPost:t.simulatedPost?.upgradeAuthority,
    logTail:t.logs?.slice(-5)})),chainAfter},null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
