#!/usr/bin/env node
'use strict';
// Historical DFlow instruction, current deployed programs/state, synthetic user assets on localhost fork.
// Mainnet calls are read-only. Exactly one signed simulation is executed per invocation.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID} = require(modules+'@solana/spl-token');
const bs58mod=require(modules+'bs58');
const bs58=bs58mod.default||bs58mod;
const {encodeV1}=require('./klend-v1-composition.js');

const sourceSig='2YXDA44jF67GLRvpeDqUmAfErwzWKzaAMWB5FiC9pLyTfNSdFr2Gtxat2tuMMT8jBTVqnw3uGNCZhLX2uwCyyH64';
const dflow='DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH';
const bison='BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi';
const oldUser='DstMruBEttyvXp4BbYakZuDGuWHbrocydfHYSoUZP5LE';
const oldFeePayer='7JCe3GHwkEr3feHgtLXnmuJ1yB3A7coSeyynxTBgdG8k';
const oldPump='7QuutQvRRLxygCKiSrQknemsv7B5Bi3uZd92i6roqfPT';
const oldWsol='7RuVN4yTe12mi5YiHQADTMEnHyqfKnGy2fXRzDajDr6a';
const oldUsdc='G9WWJD4Re3Lm3GWVgCGVqBCb5L2we8HAZGJcDi7BHczF';
const pumpMint=new PublicKey('Ar8mYJece3kHPQUxwoW8sk6LRpdCLZd5N3mZ8BMRpump');
const wsolMint=new PublicKey('So11111111111111111111111111111111111111112');
const usdcMint=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const poolWsol='ATRsNGv2nDw7hSMfkUTBoVUDsFDwN7po7KbecyiGWNB4';
const poolUsdc='2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU';
const fork='http://127.0.0.1:9397';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=env.HEAVY_RPC_URL||env.RPC_URL;
let id=0;
async function rpc(url,method,params){
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.json(); if(body.error)throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function setAccount(address,acct){
  await rpc(fork,'surfnet_setAccount',[String(address),{data:acct.data,executable:false,
    lamports:acct.lamports,owner:acct.owner,rentEpoch:0}]);
}
async function seedToken(address,template,authority,amount){
  const data=Buffer.from(template.data[0],'base64');
  authority.toBuffer().copy(data,32);
  data.writeBigUInt64LE(BigInt(amount),64);
  await setAccount(address,{data:data.toString('hex'),lamports:template.lamports,owner:template.owner});
}
function tokenAmount(acct){return acct?.data?Buffer.from(acct.data[0],'base64').readBigUInt64LE(64).toString():null;}
function sign(instructions,feePayer,user,blockhash){
  const enc=encodeV1(instructions,feePayer.publicKey,blockhash);
  const compiled=new TransactionMessage({payerKey:feePayer.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message();
  const order=compiled.staticAccountKeys.slice(0,enc.requiredSignatures).map(String);
  const signers=new Map([feePayer,user].map(x=>[String(x.publicKey),x]));
  const wire=Buffer.from(enc.wire),message=wire.subarray(0,wire.length-64*enc.requiredSignatures);
  for(let i=0;i<order.length;i++){
    const keypair=signers.get(order[i]); if(!keypair)throw Error(`uncontrolled signer ${order[i]}`);
    const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
      Buffer.from(keypair.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
    crypto.sign(null,message,key).copy(wire,wire.length-64*enc.requiredSignatures+i*64);
  }
  return {wire,enc,order};
}
async function main(){
  const tx=await rpc(mainnet,'getTransaction',[sourceSig,{encoding:'jsonParsed',maxSupportedTransactionVersion:1}]);
  if(!tx||tx.meta.err||tx.slot<=456982351)throw Error('current-deployment historical route unavailable');
  const source=tx.transaction.message.instructions.find(x=>x.programId===dflow);
  const bisonCpi=tx.meta.innerInstructions.flatMap(x=>x.instructions).find(x=>x.programId===bison);
  if(!source||!bisonCpi||bisonCpi.accounts[2]!==poolWsol||bisonCpi.accounts[3]!==poolUsdc)
    throw Error('wrong source route/pool');
  const feePayer=Keypair.generate();
  const hookPath=process.env.HOOKED_KEYPAIR_PATH;
  const secret=hookPath?JSON.parse(fs.readFileSync(hookPath,'utf8')):null;
  if(hookPath&&(!Array.isArray(secret)||secret.length!==64||
    !secret.every(x=>Number.isInteger(x)&&x>=0&&x<=255)))throw Error('invalid hooked keypair shape');
  const user=hookPath?Keypair.fromSecretKey(Uint8Array.from(secret)):Keypair.generate();
  const pumpProgram=new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const volumePda=owner=>PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'),owner.toBuffer()],pumpProgram)[0];
  const oldVolume=volumePda(new PublicKey(oldUser));
  const freshVolume=volumePda(user.publicKey);
  const freshPump=getAssociatedTokenAddressSync(pumpMint,user.publicKey,false,TOKEN_2022_PROGRAM_ID);
  const freshWsol=getAssociatedTokenAddressSync(wsolMint,user.publicKey);
  const freshUsdc=getAssociatedTokenAddressSync(usdcMint,user.publicKey);
  if(getAssociatedTokenAddressSync(pumpMint,new PublicKey(oldUser),false,TOKEN_2022_PROGRAM_ID).toBase58()!==oldPump ||
    getAssociatedTokenAddressSync(wsolMint,new PublicKey(oldUser)).toBase58()!==oldWsol ||
    getAssociatedTokenAddressSync(usdcMint,new PublicKey(oldUser)).toBase58()!==oldUsdc)
    throw Error('historical user-account mapping mismatch');
  for(const signer of [feePayer,user])await setAccount(signer.publicKey,{data:'',lamports:1_000_000_000,
    owner:SystemProgram.programId.toBase58()});
  const templates=(await rpc(fork,'getMultipleAccounts',[[oldPump,poolWsol,poolUsdc],{encoding:'base64'}])).value;
  if(templates.some(x=>!x))throw Error('missing current token template');
  const syntheticPumpRaw='4516763547202';
  await seedToken(freshPump,templates[0],user.publicKey,syntheticPumpRaw);
  await seedToken(freshWsol,templates[1],user.publicKey,'0');
  await seedToken(freshUsdc,templates[2],user.publicKey,'0');
  const replacements=new Map([[oldFeePayer,feePayer.publicKey.toBase58()],
    [oldUser,user.publicKey.toBase58()],[oldPump,freshPump.toBase58()],
    [oldWsol,freshWsol.toBase58()],[oldUsdc,freshUsdc.toBase58()],
    [oldVolume.toBase58(),freshVolume.toBase58()]]);
  const meta=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  const keys=source.accounts.map(a=>({pubkey:new PublicKey(replacements.get(a)||a),
    isSigner:!!meta.get(a)?.signer,isWritable:!!meta.get(a)?.writable}));
  const ix=new TransactionInstruction({programId:new PublicKey(dflow),keys,data:Buffer.from(bs58.decode(source.data))});
  const volumeAccount=(await rpc(fork,'getAccountInfo',[freshVolume.toBase58(),{encoding:'base64'}])).value;
  let rentTopUpLamports=0;
  if(hookPath&&volumeAccount){
    const size=Buffer.from(volumeAccount.data[0],'base64').length;
    const minRent=await rpc(fork,'getMinimumBalanceForRentExemption',[size]);
    rentTopUpLamports=Math.max(0,minRent-volumeAccount.lamports);
  }
  const instructions=[];
  if(rentTopUpLamports>0)instructions.push(SystemProgram.transfer({fromPubkey:user.publicKey,
    toPubkey:freshVolume,lamports:rentTopUpLamports}));
  instructions.push(ix);
  const watch=[freshPump,freshWsol,freshUsdc,poolWsol,poolUsdc].map(String);
  const before=(await rpc(fork,'getMultipleAccounts',[watch,{encoding:'base64'}])).value.map(tokenAmount);
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {wire,enc,order}=sign(instructions,feePayer,user,blockhash);
  const sim=await rpc(fork,'simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
    replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:watch}}]);
  const after=(sim.value.accounts||[]).map(tokenAmount);
  const deltas=watch.map((_,i)=>before[i]!=null&&after[i]!=null?(BigInt(after[i])-BigInt(before[i])).toString():null);
  const output={generatedAt:new Date().toISOString(),scope:(hookPath?'Hooked-signer':'Fresh-signer')+' DFlow outer route to current Bison wSOL/USDC on localhost fork',
    mainnetReadOnly:true,mainnetSubmission:false,forkSubmission:false,sigVerify:true,sourceSig,sourceSlot:tx.slot,
    user:user.publicKey.toBase58(),feePayer:feePayer.publicKey.toBase58(),
    userVolumeAccumulator:freshVolume.toBase58(),rentTopUpLamports,
    syntheticFunding:{pumpMint:pumpMint.toBase58(),pumpRaw:syntheticPumpRaw,lamportsPerSigner:'1000000000'},
    freshAccounts:{pump:freshPump.toBase58(),wsol:freshWsol.toBase58(),usdc:freshUsdc.toBase58()},
    bisonPool:{wsol:poolWsol,usdc:poolUsdc},wireBytes:enc.sizeBytes,addressCount:enc.addressCount,
    signerOrder:order,err:sim.value.err,computeUnits:sim.value.unitsConsumed,watch,before,after,deltas,
    logs:sim.value.logs};
  const path=__dirname+'/'+(hookPath?'bison-dflow-hooked-renttop-signed.json':'bison-dflow-fresh-signed.json');
  fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({path,err:output.err,units:output.computeUnits,wireBytes:output.wireBytes,
    addressCount:output.addressCount,signerOrder:order,deltas,logs:output.logs?.slice(-20)},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
