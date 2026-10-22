#!/usr/bin/env node
// Current deployed-binary operator-gate screen, signed locally, never submitted.
const fs=require('fs');
const crypto=require('crypto');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(modules+'@solana/web3.js');
const {encodeV1}=require('./klend-v1-composition.js');
const fork='http://127.0.0.1:9397';
const program=new PublicKey('vBoNdEvzMrSai7is21XgVYik65mqtaKXuSdMBJ1xkW4');
const P=s=>new PublicKey(s);
const hash=crypto.createHash('sha256').update('global:withdraw_stake').digest().subarray(0,8);
const [eventAuthority]=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],program);
let id=0;
async function rpc(method,params) {
 const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
 const j=await r.json();if(j.error)throw Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;
}
function sign(ix,attacker,blockhash) {
 const encoded=encodeV1([ix],attacker.publicKey,blockhash);
 if(encoded.requiredSignatures!==1)throw Error('unexpected signer count');
 const compiled=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,instructions:[ix]}).compileToV0Message();
 if(!compiled.staticAccountKeys[0].equals(attacker.publicKey))throw Error('payer order');
 const wire=Buffer.from(encoded.wire);
 const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
  Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
 return {wire,encoded};
}
async function main(){
 const attacker=Keypair.generate();
 await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{
  data:'',executable:false,lamports:1000000000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const config=P('vbMaRfmTCg92HWGzmd53APkMNpPnGVGZTUHwUJQkXAU');
 const selectedStake=P('CkcjLv1yYzckeQmPRWF1tdyui6qkr4imc5Dht8ZJsh5f');
 const accounts=[
  [config,false,false],[attacker.publicKey,true,false],
  [P('Ewt3RcMFoXNBCrYPhXojVUbeynPxVgoP4eBEo4xpYKbN'),false,false],
  [selectedStake,false,true],[P('7cgg6KhPd1G8oaoB48RyPDWu7uZs51jUpDYB3eq4VebH'),false,false],
  [attacker.publicKey,true,true],[P('SysvarStakeHistory1111111111111111111111111'),false,false],
  [P('SysvarC1ock11111111111111111111111111111111'),false,false],
  [P('Stake11111111111111111111111111111111111111'),false,false],
  [eventAuthority,false,false],[program,false,false]
 ];
 const ix=new TransactionInstruction({programId:program,
  keys:accounts.map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable})),data:hash});
 const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const {wire,encoded}=sign(ix,attacker,blockhash);
 const before=await rpc('getAccountInfo',[selectedStake.toBase58(),{encoding:'base64'}]);
 const r=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
  replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:[selectedStake.toBase58()]}}]);
 const output={generatedAt:new Date().toISOString(),scope:'signed local-fork deployed-binary withdraw_stake operator gate only',
  mainnetSubmission:false,forkSubmission:false,program:program.toBase58(),config:config.toBase58(),
  attacker:attacker.publicKey.toBase58(),selectedStake:selectedStake.toBase58(),
  selectedStakeExists:!!before.value,bytes:encoded.sizeBytes,addresses:encoded.addressCount,
  requiredSignatures:encoded.requiredSignatures,sigVerify:true,err:r.value.err,
  computeUnits:r.value.unitsConsumed,logs:r.value.logs};
 fs.writeFileSync(__dirname+'/validator-bonds-outsider-operator-screen.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify({err:output.err,bytes:output.bytes,addresses:output.addresses,
  selectedStakeExists:output.selectedStakeExists,logs:output.logs?.slice(-12)}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
