#!/usr/bin/env node
// Read-only current mainnet ProgramData fetch; never submits a transaction.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const program='Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const url=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
async function main(){
 const p=await rpc('getAccountInfo',[program,{encoding:'base64',commitment:'finalized'}]);
 const pb=Buffer.from(p.value.data[0],'base64');if(pb.readUInt32LE(0)!==2)throw Error('not upgradeable program');
 const pdAddr=new PublicKey(pb.subarray(4,36)).toBase58();
 const d=await rpc('getAccountInfo',[pdAddr,{encoding:'base64',commitment:'finalized'}]);
 const db=Buffer.from(d.value.data[0],'base64');if(db.readUInt32LE(0)!==3)throw Error('not ProgramData');
 const elf=db.subarray(45);if(elf.subarray(0,4).toString('hex')!=='7f454c46')throw Error('not ELF');
 const meta={fetchedAt:new Date().toISOString(),program,programDataAddress:pdAddr,
  programSlot:p.context.slot,programDataSlot:d.context.slot,upgradeSlot:Number(db.readBigUInt64LE(4)),
  upgradeAuthority:db[12]===1?new PublicKey(db.subarray(13,45)).toBase58():null,
  elfLength:elf.length,elfSha256:crypto.createHash('sha256').update(elf).digest('hex')};
 fs.writeFileSync(path.join(__dirname,'archer-current.so'),elf);
 fs.writeFileSync(path.join(__dirname,'archer-current-binary.json'),JSON.stringify(meta,null,2)+'\n');
 console.log(JSON.stringify(meta));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
