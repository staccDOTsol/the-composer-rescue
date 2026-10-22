const fs=require('fs');const crypto=require('crypto');
const {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram}=
  require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8').split('\n').filter(Boolean).map(x=>x.split(/=(.*)/s).slice(0,2)));
const endpoint=env.HEAVY_RPC_URL||env.RPC_URL;
const cross=require('./scope-klend-consumer-crosswalk.json').directAmmReserveMatches[0];
const census=require('./scope-live-mapping-census.json');
const mapping=census.mappings.find(m=>m.address===cross.mapping);
const scope=new PublicKey(census.scopeProgram), klend=new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const payer=new PublicKey('4Es59Rzm752CaB9vKrF75d6R9xCGKy9EFNkbTXMkTFUP');
const sysvar=new PublicKey('Sysvar1nstructions1111111111111111111111111');
const memo=new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[],data:Buffer.from('prior instruction')});
async function rpc(method,params){
  for(let a=0;a<4;a++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const obj=await response.json();if(!obj.error)return obj.result;
    if(obj.error.code===429||/rate limit/i.test(obj.error.message||'')){await new Promise(r=>setTimeout(r,800*(a+1)));continue;}
    throw Error(JSON.stringify(obj.error));
  }throw Error('RPC rate limit after retry');
}
const pk=s=>new PublicKey(s);
function scopeRefresh(){
  const indexes=[1,2],data=Buffer.alloc(8+4+indexes.length*2);
  crypto.createHash('sha256').update('global:refresh_price_list').digest().copy(data,0,0,8);
  data.writeUInt32LE(indexes.length,8);indexes.forEach((v,i)=>data.writeUInt16LE(v,12+2*i));
  return new TransactionInstruction({programId:scope,data,keys:[
    {pubkey:pk(mapping.oraclePrices),isWritable:true,isSigner:false},
    {pubkey:pk(mapping.address),isWritable:false,isSigner:false},
    {pubkey:pk(mapping.oracleTwaps),isWritable:true,isSigner:false},
    {pubkey:sysvar,isWritable:false,isSigner:false},
    ...indexes.map(i=>({pubkey:pk(mapping.ammEntries.find(x=>x.index===i).pool),isWritable:false,isSigner:false}))
  ]});
}
function klendRefresh(){
  return new TransactionInstruction({programId:klend,data:Buffer.from('02da8aeb4fc91966','hex'),keys:[
    {pubkey:pk(cross.reserve),isWritable:true,isSigner:false},
    {pubkey:pk('BUJjB7FDHwszy8BRUvNXf1NvrX4ng76yyXMj31KUem7F'),isWritable:false,isSigner:false},
    ...Array.from({length:3},()=>({pubkey:klend,isWritable:false,isSigner:false})),
    {pubkey:pk(mapping.oraclePrices),isWritable:false,isSigner:false}
  ]});
}
const hash=d=>crypto.createHash('sha256').update(d).digest('hex');
function reserveFields(d){return {hash:hash(d),lastUpdateSlot:d.readBigUInt64LE(16).toString(),stale:d[24],priceStatus:d[25],availableRaw:d.readBigUInt64LE(224).toString(),marketPriceSf:d.subarray(248,264).toString('hex')}}
async function simulate(name,instructions,blockhash){
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message());
  const wire=Buffer.from(tx.serialize());
  const x=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[cross.reserve,mapping.oraclePrices]}}]);
  const v=x.value;const reserve=v.accounts?.[0]?.data?.[0],prices=v.accounts?.[1]?.data?.[0];
  return {name,slot:x.context.slot,wireBytes:wire.length,accountKeys:tx.message.staticAccountKeys.length,err:v.err,unitsConsumed:v.unitsConsumed,reserve:reserve?reserveFields(Buffer.from(reserve,'base64')):null,scopePricesHash:prices?hash(Buffer.from(prices,'base64')):null,logs:v.logs?.filter(s=>/Scope|KLend|Error|tk |price|status/i.test(s)).slice(-25)};
}
async function main(){
  const accounts=await rpc('getMultipleAccounts',[[cross.reserve,mapping.oraclePrices],{encoding:'base64',commitment:'confirmed'}]);
  const before={slot:accounts.context.slot,reserve:reserveFields(Buffer.from(accounts.value[0].data[0],'base64')),scopePricesHash:hash(Buffer.from(accounts.value[1].data[0],'base64'))};
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const sr=scopeRefresh(),kr=klendRefresh(),cb=ComputeBudgetProgram.setComputeUnitLimit({units:500000});
  const results=[];
  for(const [name,ixs] of [['klend_only',[kr]],['scope_then_klend',[sr,kr]],['compute_scope_then_klend',[cb,sr,kr]],['klend_then_scope',[kr,sr]],['memo_scope_then_klend',[memo,sr,kr]]])results.push(await simulate(name,ixs,blockhash));
  const output={observedAt:new Date().toISOString(),scopeProgram:scope.toBase58(),klendProgram:klend.toBase58(),reserve:cross.reserve,mint:cross.mint,feed:mapping.oraclePrices,mapping:mapping.address,priceChain:cross.priceChain,ammIndexes:cross.directPriceAmm,ammPools:mapping.ammEntries.filter(e=>cross.directPriceAmm.includes(e.index)),before,results};
  const path='composer-runs/2026-10-15/scope-ctals-klend-v1.json';fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({path,before,results:results.map(x=>({name:x.name,err:x.err,wireBytes:x.wireBytes,units:x.unitsConsumed,reserve:x.reserve&&{stale:x.reserve.stale,priceStatus:x.reserve.priceStatus,marketPriceSf:x.reserve.marketPriceSf}}))}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
