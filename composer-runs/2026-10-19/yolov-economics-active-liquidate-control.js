#!/usr/bin/env node
// Read-only mainnet simulation, signed by hooked wallet. Never sends transaction.
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const e=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8');const url=e.split(/\r?\n/).map(x=>x.trim()).find(x=>x.startsWith('export SOLANA_RPC='))?.slice('export SOLANA_RPC='.length).trim().replace(/^['"]|['"]$/g,'');if(!url?.startsWith('https://'))throw new Error('RPC unavailable');
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error?.message||String(r.status));return j.result;}
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const a=['3H7xnnaW7LwVVMcBqJSG8PTH2zjJnwyjRzKESvi51xuf','BXQQo2VTJV2upjdA6qFMGBY3uMyTMnRmaZjPCB5ZVmr7','6gZ56UYfVGgw8p3B6UEHQmM4CrHsfzQgYWkdFg7gMNNX','9qBvkWum5thhXo5w6fZRTejFFk1DwkhUsnNndHdLpzZW','4JC3vamWCnD4WwmJQyykBmXHbXjPyH9LiW6tEtniMvZP','hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC','5dw5o617DrzUV2RWXjmBkmk1Fc67uaGcKTVxoxV8CYrK','yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA'];
const watch=[a[1],a[2],a[3],a[4],wallet.publicKey.toBase58()];
function summarize(x,addr){if(!x)return null;const b=Buffer.from(x.data[0],'base64');return{address:addr,owner:x.owner,lamports:x.lamports,dataLength:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),dataHex:b.length<256?b.toString('hex'):undefined,tokenRaw:addr===a[4]?b.readBigUInt64LE(64).toString():undefined};}
(async()=>{
 const genesis=await rpc('getGenesisHash',[]);if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Not mainnet-beta');
 const pre=await rpc('getMultipleAccounts',[watch,{encoding:'base64',commitment:'confirmed'}]);
 const bh=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
 const keys=a.map((pubkey,i)=>({pubkey:new PublicKey(pubkey),isSigner:false,isWritable:[1,2,3,5].includes(i)}));
 const ix=new TransactionInstruction({programId:program,keys,data:Buffer.from('bb4ae5956651dd44','hex')});const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:bh}).add(ix);tx.sign(wallet);const wire=tx.serialize();
 const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:watch}}]);
 const before=pre.value.map((x,i)=>summarize(x,watch[i]));const after=sim.value.accounts.map((x,i)=>summarize(x,watch[i]));
 const changes=before.map((b,i)=>({address:b.address,beforeSha:b.sha256,afterSha:after[i]?.sha256,dataChanged:b.sha256!==after[i]?.sha256,lamportsBefore:b.lamports,lamportsAfter:after[i]?.lamports,tokenRawBefore:b.tokenRaw,tokenRawAfter:after[i]?.tokenRaw}));
 const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,method:'simulateTransaction',sigVerify:true,broadcast:false,preSlot:pre.context.slot,simSlot:sim.context.slot,position:a[3],wireBytes:wire.length,error:sim.value.err,units:sim.value.unitsConsumed,logs:sim.value.logs,innerInstructions:sim.value.innerInstructions,changes,before,after};fs.writeFileSync(path.join(__dirname,'yolov-economics-active-liquidate-control.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({preSlot:out.preSlot,simSlot:out.simSlot,error:out.error,units:out.units,changes,logs:out.logs}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
