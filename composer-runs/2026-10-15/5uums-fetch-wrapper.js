#!/usr/bin/env node
'use strict';
// Read-only fetch of immediate caller program seen on successful bridge exits.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR=__dirname,PROGRAM='3LWzkFMDYNaVMZfRLeMLifaAr8AHQYE5hgDT51Hj8Kpu';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
const pk=b=>new PublicKey(b).toBase58();
async function main(){const p=await rpc('getAccountInfo',[PROGRAM,{encoding:'base64',commitment:'confirmed'}]);const pb=Buffer.from(p.value.data[0],'base64');const pdaddr=pk(pb.subarray(4,36));const d=await rpc('getAccountInfo',[pdaddr,{encoding:'base64',commitment:'confirmed'}]);const db=Buffer.from(d.value.data[0],'base64');const elf=db.subarray(45);if(elf.subarray(0,4).toString('hex')!=='7f454c46')throw Error('ELF magic missing');const out={fetchedAt:new Date().toISOString(),program:PROGRAM,programSlot:p.context.slot,programDataAddress:pdaddr,programDataSlot:d.context.slot,upgradeSlot:Number(db.readBigUInt64LE(4)),upgradeAuthority:db[12]?pk(db.subarray(13,45)):null,elfLength:elf.length,elfSha256:crypto.createHash('sha256').update(elf).digest('hex')};fs.writeFileSync(path.join(DIR,'5uums-wrapper.so'),elf);fs.writeFileSync(path.join(DIR,'5uums-wrapper.json'),JSON.stringify(out,null,2)+'\n');console.log(out);}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
