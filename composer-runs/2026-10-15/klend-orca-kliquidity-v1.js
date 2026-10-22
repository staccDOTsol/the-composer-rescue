#!/usr/bin/env node
// Read-only v1 simulation: exact-zero-fee KLend WSOL flash -> thin Orca WIF
// Whirlpool swap -> Kamino Liquidity fee collection -> reverse -> flash repay.
// Surfpool is a local mainnet fork. The only state mutation is an explicitly
// disclosed borrower-owned wrapped-SOL bankroll in that fork.
const fs = require('fs');
const crypto = require('crypto');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {PublicKey, TransactionInstruction} = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync, createTransferInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {encodeV1} = require('./klend-v1-composition.js');

const P = x => new PublicKey(x);
const RPC = 'http://127.0.0.1:8991';
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const ORCA = P('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const USER = P('ES2ncXxvrpW8eTa74cjCask9uX6Vg59pbo9KPQpDBDbT');
const USER_WSOL = P('ByQm7b58mxeASN8CXov6EiVJzAcmeLARp95oaSfPxJav');
const USOL_MINT = P('So11111111111111111111111111111111111111112');
const STRATEGY = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-orca-kliquidity-fixtures.json'))
  .rows.find(r => r.strategy === (process.env.KLIQ_STRATEGY || 'H8h7ZyS5qJR2cwLxvZQdPaNzLik17cRxB5pDvjdXeuBg'));
if(!STRATEGY)throw Error('strategy fixture missing');
const POOL = P(STRATEGY.strategyPool);
const WIF_MINT = P(STRATEGY.pool.mintB);
const USER_WIF = getAssociatedTokenAddressSync(WIF_MINT, USER, false, TOKEN_PROGRAM_ID);
const SHARES_MINT=P(STRATEGY.sharesMint);
const USER_SHARES=getAssociatedTokenAddressSync(SHARES_MINT,USER,false,TOKEN_PROGRAM_ID);
const census = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-zero-fee-census.json'));
const RESERVE = census.activeZero.find(r => r.reserve === '4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const USDC_RESERVE = census.activeZero.find(r => r.reserve === 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
const flashHistory = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/kamino-flash-history.json'));
const source = flashHistory.hits[0].transaction;
const msg = source.transaction.message;
const staticKeys = msg.accountKeys;
const loaded = source.meta.loadedAddresses;
const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
const h = msg.header;
const isWritable = i => i < staticKeys.length ?
  (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    i < staticKeys.length - h.numReadonlyUnsignedAccounts) :
  i < staticKeys.length + loaded.writable.length;
const historicalIx = index => {
  const x = msg.instructions[index];
  return new TransactionInstruction({programId:P(allKeys[x.programIdIndex]),
    keys:x.accounts.map(i => ({pubkey:P(allKeys[i]),isSigner:i<h.numRequiredSignatures,isWritable:isWritable(i)})),
    data:Buffer.from(bs58.decode(x.data))});
};
const borrowTemplate = historicalIx(3), repayTemplate = historicalIx(13);
const market = P(RESERVE.market);
const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
const tickSpan = 88 * STRATEGY.pool.tickSpacing;
const startFor = tick => Math.floor(tick/tickSpan)*tickSpan;
const tickArray = start => PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(start))], ORCA)[0];
const oracle = PublicKey.findProgramAddressSync([Buffer.from('oracle'), POOL.toBuffer()], ORCA)[0];
const minSqrt = 4295048016n;
const maxSqrt = 79226673515401279992447579055n;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const marginfiCoder = process.env.KLIQ_PROJECT0_COMPOSE==='1' ?
  new anchor.BorshAccountsCoder(JSON.parse(fs.readFileSync(
    'composer-runs/2026-10-15/marginfi-source/fuzz/crucible/idls/marginfi_program.json'))) : null;
const fixedRaw=w=>{const b=Buffer.from(w.value);let v=BigInt('0x'+Buffer.from(b).reverse().toString('hex'));
  if(b[15]&0x80)v-=1n<<128n;return v.toString();};
const key = (pubkey,isSigner=false,isWritable=false) => ({pubkey,isSigner,isWritable});
const u64 = value => {let b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));return b};
const u128 = value => {let b=Buffer.alloc(16);let v=BigInt(value);b.writeBigUInt64LE(v&((1n<<64n)-1n));b.writeBigUInt64LE(v>>64n,8);return b};
const disc = name => crypto.createHash('sha256').update('global:'+name).digest().subarray(0,8);

let rpcId=0;
async function rpc(method, params) {
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const j=await response.json();if(j.error)throw Error(`${method}: ${JSON.stringify(j.error)}`);return j.result;
}
function flashFor(template,n,repayIndex,reserve,mint,destination) {
  const keys=template.keys.map(k=>({...k}));
  const reserveMarket=P(reserve.market);
  const reserveLma=PublicKey.findProgramAddressSync([Buffer.from('lma'),reserveMarket.toBuffer()],KLEND)[0];
  const replacements={0:USER,1:reserveLma,2:reserveMarket,3:P(reserve.reserve),4:mint,
    5:P(reserve.supplyVault),6:destination,7:P(reserve.feeVault),11:TOKEN_PROGRAM_ID};
  for(const [i,a] of Object.entries(replacements))keys[Number(i)].pubkey=a;
  const data=Buffer.from(template.data);data.writeBigUInt64LE(BigInt(n),8);
  if(repayIndex!==undefined)data[16]=repayIndex;
  return new TransactionInstruction({programId:KLEND,keys,data});
}
const flash=(template,n,repayIndex)=>flashFor(template,n,repayIndex,RESERVE,USOL_MINT,USER_WSOL);
function swap(amount,aToB,currentStart) {
  const starts=aToB?[currentStart,currentStart-tickSpan,currentStart-2*tickSpan]:
    [currentStart,currentStart+tickSpan,currentStart+2*tickSpan];
  const data=Buffer.concat([disc('swap'),u64(amount),u64(0n),u128(aToB?minSqrt:maxSqrt),
    Buffer.from([1,aToB?1:0])]);
  return new TransactionInstruction({programId:ORCA,data,keys:[
    key(TOKEN_PROGRAM_ID),key(USER,true),key(POOL,false,true),
    key(USER_WSOL,false,true),key(P(STRATEGY.pool.vaultA),false,true),
    key(USER_WIF,false,true),key(P(STRATEGY.pool.vaultB),false,true),
    ...starts.map(s=>key(tickArray(s),false,true)),key(oracle),
  ]});
}
const collect = new TransactionInstruction({programId:P(STRATEGY.collect.programId),
  data:Buffer.from(STRATEGY.collect.dataBase64,'base64'),
  keys:STRATEGY.collect.accounts.map(a=>key(P(a.address),a.isSigner,a.isWritable))});
