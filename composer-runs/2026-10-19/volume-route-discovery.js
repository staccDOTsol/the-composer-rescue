#!/usr/bin/env node
'use strict';
// Read-only current mainnet-beta major-pair route diversity sample.
// Iteratively exclude the winning venue to reveal distinct direct-route programs.
const fs = require('fs');
const path = require('path');

const RPC = process.env.RPC || process.env.SOLANA_RPC;
if (!RPC) throw new Error('RPC or SOLANA_RPC must be set; no endpoint is logged');
const genesisExpected = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const mint = {
  USDC: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
  USDT: ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6],
  PYUSD: ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6],
  USDG: ['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', 6],
  WSOL: ['So11111111111111111111111111111111111111112', 9],
  JitoSOL: ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 9],
  mSOL: ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 9]
};
const pairs = [
  ['USDC','USDT',1000], ['USDC','WSOL',1000], ['USDC','JitoSOL',1000],
  ['USDC','mSOL',1000], ['USDC','PYUSD',1000], ['USDC','USDG',1000],
  ['USDT','WSOL',1000], ['WSOL','JitoSOL',10], ['WSOL','mSOL',10],
  ['JitoSOL','mSOL',10]
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
async function rpc(method, params=[]) {
  const response = await fetch(RPC, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function quote(a,b,human,exclude) {
  const amount = (BigInt(human) * 10n ** BigInt(mint[a][1])).toString();
  const params = new URLSearchParams({inputMint:mint[a][0],outputMint:mint[b][0],amount,
    slippageBps:'100',onlyDirectRoutes:'true'});
  if (exclude.length) params.set('excludeDexes',exclude.join(','));
  for (let i=0;i<6;i++) {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + params);
    const raw = await response.text();
    if (response.status===429 || raw.startsWith('Rate limit')) {await sleep(650*(i+1));continue;}
    let json; try {json=JSON.parse(raw);} catch {return {httpStatus:response.status,error:'non-JSON response'};}
    return {httpStatus:response.status,contextSlot:json.contextSlot||null,error:json.error||json.errorCode||null,
      outAmount:json.outAmount||null,route:(json.routePlan||[]).map(x=>({label:x.swapInfo?.label||null,
      ammKey:x.swapInfo?.ammKey||null,percent:x.percent??null}))};
  }
  return {httpStatus:429,error:'rate-limited-after-retries'};
}
async function main() {
  const genesis=await rpc('getGenesisHash'); if(genesis!==genesisExpected) throw new Error('RPC is not mainnet-beta');
  const rows=[];
  for(const [a,b,human] of pairs){
    const exclude=[];
    for(let rank=0;rank<5;rank++){
      const q=await quote(a,b,human,exclude);
      const row={pair:`${a}/${b}`,inputHuman:human,rank,excluded:[...exclude],...q};rows.push(row);
      const first=q.route?.[0];
      if(!first?.label || !first?.ammKey || exclude.includes(first.label))break;
      exclude.push(first.label);await sleep(175);
    }
  }
  const keys=[...new Set(rows.flatMap(r=>r.route?.map(x=>x.ammKey)||[]).filter(Boolean))];
  const owners={};
  for(let i=0;i<keys.length;i+=100){
    const batch=keys.slice(i,i+100);
    const result=await rpc('getMultipleAccounts',[batch,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
    batch.forEach((k,j)=>{owners[k]={owner:result.value[j]?.owner||null,executable:result.value[j]?.executable||false};});
  }
  const out={observedAtUtc:new Date().toISOString(),genesis,method:'10 chosen real-major pairs, one nominal size each, up to five distinct best direct venue labels selected by iterative exclusion',
    limitations:['Not all pools within a venue','Public quote API selection and rate limits','Pool owner is not custody or signer provenance'],
    rows,owners,noTransaction:true};
  const file=path.join(__dirname,'volume-route-discovery.json');fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({rows:rows.length,uniquePools:keys.length,uniqueOwners:new Set(Object.values(owners).map(x=>x.owner).filter(Boolean)).size,
    routes:rows.map(r=>({pair:r.pair,rank:r.rank,label:r.route?.[0]?.label||null,pool:r.route?.[0]?.ammKey||null,
      owner:owners[r.route?.[0]?.ammKey]?.owner||null,error:r.error||null})),file},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
