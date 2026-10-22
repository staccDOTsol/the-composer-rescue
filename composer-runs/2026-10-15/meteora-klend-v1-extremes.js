#!/usr/bin/env node
'use strict';

// Read-only v1 transaction simulations for the current zero-fee KLend USDC
// reserve used as a funding leg in the Meteora DLMM review. This never signs or
// submits. It manually serializes the currently-deserialization-only v1 format
// implemented by @solana/web3.js and verifies every message by decoding it.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  MessageV1,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ENV = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = ENV.HEAVY_RPC_URL || ENV.RPC_URL;
const OUT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-klend-v1-extremes.json';
const HISTORY = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kamino-flash-history.json';
const SOURCE = JSON.parse(fs.readFileSync(HISTORY));
const HIT = SOURCE.hits[0];
const SAMPLE = HIT.transaction;
const MESSAGE = SAMPLE.transaction.message;
const STATIC_KEYS = MESSAGE.accountKeys;
const ALL_KEYS = [...STATIC_KEYS, ...(SAMPLE.meta.loadedAddresses?.writable || []), ...(SAMPLE.meta.loadedAddresses?.readonly || [])];
const HEADER = MESSAGE.header;
const PAYER = new PublicKey(STATIC_KEYS[0]);
const CONNECTION = new Connection(RPC, 'confirmed');
const MAX_V1_BYTES = 4096;
const MAX_V1_KEYS = 64;

function isSigner(index) { return index < HEADER.numRequiredSignatures; }
function isWritable(index) {
  if (index < STATIC_KEYS.length) {
    if (isSigner(index)) return index < HEADER.numRequiredSignatures - HEADER.numReadonlySignedAccounts;
    return index < STATIC_KEYS.length - HEADER.numReadonlyUnsignedAccounts;
  }
  return index < STATIC_KEYS.length + (SAMPLE.meta.loadedAddresses?.writable?.length || 0);
}

function fromSample(index) {
  const ix = MESSAGE.instructions[index];
  return new TransactionInstruction({
    programId: new PublicKey(ALL_KEYS[ix.programIdIndex]),
    data: Buffer.from(bs58.decode(ix.data)),
    keys: ix.accounts.map((j) => ({ pubkey: new PublicKey(ALL_KEYS[j]), isSigner: isSigner(j), isWritable: isWritable(j) })),
  });
}

function copy(ix, mutate) {
  const keys = ix.keys.map((meta) => ({ ...meta }));
  const data = Buffer.from(ix.data);
  mutate(keys, data);
  return new TransactionInstruction({ programId: ix.programId, keys, data });
}

function withAmount(ix, amount) { return copy(ix, (_keys, data) => data.writeBigUInt64LE(amount, 8)); }
function withRepayIndex(ix, index) { return copy(ix, (_keys, data) => { data[16] = index; }); }
function withKey(ix, index, pubkey) { return copy(ix, (keys) => { keys[index].pubkey = pubkey; }); }

function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }

