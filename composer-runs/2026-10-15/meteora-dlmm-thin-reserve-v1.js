#!/usr/bin/env node
'use strict';

// Read-only Solana v1 simulations against a current, highly imbalanced DLMM
// pair. No signature verification and no transaction submission.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, MessageV1, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(rpcUrl, 'confirmed');
const builtPath = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-thin-swap-built.json';
const outputPath = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-thin-reserve-v1.json';
const built = JSON.parse(fs.readFileSync(builtPath));
const payer = new PublicKey(built.user);

function fromJson(row) {
  return new TransactionInstruction({
    programId: new PublicKey(row.programId), data: Buffer.from(row.dataHex, 'hex'),
    keys: row.keys.map((key) => ({ pubkey: new PublicKey(key.address), isSigner: key.signer, isWritable: key.writable })),
  });
}
function withAmount(ix, value) {
  const data = Buffer.from(ix.data); data.writeBigUInt64LE(BigInt(value), 8); data.writeBigUInt64LE(0n, 16);
  return new TransactionInstruction({ programId: ix.programId, data, keys: ix.keys.map((key) => ({ ...key })) });
}
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function serializeV1(instructions, blockhash) {
  const compiled = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  if (compiled.addressTableLookups.length || compiled.staticAccountKeys.length > 64) throw new Error(`v1 inline cap: ${compiled.staticAccountKeys.length}`);
  const message = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures, compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    u32(0b01100), Buffer.from(bs58.decode(blockhash)), Buffer.from([compiled.compiledInstructions.length, compiled.staticAccountKeys.length]),
    ...compiled.staticAccountKeys.map((key) => key.toBuffer()), u32(1_400_000), u32(64 * 1024 * 1024),
    ...compiled.compiledInstructions.map((ix) => { const b = Buffer.alloc(4); b[0] = ix.programIdIndex; b[1] = ix.accountKeyIndexes.length; b.writeUInt16LE(ix.data.length, 2); return b; }),
    ...compiled.compiledInstructions.flatMap((ix) => [Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]),
  ]);
  const decoded = MessageV1.deserialize(message);
  const wire = Buffer.concat([message, Buffer.alloc(decoded.header.numRequiredSignatures * 64)]);
  if (wire.length > 4096 || VersionedTransaction.deserialize(wire).version !== 1) throw new Error('v1 wire validation failed');
  return { message, wire, decoded };
}

function decode(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0], 'base64');
  const token = (row.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || row.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72;
  return { owner: row.owner, dataLength: data.length, sha256: sha256(data), ...(token ? { tokenAmount: data.readBigUInt64LE(64).toString() } : {}) };
}

async function snapshot(keys) {
  const response = await connection.getMultipleAccountsInfoAndContext(keys, 'confirmed');
  return { slot: response.context.slot, accounts: Object.fromEntries(keys.map((key, index) => {
    const info = response.value[index];
    return [key.toBase58(), info ? decode({ owner: info.owner.toBase58(), data: [info.data.toString('base64'), 'base64'] }) : null];
  })) };
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json(); if (body.error) throw new Error(JSON.stringify(body.error)); return body.result;
}

async function main() {
  const createAta = fromJson(built.instructions[1]);
  const swapBase = fromJson(built.instructions.at(-1));
  const pair = swapBase.keys[0].pubkey, poolX = swapBase.keys[2].pubkey, poolY = swapBase.keys[3].pubkey;
  const userSource = swapBase.keys[4].pubkey, userOther = swapBase.keys[5].pubkey, oracle = swapBase.keys[8].pubkey;
  const binArrays = swapBase.keys.slice(16).map((meta) => meta.pubkey);
  const monitor = [pair, poolX, poolY, userSource, userOther, oracle, ...binArrays];
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  for (const quote of built.boundaryQuotes) {
    if (quote.error) continue;
    const before = await snapshot(monitor);
    const serialized = serializeV1([createAta, withAmount(swapBase, quote.inAmount)], blockhash);
    const simulated = await rpc('simulateTransaction', [serialized.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: monitor.map(String) },
    }]);
    const after = Object.fromEntries(monitor.map((key, index) => [key.toBase58(), decode(simulated.value.accounts?.[index])]));
    const tokenDeltas = {}, stateChanged = {};
    for (const key of monitor) {
      const address = key.toBase58();
      if (before.accounts[address]?.tokenAmount != null && after[address]?.tokenAmount != null) tokenDeltas[address] = (BigInt(after[address].tokenAmount) - BigInt(before.accounts[address].tokenAmount)).toString();
      else if (before.accounts[address] == null && after[address]?.tokenAmount != null) tokenDeltas[address] = after[address].tokenAmount;
      if (before.accounts[address]?.sha256 && after[address]?.sha256) stateChanged[address] = before.accounts[address].sha256 !== after[address].sha256;
    }
    const row = {
      label: `thin_forward_${quote.inAmount}`, preSlot: before.slot, contextSlot: simulated.context.slot,
      err: simulated.value.err, unitsConsumed: simulated.value.unitsConsumed, tokenDeltas, stateChanged,
      logs: simulated.value.logs || [], message: { version: 1, wireBytes: serialized.wire.length, staticAccountKeys: serialized.decoded.staticAccountKeys.length, sha256: sha256(serialized.wire) },
    };
    results.push(row);
    process.stdout.write(`${JSON.stringify({ label: row.label, preSlot: row.preSlot, contextSlot: row.contextSlot, err: row.err, unitsConsumed: row.unitsConsumed, tokenDeltas })}\n`);
  }
  const output = {
    observedAt: new Date().toISOString(), observedRpcHost: new URL(rpcUrl).hostname,
    signerVerification: false, transactionVersion: 1, wireByteLimit: 4096, inlineAccountLimit: 64,
    pair: built.pair, inToken: built.inToken, outToken: built.outToken, reverseConstructionError: built.reverseConstructionError,
    thinReserveRawAtCustodySnapshot: '46274', sourceBuild: builtPath, quotes: built.boundaryQuotes,
    accounts: { pair: pair.toBase58(), poolX: poolX.toBase58(), poolY: poolY.toBase58(), userSource: userSource.toBase58(), userOther: userOther.toBase58(), oracle: oracle.toBase58(), binArrays: binArrays.map(String) },
    results,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, observedAt: output.observedAt }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
