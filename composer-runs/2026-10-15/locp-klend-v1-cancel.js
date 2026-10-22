#!/usr/bin/env node
// Read-only same-mint zero-fee KLend/JUP flash -> Jupiter Lock cancel -> repay.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {Connection,PublicKey,TransactionInstruction}=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const anchor=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const spl=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1}=require('./klend-v1-composition.js');
const DIR=__dirname,P=s=>new PublicKey(s),LOC=P('LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn');
const KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN=P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const env=Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env','utf8').split('\n')
 .filter(s=>s.includes('=')).map(s=>s.split(/=(.*)/s).slice(0,2)));
const endpoint=env.RPC_URL,conn=new Connection(endpoint,'confirmed');
const hit=require('./locp-jup-flash-sample.json').hit;
const tx=hit.transaction,m=tx.transaction.message,staticKeys=m.accountKeys;
const loadedWritable=tx.meta.loadedAddresses?.writable||[];
const all=[...staticKeys,...loadedWritable,...(tx.meta.loadedAddresses?.readonly||[])];
const h=m.header,writable=i=>i<staticKeys.length?(i<h.numRequiredSignatures?
 i<h.numRequiredSignatures-h.numReadonlySignedAccounts:i<staticKeys.length-h.numReadonlyUnsignedAccounts):
 i<staticKeys.length+loadedWritable.length;
function fromSample(index){const ix=m.instructions[index];return new TransactionInstruction({
 programId:P(all[ix.programIdIndex]),data:Buffer.from(bs58.decode(ix.data)),
 keys:ix.accounts.map(i=>({pubkey:P(all[i]),isSigner:i<h.numRequiredSignatures,isWritable:writable(i)}))});}
const b0=fromSample(hit.borrow.index),r0=fromSample(hit.repay.index);
if(!b0.programId.equals(KLEND)||!r0.programId.equals(KLEND))throw Error('Sample changed');
const borrower=b0.keys[0].pubkey,userJup=b0.keys[6].pubkey,supply=b0.keys[5].pubkey,fee=b0.keys[7].pubkey;
const reserve=b0.keys[3].pubkey;
const reserveCoder=new anchor.BorshAccountsCoder(require('./marginfi-source/idls-complete/kamino_lending.json'));
function flash(base,amt,idx){const d=Buffer.from(base.data);d.writeBigUInt64LE(amt,8);if(idx!==undefined)d[16]=idx;
 return new TransactionInstruction({programId:KLEND,data:d,keys:base.keys.map(k=>({...k}))});}
const state=require('./locp-source-current-state.json').rows.find(r=>r.state.address==='6wsjaQTidXNqmPDw4st2yMtFmTk7yyBEox5SydFQeJe7');
const creator=P(state.state.creator),mint=P(state.state.mint),vault=P(state.vault.address),escrow=P(state.state.address);
const creatorAta=spl.getAssociatedTokenAddressSync(mint,creator);
const idl=require('./meteora-dbc-source/idls/locker.json');
const spec=idl.instructions.find(x=>x.name==='cancel_vesting_escrow');
function cancel(signer){const addresses=[escrow,mint,vault,creatorAta,creatorAta,creator,signer,
 P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),TOKEN,
 P('AqUDk3wybxjZujrNbKmjr2YTUZ8RA1a1nyGgs1zSmvTG'),LOC];
 const data=Buffer.concat([Buffer.from(spec.discriminator),Buffer.from([0])]);
 return new TransactionInstruction({programId:LOC,data,keys:addresses.map((pubkey,i)=>({pubkey,
  isSigner:!!spec.accounts[i].signer,isWritable:!!spec.accounts[i].writable}))});}
const watch=[supply,fee,userJup,reserve,escrow,vault,creatorAta];
function view(account){if(!account)return null;
 const d=Buffer.isBuffer(account.data)?account.data:Buffer.from(account.data[0],'base64');
 const owner=typeof account.owner==='string'?account.owner:account.owner?.toBase58();
 if(owner===TOKEN.toBase58()&&d.length>=72)return{amount:d.readBigUInt64LE(64).toString()};
 if(owner===KLEND.toBase58()&&d.length===8624){const x=reserveCoder.decode('Reserve',d);
  return{availableRaw:x.liquidity.total_available_amount.toString(),
   borrowedAmountSf:x.liquidity.borrowed_amount_sf.toString(),
   collateralMintSupply:x.collateral.mint_total_supply.toString(),
   flashLoanFeeSf:x.config.fees.flash_loan_fee_sf.toString()};}
 return{owner,dataLength:d.length,hash:crypto.createHash('sha256').update(d).digest('hex')};}
