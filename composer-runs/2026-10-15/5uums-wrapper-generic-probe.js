#!/usr/bin/env node
// Read-only test whether the one-signer alias reaches an arbitrary target CPI.
const fs=require('fs'), path=require('path');
const {PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction}=
  require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const bs58=require('./kliquidity-sdk-official/node_modules/bs58');
const dir=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('='))
  .map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL;
const rows=JSON.parse(fs.readFileSync(path.join(dir,'5uums-mutation-exemplars.json'))).rows;
const wrapper=new PublicKey('3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu');
const A=new PublicKey('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N');
const C=new PublicKey('12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn');
const pda=new PublicKey('5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi');
let id=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
async function sim(name,keys,data){
  const accounts=[A.toBase58(),pda.toBase58()];
  const before=await rpc('getMultipleAccounts',[accounts,{encoding:'base64',commitment:'processed'}]);
  const ix=new TransactionInstruction({programId:wrapper,keys,data});
  const msg=new TransactionMessage({payerKey:A,recentBlockhash:'11111111111111111111111111111111',instructions:[ix]}).compileToV0Message();
  const tx=new VersionedTransaction(msg);const wire=Buffer.from(tx.serialize());
  const out=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,
    replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:accounts}}]);
  return {name,bytes:wire.length,requiredSignatures:msg.header.numRequiredSignatures,
    signerKeys:msg.staticAccountKeys.slice(0,msg.header.numRequiredSignatures).map(String),
    firstSixIndexes:Array.from(msg.compiledInstructions[0].accountKeyIndexes.slice(0,6)),
    currentSlot:out.context?.slot,err:out.value?.err,unitsConsumed:out.value?.unitsConsumed,
    lamports:accounts.map((address,i)=>({address,pre:before.value[i]?.lamports,
      post:out.value?.accounts?.[i]?.lamports,
      delta:out.value?.accounts?.[i]?.lamports-before.value[i]?.lamports})),
    logs:out.value?.logs};
}
async function main(){
  const historic=rows.MIM.topInstructions.find(x=>x.programId===wrapper.toBase58());
  const original=Buffer.from(bs58.decode(historic.data));
  const pdaNow=await rpc('getAccountInfo',[pda.toBase58(),{encoding:'base64',commitment:'processed'}]);
  function wrapperData(lamports){
    const transfer=SystemProgram.transfer({fromPubkey:pda,toPubkey:A,lamports});
    const data=Buffer.concat([SystemProgram.programId.toBuffer(),Buffer.alloc(4),transfer.data]);
    data.writeUInt32LE(transfer.data.length,32);
    return data;
  }
  const minimal=[{pubkey:A,isSigner:true,isWritable:true},{pubkey:A,isSigner:true,isWritable:true},
    {pubkey:C,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    {pubkey:pda,isSigner:false,isWritable:true},{pubkey:A,isSigner:true,isWritable:true}];
  const extra=rows.MIM.accountKeys;
  const expanded=historic.accounts.map((addr,i)=>{
    const mapped=i===1?A:i===3?SystemProgram.programId:i===5?A:new PublicKey(addr);
    return {pubkey:mapped,isSigner:i===0||i===1||i===5,
      isWritable:i===0||i===1||i===4||i===5||!!extra.find(x=>x.pubkey===addr)?.writable};
  });
  const full=pdaNow.value.lamports;
  const tests=[await sim('minimal-system-transfer-1-lamport',minimal,wrapperData(1)),
    await sim('minimal-system-transfer-full-PDA-SOL',minimal,wrapperData(full)),
    await sim('minimal-system-transfer-over-balance',minimal,wrapperData(full+1)),
    await sim('expanded-system-transfer-1-lamport',expanded,wrapperData(1))];
  const output={generatedAt:new Date().toISOString(),transport:'get* and simulateTransaction only; no signing or send',
    assumption:'wrapper data encodes 32-byte target program ID, u32 inner-data length, and inner instruction bytes; test replaces target with System Program and inner bytes with transfers of 1 lamport, full PDA SOL, and full+1',
    pdaLamportsAtStart:full,
    tests};
  fs.writeFileSync(path.join(dir,'5uums-wrapper-generic-probe.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(tests.map(x=>({name:x.name,bytes:x.bytes,requiredSignatures:x.requiredSignatures,
    signerKeys:x.signerKeys,err:x.err,lamports:x.lamports,logs:x.logs?.slice(-8)})),null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
