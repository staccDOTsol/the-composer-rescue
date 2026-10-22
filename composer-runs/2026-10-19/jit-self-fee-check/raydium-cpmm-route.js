#!/usr/bin/env node
'use strict';

// Read-only instruction construction for a Solana v1 JIT/self-swap route.
// This file has no private-key loading and no sendTransaction path.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, TransactionInstruction, SystemProgram, Connection} = require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction, createCloseAccountInstruction, TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);
const bs58Module = require(`${MOD}/bs58`);
const bs58 = bs58Module.default || bs58Module;
const anchor = require(`${MOD}/@coral-xyz/anchor`);
const DLMM = require(`${MOD}/@meteora-ag/dlmm`);

const P = x => new PublicKey(x);
const RAYDIUM = P('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const POOL = P('fAjTnZ9QqJkUmrr8cXutkYhpVge2qqtSZNt9qKn7YC2');
const CONFIG = P('FMmwToGqT9iwDgsqvzLg65vcKSzKme4szbWqX1kyCBCJ');
const AUTHORITY = P('GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL');
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VAULT_X = P('v3YN4d7JRhKFcwtex7qNtyg2r5hKYW96Cayb6GivSvY');
const VAULT_Y = P('HG2WgeYsjqQhnjhwHj7QdTVvjyWpFRk6VREAQ8MURv2u');
const LP_MINT = P('6TLtYTBaLaLMhkkHz8kCdDc9ej54G4yd7kQKuptd9ipn');
const OBSERVATION = P('BeMRiScNtZrU1Ce4D6Kv5FYKLyhGTRbmMq2KPVxupuDv');
const TOPUP_PAIR = P('HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const JUP_FLASH = P('jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS');
const JUP_LIQ = P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC');
const JUP_LIQUIDITY = P('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z');
const JUP_ADMIN = P('ALXWtv2P4GqH1B7Lq731joag52yRBRqmHV4naiXPTYWL');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const ASSOCIATED_TOKEN_PROGRAM = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const JUP_WSOL = {
  reserve: P('4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy'),
  borrowPosition: P('BZZKgXxhxVkzx3NN8RfBPwU7ZmnQbDtp3ezcsXbiALL6'),
  rateModel: P('Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo'),
  vault: P('5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr'),
};
const USDC_RESERVE = JSON.parse(fs.readFileSync(
  '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/klend-zero-fee-census.json'))
  .activeZero.find(x => x.reserve === '4QKFoFDzNFnvfkzVazABbCEfMwd3y1pZqUVzmpnkCphj');
const HISTORICAL_FLASH = JSON.parse(fs.readFileSync(
  '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kamino-flash-history.json')).hits[0].transaction;

function u64(x) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; }
function disc(name) { return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8); }
function meta(pubkey, writable=false, signer=false) { return {pubkey, isSigner:signer, isWritable:writable}; }
function historicalIx(tx, index) {
  const msg = tx.transaction.message;
  const keys = [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable||[]),
    ...(tx.meta.loadedAddresses?.readonly||[])];
  const h=msg.header, n=msg.accountKeys.length, nw=(tx.meta.loadedAddresses?.writable||[]).length;
  const writable=j=>j<n ? (j<h.numRequiredSignatures ?
    j<h.numRequiredSignatures-h.numReadonlySignedAccounts :
    j<n-h.numReadonlyUnsignedAccounts) : j<n+nw;
  const ix=msg.instructions[index];
  return new TransactionInstruction({programId:P(keys[ix.programIdIndex]),
    data:Buffer.from(bs58.decode(ix.data)),
    keys:ix.accounts.map(j=>meta(P(keys[j]),writable(j),j<h.numRequiredSignatures))});
}
function clone(ix) { return new TransactionInstruction({programId:ix.programId,
  data:Buffer.from(ix.data),keys:ix.keys.map(x=>({...x}))}); }
