#!/usr/bin/env node
// Current-binary, hooked-wallet signed mainnet simulations. No send/broadcast code.
const fs=require('fs');
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID}=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bs58mod=require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58=bs58mod.default||bs58mod;
const e=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?SOLANA_RPC=/.test(x));
if(!e)throw Error('SOLANA_RPC unavailable');
const url=e.slice(e.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const program=new PublicKey('STANDjrnkxme4tKsZSnW3WUQ9iKxbhJQj33dbW2F9sZ');
const mint=new PublicKey('DUSDt4AeLZHWYmcXnVGYdgAzjtzU5mXUVnTMdnSzAttM');
const vault='3GzZn1Qyzc6xzCgDn83teJysBW2bMCsK6DcRNhksMNo4';
const ackSignature='3tSzs7sXCesmSoZztVhvHuk6d9Hz4QqntnZmcrX5WckhPg5hmNU75HNMsKuRAwLnPU3A3hGsQg8Jp1bwTxcX5HCo';
const reqSignature='4vVzi6sr5VNoxNvzG6CtDqGwJ2SpG5jUPtVzaXFfkTqyuMj1kE9boir81ExbojiJ2TECfJonitpM4vGmgWci6pZs';
let id=0;
async function rpc(method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
 const b=await r.json();if(!r.ok||b.error)throw Error(`${method}: ${b.error?.message||r.status}`);return b.result;
}
function instruction(tx){
 const m=tx.transaction.message,h=m.header,keys=[...m.accountKeys,...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
 const ix=m.instructions.find(i=>keys[i.programIdIndex]===program.toBase58());
 if(!ix)throw Error('missing STAND instruction');
 const writable=i=>i<h.numRequiredSignatures?i<h.numRequiredSignatures-h.numReadonlySignedAccounts:
  i<m.accountKeys.length?i<m.accountKeys.length-h.numReadonlyUnsignedAccounts:
  i<m.accountKeys.length+(tx.meta?.loadedAddresses?.writable?.length||0);
 const accounts=ix.accounts.map(i=>({pubkey:new PublicKey(keys[i]),isSigner:i<h.numRequiredSignatures,isWritable:writable(i)}));
 return {accounts,data:Buffer.from(bs58.decode(ix.data))};
}
function tokenRaw(a){return a?.data?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;}
async function main(){
 const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
 const ata=getAssociatedTokenAddressSync(mint,wallet.publicKey,false,TOKEN_2022_PROGRAM_ID).toBase58();
 const ackTx=await rpc('getTransaction',[ackSignature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
 const reqTx=await rpc('getTransaction',[reqSignature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
 if(!ackTx||!reqTx)throw Error('receipt unavailable');
 const ack=instruction(ackTx),req=instruction(reqTx);
 const cases=[
  {label:'outsider_ack_redirect_to_self',source:ack,changes:{0:wallet.publicKey,1:wallet.publicKey,4:new PublicKey(ata)}},
  {label:'outsider_req_replaces_both_signers_old_caller_info',source:req,changes:{0:wallet.publicKey,1:wallet.publicKey}},
  {label:'outsider_req_expected_caller_info',source:req,changes:{0:wallet.publicKey,1:wallet.publicKey,3:new PublicKey('AEiYhWxESdcAKLyH6XPbrEAQ6Hzw9mgTAvNPgm5qKwtU')}}
 ];
 const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const before=(await rpc('getMultipleAccounts',[[vault,ata],{encoding:'base64',commitment:'processed'}])).value;
 const results=[];
 for(const c of cases){
  const keys=c.source.accounts.map((x,i)=>({...x,pubkey:c.changes[i]||x.pubkey}));
  const ix=new TransactionInstruction({programId:program,keys,data:c.source.data});
  const message=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:bh,instructions:[ix]}).compileToV0Message();
  const transaction=new VersionedTransaction(message);transaction.sign([wallet]);
  const wire=Buffer.from(transaction.serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:[vault,ata]}}]);
  results.push({label:c.label,historicalSignature:c.source===ack?ackSignature:reqSignature,
   instructionDiscriminatorHex:c.source.data.subarray(0,8).toString('hex'),bytes:wire.length,accountKeys:message.staticAccountKeys.length,
   requiredSignatures:message.header.numRequiredSignatures,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
   postRaw:(sim.value.accounts||[]).map(tokenRaw),logs:sim.value.logs});
 }
 const out={observedAt:new Date().toISOString(),network:'mainnet-beta',mode:'simulateTransaction only, sigVerify true, no send',program:program.toBase58(),wallet:wallet.publicKey.toBase58(),walletDusdAta:ata,vault,beforeRaw:before.map(tokenRaw),results};
 fs.writeFileSync(__dirname+'/stand-dusd-outsider-gate.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({wallet:out.wallet,beforeRaw:out.beforeRaw,results:results.map(x=>({label:x.label,bytes:x.bytes,accountKeys:x.accountKeys,requiredSignatures:x.requiredSignatures,err:x.err,unitsConsumed:x.unitsConsumed,postRaw:x.postRaw,errorLog:x.logs?.find(l=>l.includes('Error'))}))}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
