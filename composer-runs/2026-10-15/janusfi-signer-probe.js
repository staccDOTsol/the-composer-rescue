#!/usr/bin/env node
'use strict';

// Read-only signer-privilege probe for JanusFI. The impossible-signature
// variants identify a runtime gate; they are not executable transactions.
const fs = require('fs');
const {PublicKey, TransactionInstruction, TransactionMessage} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const dir = __dirname;
const inv = JSON.parse(fs.readFileSync(`${dir}/janusfi-current-inventory.json`));
const source = inv.transactions.find(tx => tx.janus?.[0]?.accounts?.[2]?.address === '5vQKTtZJp52mmAUCU2CJT48hvz1XbNXiLHcibJpbuwUi').janus[0];
const program = new PublicKey(inv.identifiers.program);
const owner = 'DX2RWhp5n4yCk7obUFGpGFeGbggo74fEgvfPoDvkxFCk';
const repl = {0:owner, 11:'81QnJkihJuSLZRyHaBhtcWgBRQkJbnBHccVDWpdbN12F', 12:'AxJbrrCzH1qZ5jYCkNT2Vb9BpUBqhDkzg6Mhqrmqn3DC'};
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => l.split(/=(.*)/s).slice(0,2)));
const endpoint = env.RPC_URL || env.HEAVY_RPC_URL;
let id=0;
async function rpc(method,params){ const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})}); const j=await r.json(); if(j.error) throw Error(JSON.stringify(j.error)); return j.result; }
function encode(ixs,hash){
  const v0=new TransactionMessage({payerKey:new PublicKey(owner),recentBlockhash:hash,instructions:ixs}).compileToV0Message();
  const keys=v0.staticAccountKeys, items=v0.compiledInstructions;
  const config=Buffer.alloc(8); config.writeUInt32LE(1400000,0); config.writeUInt32LE(67108864,4);
  const heads=items.map(x=>{const h=Buffer.alloc(4); h[0]=x.programIdIndex; h[1]=x.accountKeyIndexes.length; h.writeUInt16LE(x.data.length,2); return h;});
  const wire=Buffer.concat([Buffer.from([0x81,v0.header.numRequiredSignatures,v0.header.numReadonlySignedAccounts,v0.header.numReadonlyUnsignedAccounts,0x0c,0,0,0]),Buffer.from(bs58.decode(hash)),Buffer.from([items.length,keys.length]),...keys.map(x=>x.toBuffer()),config,...heads,...items.map(x=>Buffer.concat([Buffer.from(x.accountKeyIndexes),Buffer.from(x.data)])),Buffer.alloc(64*v0.header.numRequiredSignatures)]);
  return {wire,size:wire.length,signers:keys.slice(0,v0.header.numRequiredSignatures).map(x=>x.toBase58())};
}
(async()=>{
  const hash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const results=[];
  const watched=[repl[11],repl[12],source.accounts[5].address,source.accounts[6].address,source.accounts[7].address,source.accounts[13].address,source.accounts[15].address];
  function instruction(direction,amount,extra){
    const keys=source.accounts.map(a=>({pubkey:new PublicKey(repl[a.position]||a.address),isSigner:a.signer||a.position===extra,isWritable:a.writable}));
    const data=Buffer.from(source.dataHex,'hex'); data[1]=0;data[2]=direction;data.writeBigUInt64LE(BigInt(amount),3);data[11]=0;
    return new TransactionInstruction({programId:program,keys,data});
  }
  async function simulate(ixs){
    const enc=encode(ixs,hash);
    const value=(await rpc('simulateTransaction',[enc.wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:watched}}])).value;
    const balances=Object.fromEntries((value.accounts||[]).map((a,i)=>[watched[i],a?.data?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null]));
    return {enc,value,balances};
  }
  for(const extra of [null,1,2,3,17,18,19]){
    const {enc,value,balances}=await simulate([instruction(0,1000000n,extra)]);
    results.push({extra, account:extra===null?null:source.accounts[extra].address,onCurve:extra===null?null:PublicKey.isOnCurve(new PublicKey(source.accounts[extra].address).toBuffer()),size:enc.size,signers:enc.signers,err:value.err,unitsConsumed:value.unitsConsumed,balances,logs:value.logs?.slice(-12)});
  }
  const pre=await rpc('getMultipleAccounts',[watched,{encoding:'base64',commitment:'confirmed'}]);
  const preBalances=Object.fromEntries(pre.value.map((a,i)=>[watched[i],a?.data?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null]));
  const arithmetic=[];
  for (const amount of [1n,100n,1000000n,4000000n,8000000n,100000000n,1000000000n,4000000000n]) {
    const one=await simulate([instruction(0,amount,18)]);
    const outcome=one.balances[repl[12]]===null?null:BigInt(one.balances[repl[12]])-BigInt(preBalances[repl[12]]);
    const entry={buyInputCashRaw:amount.toString(),buyErr:one.value.err,buySize:one.enc.size,buyUnits:one.value.unitsConsumed,buyOutcomeRaw:outcome?.toString()||null};
    if(one.value.err===null && outcome>0n){
      const round=await simulate([instruction(0,amount,18),instruction(1,outcome,18)]);
      entry.roundTripErr=round.value.err; entry.roundTripSize=round.enc.size; entry.roundTripUnits=round.value.unitsConsumed;
      entry.roundTripCashDeltaRaw=round.balances[repl[11]]===null?null:(BigInt(round.balances[repl[11]])-BigInt(preBalances[repl[11]])).toString();
      entry.roundTripOutcomeDeltaRaw=round.balances[repl[12]]===null?null:(BigInt(round.balances[repl[12]])-BigInt(preBalances[repl[12]])).toString();
      if(amount===1000000n){
        for(const count of [2,4,8]){
          const ixs=[];for(let i=0;i<count;i++){ixs.push(instruction(0,amount,18),instruction(1,outcome,18));}
          const repeated=await simulate(ixs);
          arithmetic.push({class:'repeated-cycle',cycles:count,err:repeated.value.err,size:repeated.enc.size,units:repeated.value.unitsConsumed,cashDeltaRaw:repeated.balances[repl[11]]===null?null:(BigInt(repeated.balances[repl[11]])-BigInt(preBalances[repl[11]])).toString(),outcomeDeltaRaw:repeated.balances[repl[12]]===null?null:(BigInt(repeated.balances[repl[12]])-BigInt(preBalances[repl[12]])).toString()});
        }
      }
    }
    arithmetic.push(entry);
  }
  for (const amount of [1n,100n,1000000n,16000000n]) {
    const one=await simulate([instruction(1,amount,18)]);
    const cash=one.balances[repl[11]]===null?null:BigInt(one.balances[repl[11]])-BigInt(preBalances[repl[11]]);
    const entry={sellInputOutcomeRaw:amount.toString(),sellErr:one.value.err,sellSize:one.enc.size,sellUnits:one.value.unitsConsumed,sellCashRaw:cash?.toString()||null,sellLogs:one.value.logs?.slice(-10)};
    if(one.value.err===null && cash>0n){
      const round=await simulate([instruction(1,amount,18),instruction(0,cash,18)]);
      entry.roundTripErr=round.value.err;entry.roundTripSize=round.enc.size;entry.roundTripUnits=round.value.unitsConsumed;
      entry.roundTripCashDeltaRaw=round.balances[repl[11]]===null?null:(BigInt(round.balances[repl[11]])-BigInt(preBalances[repl[11]])).toString();
      entry.roundTripOutcomeDeltaRaw=round.balances[repl[12]]===null?null:(BigInt(round.balances[repl[12]])-BigInt(preBalances[repl[12]])).toString();
    }
    arithmetic.push(entry);
  }
  const out={generatedAt:new Date().toISOString(),source:inv.transactions.find(tx=>tx.janus?.[0]===source)?.signature,program:program.toBase58(),readOnly:true,sigVerify:false,warning:'extra-signer probes with off-curve PDAs cannot be submitted; used only to identify signer gate',results};
  out.preBalances=preBalances; out.arithmetic=arithmetic;
  fs.writeFileSync(`${dir}/janusfi-signer-probe.json`,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(results.map(({extra,account,onCurve,size,err,unitsConsumed})=>({extra,account,onCurve,size,err,unitsConsumed})),null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
