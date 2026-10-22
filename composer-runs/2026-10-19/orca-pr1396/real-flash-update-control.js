#!/usr/bin/env node
'use strict';

// Signed simulation-only control: real Save/KLend/Project0 WSOL flash loans,
// one live Whirlpool update_fees_and_rewards, then all repayments in one v1 tx.
// This establishes composition, not fee-accrual stress: the loan is idle here.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {
  Keypair, PublicKey, TransactionInstruction, SystemProgram,
} = require(`${MODULES}/@solana/web3.js`);
const {buildFlashEnvelope, simulateFlashEnvelope, rpc, PROGRAMS} = require('./real-flash-envelope.js');

const FORK = process.env.ORCA_FLASH_FORK || 'http://127.0.0.1:48899';
const POOL = new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');
const POSITION = new PublicKey('JDwC8tY9MPWnkevbCGFFVbodJAi7Bx55M6qwgqau4yaw');
const LOWER = new PublicKey('FTfe67qe9LJqsTrQHwGQHMXbxsCNgbzZFCW6czZBjAJ');
const UPPER = new PublicKey('9dLHNf8HAU4uM8YxdLxgiMSsPPQWQ6bzujKhttDoRnCp');
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-real-flash-update-actor-2026-10-19').digest());
const margin = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-real-flash-update-margin-2026-10-19').digest());
const discriminator = name => crypto.createHash('sha256')
  .update(`global:${name}`).digest().subarray(0, 8);

function positionImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {liquidity: String(data.readBigUInt64LE(72) + (data.readBigUInt64LE(80) << 64n)),
    lower: data.readInt32LE(88), upper: data.readInt32LE(92),
    checkpointA: String(data.readBigUInt64LE(96) + (data.readBigUInt64LE(104) << 64n)),
    feeOwedA: String(data.readBigUInt64LE(112)),
    checkpointB: String(data.readBigUInt64LE(120) + (data.readBigUInt64LE(128) << 64n)),
    feeOwedB: String(data.readBigUInt64LE(136))};
}

async function main() {
  const genesis = await rpc(FORK, 'getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not Solana mainnet genesis');
  await rpc(FORK, 'surfnet_setAccount', [actor.publicKey.toBase58(), {
    data: '', executable: false, lamports: 1_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  const update = new TransactionInstruction({
    programId: new PublicKey(PROGRAMS.whirlpool),
    keys: [
      {pubkey: POOL, isSigner: false, isWritable: true},
      {pubkey: POSITION, isSigner: false, isWritable: true},
      {pubkey: LOWER, isSigner: false, isWritable: false},
      {pubkey: UPPER, isSigner: false, isWritable: false},
    ],
    data: discriminator('update_fees_and_rewards'),
  });
  const cases = [];
  for (const providers of [
    ['save', 'klend', 'project0'], ['klend', 'project0'],
  ]) {
    const blockhash = (await rpc(FORK, 'getLatestBlockhash',
      [{commitment: 'processed'}])).value.blockhash;
    const envelope = buildFlashEnvelope({actor, marginAccount: margin,
      payloadInstructions: [update], blockhash, providers});
    const result = await simulateFlashEnvelope(FORK, envelope, [String(POSITION), String(POOL)]);
    const positionIndex = result.watched.indexOf(String(POSITION));
    const genuineWhirlpoolExecution = result.logs.some(line =>
      line.includes('Program log: Instruction: UpdateFeesAndRewards'));
    const row = {providers, outcome: result.err, genuineWhirlpoolExecution,
      completeRepayment: result.completeRepayment,
      positionBefore: positionImage(result.beforeAccounts[positionIndex]),
      positionAfter: positionImage(result.afterAccounts[positionIndex]),
      lenderVaultDeltas: result.lenderVaultDeltas,
      stats: result.stats, index: result.index,
      unitsConsumed: result.unitsConsumed,
      logs: result.logs.filter(line => /Instruction:|Hello from my program|failed|success/.test(line)),
    };
    cases.push(row);
    console.log(JSON.stringify({providers, err: row.outcome,
      genuineWhirlpoolExecution, completeRepayment: row.completeRepayment,
      stats: row.stats, unitsConsumed: row.unitsConsumed,
      lastLogs: row.logs.slice(-8)}));
  }
  const output = {schema: 'orca-pr1396-real-flash-update-control/v1',
    fork: 'mainnet-backed Surfpool local fork', mainnetSubmission: false,
    signerVerification: true, actor: actor.publicKey.toBase58(),
    pool: POOL.toBase58(), position: POSITION.toBase58(), cases};
  const outputPath = path.join(__dirname, 'real-flash-update-control.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
