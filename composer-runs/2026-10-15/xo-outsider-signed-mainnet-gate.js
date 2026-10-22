#!/usr/bin/env node
'use strict';
// Mainnet-beta simulation only. No transaction is broadcast.
const fs=require('fs'),path=require('path');
const {Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,TOKEN_2022_PROGRAM_ID}=
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const dir=__dirname,shapes=JSON.parse(fs.readFileSync(path.join(dir,'xo-controller-live-shapes.json')));
const original=shapes[0];
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
let seq=0;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const v=await r.json();
  if(v.error)throw Error(method+': '+v.error.message);return v.result;}
async function main(){const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('not mainnet-beta');
  const source=await rpc('getTransaction',[original.signature,
    {encoding:'jsonParsed',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);
  const msg=source.transaction.message;
  const accounts=new Map(msg.accountKeys.map(x=>[x.pubkey,x]));
  const orig=msg.instructions.find(x=>x.programId==='C64AAGzJxsFwzQZaS1t8Yis5UCVTTAchTwG2QZj1kSRi');
  if(!orig||orig.accounts.length!==12)throw Error('historical instruction mismatch');
  const originalSignerPositions=orig.accounts.map((x,i)=>accounts.get(x)?.signer?i:null).filter(x=>x!==null);
  const mint=new PublicKey('xoUSDq85Rjsb6SbUwJyreFgeWQvxdkT7R3c3g7s6p5Y');
  const walletAta=getAssociatedTokenAddressSync(mint,wallet.publicKey,false,TOKEN_2022_PROGRAM_ID);
  const ataMode=process.argv.includes('--ata');
  const distinctMode=process.argv.includes('--distinct');
  const attackerCosigners=distinctMode?[Keypair.generate(),Keypair.generate(),Keypair.generate()]:[];
  const keys=orig.accounts.map((s,i)=>({pubkey:i===0?wallet.publicKey:
    [6,7,8].includes(i)?distinctMode?attackerCosigners[i-6].publicKey:wallet.publicKey:
    i===1&&ataMode?walletAta:new PublicKey(s),
    isSigner:i===0||[6,7,8].includes(i),isWritable:!!accounts.get(s)?.writable}));
  const ix=new TransactionInstruction({programId:new PublicKey('C64AAGzJxsFwzQZaS1t8Yis5UCVTTAchTwG2QZj1kSRi'),
    keys,data:Buffer.from(bs58.decode(orig.data))});
  const bh=await rpc('getLatestBlockhash',[{commitment:'confirmed'}]);
  const instructions=ataMode?[createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey,walletAta,
    wallet.publicKey,mint,TOKEN_2022_PROGRAM_ID),ix]:[ix];
  const m=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:bh.value.blockhash,
    instructions}).compileToV0Message();
  const tx=new VersionedTransaction(m);tx.sign([wallet,...attackerCosigners]);
  const raw=Buffer.from(tx.serialize());
  const sim=await rpc('simulateTransaction',[raw.toString('base64'),
    {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'}]);
  const report={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',genesis,
    sourceSignature:original.signature,sourceSlot:source.slot,
    sourceInstruction:'SendToken',sourceSignerPositions:originalSignerPositions,
    mutation:distinctMode?'Use hooked wallet for payer signer plus three fresh outsider cosigners for the other source signer roles; use hooked-wallet XO ATA and create it idempotently in simulation. Preserve observed vault, authority, mint, recipients and instruction data. No nonce instruction.':ataMode?'Replace four source signer roles with hooked wallet; use its XO ATA as payer_token_account and create that ATA idempotently in the simulated transaction. Keep source vault, authority, mint, recipients and instruction data. No nonce instruction.':'Replace four source transaction signer account keys with hooked-wallet public key, preserving observed nonsigner vault, authority, mint, recipient, program and instruction data. No nonce instruction; no recipient substituted.',
    ataMode,distinctMode,walletAta:walletAta.toBase58(),
    walletPublicKey:wallet.publicKey.toBase58(),packetBytes:raw.length,accountKeys:m.staticAccountKeys.length,
    signatureVerified:true,simulationSlot:sim.context.slot,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
    logs:sim.value.logs,returnData:sim.value.returnData||null,
    preTokenBalances:sim.value.preTokenBalances||[],postTokenBalances:sim.value.postTokenBalances||[],
    noTransactionSubmitted:true,
    limitations:['Original instruction data might include an expiry, request ID or nonce; a failure does not by itself prove all SendToken shapes are gated.','Historical transaction had four independent signers; this outsider test uses the one available hooked wallet in all four positions.']};
  const file=path.join(dir,distinctMode?'xo-outsider-signed-mainnet-distinct-gate.json':ataMode?'xo-outsider-signed-mainnet-ata-gate.json':'xo-outsider-signed-mainnet-gate.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({file,packetBytes:report.packetBytes,accountKeys:report.accountKeys,
    slot:report.simulationSlot,err:report.err,units:report.unitsConsumed,
    programLogs:report.logs?.filter(x=>x.includes('Program log:')||x.includes('failed')).slice(-12)}));
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
