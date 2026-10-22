#!/usr/bin/env node
// Read-only exact-authority stake queries from a private and Solana public RPC.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const PRIVATE_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!PRIVATE_URL) throw Error('Set HEAVY_RPC_URL or RPC_URL');
const PUBLIC_URL = 'https://api.mainnet-beta.solana.com';
const STAKE = 'Stake11111111111111111111111111111111111111';
const AUTHORITIES = [
  'FE1zyw2MBBKumtnuBxuAeXGn4Zeh5CdHqWkzPCUN29Nm',
  '9j7f4Y6MqauTRm9RRJwzQeMkqZ8GS3FsXF7hs4nD6ugA',
];
const OUT = path.join(__dirname, 'two-native-stake-groups-live-recheck.json');

async function rpc(url, method, params) {
  let last;
  for (let retry = 0; retry < 4; retry++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 120000);
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:ctl.signal });
      const body = await response.json();
      clearTimeout(timer);
      if (!response.ok || body.error) throw Error(JSON.stringify(body.error || {status:response.status}));
      return body.result;
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 500*(2**retry)));
    }
  }
  throw last;
}
function decode(row) {
  const bytes = Buffer.from(row.account.data[0], 'base64');
  const stateKind = bytes.readUInt32LE(0);
  return {
    address: row.pubkey,
    lamports: String(row.account.lamports),
    stateKind,
    staker: new PublicKey(bytes.subarray(12,44)).toBase58(),
    withdrawer: new PublicKey(bytes.subarray(44,76)).toBase58(),
    voter: stateKind === 2 ? new PublicKey(bytes.subarray(124,156)).toBase58() : null,
  };
}
const summary = rows => ({
  count: rows.length,
  delegatedCount: rows.filter(x=>x.stateKind===2).length,
  lamports: rows.reduce((acc,x)=>acc+BigInt(x.lamports),0n).toString(),
  stakers: [...new Set(rows.map(x=>x.staker))],
  voterCount: new Set(rows.map(x=>x.voter).filter(Boolean)).size,
});

(async () => {
  const groups=[];
  for (const authority of AUTHORITIES) {
    const privateQuery = await rpc(PRIVATE_URL,'getProgramAccounts',[STAKE,{ commitment:'finalized', encoding:'base64', withContext:true, filters:[{dataSize:200},{memcmp:{offset:44,bytes:authority}}] }]);
    const rows=privateQuery.value.map(decode).filter(x=>x.withdrawer===authority).sort((a,b)=>BigInt(a.lamports)>BigInt(b.lamports)?-1:1);
    const omitted=privateQuery.value.length-rows.length;
    const pub=[];
    for(let offset=0;offset<rows.length;offset+=100){
      const batch=rows.slice(offset,offset+100);
      const result=await rpc(PUBLIC_URL,'getMultipleAccounts',[batch.map(x=>x.address),{commitment:'finalized',encoding:'base64'}]);
      for(let i=0;i<batch.length;i++){
        const x=result.value[i];
        if(x){const d=decode({pubkey:batch[i].address,account:x});pub.push({address:d.address,lamports:d.lamports,owner:x.owner,withdrawer:d.withdrawer,stateKind:d.stateKind});}
        else pub.push({address:batch[i].address,missing:true});
      }
    }
    const publicSum=pub.reduce((acc,x)=>acc+BigInt(x.lamports||0),0n);
    const privateSum=BigInt(summary(rows).lamports);
    const authorityInfo=await rpc(PRIVATE_URL,'getAccountInfo',[authority,{encoding:'base64',commitment:'finalized'}]);
    groups.push({authority,privateSlot:privateQuery.context.slot,privateExactAuthorityRows:rows.length,wrongAuthorityRowsOmitted:omitted,
      private:summary(rows),public:{queriedRows:pub.length,foundRows:pub.filter(x=>!x.missing).length,lamports:publicSum.toString(),matchingBalance:publicSum===privateSum,
        mismatchAddresses:pub.filter((x,i)=>x.missing||x.lamports!==rows[i].lamports||x.withdrawer!==authority||x.owner!==STAKE).map(x=>x.address)},
      authorityAccount:authorityInfo.value?{owner:authorityInfo.value.owner,lamports:String(authorityInfo.value.lamports),dataBytes:Buffer.from(authorityInfo.value.data[0],'base64').length}:null,
      accounts:rows,
    });
    fs.writeFileSync(OUT,JSON.stringify({generatedAt:new Date().toISOString(),commitment:'finalized',methods:['getProgramAccounts','getMultipleAccounts','getAccountInfo'],privateProvider:'configured private RPC (URL and key omitted)',publicProvider:PUBLIC_URL,groups},null,2)+'\n');
    console.log(JSON.stringify({authority,slot:privateQuery.context.slot,count:rows.length,lamports:privateSum.toString(),publicSum:String(publicSum),publicMismatch:groups.at(-1).public.mismatchAddresses.length,stakers:summary(rows).stakers}));
  }
})().catch(error=>{ console.error(error.message);process.exitCode=1; });
