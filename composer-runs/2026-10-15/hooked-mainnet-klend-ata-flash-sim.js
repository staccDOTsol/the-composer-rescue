#!/usr/bin/env node
'use strict';
// Signed mainnet-beta simulateTransaction only: create route ATAs, borrow USDC, repay USDC.
const fs=require('fs'),crypto=require('crypto');
const M='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction}=require(M+'@solana/web3.js');
const spl=require(M+'@solana/spl-token');const b=require(M+'bs58'),bs58=b.default||b;
const {encodeV1}=require('./klend-v1-composition.js');
const P=x=>new PublicKey(x);
const secret=JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH||'/Users/stacc/hooked.json','utf8'));
if(!Array.isArray(secret)||secret.length!==64||!secret.every(x=>Number.isInteger(x)&&x>=0&&x<=255))
  throw Error('invalid hooked keypair shape');
const wallet=Keypair.fromSecretKey(Uint8Array.from(secret));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const RPC=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const j=await(await fetch(RPC,{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})})).json();
  if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;}
const KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const USDC=P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USER_USDC=spl.getAssociatedTokenAddressSync(USDC,wallet.publicKey);
const reserve=JSON.parse(fs.readFileSync(__dirname+'/klend-zero-fee-census.json','utf8'))
  .activeZero.find(x=>x.reserve==='AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
if(!reserve)throw Error('zero-fee reserve not found');
const sample=JSON.parse(fs.readFileSync(__dirname+'/kamino-flash-history.json','utf8')).hits[0].transaction;
const msg=sample.transaction.message,loaded=sample.meta.loadedAddresses||{writable:[],readonly:[]};
const all=[...msg.accountKeys,...loaded.writable,...loaded.readonly],h=msg.header;
const writable=i=>i<msg.accountKeys.length?i<h.numRequiredSignatures?
  i<h.numRequiredSignatures-h.numReadonlySignedAccounts:
  i<msg.accountKeys.length-h.numReadonlyUnsignedAccounts:
  i<msg.accountKeys.length+loaded.writable.length;
function historyIx(index){const x=msg.instructions[index];
  return new TransactionInstruction({programId:P(all[x.programIdIndex]),
    keys:x.accounts.map(i=>({pubkey:P(all[i]),isSigner:i<h.numRequiredSignatures,
      isWritable:writable(i)})),data:Buffer.from(bs58.decode(x.data))});}
const templateBorrow=historyIx(3),templateRepay=historyIx(13);
const market=P(reserve.market);
const lma=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
function flash(template,amount,borrowIndex){const keys=template.keys.map(k=>({...k}));
  const replacements={0:wallet.publicKey,1:lma,2:market,3:P(reserve.reserve),
    4:USDC,5:P(reserve.supplyVault),6:USER_USDC,7:P(reserve.feeVault),11:spl.TOKEN_PROGRAM_ID};
  for(const [i,key] of Object.entries(replacements))keys[Number(i)].pubkey=key;
  const data=Buffer.from(template.data);data.writeBigUInt64LE(BigInt(amount),8);
  if(borrowIndex!==undefined)data[16]=borrowIndex;
  return new TransactionInstruction({programId:KLEND,keys,data});}
const routeAtas=[
  ['JUP6_INTERMEDIATE_6P6X','6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',spl.TOKEN_PROGRAM_ID],
  ['PUMP_B','2bCCHQadi4QeHWPKG3w13siCyWWQPgkFtniouTqVpump',spl.TOKEN_2022_PROGRAM_ID],
  ['WSOL','So11111111111111111111111111111111111111112',spl.TOKEN_PROGRAM_ID],
].map(([name,mint,tokenProgram])=>({name,mint:P(mint),tokenProgram,
  ata:spl.getAssociatedTokenAddressSync(P(mint),wallet.publicKey,false,tokenProgram)}))
  .slice(0,process.env.ATA_COUNT==='2'?2:3);
function signV1(ixs,bh){const e=encodeV1(ixs,wallet.publicKey,bh);
  const compiled=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:bh,
    instructions:ixs}).compileToV0Message();
  if(e.requiredSignatures!==1||!compiled.staticAccountKeys[0].equals(wallet.publicKey))
    throw Error('unexpected signer');
  const wire=Buffer.from(e.wire),key=crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(wallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
  return {wire,bytes:e.sizeBytes,addresses:e.addressCount,v0Bytes:e.v0Bytes,version:1};}
