#!/usr/bin/env node
'use strict';

// Faithful current-mainnet Surfpool fork probes for Solstice YieldVault.
// Every candidate transaction is a locally signed Solana v1 message and is
// passed only to simulateTransaction with sigVerify:true. No transaction is
// sent to mainnet or to the fork. The only fork mutations create an ephemeral
// attacker system account and zero-balance attacker-owned token accounts.

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  PublicKey,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} = require(`${MODULES}/@solana/web3.js`);
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync } = require(`${MODULES}/@solana/spl-token`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;
const { encodeV1 } = require('./klend-v1-composition.js');

const ROOT = __dirname;
const OUT = `${ROOT}/solstice-usx-signed-v1-fork.json`;
const FORK = process.env.SOLSTICE_FORK_RPC || 'http://127.0.0.1:8997';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('SOLSTICE_FORK_RPC must be a loopback URL');
const upstreamEnvFile = ['/tmp/composer-helius-only.env', '/tmp/composer-helius-rpc.env'].find(fs.existsSync);
const upstreamEnv = upstreamEnvFile ? Object.fromEntries(fs.readFileSync(upstreamEnvFile, 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const UPSTREAM = upstreamEnv.HEAVY_RPC_URL || upstreamEnv.RPC_URL || null;
const IDL_ARTIFACT = JSON.parse(fs.readFileSync(`${ROOT}/solstice-usx-official-frontend-idl.json`, 'utf8'));
const IDL = IDL_ARTIFACT.idl;
const FLASH_HISTORY = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`, 'utf8'));
const MARGINFI_CENSUS = JSON.parse(fs.readFileSync(`${ROOT}/solstice-usx-marginfi-census.json`, 'utf8'));

const P = (value) => new PublicKey(value);
const PROGRAM = P('eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const MARGINFI = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const JUP_FLASH = P('jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS');
const JUP_LIQUIDITY_PROGRAM = P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC');
const TOKEN = TOKEN_PROGRAM_ID;
const SYSTEM = SystemProgram.programId;
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const USX = P('6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG');
const EUSX = P('3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC');
const CONTROLLER = P('2aHdm37djj4c21ztMRBmmo4my6RtzN5Nn58Y39rpWbRM');
const VESTING = P('FCA4A8W8qzcXGDyBaQ8fiSqr2VowSihiz2bJKN9LcLwb');
const YIELD_POOL = P('2rjmJdxZeBLKjUjKjrSdtSqshgXbLEcPbjiJZ2vLNcCT');
const ASSET_VAULT = P('2SGicAhchh23nsrtWrur7zPAdb4hHtnyThQVPfza8CHA');
const CLAIM_USER = P('A9aaMu2V64S8WNeNmiCz3ZpKrtSjaanpe2TuDVXurHY9');
const CLAIM_COOLDOWN = P('E9URmf61v9M6mCXRhRExzGrJnnmYvAFjoUaXwfEq6eRv');
const CLAIM_VAULT = P('2QxQFy2foi3YLG6YJPdTa242FwNaXkXvHZBKr4FunDgC');
const OTHER_USER_EUSX = P('HAtQrpatq5A4nuDA14PsEpfKHkU7ifiusFzmx9UbHXX6');
const HARVESTER = P('D2oMURfityVQD5bax4MVy4BLa1wnJ6WXgJ2t8CUVXYR2');
const HARVESTER_USX = P('FdwuHo9eFQn44AnbLZDbnni86TGYyi5c7SpMtEKFVU8T');
const PERMISSION = P('5KzVcKDyzMFUh32tMESHjfA7vTALfDHbVxq9HbZd8rz');
const KLEND_RESERVE = P('H2pmnDSjfxeQ8zUeyUohokegYbXZgkjH4kgmoQVybyAX');
const KLEND_MARKET = P('9Y7uwXgQ68mGqRtZfuFaP4hc4fxeJ7cE9zTtqTxVhfGU');
const KLEND_SUPPLY = P('7Dow2t58RhFkqd1M2DLuZCaS5cGivXHC7WCDT632Nhsf');
const KLEND_FEE_VAULT = P('FzKdxfvcLVZvskpmWiLS6Z7bEKrJgCKRaLBvoYPMuMPt');
const KLEND_EUSX_RESERVE = P('ARQFJTiUJEuxoiA9VtAcnoAUHYvbTmhKytz7D6nfnfEb');
const KLEND_EUSX_SUPPLY = P('6ameYaNcTb3kRqjzsGq1GqPP96S1HLQjgLsBYhnx1sHv');
const KLEND_EUSX_FEE_VAULT = P('4sjFTEnYxj531xQ5TJfA1hV9qZqqmZXkhm7ByHU4wMfB');
const [KLEND_MARKET_AUTHORITY] = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), KLEND_MARKET.toBuffer()], KLEND);
const [JUP_FLASH_ADMIN] = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')], JUP_FLASH);
const [JUP_LIQUIDITY] = PublicKey.findProgramAddressSync([Buffer.from('liquidity')], JUP_LIQUIDITY_PROGRAM);
const [JUP_USX_RESERVE] = PublicKey.findProgramAddressSync(
  [Buffer.from('reserve'), USX.toBuffer()], JUP_LIQUIDITY_PROGRAM);
const [JUP_USX_BORROW_POSITION] = PublicKey.findProgramAddressSync(
  [Buffer.from('user_borrow_position'), USX.toBuffer(), JUP_FLASH_ADMIN.toBuffer()], JUP_LIQUIDITY_PROGRAM);
const [JUP_USX_RATE_MODEL] = PublicKey.findProgramAddressSync(
  [Buffer.from('rate_model'), USX.toBuffer()], JUP_LIQUIDITY_PROGRAM);
const JUP_USX_VAULT = getAssociatedTokenAddressSync(USX, JUP_LIQUIDITY, true);

const attacker = Keypair.generate();
const ATTACKER_USX = getAssociatedTokenAddressSync(USX, attacker.publicKey);
const ATTACKER_EUSX = getAssociatedTokenAddressSync(EUSX, attacker.publicKey);
const [ATTACKER_COOLDOWN] = PublicKey.findProgramAddressSync(
  [Buffer.from('COOLDOWN_ESCROW'), attacker.publicKey.toBuffer()], PROGRAM);
const [ATTACKER_COOLDOWN_VAULT] = PublicKey.findProgramAddressSync(
  [Buffer.from('COOLDOWN_ESCROW_VAULT'), attacker.publicKey.toBuffer()], PROGRAM);

let rpcId = 0;
async function rpc(method, params) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(FORK, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
        signal: AbortSignal.timeout(20_000) });
      const json = await response.json();
      if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
      return json.result;
    } catch (error) {
      lastError = error;
      if (error.name !== 'TimeoutError' && error.name !== 'AbortError' && !(error instanceof TypeError)) throw error;
    }
  }
  throw lastError;
}

async function upstreamRpc(method, params) {
  if (!UPSTREAM) throw new Error('read-only upstream RPC configuration is unavailable');
  const response = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(20_000) });
  const json = await response.json();
  if (json.error) throw new Error(`upstream ${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

async function faithfullyMirrorAccounts(addresses) {
  const response = await upstreamRpc('getMultipleAccounts', [addresses.map(String),
    { encoding: 'base64', commitment: 'finalized' }]);
  for (let i = 0; i < addresses.length; i += 1) {
    const account = response.value[i];
    if (!account) throw new Error(`mainnet account missing while mirroring ${addresses[i]}`);
    await rpc('surfnet_setAccount', [addresses[i].toBase58(), {
      data: Buffer.from(account.data[0], 'base64').toString('hex'), executable: account.executable,
      lamports: account.lamports, owner: account.owner, rentEpoch: 0,
    }]);
  }
  return { finalizedSourceSlot: response.context.slot, addresses: addresses.map(String) };
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const key = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const readU128 = (data, offset) => BigInt(`0x${Buffer.from(data.subarray(offset, offset + 16)).reverse().toString('hex') || '0'}`);

function ixDef(name) {
  const value = IDL.instructions.find((instruction) => instruction.name === name);
  if (!value) throw new Error(`Missing IDL instruction ${name}`);
  return value;
}
const disc = (name) => Buffer.from(ixDef(name).discriminator);

function lockIx(amount, overrides = {}) {
  const accounts = [
    key(attacker.publicKey, true, true), key(attacker.publicKey, true, true), key(CONTROLLER), key(VESTING),
    key(EUSX, false, true), key(ATTACKER_EUSX, false, true), key(USX), key(ASSET_VAULT, false, true),
    key(YIELD_POOL, false, true), key(ATTACKER_USX, false, true), key(TOKEN),
  ];
  for (const [position, meta] of Object.entries(overrides)) accounts[Number(position)] = meta;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([disc('lock'), u64(amount)]) });
}

function unlockIx(amount, overrides = {}) {
  const accounts = [
    key(attacker.publicKey, true), key(attacker.publicKey, true, true), key(CONTROLLER), key(VESTING),
    key(EUSX, false, true), key(ATTACKER_EUSX, false, true), key(USX), key(ASSET_VAULT, false, true),
    key(YIELD_POOL, false, true), key(ATTACKER_COOLDOWN, false, true),
    key(ATTACKER_COOLDOWN_VAULT, false, true), key(TOKEN), key(SYSTEM),
  ];
  for (const [position, meta] of Object.entries(overrides)) accounts[Number(position)] = meta;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([disc('unlock'), u64(amount)]) });
}

function withdrawIx(overrides = {}) {
  const accounts = [
    key(attacker.publicKey, true), key(attacker.publicKey, true, true), key(CONTROLLER), key(USX),
    key(ATTACKER_USX, false, true), key(ATTACKER_COOLDOWN, false, true),
    key(ATTACKER_COOLDOWN_VAULT, false, true), key(TOKEN),
  ];
  for (const [position, meta] of Object.entries(overrides)) accounts[Number(position)] = meta;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts, data: disc('withdraw') });
}

