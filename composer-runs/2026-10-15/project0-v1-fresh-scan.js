#!/usr/bin/env node
// Read-only search for recently successful P0 borrow/swap/repay/end controls.
const fs=require('fs');
const RPC_URL=process.env.RPC_URL||process.env.SOLANA_RPC;
if(!RPC_URL)throw Error('RPC URL required');
const PROGRAM='MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const limit=Number(process.env.SCAN_LIMIT||500);
let id=0;
async function rpc(method,params){for(let n=0;n<3;n++){try{const r=await fetch(RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result}catch(e){if(n===2)throw e;await new Promise(r=>setTimeout(r,250*(n+1)))}}}
function names(logs){return (logs||[]).map(x=>/^Program log: Instruction: (.+)$/.exec(x)?.[1]).filter(Boolean)}
async function main(){let sigs=[],before;while(sigs.length<limit){const rows=await rpc('getSignaturesForAddress',[PROGRAM,{limit:Math.min(1000,limit-sigs.length),...(before?{before}:{})}]);if(!rows.length)break;sigs.push(...rows.filter(x=>!x.err));before=rows.at(-1).signature;if(rows.length<Math.min(1000,limit-sigs.length))break}
 const candidates=[];for(let k=0;k<sigs.length;k+=12){const txs=await Promise.all(sigs.slice(k,k+12).map(async row=>({row,tx:await rpc('getTransaction',[row.signature,{encoding:'base64',maxSupportedTransactionVersion:1}])})));for(const {row,tx} of txs){if(!tx||tx.meta?.err)continue;const n=names(tx.meta.logMessages);if(['LendingAccountStartFlashloan','LendingAccountBorrow','LendingAccountRepay','LendingAccountEndFlashloan'].every(x=>n.includes(x))&&n.some(x=>/Swap|Trade/i.test(x))){candidates.push({signature:row.signature,slot:row.slot,sourceBytes:Buffer.from(tx.transaction[0],'base64').length,instructions:n,wire:tx.transaction[0]})}}if(candidates.length>=12)break}
 const simulated=[];for(const c of candidates){const result=await rpc('simulateTransaction',[c.wire,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed'}]);simulated.push({signature:c.signature,sourceSlot:c.slot,sourceBytes:c.sourceBytes,instructions:c.instructions,err:result.value.err,unitsConsumed:result.value.unitsConsumed,currentSlot:result.context?.slot,logs:result.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('failed')||x.includes('Error')).slice(-12)});if(!result.value.err)break}
 const out={generatedAt:new Date().toISOString(),signaturesExamined:sigs.length,candidateCount:candidates.length,candidates:simulated};const path=__dirname+'/project0-v1-fresh-scan.json';fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({path,signaturesExamined:out.signaturesExamined,candidateCount:out.candidateCount,candidates:simulated.map(x=>({signature:x.signature,sourceSlot:x.sourceSlot,sourceBytes:x.sourceBytes,err:x.err,unitsConsumed:x.unitsConsumed,instructions:x.instructions}))},null,2));}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
