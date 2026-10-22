const {Connection,PublicKey,TransactionMessage,VersionedTransaction,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const crypto=require('crypto');const fs=require('fs');
const conn=new Connection(process.env.RPC_URL,'confirmed');
const P=x=>new PublicKey(x), pid=P('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi'), token=P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const vault=P('3ESUFCnRNgZ7Mn2mPPUMmXYaKU8jpnV9VtA17M7t2mHQ'), tokenVault=P('C2QoQ111jGHEy5918XkNXQro7gGwC9PKLXd1LqBiYNwA'), lpMint=P('3RpEekjLE5cdcG15YcXJUpxSepemvq2FpmMcgo342BwC');
const victim=P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1'), victimLp=P('EB2N1HtcsFhx1MLs9VgiExoU2AsrMxPbZvCGD7s2yihQ'), victimToken=P('3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf');
const attacker=P('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3'), attackerToken=P('AFrH2rn39AkkAxUAPd88MxAFhRPv7dgZSq4NwP18P6DP');
const otherTokenVault=P('DQjGWHN9ERn1zSMpWLNvSpTFUSfnxbanBt9A7xyU2bVE');
function disc(name){return crypto.createHash('sha256').update('global:'+name).digest().subarray(0,8)}
function u64(n){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b}
function withdraw({signer=victim,destination=victimToken,lp=victimLp,reserve=tokenVault,mint=lpMint,amount=1000000n}={}){
 return new TransactionInstruction({programId:pid,keys:[
  {pubkey:vault,isSigner:false,isWritable:true},{pubkey:reserve,isSigner:false,isWritable:true},{pubkey:mint,isSigner:false,isWritable:true},
  {pubkey:destination,isSigner:false,isWritable:true},{pubkey:lp,isSigner:false,isWritable:true},{pubkey:signer,isSigner:true,isWritable:false},
  {pubkey:token,isSigner:false,isWritable:false}],data:Buffer.concat([disc('withdraw'),u64(amount),u64(0)])});
}
function enable(signer){return new TransactionInstruction({programId:pid,keys:[{pubkey:vault,isSigner:false,isWritable:true},{pubkey:signer,isSigner:true,isWritable:false}],data:Buffer.concat([disc('enable_vault'),Buffer.from([1])])})}
async function simulate(name,ixs,feePayer=victim){
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:feePayer,recentBlockhash:(await conn.getLatestBlockhash('confirmed')).blockhash,instructions:ixs}).compileToV0Message());
 const snapshotAddresses=[victimLp,victimToken,tokenVault];
 const r=await conn.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true,accounts:{encoding:'base64',addresses:snapshotAddresses.map(x=>x.toBase58())}});
 const accounts=r.value.accounts?.map((a,i)=>a?{address:snapshotAddresses[i].toBase58(),owner:a.owner,lamports:a.lamports,tokenAmount:a.owner===token.toBase58()?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():undefined}:null);
 return {name,err:r.value.err,logs:r.value.logs?.filter(x=>x.includes('Program log:')||x.includes('failed')||x.includes('success')).slice(-22),accounts,unitsConsumed:r.value.unitsConsumed};
}
(async()=>{
 const trials=[];
 trials.push(await simulate('owner_withdraw_control',[withdraw()]));
 trials.push(await simulate('outsider_uses_victim_lp',[withdraw({signer:attacker,destination:attackerToken})],attacker));
 trials.push(await simulate('owner_redirects_to_other_owned_account',[withdraw({destination:attackerToken})]));
 trials.push(await simulate('wrong_reserve_vault',[withdraw({reserve:otherTokenVault})]));
 trials.push(await simulate('wrong_lp_mint',[withdraw({mint:P('EZun6G5514FeqYtUv26cBHWLqXjAEdjGuoX6ThBpBtKj')})]));
 trials.push(await simulate('atomic_double_withdraw',[withdraw(),withdraw()]));
 trials.push(await simulate('outsider_admin',[enable(attacker)],attacker));
 fs.writeFileSync(__dirname+'/simulations.json',JSON.stringify(trials,null,2));
 console.log(JSON.stringify(trials.map(t=>({name:t.name,err:t.err,logs:t.logs,tokenAmounts:t.accounts?.map(x=>x?.tokenAmount)})),null,2));
})().catch(e=>{console.error(String(e));process.exitCode=1});
