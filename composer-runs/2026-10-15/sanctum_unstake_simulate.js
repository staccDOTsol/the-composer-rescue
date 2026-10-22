#!/usr/bin/env node
/* Read-only current-state Sanctum Unstake simulations. Never sends a transaction. */

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, Keypair, SystemProgram, StakeProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, ComputeBudgetProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC = process.env.HEAVY_RPC_URL || process.env.RPC_URL;
if (!RPC) throw new Error('RPC_URL/HEAVY_RPC_URL is not set');
const connection = new Connection(RPC, 'confirmed');
const DIR = __dirname;
const custody = JSON.parse(fs.readFileSync(`${DIR}/sanctum-unstake-custody-live.json`, 'utf8'));
const history = JSON.parse(fs.readFileSync(`${DIR}/sanctum-unstake-history.json`, 'utf8'));
const poolRow = custody.pools[0];

const PROGRAM = new PublicKey('unpXTU2Ndrc7WWNyEhQWe4udTzSibLPi25SXv2xbCHQ');
const POOL = new PublicKey(poolRow.pool);
const RESERVE = new PublicKey(poolRow.reserve);
const LP_MINT = new PublicKey(poolRow.lpMint);
const FEE = new PublicKey(poolRow.feeAccount);
const FLASH = new PublicKey(poolRow.flashAccount);
const FLASH_FEE = new PublicKey(poolRow.flashLoanFeeAccount);
const PROTOCOL_FEE = PublicKey.findProgramAddressSync([Buffer.from('protocol-fee')], PROGRAM)[0];
const CLOCK = new PublicKey('SysvarC1ock11111111111111111111111111111111');
const STAKE_HISTORY = new PublicKey('SysvarStakeHistory1111111111111111111111111');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const LP_TOKEN = new PublicKey('k5hQmYM3ALoB7NSQjx4E9R2zFZEXjnPB6f1mvAbEjzP');
const LP_OWNER = new PublicKey('Hx8vjCsqxWxnu95Yhx98TX4MQo9ig1QVnVuubrcgPpv3');

function disc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

function ix(programId, keys, data) {
  return new TransactionInstruction({programId, keys, data});
}

