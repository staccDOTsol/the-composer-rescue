#!/usr/bin/env node
'use strict';
// Single outsider mutation on current mainnet-beta. simulateTransaction only.
const fs=require('fs');const crypto=require('crypto');
const mod='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Connection,PublicKey,Keypair,TransactionInstruction,TransactionMessage,VersionedTransaction}=require(mod+'@solana/web3.js');
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,TOKEN_PROGRAM_ID}=require(mod+'@solana/spl-token');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split(/\r?\n/).filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const rpcUrl=env.HEAVY_RPC_URL||env.RPC_URL;
if(!rpcUrl)throw Error('RPC URL unavailable');
const conn=new Connection(rpcUrl,'confirmed');
const P=s=>new PublicKey(s),S=x=>x.toBase58();
const program=P('tbg7LYoHuCogZ54p6z6BaALBiyXy9b7hN368EHGh3EE');
const mint=P('G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG');
const config=P('GcqAvs4CsY86eWQzaEqEsg2CYSKYdLfkGtCrPUL9sjpJ');
const vault=P('5xi165ttDbd1cN4ot4zLMWE59FMLM7dAeTECsGWqQcMz');
const destinationAuthority=P('Ahe9AL4RQFU6DiuqLBctokfv2YDRqxoNNPL6KM4vWC1V');
const depositor=P('LZxsvsaXKA4WHiXxyJB5gxTsiWNidiiz3Qm46j3wpZZ');
const depositorStake=P('FWbL7ozRuZpn8HAVgUEeuA1K9pWobzTLAPZ6Pr26SnLe');
const sourceWithdraw='5TJfUTBWNDDXHvM2hHaBFCYUhvppriPcoqdCtL2V3AtSjJNsgBYyKSvsje9VWnp7KofEDXMZ8ZwntSC3Ct9wAFcW';
const sourceDeposit='EA1Vj2sYyTdXQr6KniDoArLfqL6ShMNLX47qXDw1TCXz9D8Cpzihc5aUMpFtjbRt8bW6xjzJyqhMqvBKJ6gWMg9';
const ata=getAssociatedTokenAddressSync(mint,wallet.publicKey);
let rpcId=0;
async function rpc(method,params){
 const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
 const j=await r.json();if(j.error)throw Error(method+': '+JSON.stringify(j.error));return j.result;
}
function assert(ok,msg){if(!ok)throw Error('validation: '+msg)}
function keyAt(data,at){return new PublicKey(data.subarray(at,at+32))}
function token(a){if(!a)return null;const d=a.data;
 assert(S(a.owner)===S(TOKEN_PROGRAM_ID)&&d.length>=72,'invalid token-account owner/layout');
 return{mint:S(keyAt(d,0)),owner:S(keyAt(d,32)),raw:d.readBigUInt64LE(64).toString()};}
function rpcAccount(a){if(!a)return null;const d=Buffer.from(a.data[0],'base64');
 return{owner:a.owner,lamports:a.lamports,data:d,executable:a.executable};}
function image(address,a){const raw=rpcAccount(a);if(!raw)return{address,exists:false,lamports:0,tokenRaw:null};
 return{address,exists:true,lamports:raw.lamports,owner:raw.owner,
  tokenRaw:raw.owner===S(TOKEN_PROGRAM_ID)&&raw.data.length>=72?raw.data.readBigUInt64LE(64).toString():null,
  tokenMint:raw.owner===S(TOKEN_PROGRAM_ID)&&raw.data.length>=72?S(keyAt(raw.data,0)):null};}