function transferYieldIx(amount, overrides = {}) {
  const accounts = [
    key(attacker.publicKey, true), key(attacker.publicKey, true, true), key(PERMISSION), key(CONTROLLER),
    key(VESTING, false, true), key(ATTACKER_USX, false, true), key(USX), key(ASSET_VAULT, false, true),
    key(YIELD_POOL, false, true), key(TOKEN),
  ];
  for (const [position, meta] of Object.entries(overrides)) accounts[Number(position)] = meta;
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts,
    data: Buffer.concat([disc('transfer_in_yield'), u64(amount)]) });
}

function historyIx(index) {
  const transaction = FLASH_HISTORY.hits[0].transaction;
  const message = transaction.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = transaction.meta.loadedAddresses?.writable || [];
  const loadedReadonly = transaction.meta.loadedAddresses?.readonly || [];
  const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  const header = message.header;
  const writable = (accountIndex) => {
    if (accountIndex < staticKeys.length) {
      if (accountIndex < header.numRequiredSignatures) {
        return accountIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts;
      }
      return accountIndex < staticKeys.length - header.numReadonlyUnsignedAccounts;
    }
    return accountIndex < staticKeys.length + loadedWritable.length;
  };
  const source = message.instructions[index];
  return new TransactionInstruction({ programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map((accountIndex) => key(P(allKeys[accountIndex]),
      accountIndex < header.numRequiredSignatures, writable(accountIndex))),
    data: Buffer.from(bs58.decode(source.data)) });
}

