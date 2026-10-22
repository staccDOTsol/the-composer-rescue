#!/usr/bin/env node
'use strict';
// Read-only Jupiter direct-route screen; chained exact outputs and independent exit owners.
const fs=require('fs');
const mints={WSOL:'So11111111111111111111111111111111111111112',USDC:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',cbBTC:'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'};
const pools={WSOL:'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',cbBTC:'9NkuAWB4LgCVFV77omEkJEjXqgV5PGupwMTu3B3pBRhc'};
const decimals={WSOL:9,USDC:6,cbBTC:8};
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
async function quote(input,output,amount,filter){
 const p=new URLSearchParams({inputMint:mints[input],outputMint:mints[output],amount:String(amount),slippageBps:'50',onlyDirectRoutes:'true',...filter});
 const r=await fetch('https://lite-api.jup.ag/swap/v1/quote?'+p,{signal:AbortSignal.timeout(15000)});const b=await r.json();
 return {http:r.status,input,output,inAmount:String(amount),outAmount:b.outAmount||null,contextSlot:b.contextSlot||null,error:b.error||null,
  route:(b.routePlan||[]).map(x=>({ammKey:x.swapInfo?.ammKey,label:x.swapInfo?.label,percent:x.percent}))};
}
async function main(){
 const genesis=await rpc('getGenesisHash');if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong genesis');
 const tests=[
  ['WSOL','WSOL','100000000','wsol-small'],['WSOL','WSOL','100000000000','wsol-100'],['WSOL','WSOL','10000000000000','wsol-10000'],
  ['WSOL','USDC','100000000','usdc-100'],['WSOL','USDC','100000000000','usdc-100000'],['WSOL','USDC','1000000000000','usdc-1000000'],
  ['cbBTC','USDC','10000000000','cbbtc-10000'],['cbBTC','USDC','100000000000','cbbtc-100000'],
  ['cbBTC','cbBTC','10000000','cbbtc-0.1'],['cbBTC','cbBTC','100000000','cbbtc-1']
 ];
 const out={observedAt:new Date().toISOString(),genesis,method:'ExactIn onlyDirectRoutes. Tessera leg forced by dexes=TesseraV and checked against target pool; other leg excludeDexes=TesseraV and owner checked by RPC. Chained exact output, quote-only; no atomic execution claim.',rows:[],exitOwners:{}};
 for(const [pair,initial,amount,label] of tests){
  const intermediate=initial==='USDC'?pair:'USDC';const firstIsTessera=initial==='USDC';
  const first=await quote(initial,intermediate,amount,firstIsTessera?{dexes:'TesseraV'}:{excludeDexes:'TesseraV'});
  let second=null,reason=null;
  if(!first.outAmount)reason=`first quote ${first.http} ${first.error}`;
  else if(firstIsTessera&&first.route.length!==1||firstIsTessera&&first.route[0]?.ammKey!==pools[pair])reason='first Tessera pool mismatch';
  else if(!firstIsTessera&&first.route.some(x=>x.ammKey===pools[pair]||x.label==='TesseraV'))reason='first independent route contains Tessera';
  if(!reason){
   second=await quote(intermediate,initial,first.outAmount,firstIsTessera?{excludeDexes:'TesseraV'}:{dexes:'TesseraV'});
   if(!second.outAmount)reason=`second quote ${second.http} ${second.error}`;
   else if(!firstIsTessera&&(second.route.length!==1||second.route[0]?.ammKey!==pools[pair]))reason='second Tessera pool mismatch';
   else if(firstIsTessera&&second.route.some(x=>x.ammKey===pools[pair]||x.label==='TesseraV'))reason='second independent route contains Tessera';
  }
  const netRaw=!reason?(BigInt(second.outAmount)-BigInt(amount)).toString():null;
  out.rows.push({pair,initial,label,first,second,reason,netRaw,netToken:netRaw===null?null:Number(netRaw)/10**decimals[initial]});
  await new Promise(r=>setTimeout(r,150));
 }
 const keys=[...new Set(out.rows.flatMap(r=>[r.first,r.second].filter(Boolean).flatMap(q=>q.route.map(x=>x.ammKey))).filter(Boolean))];
 if(keys.length){const a=await rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);keys.forEach((k,i)=>{out.exitOwners[k]=a.value[i]?.owner||null});out.ownerSlot=a.context.slot;}
 fs.writeFileSync(`${__dirname}/tessera-current-exit-quotes.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({ownerSlot:out.ownerSlot,rows:out.rows.map(x=>({label:x.label,pair:x.pair,initial:x.initial,reason:x.reason,netToken:x.netToken,slots:[x.first.contextSlot,x.second?.contextSlot],routes:[x.first.route,x.second?.route]}))},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
