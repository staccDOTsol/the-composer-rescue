#!/usr/bin/env node
'use strict';
// Signed mainnet-beta simulateTransaction only. Never submits a transaction.
const fs=require('fs');
const M='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionMessage,VersionedTransaction}=require(M+'@solana/web3.js');
const spl=require(M+'@solana/spl-token');
const raw=JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH||'/Users/stacc/hooked.json','utf8'));
if(!Array.isArray(raw)||raw.length!==64||!raw.every(x=>Number.isInteger(x)&&x>=0&&x<=255))
  throw Error('invalid hooked keypair shape');
const wallet=Keypair.fromSecretKey(Uint8Array.from(raw));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const RPC=env.HEAVY_RPC_URL||env.RPC_URL;
const rows=[
  ['WET','WETZjtprkDMCcUxPi9PfWnowMRZkiGGHDb9rABuRZ2U',spl.TOKEN_PROGRAM_ID],
  ['PUMP_B','2bCCHQadi4QeHWPKG3w13siCyWWQPgkFtniouTqVpump',spl.TOKEN_2022_PROGRAM_ID],
  ['WSOL','So11111111111111111111111111111111111111112',spl.TOKEN_PROGRAM_ID],
  ['JUP6_INTERMEDIATE_6P6X','6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',spl.TOKEN_PROGRAM_ID],
  ['PUMP_A','Ar8mYJece3kHPQUxwoW8sk6LRpdCLZd5N3mZ8BMRpump',spl.TOKEN_2022_PROGRAM_ID],
  ['CASH','CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH',spl.TOKEN_2022_PROGRAM_ID],
].map(([name,mint,program])=>({name,mint:new PublicKey(mint),program,
  ata:spl.getAssociatedTokenAddressSync(new PublicKey(mint),wallet.publicKey,false,program)}));
let id=0;
async function rpc(method,params){const j=await(await fetch(RPC,{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})})).json();
  if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;}
async function snapshot(){const [lamports,accounts]=await Promise.all([
  rpc('getBalance',[wallet.publicKey.toBase58(),{commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[rows.map(x=>x.ata.toBase58()),{encoding:'base64',commitment:'confirmed'}])]);
  return {lamports:lamports.value,atas:accounts.value.map((a,i)=>({name:rows[i].name,
    exists:!!a,lamports:a?.lamports||0}))};}
async function main(){
  const before=await snapshot();
  const instructions=rows.map(x=>spl.createAssociatedTokenAccountIdempotentInstruction(
    wallet.publicKey,x.ata,wallet.publicKey,x.mint,x.program));
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const message=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:blockhash,
    instructions}).compileToV0Message();
  const transaction=new VersionedTransaction(message);transaction.sign([wallet]);
  const wire=Buffer.from(transaction.serialize());
  const simulation=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',
    sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
    accounts:{encoding:'base64',addresses:[wallet.publicKey.toBase58(),
      ...rows.map(x=>x.ata.toBase58())]}}]);
  const after=await snapshot();
  const o={observedAt:new Date().toISOString(),rpcNetwork:'mainnet-beta',method:'simulateTransaction',
    sigVerify:true,mainnetSubmission:false,wallet:wallet.publicKey.toBase58(),
    wireVersion:0,wireBytes:wire.length,addressCount:message.staticAccountKeys.length,
    instructions:rows.map(x=>({name:x.name,mint:x.mint.toBase58(),
      tokenProgram:x.program.toBase58(),ata:x.ata.toBase58()})),
    before,simulation:{slot:simulation.context.slot,err:simulation.value.err,
      computeUnits:simulation.value.unitsConsumed,logs:simulation.value.logs?.slice(-35)},
    after,chainUnchanged:before.lamports===after.lamports&&
      before.atas.every((x,i)=>x.exists===after.atas[i].exists&&x.lamports===after.atas[i].lamports)};
  fs.writeFileSync(__dirname+'/hooked-mainnet-ata-init-sim.json',JSON.stringify(o,null,2)+'\n');
  console.log(JSON.stringify({err:o.simulation.err,slot:o.simulation.slot,
    wireBytes:o.wireBytes,computeUnits:o.simulation.computeUnits,
    chainUnchanged:o.chainUnchanged,logs:o.simulation.logs?.slice(-16)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