function klendPair(owner, ata, amount) {
  const borrow=clone(historicalIx(HISTORICAL_FLASH,3));
  const repay=clone(historicalIx(HISTORICAL_FLASH,13));
  const market=P(USDC_RESERVE.market);
  const marketAuthority=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  for(const ix of [borrow,repay]) {
    const replacements={0:owner,1:marketAuthority,2:market,3:P(USDC_RESERVE.reserve),
      4:USDC,5:P(USDC_RESERVE.supplyVault),6:ata,7:P(USDC_RESERVE.feeVault),11:TOKEN_PROGRAM_ID};
    for(const [i,key] of Object.entries(replacements)) ix.keys[Number(i)].pubkey=key;
    ix.data.writeBigUInt64LE(BigInt(amount),8);
  }
  return {borrow,repay};
}
function jupIx(discriminator,owner,ata,amount) {
  const keys=[
    meta(owner,true,true),meta(JUP_ADMIN,true),meta(ata,true),meta(WSOL),
    meta(JUP_WSOL.reserve,true),meta(JUP_WSOL.borrowPosition,true),meta(JUP_WSOL.rateModel),
    meta(JUP_WSOL.vault,true),meta(JUP_LIQUIDITY),meta(JUP_LIQ),meta(TOKEN_PROGRAM_ID),
    meta(ASSOCIATED_TOKEN_PROGRAM),meta(SystemProgram.programId),meta(IX_SYSVAR),
  ];
  return new TransactionInstruction({programId:JUP_FLASH,keys,
    data:Buffer.concat([Buffer.from(discriminator,'hex'),u64(amount)])});
}
function lpIx(name,owner,ataX,ataY,ataLp,lpAmount,maxX,maxY) {
  const keys=[meta(owner,false,true),meta(AUTHORITY),meta(POOL,true),meta(ataLp,true),
    meta(ataX,true),meta(ataY,true),meta(VAULT_X,true),meta(VAULT_Y,true),
    meta(TOKEN_PROGRAM_ID),meta(TOKEN_2022_PROGRAM_ID),meta(WSOL),meta(USDC),meta(LP_MINT,true)];
  if(name==='withdraw') keys.push(meta(MEMO));
  return new TransactionInstruction({programId:RAYDIUM,keys,
    data:Buffer.concat([disc(name),u64(lpAmount),u64(maxX),u64(maxY)])});
}
function swapIx(owner,ataX,ataY,xToY,amountIn,minOut) {
  const inputAccount=xToY?ataX:ataY,outputAccount=xToY?ataY:ataX;
  const inputVault=xToY?VAULT_X:VAULT_Y,outputVault=xToY?VAULT_Y:VAULT_X;
  const inputMint=xToY?WSOL:USDC,outputMint=xToY?USDC:WSOL;
  const keys=[meta(owner,false,true),meta(AUTHORITY),meta(CONFIG),meta(POOL,true),
    meta(inputAccount,true),meta(outputAccount,true),meta(inputVault,true),meta(outputVault,true),
    meta(TOKEN_PROGRAM_ID),meta(TOKEN_PROGRAM_ID),meta(inputMint),meta(outputMint),
    meta(OBSERVATION,true)];
  return new TransactionInstruction({programId:RAYDIUM,keys,
    data:Buffer.concat([disc('swap_base_input'),u64(amountIn),u64(minOut)])});
}
function readPoolState(account) {
  if(!account||!account.owner.equals(RAYDIUM)||account.data.length!==637)
    throw new Error('Raydium pool account missing or layout changed');
  const d=account.data;
  const state={status:d[329],lpSupply:d.readBigUInt64LE(333),protocolX:d.readBigUInt64LE(341),
    protocolY:d.readBigUInt64LE(349),fundX:d.readBigUInt64LE(357),fundY:d.readBigUInt64LE(365),
    openTime:d.readBigUInt64LE(373),creatorFeeOn:d[389],enableCreatorFee:!!d[390],
    creatorX:d.readBigUInt64LE(397),creatorY:d.readBigUInt64LE(405)};
  if(state.status!==0) throw new Error(`Pool deposit/withdraw/swap status flags ${state.status}`);
  if(state.enableCreatorFee) throw new Error('Creator fee enabled; route economics require re-evaluation');
  return state;
}
function quoteSwap(amountIn,inputReserve,outputReserve) {
  const fee=(amountIn*50n+999999n)/1000000n;
  const amountLessFee=amountIn-fee;
  const output=(amountLessFee*outputReserve)/(inputReserve+amountLessFee);
  const protocol=fee*120000n/1000000n, fund=fee*40000n/1000000n;
  return {output,fee,protocol,fund,netReserveInput:amountIn-protocol-fund};
}

