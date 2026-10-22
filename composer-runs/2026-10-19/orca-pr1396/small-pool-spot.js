#!/usr/bin/env node
'use strict';

// Real signed Whirlpool v1 swaps on an isolated mainnet-backed local fork of
// the tiny 0/0-fee WSOL/USDC SplashPool 3PRT. Never sends to public RPC.
const crypto=require('crypto');const fs=require('fs');const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {Keypair,PublicKey,SystemProgram,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction}=require(`${MOD}/@solana/spl-token`);
const {encodeV1,signV1}=require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc}=require('./real-flash-envelope.js');
const FORK='http://127.0.0.1:64339';
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const POOL=new PublicKey('3PRT79bw3hoMd9S4uC8mPTKvJVgqGa2NuS7ZLX92RFNn');
const WSOL=new PublicKey('So11111111111111111111111111111111111111112');
const USDC=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VAULT_A=new PublicKey('C3qqUF7Y8D6Cj2RFg1jwjw5Yv3eyx365BUCfBAqWfVij');
const VAULT_B=new PublicKey('Gfji6WbfJq9UwKucC3A6Vo4D3vtcqqQJpRzu4n3uKA3U');
const ARRAY_NEG=new PublicKey('2J5tNpxPdJBjbYgJFd5JQmeBnodoPL4uVSGyQn2bcJU7');
const ARRAY_POS=new PublicKey('FtRFPmMgUZGYFqq6dGkeLEE4vfafwh3HQELGURfXRvBh');
const actor=Keypair.fromSeed(crypto.createHash('sha256').update('orca-3prt-spot-local-actor').digest());
const ataA=getAssociatedTokenAddressSync(WSOL,actor.publicKey);
const ataB=getAssociatedTokenAddressSync(USDC,actor.publicKey);
const [oracle]=PublicKey.findProgramAddressSync([Buffer.from('oracle'),POOL.toBuffer()],PROGRAM);
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const D=crypto.createHash('sha256').update('global:swap').digest().subarray(0,8);
function isqrt(n){if(n<2n)return n;let x=1n<<BigInt((n.toString(2).length+1)>>1);
 while(true){const y=(x+n/x)>>1n;if(y>=x)return x;x=y;}}
function swap(limit){
 const data=Buffer.alloc(42);D.copy(data);data.writeBigUInt64LE(1_000_000n,8);
 data.writeBigUInt64LE(limit&((1n<<64n)-1n),24);data.writeBigUInt64LE(limit>>64n,32);
 data[40]=1;data[41]=0; // exact USDC input, B->A
 return new TransactionInstruction({programId:PROGRAM,data,keys:[
  key(TOKEN_PROGRAM_ID),key(actor.publicKey,false,true),key(POOL,true),
  key(ataA,true),key(VAULT_A,true),key(ataB,true),key(VAULT_B,true),
  key(ARRAY_NEG,true),key(ARRAY_POS,true),key(ARRAY_POS,true),key(oracle),
 ]});
}
async function image(){
 const ks=[POOL,VAULT_A,VAULT_B,ataA,ataB];
 const {value}=await rpc(FORK,'getMultipleAccounts',[ks.map(k=>k.toBase58()),
  {encoding:'base64',commitment:'processed'}]);
 const b=value.map(x=>x?Buffer.from(x.data[0],'base64'):null);
 const u128=(x,o)=>x.readBigUInt64LE(o)+(x.readBigUInt64LE(o+8)<<64n);
 const p=b[0];
 return {pool:{L:String(u128(p,49)),sqrt:String(u128(p,65)),tick:p.readInt32LE(81),
  spacing:p.readUInt16LE(41),feeRate:p.readUInt16LE(45),protocolFeeRate:p.readUInt16LE(47),
  protocolFeeOwedA:String(p.readBigUInt64LE(85)),protocolFeeOwedB:String(p.readBigUInt64LE(93))},
  vaultA:String(b[1].readBigUInt64LE(64)),vaultB:String(b[2].readBigUInt64LE(64)),
  actorA:b[3]&&String(b[3].readBigUInt64LE(64)),
  actorB:b[4]&&String(b[4].readBigUInt64LE(64))};
}
async function send(label,ixs){
 const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const encoded=encodeV1(ixs,actor.publicKey,bh,1_400_000);
 const signed=signV1(encoded,ixs,actor.publicKey,bh,[actor]);
 const sim=(await rpc(FORK,'simulateTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed'}])).value;
 const r={label,v1Bytes:encoded.sizeBytes,simulationError:sim.err,
  simulationUnits:sim.unitsConsumed,logs:sim.logs?.slice(-15)};
 if(sim.err)return r;
 const signature=await rpc(FORK,'sendTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',skipPreflight:true,preflightCommitment:'processed'}]);
 let tx;for(let i=0;i<20;i++){tx=await rpc(FORK,'getTransaction',[signature,
  {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
  if(tx)break;await new Promise(resolve=>setTimeout(resolve,200));}
 return {...r,signature,slot:tx?.slot,committedError:tx?tx.meta.err:'missing',
  committedUnits:tx?.meta?.computeUnitsConsumed};
}
async function main(){
 if(await rpc(FORK,'getGenesisHash')!==
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet fork');
 const before=await image();
 if(before.pool.L!=='301845'||before.pool.feeRate!==0||before.pool.protocolFeeRate!==0)
  throw Error('Unexpected pool state');
 await rpc(FORK,'surfnet_setAccount',[actor.publicKey.toBase58(),{
  data:'',executable:false,lamports:1_000_000_000,
  owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const setup=await send('create actor ATAs',[
  createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataA,actor.publicKey,WSOL),
  createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataB,actor.publicKey,USDC),
 ]);
 if(setup.simulationError||setup.committedError)throw Error('Setup failed '+JSON.stringify(setup));
 const info=(await rpc(FORK,'getAccountInfo',[ataB.toBase58(),
  {encoding:'base64',commitment:'processed'}])).value;
 const data=Buffer.from(info.data[0],'base64');data.writeBigUInt64LE(1_000_000n,64);
 await rpc(FORK,'surfnet_setAccount',[ataB.toBase58(),{
  data:data.toString('hex'),executable:false,lamports:info.lamports,
  owner:TOKEN_PROGRAM_ID.toBase58(),rentEpoch:0}]);
 const prepared=await image();
 const p=BigInt(before.pool.sqrt);const target2=isqrt(p*p*2n);const target10=isqrt(p*p*10n);
 const two=await send('2x spot',[swap(target2)]);
 const afterTwo=await image();
 const ten=await send('10x spot',[swap(target10)]);
 const afterTen=await image();
 const out=path.join(__dirname,'small-pool-spot.json');
 const result={schema:'orca-3prt-small-pool-spot/v1',mainnetSubmission:false,
  fork:FORK,pool:POOL.toBase58(),actor:actor.publicKey.toBase58(),
  activePosition:{L:'301845',lower:-427648,upper:427648},
  forkOnlyUsdcPrefundRaw:'1000000',before,setup,prepared,
  targetSqrt2:String(target2),targetSqrt10:String(target10),two,afterTwo,ten,afterTen};
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out,before,prepared,targetSqrt2:String(target2),
  targetSqrt10:String(target10),two,afterTwo,ten,afterTen}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
