#!/usr/bin/env node
'use strict';

// Current-state, read-only atomic KLend USDC -> Meteora DLMM -> KLend v1
// composition. Transactions are unsigned simulations and are never submitted.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction, TransactionMessage, MessageV1, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const SPL = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const ENV = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = ENV.HEAVY_RPC_URL || ENV.RPC_URL;
const CONNECTION = new Connection(RPC, 'confirmed');
const BUILT = JSON.parse(fs.readFileSync(process.env.BUILT || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-current-swap-built.json'));
const HISTORY = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kamino-flash-history.json'));
const CUSTODY = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-current-custody.json'));
const OUT = process.env.OUT || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-flash-v1.json';
const SAMPLE = HISTORY.hits[0].transaction;
const MESSAGE = SAMPLE.transaction.message;
const STATIC = MESSAGE.accountKeys;
const ALL = [...STATIC, ...(SAMPLE.meta.loadedAddresses?.writable || []), ...(SAMPLE.meta.loadedAddresses?.readonly || [])];
const HEADER = MESSAGE.header;
const PAYER = new PublicKey(BUILT.user);
const OUTSIDER = new PublicKey('ACiDHb2zjBY3jWRTRFGG9m3KDzYEtTns2KYXfpK1eG1j');

function isSigner(index) { return index < HEADER.numRequiredSignatures; }
function isWritable(index) {
  if (index < STATIC.length) {
    if (isSigner(index)) return index < HEADER.numRequiredSignatures - HEADER.numReadonlySignedAccounts;
    return index < STATIC.length - HEADER.numReadonlyUnsignedAccounts;
  }
  return index < STATIC.length + (SAMPLE.meta.loadedAddresses?.writable?.length || 0);
}
function sourceInstruction(index) {
  const ix = MESSAGE.instructions[index];
  return new TransactionInstruction({ programId: new PublicKey(ALL[ix.programIdIndex]), data: Buffer.from(bs58.decode(ix.data)), keys: ix.accounts.map((j) => ({ pubkey: new PublicKey(ALL[j]), isSigner: isSigner(j), isWritable: isWritable(j) })) });
}
function fromJson(row) { return new TransactionInstruction({ programId: new PublicKey(row.programId), data: Buffer.from(row.dataHex, 'hex'), keys: row.keys.map((key) => ({ pubkey: new PublicKey(key.address), isSigner: key.signer, isWritable: key.writable })) }); }
function clone(ix, mutate) { const keys = ix.keys.map((key) => ({ ...key })); const data = Buffer.from(ix.data); mutate(keys, data); return new TransactionInstruction({ programId: ix.programId, keys, data }); }
function amount(ix, value) { return clone(ix, (_keys, data) => data.writeBigUInt64LE(BigInt(value), 8)); }
function minOutZero(ix) { return clone(ix, (_keys, data) => data.writeBigUInt64LE(0n, 16)); }
function repayIndex(ix, index) { return clone(ix, (_keys, data) => { data[16] = index; }); }
function keyAt(ix, index, key) { return clone(ix, (keys) => { keys[index].pubkey = key; }); }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function serializeV1(instructions, blockhash) {
  const compiled = new TransactionMessage({ payerKey: PAYER, recentBlockhash: blockhash, instructions }).compileToV0Message();
  if (compiled.addressTableLookups.length || compiled.staticAccountKeys.length > 64) throw new Error(`v1 inline cap: ${compiled.staticAccountKeys.length} keys`);
  const message = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures, compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    u32(0b01100), Buffer.from(bs58.decode(blockhash)), Buffer.from([compiled.compiledInstructions.length, compiled.staticAccountKeys.length]),
    ...compiled.staticAccountKeys.map((key) => key.toBuffer()), u32(1_400_000), u32(64 * 1024 * 1024),
    ...compiled.compiledInstructions.map((ix) => { const b = Buffer.alloc(4); b[0] = ix.programIdIndex; b[1] = ix.accountKeyIndexes.length; b.writeUInt16LE(ix.data.length, 2); return b; }),
    ...compiled.compiledInstructions.flatMap((ix) => [Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]),
  ]);
  const decoded = MessageV1.deserialize(message);
  const wire = Buffer.concat([message, Buffer.alloc(decoded.header.numRequiredSignatures * 64)]);
  if (wire.length > 4096) throw new Error(`v1 byte cap: ${wire.length}`);
  if (VersionedTransaction.deserialize(wire).version !== 1) throw new Error('v1 round-trip failure');
  return { message, wire, decoded };
}

function decodeAccount(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0], 'base64');
  const token = (row.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || row.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 72;
  return { lamports: String(row.lamports), owner: row.owner, dataLength: data.length, sha256: sha256(data), ...(token ? { mint: new PublicKey(data.subarray(0, 32)).toBase58(), authority: new PublicKey(data.subarray(32, 64)).toBase58(), tokenAmount: data.readBigUInt64LE(64).toString() } : {}) };
}