const BORROW_TEMPLATE = historyIx(3);
const REPAY_TEMPLATE = historyIx(13);
if (!BORROW_TEMPLATE.programId.equals(KLEND) || !REPAY_TEMPLATE.programId.equals(KLEND)) {
  throw new Error('KLend source template mismatch');
}

function flashIx(template, amount, repayIndex, asset = 'USX') {
  const keys = template.keys.map((meta) => ({ ...meta }));
  const selected = asset === 'eUSX' ? {
    reserve: KLEND_EUSX_RESERVE, mint: EUSX, supply: KLEND_EUSX_SUPPLY,
    destination: ATTACKER_EUSX, feeVault: KLEND_EUSX_FEE_VAULT,
  } : {
    reserve: KLEND_RESERVE, mint: USX, supply: KLEND_SUPPLY,
    destination: ATTACKER_USX, feeVault: KLEND_FEE_VAULT,
  };
  const replacements = {
    0: attacker.publicKey, 1: KLEND_MARKET_AUTHORITY, 2: KLEND_MARKET, 3: selected.reserve,
    4: selected.mint, 5: selected.supply, 6: selected.destination, 7: selected.feeVault,
    8: KLEND, 9: KLEND, 10: SYSVAR_INSTRUCTIONS, 11: TOKEN,
  };
  for (const [position, pubkey] of Object.entries(replacements)) keys[Number(position)].pubkey = pubkey;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({ programId: KLEND, keys, data });
}

function wrappedFlash(amount, body) {
  const instructions = [flashIx(BORROW_TEMPLATE, amount), ...body];
  instructions.push(flashIx(REPAY_TEMPLATE, amount, 0));
  return instructions;
}

function wrappedEusxFlash(amount, body) {
  const instructions = [flashIx(BORROW_TEMPLATE, amount, undefined, 'eUSX'), ...body];
  instructions.push(flashIx(REPAY_TEMPLATE, amount, 0, 'eUSX'));
  return instructions;
}

function jupiterFlashIx(name, amount) {
  const discriminator = crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  const accounts = [
    key(attacker.publicKey, true, true), key(JUP_FLASH_ADMIN, false, true),
    key(ATTACKER_USX, false, true), key(USX), key(JUP_USX_RESERVE, false, true),
    key(JUP_USX_BORROW_POSITION, false, true), key(JUP_USX_RATE_MODEL),
    key(JUP_USX_VAULT, false, true), key(JUP_LIQUIDITY), key(JUP_LIQUIDITY_PROGRAM),
    key(TOKEN), key(ASSOCIATED_TOKEN_PROGRAM_ID), key(SYSTEM), key(SYSVAR_INSTRUCTIONS),
  ];
  return new TransactionInstruction({ programId: JUP_FLASH, keys: accounts,
    data: Buffer.concat([discriminator, u64(amount)]) });
}

const eventDefinitions = new Map();
for (const event of IDL.events || []) {
  const type = IDL.types.find((candidate) => candidate.name === event.name)?.type;
  if (type?.kind === 'struct') eventDefinitions.set(Buffer.from(event.discriminator).toString('hex'),
    { name: event.name, fields: type.fields });
}

function readInteger(data, offset, bytes) {
  return BigInt(`0x${Buffer.from(data.subarray(offset, offset + bytes)).reverse().toString('hex') || '0'}`);
}

