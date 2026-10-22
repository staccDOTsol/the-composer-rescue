#!/usr/bin/env node
// Read-only current Solana v1 (4096-byte) KLend -> Jupiter Lock compositions.
// Fake signer privileges are possible because simulateTransaction uses sigVerify:false;
// authorized-signer controls must never be described as live exploitability.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Connection,PublicKey,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const anchor=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {encodeV1}=require('./klend-v1-composition.js');
const DIR=__dirname,P=s=>new PublicKey(s),LOC=P('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const JUP=P('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split('\n')
  .filter(s=>s.includes('=')).map(s=>s.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL;
const conn=new Connection(endpoint,'confirmed');
const claimSample=require('./locp-claim-control.json');
const flashSample=require('./locp-jup-flash-sample.json').hit;
const state=require('./locp-source-current-state.json');
const jupEscrow=state.rows.find(r=>r.state.address==='6wsjaQTidXNqmPDw4st2yMtFmTk7yyBEox5SydFQeJe7');
const idl=require('./meteora-dbc-source/idls/locker.json');
const kaminoIdl=require('./marginfi-source/idls-complete/kamino_lending.json');
const reserveCoder=new anchor.BorshAccountsCoder(kaminoIdl);
const claimSpec=idl.instructions.find(ix=>ix.name==='claim_v2');
const memo=P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const token=P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const event=P('AqUDk3wybxjZujrNbKmjr2YTUZ8RA1a1nyGgs1zSmvTG');
const sampleTx=flashSample.transaction, m=sampleTx.transaction.message;
const staticKeys=m.accountKeys, loadedWritable=sampleTx.meta.loadedAddresses?.writable||[];
const allKeys=[...staticKeys,...loadedWritable,...(sampleTx.meta.loadedAddresses?.readonly||[])];
const header=m.header;
const isWritable=i=>i<staticKeys.length ? (i<header.numRequiredSignatures ?
  i<header.numRequiredSignatures-header.numReadonlySignedAccounts :
  i<staticKeys.length-header.numReadonlyUnsignedAccounts) :
  i<staticKeys.length+loadedWritable.length;
function sampleIx(index){const ix=m.instructions[index];return new TransactionInstruction({
 programId:P(allKeys[ix.programIdIndex]),data:Buffer.from(bs58.decode(ix.data)),
 keys:ix.accounts.map(i=>({pubkey:P(allKeys[i]),isSigner:i<header.numRequiredSignatures,isWritable:isWritable(i)}))});}
const borrowBase=sampleIx(flashSample.borrow.index),repayBase=sampleIx(flashSample.repay.index);
if(!borrowBase.programId.equals(KLEND)||!repayBase.programId.equals(KLEND))throw Error('KLend sample changed');
const refreshHit=require('./locp-jup-refresh-sample.json').hit;
const refreshTx=refreshHit.transaction,refreshMsg=refreshTx.transaction.message;
const refreshStatic=refreshMsg.accountKeys,refreshLoaded=refreshTx.meta.loadedAddresses?.writable||[];
const refreshAll=[...refreshStatic,...refreshLoaded,...(refreshTx.meta.loadedAddresses?.readonly||[])];
const refreshHeader=refreshMsg.header,refreshRaw=refreshMsg.instructions[refreshHit.index];
const refreshWritable=i=>i<refreshStatic.length?(i<refreshHeader.numRequiredSignatures?
 i<refreshHeader.numRequiredSignatures-refreshHeader.numReadonlySignedAccounts:
 i<refreshStatic.length-refreshHeader.numReadonlyUnsignedAccounts):i<refreshStatic.length+refreshLoaded.length;
const refreshIx=new TransactionInstruction({programId:P(refreshAll[refreshRaw.programIdIndex]),
 data:Buffer.from(bs58.decode(refreshRaw.data)),keys:refreshRaw.accounts.map(i=>({
  pubkey:P(refreshAll[i]),isSigner:i<refreshHeader.numRequiredSignatures,isWritable:refreshWritable(i)}))});
const borrower=borrowBase.keys[0].pubkey,userJup=borrowBase.keys[6].pubkey;
const flashSupply=borrowBase.keys[5].pubkey,flashFee=borrowBase.keys[7].pubkey;
const flashReserve=borrowBase.keys[3].pubkey;
function flash(ix,amount,index){const data=Buffer.from(ix.data);data.writeBigUInt64LE(amount,8);
 if(index!==undefined)data[16]=index;return new TransactionInstruction({programId:KLEND,
  keys:ix.keys.map(k=>({...k})),data});}
function claim(escrow,recipient,destination,amount){const accounts=[escrow.state.address,escrow.state.mint,
 escrow.vault.address,recipient,destination,memo.toBase58(),token.toBase58(),event.toBase58(),LOC.toBase58()];
 const data=Buffer.from(bs58.decode(claimSample.locIxs[0].data));data.writeBigUInt64LE(amount,8);
 return new TransactionInstruction({programId:LOC,data,keys:accounts.map((a,i)=>({pubkey:P(a),
  isSigner:!!claimSpec.accounts[i].signer,isWritable:!!claimSpec.accounts[i].writable}))});}
const cmnsEscrow=state.rows.find(r=>r.state.address==='52dwNzfWa2MmHEUTJWTbKdjXpgiRG8kPiqWe7JZBJFv5');
const cmnsDest=P('EyWdqQmTf4TkarGDcHorw2m2RL32obzuoE5J4coTGL1Y');
const cmnsRecipient=P(cmnsEscrow.state.recipient),jupRecipient=P(jupEscrow.state.recipient);
const trace=[flashSupply,flashFee,userJup,flashReserve,P(jupEscrow.state.address),
  P(jupEscrow.vault.address),P(cmnsEscrow.state.address),P(cmnsEscrow.vault.address),cmnsDest];
function snap(info,i){if(!info)return null;const data=Buffer.isBuffer(info.data)?info.data:Buffer.from(info.data[0],'base64');
 if([0,1,2,5,7,8].includes(i))return data.length>=72?{rawAmount:data.readBigUInt64LE(64).toString()}:null;
 if([4,6].includes(i))return data.length>=192?{totalClaimed:data.readBigUInt64LE(184).toString(),hash:crypto.createHash('sha256').update(data).digest('hex')}:null;
 if(i===3&&data.length===8624){const d=reserveCoder.decode('Reserve',data);return{
  availableRaw:d.liquidity.total_available_amount.toString(),
  borrowedAmountSf:d.liquidity.borrowed_amount_sf.toString(),
  collateralMintSupply:d.collateral.mint_total_supply.toString(),
  flashLoanFeeSf:d.config.fees.flash_loan_fee_sf.toString(),
  hash:crypto.createHash('sha256').update(data).digest('hex')};}
 return {hash:crypto.createHash('sha256').update(data).digest('hex')};}
let id=0;
async function simulate(name,ixs,payer,watch,blockhash,pre){
 let wire;try{wire=encodeV1(ixs,payer,blockhash);}catch(e){return{name,localError:e.message};}
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  jsonrpc:'2.0',id:++id,method:'simulateTransaction',params:[wire.wire.toString('base64'),
  {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',
   innerInstructions:true,accounts:{encoding:'base64',addresses:watch.map(k=>k.toBase58())}}]})});
 const j=await r.json(),v=j.result?.value;
 const post=Object.fromEntries(watch.map((k,i)=>[k.toBase58(),snap(v?.accounts?.[i],trace.findIndex(t=>t.equals(k)))]));
 const deltas=Object.fromEntries(watch.map(k=>{const s=k.toBase58(),a=pre[s],b=post[s];
  const aVal=a?.rawAmount??a?.totalClaimed,bVal=b?.rawAmount??b?.totalClaimed;
  return[s,aVal!=null&&bVal!=null?(BigInt(bVal)-BigInt(aVal)).toString():null]}));
 const reserveBefore=pre[flashReserve.toBase58()],reserveAfter=post[flashReserve.toBase58()];
 const reserveDeltas=reserveBefore&&reserveAfter?Object.fromEntries(
  ['availableRaw','borrowedAmountSf','collateralMintSupply'].map(k=>[k,
    (BigInt(reserveAfter[k])-BigInt(reserveBefore[k])).toString()])):null;
 return{name,slot:j.result?.context?.slot??null,v1Bytes:wire.sizeBytes,v0Bytes:wire.v0Bytes,
  accountCount:wire.addressCount,requiredSignatures:wire.requiredSignatures,
  instructions:wire.instructionCount,computeUnitLimit:wire.config.computeLimit,
  rpcError:j.error??null,err:v?.err??null,unitsConsumed:v?.unitsConsumed??null,
  loadedAccountsDataSize:v?.loadedAccountsDataSize??null,post,deltas,reserveDeltas,
  logs:v?.logs?.filter(x=>x.includes('Program log:')||x.includes('failed:')||x.includes('Instruction:'))??null,
  innerInstructions:v?.innerInstructions??null};}
