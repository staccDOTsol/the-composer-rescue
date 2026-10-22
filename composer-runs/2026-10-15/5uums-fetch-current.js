#!/usr/bin/env node
'use strict';
// Read-only fetch of exact deployed bytes, executable and ProgramData metadata.
// No transaction submission RPC is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR = __dirname;
const PROGRAM = '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const RPC = env.RPC_URL;
async function rpc(method, params) {
  const res = await fetch(RPC, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method} ${JSON.stringify(json.error)}`);
  return json.result;
}
function decode(a) { return Buffer.from(a.data[0], 'base64'); }
const pubkey = b => new PublicKey(b).toBase58();
async function main() {
  const p = await rpc('getAccountInfo',[PROGRAM,{encoding:'base64',commitment:'confirmed'}]);
  if (!p.value) throw new Error('program account absent');
  const pbuf = decode(p.value);
  if (pbuf.readUInt32LE(0) !== 2) throw new Error('not upgradeable Program state');
  const programDataAddress = pubkey(pbuf.subarray(4,36));
  const d = await rpc('getAccountInfo',[programDataAddress,{encoding:'base64',commitment:'confirmed'}]);
  if (!d.value) throw new Error('ProgramData absent');
  const dbuf = decode(d.value);
  if (dbuf.readUInt32LE(0) !== 3) throw new Error('not ProgramData state');
  const elf = dbuf.subarray(45);
  if (elf.subarray(0,4).toString('hex') !== '7f454c46') throw new Error('no ELF at ProgramData metadata offset 45');
  const file = path.join(DIR,'5uums-current.so');
  fs.writeFileSync(file,elf);
  const metadata = {
    fetchedAt:new Date().toISOString(),program:PROGRAM,
    programAccount:{slot:p.context.slot,owner:p.value.owner,executable:p.value.executable,lamports:p.value.lamports,dataLength:pbuf.length,tag:pbuf.readUInt32LE(0)},
    programDataAddress, programDataAccount:{slot:d.context.slot,owner:d.value.owner,executable:d.value.executable,lamports:d.value.lamports,dataLength:dbuf.length,tag:dbuf.readUInt32LE(0),upgradeSlot:Number(dbuf.readBigUInt64LE(4)),upgradeAuthority:dbuf[12]===1?pubkey(dbuf.subarray(13,45)):null},
    elf:{length:elf.length,sha256:crypto.createHash('sha256').update(elf).digest('hex'),magic:elf.subarray(0,4).toString('hex')}
  };
  fs.writeFileSync(path.join(DIR,'5uums-current-binary.json'),JSON.stringify(metadata,null,2)+'\n');
  process.stdout.write(JSON.stringify(metadata,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
