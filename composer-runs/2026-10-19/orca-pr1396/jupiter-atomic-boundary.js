#!/usr/bin/env node
'use strict';

// Atomic WSOL→USDC Whirlpool boundary, independent Jupiter Router return,
// and zero-fee KLend+Project0 flash repayment. Local Surfpool fork only.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} =
  require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID} = require(`${MOD}/@solana/spl-token`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc} =
  require('./real-flash-envelope.js');
const boundary = require('./one-sided-boundary.js');
const fullBoundary = require('./full-one-sided-boundary.js');

const FORK = process.env.ORCA_JUPITER_ATOMIC_FORK || 'http://127.0.0.1:65331';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('Local fork only');
const SCOPE = process.env.ORCA_JUPITER_ATOMIC_SCOPE || 'partial';
if (!['partial','full'].includes(SCOPE))throw new Error('Invalid scope');
const FULL = SCOPE === 'full';
const QUOTE_FILE = path.join(__dirname, FULL
  ? 'jupiter-router-v2-full-exact-raydium.json'
  : 'jupiter-router-v2-boundary-exact.json');
const OUT = path.join(__dirname, FULL
  ? 'jupiter-atomic-full-boundary.json' : 'jupiter-atomic-boundary.json');
const TARGET = boundary.POOL.toBase58();
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const ACTOR_SEED = 'orca-pr1396-jupiter-atomic-test-v1';
const EXPECTED_USDC = FULL ? '9375321549' : '15568208';
const INITIAL_WS0L = FULL ? 260_000_000_000n : 200_000_000n;
const FLASH_AMOUNTS = FULL
  ? {klend:300_000_000_000n,project0:50_000_000_000n}
  : {klend:200_000_000n,project0:100_000_000n};
const margin = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-jupiter-atomic-margin-v1').digest());

function fromJson(row) {
  return new TransactionInstruction({programId:new PublicKey(row.programId),
    keys:row.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),
      isSigner:a.isSigner,isWritable:a.isWritable})),
    data:Buffer.from(row.data,'base64')});
}

function verifiedRouterBuild() {
  const build = JSON.parse(fs.readFileSync(QUOTE_FILE,'utf8'));
  if (build.error || build.transactionVersion !== 1 ||
      build.inAmount !== EXPECTED_USDC ||
      build.inputMint !== boundary.USDC.toBase58() ||
      build.outputMint !== boundary.WSOL.toBase58() ||
      Object.keys(build.addressesByLookupTableAddress || {}).length !== 0 ||
      build.routePlan?.length !== 1 ||
      build.routePlan[0].swapInfo.label !== (FULL ? 'Raydium' : 'Kipseli') ||
      build.routePlan[0].swapInfo.ammKey === TARGET ||
      build.swapInstruction?.programId !== JUPITER ||
      !build.swapInstruction.accounts.some(a=>
        a.pubkey === boundary.actor.publicKey.toBase58() && a.isSigner) ||
      !build.swapInstruction.accounts.some(a=>a.pubkey === boundary.ataA.toBase58()) ||
      !build.swapInstruction.accounts.some(a=>a.pubkey === boundary.ataB.toBase58()))
    throw new Error('Router build does not match exact independent v1 route');
  return build;
}

async function account(pubkey) {
  return (await rpc(FORK,'getAccountInfo',[pubkey.toBase58(),
    {encoding:'base64',commitment:'processed'}])).value;
}
async function set(pubkey, source, amount, native) {
  const image = await account(source);
  if (!image || image.owner !== TOKEN_PROGRAM_ID.toBase58())
    throw new Error(`Missing SPL Token template ${source}`);
  const data = Buffer.from(image.data[0],'base64');
  boundary.actor.publicKey.toBuffer().copy(data,32);
  data.writeBigUInt64LE(BigInt(amount),64);
  let lamports = image.lamports;
  if (native) {
    if (data.readUInt32LE(109) !== 1)
      throw new Error('WSOL template is not native');
    lamports = Number(BigInt(amount) + data.readBigUInt64LE(113));
  }
  await rpc(FORK,'surfnet_setAccount',[pubkey.toBase58(),{
    data:data.toString('hex'),executable:false,lamports,
    owner:image.owner,rentEpoch:0}]);
}
function amount(row) {
  return row && row.data ? String(Buffer.from(row.data[0],'base64').readBigUInt64LE(64)) : null;
}
async function image() {
  const keys=[boundary.POOL,boundary.VAULT_A,boundary.VAULT_B,
    boundary.ataA,boundary.ataB];
  const rows=(await rpc(FORK,'getMultipleAccounts',[keys.map(String),
    {encoding:'base64',commitment:'processed'}])).value;
  const pool=Buffer.from(rows[0].data[0],'base64');
  const u128=(o)=>String(pool.readBigUInt64LE(o) +
    (pool.readBigUInt64LE(o+8)<<64n));
  return {pool:{liquidity:u128(49),tick:pool.readInt32LE(81),
    sqrtPriceX64:u128(65)},vaultA:amount(rows[1]),vaultB:amount(rows[2]),
    actorWsol:amount(rows[3]),actorUsdc:amount(rows[4])};
}

