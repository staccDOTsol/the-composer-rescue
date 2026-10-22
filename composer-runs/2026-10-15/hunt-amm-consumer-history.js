// Read-only recent-pool caller census; no transactions are submitted.
const fs = require('fs');
const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL required');
const pool = process.argv[2] || '9tXiuRRw7kbejLhZXtxDxYs2REe43uH2e7k1kocgdM9B';
const limit = Number(process.argv[3] || 120);
const outPath = process.argv[4] || 'composer-runs/2026-10-15/amm-consumer-history.json';
async function rpc(method, params) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(RPC, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0', id:1, method, params})});
    const body = await r.json();
    if (!body.error) return body.result;
    if (a === 5) throw Error(JSON.stringify(body.error));
    await new Promise(res => setTimeout(res, 250 * (a + 1)));
  }
}
function instructionTouches(ix, keys, pool) {
  const indices = ix.accounts || [];
  return indices.some(i => keys[i] === pool);
}
async function main() {
  const sigs = await rpc('getSignaturesForAddress', [pool, {limit, commitment:'confirmed'}]);
  const entries=[];
  for (let i=0; i<sigs.length; i+=10) {
    const batch=sigs.slice(i,i+10);
    const txs=await Promise.all(batch.map(s=>rpc('getTransaction',[s.signature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]).catch(()=>null)));
    for(let j=0;j<txs.length;j++) {
      const tx=txs[j]; if(!tx||tx.meta?.err) continue;
      const msg=tx.transaction.message;
      const keys=[...msg.accountKeys.map(k=>typeof k==='string'?k:k.pubkey),...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
      const top=(msg.instructions||[]).map((ix,ixNo)=>({ixNo,program:keys[ix.programIdIndex]||ix.programId,touchesPool:instructionTouches(ix,keys,pool)}));
      const inner=(tx.meta.innerInstructions||[]).flatMap(g=>(g.instructions||[]).map(ix=>({parentIx:g.index,program:keys[ix.programIdIndex]||ix.programId,touchesPool:instructionTouches(ix,keys,pool),stackHeight:ix.stackHeight||null})));
      entries.push({signature:batch[j].signature,slot:tx.slot,top,inner});
    }
  }
  const counts=new Map();
  for(const e of entries) for(const ix of [...e.top,...e.inner]) if(ix.touchesPool) {
    const row=counts.get(ix.program)||{program:ix.program,total:0,top:0,inner:0,examples:[]};
    row.total++; if('ixNo' in ix) row.top++; else row.inner++;
    if(row.examples.length<3&&!row.examples.includes(e.signature)) row.examples.push(e.signature);
    counts.set(ix.program,row);
  }
  const out={observedAt:new Date().toISOString(),pool,requested:limit,returned:sigs.length,successfulTransactions:entries.length,poolTouchingPrograms:[...counts.values()].sort((a,b)=>b.total-a.total),entries};
  fs.writeFileSync(outPath,JSON.stringify(out,null,2));
  console.log(JSON.stringify({pool,returned:sigs.length,read:entries.length,touching:out.poolTouchingPrograms}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
