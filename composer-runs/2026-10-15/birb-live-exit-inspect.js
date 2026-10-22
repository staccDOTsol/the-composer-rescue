#!/usr/bin/env node
'use strict';
const fs=require('fs');
const mod='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair}=require(mod+'@solana/web3.js');
const bs58mod=require(mod+'bs58'),bs58=bs58mod.default||bs58mod;
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const program='tbg7LYoHuCogZ54p6z6BaALBiyXy9b7hN368EHGh3EE';
const sig='5TJfUTBWNDDXHvM2hHaBFCYUhvppriPcoqdCtL2V3AtSjJNsgBYyKSvsje9VWnp7KofEDXMZ8ZwntSC3Ct9wAFcW';
async function main(){
 const t=await conn.getParsedTransaction(sig,{commitment:'confirmed',maxSupportedTransactionVersion:1});
 const flags=Object.fromEntries(t.transaction.message.accountKeys.map(k=>[k.pubkey.toBase58(),{signer:k.signer,writable:k.writable,source:k.source}]));
 const top=t.transaction.message.instructions.map((ix,i)=>({i,program:ix.programId.toBase58(),
  accounts:ix.accounts?.map(a=>a.toBase58()),data:ix.data,discriminator:ix.data?Buffer.from(bs58.decode(ix.data)).subarray(0,8).toString('hex'):null}));
 const inners=t.meta.innerInstructions.map(g=>({index:g.index,instructions:g.instructions.map(x=>({program:x.programId.toBase58(),
  accounts:x.accounts?.map(a=>a.toBase58()),data:x.data,parsed:x.parsed}))}));
 const selected=new Set([program]);for(const x of top.filter(x=>x.program===program))for(const a of x.accounts)selected.add(a);
 const infos=await conn.getMultipleAccountsInfo([...selected].map(x=>new PublicKey(x)),'confirmed');
 const accountState=[...selected].map((address,i)=>({address,owner:infos[i]?.owner.toBase58(),lamports:infos[i]?.lamports,
  executable:infos[i]?.executable,length:infos[i]?.data.length,base64:infos[i]?.data.toString('base64')}));
 const out={observedAt:new Date().toISOString(),wallet:wallet.publicKey.toBase58(),sourceSignature:sig,slot:t.slot,
  flags,top,inners,logs:t.meta.logMessages,preTokenBalances:t.meta.preTokenBalances,postTokenBalances:t.meta.postTokenBalances,
  accountState};
 fs.writeFileSync(__dirname+'/birb-live-exit-inspect.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({slot:t.slot,top:top.filter(x=>x.program===program),flags,logs:t.meta.logMessages?.filter(x=>x.includes('Instruction:')||x.includes('Program log:')).slice(0,35),
  tokenTransfers:inners.flatMap(g=>g.instructions.filter(x=>x.parsed?.type?.startsWith('transfer')).map(x=>({index:g.index,parsed:x.parsed}))),
  state:accountState.map(({base64,...rest})=>rest)},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
