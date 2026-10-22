#!/usr/bin/env node
'use strict';
// Read-only DNL/PONS deployment and route recheck. No transaction submission.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const base = __dirname;
const env = Object.fromEntries((fs.existsSync('/tmp/composer-helius-only.env') ?
  fs.readFileSync('/tmp/composer-helius-only.env', 'utf8') : '')
  .split(/\r?\n/).filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL ||
  env.RPC_URL || 'https://api.mainnet-beta.solana.com';
if (!endpoint) throw Error('No RPC endpoint');
const PROGRAM = 'DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4';
const POOL = 'J5vnfreibQsJrdFoj8DQTpBKNf6p2BGzzTjUZHDyXraj';
const PONS_VAULT = 'BSevns3N27vWBcYJxKwXFmJYp4T2HgWXYtgh92yxPbFb';
const PONS = 'poNSfquKq512ApeYjVghwViSun4x1MhCqHVH2Paq4jN';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RESERVE = 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z';
const MINT_SOL = 'So11111111111111111111111111111111111111112';
const wait = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
async function rpc(method, params = []) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
      if (response.status === 429 || response.status >= 500) throw Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (e) { last=e; await wait(200 * 2 ** i); }
  }
  throw last;
}
function accountImage(a) {
  if (!a) return null;
  const b = Buffer.from(a.data[0], 'base64');
  return {owner:a.owner, executable:a.executable, lamports:a.lamports, dataLength:b.length,
    sha256:crypto.createHash('sha256').update(b).digest('hex'), data:b};
}
function publicImage(a) { const {data, ...rest}=a || {}; return rest; }
function tokenImage(a) {
  if (!a) return null;
  return {...publicImage(a), mint:bs58(a.data.subarray(0,32)), authority:bs58(a.data.subarray(32,64)),
    rawAmount:a.data.readBigUInt64LE(64).toString()};
}
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function bs58(bytes) {
  let n=0n; for(const b of bytes)n=n*256n+BigInt(b);
  let s='';while(n){s=ALPHABET[Number(n%58n)]+s;n/=58n;}
  for(const b of bytes){if(b!==0)break;s='1'+s;}return s||'1';
}
async function quote(inputMint, outputMint, amount, opts={}) {
  const u=new URL('https://lite-api.jup.ag/swap/v1/quote');
  const params={inputMint,outputMint,amount:String(amount),swapMode:'ExactIn',slippageBps:'50',
    restrictIntermediateTokens:'true',...opts};
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  const observedAt=new Date().toISOString();
  let last;
  for(let attempt=0;attempt<4;attempt++){
    try {
      const r=await fetch(u,{headers:{accept:'application/json'}});
      const body=await r.json();
      if(r.status===429||r.status>=500){last=`HTTP ${r.status}: ${body.error||''}`;await wait(400*2**attempt);continue;}
      return {observedAt,httpStatus:r.status,request:params,contextSlot:body.contextSlot||null,
        inAmount:body.inAmount||null,outAmount:body.outAmount||null,
        otherAmountThreshold:body.otherAmountThreshold||null,priceImpactPct:body.priceImpactPct||null,
        route:(body.routePlan||[]).map(x=>({percent:x.percent,label:x.swapInfo.label,
          ammKey:x.swapInfo.ammKey,inputMint:x.swapInfo.inputMint,outputMint:x.swapInfo.outputMint,
          inAmount:x.swapInfo.inAmount,outAmount:x.swapInfo.outAmount,feeAmount:x.swapInfo.feeAmount,
          feeMint:x.swapInfo.feeMint})),error:body.error||null,errorCode:body.errorCode||null};
    } catch(e){last=String(e);await wait(400*2**attempt);}
  }
  return {observedAt,httpStatus:null,request:params,error:last,outAmount:null,route:[]};
}
async function main(){
  const genesis=await rpc('getGenesisHash');
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('RPC not mainnet-beta');
  const accounts=[PROGRAM,POOL,PONS_VAULT,PONS,USDC,RESERVE];
  const block=await rpc('getMultipleAccounts',[accounts,{encoding:'base64',commitment:'confirmed'}]);
  const im=Object.fromEntries(accounts.map((k,i)=>[k,accountImage(block.value[i])]));
  const programData=im[PROGRAM]?.data?.length===36?bs58(im[PROGRAM].data.subarray(4,36)):null;
  const pd=programData?accountImage((await rpc('getAccountInfo',[programData,
    {encoding:'base64',commitment:'confirmed'}])).value):null;
  const reserve=im[RESERVE];
  const onchain={slot:block.context.slot,program:publicImage(im[PROGRAM]),programDataAddress:programData,
    programData:publicImage(pd),deploySlot:pd?.data?.length>=12?Number(pd.data.readBigUInt64LE(4)):null,
    pool:publicImage(im[POOL]),ponsVault:tokenImage(im[PONS_VAULT]),
    ponsMint:{...publicImage(im[PONS]),decimals:im[PONS]?.data?.[44],supplyRaw:im[PONS]?.data?.readBigUInt64LE(36).toString()},
    usdcMint:{...publicImage(im[USDC]),decimals:im[USDC]?.data?.[44]},
    klendReserve:{...publicImage(reserve),availableRaw:reserve?.data?.readBigUInt64LE(224).toString(),
      flashFeeSf:reserve?.data?.readBigUInt64LE(4904).toString()}};
  const ladder=[1000000n,10000000n,100000000n,1000000000n,10000000000n,100000000000n];
  const rows=[];
  for(const amount of ladder){
    const first=await quote(USDC,PONS,amount,{dexes:'Denali',onlyDirectRoutes:'true'});
    let exit=null,exitConstrained=null;
    if(first.outAmount&&first.route.length===1&&first.route[0].ammKey===POOL){
      exit=await quote(PONS,USDC,first.outAmount,{excludeDexes:'Denali'});
      exitConstrained=await quote(PONS,USDC,first.outAmount,{excludeDexes:'Denali',maxAccounts:'24'});
    }
    const net=exit?.outAmount?(BigInt(exit.outAmount)-amount).toString():null;
    const netConstrained=exitConstrained?.outAmount?(BigInt(exitConstrained.outAmount)-amount).toString():null;
    rows.push({inputUsdcRaw:String(amount),first,exit,exitConstrained,
      grossDeltaUsdcRaw:net,constrainedGrossDeltaUsdcRaw:netConstrained});
    console.log(JSON.stringify({inputUsdcRaw:String(amount),firstOutPonsRaw:first.outAmount,
      firstRoute:first.route.map(x=>x.label),exitOutUsdcRaw:exit?.outAmount,
      exitRoute:exit?.route.map(x=>x.label),grossDeltaUsdcRaw:net,
      constrainedExitOutUsdcRaw:exitConstrained?.outAmount,
      constrainedGrossDeltaUsdcRaw:netConstrained}));
    await wait(300);
  }
  const result={generatedAt:new Date().toISOString(),network:'mainnet-beta',genesis,readOnly:true,
    priorQuoteSlots:[457423100,457423077,457423131],onchain,rows};
  const file=path.join(base,'dnl-pons-live-recheck.json');
  fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({file,slot:onchain.slot,deploySlot:onchain.deploySlot,
    programDataSha256:onchain.programData?.sha256,rows:rows.length}));
}
if(require.main===module) main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
module.exports={quote,USDC,PONS,POOL};
