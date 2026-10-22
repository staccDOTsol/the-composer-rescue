const fs=require('fs'),crypto=require('crypto');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction}=
 require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const source=require('./kamino-flash-history.json').hits[0].transaction;
const mapping=require('./scope-live-mapping-census.json').mappings.find(m=>m.address==='D66o6ybaEuMpBrHRRyQw7Xf3qmmHm6niJpjKaztQZBDF');
const pk=s=>new PublicKey(s),payer=pk(source.transaction.message.accountKeys[0]);
function fromSample(index){
 const m=source.transaction.message,sw=source.meta.loadedAddresses?.writable||[],sr=source.meta.loadedAddresses?.readonly||[],all=[...m.accountKeys,...sw,...sr],ix=m.instructions[index],h=m.header;
 const signer=j=>j<h.numRequiredSignatures;
 const writable=j=>j<m.accountKeys.length?(signer(j)?j<h.numRequiredSignatures-h.numReadonlySignedAccounts:j<m.accountKeys.length-h.numReadonlyUnsignedAccounts):j<m.accountKeys.length+sw.length;
 return new TransactionInstruction({programId:pk(all[ix.programIdIndex]),data:Buffer.from(bs58.decode(ix.data)),keys:ix.accounts.map(j=>({pubkey:pk(all[j]),isSigner:signer(j),isWritable:writable(j)}))});
}
function withAmount(ix,amount,borrowIndex){const d=Buffer.from(ix.data);d.writeBigUInt64LE(amount,8);if(borrowIndex!==undefined)d[16]=borrowIndex;return new TransactionInstruction({programId:ix.programId,keys:ix.keys,data:d})}
const amount=100000n,borrow=withAmount(fromSample(3),amount),repay=fromSample(13);
function scopeRefresh(){const d=Buffer.alloc(16);crypto.createHash('sha256').update('global:refresh_price_list').digest().copy(d,0,0,8);d.writeUInt32LE(2,8);d.writeUInt16LE(1,12);d.writeUInt16LE(2,14);
 return new TransactionInstruction({programId:pk('HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ'),data:d,keys:[
  {pubkey:pk(mapping.oraclePrices),isSigner:false,isWritable:true},{pubkey:pk(mapping.address),isSigner:false,isWritable:false},
  {pubkey:pk(mapping.oracleTwaps),isSigner:false,isWritable:true},{pubkey:pk('Sysvar1nstructions1111111111111111111111111'),isSigner:false,isWritable:false},
  ...[1,2].map(i=>({pubkey:pk(mapping.ammEntries.find(x=>x.index===i).pool),isSigner:false,isWritable:false}))]});
}
async function rpc(method,params){const x=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}).then(x=>x.json());if(x.error)throw Error(JSON.stringify(x.error));return x.result}
function tokenAmount(account){if(!account)return null;const d=Buffer.from(account.data[0],'base64');return d.readBigUInt64LE(64).toString()}
async function main(){
 const monitor=[borrow.keys[5].pubkey.toBase58(),borrow.keys[6].pubkey.toBase58(),borrow.keys[7].pubkey.toBase58()];
 const pre=await rpc('getMultipleAccounts',[monitor,{encoding:'base64',commitment:'confirmed'}]);const before=pre.value.map(tokenAmount);
 const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash,sr=scopeRefresh();const results=[];
 for(const [name,ixs] of [['flash_pair',[borrow,withAmount(repay,amount,0)]],['scope_then_flash_pair',[sr,borrow,withAmount(repay,amount,1)]],['flash_borrow_then_scope_then_repay',[borrow,sr,withAmount(repay,amount,0)]],['flash_pair_then_scope',[borrow,withAmount(repay,amount,0),sr]]]){
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:ixs}).compileToV0Message());const wire=Buffer.from(tx.serialize());
  const x=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:monitor}}]);const v=x.value;
  const after=v.accounts?.map(tokenAmount)||[];
  results.push({name,slot:x.context.slot,wireBytes:wire.length,err:v.err,unitsConsumed:v.unitsConsumed,before,after,deltas:after.length===before.length?after.map((n,i)=>n===null?null:(BigInt(n)-BigInt(before[i])).toString()):null,logs:v.logs?.filter(s=>/Scope|KLend|Error|tk |RefreshWithUnexpectedIxs/i.test(s)).slice(-20)});
 }
 const path='composer-runs/2026-10-15/scope-klend-flash-ordering-v1.json';fs.writeFileSync(path,JSON.stringify({observedAt:new Date().toISOString(),flashSourceSignature:require('./kamino-flash-history.json').hits[0].signature,flashReserve:borrow.keys[3].pubkey.toBase58(),scopeProgram:sr.programId.toBase58(),ammIndexes:[1,2],results},null,2)+'\n');
 console.log(JSON.stringify({path,results:results.map(x=>({name:x.name,err:x.err,wireBytes:x.wireBytes,units:x.unitsConsumed,deltas:x.deltas}))}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