function signV0(ixs,bh){const m=new TransactionMessage({payerKey:wallet.publicKey,
  recentBlockhash:bh,instructions:ixs}).compileToV0Message();
  const tx=new VersionedTransaction(m);tx.sign([wallet]);
  return {wire:Buffer.from(tx.serialize()),bytes:tx.serialize().length,
    addresses:m.staticAccountKeys.length,version:0};}
async function main(){const before=await rpc('getMultipleAccounts',[[USER_USDC.toBase58(),
  reserve.supplyVault,reserve.feeVault,...routeAtas.map(x=>x.ata.toBase58())],
  {encoding:'base64',commitment:'confirmed'}]);
  const setup=routeAtas.map(x=>spl.createAssociatedTokenAccountIdempotentInstruction(
    wallet.publicKey,x.ata,wallet.publicKey,x.mint,x.tokenProgram));
  const amount=1_000_000n,borrow=flash(templateBorrow,amount),repay=flash(templateRepay,amount,setup.length);
  const close=process.env.CLOSE_ATAS==='1'?routeAtas.map(x=>
    spl.createCloseAccountInstruction(x.ata,wallet.publicKey,wallet.publicKey,[],x.tokenProgram)):[];
  const ixs=[...setup,borrow,repay,...close];
  const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const estimated=encodeV1(ixs,wallet.publicKey,bh);
  const signed=estimated.v0Bytes<=1232?signV0(ixs,bh):signV1(ixs,bh);
  const watch=[USER_USDC.toBase58(),reserve.supplyVault,reserve.feeVault,
    ...routeAtas.map(x=>x.ata.toBase58())];
  const sim=await rpc('simulateTransaction',[signed.wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,
    commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watch}}]);
  const after=await rpc('getMultipleAccounts',[watch,{encoding:'base64',commitment:'confirmed'}]);
  const raw=a=>a?.data&&Buffer.from(a.data[0],'base64').length>=72?
    Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
  const o={observedAt:new Date().toISOString(),network:'mainnet-beta',
    method:'simulateTransaction',sigVerify:true,mainnetSubmission:false,
    wallet:wallet.publicKey.toBase58(),borrowUsdcRaw:amount.toString(),
    setupAtas:routeAtas.map(x=>({name:x.name,address:x.ata.toBase58()})),
    wireVersion:signed.version,wireBytes:signed.bytes,addressCount:signed.addresses,
    equivalentV0Bytes:estimated.v0Bytes,borrowInstructionIndex:setup.length,
    closedTemporaryAtas:close.length>0,
    watch,pre:before.value.map(raw),simPost:(sim.value.accounts||[]).map(raw),
    chainPost:after.value.map(raw),chainUnchanged:before.value.every((a,i)=>
      raw(a)===raw(after.value[i])&&a?.lamports===after.value[i]?.lamports),
    err:sim.value.err,simulationSlot:sim.context.slot,
    computeUnits:sim.value.unitsConsumed,logs:sim.value.logs?.slice(-70)};
  fs.writeFileSync(__dirname+'/'+(close.length?
    'hooked-mainnet-klend-3ata-close-flash-sim.json':routeAtas.length===2?
    'hooked-mainnet-klend-2ata-flash-sim.json':'hooked-mainnet-klend-ata-flash-sim.json'),JSON.stringify(o,null,2)+'\n');
  console.log(JSON.stringify({err:o.err,slot:o.simulationSlot,wireVersion:o.wireVersion,
    wireBytes:o.wireBytes,addressCount:o.addressCount,computeUnits:o.computeUnits,
    pre:o.pre,simPost:o.simPost,chainUnchanged:o.chainUnchanged,
    logs:o.logs?.slice(-25)},null,2));}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
