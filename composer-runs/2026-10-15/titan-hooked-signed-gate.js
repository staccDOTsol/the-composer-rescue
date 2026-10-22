#!/usr/bin/env node
'use strict';
// Signed localhost fork simulation of a current Titan same-mint route.
// The wallet secret is read at runtime and is never serialized.
const fs=require('fs'),crypto=require('crypto');
const M='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(M+'@solana/web3.js');
const {getAssociatedTokenAddressSync}=require(M+'@solana/spl-token');
const b=require(M+'bs58'),bs58=b.default||b;
const {encodeV1}=require('./klend-v1-composition.js');
const P=x=>new PublicKey(x);
const HIST='5gpxn7vBzbjBLv1ymmok4xiYXFsNSJpDXuUvcrh2WnaUjsZcAjpohYtkzkT3m8qSsXds54TvA8tNhTE3w3nhWUoj';
const TITAN='T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT';
const OLD_USER='HHHJTk2pdPSCoAcFRxkapVdDRprR7Wo1tpXyB8LcVb4s';
const OLD_SOURCE='CBfhZf2YbYy3tgXxv4WVcn2W2QHgXTWJpize78ZbuibA';
const OLD_DEST='A2hcXRGtZXMQEq41QcCYHUsowVVMpvnRVyYDEHrARsgP';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PDA_VAULT='3nnVbsCfN1mwUk2XSLCnjzY3bDDTdzpnKjvRmd8nESS2';
const FORK=process.env.FORK_RPC||'http://127.0.0.1:9397';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const MAINNET=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(url,method,params){const j=await(await fetch(url,{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})})).json();
  if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;}
function tokenAmount(a){if(!a?.data)return null;const data=Buffer.from(a.data[0],'base64');
  return data.length>=72?data.readBigUInt64LE(64).toString():null;}
async function seedToken(address,template,owner,amount){const data=Buffer.from(template.data[0],'base64');
  owner.toBuffer().copy(data,32);data.writeBigUInt64LE(BigInt(amount),64);
  await rpc(FORK,'surfnet_setAccount',[address.toBase58(),{data:data.toString('hex'),
    executable:false,lamports:template.lamports,owner:template.owner,rentEpoch:0}]);}
function signed(ix,wallet,blockhash){const e=encodeV1([ix],wallet.publicKey,blockhash);
  const v0=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:blockhash,
    instructions:[ix]}).compileToV0Message();
  if(e.requiredSignatures!==1||!v0.staticAccountKeys[0].equals(wallet.publicKey))
    throw Error('unexpected signer');
  const wire=Buffer.from(e.wire);
  const key=crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(wallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
  return {wire,e};}
async function main(){
  const raw=JSON.parse(fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH||'/Users/stacc/hooked.json','utf8'));
  if(!Array.isArray(raw)||raw.length!==64||!raw.every(x=>Number.isInteger(x)&&x>=0&&x<=255))
    throw Error('invalid wallet secret shape');
  const wallet=Keypair.fromSecretKey(Uint8Array.from(raw));
  const tx=await rpc(MAINNET,'getTransaction',[HIST,{encoding:'jsonParsed',maxSupportedTransactionVersion:1}]);
  if(!tx||tx.meta.err)throw Error('historical route unavailable');
  const root=tx.transaction.message.instructions.find(x=>x.programId===TITAN);
  if(!root||root.accounts.length!==43)throw Error('Titan root shape changed');
  const flags=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  if(!flags.get(OLD_USER)?.signer)throw Error('source signer mismatch');
  const source=getAssociatedTokenAddressSync(P(USDC),wallet.publicKey);
  const dest=Keypair.generate().publicKey;
  const templates=(await rpc(FORK,'getMultipleAccounts',[[OLD_SOURCE,OLD_DEST],{encoding:'base64'}])).value;
  if(templates.some(x=>!x))throw Error('historical token templates missing');
  await rpc(FORK,'surfnet_setAccount',[wallet.publicKey.toBase58(),{data:'',
    executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  await seedToken(source,templates[0],wallet.publicKey,'1000000000');
  await seedToken(dest,templates[1],wallet.publicKey,'0');
  const repl=new Map([[OLD_USER,wallet.publicKey.toBase58()],
    [OLD_SOURCE,source.toBase58()],[OLD_DEST,dest.toBase58()]]);
  const keys=root.accounts.map(x=>({pubkey:P(repl.get(x)||x),
    isSigner:!!flags.get(x)?.signer,isWritable:!!flags.get(x)?.writable}));
  const data=Buffer.from(bs58.decode(root.data));
  const ix=new TransactionInstruction({programId:P(TITAN),keys,data});
  const watch=[source.toBase58(),dest.toBase58(),PDA_VAULT];
  const pre=(await rpc(FORK,'getMultipleAccounts',[watch,{encoding:'base64'}])).value.map(tokenAmount);
  const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {wire,e}=signed(ix,wallet,bh);
  const s=await rpc(FORK,'simulateTransaction',[wire.toString('base64'),{encoding:'base64',
    sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watch}}]);
  const post=(s.value.accounts||[]).map(tokenAmount);
  const delta=post.length===pre.length?post.map((a,i)=>a===null||pre[i]===null?null:
    (BigInt(a)-BigInt(pre[i])).toString()):[];
  const o={generatedAt:new Date().toISOString(),scope:'hooked-wallet Titan same-mint route signed current fork gate',
    historicalSignature:HIST,sourceSlot:tx.slot,wallet:wallet.publicKey.toBase58(),
    syntheticSourceUsdcRaw:'1000000000',destinationIsFreshTokenAccount:true,
    wireBytes:e.sizeBytes,addressCount:e.addressCount,sigVerify:true,
    noMainnetSubmission:true,watch,pre,post,delta,err:s.value.err,
    computeUnits:s.value.unitsConsumed,logs:s.value.logs?.slice(-60)};
  fs.writeFileSync(__dirname+'/'+(process.env.FORK_RPC?'titan-hooked-currentfork-signed-gate.json':'titan-hooked-signed-gate.json'),JSON.stringify(o,null,2)+'\n');
  console.log(JSON.stringify({err:o.err,wireBytes:o.wireBytes,addressCount:o.addressCount,
    pre,post,delta,computeUnits:o.computeUnits,logs:o.logs?.slice(-18)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
