#!/usr/bin/env node
'use strict';
// Create exactly the six named associated token accounts on mainnet-beta.
// Simulate and verify the complete signed transaction before submitting it.
const fs=require('fs');
const path=require('path');
const M='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionMessage,VersionedTransaction}=require(M+'@solana/web3.js');
const spl=require(M+'@solana/spl-token');
const raw=JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH||'/Users/stacc/hooked.json','utf8'));
if(!Array.isArray(raw)||raw.length!==64||!raw.every(x=>Number.isInteger(x)&&x>=0&&x<=255))
  throw Error('invalid keypair shape');
const wallet=Keypair.fromSecretKey(Uint8Array.from(raw));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const RPC=env.HEAVY_RPC_URL||env.RPC_URL;
if(!RPC)throw Error('RPC URL missing');
const rows=[
  ['WETZ','WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U',spl.TOKEN_PROGRAM_ID],
  ['PUMP_B','2bCCHQadi4QeHWPKG3w13siCyWWQPgkFtniouTqVpump',spl.TOKEN_2022_PROGRAM_ID],
  ['WSOL','So11111111111111111111111111111111111111112',spl.TOKEN_PROGRAM_ID],
  ['JUP6_INTERMEDIATE_6P6X','6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',spl.TOKEN_PROGRAM_ID],
  ['PUMP_A','Ar8mYJece3kHPQUxwoW8sk6LRpdCLZd5N3mZ8BMRpump',spl.TOKEN_2022_PROGRAM_ID],
  ['CASH','CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH',spl.TOKEN_2022_PROGRAM_ID],
].map(([name,mint,program])=>({name,mint:new PublicKey(mint),program,
  ata:spl.getAssociatedTokenAddressSync(new PublicKey(mint),wallet.publicKey,false,program)}));
