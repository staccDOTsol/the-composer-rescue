#!/usr/bin/env node
// Read-only signed simulations against every live yoLov account type as ProcessPayout claim.
const fs=require('fs');const path=require('path');
const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const rpcText=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const url=rpcText.split(/\r?\n/).map(x=>x.trim()).find(x=>x.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');
if(!url?.startsWith('https://'))throw new Error('RPC unavailable');
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error?.message||String(r.status));return j.result;}
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const pool=new PublicKey('6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX');
const candidates=[
 ['Pool','6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX'],
 ['Config','3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf'],
 ['Market','BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7'],
 ['Position120','DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy'],
 ['Position114','CWEBnYiodEqxLbYEZw4jgn8VqLdXu8RBTtDGNygZJUbJ']
];
(async()=>{
 const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Not mainnet-beta');
 const rows=[];for(const [type,key] of candidates){
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const ix=new TransactionInstruction({programId:program,keys:[{pubkey:pool,isSigner:false,isWritable:true},{pubkey:new PublicKey(key),isSigner:false,isWritable:true}],data:Buffer.from('30c08139e6a1e994','hex')});
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:blockhash}).add(ix);tx.sign(wallet);
  const wire=tx.serialize();const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed'}]);
  rows.push({type,key,slot:sim.context.slot,error:sim.value.err,units:sim.value.unitsConsumed,wireBytes:wire.length,logs:(sim.value.logs||[]).filter(x=>/Program log:|failed:|success/.test(x))});
 }
 const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,method:'simulateTransaction',sigVerify:true,broadcast:false,rows};
 fs.writeFileSync(path.join(__dirname,'yolov-economics-claim-types.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(rows.map(x=>({type:x.type,slot:x.slot,error:x.error,logs:x.logs}))));
})().catch(e=>{console.error(e.message);process.exitCode=1});
