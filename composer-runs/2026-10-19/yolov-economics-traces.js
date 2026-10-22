#!/usr/bin/env node
// Read-only, bounded mainnet receipt collection for YOLO economics.
const fs = require('fs');
const path = require('path');
const bs58m = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58m.default || bs58m;
const program = 'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA';
const outPath = path.join(__dirname, 'yolov-economics-traces.json');
const envText = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8');
const rpcUrl = envText.split(/\r?\n/).map(line => line.trim())
  .find(line => line.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length)
  .trim().replace(/^['"]|['"]$/g,'');
if (!rpcUrl?.startsWith('https://')) throw new Error('SOLANA_RPC_URL unavailable');
const limit = Math.min(Math.max(Number(process.argv[2] || 48),1),100);

async function rpc(method, params) {
  for (let attempt=0;attempt<8;attempt++) {
    let response, body;
    try {
      response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
      body=await response.json();
    } catch(error) { if(attempt===7) throw error; }
    if(response?.ok && !body.error) return body.result;
    if(attempt===7) throw new Error(`${method}: ${body?.error?.message || response?.status || 'network'}`);
    await new Promise(resolve=>setTimeout(resolve,Math.min(500*(2**attempt),6000)));
  }
}
function delta(a,b){return (BigInt(a||'0')-BigInt(b||'0')).toString();}
function instruction(ix,keys,index,stack) {
  const data=ix.data||null;
  let discriminator=null;
  if(data) discriminator=Buffer.from(bs58.decode(data)).subarray(0,8).toString('hex');
  return {index,stack,discriminator,data,accounts:ix.accounts||[],
    signerAccounts:(ix.accounts||[]).filter(pubkey=>keys.find(key=>key.pubkey===pubkey)?.signer)};
}
function summarize(tx, signature) {
  const keys=tx.transaction.message.accountKeys.map(key=>typeof key==='string'?{pubkey:key,signer:false,writable:false}:key);
  const ixs=[];
  tx.transaction.message.instructions.forEach((ix,index)=>{if(ix.programId===program)ixs.push(instruction(ix,keys,index,1));});
  (tx.meta.innerInstructions||[]).forEach(group=>group.instructions.forEach(ix=>{if(ix.programId===program)ixs.push(instruction(ix,keys,group.index,ix.stackHeight||2));}));
  const before=new Map((tx.meta.preTokenBalances||[]).map(b=>[b.accountIndex,b]));
  const after=new Map((tx.meta.postTokenBalances||[]).map(b=>[b.accountIndex,b]));
  const tokens=[...new Set([...before.keys(),...after.keys()])].map(index=>{
    const a=after.get(index),b=before.get(index),x=a||b;
    return {account:keys[index]?.pubkey,owner:x.owner,mint:x.mint,decimals:x.uiTokenAmount.decimals,
      before:b?.uiTokenAmount?.amount||'0',after:a?.uiTokenAmount?.amount||'0',
      delta:delta(a?.uiTokenAmount?.amount,b?.uiTokenAmount?.amount)};
  }).filter(row=>row.delta!=='0');
  return {signature,slot:tx.slot,version:tx.version,err:tx.meta.err,feeLamports:tx.meta.fee,
    signers:keys.filter(key=>key.signer).map(key=>key.pubkey),ixs,
    logInstructions:(tx.meta.logMessages||[]).filter(log=>log.includes('Instruction: ')).map(log=>log.split('Instruction: ')[1]),
    errorLogs:(tx.meta.logMessages||[]).filter(log=>/Error|failed|panick|exceed/i.test(log)),
    tokens};
}
async function main() {
  const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Not mainnet-beta');
  const listed=await rpc('getSignaturesForAddress',[program,{limit,commitment:'confirmed'}]);
  const rows=[];
  for (const entry of listed) {
    if(entry.err) continue;
    const tx=await rpc('getTransaction',[entry.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
    if(tx) rows.push(summarize(tx,entry.signature));
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  const output={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,program,listed:listed.length,rows};
  fs.writeFileSync(outPath,JSON.stringify(output,null,2)+'\n');
  const counts={};
  for(const row of rows)for(const log of row.logInstructions)counts[log]=(counts[log]||0)+1;
  console.log(JSON.stringify({listed:listed.length,read:rows.length,minSlot:rows.at(-1)?.slot,maxSlot:rows[0]?.slot,
    logInstructionCounts:counts,distinctSelectors:[...new Set(rows.flatMap(r=>r.ixs.map(i=>i.discriminator)))]}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
