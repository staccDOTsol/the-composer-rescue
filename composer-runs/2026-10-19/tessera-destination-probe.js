#!/usr/bin/env node
'use strict';
// Signed read-only test whether a payer may direct an input-paid swap to an unrelated USDC token account.
const fs=require('fs');
const web3=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,AddressLookupTableAccount}=web3;
const pk=x=>new PublicKey(x);
const key=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const wallet=key.publicKey;
const source='BgfAes9oQmYS6sa2LefzNwdkAA1mwTq9iDZxVDhaxKDZ';
const thirdParty='FzvRbXDdrsYVMa9KohXyQytWNAZAo4PsF8yujDH7KCfG';
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
const endpoint=row.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
let id=0;
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});const b=await r.json();if(b.error)throw Error(`${method}: ${b.error.message}`);return b.result;}
const instruction=i=>new TransactionInstruction({programId:pk(i.programId),keys:i.accounts.map(a=>({pubkey:pk(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(i.data,'base64')});
const balance=a=>a?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
async function main(){
 const qurl='https://lite-api.jup.ag/swap/v1/quote?'+new URLSearchParams({inputMint:'So11111111111111111111111111111111111111112',outputMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',amount:'100000000',slippageBps:'500',onlyDirectRoutes:'true',dexes:'TesseraV'});
 const quote=await(await fetch(qurl,{signal:AbortSignal.timeout(15000)})).json();
 if(quote.error||quote.routePlan?.[0]?.swapInfo?.ammKey!=='FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n')throw Error(`quote unavailable: ${quote.error||'wrong route'}`);
 const response=await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({quoteResponse:quote,userPublicKey:wallet.toBase58(),wrapAndUnwrapSol:true,dynamicComputeUnitLimit:false}),signal:AbortSignal.timeout(15000)});
 const build=await response.json();if(!response.ok||build.error)throw Error(`swap-instructions ${build.error||response.status}`);
 const [bh,alt,recipient]=await Promise.all([
  rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
  rpc('getMultipleAccounts',[build.addressLookupTableAddresses,{encoding:'base64',commitment:'confirmed'}]),
  rpc('getAccountInfo',[thirdParty,{encoding:'jsonParsed',commitment:'confirmed'}])
 ]);
 const info=recipient.value?.data?.parsed?.info;
 if(info?.mint!=='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'||info.owner===wallet.toBase58())throw Error('third party account not suitable');
 const tables=build.addressLookupTableAddresses.map((address,i)=>new AddressLookupTableAccount({key:pk(address),state:AddressLookupTableAccount.deserialize(Buffer.from(alt.value[i].data[0],'base64'))}));
 const out={observedAt:new Date().toISOString(),quoteSlot:quote.contextSlot,thirdPartyTokenOwner:info.owner,cases:[]};
 out.cases=await Promise.all([false,true].map(async remap=>{
  const swap={...build.swapInstruction,accounts:build.swapInstruction.accounts.map(a=>({...a,pubkey:remap&&a.pubkey===source?thirdParty:a.pubkey}))};
  const list=[...(build.computeBudgetInstructions||[]),...(build.setupInstructions||[]),swap,...(build.cleanupInstruction?[build.cleanupInstruction]:[])].map(instruction);
  const msg=new TransactionMessage({payerKey:wallet,recentBlockhash:bh.value.blockhash,instructions:list}).compileToV0Message(tables);
  const tx=new VersionedTransaction(msg);tx.sign([key]);const wire=tx.serialize();
  const keys=msg.staticAccountKeys.length+msg.addressTableLookups.reduce((n,x)=>n+x.readonlyIndexes.length+x.writableIndexes.length,0);
  if(wire.length>4096||keys>64)throw Error('v1 envelope exceeded');
  const sim=await rpc('simulateTransaction',[Buffer.from(wire).toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',
   accounts:{encoding:'base64',addresses:[source,thirdParty]}}]);
  return {remap,simSlot:sim.context.slot,wireBytes:wire.length,accountKeys:keys,err:sim.value.err,
   postBalances:{walletUsdc:balance(sim.value.accounts?.[0]),thirdPartyUsdc:balance(sim.value.accounts?.[1])},
   logs:(sim.value.logs||[]).filter(x=>x.includes('TessVdML')||x.includes('JUP6Lkb')||x.includes('failed:'))};
 }));
 fs.writeFileSync(`${__dirname}/tessera-destination-probe.json`,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
