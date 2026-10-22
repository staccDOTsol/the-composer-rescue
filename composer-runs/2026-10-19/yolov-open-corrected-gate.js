#!/usr/bin/env node
// Signed mainnet simulations only. Tests custom keeper after correcting PDA and ATA accounts.
const fs=require('fs');
const {Keypair,PublicKey,Transaction,TransactionInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction}=require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bs58m=require('../2026-10-15/onre-harness/node_modules/bs58');const bs58=bs58m.default||bs58m;
const program=new PublicKey('yoLovHV5eT4DNPMG2Bu1NLmq8nVygEAPrNT1Rx6vWFA');
const mint=new PublicKey('JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'))));
const row=fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env','utf8').split(/\r?\n/)
  .find(x=>/^\s*export SOLANA_RPC=/.test(x));
const endpoint=row?.slice(row.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  const b=await r.json();if(!r.ok||b.error)throw Error(`${method}: ${b.error?.message||r.status}`);return b.result;}

async function fixture(){const signature='2NX47m8N8qyiUBhkVXfEwo9Ws8yiQmqo84ehcMGowcStt6wYGybn5ux9EWTyXMbJ6L7NPjnPWCPJp7LrDPB51sv2';
  const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  const ix=tx.transaction.message.instructions.find(x=>x.programId===program.toBase58() &&
    Buffer.from(bs58.decode(x.data)).subarray(0,8).toString('hex')==='87802f4d0f98f031');
  const roles=new Map(tx.transaction.message.accountKeys.map(x=>[x.pubkey,x]));
  return {signature,slot:tx.slot,ix,roles,originalData:Buffer.from(bs58.decode(ix.data))};}

async function probe(sample, amount, withAta){
  const data=Buffer.from(sample.originalData);
  // 27-byte args: 8-byte position nonce, 8-byte Unix time, 8-byte collateral, 3 trailing bytes.
  data.writeBigUInt64LE(BigInt(Math.floor(Date.now()/1000)),16);
  data.writeBigUInt64LE(BigInt(amount),24);
  const position=PublicKey.findProgramAddressSync([Buffer.from('position'),wallet.publicKey.toBuffer(),data.subarray(8,16)],program)[0];
  const ata=getAssociatedTokenAddressSync(mint,wallet.publicKey);
  const accounts=sample.ix.accounts.map((address,index)=>{
    const pubkey=index===0||index===1?wallet.publicKey:index===5?position:index===8?ata:new PublicKey(address);
    return {pubkey,isSigner:index===0||index===1,isWritable:index===0||index===1||!!sample.roles.get(address)?.writable};});
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value.blockhash;
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:blockhash});
  if(withAta)tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey,ata,wallet.publicKey,mint));
  tx.add(new TransactionInstruction({programId:program,keys:accounts,data}));tx.sign(wallet);
  const wire=tx.serialize();
  const result=await rpc('simulateTransaction',[wire.toString('base64'),{encoding:'base64',sigVerify:true,
    replaceRecentBlockhash:false,commitment:'confirmed',innerInstructions:true}]);
  return {amount:String(amount),withAta,position:position.toBase58(),ata:ata.toBase58(),slot:result.context.slot,
    wireBytes:wire.length,error:result.value.err,computeUnits:result.value.unitsConsumed,
    logs:(result.value.logs||[]).filter(x=>/Program log:|failed:|success/.test(x)).slice(-25)};
}
async function main(){const genesis=await rpc('getGenesisHash',[]);
  if(genesis!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet-beta');
  const sample=await fixture();const out={observedAt:new Date().toISOString(),network:'mainnet-beta',genesis,
    program:program.toBase58(),method:'simulateTransaction',sigVerify:true,broadcast:false,
    sampleSignature:sample.signature,sampleSlot:sample.slot,probes:[]};
  for(const amount of [0,1,5000000])out.probes.push(await probe(sample,amount,true));
  fs.writeFileSync(`${__dirname}/yolov-open-corrected-gate.json`,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify(out.probes.map(p=>({amount:p.amount,wireBytes:p.wireBytes,error:p.error,
    units:p.computeUnits,lastLogs:p.logs.slice(-10)}))));}
main().catch(e=>{console.error(e.message);process.exitCode=1});
