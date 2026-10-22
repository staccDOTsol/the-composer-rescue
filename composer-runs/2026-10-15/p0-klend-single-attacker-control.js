#!/usr/bin/env node
// Fork-only, locally signed Solana v1 Project0 + KLend flash conservation control.
// It creates a fresh attacker-owned marginfi account and two attacker ATAs in
// the SAME atomic v1 transaction. No mainnet transaction is submitted.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(modules+'@solana/web3.js');
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(modules+'@solana/spl-token');
const bs58 = require(modules+'bs58');
const anchor = require(modules+'@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');
const P = x => new PublicKey(x);
const outPath = __dirname+'/p0-klend-single-attacker-control.json';
const fork = 'http://127.0.0.1:8997';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env','utf8')
  .split('\n').filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
const upstream = env.HEAVY_RPC_URL || env.RPC_URL;
const KLEND=P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0=P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const USDC=P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL=P('So11111111111111111111111111111111111111112');
const sourceSig='2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const klendHistory=JSON.parse(fs.readFileSync(__dirname+'/kamino-flash-history.json'));
const klendCensus=JSON.parse(fs.readFileSync(__dirname+'/klend-zero-fee-census.json'));
const reserve=klendCensus.activeZero.find(x=>x.reserve==='4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const coder=new anchor.BorshAccountsCoder(JSON.parse(fs.readFileSync(
  __dirname+'/marginfi-source/fuzz/crucible/idls/marginfi_program.json')));
let id=0;
async function rpc(url,method,params) {
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const obj=await res.json();if(obj.error)throw Error(method+': '+JSON.stringify(obj.error));
  return obj.result;
}
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
function historyIx(tx,i) {
  const msg=tx.transaction.message;
  const keys=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),
    ...(tx.meta.loadedAddresses?.readonly||[])];
  const h=msg.header,staticCount=msg.accountKeys.length;
  const writable=j=>j<staticCount?
    (j<h.numRequiredSignatures?j<h.numRequiredSignatures-h.numReadonlySignedAccounts:
      j<staticCount-h.numReadonlyUnsignedAccounts):
    j<staticCount+(tx.meta.loadedAddresses?.writable||[]).length;
  const ix=msg.instructions[i];
  return new TransactionInstruction({programId:P(keys[ix.programIdIndex]),
    keys:ix.accounts.map(j=>({pubkey:P(keys[j]),isSigner:j<h.numRequiredSignatures,
      isWritable:writable(j)})), data:Buffer.from(bs58.decode(ix.data))});
}
function clone(ix){return new TransactionInstruction({programId:ix.programId,
  keys:ix.keys.map(k=>({...k})),data:Buffer.from(ix.data)})}
function amount(row){return row?.data?Buffer.from(row.data[0],'base64').readBigUInt64LE(64).toString():null}
function image(row){return row?.data?{owner:row.owner,lamports:row.lamports,
  dataSha256:crypto.createHash('sha256').update(Buffer.from(row.data[0],'base64')).digest('hex'),
  rawAmount: row.owner===TOKEN_PROGRAM_ID.toBase58()?amount(row):null}:null}
