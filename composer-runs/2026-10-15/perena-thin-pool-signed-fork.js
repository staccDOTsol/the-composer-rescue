#!/usr/bin/env node
// Bounded outsider-signed Perena NUMERUN direct-swap screen on localhost Surfpool.
// Trader token accounts and USDC inventory are synthetic fork fixtures. No mainnet send.
const fs=require('fs');
const m='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram}=require(m+'@solana/web3.js');
const bs58mod=require(m+'bs58'),bs58=bs58mod.default||bs58mod;
const prog='NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P';
const signature='4B99PzQefei6fRphWjVHgm2VHtoSq93EnrPmZCfkUvQaaj5fMx7dkuJxBNAU5fqKJ7Mnz7n57hTcPKrJU66BBzTG';
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=new Connection(env.HEAVY_RPC_URL||env.RPC_URL,'confirmed');
const fork='http://127.0.0.1:9397';
let rpcId=0;
async function rpc(method,params){
 const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
const pk=s=>new PublicKey(s);
function amountFromAccount(row){return row?Buffer.from(row.data[0],'base64').readBigUInt64LE(64):null}
async function main(){
 const tx=await mainnet.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:1});
 if(!tx||tx.meta.err)throw Error('historical route unavailable');
 const source=tx.meta.innerInstructions.flatMap(x=>x.instructions)
  .filter(x=>x.programId.toBase58()===prog);
 if(source.length!==2)throw Error('expected two Perena swaps');
 const trader=Keypair.generate(),usdc=Keypair.generate().publicKey,ausd=Keypair.generate().publicKey;
 const oldUsdc=source[0].accounts[3].toBase58(),oldAusd=source[0].accounts[4].toBase58();
 const templates=await mainnet.getMultipleAccountsInfo([pk(oldUsdc),pk(oldAusd)],'confirmed');
 if(templates.some(x=>!x))throw Error('trader templates unavailable');
 await rpc('surfnet_setAccount',[trader.publicKey.toBase58(),{
  data:'',executable:false,lamports:1_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 for(const [address,template,value] of [[usdc,templates[0],10_000_000_000n],[ausd,templates[1],0n]]){
  const data=Buffer.from(template.data);trader.publicKey.toBuffer().copy(data,32);data.writeBigUInt64LE(value,64);
  await rpc('surfnet_setAccount',[address.toBase58(),{data:data.toString('hex'),executable:false,
   lamports:template.lamports,owner:template.owner.toBase58(),rentEpoch:0}]);
 }
 const vaults=[source[0].accounts[5].toBase58(),source[0].accounts[6].toBase58()];
 const addresses=[usdc.toBase58(),ausd.toBase58(),...vaults];
 const initial=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'processed'}]);
 function ix(template,microAmount){
  const keys=template.accounts.map((key,i)=>({
   pubkey:i===3?(template.accounts[1].toBase58()==='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'?usdc:ausd):
    i===4?(template.accounts[2].toBase58()==='AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9'?ausd:usdc):
    i===8?trader.publicKey:key,
   isSigner:i===8,isWritable:i<=6||i===8}));
  const data=Buffer.from(bs58.decode(template.data));data.writeBigUInt64LE(BigInt(microAmount),10);
  return new TransactionInstruction({programId:pk(prog),keys,data});
 }
 async function simulate(instructions){
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const message=new TransactionMessage({payerKey:trader.publicKey,recentBlockhash:blockhash,
   instructions}).compileToV0Message();
  const signed=new VersionedTransaction(message);signed.sign([trader]);
  const wire=Buffer.from(signed.serialize());
  const sim=await rpc('simulateTransaction',[wire.toString('base64'),{
   encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',
   accounts:{encoding:'base64',addresses}}]);
  const after=sim.value.accounts?.map(amountFromAccount)||[];
  return {err:sim.value.err,bytes:wire.length,keys:message.staticAccountKeys.length,
   units:sim.value.unitsConsumed,
   deltas:after.map((x,i)=>x===null?null:(x-amountFromAccount(initial.value[i])).toString()),
   logs:(sim.value.logs||[]).filter(x=>/Instruction:|Error|error|failed|consumed/.test(x))};
 }
 const results=[];
 for(const amount of [1_000_000n,100_000_000n,1_000_000_000n,3_000_000_000n,10_000_000_000n]){
  const single=await simulate([ix(source[0],amount)]);
  let cycle=null;
  if(!single.err&&single.deltas?.[1]&&BigInt(single.deltas[1])>0n)
   cycle=await simulate([ix(source[0],amount),ix(source[1],BigInt(single.deltas[1]))]);
  results.push({inputUsdcMicro:amount.toString(),single,cycle});
  console.log(JSON.stringify({inputUsdc:amount.toString(),single:{err:single.err,deltas:single.deltas,bytes:single.bytes},cycle:cycle&&{err:cycle.err,deltas:cycle.deltas,bytes:cycle.bytes}}));
 }
 const out={generatedAt:new Date().toISOString(),program:prog,sourceSignature:signature,sourceSlot:tx.slot,
  pool:source[0].accounts[0].toBase58(),trader:trader.publicKey.toBase58(),syntheticTokenAccounts:true,
  syntheticUsdcMicro:'10000000000',sigVerify:true,mainnetSubmitted:false,forkSubmitted:false,
  initialVaultAmounts:vaults.map((v,i)=>({vault:v,amount:amountFromAccount(initial.value[i+2]).toString()})),results};
 fs.writeFileSync(__dirname+'/perena-thin-pool-signed-fork.json',JSON.stringify(out,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
