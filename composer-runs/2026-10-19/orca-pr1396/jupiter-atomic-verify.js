#!/usr/bin/env node
'use strict';

// Confirm the atomic result from the isolated local Surfpool ledger.
const fs=require('fs');
const path=require('path');
const {rpc}=require('./real-flash-envelope.js');
const FILE=path.join(__dirname,'jupiter-atomic-full-boundary.json');
const receipt=JSON.parse(fs.readFileSync(FILE,'utf8'));
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(receipt.fork))
  throw new Error('Only localhost fork verification allowed');
const KLEND='3SdrFTt4Ye5yppzpT9axNMj8W1x71nDYXdjv7vDuBpnR';
const PROJECT0='2eicbpitfJXDwqCuFAmPgDP7t2oUotnAzbGzRKLMgSLe';
const RAYDIUM='675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const asAmount=balance=>BigInt(balance?.uiTokenAmount?.amount??'0');
function balances(tx,field){
  const keys=tx.transaction.message.accountKeys.map(k=>String(k.pubkey??k));
  return Object.fromEntries((tx.meta[field]||[]).map(row=>[
    keys[row.accountIndex],asAmount(row)]));
}
async function main(){
  const sig=receipt.localSend?.signature;
  if(!sig)throw new Error('No local signature to verify');
  const tx=await rpc(receipt.fork,'getTransaction',[sig,
    {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
  const status=(await rpc(receipt.fork,'getSignatureStatuses',
    [[sig],{searchTransactionHistory:true}])).value[0];
  if(!tx||tx.version!==1||tx.meta.err||status?.err)
    throw new Error('Local v1 transaction missing or failed');
  const pre=balances(tx,'preTokenBalances');
  const post=balances(tx,'postTokenBalances');
  const lenderDeltas=Object.fromEntries([KLEND,PROJECT0]
    .map(key=>[key,String((post[key]??0n)-(pre[key]??0n))]));
  if(Object.values(lenderDeltas).some(x=>x!=='0'))
    throw new Error('Lender token balance changed');
  const logs=tx.meta.logMessages||[];
  const counts={whirlpoolSwaps:logs.filter(x=>
      x.includes('Program log: Instruction: Swap')).length,
    routerV2:logs.filter(x=>x.includes('Instruction: RouteV2')).length,
    raydiumInvokes:logs.filter(x=>x.includes(`Program ${RAYDIUM} invoke`)).length};
  if(counts.whirlpoolSwaps!==9||counts.routerV2!==1||counts.raydiumInvokes!==1)
    throw new Error(`Wrong atomic route: ${JSON.stringify(counts)}`);
  const input=BigInt(receipt.after.vaultA)-BigInt(receipt.before.vaultA);
  const quoteOutput=BigInt(receipt.before.vaultB)-BigInt(receipt.after.vaultB);
  const actorDelta=BigInt(receipt.after.actorWsol)-BigInt(receipt.before.actorWsol);
  const actualRouterOutput=input+actorDelta;
  const beforeSol=5_000_000_000n;
  const afterSol=BigInt((await rpc(receipt.fork,'getBalance',
    [receipt.actor,{commitment:'processed'}])).value);
  receipt.localSend.err=null;
  receipt.localSend.receiptAvailable=true;
  receipt.verification={status,transactionVersion:tx.version,
    slot:tx.slot,err:tx.meta.err,feeLamports:tx.meta.fee,
    computeUnitsConsumed:tx.meta.computeUnitsConsumed,
    lenderVaultDeltas:lenderDeltas,logs:counts,
    whirlpoolInputLamports:String(input),whirlpoolOutputUsdcRaw:String(quoteOutput),
    actualRouterOutputLamports:String(actualRouterOutput),
    actorWsolDeltaLamports:String(actorDelta),
    actualVsRouterQuoteLamports:String(actualRouterOutput-BigInt(receipt.quote.outAmount)),
    actorNativeSolLamportsBefore:String(beforeSol),
    actorNativeSolLamportsAfter:String(afterSol),
    actorNativeSolLamportsDelta:String(afterSol-beforeSol)};
  fs.writeFileSync(FILE,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({file:FILE,verification:receipt.verification},null,2));
}
main().catch(error=>{console.error(String(error.stack||error)
  .replace(/api-key=[^&\s]+/g,'api-key=[REDACTED]'));process.exitCode=1;});
