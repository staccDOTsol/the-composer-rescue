#!/usr/bin/env node
// Read-only top token-account census for the Chancery USDG and USDv mints.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/)
  .filter(s => s && !s.startsWith('#') && s.includes('='))
  .map(s => s.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw new Error('missing RPC URL');
let id = 0;
async function rpc(method, params) {
  const res = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const obj = await res.json();
  if (obj.error) throw new Error(`${method}: ${obj.error.code} ${obj.error.message}`);
  return obj.result;
}
async function main() {
  const mints = [
    '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
    'USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk',
  ];
  const out = {observedAt:new Date().toISOString(),readOnly:true,rows:[]};
  for (const mint of mints) {
    const top = await rpc('getTokenLargestAccounts',[mint,{commitment:'confirmed'}]);
    const addresses = top.value.map(x=>x.address);
    const accountInfos = await rpc('getMultipleAccounts',[addresses,{encoding:'jsonParsed',commitment:'confirmed'}]);
    const owners = [...new Set(accountInfos.value.map(x=>x?.data?.parsed?.info?.owner).filter(Boolean))];
    const ownerInfos = await rpc('getMultipleAccounts',[owners,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:0}}]);
    const ownerMap = new Map(owners.map((x,i)=>[x,ownerInfos.value[i] &&
      {accountOwnerProgram:ownerInfos.value[i].owner,executable:ownerInfos.value[i].executable,
        dataBytes:ownerInfos.value[i].space,lamports:ownerInfos.value[i].lamports}]));
    out.rows.push({mint,slot:top.context.slot,accounts:top.value.map((x,i)=>{
      const info = accountInfos.value[i]?.data?.parsed?.info;
      return {address:x.address,rawAmount:x.amount,uiAmount:x.uiAmountString,
        tokenProgram:accountInfos.value[i]?.owner,owner:info?.owner,
        ownerInfo:ownerMap.get(info?.owner)||null};
    })});
  }
  const output=path.join(__dirname,'chnry-usdg-daybreak-provider-token-top.json');
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({output,summary:out.rows.map(r=>({mint:r.mint,slot:r.slot,accounts:r.accounts.map(a=>({amount:a.uiAmount,owner:a.owner,ownerProgram:a.ownerInfo?.accountOwnerProgram,tokenAccount:a.address}))}))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