function decodeEvents(logs) {
  const output = [];
  for (const line of logs || []) {
    if (!line.startsWith('Program data: ')) continue;
    const data = Buffer.from(line.slice('Program data: '.length), 'base64');
    const definition = eventDefinitions.get(data.subarray(0, 8).toString('hex'));
    if (!definition) continue;
    let offset = 8;
    const fields = {};
    let valid = true;
    for (const field of definition.fields) {
      if (field.type === 'pubkey' && offset + 32 <= data.length) {
        fields[field.name] = new PublicKey(data.subarray(offset, offset + 32)).toBase58(); offset += 32;
      } else if (field.type === 'u64' && offset + 8 <= data.length) {
        fields[field.name] = readInteger(data, offset, 8).toString(); offset += 8;
      } else if (field.type === 'u128' && offset + 16 <= data.length) {
        fields[field.name] = readInteger(data, offset, 16).toString(); offset += 16;
      } else if (field.type === 'bool' && offset + 1 <= data.length) {
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
  const failedProgram = failedLine?.match(/^Program ([1-9A-HJ-NP-Za-km-z]+) failed:/)?.[1] || null;
  return { raw: err || null, customCode: custom ?? null,
    decoded: custom === undefined || failedProgram !== PROGRAM.toBase58() ? null :
      idlErrors.get(custom) || anchorErrors.get(custom) || null,
    failedProgram, failedLine };
}

const watch = [
  ['attacker', attacker.publicKey, 'system'],
  ['attackerUsx', ATTACKER_USX, 'token'],
  ['attackerEusx', ATTACKER_EUSX, 'token'],
  ['assetVault', ASSET_VAULT, 'token'],
  ['shareMint', EUSX, 'mint'],
  ['yieldPool', YIELD_POOL, 'yieldPool'],
  ['vestingSchedule', VESTING, 'vesting'],
  ['attackerCooldown', ATTACKER_COOLDOWN, 'cooldown'],
  ['attackerCooldownVault', ATTACKER_COOLDOWN_VAULT, 'token'],
  ['largeClaimCooldown', CLAIM_COOLDOWN, 'cooldown'],
  ['largeClaimVault', CLAIM_VAULT, 'token'],
  ['klendReserve', KLEND_RESERVE, 'reserve'],
  ['klendSupply', KLEND_SUPPLY, 'token'],
  ['klendFeeVault', KLEND_FEE_VAULT, 'token'],
  ['klendEusxReserve', KLEND_EUSX_RESERVE, 'reserve'],
  ['klendEusxSupply', KLEND_EUSX_SUPPLY, 'token'],
  ['klendEusxFeeVault', KLEND_EUSX_FEE_VAULT, 'token'],
  ['jupiterFlashAdmin', JUP_FLASH_ADMIN, 'jupiterFlashAdmin'],
  ['jupiterUsxReserve', JUP_USX_RESERVE, 'raw'],
  ['jupiterUsxBorrowPosition', JUP_USX_BORROW_POSITION, 'raw'],
  ['jupiterUsxRateModel', JUP_USX_RATE_MODEL, 'raw'],
  ['jupiterUsxVault', JUP_USX_VAULT, 'token'],
  ['permissionedAccount', PERMISSION, 'permission'],
  ['controller', CONTROLLER, 'controller'],
];

function normalizedAccount(account) {
  if (!account) return { exists: false };
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  return { exists: true, owner: typeof account.owner === 'string' ? account.owner : account.owner.toBase58(),
    lamports: account.lamports, data, dataLength: data.length, dataSha256: sha256(data) };
}

function decodeAccount(role, account) {
  const base = normalizedAccount(account);
  if (!base.exists) return base;
  const data = base.data;
  const result = { exists: true, owner: base.owner, lamports: base.lamports,
    dataLength: base.dataLength, dataSha256: base.dataSha256 };
  if (role === 'token') {
    result.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    result.authority = new PublicKey(data.subarray(32, 64)).toBase58();
    result.amountRaw = data.readBigUInt64LE(64).toString();
  } else if (role === 'mint') {
    result.supplyRaw = data.readBigUInt64LE(36).toString(); result.decimals = data[44];
  } else if (role === 'yieldPool') {
    result.totalAssetsRaw = readU128(data, 75).toString();
    result.sharesSupplyRaw = readU128(data, 91).toString();
  } else if (role === 'vesting') {
    result.vestingAmountRaw = data.readBigUInt64LE(9).toString();
    result.startTime = data.readBigUInt64LE(17).toString(); result.endTime = data.readBigUInt64LE(25).toString();
  } else if (role === 'cooldown') {
    result.user = new PublicKey(data.subarray(8, 40)).toBase58();
    result.assetAmountRaw = data.readBigUInt64LE(73).toString();
    result.cooldownEnd = data.readBigUInt64LE(81).toString();
  } else if (role === 'reserve') {
    result.availableRaw = data.readBigUInt64LE(224).toString();
    result.flashLoanFeeSf = data.readBigUInt64LE(4904).toString();
    result.status = data[4856]; result.emergencyMode = data[4864];
  } else if (role === 'permission') {
    result.canSendYield = data[9] !== 0;
  } else if (role === 'controller') {
    result.vestingPeriodSeconds = data.readBigUInt64LE(74).toString();
    result.cooldownPeriodSeconds = data.readBigUInt64LE(82).toString();
    result.isFrozen = data[123] !== 0;
  } else if (role === 'jupiterFlashAdmin') {
    result.liquidityProgram = new PublicKey(data.subarray(40, 72)).toBase58();
    result.status = data[72] !== 0; result.flashLoanFeeBps = data.readUInt16LE(73);
    result.isFlashLoanActive = data[83] !== 0;
    result.activeFlashLoanAmountRaw = data.readBigUInt64LE(84).toString();
  }
  return result;
}

function image(accounts, selected = watch) {
  return Object.fromEntries(selected.map(([label, , role], index) => [label, decodeAccount(role, accounts?.[index])]));
}

function delta(before, after) {
  const output = {};
  for (const [label] of watch) {
    if (!before[label] || !after[label]) continue;
    const row = {};
    for (const field of ['lamports', 'amountRaw', 'supplyRaw', 'totalAssetsRaw', 'sharesSupplyRaw',
      'assetAmountRaw', 'cooldownEnd', 'availableRaw']) {
      if (before[label][field] !== undefined && after[label][field] !== undefined) {
        const difference = BigInt(after[label][field]) - BigInt(before[label][field]);
        if (difference !== 0n) row[field] = { before: String(before[label][field]),
          after: String(after[label][field]), delta: difference.toString() };
      }
    }
    if (Object.keys(row).length) output[label] = row;
  }
  return output;
}

function signV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  if (encoded.sizeBytes > 4096 || encoded.addressCount > 64) throw new Error('v1 footprint limit exceeded');
  const compiled = new TransactionMessage({ payerKey: attacker.publicKey, recentBlockhash: blockhash, instructions })
    .compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== attacker.publicKey.toBase58()) {
    throw new Error(`uncontrolled signer set: ${signerOrder.join(',')}`);
  }
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - (64 * encoded.requiredSignatures));
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(attacker.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, message, privateKey);
  signature.copy(signed, signed.length - 64);
  const decoded = VersionedTransaction.deserialize(signed);
  if (decoded.version !== 1 || decoded.signatures.length !== 1 || decoded.signatures[0].every((byte) => byte === 0)) {
    throw new Error('signed wire failed local v1 decoding');
  }
  return { encoded, signed, signerOrder };
}

