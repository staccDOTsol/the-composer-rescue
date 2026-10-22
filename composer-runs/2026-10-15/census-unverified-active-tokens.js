#!/usr/bin/env node
// Read-only top-holder scan of currently traded mints absent from Jupiter's
// verified registry. Values are gross marks, not executable proceeds.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const dir = __dirname;
const out = path.join(dir, 'unverified-active-token-controller-census.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint = env.HEAVY_RPC_URL;
if (!endpoint) throw Error('missing RPC endpoint');
const base = 'https://lite-api.jup.ag/tokens/v2/';
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function getJson(url) { const r=await fetch(url); if(!r.ok) throw Error(`HTTP ${r.status}`); const v=await r.json(); if(!Array.isArray(v)) throw Error(`unexpected ${url}`); return v; }
async function rpcBatch(calls) {
  let last;
  for(let i=0;i<5;i++) try {
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(calls.map((c,id)=>({jsonrpc:'2.0',id,...c})))});
    if(!r.ok) throw Error(`RPC HTTP ${r.status}`);
    const rows=await r.json(); if(!Array.isArray(rows)) throw Error('RPC batch response');
    const map=new Map(rows.map(x=>[x.id,x])); return calls.map((_,id)=>map.get(id));
  } catch(e) { last=e; await delay(500*2**i); }
  throw last;
}
async function rpc(method,params) { const [r]=await rpcBatch([{method,params}]); if(!r||r.error) throw Error(`${method} ${JSON.stringify(r?.error)}`); return r.result; }
function chunks(xs,n){const o=[];for(let i=0;i<xs.length;i+=n)o.push(xs.slice(i,i+n));return o;}
function pkey(bytes){return new PublicKey(bytes).toBase58();}
async function accounts(keys,length=72) {
 const out=new Map(), slots=[];
 for(const batch of chunks(keys,100)){
   const r=await rpc('getMultipleAccounts',[batch,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length}}]);
   slots.push(r.context.slot);batch.forEach((k,i)=>out.set(k,r.value[i])); await delay(70);
 }
 return {out,slots};
}
async function main(){
 const verified=await getJson(base+'tag?query=verified'); const old=new Set(verified.map(x=>x.id));
 const intervals=['5m','1h','6h','24h']; const byMint=new Map(), intervalRows={};
 for(const interval of intervals){ const rows=await getJson(base+`toptraded/${interval}?limit=100`); intervalRows[interval]=rows.length;
   rows.forEach((x,rank)=>{if(old.has(x.id))return;const p=byMint.get(x.id)||{...x,windows:[]};p.windows.push({interval,rank:rank+1});byMint.set(x.id,p);}); }
 const mints=[...byMint.values()];
 const largest=new Map();
 for(const batch of chunks(mints,40)){
   const rs=await rpcBatch(batch.map(x=>({method:'getTokenLargestAccounts',params:[x.id,{commitment:'confirmed'}]})));
   batch.forEach((x,i)=>largest.set(x.id,rs[i]?.result||{error:rs[i]?.error}));await delay(90);
 }
 const tokenAddresses=[...new Set(mints.flatMap(x=>(largest.get(x.id)?.value||[]).map(y=>y.address)))];
 const tokenRead=await accounts(tokenAddresses,72);
 const rows=[];
 for(const x of mints)for(const a of largest.get(x.id)?.value||[]){
   const info=tokenRead.out.get(a.address);if(!info)continue;const d=Buffer.from(info.data[0],'base64');if(d.length<72)continue;
   const mint=pkey(d.subarray(0,32));if(mint!==x.id)continue;const authority=pkey(d.subarray(32,64));const amount=d.readBigUInt64LE(64).toString();
   const price=Number.isFinite(x.usdPrice)&&x.usdPrice>0?x.usdPrice:null;
   rows.push({address:a.address,mint,tokenProgram:info.owner,authority,rawAmount:amount,uiAmount:Number(amount)/10**x.decimals,
     symbol:x.symbol,usdPrice:price,usdMark:price===null?null:Number(amount)/10**x.decimals*price,
     mintLiquidityUsd:x.liquidity??null,mintHolderCount:x.holderCount??null,windows:x.windows,
     largestReadSlot:largest.get(x.id).context?.slot??null});
 }
 const off=[...new Set(rows.map(x=>x.authority).filter(x=>!PublicKey.isOnCurve(new PublicKey(x).toBytes())))];
 const authRead=await accounts(off,0);
 const ownerKeys=[...new Set(off.map(x=>authRead.out.get(x)?.owner).filter(Boolean))]; const ownerRead=await accounts(ownerKeys,0);
 const oldPrograms=new Set(JSON.parse(fs.readFileSync(path.join(dir,'mainnet-token-authority-census.raw.json'),'utf8')).programsByDirectStateAuthority.map(x=>x.programId));
 const grouped=new Map();
 for(const row of rows){ const a=authRead.out.get(row.authority);if(!a)continue;const owner=a.owner;const program=ownerRead.out.get(owner);if(!program?.executable)continue;
   const g=grouped.get(owner)||{programId:owner,priorVerifiedCensusController:oldPrograms.has(owner),grossUsd:0,vaults:[],authorities:new Set()};
   g.grossUsd+=row.usdMark||0;g.authorities.add(row.authority);g.vaults.push({...row,authorityAccountOwner:owner});grouped.set(owner,g);
 }
 const controllers=[...grouped.values()].map(x=>({...x,authorities:[...x.authorities],vaults:x.vaults.sort((a,b)=>(b.usdMark||0)-(a.usdMark||0))})).sort((a,b)=>b.grossUsd-a.grossUsd);
 const output={generatedAt:new Date().toISOString(),source:'Jupiter Token V2 toptraded 5m/1h/6h/24h at read time; Solana read-only RPC top 20 token accounts per mint',intervalRows,verifiedMintCount:verified.length,uniqueUnverifiedTradedMintCount:mints.length,queriedTokenAccountCount:tokenAddresses.length,liveMintBoundTokenAccountCount:rows.length,offcurveAuthorityCount:off.length,contextSlotRange:{min:Math.min(...[...tokenRead.slots,...authRead.slots,...ownerRead.slots]),max:Math.max(...[...tokenRead.slots,...authRead.slots,...ownerRead.slots])},mints:mints.map(x=>({id:x.id,symbol:x.symbol,decimals:x.decimals,usdPrice:x.usdPrice,liquidity:x.liquidity,windows:x.windows})),controllers,limitations:['top 100 per interval only','top 20 token accounts per mint only','price times balance, not executable proceeds','direct authority state ownership is not signer proof','receipt tokens may double count underlying']};
 fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({output:out,unverifiedMints:mints.length,tokenAccounts:rows.length,controllers:controllers.length,newControllers:controllers.filter(x=>!x.priorVerifiedCensusController).length,topNew:controllers.filter(x=>!x.priorVerifiedCensusController).slice(0,15).map(x=>({programId:x.programId,grossUsd:x.grossUsd,topVault:x.vaults[0]}))}));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
