#!/usr/bin/env node
'use strict';

// Read-only WSOL/USDC construction/simulation. No send path.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, Keypair, TransactionInstruction, SystemProgram} = require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);
const anchor = require(`${MOD}/@coral-xyz/anchor`);
const DLMM = require(`${MOD}/@meteora-ag/dlmm`);
const bs58Module = require(`${MOD}/bs58`);
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('../../2026-10-15/klend-v1-composition.js');

const ROOT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const MAINNET = 'https://api.mainnet-beta.solana.com';
const FORK = process.env.FORK_RPC || 'http://127.0.0.1:9033';
const P = x => new PublicKey(x);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const JUP_FLASH = P('jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS');
const JUP_LIQ = P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC');
const JUP_LIQUIDITY = P('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z');
const JUP_ADMIN = P('ALXWtv2P4GqH1B7Lq731joag52yRBRqmHV4naiXPTYWL');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PAIR = P('HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR');
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const jup = {targetReserve:'94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu',
  targetBorrowPosition:'J9dyC4pBTBPvzzPh7J9rhFhg8RvgerDNKkUH9kEwGMsj',
  targetRateModel:'5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688',
  targetVault:'BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB'};
const klend = JSON.parse(fs.readFileSync(`${ROOT}/klend-zero-fee-census.json`)).activeZero
  .find(x => x.reserve === '4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const history = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`)).hits[0].transaction;
const client = new Connection(MAINNET, 'confirmed');
let rpcId = 0;

async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${url} ${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function u64(x) { const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; }
function historicalIx(tx, index) {
  const message = tx.transaction.message;
  const all = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable||[]), ...(tx.meta.loadedAddresses?.readonly||[])];
  const h=message.header, n=message.accountKeys.length, nw=(tx.meta.loadedAddresses?.writable||[]).length;
  const writable=j=>j<n ? (j<h.numRequiredSignatures ? j<h.numRequiredSignatures-h.numReadonlySignedAccounts : j<n-h.numReadonlyUnsignedAccounts) : j<n+nw;
  const ix=message.instructions[index];
  return new TransactionInstruction({programId:P(all[ix.programIdIndex]),data:Buffer.from(bs58.decode(ix.data)),
    keys:ix.accounts.map(j=>({pubkey:P(all[j]),isSigner:j<h.numRequiredSignatures,isWritable:writable(j)}))});
}
function clone(ix) {return new TransactionInstruction({programId:ix.programId,data:Buffer.from(ix.data),keys:ix.keys.map(x=>({...x}))});}
function klendPair(owner,ata,amount) {
  const borrow=clone(historicalIx(history,3)); const repay=clone(historicalIx(history,13));
  const market=P(klend.market), marketAuthority=PublicKey.findProgramAddressSync([Buffer.from('lma'),market.toBuffer()],KLEND)[0];
  for (const ix of [borrow,repay]) {
    const map={0:owner,1:marketAuthority,2:market,3:P(klend.reserve),4:WSOL,5:P(klend.supplyVault),
      6:ata,7:P(klend.feeVault),11:TOKEN_PROGRAM_ID};
    for (const [i,p] of Object.entries(map)) ix.keys[Number(i)].pubkey=p;
    ix.data.writeBigUInt64LE(amount,8);
  }
  return {borrow,repay};
}
function jupIx(disc,owner,ata,amount) {
  const keys=[
    [owner,true,true],[JUP_ADMIN,false,true],[ata,false,true],[USDC,false,false],
    [P(jup.targetReserve),false,true],[P(jup.targetBorrowPosition),false,true],
    [P(jup.targetRateModel),false,false],[P(jup.targetVault),false,true],
    [JUP_LIQUIDITY,false,false],[JUP_LIQ,false,false],[TOKEN_PROGRAM_ID,false,false],
    [ASSOCIATED_TOKEN_PROGRAM_ID,false,false],[SystemProgram.programId,false,false],[IX_SYSVAR,false,false]
  ].map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable}));
  return new TransactionInstruction({programId:JUP_FLASH,keys,data:Buffer.concat([Buffer.from(disc,'hex'),u64(amount)])});
}
async function main() {
  const d=await DLMM.create(client,PAIR);
  const slot=await client.getSlot('confirmed');
  const owner=Keypair.generate(), position=Keypair.generate();
  const ataX=getAssociatedTokenAddressSync(WSOL,owner.publicKey,false,TOKEN_PROGRAM_ID);
  const ataY=getAssociatedTokenAddressSync(USDC,owner.publicKey,false,TOKEN_PROGRAM_ID);
  const active=d.lbPair.activeId;
  const binMeta=DLMM.getBinArrayAccountMetasCoverage(new anchor.BN(active),new anchor.BN(active),PAIR,d.program.programId);
  const transfer=d.getPotentialToken2022IxDataAndAccounts(0);
  const common={position:position.publicKey,lbPair:PAIR,userTokenX:ataX,userTokenY:ataY,
    reserveX:d.lbPair.reserveX,reserveY:d.lbPair.reserveY,tokenXMint:WSOL,tokenYMint:USDC,
    binArrayBitmapExtension:d.binArrayBitmapExtension?.publicKey||null,
    sender:owner.publicKey,tokenXProgram:TOKEN_PROGRAM_ID,tokenYProgram:TOKEN_PROGRAM_ID,memoProgram:MEMO};
  const init=await d.program.methods.initializePosition(active,1).accountsPartial({
    payer:owner.publicKey,position:position.publicKey,lbPair:PAIR,owner:owner.publicKey,
    rent:P('SysvarRent111111111111111111111111111111111')}).instruction();
  const depositX=BigInt(process.env.DEPOSIT_X||'0');
  const depositY=BigInt(process.env.DEPOSIT_Y||'400000000000');
  const forwardX=BigInt(process.env.FORWARD_X||'3000000000000');
  const reverseY=BigInt(process.env.REVERSE_Y||'150000000000');
  const loanX=BigInt(process.env.LOAN_X||'4500000000000');
  const loanY=BigInt(process.env.LOAN_Y||'500000000000');
  const wrapLamports=BigInt(process.env.WRAP_LAMPORTS||'200000000');
  const strategy=DLMM.toStrategyParameters({minBinId:active,maxBinId:active,strategyType:DLMM.StrategyType.Spot});
  const add=await d.program.methods.addLiquidityByStrategy2({amountX:new anchor.BN(depositX.toString()),
    amountY:new anchor.BN(depositY.toString()),activeId:active,maxActiveBinSlippage:100,
    strategyParameters:strategy},{slices:transfer.slices})
    .accountsPartial(common).remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const swapArraysX=(await d.getBinArrayForSwap(true,2)).map(x=>({pubkey:x.publicKey,isSigner:false,isWritable:true}));
  const swapArraysY=(await d.getBinArrayForSwap(false,2)).map(x=>({pubkey:x.publicKey,isSigner:false,isWritable:true}));
  const swap=async(inMint,outMint,inAmount,arrays)=>d.program.methods.swap2(new anchor.BN(inAmount.toString()),
    new anchor.BN(0),{slices:transfer.slices}).accountsPartial({lbPair:PAIR,reserveX:d.lbPair.reserveX,
      reserveY:d.lbPair.reserveY,tokenXMint:WSOL,tokenYMint:USDC,tokenXProgram:TOKEN_PROGRAM_ID,
      tokenYProgram:TOKEN_PROGRAM_ID,user:owner.publicKey,
      userTokenIn:inMint.equals(WSOL)?ataX:ataY,userTokenOut:outMint.equals(WSOL)?ataX:ataY,
      binArrayBitmapExtension:d.binArrayBitmapExtension?.publicKey||null,oracle:d.lbPair.oracle,
      hostFeeIn:null,memoProgram:MEMO}).remainingAccounts(transfer.accounts).remainingAccounts(arrays).instruction();
  const fwd=await swap(WSOL,USDC,forwardX,swapArraysX);
  const rev=await swap(USDC,WSOL,reverseY,swapArraysY);
  const claim=await d.program.methods.claimFee2(active,active,{slices:transfer.slices}).accountsPartial({
    lbPair:PAIR,sender:owner.publicKey,position:position.publicKey,reserveX:d.lbPair.reserveX,
    reserveY:d.lbPair.reserveY,tokenXMint:WSOL,tokenYMint:USDC,userTokenX:ataX,userTokenY:ataY,
    tokenProgramX:TOKEN_PROGRAM_ID,tokenProgramY:TOKEN_PROGRAM_ID,memoProgram:MEMO})
    .remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const remove=await d.program.methods.removeLiquidityByRange2(active,active,10000,{slices:transfer.slices})
    .accountsPartial(common).remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const close=await d.program.methods.closePositionIfEmpty().accountsPartial({
    rentReceiver:owner.publicKey,position:position.publicKey,sender:owner.publicKey}).instruction();
  const k=klendPair(owner.publicKey,ataX,loanX);
  const jb=jupIx('67134e18f009873f',owner.publicKey,ataY,loanY);
  const jr=jupIx('d52f998954f35ee8',owner.publicKey,ataY,loanY);
  const instructions=[
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey,ataX,owner.publicKey,WSOL,TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey,ataY,owner.publicKey,USDC,TOKEN_PROGRAM_ID),
    SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:ataX,lamports:wrapLamports}),
    createSyncNativeInstruction(ataX),
    k.borrow,jb,init,add,fwd,rev,claim,remove,close,jr,k.repay
  ];
  k.repay.data[16]=instructions.indexOf(k.borrow);
  const blockhash=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeV1(instructions,owner.publicKey,blockhash);
  const output={observedAt:new Date().toISOString(),slot,readOnly:true,submitted:false,
    owner:owner.publicKey.toBase58(),position:position.publicKey.toBase58(),
    pair:PAIR.toBase58(),activeId:active,baseFeePct:d.getFeeInfo().baseFeeRatePercentage.toString(),
    protocolSharePct:d.getFeeInfo().protocolFeePercentage.toString(),
    amounts:{loanX:String(loanX),loanY:String(loanY),depositX:String(depositX),depositY:String(depositY),
      forwardX:String(forwardX),reverseY:String(reverseY),wrapLamports:String(wrapLamports)},
    wire:{bytes:encoded.sizeBytes,accounts:encoded.addressCount,requiredSignatures:encoded.requiredSignatures,
      instructions:instructions.length,sha256:crypto.createHash('sha256').update(encoded.wire).digest('hex')},
    instructionBreakdown:instructions.map((ix,i)=>({i,program:ix.programId.toBase58(),keys:ix.keys.length,dataBytes:ix.data.length})),
    binArrays:{position:binMeta.map(x=>x.pubkey.toBase58()),forward:swapArraysX.map(x=>x.pubkey.toBase58()),reverse:swapArraysY.map(x=>x.pubkey.toBase58())}
  };
  console.log(JSON.stringify(output,null,2));
  fs.writeFileSync(`${__dirname}/construction.json`,JSON.stringify(output,null,2));
  if (encoded.sizeBytes>4096||encoded.addressCount>64){console.error('V1 envelope exceeded; simulation skipped');return;}
  for(const ix of instructions){for(const key of [ix.programId,...ix.keys.map(x=>x.pubkey)]){
    await rpc(FORK,'getAccountInfo',[key.toBase58(),{encoding:'base64',commitment:'processed'}]).catch(()=>{});
  }}
  await rpc(FORK,'requestAirdrop',[owner.publicKey.toBase58(),10_000_000_000]);
  const watched=[owner.publicKey,ataX,ataY,position.publicKey,d.lbPair.reserveX,d.lbPair.reserveY,
    P(klend.supplyVault),P(klend.feeVault),P(jup.targetVault)];
  const pre=await rpc(FORK,'getMultipleAccounts',[watched.map(x=>x.toBase58()),{encoding:'base64',commitment:'processed'}]);
  const sim=await rpc(FORK,'simulateTransaction',[encoded.wire.toString('base64'),{
    encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watched.map(x=>x.toBase58())}
  }]);
  const image=a=>a?({lamports:a.lamports,amountRaw:a.owner===TOKEN_PROGRAM_ID.toBase58()?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null}):null;
  const result={...output,
    simulation:{slot:sim.context.slot,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
    logs:sim.value.logs,innerInstructions:sim.value.innerInstructions,
    accounts:sim.value.accounts?.map((a,i)=>({address:watched[i].toBase58(),
      before:image(pre.value[i]),after:image(a)}))}};
  fs.writeFileSync(`${__dirname}/simulation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({simulation:{slot:result.simulation.slot,err:result.simulation.err,
    unitsConsumed:result.simulation.unitsConsumed,logs:result.simulation.logs?.slice(-12)}},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
