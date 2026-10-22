#!/usr/bin/env node
// Bounded direct USDv/USDC swap screen, signed by a fresh outsider on Surfpool.
// Trader inventory is synthetic fork state; no mainnet transaction or flash loan.
const fs=require('fs');
const m='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(m+'@solana/web3.js');
const bmod=require(m+'bs58'),bs58=bmod.default||bmod;
const program='Archer8kgiavM61GyusMzaaS2ft5sALtNsD1HxkUPMhy';
const signature='4DCbYsC5nVftWBdyGctet3hoLC2HNKPH9myx6vC8C8QXmnqFEdkZfiFUzNPKHKffrKv1Soh3obEdrvZWe1niFCme';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');const fork='http://127.0.0.1:9397';let id=0;
async function rpc(method,params){const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result}
const amount=x=>x?Buffer.from(x.data[0],'base64').readBigUInt64LE(64):null;
async function main(){
 const t=await mainnet.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
 const x=t.meta.innerInstructions.flatMap(g=>g.instructions).find(x=>x.programId.toBase58()===program);
 if(!x||x.accounts.length!==12)throw Error('historical swap unavailable');
 const attacker=Keypair.generate(),usdc=Keypair.generate().publicKey,usdv=Keypair.generate().publicKey;
 const templates=await mainnet.getMultipleAccountsInfo([x.accounts[2],x.accounts[7]],'confirmed');
 await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 for(const [address,template,balance] of [[usdc,templates[0],100_000_000_000n],[usdv,templates[1],0n]]){
  const data=Buffer.from(template.data);attacker.publicKey.toBuffer().copy(data,32);data.writeBigUInt64LE(balance,64);
  await rpc('surfnet_setAccount',[address.toBase58(),{data:data.toString('hex'),executable:false,
   lamports:template.lamports,owner:template.owner.toBase58(),rentEpoch:0}]);
 }
 const flags=Object.fromEntries(t.transaction.message.accountKeys.map(x=>[x.pubkey.toBase58(),x]));
 const keys=x.accounts.map((a,i)=>({pubkey:i===0?attacker.publicKey:(i===2||i===8)?usdc:i===7?usdv:a,
  isSigner:i===0,isWritable:!!flags[a.toBase58()]?.writable}));
 for(const a of [new PublicKey(program),...keys.map(k=>k.pubkey)])await rpc('getAccountInfo',[a.toBase58(),{encoding:'base64',commitment:'processed'}]);
 const addresses=[usdc.toBase58(),usdv.toBase58(),x.accounts[5].toBase58(),x.accounts[6].toBase58()];
 const initial=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'processed'}]);
 const results=[];
 for(const micro of [1_000_000n,25_000_025n,1_000_000_000n,10_000_000_000n,80_000_000_000n]){
  const data=Buffer.from(bs58.decode(x.data));data.writeBigUInt64LE(micro,1);
  const ix=new TransactionInstruction({programId:new PublicKey(program),keys,data});
  const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const msg=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:bh,instructions:[ix]}).compileToV0Message();
  const signed=new VersionedTransaction(msg);signed.sign([attacker]);const wire=Buffer.from(signed.serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
   replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses}}]);
  const deltas=(sim.value.accounts||[]).map((a,i)=>a?(amount(a)-amount(initial.value[i])).toString():null);
  results.push({micro:micro.toString(),err:sim.value.err,bytes:wire.length,keys:msg.staticAccountKeys.length,
   units:sim.value.unitsConsumed,deltas,logs:sim.value.logs});
  console.log(JSON.stringify({micro:micro.toString(),err:sim.value.err,deltas,bytes:wire.length,tail:sim.value.logs?.slice(-3)}));
 }
 fs.writeFileSync(__dirname+'/archer-usdv-direct-signed.json',JSON.stringify({generatedAt:new Date().toISOString(),
  program,sourceSignature:signature,sourceSlot:t.slot,attacker:attacker.publicKey.toBase58(),
  syntheticTraderAccounts:true,syntheticUsdcMicro:'100000000000',sigVerify:true,
  mainnetSubmitted:false,forkSubmitted:false,results},null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
