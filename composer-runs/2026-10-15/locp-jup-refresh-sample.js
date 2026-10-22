#!/usr/bin/env node
// Read-only capture of an authentic refresh for the selected zero-fee JUP reserve.
const fs=require('fs'),path=require('path');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split('\n')
 .filter(s=>s.includes('=')).map(s=>s.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL,reserve='4AFAGAm5G8fkcKy7QerL88E7BiSE22ZRbvJzvaKjayor';
let id=0;async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;}
async function main(){const sigs=await rpc('getSignaturesForAddress',[reserve,{limit:100,commitment:'confirmed'}]);
 let hit=null,inspected=0;
 for(const row of sigs.filter(s=>!s.err)){
  const tx=await rpc('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);inspected++;
  if(!tx||tx.meta?.err)continue;const m=tx.transaction.message;
  const keys=[...m.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
  const index=m.instructions.findIndex(ix=>keys[ix.programIdIndex]==='KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'&&
   keys[ix.accounts[0]]===reserve&&Buffer.from(bs58.decode(ix.data)).subarray(0,8).toString('hex')==='02da8aeb4fc91966');
  if(index>=0){hit={signature:row.signature,slot:tx.slot,index,transaction:tx,
    accounts:m.instructions[index].accounts.map(i=>keys[i])};break;}
 }
 const out={generatedAt:new Date().toISOString(),reserve,historyCount:sigs.length,inspected,
  noTransactionsSubmitted:true,hit};
 fs.writeFileSync(path.join(__dirname,'locp-jup-refresh-sample.json'),JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({historyCount:sigs.length,inspected,signature:hit?.signature,
  slot:hit?.slot,accounts:hit?.accounts}));}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
