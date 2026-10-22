#!/usr/bin/env node
// Read-only Mango v4 Bank mint scan. Official IDL: Bank = 8-byte discriminator,
// 32-byte group, 16-byte name, then 32-byte mint at offset 56.
const fs=require('fs'),crypto=require('crypto');
const bs58Module=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
let id=0;async function rpc(method,params){const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const obj=await res.json();if(obj.error)throw Error(`${method}: ${obj.error.code} ${obj.error.message}`);return obj.result}
async function main(){
 const program='4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg';
 const idl=JSON.parse(fs.readFileSync(`${__dirname}/chnry-usdg-daybreak-provider-mango-official-idl.json`));
 if(!idl.accounts.some(x=>x.name==='Bank'&&x.type.fields[2].name==='mint'))throw Error('IDL Bank layout changed');
 const d=bs58.encode(crypto.createHash('sha256').update('account:Bank').digest().subarray(0,8));
 const programInfo=await rpc('getAccountInfo',[program,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
 const out={observedAt:new Date().toISOString(),readOnly:true,program,programIdentity:{owner:programInfo.value?.owner,executable:programInfo.value?.executable},bankMintOffset:56,rows:[]};
 for(const mint of ['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH','USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v']){
  const result=await rpc('getProgramAccounts',[program,{encoding:'base64',commitment:'confirmed',withContext:true,
   filters:[{memcmp:{offset:0,bytes:d}},{memcmp:{offset:56,bytes:mint}}],dataSlice:{offset:0,length:128}}]);
  out.rows.push({mint,slot:result.context.slot,banks:result.value.map(x=>({address:x.pubkey,owner:x.account.owner,space:x.account.space}))});
 }
 const path=`${__dirname}/chnry-usdg-daybreak-provider-mango-scan.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({path,identity:out.programIdentity,rows:out.rows}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
