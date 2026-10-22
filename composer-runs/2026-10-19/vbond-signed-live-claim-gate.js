#!/usr/bin/env node
// Signed mainnet-beta simulation only. This script never broadcasts a transaction.
const fs=require('fs');
const path=require('path');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,
  StakeProgram,SystemProgram,SYSVAR_CLOCK_PUBKEY,SYSVAR_STAKE_HISTORY_PUBKEY}=require(modules+'@solana/web3.js');
const url=process.env.SOLANA_RPC;
if(!url)throw Error('SOLANA_RPC is required');
const program=new PublicKey('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'vbond-current-census.json')));
let selected;
if(!source.topReadyWithStake?.length)throw Error('No backed, ready live request in census');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const split=Keypair.generate();
const P=s=>new PublicKey(s);
const [eventAuthority]=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],program);
let id=0;
async function rpc(method,params){
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const j=await r.json();if(!r.ok||j.error)throw Error(`${method}: ${JSON.stringify(j.error||{status:r.status})}`);
  return j.result;
}
function key(pubkey,isSigner=false,isWritable=false){return {pubkey,isSigner,isWritable};}
async function main(){
  const candidateVotes=source.topReadyWithStake.map(w=>w.voteAccount);
  const voteAccounts=await rpc('getMultipleAccounts',[candidateVotes,{encoding:'base64',commitment:'confirmed'}]);
  const selectedIndex=voteAccounts.value.findIndex(a=>a?.owner==='Vote111111111111111111111111111111111111111');
  if(selectedIndex<0)throw Error('No live Vote-owned account for backed ready request');
  selected=source.topReadyWithStake[selectedIndex];
  const [bondsAuthority]=PublicKey.findProgramAddressSync([Buffer.from('bonds_authority'),P(selected.config).toBuffer()],program);
  const [vote,walletAccount,stakeAccount,requestAccount,latest]=await Promise.all([
    rpc('getAccountInfo',[selected.voteAccount,{encoding:'jsonParsed',commitment:'confirmed'}]),
    rpc('getAccountInfo',[wallet.publicKey.toBase58(),{encoding:'base64',commitment:'confirmed'}]),
    rpc('getAccountInfo',[selected.availableStake.address,{encoding:'base64',commitment:'confirmed'}]),
    rpc('getAccountInfo',[selected.address,{encoding:'base64',commitment:'confirmed'}]),
    rpc('getLatestBlockhash',[{commitment:'confirmed'}]),
  ]);
  const nodeIdentity=vote.value?.data?.parsed?.info?.nodePubkey||null;
  if(!requestAccount.value||!stakeAccount.value||!walletAccount.value)throw Error('Selected live fixture missing');
  if(wallet.publicKey.toBase58()===selected.bondAuthority||wallet.publicKey.toBase58()===nodeIdentity)
    throw Error('Signer is not an outsider for this request');
  const ix=new TransactionInstruction({programId:program,keys:[
    key(P(selected.config)),key(P(selected.bond)),key(P(selected.voteAccount)),
    key(wallet.publicKey,true),key(P(selected.address),false,true),key(bondsAuthority),
    key(P(selected.availableStake.address),false,true),key(wallet.publicKey),
    key(split.publicKey,true,true),key(wallet.publicKey,true,true),
    key(StakeProgram.programId),key(SystemProgram.programId),key(SYSVAR_STAKE_HISTORY_PUBKEY),
    key(SYSVAR_CLOCK_PUBKEY),key(eventAuthority),key(program),
  ],data:Buffer.from([48,232,23,52,20,134,122,118])});
  const message=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:latest.value.blockhash,
    instructions:[ix]}).compileToV0Message();
  const tx=new VersionedTransaction(message);tx.sign([wallet,split]);
  const wire=Buffer.from(tx.serialize());
  const signedRequired=message.header.numRequiredSignatures;
  if(signedRequired!==2)throw Error(`Expected two signatures, got ${signedRequired}`);
  const fee=await rpc('getFeeForMessage',[Buffer.from(message.serialize()).toString('base64'),{commitment:'confirmed'}]);
  const result=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
    replaceRecentBlockhash:false,commitment:'confirmed',accounts:{encoding:'base64',
      addresses:[selected.availableStake.address,selected.address,wallet.publicKey.toBase58()]}}]);
  const output={generatedAt:new Date().toISOString(),scope:'signed current mainnet-beta simulateTransaction only',
    broadcast:false,program:program.toBase58(),request:selected.address,bond:selected.bond,
    config:selected.config,voteAccount:selected.voteAccount,bondAuthority:selected.bondAuthority,
    nodeIdentity,outsider:wallet.publicKey.toBase58(),withdrawer:wallet.publicKey.toBase58(),
    stakeAccount:selected.availableStake.address,stakeLamports:selected.availableStake.lamports,
    requestEpoch:selected.epoch,currentEpoch:source.epoch,requestRemainingLamports:selected.remainingLamports,
    walletLamportsBefore:String(walletAccount.value.lamports),stakeLamportsBefore:String(stakeAccount.value.lamports),
    requestLamportsBefore:String(requestAccount.value.lamports),slotFixture:source.slots.epoch,
    transactionBytes:wire.length,addressCount:message.staticAccountKeys.length,
    requiredSignatures:signedRequired,sigVerify:true,estimatedFeeLamports:fee.value,
    err:result.value.err,computeUnits:result.value.unitsConsumed,logs:result.value.logs,
    watchedAccounts:result.value.accounts?.map((a,i)=>({address:[selected.availableStake.address,selected.address,wallet.publicKey.toBase58()][i],
      lamports:a?.lamports??null}))||null};
  fs.writeFileSync(path.join(__dirname,'vbond-signed-live-claim-gate.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({request:output.request,stakeAccount:output.stakeAccount,
    stakeSol:Number(BigInt(output.stakeLamports))/1e9,outsider:output.outsider,nodeIdentity:output.nodeIdentity,
    bondAuthority:output.bondAuthority,bytes:output.transactionBytes,requiredSignatures:output.requiredSignatures,
    err:output.err,fee:output.estimatedFeeLamports,logs:output.logs?.slice(0,12),watched:output.watchedAccounts},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
