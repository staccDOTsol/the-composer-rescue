#!/usr/bin/env node
'use strict';

// Signed fee-authority controls on an isolated local mainnet-backed Surfpool fork.
// This script refuses any non-loopback RPC and never records secret key bytes.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MOD = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc} = require('./real-flash-envelope.js');

const FORK = process.env.ORCA_AUTHORITY_FORK || 'http://127.0.0.1:64331';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('Local fork only');
const OUT = process.env.ORCA_AUTHORITY_OUT ||
  path.join(__dirname, 'authority-local-fee-zero.json');
const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const POOL = new PublicKey('BSddxwYW73as8852ZTHRH13pbZEmZ96NBjayc5mSVtkZ');
const CONFIG = new PublicKey('CuRxokDVEuCjovsSNkvUbkpTW3fCTYMbuFqPf3kpZgEz');
const TARGET = new PublicKey('12Nqk2jyA3XNe3rPxAaLFixytmohnMrBfCsdwrCfWNm2');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.config', 'solana', 'id.json'), 'utf8'))));
if (!authority.publicKey.equals(TARGET)) throw new Error('Signer pubkey mismatch');
const payer = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-jupiter-atomic-test-v1').digest());

function image(account, kind) {
  const b = Buffer.from(account.data[0], 'base64');
  if (kind === 'pool') return {
    config: new PublicKey(b.subarray(8, 40)).toBase58(),
    feeRate: b.readUInt16LE(45), protocolFeeRate: b.readUInt16LE(47),
    liquidity: String(b.readBigUInt64LE(49) + (b.readBigUInt64LE(57) << 64n)),
  };
  return {
    feeAuthority: new PublicKey(b.subarray(8, 40)).toBase58(),
    collectProtocolFeesAuthority: new PublicKey(b.subarray(40, 72)).toBase58(),
    rewardEmissionsSuperAuthority: new PublicKey(b.subarray(72, 104)).toBase58(),
  };
}

async function state() {
  const r = await rpc(FORK, 'getMultipleAccounts', [[CONFIG.toBase58(), POOL.toBase58()],
    {encoding: 'base64', commitment: 'processed'}]);
  return {slot: r.context.slot, config: image(r.value[0], 'config'),
    pool: image(r.value[1], 'pool')};
}

function setRate(name) {
  const data = Buffer.alloc(10);
  crypto.createHash('sha256').update(`global:${name}`).digest().copy(data, 0, 0, 8);
  data.writeUInt16LE(0, 8);
  return new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: CONFIG, isSigner: false, isWritable: false},
    {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: authority.publicKey, isSigner: true, isWritable: false},
  ], data});
}

async function send(ix, label) {
  const blockhash = (await rpc(FORK, 'getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([ix], payer.publicKey, blockhash, 1_400_000);
  const signed = signV1(encoded, [ix], payer.publicKey, blockhash, [payer, authority]);
  const simulation = (await rpc(FORK, 'simulateTransaction',
    [signed.wire.toString('base64'), {encoding: 'base64', sigVerify: true,
      replaceRecentBlockhash: false, commitment: 'processed'}])).value;
  const result = {label, v1Bytes: encoded.sizeBytes, simulationError: simulation.err,
    simulationUnits: simulation.unitsConsumed, simulationLogs: simulation.logs?.slice(-10)};
  if (simulation.err) return result;
  const signature = await rpc(FORK, 'sendTransaction',
    [signed.wire.toString('base64'), {encoding: 'base64', skipPreflight: true,
      preflightCommitment: 'processed'}]);
  let tx = null;
  for (let i = 0; i < 20; i++) {
    tx = await rpc(FORK, 'getTransaction',
      [signature, {encoding: 'json', commitment: 'processed',
        maxSupportedTransactionVersion: 1}]);
    if (tx) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return {...result, signature, slot: tx?.slot,
    committedError: tx?.meta?.err ?? (tx ? null : 'missing receipt'),
    committedUnits: tx?.meta?.computeUnitsConsumed,
    committedLogs: tx?.meta?.logMessages?.slice(-10)};
}

async function main() {
  if (await rpc(FORK, 'getGenesisHash') !==
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Not mainnet fork');
  const before = await state();
  if (before.pool.config !== CONFIG.toBase58() ||
      before.config.feeAuthority !== TARGET.toBase58()) throw new Error('Config mismatch');
  const payerBalance = await rpc(FORK, 'getBalance', [payer.publicKey.toBase58()]);
  if (payerBalance.value < 1_000_000) {
    await rpc(FORK, 'surfnet_setAccount', [payer.publicKey.toBase58(), {
      data: '', executable: false, lamports: 1_000_000_000,
      owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
    }]);
  }
  const protocol = await send(setRate('set_protocol_fee_rate'), 'set protocol fee rate to zero');
  const afterProtocol = await state();
  if (protocol.simulationError || protocol.committedError ||
      afterProtocol.pool.protocolFeeRate !== 0) throw new Error('Protocol fee control failed');
  const fee = await send(setRate('set_fee_rate'), 'set trading fee rate to zero');
  const after = await state();
  if (fee.simulationError || fee.committedError || after.pool.feeRate !== 0)
    throw new Error('Trading fee control failed');
  const receipt = {schema: 'orca-local-fee-authority-control/v1',
    mainnetSubmission: false, fork: FORK, pool: POOL.toBase58(),
    authorityPublicKey: TARGET.toBase58(), payerPublicKey: payer.publicKey.toBase58(),
    before, protocol, afterProtocol, fee, after};
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, before: before.pool,
    afterProtocol: afterProtocol.pool, after: after.pool,
    protocolError: protocol.committedError, feeError: fee.committedError}));
}

main().catch(error => {console.error(error.stack || error.message); process.exitCode = 1;});