async function main() {
  if ((await rpc(FORK,'getGenesisHash')) !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not mainnet genesis');
  const build=verifiedRouterBuild();
  const quoteMtime=fs.statSync(QUOTE_FILE).mtime.toISOString();
  // Prepare actor capital covering the measured Jupiter return shortfall.
  // This is declared pre-existing fork-only capital, never flash proceeds.
  await rpc(FORK,'surfnet_setAccount',[boundary.actor.publicKey.toBase58(),{
    data:'',executable:false,lamports:5_000_000_000,
    owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  await set(boundary.ataA,boundary.VAULT_A,INITIAL_WS0L,true);
  await set(boundary.ataB,boundary.VAULT_B,0n,false);
  const start=await image();
  if (start.pool.liquidity==='0' || start.actorWsol!==String(INITIAL_WS0L) ||
      start.actorUsdc!=='0') throw new Error('Unexpected initial fork state');
  const slot=await rpc(FORK,'getSlot',[{commitment:'processed'}]);
  const bh=(await rpc(FORK,'getLatestBlockhash',
    [{commitment:'processed'}])).value.blockhash;
  const router=fromJson(build.swapInstruction);
  const poolSwaps=FULL ? fullBoundary.targets.map((_,i)=>fullBoundary.swap(i))
    : [boundary.swap(true),boundary.swap(false)];
  const envelope=buildFlashEnvelope({actor:boundary.actor,marginAccount:margin,
    payloadInstructions:[...poolSwaps,router],
    blockhash:bh,providers:['klend','project0'],
    amounts:FLASH_AMOUNTS,
    initializeMargin:true,createWsolAta:false,computeLimit:1_400_000});
  const simulation=await simulateFlashEnvelope(FORK,envelope,
    [boundary.POOL,boundary.VAULT_A,boundary.VAULT_B,
      boundary.ataA,boundary.ataB]);
  const output={schema:'orca-jupiter-atomic-boundary/v1',scope:SCOPE,fork:FORK,
    mainnetSubmission:false,actor:boundary.actor.publicKey.toBase58(),
    actorSeed:ACTOR_SEED,pool:TARGET,slot,quoteMtime,
    quote:{inAmount:build.inAmount,outAmount:build.outAmount,
      otherAmountThreshold:build.otherAmountThreshold,
      routePlan:build.routePlan,transactionVersion:build.transactionVersion,
      routeRestriction:FULL ? {dexes:['Raydium']} :
        {excludedDexes:['Whirlpool','Orca V2']},
      routerProgram:build.swapInstruction.programId,
      routerAccounts:build.swapInstruction.accounts.length,
      routerDataBytes:router.data.length},
    initialActorWsolRaw:String(INITIAL_WS0L),
    flashRaw:{klend:String(FLASH_AMOUNTS.klend),
      project0:String(FLASH_AMOUNTS.project0),fees:'0'},
    before:start,wire:envelope.stats,indexes:envelope.index,
    instructionPrograms:envelope.instructions.map(ix=>ix.programId.toBase58()),
    simulation:{err:simulation.err,unitsConsumed:simulation.unitsConsumed,
      completeRepayment:simulation.completeRepayment,
      lenderVaultDeltas:simulation.lenderVaultDeltas,
      logs:simulation.logs,
      afterActorWsol:amount(simulation.afterAccounts[
        simulation.watched.indexOf(boundary.ataA.toBase58())]),
      afterActorUsdc:amount(simulation.afterAccounts[
        simulation.watched.indexOf(boundary.ataB.toBase58())])}};
  fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
  if (!simulation.err && simulation.completeRepayment) {
    // Surfpool sendTransaction needs accounts materialized in its ledger,
    // including genuinely absent optional accounts. Only seed null reads.
    const programs=new Set(envelope.instructions.map(ix=>ix.programId.toBase58()));
    const keys=[...new Set(envelope.instructions.flatMap(ix=>
      ix.keys.map(k=>k.pubkey.toBase58())))];
    output.seededAbsentAccounts=[];
    for(const address of keys){
      if(programs.has(address))continue;
      const row=(await rpc(FORK,'getAccountInfo',[address,
        {encoding:'base64',commitment:'processed'}])).value;
      if(row)continue;
      await rpc(FORK,'surfnet_setAccount',[address,{
        data:'',executable:false,lamports:0,
        owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
      output.seededAbsentAccounts.push(address);
    }
    fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
    try {
      const signature=await rpc(FORK,'sendTransaction',[
        envelope.wire.toString('base64'),
        {encoding:'base64',skipPreflight:true,
          preflightCommitment:'processed'}]);
      let tx=null;
      for(let i=0;i<20;i++){
        tx=await rpc(FORK,'getTransaction',[signature,
          {encoding:'json',commitment:'processed',
            maxSupportedTransactionVersion:1}]);
        if(tx)break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      output.localSend={signature,transactionVersion:tx?.version ?? null,
        err:tx ? tx.meta.err : 'missing receipt',slot:tx?.slot ?? null,
        computeUnitsConsumed:tx?.meta?.computeUnitsConsumed ?? null,
        feeLamports:tx?.meta?.fee ?? null,
        logs:tx?.meta?.logMessages ?? []};
      output.after=await image();
    }catch(error){
      output.localSend={err:String(error).replace(/api-key=[^&\s]+/g,
        'api-key=[REDACTED]')};
    }
  }
  fs.writeFileSync(OUT,JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({out:OUT,slot,quote:output.quote,
    wire:output.wire,simulation:output.simulation,
    localSend:output.localSend ? {
      signature:output.localSend.signature,err:output.localSend.err,
      units:output.localSend.computeUnitsConsumed}:null,
    before:output.before,after:output.after}));
}
if(require.main===module)main().catch(e=>{
  console.error(String(e.stack||e).replace(/api-key=[^&\s]+/g,'api-key=[REDACTED]'));
  process.exitCode=1;
});
