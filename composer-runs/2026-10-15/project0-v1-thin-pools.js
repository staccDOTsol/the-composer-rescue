#!/usr/bin/env node
// Current mainnet read-only Solana v1 simulations; no signing or submission.
const fs = require('fs');
const Module = require('module');
process.env.NODE_PATH = ['/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules', process.env.NODE_PATH||''].filter(Boolean).join(':');
Module._initPaths();
const {Connection,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction}=require('@solana/web3.js');
const {createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,getAssociatedTokenAddressSync}=require('@solana/spl-token');
const B=require('bs58'); const bs58=B.default||B;
const L=require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/repos/defillama-adapters/projects/helper/utils/solana/layouts/raydium-layout.js');
const READ_RPC=process.env.READ_RPC_URL||'https://api.mainnet-beta.solana.com';
const SIM_RPC=process.env.HEAVY_RPC_URL||process.env.RPC_URL;
if(!SIM_RPC)throw Error('HEAVY_RPC_URL or RPC_URL required');
const P0=new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const CPMM=new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const WSOL=new PublicKey('So11111111111111111111111111111111111111112');
const SOURCE='2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const DISC={start:'0e8321dc51bab46b',end:'697cc96a9902089c',borrow:'047e74353005d41f',repay:'4fd1acb1de33ad97',swap:'8fbe5adac41e33de'};
const CANDIDATES=[
 {pool:'23C8LwwGWtg4TcnG1tj42pC6Tq6qwMuAFZbCrT4Zahhh',apiPage:350},
 {pool:'AJUTQY17wZHv9sYJAw7FtU4DB7aMP4TYJUqkFfUXZjz2',apiPage:800},
 {pool:'C4PfFwR6pDjQ5DfZwAeptrZuwBzJeqQaz8Syq15HDcSW',apiPage:800},
 {pool:'Hx6EoXCzvYzcdtTvEm2QsXUFVe9pJzhH9FuMxmLw589D',apiPage:'WSOL/USDC ascending liquidity'},
 {pool:'EVbfagf5FXQta7z3774WgXRVqSKttL2CNzitv7gY4SQN',apiPage:'WSOL/USDC ascending liquidity'},
];
const conn=new Connection(READ_RPC,'confirmed');let rpcId=0;
const sleep=n=>new Promise(r=>setTimeout(r,n));
async function rpc(url,method,params){for(let k=0;k<5;k++){try{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j.result}catch(e){if(k===4)throw Error(`${method}: ${e}`);await sleep(300*2**k)}}}
function clone(ix){return new TransactionInstruction({programId:ix.programId,keys:ix.keys.map(k=>({...k})),data:Buffer.from(ix.data)})}
function find(ixs,name){return clone(ixs.find(x=>x.programId.equals(P0)&&Buffer.from(x.data).subarray(0,8).toString('hex')===DISC[name]))}
async function source(){const t=await rpc(READ_RPC,'getTransaction',[SOURCE,{encoding:'base64',maxSupportedTransactionVersion:1}]);if(!t)throw Error('P0 source unavailable');const wire=VersionedTransaction.deserialize(Buffer.from(t.transaction[0],'base64'));const alts=await Promise.all((wire.message.addressTableLookups||[]).map(async x=>(await conn.getAddressLookupTable(x.accountKey)).value));return{slot:t.slot,message:TransactionMessage.decompile(wire.message,{addressLookupTableAccounts:alts})}}
function serialize(payer,hash,instructions){const m=new TransactionMessage({payerKey:payer,recentBlockhash:hash,instructions}).compileToV0Message([]);const h=m.header,k=m.staticAccountKeys,c=m.compiledInstructions;if(k.length>64)throw Error('>64 keys');const ch=Buffer.alloc(4),cfg=Buffer.alloc(8);ch.writeUInt32LE(12);cfg.writeUInt32LE(1400000);cfg.writeUInt32LE(67108864,4);const heads=[],payload=[];for(const x of c){const v=Buffer.alloc(4);v[0]=x.programIdIndex;v[1]=x.accountKeyIndexes.length;v.writeUInt16LE(x.data.length,2);heads.push(v);payload.push(Buffer.from(x.accountKeyIndexes),Buffer.from(x.data))}const w=Buffer.concat([Buffer.from([0x81,h.numRequiredSignatures,h.numReadonlySignedAccounts,h.numReadonlyUnsignedAccounts]),ch,Buffer.from(bs58.decode(hash)),Buffer.from([c.length,k.length]),...k.map(x=>x.toBuffer()),cfg,...heads,...payload,Buffer.alloc(64*h.numRequiredSignatures)]);if(w.length>4096)throw Error(`>4096 bytes ${w.length}`);return{wire:w,bytes:w.length,keys:k.length,ixs:c.length,signatures:h.numRequiredSignatures}}
function tokenAmount(a){if(!a)return null;const b=Buffer.from(a.data[0],'base64');return b.length>=72?b.readBigUInt64LE(64):null}
function mintSupply(a){if(!a)return null;const b=Buffer.from(a.data[0],'base64');return b.length>=44?b.readBigUInt64LE(36):null}
function poolState(a){return L.parseRaydiumCpSwapPoolState({data:Buffer.from(a.data[0],'base64')})}
function ps(s){return{ammConfig:String(s.ammConfig),mint0:String(s.token0Mint),mint1:String(s.token1Mint),vault0:String(s.token0Vault),vault1:String(s.token1Vault),tokenProgram0:String(s.token0Program),tokenProgram1:String(s.token1Program),observation:String(s.observationKey),lpMint:String(s.lpMint),lpSupply:s.lpSupply.toString(),protocolFees0:s.protocolFeesToken0.toString(),protocolFees1:s.protocolFeesToken1.toString(),fundFees0:s.fundFeesToken0.toString(),fundFees1:s.fundFeesToken1.toString(),openTime:s.openTime.toString(),status:s.status}}
function poolSwap(state,pool,owner,ataW,ataX,amount,reverse=false){const p=new PublicKey(pool);const d=Buffer.from(DISC.swap,'hex');const data=Buffer.alloc(24);d.copy(data);data.writeBigUInt64LE(amount,8);const w0=String(state.token0Mint)===String(WSOL);const inputMint=reverse?(w0?state.token1Mint:state.token0Mint):WSOL;const outputMint=reverse?WSOL:(w0?state.token1Mint:state.token0Mint);const inputVault=reverse?(w0?state.token1Vault:state.token0Vault):(w0?state.token0Vault:state.token1Vault);const outputVault=reverse?(w0?state.token0Vault:state.token1Vault):(w0?state.token1Vault:state.token0Vault);const inputProg=reverse?(w0?state.token1Program:state.token0Program):(w0?state.token0Program:state.token1Program);const outputProg=reverse?(w0?state.token0Program:state.token1Program):(w0?state.token1Program:state.token0Program);const [auth]=PublicKey.findProgramAddressSync([Buffer.from('vault_and_lp_mint_auth_seed')],CPMM);const keys=[
 [owner,true,true],[auth,false,false],[state.ammConfig,false,false],[p,false,true],
 [reverse?ataX:ataW,false,true],[reverse?ataW:ataX,false,true],[inputVault,false,true],[outputVault,false,true],
 [inputProg,false,false],[outputProg,false,false],[inputMint,false,false],[outputMint,false,false],[state.observationKey,false,true]
 ].map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable}));return new TransactionInstruction({programId:CPMM,keys,data})}
