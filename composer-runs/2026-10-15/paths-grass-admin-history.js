#!/usr/bin/env node
// Bounded read-only history for the configured GRASS staking admin address.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const bs58=require(path.join(__dirname,'kliquidity-sdk-official/node_modules/bs58'));
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const ADMIN='31rYartQwHeBMjAe2MgGpffGV57fQY3kug4BDN8tLGqQ';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
let seq=0;
async function rpc(method,params){const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const j=await r.json();
  if(!r.ok||j.error)throw new Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;}
async function batch(sigs){const calls=sigs.map(s=>({jsonrpc:'2.0',id:++seq,method:'getTransaction',
  params:[s.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]}));
  let last;for(let attempt=0;attempt<6;attempt++){try{
    const r=await fetch(env.RPC_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(calls)});
    if(r.status===429||r.status>=500)throw new Error(`retryable HTTP ${r.status}`);
    const j=await r.json();if(!r.ok||!Array.isArray(j))throw new Error(`batch: ${JSON.stringify(j).slice(0,300)}`);
    const m=new Map(j.map(x=>[x.id,x.result||null]));return calls.map(x=>m.get(x.id));
  }catch(e){last=e;if(attempt<5)await new Promise(ok=>setTimeout(ok,400*2**attempt));}}
  throw last;}
const names=['initialize_global_config','initialize_reward_pool','initialize_staking_pool',
  'staking_pool_change_router','adjust_global_config','fund_reward_pool','lock_reward_pool',
  'lock_staking_pool','drain_reward_pool','drain_staking_pool','stake_tokens','unstake_tokens',
  'claim_rewards','withdraw'];
const byDisc=Object.fromEntries(names.map(n=>[crypto.createHash('sha256').update(`global:${n}`).digest('hex').slice(0,16),n]));
async function main(){
  const cache=path.join(DIR,'paths-grass-admin-signature-index.json');
  const sigs=fs.existsSync(cache)?JSON.parse(fs.readFileSync(cache)):[];let before;
  for(let page=0;!sigs.length&&page<20;page++){
    const opts={limit:1000,commitment:'confirmed'};if(before)opts.before=before;
    const chunk=await rpc('getSignaturesForAddress',[ADMIN,opts]);
    if(!chunk.length)break;
    sigs.push(...chunk);before=chunk.at(-1).signature;
    process.stdout.write(`signature page ${page+1}: ${sigs.length}, oldest ${chunk.at(-1).blockTime}\n`);
    if(chunk.at(-1).blockTime<1728926772)break;
  }
  fs.writeFileSync(path.join(DIR,'paths-grass-admin-signature-index.json'),JSON.stringify(sigs)+'\n');
  const examined=sigs.slice(-1881);
  const result={program:PROGRAM,adminAddress:ADMIN,generatedAt:new Date().toISOString(),
    sampledSignatures:sigs.length,newestTime:sigs[0]?.blockTime,oldestTime:sigs.at(-1)?.blockTime,
    examinedSignatureCount:examined.length,examinedNewestTime:examined[0]?.blockTime,
    examinedOldestTime:examined.at(-1)?.blockTime,
    transactionsFetched:0,missingTransactions:0,programInstructions:[],errors:[]};
  for(let i=0;i<examined.length;i+=40){const chunk=examined.slice(i,i+40);let txs;
    try{txs=await batch(chunk);}catch(e){result.errors.push({batchStart:i,error:String(e)});continue;}
    for(let j=0;j<chunk.length;j++){const tx=txs[j],s=chunk[j];if(!tx){result.missingTransactions++;continue;}
      result.transactionsFetched++;const msg=tx.transaction.message,h=msg.header,
        keys=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
      for(const [ixNo,ix] of msg.instructions.entries()){
        if(keys[ix.programIdIndex]!==PROGRAM)continue;
        const data=Buffer.from(bs58.decode(ix.data)),disc=data.subarray(0,8).toString('hex');
        result.programInstructions.push({signature:s.signature,slot:tx.slot,blockTime:s.blockTime,
          error:tx.meta.err,instructionIndex:ixNo,name:byDisc[disc]||null,discriminator:disc,
          dataHex:data.toString('hex'),accounts:ix.accounts.map((idx,pos)=>({position:pos,key:keys[idx],
            signer:idx<h.numRequiredSignatures})),logs:tx.meta.logMessages?.filter(x=>x.includes('Instruction:')||x.includes('Error')),
          inner:(tx.meta.innerInstructions||[]).find(g=>g.index===ixNo)?.instructions.map(z=>({
            program:keys[z.programIdIndex],accounts:z.accounts?.map(k=>keys[k]),
            dataHex:z.data?Buffer.from(bs58.decode(z.data)).toString('hex'):null,stackHeight:z.stackHeight}))});
      }
      for(const group of tx.meta.innerInstructions||[]){
        for(const [innerNo,ix] of group.instructions.entries()){
          if(keys[ix.programIdIndex]!==PROGRAM)continue;
          const data=Buffer.from(bs58.decode(ix.data)),disc=data.subarray(0,8).toString('hex');
          result.programInstructions.push({signature:s.signature,slot:tx.slot,blockTime:s.blockTime,
            error:tx.meta.err,instructionIndex:group.index,innerIndex:innerNo,
            topLevelProgram:keys[msg.instructions[group.index].programIdIndex],
            name:byDisc[disc]||null,discriminator:disc,dataHex:data.toString('hex'),
            accounts:ix.accounts.map((idx,pos)=>({position:pos,key:keys[idx],
              signer:idx<h.numRequiredSignatures})),
            logs:tx.meta.logMessages?.filter(x=>x.includes('Instruction:')||x.includes('Error'))});
        }
      }
    }
    if(i%200===0)process.stdout.write(`inspected ${i+chunk.length}, matches ${result.programInstructions.length}\n`);
    await new Promise(ok=>setTimeout(ok,100));
  }
  fs.writeFileSync(path.join(DIR,'paths-grass-admin-history.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({sampledSignatures:result.sampledSignatures,
    transactionsFetched:result.transactionsFetched,missingTransactions:result.missingTransactions,
    programInstructions:result.programInstructions.length,
    byName:Object.fromEntries([...new Set(result.programInstructions.map(x=>x.name))]
      .map(n=>[n,result.programInstructions.filter(x=>x.name===n).length])),errors:result.errors},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
