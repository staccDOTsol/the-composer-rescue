#!/usr/bin/env node
'use strict';

// Sweep the size of a real three-provider WSOL flash-loan-funded Whirlpool
// round trip in signed transaction-v1. Every case runs only on an isolated
// local mainnet-backed Surfpool fork; no mainnet submission path exists here.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram} =
  require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} =
  require(`${MODULES}/@solana/spl-token`);
const PROVIDER_MODE = process.env.ORCA_ECONOMIC_PROVIDERS || 'three';
if (!['two', 'three'].includes(PROVIDER_MODE))
  throw new Error('ORCA_ECONOMIC_PROVIDERS must be two or three');
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS, saveFeeRaw} =
  require(PROVIDER_MODE === 'two' ? './economic-max-two-envelope.js'
    : './real-flash-envelope.js');
const PREPARE_ATAS = process.env.ORCA_ECONOMIC_PREPARE_ATAS === '1';
const SEND_LOCAL = process.env.ORCA_ECONOMIC_SEND_LOCAL === '1';
if (SEND_LOCAL && (!PREPARE_ATAS || PROVIDER_MODE !== 'two'))
  throw new Error('Local send requires prepared two-provider mode');
const {
  POOL, POSITION, LOWER, UPPER, CURRENT_ARRAY,
  WSOL_VAULT, USDC_MINT, USDC_VAULT, tokenAmount, positionImage,
} = require('./real-flash-swap-roundtrip.js');

const FORK = process.env.ORCA_ECONOMIC_FORK || 'http://127.0.0.1:56899';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK))
  throw new Error('Only localhost Surfpool forks are permitted');
const ALLOCATION = process.env.ORCA_ECONOMIC_ALLOCATION || 'klend';
if (!['klend', 'save'].includes(ALLOCATION))
  throw new Error('ORCA_ECONOMIC_ALLOCATION must be klend or save');
const TICK_MODE = process.env.ORCA_ECONOMIC_TICK_MODE || 'current';
if (!['current', 'adjacent', 'adjacent2'].includes(TICK_MODE))
  throw new Error('ORCA_ECONOMIC_TICK_MODE must be current, adjacent, or adjacent2');
const OUT = path.join(__dirname, PROVIDER_MODE === 'two'
  ? `economic-max-two-${TICK_MODE}${PREPARE_ATAS ? '-prepared' : ''}.json`
  : ALLOCATION === 'save'
  ? (TICK_MODE === 'current' ? 'economic-max-combined.json'
      : `economic-max-combined-${TICK_MODE}.json`)
  : 'economic-max-sweep.json');
const D = name => crypto.createHash('sha256')
  .update(`global:${name}`).digest().subarray(0, 8);
const key = (pubkey, isWritable, isSigner = false) =>
  ({pubkey, isWritable, isSigner});
const p = value => value instanceof PublicKey ? value : new PublicKey(value);
const [oracle] = PublicKey.findProgramAddressSync(
  [Buffer.from('oracle'), POOL.toBuffer()], p(PROGRAMS.whirlpool));
const tickPda = startTick => PublicKey.findProgramAddressSync([
  Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(startTick)),
], p(PROGRAMS.whirlpool))[0];
const DOWN1 = tickPda(-23232);
const DOWN2 = tickPda(-23584);
const UP1 = tickPda(-22528);
const seed = (kind, amount) => Keypair.fromSeed(crypto.createHash('sha256')
  .update(`orca-pr1396-economic-max-${kind}-${amount}-2026-10-19`).digest());

function swap(actor, ataA, ataB, amount, exactInput, aToB) {
  const data = Buffer.alloc(42);
  D('swap').copy(data);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(aToB ? 0n : 0xffffffffffffffffn, 16);
  // Zero sqrt-price limit invokes the program default.
  data[40] = exactInput ? 1 : 0;
  data[41] = aToB ? 1 : 0;
  const arrays = TICK_MODE === 'current'
    ? [CURRENT_ARRAY, CURRENT_ARRAY, CURRENT_ARRAY]
    : aToB ? [CURRENT_ARRAY, DOWN1, DOWN2]
      : TICK_MODE === 'adjacent2' ? [DOWN2, DOWN1, CURRENT_ARRAY]
        : [DOWN1, CURRENT_ARRAY, UP1];
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool),
    keys: [
      key(TOKEN_PROGRAM_ID, false), key(actor.publicKey, false, true),
      key(POOL, true), key(ataA, true), key(WSOL_VAULT, true),
      key(ataB, true), key(USDC_VAULT, true),
      ...arrays.map(address => key(address, true)), key(oracle, false),
    ], data});
}

