#!/usr/bin/env node
// Read-only mainnet check of Composer's recovered interface against later receipts.
const fs = require('fs');
const path = require('path');
const bs58Module = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const root = __dirname;
const program = 'yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA';
const rpcEnvFile = '/Users/stacc/.config/stacc-ladder/rpc.env';
const rpcEnvRow = fs.existsSync(rpcEnvFile) ? fs.readFileSync(rpcEnvFile, 'utf8').split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line)) : null;
const endpoint = process.env.SOLANA_RPC || (rpcEnvRow ? rpcEnvRow.slice(rpcEnvRow.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') : 'https://api.mainnet-beta.solana.com');
const minSlot = Number(process.argv[2] || 458738799);
const maxFresh = Math.min(Number(process.argv[3] || 16), 100);
const outputName = process.argv[4] || 'yolov-composer-holdout.json';
const idl = JSON.parse(fs.readFileSync(path.join(root, 'yolov-composer-learn.json')));
const byDiscriminator = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix]));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0', id:1, method, params}),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.json();
    if (response.ok && !body.error) return body.result;
    if (attempt === 3) throw new Error(`${method}: ${body.error?.message || response.status}`);
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

function matchInstruction(ix, keys, topIndex, source) {
  const bytes = ix.data ? Buffer.from(bs58.decode(ix.data)) : Buffer.alloc(0);
  const discriminator = bytes.subarray(0, 8).toString('hex');
  const learned = byDiscriminator.get(discriminator);
  const accounts = ix.accounts || [];
  const mismatch = [];
  if (learned) {
    if (accounts.length !== learned.accounts.length) mismatch.push(`account count ${accounts.length} != ${learned.accounts.length}`);
    for (let i=0;i<Math.min(accounts.length, learned.accounts.length);i++) {
      const expected = learned.accounts[i];
      const actual = keys.find(k => k.pubkey === accounts[i]);
      if (expected.address && expected.address !== accounts[i]) mismatch.push(`account_${i} address`);
      if (actual && expected.signer !== actual.signer) mismatch.push(`account_${i} signer ${actual.signer}`);
      // Runtime account writability is transaction-global; a true here can come from another instruction.
      if (actual && expected.writable && !actual.writable) mismatch.push(`account_${i} not writable`);
    }
  }
  return {source, topIndex, name:learned?.name || null, discriminator, dataBytes:bytes.length,
    accounts, signerAccounts:accounts.filter(a => keys.find(k => k.pubkey===a)?.signer), mismatch};
}

function tokenDeltas(tx, keys) {
  const before = new Map((tx.meta?.preTokenBalances || []).map(b => [b.accountIndex, b]));
  const after = new Map((tx.meta?.postTokenBalances || []).map(b => [b.accountIndex, b]));
  return [...new Set([...before.keys(),...after.keys()])].map(index => {
    const a=after.get(index), b=before.get(index), x=a||b;
    return {account:keys[index]?.pubkey || null, owner:x.owner || null, mint:x.mint,
      before:b?.uiTokenAmount?.amount || '0', after:a?.uiTokenAmount?.amount || '0',
      delta:(BigInt(a?.uiTokenAmount?.amount || '0')-BigInt(b?.uiTokenAmount?.amount || '0')).toString(),
      decimals:x.uiTokenAmount.decimals};
  }).filter(x => x.delta !== '0');
}

async function main() {
  const listed = await rpc('getSignaturesForAddress',[program,{limit:100,commitment:'confirmed'}]);
  const fresh = listed.filter(row => row.slot > minSlot && !row.err).slice(0,maxFresh);
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',program,minSlot,
    composerArtifactSha256:'c376dad885146443b14b796eba479134de663c0e2eafc6bfa5aea9697d02ba26',
    signaturesListed:listed.length, freshCount:fresh.length, transactions:[]};
  for (const row of fresh) {
    const tx=await rpc('getTransaction',[row.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
    if (!tx) continue;
    const keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?{pubkey:k,signer:false,writable:false}:k);
    const instructions=[];
    tx.transaction.message.instructions.forEach((ix,index)=>{if(ix.programId===program) instructions.push(matchInstruction(ix,keys,index,'top'));});
    (tx.meta?.innerInstructions||[]).forEach(group=>group.instructions.forEach(ix=>{if(ix.programId===program) instructions.push(matchInstruction(ix,keys,group.index,'inner'));}));
    out.transactions.push({signature:row.signature,slot:tx.slot,version:tx.version,
      signers:keys.filter(k=>k.signer).map(k=>k.pubkey),instructions,
      tokenDeltas:tokenDeltas(tx,keys),
      logInstructionNames:(tx.meta?.logMessages||[]).filter(l=>l.includes('Instruction:')).map(l=>l.split('Instruction: ')[1])});
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  out.summary={transactions:out.transactions.length,instructions:out.transactions.reduce((n,t)=>n+t.instructions.length,0),
    unknownSelectors:out.transactions.flatMap(t=>t.instructions).filter(i=>!i.name).length,
    mismatched:out.transactions.flatMap(t=>t.instructions).filter(i=>i.mismatch.length).length,
    byName:Object.fromEntries([...new Set(out.transactions.flatMap(t=>t.instructions.map(i=>i.name)))].map(name=>[name,out.transactions.flatMap(t=>t.instructions).filter(i=>i.name===name).length]))};
  fs.writeFileSync(path.join(root,outputName),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({minSlot,freshCount:out.freshCount,summary:out.summary,
    mismatches:out.transactions.flatMap(t=>t.instructions.filter(i=>i.mismatch.length).map(i=>({signature:t.signature,slot:t.slot,name:i.name,mismatch:i.mismatch})))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