async function simulate(label, instructions, before, metadata = {}) {
  try {
    const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'processed' }])).value.blockhash;
    const signed = signV1(instructions, blockhash);
    const staticAddresses = new Set(signed.encoded.wire.length ?
      new TransactionMessage({ payerKey: attacker.publicKey, recentBlockhash: blockhash, instructions })
        .compileToV0Message().staticAccountKeys.map(String) : []);
    const selected = watch.filter(([, address]) => staticAddresses.has(address.toBase58()));
    const result = await rpc('simulateTransaction', [signed.signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: { encoding: 'base64', addresses: selected.map(([, address]) => address.toBase58()) },
    }]);
    const after = image(result.value.accounts, selected);
    const row = {
      label, metadata, contextSlot: result.context.slot,
      sigVerify: true, signatureVerificationAccepted: true,
      err: result.value.err || null,
      error: describeError(result.value.err, result.value.logs),
      unitsConsumed: result.value.unitsConsumed,
      loadedAccountsDataSize: result.value.loadedAccountsDataSize,
      events: decodeEvents(result.value.logs),
      monitoredAccounts: selected.map(([accountLabel, address]) => ({ label: accountLabel, address: address.toBase58() })),
      changes: delta(before, after), after,
      message: {
        version: 1, wireBytes: signed.encoded.sizeBytes, staticAccountKeys: signed.encoded.addressCount,
        instructions: signed.encoded.instructionCount, requiredSignatures: signed.encoded.requiredSignatures,
        signerOrder: signed.signerOrder, within4096Bytes: signed.encoded.sizeBytes <= 4096,
        within64Accounts: signed.encoded.addressCount <= 64,
        signedWireSha256: sha256(signed.signed), signedWireBase64: signed.signed.toString('base64'),
      },
      logs: result.value.logs || [],
    };
    process.stdout.write(`${JSON.stringify({ label, err: row.err,
      error: row.error.decoded?.name || row.error.failedLine, sigVerify: row.sigVerify,
      bytes: row.message.wireBytes, accounts: row.message.staticAccountKeys,
      units: row.unitsConsumed, events: row.events.map((event) => event.name) })}\n`);
    return row;
  } catch (error) {
    const row = { label, metadata, sigVerify: true, signatureVerificationAccepted: false,
      constructionOrTransportError: String(error.stack || error) };
    process.stdout.write(`${JSON.stringify({ label, constructionOrTransportError: error.message })}\n`);
    return row;
  }
}

const eventField = (row, name, field) => row.events?.find((event) => event.name === name)?.fields?.[field];

