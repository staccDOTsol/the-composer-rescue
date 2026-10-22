#!/usr/bin/env node
// Read-only inspection of a recent successful current-Locp outgoing claim.
const fs=require('fs'); const path=require('path');
const DIR=__dirname; const LOC='LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
const signature='BeY3h8qqvFbRAEwanYgErNitdYTCu7PHzi3SkzC6geCWc5Q5cgv5fw6Ad5WpHVhUXGQsTR73JAaoBXeuA6Sn7Ao';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split('\n')
  .filter(s=>s.includes('=')).map(s=>s.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL;
let id=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result;}
async function main(){
 const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
 const keys=tx.transaction.message.accountKeys;
 const locIxs=tx.transaction.message.instructions.map((ix,i)=>({...ix,index:i})).filter(ix=>ix.programId===LOC);
 const current=await rpc('getMultipleAccounts',[[
  '52dwNzfWa2MmHEUTJWTbKdjXpgiRG8kPiqWe7JZBJFv5',
  'CFmVuKiy6xtyKtk123ebA2Yw8PRGxC43rTdYvL7k4y7d',
  'EyWdqQmTf4TkarGDcHorw2m2RL32obzuoE5J4coTGL1Y',LOC],
  {encoding:'base64',commitment:'confirmed'}]);
 const names=['escrow','vault','destination','program'];
 const result={signature,slot:tx.slot,blockTime:tx.blockTime,success:tx.meta.err===null,
  accountKeys:keys, topInstructions:tx.transaction.message.instructions,
  locIxs, recentBlockhash:tx.transaction.message.recentBlockhash,
  tokenPre:tx.meta.preTokenBalances,tokenPost:tx.meta.postTokenBalances,
  logMessages:tx.meta.logMessages,
  currentSlot:current.context.slot,current:Object.fromEntries(names.map((n,i)=>[n,current.value[i]]))};
 fs.writeFileSync(path.join(DIR,'locp-claim-control.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({signature,slot:tx.slot,currentSlot:current.context.slot,
  locIxs:locIxs.map(ix=>({index:ix.index,accounts:ix.accounts,data:ix.data})),
  current:names.map((n,i)=>({name:n,owner:current.value[i]?.owner,executable:current.value[i]?.executable,
    dataLength:current.value[i]?.data?.[0]?Buffer.from(current.value[i].data[0],'base64').length:null})),
  logTail:tx.meta.logMessages.slice(-15)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