function templatedIx(template,amountA,amountB) {
  const data=Buffer.from(template.dataBase64,'base64');
  if(amountA!==undefined)data.writeBigUInt64LE(BigInt(amountA),8);
  if(amountB!==undefined)data.writeBigUInt64LE(BigInt(amountB),16);
  return new TransactionInstruction({programId:P(template.programId),data,
    keys:template.accounts.map(a=>key(P(a.address),a.isSigner,a.isWritable))});
}
const deposit=(amountA,amountB)=>templatedIx(STRATEGY.deposit,amountA,amountB);
const withdraw=shares=>templatedIx(STRATEGY.withdraw,shares);
const createWif = createAssociatedTokenAccountIdempotentInstruction(USER,USER_WIF,USER,WIF_MINT,TOKEN_PROGRAM_ID);
const createShares=createAssociatedTokenAccountIdempotentInstruction(USER,USER_SHARES,USER,SHARES_MINT,TOKEN_PROGRAM_ID);
const watched = [USER,USER_WSOL,USER_WIF,P(RESERVE.supplyVault),P(RESERVE.feeVault),P(RESERVE.reserve),
  POOL,P(STRATEGY.pool.vaultA),P(STRATEGY.pool.vaultB),P(STRATEGY.strategy),
  P(STRATEGY.strategyPosition),P(STRATEGY.collect.accounts[10].address),
  P(STRATEGY.collect.accounts[12].address),P(STRATEGY.collect.accounts[14].address),
  P(STRATEGY.collect.accounts[15].address),P(STRATEGY.sharesMint),USER_SHARES];
const names=['userLamports','userWSOL','userWIF','flashSupply','flashFee','flashReserve',
  'orcaPool','orcaVaultWSOL','orcaVaultWIF','kaminoStrategy','kaminoPosition',
  'kaminoVaultWSOL','kaminoVaultWIF','kaminoTreasuryWSOL','kaminoTreasuryWIF','sharesMint','userShares'];
if(process.env.KLIQ_DUAL_FLASH==='1'||process.env.KLIQ_LARGE_SHARE==='1') {
  watched.push(P(USDC_RESERVE.supplyVault),P(USDC_RESERVE.feeVault),P(USDC_RESERVE.reserve));
  names.push('usdcFlashSupply','usdcFlashFee','usdcFlashReserve');
}
if(process.env.KLIQ_PROJECT0_COMPOSE==='1') {
  watched.push(P('JQhYzVs8YRNy7ZrXo7tdhmCmNqDRPMmZ2436jGwLSxp'),
    P('7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat'),
    P('5oxfHB4yt3t8JaLyCgrptt6ahn79TTcNWfLWEtFMcmQF'),
    P('2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB'));
  names.push('p0BorrowerUSDC','p0LenderVault','p0MarginfiAccount','p0Bank');
}
const tokenRoles=new Set([1,2,3,4,7,8,11,12,13,14,16,17,18]);
function decode(row,i) {
  if(!row)return null;
  const d=Buffer.from(row.data[0],'base64');
  const base={owner:row.owner,lamports:String(row.lamports),size:d.length,sha256:hash(d)};
  if(tokenRoles.has(i)&&d.length>=72)base.rawAmount=d.readBigUInt64LE(64).toString();
  if((i===5||i===19)&&d.length>4912){base.availableRaw=d.readBigUInt64LE(224).toString();base.flashFeeSf=d.readBigUInt64LE(4904).toString()}
  if(i===6&&d.length===653){base.tick=d.readInt32LE(81);base.sqrtPrice=(d.readBigUInt64LE(65)+(d.readBigUInt64LE(73)<<64n)).toString();base.liquidity=(d.readBigUInt64LE(49)+(d.readBigUInt64LE(57)<<64n)).toString()}
  if(i===10&&d.length>=144){base.feeOwedA=d.readBigUInt64LE(112).toString();base.feeOwedB=d.readBigUInt64LE(136).toString()}
  if(i===15&&d.length>=44)base.supplyRaw=d.readBigUInt64LE(36).toString();
  if(marginfiCoder&&i===19){const a=marginfiCoder.decode('MarginfiAccount',d);
    base.selectedBankBalance=a.lending_account.balances.filter(x=>x.active)
      .filter(x=>String(x.bank_pk)==='2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB')
      .map(x=>({assetSharesI80F48Raw:fixedRaw(x.asset_shares),
        liabilitySharesI80F48Raw:fixedRaw(x.liability_shares),
        premiumOutstandingI80F48Raw:fixedRaw(x.premium_outstanding)}));}
  if(marginfiCoder&&i===20){const b=marginfiCoder.decode('Bank',d);
    base.bankAccounting={totalAssetSharesI80F48Raw:fixedRaw(b.total_asset_shares),
      totalLiabilitySharesI80F48Raw:fixedRaw(b.total_liability_shares),
      assetShareValueI80F48Raw:fixedRaw(b.asset_share_value),
      liabilityShareValueI80F48Raw:fixedRaw(b.liability_share_value),
      groupFeesI80F48Raw:fixedRaw(b.collected_group_fees_outstanding),
      programFeesI80F48Raw:fixedRaw(b.collected_program_fees_outstanding)};}
  return base;
}
async function getRows(){const r=await rpc('getMultipleAccounts',[watched.map(String),{encoding:'base64',commitment:'processed'}]);return{slot:r.context.slot,rows:r.value.map(decode)}}
const initialStart=startFor(STRATEGY.pool.tickCurrent);
async function setSeed(n) {
  const account=(await rpc('getAccountInfo',[String(USER_WSOL),{encoding:'base64',commitment:'processed'}])).value;
  if(!account)throw Error('WSOL fixture missing');
  const d=Buffer.from(account.data[0],'base64');
  if(P(bs58.encode(d.subarray(32,64))).toBase58()!==USER.toBase58())throw Error('WSOL owner mismatch');
  d.writeBigUInt64LE(BigInt(n),64);
  const rent=1488440n;
  await rpc('surfnet_setAccount',[String(USER_WSOL),{data:d.toString('hex'),executable:false,
    lamports:Number(rent+BigInt(n)),owner:account.owner,rentEpoch:0}]);
}
async function setSeedToken(mint,ata,n) {
  const account=(await rpc('getAccountInfo',[String(ata),{encoding:'base64',commitment:'processed'}])).value;
  const d=account?Buffer.from(account.data[0],'base64'):Buffer.alloc(165);
  if(account&&account.owner!==String(TOKEN_PROGRAM_ID))throw Error('token account owner mismatch');
  if(account&&(!d.subarray(0,32).equals(mint.toBuffer())||
      !d.subarray(32,64).equals(USER.toBuffer())))throw Error('token account mint/owner mismatch');
  if(!account){mint.toBuffer().copy(d,0);USER.toBuffer().copy(d,32);d[108]=1;}
  d.writeBigUInt64LE(BigInt(n),64);
  await rpc('surfnet_setAccount',[String(ata),{data:d.toString('hex'),executable:false,
    lamports:account?.lamports||2039280,owner:String(TOKEN_PROGRAM_ID),rentEpoch:0}]);
}
async function simulate(name,ixs,bh) {
  const e=encodeV1(ixs,USER,bh);
  const r=await rpc('simulateTransaction',[e.wire.toString('base64'),{encoding:'base64',sigVerify:false,
    replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watched.map(String)}}]);
  return{name,slot:r.context.slot,v1Bytes:e.sizeBytes,v0Bytes:e.v0Bytes,
    addresses:e.addressCount,writable:e.writableCount,ixCount:e.instructionCount,
    requiredSignatures:e.requiredSignatures,
    computeConfig:e.config,err:r.value.err,unitsConsumed:r.value.unitsConsumed,
    loadedAccountDataSize:r.value.loadedAccountsDataSize,
    post:r.value.accounts?.map(decode),logs:r.value.logs?.filter(x=>x.includes('Instruction:')||x.includes('failed')||x.includes('Error')||x.includes('tick')||x.includes('success')).slice(-45),
    innerInstructions:r.value.innerInstructions};
}
const delta=(a,b,field)=>b?.[field]!=null&&(a?.[field]!=null||a==null&&field==='rawAmount')?
  (BigInt(b[field])-BigInt(a?.[field]||0)).toString():null;
