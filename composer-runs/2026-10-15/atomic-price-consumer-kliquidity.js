#!/usr/bin/env node
// Read-only current-mainnet v1 simulations; never signs or submits.
const fs = require('fs');
const {Connection, PublicKey, TransactionInstruction} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {createTransferCheckedInstruction} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');
const P = x => new PublicKey(x);
const home = 'composer-runs/2026-10-15/';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split(/\r?\n/)
  .filter(x => x && !x.startsWith('#')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const conn = new Connection(rpcUrl, 'confirmed');
const srcDeposit = JSON.parse(fs.readFileSync(home + 'kliquidity-deposit-source.json'));
const srcSwap = JSON.parse(fs.readFileSync(home + 'kliquidity-orca-swap-source.json')).tx;
const srcWithdraw = JSON.parse(fs.readFileSync(home + 'kliquidity-withdraw-source.json'));
const census = JSON.parse(fs.readFileSync(home + 'klend-zero-fee-census.json'));
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const USER = P('HFXKoknCskn6nVJVDZxpA2K7SREEkXypxaCobnqd2A9Z');
const USER_PYUSD = P('D5QvKZ6TSjuwhCxxQRPfvQrjYoskcniKyXuSzPZzr1PQ');
const USER_USDC = P('9iStuDryvEtGJek21SMMhAQk4u49ts62qk8GKy8nc26K');
const USER_SHARE = P('86AtsnMngKF7pj6AM8bWbbPxRLyktYaymN27y9LPJtcu');
const HOLDER = P('Enj5st8nPmhtKka7ivp8zum66TYz4JjDG45bE3QUyUT7');
const HOLDER_PYUSD = P('FAD3u9fq5W159y2FAo1HMqv6Utogq9XrVuxwB8hJRkUL');
const HOLDER_USDC = P('EBHcqBTqK3Wz81ymgTsLRwhpU89izUw99HbsyKJceWnk');
const HOLDER_SHARE = P('41X7pYVPHucbz8ry1bNd1ieCwaByys41eS8GR125gb5o');
const PYUSD = P('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const STRATEGY = P('Hmj82e48X9LNW8LeMLk186iE4UKPoUwWuLwoiqMpUiGm');
const ORCA_POOL = P('9tXiuRRw7kbejLhZXtxDxYs2REe43uH2e7k1kocgdM9B');
const KL_RES = census.activeZero.filter(x => x.mint === USDC.toBase58())
  .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
if (!KL_RES || KL_RES.flashFeeSf !== '0') throw new Error('exact-zero-rate USDC reserve missing');
const [MARKET_AUTH] = PublicKey.findProgramAddressSync([Buffer.from('lma'), P(KL_RES.market).toBuffer()], KLEND);
const k = (pubkey, isSigner=false, isWritable=false) => ({pubkey, isSigner, isWritable});
const u64 = x => { const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };
function sourceIx(tx, n) {
  const m = tx.transaction.message;
  const keys = [...m.staticAccountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])].map(x => P(x));
  const ix = m.compiledInstructions[n];
  const ns = m.header.numRequiredSignatures, nrs = m.header.numReadonlySignedAccounts,
    nru = m.header.numReadonlyUnsignedAccounts, stat = m.staticAccountKeys.length,
    loadW = tx.meta.loadedAddresses?.writable.length || 0;
  const signer = i => i < ns;
  const writable = i => i < ns ? i < ns-nrs : i < stat ? i < stat-nru : i < stat+loadW;
  return new TransactionInstruction({programId: keys[ix.programIdIndex],
    keys: ix.accountKeyIndexes.map(i => k(keys[i],signer(i),writable(i))), data: Buffer.from(ix.data.data)});
}
function deposit(amountA,amountB) {
  const ix=sourceIx(srcDeposit,3);
  ix.data.writeBigUInt64LE(BigInt(amountA),8);
  ix.data.writeBigUInt64LE(BigInt(amountB),16);
  return ix;
}
function swap(amount,aToB,user=USER,ownerA=USER_PYUSD,ownerB=USER_USDC) {
  const ix=sourceIx(srcSwap,2);
  ix.keys[3].pubkey=user; ix.keys[3].isSigner=true;
  ix.keys[7].pubkey=ownerA; ix.keys[9].pubkey=ownerB;
  ix.data.writeBigUInt64LE(BigInt(amount),8);
  ix.data[40]=1; ix.data[41]=aToB?1:0;
  return ix;
}
function withdraw(shares,user=HOLDER,ownerA=HOLDER_PYUSD,ownerB=HOLDER_USDC,ownerShare=HOLDER_SHARE) {
  const ix=sourceIx(srcWithdraw,5);ix.keys[0].pubkey=user;ix.keys[0].isSigner=true;
  ix.keys[12].pubkey=ownerA;ix.keys[13].pubkey=ownerB;ix.keys[16].pubkey=ownerShare;
  ix.data.writeBigUInt64LE(BigInt(shares),8);return ix;
}
function flash(amount,borrowIndex,user=USER,destination=USER_USDC) {
  const data=Buffer.concat([borrowIndex===undefined ? Buffer.from([135,231,52,167,7,52,212,193]) :
    Buffer.from([185,117,0,203,96,245,180,186]),u64(amount),borrowIndex===undefined?Buffer.alloc(0):Buffer.from([borrowIndex])]);
  return new TransactionInstruction({programId:KLEND,data,keys:[k(user,true),k(MARKET_AUTH),k(P(KL_RES.market)),
    k(P(KL_RES.reserve),false,true),k(USDC),k(P(KL_RES.supplyVault),false,true),k(destination,false,true),
    k(P(KL_RES.feeVault),false,true),k(KLEND),k(KLEND),k(SYSVAR),k(TOKEN)]});
}
const watched=[USER_PYUSD,USER_USDC,USER_SHARE,P(KL_RES.supplyVault),P(KL_RES.feeVault),P(KL_RES.reserve),
  ORCA_POOL,STRATEGY,P('CJJdsVKXsPDcfKsYafBMYb6ZhtgnnjUk5JgBAehXjdzi'),
  P('7ZVPknXkeDJYwJmrSy9Ei4KMbfo59EpyarGtPTu1ppJv')];
