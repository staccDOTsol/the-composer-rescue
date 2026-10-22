#!/usr/bin/env node
'use strict';
// Read-only local-mainnet-fork transaction sizing and signed simulation.
// Route: zero-fee KLend USDC flash -> Orca USDG/USDC A -> Kamino
// deposit/withdraw -> independent Orca USDG/SOL B -> Orca SOL/USDC C -> repay.
const fs=require('fs');
const crypto=require('crypto');
const MOD='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync}=require(`${MOD}/@solana/spl-token`);
const bs58=require(`${MOD}/bs58`);
const {encodeV1}=require('./klend-v1-composition.js');
const P=x=>new PublicKey(x);
const ORCA=P('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN_2022=P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const MEMO=P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const STRATEGY=require('./kliquidity-top5-fixtures.json').rows.find(x=>x.strategy==='ByPbo7yGcsfrEXet3ip3DcMKf4hwhUv71b6aAU9umBdu');
const USDC=P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDG=P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const SOL=P('So11111111111111111111111111111111111111112');
const POOLS=[STRATEGY.strategyPool,'5KqohoeGjTjyHAFJJywK4J7fkFuK82PfMyuseGgLKZu2',
  'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'];
const userKp=Keypair.generate();const USER=userKp.publicKey;
const OLD_USER=P('ES2ncXxvrpW8eTa74cjCask9uX6Vg59pbo9KPQpDBDbT');
const SHARES=P(STRATEGY.sharesMint);
const PREEXIST=process.env.KLIQ_CROSS_PREEXIST==='1';
const EXIT_MODE=process.env.KLIQ_CROSS_EXIT||'orca_multihop';
const MANIFEST=P('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
const MANIFEST_MARKET=P('EXMcKF76kmBUH8xZ5fi1jv3ezh3eVQCeL4rQbpjCRxvF');
const USDG_ATA=getAssociatedTokenAddressSync(USDG,USER,false,TOKEN_2022);
const USDC_ATA=getAssociatedTokenAddressSync(USDC,USER,false,TOKEN_PROGRAM_ID);
const SOL_ATA=getAssociatedTokenAddressSync(SOL,USER,false,TOKEN_PROGRAM_ID);
const SHARES_ATA=getAssociatedTokenAddressSync(SHARES,USER,false,TOKEN_PROGRAM_ID);
const userRemap=new Map([[String(OLD_USER),USER],
  [String(getAssociatedTokenAddressSync(USDG,OLD_USER,false,TOKEN_2022)),USDG_ATA],
  [String(getAssociatedTokenAddressSync(USDC,OLD_USER,false,TOKEN_PROGRAM_ID)),USDC_ATA],
  [String(getAssociatedTokenAddressSync(SHARES,OLD_USER,false,TOKEN_PROGRAM_ID)),SHARES_ATA]]);
const KRESERVE=require('./klend-zero-fee-census.json').activeZero.find(x=>
  x.reserve==='AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
const FH=require('./kamino-flash-history.json').hits[0].transaction;
const fhKeys=[...FH.transaction.message.accountKeys,...FH.meta.loadedAddresses.writable,
  ...FH.meta.loadedAddresses.readonly];
const FH_HEADER=FH.transaction.message.header;
const isW=i=>i<FH.transaction.message.accountKeys.length?
  i<FH_HEADER.numRequiredSignatures?i<FH_HEADER.numRequiredSignatures-FH_HEADER.numReadonlySignedAccounts:
    i<FH.transaction.message.accountKeys.length-FH_HEADER.numReadonlyUnsignedAccounts:
  i<FH.transaction.message.accountKeys.length+FH.meta.loadedAddresses.writable.length;
function historyIx(i){const x=FH.transaction.message.instructions[i];return new TransactionInstruction({
  programId:P(fhKeys[x.programIdIndex]),
  keys:x.accounts.map(j=>({pubkey:P(fhKeys[j]),isSigner:j<FH_HEADER.numRequiredSignatures,isWritable:isW(j)})),
  data:Buffer.from(bs58.decode(x.data))});}
const BORROW=historyIx(3),REPAY=historyIx(13);
function flash(template,amount,repayIndex){const keys=template.keys.map(x=>({...x}));
  const market=P(KRESERVE.market);
  const lma=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  for(const [i,k] of Object.entries({0:USER,1:lma,2:market,3:P(KRESERVE.reserve),4:USDC,
    5:P(KRESERVE.supplyVault),6:USDC_ATA,7:P(KRESERVE.feeVault),11:TOKEN_PROGRAM_ID}))keys[Number(i)].pubkey=k;
  const data=Buffer.from(template.data);data.writeBigUInt64LE(BigInt(amount),8);
  if(repayIndex!==undefined)data[16]=repayIndex;
  return new TransactionInstruction({programId:KLEND,keys,data});}
const key=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const u64=n=>{let b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
const u128=n=>{let b=Buffer.alloc(16),v=BigInt(n);b.writeBigUInt64LE(v&((1n<<64n)-1n));b.writeBigUInt64LE(v>>64n,8);return b};
const disc=n=>crypto.createHash('sha256').update('global:'+n).digest().subarray(0,8);
const tarr=(pool,start)=>PublicKey.findProgramAddressSync([Buffer.from('tick_array'),pool.toBuffer(),Buffer.from(String(start))],ORCA)[0];
const oracle=pool=>PublicKey.findProgramAddressSync([Buffer.from('oracle'),pool.toBuffer()],ORCA)[0];
const minSqrt=4295048016n,maxSqrt=79226673515401279992447579055n;
let requestId=0;
const RPC=process.env.KLIQ_CROSS_RPC||'http://127.0.0.1:9295';
async function rpc(method,params){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params})});let j=await r.json();
  if(j.error)throw Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;}
