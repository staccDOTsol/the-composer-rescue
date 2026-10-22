const fs=require('fs');
const crypto=require('crypto');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram}=
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const census=require('./scope-live-mapping-census.json');
const scope=new PublicKey(census.scopeProgram);
const payer=new PublicKey('4Es59Rzm752CaB9vKrF75d6R9xCGKy9EFNkbTXMkTFUP');
const sysvar=new PublicKey('Sysvar1nstructions1111111111111111111111111');
const memo=new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from('prior non-compute instruction')});
const compute=ComputeBudgetProgram.setComputeUnitLimit({units:500000});
const disc=crypto.createHash('sha256').update('global:refresh_price_list').digest().subarray(0,8);
async function rpc(method,params){
  for(let a=0;a<4;a++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const obj=await response.json();
    if(!obj.error)return obj.result;
    if(obj.error.code===429||/rate limit/i.test(obj.error.message||'')){await new Promise(r=>setTimeout(r,800*(a+1)));continue;}
    throw Error(JSON.stringify(obj.error));
  }
  throw Error('RPC rate limit after retry');
}
function refresh(mapping,entry,overridePool,extraMints=[]){
  const data=Buffer.alloc(14);disc.copy(data);data.writeUInt32LE(1,8);data.writeUInt16LE(entry.index,12);
  return new TransactionInstruction({programId:scope,keys:[
    {pubkey:new PublicKey(mapping.oraclePrices),isSigner:false,isWritable:true},
    {pubkey:new PublicKey(mapping.address),isSigner:false,isWritable:false},
    {pubkey:new PublicKey(mapping.oracleTwaps),isSigner:false,isWritable:true},
    {pubkey:sysvar,isSigner:false,isWritable:false},
    {pubkey:new PublicKey(overridePool||entry.pool),isSigner:false,isWritable:false},
    ...extraMints.map(m=>({pubkey:new PublicKey(m),isSigner:false,isWritable:false})),
  ],data});
}
async function simulate(label,mapping,entry,prefix,overridePool,blockhash,extraMints=[]){
  const ix=refresh(mapping,entry,overridePool,extraMints);
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[...prefix,ix]}).compileToV0Message());
  const bytes=Buffer.from(tx.serialize());
  const out=await rpc('simulateTransaction',[bytes.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[mapping.oraclePrices]}}]);
  const v=out.value;
  const price=v.accounts?.[0]?.data?.[0];
  return {label,feed:mapping.oraclePrices,entry:entry.index,type:entry.type,pool:entry.pool,wireBytes:bytes.length,staticKeys:tx.message.staticAccountKeys.length,slot:out.context.slot,err:v.err,unitsConsumed:v.unitsConsumed,priceAccountHash:price?crypto.createHash('sha256').update(Buffer.from(price,'base64')).digest('hex'):null,logs:v.logs?.filter(x=>/Scope|Error|tk |Memo|refresh/i.test(x)).slice(-12)};
}
async function main(){
  const hash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const targets=census.mappings.filter(m=>m.ammEntries.length&&m.oraclePrices&&m.oracleTwaps).map(m=>({mapping:m,entry:m.ammEntries.find(e=>e.type.startsWith('Raydium'))}));
  const results=[];
  for(const {mapping,entry} of targets){
    results.push(await simulate('refresh_first',mapping,entry,[],null,hash));
    results.push(await simulate('compute_then_refresh',mapping,entry,[compute],null,hash));
    results.push(await simulate('memo_then_refresh',mapping,entry,[memo],null,hash));
    const alternate=mapping.ammEntries.find(e=>e.pool!==entry.pool);
    if(alternate) results.push(await simulate('wrong_mapped_pool',mapping,entry,[],alternate.pool,hash));
  }
  for(const mapping of census.mappings.filter(m=>m.ammEntries.some(e=>e.type.startsWith('Orca'))).slice(0,2)){
    const entry=mapping.ammEntries.find(e=>e.type.startsWith('Orca'));
    const pool=(await rpc('getAccountInfo',[entry.pool,{encoding:'base64',commitment:'confirmed'}])).value;
    if(!pool||pool.owner!=='whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc')throw Error('Orca pool owner mismatch');
    const data=Buffer.from(pool.data[0],'base64');
    const mints=[new PublicKey(data.subarray(101,133)).toBase58(),new PublicKey(data.subarray(181,213)).toBase58()];
    results.push(await simulate('orca_refresh_first',mapping,entry,[],null,hash,mints));
    results.push(await simulate('orca_memo_then_refresh',mapping,entry,[memo],null,hash,mints));
  }
  const path='composer-runs/2026-10-15/scope-live-ordering-replay.json';
  fs.writeFileSync(path,JSON.stringify({timestamp:new Date().toISOString(),scopeProgram:scope.toBase58(),sourceMappingCensusSlot:census.slot,results},null,2)+'\n');
  console.log(JSON.stringify({path,count:results.length,results:results.map(x=>({label:x.label,feed:x.feed,entry:x.entry,err:x.err,wireBytes:x.wireBytes,units:x.unitsConsumed}))}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