function summarize(pre,result) {
  result.deltas=Object.fromEntries(names.map((name,i)=>[name,{
    rawAmount:delta(pre.rows[i],result.post?.[i],'rawAmount'),
    lamports:delta(pre.rows[i],result.post?.[i],'lamports'),
    feeOwedA:delta(pre.rows[i],result.post?.[i],'feeOwedA'),
    feeOwedB:delta(pre.rows[i],result.post?.[i],'feeOwedB'),
    supplyRaw:delta(pre.rows[i],result.post?.[i],'supplyRaw'),
    tickBefore:pre.rows[i]?.tick,tickAfter:result.post?.[i]?.tick,
  }]));
  return result;
}
async function main() {
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  // Surfpool lazily imports remote accounts. Prime each watch address before
  // taking a baseline, so the strategy and treasury are not recorded as null.
  for(const address of watched) await rpc('getAccountInfo',[String(address),{encoding:'base64',commitment:'processed'}]);
  const output={observedAt:new Date().toISOString(),readOnly:true,noLiveSubmission:true,
    localFork:'Surfpool mainnet fork; only user-owned WSOL amount and matching native lamports seeded',
    sourceFlashSignature:flashHistory.hits[0].signature,strategy:STRATEGY.strategy,
    pool:String(POOL),reserve:RESERVE,user:String(USER),watch:names.map((name,i)=>({name,address:String(watched[i])})),
    cases:[]};
  const currentReserve=(await rpc('getAccountInfo',[RESERVE.reserve,{encoding:'base64',commitment:'processed'}])).value;
  const available=Buffer.from(currentReserve.data[0],'base64').readBigUInt64LE(224);
  output.availableRawAtStart=available.toString();
  if(process.env.KLIQ_PROJECT0_COMPOSE==='1') {
    if(String(WIF_MINT)!==String(P(USDC_RESERVE.mint)))throw Error('Project0 compose requires USDC B mint');
    const sourceSignature='2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
    const tx=await rpc('getTransaction',[sourceSignature,
      {encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
    if(!tx)throw Error('Project0 source transaction unavailable');
    const historicalKeys=[...tx.transaction.message.accountKeys,...tx.meta.loadedAddresses.writable,
      ...tx.meta.loadedAddresses.readonly];
    const ph=tx.transaction.message.header,staticCount=tx.transaction.message.accountKeys.length;
    const projectWritable=i=>i<staticCount?
      (i<ph.numRequiredSignatures?i<ph.numRequiredSignatures-ph.numReadonlySignedAccounts:
        i<staticCount-ph.numReadonlyUnsignedAccounts):
      i<staticCount+tx.meta.loadedAddresses.writable.length;
    const projectHistoricalIx=i=>{const x=tx.transaction.message.instructions[i];return new TransactionInstruction({
      programId:P(historicalKeys[x.programIdIndex]),
      keys:x.accounts.map(k=>key(P(historicalKeys[k]),k<ph.numRequiredSignatures,projectWritable(k))),
      data:Buffer.from(bs58.decode(x.data))});};
    const p0Start0=projectHistoricalIx(1),p0Borrow0=projectHistoricalIx(2),
      p0Repay0=projectHistoricalIx(5),p0End0=projectHistoricalIx(6);
    if(![p0Start0,p0Borrow0,p0Repay0,p0End0].every(x=>x.programId.equals(PROJECT0)))
      throw Error('Project0 template program mismatch');
    const p0Authority=p0Borrow0.keys[2].pubkey,p0Token=p0Borrow0.keys[4].pubkey;
    const clone=x=>new TransactionInstruction({programId:x.programId,
      keys:x.keys.map(k=>({...k})),data:Buffer.from(x.data)});
    const loanSol=100000000000n,loanUsdc=10000000000n,
      depositMaxA=50000000000n,depositMaxB=10000000000n,
      quoteSeedSol=150000000000n,finalSeedSol=1000000000n,quoteSeedUsdc=10000000000n;
    const p0Borrow=clone(p0Borrow0),p0Repay=clone(p0Repay0);
    p0Borrow.data.writeBigUInt64LE(loanUsdc,8);p0Repay.data.writeBigUInt64LE(loanUsdc,8);
    const toUser=createTransferInstruction(p0Token,USER_WIF,p0Authority,loanUsdc);
    const toP0=createTransferInstruction(USER_WIF,p0Token,USER,loanUsdc);
    const withP0=(middle)=>{const x=[clone(p0Start0),...middle,clone(p0End0)];
      x[0].data.writeBigUInt64LE(BigInt(x.length-1),8);return x;};
    const borrowSol=flash(borrowTemplate,loanSol),repaySol=flash(repayTemplate,loanSol,3);
    const report={observedAt:new Date().toISOString(),readOnly:true,noLiveSubmission:true,
      sourceProject0Signature:sourceSignature,sourceProject0Slot:tx.slot,
      strategy:STRATEGY.strategy,pool:String(POOL),p0Authority:String(p0Authority),
      p0BorrowerUSDC:String(p0Token),loanSolRaw:loanSol.toString(),loanUsdcRaw:loanUsdc.toString(),
      depositMaxARaw:depositMaxA.toString(),depositMaxBRaw:depositMaxB.toString(),
      quoteSeedSolRaw:quoteSeedSol.toString(),finalSeedSolRaw:finalSeedSol.toString(),
      quoteSeedUsdcRaw:quoteSeedUsdc.toString(),cases:[]};
    await setSeed(finalSeedSol);await setSeedToken(WIF_MINT,USER_WIF,0n);
    const controlPre=await getRows();
    report.controlPreSlot=controlPre.slot;report.controlPre=controlPre.rows;
    const control=withP0([createWif,createShares,borrowSol,p0Borrow,p0Repay,repaySol]);
    report.pairControl=summarize(controlPre,await simulate('p0_plus_klend_pair_control',control,blockhash));
    console.log(JSON.stringify({probe:'p0_klend_pair',err:report.pairControl.err,
      bytes:report.pairControl.v1Bytes,accounts:report.pairControl.addresses,
      cu:report.pairControl.unitsConsumed,p0Vault:report.pairControl.deltas.p0LenderVault.rawAmount,
      klendVault:report.pairControl.deltas.flashSupply.rawAmount}));
    if(!report.pairControl.err) {
      await setSeed(quoteSeedSol);await setSeedToken(WIF_MINT,USER_WIF,quoteSeedUsdc);
      const pre=await getRows(),start=startFor(pre.rows[6].tick);
      report.quotePreSlot=pre.slot;report.quotePre=pre.rows;
      const base=[createWif,createShares,borrowSol,p0Borrow,toUser,deposit(depositMaxA,depositMaxB)];
      const quoteIxs=withP0([...base,toP0,p0Repay,repaySol]);
      report.depositQuote=summarize(pre,await simulate('p0_klend_deposit_quote',quoteIxs,blockhash));
      console.log(JSON.stringify({probe:'p0_klend_deposit_quote',err:report.depositQuote.err,
        shares:report.depositQuote.deltas.userShares.rawAmount,
        bytes:report.depositQuote.v1Bytes,accounts:report.depositQuote.addresses,
        cu:report.depositQuote.unitsConsumed}));
      if(!report.depositQuote.err&&BigInt(report.depositQuote.deltas.userShares.rawAmount||'0')>0n) {
        const shares=BigInt(report.depositQuote.deltas.userShares.rawAmount);
        for(const move of [100000000n,1000000000n,10000000000n,50000000000n]) {
          const row={moveRaw:move.toString()};
          try {
            const prefix=[...base,swap(move,true,start),withdraw(shares),toP0,p0Repay];
            row.quote=summarize(pre,await simulate('p0_klend_manip_quote',
              withP0([...prefix,repaySol]),blockhash));
            if(!row.quote.err) {
              const reverseB=BigInt(row.quote.post[2].rawAmount)-quoteSeedUsdc;
              row.reverseInputBRaw=reverseB.toString();
              await setSeed(finalSeedSol);await setSeedToken(WIF_MINT,USER_WIF,0n);
              const finalPre=await getRows();
              row.finalPreSlot=finalPre.slot;row.finalPre=finalPre.rows;
              row.final=summarize(finalPre,await simulate('p0_klend_full',
                withP0([...prefix,swap(reverseB,false,startFor(row.quote.post[6].tick)),repaySol]),
                blockhash));
              await setSeed(quoteSeedSol);await setSeedToken(WIF_MINT,USER_WIF,quoteSeedUsdc);
            }
            report.cases.push(row);
            console.log(JSON.stringify({probe:'p0_klend_full',moveRaw:move.toString(),
              quoteErr:row.quote?.err||null,finalErr:row.final?.err||null,
              netWSOL:row.final?.deltas?.userWSOL?.rawAmount,
              netUSDC:row.final?.deltas?.userWIF?.rawAmount,
              netShares:row.final?.deltas?.userShares?.rawAmount,
              p0Vault:row.final?.deltas?.p0LenderVault?.rawAmount,
              p0Borrower:row.final?.deltas?.p0BorrowerUSDC?.rawAmount,
              klendVault:row.final?.deltas?.flashSupply?.rawAmount,
              bytes:row.final?.v1Bytes,accounts:row.final?.addresses,cu:row.final?.unitsConsumed}));
          }catch(error){row.error=String(error);report.cases.push(row);
            console.log(JSON.stringify({probe:'p0_klend_full',moveRaw:move.toString(),error:String(error)}));}
        }
      }
    }
    fs.writeFileSync('composer-runs/2026-10-15/klend-project0-orca-kliquidity-v1.json',
      JSON.stringify(report,null,2)+'\n');
    return;
  }
  if(process.env.KLIQ_LARGE_SHARE==='1') {
    if(String(WIF_MINT)!==String(P(USDC_RESERVE.mint)))throw Error('large share requires USDC B mint');
    const loan=100000000000n,quoteSeedSol=150000000000n,finalSeedSol=1000000000n;
    const seedUsdc=10000000000n,maxA=50000000000n,maxB=10000000000n;
    await setSeed(quoteSeedSol);await setSeedToken(WIF_MINT,USER_WIF,seedUsdc);
    const pre=await getRows(),start=startFor(pre.rows[6].tick);
    const borrow=flash(borrowTemplate,loan),repay=flash(repayTemplate,loan,2);
    const base=[createWif,createShares,borrow,deposit(maxA,maxB)];
    const report={observedAt:new Date().toISOString(),readOnly:true,noLiveSubmission:true,
      strategy:STRATEGY.strategy,pool:String(POOL),reserve:RESERVE.reserve,
      loanRaw:loan.toString(),quoteSeedSolRaw:quoteSeedSol.toString(),
      finalSeedSolRaw:finalSeedSol.toString(),borrowerSeedUsdcRaw:seedUsdc.toString(),
      depositMaxARaw:maxA.toString(),depositMaxBRaw:maxB.toString(),
      preSlot:pre.slot,pre:pre.rows,cases:[]};
    try {
      report.depositQuote=summarize(pre,await simulate('large_share_deposit_quote',
        [...base,repay],blockhash));
      console.log(JSON.stringify({probe:'large_share_deposit_quote',err:report.depositQuote.err,
        shares:report.depositQuote.deltas.userShares.rawAmount,bytes:report.depositQuote.v1Bytes,
        accounts:report.depositQuote.addresses,cu:report.depositQuote.unitsConsumed}));
      if(!report.depositQuote.err&&BigInt(report.depositQuote.deltas.userShares.rawAmount||'0')>0n) {
        const shares=BigInt(report.depositQuote.deltas.userShares.rawAmount);
        for(const move of [100000000n,1000000000n,10000000000n,50000000000n,100000000000n]) {
          const row={moveRaw:move.toString()};
          try {
            const prefix=[...base,swap(move,true,start),withdraw(shares)];
            row.quote=summarize(pre,await simulate('large_share_manip_quote',
              [...prefix,repay],blockhash));
            if(!row.quote.err) {
              const reverseB=BigInt(row.quote.post[2].rawAmount)-seedUsdc;
              row.reverseInputBRaw=reverseB.toString();
              await setSeed(finalSeedSol);
              const finalPre=await getRows();
              row.finalPreSlot=finalPre.slot;row.finalPre=finalPre.rows;
              row.final=summarize(finalPre,await simulate('large_share_full',
                [...prefix,swap(reverseB,false,startFor(row.quote.post[6].tick)),repay],blockhash));
              await setSeed(quoteSeedSol);
            }
            report.cases.push(row);
            console.log(JSON.stringify({probe:'large_share',moveRaw:move.toString(),
              quoteErr:row.quote?.err||null,finalErr:row.final?.err||null,
              reverseInputBRaw:row.reverseInputBRaw||null,
              netWSOL:row.final?.deltas?.userWSOL?.rawAmount,
              netUSDC:row.final?.deltas?.userWIF?.rawAmount,
              netShares:row.final?.deltas?.userShares?.rawAmount,
              flashDelta:row.final?.deltas?.flashSupply?.rawAmount,
              bytes:row.final?.v1Bytes,accounts:row.final?.addresses,cu:row.final?.unitsConsumed}));
          }catch(error){row.error=String(error);report.cases.push(row);
            console.log(JSON.stringify({probe:'large_share',moveRaw:move.toString(),error:String(error)}));}
        }
      }
    }catch(error){report.error=String(error);console.log(JSON.stringify({probe:'large_share',error:String(error)}));}
    fs.writeFileSync('composer-runs/2026-10-15/klend-orca-kliquidity-large-share-v1.json',
      JSON.stringify(report,null,2)+'\n');
    return;
  }
  if(process.env.KLIQ_DUAL_FLASH==='1') {
    if(String(WIF_MINT)!==String(P(USDC_RESERVE.mint)))throw Error('dual flash requires USDC B mint');
    const solLoan=100000000000n,usdcLoan=10000000000n;
    const solQuoteSeed=150000000000n,usdcQuoteSeed=10000000000n;
    const depositA=50000000000n,depositB=10000000000n;
    await setSeed(solQuoteSeed);await setSeedToken(WIF_MINT,USER_WIF,usdcQuoteSeed);
    const pre=await getRows();
    const borrowSol=flash(borrowTemplate,solLoan);
    const borrowUsdc=flashFor(borrowTemplate,usdcLoan,undefined,USDC_RESERVE,WIF_MINT,USER_WIF);
    const repaySol=flash(repayTemplate,solLoan,2);
    const repayUsdc=flashFor(repayTemplate,usdcLoan,3,USDC_RESERVE,WIF_MINT,USER_WIF);
    const base=[createWif,createShares,borrowSol,borrowUsdc,deposit(depositA,depositB)];
    const report={observedAt:new Date().toISOString(),readOnly:true,noLiveSubmission:true,
      strategy:STRATEGY.strategy,pool:String(POOL),solReserve:RESERVE.reserve,
      usdcReserve:USDC_RESERVE.reserve,solLoanRaw:solLoan.toString(),usdcLoanRaw:usdcLoan.toString(),
      depositMaxARaw:depositA.toString(),depositMaxBRaw:depositB.toString(),
      quoteSeeds:{solRaw:solQuoteSeed.toString(),usdcRaw:usdcQuoteSeed.toString()},
      note:'Quote phase uses local borrower-owned seed; final phase resets USDC seed to zero.',
      preSlot:pre.slot,pre:pre.rows,cases:[]};
    try {
      report.depositQuote=summarize(pre,await simulate('dual_flash_deposit_quote',
        [...base,repayUsdc,repaySol],blockhash));
      console.log(JSON.stringify({probe:'dual_flash_deposit_quote',err:report.depositQuote.err,
        shares:report.depositQuote.deltas.userShares.rawAmount,bytes:report.depositQuote.v1Bytes,
        accounts:report.depositQuote.addresses,cu:report.depositQuote.unitsConsumed}));
      if(!report.depositQuote.err&&BigInt(report.depositQuote.deltas.userShares.rawAmount||'0')>0n) {
        const shares=BigInt(report.depositQuote.deltas.userShares.rawAmount);
        const start=startFor(pre.rows[6].tick);
        for(const move of [1000000000n,10000000000n,50000000000n,100000000000n]) {
          const row={moveRaw:move.toString()};
          try {
            const prefix=[...base,swap(move,true,start),withdraw(shares),repayUsdc];
            row.quote=summarize(pre,await simulate('dual_flash_manip_quote',
              [...prefix,repaySol],blockhash));
            if(!row.quote.err) {
              const remainingB=BigInt(row.quote.post[2].rawAmount)-usdcQuoteSeed;
              row.reverseInputBRaw=remainingB.toString();
              await setSeed(1000000000n);await setSeedToken(WIF_MINT,USER_WIF,0n);
              const finalPre=await getRows();
              row.finalPreSlot=finalPre.slot;row.finalPre=finalPre.rows;
              row.final=summarize(finalPre,await simulate('dual_flash_full',
                [...prefix,swap(remainingB,false,startFor(row.quote.post[6].tick)),repaySol],blockhash));
              await setSeed(solQuoteSeed);await setSeedToken(WIF_MINT,USER_WIF,usdcQuoteSeed);
            }
            report.cases.push(row);
            console.log(JSON.stringify({probe:'dual_flash_manip',moveRaw:move.toString(),
              quoteErr:row.quote?.err||null,finalErr:row.final?.err||null,
              reverseInputBRaw:row.reverseInputBRaw||null,
              netWSOL:row.final?.deltas?.userWSOL?.rawAmount,
              netUSDC:row.final?.deltas?.userWIF?.rawAmount,
              netShares:row.final?.deltas?.userShares?.rawAmount,
              solFlash:row.final?.deltas?.flashSupply?.rawAmount,
              usdcFlash:row.final?.deltas?.usdcFlashSupply?.rawAmount,
              bytes:row.final?.v1Bytes,accounts:row.final?.addresses,cu:row.final?.unitsConsumed}));
          }catch(error){row.error=String(error);report.cases.push(row);
            console.log(JSON.stringify({probe:'dual_flash_manip',moveRaw:move.toString(),error:String(error)}));}
        }
      }
    }catch(error){report.error=String(error);console.log(JSON.stringify({probe:'dual_flash',error:String(error)}));}
    fs.writeFileSync('composer-runs/2026-10-15/klend-orca-kliquidity-dual-flash-v1.json',
      JSON.stringify(report,null,2)+'\n');
    return;
  }
  if(process.env.KLIQ_DEPOSIT_CONTROL==='1') {
    const seed=3000000000n,loan=1000000000n;
    await setSeed(seed);
    const pre=await getRows();
    const sizes=[[1000000n,0n],[10000000n,0n],[100000000n,0n]];
    output.depositOnlyControls=[];
    for(const [maxA,maxB] of sizes) {
      const ixs=[createWif,createShares,flash(borrowTemplate,loan),deposit(maxA,maxB),
        flash(repayTemplate,loan,2)];
      try {
        const r=summarize(pre,await simulate('deposit_only_control',ixs,blockhash));
        output.depositOnlyControls.push({maxARaw:maxA.toString(),maxBRaw:maxB.toString(),result:r});
        console.log(JSON.stringify({strategy:STRATEGY.strategy,maxARaw:maxA.toString(),
          err:r.err,sharesDelta:r.deltas.userShares.rawAmount,userWSOLDelta:r.deltas.userWSOL.rawAmount,
          v1Bytes:r.v1Bytes,cu:r.unitsConsumed}));
      }catch(error){output.depositOnlyControls.push({maxARaw:maxA.toString(),error:String(error)});
        console.log(JSON.stringify({strategy:STRATEGY.strategy,maxARaw:maxA.toString(),error:String(error)}));}
    }
    output.depositSwapControls=[];
    for(const move of [10000000n,100000000n,1000000000n]) {
      const swapIx=swap(move,true,startFor(pre.rows[6].tick));
      const forward=[createWif,createShares,flash(borrowTemplate,loan),swapIx,
        flash(repayTemplate,loan,2)];
      const row={moveRaw:move.toString()};
      try {
        row.forward=summarize(pre,await simulate('swap_quote',forward,blockhash));
        if(!row.forward.err) {
          const out=BigInt(row.forward.deltas.userWIF.rawAmount||'0');
          row.tokenBReceivedRaw=out.toString();
          const maxA=move, maxB=out;
          row.deposit=summarize(pre,await simulate('swap_then_deposit',
            [createWif,createShares,flash(borrowTemplate,loan),swapIx,
              deposit(maxA,maxB),flash(repayTemplate,loan,2)],blockhash));
          if(!row.deposit.err&&BigInt(row.deposit.deltas.userShares.rawAmount||'0')>0n) {
            const minted=BigInt(row.deposit.deltas.userShares.rawAmount);
            const base=[createWif,createShares,flash(borrowTemplate,loan),swapIx,
              deposit(maxA,maxB)];
            row.withdraw=summarize(pre,await simulate('swap_deposit_withdraw',
              [...base,withdraw(minted),flash(repayTemplate,loan,2)],blockhash));
            if(!row.withdraw.err&&BigInt(row.withdraw.deltas.userWIF.rawAmount||'0')>0n) {
              const b=BigInt(row.withdraw.deltas.userWIF.rawAmount);
              row.reverse=summarize(pre,await simulate('swap_deposit_withdraw_reverse',
                [...base,withdraw(minted),swap(b,false,startFor(row.withdraw.post[6].tick)),
                  flash(repayTemplate,loan,2)],blockhash));
            }
          }
        }
        output.depositSwapControls.push(row);
        console.log(JSON.stringify({strategy:STRATEGY.strategy,moveRaw:move.toString(),
          swapErr:row.forward.err,tokenBReceivedRaw:row.tokenBReceivedRaw||null,
          depositErr:row.deposit?.err||null,sharesDelta:row.deposit?.deltas?.userShares?.rawAmount,
          withdrawErr:row.withdraw?.err||null,reverseErr:row.reverse?.err||null,
          reverseWSOLDelta:row.reverse?.deltas?.userWSOL?.rawAmount,
          reverseTokenBDelta:row.reverse?.deltas?.userWIF?.rawAmount,
          userWSOLDelta:row.deposit?.deltas?.userWSOL?.rawAmount,
          v1Bytes:row.deposit?.v1Bytes,cu:row.deposit?.unitsConsumed}));
      }catch(error){row.error=String(error);output.depositSwapControls.push(row);
        console.log(JSON.stringify({strategy:STRATEGY.strategy,moveRaw:move.toString(),error:String(error)}));}
    }
    if(STRATEGY.strategy==='5EfeGn1h7m6Rx9mGEmamDoxMtdhRmUh2N9fYRiDQqteS') {
      const loan2=10000000000n,seed2=20000000000n,first=100000000n;
      await setSeed(seed2);
      const basePre=await getRows(),baseStart=startFor(basePre.rows[6].tick);
      const quote=summarize(basePre,await simulate('base_forward_quote',
        [createWif,createShares,flash(borrowTemplate,loan2),swap(first,true,baseStart),
          flash(repayTemplate,loan2,2)],blockhash));
      output.depositThenManipulate={loanRaw:loan2.toString(),seedRaw:seed2.toString(),
        initialMoveRaw:first.toString(),quote};
      if(!quote.err) {
        const b=BigInt(quote.deltas.userWIF.rawAmount);
        const initial=[createWif,createShares,flash(borrowTemplate,loan2),
          swap(first,true,baseStart),deposit(first,b)];
        const d=summarize(basePre,await simulate('base_deposit',
          [...initial,flash(repayTemplate,loan2,2)],blockhash));
        output.depositThenManipulate.baseDeposit=d;
        if(!d.err&&BigInt(d.deltas.userShares.rawAmount||'0')>0n) {
          const shares=BigInt(d.deltas.userShares.rawAmount),afterDepositStart=startFor(d.post[6].tick);
          output.depositThenManipulate.mintedSharesRaw=shares.toString();
          output.depositThenManipulate.cases=[];
          for(const move2 of [10000000n,100000000n,500000000n,1000000000n,2000000000n,5000000000n,10000000000n]) {
            const row={secondMoveRaw:move2.toString()};
            try {
              const prefix=[...initial,swap(move2,true,afterDepositStart),withdraw(shares)];
              row.withdraw=summarize(basePre,await simulate('manipulate_then_withdraw',
                [...prefix,flash(repayTemplate,loan2,2)],blockhash));
              if(!row.withdraw.err&&BigInt(row.withdraw.deltas.userWIF.rawAmount||'0')>0n) {
                const bb=BigInt(row.withdraw.deltas.userWIF.rawAmount);
                row.reverse=summarize(basePre,await simulate('manipulate_withdraw_reverse',
                  [...prefix,swap(bb,false,startFor(row.withdraw.post[6].tick)),
                    flash(repayTemplate,loan2,2)],blockhash));
              }
              output.depositThenManipulate.cases.push(row);
              console.log(JSON.stringify({probe:'deposit_then_manipulate',secondMoveRaw:move2.toString(),
                withdrawErr:row.withdraw?.err||null,reverseErr:row.reverse?.err||null,
                netWSOL:row.reverse?.deltas?.userWSOL?.rawAmount,
                netTokenB:row.reverse?.deltas?.userWIF?.rawAmount,
                netShares:row.reverse?.deltas?.userShares?.rawAmount,
                v1Bytes:row.reverse?.v1Bytes,cu:row.reverse?.unitsConsumed}));
            }catch(error){row.error=String(error);output.depositThenManipulate.cases.push(row);
              console.log(JSON.stringify({probe:'deposit_then_manipulate',secondMoveRaw:move2.toString(),error:String(error)}));}
          }
        }
      }
    }
    fs.writeFileSync(`composer-runs/2026-10-15/klend-kliquidity-deposit-control-${STRATEGY.strategy}.json`,
      JSON.stringify(output,null,2)+'\n');
    return;
  }
  const tests=[1n,1000000n,1000000000n,10000000000n,25000000000n,50000000000n,
    100000000000n,200000000000n,500000000000n,available*99n/100n,available,available+1n];
  for(const n of tests) {
    const seed=n+1000000000n; // clearly disclosed; borrower can repay even one-way control
    await setSeed(seed);
    const pre=await getRows();
    const currentStart=startFor(pre.rows[6].tick);
    const borrow=flash(borrowTemplate,n),repay=flash(repayTemplate,n,1);
    const forward=[createWif,borrow,swap(n,true,currentStart),repay];
    let caseResult={amountRaw:n.toString(),seedRaw:seed.toString(),preSlot:pre.slot,pre:pre.rows};
    try {
      const f=summarize(pre,await simulate('forward_then_repay',forward,blockhash));
      caseResult.forward=f;
      if(!f.err&&f.deltas.userWIF.rawAmount&&BigInt(f.deltas.userWIF.rawAmount)>0n) {
        const out=BigInt(f.deltas.userWIF.rawAmount);
        const tick=f.post[6].tick;
        const reverse=swap(out,false,startFor(tick));
        const variants=[
          ['forward_reverse',[createWif,borrow,swap(n,true,currentStart),reverse,flash(repayTemplate,n,1)]],
          ['forward_collect_reverse',[createWif,borrow,swap(n,true,currentStart),collect,reverse,flash(repayTemplate,n,1)]],
          ['collect_forward_reverse',[createWif,borrow,collect,swap(n,true,currentStart),reverse,flash(repayTemplate,n,1)]],
          ['forward_reverse_collect',[createWif,borrow,swap(n,true,currentStart),reverse,collect,flash(repayTemplate,n,1)]],
        ];
        for(const [name,ixs] of n<=100000000000n?variants:variants.slice(1,2)) {
          try {caseResult[name]=summarize(pre,await simulate(name,ixs,blockhash));}
          catch(error){caseResult[name]={transportError:String(error)}}
        }
      }
    } catch(error){caseResult.setupError=String(error)}
    output.cases.push(caseResult);
    console.log(JSON.stringify({amountRaw:n.toString(),seedRaw:seed.toString(),
      forward:caseResult.forward?.err||caseResult.setupError||null,
      forwardWif:caseResult.forward?.deltas?.userWIF?.rawAmount,
      tick:caseResult.forward?.post?.[6]?.tick,
      cycle:caseResult.forward_collect_reverse?.err||caseResult.forward_collect_reverse?.transportError||null,
      cycleWsol:caseResult.forward_collect_reverse?.deltas?.userWSOL?.rawAmount,
      v1Bytes:caseResult.forward_collect_reverse?.v1Bytes}));
  }
  // The actual value-moving strategy probe uses the same live pool, oracle,
  // share mint, and deployed strategy accounts. All quantities are raw units.
  const loan=100000000000n,forwardAmount=50000000000n,depositMaxA=10000000000n,
    depositMaxB=1000000000n,seed=101000000000n;
  await setSeed(seed);
  const depositPre=await getRows();
  const depositStart=startFor(depositPre.rows[6].tick);
  const depositBorrow=flash(borrowTemplate,loan);
  const depositRepay=flash(repayTemplate,loan,2); // two ATA creates precede borrow
  const depositProbe=[createWif,createShares,depositBorrow,swap(forwardAmount,true,depositStart),
    deposit(depositMaxA,depositMaxB),depositRepay];
  output.depositProbe={seedRaw:seed.toString(),borrowRaw:loan.toString(),
    forwardInputRaw:forwardAmount.toString(),depositMaxARaw:depositMaxA.toString(),
    depositMaxBRaw:depositMaxB.toString(),preSlot:depositPre.slot,pre:depositPre.rows};
  try {
    const d=summarize(depositPre,await simulate('displaced_deposit_then_repay',depositProbe,blockhash));
    output.depositProbe.result=d;
    console.log(JSON.stringify({probe:'deposit',err:d.err,sharesMinted:d.deltas.userShares.rawAmount,
      wsolDelta:d.deltas.userWSOL.rawAmount,wifRemaining:d.post?.[2]?.rawAmount,
      v1Bytes:d.v1Bytes,accounts:d.addresses,cu:d.unitsConsumed}));
    if(!d.err&&BigInt(d.deltas.userShares.rawAmount||0)>0n) {
      const shares=BigInt(d.deltas.userShares.rawAmount);
      const wifRemaining=BigInt(d.post[2].rawAmount);
      const reverseStart=startFor(d.post[6].tick);
      const variants=[
        ['deposit_withdraw_no_reversal',[createWif,createShares,depositBorrow,
          swap(forwardAmount,true,depositStart),deposit(depositMaxA,depositMaxB),
          withdraw(shares),depositRepay]],
        ['deposit_reverse_withdraw',[createWif,createShares,depositBorrow,
          swap(forwardAmount,true,depositStart),deposit(depositMaxA,depositMaxB),
          swap(wifRemaining,false,reverseStart),withdraw(shares),depositRepay]],
        ['deposit_collect_reverse_withdraw',[createWif,createShares,depositBorrow,
          swap(forwardAmount,true,depositStart),deposit(depositMaxA,depositMaxB),
          collect,swap(wifRemaining,false,reverseStart),withdraw(shares),depositRepay]],
      ];
      for(const [name,ixs] of variants) {
        try {const r=summarize(depositPre,await simulate(name,ixs,blockhash));
          output.depositProbe[name]=r;
          console.log(JSON.stringify({probe:name,err:r.err,sharesDelta:r.deltas.userShares.rawAmount,
            wsolDelta:r.deltas.userWSOL.rawAmount,wifDelta:r.deltas.userWIF.rawAmount,
            v1Bytes:r.v1Bytes,accounts:r.addresses,cu:r.unitsConsumed}));}
        catch(error){output.depositProbe[name]={transportError:String(error)};
          console.log(JSON.stringify({probe:name,transportError:String(error)}));}
      }
    }
  }catch(error){output.depositProbe.error=String(error);console.log(JSON.stringify({probe:'deposit',error:String(error)}))}
  output.depositMatrix=[];
  for(const move of [100000000n,500000000n,1000000000n,2000000000n,
    5000000000n,10000000000n,25000000000n,50000000000n]) {
    await setSeed(seed);
    const pre=await getRows(),start=startFor(pre.rows[6].tick);
    const ixs=[createWif,createShares,depositBorrow,swap(move,true,start),
      deposit(10000000000n,50000000n),depositRepay];
    const row={forwardInputRaw:move.toString(),seedRaw:seed.toString(),preSlot:pre.slot};
    try {
      const d=summarize(pre,await simulate('deposit_matrix',ixs,blockhash));row.deposit=d;
      if(!d.err&&BigInt(d.deltas.userShares.rawAmount||0n)>0n) {
        const shares=BigInt(d.deltas.userShares.rawAmount);
        const wifRemaining=BigInt(d.post[2].rawAmount);
        row.mintedSharesRaw=shares.toString();row.wifRemainingRaw=wifRemaining.toString();
        const reverse=swap(wifRemaining,false,startFor(d.post[6].tick));
        for(const [label,parts] of [
          ['withdraw_same_price',[...ixs.slice(0,-1),withdraw(shares),depositRepay]],
          ['reverse_then_withdraw',[...ixs.slice(0,-1),reverse,withdraw(shares),depositRepay]],
        ]) {
          try{row[label]=summarize(pre,await simulate(label,parts,blockhash));}
          catch(error){row[label]={transportError:String(error)}}
        }
      }
    }catch(error){row.error=String(error)}
    output.depositMatrix.push(row);
    console.log(JSON.stringify({probe:'deposit_matrix',move:move.toString(),
      err:row.deposit?.err||row.error||null,shares:row.mintedSharesRaw||null,
      roundtripErr:row.reverse_then_withdraw?.err||row.reverse_then_withdraw?.transportError||null,
      wsolDelta:row.reverse_then_withdraw?.deltas?.userWSOL?.rawAmount,
      wifDelta:row.reverse_then_withdraw?.deltas?.userWIF?.rawAmount}));
  }
  // Orca exposes exactly three tick arrays per legacy swap. Chain several
  // correctly re-indexed swaps in one v1 transaction to cross further arrays.
  const rangeLoan=200000000000n,rangeChunk=50000000000n,rangeSeed=201000000000n;
  await setSeed(rangeSeed);
  const rangePre=await getRows();
  const rangeBorrow=flash(borrowTemplate,rangeLoan),rangeRepay=flash(repayTemplate,rangeLoan,1);
  const range={seedRaw:rangeSeed.toString(),borrowRaw:rangeLoan.toString(),
    chunkRaw:rangeChunk.toString(),preSlot:rangePre.slot,pre:rangePre.rows,
    forwards:[],reverses:[]};
  let sequence=[createWif,rangeBorrow],tick=rangePre.rows[6].tick;
  for(let i=0;i<4;i++){
    sequence.push(swap(rangeChunk,true,startFor(tick)));
    try {
      const r=summarize(rangePre,await simulate('range_forward_'+(i+1),
        [...sequence,rangeRepay],blockhash));range.forwards.push(r);
      if(r.err)break;tick=r.post[6].tick;
    }catch(error){range.forwards.push({transportError:String(error)});break}
  }
  if(range.forwards.length===4&&!range.forwards[3].err&&!range.forwards[3].transportError){
    const totalWif=BigInt(range.forwards[3].post[2].rawAmount);
    range.totalWifRaw=totalWif.toString();
    const base=totalWif/4n;
    for(let i=0;i<4;i++){
      const amount=i===3?totalWif-base*3n:base;
      sequence.push(swap(amount,false,startFor(tick)));
      try{
        const r=summarize(rangePre,await simulate('range_reverse_'+(i+1),
          [...sequence,rangeRepay],blockhash));range.reverses.push(r);
        if(r.err)break;tick=r.post[6].tick;
      }catch(error){range.reverses.push({transportError:String(error)});break}
    }
    if(range.reverses.length===4&&!range.reverses[3].err&&!range.reverses[3].transportError){
      const withCollect=[...sequence.slice(0,6),collect,...sequence.slice(6),rangeRepay];
      try{range.collectBetween=summarize(rangePre,await simulate('range_collect_between',withCollect,blockhash));}
      catch(error){range.collectBetween={transportError:String(error)}}
    }
  }
  output.multiArrayRange=range;
  console.log(JSON.stringify({probe:'multi_array_range',forwardTicks:range.forwards.map(r=>r.post?.[6]?.tick),
    forwardErrs:range.forwards.map(r=>r.err||r.transportError||null),
    reverseTicks:range.reverses.map(r=>r.post?.[6]?.tick),
    reverseErrs:range.reverses.map(r=>r.err||r.transportError||null),
    collectErr:range.collectBetween?.err||range.collectBetween?.transportError||null,
    size:range.collectBetween?.v1Bytes,accounts:range.collectBetween?.addresses,
    wsolDelta:range.collectBetween?.deltas?.userWSOL?.rawAmount}));
  fs.writeFileSync('composer-runs/2026-10-15/klend-orca-kliquidity-v1.json',JSON.stringify(output,null,2)+'\n');
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1});