function serializeV1(payer, recentBlockhash, instructions, transactionConfig = {
  computeUnitLimit: 1_400_000,
  loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
}) {
  const v0 = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions }).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 serializer does not permit address lookup tables');
  if (v0.staticAccountKeys.length > MAX_V1_KEYS) throw new Error(`v1 static key cap exceeded: ${v0.staticAccountKeys.length}`);
  if (v0.compiledInstructions.length > 255) throw new Error('v1 instruction cap exceeded');

  let mask = 0;
  const config = [];
  if (transactionConfig.priorityFee != null) { mask |= 0b00011; config.push(u64(transactionConfig.priorityFee)); }
  if (transactionConfig.computeUnitLimit != null) { mask |= 0b00100; config.push(u32(transactionConfig.computeUnitLimit)); }
  if (transactionConfig.loadedAccountsDataSizeLimit != null) { mask |= 0b01000; config.push(u32(transactionConfig.loadedAccountsDataSizeLimit)); }
  if (transactionConfig.heapSize != null) { mask |= 0b10000; config.push(u32(transactionConfig.heapSize)); }

  const message = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures, v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    u32(mask),
    Buffer.from(bs58.decode(recentBlockhash)),
    Buffer.from([v0.compiledInstructions.length, v0.staticAccountKeys.length]),
    ...v0.staticAccountKeys.map((key) => key.toBuffer()),
    ...config,
    ...v0.compiledInstructions.map((ix) => {
      if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) throw new Error('v1 instruction field overflow');
      const header = Buffer.alloc(4);
      header[0] = ix.programIdIndex;
      header[1] = ix.accountKeyIndexes.length;
      header.writeUInt16LE(ix.data.length, 2);
      return header;
    }),
    ...v0.compiledInstructions.flatMap((ix) => [Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]),
  ]);
  const decoded = MessageV1.deserialize(message);
  if (decoded.staticAccountKeys.length !== v0.staticAccountKeys.length || decoded.compiledInstructions.length !== instructions.length) {
    throw new Error('v1 decode verification mismatch');
  }
  const signatures = Buffer.alloc(v0.header.numRequiredSignatures * 64);
  const wire = Buffer.concat([message, signatures]);
  if (wire.length > MAX_V1_BYTES) throw new Error(`v1 transaction size cap exceeded: ${wire.length}`);
  const tx = VersionedTransaction.deserialize(wire);
  if (tx.version !== 1) throw new Error('wire did not deserialize as v1');
  return { wire, message, decoded };
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function tokenAmount(data) { return data && data.length >= 72 ? data.readBigUInt64LE(64) : null; }

async function simulate(label, instructions, monitor, before, blockhash) {
  try {
    const serialized = serializeV1(PAYER, blockhash, instructions);
    const body = {
      jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [serialized.wire.toString('base64'), {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
        accounts: { encoding: 'base64', addresses: monitor.map((key) => key.toBase58()) },
      }],
    };
    const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    const value = json.result.value;
    const after = Object.fromEntries(monitor.map((key, index) => {
      const account = value.accounts?.[index];
      if (!account) return [key.toBase58(), null];
      const data = Buffer.from(account.data[0], 'base64');
      const amount = tokenAmount(data);
      return [key.toBase58(), amount == null ? { sha256: sha256(data), dataLength: data.length } : { tokenAmount: amount.toString() }];
    }));
    const tokenDeltas = {};
    for (const key of monitor) {
      const address = key.toBase58();
      if (before[address]?.tokenAmount != null && after[address]?.tokenAmount != null) {
        tokenDeltas[address] = (BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount)).toString();
      }
    }
    return {
      label, contextSlot: json.result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed,
      returnData: value.returnData || null, tokenDeltas, after,
      logs: value.logs || [],
      message: {
        version: 1, messageBytes: serialized.message.length, wireBytes: serialized.wire.length,
        staticAccountKeys: serialized.decoded.staticAccountKeys.length,
        instructions: serialized.decoded.compiledInstructions.length,
        computeUnitLimit: serialized.decoded.transactionConfig.computeUnitLimit,
        sha256: sha256(serialized.wire), base64: serialized.wire.toString('base64'),
      },
    };
  } catch (error) {
    return { label, constructionOrTransportError: String(error?.message || error) };
  }
}

