#!/usr/bin/env node
// Read-only current ClaimRewards state diff to locate accounting fields.
const fs=require('fs'),path=require('path');
const web3=require('/Users/stacc/ftl/server/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/ftl/server/node_modules/bs58');
const bs=(bs58.default||bs58);
const DIR=__dirname,PROGRAM='EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc';
const SIG='4tdqCnpE3apHWD1nKjAbNnUnjcTteCvAgPm8Kmmfq3rz5oEMWXAAPmRLK7186EcnqvNzCUMSiFdmL2bWYHGtLvaF';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\n/)
  .filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const j=await r.json();
  if(!r.ok||j.error)throw new Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;}
async function main(){
  const tx=await rpc('getTransaction',[SIG,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
  const msg=tx.transaction.message,keys=msg.accountKeys,h=msg.header;
  const c=msg.instructions.find(ix=>keys[ix.programIdIndex]===PROGRAM),
    claim=c.accounts.map(index=>({pubkey:new web3.PublicKey(keys[index]),
      isSigner:index<h.numRequiredSignatures,
      isWritable:index<h.numRequiredSignatures ? index<h.numRequiredSignatures-h.numReadonlySignedAccounts:
        index<keys.length-h.numReadonlyUnsignedAccounts}));
  const user=claim[2].pubkey.toBase58(),pool=claim[1].pubkey.toBase58(),reward=claim[4].pubkey.toBase58(),
    global=claim[3].pubkey.toBase58();
  const monitored=[user,pool,reward,global];
  const pre=await rpc('getMultipleAccounts',[monitored,{encoding:'base64',commitment:'confirmed'}]);
  const bh=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const ix=new web3.TransactionInstruction({programId:new web3.PublicKey(PROGRAM),keys:claim,data:Buffer.from(bs.decode(c.data))});
  const message=new web3.TransactionMessage({payerKey:new web3.PublicKey(keys[0]),recentBlockhash:bh,
    instructions:[ix]}).compileToV0Message();
  const wire=Buffer.from(new web3.VersionedTransaction(message).serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,
    replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:monitored}}]);
  const accounts=monitored.map((key,i)=>{const before=Buffer.from(pre.value[i].data[0],'base64'),
    after=Buffer.from(sim.value.accounts[i].data[0],'base64');let changed=[];
    for(let j=0;j<before.length;j++)if(before[j]!==after[j])changed.push(j);
    let ranges=[];for(const j of changed){const r=ranges.at(-1);if(r&&j<=r[1]+1)r[1]=j;else ranges.push([j,j]);}
    return {key,length:before.length,changedRanges:ranges,beforeBase64:before.toString('base64'),afterBase64:after.toString('base64')};});
  const result={slot:sim.context.slot,error:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
    user,pool,reward,global,accountOrder:claim.map(x=>x.pubkey.toBase58()),accounts};
  fs.writeFileSync(path.join(DIR,'paths-grass-state-diff.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify({slot:result.slot,error:result.error,
    changes:accounts.map(({key,changedRanges})=>({key,changedRanges}))},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
