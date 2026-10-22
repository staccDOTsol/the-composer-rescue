#!/usr/bin/env node
// Signed read-only mainnet simulations with observed liquidation account shape.
const fs=require('fs');const path=require('path');const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const rpcText=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');
const url=rpcText.split(/\r?\n/).map(x=>x.trim()).find(x=>x.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');if(!url?.startsWith('https://'))throw new Error('RPC unavailable');
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error?.message||String(r.status));return j.result;}
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const base=['3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf','BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7','6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX','DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy','4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK','yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA'];
const cases=[
 ['closed_correctBTC','hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC','DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy'],
 ['closed_SOLoracle','FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh','DfRowffc5W5zSdjAoEcoWuQjwgvXnqecyBMzPTYu9Qmy'],
 ['active_correctBTC','hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC','9qBvkWum5thhXo5w6fZRTejFFk1DwkhUsnNndHdLpzZW'],
 ['active_SOLoracle','FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh','9qBvkWum5thhXo5w6fZRTejFFk1DwkhUsnNndHdLpzZW'],
 ['active_ETHoracle','AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1','9qBvkWum5thhXo5w6fZRTejFFk1DwkhUsnNndHdLpzZW'],
 ['active_wallet',wallet.publicKey.toBase58(),'9qBvkWum5thhXo5w6fZRTejFFk1DwkhUsnNndHdLpzZW']
];
(async()=>{const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Not mainnet-beta');const rows=[];
 for(const [name,oracle,position] of cases){const a=[...base];a[5]=oracle;a[3]=position;
  const keys=a.map((pubkey,i)=>({pubkey:new PublicKey(pubkey),isSigner:false,isWritable:[1,2,3,5].includes(i)}));
  const ix=new TransactionInstruction({programId:program,keys,data:Buffer.from('bb4ae5956651dd44','hex')});
  const bh=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:bh}).add(ix);tx.sign(wallet);const wire=tx.serialize();
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true}]);
  rows.push({name,oracle,position,slot:sim.context.slot,error:sim.value.err,units:sim.value.unitsConsumed,wireBytes:wire.length,
   logs:(sim.value.logs||[]).filter(x=>/Program log:|failed:|success|invoke/.test(x))});
 }
 const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,method:'simulateTransaction',sigVerify:true,broadcast:false,rows};fs.writeFileSync(path.join(__dirname,'yolov-economics-oracle-binding.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(rows));
})().catch(e=>{console.error(e.message);process.exitCode=1});
