#!/usr/bin/env node
'use strict';
// Read-only mainnet-beta discovery. Wallet is loaded at runtime for this audit.
const fs=require('fs');
const mod='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,Keypair,PublicKey}=require(mod+'@solana/web3.js');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const conn=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const targets=[
 ['RUSH-stake','SaTsTaKpGdTfUEPSSwyYgLKkfnZu8uL3D1DbLXshdb7',''],
 ['RUSH-fusion','fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9',''],
 ['BIRB','tbg7LYoHuCogZ54p6z6BaALBiyXy9b7hN368EHGh3EE',''],
 ['NEON','919AnvG1Vi9ekoxQs6d6SYQiRmYMcinw4U6bzL2YNoFM','9okWmESkYFw3Jmk3KxRijp2TMM21YHAGaUFRZNUoDFjP'],
 ['sCLOUD','bon4Kh3x1uQK16w9b9DKgz3Aw4AP1pZxBJk55Q6Sosb','FxUBDoykCbJTDNGMn7vopjo5Pakfs2xTkS9jVZpf4Gh3'],
];
async function main(){
 const out={observedAt:new Date().toISOString(),wallet:wallet.publicKey.toBase58(),rows:[]};
 const crosswalk=JSON.parse(fs.readFileSync(__dirname+'/mainnet-token-authority-flash-crosswalk.json','utf8'));
 for(const [symbol,program,hardVault] of targets){
  const vault=hardVault||crosswalk.targets.find(t=>t.programId===program)?.assets[0]?.sampledTokenAccounts[0];
  const [vaultInfo,sigs,progInfo]=await Promise.all([
   conn.getParsedAccountInfo(new PublicKey(vault),'confirmed'),
   conn.getSignaturesForAddress(new PublicKey(vault),{limit:12},'confirmed'),
   conn.getAccountInfo(new PublicKey(program),'confirmed')]);
  const token=vaultInfo.value?.data?.parsed?.info;
  const row={symbol,program,vault,programExecutable:progInfo?.executable,token,
   recentSignatures:sigs.map(x=>({signature:x.signature,slot:x.slot,err:x.err}))};
  const txs=await Promise.all(sigs.slice(0,4).map(x=>conn.getParsedTransaction(x.signature,{commitment:'confirmed',maxSupportedTransactionVersion:1})));
  row.transactions=txs.map((tx,i)=>({signature:sigs[i].signature,slot:tx?.slot,
   topPrograms:tx?.transaction.message.instructions.map(x=>x.programId.toBase58()),
   tokenOut:tx?.meta?.innerInstructions?.flatMap(g=>g.instructions).filter(ix=>{
    const p=ix.parsed;return (p?.type==='transfer'||p?.type==='transferChecked')&&p.info?.source===vault;
   }).map(ix=>({programId:ix.programId.toBase58(),parsed:ix.parsed}))}));
  out.rows.push(row);
 }
 const path=__dirname+'/next-controller-discovery.json';
 fs.writeFileSync(path,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out.rows.map(r=>({symbol:r.symbol,programExecutable:r.programExecutable,
  token:{mint:r.token?.mint,owner:r.token?.owner,amount:r.token?.tokenAmount?.amount},
  signatures:r.recentSignatures.length,transactions:r.transactions.map(t=>({signature:t.signature,slot:t.slot,topPrograms:t.topPrograms,tokenOut:t.tokenOut}))})),null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
