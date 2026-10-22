#!/usr/bin/env node
'use strict';

// Prepare the borrower's real margin account and token accounts in a separate
// local-fork setup transaction, then maximize actual swap/update cycles inside
// one signed transaction-v1 containing Save, KLend and Project 0 flash loans.

const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {PublicKey, SystemProgram, TransactionInstruction} = require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MODULES}/@solana/spl-token`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');
const {FORK, POOL, POSITION, WSOL_VAULT, USDC_MINT, USDC_VAULT,
  swap, update, tokenAmount, positionImage} = require('./real-flash-swap-roundtrip.js');
const {remap, poolImage, accountImages, fundActor, seed} = require('./real-flash-cycle-ceiling.js');

if (FORK !== 'http://127.0.0.1:48899') throw new Error('Local fork :48899 only');
const OUT = path.join(__dirname, 'real-flash-cycle-optimized.json');
const actor = seed('orca-pr1396-optimized-cycle-actor-2026-10-19');
const margin = seed('orca-pr1396-optimized-cycle-margin-2026-10-19');
const ataA = getAssociatedTokenAddressSync(new PublicKey(PROGRAMS.wsol), actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
const INPUT = 1_000_000_000n;
const RETURN = 980_000_000n;
const CUSHION = 320_000_000;
const key = (pubkey, isWritable) => ({pubkey, isSigner: false, isWritable});

async function seedAbsent(instructions) {
  const programKeys = new Set(instructions.map(ix => ix.programId.toBase58()));
  const keys = [...new Set(instructions.flatMap(ix =>
    ix.keys.map(meta => meta.pubkey.toBase58())))];
  const seeded = [];
  for (const address of keys) {
    if (programKeys.has(address)) continue;
    const value = (await rpc(FORK, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}])).value;
    if (value) continue;
    await rpc(FORK, 'surfnet_setAccount', [address, {
      data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
    seeded.push(address);
  }
  return seeded;
}

async function send(wire) {
  const signature = await rpc(FORK, 'sendTransaction', [wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  let tx = null;
  for (let i = 0; i < 15; i += 1) {
    tx = await rpc(FORK, 'getTransaction', [signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
    if (tx) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return {signature, tx};
}

async function prepare() {
  await fundActor(actor, 2_000_000_000);
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const source = buildFlashEnvelope({actor, marginAccount: margin,
    providers: ['save', 'klend', 'project0'],
    payloadInstructions: [update()], blockhash});
  const instructions = [
    source.instructions[0], // genuine Project 0 margin-account initialization
    source.instructions[1], // WSOL ATA creation
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey,
      toPubkey: ataA, lamports: CUSHION}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const encoded = encodeV1(instructions, actor.publicKey, blockhash, 500_000);
  const signed = signV1(encoded, instructions, actor.publicKey, blockhash,
    [actor, margin]);
  const seededAbsentAccounts = await seedAbsent(instructions);
  const simulated = await rpc(FORK, 'simulateTransaction', [signed.wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed'}]);
  if (simulated.value.err) throw new Error(`Setup failed simulation: ${JSON.stringify(simulated.value.err)}`);
  const {signature, tx} = await send(signed.wire);
  if (!tx || tx.meta.err) throw new Error(`Setup failed on local ledger: ${JSON.stringify(tx?.meta?.err)}`);
  const startBalance = (await rpc(FORK, 'getTokenAccountBalance', [ataA.toBase58()])).value.amount;
  if (startBalance !== String(CUSHION)) throw new Error('Setup did not prefund expected WSOL cushion');
  return {signature, transactionVersion: tx.version, transactionSlot: tx.slot,
    transactionError: tx.meta.err, unitsConsumed: tx.meta.computeUnitsConsumed,
    wire: {version: 1, bytes: encoded.sizeBytes,
      instructions: encoded.instructionCount, accounts: encoded.addressCount},
    seededAbsentAccounts, actorWsolRaw: startBalance,
    actorUsdcRaw: (await rpc(FORK, 'getTokenAccountBalance', [ataB.toBase58()])).value.amount,
    logs: tx.meta.logMessages || []};
}

function payload(cycles) {
  const instructions = [];
  for (let i = 0; i < cycles; i += 1) {
    instructions.push(remap(swap({amount: INPUT, exactInput: true, aToB: true,
      otherAmountThreshold: 0n}), actor, ataA, ataB));
    instructions.push(update());
    instructions.push(remap(swap({amount: RETURN, exactInput: false, aToB: false,
      otherAmountThreshold: 0xffffffffffffffffn}), actor, ataA, ataB));
    instructions.push(update());
  }
  return instructions;
}

async function oneCase(cycles) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  let envelope;
  try {
    envelope = buildFlashEnvelope({actor, marginAccount: margin,
      providers: ['save', 'klend', 'project0'],
      amounts: {save: INPUT, klend: INPUT, project0: INPUT},
      payloadInstructions: payload(cycles), blockhash,
      initializeMargin: false, createWsolAta: false, saveFeeTopup: false});
  } catch (error) {
    return {summary: {cycles, buildError: error.message}, envelope: null};
  }
  const watch = [POOL, POSITION, WSOL_VAULT, USDC_VAULT, ataA, ataB];
  const simulated = await simulateFlashEnvelope(FORK, envelope, watch);
  const at = address => simulated.watched.indexOf(address.toBase58());
  const summary = {cycles, err: simulated.err,
    completeRepayment: simulated.completeRepayment,
    stats: simulated.stats, instructionIndexes: simulated.index,
    unitsConsumed: simulated.unitsConsumed,
    swapsLogged: simulated.logs.filter(line =>
      line.includes('Program log: Instruction: Swap')).length,
    updatesLogged: simulated.logs.filter(line =>
      line.includes('Program log: Instruction: UpdateFeesAndRewards')).length,
    actorWsolBefore: tokenAmount(simulated.beforeAccounts[at(ataA)]),
    actorWsolAfter: tokenAmount(simulated.afterAccounts[at(ataA)]),
    poolWsolBefore: tokenAmount(simulated.beforeAccounts[at(WSOL_VAULT)]),
    poolWsolAfter: tokenAmount(simulated.afterAccounts[at(WSOL_VAULT)]),
    poolUsdcBefore: tokenAmount(simulated.beforeAccounts[at(USDC_VAULT)]),
    poolUsdcAfter: tokenAmount(simulated.afterAccounts[at(USDC_VAULT)]),
    positionBefore: positionImage(simulated.beforeAccounts[at(POSITION)]),
    positionAfter: positionImage(simulated.afterAccounts[at(POSITION)]),
    poolBefore: poolImage(simulated.beforeAccounts[at(POOL)]),
    poolAfter: poolImage(simulated.afterAccounts[at(POOL)]),
    lenderVaultDeltas: simulated.lenderVaultDeltas,
    logCount: simulated.logs.length,
    logTruncated: simulated.logs.includes('Log truncated'),
    finalLogs: simulated.logs.slice(-10)};
  return {summary, envelope, watch};
}

async function commit(result) {
  const {envelope, watch} = result;
  const seededAbsentAccounts = await seedAbsent(envelope.instructions);
  const simulated = await simulateFlashEnvelope(FORK, envelope, watch);
  if (simulated.err || !simulated.completeRepayment)
    throw new Error(`Max pre-send simulation failed: ${JSON.stringify(simulated.err)}`);
  const addresses = [...new Set([...Object.values(envelope.lenderAccounts),
    ...watch.map(address => address.toBase58())])];
  const before = await accountImages(addresses);
  const {signature, tx} = await send(envelope.wire);
  const after = await accountImages(addresses);
  const tokenDeltas = Object.fromEntries(addresses.map(address => [address,
    before[address].tokenAmount !== null && after[address].tokenAmount !== null
      ? String(BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount))
      : null]));
  return {signature, transactionVersion: tx?.version ?? null,
    transactionSlot: tx?.slot ?? null, transactionError: tx?.meta?.err ?? null,
    unitsConsumed: tx?.meta?.computeUnitsConsumed ?? null,
    seededAbsentAccounts, signedWireBase64: envelope.wire.toString('base64'),
    before, after, tokenDeltas, logs: tx?.meta?.logMessages || []};
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not mainnet genesis');
  const setup = await prepare();
  console.log(JSON.stringify({setupSignature: setup.signature,
    setupVersion: setup.transactionVersion, setupErr: setup.transactionError,
    actorWsolRaw: setup.actorWsolRaw}));
  const cases = [];
  const passes = [];
  for (const cycles of [5, 6, 7, 8, 10, 12, 14, 15]) {
    const result = await oneCase(cycles);
    cases.push(result.summary);
    if (result.envelope && !result.summary.err && result.summary.completeRepayment)
      passes.push(result);
    console.log(JSON.stringify({cycles,
      err: result.summary.err || result.summary.buildError || null,
      instructions: result.summary.stats?.instructions,
      bytes: result.summary.stats?.bytes,
      unitsConsumed: result.summary.unitsConsumed,
      completeRepayment: result.summary.completeRepayment}));
  }
  const strongest = passes.at(-1);
  const committed = strongest ? await commit(strongest) : null;
  if (committed) console.log(JSON.stringify({committedCycles: strongest.summary.cycles,
    signature: committed.signature, version: committed.transactionVersion,
    err: committed.transactionError, unitsConsumed: committed.unitsConsumed,
    lenderDeltas: Object.fromEntries(Object.entries(strongest.envelope.lenderAccounts)
      .map(([label, address]) => [label, committed.tokenDeltas[address]]))}));
  fs.writeFileSync(OUT, `${JSON.stringify({
    schema: 'orca-pr1396-real-flash-cycle-optimized/v1',
    execution: 'mainnet-backed local Surfpool fork', mainnetSubmission: false,
    pool: POOL.toBase58(), position: POSITION.toBase58(),
    actor: actor.publicKey.toBase58(), margin: margin.publicKey.toBase58(),
    wsolAta: ataA.toBase58(), usdcAta: ataB.toBase58(),
    setup, cases, strongest: strongest?.summary || null, committed,
  }, null, 2)}\n`);
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
