#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bs58m = require('./sdk-3.0.2/node_modules/bs58');
const bs58 = bs58m.default || bs58m;
const web3 = require('./sdk-3.0.2/node_modules/@solana/web3.js');
const spl = require('./sdk-3.0.2/node_modules/@solana/spl-token');
const kit = require('./sdk-3.0.2/node_modules/@solana/kit');
const {RestakingProgram, restakingTypes: T} = require('./sdk-3.0.2');

const {Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage} = web3;
const FORK = process.env.FRAGMETRIC_FORK_RPC || 'http://127.0.0.1:9187';
const A = {
  program: new PublicKey('fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3'),
  fund: new PublicKey('3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb'),
  receipt: new PublicKey('FRAGSEthVFL7fdqM8hxfxkfCZzUvmg21cqPJVvC1qdbo'),
  wrapped: new PublicKey('WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U'),
  jsol: new PublicKey('7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn'),
  targetPoolReserve: new PublicKey('5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa'),
  eventAuthority: new PublicKey('ELPv21PLEZ3q7SXyKtKLCvECEcbUcqVSZStCBb8dJXvB'),
};
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(FORK, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function ed25519Sign(message, keypair) {
  const privateKey = crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), Buffer.from(keypair.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  return crypto.sign(null, message, privateKey);
}

function writableAt(message, index) {
  const h = message.header;
  if (index < h.numRequiredSignatures) return index < h.numRequiredSignatures - h.numReadonlySignedAccounts;
  return index < message.staticAccountKeys.length - h.numReadonlyUnsignedAccounts;
}

function encodeSignedV1(instructions, payer, blockhash, signers) {
  const compiled = new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message();
  if (compiled.addressTableLookups.length) throw new Error('v1 inline encoder received lookup tables');
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error(`v1 inline limit: ${keys.length} addresses, ${items.length} instructions`);
  const config = Buffer.alloc(8); config.writeUInt32LE(1_400_000,0); config.writeUInt32LE(67_108_864,4);
  const bodies = items.map(ix => {const head=Buffer.alloc(4);head[0]=ix.programIdIndex;head[1]=ix.accountKeyIndexes.length;head.writeUInt16LE(ix.data.length,2);return Buffer.concat([head,Buffer.from(ix.accountKeyIndexes),Buffer.from(ix.data)]);});
  const message = Buffer.concat([Buffer.from([0x81,compiled.header.numRequiredSignatures,compiled.header.numReadonlySignedAccounts,compiled.header.numReadonlyUnsignedAccounts]),Buffer.from([0x0c,0,0,0]),Buffer.from(bs58.decode(blockhash)),Buffer.from([items.length,keys.length]),...keys.map(k=>k.toBuffer()),config,...bodies]);
  const signerOrder = keys.slice(0,compiled.header.numRequiredSignatures).map(k=>k.toBase58());
  const signatures = signerOrder.map(address => {const signer=signers.get(address);if(!signer)throw new Error(`uncontrolled signer ${address}`);return ed25519Sign(message,signer);});
  const wire = Buffer.concat([message,...signatures]);
  if (wire.length > 4096) throw new Error(`v1 wire ${wire.length} > 4096`);
  return {wire,sizeBytes:wire.length,accountCount:keys.length,instructionCount:items.length,signerOrder,accountKeys:keys.map((k,i)=>({address:k.toBase58(),signer:i<compiled.header.numRequiredSignatures,writable:writableAt(compiled,i)}))};
}

function fromKit(ix) {
  return new TransactionInstruction({
    programId:new PublicKey(ix.programAddress),
    keys:(ix.accounts||[]).map(a=>({pubkey:new PublicKey(a.address),isSigner:a.role>=2,isWritable:(a.role&1)===1})),
    data:Buffer.from(ix.data||[]),
  });
}

function image(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0],'base64');
  const out = {owner:row.owner,lamports:row.lamports,dataLength:data.length,dataSha256:crypto.createHash('sha256').update(data).digest('hex')};
  if ((row.owner===spl.TOKEN_PROGRAM_ID.toBase58()||row.owner===spl.TOKEN_2022_PROGRAM_ID.toBase58())&&data.length>=165) out.tokenAmountRaw=data.readBigUInt64LE(64).toString();
  if ((row.owner===spl.TOKEN_PROGRAM_ID.toBase58()||row.owner===spl.TOKEN_2022_PROGRAM_ID.toBase58())&&data.length>=82&&data.length!==165) out.mintSupplyRaw=data.readBigUInt64LE(36).toString();
  return out;
}

function delta(after,before,field){return (BigInt(after?.[field]||0)-BigInt(before?.[field]||0)).toString();}

async function setFreshAttacker(attacker, attackerJsol, amount) {
  await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,lamports:100_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  const source=(await rpc('getAccountInfo',[A.targetPoolReserve.toBase58(),{encoding:'base64',commitment:'processed'}])).value;
  const data=Buffer.from(source.data[0],'base64');
  attacker.publicKey.toBuffer().copy(data,32); data.writeBigUInt64LE(amount,64);
  await rpc('surfnet_setAccount',[attackerJsol.toBase58(),{data:data.toString('hex'),executable:false,lamports:source.lamports,owner:source.owner,rentEpoch:0}]);
}

