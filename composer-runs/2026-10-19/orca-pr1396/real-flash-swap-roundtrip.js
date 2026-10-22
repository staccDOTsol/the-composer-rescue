#!/usr/bin/env node
'use strict';

// Simulation only: real KLend and Project 0 WSOL loans fund two genuine
// Whirlpool swaps, with a permissionless LP checkpoint update between them.
// The borrower receives no WSOL token balance until the flash borrows.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, TransactionInstruction, SystemProgram} =
  require(`${MODULES}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MODULES}/@solana/spl-token`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');

const FORK = process.env.ORCA_FLASH_FORK || 'http://127.0.0.1:48899';
const POOL = new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');
const POSITION = new PublicKey('JDwC8tY9MPWnkevbCGFFVbodJAi7Bx55M6qwgqau4yaw');
const LOWER = new PublicKey('FTfe67qe9LJqsTrQHwGQHMXbxsCNgbzZFCW6czZBjAJ');
const UPPER = new PublicKey('9dLHNf8HAU4uM8YxdLxgiMSsPPQWQ6bzujKhttDoRnCp');
const CURRENT_ARRAY = new PublicKey('7T6JQngtMoLfPoxT6ZpbzY1uGiWkGPgwLC2vR1sTjPsn');
const WSOL_VAULT = new PublicKey('EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_VAULT = new PublicKey('2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP');
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-real-flash-swap-actor-2026-10-19').digest());
const margin = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-real-flash-swap-margin-2026-10-19').digest());
const D = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const key = (pubkey, isWritable, isSigner = false) => ({pubkey, isWritable, isSigner});
const ataA = getAssociatedTokenAddressSync(new PublicKey(PROGRAMS.wsol), actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC_MINT, actor.publicKey);
const [oracle] = PublicKey.findProgramAddressSync(
  [Buffer.from('oracle'), POOL.toBuffer()], new PublicKey(PROGRAMS.whirlpool));

function swap({amount, exactInput, aToB, otherAmountThreshold}) {
  const data = Buffer.alloc(42);
  D('swap').copy(data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  data.writeBigUInt64LE(otherAmountThreshold === undefined
    ? (aToB ? 0n : 1_000_000n) : BigInt(otherAmountThreshold), 16);
  data.writeBigUInt64LE(0n, 24); // sqrtPriceLimit u128 = 0, Orca's default
  data.writeBigUInt64LE(0n, 32);
  data[40] = exactInput ? 1 : 0;
  data[41] = aToB ? 1 : 0;
  return new TransactionInstruction({programId: new PublicKey(PROGRAMS.whirlpool),
    keys: [
      key(TOKEN_PROGRAM_ID, false), key(actor.publicKey, false, true),
      key(POOL, true), key(ataA, true), key(WSOL_VAULT, true),
      key(ataB, true), key(USDC_VAULT, true),
      key(CURRENT_ARRAY, true), key(CURRENT_ARRAY, true),
      key(CURRENT_ARRAY, true), key(oracle, false),
    ], data});
}

function update() {
  return new TransactionInstruction({programId: new PublicKey(PROGRAMS.whirlpool),
    keys: [key(POOL, true), key(POSITION, true), key(LOWER, false), key(UPPER, false)],
    data: D('update_fees_and_rewards')});
}

function tokenAmount(account) {
  if (!account || account.owner !== TOKEN_PROGRAM_ID.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length < 72 ? null : String(data.readBigUInt64LE(64));
}

function positionImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const u128 = offset => String(data.readBigUInt64LE(offset) +
    (data.readBigUInt64LE(offset + 8) << 64n));
  return {liquidity: u128(72), checkpointA: u128(96),
    feeOwedA: String(data.readBigUInt64LE(112)), checkpointB: u128(120),
    feeOwedB: String(data.readBigUInt64LE(136))};
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('The local fork is not Solana mainnet genesis');
  // Fork-only 1 SOL pays rent. WSOL fee cushion is just 30,000 lamports,
  // less than the first 1,000,000-lamport swap input.
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports: 1_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const beforeBorrow = [
    createAssociatedTokenAccountIdempotentInstruction(
      actor.publicKey, ataB, actor.publicKey, USDC_MINT),
    SystemProgram.transfer({fromPubkey: actor.publicKey,
      toPubkey: ataA, lamports: 30_000}),
    new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
      keys: [key(ataA, true)], data: Buffer.from([17])}),
  ];
  const payloadInstructions = [
    swap({amount: 1_000_000n, exactInput: true, aToB: true}),
    update(),
    swap({amount: 980_000n, exactInput: false, aToB: false}),
    update(),
  ];
  const cases = [];
  for (const providers of [['klend', 'project0'], ['save', 'klend', 'project0']]) {
    const blockhash = (await rpc(FORK, 'getLatestBlockhash',
      [{commitment: 'processed'}])).value.blockhash;
    const envelope = buildFlashEnvelope({actor, marginAccount: margin,
      providers, beforeBorrow, payloadInstructions, blockhash});
    const result = await simulateFlashEnvelope(FORK, envelope,
      [POOL, POSITION, ataA, ataB, WSOL_VAULT, USDC_VAULT]);
    const at = address => result.watched.indexOf(address.toBase58());
    const row = {providers, err: result.err,
      completeRepayment: result.completeRepayment,
      whirlpoolSwapExecutions: result.logs.filter(line =>
        line.includes('Program log: Instruction: Swap')).length,
      whirlpoolUpdateExecutions: result.logs.filter(line =>
        line.includes('Program log: Instruction: UpdateFeesAndRewards')).length,
      actorWsolBefore: tokenAmount(result.beforeAccounts[at(ataA)]),
      actorWsolAfter: tokenAmount(result.afterAccounts[at(ataA)]),
      actorUsdcBefore: tokenAmount(result.beforeAccounts[at(ataB)]),
      actorUsdcAfter: tokenAmount(result.afterAccounts[at(ataB)]),
      poolWsolBefore: tokenAmount(result.beforeAccounts[at(WSOL_VAULT)]),
      poolWsolAfter: tokenAmount(result.afterAccounts[at(WSOL_VAULT)]),
      poolUsdcBefore: tokenAmount(result.beforeAccounts[at(USDC_VAULT)]),
      poolUsdcAfter: tokenAmount(result.afterAccounts[at(USDC_VAULT)]),
      positionBefore: positionImage(result.beforeAccounts[at(POSITION)]),
      positionAfter: positionImage(result.afterAccounts[at(POSITION)]),
      lenderVaultDeltas: result.lenderVaultDeltas,
      stats: result.stats, index: result.index,
      unitsConsumed: result.unitsConsumed, logs: result.logs};
    cases.push(row);
    console.log(JSON.stringify({providers, err: row.err,
      completeRepayment: row.completeRepayment,
      swaps: row.whirlpoolSwapExecutions, updates: row.whirlpoolUpdateExecutions,
      unitsConsumed: row.unitsConsumed, stats: row.stats,
      finalLogs: row.logs.slice(-12)}));
  }
  fs.writeFileSync(path.join(__dirname, 'real-flash-swap-roundtrip.json'),
    `${JSON.stringify({schema: 'orca-pr1396-real-flash-swap-roundtrip/v1',
      fork: 'mainnet-backed Surfpool local fork', mainnetSubmission: false,
      signerVerification: true, actor: actor.publicKey.toBase58(),
      wsolAta: ataA.toBase58(), usdcAta: ataB.toBase58(),
      pool: POOL.toBase58(), position: POSITION.toBase58(), cases}, null, 2)}\n`);
}

module.exports = {FORK, POOL, POSITION, LOWER, UPPER, CURRENT_ARRAY,
  WSOL_VAULT, USDC_MINT, USDC_VAULT, actor, margin, ataA, ataB,
  swap, update, tokenAmount, positionImage};

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message); process.exitCode = 1;
});