function addLiquidity(amount) {
  return ix(PROGRAM, [
    {pubkey: LP_OWNER, isSigner: true, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: LP_MINT, isSigner: false, isWritable: true},
    {pubkey: LP_TOKEN, isSigner: false, isWritable: true},
    {pubkey: FLASH, isSigner: false, isWritable: true},
    {pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], Buffer.concat([disc('add_liquidity'), u64(amount)]));
}

function removeLiquidity(amount, authority = LP_OWNER, to = LP_OWNER, reserve = RESERVE) {
  return ix(PROGRAM, [
    {pubkey: authority, isSigner: true, isWritable: false},
    {pubkey: to, isSigner: false, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: reserve, isSigner: false, isWritable: true},
    {pubkey: LP_MINT, isSigner: false, isWritable: true},
    {pubkey: LP_TOKEN, isSigner: false, isWritable: true},
    {pubkey: FLASH, isSigner: false, isWritable: true},
    {pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], Buffer.concat([disc('remove_liquidity'), u64(amount)]));
}

function reclaim(stake, record) {
  return ix(PROGRAM, [
    {pubkey: stake, isSigner: false, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: record, isSigner: false, isWritable: true},
    {pubkey: CLOCK, isSigner: false, isWritable: false},
    {pubkey: STAKE_HISTORY, isSigner: false, isWritable: false},
    {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
  ], disc('reclaim_stake_account'));
}

function takeFlashLoan(amount, receiver = LP_OWNER) {
  return ix(PROGRAM, [
    {pubkey: receiver, isSigner: false, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: false},
    {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: FLASH, isSigner: false, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false},
  ], Buffer.concat([disc('take_flash_loan'), u64(amount)]));
}

function repayFlashLoan(repayer = LP_OWNER) {
  return ix(PROGRAM, [
    {pubkey: repayer, isSigner: true, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: false},
    {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: FLASH, isSigner: false, isWritable: true},
    {pubkey: FLASH_FEE, isSigner: false, isWritable: false},
    {pubkey: PROTOCOL_FEE, isSigner: false, isWritable: false},
    {pubkey: protocolFeeDestinationForInstruction, isSigner: false, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], disc('repay_flash_loan'));
}

let protocolFeeDestinationForInstruction;

function unstake(stake, record, unstaker, destination, protocolDestination, reserve = RESERVE) {
  return ix(PROGRAM, [
    {pubkey: unstaker, isSigner: true, isWritable: false},
    {pubkey: stake, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: reserve, isSigner: false, isWritable: true},
    {pubkey: FEE, isSigner: false, isWritable: false},
    {pubkey: record, isSigner: false, isWritable: true},
    {pubkey: PROTOCOL_FEE, isSigner: false, isWritable: false},
    {pubkey: protocolDestination, isSigner: false, isWritable: true},
    {pubkey: CLOCK, isSigner: false, isWritable: false},
    {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], disc('unstake'));
}

async function protocolDestination() {
  const info = await connection.getAccountInfo(PROTOCOL_FEE, 'confirmed');
  return new PublicKey(info.data.subarray(8, 40));
}

function compactAccount(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  return {lamports:value.lamports, owner:value.owner, executable:value.executable, dataLen:data.length, dataHex:data.length <= 120 ? data.toString('hex') : undefined};
}

async function simulate(name, instructions, addresses) {
  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({payerKey:LP_OWNER,recentBlockhash:blockhash,instructions}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const wire = Buffer.from(transaction.serialize()).toString('base64');
  const config = {encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',innerInstructions:true,accounts:{encoding:'base64',addresses:addresses.map(String)}};
  const response = await connection._rpcRequest('simulateTransaction', [wire, config]);
  if (response.error) throw new Error(`${name}: ${JSON.stringify(response.error)}`);
  const value = response.result.value;
  return {
    name,
    err:value.err,
    unitsConsumed:value.unitsConsumed,
    logs:value.logs,
    returnData:value.returnData,
    postAccounts:Object.fromEntries(addresses.map((key,i)=>[String(key),compactAccount(value.accounts?.[i])] )),
  };
}

async function main() {
  const protocolDest = await protocolDestination();
  protocolFeeDestinationForInstruction = protocolDest;
  const preKeys = [LP_OWNER, RESERVE, POOL, LP_MINT, LP_TOKEN];
  const preInfos = await connection.getMultipleAccountsInfo(preKeys, 'confirmed');
  const pre = Object.fromEntries(preKeys.map((key,i)=>[String(key), preInfos[i] ? {lamports:preInfos[i].lamports, owner:String(preInfos[i].owner), dataHex:preInfos[i].data.length <= 120 ? preInfos[i].data.toString('hex') : undefined, dataLen:preInfos[i].data.length} : null]));
  const poolOwned = BigInt(poolRow.reserveLamports) + BigInt(poolRow.incomingStakeRecordedLamports);
  const lpSupply = BigInt(poolRow.lpMintSupply);
  const addAmount = 10_000_000n;
  const minted = addAmount * lpSupply / poolOwned;
  const removeAmount = 1_000_000n;
  const valuationProbeBurn = 900_000_000n;
  const trailingPoolLamports = poolRow.trailingDataHex
    ? Buffer.from(poolRow.trailingDataHex, 'hex').readBigUInt64LE(0)
    : 0n;
  const expectedProbeWithoutTrailing = valuationProbeBurn * poolOwned / lpSupply;
  const expectedProbeWithTrailing = valuationProbeBurn * (poolOwned + trailingPoolLamports) / lpSupply;
  const attacker = Keypair.generate().publicKey;
  const results = [];

  results.push(await simulate('positive_remove_liquidity', [
    ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), removeLiquidity(removeAmount),
  ], preKeys));
  results.push(await simulate('positive_remove_liquidity_valuation_probe', [
    ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), removeLiquidity(valuationProbeBurn),
  ], preKeys));
  results.push(await simulate('mutation_remove_wrong_authority', [
    ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), removeLiquidity(removeAmount, attacker, attacker),
  ], preKeys.concat([attacker])));
  results.push(await simulate('mutation_remove_wrong_reserve_alias', [
    ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), removeLiquidity(removeAmount, LP_OWNER, LP_OWNER, LP_OWNER),
  ], preKeys));
  results.push(await simulate('atomic_add_then_remove_round_trip', [
    ComputeBudgetProgram.setComputeUnitLimit({units:600_000}), addLiquidity(addAmount), removeLiquidity(minted),
  ], preKeys));
  results.push(await simulate('inactive_flash_take_repay_missing_fee_account', [
    ComputeBudgetProgram.setComputeUnitLimit({units:600_000}), takeFlashLoan(1_000_000n), repayFlashLoan(),
  ], [LP_OWNER, RESERVE, POOL, FLASH, FLASH_FEE, protocolDest]));

  const epochInfo = await connection.getEpochInfo('confirmed');
  const stakeInfos = await connection.getMultipleAccountsInfo(poolRow.stakeAccounts.map(x=>new PublicKey(x.stakeAccount)), 'confirmed');
  const activationRows = poolRow.stakeAccounts.map((row,i) => {
    const data = stakeInfos[i].data;
    const tag = data.readUInt32LE(0);
    const activationEpoch = tag === 2 ? data.readBigUInt64LE(164) : null;
    const deactivationEpoch = tag === 2 ? data.readBigUInt64LE(172) : null;
    const state = tag === 1 || (tag === 2 && deactivationEpoch < BigInt(epochInfo.epoch)) ? 'inactive' : (tag === 2 && deactivationEpoch === BigInt(epochInfo.epoch) ? 'deactivating' : 'active');
    return {row, activation:{state,tag,activationEpoch:activationEpoch?.toString(),deactivationEpoch:deactivationEpoch?.toString(),currentEpoch:epochInfo.epoch}};
  });
  const inactive = activationRows.filter(x => x.activation.state === 'inactive');
  const selectedAny = activationRows[0]?.row;
  const otherAny = selectedAny && poolRow.stakeAccounts.find(x => x.recordAccount !== selectedAny.recordAccount);
  if (selectedAny && otherAny) {
    results.push(await simulate('mutation_reclaim_with_other_stake_record', [
      ComputeBudgetProgram.setComputeUnitLimit({units:500_000}), reclaim(new PublicKey(selectedAny.stakeAccount), new PublicKey(otherAny.recordAccount)),
    ], [LP_OWNER, RESERVE, POOL, new PublicKey(selectedAny.stakeAccount), new PublicKey(otherAny.recordAccount)]));
  }
  const priorReclaim = history.samples?.reclaim_stake_account?.[0]?.instruction?.accounts;
  if (priorReclaim?.length >= 4) {
    const staleStake = new PublicKey(priorReclaim[0]);
    const staleRecord = new PublicKey(priorReclaim[3]);
    results.push(await simulate('mutation_reclaim_stale_closed_stake_record', [
      ComputeBudgetProgram.setComputeUnitLimit({units:500_000}), reclaim(staleStake, staleRecord),
    ], [LP_OWNER, RESERVE, POOL, staleStake, staleRecord]));
  }
  if (inactive.length) {
    const selected = inactive[0].row;
    const stake = new PublicKey(selected.stakeAccount);
    const record = new PublicKey(selected.recordAccount);
    const other = poolRow.stakeAccounts.find(x => x.recordAccount !== selected.recordAccount);
    results.push(await simulate('positive_reclaim_inactive_stake', [
      ComputeBudgetProgram.setComputeUnitLimit({units:500_000}), reclaim(stake, record),
    ], [LP_OWNER, RESERVE, POOL, stake, record]));
    results.push(await simulate('mutation_duplicate_reclaim_same_transaction', [
      ComputeBudgetProgram.setComputeUnitLimit({units:800_000}), reclaim(stake, record), reclaim(stake, record),
    ], [LP_OWNER, RESERVE, POOL, stake, record]));
    results.push(await simulate('atomic_add_reclaim_remove', [
      ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}), addLiquidity(addAmount), reclaim(stake, record), removeLiquidity(minted),
    ], [LP_OWNER, RESERVE, POOL, LP_MINT, LP_TOKEN, stake, record]));
  }

  const newStake = Keypair.generate().publicKey;
  const newRecord = PublicKey.findProgramAddressSync([POOL.toBuffer(), newStake.toBuffer()], PROGRAM)[0];
  const rent = await connection.getMinimumBalanceForRentExemption(StakeProgram.space, 'confirmed');
  const stakeLamports = BigInt(rent) + 10_000_000n;
  const createStake = SystemProgram.createAccount({fromPubkey:LP_OWNER,newAccountPubkey:newStake,lamports:Number(stakeLamports),space:StakeProgram.space,programId:StakeProgram.programId});
  const initStake = StakeProgram.initialize({stakePubkey:newStake,authorized:{staker:LP_OWNER,withdrawer:LP_OWNER},lockup:{unixTimestamp:0,epoch:0,custodian:PublicKey.default}});
  results.push(await simulate('positive_create_initialized_stake_then_unstake', [
    ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}), createStake, initStake, unstake(newStake,newRecord,LP_OWNER,LP_OWNER,protocolDest),
  ], [LP_OWNER, RESERVE, POOL, newStake, newRecord, protocolDest]));
  results.push(await simulate('mutation_unstake_wrong_authority', [
    ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}), createStake, initStake, unstake(newStake,newRecord,attacker,attacker,protocolDest),
  ], [LP_OWNER, attacker, RESERVE, POOL, newStake, newRecord, protocolDest]));
  results.push(await simulate('mutation_unstake_wrong_reserve_alias', [
    ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}), createStake, initStake, unstake(newStake,newRecord,LP_OWNER,LP_OWNER,protocolDest,LP_OWNER),
  ], [LP_OWNER, RESERVE, POOL, newStake, newRecord, protocolDest]));
  const unrelatedRecord = PublicKey.findProgramAddressSync([POOL.toBuffer(), attacker.toBuffer()], PROGRAM)[0];
  results.push(await simulate('mutation_unstake_with_other_record_pda', [
    ComputeBudgetProgram.setComputeUnitLimit({units:1_000_000}), createStake, initStake, unstake(newStake,unrelatedRecord,LP_OWNER,LP_OWNER,protocolDest),
  ], [LP_OWNER, RESERVE, POOL, newStake, unrelatedRecord, protocolDest]));
  results.push(await simulate('mutation_duplicate_unstake_same_transaction', [
    ComputeBudgetProgram.setComputeUnitLimit({units:1_200_000}), createStake, initStake,
    unstake(newStake,newRecord,LP_OWNER,LP_OWNER,protocolDest),
    unstake(newStake,newRecord,LP_OWNER,LP_OWNER,protocolDest),
  ], [LP_OWNER, RESERVE, POOL, newStake, newRecord, protocolDest]));

  const summary = {
    observedSlot: await connection.getSlot('confirmed'),
    program:String(PROGRAM), pool:String(POOL), reserve:String(RESERVE),
    payerAndLpAuthority:String(LP_OWNER), lpTokenAccount:String(LP_TOKEN),
    protocolFeeAccount:String(PROTOCOL_FEE), protocolFeeDestination:String(protocolDest),
    pre, parameters:{poolOwnedLamports:String(poolOwned),trailingPoolLamports:String(trailingPoolLamports),lpSupply:String(lpSupply),addAmount:String(addAmount),expectedMintedRaw:String(minted),removeAmountRaw:String(removeAmount),valuationProbeBurnRaw:String(valuationProbeBurn),expectedProbeWithoutTrailingLamports:String(expectedProbeWithoutTrailing),expectedProbeWithTrailingLamports:String(expectedProbeWithTrailing),freshStakeLamports:String(stakeLamports)},
    stakeActivationSummary:{total:activationRows.length,states:activationRows.reduce((a,x)=>(a[x.activation.state]=(a[x.activation.state]||0)+1,a),{}),inactiveSelected:inactive[0]?.row || null},
    results,
    caveat:'sigVerify=false permits zero signatures; landed transactions are the real authorization/value-moving positive controls. No transaction was submitted.',
  };
  const out = `${DIR}/sanctum-unstake-simulations.json`;
  fs.writeFileSync(out, JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({out,observedSlot:summary.observedSlot,stakeActivationSummary:summary.stakeActivationSummary,results:results.map(r=>({name:r.name,err:r.err,unitsConsumed:r.unitsConsumed,lastLogs:(r.logs||[]).slice(-6)}))},null,2));
}

main().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
