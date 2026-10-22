#!/usr/bin/env node
'use strict';
// Read-only fetch of Anchor IDL account, if published.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR=__dirname, PROGRAM='5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
async function main(){
  const programId=new PublicKey(PROGRAM);
  const base=PublicKey.findProgramAddressSync([],programId)[0];
  const address=(await PublicKey.createWithSeed(base,'anchor:idl',programId)).toBase58();
  const result=await rpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);
  if(!result.value){const out={slot:result.context.slot,idlAddress:address,exists:false};fs.writeFileSync(path.join(DIR,'5uums-idl-status.json'),JSON.stringify(out,null,2)+'\n');console.log(out);return;}
  const b=Buffer.from(result.value.data[0],'base64');
  const authority=new PublicKey(b.subarray(8,40)).toBase58();
  const len=b.readUInt32LE(40);
  const compressed=b.subarray(44,44+len);
  const idl=JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
  const out={slot:result.context.slot,idlAddress:address,exists:true,owner:result.value.owner,authority,accountLength:b.length,compressedLength:len,idlName:idl.name,idlVersion:idl.version};
  fs.writeFileSync(path.join(DIR,'5uums-idl-status.json'),JSON.stringify(out,null,2)+'\n');
  fs.writeFileSync(path.join(DIR,'5uums-idl.json'),JSON.stringify(idl,null,2)+'\n');
  console.log(out);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
