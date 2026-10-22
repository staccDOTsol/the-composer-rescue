#!/usr/bin/env node
'use strict';

// Read-only recent-receipt scan keyed by Composer's published IDL selectors.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58Module = require('../2026-10-15/fragmetric-core-current-audit/sdk-3.0.2/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const program = 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3';
const focus = new Set(['operator_run_fund_command', 'slasher_initialize_normalized_token_withdrawal_account',
  'slasher_withdraw_normalized_token', 'user_request_withdrawal', 'user_cancel_withdrawal_request',
  'user_withdraw_sol', 'user_withdraw_supported_token']);
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'fragmetric-composer-idl.json'), 'utf8'));
const bySelector = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
const envFile = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
if ((fs.statSync(envFile).mode & 0o777) !== 0o600) throw new Error('RPC env file must be mode 0600');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)\s*$/); if (!match) continue;
  let value = match[2].trim(); if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1); env[match[1]] = value;
}
const endpoint = env.SOLANA_RPC_URL || env.SOLANA_RPC || env.HELIUS_RPC || env.RPC;
if (!endpoint) throw new Error('RPC endpoint absent');
let id = 0;
async function call(method, params) {
  const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(120000)});
  const body=await response.json(); if(body.error)throw new Error(`${method}: ${JSON.stringify(body.error)}`); return body.result;
}
async function batch(calls) {
  const rows = calls.map(row => ({jsonrpc:'2.0',id:++id,method:row.method,params:row.params}));
  const response = await fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(rows),signal:AbortSignal.timeout(120000)});
  const bodies=await response.json(); const map=new Map(bodies.map(row=>[row.id,row]));
  return rows.map(row=>{const x=map.get(row.id);if(x?.error)throw new Error(`${row.method}: ${JSON.stringify(x.error)}`);return x?.result;});
}
function programOf(ix){return typeof ix.programId==='string'?ix.programId:null;}
function instructionRows(tx) {
  const rows=[];
  const ingest=(ix,location,outerIndex)=>{if(programOf(ix)!==program||!ix.data)return;const data=Buffer.from(bs58.decode(ix.data));
    const selector=data.subarray(0,8).toString('hex');rows.push({location,outerIndex,name:bySelector.get(selector)||null,
      selector,dataBase58:ix.data,argsHex:data.subarray(8).toString('hex'),accounts:ix.accounts||[]});};
  tx.transaction.message.instructions.forEach((ix,i)=>ingest(ix,'outer',i));
  for(const group of tx.meta?.innerInstructions||[])for(const ix of group.instructions)ingest(ix,'inner',group.index);
  return rows;
}
function tokenDeltas(tx){const keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey);
 const before=new Map((tx.meta.preTokenBalances||[]).map(x=>[x.accountIndex,x]));const after=new Map((tx.meta.postTokenBalances||[]).map(x=>[x.accountIndex,x]));
 return [...new Set([...before.keys(),...after.keys()])].map(index=>{const a=after.get(index),b=before.get(index),x=a||b;
  return {account:keys[index],mint:x.mint,owner:x.owner||null,before:b?.uiTokenAmount?.amount||'0',after:a?.uiTokenAmount?.amount||'0',
   delta:(BigInt(a?.uiTokenAmount?.amount||0)-BigInt(b?.uiTokenAmount?.amount||0)).toString()};}).filter(x=>x.delta!=='0');}

async function main(){
 const listed=await call('getSignaturesForAddress',[program,{limit:1000,commitment:'finalized'}]);
 const ok=listed.filter(x=>!x.err);const transactions=[];
 for(let start=0;start<ok.length;start+=25){const page=ok.slice(start,start+25);
  const txs=await batch(page.map(row=>({method:'getTransaction',params:[row.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]})));
  txs.forEach((tx,i)=>{if(!tx)return;const instructions=instructionRows(tx);if(!instructions.some(x=>focus.has(x.name)))return;
   transactions.push({signature:page[i].signature,slot:tx.slot,blockTime:tx.blockTime,signers:tx.transaction.message.accountKeys.filter(x=>x.signer).map(x=>x.pubkey),
    instructions,tokenDeltas:tokenDeltas(tx),logInstructionNames:(tx.meta.logMessages||[]).filter(x=>x.includes('Instruction: ')).map(x=>x.split('Instruction: ')[1])});});
  if(start+25<ok.length)await new Promise(resolve=>setTimeout(resolve,100));
 }
 const counts={};for(const tx of transactions)for(const ix of tx.instructions)counts[ix.name]=(counts[ix.name]||0)+1;
 const output={generatedAt:new Date().toISOString(),network:'mainnet-beta',commitment:'finalized',program,
  composerIdlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fragmetric-composer-idl.json'))).digest('hex'),
  signaturesListed:listed.length,successfulSignatures:ok.length,matchingTransactions:transactions.length,counts,transactions};
 fs.writeFileSync(path.join(__dirname,'fragmetric-receipt-scan.json'),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({signaturesListed:listed.length,successfulSignatures:ok.length,matchingTransactions:transactions.length,counts,
  candidates:transactions.filter(tx=>tx.instructions.some(ix=>['slasher_withdraw_normalized_token','user_withdraw_sol','user_withdraw_supported_token'].includes(ix.name)))
    .slice(0,20).map(tx=>({signature:tx.signature,slot:tx.slot,names:tx.instructions.map(x=>x.name),signers:tx.signers,tokenDeltas:tx.tokenDeltas}))},null,2));
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
