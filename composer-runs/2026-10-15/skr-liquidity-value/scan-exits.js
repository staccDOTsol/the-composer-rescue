#!/usr/bin/env node
// Read-only bounded search for a successful vault-debit token CPI.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8')
  .split(/\r?\n/).filter((x)=>x.startsWith('RPC_URL='))
  .map((x)=>['RPC_URL',x.slice('RPC_URL='.length)]));
const endpoint=env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL missing');
const vault='8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const config='4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const program='SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
async function rpc(method,params) {
  const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(!res.ok)throw new Error(`${method} HTTP ${res.status}`);
  const body=await res.json();
  if(body.error)throw new Error(`${method} ${body.error.message}`);
  return body.result;
}
function outbound(tx){
  const hits=[];
  for(const group of tx.meta?.innerInstructions||[]){
    let parentProgram=tx.transaction.message.instructions[group.index]?.programId;
    for(const ix of group.instructions){
      if(ix.stackHeight===2)parentProgram=tx.transaction.message.instructions[group.index]?.programId;
      const p=ix.parsed;
      if(ix.programId==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&
          (p?.type==='transfer'||p?.type==='transferChecked')&&p.info?.source===vault){
        hits.push({outerIndex:group.index,outerProgram:tx.transaction.message.instructions[group.index]?.programId,
          immediateParent:parentProgram,stackHeight:ix.stackHeight,type:p.type,info:p.info});
      }
      if(ix.stackHeight===2&&ix.programId!== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        parentProgram=ix.programId;
    }
  }
  return hits;
}
async function main(){
  const signatures=await rpc('getSignaturesForAddress',[vault,{limit:1000,commitment:'confirmed'}]);
  const successful=signatures.filter((x)=>x.err===null);
  const output={generatedAt:new Date().toISOString(),scope:'newest 1000 signatures for vault',
    total:signatures.length,successful:successful.length,
    newest:signatures[0],oldest:signatures.at(-1),checked:0,errors:[],outgoing:[]};
  const candidates=successful.slice(0,Math.min(successful.length,400));
  const batchSize=12;
  for(let i=0;i<candidates.length;i+=batchSize){
    const batch=candidates.slice(i,i+batchSize);
    const txs=await Promise.allSettled(batch.map((x)=>rpc('getTransaction',[x.signature,
      {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}])));
    for(let j=0;j<txs.length;j++){
      const result=txs[j];const sig=batch[j];
      if(result.status==='rejected'){output.errors.push({signature:sig.signature,error:result.reason.message});continue;}
      output.checked++;
      if(!result.value)continue;
      for(const hit of outbound(result.value)){
        const finding={signature:sig.signature,slot:sig.slot,blockTime:sig.blockTime,...hit,
          topLevelInstructions:result.value.transaction.message.instructions,
          innerGroup:result.value.meta.innerInstructions.find((g)=>g.index===hit.outerIndex)?.instructions,
          preTokenBalances:result.value.meta.preTokenBalances,
          postTokenBalances:result.value.meta.postTokenBalances};
        output.outgoing.push(finding);
      }
    }
    if(output.outgoing.length)break;
  }
  fs.writeFileSync(path.join(__dirname,'exit-search.json'),JSON.stringify(output,null,2)+'\n');
  process.stdout.write(JSON.stringify({total:output.total,successful:output.successful,checked:output.checked,
    newest:output.newest?.slot,oldest:output.oldest?.slot,errors:output.errors.length,
    outgoing:output.outgoing.map(({signature,slot,immediateParent,outerProgram,info})=>({signature,slot,immediateParent,outerProgram,info}))},null,2)+'\n');
}
main().catch((e)=>{process.stderr.write(`${e.stack||e.message}\n`);process.exitCode=1});
