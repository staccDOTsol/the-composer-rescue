#!/usr/bin/env node
'use strict';

// After the dual-owned local-fork flash, restore both displayed spots using
// only the actor's resulting token balances and the remaining outsider LPs.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync} = require(`${MOD}/@solana/spl-token`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc, PROGRAMS} = require('./real-flash-envelope.js');
const FORK = process.env.ORCA_DUAL_ARB_FORK || 'http://127.0.0.1:64341';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw Error('Local fork only');
const PROGRAM = new PublicKey(PROGRAMS.whirlpool);
const WSOL = new PublicKey(PROGRAMS.wsol);
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const actor = Keypair.fromSeed(crypto.createHash('sha256').update('orca-pr1396-jupiter-atomic-test-v1').digest());
const ataA = getAssociatedTokenAddressSync(WSOL, actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC, actor.publicKey);
const CONTROL = path.join(__dirname, 'dual-owned-flash-control.json');
const AUDIT = path.join(__dirname, 'dual-owned-flash-ledger.json');
const OUT = path.join(__dirname, 'dual-owned-self-arb.json');
const control = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));
const pools = control.positions.map((p, i) => ({
  address: new PublicKey(p.pool), vaultA: new PublicKey(p.vaultA),
  vaultB: new PublicKey(p.vaultB), target: BigInt(control.prepared[p.pool].sqrt),
  arrayNeg: PublicKey.findProgramAddressSync([Buffer.from('tick_array'),
    new PublicKey(p.pool).toBuffer(), Buffer.from('-2894848')], PROGRAM)[0],
  arrayPos: PublicKey.findProgramAddressSync([Buffer.from('tick_array'),
    new PublicKey(p.pool).toBuffer(), Buffer.from('0')], PROGRAM)[0],
  oracle: PublicKey.findProgramAddressSync([Buffer.from('oracle'),
    new PublicKey(p.pool).toBuffer()], PROGRAM)[0], index: i,
}));
const key = (pubkey, isWritable = false, isSigner = false) => ({pubkey, isWritable, isSigner});
const D = crypto.createHash('sha256').update('global:swap').digest().subarray(0, 8);
const u128 = (d, o) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);
function swap(pool, amount, aToB) {
  const data = Buffer.alloc(42); D.copy(data); data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(pool.target & ((1n << 64n) - 1n), 24);
  data.writeBigUInt64LE(pool.target >> 64n, 32);
  data[40] = 1; data[41] = aToB ? 1 : 0;
  const arrays = aToB ? [pool.arrayNeg, pool.arrayNeg, pool.arrayNeg]
    : [pool.arrayNeg, pool.arrayPos, pool.arrayPos];
  return new TransactionInstruction({programId: PROGRAM, data, keys: [
    key(TOKEN_PROGRAM_ID), key(actor.publicKey, false, true),
    key(pool.address, true), key(ataA, true), key(pool.vaultA, true),
    key(ataB, true), key(pool.vaultB, true),
    ...arrays.map(x => key(x, true)), key(pool.oracle),
  ]});
}
async function image() {
  const addresses = [ataA, ataB, ...pools.flatMap(p => [p.address, p.vaultA, p.vaultB])];
  const {value} = await rpc(FORK, 'getMultipleAccounts', [addresses.map(a => a.toBase58()),
    {encoding: 'base64', commitment: 'processed'}]);
  return Object.fromEntries(addresses.map((a, i) => {
    const d = Buffer.from(value[i].data[0], 'base64');
    return [a.toBase58(), pools.some(p => p.address.equals(a)) ?
      {L: String(u128(d, 49)), sqrt: String(u128(d, 65)), tick: d.readInt32LE(81)} :
      String(d.readBigUInt64LE(64))];
  }));
}
async function main() {
  if (await rpc(FORK, 'getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw Error('Not mainnet-backed fork');
  const before = await image();
  if (before[ataA.toBase58()] !== audit.atomicReceipt.actorTokenAfter.wsolLamports ||
      before[ataB.toBase58()] !== audit.atomicReceipt.actorTokenAfter.usdcRaw)
    throw Error('Fork is not at immediately post-dual-owned state');
  const ixs = [swap(pools[0], 1_000_000n, false), swap(pools[1], 2_000_000_000n, true)];
  const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(ixs, actor.publicKey, blockhash, 1_400_000);
  const signed = signV1(encoded, ixs, actor.publicKey, blockhash, [actor]);
  const simulated = (await rpc(FORK, 'simulateTransaction', [signed.wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed'}])).value;
  const result = {schema: 'orca-dual-owned-outsider-self-arb/v1', mainnetSubmission: false,
    fork: FORK, precedingAtomicSignature: audit.atomicReceipt.signature,
    actor: actor.publicKey.toBase58(), targetSqrt: pools.map(p => String(p.target)),
    inputCaps: {pool1UsdcRaw: '1000000', pool2WsolLamports: '2000000000'},
    before, simulation: {err: simulated.err, cu: simulated.unitsConsumed,
      logs: simulated.logs?.slice(-20)}, wire: {version: 1, bytes: encoded.sizeBytes,
      sha256: crypto.createHash('sha256').update(signed.wire).digest('hex')}};
  if (!simulated.err) {
    result.signature = await rpc(FORK, 'sendTransaction', [signed.wire.toString('base64'),
      {encoding: 'base64', skipPreflight: true, preflightCommitment: 'processed'}]);
    let tx;
    for (let i = 0; i < 20; i++) {
      tx = await rpc(FORK, 'getTransaction', [result.signature,
        {encoding: 'jsonParsed', commitment: 'processed', maxSupportedTransactionVersion: 1}]);
      if (tx) break; await new Promise(resolve => setTimeout(resolve, 200));
    }
    result.committed = {slot: tx?.slot, version: tx?.version, err: tx?.meta?.err,
      cu: tx?.meta?.computeUnitsConsumed, feeLamports: tx?.meta?.fee,
      tokenTransfers: (tx?.meta?.innerInstructions || []).flatMap(g => g.instructions
        .filter(ix => ix.parsed?.type === 'transfer' && ix.parsed?.info?.amount)
        .map(ix => ({index: g.index, ...ix.parsed.info})))};
    result.after = await image();
    const finalA = BigInt(result.after[ataA.toBase58()]);
    const finalB = BigInt(result.after[ataB.toBase58()]);
    const initialA = BigInt(audit.depositedTotal.wsolLamports);
    const initialB = BigInt(audit.depositedTotal.usdcRaw);
    const consolidated = {wsolLamports: String(finalA - initialA),
      usdcRaw: String(finalB - initialB)};
    result.consolidatedDeltaAfterSelfArb = consolidated;
    result.illustrativeUsdChangeAt104_5 = Number(finalA - initialA) / 1e9 * 104.5 +
      Number(finalB - initialB) / 1e6;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, sim: result.simulation,
    committed: result.committed, after: result.after,
    consolidated: result.consolidatedDeltaAfterSelfArb,
    usd: result.illustrativeUsdChangeAt104_5}));
}
main().catch(error => {console.error(String(error.stack || error).replace(/api-key=[^&\s"']+/gi,
  'api-key=[REDACTED]')); process.exitCode = 1;});