function update() {
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool),
    keys: [key(POOL, true), key(POSITION, true),
      key(LOWER, false), key(UPPER, false)],
    data: D('update_fees_and_rewards')});
}

function safeError(error) {
  return String(error && (error.stack || error.message || error))
    .replace(/api-key=[^&\s"']+/gi, 'api-key=[REDACTED]')
    .slice(0, 1200);
}

async function syncVerifiedSaveState() {
  const source = process.env.ORCA_ECONOMIC_SAVE_SOURCE;
  if (!source) return null;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(source) || source === FORK)
    throw new Error('Save account source must be a distinct local fork');
  const addresses = [
    '8UviNr47S8eL6J3WfDxMRa3hvLta1VDJwNWqsDgtN3Cv', // Save supply
    '8PbodeaosQP19SjYFx855UMqWxH2HynZLdBXmsrbac36', // Save reserve
    '5wo1tFpi4HaVKnemqaXeQnBEpezrJXcXvuztYaPhvgC7', // Save fee vault
    '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY', // Save config
  ];
  const response = await rpc(source, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'processed'}]);
  for (let i = 0; i < addresses.length; i++) {
    const account = response.value[i];
    if (!account) throw new Error(`Verified source lacks ${addresses[i]}`);
    await rpc(FORK, 'surfnet_setAccount', [addresses[i], {
      data: Buffer.from(account.data[0], 'base64').toString('hex'),
      owner: account.owner, lamports: account.lamports,
      executable: account.executable, rentEpoch: 0,
    }]);
  }
  return {source, addresses};
}