async function main() {
  const sourceBorrow = fromSample(3);
  const sourceRepay = fromSample(13);
  const reserve = sourceBorrow.keys[3].pubkey;
  const supply = sourceBorrow.keys[5].pubkey;
  const userToken = sourceBorrow.keys[6].pubkey;
  const feeVault = sourceBorrow.keys[7].pubkey;
  const otherToken = new PublicKey('2FT1zp7qKxtRC2gMWE3S5y5MG345dM4Y2u5wKTZYvm4i');
  const monitor = [reserve, supply, userToken, feeVault, otherToken];
  const pre = await CONNECTION.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((key, index) => {
    const info = pre.value[index];
    if (!info) return [key.toBase58(), null];
    const amount = tokenAmount(info.data);
    return [key.toBase58(), amount == null ? { sha256: sha256(info.data), dataLength: info.data.length } : { tokenAmount: amount.toString() }];
  }));
  const available = BigInt(before[supply.toBase58()].tokenAmount);
  const currentConfigLargeControl = 7_789_632_497_552n;
  const amounts = [0n, 1n, 2n, 10n, 100_000n, currentConfigLargeControl, available / 2n,
    available - 1n, available, available + 1n, 18_446_744_073_709_551_615n]
    .filter((value, index, array) => value >= 0n && array.findIndex((candidate) => candidate === value) === index);
  const blockhash = (await CONNECTION.getLatestBlockhash('confirmed')).blockhash;
  const cases = [];
  for (const amount of amounts) {
    cases.push([`direct_${amount}`, [withAmount(sourceBorrow, amount), withRepayIndex(withAmount(sourceRepay, amount), 0)]]);
  }
  const repeatedAmount = 100_000n;
  cases.push(['two_sequential_pairs', [
    withAmount(sourceBorrow, repeatedAmount), withRepayIndex(withAmount(sourceRepay, repeatedAmount), 0),
    withAmount(sourceBorrow, repeatedAmount), withRepayIndex(withAmount(sourceRepay, repeatedAmount), 2),
  ]]);
  cases.push(['borrow_borrow_repay_repay', [
    withAmount(sourceBorrow, repeatedAmount), withAmount(sourceBorrow, repeatedAmount),
    withRepayIndex(withAmount(sourceRepay, repeatedAmount), 0), withRepayIndex(withAmount(sourceRepay, repeatedAmount), 1),
  ]]);
  cases.push(['wrong_order_repay_first', [withRepayIndex(withAmount(sourceRepay, repeatedAmount), 1), withAmount(sourceBorrow, repeatedAmount)]]);
  cases.push(['wrong_repay_index', [withAmount(sourceBorrow, repeatedAmount), withRepayIndex(withAmount(sourceRepay, repeatedAmount), 1)]]);
  cases.push(['amount_mismatch_minus_one', [withAmount(sourceBorrow, repeatedAmount), withRepayIndex(withAmount(sourceRepay, repeatedAmount - 1n), 0)]]);
  cases.push(['destination_alias_supply', [
    withKey(withAmount(sourceBorrow, repeatedAmount), 6, supply),
    withKey(withRepayIndex(withAmount(sourceRepay, repeatedAmount), 0), 6, supply),
  ]]);
  cases.push(['fee_vault_substitution', [
    withAmount(sourceBorrow, repeatedAmount), withKey(withRepayIndex(withAmount(sourceRepay, repeatedAmount), 0), 7, otherToken),
  ]]);

  const results = [];
  for (const [label, instructions] of cases) {
    const result = await simulate(label, instructions, monitor, before, blockhash);
    results.push(result);
    process.stdout.write(`${JSON.stringify({ label, err: result.err, constructionOrTransportError: result.constructionOrTransportError, unitsConsumed: result.unitsConsumed, wireBytes: result.message?.wireBytes, keys: result.message?.staticAccountKeys, tokenDeltas: result.tokenDeltas })}\n`);
  }
  const output = {
    observedAt: new Date().toISOString(), rpcHost: new URL(RPC).hostname,
    sourceSignature: HIT.signature, sourceSlot: HIT.slot, signerVerification: false, transactionVersion: 1,
    protocol: 'Kamino Lending / KLend', programId: sourceBorrow.programId.toBase58(), asset: 'USDC',
    preSlot: pre.context.slot, accounts: {
      payer: PAYER.toBase58(), reserve: reserve.toBase58(), liquiditySupply: supply.toBase58(),
      userToken: userToken.toBase58(), feeVault: feeVault.toBase58(), comparisonTokenAccount: otherToken.toBase58(),
    },
    before, availableLiquidityRawAtPreSlot: available.toString(), testedAmountsRaw: amounts.map(String),
    sourceBorrowDataHex: sourceBorrow.data.toString('hex'), sourceRepayDataHex: sourceRepay.data.toString('hex'), results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, observedAt: output.observedAt, preSlot: output.preSlot }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
