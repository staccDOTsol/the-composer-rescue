#!/usr/bin/env node
'use strict';

// Find the largest genuine three-lender / Whirlpool swap+update payload that
// fits Solana transaction-v1's 64-instruction and 1.4m-CU limits, then commit
// the strongest successful case to the local Surfpool fork. No mainnet send.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, SystemProgram, TransactionInstruction} = require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MODULES}/@solana/spl-token`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');
const {
  FORK, POOL, POSITION, WSOL_VAULT, USDC_MINT, USDC_VAULT,
  actor: BASE_ACTOR, ataA: BASE_ATA_A, ataB: BASE_ATA_B,
  swap, update, tokenAmount, positionImage,
} = require('./real-flash-swap-roundtrip.js');

if (FORK !== 'http://127.0.0.1:48899') throw new Error('Local fork :48899 only');
const OUT = path.join(__dirname, 'real-flash-cycle-ceiling.json');
const LAMPORTS = 1_000_000_000n;
const INPUT = LAMPORTS;
const RETURN = 980_000_000n;
const MAX_USDC = 0xffffffffffffffffn;
const key = (pubkey, isWritable) => ({pubkey, isWritable, isSigner: false});
const seed = label => Keypair.fromSeed(crypto.createHash('sha256').update(label).digest());

function remap(ix, actor, ataA, ataB) {
  const replacements = new Map([
    [BASE_ACTOR.publicKey.toBase58(), actor.publicKey],
    [BASE_ATA_A.toBase58(), ataA], [BASE_ATA_B.toBase58(), ataB],
  ]);
  return new TransactionInstruction({programId: ix.programId,
    data: Buffer.from(ix.data),
    keys: ix.keys.map(meta => ({...meta,
      pubkey: replacements.get(meta.pubkey.toBase58()) || meta.pubkey}))});
}

function u128(data, offset) {
  return String(data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n));
}

function poolImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {liquidity: u128(data, 49), tickCurrentIndex: data.readInt32LE(81),
    feeGrowthGlobalA: u128(data, 165), feeGrowthGlobalB: u128(data, 245),
    protocolFeeOwedA: String(data.readBigUInt64LE(85)),
    protocolFeeOwedB: String(data.readBigUInt64LE(93))};
}

async function fundActor(actor, lamports) {
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
}

async function oneCase(cycles, extraUpdate = false) {
  const label = `orca-pr1396-flash-ceiling-${cycles}-${extraUpdate ? 'extra' : 'plain'}`;
  const actor = seed(`${label}-actor`);
  const margin = seed(`${label}-margin`);
  const ataA = getAssociatedTokenAddressSync(
    new (require(`${MODULES}/@solana/web3.js`).PublicKey)(PROGRAMS.wsol), actor.publicKey);
  const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
  // 20m lamport net roundtrip loss per cycle plus a 10m buffer. The actor's
  // starting WSOL is always below the 1 SOL first-swap input.
  const cushion = Number(20_000_000n * BigInt(cycles) + 10_000_000n);
  await fundActor(actor, 1_000_000_000);
  const beforeBorrow = [
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey, toPubkey: ataA,
      lamports: cushion}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const payload = [];
  for (let i = 0; i < cycles; i += 1) {
    payload.push(remap(swap({amount: INPUT, exactInput: true, aToB: true,
      otherAmountThreshold: 0n}), actor, ataA, ataB));
    payload.push(update());
    payload.push(remap(swap({amount: RETURN, exactInput: false, aToB: false,
      otherAmountThreshold: MAX_USDC}), actor, ataA, ataB));
    payload.push(update());
  }
  if (extraUpdate) payload.push(update());
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  let envelope;
  try {
    envelope = buildFlashEnvelope({actor, marginAccount: margin,
      providers: ['save', 'klend', 'project0'],
      amounts: {save: LAMPORTS, klend: LAMPORTS, project0: LAMPORTS},
      beforeBorrow, payloadInstructions: payload, blockhash});
  } catch (error) {
    return {summary: {cycles, extraUpdate, buildError: error.message,
      payloadInstructions: payload.length}, envelope: null};
  }
  const watch = [POOL, POSITION, WSOL_VAULT, USDC_VAULT, ataA, ataB];
  const result = await simulateFlashEnvelope(FORK, envelope, watch);
  const at = address => result.watched.indexOf(address.toBase58());
  const summary = {cycles, extraUpdate, actor: actor.publicKey.toBase58(),
    margin: margin.publicKey.toBase58(), wsolAta: ataA.toBase58(),
    usdcAta: ataB.toBase58(), cushionRaw: String(cushion),
    loanRawEach: String(LAMPORTS), swapInputRawEach: String(INPUT),
    swapReturnRawEach: String(RETURN),
    err: result.err, completeRepayment: result.completeRepayment,
    stats: result.stats, instructionIndexes: result.index,
    unitsConsumed: result.unitsConsumed,
    swapsExecuted: result.logs.filter(line =>
      line.includes('Program log: Instruction: Swap')).length,
    updatesExecuted: result.logs.filter(line =>
      line.includes('Program log: Instruction: UpdateFeesAndRewards')).length,
    actorWsolBefore: tokenAmount(result.beforeAccounts[at(ataA)]),
    actorWsolAfter: tokenAmount(result.afterAccounts[at(ataA)]),
    poolWsolBefore: tokenAmount(result.beforeAccounts[at(WSOL_VAULT)]),
    poolWsolAfter: tokenAmount(result.afterAccounts[at(WSOL_VAULT)]),
    poolUsdcBefore: tokenAmount(result.beforeAccounts[at(USDC_VAULT)]),
    poolUsdcAfter: tokenAmount(result.afterAccounts[at(USDC_VAULT)]),
    positionBefore: positionImage(result.beforeAccounts[at(POSITION)]),
    positionAfter: positionImage(result.afterAccounts[at(POSITION)]),
    poolBefore: poolImage(result.beforeAccounts[at(POOL)]),
    poolAfter: poolImage(result.afterAccounts[at(POOL)]),
    lenderVaultDeltas: result.lenderVaultDeltas,
    logCount: result.logs.length,
    logTruncated: result.logs.includes('Log truncated'),
    lastLogs: result.logs.slice(-10)};
  return {summary, envelope, actor, margin, ataA, ataB,
    watch, simulationLogs: result.logs};
}