function lpAction(state,pool,owner,ataW,ataX,ataLp,amount,withdraw=false){
  const [auth]=PublicKey.findProgramAddressSync([Buffer.from('vault_and_lp_mint_auth_seed')],CPMM);
  const token=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const token22=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const memo=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const keys=[[owner,true,true],[auth,false,false],[new PublicKey(pool),false,true],[ataLp,false,true],[ataW,false,true],[ataX,false,true],[state.token0Vault,false,true],[state.token1Vault,false,true],[token,false,false],[token22,false,false],[state.token0Mint,false,false],[state.token1Mint,false,false],[state.lpMint,false,true],...(withdraw?[[memo,false,false]]:[])].map(([pubkey,isSigner,isWritable])=>({pubkey,isSigner,isWritable}));
  const data=Buffer.alloc(32);Buffer.from(withdraw?'b712469c946da122':'f223c68952e1f2b6','hex').copy(data);data.writeBigUInt64LE(amount,8);if(!withdraw){data.writeBigUInt64LE(1000000000000n,16);data.writeBigUInt64LE(1000000000000n,24)}
  return new TransactionInstruction({programId:CPMM,keys,data});
}
async function read(keys,commitment='confirmed'){const r=await rpc(SIM_RPC,'getMultipleAccounts',[keys.map(String),{encoding:'base64',commitment}]);return{slot:r.context.slot,values:r.value}}
async function simulate(name,payer,ixs,keys){const h=(await rpc(SIM_RPC,'getLatestBlockhash',[{commitment:'finalized'}])).value.blockhash;const w=serialize(payer,h,ixs);const r=await rpc(SIM_RPC,'simulateTransaction',[w.wire.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'finalized',innerInstructions:true,accounts:{encoding:'base64',addresses:keys.map(String)}}]);const v=r.value;const transfers=(v.innerInstructions||[]).flatMap(z=>z.instructions||[]).filter(x=>x.parsed?.type==='transfer'||x.parsed?.type==='transferChecked').map(x=>({source:x.parsed.info.source,destination:x.parsed.info.destination,amount:x.parsed.info.amount||x.parsed.info.tokenAmount?.amount,mint:x.parsed.info.mint||null}));return{name,slot:r.context.slot,bytes:w.bytes,accounts:w.keys,instructions:w.ixs,signatures:w.signatures,cuLimit:1400000,dataLimit:67108864,units:v.unitsConsumed,err:v.err,tail:v.logs?.filter(x=>/Instruction:|Error|failed|Program return/.test(x)).slice(-8),transfers,post:v.accounts?.map((a,i)=>({key:String(keys[i]),rawToken:tokenAmount(a)?.toString()||null,mintSupply:mintSupply(a)?.toString()||null,pool:a&&String(keys[i])===String(keys[5])?ps(poolState(a)):null}))}}
async function main(){const src=await source(),payer=src.message.payerKey;const ixs=src.message.instructions;const start=find(ixs,'start'),end=find(ixs,'end'),borrow=find(ixs,'borrow'),repay=find(ixs,'repay');const owner=borrow.keys[2].pubkey;const ataW=getAssociatedTokenAddressSync(WSOL,owner);borrow.keys[4].pubkey=ataW;repay.keys[4].pubkey=ataW;const createW=createAssociatedTokenAccountIdempotentInstruction(payer,ataW,owner,WSOL);const seed=SystemProgram.transfer({fromPubkey:owner,toPubkey:ataW,lamports:2000000});const sync=createSyncNativeInstruction(ataW);const sequence=(parts)=>{const z=[clone(start),clone(createW),clone(seed),clone(sync),...parts.map(clone),clone(end)];z[0].data.writeBigUInt64LE(BigInt(z.length-1),8);return z};const amountIx=(ix,n)=>{const x=clone(ix);x.data.writeBigUInt64LE(n,8);return x};const output={generatedAt:new Date().toISOString(),readSource:'Solana public RPC',simulationSource:'configured mainnet RPC',sourceSignature:SOURCE,sourceSlot:src.slot,authority:String(owner),walletWsol:String(ataW),pools:[]};
 for(const c of CANDIDATES.filter(x=>!process.env.ONLY_POOL||x.pool===process.env.ONLY_POOL)){const stateResult=await read([c.pool]);if(!stateResult.values[0]){output.pools.push({pool:c.pool,error:'missing state'});continue}const state=poolState(stateResult.values[0]);const xMint=String(state.token0Mint)===String(WSOL)?state.token1Mint:state.token0Mint;const xProg=String(state.token0Mint)===String(WSOL)?state.token1Program:state.token0Program;const ataX=getAssociatedTokenAddressSync(xMint,owner,false,xProg);const createX=createAssociatedTokenAccountIdempotentInstruction(payer,ataX,owner,xMint,xProg);const keys=[ataW,ataX,borrow.keys[6].pubkey,state.token0Vault,state.token1Vault,new PublicKey(c.pool),state.lpMint];const before=await read(keys,'finalized');const rec={pool:c.pool,apiPage:c.apiPage,stateOwner:stateResult.values[0].owner,poolState:ps(state),preSlot:before.slot,pre:before.values.map((a,i)=>({key:String(keys[i]),rawToken:tokenAmount(a)?.toString()||null,mintSupply:mintSupply(a)?.toString()||null})),cases:[]};output.pools.push(rec);const forward=n=>poolSwap(state,c.pool,owner,ataW,ataX,n);const reverse=n=>poolSwap(state,c.pool,owner,ataW,ataX,n,true);
  if(process.env.LP_CYCLE){
    const lpInfo=await read([state.lpMint],'finalized');const lpProg=new PublicKey(lpInfo.values[0].owner);const ataLp=getAssociatedTokenAddressSync(state.lpMint,owner,false,lpProg);const createLp=createAssociatedTokenAccountIdempotentInstruction(payer,ataLp,owner,state.lpMint,lpProg);const lpKeys=[...keys,ataLp];const n=100000n,lp=100n;
    const buy=forward(n),add=lpAction(state,c.pool,owner,ataW,ataX,ataLp,lp),remove=lpAction(state,c.pool,owner,ataW,ataX,ataLp,lp,true);
    for(const [name,middle] of [['swap_deposit_repay',[buy,add]],['swap_deposit_withdraw_repay',[buy,add,remove]],['deposit_without_usdc_control',[add]]]){
      const z=sequence([createX,createLp,amountIx(borrow,n),...middle,amountIx(repay,n)]);const t=await simulate(name,payer,z,lpKeys);rec.cases.push(t);console.log(c.pool,t.name,JSON.stringify(t.err),t.bytes,t.units)}
  }
  for(const n of ((process.env.REPEATS_ONLY||process.env.LP_CYCLE)?[]:[1n,2n,3n,4n,10n,50n,51n,100n,400n,401n,1000n,10000n,100000n,1000000n])){const z=sequence([createX,amountIx(borrow,n),forward(n),amountIx(repay,n)]);const t=await simulate(`forward_repay_${n}`,payer,z,keys);rec.cases.push(t);console.log(c.pool,t.name,JSON.stringify(t.err),t.bytes,t.units)}
  for(const n of [1000n,100000n,1000000n]){const f=rec.cases.find(x=>x.name===`forward_repay_${n}`);if(!f||f.err)continue;const out=BigInt(f.post[1].rawToken||'0');if(out===0n)continue;const revAmount=out*99n/100n;if(!revAmount)continue;const z=sequence([createX,amountIx(borrow,n),forward(n),reverse(revAmount),amountIx(repay,n)]);const t=await simulate(`roundtrip_repay_${n}_reverse_${revAmount}`,payer,z,keys);rec.cases.push(t);console.log(c.pool,t.name,JSON.stringify(t.err),t.bytes,t.units)}
  if(process.env.REPEATS_ONLY){
    for(const n of [2n,400n,401n]){
      const one=await simulate(`forward_repay_${n}`,payer,sequence([createX,amountIx(borrow,n),forward(n),amountIx(repay,n)]),keys);
      rec.cases.push(one);
      if(!one.err){const received=BigInt(one.post[1].rawToken);const z=sequence([createX,amountIx(borrow,n),forward(n),reverse(received),amountIx(repay,n)]);rec.cases.push(await simulate(`full_reverse_${n}_x_${received}`,payer,z,keys));}
    }
    const twice=await simulate('two_forward_2_repay_4',payer,sequence([createX,amountIx(borrow,4n),forward(2n),forward(2n),amountIx(repay,4n)]),keys);rec.cases.push(twice);
    if(!twice.err){const received=BigInt(twice.post[1].rawToken);rec.cases.push(await simulate(`two_forward_2_reverse_${received}_repay_4`,payer,sequence([createX,amountIx(borrow,4n),forward(2n),forward(2n),reverse(received),amountIx(repay,4n)]),keys));}
    for(let count of [3,5,10]){const steps=[];for(let i=0;i<count;i++)steps.push(forward(2n));rec.cases.push(await simulate(`repeat_${count}_forwards_2_repay_${2*count}`,payer,sequence([createX,amountIx(borrow,BigInt(2*count)),...steps,amountIx(repay,BigInt(2*count))]),keys));}
  }
  rec.postPriceNote='Quote quality to be evaluated from other on-chain pools; no profit inference from single-pool marginal price.';fs.writeFileSync(__dirname+'/'+(process.env.THIN_OUTPUT||(process.env.REPEATS_ONLY?'project0-v1-thin-pool-repeats.json':'project0-v1-thin-pools.json')),JSON.stringify(output,null,2)+'\n');
 }
 console.log(JSON.stringify({output:__dirname+'/'+(process.env.THIN_OUTPUT||(process.env.REPEATS_ONLY?'project0-v1-thin-pool-repeats.json':'project0-v1-thin-pools.json')),pools:output.pools.map(x=>({pool:x.pool,preSlot:x.preSlot,cases:x.cases?.length,successes:x.cases?.filter(y=>!y.err).map(y=>y.name)}))},null,2))}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
