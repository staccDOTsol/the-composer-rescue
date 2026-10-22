#!/usr/bin/env node
'use strict';

// Read-only construction/simulation of the exact zero-fee flash -> JIT LP ->
// self swaps -> fee claim -> LP exit -> flash repayment sequence. No send path.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection, PublicKey, Keypair, TransactionInstruction, SystemProgram} = require(`${MOD}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);
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
const JUP_FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const JUP_LIQ = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const JUP_LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const JUP_ADMIN = P('G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PAIR = P('2QE3DepmF4kye9Y9Yh6AXEYUarRsoUFGzdoJhAa9BBQ6');
const USDE = P('DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT');
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const flashData = JSON.parse(fs.readFileSync(`${ROOT}/jup6qf-native-flash-v1-simulations.json`));
const jup = flashData.setups.find(x => x.symbol === 'USDG');
const klend = JSON.parse(fs.readFileSync(`${ROOT}/klend-zero-fee-census.json`)).activeZero
  .find(x => x.name === 'USDe' && x.mint === USDE.toBase58());
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
    const map={0:owner,1:marketAuthority,2:market,3:P(klend.reserve),4:USDE,5:P(klend.supplyVault),
      6:ata,7:P(klend.feeVault),11:TOKEN_PROGRAM_ID};
    for (const [i,p] of Object.entries(map)) ix.keys[Number(i)].pubkey=p;
    ix.data.writeBigUInt64LE(amount,8);
  }
  return {borrow,repay};
}
function jupIx(disc,owner,ata,amount) {
  const keys=[
    [owner,true,true],[JUP_ADMIN,false,true],[ata,false,true],[USDG,false,false],
    [P(jup.targetReserve),false,true],[P(jup.targetBorrowPosition),false,true],
    [P(jup.targetRateModel),false,false],[P(jup.targetVault),false,true],
    [JUP_LIQUIDITY,false,false],[JUP_LIQ,false,false],[TOKEN_2022_PROGRAM_ID,false,false],
    [ASSOCIATED_TOKEN_PROGRAM_ID,false,false],[SystemProgram.programId,false,false],[IX_SYSVAR,false,false]
  ].map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable}));
  return new TransactionInstruction({programId:JUP_FLASH,keys,data:Buffer.concat([Buffer.from(disc,'hex'),u64(amount)])});
}
async function main() {
  const d=await DLMM.create(client,PAIR);
  const slot=await client.getSlot('confirmed');
  const owner=Keypair.generate(), position=Keypair.generate();
  const ataX=getAssociatedTokenAddressSync(USDE,owner.publicKey,false,TOKEN_PROGRAM_ID);
  const ataY=getAssociatedTokenAddressSync(USDG,owner.publicKey,false,TOKEN_2022_PROGRAM_ID);
  const active=d.lbPair.activeId;
  const binMeta=DLMM.getBinArrayAccountMetasCoverage(new anchor.BN(active),new anchor.BN(active),PAIR,d.program.programId);
  const transfer=d.getPotentialToken2022IxDataAndAccounts(0);
  const common={position:position.publicKey,lbPair:PAIR,userTokenX:ataX,userTokenY:ataY,
    reserveX:d.lbPair.reserveX,reserveY:d.lbPair.reserveY,tokenXMint:USDE,tokenYMint:USDG,
    binArrayBitmapExtension:d.binArrayBitmapExtension?.publicKey||null,
    sender:owner.publicKey,tokenXProgram:TOKEN_PROGRAM_ID,tokenYProgram:TOKEN_2022_PROGRAM_ID,memoProgram:MEMO};
  const init=await d.program.methods.initializePosition(active,1).accountsPartial({
    payer:owner.publicKey,position:position.publicKey,lbPair:PAIR,owner:owner.publicKey,
    rent:P('SysvarRent111111111111111111111111111111111')}).instruction();
  const depositX=BigInt(process.env.DEPOSIT_X||'500000000000000'); // 500k USDe, 9 decimals
  const depositY=BigInt(process.env.DEPOSIT_Y||'500000000000');    // 500k USDG, 6 decimals
  const forwardX=BigInt(process.env.FORWARD_X||'400000000000000'); // 400k USDe
  const reverseY=BigInt(process.env.REVERSE_Y||'400000000000');   // 400k USDG
  const loanX=BigInt(process.env.LOAN_X||'1000000000000000');
  const loanY=BigInt(process.env.LOAN_Y||'1000000000000');
  const strategy=DLMM.toStrategyParameters({minBinId:active,maxBinId:active,strategyType:DLMM.StrategyType.Spot});
  const add=await d.program.methods.addLiquidityByStrategy2({amountX:new anchor.BN(depositX.toString()),
    amountY:new anchor.BN(depositY.toString()),activeId:active,maxActiveBinSlippage:100,
    strategyParameters:strategy},{slices:transfer.slices})
    .accountsPartial(common).remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const swapArraysX=(await d.getBinArrayForSwap(true,2)).map(x=>({pubkey:x.publicKey,isSigner:false,isWritable:true}));
  const swapArraysY=(await d.getBinArrayForSwap(false,2)).map(x=>({pubkey:x.publicKey,isSigner:false,isWritable:true}));
  const swap=async(inMint,outMint,inAmount,arrays)=>d.program.methods.swap2(new anchor.BN(inAmount.toString()),
    new anchor.BN(0),{slices:transfer.slices}).accountsPartial({lbPair:PAIR,reserveX:d.lbPair.reserveX,
      reserveY:d.lbPair.reserveY,tokenXMint:USDE,tokenYMint:USDG,tokenXProgram:TOKEN_PROGRAM_ID,
      tokenYProgram:TOKEN_2022_PROGRAM_ID,user:owner.publicKey,
      userTokenIn:inMint.equals(USDE)?ataX:ataY,userTokenOut:outMint.equals(USDE)?ataX:ataY,
      binArrayBitmapExtension:d.binArrayBitmapExtension?.publicKey||null,oracle:d.lbPair.oracle,
      hostFeeIn:null,memoProgram:MEMO}).remainingAccounts(transfer.accounts).remainingAccounts(arrays).instruction();
  const fwd=await swap(USDE,USDG,forwardX,swapArraysX);
  const rev=await swap(USDG,USDE,reverseY,swapArraysY);
  const claim=await d.program.methods.claimFee2(active,active,{slices:transfer.slices}).accountsPartial({
    lbPair:PAIR,sender:owner.publicKey,position:position.publicKey,reserveX:d.lbPair.reserveX,
    reserveY:d.lbPair.reserveY,tokenXMint:USDE,tokenYMint:USDG,userTokenX:ataX,userTokenY:ataY,
    tokenProgramX:TOKEN_PROGRAM_ID,tokenProgramY:TOKEN_2022_PROGRAM_ID,memoProgram:MEMO})
    .remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const remove=await d.program.methods.removeLiquidityByRange2(active,active,10000,{slices:transfer.slices})
    .accountsPartial(common).remainingAccounts(transfer.accounts).remainingAccounts(binMeta).instruction();
  const close=await d.program.methods.closePositionIfEmpty().accountsPartial({
    rentReceiver:owner.publicKey,position:position.publicKey,sender:owner.publicKey}).instruction();
  const k=klendPair(owner.publicKey,ataX,loanX);
  const jb=jupIx('67134e18f009873f',owner.publicKey,ataY,loanY);
  const jr=jupIx('d52f998954f35ee8',owner.publicKey,ataY,loanY);
  const instructions=[
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey,ataX,owner.publicKey,USDE,TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(owner.publicKey,ataY,owner.publicKey,USDG,TOKEN_2022_PROGRAM_ID),
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
      forwardX:String(forwardX),reverseY:String(reverseY)},
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
  // Model a caller-owned fee-loss buffer on the local fork only. The source
  // token accounts are used solely as byte-layout templates; their balances
  // and owner fields are overwritten. This is not a claim of real funding.
  const bufferX=BigInt(process.env.BUFFER_X||'500000000000'); // 500 USDe
  const bufferY=BigInt(process.env.BUFFER_Y||'500000000');    // 500 USDG
  for(const [ata,source,authority,amount,program] of [
    [ataX,'7LjXewfYUtZA9DwdgSL4K8swuYALHRKmecLVio6pHqif',owner.publicKey,bufferX,TOKEN_PROGRAM_ID],
    [ataY,jup.borrowerTokenAccount,owner.publicKey,bufferY,TOKEN_2022_PROGRAM_ID]
  ]) {
    const row=await rpc(FORK,'getAccountInfo',[source,{encoding:'base64',commitment:'processed'}]);
    if(!row.value) throw new Error(`Missing token-account template ${source}`);
    const data=Buffer.from(row.value.data[0],'base64');
    authority.toBuffer().copy(data,32);
    data.writeBigUInt64LE(amount,64);
    await rpc(FORK,'surfnet_setAccount',[ata.toBase58(),{data:data.toString('hex'),
      executable:false,lamports:row.value.lamports,owner:program.toBase58(),rentEpoch:0}]);
  }
  const watched=[owner.publicKey,ataX,ataY,position.publicKey,d.lbPair.reserveX,d.lbPair.reserveY,
    P(klend.supplyVault),P(klend.feeVault),P(jup.targetVault)];
  const pre=await rpc(FORK,'getMultipleAccounts',[watched.map(x=>x.toBase58()),{encoding:'base64',commitment:'processed'}]);
  const sim=await rpc(FORK,'simulateTransaction',[encoded.wire.toString('base64'),{
    encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed',innerInstructions:true,
    accounts:{encoding:'base64',addresses:watched.map(x=>x.toBase58())}
  }]);
  const image=a=>a?({lamports:a.lamports,amountRaw:[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(a.owner)?Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null}):null;
  const result={...output,localForkSeed:{bufferX:String(bufferX),bufferY:String(bufferY),synthetic:true},
    simulation:{slot:sim.context.slot,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
    logs:sim.value.logs,innerInstructions:sim.value.innerInstructions,
    accounts:sim.value.accounts?.map((a,i)=>({address:watched[i].toBase58(),
      before:image(pre.value[i]),after:image(a)}))}};
  fs.writeFileSync(`${__dirname}/simulation.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({simulation:{slot:result.simulation.slot,err:result.simulation.err,
    unitsConsumed:result.simulation.unitsConsumed,logs:result.simulation.logs?.slice(-12)}},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