async function poolData(address){const row=(await rpc('getAccountInfo',[address,{encoding:'base64',commitment:'processed'}])).value;
  if(!row||row.owner!==String(ORCA))throw Error('pool missing/owner '+address);
  const b=Buffer.from(row.data[0],'base64');if(b.length!==653)throw Error('pool length');
  return {address:P(address),mintA:P(b.subarray(101,133)),mintB:P(b.subarray(181,213)),
    vaultA:P(b.subarray(133,165)),vaultB:P(b.subarray(213,245)),
    tick:b.readInt32LE(81),spacing:b.readUInt16LE(41),feeRate:b.readUInt16LE(45),
    liquidity:(b.readBigUInt64LE(49)+(b.readBigUInt64LE(57)<<64n)).toString()};}
function swap(pool,amount,aToB,ataA,ataB,progA,progB,tick=pool.tick){
  const span=88*pool.spacing,start=Math.floor(tick/span)*span;
  const starts=aToB?[start,start-span,start-2*span]:[start,start+span,start+2*span];
  const data=Buffer.concat([disc('swap_v2'),u64(amount),u64(0n),u128(aToB?minSqrt:maxSqrt),
    Buffer.from([1,aToB?1:0,0])]);
  return new TransactionInstruction({programId:ORCA,data,keys:[
    key(progA),key(progB),key(MEMO),key(USER,true),key(pool.address,false,true),
    key(pool.mintA),key(pool.mintB),key(ataA,false,true),key(pool.vaultA,false,true),
    key(ataB,false,true),key(pool.vaultB,false,true),...starts.map(s=>key(tarr(pool.address,s),false,true)),
    key(oracle(pool.address),false,true)]});}
function klix(template,amountA,amountB){const data=Buffer.from(template.dataBase64,'base64');
  if(amountA!==undefined)data.writeBigUInt64LE(BigInt(amountA),8);
  if(amountB!==undefined)data.writeBigUInt64LE(BigInt(amountB),16);
  return new TransactionInstruction({programId:P(template.programId),data,
    keys:template.accounts.map(a=>key(userRemap.get(a.address)||P(a.address),a.isSigner,a.isWritable))});}
