#!/usr/bin/env node
'use strict';

// One signed v1 containing every required WSOL->USDC Whirlpool swap across all
// nonzero C7AD positions, executed only on a local mainnet-backed Surfpool fork.
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {PublicKey,SystemProgram,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction}=require(`${MOD}/@solana/spl-token`);
const {PriceMath}=require(`${MOD}/@orca-so/whirlpools-sdk`);
const {rpc}=require('./real-flash-envelope.js');
const core=require('./one-sided-boundary.js');
const {POOL,WSOL,USDC,VAULT_A,VAULT_B,actor,ataA,ataB}=core;
const FORK=process.env.ORCA_BOUNDARY_FORK||'http://127.0.0.1:64333';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK))throw Error('Local fork only');
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const [oracle]=PublicKey.findProgramAddressSync([Buffer.from('oracle'),POOL.toBuffer()],PROGRAM);
const key=(pubkey,isWritable,isSigner=false)=>({pubkey,isWritable,isSigner});
const D=crypto.createHash('sha256').update('global:swap').digest().subarray(0,8);
const starts=[];for(let s=-28160;s>=-39424;s-=704)starts.push(s);
const addr=new Map(starts.map(s=>[s,PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'),POOL.toBuffer(),Buffer.from(String(s))],PROGRAM)[0]]));
const targets=[-28864,-30272,-31680,-33088,-34496,-35904,-37312,-38720,-39120];
const arrayStarts=[[-28160,-28864,-29568],[-28864,-29568,-30272],
  [-30272,-30976,-31680],[-31680,-32384,-33088],
  [-33088,-33792,-34496],[-34496,-35200,-35904],
  [-35904,-36608,-37312],[-37312,-38016,-38720],
  [-38720,-39424,-39424]];
function swap(i){
  const data=Buffer.alloc(42);D.copy(data);
  data.writeBigUInt64LE(500_000_000_000n,8);
  data.writeBigUInt64LE(0n,16);
  const limit=BigInt(PriceMath.tickIndexToSqrtPriceX64(targets[i]).toString());
  data.writeBigUInt64LE(limit & ((1n<<64n)-1n),24);
  data.writeBigUInt64LE(limit>>64n,32);
  data[40]=1;data[41]=1;
  return new TransactionInstruction({programId:PROGRAM,keys:[
    key(TOKEN_PROGRAM_ID,false),key(actor.publicKey,false,true),
    key(POOL,true),key(ataA,true),key(VAULT_A,true),
    key(ataB,true),key(VAULT_B,true),
    ...arrayStarts[i].map(s=>key(addr.get(s),true)),key(oracle,false),
  ],data});
}
async function image(){
  const keys=[POOL,VAULT_A,VAULT_B,ataA,ataB];
  const {value}=await rpc(FORK,'getMultipleAccounts',
    [keys.map(k=>k.toBase58()),{encoding:'base64',commitment:'processed'}]);
  const raw=value.map(v=>v?Buffer.from(v.data[0],'base64'):null);
  const u128=(b,o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
  const p=raw[0];
  return {pool:{liquidity:String(u128(p,49)),sqrtPriceX64:String(u128(p,65)),
    tick:p.readInt32LE(81),feeRate:p.readUInt16LE(45)},
    vaultA:raw[1]&&String(raw[1].readBigUInt64LE(64)),
    vaultB:raw[2]&&String(raw[2].readBigUInt64LE(64)),
    actorA:raw[3]&&String(raw[3].readBigUInt64LE(64)),
    actorB:raw[4]&&String(raw[4].readBigUInt64LE(64))};
}
async function send(instructions,label){
  const {encodeV1,signV1}=require('../../2026-10-15/hylo-exchange-v1-wire.js');
  const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeV1(instructions,actor.publicKey,bh,1_400_000);
  const signed=signV1(encoded,instructions,actor.publicKey,bh,[actor]);
  const sim=(await rpc(FORK,'simulateTransaction',[signed.wire.toString('base64'),
    {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed'}])).value;
  const result={label,simulationError:sim.err,simulationUnits:sim.unitsConsumed,
    simulationLogs:sim.logs?.slice(-22),v1Bytes:encoded.sizeBytes,
    instructionCount:instructions.length};
  if(sim.err)return result;
  const signature=await rpc(FORK,'sendTransaction',[signed.wire.toString('base64'),
    {encoding:'base64',skipPreflight:true,preflightCommitment:'processed'}]);
  let tx;
  for(let i=0;i<20;i++){
    tx=await rpc(FORK,'getTransaction',[signature,
      {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
    if(tx)break;await new Promise(r=>setTimeout(r,200));
  }
  return {...result,signature,committedError:tx?tx.meta.err:'missing receipt',
    slot:tx?.slot,committedUnits:tx?.meta?.computeUnitsConsumed,
    swapExecutions:tx?.meta?.logMessages?.filter(x=>x.includes('Instruction: Swap')).length,
    committedLogs:tx?.meta?.logMessages?.slice(-22)};
}
async function main(){
  if(await rpc(FORK,'getGenesisHash')!==
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet fork');
  const before=await image();
  if(before.pool.tick!==-27913||before.pool.liquidity!=='607354963')
    throw Error('Unexpected initial pool state');
  const available=(await rpc(FORK,'getMultipleAccounts',
    [[...addr.values()].map(x=>x.toBase58()),{encoding:'base64',commitment:'processed'}])).value;
  if(available.some(x=>!x))throw Error('Missing initialized tick arrays');
  await rpc(FORK,'surfnet_setAccount',[actor.publicKey.toBase58(),{
    data:'',executable:false,lamports:600_000_000_000,
    owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  const setup=await send([
    createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataA,actor.publicKey,WSOL),
    createAssociatedTokenAccountIdempotentInstruction(actor.publicKey,ataB,actor.publicKey,USDC),
    SystemProgram.transfer({fromPubkey:actor.publicKey,toPubkey:ataA,lamports:500_000_000_000}),
    new TransactionInstruction({programId:TOKEN_PROGRAM_ID,keys:[key(ataA,true)],data:Buffer.from([17])}),
  ],'setup 500 WSOL, fork-only prefund');
  if(setup.simulationError||setup.committedError)throw Error('Setup failed: '+JSON.stringify(setup));
  const prepared=await image();
  const boundary=await send(targets.map((_,i)=>swap(i)),'all existing A-to-B bands');
  const after=await image();
  const out=path.join(__dirname,'full-one-sided-boundary.json');
  const result={schema:'orca-full-one-sided-boundary/v1',mainnetSubmission:false,
    fork:FORK,pool:POOL.toBase58(),actor:actor.publicKey.toBase58(),
    tickArrayStarts:starts,tickArrayAddresses:[...addr.values()].map(x=>x.toBase58()),
    targets,arrayStarts,before,setup,prepared,boundary,after};
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({out,before,setup,prepared,boundary,after}));
}
module.exports={FORK,POOL,actor,ataA,ataB,targets,arrayStarts,swap,image,send};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