async function main(){
 const preResult=await conn.getMultipleAccountsInfoAndContext(trace,'confirmed');
 const pre=Object.fromEntries(trace.map((k,i)=>[k.toBase58(),snap(preResult.value[i],i)]));
 const amount=BigInt(pre[flashSupply.toBase58()].rawAmount);
 const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash;
 const b=n=>flash(borrowBase,n),r=n=>flash(repayBase,n,0);
 const specs=[
  ['cmns_claim_control', [claim(cmnsEscrow,cmnsRecipient,cmnsDest,1n)],cmnsRecipient],
  ['cmns_two_dust_claims', [claim(cmnsEscrow,cmnsRecipient,cmnsDest,1n),claim(cmnsEscrow,cmnsRecipient,cmnsDest,1n)],cmnsRecipient],
  ['cmns_claim_max_u64', [claim(cmnsEscrow,cmnsRecipient,cmnsDest,(1n<<64n)-1n)],cmnsRecipient],
  ['cmns_two_max_claim_legs', [claim(cmnsEscrow,cmnsRecipient,cmnsDest,(1n<<64n)-1n),claim(cmnsEscrow,cmnsRecipient,cmnsDest,(1n<<64n)-1n)],cmnsRecipient],
  ['cmns_claim_zero_max', [claim(cmnsEscrow,cmnsRecipient,cmnsDest,0n)],cmnsRecipient],
  ['cmns_outsider_recipient', [claim(cmnsEscrow,borrower,cmnsDest,1n)],borrower],
  ['cmns_recipient_token_alias_vault', [claim(cmnsEscrow,cmnsRecipient,P(cmnsEscrow.vault.address),1n)],cmnsRecipient],
  ['cmns_escrow_token_alias_flash_supply', [new TransactionInstruction({programId:LOC,data:Buffer.from(bs58.decode(claimSample.locIxs[0].data)),keys:claim(cmnsEscrow,cmnsRecipient,cmnsDest,1n).keys.map((k,i)=>i===2?{...k,pubkey:flashSupply}:k)})],cmnsRecipient],
  ['jup_outsider_claim', [claim(jupEscrow,borrower,userJup,1n)],borrower],
  ['jup_authorized_recipient_claim_before_cliff', [claim(jupEscrow,jupRecipient,userJup,1n)],jupRecipient],
  ['jup_flash_dust_pair', [b(1n),r(1n)],borrower],
  ['jup_refresh_before_flash_pair', [refreshIx,b(1n),flash(repayBase,1n,1)],borrower],
  ['jup_refresh_between_flash_pair', [b(1n),refreshIx,r(1n)],borrower],
  ['jup_flash_dust_outsider_claim_repay', [b(1n),claim(jupEscrow,borrower,userJup,1n),r(1n)],borrower],
  ['jup_refresh_before_flash_outsider_claim_repay', [refreshIx,b(1n),claim(jupEscrow,borrower,userJup,1n),flash(repayBase,1n,1)],borrower],
  ['jup_flash_refresh_outsider_claim_repay', [b(1n),refreshIx,claim(jupEscrow,borrower,userJup,1n),r(1n)],borrower],
  ['jup_outsider_claim_before_flash', [claim(jupEscrow,borrower,userJup,1n),b(1n),flash(repayBase,1n,1)],borrower],
  ['jup_outsider_claim_after_flash_repay', [b(1n),r(1n),claim(jupEscrow,borrower,userJup,1n)],borrower],
  ['jup_flash_90pct_pair', [b(amount*90n/100n),r(amount*90n/100n)],borrower],
  ['jup_flash_90pct_outsider_claim_repay', [b(amount*90n/100n),claim(jupEscrow,borrower,userJup,1n),r(amount*90n/100n)],borrower],
  ['jup_flash_near_liquidity_pair', [b(amount-1n),r(amount-1n)],borrower],
  ['jup_flash_near_liquidity_outsider_claim_repay', [b(amount-1n),claim(jupEscrow,borrower,userJup,1n),r(amount-1n)],borrower],
  ['jup_flash_full_liquidity_pair', [b(amount),r(amount)],borrower],
  ['jup_flash_two_claim_legs', [b(1n),claim(jupEscrow,borrower,userJup,1n),claim(jupEscrow,borrower,userJup,1n),r(1n)],borrower],
  ['jup_flash_cmns_authorized_claim_repay', [b(1n),claim(cmnsEscrow,cmnsRecipient,cmnsDest,1n),r(1n)],borrower],
 ];
 const output=[];
 for(const [name,ixs,payer] of specs){
  try{const watch=name==='cmns_recipient_token_alias_vault'?trace.filter((_,i)=>i!==3):trace;
   const result=await simulate(name,ixs,payer,watch,blockhash,pre);output.push(result);
   console.log(JSON.stringify({name,err:result.err,rpcError:result.rpcError,v1Bytes:result.v1Bytes,
    accountCount:result.accountCount,deltas:result.deltas,logs:result.logs?.slice(-6)}));}
  catch(e){output.push({name,localError:e.stack||e.message});console.log(JSON.stringify({name,localError:e.message}));}
 }
 const report={generatedAt:new Date().toISOString(),readOnly:true,noTransactionsSubmitted:true,
  sigVerify:false,virtualSignerWarning:'Successful controls assume the listed account can sign. This simulation does not prove live signature possession.',
  programId:LOC.toBase58(),klendId:KLEND.toBase58(),sourceFlashSignature:flashSample.signature,
  sourceClaimSignature:claimSample.signature,flashReserve:flashReserve.toBase58(),
  flashBorrower:borrower.toBase58(),flashSupply:flashSupply.toBase58(),flashFee:flashFee.toBase58(),
  flashSupplyRaw:amount.toString(),reserveFeeRateSf:require('./locp-klend-reserve-candidates.json').rows.find(x=>x.symbol==='JUP').reserves.find(x=>x.reserve===flashReserve.toBase58()).flashLoanFeeSf,
  preSlot:preResult.context.slot,pre,traceAddresses:trace.map(x=>x.toBase58()),results:output};
 fs.writeFileSync(path.join(DIR,'locp-klend-v1-simulations.json'),JSON.stringify(report,null,2)+'\n');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
