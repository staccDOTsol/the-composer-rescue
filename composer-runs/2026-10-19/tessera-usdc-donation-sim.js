#!/usr/bin/env node
'use strict';
// Signed, read-only mainnet simulation of WSOL->USDC funding then USDC donation + USDC->WSOL.
const fs=require('fs');
const web3=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,AddressLookupTableAccount}=web3;
const pk=x=>new PublicKey(x);
const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const wallet=key.publicKey;
const wsolMint=pk('So11111111111111111111111111111111111111112');
const usdcMint=pk('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const wsol=spl.getAssociatedTokenAddressSync(wsolMint,wallet);
const usdc=spl.getAssociatedTokenAddressSync(usdcMint,wallet);
const wsolVault=pk('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const usdcVault=pk('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
const balance=a=>a?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
const instruction=i=>new TransactionInstruction({programId:pk(i.programId),keys:i.accounts.map(a=>({pubkey:pk(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(i.data,'base64')});
async function route(inputMint,outputMint,amount){
 const p=new URLSearchParams({inputMint,outputMint,amount:String(amount),slippageBps:'500',onlyDirectRoutes:'true',dexes:'TesseraV'});
 const q=await(await fetch('https://lite-api.jup.ag/swap/v1/quote?'+p,{signal:AbortSignal.timeout(15000)})).json();
 if(q.routePlan?.length!==1||q.routePlan[0].swapInfo?.ammKey!=='FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n')throw Error('wrong route');
 const r=await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quoteResponse:q,userPublicKey:wallet.toBase58(),wrapAndUnwrapSol:false,dynamicComputeUnitLimit:false}),signal:AbortSignal.timeout(15000)});
 const b=await r.json();if(!r.ok||b.error)throw Error(`swap-instructions ${b.error||r.status}`);
 return {q,b};
}
async function main(){
 const [buy,sell]=await Promise.all([route(wsolMint.toBase58(),usdcMint.toBase58(),200000000),route(usdcMint.toBase58(),wsolMint.toBase58(),10000000)]);
 const tableKeys=[...new Set([...buy.b.addressLookupTableAddresses,...sell.b.addressLookupTableAddresses])];
 const [bh,pre,lookup]=await Promise.all([
  rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[[wsol.toBase58(),usdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58()],{encoding:'base64',commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[tableKeys,{encoding:'base64',commitment:'confirmed'}])
 ]);
 const tables=tableKeys.map((address,i)=>new AddressLookupTableAccount({key:pk(address),state:AddressLookupTableAccount.deserialize(Buffer.from(lookup.value[i].data[0],'base64'))}));
 const base=[...(buy.b.computeBudgetInstructions||[]).map(instruction),spl.createAssociatedTokenAccountIdempotentInstruction(wallet,wsol,wallet,wsolMint),
  SystemProgram.transfer({fromPubkey:wallet,toPubkey:wsol,lamports:200000000}),spl.createSyncNativeInstruction(wsol),
  ...(buy.b.setupInstructions||[]).map(instruction),instruction(buy.b.swapInstruction),
  ...(sell.b.setupInstructions||[]).map(instruction)];
 const end=[instruction(sell.b.swapInstruction)];
 const out={observedAt:new Date().toISOString(),buyQuoteSlot:buy.q.contextSlot,sellQuoteSlot:sell.q.contextSlot,buyOutQuote:buy.q.outAmount,sellOutQuote:sell.q.outAmount,
  preSlot:pre.context.slot,preBalances:Object.fromEntries(['userWsol','userUsdc','wsolVault','usdcVault'].map((name,i)=>[name,balance(pre.value[i])])),cases:[]};
 const cases=[0,1000000,10000000].map(donation=>{
  const instructions=[...base,...(donation?[spl.createTransferInstruction(usdc,usdcVault,wallet,donation)]:[]),...end];
  const msg=new TransactionMessage({payerKey:wallet,recentBlockhash:bh.value.blockhash,instructions}).compileToV0Message(tables);
  const tx=new VersionedTransaction(msg);tx.sign([key]);const wire=tx.serialize();
  const keys=msg.staticAccountKeys.length+msg.addressTableLookups.reduce((n,x)=>n+x.readonlyIndexes.length+x.writableIndexes.length,0);
  if(wire.length>4096||keys>64)throw Error(`v1 limits ${wire.length} bytes ${keys} keys`);
  return {donation,wire,keys};
 });
 out.cases=await Promise.all(cases.map(async c=>{
  const sim=await rpc('simulateTransaction',[Buffer.from(c.wire).toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,
   accounts:{encoding:'base64',addresses:[wsol.toBase58(),usdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58()]}}]);
  return {donationUsdcRaw:c.donation,buyInputWsolRaw:200000000,sellInputUsdcRaw:10000000,simSlot:sim.context.slot,wireBytes:c.wire.length,accountKeys:c.keys,
   err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
   postBalances:Object.fromEntries(['userWsol','userUsdc','wsolVault','usdcVault'].map((name,i)=>[name,balance(sim.value.accounts?.[i])])),
   logs:(sim.value.logs||[]).filter(x=>x.includes('TessVdML')||x.includes('JUP6Lkb')||x.includes('failed:'))};
 }));
 fs.writeFileSync(`${__dirname}/tessera-usdc-donation-sim.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
