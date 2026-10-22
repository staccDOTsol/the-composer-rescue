#!/usr/bin/env node
// Bounded read-only bridge-route attribution and USDC exit screen. No wallet loaded.
const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const rpcUrl=env.HEAVY_RPC_URL||env.RPC_URL;
const program='circiqFCstNzaFBji1udQ6txgQBrn29pVSYHNJQo3wZ';
const vault='5crgXHDPmJup446JZ8Qxyx4jjyZbdW8pUjYBpbuqs8Ra';
const authority='AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy';
const mint='rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof';
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let id=0;
async function rpc(method,params){const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;}
async function quote(amount){const u=new URL('https://lite-api.jup.ag/swap/v1/quote');u.searchParams.set('inputMint',mint);u.searchParams.set('outputMint',usdc);u.searchParams.set('amount',String(amount));u.searchParams.set('slippageBps','50');const r=await fetch(u);const b=await r.json();return{inRaw:String(amount),status:r.status,outUsdcRaw:b.outAmount||null,contextSlot:b.contextSlot||null,error:b.error||null,errorCode:b.errorCode||null,route:(b.routePlan||[]).map(x=>({label:x.swapInfo.label,ammKey:x.swapInfo.ammKey,inRaw:x.swapInfo.inAmount,outRaw:x.swapInfo.outAmount}))};}
async function main(){
 const signature='3ziipkssiTUxka7V5EjWNZ9Qt43eguAKMDeFEfp3UX3sWPQrwVyzMwgkRYZdJYaAr8cHEaEiSrPZzFjkm46myFaq';
 const [slot,tx,bal,auth,prog]=await Promise.all([
  rpc('getSlot',[{commitment:'confirmed'}]),rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]),
  rpc('getTokenAccountBalance',[vault,{commitment:'confirmed'}]),rpc('getAccountInfo',[authority,{encoding:'base64',commitment:'confirmed'}]),
  rpc('getAccountInfo',[program,{encoding:'base64',commitment:'confirmed'}]),
 ]);
 const keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey);
 const top=tx.transaction.message.instructions.map(x=>({programId:x.programId||keys[x.programIdIndex],accounts:x.accounts||[],parsedType:x.parsed?.type||null,dataLength:x.data?.length||0}));
 const inner=(tx.meta.innerInstructions||[]).flatMap(x=>x.instructions).map(x=>({programId:x.programId||keys[x.programIdIndex],parsedType:x.parsed?.type||null,
  source:x.parsed?.info?.source||null,destination:x.parsed?.info?.destination||null,authority:x.parsed?.info?.authority||null,amount:x.parsed?.info?.amount||null}));
 const quotes=[];for(const amount of [44_750_000_000n,100_000_000_000n,1_000_000_000_000n,10_000_000_000_000n])quotes.push(await quote(amount));
 const output={generatedAt:new Date().toISOString(),readOnly:true,currentSlot:slot,program,programExecutable:prog.value?.executable||false,
  vault:{address:vault,mint,amount:bal.value.amount,decimals:bal.value.decimals,authority,authorityOwner:auth.value?.owner||null},
  historical:{signature,slot:tx.slot,err:tx.meta.err,signers:tx.transaction.message.accountKeys.filter(k=>k.signer).map(k=>k.pubkey),top,
   targetProgramInner:inner.filter(x=>x.programId===program),vaultOutflows:inner.filter(x=>x.source===vault),
   logSignals:(tx.meta.logMessages||[]).filter(x=>/invoke|Instruction:|success|failed|error/i.test(x)).filter(x=>/circiq|brdgGY|Instruction:|failed|error/i.test(x)).slice(0,28)},quotes};
 fs.writeFileSync(__dirname+'/circiq-render-route-gate.json',JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify(output,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