let id=0;
async function simulate(name,ixs,payer,bh,pre){const e=encodeV1(ixs,payer,bh);
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'simulateTransaction',params:[e.wire.toString('base64'),
   {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watch.map(String)}}]})});
 const j=await response.json(),v=j.result?.value;
 const post=Object.fromEntries(watch.map((k,i)=>[k.toBase58(),view(v?.accounts?.[i])]));
 const delta=Object.fromEntries(watch.map(k=>{const s=k.toBase58(),a=pre[s]?.amount,b=post[s]?.amount;
  return[s,a!=null&&b!=null?(BigInt(b)-BigInt(a)).toString():null]}));
 const reserveDeltas=pre[reserve.toBase58()]&&post[reserve.toBase58()]?Object.fromEntries(
  ['availableRaw','borrowedAmountSf','collateralMintSupply'].map(k=>[k,
   (BigInt(post[reserve.toBase58()][k])-BigInt(pre[reserve.toBase58()][k])).toString()])):null;
 return{name,v1Bytes:e.sizeBytes,v0Bytes:e.v0Bytes,accountCount:e.addressCount,instructionCount:e.instructionCount,
  slot:j.result?.context?.slot,err:v?.err??null,rpcError:j.error??null,unitsConsumed:v?.unitsConsumed,
  post,delta,reserveDeltas,logs:v?.logs?.filter(z=>z.includes('Program log:')||z.includes('failed:'))??null,
  innerInstructions:v?.innerInstructions??null};}
async function main(){const info=await conn.getMultipleAccountsInfoAndContext(watch,'confirmed');
 const pre=Object.fromEntries(watch.map((k,i)=>[k.toBase58(),view(info.value[i])]));
 const amount=BigInt(pre[supply.toBase58()].amount),bh=(await conn.getLatestBlockhash('confirmed')).blockhash;
 const cases=[
  ['outsider_cancel_alone',[cancel(borrower)],borrower],
  ['flash_dust_outsider_cancel_repay',[flash(b0,1n),cancel(borrower),flash(r0,1n,0)],borrower],
  ['flash_90pct_outsider_cancel_repay',[flash(b0,amount*90n/100n),cancel(borrower),flash(r0,amount*90n/100n,0)],borrower],
  ['flash_full_outsider_cancel_repay',[flash(b0,amount),cancel(borrower),flash(r0,amount,0)],borrower],
  ['authorized_creator_cancel_control',[cancel(creator)],creator],
  ['flash_dust_authorized_creator_cancel_repay',[flash(b0,1n),cancel(creator),flash(r0,1n,0)],borrower],
 ];
 const results=[];for(const [name,ixs,payer] of cases){try{const x=await simulate(name,ixs,payer,bh,pre);results.push(x);
  console.log(JSON.stringify({name,err:x.err,rpcError:x.rpcError,v1Bytes:x.v1Bytes,delta:x.delta,logs:x.logs?.slice(-5)}));}
  catch(e){results.push({name,localError:e.stack||e.message});console.log(JSON.stringify({name,localError:e.message}));}}
 const output={generatedAt:new Date().toISOString(),noTransactionsSubmitted:true,sigVerify:false,
  virtualSignerWarning:'Authorized creator simulations use sigVerify:false and do not prove live key control.',
  sourceFlashSignature:hit.signature,programId:LOC.toBase58(),klend:KLEND.toBase58(),
  reserve:hit.reserve.reserve,flashFeeRateSf:hit.reserve.flashLoanFeeSf,flashSourceAmountRaw:amount.toString(),
  escrow:escrow.toBase58(),vault:vault.toBase58(),creator:creator.toBase58(),outsider:borrower.toBase58(),
  creatorAta:creatorAta.toBase58(),preSlot:info.context.slot,pre,results};
 fs.writeFileSync(path.join(DIR,'locp-klend-v1-cancel.json'),JSON.stringify(output,null,2)+'\n');}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
