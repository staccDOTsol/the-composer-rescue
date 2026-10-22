#!/usr/bin/env node
// Read-only decode of queued curve-update buffers for live Hadron USDC pools.
const fs=require('fs');const path=require('path');
const {Connection,PublicKey}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron,decodeCurveUpdates}=require('./hadron-sdk/package/dist/index.js');
const census=require('./hadron-current-census.json');
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!row)throw Error('SOLANA_RPC missing');
const rpc=new Connection(row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,''),'confirmed');
const cast=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof PublicKey?v.toBase58():v));
async function main(){
  const selected=census.pools.filter(p=>p.state===1&&(p.mintX===USDC||p.mintY===USDC)&&BigInt(p.usdcRaw)>=100000000n)
    .sort((a,b)=>BigInt(a.usdcRaw)>BigInt(b.usdcRaw)?-1:1).slice(0,18);
  const rows=[];
  for(const p of selected){
    const h=await Hadron.load(rpc,new PublicKey(p.id));
    const ai=await rpc.getAccountInfoAndContext(h.addresses.curveUpdates,'confirmed');
    let decoded=null,error=null;
    try{decoded=ai.value?cast(decodeCurveUpdates(ai.value.data)):null}catch(e){error=e.message}
    rows.push({pool:p.id,mintX:p.mintX,mintY:p.mintY,usdcRaw:p.usdcRaw,slot:ai.context.slot,address:h.addresses.curveUpdates.toBase58(),decoded,error});
  }
  const out={observedAtUtc:new Date().toISOString(),genesis:await rpc.getGenesisHash(),noTransactions:true,rows};
  fs.writeFileSync(path.join(__dirname,'hadron-pending-curve-updates.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(rows.map(r=>({pool:r.pool,slot:r.slot,numOps:r.decoded?.numOps,sequence:r.decoded?.sequence,error:r.error})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
