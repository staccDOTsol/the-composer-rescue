#!/usr/bin/env node
// Conditional internal-account checks only: synthetic off-curve signer in a read-only simulation.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const web3=require('/Users/stacc/ftl/server/node_modules/@solana/web3.js');
const bs58pkg=require('/Users/stacc/ftl/server/node_modules/bs58');const bs58=bs58pkg.default||bs58pkg;
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const HIST='KKuhSpAhCigHCkLmT38yX6ravnCfUYfKYxA7wnoHEiVMAhHXoqWCQQGaW8TqRNbrbGA4cJMqsk9WgGFB5nVKhy3';
const ADMIN='31rYartQwHeBMjAe2MgGpffGV57fQY3kug4BDN8tLGqQ';
const DEST='7oMjvD5MWttpfwA5mDx9aV7aLE8GkMCYeELxqckXKX3n';
const MINT='Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs';
const REWARD='8jX6h76wzVMwdnbZ4fhXt7zEAriynbdLMExPipvHAWYW';
const VAULT='7FZRSVR4Wf8p26cuNX86zy3FJA86xni1pXokbueuww5J';
const CREATE_KEY='jCyT7c4wtVY5iW7fg86ZtpHGqp7K6HqFs9M3qExX8Ch';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PAYER='6M8ky5cy1ex51a9TfwGtC9fNTGjjWHg4mqmF6uMxBaMN';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL,pk=x=>new web3.PublicKey(x);
async function rpc(method,params){for(let attempt=0;attempt<8;attempt++){
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
  if(r.ok&&!j.error)return j.result;
  if(j.error?.code===-32016&&attempt<7){await new Promise(resolve=>setTimeout(resolve,250));continue;}
  throw new Error(`${method}: ${JSON.stringify(j.error)}`);
}}
function summary(a){if(!a)return null;const b=Buffer.from(a.data[0],'base64'),out={owner:a.owner,size:b.length,
  sha256:crypto.createHash('sha256').update(b).digest('hex')};
  if(a.owner===TOKEN&&b.length>=72)out.token={mint:bs58.encode(b.subarray(0,32)),
    authority:bs58.encode(b.subarray(32,64)),amount:b.readBigUInt64LE(64).toString()};
  return out;}
async function main(){
  const hist=JSON.parse(fs.readFileSync(path.join(DIR,'paths-grass-admin-drain-json.json')));
  const msg=hist.transaction.message,keys=msg.accountKeys;
  const inner=hist.meta.innerInstructions.flatMap(g=>g.instructions).find(x=>keys[x.programIdIndex]===PROGRAM);
  const original=Buffer.from(bs58.decode(inner.data));
  if(original.subarray(0,8).toString('hex')!=='81eb2ae94adaee1c')throw new Error('unexpected selector');
  const base=[
    {key:MINT,signer:false,writable:false},
    {key:REWARD,signer:false,writable:true},
    {key:VAULT,signer:false,writable:true},
    {key:DEST,signer:false,writable:true},
    {key:ADMIN,signer:true,writable:true},
    {key:CREATE_KEY,signer:false,writable:false},
    {key:TOKEN,signer:false,writable:false},
  ];
  const monitors=[REWARD,VAULT,DEST,ADMIN,CREATE_KEY];
  const pre=await rpc('getMultipleAccounts',[monitors,{encoding:'base64',commitment:'confirmed'}]);
  const before=Object.fromEntries(monitors.map((k,i)=>[k,summary(pre.value[i])]));
  const bh=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const cases=[
    {name:'synthetic_offcurve_admin_signer',mutate:a=>a},
    {name:'admin_not_signer',mutate:a=>{a[4].signer=false;return a;}},
    {name:'foreign_admin_signer',mutate:a=>{a[4].key=PAYER;return a;}},
    {name:'foreign_create_key',mutate:a=>{a[5].key=PAYER;return a;}},
    {name:'foreign_destination',mutate:a=>{a[3].key='4YxvN7qeK9Mk32TzjjKNF72yPBAM4zx5kvV3dQeyMyvF';return a;}},
    {name:'staking_vault_alias',mutate:a=>{a[2].key='GBSdbtzKg6A1a9HM99AvCUWpzXbDq4hbgAX5Q48N7VRK';return a;}},
    {name:'dust_one_raw',mutate:a=>a,data:Buffer.concat([original.subarray(0,9),Buffer.from([1,0,0,0,0,0,0,0])])},
  ];
  const outcomes=[];
  for(const c of cases){const aa=c.mutate(base.map(x=>({...x}))),ix=new web3.TransactionInstruction({
    programId:pk(PROGRAM),keys:aa.map(x=>({pubkey:pk(x.key),isSigner:x.signer,isWritable:x.writable})),
    data:c.data||original});
    const m=new web3.TransactionMessage({payerKey:pk(PAYER),recentBlockhash:bh,instructions:[ix]}).compileToV0Message();
    const raw=Buffer.from(new web3.VersionedTransaction(m).serialize());
    const sim=await rpc('simulateTransaction',[raw.toString('base64'),{encoding:'base64',sigVerify:false,
      replaceRecentBlockhash:true,commitment:'confirmed',minContextSlot:pre.context.slot,
      innerInstructions:true,accounts:{encoding:'base64',addresses:monitors}}]);
    const after=Object.fromEntries(monitors.map((k,i)=>[k,summary(sim.value.accounts?.[i])]));
    const deltas=Object.fromEntries(monitors.map(k=>[k,before[k]?.token&&after[k]?.token?
      (BigInt(after[k].token.amount)-BigInt(before[k].token.amount)).toString():null]));
    outcomes.push({name:c.name,slot:sim.context.slot,error:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
      wireBytes:raw.length,dataHex:(c.data||original).toString('hex'),accounts:aa,
      tokenDeltas:deltas,logs:sim.value.logs,innerInstructions:sim.value.innerInstructions});
    process.stdout.write(`${c.name}: ${JSON.stringify(sim.value.err)}\n`);
  }
  const result={generatedAt:new Date().toISOString(),program:PROGRAM,historicalSignature:HIST,
    historicalSlot:hist.slot,currentReadSlot:pre.context.slot,
    limitation:'Synthetic off-curve signer with sigVerify:false tests program checks only; cannot be submitted or imply Squads approval.',
    before,outcomes};
  fs.writeFileSync(path.join(DIR,'paths-grass-admin-drain-sim.json'),JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
