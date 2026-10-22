#!/usr/bin/env node
'use strict';
// Read-only: sample current best direct major-asset routes and identify their
// pool-account owners. A quoted pool is a discovery lead, not a vulnerability.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
const m = {
  USDC: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6],
  USDT: ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6],
  PYUSD: ['2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6],
  USDG: ['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', 6],
  USDS: ['USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', 6],
  WSOL: ['So11111111111111111111111111111111111111112', 9],
  JitoSOL: ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 9],
  mSOL: ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 9],
  JSOL: ['7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn', 9],
  ETH: ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 8],
  WBTC: ['3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', 8],
  cbBTC: ['cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 8],
  JUP: ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6],
  JTO: ['jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 9],
  RENDER: ['rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', 8],
  ORCA: ['orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', 6],
  MNDE: ['MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey', 9]
};
const batch2 = process.argv[2] === 'batch2';
const pairs = batch2 ? [
  ['USDC','ETH',1000,1], ['USDC','WBTC',1000,1],
  ['USDC','cbBTC',1000,1], ['USDC','WSOL',1000,10],
  ['WSOL','JUP',10,1000], ['WSOL','JTO',10,1000],
  ['WSOL','RENDER',10,1000], ['WSOL','ORCA',10,1000],
  ['WSOL','MNDE',10,10000]
] : [
  ['USDC','USDT',1000], ['USDC','PYUSD',1000], ['USDC','USDG',1000],
  ['USDC','USDS',1000], ['WSOL','JitoSOL',10], ['WSOL','mSOL',10],
  ['WSOL','JSOL',10]
];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function quote(a,b,human) {
  const amount = (BigInt(human) * 10n ** BigInt(m[a][1])).toString();
  const q = new URLSearchParams({inputMint:m[a][0],outputMint:m[b][0],amount,
    slippageBps:'100',onlyDirectRoutes:'true'});
  const r = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + q);
  const v = await r.json();
  return {input:a,output:b,inAmount:amount,httpStatus:r.status,
    outAmount:v.outAmount || null,contextSlot:v.contextSlot || null,
    error:v.error || null,
    route:(v.routePlan||[]).map(x=>({label:x.swapInfo?.label||null,
      ammKey:x.swapInfo?.ammKey||null,percent:x.percent||null}))};
}
async function rpc(method,params=[]) {
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const v=await r.json();if(v.error)throw Error(method+': '+JSON.stringify(v.error));return v.result;
}
async function main(){
  const genesis=await rpc('getGenesisHash');
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const rows=[];
  for(const [a,b,n,reverseN] of pairs){rows.push(await quote(a,b,n));await delay(70);
    rows.push(await quote(b,a,reverseN ?? n));await delay(70);}
  const keys=[...new Set(rows.flatMap(x=>x.route.map(y=>y.ammKey)).filter(Boolean))];
  const owners={};
  for(let i=0;i<keys.length;i+=100){
    const batch=keys.slice(i,i+100);
    const r=await rpc('getMultipleAccounts',[batch,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
    batch.forEach((key,j)=>{owners[key]={owner:r.value[j]?.owner||null,executable:r.value[j]?.executable||false};});
  }
  const out={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,
    method:'Best onlyDirectRoutes Jupiter ExactIn quote for seven selected major pairs, both directions, at one nominal size; pool owners fetched with read-only mainnet RPC.',
    limitations:['Best quote is not all available pools or programs','Quotes are not executable atomic routes or proof of outsider profit','Pool account owner alone does not prove custody or PDA-signed outflow'],
    noTransaction:true,rows,owners};
  const file=path.join(dir,batch2?'major-direct-route-discovery-batch2.json':'major-direct-route-discovery.json');
  fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({pairs:pairs.length,quotes:rows.length,
    routes:rows.map(x=>({pair:x.input+'→'+x.output,slot:x.contextSlot,
      label:x.route[0]?.label||null,ammKey:x.route[0]?.ammKey||null,
      owner:owners[x.route[0]?.ammKey]?.owner||null,error:x.error})),output:file}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