async function simulateV1(name, instructions, attacker, watch) {
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeSignedV1(instructions,attacker.publicKey,blockhash,new Map([[attacker.publicKey.toBase58(),attacker]]));
  const beforeRows=(await rpc('getMultipleAccounts',[watch.map(x=>x.address.toBase58()),{encoding:'base64',commitment:'processed'}])).value;
  const result=await rpc('simulateTransaction',[encoded.wire.toString('base64'),{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed',innerInstructions:true,accounts:{encoding:'base64',addresses:watch.map(x=>x.address.toBase58())}}]);
  const before=Object.fromEntries(watch.map((x,i)=>[x.label,image(beforeRows[i])]));
  const after=Object.fromEntries(watch.map((x,i)=>[x.label,image(result.value.accounts?.[i])]));
  return {name,txVersion:1,signatureVerification:true,localForkOnly:true,liveSubmission:false,...encoded,wireSha256:crypto.createHash('sha256').update(encoded.wire).digest('hex'),err:result.value.err,unitsConsumed:result.value.unitsConsumed,logs:result.value.logs,before,after,deltas:{attackerJsolRaw:delta(after.attackerJsol,before.attackerJsol,'tokenAmountRaw'),fundJsolReserveRaw:delta(after.fundJsolReserve,before.fundJsolReserve,'tokenAmountRaw'),targetPoolReserveRaw:delta(after.targetPoolReserve,before.targetPoolReserve,'tokenAmountRaw'),attackerFragRaw:delta(after.attackerFrag,before.attackerFrag,'tokenAmountRaw'),receiptSupplyRaw:delta(after.receiptMint,before.receiptMint,'mintSupplyRaw')}};
}

async function main(){
  const attacker=Keypair.generate();
  const kitSigner=await kit.createKeyPairSignerFromBytes(attacker.secretKey);
  const rp=RestakingProgram.mainnet(FORK,{transaction:{feePayer:kitSigner,signers:[kitSigner]}});
  const attackerJsol=spl.getAssociatedTokenAddressSync(A.jsol,attacker.publicKey);
  const attackerFrag=spl.getAssociatedTokenAddressSync(A.receipt,attacker.publicKey,false,spl.TOKEN_2022_PROGRAM_ID);
  await setFreshAttacker(attacker,attackerJsol,50_000_000_000_000n);
  const amounts=[1n,2n,10n,100n,1_000n,1_000_000n,1_000_000_000n,35_484_568_921_185n,36_616_676_915_545n];
  const cases=[];
  for(const amount of amounts){
    const message=await rp.fragSOL.payer.deposit.assemble({assetMint:A.jsol.toBase58(),assetAmount:amount,applyPresetComputeUnitLimit:false},{feePayer:kitSigner,signers:[kitSigner]});
    const instructions=message.instructions.map(fromKit);
    const fundJsolIx=instructions.at(-1);
    const fundJsolReserve=fundJsolIx.keys[7].pubkey;
    const watch=[{label:'attackerJsol',address:attackerJsol},{label:'fundJsolReserve',address:fundJsolReserve},{label:'targetPoolReserve',address:A.targetPoolReserve},{label:'attackerFrag',address:attackerFrag},{label:'receiptMint',address:A.receipt},{label:'fund',address:A.fund}];
    try{cases.push(await simulateV1(`deposit_${amount}`,instructions,attacker,watch));}catch(error){cases.push({name:`deposit_${amount}`,localError:error.message});}
  }

  const fundDecoded=T.getFundAccountDecoder().decode(Buffer.from((await rpc('getAccountInfo',[A.fund.toBase58(),{encoding:'base64',commitment:'processed'}])).value.data[0],'base64'));
  const strategyIx=T.getFundManagerUpdateFundStrategyInstruction({fundManager:kitSigner,receiptTokenMint:A.receipt.toBase58(),fundAccount:A.fund.toBase58(),eventAuthority:A.eventAuthority.toBase58(),program:A.program.toBase58(),depositEnabled:!!fundDecoded.depositEnabled,donationEnabled:!!fundDecoded.donationEnabled,withdrawalEnabled:!!fundDecoded.withdrawalEnabled,transferEnabled:!!fundDecoded.transferEnabled,operationEnabled:!!fundDecoded.operationEnabled,withdrawalFeeRateBps:fundDecoded.withdrawalFeeRateBps,withdrawalBatchThresholdSeconds:fundDecoded.withdrawalBatchThresholdIntervalSeconds,performanceFeeRateBps:fundDecoded.performanceFeeRateBps});
  cases.push(await simulateV1('outsider_update_general_strategy', [fromKit(strategyIx)], attacker,[{label:'attackerJsol',address:attackerJsol},{label:'fundJsolReserve',address:new PublicKey('BU9NeT5CfV7SSo8uKCrpCCcfxdkcLSirLtydXXV8MDhF')},{label:'targetPoolReserve',address:A.targetPoolReserve},{label:'attackerFrag',address:attackerFrag},{label:'receiptMint',address:A.receipt},{label:'fund',address:A.fund}]));

  const output={observedAt:new Date().toISOString(),fork:FORK,attacker:attacker.publicKey.toBase58(),setup:{freshAttackerLamports:100_000_000_000,freshAttackerJsolRaw:'50000000000000',mutationScope:'Only fresh attacker-owned system and JSOL token accounts were set. Protocol, pool, lender, mint, and program accounts were lazily loaded unchanged from current mainnet.',noMainnetSend:true},cases};
  fs.writeFileSync(path.join(__dirname,'signed-local-deposit-probes.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify(cases.map(c=>({name:c.name,err:c.err,localError:c.localError,sizeBytes:c.sizeBytes,accountCount:c.accountCount,deltas:c.deltas,guard:(c.logs||[]).filter(x=>/Error|Constraint|unauthor|Instruction:/.test(x)).slice(-12)})),null,2));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
