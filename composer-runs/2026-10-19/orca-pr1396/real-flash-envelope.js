#!/usr/bin/env node
'use strict';

// Build and simulate one signed Solana transaction-v1 containing real
// Save, KLend, and Project 0 flash loans around caller-supplied Whirlpool
// instructions. This module has no transaction submission path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = require('./runtime.js').nodeModules();
const {
  PublicKey, TransactionInstruction, SystemProgram,
} = require(`${MODULES}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
} = require(`${MODULES}/@solana/spl-token`);
const {encodeV1, signV1} = require('../../2026-10-15/hylo-exchange-v1-wire.js');

const CONTROL = path.join(__dirname, '..', 'bison-wsol-flash-envelope.json');
const PROGRAMS = Object.freeze({
  whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  save: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  klend: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  project0: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  wsol: 'So11111111111111111111111111111111111111112',
});
const P = value => value instanceof PublicKey ? value : new PublicKey(value);
const meta = (pubkey, isWritable, isSigner) => ({pubkey: P(pubkey), isWritable, isSigner});
const clone = ix => new TransactionInstruction({
  programId: ix.programId,
  keys: ix.keys.map(key => ({...key})),
  data: Buffer.from(ix.data),
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function decodeSignedV1Wire(signedBase64) {
  const wire = Buffer.from(signedBase64, 'base64');
  if (wire[0] !== 0x81) throw new Error('Control receipt is not transaction-v1');
  const signatures = wire[1];
  const readonlySigners = wire[2];
  const readonlyNonSigners = wire[3];
  const instructionCount = wire[40];
  const accountCount = wire[41];
  const keys = [];
  let offset = 42;
  for (let index = 0; index < accountCount; index += 1) {
    keys.push(new PublicKey(wire.subarray(offset, offset + 32)));
    offset += 32;
  }
  offset += 8; // Compute-unit and loaded-account-data limits.
  const headers = [];
  for (let index = 0; index < instructionCount; index += 1) {
    headers.push({program: wire[offset], accounts: wire[offset + 1],
      data: wire.readUInt16LE(offset + 2)});
    offset += 4;
  }
  const instructions = headers.map(header => {
    const indexes = wire.subarray(offset, offset + header.accounts);
    offset += header.accounts;
    const data = Buffer.from(wire.subarray(offset, offset + header.data));
    offset += header.data;
    const keyMetas = [...indexes].map(index => meta(keys[index],
      index < signatures ? index < signatures - readonlySigners
        : index < accountCount - readonlyNonSigners,
      index < signatures));
    return new TransactionInstruction({
      programId: keys[header.program], keys: keyMetas, data,
    });
  });
  if (offset + 64 * signatures !== wire.length)
    throw new Error('Control receipt has unexpected v1 payload length');
  return {wire, instructions, keys, signatures,
    blockhash: new PublicKey(wire.subarray(8, 40)).toBase58()};
}

function controlTemplates() {
  const receipt = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
  const row = receipt.cases.find(item => item.label === 'triple_save_klend_p0_control');
  if (!row || row.err || !row.completeRepayment || !row.wire?.sigVerify ||
      !row.wire?.signedBase64) {
    throw new Error('Pinned three-provider successful signed receipt is missing');
  }
  const decoded = decodeSignedV1Wire(row.wire.signedBase64);
  if (sha256(decoded.wire) !== row.wire.sha256)
    throw new Error('Pinned flash receipt SHA-256 mismatch');
  const expected = [PROGRAMS.project0, null, PROGRAMS.project0, PROGRAMS.save,
    PROGRAMS.klend, PROGRAMS.project0, PROGRAMS.project0, null, null,
    PROGRAMS.klend, PROGRAMS.save, PROGRAMS.project0];
  if (decoded.instructions.length !== expected.length || expected.some((program, index) =>
    program && !decoded.instructions[index].programId.equals(P(program)))) {
    throw new Error('Pinned real lender instruction layout changed');
  }
  return {receipt, row, ...decoded,
    init: decoded.instructions[0], ata: decoded.instructions[1],
    start: decoded.instructions[2], saveBorrow: decoded.instructions[3],
    klendBorrow: decoded.instructions[4], p0Borrow: decoded.instructions[5],
    p0Repay: decoded.instructions[6], klendRepay: decoded.instructions[9],
    saveRepay: decoded.instructions[10], end: decoded.instructions[11]};
}

function requireAmount(value, label) {
  const amount = BigInt(value);
  if (amount <= 0n || amount > 0xffffffffffffffffn)
    throw new RangeError(`${label} must be a positive u64`);
  return amount;
}

function saveFeeRaw(amount) {
  return (amount * 4n + 9_999n) / 10_000n;
}

function buildFlashEnvelope({
  actor, marginAccount, payloadInstructions, blockhash,
  providers = ['klend', 'project0', 'save'],
  amounts = {klend: 1_000_000_000n, project0: 100_000_000n, save: 1_000_000n},
  beforeBorrow = [], afterRepay = [], saveFeeTopup = true,
  initializeMargin = true, createWsolAta = true,
  extraSigners = [], requireWhirlpoolPayload = true,
  computeLimit = 1_400_000,
}) {
  if (!actor?.publicKey || !marginAccount?.publicKey)
    throw new Error('actor and marginAccount must be controlled Keypairs');
  if (!blockhash) throw new Error('A current fork blockhash is required');
  if (!Array.isArray(payloadInstructions) || !payloadInstructions.length)
    throw new Error('Provide actual Whirlpool payload instructions');
  const selected = new Set(providers);
  if (selected.size !== providers.length ||
      [...selected].some(provider => !['save', 'klend', 'project0'].includes(provider)) ||
      !selected.has('klend') || !selected.has('project0') ||
      selected.size < 2 || selected.size > 3) {
    throw new Error('Choose exactly KLend+Project0, with optional Save');
  }
  if (requireWhirlpoolPayload && !payloadInstructions.some(ix =>
    ix.programId.equals(P(PROGRAMS.whirlpool)))) {
    throw new Error('At least one payload instruction must invoke real Whirlpool');
  }

  const t = controlTemplates();
  const wsolAta = getAssociatedTokenAddressSync(P(PROGRAMS.wsol), actor.publicKey);
  const replacements = new Map([
    [t.receipt.outsider.authority, actor.publicKey],
    [t.receipt.outsider.marginAccount, marginAccount.publicKey],
    [t.receipt.outsider.wsolAta, wsolAta],
  ]);
  function adapted(template) {
    const instruction = clone(template);
    instruction.keys = instruction.keys.map(key => ({...key,
      pubkey: replacements.get(key.pubkey.toBase58()) || key.pubkey}));
    return instruction;
  }
  const p0Amount = requireAmount(amounts.project0, 'Project0 amount');
  const klendAmount = requireAmount(amounts.klend, 'KLend amount');
  const saveAmount = selected.has('save') ? requireAmount(amounts.save, 'Save amount') : 0n;

  const init = adapted(t.init);
  const ata = adapted(t.ata);
  const start = adapted(t.start);
  const p0Borrow = adapted(t.p0Borrow);
  const p0Repay = adapted(t.p0Repay);
  const klendBorrow = adapted(t.klendBorrow);
  const klendRepay = adapted(t.klendRepay);
  const saveBorrow = selected.has('save') ? adapted(t.saveBorrow) : null;
  const saveRepay = selected.has('save') ? adapted(t.saveRepay) : null;
  const end = adapted(t.end);
  for (const instruction of [p0Borrow, p0Repay])
    instruction.data.writeBigUInt64LE(p0Amount, 8);
  for (const instruction of [klendBorrow, klendRepay])
    instruction.data.writeBigUInt64LE(klendAmount, 8);
  if (saveBorrow) for (const instruction of [saveBorrow, saveRepay])
    instruction.data.writeBigUInt64LE(saveAmount, 1);

  const instructions = [
    ...(initializeMargin ? [init] : []),
    ...(createWsolAta ? [ata] : []),
    ...beforeBorrow, start,
  ];
  if (saveBorrow) instructions.push(saveBorrow);
  instructions.push(klendBorrow, p0Borrow, ...payloadInstructions, p0Repay);
  if (saveBorrow && saveFeeTopup) {
    const fee = saveFeeRaw(saveAmount);
    if (fee > 0n) {
      instructions.push(SystemProgram.transfer({
        fromPubkey: actor.publicKey, toPubkey: wsolAta, lamports: fee,
      }));
      instructions.push(new TransactionInstruction({
        programId: TOKEN_PROGRAM_ID,
        keys: [meta(wsolAta, true, false)],
        data: Buffer.from([17]), // SyncNative
      }));
    }
  }
  instructions.push(klendRepay);
  if (saveRepay) instructions.push(saveRepay);
  instructions.push(end, ...afterRepay);

  const index = {
    p0Start: instructions.indexOf(start), p0End: instructions.indexOf(end),
    klendBorrow: instructions.indexOf(klendBorrow),
    klendRepay: instructions.indexOf(klendRepay),
    saveBorrow: saveBorrow ? instructions.indexOf(saveBorrow) : null,
    saveRepay: saveRepay ? instructions.indexOf(saveRepay) : null,
    whirlpool: instructions.map((instruction, i) => instruction.programId.equals(
      P(PROGRAMS.whirlpool)) ? i : null).filter(i => i !== null),
  };
  if (index.p0End > 255 || index.klendBorrow > 255 ||
      (saveBorrow && index.saveBorrow > 255)) {
    throw new Error('Indexed flash instruction exceeds u8 transaction index');
  }
  start.data.writeBigUInt64LE(BigInt(index.p0End), 8);
  klendRepay.data[16] = index.klendBorrow;
  if (saveRepay) saveRepay.data[9] = index.saveBorrow;

  const encoded = encodeV1(instructions, actor.publicKey, blockhash, computeLimit);
  const signed = signV1(encoded, instructions, actor.publicKey, blockhash,
    [actor, marginAccount, ...extraSigners]);
  return {
    instructions, wire: signed.wire, signerOrder: signed.signerOrder,
    index, wsolAta, feeTopupRaw: saveBorrow && saveFeeTopup ? saveFeeRaw(saveAmount) : 0n,
    amounts: {klend: klendAmount, project0: p0Amount, save: saveAmount},
    stats: {version: 1, bytes: encoded.sizeBytes, accounts: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      computeLimit, sha256: sha256(signed.wire)},
    lenderAccounts: {
      saveSupply: t.receipt.accounts.saveSupply,
      klendSupply: t.receipt.accounts.klendSupply,
      p0Vault: t.receipt.accounts.p0Vault,
      saveFee: t.receipt.accounts.saveFee,
    },
  };
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const body = await response.json();
  if (body.error) {
    // Surfpool may echo its upstream RPC URL inside a nested error. Never
    // print or persist a user-provided API key when a fork fetch fails.
    const safeError = JSON.stringify(body.error)
      .replace(/api-key=[^\\"\s)]+/g, 'api-key=[REDACTED]');
    throw new Error(`${method}: ${safeError}`);
  }
  return body.result;
}

function tokenAmount(account) {
  if (!account || account.owner !== TOKEN_PROGRAM_ID.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64) : null;
}

async function simulateFlashEnvelope(forkRpc, envelope, watch = []) {
  const addresses = [...new Set([...envelope.instructions.flatMap(ix => [
    ix.programId.toBase58(), ...ix.keys.map(key => key.pubkey.toBase58())]),
    ...Object.values(envelope.lenderAccounts), ...watch.map(String)])];
  // Surfpool lazily imports real accounts and programs from its mainnet datasource.
  for (let first = 0; first < addresses.length; first += 10) {
    await Promise.all(addresses.slice(first, first + 10).map(address =>
      rpc(forkRpc, 'getAccountInfo', [address, {encoding: 'base64', commitment: 'processed'}])));
  }
  const watched = [...new Set([...Object.values(envelope.lenderAccounts), ...watch.map(String)])];
  const before = await rpc(forkRpc, 'getMultipleAccounts', [watched,
    {encoding: 'base64', commitment: 'processed'}]);
  const result = await rpc(forkRpc, 'simulateTransaction', [envelope.wire.toString('base64'),
    {encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched}}]);
  const after = result.value.accounts || [];
  const deltas = Object.fromEntries(watched.map((address, index) => {
    const pre = tokenAmount(before.value[index]);
    const post = tokenAmount(after[index]);
    return [address, pre !== null && post !== null ? String(post - pre) : null];
  }));
  const expectedRepayments = [envelope.lenderAccounts.klendSupply,
    envelope.lenderAccounts.p0Vault,
    ...(envelope.amounts.save > 0n ? [envelope.lenderAccounts.saveSupply] : [])];
  return {err: result.value.err || null, unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    logs: result.value.logs || [], innerInstructions: result.value.innerInstructions || [],
    watched, beforeAccounts: before.value, afterAccounts: after,
    lenderVaultDeltas: deltas,
    completeRepayment: !result.value.err && expectedRepayments.every(address => deltas[address] === '0'),
    stats: envelope.stats, index: envelope.index};
}

module.exports = {PROGRAMS, decodeSignedV1Wire, controlTemplates,
  buildFlashEnvelope, simulateFlashEnvelope, saveFeeRaw, rpc};