function amount(a){if(!a?.data)return null;const d=Buffer.from(a.data[0],'base64');
  return a.owner===TOKEN.toBase58()||a.owner==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? d.readBigUInt64LE(64).toString() : null;}
async function simulate(name,ixs,blockhash,payer=USER,trace=watched) {
  let enc;try{enc=encodeV1(ixs,payer,blockhash);}catch(e){return {name,localError:e.message};}
  const request={jsonrpc:'2.0',id:name,method:'simulateTransaction',params:[enc.wire.toString('base64'),
    {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,
      accounts:{encoding:'base64',addresses:trace.map(String)}}]};
  const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
  const json=await response.json();const v=json.result?.value;
  return {name,slot:json.result?.context?.slot,transportError:json.error||null,err:v?.err||null,
    bytes:enc.sizeBytes,accountCount:enc.addressCount,instructionCount:enc.instructionCount,units:v?.unitsConsumed||null,
    post:trace.map((a,i)=>({address:String(a),raw:amount(v?.accounts?.[i])})),innerInstructions:v?.innerInstructions||null,
    logs:v?.logs?.filter(s=>/Instruction:|Error|failed:|Program log: .*price|Program log: .*Price/.test(s)).slice(-50)||null};
}
(async()=>{
  const info=await conn.getMultipleAccountsInfo(watched,'confirmed');const pre=info.map((a,i)=>({address:String(watched[i]),raw:a?.data&&(a.owner.equals(TOKEN)||a.owner.toBase58()==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')?a.data.readBigUInt64LE(64).toString():null}));
  const blockhash=(await conn.getLatestBlockhash('confirmed')).blockhash;
  const out=[];
  const cases=[
    ['deposit_1each_control',[deposit(1_000_000n,1_000_000n)]],
    ['flash_1000_pair',[flash(1_000_000_000n),flash(1_000_000_000n,0)]],
    ['swap_1_usdc',[swap(1_000_000n,false)]],
  ];
  for(const [name,ixs] of cases){const r=await simulate(name,ixs,blockhash);out.push(r);console.log(JSON.stringify({name,err:r.err,localError:r.localError,transportError:r.transportError,bytes:r.bytes,accounts:r.accountCount,units:r.units,logs:r.logs?.slice(-8)}));}
  for(const amt of [1_000_000_000n,100_000_000_000n,1_000_000_000_000n,1_500_000_000_000n,
    2_000_000_000_000n,2_500_000_000_000n,3_000_000_000_000n,7_000_000_000_000n]){
    const name='forward_deposit_'+amt;
    const first=await simulate(name,[flash(amt),swap(amt,false),deposit(1_000_000n,1_000_000n),flash(amt,0)],blockhash);
    out.push(first);
    const transfer=first.innerInstructions?.find(x=>x.index===1)?.instructions?.find(x=>x.parsed?.info?.mint===PYUSD.toBase58());
    const received=BigInt(transfer?.parsed?.info?.tokenAmount?.amount||0);
    const depositA=first.innerInstructions?.find(x=>x.index===2)?.instructions?.find(x=>x.parsed?.info?.mint===PYUSD.toBase58());
    const spentA=BigInt(depositA?.parsed?.info?.tokenAmount?.amount||0);
    console.log(JSON.stringify({name,err:first.err,bytes:first.bytes,accounts:first.accountCount,units:first.units,receivedPyusdRaw:String(received),depositedPyusdRaw:String(spentA),logs:first.logs?.slice(-4)}));
    if(!received||!spentA)continue;
    const reverseA=received-spentA-1_000n;
    if(reverseA<=0)continue;
    const full=await simulate('roundtrip_'+amt,[flash(amt),swap(amt,false),deposit(1_000_000n,1_000_000n),swap(reverseA,true),flash(amt,0)],blockhash);
    out.push(full);
    console.log(JSON.stringify({name:full.name,err:full.err,bytes:full.bytes,accounts:full.accountCount,units:full.units,reversePyusdRaw:String(reverseA),postUser:full.post?.slice(0,3),logs:full.logs?.slice(-5)}));
    if(amt===100_000_000_000n||amt===1_000_000_000_000n){
      const m=first.innerInstructions?.find(x=>x.index===2)?.instructions?.find(x=>x.parsed?.type==='mintTo'&&x.parsed?.info?.mint==='38wQFRuj6FezzGYegzHdqrRK7hkEkBx7wSqxDBYXpKpy');
      const minted=BigInt(m?.parsed?.info?.amount||0);
      if(minted){
        const scenarios=[['deposit_reverse_withdraw',[flash(amt),swap(amt,false),deposit(1_000_000n,1_000_000n),swap(reverseA,true),withdraw(minted,USER,USER_PYUSD,USER_USDC,USER_SHARE),flash(amt,0)]],
          ['deposit_withdraw_reverse',[flash(amt),swap(amt,false),deposit(1_000_000n,1_000_000n),withdraw(minted,USER,USER_PYUSD,USER_USDC,USER_SHARE),swap(reverseA,true),flash(amt,0)]]];
        for(const [label,ixs] of scenarios){const r=await simulate(label+'_'+amt,ixs,blockhash);out.push(r);console.log(JSON.stringify({name:r.name,err:r.err,bytes:r.bytes,accounts:r.accountCount,units:r.units,mintedSharesRaw:String(minted),postUser:r.post?.slice(0,3),logs:r.logs?.slice(-7)}));}
      }
    }
  }
  const holderTrace=[HOLDER_PYUSD,HOLDER_USDC,HOLDER_SHARE,P(KL_RES.supplyVault),P(KL_RES.feeVault),P(KL_RES.reserve),ORCA_POOL,STRATEGY];
  const holderPre=await conn.getMultipleAccountsInfo(holderTrace,'confirmed');
  const holderStart=holderPre.map((a,i)=>({address:String(holderTrace[i]),raw:a?.data&&(a.owner.equals(TOKEN)||a.owner.toBase58()==='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')?a.data.readBigUInt64LE(64).toString():null}));
  for(const [amt,shares] of [[100_000_000_000n,20_000_000_000n],[1_000_000_000_000n,150_000_000_000n]]){
    const base=await simulate('holder_withdraw_'+shares,[withdraw(shares)],blockhash,HOLDER,holderTrace);out.push(base);
    console.log(JSON.stringify({name:base.name,err:base.err,bytes:base.bytes,accounts:base.accountCount,postUser:base.post?.slice(0,3),logs:base.logs?.slice(-4)}));
    const first=await simulate('holder_forward_withdraw_'+amt,[flash(amt,undefined,HOLDER,HOLDER_USDC),
      swap(amt,false,HOLDER,HOLDER_PYUSD,HOLDER_USDC),withdraw(shares),flash(amt,0,HOLDER,HOLDER_USDC)],blockhash,HOLDER,holderTrace);
    out.push(first);
    const t=first.innerInstructions?.find(x=>x.index===1)?.instructions?.find(x=>x.parsed?.info?.mint===PYUSD.toBase58());
    const received=BigInt(t?.parsed?.info?.tokenAmount?.amount||0);
    console.log(JSON.stringify({name:first.name,err:first.err,receivedPyusdRaw:String(received),logs:first.logs?.slice(-6)}));
    if(!received)continue;
    const reverseA=received-1_000n;
    const full=await simulate('holder_roundtrip_'+amt,[flash(amt,undefined,HOLDER,HOLDER_USDC),
      swap(amt,false,HOLDER,HOLDER_PYUSD,HOLDER_USDC),withdraw(shares),
      swap(reverseA,true,HOLDER,HOLDER_PYUSD,HOLDER_USDC),flash(amt,0,HOLDER,HOLDER_USDC)],blockhash,HOLDER,holderTrace);
    out.push(full);
    console.log(JSON.stringify({name:full.name,err:full.err,bytes:full.bytes,accounts:full.accountCount,units:full.units,reversePyusdRaw:String(reverseA),postUser:full.post?.slice(0,3),logs:full.logs?.slice(-6)}));
  }
  const fundedTrace=[...holderTrace,USER_USDC];
  const fullHolderBase=await simulate('holder_withdraw_178000000000',[withdraw(178_000_000_000n)],blockhash,HOLDER,fundedTrace);
  out.push(fullHolderBase);
  console.log(JSON.stringify({name:fullHolderBase.name,err:fullHolderBase.err,post:fullHolderBase.post?.filter((_,i)=>i<3||i===8)}));
  for(const amt of [3_000_000_000_000n,7_000_000_000_000n]){
    const capital=2_000_000_000n,shares=178_000_000_000n;
    const fund=createTransferCheckedInstruction(USER_USDC,USDC,HOLDER_USDC,USER,capital,6);
    const first=await simulate('funded_holder_forward_'+amt,[fund,flash(amt,undefined,HOLDER,HOLDER_USDC),
      swap(amt,false,HOLDER,HOLDER_PYUSD,HOLDER_USDC),withdraw(shares),flash(amt,1,HOLDER,HOLDER_USDC)],blockhash,HOLDER,fundedTrace);
    out.push(first);
    const t=first.innerInstructions?.find(x=>x.index===2)?.instructions?.find(x=>x.parsed?.info?.mint===PYUSD.toBase58());
    const received=BigInt(t?.parsed?.info?.tokenAmount?.amount||0);
    console.log(JSON.stringify({name:first.name,err:first.err,receivedPyusdRaw:String(received),bytes:first.bytes,accounts:first.accountCount,units:first.units,logs:first.logs?.slice(-5)}));
    if(!received)continue;
    const full=await simulate('funded_holder_roundtrip_'+amt,[fund,flash(amt,undefined,HOLDER,HOLDER_USDC),
      swap(amt,false,HOLDER,HOLDER_PYUSD,HOLDER_USDC),withdraw(shares),
      swap(received-1_000n,true,HOLDER,HOLDER_PYUSD,HOLDER_USDC),flash(amt,1,HOLDER,HOLDER_USDC)],blockhash,HOLDER,fundedTrace);
    out.push(full);
    console.log(JSON.stringify({name:full.name,err:full.err,bytes:full.bytes,accounts:full.accountCount,units:full.units,post:full.post?.filter((_,i)=>i<3||i===8),logs:full.logs?.slice(-7)}));
  }
  fs.writeFileSync(home+'atomic-price-consumer-kliquidity.json',JSON.stringify({generatedAt:new Date().toISOString(),readOnly:true,sourceDepositSignature:'5eZhDBCNMubKwGHCtVFbbMPxLpZ1mvqpxdu7TTaA6TzrrqKnM76tdgrp5v8TQV4LsUsczaSFgVAMeEN4UeD5aBcG',sourceSwapSignature:'5pBesuRNYC8aXe51LmLd4LreTtjZG5EfYiLaWW8cus48rGGNRR3whAsfzh7gTBPFNz5F4LyMtRTh52NmwcBhDPt7',sourceWithdrawSignature:'2HgJjwHbskaa7FYqdmFZcDh92iKNCz7aTvrbo7Mi3o85KJmcZBLE3YohiS3rwyBZYjwp8unu6X56w7JPbUQGdL8U',reserve:KL_RES,pre,holderStart,results:out},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
