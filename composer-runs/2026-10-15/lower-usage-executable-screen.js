#!/usr/bin/env node
// Check current executable status for the bounded $100k-$1m top-holder lane.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey}=require(modules+'@solana/web3.js');
const source=require('./mainnet-token-authority-flash-crosswalk.json');
const candidates=source.targets.filter(x=>x.sampledGrossUsd>=100_000&&x.sampledGrossUsd<1_000_000);
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;
let id=0;
async function rpc(method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
async function main(){
 const ids=candidates.map(x=>x.programId);
 const live=await rpc('getMultipleAccounts',[ids,{encoding:'base64',commitment:'finalized'}]);
 const rows=candidates.map((c,i)=>{
  const a=live.value[i],data=a?Buffer.from(a.data[0],'base64'):null;
  const programdata=a?.executable&&data?.length===36&&data.readUInt32LE(0)===2
   ?new PublicKey(data.subarray(4,36)).toBase58():null;
  return {programId:c.programId,sampledGrossUsd:c.sampledGrossUsd,
   assets:c.assets.map(x=>({mint:x.mint,symbols:x.symbols,sampledCustodyUsd:x.sampledCustodyUsd})),
   currentExecutable:!!a?.executable,owner:a?.owner||null,
   programdata,accountLength:data?.length||null};
 });
 const dataIds=rows.filter(x=>x.programdata).map(x=>x.programdata);
 const pd=await rpc('getMultipleAccounts',[dataIds,{encoding:'base64',commitment:'finalized'}]);
 let i=0;for(const row of rows)if(row.programdata){
  const a=pd.value[i++],d=a?Buffer.from(a.data[0],'base64'):null;
  row.lastDeploySlot=d?.length>=12&&d.readUInt32LE(0)===3?Number(d.readBigUInt64LE(4)):null;
 }
 const out={generatedAt:new Date().toISOString(),slot:live.context.slot,
  method:'Top-20 of verified mints; direct program-owned authority state; current finalized executable check. USD spot marks are selection signals only.',
  candidateCount:rows.length,executableCount:rows.filter(x=>x.currentExecutable).length,rows};
 fs.writeFileSync(__dirname+'/lower-usage-executable-screen.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({slot:out.slot,candidates:out.candidateCount,executable:out.executableCount,
  highInterest:rows.filter(x=>x.currentExecutable&&x.assets.some(a=>
   a.symbols.some(s=>/USD|SOL|BTC|ETH|CASH|RIV|BORG|RUSH|ROAM|SBR|MPLX/i.test(s))))
   .slice(0,35).map(x=>({programId:x.programId,usd:Math.round(x.sampledGrossUsd),
    symbols:x.assets.map(a=>a.symbols[0]).slice(0,5),lastDeploySlot:x.lastDeploySlot}))}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
