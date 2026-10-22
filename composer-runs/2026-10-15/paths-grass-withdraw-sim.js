#!/usr/bin/env node
// Current-binary read-only Withdraw control and account-binding probes.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const web3=require('/Users/stacc/ftl/server/node_modules/@solana/web3.js');
const bs58pkg=require('/Users/stacc/ftl/server/node_modules/bs58');
const bs58=bs58pkg.default||bs58pkg;
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const HIST='2p1huVXX3pS2Dq5ShaZP25M5J7dcAhg5HPMEPu4gFvEXUJJANM2piZZ6vF8RmmJtkj4xyoNwar3RXAnrzBHAS1xa';
const USER='3q5npT5PAsivpj1KPCK6sfazGiUgEKLQdcYgMaQAuuK7';
const DEST='4YxvN7qeK9Mk32TzjjKNF72yPBAM4zx5kvV3dQeyMyvF';
const SIGNER='GYWTJ88vpxGh8WZRygxUByH39ufi34RNuB3nRKPVQjUD';
const OTHER_POOL='BSb68HCsLMsuq9BSTZHKhTfZSyTMhUfipgvwaUDjBmv1';
const OTHER_VAULT='5JwNA9W3SC5q8Ht23dGnWvixsaHkkbvmTX9eiZ9t9XUB';
const OTHER_DEST='B7a65jSFQMdyHsbRYviSQvsrQuxMoQyE6jNpWeRDs735';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
async function rpc(method,params){let last;for(let i=0;i<5;i++){try{
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
  if(!r.ok||j.error)throw new Error(`${method}: ${r.status} ${JSON.stringify(j.error)}`);return j.result;
}catch(e){last=e;if(i<4)await new Promise(ok=>setTimeout(ok,300*2**i));}}throw last;}
const pk=s=>new web3.PublicKey(s),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function summarize(a){if(!a)return null;const b=Buffer.from(a.data[0],'base64');const x={owner:a.owner,size:b.length,sha256:sha(b)};
  if(a.owner==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&b.length>=72)
    x.token={mint:bs58.encode(b.subarray(0,32)),authority:bs58.encode(b.subarray(32,64)),amount:b.readBigUInt64LE(64).toString()};
  if(a.owner===PROGRAM&&b.length===2584)x.pending0={pool:bs58.encode(b.subarray(8,40)),
    amount:b.readBigUInt64LE(40).toString(),requestTime:b.readBigUInt64LE(48).toString(),
    unlockTime:b.readBigUInt64LE(56).toString()};
  return x;
}
async function main(){
  const tx=await rpc('getTransaction',[HIST,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  const msg=tx.transaction.message,keys=msg.accountKeys,h=msg.header,ref=msg.instructions.find(x=>keys[x.programIdIndex]===PROGRAM);
  const writable=i=>i<h.numRequiredSignatures?i<h.numRequiredSignatures-h.numReadonlySignedAccounts:i<keys.length-h.numReadonlyUnsignedAccounts;
  const base=ref.accounts.map(index=>({key:keys[index],signer:index<h.numRequiredSignatures,writable:writable(index)}));
  base[3].key=USER;base[5].key=DEST;base[6].key=SIGNER;
  const data=Buffer.from(bs58.decode(ref.data));
  const monitors=[base[1].key,base[2].key,USER,base[4].key,DEST,SIGNER,OTHER_POOL,OTHER_VAULT,OTHER_DEST];
  const pre=await rpc('getMultipleAccounts',[monitors,{encoding:'base64',commitment:'confirmed'}]);
  const before=Object.fromEntries(monitors.map((key,i)=>[key,summarize(pre.value[i])]));
  const preUser=Buffer.from(pre.value[monitors.indexOf(USER)].data[0],'base64');
  const bh=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const cases=[
    {name:'mature_withdraw_current',mutate:a=>a},
    {name:'mature_withdraw_twice_atomic',mutate:a=>a,repeats:2},
    {name:'wrong_signer',mutate:a=>{a[6].key=keys[0];return a;}},
    {name:'other_user_destination',mutate:a=>{a[5].key=OTHER_DEST;return a;}},
    {name:'cross_pool_original_vault',mutate:a=>{a[1].key=OTHER_POOL;return a;}},
    {name:'cross_vault_original_pool',mutate:a=>{a[4].key=OTHER_VAULT;return a;}},
    {name:'cross_pool_and_vault',mutate:a=>{a[1].key=OTHER_POOL;a[4].key=OTHER_VAULT;return a;}},
    {name:'wrong_request_index',mutate:a=>a,data:Buffer.concat([data.subarray(0,8),Buffer.from([1])])},
    {name:'destination_aliases_vault',mutate:a=>{a[5].key=a[4].key;return a;}},
    {name:'pool_aliases_vault',mutate:a=>{a[1].key=a[4].key;return a;}},
  ];
  const results=[];
  for(const c of cases){const aa=c.mutate(base.map(x=>({...x}))),
    ix=new web3.TransactionInstruction({programId:pk(PROGRAM),keys:aa.map(x=>({pubkey:pk(x.key),isSigner:x.signer,isWritable:x.writable})),data:c.data||data});
    const m=new web3.TransactionMessage({payerKey:pk(keys[0]),recentBlockhash:bh,
      instructions:Array.from({length:c.repeats||1},()=>ix)}).compileToV0Message();
    const raw=Buffer.from(new web3.VersionedTransaction(m).serialize());
    if(raw.length>1232)throw new Error(`${c.name} wire oversized ${raw.length}`);
    const sim=await rpc('simulateTransaction',[raw.toString('base64'),{encoding:'base64',sigVerify:false,
      replaceRecentBlockhash:true,commitment:'confirmed',minContextSlot:pre.context.slot,
      innerInstructions:true,accounts:{encoding:'base64',addresses:monitors}}]);
    const after=Object.fromEntries(monitors.map((key,i)=>[key,summarize(sim.value.accounts?.[i])]));
    const tokenDelta=Object.fromEntries(monitors.map(key=>[key,before[key]?.token&&after[key]?.token?
      (BigInt(after[key].token.amount)-BigInt(before[key].token.amount)).toString():null]));
    const userPost=sim.value.accounts?.[monitors.indexOf(USER)]?.data?.[0];
    results.push({name:c.name,wireBytes:raw.length,slot:sim.context.slot,error:sim.value.err,
      unitsConsumed:sim.value.unitsConsumed,instructionDataHex:(c.data||data).toString('hex'),
      accounts:aa.map(x=>x.key),tokenDelta,after,logs:sim.value.logs,
      innerInstructions:sim.value.innerInstructions,userPostBase64:c.name==='mature_withdraw_current'?userPost:null});
    process.stdout.write(`${c.name} ${JSON.stringify(sim.value.err)} ${sim.value.unitsConsumed} CU\n`);
  }
  const report={generatedAt:new Date().toISOString(),method:'simulateTransaction only; sigVerify:false; no transaction submitted',
    program:PROGRAM,referenceSignature:HIST,referenceSlot:tx.slot,currentReadSlot:pre.context.slot,
    currentUser:USER,signer:SIGNER,destination:DEST,pool:base[1].key,vault:base[4].key,
    instructionDataHex:data.toString('hex'),before,preUserBase64:preUser.toString('base64'),results};
  fs.writeFileSync(path.join(DIR,'paths-grass-withdraw-sim.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(`wrote paths-grass-withdraw-sim.json\n`);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
