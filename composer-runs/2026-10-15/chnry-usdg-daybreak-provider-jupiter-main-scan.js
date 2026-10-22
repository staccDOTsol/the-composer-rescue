#!/usr/bin/env node
// Read-only canonical TokenReserve mint-filter scan across Jupiter Lend liquidity deployments.
const fs=require('fs');
const bs58Module=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\r?\n/)
  .filter(x=>x && !x.startsWith('#') && x.includes('='))
  .map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
if(!endpoint)throw new Error('missing RPC');
let id=0;
async function rpc(method,params){const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const body=await response.json();if(body.error)throw Error(`${method}: ${body.error.code} ${body.error.message}`);return body.result;}
async function main(){
 const mints=['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH','USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk'];
 const programs=['jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC','jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS'];
 const out={observedAt:new Date().toISOString(),readOnly:true,mints,rows:[]};
 for(const mint of mints) for(const program of programs){
  const result=await rpc('getProgramAccounts',[program,{encoding:'base64',commitment:'confirmed',withContext:true,
   filters:[{memcmp:{offset:0,bytes:bs58.encode(Buffer.from([21,18,59,135,120,20,31,12]))}},{memcmp:{offset:8,bytes:mint}}],dataSlice:{offset:0,length:160}}]);
  const positions=await rpc('getProgramAccounts',[program,{encoding:'base64',commitment:'confirmed',withContext:true,
   filters:[{memcmp:{offset:0,bytes:bs58.encode(Buffer.from([73,126,65,123,220,126,197,24]))}},{memcmp:{offset:40,bytes:mint}}],dataSlice:{offset:0,length:160}}]);
  out.rows.push({mint,program,slot:result.context.slot,positionSlot:positions.context.slot,
   reserves:result.value.map(x=>({address:x.pubkey,owner:x.account.owner,space:x.account.space,dataPrefixBase64:x.account.data[0]})),
   positions:positions.value.map(x=>({address:x.pubkey,owner:x.account.owner,space:x.account.space,dataPrefixBase64:x.account.data[0]}))});
 }
 const path=`${__dirname}/chnry-usdg-daybreak-provider-jupiter-main-scan.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({path,summary:out.rows.map(x=>({mint:x.mint,program:x.program,slot:x.slot,reserves:x.reserves.map(y=>y.address),positions:x.positions.map(y=>y.address)}))}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
