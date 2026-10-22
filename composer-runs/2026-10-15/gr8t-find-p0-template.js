#!/usr/bin/env node
const fs=require('fs');
const env=fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/).find(x=>x.startsWith('RPC_URL='));
const url=process.env.RPC_URL || env?.slice(8);
if(!url)throw Error('RPC URL unavailable');
let id=0;
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result}
const bank='H6bfRmfZPoxDDs8eoVBgouTPowwyv7opfBbHd5KUmuUz';
const program='MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const borrow='047e74353005d41f', repay='4fd1acb1de33ad97';
(async()=>{
 const sigs=await rpc('getSignaturesForAddress',[bank,{limit:1000,commitment:'confirmed'}]);
 for(let i=0;i<sigs.length;i+=50){
  const rows=await Promise.all(sigs.slice(i,i+50).map(s=>rpc('getTransaction',[s.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}])));
  for(let j=0;j<rows.length;j++){const tx=rows[j];if(!tx)continue;const keys=tx.transaction.message.accountKeys.map(x=>typeof x==='string'?x:x.pubkey);for(const ix of tx.transaction.message.instructions){if(ix.programId!==program||!ix.data)continue;const data=Buffer.from((require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58').default||require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58')).decode(ix.data));const d=data.subarray(0,8).toString('hex');if((d===borrow||d===repay)&&ix.accounts.map(a=>typeof a==='number'?keys[a]:a).includes(bank)){console.log(JSON.stringify({signature:sigs[i+j].signature,slot:tx.slot,disc:d,accounts:ix.accounts.map(a=>typeof a==='number'?keys[a]:a),dataHex:data.toString('hex')}));return}}
  }
 }
 console.log(JSON.stringify({found:false,scanned:sigs.length}));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
