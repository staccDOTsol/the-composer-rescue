#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const dir=__dirname;
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const targets={xo:'C64AAGzJxsFwzQZaS1t8Yis5UCVTTAchTwG2QZj1kSRi',
  dnl:'DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4'};
let seq=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const v=await r.json();
  if(v.error)throw Error(method+': '+v.error.message);return v.result;}
async function main(){const rows=[];for(const [label,id] of Object.entries(targets)){
  const program=new PublicKey(id),base=PublicKey.findProgramAddressSync([],program)[0];
  const address=(await PublicKey.createWithSeed(base,'anchor:idl',program)).toBase58();
  const a=await rpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);
  const row={label,programId:id,idlAddress:address,slot:a.context.slot,exists:!!a.value};
  if(a.value){try{const b=Buffer.from(a.value.data[0],'base64');const n=b.readUInt32LE(40);
    const idl=JSON.parse(zlib.inflateSync(b.subarray(44,44+n)).toString('utf8'));
    row.name=idl.name;row.instructions=(idl.instructions||[]).map(x=>({name:x.name,
      accountCount:x.accounts?.length||0,args:x.args?.map(a=>a.name)||[]}));
    fs.writeFileSync(path.join(dir,`unreviewed-${label}-onchain-idl.json`),JSON.stringify(idl,null,2)+'\n');
  }catch(e){row.decodeError=String(e)}}rows.push(row);
}fs.writeFileSync(path.join(dir,'unreviewed-controller-idl-gate.json'),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify(rows.map(x=>({label:x.label,exists:x.exists,name:x.name,
  instructions:x.instructions?.map(i=>i.name)||[],decodeError:x.decodeError}))))}
main().catch(e=>{console.error(e.message);process.exitCode=1});
