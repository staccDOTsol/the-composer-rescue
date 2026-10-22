#!/usr/bin/env node
'use strict';
const fs=require('fs');
const crypto=require('crypto');
const bs58Module=require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58=bs58Module.default||bs58Module;
const program='TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH';
const addresses={
  program,
  authority:'8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF',
  cbBtcPool:'9NkuAWB4LgCVFV77omEkJEjXqgV5PGupwMTu3B3pBRhc',
  wsolPool:'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n',
  cbBtcVault:'37hggNyT4Ec8GEcxMLrWrZyrMSSFMSiFT6VBayRYceZH',
  usdcVault:'9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx',
  wsolVault:'5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV'
};
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!row)throw Error('SOLANA_RPC missing');
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){
  for(let attempt=0;attempt<4;attempt++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
    const body=await response.json();
    if(response.ok&&!body.error)return body.result;
    if(attempt===3)throw Error(`${method}: ${body.error?.message||response.status}`);
    await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
}
function accountSummary(address,a){
  if(!a)return null;
  const b=Buffer.from(a.data[0],'base64');
  const out={address,owner:a.owner,executable:a.executable,lamports:a.lamports,dataLen:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};
  if(a.owner==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&b.length>=165){
    out.mint=bs58.encode(b.subarray(0,32));out.tokenAuthority=bs58.encode(b.subarray(32,64));out.tokenAmount=b.readBigUInt64LE(64).toString();
  }
  if(address===program&&b.length>=36){out.programdata=bs58.encode(b.subarray(4,36));}
  if(address===out.programdata){}
  return out;
}
async function main(){
  const genesis=await rpc('getGenesisHash');
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('wrong genesis');
  const keys=Object.values(addresses);
  const batch=await rpc('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed'}]);
  const accounts=Object.fromEntries(Object.keys(addresses).map((name,i)=>[name,accountSummary(keys[i],batch.value[i])]));
  const programdata=accounts.program.programdata;
  const pda=(await rpc('getAccountInfo',[programdata,{encoding:'base64',commitment:'confirmed'}])).value;
  const bytes=Buffer.from(pda.data[0],'base64');
  const authority=bytes[12]===1?bs58.encode(bytes.subarray(13,45)):null;
  accounts.programdata={address:programdata,owner:pda.owner,executable:pda.executable,lamports:pda.lamports,dataLen:bytes.length,lastDeploySlot:Number(bytes.readBigUInt64LE(4)),upgradeAuthority:authority,binaryBytes:bytes.length-45,binarySha256:crypto.createHash('sha256').update(bytes.subarray(45)).digest('hex')};
  const signatures=await rpc('getSignaturesForAddress',[program,{limit:100,commitment:'confirmed'}]);
  const out={observedAt:new Date().toISOString(),genesis,slot:batch.context.slot,addresses,accounts,signatures:signatures.map(x=>({signature:x.signature,slot:x.slot,err:x.err,blockTime:x.blockTime}))};
  fs.writeFileSync(`${__dirname}/tessera-current-census.json`,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot:out.slot,binary:accounts.programdata,balances:Object.fromEntries(['cbBtcVault','usdcVault','wsolVault'].map(n=>[n,accounts[n].tokenAmount])),latestSignatures:signatures.slice(0,3)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