async function buildRoute({connection,rpcUrl,owner,amounts={}}) {
  connection=connection||new Connection(rpcUrl||'https://api.mainnet-beta.solana.com','confirmed');
  owner=P(owner);
  const loanWsolRaw=BigInt(amounts.loanWsolRaw??'10000000000000');
  const loanUsdcRaw=BigInt(amounts.loanUsdcRaw??'800000000000');
  const depositWsolRaw=BigInt(amounts.depositWsolRaw??'5000000000000');
  const forwardWsolRaw=BigInt(amounts.forwardWsolRaw??'5000000000000');
  const loops=Number(amounts.loops??1);
  const wrapLamports=BigInt(amounts.wrapLamports??'200000000');
  const guardPpm=BigInt(amounts.guardPpm??'1000');
  const depositHeadroomPpm=BigInt(amounts.depositHeadroomPpm??'1000');
  const withdrawGuardPpm=BigInt(amounts.withdrawGuardPpm??'1000');
  const topupEnabled=amounts.topupEnabled!==false;
  if(!Number.isSafeInteger(loops)||loops<1||loops>16) throw new Error('Invalid loop count');
  if(guardPpm<0n||guardPpm>1000n) throw new Error('Invalid slippage guard (ppm)');
  if(depositHeadroomPpm<0n||depositHeadroomPpm>10000n||
    withdrawGuardPpm<0n||withdrawGuardPpm>1000n)
    throw new Error('Invalid LP slippage guard (ppm)');
  const guarded=x=>x*(1000000n-guardPpm)/1000000n;
  const lpMin=x=>x*(1000000n-withdrawGuardPpm)/1000000n;
  const lpMax=x=>(x*(1000000n+depositHeadroomPpm)+999999n)/1000000n;
  if(depositWsolRaw<=0n||depositWsolRaw>=loanWsolRaw) throw new Error('Invalid LP deposit size');
  if(forwardWsolRaw<=0n||forwardWsolRaw>loanWsolRaw-depositWsolRaw+wrapLamports)
    throw new Error('Forward swap exceeds funded WSOL balance');
  const ataWsol=getAssociatedTokenAddressSync(WSOL,owner,false,TOKEN_PROGRAM_ID);
  const ataUsdc=getAssociatedTokenAddressSync(USDC,owner,false,TOKEN_PROGRAM_ID);
  const ataLp=getAssociatedTokenAddressSync(LP_MINT,owner,false,TOKEN_PROGRAM_ID);
  const accounts=await connection.getMultipleAccountsInfo(
    [POOL,VAULT_X,VAULT_Y,CONFIG,ataWsol,ataUsdc,ataLp],'confirmed');
  const state=readPoolState(accounts[0]);
  const cfg=accounts[3]?.data;
  if(!accounts[3]?.owner.equals(RAYDIUM)||!cfg||cfg.length<36)
    throw new Error('Raydium fee config account missing or layout changed');
  const tradeFeeRate=cfg.readBigUInt64LE(12),protocolFeeRate=cfg.readBigUInt64LE(20),
    fundFeeRate=cfg.readBigUInt64LE(28);
  if(tradeFeeRate!==50n||protocolFeeRate!==120000n||fundFeeRate!==40000n)
    throw new Error(`Raydium pool fee config changed: ${tradeFeeRate}/${protocolFeeRate}/${fundFeeRate}`);
  const vaultX=accounts[1]?.data.readBigUInt64LE(64),vaultY=accounts[2]?.data.readBigUInt64LE(64);
  if(vaultX===undefined||vaultY===undefined) throw new Error('Pool vault account missing');
  let reserveX=vaultX-state.protocolX-state.fundX-state.creatorX;
  let reserveY=vaultY-state.protocolY-state.fundY-state.creatorY;
  const lpAmount=depositWsolRaw*state.lpSupply/reserveX;
  if(lpAmount===0n) throw new Error('LP amount underflow');
  const depositX=(lpAmount*reserveX+state.lpSupply-1n)/state.lpSupply;
  const depositY=(lpAmount*reserveY+state.lpSupply-1n)/state.lpSupply;
  if(depositX>loanWsolRaw||depositY>loanUsdcRaw)
    throw new Error(`LP deposit needs ${depositX} WSOL raw and ${depositY} USDC raw`);
  reserveX+=depositX; reserveY+=depositY;
  const instructions=[];
  if(!accounts[4]) instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    owner,ataWsol,owner,WSOL,TOKEN_PROGRAM_ID));
  if(!accounts[5]) instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    owner,ataUsdc,owner,USDC,TOKEN_PROGRAM_ID));
  if(!accounts[6]) instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    owner,ataLp,owner,LP_MINT,TOKEN_PROGRAM_ID));
  instructions.push(SystemProgram.transfer({fromPubkey:owner,toPubkey:ataWsol,
    lamports:Number(wrapLamports)}),createSyncNativeInstruction(ataWsol));
  const jupBorrow=jupIx('67134e18f009873f',owner,ataWsol,loanWsolRaw);
  const jupRepay=jupIx('d52f998954f35ee8',owner,ataWsol,loanWsolRaw);
  const klend=klendPair(owner,ataUsdc,loanUsdcRaw);
  instructions.push(jupBorrow,klend.borrow,
    lpIx('deposit',owner,ataWsol,ataUsdc,ataLp,lpAmount,lpMax(depositX),lpMax(depositY)));
  const quotes=[];
  let sumForwardWsol=0n,sumForwardUsdc=0n,sumReverseUsdc=0n,sumReverseWsol=0n;
  for(let i=0;i<loops;i++) {
    const fwd=quoteSwap(forwardWsolRaw,reserveX,reserveY);
    const minForwardOut=guarded(fwd.output);
    const reverseUsdcRaw=BigInt(amounts.reverseUsdcRaw??minForwardOut);
    if(reverseUsdcRaw>fwd.output) throw new Error('Reverse input exceeds estimated forward output');
    instructions.push(swapIx(owner,ataWsol,ataUsdc,true,forwardWsolRaw,minForwardOut));
    reserveX+=fwd.netReserveInput; reserveY-=fwd.output;
    const rev=quoteSwap(reverseUsdcRaw,reserveY,reserveX);
    const minReverseOut=guarded(rev.output);
    instructions.push(swapIx(owner,ataWsol,ataUsdc,false,reverseUsdcRaw,minReverseOut));
    reserveY+=rev.netReserveInput; reserveX-=rev.output;
    quotes.push({forwardWsolRaw:String(forwardWsolRaw),forwardUsdcOutRaw:String(fwd.output),
      minForwardOutRaw:String(minForwardOut),reverseUsdcRaw:String(reverseUsdcRaw),
      reverseWsolOutRaw:String(rev.output),minReverseOutRaw:String(minReverseOut),
      forwardFeeRaw:String(fwd.fee),reverseFeeRaw:String(rev.fee)});
    sumForwardWsol+=forwardWsolRaw;sumForwardUsdc+=fwd.output;
    sumReverseUsdc+=reverseUsdcRaw;sumReverseWsol+=rev.output;
  }
  const withdrawX=lpAmount*reserveX/(state.lpSupply+lpAmount);
  const withdrawY=lpAmount*reserveY/(state.lpSupply+lpAmount);
  instructions.push(lpIx('withdraw',owner,ataWsol,ataUsdc,ataLp,lpAmount,
    lpMin(withdrawX),lpMin(withdrawY)));
  const expectedWsol=wrapLamports+loanWsolRaw-depositX-sumForwardWsol+sumReverseWsol+withdrawX;
  const expectedUsdc=loanUsdcRaw-depositY+sumForwardUsdc-sumReverseUsdc+withdrawY;
  const usdcDeficit=expectedUsdc>=loanUsdcRaw?0n:loanUsdcRaw-expectedUsdc;
  let topup=null;
  if(usdcDeficit>0n&&topupEnabled) {
    const d=await DLMM.create(connection,TOPUP_PAIR);
    const arrays=await d.getBinArrayForSwap(true,2);
    const transfer=d.getPotentialToken2022IxDataAndAccounts(0);
    const quote=input=>d.swapQuote(new anchor.BN(input.toString()),true,
      new anchor.BN(10),arrays);
    const requiredOut=usdcDeficit+BigInt(amounts.topupExtraUsdcRaw??'1000');
    let low=1n,high=expectedWsol-loanWsolRaw;
    if(high<=0n||BigInt(quote(high).minOutAmount.toString())<requiredOut)
      throw new Error(`WSOL buffer insufficient for USDC top-up: max ${high} lamports cannot buy ${requiredOut} USDC raw`);
    while(low<high) {
      const mid=(low+high)/2n;
      if(BigInt(quote(mid).minOutAmount.toString())>=requiredOut) high=mid;
      else low=mid+1n;
    }
    const inputWsol=high,q=quote(inputWsol);
    const minOut=BigInt(q.minOutAmount.toString());
    const swapArrays=arrays.map(x=>meta(x.publicKey,true));
    const ix=await d.program.methods.swap2(new anchor.BN(inputWsol.toString()),
      new anchor.BN(minOut.toString()),{slices:transfer.slices})
      .accountsPartial({lbPair:TOPUP_PAIR,reserveX:d.lbPair.reserveX,reserveY:d.lbPair.reserveY,
        tokenXMint:WSOL,tokenYMint:USDC,tokenXProgram:TOKEN_PROGRAM_ID,
        tokenYProgram:TOKEN_PROGRAM_ID,user:owner,userTokenIn:ataWsol,userTokenOut:ataUsdc,
        binArrayBitmapExtension:d.binArrayBitmapExtension?.publicKey||null,
        oracle:d.lbPair.oracle,hostFeeIn:null,memoProgram:MEMO})
      .remainingAccounts(transfer.accounts).remainingAccounts(swapArrays).instruction();
    instructions.push(ix);
    topup={pair:TOPUP_PAIR.toBase58(),inputWsolRaw:String(inputWsol),
      quotedUsdcOutRaw:q.outAmount.toString(),minUsdcOutRaw:String(minOut),
      usdcDeficitRaw:String(usdcDeficit),requiredUsdcRaw:String(requiredOut),
      binArrays:swapArrays.map(x=>x.pubkey.toBase58())};
  }
  instructions.push(klend.repay,jupRepay);
  klend.repay.data[16]=instructions.indexOf(klend.borrow);
  // Close only ATAs this route creates. An existing ATA may contain unrelated funds.
  if(!accounts[4]) instructions.push(createCloseAccountInstruction(ataWsol,owner,owner));
  if(!accounts[6]) instructions.push(createCloseAccountInstruction(ataLp,owner,owner));
  return {instructions,ataWsol,ataUsdc,ataLp,loanWsolRaw,loanUsdcRaw,
    depositWsolRaw:depositX,depositUsdcRaw:depositY,lpAmount,
    grossUsd:Number(sumForwardWsol)*Number(vaultY-state.protocolY-state.fundY-state.creatorY)/
      Number(vaultX-state.protocolX-state.fundX-state.creatorX)/1000000+
      Number(sumReverseUsdc)/1000000,
    poolVaultWsol:VAULT_X,poolVaultUsdc:VAULT_Y,
    jupVaultWsol:JUP_WSOL.vault,klendVaultUsdc:P(USDC_RESERVE.supplyVault),
    pool:POOL,config:CONFIG,quotes,topup,
    expectedBeforeTopup:{wsolRaw:String(expectedWsol),usdcRaw:String(expectedUsdc)},
    ataExisted:{wsol:!!accounts[4],usdc:!!accounts[5],
      lp:!!accounts[6]},poolSnapshot:{reserveX:String(vaultX),reserveY:String(vaultY),
      tradeableX:String(vaultX-state.protocolX-state.fundX-state.creatorX),
      tradeableY:String(vaultY-state.protocolY-state.fundY-state.creatorY),
      lpSupply:String(state.lpSupply),status:state.status,openTime:String(state.openTime),
      enableCreatorFee:state.enableCreatorFee,tradeFeeRate:String(tradeFeeRate),
      protocolFeeRate:String(protocolFeeRate),fundFeeRate:String(fundFeeRate)},
    expectedWithdrawal:{wsolRaw:String(withdrawX),usdcRaw:String(withdrawY),
      minWsolRaw:String(lpMin(withdrawX)),minUsdcRaw:String(lpMin(withdrawY))},
    depositMaximum:{wsolRaw:String(lpMax(depositX)),usdcRaw:String(lpMax(depositY))}};
}

module.exports={buildRoute,POOL,RAYDIUM,VAULT_X,VAULT_Y,LP_MINT,WSOL,USDC};
