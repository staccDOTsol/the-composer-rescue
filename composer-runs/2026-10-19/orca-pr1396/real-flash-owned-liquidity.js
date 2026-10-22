#!/usr/bin/env node
'use strict';

// On the local fork only: open an actor-owned position in a separate real v1
// setup transaction, then add/remove its liquidity inside one signed v1
// Save+KLend+Project0 flash-loan transaction with genuine Whirlpool swaps.

const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {PublicKey, SystemProgram, TransactionInstruction} = require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync} = require(`${MODULES}/@solana/spl-token`);
const base58Package = require(`${MODULES}/bs58`);
const base58 = base58Package.default || base58Package;
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');
const {FORK, POOL, WSOL_VAULT, USDC_MINT, USDC_VAULT,
  swap, tokenAmount, positionImage} = require('./real-flash-swap-roundtrip.js');
const {remap, poolImage, accountImages, seed} = require('./real-flash-cycle-ceiling.js');

if (FORK !== 'http://127.0.0.1:48899') throw new Error('Local fork :48899 only');
const OUT = path.join(__dirname, 'real-flash-owned-liquidity.json');
const whirlpoolProgram = new PublicKey(PROGRAMS.whirlpool);
const actor = seed('orca-pr1396-optimized-cycle-actor-2026-10-19');
const margin = seed('orca-pr1396-optimized-cycle-margin-2026-10-19');
const mint = seed('orca-pr1396-flash-owned-position-mint-2026-10-19');
const [position, positionBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('position'), mint.publicKey.toBuffer()], whirlpoolProgram);
const positionNftAta = getAssociatedTokenAddressSync(mint.publicKey, actor.publicKey);
const ataA = getAssociatedTokenAddressSync(new PublicKey(PROGRAMS.wsol), actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
const lowerIndex = -22880;
const upperIndex = -22528;
const [lowerArray] = PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(lowerIndex))], whirlpoolProgram);
const [upperArray] = PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(upperIndex))], whirlpoolProgram);
const key = (pubkey, isWritable = false, isSigner = false) => ({pubkey, isWritable, isSigner});
const D = name => require('crypto').createHash('sha256')
  .update(`global:${name}`).digest().subarray(0, 8);

function openPosition() {
  const data = Buffer.alloc(17);
  D('open_position').copy(data);
  data[8] = positionBump;
  data.writeInt32LE(lowerIndex, 9);
  data.writeInt32LE(upperIndex, 13);
  return new TransactionInstruction({programId: whirlpoolProgram, data,
    keys: [
      key(actor.publicKey, true, true), key(actor.publicKey),
      key(position, true), key(mint.publicKey, true, true),
      key(positionNftAta, true), key(POOL), key(TOKEN_PROGRAM_ID),
      key(SystemProgram.programId),
      key(new PublicKey('SysvarRent111111111111111111111111111111111')),
      key(ASSOCIATED_TOKEN_PROGRAM_ID),
    ]});
}

function liquidityChange(name, liquidity) {
  const data = Buffer.alloc(40);
  D(name).copy(data);
  data.writeBigUInt64LE(BigInt(liquidity), 8);
  data.writeBigUInt64LE(0n, 16);
  data.writeBigUInt64LE(name === 'increase_liquidity' ? 500_000_000n : 0n, 24);
  data.writeBigUInt64LE(name === 'increase_liquidity' ? 100_000_000n : 0n, 32);
  return new TransactionInstruction({programId: whirlpoolProgram, data,
    keys: [
      key(POOL, true), key(TOKEN_PROGRAM_ID), key(actor.publicKey, false, true),
      key(position, true), key(positionNftAta),
      key(ataA, true), key(ataB, true),
      key(WSOL_VAULT, true), key(USDC_VAULT, true),
      key(lowerArray, true), key(upperArray, true),
    ]});
}

function updatePosition() {
  return new TransactionInstruction({programId: whirlpoolProgram,
    keys: [key(POOL, true), key(position, true),
      key(lowerArray), key(upperArray)],
    data: D('update_fees_and_rewards')});
}

