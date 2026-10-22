#!/usr/bin/env node
'use strict';
// Read-only live state snapshot and canonical PDA tests.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR=__dirname,PROGRAM='5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/).filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(!r.ok)throw Error(`${method} HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
const pk=b=>new PublicKey(b).toBase58();
async function main(){
  const addresses=['Cst5bqk7QJAj1tR7qH9eiYnT7ygDEashKYTFvV1obRGK','5okKWzQ6ox3p6qVCGe8b99n5QeecHkv2q5BKXMpNYKQi','FppzwTMvRH9X6a3vRq6KnUYGtA6xGZUELS8yqsZJty6N','5XXejrbDVQifMfE4xbcFmBxSVndS1FYhmvoGFc78TMJp','12eeLK7yJXpm7x7PUQVgReEeECm4Y4fNhzQhwbBMTXKn'];
  const r=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
  const accounts=Object.fromEntries(addresses.map((a,i)=>{const x=r.value[i],b=x?Buffer.from(x.data[0],'base64'):null;return[a,x?{owner:x.owner,lamports:x.lamports,executable:x.executable,dataLength:b.length,dataHex:b.toString('hex'),sha256:crypto.createHash('sha256').update(b).digest('hex')}:null]}));
  const names=['DeadlockBridgeInfo','Bridge','BridgeInfo','GlobalState','State'];
  const discriminators=Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update('account:'+n).digest('hex').slice(0,16)]));
  const seeds=['bridge','bridge_signer','to_signer','bridgeto_signer','bridge_info','deadlock_bridge'];
  const p=new PublicKey(PROGRAM),pdas=Object.fromEntries(seeds.map(s=>{const [x,b]=PublicKey.findProgramAddressSync([Buffer.from(s)],p);return[s,{address:x.toBase58(),bump:b}]}));
  const out={observedSlot:r.context.slot,accounts,discriminators,pdas};
  fs.writeFileSync(path.join(DIR,'5uums-state.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({...out,accounts:Object.fromEntries(Object.entries(accounts).map(([k,v])=>[k,v?{...v,dataHex:v.dataHex.slice(0,384)}:null]))},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
