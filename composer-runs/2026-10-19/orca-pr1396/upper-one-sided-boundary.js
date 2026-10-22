#!/usr/bin/env node
'use strict';

// Opposite direction boundary on untouched local mainnet-backed C7AD fork.
// The actor's tiny USDC funding is explicitly injected by the local fork API.
const crypto=require('crypto');const fs=require('fs');const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {PublicKey,SystemProgram,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction}=require(`${MOD}/@solana/spl-token`);
const {PriceMath}=require(`${MOD}/@orca-so/whirlpools-sdk`);
const {rpc}=require('./real-flash-envelope.js');
const {POOL,WSOL,USDC,VAULT_A,VAULT_B,actor,ataA,ataB}=require('./one-sided-boundary.js');
const {encodeV1,signV1}=require('../../2026-10-15/hylo-exchange-v1-wire.js');
const FORK='http://127.0.0.1:64335';
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const [oracle]=PublicKey.findProgramAddressSync([Buffer.from('oracle'),POOL.toBuffer()],PROGRAM);
const array=PublicKey.findProgramAddressSync([Buffer.from('tick_array'),POOL.toBuffer(),
  Buffer.from('-28160')],PROGRAM)[0];
const key=(pubkey,isWritable,isSigner=false)=>({pubkey,isWritable,isSigner});
const D=crypto.createHash('sha256').update('global:swap').digest().subarray(0,8);
function swap(limitTick,amount){
 const data=Buffer.alloc(42);D.copy(data);data.writeBigUInt64LE(BigInt(amount),8);
 const limit=BigInt(PriceMath.tickIndexToSqrtPriceX64(limitTick).toString());
 data.writeBigUInt64LE(limit&((1n<<64n)-1n),24);data.writeBigUInt64LE(limit>>64n,32);
 data[40]=1;data[41]=0; // exact B input
 return new TransactionInstruction({programId:PROGRAM,keys:[
  key(TOKEN_PROGRAM_ID,false),key(actor.publicKey,false,true),key(POOL,true),
  key(ataA,true),key(VAULT_A,true),key(ataB,true),key(VAULT_B,true),
  key(array,true),key(array,true),key(array,true),key(oracle,false),
 ],data});
}
async function image(){
 const ks=[POOL,VAULT_A,VAULT_B,ataA,ataB];
 const {value}=await rpc(FORK,'getMultipleAccounts',[ks.map(x=>x.toBase58()),
  {encoding:'base64',commitment:'processed'}]);
 const b=value.map(x=>x?Buffer.from(x.data[0],'base64'):null);
 const u128=(x,o)=>x.readBigUInt64LE(o)+(x.readBigUInt64LE(o+8)<<64n);
 return {pool:{L:String(u128(b[0],49)),sqrt:String(u128(b[0],65)),tick:b[0].readInt32LE(81)},
  vaultA:String(b[1].readBigUInt64LE(64)),vaultB:String(b[2].readBigUInt64LE(64)),
  actorA:b[3]&&String(b[3].readBigUInt64LE(64)),
  actorB:b[4]&&String(b[4].readBigUInt64LE(64))};
}
async function send(ixs){
 const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const encoded=encodeV1(ixs,actor.publicKey,bh,1_400_000);
 const signed=signV1(encoded,ixs,actor.publicKey,bh,[actor]);
 const sim=(await rpc(FORK,'simulateTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed'}])).value;
 const result={v1Bytes:encoded.sizeBytes,simulationError:sim.err,
  simulationUnits:sim.unitsConsumed,logs:sim.logs?.slice(-14)};
 if(sim.err)return result;
 const signature=await rpc(FORK,'sendTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',skipPreflight:true,preflightCommitment:'processed'}]);
 let tx;for(let i=0;i<20;i++){tx=await rpc(FORK,'getTransaction',[signature,
   {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
   if(tx)break;await new Promise(r=>setTimeout(r,200));}
 return {...result,signature,slot:tx?.slot,committedError:tx?tx.meta.err:'missing',
  committedUnits:tx?.meta?.computeUnitsConsumed};
}
async function main(){
 if(await rpc(FORK,'getGenesisHash')!==
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet fork');
 const before=await image();
 await rpc(FORK,'surfnet_setAccount',[actor.publicKey.toBase58(),{
  data:'',executable:false,lamports:1_000_000_000,
  owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const setup=await send([
  createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataA,actor.publicKey,WSOL),
  createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataB,actor.publicKey,USDC),
 ]);
 if(setup.simulationError||setup.committedError)throw Error('Setup failed');
 const account=(await rpc(FORK,'getAccountInfo',[ataB.toBase58(),
  {encoding:'base64',commitment:'processed'}])).value;
 const raw=Buffer.from(account.data[0],'base64');raw.writeBigUInt64LE(1_000_000n,64);
 await rpc(FORK,'surfnet_setAccount',[ataB.toBase58(),{
  data:raw.toString('hex'),executable:false,lamports:account.lamports,
  owner:TOKEN_PROGRAM_ID.toBase58(),rentEpoch:0}]);
 const prepared=await image();
 const upper=await send([swap(-27912,1000n)]);
 const afterUpper=await image();
 const empty=await send([swap(-27800,1n)]);
 const afterEmpty=await image();
 const result={schema:'orca-upper-one-sided-boundary/v1',fork:FORK,
  mainnetSubmission:false,forkOnlyUsdcPrefundRaw:'1000000',
  pool:POOL.toBase58(),actor:actor.publicKey.toBase58(),
  before,setup,prepared,upper,afterUpper,empty,afterEmpty};
 const out=path.join(__dirname,'upper-one-sided-boundary.json');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out,before,prepared,upper,afterUpper,empty,afterEmpty}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
