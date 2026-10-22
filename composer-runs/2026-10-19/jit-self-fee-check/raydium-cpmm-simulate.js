#!/usr/bin/env node
'use strict';

// Fork-only simulation. Never signs or submits a mainnet transaction.
const fs=require('fs');
const path=require('path');
const MOD='/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {Connection,Keypair}=require(`${MOD}/@solana/web3.js`);
const {encodeV1}=require('../../2026-10-15/klend-v1-composition.js');
const {buildRoute}=require('./raydium-cpmm-route.js');
const FORK=process.env.FORK_RPC||'http://127.0.0.1:9033';
let rpcId=0;
async function rpc(method,params) {
  const response=await fetch(FORK,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
  const result=await response.json();
  if(result.error) throw new Error(`${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}
async function main() {
  const owner=Keypair.generate();
  const connection=new Connection(FORK,'confirmed');
  const amounts={loanWsolRaw:process.env.LOAN_WSOL_RAW,
    loanUsdcRaw:process.env.LOAN_USDC_RAW,
    depositWsolRaw:process.env.DEPOSIT_WSOL_RAW,
    forwardWsolRaw:process.env.FORWARD_WSOL_RAW,
    reverseUsdcRaw:process.env.REVERSE_USDC_RAW,
    loops:process.env.LOOPS,
    wrapLamports:process.env.WRAP_LAMPORTS,
    guardPpm:process.env.GUARD_PPM};
  Object.keys(amounts).forEach(k=>amounts[k]===undefined&&delete amounts[k]);
  const route=await buildRoute({connection,owner:owner.publicKey,amounts});
  const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded=encodeV1(route.instructions,owner.publicKey,blockhash);
  const construction={observedAt:new Date().toISOString(),readOnly:true,submitted:false,
    owner:owner.publicKey.toBase58(),pool:route.pool.toBase58(),
    route:{loanWsolRaw:String(route.loanWsolRaw),loanUsdcRaw:String(route.loanUsdcRaw),
      depositWsolRaw:String(route.depositWsolRaw),depositUsdcRaw:String(route.depositUsdcRaw),
      lpAmount:String(route.lpAmount),ataExisted:route.ataExisted,quotes:route.quotes,
      poolSnapshot:route.poolSnapshot,expectedWithdrawal:route.expectedWithdrawal,
      depositMaximum:route.depositMaximum,expectedBeforeTopup:route.expectedBeforeTopup,
      topup:route.topup,grossUsd:route.grossUsd},
    wire:{bytes:encoded.sizeBytes,accounts:encoded.addressCount,instructions:route.instructions.length,
      requiredSignatures:encoded.requiredSignatures},
    instructionBreakdown:route.instructions.map((ix,i)=>({i,program:ix.programId.toBase58(),
      keys:ix.keys.length,dataBytes:ix.data.length}))};
  fs.writeFileSync(path.join(__dirname,'raydium-cpmm-construction.json'),JSON.stringify(construction,null,2));
  console.log(JSON.stringify({construction:{wire:construction.wire,route:construction.route}},null,2));
  await rpc('requestAirdrop',[owner.publicKey.toBase58(),10_000_000_000]);
  const watched=[owner.publicKey,route.ataWsol,route.ataUsdc,route.ataLp,
    route.poolVaultWsol,route.poolVaultUsdc,route.jupVaultWsol,route.klendVaultUsdc];
  const before=await rpc('getMultipleAccounts',[watched.map(x=>x.toBase58()),
    {encoding:'base64',commitment:'processed'}]);
  const simulation=await rpc('simulateTransaction',[encoded.wire.toString('base64'),{
    encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed',
    innerInstructions:true,accounts:{encoding:'base64',addresses:watched.map(x=>x.toBase58())}}]);
  const rawAmount=a=>a&&a.data&&a.owner==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'?
    Buffer.from(a.data[0],'base64').readBigUInt64LE(64).toString():null;
  const balances=watched.map((x,i)=>({address:x.toBase58(),
    before:{lamports:before.value[i]?.lamports??0,rawAmount:rawAmount(before.value[i])},
    after:{lamports:simulation.value.accounts?.[i]?.lamports??0,
      rawAmount:rawAmount(simulation.value.accounts?.[i])}}));
  const output={...construction,simulation:{slot:simulation.context.slot,err:simulation.value.err,
    unitsConsumed:simulation.value.unitsConsumed,logs:simulation.value.logs,
    innerInstructions:simulation.value.innerInstructions,balances}};
  fs.writeFileSync(path.join(__dirname,'raydium-cpmm-simulation.json'),JSON.stringify(output,null,2));
  console.log(JSON.stringify({simulation:{slot:output.simulation.slot,err:output.simulation.err,
    unitsConsumed:output.simulation.unitsConsumed,
    logsTail:output.simulation.logs?.slice(-20),balances}},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
