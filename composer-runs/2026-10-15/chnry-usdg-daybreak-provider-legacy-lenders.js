#!/usr/bin/env node
// Read-only SPL-lending-style reserve scans for Port and Larix.
const fs=require('fs');
const bs58Module=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const obj=await res.json();if(obj.error)throw Error(`${method}: ${obj.error.code} ${obj.error.message}`);return obj.result}
async function main(){
 const programs=[{name:'Port Finance variable-rate lending',id:'Port7uDYB3wk6GJAw4KT1WpTeMtSu9bTcChBHkX2LfR'},
  {name:'Larix lending',id:'7Zb1bGi32pfsrBkzWdqd4dFhUXwp5Nybr1zuaEwN34hy'}];
 const mints=['2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH','USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'];
 const out={observedAt:new Date().toISOString(),readOnly:true,note:'Mint offset 42 is the SPL Token Lending Reserve liquidity mint offset; positive USDC controls determine whether this layout applies. A zero without a positive control is not an exhaustive exclusion.',rows:[]};
 for(const program of programs){
  const info=await rpc('getAccountInfo',[program.id,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
  const all=await rpc('getProgramAccounts',[program.id,{encoding:'base64',commitment:'confirmed',withContext:true,dataSlice:{offset:0,length:0}}]);
  const sizes={};for(const a of all.value)sizes[a.account.space]=(sizes[a.account.space]||0)+1;
  const marketSize=program.name.startsWith('Port')?258:418;
  const markets=all.value.filter(x=>x.account.space===marketSize).map(x=>x.pubkey);
  // Port packs the token program after version, bump and two pubkeys (66).
  // Larix adds pending_owner and quote_currency before it (98).
  const tokenProgramOffset=program.name.startsWith('Port')?66:98;
  const marketInfos=await rpc('getMultipleAccounts',[markets,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:tokenProgramOffset,length:32}}]);
  const row={name:program.name,program:program.id,programOwner:info.value?.owner,executable:info.value?.executable,slot:all.context.slot,ownedAccountCount:all.value.length,accountSizes:sizes,
   marketTokenProgramOffset:tokenProgramOffset,marketTokenPrograms:markets.map((address,i)=>({address,tokenProgram:marketInfos.value[i]?.data?.[0]?bs58.encode(Buffer.from(marketInfos.value[i].data[0],'base64')):null})),mintOffset42:[]};
  for(const mint of mints){const result=await rpc('getProgramAccounts',[program.id,{encoding:'base64',commitment:'confirmed',withContext:true,filters:[{memcmp:{offset:42,bytes:mint}}],dataSlice:{offset:0,length:0}}]);
   row.mintOffset42.push({mint,slot:result.context.slot,accounts:result.value.map(x=>({address:x.pubkey,space:x.account.space,owner:x.account.owner}))});}
  out.rows.push(row);
 }
 const path=`${__dirname}/chnry-usdg-daybreak-provider-legacy-lenders.json`;
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({path,rows:out.rows},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
