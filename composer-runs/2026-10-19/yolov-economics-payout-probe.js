#!/usr/bin/env node
// Signed, read-only mainnet simulation; no send RPC methods in this file.
const fs=require('fs');
const path=require('path');
const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const rpcText=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const url=rpcText.split(/\r?\n/).map(x=>x.trim()).find(x=>x.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');
if(!url?.startsWith('https://')) throw new Error('RPC unavailable');
async function rpc(method,params){
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok||body.error)throw new Error(`${method}: ${body.error?.message||response.status}`);
  return body.result;
}
async function probe(name,disc,accounts){
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const instruction=new TransactionInstruction({programId:program,keys:accounts,data:Buffer.from(disc,'hex')});
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:blockhash}).add(instruction);
  tx.sign(wallet);
  const wire=tx.serialize().toString('base64');
  const sim=await rpc('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,
    commitment:'confirmed',innerInstructions:true}]);
  return {name,accountCount:accounts.length,wireBytes:Buffer.from(wire,'base64').length,
    slot:sim.context.slot,error:sim.value.err,units:sim.value.unitsConsumed,
    logs:(sim.value.logs||[]).filter(x=>/Program log:|failed:|success|invoke/.test(x)).slice(-22)};
}
async function probePair(name,steps){
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:blockhash});
  for(const step of steps)tx.add(new TransactionInstruction({programId:program,
    keys:step.accounts,data:Buffer.from(step.disc,'hex')}));
  tx.sign(wallet);
  const wire=tx.serialize().toString('base64');
  const sim=await rpc('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,
    replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:[
      '4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP',
      'DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy']}}]);
  return {name,steps:steps.map(x=>x.name),wireBytes:Buffer.from(wire,'base64').length,
    slot:sim.context.slot,error:sim.value.err,units:sim.value.unitsConsumed,
    logs:(sim.value.logs||[]).filter(x=>/Program log:|failed:|success|invoke/.test(x)).slice(-35),
    postAccountData:(sim.value.accounts||[]).map(a=>a?.data?.[0]||null)};
}
async function main(){
  const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Not mainnet-beta');
  const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,
    method:'simulateTransaction',sigVerify:true,broadcast:false,probes:[]};
  out.probes.push(await probe('process_payout_no_accounts','30c08139e6a1e994',[]));
  out.probes.push(await probe('process_payout_pool_3H7','30c08139e6a1e994',[
    {pubkey:new PublicKey('3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf'),isSigner:false,isWritable:true}
  ]));
  out.probes.push(await probe('process_payout_pool_BXQQ','30c08139e6a1e994',[
    {pubkey:new PublicKey('BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7'),isSigner:false,isWritable:true}
  ]));
  out.probes.push(await probe('process_payout_pool_6gZ','30c08139e6a1e994',[
    {pubkey:new PublicKey('6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX'),isSigner:false,isWritable:true}
  ]));
  out.probes.push(await probe('withdraw_fees_no_accounts','c6d4ab6d90d7ae59',[]));
  const account=(pubkey,isWritable)=>({pubkey:new PublicKey(pubkey),isSigner:false,isWritable});
  const liq={name:'liquidate_position',disc:'bb4ae5956651dd44',accounts:[
    account('3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf',false),
    account('BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7',true),
    account('6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX',true),
    account('DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy',true),
    account('4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP',false),
    account('hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC',true),
    account('5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK',false),
    account('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA',false)]};
  const payout={name:'process_payout_fake_claim',disc:'30c08139e6a1e994',accounts:[
    account('6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX',true),
    account('DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy',true)]};
  out.probes.push(await probePair('liquidate_current_position',[liq]));
  out.probes.push(await probePair('liquidate_then_payout_wrong_claim',[liq,payout]));
  fs.writeFileSync(path.join(__dirname,'yolov-economics-payout-probe.json'),JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(out.probes.map(p=>({name:p.name,slot:p.slot,wireBytes:p.wireBytes,error:p.error,
    units:p.units,lastLogs:p.logs?.slice(-5),postAccounts:p.postAccountData?.map(x=>x?.length||0)}))));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
