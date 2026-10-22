#!/usr/bin/env node
'use strict';
// Current-state, localhost-only signed Jupiter route replay. Mainnet access is read-only.
// ~/hooked.json is read only at runtime; its secret bytes are never logged or saved.
const fs=require('fs');
const os=require('os');
const crypto=require('crypto');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID}=require(modules+'@solana/spl-token');
const bs58mod=require(modules+'bs58');const bs58=bs58mod.default||bs58mod;
const {encodeV1}=require('./klend-v1-composition.js');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const mainnet=env.HEAVY_RPC_URL||env.RPC_URL;
const freshFork=process.argv.includes('--fresh-fork');
const fork=freshFork?'http://127.0.0.1:9497':'http://127.0.0.1:9397';
const signature='fQXJTLr2nXDgKoaMymrJvYnbiiBqzUL5yzpd9FMipyD54ofDWQ4KUuukJDwzinkGxq2f9bEUuAf6u47LMA56whr';
const jupiter='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const bison='BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi';
const oldUser='6vNX2zQpbp8MZRzkFipLXqCeP4Ae9Jofuv7tJqTFKEra';
const oldPayer='AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51';
const inputMint=new PublicKey('2bCCHQadi4QeHWPKG3w13siCyWWQPgkFtniouTqVpump');
const intermediateMint=new PublicKey('6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN');
const wsolMint=new PublicKey('So11111111111111111111111111111111111111112');
const usdcMint=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const oldInput='BairhxQRAAL6brxJVWqD6gmxR8AcqBf8Pg2zwFqb7LE6';
const oldIntermediate='B4BNjM8ZHQsKhUtN9R7hpvmLVd1rud1fDdW6xt1SyTYz';
const oldWsol='GHGJ35yJCH568L3Zvr7NRphKfDCn6bPtSaJ9RHssLut1';
const oldUsdc='C5khEUF3wja8zTr5QzJek4n7tDgNxzA4LPTNtr8BYnzv';
const poolWsol='ATRsNGv2nDw7hSMfkUTBoVUDsFDwN7po7KbecyiGWNB4';
const poolUsdc='2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU';
let id=0;
async function rpc(url,method,params){
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.json();if(body.error)throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function setAccount(address,data,owner,lamports){
  await rpc(fork,'surfnet_setAccount',[String(address),{data,executable:false,lamports,
    owner:String(owner),rentEpoch:0}]);
}
async function seedToken(address,template,authority,raw){
  const data=Buffer.from(template.data[0],'base64');authority.toBuffer().copy(data,32);
  data.writeBigUInt64LE(BigInt(raw),64);
  await setAccount(address,data.toString('hex'),template.owner,template.lamports);
}
function tokenAmount(account){return account?.data?Buffer.from(account.data[0],'base64').readBigUInt64LE(64).toString():null;}
function loadHooked(){
  const value=JSON.parse(fs.readFileSync(os.homedir()+'/hooked.json','utf8'));
  if(!Array.isArray(value)||value.length!==64||!value.every(x=>Number.isInteger(x)&&x>=0&&x<256))
    throw Error('hooked.json is not a 64-byte keypair array');
  return Keypair.fromSecretKey(Uint8Array.from(value));
}
function sign(instructions,payer,user,blockhash){
  const encoded=encodeV1(instructions,payer.publicKey,blockhash);
  if(encoded.sizeBytes>4096||encoded.addressCount>64)throw Error('v1 size/address limit exceeded');
  const compiled=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,
    instructions}).compileToV0Message();
  const required=compiled.staticAccountKeys.slice(0,encoded.requiredSignatures).map(String);
  const available=new Map([payer,user].map(x=>[String(x.publicKey),x]));
  const wire=Buffer.from(encoded.wire),message=wire.subarray(0,wire.length-64*encoded.requiredSignatures);
  for(let i=0;i<required.length;i++){
    const keypair=available.get(required[i]);if(!keypair)throw Error('uncontrolled required signer');
    const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
      Buffer.from(keypair.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
    crypto.sign(null,message,key).copy(wire,wire.length-64*encoded.requiredSignatures+i*64);
  }
  return {wire,encoded,required};
}
async function main(){
  const historical=await rpc(mainnet,'getTransaction',[signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1}]);
  if(!historical||historical.meta.err)throw Error('historical success unavailable');
  const route=historical.transaction.message.instructions.find(x=>x.programId===jupiter);
  const bisonCpi=historical.meta.innerInstructions.flatMap(x=>x.instructions).find(x=>x.programId===bison);
  if(!route||!bisonCpi||bisonCpi.accounts[2]!==poolWsol||bisonCpi.accounts[3]!==poolUsdc)
    throw Error('historical route is not expected Bison pool');
  const user=loadHooked(),payer=Keypair.generate();
  const mapVolume=process.argv.includes('--mapped-volume');
  const volumeProgram=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
  const userVolume=PublicKey.findProgramAddressSync([
    Buffer.from('user_volume_accumulator'),user.publicKey.toBuffer()],volumeProgram)[0];
  const oldVolume='DNcKnhrTLAT23RhBosqxtHW9mN9ESTCJHWCcg6mjrP5N';
  if(mapVolume){
    const volume=(await rpc(fork,'getAccountInfo',[String(userVolume),{encoding:'base64'}])).value;
    if(!volume||volume.owner!==String(volumeProgram))throw Error('fresh signer volume PDA unavailable');
  }
  const old=new PublicKey(oldUser);
  const ata=(mint,owner,tokenProgram)=>getAssociatedTokenAddressSync(mint,owner,false,tokenProgram);
  const pairs=[
    {old:oldInput,new:ata(inputMint,user.publicKey,TOKEN_2022_PROGRAM_ID),mint:inputMint,program:TOKEN_2022_PROGRAM_ID,template:oldInput,raw:'2282395815669'},
    {old:oldIntermediate,new:ata(intermediateMint,user.publicKey),mint:intermediateMint,template:oldIntermediate,raw:'0'},
    {old:oldWsol,new:ata(wsolMint,user.publicKey),mint:wsolMint,template:poolWsol,raw:'0'},
    {old:oldUsdc,new:ata(usdcMint,user.publicKey),mint:usdcMint,template:poolUsdc,raw:'0'},
  ];
  for(const row of pairs)if(ata(row.mint,old,row.program).toBase58()!==row.old)
    throw Error(`historical ATA mismatch for ${row.mint}`);
  await setAccount(payer.publicKey,'',SystemProgram.programId,1_000_000_000);
  // Set only localhost wallet balances. This does not fund or move assets on mainnet.
  await setAccount(user.publicKey,'',SystemProgram.programId,1_000_000_000);
  const templates=(await rpc(fork,'getMultipleAccounts',[pairs.map(x=>x.template),{encoding:'base64'}])).value;
  if(templates.some(x=>!x))throw Error('current template missing');
  for(let i=0;i<pairs.length;i++)await seedToken(pairs[i].new,templates[i],user.publicKey,pairs[i].raw);
  const replacements=new Map([[oldUser,String(user.publicKey)],[oldPayer,String(payer.publicKey)],
    ...pairs.map(x=>[x.old,String(x.new)])]);
  if(mapVolume)replacements.set(oldVolume,String(userVolume));
  const meta=new Map(historical.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  const keys=route.accounts.map(address=>({pubkey:new PublicKey(replacements.get(address)||address),
    isSigner:!!meta.get(address)?.signer,isWritable:!!meta.get(address)?.writable}));
  const ix=new TransactionInstruction({programId:new PublicKey(jupiter),keys,data:Buffer.from(bs58.decode(route.data))});
  const watch=[...pairs.map(x=>String(x.new)),poolWsol,poolUsdc];
  const before=(await rpc(fork,'getMultipleAccounts',[watch,{encoding:'base64'}])).value.map(tokenAmount);
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const {wire,encoded,required}=sign([ix],payer,user,blockhash);
  const response=await rpc(fork,'simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
    replaceRecentBlockhash:false,commitment:'processed',accounts:{encoding:'base64',addresses:watch}}]);
  const after=(response.value.accounts||[]).map(tokenAmount);
  const deltas=watch.map((_,i)=>before[i]!=null&&after[i]!=null?(BigInt(after[i])-BigInt(before[i])).toString():null);
  const output={generatedAt:new Date().toISOString(),scope:'Current JUP6-rooted Bison wSOL/USDC route, signed localhost simulation',
    sourceSignature:signature,sourceSlot:historical.slot,sigVerify:true,mainnetReadOnly:true,
    mainnetSubmission:false,forkSubmission:false,signerAddress:String(user.publicKey),payerAddress:String(payer.publicKey),
    mappedUserVolumePda:mapVolume?String(userVolume):null,
    syntheticFunding:Object.fromEntries(pairs.map(x=>[String(x.mint),x.raw])),watch,before,after,deltas,
    wireBytes:encoded.sizeBytes,addressCount:encoded.addressCount,requiredSigners:required,
    err:response.value.err,unitsConsumed:response.value.unitsConsumed,logs:response.value.logs};
  const path=__dirname+'/'+(freshFork?'bison-jup6-hooked-freshfork-signed.json':
    mapVolume?'bison-jup6-hooked-volume-signed.json':'bison-jup6-hooked-signed.json');
  fs.writeFileSync(path,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({path,err:output.err,wireBytes:output.wireBytes,addressCount:output.addressCount,
    unitsConsumed:output.unitsConsumed,deltas,logs:output.logs?.slice(-25)},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
