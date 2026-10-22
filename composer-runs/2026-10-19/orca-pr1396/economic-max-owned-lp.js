#!/usr/bin/env node
'use strict';

// Sweep a signed transaction-v1 with real zero-fee KLend+Project0 flash loans,
// four Whirlpool swaps, and a genuine actor-owned position increase/decrease,
// two fee updates, and fee collection. Local mainnet-backed Surfpool fork only.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram} =
  require(`${MODULES}/@solana/web3.js`);
const bs58 = require(`${MODULES}/bs58`).default;
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} =
  require(`${MODULES}/@solana/spl-token`);
const PROVIDER_MODE = 'klend-project0';
const {buildFlashEnvelope, simulateFlashEnvelope, decodeSignedV1Wire, rpc, PROGRAMS} =
  require('./real-flash-envelope.js');
const PREPARE_ATAS = true;
const SEND_LOCAL = process.env.ORCA_ECONOMIC_SEND_LOCAL === '1';
const {
  POOL, POSITION, LOWER, UPPER, CURRENT_ARRAY,
  WSOL_VAULT, USDC_MINT, USDC_VAULT, tokenAmount, positionImage,
} = require('./real-flash-swap-roundtrip.js');

const FORK = process.env.ORCA_ECONOMIC_FORK || 'http://127.0.0.1:56899';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK))
  throw new Error('Only localhost Surfpool forks are permitted');
const ALLOCATION = 'zero-fee';
const TICK_MODE = process.env.ORCA_ECONOMIC_TICK_MODE || 'current';
if (!['current', 'adjacent', 'adjacent2'].includes(TICK_MODE))
  throw new Error('ORCA_ECONOMIC_TICK_MODE must be current, adjacent, or adjacent2');
const OUT = path.join(__dirname, `economic-max-zero-fee-owned-lp-${TICK_MODE}.json`);
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
const POSITION_LOWER = DOWN2;
const POSITION_UPPER = UP1;
const POSITION_LOWER_TICK = -23584;
const POSITION_UPPER_TICK = -22528;
const POSITION_LIQUIDITY = 10_000_000_000n;
const PROJECT0_VAULT = p('2eicbpitfJXDwqCuFAmPgDP7t2oUotnAzbGzRKLMgSLe');
const KLEND_FEE_VAULT = p('DW718KwF5d9URykynv8dcmHSQNXKTv7V5VxW5ozckbGS');
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

function openOwnedPosition(actor, mint, position, bump, nftAta) {
  const data = Buffer.alloc(17);
  D('open_position').copy(data);
  data[8] = bump;
  data.writeInt32LE(POSITION_LOWER_TICK, 9);
  data.writeInt32LE(POSITION_UPPER_TICK, 13);
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool), data,
    keys: [key(actor.publicKey, true, true), key(actor.publicKey, false),
      key(position, true), key(mint.publicKey, true, true),
      key(nftAta, true), key(POOL, false), key(TOKEN_PROGRAM_ID, false),
      key(SystemProgram.programId, false),
      key(p('SysvarRent111111111111111111111111111111111'), false),
      key(ASSOCIATED_TOKEN_PROGRAM_ID, false)]});
}

function ownedLiquidityChange(name, actor, position, nftAta, ataA, ataB) {
  const data = Buffer.alloc(40);
  D(name).copy(data);
  data.writeBigUInt64LE(POSITION_LIQUIDITY, 8);
  data.writeBigUInt64LE(0n, 16);
  data.writeBigUInt64LE(name === 'increase_liquidity'
    ? 100_000_000_000n : 0n, 24); // Up to 100 WSOL.
  data.writeBigUInt64LE(name === 'increase_liquidity'
    ? 10_000_000_000n : 0n, 32); // Up to 10,000 USDC.
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool), data,
    keys: [key(POOL, true), key(TOKEN_PROGRAM_ID, false),
      key(actor.publicKey, false, true), key(position, true),
      key(nftAta, false), key(ataA, true), key(ataB, true),
      key(WSOL_VAULT, true), key(USDC_VAULT, true),
      key(POSITION_LOWER, true), key(POSITION_UPPER, true)]});
}

