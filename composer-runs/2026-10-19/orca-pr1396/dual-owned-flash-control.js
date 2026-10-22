#!/usr/bin/env node
'use strict';

// Local mainnet-backed fork only. This is a direct-Whirlpool second-hop
// account-mechanics control; Jupiter cannot see positions created only here.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MOD}/@solana/spl-token`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');
const FORK = process.env.ORCA_DUAL_OWNED_FORK || 'http://127.0.0.1:64341';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw Error('Local fork only');
const OUT = path.join(__dirname, 'dual-owned-flash-control.json');
const PROGRAM = new PublicKey(PROGRAMS.whirlpool);
const WSOL = new PublicKey(PROGRAMS.wsol);
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const actor = Keypair.fromSeed(crypto.createHash('sha256').update('orca-pr1396-jupiter-atomic-test-v1').digest());
const margin = Keypair.fromSeed(crypto.createHash('sha256').update('orca-pr1396-dual-owned-margin-v1').digest());
const ataA = getAssociatedTokenAddressSync(WSOL, actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC, actor.publicKey);
const key = (pubkey, isWritable = false, isSigner = false) => ({pubkey, isWritable, isSigner});
const D = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u128 = (buf, off) => buf.readBigUInt64LE(off) + (buf.readBigUInt64LE(off + 8) << 64n);
const L = 1_240_000_000n;
const POOLS = [
  {name: 'owned_first_3PRT', address: new PublicKey('3PRT79bw3hoMd9S4uC8mPTKvJVgqGa2NuS7ZLX92RFNn')},
  {name: 'owned_second_BSdd', address: new PublicKey('BSddxwYW73as8852ZTHRH13pbZEmZ96NBjayc5mSVtkZ')},
];
for (const pool of POOLS) {
  pool.mint = Keypair.fromSeed(crypto.createHash('sha256').update(`orca-pr1396-${pool.name}-position-mint`).digest());
  [pool.position, pool.bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), pool.mint.publicKey.toBuffer()], PROGRAM);
  pool.nftAta = getAssociatedTokenAddressSync(pool.mint.publicKey, actor.publicKey);
  [pool.oracle] = PublicKey.findProgramAddressSync([Buffer.from('oracle'), pool.address.toBuffer()], PROGRAM);
  pool.arrayNeg = PublicKey.findProgramAddressSync([Buffer.from('tick_array'), pool.address.toBuffer(),
    Buffer.from('-2894848')], PROGRAM)[0];
  pool.arrayPos = PublicKey.findProgramAddressSync([Buffer.from('tick_array'), pool.address.toBuffer(),
    Buffer.from('0')], PROGRAM)[0];
}

