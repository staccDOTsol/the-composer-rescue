#!/usr/bin/env node
// Read-only mainnet census of current program-owned account discriminators.
const fs=require('fs');
const path=require('path');
const envText=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const rpcUrl=envText.split(/\r?\n/).map(line=>line.trim()).find(line=>line.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');
if(!rpcUrl?.startsWith('https://'))throw new Error('RPC unavailable');
(async()=>{
 const body={jsonrpc:'2.0',id:1,method:'getProgramAccounts',params:['yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA',{encoding:'base64',withContext:true,dataSlice:{offset:0,length:8},commitment:'confirmed'}]};
 const res=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const json=await res.json();
 if(!res.ok||json.error)throw new Error(json.error?.message||String(res.status));
 const counts={}; const examples={};
 for(const row of json.result.value){
  const key=`${row.account.space}:${Buffer.from(row.account.data[0],'base64').toString('hex')}`;
  counts[key]=(counts[key]||0)+1;
  (examples[key]??=[]);if(examples[key].length<3) examples[key].push(row.pubkey);
 }
 const output={observedAt:new Date().toISOString(),slot:json.result.context.slot,program:'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA',total:json.result.value.length,counts,examples};
 const file=path.join(__dirname,'yolov-economics-type-census.json');fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output));
})().catch(e=>{console.error(e.message);process.exitCode=1});
