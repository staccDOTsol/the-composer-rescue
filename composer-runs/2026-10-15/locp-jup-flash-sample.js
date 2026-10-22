#!/usr/bin/env node
// Read-only lookup of a successful JUP KLend flash pair to avoid guessing market authority.
const fs=require('fs'),path=require('path');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split('\n')
  .filter(s=>s.includes('=')).map(s=>s.split(/=(.*)/s).slice(0,2)));
const url=env.RPC_URL,klend='KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const candidates=require('./locp-klend-reserve-candidates.json').rows.find(r=>r.symbol==='JUP').reserves;
let id=0;
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(`${method}: ${j.error.code} ${j.error.message}`);return j.result;}
async function main(){
 const searched=[];let hit=null;
 for(const reserve of candidates){
  const sigs=await rpc('getSignaturesForAddress',[reserve.reserve,{limit:80,commitment:'confirmed'}]);
  const clean=sigs.filter(s=>!s.err);let inspected=0;
  for(const sig of clean.slice(0,50)){
   const tx=await rpc('getTransaction',[sig.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
   inspected++;if(!tx || tx.meta?.err)continue;
   const m=tx.transaction.message;
   const keys=[...m.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
   const ixs=m.instructions.map((ix,index)=>({index,program:keys[ix.programIdIndex],
     disc:Buffer.from(bs58.decode(ix.data)).subarray(0,8).toString('hex'),
     accounts:ix.accounts.map(k=>keys[k])}));
   const borrow=ixs.find(ix=>ix.program===klend&&ix.accounts[3]===reserve.reserve&&
     ix.disc==='87e734a70734d4c1');
   const repay=ixs.find(ix=>ix.program===klend&&ix.accounts[3]===reserve.reserve&&
     ix.disc==='b97500cb60f5b4ba');
   if(borrow&&repay){hit={reserve,signature:sig.signature,slot:tx.slot,
     transaction:tx,borrow,repay};break;}
  }
  searched.push({reserve:reserve.reserve,recentHistory:sigs.length,successful:clean.length,inspected});
  console.log(JSON.stringify({reserve:reserve.reserve,successful:clean.length,inspected,hit:!!hit}));
  if(hit)break;
 }
 const out={generatedAt:new Date().toISOString(),noTransactionsSubmitted:true,searched,hit};
 fs.writeFileSync(path.join(__dirname,'locp-jup-flash-sample.json'),JSON.stringify(out,null,2)+'\n');
 if(hit)console.log(JSON.stringify({signature:hit.signature,slot:hit.slot,reserve:hit.reserve.reserve,
   borrowAccounts:hit.borrow.accounts,repayAccounts:hit.repay.accounts}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
