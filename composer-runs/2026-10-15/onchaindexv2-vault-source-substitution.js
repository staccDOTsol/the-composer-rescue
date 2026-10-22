#!/usr/bin/env node
'use strict';
// One signed local-fork source-account substitution. No mainnet transaction submission.
const fs=require('fs');const crypto=require('crypto');
const MOD='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync}=require(`${MOD}/@solana/spl-token`);
const bs58=require(`${MOD}/bs58`);const {encodeV1}=require('./klend-v1-composition.js');
const P=x=>new PublicKey(x);
const FORK='http://127.0.0.1:9397';
const PROGRAM=P('1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE');
const USDC=P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT=P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const sourceSig='3Tr8Zsi2YpJMkkmL36YxxEj8KFhor4mXc6kp9BDo2gobJsJBWpyhD7hYfz76FBjYTczVmcXLpaKYVvGsUJkxUF8t';
const authority=Keypair.generate();
const userUsdc=getAssociatedTokenAddressSync(USDC,authority.publicKey);
const userUsdt=getAssociatedTokenAddressSync(USDT,authority.publicKey);
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split(/\r?\n/).filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
const UPSTREAM=env.HEAVY_RPC_URL||env.RPC_URL;
let id=0;
async function rpc(url,method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});let j=await r.json();
  if(j.error)throw Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;}
function tokenImage(a){if(!a)return null;const b=Buffer.from(a.data[0],'base64');
  return{owner:a.owner,raw:a.owner===String(TOKEN_PROGRAM_ID)&&b.length>=72?
    b.readBigUInt64LE(64).toString():null,
    sha256:crypto.createHash('sha256').update(b).digest('hex')};}
async function seedAta(mint,ata,amount){const b=Buffer.alloc(165);
  mint.toBuffer().copy(b,0);authority.publicKey.toBuffer().copy(b,32);
  b.writeBigUInt64LE(BigInt(amount),64);b[108]=1;
  await rpc(FORK,'surfnet_setAccount',[String(ata),{data:b.toString('hex'),executable:false,
    lamports:2039280,owner:String(TOKEN_PROGRAM_ID),rentEpoch:0}]);}
function signedWire(ix,bh){const encoded=encodeV1([ix],authority.publicKey,bh);
  const compiled=new TransactionMessage({payerKey:authority.publicKey,recentBlockhash:bh,
    instructions:[ix]}).compileToV0Message();
  const signers=compiled.staticAccountKeys.slice(0,encoded.requiredSignatures).map(String);
  if(signers.length!==1||signers[0]!==String(authority.publicKey))throw Error('uncontrolled signer '+signers);
  const wire=Buffer.from(encoded.wire),message=wire.subarray(0,wire.length-64);
  const key=crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(authority.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,message,key).copy(wire,wire.length-64);
  return{encoded,wire};}
