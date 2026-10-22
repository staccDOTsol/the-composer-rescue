#!/usr/bin/env node
'use strict';
// Read-only current-state simulations. This file calls getTransaction,
// getLatestBlockhash, getTokenAccountBalance, and simulateTransaction only.
const fs=require('fs'),path=require('path');
const {PublicKey,Transaction,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const DIR=__dirname,WRAPPER='3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu',SIG='2HMjoo5om3t8ho8Ac3jT6DHwL5oFxwdaQGj5RCHBJARb41KPo6eh1YhGDgnaSRF9dkTuiA4whFkDoAgvG5pkzmZR',MIM='7Lzp4oZietdSBSojPsXsD8VSffBNnmuEZPrYzpuDQ83w',MIM_MINT='M1M6sdffCs3ozzhpRveweRCWdZhxth4mvVujPtYEC3h';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let n=0;async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++n,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(`${method} ${JSON.stringify(j.error)}`);return j.result;}
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
async function main(){
  const [historical,blockhash,before]=await Promise.all([
    rpc('getTransaction',[SIG,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]),
    rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
    rpc('getTokenAccountBalance',[MIM,{commitment:'confirmed'}])
  ]);
  const keys=new Map(historical.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  const original=historical.transaction.message.instructions.filter(x=>x.programId===WRAPPER);
  if(original.length!==2)throw Error('expected two wrapper legs');
  const payer=historical.transaction.message.accountKeys.find(x=>x.signer).pubkey;
  const A='FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N',B='5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp',C='12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn';
  function makeTx(signerSet,ixCount=1,feePayer=payer,overrides={},amount=null){
    const tx=new Transaction({feePayer:new PublicKey(feePayer),recentBlockhash:blockhash.value.blockhash});
    for(const ix of original.slice(0,ixCount)){
      const data=Buffer.from(bs58.decode(ix.data));
      if(amount!==null){if(data.readUInt32LE(32)!==16||data.subarray(36,44).toString('hex')!=='659b28159ebd38cb')throw Error('unexpected wrapper wire layout');data.writeBigUInt64LE(BigInt(amount),44);}
      tx.add(new TransactionInstruction({programId:new PublicKey(WRAPPER),keys:ix.accounts.map((oldAddress,index)=>{const address=overrides[index]||oldAddress;return{pubkey:new PublicKey(address),isWritable:keys.get(oldAddress)?.writable||false,isSigner:signerSet.has(address)}}),data}));
    }
    const message=tx.compileMessage();
    return {base64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),wire:{numRequiredSignatures:message.header.numRequiredSignatures,requiredSigners:message.accountKeys.slice(0,message.header.numRequiredSignatures).map(x=>x.toBase58()),wrapperAccountIndices:message.instructions[0].accounts}};
  }
  const variants=[
    {label:'reference_three_signers',signers:[A,B,C]},
    {label:'missing_B',signers:[A,C]},
    {label:'missing_C',signers:[A,B]},
    {label:'only_A',signers:[A]},
    {label:'B_C_without_A',signers:[B,C],feePayer:B},
    {label:'only_B',signers:[B],feePayer:B},
    {label:'A_duplicated_in_B_slot',signers:[A],overrides:{1:A}},
    {label:'A_duplicated_in_C_slot',signers:[A],overrides:{2:A}},
    {label:'B_duplicated_in_A_slot',signers:[B],feePayer:B,overrides:{0:B}},
    {label:'A_all_three_slots',signers:[A],overrides:{1:A,2:A}},
    {label:'A_plus_arbitrary_substitute_B',signers:[A,'DSHGxWLEaySS1riiQozyAjXTv3smXmr5Q2qPmEKU8qHr'],overrides:{1:'DSHGxWLEaySS1riiQozyAjXTv3smXmr5Q2qPmEKU8qHr'}},
    {label:'A_alias_full_MIM_to_A',signers:[A],overrides:{1:A,8:getAssociatedTokenAddressSync(new PublicKey(MIM_MINT),new PublicKey(A)).toBase58(),9:A},amount:before.value.amount},
    {label:'A_alias_one_raw_MIM_to_A',signers:[A],overrides:{1:A,8:getAssociatedTokenAddressSync(new PublicKey(MIM_MINT),new PublicKey(A)).toBase58(),9:A},amount:'1'},
  ];
  const results=[];
  for(const v of variants){
    try{const built=makeTx(new Set(v.signers),1,v.feePayer||payer,v.overrides||{},v.amount??null);const result=await rpc('simulateTransaction',[built.base64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:[MIM]}}]);const b=result.value.accounts?.[0]?.data?.[0]?Buffer.from(result.value.accounts[0].data[0],'base64'):null;results.push({label:v.label,signers:v.signers,feePayer:v.feePayer||payer,overrides:v.overrides||{},amount:v.amount||null,wire:built.wire,contextSlot:result.context.slot,err:result.value.err,logs:result.value.logs,unitsConsumed:result.value.unitsConsumed,postMimRaw:b?b.readBigUInt64LE(64).toString():null,innerInstructions:result.value.innerInstructions});}
    catch(e){results.push({label:v.label,signers:v.signers,rpcError:e.message});}
  }
  const after=await rpc('getTokenAccountBalance',[MIM,{commitment:'confirmed'}]);
  const out={at:new Date().toISOString(),historicalSignature:SIG,historicalSlot:historical.slot,feePayer:payer,originalSigners:historical.transaction.message.accountKeys.filter(x=>x.signer).map(x=>x.pubkey),before:{slot:before.context.slot,rawAmount:before.value.amount},after:{slot:after.context.slot,rawAmount:after.value.amount},noChainBalanceChange:before.value.amount===after.value.amount,results};
  fs.writeFileSync(path.join(DIR,'5uums-wrapper-gates.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({...out,results:results.map(x=>({label:x.label,err:x.err,rpcError:x.rpcError,unitsConsumed:x.unitsConsumed,postMimRaw:x.postMimRaw,logs:x.logs?.filter(y=>y.includes('failed')||y.includes('error')||y.includes('invoke'))?.slice(0,12)}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