let id=0;
async function rpc(method,params){
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const result=await response.json();
  if(result.error)throw Error(method+': '+JSON.stringify(result.error));
  return result.result;
}
function verifyAccount(account,row){
  if(!account)return false;
  if(account.owner!==row.program.toBase58())throw Error(row.name+' ATA program mismatch');
  const bytes=Buffer.from(account.data[0],'base64');
  if(bytes.length<72||!new PublicKey(bytes.subarray(0,32)).equals(row.mint)||
     !new PublicKey(bytes.subarray(32,64)).equals(wallet.publicKey))
    throw Error(row.name+' ATA mint/owner mismatch');
  return true;
}
async function snapshot(){
  const [balance,accounts]=await Promise.all([
    rpc('getBalance',[wallet.publicKey.toBase58(),{commitment:'confirmed'}]),
    rpc('getMultipleAccounts',[rows.map(x=>x.ata.toBase58()),
      {encoding:'base64',commitment:'confirmed'}]),
  ]);
  accounts.value.forEach((account,i)=>verifyAccount(account,rows[i]));
  return {slot:Math.max(balance.context.slot,accounts.context.slot),
    lamports:balance.value,accounts:accounts.value};
}
async function main(){
  const before=await snapshot();
  const mints=await rpc('getMultipleAccounts',[rows.map(x=>x.mint.toBase58()),
    {encoding:'base64',commitment:'confirmed'}]);
  mints.value.forEach((account,i)=>{
    if(!account||account.owner!==rows[i].program.toBase58())
      throw Error(rows[i].name+' mint program mismatch');
  });
  const missing=rows.filter((_,i)=>!before.accounts[i]);
  if(!missing.length){
    console.log(JSON.stringify({alreadyInitialized:true,wallet:wallet.publicKey.toBase58(),
      atas:rows.map(x=>({name:x.name,address:x.ata.toBase58()}))},null,2));
    return;
  }
  const ixs=missing.map(x=>spl.createAssociatedTokenAccountIdempotentInstruction(
    wallet.publicKey,x.ata,wallet.publicKey,x.mint,x.program));
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const message=new TransactionMessage({payerKey:wallet.publicKey,
    recentBlockhash:blockhash,instructions:ixs}).compileToV0Message();
  const tx=new VersionedTransaction(message);tx.sign([wallet]);
  const wire=Buffer.from(tx.serialize());
  if(wire.length>1232)throw Error('packet exceeds 1232 bytes');
  const fee=(await rpc('getFeeForMessage',[
    Buffer.from(message.serialize()).toString('base64'),{commitment:'processed'}])).value;
  // Some RPC backends cap simulated account returns at six addresses.
  const watched=[wallet.publicKey.toBase58(),...missing.map(x=>x.ata.toBase58())];
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,
    commitment:'confirmed',accounts:{encoding:'base64',addresses:watched}}]);
  if(sim.value.err)throw Error('signed simulation failed: '+JSON.stringify(sim.value.err));
  const simAccounts=sim.value.accounts;
  if(!Array.isArray(simAccounts)||simAccounts.length!==watched.length)
    throw Error('incomplete simulation account snapshot');
  missing.forEach((row,i)=>{
    if(!verifyAccount(simAccounts[i+1],row))
      throw Error(row.name+' missing after simulated creation');
  });
  if(simAccounts[0].lamports<650240)throw Error('payer below minimum rent floor in simulation');
  const savePath=path.join(__dirname,missing.length===rows.length?
    'hooked-mainnet-six-ata-creation.json':
    'hooked-mainnet-'+missing.map(x=>x.name.toLowerCase()).join('-')+'-recreation.json');
  const evidence={observedAt:new Date().toISOString(),network:'mainnet-beta',
    wallet:wallet.publicKey.toBase58(),preSlot:before.slot,
    simulationSlot:sim.context.slot,wireBytes:wire.length,
    addressCount:message.staticAccountKeys.length,feeLamports:fee,
    payerBeforeLamports:before.lamports,
    payerSimAfterLamports:simAccounts[0].lamports,
    atas:rows.map((x,i)=>({name:x.name,mint:x.mint.toBase58(),
      tokenProgram:x.program.toBase58(),address:x.ata.toBase58(),
      alreadyExisted:!!before.accounts[i],simCreated:!before.accounts[i]})),
    signedSimulation:{err:sim.value.err,unitsConsumed:sim.value.unitsConsumed},
    submitted:false};
  fs.writeFileSync(savePath,JSON.stringify(evidence,null,2)+'\n');
  if(process.env.SUBMIT!=='1'){
    console.log(JSON.stringify({ready:true,submitted:false,wireBytes:wire.length,
      feeLamports:fee,missing:missing.map(x=>x.name),
      payerSimAfterLamports:simAccounts[0].lamports},null,2));
    return;
  }
  const signature=await rpc('sendTransaction',[wire.toString('base64'),{
    encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:3}]);
  evidence.submitted=true;evidence.signature=signature;
  fs.writeFileSync(savePath,JSON.stringify(evidence,null,2)+'\n');
  let status=null;
  for(let attempt=0;attempt<20;attempt++){
    const reply=await rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
    status=reply.value[0];
    if(status?.err)throw Error('submitted transaction failed: '+JSON.stringify(status.err));
    if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized')break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  const after=await snapshot();
  const complete=after.accounts.every((account,i)=>verifyAccount(account,rows[i]));
  evidence.confirmationStatus=status?.confirmationStatus||null;
  evidence.postSlot=after.slot;
  evidence.payerAfterLamports=after.lamports;
  evidence.allSixExist=complete;
  fs.writeFileSync(savePath,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({signature,confirmationStatus:evidence.confirmationStatus,
    allSixExist:complete,payerBeforeLamports:before.lamports,
    payerAfterLamports:after.lamports,atas:evidence.atas.map(x=>({name:x.name,address:x.address}))},null,2));
  if(!complete)process.exitCode=2;
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