async function main(){
  const tx=await rpc(UPSTREAM,'getTransaction',[sourceSig,{encoding:'json',commitment:'confirmed',
    maxSupportedTransactionVersion:1}]);if(!tx)throw Error('source transaction unavailable');
  const message=tx.transaction.message,loaded=tx.meta.loadedAddresses||{writable:[],readonly:[]};
  const keys=[...message.accountKeys,...loaded.writable,...loaded.readonly];
  const inner=tx.meta.innerInstructions.flatMap(z=>z.instructions)
    .filter(x=>keys[x.programIdIndex]===String(PROGRAM));
  if(!inner.length)throw Error('source inner instruction missing');
  const src=inner[0],header=message.header,staticCount=message.accountKeys.length;
  const isWritable=j=>j<staticCount?j<header.numRequiredSignatures?
    j<header.numRequiredSignatures-header.numReadonlySignedAccounts:
    j<staticCount-header.numReadonlyUnsignedAccounts:
    j<staticCount+loaded.writable.length;
  const oldAccounts=src.accounts.map(i=>keys[i]);
  if(oldAccounts[5]!=='HkGq6HSQZeoah15RbyYK2YF6bfCkNmAK4F5VDxYMiwJv'||
    oldAccounts[6]!=='PRYpoFwPHBcL82JGeqrU7czwmQiSHa9udbeTbtXLv7d'||
    oldAccounts[7]!=='3XRwcurZPFvjow6MitN9ZR8ycddT2NGZU5oZznNVM3eT'||
    oldAccounts[9]!==keys[0])throw Error('source account roles changed');
  const ix=new TransactionInstruction({programId:PROGRAM,
    keys:src.accounts.map((j,k)=>({pubkey:k===7?P(oldAccounts[5]):k===8?userUsdt:
      k===9?authority.publicKey:P(keys[j]),
      isSigner:k===9?true:j<header.numRequiredSignatures,isWritable:isWritable(j)})),
    data:Buffer.from(bs58.decode(src.data))});
  await rpc(FORK,'surfnet_setAccount',[String(authority.publicKey),{data:'',executable:false,
    lamports:1000000000,owner:String(SystemProgram.programId),rentEpoch:0}]);
  await seedAta(USDC,userUsdc,1000000000n);await seedAta(USDT,userUsdt,0n);
  // Import the current binary/state before taking the pre-image.
  await rpc(FORK,'getMultipleAccounts',[ix.keys.map(k=>String(k.pubkey)),{encoding:'base64'}]);
  const watched=[userUsdc,userUsdt,P(oldAccounts[5]),P(oldAccounts[6]),P(oldAccounts[0])];
  const pre=(await rpc(FORK,'getMultipleAccounts',[watched.map(String),{encoding:'base64'}])).value.map(tokenImage);
  const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {encoded,wire}=signedWire(ix,bh);
  const r=await rpc(FORK,'simulateTransaction',[wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
    innerInstructions:true,accounts:{encoding:'base64',addresses:watched.map(String)}}]);
  const post=(r.value.accounts||[]).map(tokenImage);
  const out={observedAtUtc:new Date().toISOString(),sourceSignature:sourceSig,
    sourceSlot:tx.slot,localFork:FORK,simulationSlot:r.context.slot,
    target:String(PROGRAM),onlyFreshSigner:String(authority.publicKey),
    substitution:{historicalUserUsdc:oldAccounts[7],substitutedUserUsdcSource:oldAccounts[5],
      historicalUserUsdt:oldAccounts[8],outsiderUserUsdt:String(userUsdt),
      historicalSigner:oldAccounts[9],outsiderSigner:String(authority.publicKey)},
    userStartingUsdcRaw:'1000000000',userStartingUsdtRaw:'0',
    originalDataBase58:src.data,wire:{version:1,bytes:encoded.sizeBytes,
      accounts:encoded.addressCount,instructions:1,sigVerify:true,
      sha256:crypto.createHash('sha256').update(wire).digest('hex')},
    err:r.value.err,cu:r.value.unitsConsumed,
    watch:watched.map(String),pre,post,
    userUsdCDeltaRaw:pre[0]?.raw!=null&&post[0]?.raw!=null?
      (BigInt(post[0].raw)-BigInt(pre[0].raw)).toString():null,
    userUsdTDeltaRaw:pre[1]?.raw!=null&&post[1]?.raw!=null?
      (BigInt(post[1].raw)-BigInt(pre[1].raw)).toString():null,
    logs:r.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('failed')||
      x.includes('Error')||x.includes('Program log:')).slice(-35)};
  fs.writeFileSync(__dirname+'/onchaindexv2-vault-source-substitution.json',JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({err:out.err,cu:out.cu,bytes:out.wire.bytes,
    accounts:out.wire.accounts,usdcDelta:out.userUsdCDeltaRaw,
    usdtDelta:out.userUsdTDeltaRaw,logs:out.logs?.slice(-8)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
