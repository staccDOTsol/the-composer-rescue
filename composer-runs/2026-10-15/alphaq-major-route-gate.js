#!/usr/bin/env node
'use strict';
// Read-only direct AlphaQ -> independent exit economic gate on mainnet quotes.
const fs = require('fs');
const path = require('path');
const M = {
  USDS: ['USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', 6],
  USDC: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
  JitoSOL: ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 9],
  mSOL: ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 9],
  WSOL: ['So11111111111111111111111111111111111111112', 9]
};
const P = 'ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA';
const pairs = [
  {a:'USDS',b:'USDC',pool:'6R3LknvRLwPg7c8Cww7LKqBHRDcGioPoj29uURX9anug',sizes:[100,1000,10000,100000]},
  {a:'JitoSOL',b:'WSOL',pool:'hKH9LFREBm3TxTx5Ex6D1nHTKEA8ii3CWfhEkB9s21u',sizes:[1,10,100,500]},
  {a:'mSOL',b:'WSOL',pool:'DbTYuFpdELAgyZBhX7TaTVDGYq1dJSQqdnAhtWHjxPjP',sizes:[1,10,100,500]}
];
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;
if(!url)throw Error('RPC endpoint unavailable');
async function rpc(method,params=[]){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const x=await r.json();if(x.error)throw Error(`${method}: ${JSON.stringify(x.error)}`);return x.result;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function quote(a,b,amount){const qs=new URLSearchParams({inputMint:M[a][0],outputMint:M[b][0],amount:String(amount),slippageBps:'100',onlyDirectRoutes:'true'});
  let r,q;
  for(let attempt=0;attempt<6;attempt++){
    r=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+qs);
    const body=await r.text();
    if(r.status===429||body.startsWith('Rate limit')){await sleep(700*(attempt+1));continue;}
    try{q=JSON.parse(body);break;}catch{throw Error('quote non-JSON status '+r.status);}
  }
  if(!q)throw Error('quote rate limit persisted');
  await sleep(125);
  return {httpStatus:r.status,amountIn:q.inAmount||String(amount),
    amountOut:q.outAmount||null,contextSlot:q.contextSlot||null,error:q.error||null,
    route:(q.routePlan||[]).map(x=>({label:x.swapInfo?.label||null,ammKey:x.swapInfo?.ammKey||null,percent:x.percent||null}))};}
async function main(){const genesis=await rpc('getGenesisHash');if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const pools=pairs.map(x=>x.pool);const state=await rpc('getMultipleAccounts',[[P,...pools],{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
  const accounts=Object.fromEntries([P,...pools].map((k,i)=>[k,{owner:state.value[i]?.owner||null,executable:state.value[i]?.executable||false,space:state.value[i]?.space??null}]));
  const rows=[];
  for(const pair of pairs)for(const n of pair.sizes){const input=(BigInt(n)*10n**BigInt(M[pair.a][1])).toString();const first=await quote(pair.a,pair.b,input);
    const target=first.route.length===1&&first.route[0].ammKey===pair.pool;const exit=target&&first.amountOut?await quote(pair.b,pair.a,first.amountOut):null;
    const independent=Boolean(exit?.route?.length)&&exit.route.every(x=>x.ammKey!==pair.pool);
    rows.push({pair:pair.a+'>'+pair.b,size:n,target,first,exit,independent,
      netInputRawBeforeTxFees:independent&&exit?.amountOut?(BigInt(exit.amountOut)-BigInt(input)).toString():null});}
  const out={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,stateSlot:state.context.slot,program:P,accounts,pairs,rows,
    quoteMethod:'Jupiter ExactIn onlyDirectRoutes, first leg accepted only when exact AlphaQ pool wins, independent reverse exit',
    noTransaction:true,limitations:['Best direct quote does not enumerate all pools or atomic paths','No signed simulation unless a persistent fee-positive round trip appears']};
  const f=path.join(__dirname,'alphaq-major-route-gate.json');fs.writeFileSync(f,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({stateSlot:out.stateSlot,accounts,rows:rows.map(x=>({pair:x.pair,size:x.size,target:x.target,
    independent:x.independent,net:x.netInputRawBeforeTxFees,exitRoute:x.exit?.route?.[0]?.label||null})),evidence:f}));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
