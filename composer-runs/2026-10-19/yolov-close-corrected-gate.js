#!/usr/bin/env node
// Signed read-only mainnet close probes with a position actually owned by the test wallet.
const fs=require('fs');
const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bs58m=require('../2026-10-15/onre-harness/node_modules/bs58');const bs58=bs58m.default||bs58m;
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const mint=new PublicKey('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD');
const market=new PublicKey('Ew8sRjpuBttpmhSUeaAn4dLAegWnz55AuafVcGuojCPS');
const position=new PublicKey('6fKnSCwzKPUFFATXGtxiXrUR9L7qkm2i4pe58JgaBv68');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/)
  .find(x=>/^\s*export SOLANA_RPC=/.test(x));
const endpoint=row?.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const b=await r.json();if(!r.ok||b.error)throw Error(`${method}: ${b.error?.message||r.status}`);return b.result;}
async function sample(){const sig='ZFgcNGjsfZxmANaDe8Ndo23diEubVezxfPZv9BuyqPfR6dFxuWcqz1ZVk6pgdgabVHgpkHNNq7bMj9nFKo3wWU5';
  const tx=await rpc('getTransaction',[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  const ix=tx.transaction.message.instructions.find(x=>x.programId===program.toBase58() &&
    Buffer.from(bs58.decode(x.data)).subarray(0,8).toString('hex')==='7b86510031446262');
  const roles=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  return {signature:sig,slot:tx.slot,ix,roles,data:Buffer.from(bs58.decode(ix.data))};}
async function probe(fixture,variant){const ata=getAssociatedTokenAddressSync(mint,wallet.publicKey);
  const accounts=fixture.ix.accounts.map((address,index)=>{
    const pubkey=index===0||index===1?wallet.publicKey:index===3?market:index===5?position:
      (index===6||index===9)&&variant!=='original_destinations'?ata:new PublicKey(address);
    return {pubkey,isSigner:index===0||index===1,isWritable:index===0||index===1||
      (index===6||index===9)&&variant!=='original_destinations'||!!fixture.roles.get(address)?.writable};});
  const data=Buffer.from(fixture.data);data.writeBigUInt64LE(BigInt(Math.floor(Date.now()/1000)),8);
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:blockhash});
  if(variant!=='original_destinations')tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey,ata,wallet.publicKey,mint));
  tx.add(new TransactionInstruction({programId:program,keys:accounts,data}));tx.sign(wallet);
  const wire=tx.serialize();const result=await rpc('simulateTransaction',[wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true}]);
  return {variant,ata:ata.toBase58(),slot:result.context.slot,wireBytes:wire.length,
    error:result.value.err,computeUnits:result.value.unitsConsumed,
    logs:(result.value.logs||[]).filter(x=>/Program log:|failed:|success/.test(x)).slice(-30)};}
async function main(){const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet-beta');
  const fixture=await sample();const pos=await rpc('getAccountInfo',[position.toBase58(),{encoding:'base64',commitment:'confirmed'}]);
  const bytes=Buffer.from(pos.value.data[0],'base64');
  const derived=PublicKey.findProgramAddressSync([Buffer.from('position'),wallet.publicKey.toBuffer(),bytes.subarray(72,80)],program)[0];
  if(!derived.equals(position))throw Error('Wallet-owned position seed mismatch');
  const output={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,program:program.toBase58(),
    position:position.toBase58(),positionSlot:pos.context.slot,positionOwner:wallet.publicKey.toBase58(),
    method:'simulateTransaction',sigVerify:true,broadcast:false,fixtureSignature:fixture.signature,
    fixtureSlot:fixture.slot,probes:[]};
  for(const variant of ['original_destinations','own_ata_both'])output.probes.push(await probe(fixture,variant));
  fs.writeFileSync(`${__dirname}/yolov-close-corrected-gate.json`,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(output.probes.map(x=>({variant:x.variant,wireBytes:x.wireBytes,error:x.error,
    units:x.computeUnits,lastLogs:x.logs.slice(-12)}))));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