async function preSnapshot(monitor) {
  const response = await CONNECTION.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  return { slot: response.context.slot, accounts: Object.fromEntries(monitor.map((key, index) => {
    const info = response.value[index];
    if (!info) return [key.toBase58(), null];
    return [key.toBase58(), decodeAccount({ data: [info.data.toString('base64'), 'base64'], owner: info.owner.toBase58(), lamports: info.lamports })];
  })) };
}

async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json(); if (body.error) throw new Error(JSON.stringify(body.error)); return body.result;
}

async function simulate(label, instructions, monitor, before, blockhash) {
  try {
    const serialized = serializeV1(instructions, blockhash);
    const result = await rpc('simulateTransaction', [serialized.wire.toString('base64'), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: monitor.map(String) } }]);
    const value = result.value;
    const after = Object.fromEntries(monitor.map((key, index) => [key.toBase58(), decodeAccount(value.accounts?.[index])]));
    const deltas = {};
    const stateChanged = {};
    for (const key of monitor) {
      const address = key.toBase58();
      if (before[address]?.tokenAmount != null && after[address]?.tokenAmount != null) deltas[address] = (BigInt(after[address].tokenAmount) - BigInt(before[address].tokenAmount)).toString();
      else if (before[address] == null && after[address]?.tokenAmount != null) deltas[address] = after[address].tokenAmount;
      if (before[address]?.sha256 && after[address]?.sha256) stateChanged[address] = before[address].sha256 !== after[address].sha256;
    }
    return { label, contextSlot: result.context.slot, err: value.err, unitsConsumed: value.unitsConsumed, tokenDeltas: deltas, stateChanged, after, logs: value.logs || [], message: { version: 1, wireBytes: serialized.wire.length, messageBytes: serialized.message.length, staticAccountKeys: serialized.decoded.staticAccountKeys.length, instructions: instructions.length, sha256: sha256(serialized.wire), base64: serialized.wire.toString('base64') } };
  } catch (error) { return { label, constructionOrTransportError: String(error?.message || error) }; }
}

