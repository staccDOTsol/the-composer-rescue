#!/usr/bin/env node
'use strict';
// Read-only, bounded SolFi V2 pool/custody proof and two-sided cross-venue quotes.
// Never submits or signs a transaction.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROGRAM = 'SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF';
const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const WSOL = 'So11111111111111111111111111111111111111112';
let id = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rpc(method, params = []) {
  const r = await fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const v = await r.json(); if (v.error) throw Error(method+': '+JSON.stringify(v.error));
  return v.result;
}
async function account(key, encoding = 'jsonParsed') {
  const r = await rpc('getAccountInfo', [key,{encoding,commitment:'confirmed'}]);
  return {key,slot:r.context.slot,owner:r.value?.owner||null,executable:r.value?.executable||false,
    lamports:r.value?.lamports??null,data:r.value?.data??null};
}
function programId(ix) { return typeof ix.programId === 'string' ? ix.programId : ix.programId?.toString?.(); }
function summarizeTransaction(t, signature) {
  const outer = t.transaction.message.instructions;
  const groups = [];
  for (const group of t.meta?.innerInstructions || []) {
    const calls = group.instructions || [];
    groups.push({outerIndex:group.index,outerProgram:programId(outer[group.index]),
      solfiCallCount:calls.filter(ix=>programId(ix)===PROGRAM).length,
      solfiCalls:calls.map((ix,index)=>({ix,index})).filter(x=>programId(x.ix)===PROGRAM)
        .map(x=>({index:x.index,stackHeight:x.ix.stackHeight??null})),
      tokenTransfers:calls.filter(ix=>['transfer','transferChecked'].includes(ix.parsed?.type))
        .map(ix=>({program:programId(ix),type:ix.parsed.type,
          stackHeight:ix.stackHeight??null,...ix.parsed.info}))});
  }
  return {signature,slot:t.slot,blockTime:t.blockTime,error:t.meta?.err||null,
    outerPrograms:outer.map(programId),groups};
}
async function quote(a,b,amount,side) {
  const p = new URLSearchParams({inputMint:a,outputMint:b,amount:String(amount),
    slippageBps:'100',onlyDirectRoutes:'true'});
  p.set(side==='solfi'?'dexes':'excludeDexes','SolFi V2');
  const r = await fetch('https://lite-api.jup.ag/swap/v1/quote?'+p);
  const v = await r.json();
  const route = (v.routePlan||[]).map(x=>({label:x.swapInfo?.label||null,
    ammKey:x.swapInfo?.ammKey||null,percent:x.percent||null}));
  return {side,httpStatus:r.status,inAmount:v.inAmount||String(amount),outAmount:v.outAmount||null,
    contextSlot:v.contextSlot||null,error:v.error||null,route,
    accepted:route.length===1 && (side==='solfi' ? route[0].ammKey===POOL :
      route[0].ammKey!==POOL && route[0].label!=='SolFi V2')};
}
async function main() {
  const genesis = await rpc('getGenesisHash'); if(genesis!==GENESIS)throw Error('not mainnet-beta');
  const pool = await account(POOL,'base64');
  const program = await account(PROGRAM,'base64');
  const programBytes=Buffer.from(program.data?.[0]||'', 'base64');
  if (programBytes.length!==36 || programBytes.readUInt32LE(0)!==2) throw Error('unexpected upgradeable program account');
  const bs58=require('./jup6qf-sdk/node_modules/bs58');
  const programDataKey=bs58.encode(programBytes.subarray(4,36));
  const programDataReply=await rpc('getAccountInfo',[programDataKey,
    {encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:12}}]);
  const programDataBytes=Buffer.from(programDataReply.value?.data?.[0]||'', 'base64');
  if (programDataBytes.length<12 || programDataBytes.readUInt32LE(0)!==3) throw Error('unexpected program-data account');
  const lastDeploySlot=Number(programDataBytes.readBigUInt64LE(4));
  const programDataProof={method:'getAccountInfo base64 dataSlice offset 0 length 12',
    contextSlot:programDataReply.context.slot,owner:programDataReply.value.owner,
    stateTag:3,lastDeploySlot};
  const ownedTokens = await rpc('getTokenAccountsByOwner',[POOL,
    {programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},
    {encoding:'jsonParsed',commitment:'confirmed'}]);
  const owned2022Tokens = await rpc('getTokenAccountsByOwner',[POOL,
    {programId:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'},
    {encoding:'jsonParsed',commitment:'confirmed'}]);
  const vaults=[ownedTokens,owned2022Tokens].flatMap(reply=>reply.value.map(x=>({
    key:x.pubkey,slot:reply.context.slot,tokenProgram:x.account.owner,
    mint:x.account.data.parsed?.info?.mint||null,
    authority:x.account.data.parsed?.info?.owner||null,
    amount:x.account.data.parsed?.info?.tokenAmount?.amount||null,
    decimals:x.account.data.parsed?.info?.tokenAmount?.decimals??null,
    uiAmountString:x.account.data.parsed?.info?.tokenAmount?.uiAmountString||null})));
  const sigs = await rpc('getSignaturesForAddress',[POOL,{limit:8,commitment:'confirmed'}]);
  const transactions=[];
  for (const s of sigs) {
    if (s.err) continue;
    const t = await rpc('getTransaction',[s.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);
    if (t) transactions.push(summarizeTransaction(t,s.signature));
    if (transactions.length>=4) break;
  }
  const candidates = [...new Set(transactions.flatMap(t=>t.groups.flatMap(g=>g.tokenTransfers
    .flatMap(x=>[x.source,x.destination,x.authority]).filter(Boolean))))];
  const accounts={};
  for (let i=0;i<candidates.length;i+=100) {
    const batch=candidates.slice(i,i+100);
    const r=await rpc('getMultipleAccounts',[batch,{encoding:'jsonParsed',commitment:'confirmed'}]);
    batch.forEach((key,j)=>{const v=r.value[j];accounts[key]={owner:v?.owner||null,
      executable:v?.executable||false,parsed:v?.data?.parsed||null,slot:r.context.slot};});
  }
  const rows=[];
  for (const usdc of [100,1000,10000]) {
    const input=BigInt(usdc)*1000000n;
    for (const direction of ['solfi-first','solfi-second']) {
      const first=direction==='solfi-first' ? await quote(USDC,USDT,input,'solfi') :
        await quote(USDC,USDT,input,'independent');
      await delay(100);
      const second=first.outAmount&&first.accepted ?
        await quote(USDT,USDC,first.outAmount,direction==='solfi-first'?'independent':'solfi') : null;
      await delay(100);
      const valid=!!(first.outAmount&&first.accepted&&second?.outAmount&&second.accepted);
      rows.push({usdc,direction,first,second,valid,
        netUsdcRaw:valid?(BigInt(second.outAmount)-input).toString():null});
    }
  }
  const solUsdc=await quote(WSOL,USDC,1000000000n,'independent');
  const oneSignatureBaseFeeUsdcRaw=solUsdc.outAmount ?
    (BigInt(solUsdc.outAmount)*5000n/1000000000n).toString() : null;
  const result={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,
    programId:PROGRAM,poolKey:POOL,program,programDataKey,lastDeploySlot,
    programDataProof,pool,vaults,recentSignatures:sigs,
    transactions,accounts,quotes:rows,solUsdc,oneSignatureBaseFeeUsdcRaw,noMainnetTransaction:true,
    limitations:['Recent pool-key signature sample only','Quoted legs are not atomic execution',
      'A token authority account owned by the program plus inner SPL transfer under the SolFi CPI proves a bounded program-signed outflow, not a general withdrawability claim']};
  const output=path.join(dir,'solfi-v2-current-gate.json');
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,poolOwner:pool.owner,programExecutable:program.executable,
    signatures:sigs.length,transactions:transactions.length,vaults,
    programDataKey,lastDeploySlot,solUsdcOutRaw:solUsdc.outAmount,oneSignatureBaseFeeUsdcRaw,
    quotes:rows.map(x=>({usdc:x.usdc,direction:x.direction,valid:x.valid,
      netUsdcRaw:x.netUsdcRaw,first:x.first.route[0],second:x.second?.route[0],
      firstSlot:x.first.contextSlot,secondSlot:x.second?.contextSlot,
      firstError:x.first.error,secondError:x.second?.error}))},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