async function localLedgerSend(envelope, simulation, input, setupSignature) {
  const programKeys = new Set(envelope.instructions.map(ix => ix.programId.toBase58()));
  const instructionKeys = [...new Set(envelope.instructions.flatMap(ix =>
    ix.keys.map(account => account.pubkey.toBase58())))];
  const seededAbsentAccounts = [];
  for (const address of instructionKeys) {
    if (programKeys.has(address)) continue;
    const info = await rpc(FORK, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}]);
    if (info.value) continue;
    await rpc(FORK, 'surfnet_setAccount', [address, {
      data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
    seededAbsentAccounts.push(address);
  }
  const addresses = simulation.watched;
  const before = (await rpc(FORK, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'processed'}])).value;
  const signature = await rpc(FORK, 'sendTransaction', [
    envelope.wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true,
      preflightCommitment: 'processed'},
  ]);
  let transaction = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    transaction = await rpc(FORK, 'getTransaction', [signature,
      {encoding: 'json', commitment: 'processed',
        maxSupportedTransactionVersion: 1}]);
    if (transaction) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const status = await rpc(FORK, 'getSignatureStatuses', [[signature],
    {searchTransactionHistory: true}]);
  const after = (await rpc(FORK, 'getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'processed'}])).value;
  const tokenDeltas = Object.fromEntries(addresses.map((address, index) => {
    const first = tokenAmount(before[index]);
    const last = tokenAmount(after[index]);
    return [address, first !== null && last !== null
      ? String(BigInt(last) - BigInt(first)) : null];
  }));
  const accountImages = Object.fromEntries(addresses.map((address, index) => [
    address, {before: tokenAmount(before[index]), after: tokenAmount(after[index]),
      positionBefore: address === POSITION.toBase58() ? positionImage(before[index]) : undefined,
      positionAfter: address === POSITION.toBase58() ? positionImage(after[index]) : undefined},
  ]));
  const receipt = {
    schema: 'orca-pr1396-economic-max-local-ledger/v1',
    execution: 'signed transaction-v1 committed on isolated mainnet-backed Surfpool fork',
    mainnetSubmission: false, fork: FORK, inputLamports: String(input),
    setupSignature, signature, status: status.value[0],
    transactionVersion: transaction?.version ?? null,
    transactionSlot: transaction?.slot ?? null,
    transactionError: transaction?.meta?.err ?? null,
    transactionUnitsConsumed: transaction?.meta?.computeUnitsConsumed ?? null,
    wire: envelope.stats, signedWireBase64: envelope.wire.toString('base64'),
    indexes: envelope.index, seededAbsentAccounts,
    addresses, accountImages, tokenDeltas,
    logs: transaction?.meta?.logMessages || [],
    priorSimulation: {err: simulation.err,
      completeRepayment: simulation.completeRepayment,
      unitsConsumed: simulation.unitsConsumed},
  };
  const output = path.join(__dirname, 'economic-max-two-adjacent-prepared-send.json');
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  const lenders = [envelope.lenderAccounts.saveSupply,
    envelope.lenderAccounts.klendSupply];
  if (!transaction || transaction.meta?.err ||
      transaction.version !== 1 ||
      lenders.some(address => tokenDeltas[address] !== '0') ||
      tokenDeltas[envelope.lenderAccounts.saveFee] !==
        String(saveFeeRaw(envelope.amounts.save))) {
    throw new Error('Local ledger transaction violated expected lender/fee invariants');
  }
  return {signature, output, slot: receipt.transactionSlot,
    unitsConsumed: receipt.transactionUnitsConsumed,
    tokenDeltas};
}

async function trial(input) {
  const actor = seed('actor', input);
  const margin = seed('margin', input);
  const ataA = getAssociatedTokenAddressSync(p(PROGRAMS.wsol), actor.publicKey);
  const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
  const cushion = input / 50n + 10_000n; // 2% exact-out shortfall plus fee.
  if (cushion >= input) throw new Error('Prefund must remain below swap input');
  const amounts = PROVIDER_MODE === 'two' ? {
    save: input - 1_000_000_000n,
    project0: 0n,
    klend: 1_000_000_000n,
  } : ALLOCATION === 'save' ? {
    save: input - 1_100_000_000n,
    project0: 100_000_000n,
    klend: 1_000_000_000n,
  } : {
    save: 1_000_000n,
    project0: 100_000_000n,
    klend: input - 101_000_000n,
  };
  if (amounts.save <= 0n || amounts.klend <= 0n)
    throw new Error('Input too small for all three real providers');
  // This funds only local native SOL for rent and an explicitly wrapped cushion.
  // The first swap still requires the three borrowed WSOL principals.
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false,
    lamports: Number(cushion + saveFeeRaw(amounts.save) + 2_000_000_000n),
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  // Mark the two fresh token-account addresses as absent locally, preventing
  // Surfpool from querying the remote RPC for accounts that cannot yet exist.
  for (const address of [ataA, ataB]) await rpc(FORK, 'surfnet_setAccount', [
    address.toBase58(), {data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0},
  ]);
  let setupSignature = null;
  if (PREPARE_ATAS) {
    const setupBlockhash = (await rpc(FORK, 'getLatestBlockhash',
      [{commitment: 'processed'}])).value.blockhash;
    const setup = new Transaction({feePayer: actor.publicKey,
      recentBlockhash: setupBlockhash});
    setup.add(
      createAssociatedTokenAccountIdempotentInstruction(
        actor.publicKey, ataA, actor.publicKey, p(PROGRAMS.wsol)),
      createAssociatedTokenAccountIdempotentInstruction(
        actor.publicKey, ataB, actor.publicKey, USDC_MINT),
      SystemProgram.transfer({fromPubkey: actor.publicKey,
        toPubkey: ataA, lamports: cushion}),
      new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
        keys: [key(ataA, true)], data: Buffer.from([17])}),
    );
    setup.sign(actor);
    setupSignature = await rpc(FORK, 'sendTransaction', [
      setup.serialize().toString('base64'),
      {encoding: 'base64', skipPreflight: false, preflightCommitment: 'processed'},
    ]);
    const funded = await rpc(FORK, 'getAccountInfo', [ataA.toBase58(),
      {encoding: 'base64', commitment: 'processed'}]);
    if (tokenAmount(funded.value) !== String(cushion))
      throw new Error('Setup did not fund WSOL cushion on the local ledger');
  }
  const beforeBorrow = PREPARE_ATAS ? [] : [
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey,
      toPubkey: ataA, lamports: cushion}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const payloadInstructions = PROVIDER_MODE === 'two'
    ? [swap(actor, ataA, ataB, input, true, true),
        swap(actor, ataA, ataB, input * 98n / 100n, false, false), update()]
    : [swap(actor, ataA, ataB, input, true, true), update(),
        swap(actor, ataA, ataB, input * 98n / 100n, false, false), update()];
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const envelope = buildFlashEnvelope({actor, marginAccount: margin,
    providers: PROVIDER_MODE === 'two' ? ['save', 'klend']
      : ['save', 'klend', 'project0'], amounts, beforeBorrow,
    createWsolAta: !PREPARE_ATAS,
    payloadInstructions, blockhash});
  if (SEND_LOCAL) {
    // Surfpool's send path needs a local empty image for absent sysvar keys.
    const programKeys = new Set(envelope.instructions.map(ix => ix.programId.toBase58()));
    for (const address of [...new Set(envelope.instructions.flatMap(ix =>
      ix.keys.map(account => account.pubkey.toBase58())))]) {
      if (programKeys.has(address)) continue;
      const info = await rpc(FORK, 'getAccountInfo', [address,
        {encoding: 'base64', commitment: 'processed'}]);
      if (info.value) continue;
      await rpc(FORK, 'surfnet_setAccount', [address, {
        data: '', executable: false, lamports: 0,
        owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
      }]);
    }
  }
  const result = await simulateFlashEnvelope(FORK, envelope,
    [POOL, POSITION, ataA, ataB, WSOL_VAULT, USDC_VAULT]);
  const swaps = result.logs.filter(line =>
    line.includes('Program log: Instruction: Swap')).length;
  const updates = result.logs.filter(line =>
    line.includes('Program log: Instruction: UpdateFeesAndRewards')).length;
  const firstFailure = result.logs.find(line => /failed:|Error Code:|Program log: Error/i.test(line));
  const at = address => result.watched.indexOf(address.toBase58());
  const accountAt = (array, address) => array[at(address)];
  const pass = !result.err && result.completeRepayment && swaps === 2 &&
    updates === (PROVIDER_MODE === 'two' ? 1 : 2);
  const ledger = SEND_LOCAL && pass
    ? await localLedgerSend(envelope, result, input, setupSignature) : null;
  return {inputLamports: String(input), cushionLamports: String(cushion),
    allocation: ALLOCATION, providerMode: PROVIDER_MODE, tickMode: TICK_MODE,
    setupSignature, ledger,
    saveFeeLamports: String(saveFeeRaw(amounts.save)),
    borrowedLamports: Object.fromEntries(Object.entries(amounts)
      .map(([name, value]) => [name, String(value)])),
    actor: actor.publicKey.toBase58(),
    actorWsolAta: ataA.toBase58(),
    err: result.err, firstFailure: firstFailure || null,
    whirlpoolSwaps: swaps, whirlpoolUpdates: updates,
    completeRepayment: result.completeRepayment,
    lenderVaultDeltas: result.lenderVaultDeltas,
    actorWsolBefore: tokenAmount(accountAt(result.beforeAccounts, ataA)),
    actorWsolAfter: tokenAmount(accountAt(result.afterAccounts, ataA)),
    actorUsdcBefore: tokenAmount(accountAt(result.beforeAccounts, ataB)),
    actorUsdcAfter: tokenAmount(accountAt(result.afterAccounts, ataB)),
    poolWsolBefore: tokenAmount(accountAt(result.beforeAccounts, WSOL_VAULT)),
    poolWsolAfter: tokenAmount(accountAt(result.afterAccounts, WSOL_VAULT)),
    poolUsdcBefore: tokenAmount(accountAt(result.beforeAccounts, USDC_VAULT)),
    poolUsdcAfter: tokenAmount(accountAt(result.afterAccounts, USDC_VAULT)),
    positionBefore: positionImage(accountAt(result.beforeAccounts, POSITION)),
    positionAfter: positionImage(accountAt(result.afterAccounts, POSITION)),
    unitsConsumed: result.unitsConsumed, wire: envelope.stats,
    logTail: result.logs.slice(-18),
    pass};
}