async function accountImages(addresses) {
  const response = await rpc(FORK, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'processed'}]);
  return Object.fromEntries(addresses.map((address, i) => [address, {
    exists: !!response.value[i], tokenAmount: tokenAmount(response.value[i]),
    position: address === POSITION.toBase58()
      ? positionImage(response.value[i]) : undefined,
    pool: address === POOL.toBase58()
      ? poolImage(response.value[i]) : undefined,
  }]));
}

async function commit(result) {
  const {envelope, watch} = result;
  const programKeys = new Set(envelope.instructions.map(ix => ix.programId.toBase58()));
  const addresses = [...new Set(envelope.instructions.flatMap(ix =>
    ix.keys.map(meta => meta.pubkey.toBase58())))];
  const seededAbsentAccounts = [];
  for (const address of addresses) {
    if (programKeys.has(address)) continue;
    const value = (await rpc(FORK, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}])).value;
    if (value) continue;
    await rpc(FORK, 'surfnet_setAccount', [address, {
      data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
    seededAbsentAccounts.push(address);
  }
  const secondSimulation = await simulateFlashEnvelope(FORK, envelope, watch);
  if (secondSimulation.err || !secondSimulation.completeRepayment)
    throw new Error(`Pre-send simulation changed: ${JSON.stringify(secondSimulation.err)}`);
  const allAddresses = [...new Set([...Object.values(envelope.lenderAccounts),
    ...watch.map(address => address.toBase58())])];
  const before = await accountImages(allAddresses);
  const signature = await rpc(FORK, 'sendTransaction', [envelope.wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  let transaction = null;
  for (let i = 0; i < 15; i += 1) {
    transaction = await rpc(FORK, 'getTransaction', [signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
    if (transaction) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const after = await accountImages(allAddresses);
  const deltas = Object.fromEntries(allAddresses.map(address => [address,
    before[address].tokenAmount !== null && after[address].tokenAmount !== null
      ? String(BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount))
      : null]));
  return {signature, transactionVersion: transaction?.version ?? null,
    transactionSlot: transaction?.slot ?? null,
    transactionError: transaction?.meta?.err ?? null,
    transactionUnitsConsumed: transaction?.meta?.computeUnitsConsumed ?? null,
    seededAbsentAccounts, signedWireBase64: envelope.wire.toString('base64'),
    before, after, tokenDeltas: deltas,
    logs: transaction?.meta?.logMessages || []};
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not mainnet genesis');
  const cases = [];
  const live = [];
  for (const [cycles, extraUpdate] of [
    [4, false], [5, false], [8, false], [12, false], [12, true], [13, false],
  ]) {
    const result = await oneCase(cycles, extraUpdate);
    cases.push(result.summary);
    if (result.envelope && !result.summary.err && result.summary.completeRepayment)
      live.push(result);
    console.log(JSON.stringify({cycles, extraUpdate,
      err: result.summary.err || result.summary.buildError || null,
      instructions: result.summary.stats?.instructions,
      bytes: result.summary.stats?.bytes,
      accounts: result.summary.stats?.accounts,
      unitsConsumed: result.summary.unitsConsumed,
      swaps: result.summary.swapsExecuted,
      updates: result.summary.updatesExecuted,
      completeRepayment: result.summary.completeRepayment}));
  }
  const strongest = live.at(-1);
  let committed = null;
  if (strongest && strongest.summary.cycles >= 4) {
    committed = await commit(strongest);
    console.log(JSON.stringify({committedSignature: committed.signature,
      transactionVersion: committed.transactionVersion,
      transactionError: committed.transactionError,
      transactionUnitsConsumed: committed.transactionUnitsConsumed,
      logCount: committed.logs.length,
      logTruncated: committed.logs.includes('Log truncated'),
      lenderVaultDeltas: Object.fromEntries(Object.entries(strongest.envelope.lenderAccounts)
        .map(([label, address]) => [label, committed.tokenDeltas[address]]))}));
  }
  const receipt = {schema: 'orca-pr1396-real-flash-cycle-ceiling/v1',
    execution: 'mainnet-backed local Surfpool fork', mainnetSubmission: false,
    targetPosition: POSITION.toBase58(), pool: POOL.toBase58(),
    cases, strongest: strongest?.summary || null, committed};
  fs.writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

module.exports = {remap, poolImage, accountImages, fundActor, seed};

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message); process.exitCode = 1;
});
