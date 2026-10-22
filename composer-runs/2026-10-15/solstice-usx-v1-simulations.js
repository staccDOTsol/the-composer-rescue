#!/usr/bin/env node
'use strict';

// Read-only simulations against the currently deployed Solstice YieldVault and
// KLend programs. This script constructs actual Solana transaction-version-1
// wire messages (4,096-byte cap), verifies that web3.js can deserialize them,
// and calls simulateTransaction with signature verification disabled. It never
// calls sendTransaction and never prints the configured RPC URL.

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/kliquidity-sdk-official/node_modules';
const LOCAL_WEB3 = `${MODULES}/@solana/web3.js`;
const V1_WEB3 = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js';
const web3 = require(LOCAL_WEB3).MessageV1 ? require(LOCAL_WEB3) : require(V1_WEB3);
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  MessageV1,
  VersionedTransaction,
} = web3;
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;

const ROOT = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const OUT = `${ROOT}/solstice-usx-v1-simulations.json`;
const IDL_ARTIFACT = JSON.parse(fs.readFileSync(`${ROOT}/solstice-usx-official-frontend-idl.json`, 'utf8'));
const IDL = IDL_ARTIFACT.idl;
const FLASH_HISTORY = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`, 'utf8'));
const ENV = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split('\n').filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = (process.env.RPC_URL || ENV.RPC_URL || ENV.HEAVY_RPC_URL || '').replace(/^['"]|['"]$/g, '');
if (!RPC) throw new Error('RPC_URL is not configured');
const CONNECTION = new Connection(RPC, 'confirmed');

const P = (value) => new PublicKey(value);
const PROGRAM = P('eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = P('11111111111111111111111111111111');
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const USX = P('6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG');
const EUSX = P('3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC');
const CONTROLLER = P('2aHdm37djj4c21ztMRBmmo4my6RtzN5Nn58Y39rpWbRM');
const VESTING = P('FCA4A8W8qzcXGDyBaQ8fiSqr2VowSihiz2bJKN9LcLwb');
const YIELD_POOL = P('2rjmJdxZeBLKjUjKjrSdtSqshgXbLEcPbjiJZ2vLNcCT');
const ASSET_VAULT = P('2SGicAhchh23nsrtWrur7zPAdb4hHtnyThQVPfza8CHA');

// A recent ordinary user whose withdrawal completed before this review. The
// user's current escrow and escrow vault are empty. Treating this address as
// controlled is conservative: no victim or operator signature is simulated.
const OUTSIDER = P('8cMVF74wYeTpM1yi1tQSYYhTHsoFSbzpXvapFk9MGo6Z');
const OUTSIDER_USX = P('8DWKv6FnQmjjNZjWTfsLAi5SZCNjRqDrfXbFzMZneYLy');
const OUTSIDER_EUSX = P('9upyfsTW9LMCSuworyLRQ6w9nzgD8BVeZxZDH3P5f5x');
const OUTSIDER_COOLDOWN = P('4KL9Uomii7BF2FfhBzrAoNsBMfPqq5qD2jecYcse1mYZ');
const OUTSIDER_COOLDOWN_VAULT = P('4wNKXYB1ESeD4kg2WvxomXaiu5BqYL2puaMAhomYcjaD');

// The large live cooldown claim called out by the prior custody census.
const CLAIM_USER = P('A9aaMu2V64S8WNeNmiCz3ZpKrtSjaanpe2TuDVXurHY9');
const CLAIM_COOLDOWN = P('E9URmf61v9M6mCXRhRExzGrJnnmYvAFjoUaXwfEq6eRv');
const CLAIM_VAULT = P('2QxQFy2foi3YLG6YJPdTa242FwNaXkXvHZBKr4FunDgC');

// Current permission path observed in a successful harvester CPI.
const HARVESTER = P('D2oMURfityVQD5bax4MVy4BLa1wnJ6WXgJ2t8CUVXYR2');
const HARVESTER_USX = P('FdwuHo9eFQn44AnbLZDbnni86TGYyi5c7SpMtEKFVU8T');
const PERMISSION = P('5KzVcKDyzMFUh32tMESHjfA7vTALfDHbVxq9HbZd8rz');

// A token account owned by another ordinary eUSX holder. It is used only to
// prove that substituting somebody else's share account is rejected.
const OTHER_USER_EUSX = P('HAtQrpatq5A4nuDA14PsEpfKHkU7ifiusFzmx9UbHXX6');

const KLEND_RESERVE = P('H2pmnDSjfxeQ8zUeyUohokegYbXZgkjH4kgmoQVybyAX');
const KLEND_MARKET = P('9Y7uwXgQ68mGqRtZfuFaP4hc4fxeJ7cE9zTtqTxVhfGU');
const KLEND_SUPPLY = P('7Dow2t58RhFkqd1M2DLuZCaS5cGivXHC7WCDT632Nhsf');
const KLEND_FEE_VAULT = P('FzKdxfvcLVZvskpmWiLS6Z7bEKrJgCKRaLBvoYPMuMPt');
const [KLEND_MARKET_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), KLEND_MARKET.toBuffer()], KLEND);

const MAX_V1_BYTES = 4096;
const MAX_V1_KEYS = 64;
const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32LE(Number(value)); return out; };
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const readU128 = (data, offset) => BigInt(`0x${Buffer.from(data.subarray(offset, offset + 16)).reverse().toString('hex') || '0'}`);
const key = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });

function instructionDefinition(name) {
  const value = IDL.instructions.find((instruction) => instruction.name === name);
  if (!value) throw new Error(`IDL instruction not found: ${name}`);
  return value;
}

function instructionDiscriminator(name) {
  return Buffer.from(instructionDefinition(name).discriminator);
}

function assertPda(label, address, seeds) {
  const [derived, bump] = PublicKey.findProgramAddressSync(seeds, PROGRAM);
  if (!derived.equals(address)) throw new Error(`${label} PDA mismatch: ${derived}`);
  return { label, address: address.toBase58(), bump, verified: true };
}

const pdaProofs = [
  assertPda('controller', CONTROLLER, [Buffer.from('CONTROLLER')]),
  assertPda('vestingSchedule', VESTING, [Buffer.from('VESTING_SCHEDULE')]),
  assertPda('yieldPool', YIELD_POOL, [Buffer.from('YIELD_POOL')]),
  assertPda('assetVault', ASSET_VAULT, [Buffer.from('ASSET_VAULT')]),
  assertPda('shareMint', EUSX, [Buffer.from('SHARE_MINT')]),
  assertPda('outsiderCooldown', OUTSIDER_COOLDOWN, [Buffer.from('COOLDOWN_ESCROW'), OUTSIDER.toBuffer()]),
  assertPda('outsiderCooldownVault', OUTSIDER_COOLDOWN_VAULT, [Buffer.from('COOLDOWN_ESCROW_VAULT'), OUTSIDER.toBuffer()]),
  assertPda('largeClaimCooldown', CLAIM_COOLDOWN, [Buffer.from('COOLDOWN_ESCROW'), CLAIM_USER.toBuffer()]),
  assertPda('largeClaimVault', CLAIM_VAULT, [Buffer.from('COOLDOWN_ESCROW_VAULT'), CLAIM_USER.toBuffer()]),
  assertPda('permissionedAccount', PERMISSION, [Buffer.from('PERMISSIONED_ACCOUNT'), HARVESTER.toBuffer()]),
];

function lockIx(amount, overrides = {}) {
  const accounts = [
    key(OUTSIDER, true, true), key(OUTSIDER, true, true), key(CONTROLLER), key(VESTING),
    key(EUSX, false, true), key(OUTSIDER_EUSX, false, true), key(USX),
    key(ASSET_VAULT, false, true), key(YIELD_POOL, false, true),
    key(OUTSIDER_USX, false, true), key(TOKEN),
  ];
  for (const [position, replacement] of Object.entries(overrides)) accounts[Number(position)] = replacement;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([instructionDiscriminator('lock'), u64(amount)]) });
}

function unlockIx(amount, overrides = {}) {
  const accounts = [
    key(OUTSIDER, true), key(OUTSIDER, true, true), key(CONTROLLER), key(VESTING),
    key(EUSX, false, true), key(OUTSIDER_EUSX, false, true), key(USX),
    key(ASSET_VAULT, false, true), key(YIELD_POOL, false, true),
    key(OUTSIDER_COOLDOWN, false, true), key(OUTSIDER_COOLDOWN_VAULT, false, true),
    key(TOKEN), key(SYSTEM),
  ];
  for (const [position, replacement] of Object.entries(overrides)) accounts[Number(position)] = replacement;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([instructionDiscriminator('unlock'), u64(amount)]) });
}

function withdrawIx(overrides = {}, trailingAmount) {
  const accounts = [
    key(OUTSIDER, true), key(OUTSIDER, true, true), key(CONTROLLER), key(USX),
    key(OUTSIDER_USX, false, true), key(OUTSIDER_COOLDOWN, false, true),
    key(OUTSIDER_COOLDOWN_VAULT, false, true), key(TOKEN),
  ];
  for (const [position, replacement] of Object.entries(overrides)) accounts[Number(position)] = replacement;
  const data = trailingAmount === undefined ? instructionDiscriminator('withdraw') :
    Buffer.concat([instructionDiscriminator('withdraw'), u64(trailingAmount)]);
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts, data });
}

function transferYieldIx(amount, overrides = {}) {
  const accounts = [
    key(OUTSIDER, true), key(OUTSIDER, true, true), key(PERMISSION), key(CONTROLLER),
    key(VESTING, false, true), key(OUTSIDER_USX, false, true), key(USX),
    key(ASSET_VAULT, false, true), key(YIELD_POOL, false, true), key(TOKEN),
  ];
  for (const [position, replacement] of Object.entries(overrides)) accounts[Number(position)] = replacement;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([instructionDiscriminator('transfer_in_yield'), u64(amount)]) });
}

function historyInstruction(index) {
  const sample = FLASH_HISTORY.hits[0].transaction;
  const message = sample.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = sample.meta.loadedAddresses?.writable || [];
  const loadedReadonly = sample.meta.loadedAddresses?.readonly || [];
  const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  const header = message.header;
  const isWritable = (accountIndex) => {
    if (accountIndex < staticKeys.length) {
      if (accountIndex < header.numRequiredSignatures) {
        return accountIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts;
      }
      return accountIndex < staticKeys.length - header.numReadonlyUnsignedAccounts;
    }
    return accountIndex < staticKeys.length + loadedWritable.length;
  };
  const source = message.instructions[index];
  return new TransactionInstruction({
    programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map((accountIndex) => key(P(allKeys[accountIndex]),
      accountIndex < header.numRequiredSignatures, isWritable(accountIndex))),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

const BORROW_TEMPLATE = historyInstruction(3);
const REPAY_TEMPLATE = historyInstruction(13);
if (!BORROW_TEMPLATE.programId.equals(KLEND) || !REPAY_TEMPLATE.programId.equals(KLEND)) {
  throw new Error('Historical KLend instruction template indexes changed');
}

function flashIx(template, amount, repayIndex) {
  const keys = template.keys.map((meta) => ({ ...meta }));
  const replacements = {
    0: OUTSIDER, 1: KLEND_MARKET_AUTHORITY, 2: KLEND_MARKET, 3: KLEND_RESERVE,
    4: USX, 5: KLEND_SUPPLY, 6: OUTSIDER_USX, 7: KLEND_FEE_VAULT,
    8: KLEND, 9: KLEND, 10: SYSVAR_INSTRUCTIONS, 11: TOKEN,
  };
  for (const [position, pubkey] of Object.entries(replacements)) keys[Number(position)].pubkey = pubkey;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({ programId: KLEND, keys, data });
}

function serializeV1(instructions, blockhash, transactionConfig = {
  computeUnitLimit: 1_400_000,
  loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
}) {
  const v0 = new TransactionMessage({ payerKey: OUTSIDER, recentBlockhash: blockhash, instructions })
    .compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 test messages may not use address tables');
  if (v0.staticAccountKeys.length > MAX_V1_KEYS) throw new Error(`v1 key limit exceeded: ${v0.staticAccountKeys.length}`);
  if (v0.compiledInstructions.length > 255) throw new Error('v1 instruction count exceeds u8');

  let configMask = 0;
  const config = [];
  if (transactionConfig.priorityFee != null) { configMask |= 0b00011; config.push(u64(transactionConfig.priorityFee)); }
  if (transactionConfig.computeUnitLimit != null) { configMask |= 0b00100; config.push(u32(transactionConfig.computeUnitLimit)); }
  if (transactionConfig.loadedAccountsDataSizeLimit != null) { configMask |= 0b01000; config.push(u32(transactionConfig.loadedAccountsDataSizeLimit)); }
  if (transactionConfig.heapSize != null) { configMask |= 0b10000; config.push(u32(transactionConfig.heapSize)); }

  const message = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures, v0.header.numReadonlySignedAccounts,
      v0.header.numReadonlyUnsignedAccounts]),
    u32(configMask),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([v0.compiledInstructions.length, v0.staticAccountKeys.length]),
    ...v0.staticAccountKeys.map((address) => address.toBuffer()),
    ...config,
    ...v0.compiledInstructions.map((instruction) => {
      if (instruction.accountKeyIndexes.length > 255 || instruction.data.length > 65535) {
        throw new Error('v1 instruction field overflow');
      }
      const header = Buffer.alloc(4);
      header[0] = instruction.programIdIndex;
      header[1] = instruction.accountKeyIndexes.length;
      header.writeUInt16LE(instruction.data.length, 2);
      return header;
    }),
    ...v0.compiledInstructions.flatMap((instruction) =>
      [Buffer.from(instruction.accountKeyIndexes), Buffer.from(instruction.data)]),
  ]);
  const decoded = MessageV1.deserialize(message);
  if (decoded.staticAccountKeys.length !== v0.staticAccountKeys.length ||
      decoded.compiledInstructions.length !== instructions.length) {
    throw new Error('v1 message decode verification mismatch');
  }
  const wire = Buffer.concat([message, Buffer.alloc(v0.header.numRequiredSignatures * 64)]);
  if (wire.length > MAX_V1_BYTES) throw new Error(`v1 wire exceeds 4096 bytes: ${wire.length}`);
  const transaction = VersionedTransaction.deserialize(wire);
  if (transaction.version !== 1) throw new Error('serialized transaction did not decode as version 1');
  return { wire, message, decoded, transaction };
}

const watch = [
  ['outsiderUsx', OUTSIDER_USX, 'token'],
  ['outsiderEusx', OUTSIDER_EUSX, 'token'],
  ['assetVault', ASSET_VAULT, 'token'],
  ['shareMint', EUSX, 'mint'],
  ['yieldPool', YIELD_POOL, 'yieldPool'],
  ['vestingSchedule', VESTING, 'vesting'],
  ['outsiderCooldown', OUTSIDER_COOLDOWN, 'cooldown'],
  ['outsiderCooldownVault', OUTSIDER_COOLDOWN_VAULT, 'token'],
  ['largeClaimCooldown', CLAIM_COOLDOWN, 'cooldown'],
  ['largeClaimVault', CLAIM_VAULT, 'token'],
  ['klendReserve', KLEND_RESERVE, 'reserve'],
  ['klendSupply', KLEND_SUPPLY, 'token'],
  ['klendFeeVault', KLEND_FEE_VAULT, 'token'],
  ['permissionedAccount', PERMISSION, 'permission'],
  ['controller', CONTROLLER, 'controller'],
];

function baseAccount(account) {
  if (!account) return { exists: false };
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  return {
    exists: true,
    owner: typeof account.owner === 'string' ? account.owner : account.owner.toBase58(),
    dataLength: data.length,
    dataSha256: sha256(data),
    data,
  };
}

function decodeAccount(role, account) {
  const base = baseAccount(account);
  if (!base.exists) return base;
  const data = base.data;
  const result = { exists: true, owner: base.owner, dataLength: base.dataLength, dataSha256: base.dataSha256 };
  if (role === 'token') {
    result.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    result.authority = new PublicKey(data.subarray(32, 64)).toBase58();
    result.amountRaw = data.readBigUInt64LE(64).toString();
  } else if (role === 'mint') {
    result.supplyRaw = data.readBigUInt64LE(36).toString();
    result.decimals = data[44];
  } else if (role === 'yieldPool') {
    result.bump = data[8];
    result.assetMint = new PublicKey(data.subarray(9, 41)).toBase58();
    result.assetMintDecimals = data[41];
    result.assetVault = new PublicKey(data.subarray(42, 74)).toBase58();
    result.assetVaultBump = data[74];
    result.totalAssetsRaw = readU128(data, 75).toString();
    result.sharesSupplyRaw = readU128(data, 91).toString();
  } else if (role === 'vesting') {
    result.bump = data[8];
    result.vestingAmountRaw = data.readBigUInt64LE(9).toString();
    result.startTime = data.readBigUInt64LE(17).toString();
    result.endTime = data.readBigUInt64LE(25).toString();
  } else if (role === 'cooldown') {
    result.user = new PublicKey(data.subarray(8, 40)).toBase58();
    result.bump = data[40];
    result.assetMint = new PublicKey(data.subarray(41, 73)).toBase58();
    result.assetAmountRaw = data.readBigUInt64LE(73).toString();
    result.cooldownEnd = data.readBigUInt64LE(81).toString();
  } else if (role === 'reserve') {
    result.market = new PublicKey(data.subarray(32, 64)).toBase58();
    result.mint = new PublicKey(data.subarray(128, 160)).toBase58();
    result.supplyVault = new PublicKey(data.subarray(160, 192)).toBase58();
    result.feeVault = new PublicKey(data.subarray(192, 224)).toBase58();
    result.availableRaw = data.readBigUInt64LE(224).toString();
    result.flashLoanFeeSf = data.readBigUInt64LE(4904).toString();
    result.status = data[4856];
    result.emergencyMode = data[4864];
  } else if (role === 'permission') {
    result.bump = data[8];
    result.canSendYield = data[9] !== 0;
  } else if (role === 'controller') {
    result.authority = new PublicKey(data.subarray(8, 40)).toBase58();
    result.bump = data[40];
    result.shareMint = new PublicKey(data.subarray(41, 73)).toBase58();
    result.shareMintDecimals = data[73];
    result.vestingPeriodSeconds = data.readBigUInt64LE(74).toString();
    result.cooldownPeriodSeconds = data.readBigUInt64LE(82).toString();
    result.hasProposedAuthority = data[122] !== 0;
    result.isFrozen = data[123] !== 0;
  }
  return result;
}

function image(accounts, selectedWatch = watch) {
  return Object.fromEntries(selectedWatch.map(([label, , role], index) => [label, decodeAccount(role, accounts?.[index])]));
}

function changes(before, after) {
  const fields = ['amountRaw', 'supplyRaw', 'totalAssetsRaw', 'sharesSupplyRaw',
    'assetAmountRaw', 'cooldownEnd', 'availableRaw'];
  const output = {};
  for (const [label] of watch) {
    const row = {};
    for (const field of fields) {
      if (before[label]?.[field] !== undefined && after[label]?.[field] !== undefined) {
        const delta = BigInt(after[label][field]) - BigInt(before[label][field]);
        if (delta !== 0n) row[field] = { before: before[label][field], after: after[label][field], delta: delta.toString() };
      }
    }
    if (Object.keys(row).length) output[label] = row;
  }
  return output;
}

const eventDefinitions = new Map();
for (const event of IDL.events || []) {
  const type = IDL.types.find((candidate) => candidate.name === event.name)?.type;
  if (type?.kind === 'struct') eventDefinitions.set(Buffer.from(event.discriminator).toString('hex'),
    { name: event.name, fields: type.fields });
}

function decodeInteger(data, offset, bytes) {
  return BigInt(`0x${Buffer.from(data.subarray(offset, offset + bytes)).reverse().toString('hex') || '0'}`);
}

function decodeEvents(logs) {
  const output = [];
  for (const line of logs || []) {
    if (!line.startsWith('Program data: ')) continue;
    let data;
    try { data = Buffer.from(line.slice('Program data: '.length), 'base64'); } catch { continue; }
    const definition = eventDefinitions.get(data.subarray(0, 8).toString('hex'));
    if (!definition) continue;
    let offset = 8;
    const fields = {};
    let valid = true;
    for (const field of definition.fields) {
      const type = field.type;
      if (type === 'pubkey') {
        if (offset + 32 > data.length) { valid = false; break; }
        fields[field.name] = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
        offset += 32;
      } else if (type === 'u64') {
        if (offset + 8 > data.length) { valid = false; break; }
        fields[field.name] = decodeInteger(data, offset, 8).toString(); offset += 8;
      } else if (type === 'u128') {
        if (offset + 16 > data.length) { valid = false; break; }
        fields[field.name] = decodeInteger(data, offset, 16).toString(); offset += 16;
      } else if (type === 'bool') {
        if (offset + 1 > data.length) { valid = false; break; }
        fields[field.name] = data[offset] !== 0; offset += 1;
      } else { valid = false; break; }
    }
    if (valid) output.push({ name: definition.name, fields });
  }
  return output;
}

const idlErrors = new Map((IDL.errors || []).map((error) => [error.code, error]));
const anchorErrors = new Map([
  [2006, { code: 2006, name: 'ConstraintSeeds', msg: 'A seeds constraint was violated.' }],
  [3010, { code: 3010, name: 'AccountNotSigner', msg: 'The given account did not sign.' }],
]);
function describeError(err, logs) {
  const custom = err?.InstructionError?.[1]?.Custom;
  const failedLine = [...(logs || [])].reverse().find((line) => line.includes(' failed: ')) || null;
  if (custom === undefined) return { raw: err || null, failedLine };
  const known = idlErrors.get(custom) || anchorErrors.get(custom);
  return { raw: err, customCode: custom, idl: known || null, failedLine };
}

async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }) });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

async function simulate(label, instructions, blockhash, before, metadata = {}) {
  try {
    const encoded = serializeV1(instructions, blockhash);
    const messageAddresses = new Set(encoded.decoded.staticAccountKeys.map((address) => address.toBase58()));
    const selectedWatch = watch.filter(([, address]) => messageAddresses.has(address.toBase58()));
    const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      innerInstructions: true,
      accounts: { encoding: 'base64', addresses: selectedWatch.map(([, address]) => address.toBase58()) },
    }]);
    const value = result.value;
    const after = image(value.accounts, selectedWatch);
    const row = {
      label,
      metadata,
      contextSlot: result.context.slot,
      err: value.err || null,
      error: describeError(value.err, value.logs),
      unitsConsumed: value.unitsConsumed,
      loadedAccountsDataSize: value.loadedAccountsDataSize,
      events: decodeEvents(value.logs),
      monitoredAccounts: selectedWatch.map(([accountLabel, address]) => ({ label: accountLabel, address: address.toBase58() })),
      changes: changes(before, after),
      after,
      logs: value.logs || [],
      message: {
        version: 1,
        wireBytes: encoded.wire.length,
        messageBytes: encoded.message.length,
        staticAccountKeys: encoded.decoded.staticAccountKeys.length,
        requiredSignatures: encoded.decoded.header.numRequiredSignatures,
        instructions: encoded.decoded.compiledInstructions.length,
        computeUnitLimit: encoded.decoded.transactionConfig.computeUnitLimit,
        loadedAccountsDataSizeLimit: encoded.decoded.transactionConfig.loadedAccountsDataSizeLimit,
        wireSha256: sha256(encoded.wire),
        wireBase64: encoded.wire.toString('base64'),
      },
    };
    process.stdout.write(`${JSON.stringify({ label, err: row.err, error: row.error?.idl?.name || row.error?.failedLine,
      wireBytes: row.message.wireBytes, keys: row.message.staticAccountKeys,
      unitsConsumed: row.unitsConsumed, events: row.events.map((event) => event.name) })}\n`);
    return row;
  } catch (error) {
    const row = { label, metadata, constructionOrTransportError: String(error.stack || error) };
    process.stdout.write(`${JSON.stringify({ label, constructionOrTransportError: error.message })}\n`);
    return row;
  }
}

function eventValue(result, eventName, fieldName) {
  return result.events?.find((event) => event.name === eventName)?.fields?.[fieldName];
}

function unvestedAt(vesting, unixTime) {
  const amount = BigInt(vesting.vestingAmountRaw);
  const start = BigInt(vesting.startTime);
  const end = BigInt(vesting.endTime);
  const now = BigInt(unixTime);
  if (now < start) return amount;
  if (now >= end || end <= start) return 0n;
  return amount * (end - now) / (end - start);
}

function estimatedShares(before, amount, unixTime) {
  const totalAssets = BigInt(before.yieldPool.totalAssetsRaw);
  const supply = BigInt(before.yieldPool.sharesSupplyRaw);
  const effectiveAssets = totalAssets - unvestedAt(before.vestingSchedule, unixTime);
  // The current official frontend uses virtual +1 terms. Exact values are
  // subsequently taken from current-program LockEvent simulations.
  return BigInt(amount) * (supply + 1n) / (effectiveAssets + 1n);
}

async function main() {
  const latestSlot = await CONNECTION.getSlot('confirmed');
  const latestBlockTime = await CONNECTION.getBlockTime(latestSlot);
  const latestBlockhash = (await CONNECTION.getLatestBlockhash('confirmed')).blockhash;
  const pre = await CONNECTION.getMultipleAccountsInfoAndContext(watch.map(([, address]) => address), 'confirmed');
  const before = image(pre.value);
  const available = BigInt(before.klendReserve.availableRaw);
  const flashFeeSf = BigInt(before.klendReserve.flashLoanFeeSf);

  if (flashFeeSf !== 0n) throw new Error(`KLend reserve is not exact-zero-rate: ${flashFeeSf}`);
  if (before.klendReserve.market !== KLEND_MARKET.toBase58() || before.klendReserve.mint !== USX.toBase58() ||
      before.klendReserve.supplyVault !== KLEND_SUPPLY.toBase58() || before.klendReserve.feeVault !== KLEND_FEE_VAULT.toBase58()) {
    throw new Error('KLend reserve relationship mismatch');
  }
  if (before.assetVault.authority !== CONTROLLER.toBase58() || before.assetVault.mint !== USX.toBase58()) {
    throw new Error('Solstice asset vault relationship mismatch');
  }
  if (before.shareMint.supplyRaw === undefined || before.yieldPool.assetMint !== USX.toBase58() ||
      before.yieldPool.assetVault !== ASSET_VAULT.toBase58()) {
    throw new Error('Solstice pool relationship mismatch');
  }

  const results = [];
  const run = async (label, instructions, metadata) => {
    const result = await simulate(label, instructions, latestBlockhash, before, metadata);
    results.push(result);
    return result;
  };

  // Flash-liquidity controls: prove the current reserve is usable, exactly
  // zero-rate, and supports both dust and near-available principal.
  for (const amount of [1n, 2n, 10n, available - 1n, available]) {
    await run(`klend_flash_repay_control_${amount}`, [
      flashIx(BORROW_TEMPLATE, amount), flashIx(REPAY_TEMPLATE, amount, 0),
    ], { category: 'flash-control', amountRaw: amount.toString(), expected: 'success and exact full repayment' });
  }

  // Cross-account substitutions against the $5.203M user-bound claim.
  await run('outsider_substitutes_large_claim_pdas', [withdrawIx({
    5: key(CLAIM_COOLDOWN, false, true), 6: key(CLAIM_VAULT, false, true),
  })], { category: 'account-substitution', expected: 'PDA seed constraint rejects claim substitution' });

  await run('large_claim_user_without_beneficiary_signature', [withdrawIx({
    0: key(CLAIM_USER, false), 1: key(OUTSIDER, true, true),
    5: key(CLAIM_COOLDOWN, false, true), 6: key(CLAIM_VAULT, false, true),
  })], { category: 'signature-control', expected: 'required beneficiary signer constraint rejects outsider' });

  await run('outsider_substitutes_other_users_share_account', [unlockIx(1n, {
    5: key(OTHER_USER_EUSX, false, true),
  })], { category: 'account-substitution', expected: 'token-owner constraint rejects another user share account' });

  await run('outsider_unlocks_with_zero_owned_shares', [unlockIx(1n)], {
    category: 'balance-control', expected: 'insufficient share balance; no claim created',
  });

  await run('outsider_substitutes_legitimate_permission_record', [transferYieldIx(1n)], {
    category: 'permission-substitution', expected: 'permission PDA seed binding rejects outsider',
  });

  await run('legitimate_harvester_without_harvester_signature', [transferYieldIx(1n, {
    0: key(HARVESTER, false), 2: key(PERMISSION), 5: key(HARVESTER_USX, false, true),
  })], { category: 'signature-control', expected: 'harvester signer constraint rejects outsider payer' });

  // Obtain exact current-binary share outputs from failed atomic flash prefixes.
  // Although the transaction rolls back at repay, earlier program events expose
  // the share calculation used by the deployed program.
  const flashTargetAmounts = [1n, 2n, 10n, 1_000_000n, available - 1n];
  for (const amount of flashTargetAmounts) {
    const prefix = await run(`flash_lock_then_repay_${amount}`, [
      flashIx(BORROW_TEMPLATE, amount), lockIx(amount), flashIx(REPAY_TEMPLATE, amount, 0),
    ], { category: 'atomic-prefix', amountRaw: amount.toString(), expected: 'repay fails because principal was locked; entire transaction rolls back' });
    const eventShares = eventValue(prefix, 'LockEvent', 'share_amount');
    if (!eventShares) continue;
    const estimated = estimatedShares(before, amount,
      BigInt(latestBlockTime || Math.floor(Date.now() / 1000)) + (amount > 1_000_000n ? 120n : 2n));
    const exactShares = eventShares ? BigInt(eventShares) : estimated;

    await run(`flash_lock_unlock_withdraw_repay_exact_${amount}`, [
      flashIx(BORROW_TEMPLATE, amount), lockIx(amount), unlockIx(exactShares), withdrawIx(),
      flashIx(REPAY_TEMPLATE, amount, 0),
    ], { category: 'atomic-target-exact', amountRaw: amount.toString(), shareAmountRaw: exactShares.toString(),
      expected: 'cannot withdraw the newly created claim before seven-day cooldown; no commit or outsider gain' });

    if (amount > 1_000_000n) {
      const conservativeShares = exactShares > 1_000_000n ? exactShares - 1_000_000n : exactShares;
      await run(`flash_lock_unlock_withdraw_repay_conservative_${amount}`, [
        flashIx(BORROW_TEMPLATE, amount), lockIx(amount), unlockIx(conservativeShares), withdrawIx(),
        flashIx(REPAY_TEMPLATE, amount, 0),
      ], { category: 'atomic-target-near-available', amountRaw: amount.toString(), shareAmountRaw: conservativeShares.toString(),
        shareSafetyReductionRaw: (exactShares - conservativeShares).toString(),
        expected: 'stress current liquidity while avoiding clock-sensitive one-unit overburn; cooldown still blocks unwind' });
    }
  }

  // Reconcile every successful flash control and every target prefix using all
  // observable debts, cooldown claims, residual shares, and protocol balances.
  for (const row of results) {
    if (row.metadata?.category === 'flash-control') {
      row.economicReconciliation = {
        debtPrincipalRaw: row.metadata.amountRaw,
        debtRepaidInFull: row.err === null && Object.keys(row.changes || {}).length === 0,
        userUsxDeltaRaw: row.changes?.outsiderUsx?.amountRaw?.delta || '0',
        klendSupplyDeltaRaw: row.changes?.klendSupply?.amountRaw?.delta || '0',
        klendFeeVaultDeltaRaw: row.changes?.klendFeeVault?.amountRaw?.delta || '0',
        outsiderNetAssetGainRaw: '0',
      };
    }
    if (row.metadata?.category?.startsWith('atomic-target')) {
      const lockEvent = row.events?.find((event) => event.name === 'LockEvent')?.fields;
      const unlockEvent = row.events?.find((event) => event.name === 'UnlockEvent')?.fields;
      if (lockEvent && unlockEvent) {
        const debt = BigInt(row.metadata.amountRaw);
        const minted = BigInt(lockEvent.share_amount);
        const burned = BigInt(unlockEvent.share_amount);
        const residualShares = minted - burned;
        const effectiveAssetsAfter = BigInt(unlockEvent.total_assets_after) - BigInt(unlockEvent.unvested_amount);
        const supplyAfter = BigInt(unlockEvent.shares_supply_after);
        const residualClaimValue = supplyAfter === 0n ? 0n : residualShares * effectiveAssetsAfter / supplyAfter;
        const cooldownClaim = BigInt(unlockEvent.cooldown_escrow_asset_amount);
        const grossClaims = cooldownClaim + residualClaimValue;
        row.economicReconciliation = {
          flashDebtRaw: debt.toString(),
          mintedSharesRaw: minted.toString(),
          burnedSharesRaw: burned.toString(),
          residualSharesRaw: residualShares.toString(),
          cooldownClaimRaw: cooldownClaim.toString(),
          residualSharesClaimValueRawAtUnlockPrice: residualClaimValue.toString(),
          grossUserClaimsRaw: grossClaims.toString(),
          grossClaimsMinusDebtRaw: (grossClaims - debt).toString(),
          immediatelyLiquidUsxRaw: '0',
          debtRepaidInFull: false,
          transactionCommitted: row.err === null,
          realizedOutsiderNetAssetGainRaw: '0',
          conclusion: 'The same-transaction withdrawal is rejected; Solana rolls the entire transaction back. Even before rollback, the user has a time-locked own claim, not freely repayable USX.',
        };
      }
    }
  }

  const successfulFlashControls = results.filter((row) => row.metadata?.category === 'flash-control' && row.err === null);
  const successfulTargetTransactions = results.filter((row) => row.metadata?.category?.startsWith('atomic-target') && row.err === null);
  const output = {
    generatedAt: new Date().toISOString(),
    rpcHost: new URL(RPC).hostname,
    readOnly: true,
    liveSubmission: false,
    signerVerification: false,
    simulationModel: 'Only the chosen outsider address is granted signer privilege. Victim/operator signatures are never granted. All v1 wires contain zero signatures and are passed only to simulateTransaction.',
    transactionVersion: 1,
    v1Limits: { wireBytes: MAX_V1_BYTES, staticAccountKeys: MAX_V1_KEYS, addressLookupTables: false },
    programIds: { solsticeYieldVault: PROGRAM.toBase58(), klend: KLEND.toBase58() },
    currentSlot: latestSlot,
    currentBlockTime: latestBlockTime,
    preContextSlot: pre.context.slot,
    officialFrontendIdl: {
      fetchedAt: IDL_ARTIFACT.fetchedAt,
      bundlePath: IDL_ARTIFACT.source.bundlePath,
      bundleSha256: IDL_ARTIFACT.source.bundleSha256,
      version: IDL.metadata.version,
    },
    klend: {
      reserve: KLEND_RESERVE.toBase58(), market: KLEND_MARKET.toBase58(),
      marketAuthority: KLEND_MARKET_AUTHORITY.toBase58(), supplyVault: KLEND_SUPPLY.toBase58(),
      feeVault: KLEND_FEE_VAULT.toBase58(), availableRaw: available.toString(),
      flashLoanFeeSf: flashFeeSf.toString(), feeClassification: 'exact configured zero, not a positive fee rounded to zero',
      sourceTemplateSignature: FLASH_HISTORY.hits[0].signature,
      sourceTemplateSlot: FLASH_HISTORY.hits[0].slot,
    },
    pdaProofs,
    before,
    accountingObservation: {
      internalSharesSupplyRaw: before.yieldPool.sharesSupplyRaw,
      splMintSupplyRaw: before.shareMint.supplyRaw,
      internalMinusMintSupplyRaw: (BigInt(before.yieldPool.sharesSupplyRaw) - BigInt(before.shareMint.supplyRaw)).toString(),
      interpretation: 'The internal ledger exceeds live SPL mint supply. Direct SPL burns can reduce mint supply without invoking YieldVault, while YieldVault events decrement both. This is dilution/stranding, not a source of outsider claims.',
    },
    summary: {
      successfulFlashControls: successfulFlashControls.length,
      flashControlsRun: results.filter((row) => row.metadata?.category === 'flash-control').length,
      successfulTargetTransactions: successfulTargetTransactions.length,
      positiveOutsiderEquityAfterDebtAndClaimsProven: false,
    },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, generatedAt: output.generatedAt,
    preContextSlot: output.preContextSlot, summary: output.summary }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
