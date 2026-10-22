#!/usr/bin/env node
// Read-only mainnet history/state; all signed swap tests run on localhost Surfpool.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(modules + '@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(modules + '@solana/spl-token');
const bs58Module = require(modules + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');
const fork = 'http://127.0.0.1:9397';
const bison = 'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi';
const sourceSignature = '29EHe8VnqXbnP9xvqbKmPvEC3BvnneRXQDJguwhVDwqEQH1GpQEneCLVXV4tQco9bGjuEFrGy4dzWFtK8dxLd3Jo';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(x=>x.includes('=')).map(x=>x.split(/=(.*)/s).slice(0,2)));
const source = env.HEAVY_RPC_URL || env.RPC_URL;
let id=0;
async function rpc(url,method,params) {
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const j=await r.json(); if(j.error) throw Error(`${method}: ${JSON.stringify(j.error)}`); return j.result;
}
function signV1(instructions,attacker,blockhash) {
  const encoded=encodeV1(instructions,attacker.publicKey,blockhash);
  if(encoded.requiredSignatures!==1) throw Error(`unexpected signer count: ${encoded.requiredSignatures}`);
  const compiled=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message();
  if(!compiled.staticAccountKeys[0].equals(attacker.publicKey)) throw Error('payer ordering');
  const wire=Buffer.from(encoded.wire);
  const key=crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,wire.subarray(0,wire.length-64),key).copy(wire,wire.length-64);
  return {wire,encoded};
}
function amount(x) {return x?.data ? Buffer.from(x.data[0],'base64').readBigUInt64LE(64).toString() : null;}
async function seedToken(address,template,owner,rawAmount) {
  const data=Buffer.from(template.data[0],'base64');
  owner.toBuffer().copy(data,32); data.writeBigUInt64LE(BigInt(rawAmount),64);
  await rpc(fork,'surfnet_setAccount',[address.toBase58(),{data:data.toString('hex'),
    executable:false,lamports:template.lamports,owner:template.owner,rentEpoch:0}]);
}
async function main() {
  const tx=await rpc(source,'getTransaction',[sourceSignature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1}]);
  if(!tx || tx.meta.err || tx.slot<=456982351) throw Error('current-deployment historical swap unavailable');
  const group=tx.meta.innerInstructions.find(g=>g.index===0);
  const historical=group?.instructions.find(i=>i.programId===bison);
  if(!historical || historical.accounts.length!==10) throw Error('Bison CPI not found');
  const meta=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  const attacker=Keypair.generate();
  const ethMint=new PublicKey('So11111111111111111111111111111111111111112');
  const usdcMint=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const attackerEth=getAssociatedTokenAddressSync(ethMint,attacker.publicKey);
  const attackerUsdc=getAssociatedTokenAddressSync(usdcMint,attacker.publicKey);
  const poolEth=historical.accounts[2],poolUsdc=historical.accounts[3];
  const templates=(await rpc(fork,'getMultipleAccounts',[[poolEth,poolUsdc],{encoding:'base64'}])).value;
  if(templates.some(x=>!x)) throw Error('missing pool token account');
  await rpc(fork,'surfnet_setAccount',[attacker.publicKey.toBase58(),{
    data:'',executable:false,lamports:1000000000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  await seedToken(attackerEth,templates[0],attacker.publicKey,0n);
  await seedToken(attackerUsdc,templates[1],attacker.publicKey,0n);
  await seedToken(attackerEth,templates[0],attacker.publicKey,50000000000000n);
  const keys=historical.accounts.map((x,i)=>{
    const pubkey=new PublicKey(i===0?attacker.publicKey.toBase58():i===4?attackerEth.toBase58():i===5?attackerUsdc.toBase58():x);
    const m=meta.get(x);
    return {pubkey,isSigner:i===0,isWritable:!!m?.writable};
  });
  const ixData=Buffer.from(bs58.decode(historical.data));
  if(ixData.length!==19 || ixData[0]!==7) throw Error('historical data layout mismatch');
  const before=(await rpc(fork,'getMultipleAccounts',[[poolEth,poolUsdc,attackerEth.toBase58(),attackerUsdc.toBase58()],{encoding:'base64'}])).value;
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const results=[];
  for(const signerIndex of [null,8,9]) {
    const inputRaw=659642649n;
    const data=Buffer.from(ixData); data.writeBigUInt64LE(inputRaw,1);
    const variantKeys=keys.map(x=>({...x}));
    if(signerIndex!==null) variantKeys[signerIndex].isSigner=true;
    const ix=new TransactionInstruction({programId:new PublicKey(bison),keys:variantKeys,data});
    const encoded=encodeV1([ix],attacker.publicKey,blockhash);
    const wire=encoded.wire;
    const r=await rpc(fork,'simulateTransaction',[wire.toString('base64'),{
      encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'processed',
      accounts:{encoding:'base64',addresses:[poolEth,poolUsdc,attackerEth.toBase58(),attackerUsdc.toBase58()]}}]);
    const after=(r.value.accounts||[]).map(amount);
    results.push({signerIndex,inputRaw:inputRaw.toString(),err:r.value.err,wireBytes:encoded.sizeBytes,
      requiredSignatures:encoded.requiredSignatures,
      addresses:encoded.addressCount,computeUnits:r.value.unitsConsumed,
      postRaw:after,attackerEthDeltaRaw:after[2]==null?null:(BigInt(after[2])-BigInt(amount(before[2]))).toString(),
      attackerUsdcDeltaRaw:after[3]==null?null:(BigInt(after[3])-BigInt(amount(before[3]))).toString(),
      logs:r.value.logs?.slice(-12)});
  }
  const output={generatedAt:new Date().toISOString(),scope:'Diagnostic signer-flag test on current Bison binary; sigVerify:false is non-executable; baseline sigVerify:true in bison-wsol-usdc-current-signed.json',
    sourceSignature,sourceSlot:tx.slot,bison,attacker:attacker.publicKey.toBase58(),
    poolEth,poolUsdc,ethMint:ethMint.toBase58(),usdcMint:usdcMint.toBase58(),
    syntheticStartingWSOLraw:'50000000000000',sigVerify:false,mainnetSubmission:false,forkSubmission:false,
    beforeRaw:before.map(amount),results};
  fs.writeFileSync(__dirname+'/bison-wsol-usdc-signer-flags.json',JSON.stringify(output,null,2));
  console.log(JSON.stringify({sourceSlot:tx.slot,results:results.map(x=>({signerIndex:x.signerIndex,inputRaw:x.inputRaw,err:x.err,
    ethDelta:x.attackerEthDeltaRaw,usdcDelta:x.attackerUsdcDeltaRaw,wireBytes:x.wireBytes,addresses:x.addresses,
    lastLogs:x.logs?.slice(-3)}))}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