async function seedAbsent(instructions) {
  const programs = new Set(instructions.map(ix => ix.programId.toBase58()));
  const keys = [...new Set(instructions.flatMap(ix =>
    ix.keys.map(meta => meta.pubkey.toBase58())))];
  const seeded = [];
  for (const address of keys) {
    if (programs.has(address)) continue;
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

async function setup() {
  const existingPosition = (await rpc(FORK, 'getAccountInfo', [position.toBase58(),
    {encoding: 'base64'}])).value;
  if (existingPosition) {
    const nftAmount = (await rpc(FORK, 'getTokenAccountBalance',
      [positionNftAta.toBase58()])).value.amount;
    if (nftAmount !== '1') throw new Error('Existing position NFT authority is missing');
    if (!fs.existsSync(OUT)) throw new Error('Existing position lacks a prior setup receipt');
    return JSON.parse(fs.readFileSync(OUT, 'utf8')).setup;
  }
  const account = await rpc(FORK, 'getAccountInfo', [margin.publicKey.toBase58(),
    {encoding: 'base64'}]);
  if (!account.value) throw new Error('Run real-flash-cycle-optimized.js first to initialize margin/token accounts');
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const instructions = [openPosition()];
  const encoded = encodeV1(instructions, actor.publicKey, blockhash, 500_000);
  const signed = signV1(encoded, instructions, actor.publicKey, blockhash,
    [actor, mint]);
  const seededAbsentAccounts = await seedAbsent(instructions);
  const sim = await rpc(FORK, 'simulateTransaction', [signed.wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed'}]);
  if (sim.value.err) throw new Error(`OpenPosition simulation failed: ${JSON.stringify(sim.value.err)}; ${sim.value.logs?.slice(-8).join(' | ')}`);
  const {signature, tx} = await send(signed.wire);
  if (!tx || tx.meta.err) throw new Error(`OpenPosition send failed: ${JSON.stringify(tx?.meta?.err)}`);
  const pos = await rpc(FORK, 'getAccountInfo', [position.toBase58(),
    {encoding: 'base64'}]);
  const nft = (await rpc(FORK, 'getTokenAccountBalance',
    [positionNftAta.toBase58()])).value.amount;
  if (!pos.value || nft !== '1') throw new Error('Position NFT setup did not commit');
  return {signature, version: tx.version, slot: tx.slot, err: tx.meta.err,
    unitsConsumed: tx.meta.computeUnitsConsumed,
    signedWireBase64: signed.wire.toString('base64'),
    seededAbsentAccounts, positionBefore: positionImage(pos.value),
    positionNftRaw: nft, logs: tx.meta.logMessages || []};
}

function payload(liquidity) {
  return [
    remap(swap({amount: 1_000_000_000n, exactInput: true, aToB: true,
      otherAmountThreshold: 0n}), actor, ataA, ataB),
    liquidityChange('increase_liquidity', liquidity),
    remap(swap({amount: 100_000_000n, exactInput: true, aToB: true,
      otherAmountThreshold: 0n}), actor, ataA, ataB),
    updatePosition(),
    liquidityChange('decrease_liquidity', liquidity),
    remap(swap({amount: 1_080_000_000n, exactInput: false, aToB: false,
      otherAmountThreshold: 0xffffffffffffffffn}), actor, ataA, ataB),
  ];
}

async function oneCase(liquidity) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const envelope = buildFlashEnvelope({actor, marginAccount: margin,
    providers: ['save', 'klend', 'project0'],
    amounts: {save: 1_000_000_000n, klend: 1_000_000_000n,
      project0: 1_000_000_000n},
    payloadInstructions: payload(liquidity), blockhash,
    initializeMargin: false, createWsolAta: false, saveFeeTopup: false});
  const watch = [POOL, position, WSOL_VAULT, USDC_VAULT, ataA, ataB];
  const sim = await simulateFlashEnvelope(FORK, envelope, watch);
  const at = address => sim.watched.indexOf(address.toBase58());
  const summary = {liquidity: String(liquidity), err: sim.err,
    completeRepayment: sim.completeRepayment,
    stats: sim.stats, unitsConsumed: sim.unitsConsumed,
    swapsLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: Swap')).length,
    increasesLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: IncreaseLiquidity')).length,
    decreasesLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: DecreaseLiquidity')).length,
    updatesLogged: sim.logs.filter(line =>
      line.includes('Program log: Instruction: UpdateFeesAndRewards')).length,
    actorWsolBefore: tokenAmount(sim.beforeAccounts[at(ataA)]),
    actorWsolAfter: tokenAmount(sim.afterAccounts[at(ataA)]),
    actorUsdcBefore: tokenAmount(sim.beforeAccounts[at(ataB)]),
    actorUsdcAfter: tokenAmount(sim.afterAccounts[at(ataB)]),
    positionBefore: positionImage(sim.beforeAccounts[at(position)]),
    positionAfter: positionImage(sim.afterAccounts[at(position)]),
    poolBefore: poolImage(sim.beforeAccounts[at(POOL)]),
    poolAfter: poolImage(sim.afterAccounts[at(POOL)]),
    lenderVaultDeltas: sim.lenderVaultDeltas,
    finalLogs: sim.logs.slice(-10)};
  return {summary, envelope, watch};
}

async function commit(result) {
  const {envelope, watch} = result;
  const addresses = [...new Set([...Object.values(envelope.lenderAccounts),
    ...watch.map(value => value.toBase58())])];
  const before = await accountImages(addresses);
  const positionBefore = positionImage((await rpc(FORK, 'getAccountInfo',
    [position.toBase58(), {encoding: 'base64', commitment: 'processed'}])).value);
  const {signature, tx} = await send(envelope.wire);
  const after = await accountImages(addresses);
  const positionAfter = positionImage((await rpc(FORK, 'getAccountInfo',
    [position.toBase58(), {encoding: 'base64', commitment: 'processed'}])).value);
  const deltas = Object.fromEntries(addresses.map(address => [address,
    before[address].tokenAmount !== null && after[address].tokenAmount !== null
      ? String(BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount))
      : null]));
  const accountKeys = tx?.transaction?.message?.accountKeys || [];
  const liquidityTransfers = (tx?.meta?.innerInstructions || [])
    .filter(group => [5, 8].includes(group.index))
    .map(group => ({outerInstructionIndex: group.index,
      tokenTransfers: group.instructions.map(ix => {
        const data = Buffer.from(base58.decode(ix.data));
        return {program: accountKeys[ix.programIdIndex],
          from: accountKeys[ix.accounts[0]], to: accountKeys[ix.accounts[1]],
          amountRaw: data[0] === 3 ? String(data.readBigUInt64LE(1)) : null,
          tokenInstructionKind: data[0]};
      })}));
  return {signature, version: tx?.version ?? null, slot: tx?.slot ?? null,
    err: tx?.meta?.err ?? null, unitsConsumed: tx?.meta?.computeUnitsConsumed ?? null,
    signedWireBase64: envelope.wire.toString('base64'),
    before, after, positionBefore, positionAfter,
    tokenDeltas: deltas, liquidityTransfers,
    logs: tx?.meta?.logMessages || []};
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not mainnet genesis');
  const prepared = await setup();
  console.log(JSON.stringify({setupSignature: prepared.signature,
    setupErr: prepared.err, position: position.toBase58(), nftAmount: prepared.positionNftRaw}));
  const cases = [];
  const passing = [];
  for (const liquidity of [100_000_000n, 1_000_000_000n]) {
    const result = await oneCase(liquidity);
    cases.push(result.summary);
    if (!result.summary.err && result.summary.completeRepayment) passing.push(result);
    console.log(JSON.stringify({liquidity: String(liquidity),
      err: result.summary.err, completeRepayment: result.summary.completeRepayment,
      instructions: result.summary.stats.instructions,
      bytes: result.summary.stats.bytes,
      unitsConsumed: result.summary.unitsConsumed,
      swaps: result.summary.swapsLogged,
      increases: result.summary.increasesLogged,
      decreases: result.summary.decreasesLogged}));
  }
  const strongest = passing.at(-1);
  const committed = strongest ? await commit(strongest) : null;
  if (committed) console.log(JSON.stringify({signature: committed.signature,
    version: committed.version, err: committed.err,
    unitsConsumed: committed.unitsConsumed}));
  fs.writeFileSync(OUT, `${JSON.stringify({
    schema: 'orca-pr1396-real-flash-owned-liquidity/v1',
    execution: 'mainnet-backed local Surfpool fork', mainnetSubmission: false,
    actor: actor.publicKey.toBase58(), margin: margin.publicKey.toBase58(),
    pool: POOL.toBase58(), position: position.toBase58(),
    positionMint: mint.publicKey.toBase58(), positionNftAta: positionNftAta.toBase58(),
    wsolAta: ataA.toBase58(), usdcAta: ataB.toBase58(),
    setup: prepared, cases, strongest: strongest?.summary || null, committed,
  }, null, 2)}\n`);
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