function fixedRaw(wrapped){
  const bytes=Buffer.from(wrapped.value);let value=BigInt('0x'+Buffer.from(bytes).reverse().toString('hex'));
  if(bytes[15]&0x80)value-=1n<<128n;return value.toString();
}
function bankImage(row){
  if(!row?.data)return null;
  const bank=coder.decode('Bank',Buffer.from(row.data[0],'base64'));
  return {mint:bank.mint.toBase58(),assetShares:fixedRaw(bank.total_asset_shares),
    liabilityShares:fixedRaw(bank.total_liability_shares),
    assetShareValue:fixedRaw(bank.asset_share_value),
    liabilityShareValue:fixedRaw(bank.liability_share_value),
    groupFees:fixedRaw(bank.collected_group_fees_outstanding),
    programFees:fixedRaw(bank.collected_program_fees_outstanding)};
}
function reserveImage(row){
  if(!row?.data)return null;
  const bytes=Buffer.from(row.data[0],'base64');
  return {availableRaw:bytes.readBigUInt64LE(224).toString(),
    flashFeeSf:bytes.readBigUInt64LE(4904).toString()};
}
async function main(){
  const authority=Keypair.generate(),account=Keypair.generate();
  const ataSol=getAssociatedTokenAddressSync(WSOL,authority.publicKey);
  const ataUsdc=getAssociatedTokenAddressSync(USDC,authority.publicKey);
  // Only the locally generated attacker authority receives synthetic SOL.
  await rpc(fork,'surfnet_setAccount',[authority.publicKey.toBase58(),{
    data:'',executable:false,lamports:10000000000,
    owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  const source=await rpc(upstream,'getTransaction',[sourceSig,
    {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
  if(!source)throw Error('Project0 source transaction unavailable');
  const p0start=clone(historyIx(source,1)),p0borrow=clone(historyIx(source,2)),
    p0repay=clone(historyIx(source,5)),p0end=clone(historyIx(source,6));
  if(![p0start,p0borrow,p0repay,p0end].every(x=>x.programId.equals(P0)))
    throw Error('Project0 historical instruction mismatch');
  const group=p0borrow.keys[0].pubkey,bank=p0borrow.keys[3].pubkey,
    p0vault=p0borrow.keys[6].pubkey;
  const init=new TransactionInstruction({programId:P0,
    keys:[
      {pubkey:group,isSigner:false,isWritable:false},
      {pubkey:account.publicKey,isSigner:true,isWritable:true},
      {pubkey:authority.publicKey,isSigner:true,isWritable:false},
      {pubkey:authority.publicKey,isSigner:true,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
    ],data:Buffer.from([43,78,61,255,148,52,249,154])});
  // Remap every historical marginfi account, authority, and token signer role.
  p0start.keys[0].pubkey=account.publicKey;p0start.keys[1].pubkey=authority.publicKey;
  p0borrow.keys[1].pubkey=account.publicKey;p0borrow.keys[2].pubkey=authority.publicKey;
  p0borrow.keys[4].pubkey=ataUsdc;
  p0repay.keys[1].pubkey=account.publicKey;p0repay.keys[2].pubkey=authority.publicKey;
  p0repay.keys[4].pubkey=ataUsdc;
  p0end.keys[0].pubkey=account.publicKey;p0end.keys[2].pubkey=authority.publicKey;
  const loanUsdc=1000000000n,loanSol=1000000000n;
  p0borrow.data.writeBigUInt64LE(loanUsdc,8);
  p0repay.data.writeBigUInt64LE(loanUsdc,8);
  const klendSource=klendHistory.hits[0].transaction;
  const solBorrow=clone(historyIx(klendSource,3)),solRepay=clone(historyIx(klendSource,13));
  if(!solBorrow.programId.equals(KLEND)||!solRepay.programId.equals(KLEND))
    throw Error('KLend historical instruction mismatch');
  const market=P(reserve.market),lma=PublicKey.findProgramAddressSync([
    Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  for(const ix of [solBorrow,solRepay]){
    for(const [j,pubkey] of Object.entries({0:authority.publicKey,1:lma,2:market,
      3:P(reserve.reserve),4:WSOL,5:P(reserve.supplyVault),6:ataSol,
      7:P(reserve.feeVault),11:TOKEN_PROGRAM_ID}))ix.keys[+j].pubkey=pubkey;
    ix.data.writeBigUInt64LE(loanSol,8);
  }
  const ixs=[init,
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,ataSol,
      authority.publicKey,WSOL),
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,ataUsdc,
      authority.publicKey,USDC),
    p0start,solBorrow,p0borrow,p0repay,solRepay,p0end];
  p0start.data.writeBigUInt64LE(BigInt(ixs.length-1),8);
  solRepay.data[16]=ixs.indexOf(solBorrow);
  const watched=[authority.publicKey,account.publicKey,ataSol,ataUsdc,
    p0vault,P(reserve.supplyVault),P(reserve.feeVault),bank,P(reserve.reserve)];
  const labels=['attacker','freshMarginfiAccount','attackerWSOL','attackerUSDC',
    'project0LiquidityVault','klendSupplyVault','klendFeeVault','project0Bank','klendReserve'];
  // Import current public lender accounts before the baseline.
  for(const address of watched)await rpc(fork,'getAccountInfo',[
    address.toBase58(),{encoding:'base64',commitment:'processed'}]);
  const before=await rpc(fork,'getMultipleAccounts',[
    watched.map(String),{encoding:'base64',commitment:'processed'}]);
  const blockhash=(await rpc(fork,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeV1(ixs,authority.publicKey,blockhash);
  const compiled=new TransactionMessage({payerKey:authority.publicKey,
    recentBlockhash:blockhash,instructions:ixs}).compileToV0Message();
  const signers=new Map([[authority.publicKey.toBase58(),authority],
    [account.publicKey.toBase58(),account]]);
  const signatureCount=encoded.requiredSignatures;
  const signed=Buffer.from(encoded.wire),msg=signed.subarray(0,signed.length-64*signatureCount);
  const signerOrder=compiled.staticAccountKeys.slice(0,signatureCount).map(String);
  for(let i=0;i<signatureCount;i++){
    const kp=signers.get(signerOrder[i]);if(!kp)throw Error('Uncontrolled signer '+signerOrder[i]);
    const priv=crypto.createPrivateKey({key:Buffer.concat([
      Buffer.from('302e020100300506032b657004220420','hex'),
      Buffer.from(kp.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
    crypto.sign(null,msg,priv).copy(signed,signed.length-64*signatureCount+i*64);
  }
  const simulation=await rpc(fork,'simulateTransaction',[signed.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,
    commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watched.map(String)}}]);
  const after=simulation.value.accounts||[];
  let decoded=null;
  if(after[1]?.data){try {const a=coder.decode('MarginfiAccount',
    Buffer.from(after[1].data[0],'base64'));
    decoded={authority:a.authority.toBase58(),group:a.group.toBase58(),
      activeBalances:a.lending_account.balances.filter(x=>x.active).map(x=>({
        bank:x.bank_pk.toBase58(),assetShares:x.asset_shares.value,
        liabilityShares:x.liability_shares.value}))};}catch(e){decoded={decodeError:String(e)}}}
  const report={observedAt:new Date().toISOString(),scope:'local fork only; no mainnet submission',
    forkBaselineSlot:before.context.slot,simulationSlot:simulation.context.slot,
    sourceProject0Signature:sourceSig,sourceProject0Slot:source.slot,
    attackerAuthority:authority.publicKey.toBase58(),freshMarginfiAccount:account.publicKey.toBase58(),
    signerOrder,signaturesVerified:true,
    project0Group:group.toBase58(),project0Bank:bank.toBase58(),
    borrowed:{wsolRaw:loanSol.toString(),usdcRaw:loanUsdc.toString()},
    wire:{version:1,bytes:encoded.sizeBytes,addresses:encoded.addressCount,
      instructions:encoded.instructionCount,requiredSignatures:signatureCount,
      sha256:crypto.createHash('sha256').update(signed).digest('hex'),
      signedBase64:signed.toString('base64')},
    err:simulation.value.err,computeUnits:simulation.value.unitsConsumed,
    labels,addresses:watched.map(String),before:before.value.map(image),
    after:after.map(image),marginfiAfter:decoded,
    project0BankBefore:bankImage(before.value[7]),project0BankAfter:bankImage(after[7]),
    klendReserveBefore:reserveImage(before.value[8]),
    klendReserveAfter:reserveImage(after[8]),
    logs:simulation.value.logs,innerInstructions:simulation.value.innerInstructions};
  report.deltas=Object.fromEntries(labels.map((label,i)=>[label,{rawAmount:
    before.value[i]?.owner===TOKEN_PROGRAM_ID.toBase58()||after[i]?.owner===TOKEN_PROGRAM_ID.toBase58()?
      (BigInt(amount(after[i])||0)-BigInt(amount(before.value[i])||0)).toString():null,
    lamports:before.value[i]&&after[i]?after[i].lamports-before.value[i].lamports:null}]));
  fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({outPath,err:report.err,bytes:report.wire.bytes,
    addresses:report.wire.addresses,instructions:report.wire.instructions,
    signers:report.signerOrder,computeUnits:report.computeUnits,
    p0VaultDelta:report.deltas.project0LiquidityVault.rawAmount,
    klendVaultDelta:report.deltas.klendSupplyVault.rawAmount,
    marginfiAfter:report.marginfiAfter}));
}
main().catch(e=>{console.error(String(e.stack||e));process.exitCode=1});