async function main() {
  const borrowBase = sourceInstruction(3);
  const repayBase = sourceInstruction(13);
  const createAta = fromJson(BUILT.instructions[1]);
  const forwardBase = fromJson(BUILT.instructions.at(-1));
  const reverseBase = fromJson(BUILT.reverseInstructions.at(-1));
  const reserve = borrowBase.keys[3].pubkey, supply = borrowBase.keys[5].pubkey, userUsdc = borrowBase.keys[6].pubkey, feeVault = borrowBase.keys[7].pubkey;
  const pair = forwardBase.keys[0].pubkey, poolX = forwardBase.keys[2].pubkey, poolY = forwardBase.keys[3].pubkey, userTrump = forwardBase.keys[5].pubkey, oracle = forwardBase.keys[8].pubkey;
  const binArrays = [...new Map([...forwardBase.keys.slice(16), ...reverseBase.keys.slice(16)].map((meta) => [meta.pubkey.toBase58(), meta.pubkey])).values()];
  const monitor = [PAYER, reserve, supply, userUsdc, feeVault, pair, poolX, poolY, userTrump, oracle, ...binArrays].slice(0, 15);
  const pre = await preSnapshot(monitor);
  const blockhash = (await CONNECTION.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  const run = async (label, ixs, caseMonitor = monitor) => {
    const casePre = await preSnapshot(caseMonitor);
    const result = await simulate(label, ixs, caseMonitor, casePre.accounts, blockhash);
    result.preSlot = casePre.slot;
    results.push(result);
    process.stdout.write(`${JSON.stringify({ label, preSlot: casePre.slot, contextSlot: result.contextSlot, err: result.err, transport: result.constructionOrTransportError, cu: result.unitsConsumed, bytes: result.message?.wireBytes, keys: result.message?.staticAccountKeys, deltas: result.tokenDeltas })}\n`);
  };

  await run('dlmm_forward_1000', [createAta, amount(minOutZero(forwardBase), 1000n)]);
  await run('dlmm_roundtrip_1000', [createAta, amount(minOutZero(forwardBase), 1000n), amount(minOutZero(reverseBase), 532n)]);
  for (const quote of BUILT.boundaryQuotes) {
    const input = BigInt(quote.inAmount), output = BigInt(quote.outAmount);
    const borrow = amount(borrowBase, input), repay = repayIndex(amount(repayBase, input), 0);
    const forward = amount(minOutZero(forwardBase), input);
    const legs = [borrow, createAta, forward];
    if (output > 0n) legs.push(amount(minOutZero(reverseBase), output));
    legs.push(repay);
    await run(`flash_dlmm_roundtrip_${input}`, legs);
  }
  // Use an independently observed on-curve swap signer with enough pre-existing
  // USDC to pay the large round-trip loss while the exact flash principal is
  // repaid. Signatures remain disabled and nothing is submitted.
  const crossingQuote = BUILT.boundaryQuotes.find((quote) => quote.inAmount === '10000000000');
  if (pair.toBase58() === '9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2' && crossingQuote && !crossingQuote.error) {
    const swapInput = 10_000_000_000n;
    const swapOutput = BigInt(crossingQuote.outAmount);
    const richOwner = new PublicKey('C39ohmu1fxbQubgW9JVgDBHrKzgvr7RNrySdntdzfTyW');
    const richUsdc = new PublicKey('8Wx2skXGvoPdL9FVzGyuk6fJNF2xapVPKwrtodrUm3Qj');
    const otherMint = forwardBase.keys[6].pubkey;
    const tokenProgram = forwardBase.keys[11].pubkey;
    const richOther = SPL.getAssociatedTokenAddressSync(otherMint, richOwner, false, tokenProgram);
    const richCreateAta = SPL.createAssociatedTokenAccountIdempotentInstruction(PAYER, richOther, richOwner, otherMint, tokenProgram);
    const richBorrow = keyAt(keyAt(amount(borrowBase, swapInput), 0, richOwner), 6, richUsdc);
    const richRepay = keyAt(keyAt(repayIndex(amount(repayBase, swapInput), 0), 0, richOwner), 6, richUsdc);
    const richForward = keyAt(keyAt(keyAt(amount(minOutZero(forwardBase), swapInput), 4, richUsdc), 5, richOther), 10, richOwner);
    const richReverse = keyAt(keyAt(keyAt(amount(minOutZero(reverseBase), swapOutput), 4, richOther), 5, richUsdc), 10, richOwner);
    const crossingMonitor = [reserve, supply, richUsdc, feeVault, pair, poolX, poolY, richOther, oracle, ...binArrays].slice(0, 15);
    await run('flash_oncurve_signer_bin_crossing_roundtrip_10000000000', [
      richBorrow, richCreateAta, richForward, richReverse, richRepay,
    ], crossingMonitor);
  }
  const borrow2000 = amount(borrowBase, 2000n), repay2000 = repayIndex(amount(repayBase, 2000n), 0);
  await run('flash_two_repeated_roundtrips_1000', [borrow2000, createAta,
    amount(minOutZero(forwardBase), 1000n), amount(minOutZero(reverseBase), 532n),
    amount(minOutZero(forwardBase), 1000n), amount(minOutZero(reverseBase), 532n), repay2000]);

  const outsiderForward = keyAt(amount(minOutZero(forwardBase), 1000n), 10, OUTSIDER);
  await run('flash_outsider_signer', [amount(borrowBase, 1000n), createAta, outsiderForward, repayIndex(amount(repayBase, 1000n), 0)]);
  const alternateUsdcVault = CUSTODY.rows.flatMap((row) => row.controlVerified ? row.reserves : []).find((row) => row.mint === forwardBase.keys[7].pubkey.toBase58() && row.address !== poolY.toBase58());
  if (alternateUsdcVault) await run('flash_foreign_same_mint_reserve_y', [amount(borrowBase, 1000n), createAta, keyAt(amount(minOutZero(forwardBase), 1000n), 3, new PublicKey(alternateUsdcVault.address)), repayIndex(amount(repayBase, 1000n), 0)]);
  await run('flash_token_program_substitution', [amount(borrowBase, 1000n), createAta, keyAt(amount(minOutZero(forwardBase), 1000n), 12, new PublicKey('11111111111111111111111111111111')), repayIndex(amount(repayBase, 1000n), 0)]);
  await run('flash_output_aliases_pool_reserve', [amount(borrowBase, 1000n), createAta, keyAt(amount(minOutZero(forwardBase), 1000n), 5, poolX), repayIndex(amount(repayBase, 1000n), 0)]);
  await run('valid_then_outsider_atomicity', [createAta, amount(minOutZero(forwardBase), 1000n), outsiderForward]);
  await run('outsider_then_valid_atomicity', [createAta, outsiderForward, amount(minOutZero(forwardBase), 1000n)]);

  const output = {
    observedAt: new Date().toISOString(), rpcHost: new URL(RPC).hostname, signerVerification: false,
    transactionVersion: 1, wireByteLimit: 4096, inlineAccountLimit: 64,
    funding: { protocol: 'KLend', programId: borrowBase.programId.toBase58(), asset: 'USDC', reserve: reserve.toBase58(), supply: supply.toBase58(), feeVault: feeVault.toBase58(), decodedFlashLoanFeeSf: '0' },
    target: { programId: forwardBase.programId.toBase58(), pair: pair.toBase58(), poolX: poolX.toBase58(), poolY: poolY.toBase58(), userUsdc: userUsdc.toBase58(), userOtherToken: userTrump.toBase58(), oracle: oracle.toBase58(), binArrays: binArrays.map(String) },
    quotes: BUILT.boundaryQuotes, pre, monitor: monitor.map(String), results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, observedAt: output.observedAt, preSlot: pre.slot }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