async function main(){
 const [programAcc,configAcc,stakeAcc,vaultAcc,mintAcc,ataAcc,walletAcc,sourceTx,depositTx]=await Promise.all([
  conn.getAccountInfo(program,'confirmed'),conn.getAccountInfo(config,'confirmed'),conn.getAccountInfo(depositorStake,'confirmed'),
  conn.getAccountInfo(vault,'confirmed'),conn.getAccountInfo(mint,'confirmed'),conn.getAccountInfo(ata,'confirmed'),
  conn.getAccountInfo(wallet.publicKey,'confirmed'),
  conn.getParsedTransaction(sourceWithdraw,{commitment:'confirmed',maxSupportedTransactionVersion:1}),
  conn.getParsedTransaction(sourceDeposit,{commitment:'confirmed',maxSupportedTransactionVersion:1})]);
 assert(programAcc?.executable&&S(programAcc.owner)==='BPFLoaderUpgradeab1e11111111111111111111111','deployed program');
 assert(configAcc&&S(configAcc.owner)===S(program)&&configAcc.data.length===162,'config owner/layout');
 assert(stakeAcc&&S(stakeAcc.owner)===S(program)&&stakeAcc.data.length===49,'stake owner/layout');
 assert(vaultAcc&&mintAcc,'mint/vault missing');
 const [derivedConfig,configBump]=PublicKey.findProgramAddressSync([Buffer.from('config')],program);
 const [derivedStake,stakeBump]=PublicKey.findProgramAddressSync([Buffer.from('stake'),depositor.toBuffer()],program);
 const [walletStake]=PublicKey.findProgramAddressSync([Buffer.from('stake'),wallet.publicKey.toBuffer()],program);
 const walletStakeAcc=await conn.getAccountInfo(walletStake,'confirmed');
 assert(derivedConfig.equals(config)&&derivedStake.equals(depositorStake),'PDA seed relation');
 assert(keyAt(stakeAcc.data,8).equals(depositor),'stake record owner');
 assert(keyAt(configAcc.data,72).equals(destinationAuthority),'configured authority account');
 assert(keyAt(configAcc.data,104).equals(vault),'configured vault');
 const pool=token(vaultAcc);assert(pool.mint===S(mint)&&pool.owner===S(config),'vault mint/authority');
 assert(S(mintAcc.owner)===S(TOKEN_PROGRAM_ID)&&mintAcc.data.length===82&&mintAcc.data[45]===1,'mint owner/layout/initialization');
 const mintDecimals=mintAcc.data[44];assert(mintDecimals===6,'mint decimals');
 if(ataAcc){const t=token(ataAcc);assert(t.mint===S(mint)&&t.owner===S(wallet.publicKey),'wallet ATA mint/owner');}
 assert(sourceTx&&depositTx&&sourceTx.slot>442000000&&depositTx.slot>442000000,'post-deploy source transactions');
 const sourceIx=sourceTx.transaction.message.instructions.find(x=>S(x.programId)===S(program));
 const depositIx=depositTx.transaction.message.instructions.find(x=>S(x.programId)===S(program));
 assert(sourceIx&&depositIx&&S(depositIx.accounts[0])===S(depositor)&&S(depositIx.accounts[6])===S(depositorStake),'source deposit position');
 const oldData=Buffer.from((require(mod+'bs58').default||require(mod+'bs58')).decode(sourceIx.data));
 assert(oldData.length===16&&oldData.subarray(0,8).equals(crypto.createHash('sha256').update('global:withdraw').digest().subarray(0,8)),'withdraw selector/layout');
 assert(stakeAcc.data.readBigUInt64LE(40)>=1_000_000n,'selected stake has at least 1 BIRB');
 const data=Buffer.from(oldData);data.writeBigUInt64LE(1_000_000n,8);
 const keys=sourceIx.accounts.map((a,i)=>({pubkey:i===0?wallet.publicKey:i===4?ata:i===6?depositorStake:a,
  isSigner:i===0,isWritable:[0,1,2,4,5,6].includes(i)}));
 assert(keys.length===9&&S(keys[1].pubkey)===S(config)&&S(keys[2].pubkey)===S(destinationAuthority)&&
  S(keys[3].pubkey)===S(mint)&&S(keys[5].pubkey)===S(vault),'withdraw account order');
 const ixs=[];
 if(!ataAcc)ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey,ata,wallet.publicKey,mint));
 ixs.push(new TransactionInstruction({programId:program,keys,data}));
 const watch=[wallet.publicKey,ata,vault,depositorStake,config,destinationAuthority];const addresses=watch.map(S);
 const preRpc=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
 const pre=preRpc.value.map((a,i)=>image(addresses[i],a));
 const bh=(await conn.getLatestBlockhash('confirmed')).blockhash;
 const msg=new TransactionMessage({payerKey:wallet.publicKey,recentBlockhash:bh,instructions:ixs}).compileToV0Message();
 const tx=new VersionedTransaction(msg);tx.sign([wallet]);
 const wire=Buffer.from(tx.serialize());
 const sim=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
  replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true,
  accounts:{encoding:'base64',addresses}}]);
 // On a failed transaction this RPC returns null for every simulated account.
 // Use a separate read-only chain snapshot for actual pre/post reconciliation.
 const simulatedPostAvailable=(sim.value.accounts||[]).some(Boolean);
 const simulatedPost=simulatedPostAvailable?(sim.value.accounts||[]).map((a,i)=>image(addresses[i],a)):null;
 const postRpc=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}]);
 const postChain=postRpc.value.map((a,i)=>image(addresses[i],a));
 const amountDelta=(before,after)=>!before?.exists&&!after?.exists?'0':before?.tokenRaw!=null&&after?.tokenRaw!=null?
  (BigInt(after.tokenRaw)-BigInt(before.tokenRaw)).toString():
  !before?.exists&&after?.tokenRaw!=null?after.tokenRaw:
  before?.tokenRaw!=null&&!after?.exists?(-BigInt(before.tokenRaw)).toString():null;
 const preStakeRaw=rpcAccount(preRpc.value[3])?.data.readBigUInt64LE(40).toString();
 const postStakeRaw=rpcAccount(postRpc.value[3])?.data.readBigUInt64LE(40).toString();
 const chainDelta={walletBirbRaw:amountDelta(pre[1],postChain[1]),vaultBirbRaw:amountDelta(pre[2],postChain[2]),
  walletLamports:pre[0]&&postChain[0]?postChain[0].lamports-pre[0].lamports:null,
  destinationAuthorityLamports:pre[5]&&postChain[5]?postChain[5].lamports-pre[5].lamports:null,
  stakeRecordedRaw:preStakeRaw!=null&&postStakeRaw!=null?(BigInt(postStakeRaw)-BigInt(preStakeRaw)).toString():null};
 const pd=S(keyAt(programAcc.data,4));
 const programdata=await rpc('getAccountInfo',[pd,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:12}}]);
 const pdBytes=Buffer.from(programdata.value.data[0],'base64');
 const out={observedAtUtc:new Date().toISOString(),network:'mainnet-beta',simulationSlot:sim.context.slot,
  program:S(program),programdata:pd,lastDeploySlot:pdBytes.readBigUInt64LE(4).toString(),
  sourceWithdraw,sourceWithdrawSlot:sourceTx.slot,sourceDeposit,sourceDepositSlot:depositTx.slot,
  signer:S(wallet.publicKey),attemptedWithdrawBirbRaw:'1000000',
  validation:{configPda:S(config),configBump,stakePda:S(depositorStake),stakeBump,
   stakeOwner:S(depositor),stakeRecordedRaw:stakeAcc.data.readBigUInt64LE(40).toString(),
   walletStakePda:S(walletStake),walletStakeExists:!!walletStakeAcc,
   configuredVault:S(vault),vaultAuthority:pool.owner,mint:S(mint),mintDecimals,
   mintSupplyRaw:mintAcc.data.readBigUInt64LE(36).toString(),walletAta:S(ata),walletAtaExisted:!!ataAcc,
   poolVaultRaw:pool.raw},
  packet:{bytes:wire.length,keys:msg.staticAccountKeys.length,instructions:ixs.length,
   signerCount:msg.header.numRequiredSignatures,sigVerify:true,sha256:crypto.createHash('sha256').update(wire).digest('hex')},
  simulation:{error:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
   logs:sim.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('Error')||x.includes('failed')||x.includes('Program log:')),
   simulatedPostAvailable,simulatedPost,
   chainPre:{slot:preRpc.context.slot,accounts:pre,stakeRecordedRaw:preStakeRaw},
   chainPost:{slot:postRpc.context.slot,accounts:postChain,stakeRecordedRaw:postStakeRaw},
   chainDelta,lenders:[],debtRaw:'0'},mainnetSubmitted:false,syntheticBalances:false};
 fs.writeFileSync(__dirname+'/birb-outsider-mainnet-signed.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({slot:out.simulationSlot,lastDeploySlot:out.lastDeploySlot,
  stakeRaw:out.validation.stakeRecordedRaw,walletStakeExists:out.validation.walletStakeExists,
  packet:out.packet,error:out.simulation.error,chainDelta:out.simulation.chainDelta,
  preSlot:out.simulation.chainPre.slot,postSlot:out.simulation.chainPost.slot,
  simulatedPostAvailable:out.simulation.simulatedPostAvailable,logs:out.simulation.logs},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
