#!/usr/bin/env node
// Current mainnet read-only v1 simulations. This file never signs or submits a transaction.
const fs = require('fs');
const {Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs.default || bs;
const {createApproveInstruction,createSetAuthorityInstruction,createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,getAssociatedTokenAddressSync,AuthorityType} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const RPC_URL = process.env.RPC_URL || process.env.SOLANA_RPC;
if (!RPC_URL) throw new Error('RPC_URL or SOLANA_RPC is required');
const outputPath = __dirname + '/project0-v1-composition.json';
const P0 = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const JUP_VAULT = new PublicKey('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi');
const RAYDIUM_CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const sourceSignature = '2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const vaultSignature = 'N7RNYhPJiXyu9KW1kfnP7HZPmzEpL6Wz13Euwoct4XxkLYjxLMJp1tXb8QJyQbmESxWNyiGzUw7Cyis7YtWUiRj';
const START = Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]);
const END = Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]);
const BORROW = Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]);
const REPAY = Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]);
const VAULT_BORROW = Buffer.from([217, 106, 208, 99, 116, 151, 42, 135]);
const conn = new Connection(RPC_URL, 'processed');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function clone(ix) {return new TransactionInstruction({programId:ix.programId,keys:ix.keys.map(k=>({...k})),data:Buffer.from(ix.data)});}
function matching(ix, id, disc) {return ix.programId.equals(id) && Buffer.from(ix.data).subarray(0,8).equals(disc);}
async function decompile(signature) {
  const tx = await rpc('getTransaction',[signature,{encoding:'base64',maxSupportedTransactionVersion:1}]);
  if (!tx) throw Error(`missing source ${signature}`);
  const wire = VersionedTransaction.deserialize(Buffer.from(tx.transaction[0],'base64'));
  const alts = await Promise.all((wire.message.addressTableLookups||[]).map(async x=>{
    const result=await conn.getAddressLookupTable(x.accountKey);
    if(!result.value)throw Error(`missing ALT ${x.accountKey}`);
    return result.value;
  }));
  return {slot:tx.slot, message:TransactionMessage.decompile(wire.message,{addressLookupTableAccounts:alts})};
}
function vaultControl(message) {
  const ix=clone(message.instructions.find(x=>matching(x,JUP_VAULT,VAULT_BORROW)));
  if (!ix) throw Error('vault borrow missing');
  ix.keys[13].pubkey=new PublicKey('HEVtoTQK7wPt7swXEeBDXX293N6gEYKqjHVek9juYUY6');
  ix.keys[14].pubkey=ix.keys[13].pubkey;
  ix.keys[15].pubkey=new PublicKey('GgzmHfGzacUsi4B7djXnkvUv3fc9Ws2ZWLqTYpwkjjzf');
  ix.keys[16].pubkey=ix.keys[15].pubkey;
  ix.data.fill(0,8,40);
  ix.data.writeBigInt64LE(1000n,24);
  return ix;
}
function v1Wire(payer, blockhash, instructions, cuLimit=1400000, dataLimit=67108864) {
  const compiled = new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message([]);
  const {header,staticAccountKeys:keys,compiledInstructions:ixs}=compiled;
  if(keys.length>64 || ixs.length>64)throw Error(`v1 key/instruction limit: ${keys.length}/${ixs.length}`);
  const configMask=Buffer.alloc(4); configMask.writeUInt32LE(0x0c);
  const config=Buffer.alloc(8); config.writeUInt32LE(cuLimit,0);config.writeUInt32LE(dataLimit,4);
  const prefix=Buffer.from([0x81,header.numRequiredSignatures,header.numReadonlySignedAccounts,header.numReadonlyUnsignedAccounts]);
  const headerParts=[];const payloadParts=[];
  for(const ix of ixs){
    if(ix.accountKeyIndexes.length>255 || ix.data.length>65535)throw Error('v1 instruction size limit');
    const h=Buffer.alloc(4);h[0]=ix.programIdIndex;h[1]=ix.accountKeyIndexes.length;h.writeUInt16LE(ix.data.length,2);
    headerParts.push(h);payloadParts.push(Buffer.from(ix.accountKeyIndexes),Buffer.from(ix.data));
  }
  const wire=Buffer.concat([prefix,configMask,Buffer.from(bs58.decode(blockhash)),Buffer.from([ixs.length,keys.length]),...keys.map(k=>k.toBuffer()),config,...headerParts,...payloadParts,Buffer.alloc(64*header.numRequiredSignatures)]);
  if(wire.length>4096)throw Error(`v1 wire is ${wire.length} bytes`);
  return {wire,addresses:keys.length,signatures:header.numRequiredSignatures,ixs:ixs.length,cuLimit,dataLimit};
}
async function simulate(name,payer,instructions,watched=[],commitment='processed') {
  const {blockhash}=await conn.getLatestBlockhash(commitment);
  const tx=v1Wire(payer,blockhash,instructions);
  const result=await rpc('simulateTransaction',[tx.wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment,innerInstructions:true,...(watched.length?{accounts:{encoding:'base64',addresses:watched.map(String)}}:{})}]);
  const value=result.value;
  return {name,v1Bytes:tx.wire.length,accountCount:tx.addresses,signatures:tx.signatures,instructionCount:tx.ixs,computeUnitLimit:tx.cuLimit,loadedAccountsDataSizeLimit:tx.dataLimit,slot:result.context?.slot,err:value.err,unitsConsumed:value.unitsConsumed,loadedAccountsDataSize:value.loadedAccountsDataSize,returnData:value.returnData,logs:value.logs,innerInstructions:value.innerInstructions,watched:watched.map((key,i)=>({address:String(key),postData:value.accounts?.[i]?.data?.[0]||null}))};
}
function concise(x) {return {name:x.name,v1Bytes:x.v1Bytes,accountCount:x.accountCount,instructionCount:x.instructionCount,slot:x.slot,err:x.err,unitsConsumed:x.unitsConsumed,logTail:x.logs?.filter(z=>z.includes('Instruction:')||z.includes('Error')||z.includes('failed')).slice(-8)};}
function raydiumSwap(sample,amount,input,output,authority){
  const i=sample.instruction;
  const keys=i.accounts.map(x=>({pubkey:new PublicKey(x.address),isSigner:x.signer,isWritable:x.writable}));
  keys[0].pubkey=authority;keys[4].pubkey=input;keys[5].pubkey=output;
  const data=Buffer.from(i.dataHex,'hex');data.writeBigUInt64LE(amount,8);data.writeBigUInt64LE(0n,16);
  return new TransactionInstruction({programId:RAYDIUM_CPMM,keys,data});
}
function rawTokenAmount(watchedRow){const b=watchedRow?.postData?Buffer.from(watchedRow.postData,'base64'):null;return b&&b.length>=72?b.readBigUInt64LE(64):null}
async function main(){
  const p0=await decompile(sourceSignature);
  const vault=await decompile(vaultSignature);
  const start=clone(p0.message.instructions.find(x=>matching(x,P0,START)));
  const end=clone(p0.message.instructions.find(x=>matching(x,P0,END)));
  const borrow=clone(p0.message.instructions.find(x=>matching(x,P0,BORROW)));
  const repay=clone(p0.message.instructions.find(x=>matching(x,P0,REPAY)));
  const vaultBorrow=vaultControl(vault.message);
  if(!start||!end||!borrow||!repay)throw Error('P0 source incomplete');
  const p0Payer=p0.message.payerKey;
  const freshDestination=getAssociatedTokenAddressSync(new PublicKey('So11111111111111111111111111111111111111112'),borrow.keys[2].pubkey);
  borrow.keys[4].pubkey=freshDestination;
  repay.keys[4].pubkey=freshDestination;
  const createDestination=createAssociatedTokenAccountIdempotentInstruction(p0Payer,freshDestination,borrow.keys[2].pubkey,new PublicKey('So11111111111111111111111111111111111111112'));
  const watched=[borrow.keys[6].pubkey,borrow.keys[4].pubkey,vaultBorrow.keys[25].pubkey,vaultBorrow.keys[2].pubkey,vaultBorrow.keys[7].pubkey,vaultBorrow.keys[11].pubkey];
  const make=(middle)=>{const ixs=[clone(start),clone(createDestination),...middle.map(clone),clone(end)];ixs[0].data.writeBigUInt64LE(BigInt(ixs.length-1),8);return ixs;};
  const cases=[];
  cases.push(await simulate('start_end_v1_format_control',p0Payer,make([]),watched));
  cases.push(await simulate('start_borrow_repay_end',p0Payer,make([borrow,repay]),watched));
  cases.push(await simulate('start_borrow_vault_borrow_repay_end',p0Payer,make([borrow,vaultBorrow,repay]),watched));
  cases.push(await simulate('start_vault_borrow_borrow_repay_end',p0Payer,make([vaultBorrow,borrow,repay]),watched));
  cases.push(await simulate('start_borrow_repay_vault_borrow_end',p0Payer,make([borrow,repay,vaultBorrow]),watched));
  const vaultSupply=clone(vaultBorrow);
  vaultSupply.data.fill(0,8,40);
  vaultSupply.data.writeBigInt64LE(10000000n,8);
  vaultSupply.keys[1].pubkey=borrow.keys[4].pubkey;
  const vaultWithdraw=clone(vaultSupply);
  vaultWithdraw.data.writeBigInt64LE(-10000000n,8);
  vaultWithdraw.keys[3].pubkey=vaultSupply.keys[0].pubkey;
  vaultWithdraw.keys[5].pubkey=borrow.keys[4].pubkey;
  const approve=createApproveInstruction(borrow.keys[4].pubkey,vaultSupply.keys[0].pubkey,borrow.keys[2].pubkey,10000000n);
  cases.push(await simulate('borrow_approve_delegate_vault_supply_repay_end',p0Payer,make([borrow,approve,vaultSupply,repay]),watched));
  cases.push(await simulate('borrow_approve_delegate_vault_supply_withdraw_repay_end',p0Payer,make([borrow,approve,vaultSupply,vaultWithdraw,repay]),watched));
  const ownerToJup=createSetAuthorityInstruction(borrow.keys[4].pubkey,borrow.keys[2].pubkey,AuthorityType.AccountOwner,vaultSupply.keys[0].pubkey);
  const ownerBack=createSetAuthorityInstruction(borrow.keys[4].pubkey,vaultSupply.keys[0].pubkey,AuthorityType.AccountOwner,borrow.keys[2].pubkey);
  cases.push(await simulate('borrow_transfer_owner_supply_restore_owner_repay_end',p0Payer,make([borrow,ownerToJup,vaultSupply,ownerBack,repay]),watched));
  cases.push(await simulate('borrow_transfer_owner_supply_withdraw_restore_owner_repay_end',p0Payer,make([borrow,ownerToJup,vaultSupply,vaultWithdraw,ownerBack,repay]),watched));
  const amountPair=(n)=>{const b=clone(borrow),r=clone(repay);b.data.writeBigUInt64LE(n,8);r.data.writeBigUInt64LE(n,8);return[b,r]};
  const vaultParsed=await conn.getParsedAccountInfo(borrow.keys[6].pubkey,'processed');
  const available=BigInt(vaultParsed.value.data.parsed.info.tokenAmount.amount);
  for(const amount of [1n,2n,1000n,available*9n/10n,available-1n]){
    cases.push(await simulate(`p0_borrow_repay_${amount}`,p0Payer,make(amountPair(amount)),watched));
  }
  const repeated=[];
  for(let i=0;i<10;i++)repeated.push(amountPair(1n)[0]);
  for(let i=0;i<10;i++)repeated.push(amountPair(1n)[1]);
  cases.push(await simulate('p0_ten_one_unit_borrows_then_ten_repays',p0Payer,make(repeated),watched));
  const vaultRepay=clone(vaultBorrow);
  vaultRepay.data.writeBigInt64LE(-1000n,24);
  cases.push(await simulate('p0_flash_vault_borrow_repay_same_tx',p0Payer,make([borrow,vaultBorrow,vaultRepay,repay]),watched));
  cases.push(await simulate('p0_flash_vault_double_borrow_same_tx',p0Payer,make([borrow,vaultBorrow,vaultBorrow,repay]),watched));
  cases.push(...await Promise.all([
    simulate('fixed_slot_no_vault_borrow',p0Payer,make([borrow,repay]),watched,'finalized'),
    simulate('fixed_slot_one_vault_borrow',p0Payer,make([borrow,vaultBorrow,repay]),watched,'finalized'),
    simulate('fixed_slot_two_vault_borrows',p0Payer,make([borrow,vaultBorrow,vaultBorrow,repay]),watched,'finalized'),
  ]));
  const topPool=JSON.parse(fs.readFileSync(__dirname+'/raydium-cpmm-top-pool-history.json','utf8'));
  const forwardSample=topPool.samples.find(x=>x.signature.startsWith('foep5953'));
  const reverseSample=topPool.samples.find(x=>x.signature.startsWith('5HoqHgcZ'));
  if(!forwardSample||!reverseSample)throw Error('Raydium CPMM control sample missing');
  const memeMint=new PublicKey('Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk');
  const memeDestination=getAssociatedTokenAddressSync(memeMint,borrow.keys[2].pubkey);
  const createMemeDestination=createAssociatedTokenAccountIdempotentInstruction(p0Payer,memeDestination,borrow.keys[2].pubkey,memeMint);
  const forwardAmount=10000000n;
  const forward=raydiumSwap(forwardSample,forwardAmount,borrow.keys[4].pubkey,memeDestination,borrow.keys[2].pubkey);
  const swapWatched=[...watched,memeDestination,forward.keys[6].pubkey,forward.keys[7].pubkey];
  const forwardOnly=await simulate('p0_flash_borrow_cpmm_forward_no_repay',p0Payer,make([createMemeDestination,...amountPair(forwardAmount).slice(0,1),forward]),swapWatched);
  cases.push(forwardOnly);
  const innerOutput=(forwardOnly.innerInstructions||[]).flatMap(x=>x.instructions||[]).find(x=>x.parsed?.info?.destination===memeDestination.toBase58()&&x.parsed?.info?.tokenAmount?.amount)?.parsed?.info?.tokenAmount?.amount;
  const firstOutput=rawTokenAmount(forwardOnly.watched.find(x=>x.address===memeDestination.toBase58()))??(innerOutput?BigInt(innerOutput):null);
  if(firstOutput!==null&&firstOutput>0n){
    const reverseAmount=firstOutput*99n/100n;
    const reverse=raydiumSwap(reverseSample,reverseAmount,memeDestination,borrow.keys[4].pubkey,borrow.keys[2].pubkey);
    const forwardReverse=await simulate('p0_flash_cpmm_forward_reverse_no_repay',p0Payer,make([createMemeDestination,...amountPair(forwardAmount).slice(0,1),forward,reverse]),swapWatched);
    cases.push(forwardReverse);
    cases.push(await simulate('p0_flash_cpmm_forward_reverse_full_repay',p0Payer,make([createMemeDestination,...amountPair(forwardAmount).slice(0,1),forward,reverse,amountPair(forwardAmount)[1]]),swapWatched));
    const seed=SystemProgram.transfer({fromPubkey:borrow.keys[2].pubkey,toPubkey:borrow.keys[4].pubkey,lamports:1000000});
    const sync=createSyncNativeInstruction(borrow.keys[4].pubkey);
    cases.push(await simulate('p0_flash_cpmm_roundtrip_seeded_full_repay',p0Payer,make([createMemeDestination,seed,sync,...amountPair(forwardAmount).slice(0,1),forward,reverse,amountPair(forwardAmount)[1]]),swapWatched));
  }
  const output={generatedAt:new Date().toISOString(),transport:'read-only mainnet simulateTransaction; no sendTransaction or signature',p0Program:P0.toBase58(),jupiterVaultProgram:JUP_VAULT.toBase58(),sourceSignatures:{p0:sourceSignature,jupiterVault:vaultSignature},sourceSlots:{p0:p0.slot,jupiterVault:vault.slot},borrow:{authority:borrow.keys[2].pubkey.toBase58(),bank:borrow.keys[3].pubkey.toBase58(),destination:borrow.keys[4].pubkey.toBase58(),vault:borrow.keys[6].pubkey.toBase58(),rawAmount:borrow.data.readBigUInt64LE(8).toString(),observedVaultAvailableRaw:available.toString()},repay:{bank:repay.keys[3].pubkey.toBase58(),source:repay.keys[4].pubkey.toBase58(),rawAmount:repay.data.readBigUInt64LE(8).toString()},jupiterVault:{signer:vaultBorrow.keys[0].pubkey.toBase58(),supplyMint:vaultBorrow.keys[8].pubkey.toBase58(),borrowMint:vaultBorrow.keys[9].pubkey.toBase58(),supplyDestination:vaultBorrow.keys[5].pubkey.toBase58()},watched:watched.map(String),cases};
  fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({outputPath,sourceSlots:output.sourceSlots,borrow:output.borrow,repay:output.repay,cases:cases.map(concise)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
