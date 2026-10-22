#!/usr/bin/env node
// Read-only Drift SpotMarket mint filter (Anchor discriminator and IDL mint offset 72).
const fs=require('fs'),crypto=require('crypto');
const bs58Module=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const obj=await res.json();if(obj.error)throw Error(`${method}: ${obj.error.code} ${obj.error.message}`);return obj.result}
async function main(){
 const program='dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';
 const idl=JSON.parse(fs.readFileSync(`${__dirname}/drift-source/sdk/src/idl/drift.json`));
 const market=idl.accounts.find(x=>x.name==='SpotMarket');
 if(!market||market.type.fields[2].name!=='mint')throw Error('SpotMarket IDL layout changed');
 const discriminator=bs58.encode(crypto.createHash('sha256').update('account:SpotMarket').digest().subarray(0,8));
 const info=await rpc('getAccountInfo',[program,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
 const out={observedAt:new Date().toISOString(),readOnly:true,program,programOwner:info.value?.owner,executable:info.value?.executable,mintOffset:72,rows:[]};
 for(const mint of ['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH','USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']){
  const r=await rpc('getProgramAccounts',[program,{encoding:'base64',commitment:'confirmed',withContext:true,
   filters:[{memcmp:{offset:0,bytes:discriminator}},{memcmp:{offset:72,bytes:mint}}],dataSlice:{offset:0,length:0}}]);
  out.rows.push({mint,slot:r.context.slot,spotMarkets:r.value.map(x=>({address:x.pubkey,owner:x.account.owner,space:x.account.space}))});
 }
 const path=`${__dirname}/chnry-usdg-daybreak-provider-drift-scan.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({path,rows:out.rows}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
