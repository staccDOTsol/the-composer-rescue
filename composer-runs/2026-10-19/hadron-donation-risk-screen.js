#!/usr/bin/env node
// Read-only SDK math screen for unsolicited vault-donation inventory effects.
const fs=require('fs');const path=require('path');
const {Connection,PublicKey}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {Hadron}=require('./hadron-sdk/package/dist/index.js');
const env=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!env)throw Error('SOLANA_RPC missing');
const rpc=new Connection(env.slice(env.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,''),'confirmed');
const targets=[
  {label:'DGLD',pool:'rQsUkcKpia3v3VykWVNZWALuYehNZSTTjDa7qJ3oxWs'},
  {label:'USDC-USDT',pool:'GPHRA3MJGT4ERmsq3sgt9Mcf3WVdG81oJia7yuLZ6ixU'},
];
const fractionsPpm=[0,100,1000,10000,50000,100000,250000,500000,1000000,2000000,5000000,10000000];
const explicitDonationRaw=[1n,10n,100n,1000n,10000n,100000n];
const cast=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v instanceof PublicKey?v.toBase58():v));
async function token(pk){const x=await rpc.getTokenAccountBalance(pk,'confirmed');return{slot:x.context.slot,raw:BigInt(x.value.amount),decimals:x.value.decimals}}
async function main(){
  const rows=[];
  for(const t of targets){
    const h=await Hadron.load(rpc,new PublicKey(t.pool));
    const [x,y]=await Promise.all([token(h.addresses.vaultX),token(h.addresses.vaultY)]);
    const scenarios=[];
    for(const side of ['x','y'])for(const raw of explicitDonationRaw){
      const dx=side==='x'?raw:0n,dy=side==='y'?raw:0n;
      let risk,error=null;
      try{risk=cast(h.getInventoryRiskFactors(x.raw+dx,y.raw+dy))}catch(e){error=e.message}
      scenarios.push({donationSide:side,donationFractionPpm:null,donationRaw:raw.toString(),risk,error});
    }
    for(const side of ['x','y'])for(const ppm of fractionsPpm){
      const dx=side==='x'?x.raw*BigInt(ppm)/1000000n:0n;
      const dy=side==='y'?y.raw*BigInt(ppm)/1000000n:0n;
      let risk,error=null;
      try{risk=cast(h.getInventoryRiskFactors(x.raw+dx,y.raw+dy))}catch(e){error=e.message}
      scenarios.push({donationSide:side,donationFractionPpm:ppm,donationRaw:(dx+dy).toString(),risk,error});
    }
    rows.push({label:t.label,pool:t.pool,slot:Math.max(x.slot,y.slot),vaultX:{address:h.addresses.vaultX.toBase58(),raw:x.raw.toString(),decimals:x.decimals},vaultY:{address:h.addresses.vaultY.toBase58(),raw:y.raw.toString(),decimals:y.decimals},midprice:h.getMidprice(),spreadBps:h.getSpreadBps(),fee:cast(h.resolveFee()),activeCurves:cast(h.getActiveCurves()),scenarios});
  }
  const out={observedAtUtc:new Date().toISOString(),genesis:await rpc.getGenesisHash(),noTransactions:true,method:'Official SDK getInventoryRiskFactors over current raw vault balances plus hypothetical unsolicited donation; no state mutation',rows};
  fs.writeFileSync(path.join(__dirname,'hadron-donation-risk-screen.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(rows.map(r=>({label:r.label,slot:r.slot,vaultX:r.vaultX,vaultY:r.vaultY,baseline:r.scenarios.filter(s=>s.donationFractionPpm===0).slice(0,1)[0].risk,extremes:r.scenarios.filter(s=>[1000000,10000000].includes(s.donationFractionPpm)).map(s=>({side:s.donationSide,ppm:s.donationFractionPpm,risk:s.risk}))})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