function updateOwnedPosition(position) {
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool),
    data: D('update_fees_and_rewards'), keys: [key(POOL, true),
      key(position, true), key(POSITION_LOWER, false),
      key(POSITION_UPPER, false)]});
}

function collectOwnedFees(actor, position, nftAta, ataA, ataB) {
  return new TransactionInstruction({programId: p(PROGRAMS.whirlpool),
    data: D('collect_fees'), keys: [key(POOL, false),
      key(actor.publicKey, false, true), key(position, true),
      key(nftAta, false), key(ataA, true), key(WSOL_VAULT, true),
      key(ataB, true), key(USDC_VAULT, true), key(TOKEN_PROGRAM_ID, false)]});
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

async function localLedgerSend(envelope, simulation, input, setupSignature,
  positionSetupSignature, ownedPosition) {
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
      positionBefore: address === ownedPosition.toBase58()
        ? positionImage(before[index]) : undefined,
      positionAfter: address === ownedPosition.toBase58()
        ? positionImage(after[index]) : undefined},
  ]));
  const wireKeys = decodeSignedV1Wire(envelope.wire.toString('base64')).keys;
  const innerTokenTransfers = (transaction?.meta?.innerInstructions || [])
    .flatMap(group => (group.instructions || []).flatMap(ix => {
      if (wireKeys[ix.programIdIndex]?.toBase58() !== TOKEN_PROGRAM_ID.toBase58())
        return [];
      const bytes = Buffer.from(bs58.decode(ix.data));
      if (bytes.length !== 9 || bytes[0] !== 3) return [];
      return [{outerInstructionIndex: group.index,
        source: wireKeys[ix.accounts[0]].toBase58(),
        destination: wireKeys[ix.accounts[1]].toBase58(),
        amountRaw: String(bytes.readBigUInt64LE(1))}];
    }));
  const receipt = {
    schema: 'orca-pr1396-economic-max-zero-fee-owned-lp-ledger/v1',
    execution: 'signed transaction-v1 committed on isolated mainnet-backed Surfpool fork',
    mainnetSubmission: false, fork: FORK, inputLamports: String(input),
    setupSignature, positionSetupSignature,
    ownedPosition: ownedPosition.toBase58(), signature, status: status.value[0],
    transactionVersion: transaction?.version ?? null,
    transactionSlot: transaction?.slot ?? null,
    transactionError: transaction?.meta?.err ?? null,
    transactionFeeLamports: transaction?.meta?.fee ?? null,
    transactionUnitsConsumed: transaction?.meta?.computeUnitsConsumed ?? null,
    wire: envelope.stats, signedWireBase64: envelope.wire.toString('base64'),
    indexes: envelope.index, seededAbsentAccounts,
    instructionManifest: envelope.instructions.map((ix, index) => ({index,
      program: ix.programId.toBase58(), discriminatorHex: ix.data.subarray(0, 8).toString('hex'),
      keys: ix.keys.map(key => key.pubkey.toBase58())})),
    addresses, accountImages, tokenDeltas,
    innerTokenTransfers,
    innerInstructions: transaction?.meta?.innerInstructions || [],
    logs: transaction?.meta?.logMessages || [],
    priorSimulation: {err: simulation.err,
      completeRepayment: simulation.completeRepayment,
      unitsConsumed: simulation.unitsConsumed},
  };
  const output = path.join(__dirname,
    `economic-max-zero-fee-owned-lp-${TICK_MODE}-send.json`);
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  const lenders = [envelope.lenderAccounts.klendSupply,
    envelope.lenderAccounts.p0Vault, KLEND_FEE_VAULT.toBase58()];
  if (!transaction || transaction.meta?.err ||
      transaction.version !== 1 ||
      lenders.some(address => tokenDeltas[address] !== '0') ||
      envelope.instructions.some(ix => ix.programId.equals(p(PROGRAMS.save)))) {
    throw new Error('Local ledger transaction violated expected lender/fee invariants');
  }
  return {signature, output, slot: receipt.transactionSlot,
    unitsConsumed: receipt.transactionUnitsConsumed,
    tokenDeltas};
}

