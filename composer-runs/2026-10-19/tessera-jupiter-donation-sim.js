#!/usr/bin/env node
'use strict';
// Signed, read-only mainnet Jupiter->Tessera simulation. No sendRawTransaction call exists.
const fs=require('fs');
const web3=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram,AddressLookupTableAccount}=web3;
const pk=x=>new PublicKey(x);
const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const wallet=key.publicKey;
const wsolMint=pk('So11111111111111111111111111111111111111112');
const usdcMint=pk('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const userWsol=spl.getAssociatedTokenAddressSync(wsolMint,wallet);
const userUsdc=spl.getAssociatedTokenAddressSync(usdcMint,wallet);
const wsolVault=pk('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const usdcVault=pk('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
const tokenBalance=a=>a?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
function deserializeIx(ix){return new TransactionInstruction({programId:pk(ix.programId),keys:ix.accounts.map(a=>({pubkey:pk(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(ix.data,'base64')})}
async function jupiter(){
 const params=new URLSearchParams({inputMint:wsolMint.toBase58(),outputMint:usdcMint.toBase58(),amount:'100000000',slippageBps:'500',onlyDirectRoutes:'true',dexes:'TesseraV'});
 const quote=await(await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`,{signal:AbortSignal.timeout(15000)})).json();
 if(quote.routePlan?.length!==1||quote.routePlan[0].swapInfo?.ammKey!=='FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n')throw Error('wrong quote route');
 const r=await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quoteResponse:quote,userPublicKey:wallet.toBase58(),wrapAndUnwrapSol:true,dynamicComputeUnitLimit:false}),signal:AbortSignal.timeout(15000)});
 const build=await r.json();if(!r.ok||build.error)throw Error(`Jupiter swap-instructions: ${build.error||r.status}`);
 return {quote,build};
}
async function main(){
 const {quote,build}=await jupiter();
 const altKeys=build.addressLookupTableAddresses||[];
 const [bh,pre,alts]=await Promise.all([
  rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[[userWsol.toBase58(),userUsdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58()],{encoding:'base64',commitment:'confirmed'}]),
  altKeys.length?rpc('getMultipleAccounts',[altKeys,{encoding:'base64',commitment:'confirmed'}]):Promise.resolve({value:[]})
 ]);
 const lookupTables=altKeys.map((address,i)=>new AddressLookupTableAccount({key:pk(address),state:AddressLookupTableAccount.deserialize(Buffer.from(alts.value[i].data[0],'base64'))}));
 const out={observedAt:new Date().toISOString(),quoteSlot:quote.contextSlot,quoteOutAmount:quote.outAmount,quoteThreshold:quote.otherAmountThreshold,
  preSlot:pre.context.slot,blockhashLastValidBlockHeight:bh.value.lastValidBlockHeight,lookupTables:altKeys,
  preBalances:Object.fromEntries(['userWsol','userUsdc','wsolVault','usdcVault'].map((name,i)=>[name,tokenBalance(pre.value[i])])),cases:[]};
 const basic=[...(build.computeBudgetInstructions||[]),...(build.setupInstructions||[])].map(deserializeIx);
 const swap=deserializeIx(build.swapInstruction),cleanup=build.cleanupInstruction?deserializeIx(build.cleanupInstruction):null;
 out.cases=await Promise.all([0,10000000,50000000].map(async donation=>{
  const extra=[SystemProgram.transfer({fromPubkey:wallet,toPubkey:userWsol,lamports:50000000}),spl.createSyncNativeInstruction(userWsol)];
  const donated=donation?[spl.createTransferInstruction(userWsol,wsolVault,wallet,donation)]:[];
  const instructions=[...basic,...extra,...donated,swap,...(cleanup?[cleanup]:[])];
  const msg=new TransactionMessage({payerKey:wallet,recentBlockhash:bh.value.blockhash,instructions}).compileToV0Message(lookupTables);
  const tx=new VersionedTransaction(msg);tx.sign([key]);const wire=tx.serialize();
  const accountKeys=msg.staticAccountKeys.length+msg.addressTableLookups.reduce((n,x)=>n+x.readonlyIndexes.length+x.writableIndexes.length,0);
  if(wire.length>4096||accountKeys>64)throw Error(`v1 limits ${wire.length} bytes ${accountKeys} keys`);
  const sim=await rpc('simulateTransaction',[Buffer.from(wire).toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,
   accounts:{encoding:'base64',addresses:[userUsdc.toBase58(),wsolVault.toBase58(),usdcVault.toBase58()]}}]);
  return {donationLamports:donation,swapInputLamports:100000000,extraFundingLamports:50000000,simSlot:sim.context.slot,wireBytes:wire.length,accountKeys,
   err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
   postBalances:Object.fromEntries(['userUsdc','wsolVault','usdcVault'].map((name,i)=>[name,tokenBalance(sim.value.accounts?.[i])])),
   logs:(sim.value.logs||[]).filter(x=>x.includes('TessVdML')||x.includes('JUP6Lkb')||x.includes('failed:')),
   innerInstructions:(sim.value.innerInstructions||[]).map(g=>({index:g.index,count:g.instructions?.length||0}))};
 }));
 fs.writeFileSync(`${__dirname}/tessera-jupiter-donation-sim.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
