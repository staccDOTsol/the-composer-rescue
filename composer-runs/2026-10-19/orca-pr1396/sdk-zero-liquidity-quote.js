#!/usr/bin/env node
'use strict';
// Official legacy Whirlpool SDK read-only quotes on a zero-active-liquidity
// mainnet-backed local fork after an actor LP round trip.
const fs=require('fs');const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {Connection,PublicKey}=require(`${MOD}/@solana/web3.js`);
const anchor=require(`${MOD}/@coral-xyz/anchor`);
const sdk=require(`${MOD}/@orca-so/whirlpools-sdk`);
const {Percentage}=require(`${MOD}/@orca-so/common-sdk`);
const BN=require(`${MOD}/bn.js`);
const {actor}=require('./one-sided-boundary.js');
const FORK='http://127.0.0.1:64335';
const POOL=new PublicKey('C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd');
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const WSOL=new PublicKey('So11111111111111111111111111111111111111112');
const USDC=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
async function main(){
 const ctx=sdk.WhirlpoolContext.from(new Connection(FORK,'processed'),
  new anchor.Wallet(actor),undefined,undefined,
  {userDefaultConfirmCommitment:'processed'},PROGRAM);
 const pool=await sdk.buildWhirlpoolClient(ctx).getPool(POOL,sdk.IGNORE_CACHE);
 const state={liquidity:pool.getData().liquidity.toString(),
  tick:pool.getData().tickCurrentIndex,sqrtPriceX64:pool.getData().sqrtPrice.toString()};
 const cases=[];
 for(const [label,mint,amount] of [
  ['B-to-A empty direction',USDC,'1000000'],
  ['A-to-B returning to previous position range',WSOL,'1000000']]){
  try{
   const q=await sdk.swapQuoteByInputToken(pool,mint,new BN(amount),
    Percentage.fromFraction(1,100),PROGRAM,ctx.fetcher,sdk.IGNORE_CACHE);
   cases.push({label,inputRaw:amount,amountInRaw:q.estimatedAmountIn.toString(),
    amountOutRaw:q.estimatedAmountOut.toString(),
    endTick:q.estimatedEndTickIndex,endSqrtPriceX64:q.estimatedEndSqrtPrice.toString()});
  }catch(e){cases.push({label,inputRaw:amount,errorName:e.name,errorMessage:e.message});}
 }
 const result={schema:'orca-sdk-zero-liquidity-quote/v1',
  source:'@orca-so/whirlpools-sdk swapQuoteByInputToken',
  mainnetSubmission:false,fork:FORK,pool:POOL.toBase58(),state,cases};
 const out=path.join(__dirname,'sdk-zero-liquidity-quote.json');
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out,state,cases}));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
