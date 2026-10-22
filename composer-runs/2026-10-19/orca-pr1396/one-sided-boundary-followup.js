#!/usr/bin/env node
'use strict';

// Continue the locally executed C7AD boundary receipt: move through the empty
// range, then reverse across the LP lower tick. Local RPC guard is inherited.
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {PublicKey,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID}=require(`${MOD}/@solana/spl-token`);
const {PriceMath}=require(`${MOD}/@orca-so/whirlpools-sdk`);
const {POOL,VAULT_A,VAULT_B,actor,ataA,ataB,arrays,image,send}=require('./one-sided-boundary.js');
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const [oracle]=PublicKey.findProgramAddressSync([Buffer.from('oracle'),POOL.toBuffer()],PROGRAM);
const key=(pubkey,isWritable,isSigner=false)=>({pubkey,isWritable,isSigner});

function swap({amount,aToB,limitTick}) {
  const data=Buffer.alloc(42);
  crypto.createHash('sha256').update('global:swap').digest().subarray(0,8).copy(data);
  data.writeBigUInt64LE(BigInt(amount),8);
  data.writeBigUInt64LE(0n,16);
  const limit=BigInt(PriceMath.tickIndexToSqrtPriceX64(limitTick).toString());
  data.writeBigUInt64LE(limit & ((1n<<64n)-1n),24);
  data.writeBigUInt64LE(limit>>64n,32);
  data[40]=1;
  data[41]=aToB?1:0;
  const array=arrays[3]; // Current and all requested prices are in [-30272,-29569].
  return new TransactionInstruction({programId:PROGRAM,keys:[
    key(TOKEN_PROGRAM_ID,false),key(actor.publicKey,false,true),
    key(POOL,true),key(ataA,true),key(VAULT_A,true),
    key(ataB,true),key(VAULT_B,true),
    key(array,true),key(array,true),key(array,true),key(oracle,false),
  ],data});
}

async function main(){
  const start=await image();
  if(start.pool.liquidity!=='0'||start.pool.tick!==-29921)
    throw new Error('Expected C7AD after previous boundary receipt');
  const emptyGap=await send([swap({amount:1n,aToB:true,limitTick:-30000})],
    'zero-liquidity gap from -29921 to -30000');
  const afterGap=await image();
  const reverse=await send([swap({amount:1_000_000n,aToB:false,limitTick:-29912})],
    'reverse USDC-to-WSOL crossing -29920');
  const afterReverse=await image();
  const result={schema:'orca-one-sided-boundary-followup/v1',
    mainnetSubmission:false,start,emptyGap,afterGap,reverse,afterReverse};
  const out=path.join(__dirname,'one-sided-boundary-followup.json');
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({out,start,emptyGap,afterGap,reverse,afterReverse}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