function manifestSwap(amount){
  const pda=(tag,mint)=>PublicKey.findProgramAddressSync([
    Buffer.from(tag),...(tag==='vault'?[MANIFEST_MARKET.toBuffer()]:[]),mint.toBuffer()],MANIFEST)[0];
  return new TransactionInstruction({programId:MANIFEST,
    data:Buffer.concat([Buffer.from([4]),u64(amount),u64(0n),Buffer.from([1,1])]),
    keys:[key(USER,true,true),key(MANIFEST_MARKET,false,true),key(SystemProgram.programId),
      key(USDG_ATA,false,true),key(USDC_ATA,false,true),
      key(pda('vault',USDG),false,true),key(pda('vault',USDC),false,true),
      key(TOKEN_2022),key(USDG),key(TOKEN_PROGRAM_ID),key(USDC),
      key(pda('global',USDC),false,true),key(pda('global-vault',USDC),false,true)]});
}
const setup=PREEXIST?[]:[createAssociatedTokenAccountIdempotentInstruction(USER,USDG_ATA,USER,USDG,TOKEN_2022),
  createAssociatedTokenAccountIdempotentInstruction(USER,USDC_ATA,USER,USDC,TOKEN_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(USER,SOL_ATA,USER,SOL,TOKEN_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(USER,SHARES_ATA,USER,SHARES,TOKEN_PROGRAM_ID)];
function signV1(encoded,instructions,blockhash){
  const c=new TransactionMessage({payerKey:USER,recentBlockhash:blockhash,instructions}).compileToV0Message();
  const names=c.staticAccountKeys.slice(0,encoded.requiredSignatures).map(String);
  if(names.length!==1||names[0]!==String(USER))throw Error('uncontrolled signer: '+names);
  const wire=Buffer.from(encoded.wire),msg=wire.subarray(0,wire.length-64),key=crypto.createPrivateKey({
    key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
      Buffer.from(userKp.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,msg,key).copy(wire,wire.length-64);return wire;}
async function setSeedToken(mint,ata,program,amount){
  const account=(await rpc('getAccountInfo',[String(ata),{encoding:'base64',commitment:'processed'}])).value;
  let data=account?Buffer.from(account.data[0],'base64'):null;
  if(!data&&program.equals(TOKEN_2022)&&mint.equals(USDG)){
    const source=(await rpc('getAccountInfo',[String(POOLS[0]&&'6j9UtMmzmWuLu45XXmdUXN3NJBdiicxxoBEex8jUs3j6'),
      {encoding:'base64',commitment:'processed'}])).value;
    if(!source||source.owner!==String(TOKEN_2022))throw Error('source USDG account missing');
    data=Buffer.from(source.data[0],'base64');
  }
  if(!data)data=Buffer.alloc(program.equals(TOKEN_2022)?166:165);
  if(account&&account.owner!==String(program))throw Error('seed owner mismatch '+ata);
  if(account&&(!data.subarray(0,32).equals(mint.toBuffer())||
    !data.subarray(32,64).equals(USER.toBuffer())))throw Error('seed mint/authority mismatch '+ata);
  if(!account){mint.toBuffer().copy(data,0);USER.toBuffer().copy(data,32);data[108]=1;
    if(program.equals(TOKEN_2022))data[165]=2;}
  data.writeBigUInt64LE(BigInt(amount),64);
  await rpc('surfnet_setAccount',[String(ata),{data:data.toString('hex'),executable:false,
    lamports:account?.lamports||2039280,owner:String(program),rentEpoch:0}]);
}
const image=row=>row&&row.data?{
  rawAmount:row.data[0]&&Buffer.from(row.data[0],'base64').length>=72?
    Buffer.from(row.data[0],'base64').readBigUInt64LE(64).toString():null,
  owner:row.owner,lamports:String(row.lamports),
  sha256:crypto.createHash('sha256').update(Buffer.from(row.data[0],'base64')).digest('hex')}:null;
function tokenDelta(before,after){return after&&after.rawAmount!==null&&
  (!before||before.rawAmount!==null)?
  (BigInt(after.rawAmount)-BigInt(before?.rawAmount||0)).toString():null;}
async function simulate(ixs,label,watch){
  const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeV1(ixs,USER,bh),wire=signV1(encoded,ixs,bh);
  const pre=(await rpc('getMultipleAccounts',[watch.map(String),{encoding:'base64',commitment:'processed'}])).value.map(image);
  const r=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',
    sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watch.map(String)}}]);
  const post=r.value.accounts?.map(image)||[];
  return {label,slot:r.context.slot,err:r.value.err,cu:r.value.unitsConsumed,
    bytes:encoded.sizeBytes,accounts:encoded.addressCount,ixCount:encoded.instructionCount,
    signaturesVerified:true,sha256:crypto.createHash('sha256').update(wire).digest('hex'),
    pre,post,deltas:pre.map((x,i)=>tokenDelta(x,post[i])),
    logs:r.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('failed')||x.includes('Error')||x.includes('Program log:')).slice(-30)};
}
async function main(){const pools=await Promise.all(POOLS.map(poolData));
  if(String(pools[0].mintA)!==String(USDG)||String(pools[0].mintB)!==String(USDC)||
    String(pools[1].mintA)!==String(SOL)||String(pools[1].mintB)!==String(USDG)||
    String(pools[2].mintA)!==String(SOL)||String(pools[2].mintB)!==String(USDC))throw Error('pool mint identity');
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const available=Buffer.from((await rpc('getAccountInfo',[KRESERVE.reserve,{encoding:'base64'}])).value.data[0],'base64').readBigUInt64LE(224);
  const borrow=flash(BORROW,available),repay=flash(REPAY,available,setup.length);
  const a=swap(pools[0],1000000000000n,false,USDG_ATA,USDC_ATA,TOKEN_2022,TOKEN_PROGRAM_ID);
  const d=klix(STRATEGY.deposit,1000000000000n,1000000000000n);
  const w=klix(STRATEGY.withdraw,1000000000000n);
  const b=EXIT_MODE==='manifest'?manifestSwap(1000000000000n):
    swap(pools[1],1000000000000n,false,SOL_ATA,USDG_ATA,TOKEN_PROGRAM_ID,TOKEN_2022);
  const c=EXIT_MODE==='manifest'?null:
    swap(pools[2],100000000000n,true,SOL_ATA,USDC_ATA,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID);
  const ixs=[...setup,borrow,a,d,w,b,...(c?[c]:[]),repay];
  const fit=encodeV1(ixs,USER,blockhash);
  const out={observedAtUtc:new Date().toISOString(),readOnly:true,localFork:RPC,
    route:EXIT_MODE==='manifest'?'KLend USDC max available -> Orca USDG/USDC A -> Kamino deposit/withdraw -> independent Manifest USDG/USDC B -> repay':
      'KLend USDC max available -> Orca USDG/USDC A -> Kamino deposit/withdraw -> independent Orca USDG/SOL B -> Orca SOL/USDC C -> repay',
    signer:String(USER),poolData:pools.map(p=>({address:String(p.address),mintA:String(p.mintA),mintB:String(p.mintB),feeRate:p.feeRate,tick:p.tick,spacing:p.spacing,liquidity:p.liquidity})),
    flashReserve:KRESERVE.reserve,flashAvailableRaw:available.toString(),fit:{bytes:fit.sizeBytes,accounts:fit.addressCount,ix:fit.instructionCount,signatures:fit.requiredSignatures,computeLimit:fit.config.computeLimit},
    accountUnion:new TransactionMessage({payerKey:USER,recentBlockhash:blockhash,instructions:ixs}).compileToV0Message().staticAccountKeys.map(String)};
  const suffix=EXIT_MODE==='manifest'?'-manifest':'';
  const setupSuffix=PREEXIST?'-preexisting':'';
  fs.writeFileSync(__dirname+`/kliquidity-usdg-asymmetric-v1${suffix}${setupSuffix}-fit.json`,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({fit:out.fit,flashAvailableRaw:out.flashAvailableRaw,pools:out.poolData},null,2));
  if(process.env.KLIQ_CROSS_FIT_MULTI==='1'){
    const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
      .split(/\r?\n/).filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
    const sourceUrl=env.HEAVY_RPC_URL||env.RPC_URL;
    const sig='2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
    const response=await fetch(sourceUrl,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[sig,
        {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]})});
    const tx=(await response.json()).result;
    if(!tx)throw Error('P0 source transaction unavailable');
    const txKeys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),
      ...(tx.meta.loadedAddresses?.readonly||[])];
    const txH=tx.transaction.message.header,txStatic=tx.transaction.message.accountKeys.length;
    const txWritable=j=>j<txStatic?j<txH.numRequiredSignatures?
      j<txH.numRequiredSignatures-txH.numReadonlySignedAccounts:
      j<txStatic-txH.numReadonlyUnsignedAccounts:
      j<txStatic+(tx.meta.loadedAddresses?.writable||[]).length;
    const txIx=i=>{const x=tx.transaction.message.instructions[i];
      return new TransactionInstruction({programId:P(txKeys[x.programIdIndex]),
        keys:x.accounts.map(j=>key(P(txKeys[j]),j<txH.numRequiredSignatures,txWritable(j))),
        data:Buffer.from(bs58.decode(x.data))});};
    const p0=P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
    const margin=Keypair.generate(),start=txIx(1),p0Borrow=txIx(2),p0Repay=txIx(5),end=txIx(6);
    if(![start,p0Borrow,p0Repay,end].every(x=>x.programId.equals(p0)))throw Error('P0 history mismatch');
    const group=p0Borrow.keys[0].pubkey,bank=p0Borrow.keys[3].pubkey,vault=p0Borrow.keys[6].pubkey;
    const init=new TransactionInstruction({programId:p0,keys:[
      key(group),key(margin.publicKey,true,true),key(USER,true),key(USER,true,true),
      key(SystemProgram.programId)],data:Buffer.from([43,78,61,255,148,52,249,154])});
    start.keys[0].pubkey=margin.publicKey;start.keys[1].pubkey=USER;
    p0Borrow.keys[1].pubkey=margin.publicKey;p0Borrow.keys[2].pubkey=USER;
    p0Borrow.keys[4].pubkey=USDC_ATA;
    p0Repay.keys[1].pubkey=margin.publicKey;p0Repay.keys[2].pubkey=USER;
    p0Repay.keys[4].pubkey=USDC_ATA;
    end.keys[0].pubkey=margin.publicKey;end.keys[2].pubkey=USER;
    for(const ix of [p0Borrow,p0Repay])ix.data.writeBigUInt64LE(10000000000n,8);
    const multi=[init,...setup,start,borrow,a,d,w,b,...(c?[c]:[]),p0Repay,repay,end];
    multi.splice(7,0,p0Borrow);
    start.data.writeBigUInt64LE(BigInt(multi.length-1),8);
    repay.data[16]=multi.indexOf(borrow);
    const compiled=new TransactionMessage({payerKey:USER,recentBlockhash:blockhash,
      instructions:multi}).compileToV0Message();
    let fitMulti,fitError=null;
    try{const encoded=encodeV1(multi,USER,blockhash);
      fitMulti={bytes:encoded.sizeBytes,accounts:encoded.addressCount,ix:encoded.instructionCount,
        signatures:encoded.requiredSignatures};}catch(error){fitError=String(error)}
    const multiOut={observedAtUtc:new Date().toISOString(),sourceSignature:sig,
      newP0Account:String(margin.publicKey),p0Group:String(group),p0Bank:String(bank),
      p0Vault:String(vault),flashAmountP0Raw:'10000000000',
      note:'P0 raw amount is a fit placeholder; exact available liquidity must be checked for executed path.',
      fit:fitMulti,error:fitError,compiledAccountCount:compiled.staticAccountKeys.length,
      union:compiled.staticAccountKeys.map(String)};
    fs.writeFileSync(__dirname+`/kliquidity-usdg-asymmetric-v1${suffix}${setupSuffix}-multisource-fit.json`,
      JSON.stringify(multiOut,null,2)+'\n');
    console.log(JSON.stringify({multiSourceFit:fitMulti,multiSourceError:fitError,
      compiledAccountCount:multiOut.compiledAccountCount}));
  }
  if(process.env.KLIQ_CROSS_SIM!=='1')return;
  await rpc('surfnet_setAccount',[String(USER),{data:'',executable:false,
    lamports:10000000000,owner:String(SystemProgram.programId),rentEpoch:0}]);
  if(PREEXIST){await setSeedToken(USDG,USDG_ATA,TOKEN_2022,0n);
    await setSeedToken(SHARES,SHARES_ATA,TOKEN_PROGRAM_ID,0n);}
  await setSeedToken(SOL,SOL_ATA,TOKEN_PROGRAM_ID,0n);
  await setSeedToken(USDC,USDC_ATA,TOKEN_PROGRAM_ID,16000000000000n);
  const watch=[USDC_ATA,USDG_ATA,SOL_ATA,SHARES_ATA,P(KRESERVE.supplyVault),
    P(KRESERVE.feeVault),P(KRESERVE.reserve),pools[0].address,pools[0].vaultA,pools[0].vaultB,
    pools[1].address,pools[1].vaultA,pools[1].vaultB,pools[2].address,pools[2].vaultA,pools[2].vaultB,
    P(STRATEGY.strategy),P(STRATEGY.sharesMint)];
  if(EXIT_MODE==='manifest')watch.push(MANIFEST_MARKET,...b.keys.slice(5,7).map(x=>x.pubkey),
    ...b.keys.slice(11,13).map(x=>x.pubkey));
  await rpc('getMultipleAccounts',[out.accountUnion,{encoding:'base64',commitment:'processed'}]);
  const report={...out,watch:watch.map(String),cases:[]};
  const finalSeedRaw=BigInt(process.env.KLIQ_CROSS_FINAL_SEED_RAW||'100000000000');
  report.quoteSeedUsdCRaw='16000000000000';report.finalSeedUsdCRaw=finalSeedRaw.toString();
  for(const move of [1000000000n,100000000000n,500000000000n,1000000000000n,2000000000000n,available]){
    await setSeedToken(USDC,USDC_ATA,TOKEN_PROGRAM_ID,16000000000000n);
    const row={moveRaw:move.toString(),flashRaw:available.toString()};
    const makeA=swap(pools[0],move,false,USDG_ATA,USDC_ATA,TOKEN_2022,TOKEN_PROGRAM_ID);
    const base=[...setup,borrow,makeA];
    try{
      const f=await simulate([...base,repay],'A_forward',watch);
      row.forward={err:f.err,cu:f.cu,outUsdGRaw:f.deltas[1],tickAfter:f.post[7]&&f.post[7].sha256,logs:f.logs};
      if(f.err||BigInt(f.deltas[1]||'0')<=0n){report.cases.push(row);continue;}
      const outA=BigInt(f.deltas[1]);
      const d=klix(STRATEGY.deposit,outA,move);
      const withDeposit=[...base,d];
      const ds=await simulate([...withDeposit,repay],'Kamino_deposit',watch);
      row.deposit={err:ds.err,cu:ds.cu,mintedSharesRaw:ds.deltas[3],logs:ds.logs};
      if(ds.err||BigInt(ds.deltas[3]||'0')<=0n){report.cases.push(row);continue;}
      const shares=BigInt(ds.deltas[3]),w=klix(STRATEGY.withdraw,shares);
      const withWithdraw=[...withDeposit,w];
      const ws=await simulate([...withWithdraw,repay],'Kamino_withdraw',watch);
      row.withdraw={err:ws.err,cu:ws.cu,remainingUsdGRaw:ws.post[1]?.rawAmount,
        remainingUsdCRaw:ws.post[0]?.rawAmount,sharesDelta:ws.deltas[3],logs:ws.logs};
      if(ws.err||BigInt(ws.post[1]?.rawAmount||0)<=0n){report.cases.push(row);continue;}
      const sellUsdG=BigInt(ws.post[1].rawAmount);
      const sellB=EXIT_MODE==='manifest'?manifestSwap(sellUsdG):
        swap(pools[1],sellUsdG,false,SOL_ATA,USDG_ATA,TOKEN_PROGRAM_ID,TOKEN_2022);
      const bs=await simulate([...withWithdraw,sellB,repay],'independent_B',watch);
      row.independentB={err:bs.err,cu:bs.cu,solRaw:bs.post[2]?.rawAmount,
        usdGRaw:bs.post[1]?.rawAmount,usdCRaw:bs.post[0]?.rawAmount,logs:bs.logs};
      if(bs.err||EXIT_MODE!=='manifest'&&BigInt(bs.post[2]?.rawAmount||0)<=0n){report.cases.push(row);continue;}
      const sellC=EXIT_MODE==='manifest'?null:swap(pools[2],BigInt(bs.post[2].rawAmount),true,
        SOL_ATA,USDC_ATA,TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID);
      // Final case uses disclosed 100k USDC borrower bankroll, enough to
      // reveal signed completion; net equity includes this starting balance.
      await setSeedToken(USDC,USDC_ATA,TOKEN_PROGRAM_ID,finalSeedRaw);
      const full=await simulate([...withWithdraw,sellB,...(sellC?[sellC]:[]),repay],
        'full_Asymmetric',watch);
      row.full={err:full.err,cu:full.cu,bytes:full.bytes,accounts:full.accounts,
        signaturesVerified:full.signaturesVerified,transactionSha256:full.sha256,
        userUsdCDeltaRaw:full.deltas[0],userUsdGDeltaRaw:full.deltas[1],
        userSolDeltaRaw:full.deltas[2],sharesDeltaRaw:full.deltas[3],
        lenderSupplyDeltaRaw:full.deltas[4],lenderFeeDeltaRaw:full.deltas[5],
        finalUsdGRaw:full.post[1]?.rawAmount,finalSolRaw:full.post[2]?.rawAmount,
        finalSharesRaw:full.post[3]?.rawAmount,logs:full.logs};
      await setSeedToken(USDC,USDC_ATA,TOKEN_PROGRAM_ID,16000000000000n);
    }catch(error){row.error=String(error)}
    report.cases.push(row);
    console.log(JSON.stringify({moveRaw:row.moveRaw,forwardErr:row.forward?.err,
      depositErr:row.deposit?.err,withdrawErr:row.withdraw?.err,
      bErr:row.independentB?.err,fullErr:row.full?.err,
      netUsdC:row.full?.userUsdCDeltaRaw,bytes:row.full?.bytes,accounts:row.full?.accounts,
      error:row.error}));
  }
  const capitalSuffix=finalSeedRaw===100000000000n?'':'-capital';
  fs.writeFileSync(__dirname+`/kliquidity-usdg-asymmetric-v1${suffix}${setupSuffix}${capitalSuffix}-sim.json`,
    JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
