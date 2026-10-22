#!/usr/bin/env node
'use strict';
// Read-only size/account screen for an atomic DNL + independent exit + KLend route.
// Uses a public wallet address from prior evidence; it does not load a signing key.
const fs=require('fs');
const path=require('path');
const DIR=__dirname;
const MOD='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,createCloseAccountInstruction}=require(`${MOD}/@solana/spl-token`);
const bs58=require(`${MOD}/bs58`);
const {encodeV1}=require('./klend-v1-composition.js');
const {USDC,PONS,POOL}=require('./dnl-pons-live-recheck.js');
const KLEND='KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const RESERVE='AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z';
const WALLET='331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth';
const P=x=>new PublicKey(x);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rpcEndpoint=process.env.HEAVY_RPC_URL||process.env.RPC_URL||'https://api.mainnet-beta.solana.com';
let seq=0;
async function rpc(method,params=[]){let last;
  for(let n=0;n<4;n++)try{const r=await fetch(rpcEndpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const b=await r.json();
    if(r.status===429||r.status>=500)throw Error(`HTTP ${r.status}`);
    if(b.error)throw Error(`${method}: ${JSON.stringify(b.error)}`);return b.result;
  }catch(e){last=e;await wait(400*2**n)}throw last;
}
async function jup(url,opts){let last;
  for(let n=0;n<4;n++)try{const r=await fetch(url,opts);const b=await r.json();
    if(r.status===429||r.status>=500)throw Error(`HTTP ${r.status}`);
    return {status:r.status,body:b};
  }catch(e){last=e;await wait(800*2**n)}throw last;
}
async function quote(input,output,amount,extra){
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');
  for(const [k,v] of Object.entries({inputMint:input,outputMint:output,amount:String(amount),
    swapMode:'ExactIn',slippageBps:'50',restrictIntermediateTokens:'true',...extra}))u.searchParams.set(k,String(v));
  const r=await jup(u);
  if(r.status!==200||!r.body.outAmount)throw Error(`quote ${r.status}: ${r.body.error||'no output'}`);
  return r.body;
}
async function build(q){const r=await jup('https://lite-api.jup.ag/swap/v1/swap-instructions',
  {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quoteResponse:q,
    userPublicKey:WALLET,wrapAndUnwrapSol:false,useSharedAccounts:true,
    dynamicComputeUnitLimit:false,skipUserAccountsRpcCalls:true})});
  return {status:r.status,body:r.body};
}
function ix(j){return new TransactionInstruction({programId:P(j.programId),
  keys:j.accounts.map(k=>({pubkey:P(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable})),
  data:Buffer.from(j.data,'base64')});}
function historicalIx(tx,index){
  const m=tx.transaction.message,loaded=tx.meta.loadedAddresses||{writable:[],readonly:[]};
  const all=[...m.accountKeys,...loaded.writable,...loaded.readonly];
  const h=m.header,n=m.accountKeys.length,src=m.instructions[index];
  const writable=j=>j<n?j<h.numRequiredSignatures?
    j<h.numRequiredSignatures-h.numReadonlySignedAccounts:
    j<n-h.numReadonlyUnsignedAccounts:j<n+loaded.writable.length;
  return new TransactionInstruction({programId:P(all[src.programIdIndex]),
    keys:src.accounts.map(j=>({pubkey:P(all[j]),isSigner:j<h.numRequiredSignatures,
      isWritable:writable(j)})),data:Buffer.from(bs58.decode(src.data))});
}
function flashIx(template,reserve,userUsdc,amount,borrowIndex){
  const keys=template.keys.map(k=>({...k}));
  const market=P(reserve.market);
  const lma=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],P(KLEND))[0];
  for(const [i,v] of Object.entries({0:P(WALLET),1:lma,2:market,3:P(reserve.reserve),
    4:P(USDC),5:P(reserve.supplyVault),6:userUsdc,7:P(reserve.feeVault),11:TOKEN_PROGRAM_ID}))
    keys[Number(i)].pubkey=v;
  const data=Buffer.from(template.data);data.writeBigUInt64LE(amount,8);
  if(borrowIndex!==undefined)data[16]=borrowIndex;
  return new TransactionInstruction({programId:P(KLEND),keys,data});
}
function list(b){return [...(b.setupInstructions||[]),...(b.otherInstructions||[]),
  ...(b.swapInstruction?[b.swapInstruction]:[]),...(b.cleanupInstruction?[b.cleanupInstruction]:[])].map(ix);}
function image(q){return {contextSlot:q.contextSlot,inAmount:q.inAmount,outAmount:q.outAmount,
  threshold:q.otherAmountThreshold,route:q.routePlan.map(x=>({label:x.swapInfo.label,
    ammKey:x.swapInfo.ammKey,inAmount:x.swapInfo.inAmount,outAmount:x.swapInfo.outAmount}))};}
