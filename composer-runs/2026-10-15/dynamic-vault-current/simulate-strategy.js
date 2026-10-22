const {Connection,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');const fs=require('fs'),crypto=require('crypto');
const conn=new Connection(process.env.RPC_URL,'confirmed'),P=x=>new PublicKey(x),pid=P('24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi');
const operator=P('2nGpQ5VarkUBPidNgcvMc7JH5ctkRFX4bbtByFjntJQd'),outsider=P('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3');
async function historicalIx(signature){
 const tx=await conn.getParsedTransaction(signature,{maxSupportedTransactionVersion:1,commitment:'confirmed'});
 const ix=tx.transaction.message.instructions.find(x=>x.programId.equals(pid));
 const flags=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey.toBase58(),{isSigner:x.signer,isWritable:x.writable}]));
 return {slot:tx.slot,ix:new TransactionInstruction({programId:pid,keys:ix.accounts.map(a=>({pubkey:a,...flags.get(a.toBase58())})),data:Buffer.from(bs58.decode(ix.data))})};
}
async function run(name,ix,feePayer){
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:feePayer,recentBlockhash:(await conn.getLatestBlockhash('confirmed')).blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:1000000}),ix]}).compileToV0Message());
 const r=await conn.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true});
 return {name,err:r.value.err,logs:r.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('Error')||x.includes('failed')||x.includes('success')).slice(-22),unitsConsumed:r.value.unitsConsumed};
}
(async()=>{
 const dep=await historicalIx('2xBSwsUhAD6Qej3aAnsKWVygzMZdCpfhytuzL3CdgGLX9VR4JfH6vr8TdN3RTFSw4nS4SJKeMGAZ6fg5VSb3sZK1');
 const wit=await historicalIx('2MBg4UGVEXGVrkpQAfmK1Sgz91jzbVryR2evs449GKz1t7ae8KMCccwXwJDRBi3RTL1wFVXJ2iQT6Lif3T33x9Qy');
 const trials=[];trials.push(await run('deposit_strategy_operator_control',dep.ix,operator));
 const outsiderIx=new TransactionInstruction({programId:pid,keys:dep.ix.keys.map((x,i)=>i===9?{...x,pubkey:outsider,isSigner:true}:x),data:dep.ix.data});
 trials.push(await run('deposit_strategy_outsider',outsiderIx,outsider));
 const otherStrategy=P('uVKHtBi36zXbcKKpSDKMVP3Vqbah8pshYqCqyoaV8ui');
 const wrongStrategy=new TransactionInstruction({programId:pid,keys:dep.ix.keys.map((x,i)=>i===1?{...x,pubkey:otherStrategy}:x),data:dep.ix.data});
 trials.push(await run('deposit_strategy_wrong_vault_strategy',wrongStrategy,operator));
 const withdraw1=new TransactionInstruction({programId:pid,keys:wit.ix.keys,data:Buffer.concat([wit.ix.data.subarray(0,8),Buffer.alloc(8)])});withdraw1.data.writeBigUInt64LE(1000000n,8);
 trials.push(await run('withdraw_strategy_control_1usdc',withdraw1,operator));
 const directKeys=[wit.ix.keys[0],wit.ix.keys[1],wit.ix.keys[7],wit.ix.keys[5],wit.ix.keys[6],wit.ix.keys[2],wit.ix.keys[4],wit.ix.keys[3],
  {pubkey:P('3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf'),isSigner:false,isWritable:true},
  {pubkey:P('EB2N1HtcsFhx1MLs9VgiExoU2AsrMxPbZvCGD7s2yihQ'),isSigner:false,isWritable:true},
  {pubkey:P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1'),isSigner:true,isWritable:false},
  wit.ix.keys[8],...wit.ix.keys.slice(10)];
 const directData=Buffer.alloc(24);crypto.createHash('sha256').update('global:withdraw_directly_from_strategy').digest().copy(directData,0,0,8);directData.writeBigUInt64LE(1000000n,8);
 const direct=new TransactionInstruction({programId:pid,keys:directKeys,data:directData});
 trials.push(await run('direct_strategy_withdraw_owner_control',direct,P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1')));
 const wrongOwner=new TransactionInstruction({programId:pid,keys:directKeys.map((x,i)=>i===8?{...x,pubkey:P('AFrH2rn39AkkAxUAPd88MxAFhRPv7dgZSq4NwP18P6DP')}:i===10?{...x,pubkey:outsider}:x),data:directData});
 trials.push(await run('direct_strategy_withdraw_outsider',wrongOwner,outsider));
 fs.writeFileSync(__dirname+'/strategy-simulations.json',JSON.stringify({historicalSlots:{deposit:dep.slot,withdraw:wit.slot},trials},null,2));
 console.log(JSON.stringify({historicalSlots:{deposit:dep.slot,withdraw:wit.slot},trials},null,2));
})().catch(e=>{console.error(String(e));process.exitCode=1});