function token(account) {
  if (!account || account.owner !== TOKEN_PROGRAM_ID.toBase58()) return null;
  return Buffer.from(account.data[0], 'base64').readBigUInt64LE(64);
}
function positionImage(account) {
  if (!account) return null;
  const d = Buffer.from(account.data[0], 'base64');
  return {liquidity: String(u128(d, 72)), feeOwedA: String(d.readBigUInt64LE(112)),
    feeOwedB: String(d.readBigUInt64LE(136))};
}
async function get(address) {
  return (await rpc(FORK, 'getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}])).value;
}
async function image() {
  const addresses = [ataA, ataB, ...POOLS.flatMap(p => [p.address, p.vaultA, p.vaultB, p.position])];
  const {value} = await rpc(FORK, 'getMultipleAccounts', [addresses.map(x => x.toBase58()),
    {encoding: 'base64', commitment: 'processed'}]);
  const obj = {};
  addresses.forEach((a, i) => {
    if (a.equals(ataA) || a.equals(ataB) || POOLS.some(p => a.equals(p.vaultA) || a.equals(p.vaultB)))
      obj[a.toBase58()] = value[i] ? String(token(value[i])) : null;
    else if (POOLS.some(p => a.equals(p.position))) obj[a.toBase58()] = positionImage(value[i]);
    else if (value[i]) {
      const d = Buffer.from(value[i].data[0], 'base64');
      obj[a.toBase58()] = {liquidity: String(u128(d, 49)), sqrt: String(u128(d, 65)),
        tick: d.readInt32LE(81), feeRate: d.readUInt16LE(45), protocolFeeRate: d.readUInt16LE(47)};
    }
  });
  return obj;
}
async function send(label, ixs, signers = []) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const enc = encodeV1(ixs, actor.publicKey, blockhash, 1_400_000);
  const signed = signV1(enc, ixs, actor.publicKey, blockhash, [actor, ...signers]);
  const sim = (await rpc(FORK, 'simulateTransaction', [signed.wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed'}])).value;
  const row = {label, bytes: enc.sizeBytes, simError: sim.err, simCU: sim.unitsConsumed,
    simTail: sim.logs?.slice(-14)};
  if (sim.err) return row;
  row.signature = await rpc(FORK, 'sendTransaction', [signed.wire.toString('base64'),
    {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
  for (let i = 0; i < 20; i++) {
    const tx = await rpc(FORK, 'getTransaction', [row.signature,
      {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
    if (tx) { row.slot = tx.slot; row.error = tx.meta.err; row.cu = tx.meta.computeUnitsConsumed; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return row;
}
function open(pool) {
  const data = Buffer.alloc(17); D('open_position').copy(data); data[8] = pool.bump;
  data.writeInt32LE(-427648, 9); data.writeInt32LE(427648, 13);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(actor.publicKey, true, true), key(actor.publicKey), key(pool.position, true),
    key(pool.mint.publicKey, true, true), key(pool.nftAta, true), key(pool.address),
    key(TOKEN_PROGRAM_ID), key(SystemProgram.programId),
    key(new PublicKey('SysvarRent111111111111111111111111111111111')),
    key(ASSOCIATED_TOKEN_PROGRAM_ID),
  ]});
}
function liquidity(pool, increasing) {
  const data = Buffer.alloc(40); D(increasing ? 'increase_liquidity' : 'decrease_liquidity').copy(data);
  data.writeBigUInt64LE(L, 8);
  data.writeBigUInt64LE(increasing ? 10_000_000_000n : 0n, 24);
  data.writeBigUInt64LE(increasing ? 1_000_000_000n : 0n, 32);
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(pool.address, true), key(TOKEN_PROGRAM_ID), key(actor.publicKey, false, true),
    key(pool.position, true), key(pool.nftAta), key(ataA, true), key(ataB, true),
    key(pool.vaultA, true), key(pool.vaultB, true), key(pool.arrayNeg, true), key(pool.arrayPos, true),
  ]});
}
function collect(pool) {
  return new TransactionInstruction({programId: PROGRAM, data: D('collect_fees'), keys: [
    key(pool.address), key(actor.publicKey, false, true), key(pool.position, true), key(pool.nftAta),
    key(ataA, true), key(pool.vaultA, true), key(ataB, true), key(pool.vaultB, true), key(TOKEN_PROGRAM_ID),
  ]});
}
function swap(pool, amount, aToB, exactInput = true) {
  const data = Buffer.alloc(42); D('swap').copy(data);
  data.writeBigUInt64LE(amount, 8);
  data[40] = exactInput ? 1 : 0; data[41] = aToB ? 1 : 0;
  const arrays = aToB ? [pool.arrayNeg, pool.arrayNeg, pool.arrayNeg]
    : [pool.arrayNeg, pool.arrayPos, pool.arrayPos];
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(TOKEN_PROGRAM_ID), key(actor.publicKey, false, true), key(pool.address, true),
    key(ataA, true), key(pool.vaultA, true), key(ataB, true), key(pool.vaultB, true),
    ...arrays.map(a => key(a, true)), key(pool.oracle),
  ]});
}
async function setAbsence(address) {
  await rpc(FORK, 'surfnet_setAccount', [address.toBase58(), {data: '', executable: false,
    lamports: 0, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
}
async function setTokenAmount(address, amount, nativeEmpty = false) {
  const info = await get(address); const data = Buffer.from(info.data[0], 'base64');
  data.writeBigUInt64LE(amount, 64);
  const reserve = data.readUInt32LE(109) === 1 ? Number(data.readBigUInt64LE(113)) : info.lamports;
  await rpc(FORK, 'surfnet_setAccount', [address.toBase58(), {data: data.toString('hex'),
    executable: false, lamports: nativeEmpty ? reserve : info.lamports,
    owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0}]);
}
async function main() {
  if (await rpc(FORK, 'getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw Error('Not a mainnet-backed local fork');
  for (const pool of POOLS) {
    const info = await get(pool.address); const d = Buffer.from(info.data[0], 'base64');
    pool.vaultA = new PublicKey(d.subarray(133, 165));
    pool.vaultB = new PublicKey(d.subarray(213, 245));
    if (!new PublicKey(d.subarray(101, 133)).equals(WSOL) ||
        !new PublicKey(d.subarray(181, 213)).equals(USDC)) throw Error('Unexpected pool mints');
    if (d.readUInt16LE(45) !== 0 || d.readUInt16LE(47) !== 0)
      throw Error(`${pool.name} is not zero fee/protocol on this fork`);
    for (const address of [pool.arrayNeg, pool.arrayPos])
      if (!await get(address)) throw Error(`Missing tick array ${address}`);
  }
  let setup = null;
  const creations = [];
  let preZero = null;
  if (process.env.ORCA_DUAL_RESUME !== '1') {
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports: 15_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  for (const address of [ataA, ataB, margin.publicKey,
    ...POOLS.flatMap(p => [p.mint.publicKey, p.position, p.nftAta])])
    await setAbsence(address);
  setup = await send('create ATAs and wrap 9 SOL', [
    createAssociatedTokenAccountIdempotentInstruction(actor.publicKey, ataA, actor.publicKey, WSOL),
    createAssociatedTokenAccountIdempotentInstruction(actor.publicKey, ataB, actor.publicKey, USDC),
    SystemProgram.transfer({fromPubkey: actor.publicKey, toPubkey: ataA, lamports: 9_000_000_000n}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID, keys: [key(ataA, true)], data: Buffer.from([17])}),
  ]);
  if (setup.simError || setup.error) throw Error(`ATA setup failed ${JSON.stringify(setup)}`);
  await setTokenAmount(ataB, 1_000_000_000n);
  for (const pool of POOLS) {
    const receipt = await send(`open and fund ${pool.name}`, [open(pool), liquidity(pool, true)], [pool.mint]);
    creations.push(receipt);
    if (receipt.simError || receipt.error) throw Error(`LP setup failed ${JSON.stringify(receipt)}`);
  }
  preZero = await image();
  // Fork-only removal of unused liquid setup funds; preserve genuine deposited LPs.
  await setTokenAmount(ataA, 0n, true);
  await setTokenAmount(ataB, 0n);
  }
  const prepared = await image();
  const borrow = 6_271_347_260_340n;
  // Compute exact first-leg output by simulation before filling the second leg.
  const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const firstPayload = [swap(POOLS[0], borrow, true)];
  const common = {actor, marginAccount: margin, providers: ['klend', 'project0'],
    amounts: {klend: 5_742_317_260_340n, project0: 529_030_000_000n},
    blockhash, createWsolAta: false, saveFeeTopup: false};
  const firstEnvelope = buildFlashEnvelope({...common, payloadInstructions: firstPayload});
  const first = await simulateFlashEnvelope(FORK, firstEnvelope,
    [ataA, ataB, POOLS[0].address, POOLS[0].vaultA, POOLS[0].vaultB]);
  // A first-leg-only flash cannot repay. An instruction log and post-sim token
  // image are still available only if execution reached the swap; otherwise quote below.
  let firstOutput = null;
  const idxB = first.watched.indexOf(ataB.toBase58());
  if (idxB >= 0 && first.afterAccounts[idxB]) firstOutput = token(first.afterAccounts[idxB]);
  if (!firstOutput || firstOutput <= 0n) {
    const {Connection} = require(`${MOD}/@solana/web3.js`);
    const anchor = require(`${MOD}/@coral-xyz/anchor`);
    const sdk = require(`${MOD}/@orca-so/whirlpools-sdk`);
    const {Percentage} = require(`${MOD}/@orca-so/common-sdk`);
    const BN = require(`${MOD}/bn.js`);
    const ctx = sdk.WhirlpoolContext.from(new Connection(FORK, 'processed'),
      new anchor.Wallet(actor), undefined, undefined,
      {userDefaultConfirmCommitment: 'processed'}, PROGRAM);
    const client = sdk.buildWhirlpoolClient(ctx);
    const pool = await client.getPool(POOLS[0].address, sdk.IGNORE_CACHE);
    const quote = await sdk.swapQuoteByInputToken(pool, WSOL, new BN(String(borrow)),
      Percentage.fromFraction(1, 100), PROGRAM, ctx.fetcher, sdk.IGNORE_CACHE);
    firstOutput = BigInt(quote.estimatedAmountOut.toString());
  }
  const payload = [swap(POOLS[0], borrow, true), swap(POOLS[1], firstOutput, false),
    liquidity(POOLS[0], false), collect(POOLS[0]),
    liquidity(POOLS[1], false), collect(POOLS[1])];
  const envelope = buildFlashEnvelope({...common, payloadInstructions: payload});
  const watch = [ataA, ataB, ...POOLS.flatMap(p => [p.address, p.vaultA, p.vaultB, p.position])];
  const sim = await simulateFlashEnvelope(FORK, envelope, watch);
  const afterSim = Object.fromEntries(watch.map(a => [a.toBase58(), (() => {
    const i = sim.watched.indexOf(a.toBase58());
    const account = sim.afterAccounts[i];
    return POOLS.some(p => p.position.equals(a)) ? positionImage(account) :
      POOLS.some(p => p.address.equals(a)) ? account ? {
        L: String(u128(Buffer.from(account.data[0], 'base64'), 49)),
        tick: Buffer.from(account.data[0], 'base64').readInt32LE(81)} : null :
      account ? String(token(account)) : null;
  })()]));
  const result = {schema: 'orca-dual-owned-zero-fee-flash-control/v1',
    mainnetSubmission: false, fork: FORK, secondLeg: 'direct Whirlpool control; not Jupiter Router',
    actor: actor.publicKey.toBase58(), pool1: POOLS[0].address.toBase58(),
    pool2: POOLS[1].address.toBase58(), liquidityEach: String(L),
    positions: POOLS.map(p => ({pool: p.address.toBase58(), position: p.position.toBase58(),
      mint: p.mint.publicKey.toBase58(), vaultA: p.vaultA.toBase58(), vaultB: p.vaultB.toBase58()})),
    setup, creations, preZero, prepared, borrowLamports: String(borrow),
    firstLegEstimatedUsdcRaw: String(firstOutput),
    firstLegTrial: {err: first.err, logs: first.logs?.slice(-14)},
    simulation: {err: sim.err, completeRepayment: sim.completeRepayment,
      unitsConsumed: sim.unitsConsumed, firstFailure: sim.logs.find(x => /failed:|Error Code:/i.test(x)),
      logs: sim.logs, after: afterSim, lenderVaultDeltas: sim.lenderVaultDeltas},
    envelope: {stats: envelope.stats, index: envelope.index,
      instructionNames: envelope.instructions.map(ix => ix.programId.toBase58() === PROGRAM.toBase58()
        ? ix.data.subarray(0, 8).toString('hex') : ix.programId.toBase58())},
  };
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  if (!sim.err && sim.completeRepayment) {
    // Surfpool's ledger send path needs explicit local images for absent
    // accounts, even when the simulation path has already succeeded.
    const programKeys = new Set(envelope.instructions.map(ix => ix.programId.toBase58()));
    result.seededAbsentAccounts = [];
    for (const address of [...new Set(envelope.instructions.flatMap(ix =>
      ix.keys.map(k => k.pubkey.toBase58())))]) {
      if (programKeys.has(address)) continue;
      const info = await rpc(FORK, 'getAccountInfo', [address,
        {encoding: 'base64', commitment: 'processed'}]);
      if (info.value) continue;
      await setAbsence(new PublicKey(address));
      result.seededAbsentAccounts.push(address);
    }
    fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    result.signature = await rpc(FORK, 'sendTransaction', [envelope.wire.toString('base64'),
      {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
    let tx;
    for (let i = 0; i < 20; i++) {
      tx = await rpc(FORK, 'getTransaction', [result.signature,
        {encoding: 'json', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
      if (tx) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    result.committed = {slot: tx?.slot, error: tx?.meta?.err, version: tx?.version,
      cu: tx?.meta?.computeUnitsConsumed, feeLamports: tx?.meta?.fee};
    result.after = await image();
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, creations, preZero, prepared,
    firstOutput: String(firstOutput), simError: sim.err, completeRepayment: sim.completeRepayment,
    cu: sim.unitsConsumed, bytes: envelope.stats.bytes, committed: result.committed,
    after: result.after, failure: result.simulation.firstFailure}));
}
main().catch(e => {console.error(String(e.stack || e).replace(/api-key=[^&\s"']+/gi,
  'api-key=[REDACTED]')); process.exitCode = 1;});
