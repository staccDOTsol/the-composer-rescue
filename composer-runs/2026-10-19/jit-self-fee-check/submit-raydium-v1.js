#!/usr/bin/env node
'use strict';

// Signed, guarded Solana v1 preflight for the caller-owned Raydium CPMM JIT
// roundtrip. Broadcasting occurs only with --submit. Never log secret bytes or
// signed transaction bytes. The route builder has no signer access.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection,Keypair,TransactionMessage} = require(`${MOD}/@solana/web3.js`);
const bs58Mod = require(`${MOD}/bs58`);
const bs58 = bs58Mod.default || bs58Mod;
const {encodeV1} = require('../../2026-10-15/klend-v1-composition.js');

const WALLET = '331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth';
const MAX_SPEND_LAMPORTS = 280000000n;
const MAX_SIM_SPEND_LAMPORTS = 279000000n;
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const JUP_WSOL_VAULT = '5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr';
const KLEND_USDC_VAULT = 'UBSsE59MB1TKtADobD8spRgMGhMFoYaLDmkN3MFQmkp';
const RAYDIUM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RAYDIUM_SWAP_DISC = crypto.createHash('sha256').update('global:swap_base_input').digest().subarray(0,8);
let rpcId = 0;

function assert(ok,message) { if (!ok) throw new Error(message); }
function parseArgs(argv) {
  const args = {submit:false};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === '--submit') args.submit=true;
    else if (argv[i] === '--rpc') args.rpc=argv[++i];
    else if (argv[i] === '--loan-wsol-raw') args.loanWsolRaw=argv[++i];
    else if (argv[i] === '--loan-usdc-raw') args.loanUsdcRaw=argv[++i];
    else if (argv[i] === '--deposit-wsol-raw') args.depositWsolRaw=argv[++i];
    else if (argv[i] === '--swap-wsol-raw') args.forwardWsolRaw=argv[++i];
    else if (argv[i] === '--reverse-usdc-raw') args.reverseUsdcRaw=argv[++i];
    else if (argv[i] === '--loops') args.loops=argv[++i];
    else if (argv[i] === '--guard-ppm') args.guardPpm=argv[++i];
    else if (argv[i] === '--deposit-headroom-ppm') args.depositHeadroomPpm=argv[++i];
    else if (argv[i] === '--wrap-lamports') args.wrapLamports=argv[++i];
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}
async function rpc(url,method,params) {
  const response = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function loadWallet() {
  const parsed=JSON.parse(fs.readFileSync('/Users/stacc/hooked.json','utf8'));
  assert(Array.isArray(parsed)&&parsed.length===64&&parsed.every(x=>Number.isInteger(x)&&x>=0&&x<=255),
    'hooked.json must be a 64-byte Solana keypair array');
  const secret=Uint8Array.from(parsed);
  parsed.fill(0);
  const wallet=Keypair.fromSecretKey(secret);
  // Keypair retains this Uint8Array; clear it only after the transaction is signed.
  assert(wallet.publicKey.toBase58()===WALLET,'Unexpected wallet public key');
  return wallet;
}
function amountRaw(account) {
  if (!account) return 0n;
  assert(account.owner===TOKEN||account.owner===TOKEN_2022,'Watched token account owner changed');
  const data=Buffer.from(account.data[0],'base64');
  assert(data.length>=72,'Short token account');
  return data.readBigUInt64LE(64);
}
function accountAt(rows,i) { return rows?.[i]||null; }
function transferDelta(sim,address,beforeIx=Infinity) {
  let delta=0n;
  for(const group of sim?.innerInstructions||[]) {
    if(group.index>=beforeIx) continue;
    for(const ix of group.instructions||[]) {
    const info=ix.parsed?.info;
    if((ix.parsed?.type!=='transferChecked'&&ix.parsed?.type!=='transfer')||!info?.tokenAmount?.amount) continue;
    const amount=BigInt(info.tokenAmount.amount);
    if(info.source===address) delta-=amount;
    if(info.destination===address) delta+=amount;
    }
  }
  return delta;
}
function raydiumGrossUsdcRaw(meta,instructions,ataUsdc) {
  const swapIndexes=new Set(instructions.flatMap((ix,i)=>
    String(ix.programId)===RAYDIUM&&Buffer.from(ix.data).subarray(0,8).equals(RAYDIUM_SWAP_DISC)?[i]:[]));
  let gross=0n,seen=0;
  for(const group of meta?.innerInstructions||[]) {
    if(!swapIndexes.has(group.index)) continue;
    for(const ix of group.instructions||[]) {
      const info=ix.parsed?.info;
      if(ix.parsed?.type!=='transferChecked'||info?.mint!==USDC||
        (info.source!==String(ataUsdc)&&info.destination!==String(ataUsdc))) continue;
      gross+=BigInt(info.tokenAmount.amount);seen++;
    }
  }
  return seen?gross:null;
}
function signerList(instructions,payer,blockhash) {
  const msg=new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions}).compileToV0Message();
  return msg.staticAccountKeys.slice(0,msg.header.numRequiredSignatures).map(String);
}
async function walletTokenAddresses(url,owner,program) {
  const rows=await rpc(url,'getTokenAccountsByOwner',[String(owner),{programId:program},{encoding:'base64',commitment:'confirmed'}]);
  return rows.value.map(x=>x.pubkey);
}
async function main() {
  const args=parseArgs(process.argv.slice(2));
  const url=args.rpc||process.env.SOLANA_RPC||process.env.RPC_URL||DEFAULT_RPC;
  const wallet=loadWallet();
  const owner=wallet.publicKey;
  const genesis=await rpc(url,'getGenesisHash',[]);
  assert(genesis==='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','RPC is not Solana mainnet-beta');
  const {value:bh,context:bhContext}=await rpc(url,'getLatestBlockhash',[{commitment:'confirmed'}]);
  const {buildRoute}=require('./raydium-cpmm-route.js');
  assert(typeof buildRoute==='function','Raydium route builder unavailable');
  const wrapLamports=BigInt(args.wrapLamports??'200000000');
  assert(wrapLamports>=0n&&wrapLamports<=275000000n,
    'Wrapped SOL funding exceeds 0.275 SOL route cap');
  const connection=new Connection(url,'confirmed');
  const route=await buildRoute({connection,owner,amounts:{
    loanWsolRaw:args.loanWsolRaw,loanUsdcRaw:args.loanUsdcRaw,
    depositWsolRaw:args.depositWsolRaw,forwardWsolRaw:args.forwardWsolRaw,
    reverseUsdcRaw:args.reverseUsdcRaw,loops:args.loops,
    guardPpm:args.guardPpm,depositHeadroomPpm:args.depositHeadroomPpm,
    wrapLamports:String(wrapLamports)}});
  const instructions=route.instructions;
  assert(Array.isArray(instructions)&&instructions.length>0,'Empty route');
  const owned=new Set([...(await walletTokenAddresses(url,owner,TOKEN)),
    ...(await walletTokenAddresses(url,owner,TOKEN_2022))]);
  const allowedWalletToken=new Set([String(route.ataWsol),String(route.ataUsdc),String(route.ataLp)]);
  for (const ix of instructions) for (const meta of ix.keys) {
    const address=String(meta.pubkey);
    assert(!owned.has(address)||allowedWalletToken.has(address),`Route touches unrelated wallet token account ${address}`);
    assert(!meta.isSigner||address===WALLET,`Uncontrolled signer ${address}`);
  }
  assert(signerList(instructions,owner,bh.blockhash).join(',')===WALLET,'Unexpected v1 signer set');
  const encoded=encodeV1(instructions,owner,bh.blockhash);
  assert(encoded.requiredSignatures===1&&encoded.addressCount<=64&&encoded.sizeBytes<=4096,
    'V1 envelope exceeds supported limits');
  const wire=Buffer.from(encoded.wire);
  const key=crypto.createPrivateKey({key:Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(wallet.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  const derivedPublic=crypto.createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32);
  assert(derivedPublic.equals(owner.toBuffer()),
    `Ed25519 signing key does not match expected wallet (derived ${bs58.encode(derivedPublic)})`);
  const message=wire.subarray(0,wire.length-64);
  crypto.sign(null,message,key).copy(wire,wire.length-64);
  assert(crypto.verify(null,message,crypto.createPublicKey(key),wire.subarray(wire.length-64)),
    'Local v1 signature verification failed');
  wallet.secretKey.fill(0);
  const signature=bs58.encode(wire.subarray(wire.length-64));
  const watch=[String(owner),String(route.ataWsol),String(route.ataUsdc),String(route.ataLp),
    JUP_WSOL_VAULT,KLEND_USDC_VAULT];
  const before=await rpc(url,'getMultipleAccounts',[watch,{encoding:'base64',commitment:'confirmed'}]);
  assert(before.value[0]?.lamports>0,'Wallet has no SOL');
  assert(before.value[1]===null,'Wallet WSOL ATA already exists; route would touch existing funds');
  assert(before.value[3]===null,'Wallet LP ATA already exists; route would touch existing LP tokens');
  assert(amountRaw(before.value[2])===0n,'Wallet USDC ATA has pre-existing funds; route would touch them');
  const simulation=await rpc(url,'simulateTransaction',[wire.toString('base64'),{
    encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',
    innerInstructions:true,accounts:{encoding:'base64',addresses:watch}}]);
  const sim=simulation.value;
  assert(sim?.err===null,`Signed mainnet simulation failed: ${JSON.stringify(sim?.err)}; `+
    `pre-repay wallet USDC raw ${String(amountRaw(before.value[2])+transferDelta(sim,String(route.ataUsdc),11))}; `+
    `logs ${JSON.stringify(sim?.logs?.slice(-20))}`);
  assert(Array.isArray(sim.accounts)&&sim.accounts.length===watch.length,
    'Missing post-state account snapshots');
  const pre=before.value,post=sim.accounts;
  const preLamports=BigInt(pre[0].lamports),postLamports=BigInt(post[0].lamports);
  const solSpent=preLamports-postLamports;
  assert(solSpent>=0n&&solSpent<=MAX_SIM_SPEND_LAMPORTS,
    `Projected wallet SOL spend ${solSpent} exceeds 0.279 SOL pre-signature cap`);
  assert(solSpent+1000000n<=MAX_SPEND_LAMPORTS,'Signature-fee reserve breaches 0.28 SOL cap');
  const usdcDelta=amountRaw(accountAt(post,2))-amountRaw(accountAt(pre,2));
  assert(usdcDelta>=0n,'Route consumes existing wallet USDC');
  assert(post[1]===null||post[1].lamports===0,'WSOL ATA was not closed');
  assert(post[3]===null||post[3].lamports===0,'LP ATA was not closed');
  assert(amountRaw(accountAt(pre,4))===amountRaw(accountAt(post,4)),'Jupiter WSOL loan vault did not net to zero');
  assert(amountRaw(accountAt(pre,5))===amountRaw(accountAt(post,5)),'KLend USDC loan vault did not net to zero');
  const simulatedGrossRaw=raydiumGrossUsdcRaw(sim,instructions,route.ataUsdc);
  const summary={wallet:WALLET,slot:simulation.context.slot,blockhashSlot:bhContext.slot,
    simulationSignature:signature,grossUsd:simulatedGrossRaw===null?route.grossUsd:Number(simulatedGrossRaw)/1e6,
    grossSource:simulatedGrossRaw===null?'pool quote':'simulated SPL transfers',
    projectedSolSpentLamports:String(solSpent),projectedUsdcDeltaRaw:String(usdcDelta),
    unitsConsumed:sim.unitsConsumed,wireBytes:encoded.sizeBytes,accounts:encoded.addressCount,
    instructions:instructions.length,submitted:false};
  if (!args.submit) {console.log(JSON.stringify(summary,null,2));return;}
  console.log(JSON.stringify({...summary,submitting:true,submitted:false,
    signature,solscan:`https://solscan.io/tx/${signature}`},null,2));
  const sent=await rpc(url,'sendTransaction',[wire.toString('base64'),{
    encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:5}]);
  assert(sent===signature,'RPC returned a different transaction signature');
  summary.submitted=true;
  summary.signature=signature;
  summary.solscan=`https://solscan.io/tx/${signature}`;
  console.log(JSON.stringify(summary,null,2));
  const deadline=Date.now()+60000;
  while(Date.now()<deadline) {
    const statuses=await rpc(url,'getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
    const status=statuses.value?.[0];
    if(status?.err) throw new Error(`Submitted transaction failed: ${JSON.stringify(status.err)}; signature ${signature}`);
    if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized') {
      const detail=await rpc(url,'getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',
        maxSupportedTransactionVersion:1}]);
      if(detail) {
        assert(detail.meta?.err===null,'Confirmed transaction metadata shows failure');
        const actualGrossRaw=raydiumGrossUsdcRaw(detail.meta,instructions,route.ataUsdc);
        const accountKeys=detail.transaction.message.accountKeys.map(x=>typeof x==='string'?x:x.pubkey);
        const ownerIndex=accountKeys.indexOf(WALLET);
        const actualSolSpent=ownerIndex<0?null:
          BigInt(detail.meta.preBalances[ownerIndex])-BigInt(detail.meta.postBalances[ownerIndex]);
        console.log(JSON.stringify({signature,confirmed:true,slot:detail.slot,
          actualGrossUsd:actualGrossRaw===null?null:Number(actualGrossRaw)/1e6,
          actualSolSpentLamports:actualSolSpent===null?null:String(actualSolSpent),
          solscan:`https://solscan.io/tx/${signature}`},null,2));
        return;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error(`Submitted transaction details not yet available; check ${summary.solscan}`);
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
