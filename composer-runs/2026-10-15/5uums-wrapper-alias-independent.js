#!/usr/bin/env node
// Independent read-only reproduction of duplicate-signer metas in the live
// RuneMine wrapper. Never signs or sends a transaction.
const fs = require('fs');
const path = require('path');
const {PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction} =
  require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const bs58 = require('./kliquidity-sdk-official/node_modules/bs58');
const dir = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint = env.RPC_URL;
const rows = JSON.parse(fs.readFileSync(path.join(dir,'5uums-mutation-exemplars.json'))).rows;
const wrapper = new PublicKey('3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu');
const A = new PublicKey('FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N');
const B = new PublicKey('5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp');
const C = new PublicKey('12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn');
const watch = {
  MIM: ['7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w',
    '4rfDdc8xLDWBiqRKpVQS689ivWAqe6ae9ckfc9c8HNDi',
    'GQZmALKPHca7XHiXDCNiogXUP4rKWqj28CVQb4EEfCRE'],
  DOG: ['5yXSQmeFkxCYrfcPpgu8UBpy3gqThvXXGVAUyRPAvVWb',
    '9XruDz444Wc6DwtM4rAooBgAZUGNeFnEwkyArjbBf2dA'],
  PUPS: ['A7w8ytRtX225qiPmn52kMGsob5aR3obVfL4qcqVBHeK1',
    'yBvRQpgBbyrNtoWCAW6BxBHDGcqyDXgZzy2fZgiBYNC'],
};
let id=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}); const j=await r.json();
  if(j.error) throw Error(JSON.stringify(j.error)); return j.result;}
function amount(info){if(!info?.data)return null;const b=Buffer.from(info.data[0],'base64');
  return b.length>=72?b.readBigUInt64LE(64).toString():null;}
function source(symbol) {
  const row=rows[symbol]; const top=row.topInstructions.find(ix=>ix.programId===wrapper.toBase58());
  const flags=new Map(row.accountKeys.map(k=>[k.pubkey,k]));
  const keys=top.accounts.map(addr=>({pubkey:new PublicKey(addr),isSigner:!!flags.get(addr)?.signer,
    isWritable:!!flags.get(addr)?.writable}));
  return {data:Buffer.from(bs58.decode(top.data)),keys};
}
function clone(x){return {data:Buffer.from(x.data),keys:x.keys.map(k=>({...k}))};}
function ix(x){return new TransactionInstruction({programId:wrapper,data:x.data,keys:x.keys});}
async function test(label,symbol,variant){
  const x=clone(source(symbol)); variant(x);
  const obs=watch[symbol]; const pre=await rpc('getMultipleAccounts',[obs,{encoding:'base64',commitment:'processed'}]);
  const message=new TransactionMessage({payerKey:A,recentBlockhash:'11111111111111111111111111111111',
    instructions:[ix(x)]}).compileToV0Message();
  const tx=new VersionedTransaction(message); const wire=Buffer.from(tx.serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,
    replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:obs}}]);
  const before=pre.value.map(amount),after=sim.value.accounts?.map(amount);
  return {label,symbol,wireBytes:wire.length,version:0,signatureSlots:tx.signatures.length,
    requiredSignatures:message.header.numRequiredSignatures,
    signerKeys:message.staticAccountKeys.slice(0,message.header.numRequiredSignatures).map(String),
    firstThreeMetas:x.keys.slice(0,3).map(k=>({address:k.pubkey.toBase58(),isSigner:k.isSigner})),
    firstThreeCompiledIndexes:Array.from(message.compiledInstructions[0].accountKeyIndexes.slice(0,3)),
    amountRaw:x.data.readBigUInt64LE(x.data.length-8).toString(),
    currentSlot:sim.context?.slot, snapshotSlot:pre.context?.slot,err:sim.value.err,
    unitsConsumed:sim.value.unitsConsumed,
    tokens:obs.map((address,i)=>({address,pre:before[i],post:after?.[i],
      delta:before[i]&&after?.[i]?(BigInt(after[i])-BigInt(before[i])).toString():null})),
    logs:sim.value.logs?.filter(s=>/3LWzk|5UuMS|Tokenkeg|Instruction:|AnchorError|Error|failed/.test(s))};
}
async function main(){
  const aInfo=await rpc('getAccountInfo',[A.toBase58(),{encoding:'base64',commitment:'processed'}]);
  const initial=await rpc('getMultipleAccounts',[Object.values(watch).map(x=>x[0]),{encoding:'base64',commitment:'processed'}]);
  const full=initial.value.map(x=>BigInt(amount(x)));
  const tests=[];
  const onlyA=x=>{x.keys[1].isSigner=false;x.keys[2].isSigner=false;};
  const duplicateAinB=x=>{x.keys[1].pubkey=A;x.keys[1].isSigner=true;x.keys[2].isSigner=false;};
  tests.push(await test('control-only-A-distinct-slots','MIM',onlyA));
  tests.push(await test('A-duplicated-in-B-slot-original-amount','MIM',duplicateAinB));
  tests.push(await test('A-duplicated-in-B-slot-full-MIM','MIM',x=>{
    duplicateAinB(x);x.data.writeBigUInt64LE(full[0],x.data.length-8);
  }));
  tests.push(await test('A-duplicated-in-B-slot-alternate-recipient','MIM',x=>{
    duplicateAinB(x);x.data.writeBigUInt64LE(1n,x.data.length-8);
    x.keys[8].pubkey=new PublicKey(watch.MIM[2]);
    x.keys[9].pubkey=new PublicKey('7Lzj4Jr46rQUdKst1drAxSP2sBcQVvMoCBaDsrEYhWqj');
  }));
  tests.push(await test('A-duplicated-in-C-slot','MIM',x=>{
    x.keys[1].isSigner=false;x.keys[2].pubkey=A;x.keys[2].isSigner=true;
  }));
  tests.push(await test('A-duplicated-in-B-slot-full-DOG','DOG',x=>{
    duplicateAinB(x);x.data.writeBigUInt64LE(full[1],x.data.length-8);
  }));
  tests.push(await test('A-duplicated-in-B-slot-full-PUPS','PUPS',x=>{
    duplicateAinB(x);x.data.writeBigUInt64LE(full[2],x.data.length-8);
  }));
  const output={generatedAt:new Date().toISOString(),transport:'get* and simulateTransaction only; no signing or send',
    caveat:'sigVerify:false supplies a zero signature. Signer-count and compiled-index evidence proves the alias variant needs only A to sign, but no live transaction was submitted.',
    A:{address:A.toBase58(),onCurve:PublicKey.isOnCurve(A.toBytes()),owner:aInfo.value?.owner,
      lamports:aInfo.value?.lamports},
    B:{address:B.toBase58(),onCurve:PublicKey.isOnCurve(B.toBytes())},
    C:{address:C.toBase58(),onCurve:PublicKey.isOnCurve(C.toBytes())},
    initialVaultAmounts:{MIM:full[0].toString(),DOG:full[1].toString(),PUPS:full[2].toString()},tests};
  fs.writeFileSync(path.join(dir,'5uums-wrapper-alias-independent.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({A:output.A,tests:tests.map(t=>({label:t.label,wireBytes:t.wireBytes,
    requiredSignatures:t.requiredSignatures,signerKeys:t.signerKeys,firstThreeCompiledIndexes:t.firstThreeCompiledIndexes,
    err:t.err,delta:t.tokens.map(x=>x.delta),logTail:t.logs?.slice(-4)}))},null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