async function main(){
  const genesis=await rpc('getGenesisHash');if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const amount=1000000000n;
  const first=await quote(USDC,PONS,amount,{dexes:'Denali',onlyDirectRoutes:'true'});
  if(first.routePlan.length!==1||first.routePlan[0].swapInfo.ammKey!==POOL)throw Error('first route is not DNL pool');
  await wait(1500);
  const exit=await quote(PONS,USDC,first.outAmount,{excludeDexes:'Denali',maxAccounts:'24'});
  if(exit.routePlan.some(x=>x.swapInfo.ammKey===POOL))throw Error('exit uses DNL pool');
  await wait(1500);
  const builtFirst=await build(first);
  await wait(1500);
  const builtExit=await build(exit);
  const record={generatedAt:new Date().toISOString(),genesis,network:'mainnet-beta',
    quote:{first:image(first),exit:image(exit),grossDeltaRaw:String(BigInt(exit.outAmount)-amount)},
    builds:{first:{status:builtFirst.status,error:builtFirst.body.error||null,
      setupCount:(builtFirst.body.setupInstructions||[]).length,
      otherCount:(builtFirst.body.otherInstructions||[]).length,
      swapAccountCount:builtFirst.body.swapInstruction?.accounts?.length||null,
      cleanupCount:builtFirst.body.cleanupInstruction?1:0},
      exit:{status:builtExit.status,error:builtExit.body.error||null,
        setupCount:(builtExit.body.setupInstructions||[]).length,
        otherCount:(builtExit.body.otherInstructions||[]).length,
        swapAccountCount:builtExit.body.swapInstruction?.accounts?.length||null,
        cleanupCount:builtExit.body.cleanupInstruction?1:0}},
    noSigningKeyLoaded:true,noSimulation:true,noSubmission:true};
  if(builtFirst.status===200&&builtExit.status===200&&builtFirst.body.swapInstruction&&builtExit.body.swapInstruction){
    const userUsdc=getAssociatedTokenAddressSync(P(USDC),P(WALLET));
    const userPons=getAssociatedTokenAddressSync(P(PONS),P(WALLET));
    const users=await rpc('getMultipleAccounts',[[String(userUsdc),String(userPons)],
      {encoding:'base64',commitment:'confirmed'}]);
    record.userAtas={slot:users.context.slot,usdc:String(userUsdc),usdcExists:!!users.value[0],
      pons:String(userPons),ponsExists:!!users.value[1]};
    const reserve=JSON.parse(fs.readFileSync(path.join(DIR,'klend-zero-fee-census.json'),'utf8'))
      .activeZero.find(x=>x.reserve===RESERVE);
    if(!reserve||reserve.flashFeeSf!=='0')throw Error('zero-fee KLend reserve missing');
    const sample=JSON.parse(fs.readFileSync(path.join(DIR,'kamino-flash-history.json'),'utf8')).hits[0].transaction;
    const sourceBorrow=historicalIx(sample,3),sourceRepay=historicalIx(sample,13);
    if(String(sourceBorrow.programId)!==KLEND||String(sourceRepay.programId)!==KLEND)
      throw Error('historical flash template mismatch');
    const setup=[...(builtFirst.body.setupInstructions||[]),...(builtExit.body.setupInstructions||[])].map(ix);
    const firstRest=[...(builtFirst.body.otherInstructions||[]),builtFirst.body.swapInstruction,
      ...(builtFirst.body.cleanupInstruction?[builtFirst.body.cleanupInstruction]:[])].map(ix);
    const exitRest=[...(builtExit.body.otherInstructions||[]),builtExit.body.swapInstruction,
      ...(builtExit.body.cleanupInstruction?[builtExit.body.cleanupInstruction]:[])].map(ix);
    const borrowIndex=setup.length;
    const borrow=flashIx(sourceBorrow,reserve,userUsdc,amount);
    const repay=flashIx(sourceRepay,reserve,userUsdc,amount,borrowIndex);
    const all=[...setup,borrow,...firstRest,...exitRest,repay];
    const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
    try{const e=encodeV1(all,P(WALLET),blockhash);
      record.envelope={instructionCount:e.instructionCount,addressCount:e.addressCount,
        writableCount:e.writableCount,requiredSignatures:e.requiredSignatures,
        wireBytes:e.sizeBytes,v0Bytes:e.v0Bytes,borrowIndex,limitBytes:4096,limitAccounts:64,
        includesSetupCount:setup.length,firstRestCount:firstRest.length,exitRestCount:exitRest.length,
        underLimits:e.sizeBytes<=4096&&e.addressCount<=64};
      if(!users.value[1]){
        const withClose=[...all.slice(0,-1),
          createCloseAccountInstruction(userPons,P(WALLET),P(WALLET)),repay];
        const closed=encodeV1(withClose,P(WALLET),blockhash);
        record.envelope.withPonsAtaClose={instructionCount:closed.instructionCount,
          addressCount:closed.addressCount,wireBytes:closed.sizeBytes,
          underLimits:closed.sizeBytes<=4096&&closed.addressCount<=64,
          conditionalOnZeroPonsDust:true};
      }}
    catch(e){record.envelope={error:e.message,borrowIndex,instructionCount:all.length,
      uniquePubkeys:[...new Set(all.flatMap(i=>[String(i.programId),...i.keys.map(k=>String(k.pubkey))]))].length};}
  }
  const file=path.join(DIR,'dnl-pons-envelope.json');fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify({file,quote:record.quote,builds:record.builds,
    userAtas:record.userAtas,envelope:record.envelope}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