async function setZeroTokenAccount(source, target, mint) {
  const original = (await rpc('getAccountInfo', [source.toBase58(),
    { encoding: 'base64', commitment: 'processed' }])).value;
  if (!original) throw new Error(`token account template missing: ${source}`);
  const data = Buffer.from(original.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw new Error('token account template mint mismatch');
  attacker.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(0n, 64);
  // Clear delegate, native, delegated amount, and close authority fields.
  data.writeUInt32LE(0, 72); data.fill(0, 76, 108); data.writeUInt32LE(0, 109);
  data.fill(0, 113, 121); data.writeBigUInt64LE(0n, 121); data.writeUInt32LE(0, 129); data.fill(0, 133, 165);
  await rpc('surfnet_setAccount', [target.toBase58(), { data: data.toString('hex'), executable: false,
    lamports: original.lamports, owner: TOKEN.toBase58(), rentEpoch: 0 }]);
}

function reconcile(row) {
  if (row.metadata?.category === 'flash-control') {
    const eusx = row.metadata.mintSymbol === 'eUSX';
    const attackerLabel = eusx ? 'attackerEusx' : 'attackerUsx';
    const supplyLabel = eusx ? 'klendEusxSupply' : 'klendSupply';
    const feeLabel = eusx ? 'klendEusxFeeVault' : 'klendFeeVault';
    row.economicReconciliation = {
      principalRaw: row.metadata.amountRaw,
      mintSymbol: row.metadata.mintSymbol || 'USX',
      debtRepaidInFull: row.err === null && !(row.changes?.[attackerLabel]?.amountRaw) &&
        !(row.changes?.[supplyLabel]?.amountRaw) && !(row.changes?.[feeLabel]?.amountRaw),
      attackerTokenDeltaRaw: row.changes?.[attackerLabel]?.amountRaw?.delta || '0',
      klendSupplyDeltaRaw: row.changes?.[supplyLabel]?.amountRaw?.delta || '0',
      klendFeeDeltaRaw: row.changes?.[feeLabel]?.amountRaw?.delta || '0',
      outsiderNetAssetGainRaw: '0',
    };
  }
  if (row.metadata?.category?.startsWith('atomic-target') &&
      !row.metadata.category.startsWith('atomic-target-eusx')) {
    const lock = row.events?.find((event) => event.name === 'LockEvent')?.fields;
    const unlock = row.events?.find((event) => event.name === 'UnlockEvent')?.fields;
    if (!lock || !unlock) return;
    const debt = BigInt(row.metadata.amountRaw);
    const residualShares = BigInt(lock.share_amount) - BigInt(unlock.share_amount);
    const effectiveAfter = BigInt(unlock.total_assets_after) - BigInt(unlock.unvested_amount);
    const supplyAfter = BigInt(unlock.shares_supply_after);
    const residualValue = supplyAfter === 0n ? 0n : residualShares * effectiveAfter / supplyAfter;
    const claim = BigInt(unlock.cooldown_escrow_asset_amount);
    row.economicReconciliation = {
      flashDebtRaw: debt.toString(), mintedSharesRaw: lock.share_amount,
      burnedSharesRaw: unlock.share_amount, residualSharesRaw: residualShares.toString(),
      cooldownClaimRaw: claim.toString(), residualShareClaimValueRaw: residualValue.toString(),
      grossClaimsRaw: (claim + residualValue).toString(),
      grossClaimsMinusDebtRaw: (claim + residualValue - debt).toString(),
      immediatelyLiquidUsxRaw: '0', debtRepaidInFull: false,
      transactionCommitted: row.err === null, realizedOutsiderNetAssetGainRaw: '0',
    };
  }
  if (row.metadata?.category?.startsWith('atomic-target-eusx')) {
    const unlock = row.events?.find((event) => event.name === 'UnlockEvent')?.fields;
    row.economicReconciliation = {
      flashDebtMint: 'eUSX', flashDebtRaw: row.metadata.amountRaw,
      burnedBorrowedEusxRaw: unlock?.share_amount || null,
      resultingCooldownClaimMint: 'USX', cooldownClaimRaw: unlock?.cooldown_escrow_asset_amount || null,
      immediatelyLiquidUsxRaw: '0', immediatelyLiquidEusxRaw: '0',
      debtRepaidInFull: false, transactionCommitted: row.err === null,
      realizedOutsiderNetAssetGainRaw: '0',
      note: 'The borrowed eUSX is burned into an attacker-bound USX cooldown claim; it is not available for same-transaction eUSX repayment.',
    };
  }
}

async function main() {
  // Surfpool's lazy proxy can stall on one high-lamport token account. Mirror
  // these protocol account data/owner/lamports byte-for-byte from one finalized
  // read-only batch; rentEpoch is runtime metadata and is normalized to zero.
  // This is a faithful import, not synthetic protocol state.
  const faithfullyMirrored = await faithfullyMirrorAccounts([
    KLEND_EUSX_RESERVE, KLEND_EUSX_SUPPLY, KLEND_EUSX_FEE_VAULT,
    JUP_FLASH_ADMIN, JUP_LIQUIDITY, JUP_USX_RESERVE, JUP_USX_RATE_MODEL, JUP_USX_VAULT,
  ]);
  // Fork-only fixture setup. No token value is assigned to the attacker.
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {
    data: '', executable: false, lamports: 20_000_000_000,
    owner: SYSTEM.toBase58(), rentEpoch: 0,
  }]);
  await setZeroTokenAccount(ASSET_VAULT, ATTACKER_USX, USX);
  await setZeroTokenAccount(OTHER_USER_EUSX, ATTACKER_EUSX, EUSX);

  // Force import of every current public account before taking the baseline.
  for (const [, address] of watch) await rpc('getAccountInfo', [address.toBase58(),
    { encoding: 'base64', commitment: 'processed' }]);
  const pre = await rpc('getMultipleAccounts', [watch.map(([, address]) => address.toBase58()),
    { encoding: 'base64', commitment: 'processed' }]);
  const before = image(pre.value);
  const available = BigInt(before.klendReserve.availableRaw);
  const eusxAvailable = BigInt(before.klendEusxReserve.availableRaw);
  if (BigInt(before.klendReserve.flashLoanFeeSf) !== 0n) throw new Error('KLend USX flash fee is not exact zero');
  if (BigInt(before.klendEusxReserve.flashLoanFeeSf) !== 0n) throw new Error('KLend eUSX flash fee is not exact zero');
  if (before.attackerUsx.amountRaw !== '0' || before.attackerEusx.amountRaw !== '0') {
    throw new Error('attacker token fixture must start with zero tokens');
  }

  const marginfiUsx = MARGINFI_CENSUS.rows.filter((row) => row.mint === USX.toBase58());
  const marginfiEusx = MARGINFI_CENSUS.rows.filter((row) => row.mint === EUSX.toBase58());
  if (marginfiUsx.length || marginfiEusx.length) throw new Error('marginfi census unexpectedly contains USX/eUSX');

  const results = [];
  const run = async (label, instructions, metadata) => {
    const row = await simulate(label, instructions, before, metadata);
    results.push(row); return row;
  };

  // Exact live-availability boundary and dust conservation controls.
  for (const amount of [1n, 2n, 10n, available - 1n, available, available + 1n]) {
    await run(`signed_flash_repay_control_${amount}`, wrappedFlash(amount, []), {
      category: 'flash-control', amountRaw: amount.toString(),
      boundary: amount === available - 1n ? 'available-1' : amount === available ? 'available' :
        amount === available + 1n ? 'available+1' : 'dust',
      expected: amount <= available ? 'success with exact lender conservation' : 'insufficient-liquidity rejection',
    });
  }

  // The same provider exposes a second zero-fee mint. Exercise its distinct
  // source-specific minimum and exact live boundary, then try the economically
  // relevant eUSX -> cooldown-USX unwind route.
  for (const amount of [1n, 2n, 10n, eusxAvailable - 1n, eusxAvailable, eusxAvailable + 1n]) {
    await run(`signed_eusx_flash_repay_control_${amount}`, wrappedEusxFlash(amount, []), {
      category: 'flash-control', mintSymbol: 'eUSX', amountRaw: amount.toString(),
      boundary: amount === eusxAvailable - 1n ? 'available-1' : amount === eusxAvailable ? 'available' :
        amount === eusxAvailable + 1n ? 'available+1' : 'dust',
      expected: amount <= eusxAvailable ? 'success with exact lender conservation' : 'insufficient-liquidity rejection',
    });
  }

  // KLend forbids more than one flash borrow in one transaction. This proves
  // that its USX and eUSX reserves are two mints, not two independent sources
  // that can be stacked into a dual-provider envelope.
  await run('signed_klend_repeat_borrow_usx_then_eusx', [
    flashIx(BORROW_TEMPLATE, 10n),
    flashIx(BORROW_TEMPLATE, 10n, undefined, 'eUSX'),
    flashIx(REPAY_TEMPLATE, 10n, 1, 'eUSX'),
    flashIx(REPAY_TEMPLATE, 10n, 0),
  ], { category: 'flash-repeat-constraint', amountRawByMint: { USX: '10', eUSX: '10' },
    expected: 'KLend rejects the second flash borrow in the same transaction' });

  await run('signed_jupiter_current_usx_flash_configuration_probe', [
    jupiterFlashIx('flashloan_borrow', 1_000n),
    jupiterFlashIx('flashloan_payback', 1_000n),
  ], { category: 'incompatible-provider-probe', provider: 'Jupiter Flash current deployment',
    mintSymbol: 'USX', amountRaw: '1000', sourceMinimumRaw: '1000',
    expected: 'rejection because the flash wrapper has no configured USX borrow-position account' });

  // Every plausible outsider authorization/substitution candidate is inside a
  // real signed flash envelope, even though these cases fail before repayment.
  const authPrincipal = 2n;
  await run('signed_flash_outsider_substitutes_large_claim_pdas', wrappedFlash(authPrincipal, [withdrawIx({
    5: key(CLAIM_COOLDOWN, false, true), 6: key(CLAIM_VAULT, false, true),
  })]), { category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'ConstraintSeeds' });

  await run('signed_flash_large_claim_without_beneficiary_signature', wrappedFlash(authPrincipal, [withdrawIx({
    0: key(CLAIM_USER, false), 1: key(attacker.publicKey, true, true),
    5: key(CLAIM_COOLDOWN, false, true), 6: key(CLAIM_VAULT, false, true),
  })]), { category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'AccountNotSigner' });

  await run('signed_flash_substitutes_other_users_share_account', wrappedFlash(authPrincipal, [unlockIx(1n, {
    5: key(OTHER_USER_EUSX, false, true),
  })]), { category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'InvalidOwner' });

  await run('signed_flash_unlocks_zero_owned_shares', wrappedFlash(authPrincipal, [unlockIx(1n)]), {
    category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'InsufficientFunds',
  });

  await run('signed_flash_substitutes_permission_record', wrappedFlash(authPrincipal, [transferYieldIx(1n)]), {
    category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'ConstraintSeeds',
  });

  await run('signed_flash_harvester_without_signature', wrappedFlash(authPrincipal, [transferYieldIx(1n, {
    0: key(HARVESTER, false), 2: key(PERMISSION), 5: key(HARVESTER_USX, false, true),
  })]), { category: 'flash-auth-candidate', amountRaw: authPrincipal.toString(), expected: 'AccountNotSigner' });

  // Same-transaction share/claim math at dust and maximum live KLend size.
  for (const amount of [1n, 2n, 10n, 1_000_000n, available - 1n, available, available + 1n]) {
    const prefix = await run(`signed_flash_lock_then_repay_${amount}`,
      wrappedFlash(amount, [lockIx(amount)]), {
        category: 'atomic-prefix', amountRaw: amount.toString(),
        expected: amount === 1n ? 'ZeroShareAmount' : amount > available ? 'KLend liquidity rejection' :
          'lock event followed by repay failure and atomic rollback',
      });
    const shares = eventField(prefix, 'LockEvent', 'share_amount');
    if (!shares) continue;

    // The still-active vesting schedule can change the exact mint result once
    // per second. Retry only when the LockEvent proves the static unlock
    // argument was stale; a final aligned row always burns the amount minted
    // by the lock in that same simulated transaction.
    let alignedShares = shares;
    let noWithdraw = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      noWithdraw = await run(`signed_flash_lock_unlock_repay_${amount}${attempt ? `_alignment_retry_${attempt}` : ''}`,
        wrappedFlash(amount, [lockIx(amount), unlockIx(alignedShares)]), {
          category: 'atomic-target-no-withdraw', amountRaw: amount.toString(), shareAmountRaw: alignedShares,
          alignmentAttempt: attempt,
          expected: 'repay fails because all redeemed USX is in the attacker-bound cooldown vault',
        });
      const minted = eventField(noWithdraw, 'LockEvent', 'share_amount');
      if (!minted || minted === alignedShares) break;
      alignedShares = minted;
    }

    let withWithdraw = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      withWithdraw = await run(`signed_flash_lock_unlock_withdraw_repay_${amount}${attempt ? `_alignment_retry_${attempt}` : ''}`,
        wrappedFlash(amount, [lockIx(amount), unlockIx(alignedShares), withdrawIx()]), {
          category: 'atomic-target-withdraw', amountRaw: amount.toString(), shareAmountRaw: alignedShares,
          alignmentAttempt: attempt,
          expected: 'CooldownNotEnded; complete rollback before lender repayment',
        });
      const minted = eventField(withWithdraw, 'LockEvent', 'share_amount');
      if (!minted || minted === alignedShares) break;
      alignedShares = minted;
    }
  }


  for (const amount of [1n, 2n, 10n, 1_000_000n, eusxAvailable - 1n, eusxAvailable, eusxAvailable + 1n]) {
    await run(`signed_eusx_flash_unlock_repay_${amount}`,
      wrappedEusxFlash(amount, [unlockIx(amount)]), {
        category: 'atomic-target-eusx-no-withdraw', mintSymbol: 'eUSX', amountRaw: amount.toString(),
        expected: amount > eusxAvailable ? 'KLend liquidity rejection' :
          'borrowed eUSX burns into cooldown USX, leaving no eUSX for repayment',
      });
    await run(`signed_eusx_flash_unlock_withdraw_repay_${amount}`,
      wrappedEusxFlash(amount, [unlockIx(amount), withdrawIx()]), {
        category: 'atomic-target-eusx-withdraw', mintSymbol: 'eUSX', amountRaw: amount.toString(),
        expected: amount > eusxAvailable ? 'KLend liquidity rejection' :
          'CooldownNotEnded; complete rollback before eUSX lender repayment',
      });
  }

  for (const row of results) reconcile(row);
  const validSigned = results.filter((row) => row.signatureVerificationAccepted);
  const footprintViolations = results.filter((row) => row.message &&
    (!row.message.within4096Bytes || !row.message.within64Accounts));
  const successfulTarget = results.filter((row) => row.metadata?.category?.startsWith('atomic-target') && row.err === null);
  const output = {
    generatedAt: new Date().toISOString(),
    scope: 'faithful current-mainnet Surfpool fork; simulateTransaction only; no sendTransaction',
    forkRpc: 'loopback only (port omitted from evidence)',
    forkBaselineSlot: pre.context.slot,
    signerModel: {
      attackerPublicKey: attacker.publicKey.toBase58(),
      ephemeralKeyGeneratedInMemory: true, privateKeyPrintedOrSaved: false,
      sigVerify: true, replaceRecentBlockhash: false,
      syntheticLamportsRaw: '20000000000', syntheticTokenBalancesRaw: { USX: '0', eUSX: '0' },
      forkMutations: ['ephemeral attacker system account', 'zero-balance attacker USX token account',
        'zero-balance attacker eUSX token account',
        'finalized mainnet data/owner/lamports mirror of eight KLend eUSX/Jupiter protocol accounts (rentEpoch normalized to zero)'],
      faithfullyMirroredProtocolAccounts: faithfullyMirrored,
    },
    addresses: {
      attackerUsx: ATTACKER_USX.toBase58(), attackerEusx: ATTACKER_EUSX.toBase58(),
      attackerCooldown: ATTACKER_COOLDOWN.toBase58(), attackerCooldownVault: ATTACKER_COOLDOWN_VAULT.toBase58(),
    },
    pdaProofs: {
      controller: CONTROLLER.toBase58(), vestingSchedule: VESTING.toBase58(),
      yieldPool: YIELD_POOL.toBase58(), assetVault: ASSET_VAULT.toBase58(), shareMint: EUSX.toBase58(),
    },
    flashSources: {
      klend: { reserve: KLEND_RESERVE.toBase58(), market: KLEND_MARKET.toBase58(),
        supply: KLEND_SUPPLY.toBase58(), feeVault: KLEND_FEE_VAULT.toBase58(),
        availableRaw: available.toString(), exactFlashFeeSf: before.klendReserve.flashLoanFeeSf,
        additionalMint: { mint: EUSX.toBase58(), reserve: KLEND_EUSX_RESERVE.toBase58(),
          supply: KLEND_EUSX_SUPPLY.toBase58(), feeVault: KLEND_EUSX_FEE_VAULT.toBase58(),
          availableRaw: eusxAvailable.toString(), exactFlashFeeSf: before.klendEusxReserve.flashLoanFeeSf },
        sameTransactionRepeatBorrowCompatible: false },
      project0Marginfi: {
        programId: MARGINFI.toBase58(), censusSlot: MARGINFI_CENSUS.observationSlot,
        decodedBanks: MARGINFI_CENSUS.decodedBanks, usxBankOrVaultRows: marginfiUsx,
        eusxBankOrVaultRows: marginfiEusx, compatibleDirectFlashSource: false,
        blocker: 'No current Project0/marginfi Bank exists for USX or eUSX, so there is no second direct same-mint lender to combine or boundary-test.',
      },
      jupiterFlash: {
        programId: JUP_FLASH.toBase58(), liquidityProgramId: JUP_LIQUIDITY_PROGRAM.toBase58(),
        admin: JUP_FLASH_ADMIN.toBase58(), reserve: JUP_USX_RESERVE.toBase58(),
        borrowPosition: JUP_USX_BORROW_POSITION.toBase58(), rateModel: JUP_USX_RATE_MODEL.toBase58(),
        vault: JUP_USX_VAULT.toBase58(), configuredFeeBps: before.jupiterFlashAdmin.flashLoanFeeBps,
        displayedVaultBalanceRaw: before.jupiterUsxVault.amountRaw,
        borrowPositionExists: before.jupiterUsxBorrowPosition.exists,
        compatibleDirectFlashSource: false,
        blocker: 'USX liquidity reserve/vault exists, but the Jupiter Flash protocol-specific USX borrow-position PDA is absent; the signed minimum-size wrapper probe rejects before a loan is issued.',
      },
    },
    before,
    summary: {
      cases: results.length,
      signedCasesAcceptedBySigVerify: validSigned.length,
      signatureVerificationFailures: results.length - validSigned.length,
      footprintViolations: footprintViolations.length,
      successfulTargetTransactions: successfulTarget.length,
      positiveOutsiderEquityAfterAllDebtAndClaims: false,
    },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUT, forkBaselineSlot: output.forkBaselineSlot,
    summary: output.summary, klendAvailableRaw: available.toString(), klendEusxAvailableRaw: eusxAvailable.toString(),
    marginfiBlocker: output.flashSources.project0Marginfi.blocker }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