async function trial(input) {
  const actor = seed('actor', input);
  const margin = seed('margin', input);
  const positionMint = seed('position-mint', input);
  const [ownedPosition, positionBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), positionMint.publicKey.toBuffer()], p(PROGRAMS.whirlpool));
  const positionNftAta = getAssociatedTokenAddressSync(
    positionMint.publicKey, actor.publicKey);
  const ataA = getAssociatedTokenAddressSync(p(PROGRAMS.wsol), actor.publicKey);
  const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
  const cushion = input / 50n + 3_000_000_000n;
  if (cushion >= input) throw new Error('Prefund must remain below swap input');
  const project0Capacity = BigInt((await rpc(FORK, 'getTokenAccountBalance',
    [PROJECT0_VAULT.toBase58()])).value.amount);
  const requestedProject0 = process.env.ORCA_ECONOMIC_P0_AMOUNT_LAMPORTS;
  const project0Amount = requestedProject0
    ? BigInt(requestedProject0)
    : input / 10n < project0Capacity ? input / 10n : project0Capacity;
  const amounts = {
    save: 0n,
    project0: project0Amount,
    klend: input - project0Amount,
  };
  if (amounts.project0 <= 0n || amounts.klend <= 0n ||
      amounts.project0 > project0Capacity)
    throw new Error('Input too small for two zero-fee providers');
  // This funds only local native SOL for rent and an explicitly wrapped cushion.
  // The first swap still requires both borrowed WSOL principals.
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false,
    lamports: Number(cushion + 2_000_000_000n),
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  // Mark the two fresh token-account addresses as absent locally, preventing
  // Surfpool from querying the remote RPC for accounts that cannot yet exist.
  for (const address of [ataA, ataB, margin.publicKey])
    await rpc(FORK, 'surfnet_setAccount', [
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
  for (const address of [positionMint.publicKey, ownedPosition, positionNftAta])
    await rpc(FORK, 'surfnet_setAccount', [address.toBase58(), {
      data: '', executable: false, lamports: 0,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
  const positionSetupBlockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const positionSetup = new Transaction({feePayer: actor.publicKey,
    recentBlockhash: positionSetupBlockhash});
  positionSetup.add(openOwnedPosition(actor, positionMint, ownedPosition,
    positionBump, positionNftAta));
  positionSetup.sign(actor, positionMint);
  const positionSetupSignature = await rpc(FORK, 'sendTransaction', [
    positionSetup.serialize().toString('base64'),
    {encoding: 'base64', skipPreflight: false, preflightCommitment: 'processed'},
  ]);
  const nftAmount = (await rpc(FORK, 'getTokenAccountBalance',
    [positionNftAta.toBase58()])).value.amount;
  if (nftAmount !== '1') throw new Error('Actor-owned NFT position was not created');
  const beforeBorrow = PREPARE_ATAS ? [] : [
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey,
      toPubkey: ataA, lamports: cushion}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const payloadInstructions = [
    swap(actor, ataA, ataB, input, true, true),
    ownedLiquidityChange('increase_liquidity', actor, ownedPosition,
      positionNftAta, ataA, ataB),
    swap(actor, ataA, ataB, 1_000_000_000n, true, true),
    updateOwnedPosition(ownedPosition),
    swap(actor, ataA, ataB, 1_000_000_000n, true, true),
    updateOwnedPosition(ownedPosition),
    ownedLiquidityChange('decrease_liquidity', actor, ownedPosition,
      positionNftAta, ataA, ataB),
    collectOwnedFees(actor, ownedPosition, positionNftAta, ataA, ataB),
    swap(actor, ataA, ataB,
      input * 98n / 100n + 2_000_000_000n, false, false),
  ];
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const envelope = buildFlashEnvelope({actor, marginAccount: margin,
    providers: ['klend', 'project0'], amounts, beforeBorrow,
    createWsolAta: !PREPARE_ATAS,
    saveFeeTopup: false,
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
    [POOL, ownedPosition, positionNftAta, ataA, ataB, WSOL_VAULT,
      USDC_VAULT, KLEND_FEE_VAULT]);
  const swaps = result.logs.filter(line =>
    line.includes('Program log: Instruction: Swap')).length;
  const updates = result.logs.filter(line =>
    line.includes('Program log: Instruction: UpdateFeesAndRewards')).length;
  const increases = result.logs.filter(line =>
    line.includes('Program log: Instruction: IncreaseLiquidity')).length;
  const decreases = result.logs.filter(line =>
    line.includes('Program log: Instruction: DecreaseLiquidity')).length;
  const collects = result.logs.filter(line =>
    line.includes('Program log: Instruction: CollectFees')).length;
  const firstFailure = result.logs.find(line => /failed:|Error Code:|Program log: Error/i.test(line));
  const at = address => result.watched.indexOf(address.toBase58());
  const accountAt = (array, address) => array[at(address)];
  const ownedPositionAfter = positionImage(accountAt(result.afterAccounts,
    ownedPosition));
  const pass = !result.err && result.completeRepayment && swaps === 4 &&
    updates === 2 && collects === 1 &&
    ownedPositionAfter?.liquidity === '0' &&
    result.lenderVaultDeltas[KLEND_FEE_VAULT.toBase58()] === '0';
  const ledger = SEND_LOCAL && pass
    ? await localLedgerSend(envelope, result, input, setupSignature,
        positionSetupSignature, ownedPosition) : null;
  return {inputLamports: String(input), cushionLamports: String(cushion),
    allocation: ALLOCATION, providerMode: PROVIDER_MODE, tickMode: TICK_MODE,
    setupSignature, positionSetupSignature, ledger,
    positionMint: positionMint.publicKey.toBase58(),
    positionNftAta: positionNftAta.toBase58(),
    ownedPosition: ownedPosition.toBase58(), nftAmount,
    liquidity: String(POSITION_LIQUIDITY),
    saveFeeLamports: '0',
    borrowedLamports: Object.fromEntries(Object.entries(amounts)
      .map(([name, value]) => [name, String(value)])),
    actor: actor.publicKey.toBase58(),
    actorWsolAta: ataA.toBase58(),
    err: result.err, firstFailure: firstFailure || null,
    whirlpoolSwaps: swaps, whirlpoolUpdates: updates,
    whirlpoolIncreases: increases, whirlpoolDecreases: decreases,
    whirlpoolCollects: collects,
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
    positionBefore: positionImage(accountAt(result.beforeAccounts, ownedPosition)),
    positionAfter: ownedPositionAfter,
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
      increases: row.whirlpoolIncreases, decreases: row.whirlpoolDecreases,
      collects: row.whirlpoolCollects,
      cu: row.unitsConsumed, wire: row.wire}));
    fs.writeFileSync(OUT, `${JSON.stringify({
      schema: 'orca-pr1396-economic-max-sweep/v1',
      execution: 'signed v1 simulation on separate local mainnet-backed Surfpool fork',
      mainnetSubmission: false, fork: FORK, allocation: ALLOCATION,
      providerMode: PROVIDER_MODE, preparedAtas: PREPARE_ATAS,
      tickMode: TICK_MODE,
      syncedSaveState,
      pool: POOL.toBase58(), rows,
    }, null, 2)}\n`);
  }
}

main().catch(error => {console.error(safeError(error)); process.exitCode = 1;});
