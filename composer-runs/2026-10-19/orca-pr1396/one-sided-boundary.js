#!/usr/bin/env node
'use strict';

// Execute a WSOL->USDC boundary crossing on an isolated mainnet-backed Surfpool
// fork. Never targets a public RPC for sendTransaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = require('./runtime.js').nodeModules();
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} = require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MOD}/@solana/spl-token`);
const {PriceMath} = require(`${MOD}/@orca-so/whirlpools-sdk`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');
const {rpc} = require('./real-flash-envelope.js');

const FORK = process.env.ORCA_BOUNDARY_FORK || 'http://127.0.0.1:64331';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('Local fork only');
const OUT = path.join(__dirname, 'one-sided-boundary.json');
const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const POOL = new PublicKey('C7AD8EHcbKvFL3zw2z4YKKn1ZMTCYqkThZGtY3hPajsd');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const VAULT_A = new PublicKey('5ui3cgF3Hx5rGhFp4FAjhoqVQSfmZAFZ9KhdiWY8ewKu');
const VAULT_B = new PublicKey('5qCGEJ3711m5HDzdS82AcC7xnKNW293agPtYX8de7ERt');
const actor = Keypair.fromSeed(crypto.createHash('sha256')
  .update('orca-pr1396-jupiter-atomic-test-v1').digest());
const ataA = getAssociatedTokenAddressSync(WSOL, actor.publicKey);
const ataB = getAssociatedTokenAddressSync(USDC, actor.publicKey);
const [oracle] = PublicKey.findProgramAddressSync([Buffer.from('oracle'), POOL.toBuffer()], PROGRAM);
const key = (pubkey, isWritable, isSigner = false) => ({pubkey, isWritable, isSigner});
const D = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u128 = (b, o) => b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n);
const arr = start => PublicKey.findProgramAddressSync(
  [Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(start))], PROGRAM)[0];
const arrays = [-28160, -28864, -29568, -30272].map(arr);

function swap(first, amount = 1_000_000_000n) {
  const data = Buffer.alloc(42);
  D('swap').copy(data);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(0n, 16);
  const limit = BigInt(PriceMath.tickIndexToSqrtPriceX64(first ? -28864 : -29920).toString());
  data.writeBigUInt64LE(limit & ((1n << 64n) - 1n), 24);
  data.writeBigUInt64LE(limit >> 64n, 32);
  data[40] = 1; // exact input
  data[41] = 1; // A -> B
  const arrayMetas = (first ? arrays.slice(0, 3) : arrays.slice(1, 4))
    .map(address => key(address, true));
  return new TransactionInstruction({programId: PROGRAM, keys: [
    key(TOKEN_PROGRAM_ID, false), key(actor.publicKey, false, true),
    key(POOL, true), key(ataA, true), key(VAULT_A, true),
    key(ataB, true), key(VAULT_B, true),
    ...arrayMetas, key(oracle, false),
  ], data});
}

async function image() {
  const keys = [POOL, VAULT_A, VAULT_B, ataA, ataB, ...arrays];
  const {value} = await rpc(FORK, 'getMultipleAccounts',
    [keys.map(k => k.toBase58()), {encoding:'base64', commitment:'processed'}]);
  const data = value.map(v => v ? Buffer.from(v.data[0], 'base64') : null);
  const p = data[0];
  return {pool:{liquidity:String(u128(p,49)), sqrtPriceX64:String(u128(p,65)),
      tick:p.readInt32LE(81), feeRate:p.readUInt16LE(45)},
    vaultA:data[1] ? String(data[1].readBigUInt64LE(64)) : null,
    vaultB:data[2] ? String(data[2].readBigUInt64LE(64)) : null,
    actorA:data[3] ? String(data[3].readBigUInt64LE(64)) : null,
    actorB:data[4] ? String(data[4].readBigUInt64LE(64)) : null,
    arrays:Object.fromEntries(arrays.map((a,i)=>[a.toBase58(),!!data[i+5]]))};
}

async function send(instructions, label) {
  const bh = (await rpc(FORK,'getLatestBlockhash',[{commitment:'processed'}])).value.blockhash;
  const encoded = encodeV1(instructions, actor.publicKey, bh, 1_400_000);
  const signed = signV1(encoded, instructions, actor.publicKey, bh, [actor]);
  const simulated = await rpc(FORK,'simulateTransaction',[signed.wire.toString('base64'),
    {encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'processed'}]);
  const pre = {label, simulatedError:simulated.value.err,
    units:simulated.value.unitsConsumed, logs:simulated.value.logs?.slice(-18) ?? [],
    transactionVersion:1, wireBytes:encoded.sizeBytes};
  if (pre.simulatedError) return pre;
  const signature = await rpc(FORK,'sendTransaction',[signed.wire.toString('base64'),
    {encoding:'base64',skipPreflight:true,preflightCommitment:'processed'}]);
  let tx;
  for (let i=0;i<20;i++) {
    tx=await rpc(FORK,'getTransaction',[signature,
      {encoding:'json',commitment:'processed',maxSupportedTransactionVersion:1}]);
    if(tx)break;
    await new Promise(r=>setTimeout(r,200));
  }
  return {...pre, signature, committedError:tx ? tx.meta.err : 'missing receipt',
    slot:tx?.slot, committedUnits:tx?.meta?.computeUnitsConsumed,
    committedLogs:tx?.meta?.logMessages?.slice(-18) ?? []};
}

async function main() {
  if (await rpc(FORK,'getGenesisHash') !==
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('Fork is not mainnet genesis');
  const before = await image();
  const setup = [];
  if (before.actorA === null) setup.push(createAssociatedTokenAccountIdempotentInstruction(
    actor.publicKey, ataA, actor.publicKey, WSOL));
  if (before.actorB === null) setup.push(createAssociatedTokenAccountIdempotentInstruction(
    actor.publicKey, ataB, actor.publicKey, USDC));
  await rpc(FORK,'surfnet_setAccount',[actor.publicKey.toBase58(),{
    data:'', executable:false, lamports:3_000_000_000,
    owner:SystemProgram.programId.toBase58(), rentEpoch:0}]);
  setup.push(SystemProgram.transfer({fromPubkey:actor.publicKey,toPubkey:ataA,
    lamports:1_000_000_000}));
  setup.push(new TransactionInstruction({programId:TOKEN_PROGRAM_ID,
    keys:[key(ataA,true)], data:Buffer.from([17])}));
  const setupReceipt = await send(setup,'setup');
  if (setupReceipt.simulatedError || setupReceipt.committedError) throw new Error(
    `Setup failed: ${JSON.stringify(setupReceipt)}`);
  const prepared = await image();
  const first = await send([swap(true)],'first to tick -28864');
  const middle = await image();
  const second = first.committedError ? null : await send([swap(false)],
    'second to final lower tick -29920');
  const after = await image();
  const result={schema:'orca-one-sided-boundary/v1', fork:FORK,
    mainnetSubmission:false, pool:POOL.toBase58(), actor:actor.publicKey.toBase58(),
    ataA:ataA.toBase58(), ataB:ataB.toBase58(),
    tickArrayAddresses:arrays.map(a=>a.toBase58()),
    limits:[-28864,-29920], before, setupReceipt, prepared,
    first,middle,second,after};
  fs.writeFileSync(OUT, JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({out:OUT, before, prepared,first,middle,second,after}));
}

module.exports={FORK,POOL,WSOL,USDC,VAULT_A,VAULT_B,actor,ataA,ataB,arrays,swap,image,send};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
