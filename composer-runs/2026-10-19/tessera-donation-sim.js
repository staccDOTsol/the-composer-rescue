#!/usr/bin/env node
'use strict';
// Signed, read-only mainnet simulation. No sendRawTransaction call exists in this file.
const fs=require('fs');
const web3=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram}=web3;
const pk=x=>new PublicKey(x);
const program=pk('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
const authority=pk('8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF');
const pool=pk('FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n');
const wsolVault=pk('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const usdcVault=pk('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const wsolMint=pk('So11111111111111111111111111111111111111112');
const usdcMint=pk('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const userUsdc=pk('BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ');
const global12=pk('BAT1Ndpu5gbLTp2AZkSXP79LJBZfCH4B3zGhi6LtvdhK');
const global13=pk('4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs');
const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const wallet=key.publicKey;
const userWsol=spl.getAssociatedTokenAddressSync(wsolMint,wallet);
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
const tokenBalance=a=>a?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
function swapIx(amount){
 const data=Buffer.alloc(18);data[0]=0x10;data[1]=0x01;data.writeBigUInt64LE(BigInt(amount),2);data.writeBigUInt64LE(0n,10);
 const metas=[
  [authority,false,false],[pool,false,true],[wallet,true,true],
  [wsolVault,false,true],[usdcVault,false,true],[userWsol,false,true],[userUsdc,false,true],
  [wsolMint,false,false],[usdcMint,false,false],[spl.TOKEN_PROGRAM_ID,false,false],[spl.TOKEN_PROGRAM_ID,false,false],
  [pk('Sysvar1nstructions1111111111111111111111111'),false,false],[global12,false,false],[global13,false,false]
 ];
 return new TransactionInstruction({programId:program,keys:metas.map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable})),data});
}
async function buildAndSimulate(donation,hash){
 const tx=new Transaction({feePayer:wallet,recentBlockhash:hash});
 tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(wallet,userWsol,wallet,wsolMint));
 tx.add(SystemProgram.transfer({fromPubkey:wallet,toPubkey:userWsol,lamports:200000000}));
 tx.add(spl.createSyncNativeInstruction(userWsol));
 if(donation)tx.add(spl.createTransferInstruction(userWsol,wsolVault,wallet,donation));
 tx.add(swapIx(100000000));
 tx.sign(key);
 const wire=tx.serialize();
 const keys=tx.compileMessage().accountKeys.map(x=>x.toBase58());
 if(wire.length>4096||keys.length>64)throw Error(`v1 limits ${wire.length} bytes ${keys.length} keys`);
 const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,
  accounts:{encoding:'base64',addresses:[userWsol.toBase58(),userUsdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58(),pool.toBase58()]}}]);
 const accountBalances=Object.fromEntries(['userWsol','userUsdc','wsolVault','usdcVault','pool'].map((name,i)=>[name,i===4?null:tokenBalance(sim.value.accounts?.[i])]));
 return {donationLamports:donation,swapInputLamports:100000000,wireBytes:wire.length,accountKeys:keys.length,signatures:tx.signatures.length,
  err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,accountBalances,logs:sim.value.logs,
  innerInstructions:sim.value.innerInstructions};
}
async function main(){
 const [bh,pre]=await Promise.all([
  rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[[userWsol.toBase58(),userUsdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58()],{encoding:'base64',commitment:'confirmed'}])
 ]);
 const out={observedAt:new Date().toISOString(),blockhashLastValidBlockHeight:bh.value.lastValidBlockHeight,preSlot:pre.context.slot,
  wallet:wallet.toBase58(),userWsol:userWsol.toBase58(),userUsdc:userUsdc.toBase58(),
  preBalances:Object.fromEntries(['userWsol','userUsdc','wsolVault','usdcVault'].map((name,i)=>[name,tokenBalance(pre.value[i])])),
  cases:[]};
 for(const donation of [0,10000000,50000000]){
  out.cases.push(await buildAndSimulate(donation,bh.value.blockhash));
 }
 fs.writeFileSync(`${__dirname}/tessera-donation-sim.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({preSlot:out.preSlot,preBalances:out.preBalances,cases:out.cases.map(x=>({donationLamports:x.donationLamports,err:x.err,wireBytes:x.wireBytes,accountKeys:x.accountKeys,units:x.unitsConsumed,post:x.accountBalances,logs:x.logs?.slice(-8)}))},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
