#!/usr/bin/env node
// Read-only census of all 188-byte SKR GuardianDelegationPool accounts.
const fs=require('fs');
const path=require('path');
const {PublicKey}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const PROGRAM='SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG='4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
 if(!r.ok||j.error)throw Error(JSON.stringify(j.error||r.status));return j.result;}
const pk=b=>new PublicKey(b).toBase58();
const u128=(b,at)=>b.readBigUInt64LE(at)+(b.readBigUInt64LE(at+8)<<64n);
async function main(){
 const r=await rpc('getProgramAccounts',[PROGRAM,{encoding:'base64',commitment:'confirmed',withContext:true,
  filters:[{dataSize:188}]}]);
 const rows=r.value.map(x=>{const b=Buffer.from(x.account.data[0],'base64');return {
  address:x.pubkey,discriminator:b.subarray(0,8).toString('hex'),stakeConfig:pk(b.subarray(8,40)),
  guardian:pk(b.subarray(40,72)),authority:pk(b.subarray(72,104)),totalShares:u128(b,104).toString(),
  accruedCommission:u128(b,152).toString(),commissionBps:b.readUInt16LE(168),active:!!b[171]};});
 const selected=rows.filter(x=>x.discriminator==='85eeffd6d70bbd17'&&x.stakeConfig===CONFIG);
 const out={generatedAt:new Date().toISOString(),slot:r.context.slot,noTransactionsSubmitted:true,
  all188ByteAccounts:rows.length,matchingGuardianPools:selected.length,
  sumShares:selected.reduce((a,x)=>a+BigInt(x.totalShares),0n).toString(),
  sumAccruedCommission:selected.reduce((a,x)=>a+BigInt(x.accruedCommission),0n).toString(),
  nonzeroAccrual:selected.filter(x=>BigInt(x.accruedCommission)>0n),
  nonzeroShares:selected.filter(x=>BigInt(x.totalShares)>0n),rows:selected};
 fs.writeFileSync(path.join(__dirname,'guardian-census.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({...out,rows:undefined},null,2));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