async function main() {
  if (SEND_LOCAL && process.argv.slice(2).length !== 1)
    throw new Error('Local send requires exactly one input size');
  const genesis = await rpc(FORK, 'getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork does not have mainnet genesis');
  const syncedSaveState = await syncVerifiedSaveState();
  const rows = [];
  const inputs = process.argv.slice(2).length
    ? process.argv.slice(2).map(BigInt)
    : [1n, 10n, 100n, 1_000n, 5_000n].map(x => x * 1_000_000_000n);
  for (const input of inputs) {
    let row;
    try { row = await trial(input); }
    catch (error) { row = {inputLamports: String(input), pass: false,
      harnessError: safeError(error)}; }
    rows.push(row);
    console.log(JSON.stringify({inputLamports: row.inputLamports,
      pass: row.pass, err: row.err || null,
      firstFailure: row.firstFailure || row.harnessError || null,
      swaps: row.whirlpoolSwaps, updates: row.whirlpoolUpdates,
      cu: row.unitsConsumed, wire: row.wire}));
    fs.writeFileSync(OUT, `${JSON.stringify({
      schema: 'orca-pr1396-economic-max-sweep/v1',
      execution: 'signed v1 simulation on separate local mainnet-backed Surfpool fork',
      mainnetSubmission: false, fork: FORK, allocation: ALLOCATION,
      providerMode: PROVIDER_MODE, preparedAtas: PREPARE_ATAS,
      tickMode: TICK_MODE,
      syncedSaveState,
      pool: POOL.toBase58(), position: POSITION.toBase58(), rows,
    }, null, 2)}\n`);
  }
}

main().catch(error => {console.error(safeError(error)); process.exitCode = 1;});
