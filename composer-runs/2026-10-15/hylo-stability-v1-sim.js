#!/usr/bin/env node
// Read-only current-mainnet Hylo earn-pool composition and authorization probes.
// This script uses get* RPC methods and simulateTransaction only. It never signs
// or submits a transaction. Solana v1 wires contain zeroed signature bytes and
// sigVerify:false models only the selected on-curve user's own signature.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const FORK_RPC_URL = process.env.HYLO_FORK_RPC || null;
const FORK_MODE = Boolean(FORK_RPC_URL);
const FORK_SIGNER = FORK_MODE ? Keypair.generate() : null;
const OUTPUT = path.join(ROOT, FORK_MODE ?
  'hylo-stability-signed-fork-sim.json' : 'hylo-stability-v1-sim.json');
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const MARGINFI_SOURCE_PATH = path.join(ROOT, 'marginfi-flashloan-source-3ok9.json');
const HYLO_IDL_PATH = path.join(ROOT, 'hylo-stability-sdk-source/hylo-idl/idls/hylo_earn_pool.json');
const EXCHANGE_IDL_PATH = path.join(ROOT, 'hylo-stability-sdk-source/hylo-idl/idls/hylo_exchange.json');
const MARGINFI_IDL_PATH = path.join(ROOT, 'marginfi-source/fuzz/crucible/idls/marginfi_program.json');

function readEnv(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

const env = readEnv(ENV_PATH);
// Prefer the primary current-state endpoint. The heavy endpoint is retained as
// a fallback for providers that expose it, but it can intentionally lag while
// serving archival workloads.
const rpcUrl = FORK_RPC_URL || env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');
let rpcId = 0;

const P = value => new PublicKey(value);
const TOKEN = spl.TOKEN_PROGRAM_ID;
const MARGINFI = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const EARN_POOL = P('HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ');
const EXCHANGE = P('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const HYUSD = P('5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E');
const SHYUSD = P('HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz');
const SYSTEM = P('11111111111111111111111111111111');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const LUT_PROGRAM = P('AddressLookupTab1e1111111111111111111111111');
const SOL_USD_FEED = P('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const LST_REGISTRY = P('9Mb2Mt76AN7eNY3BBA4LgfTicARXhcEEokTBfsN47noK');

// Real on-curve holder selected by intersecting current top hyUSD token holders
// with current MarginfiAccount.authority values. It is not a Hylo privileged key.
const REAL_USER = P('7x2MerAJdgFFsoTq58AQKeCSVQ1w1YGQR2QWtYoMKvat');
const USER = FORK_SIGNER?.publicKey || REAL_USER;
const USER_HYUSD = P('2ymvQ13KLsxRjou4eZft3g1z9SyCeMq9vrKXmnuY82Sz');
const REAL_USER_MARGINFI = P('GQtXwRLaQMHQXojtZXubPJxNFtLL6Bp1menTw21cw8zu');
const EMPTY_MARGINFI_TEMPLATE = P('93rXRLxa3nJ6WkEbsxHCPS6doffoVf4yXb8hxWaphPsw');
const USER_MARGINFI = FORK_MODE ? EMPTY_MARGINFI_TEMPLATE : REAL_USER_MARGINFI;
const REAL_USER_SHYUSD = P('HVzm2H461LenSsuiiHfDtKQq1u8B1e7M6puR7A1e5kXf');
const USER_SHYUSD = FORK_MODE ? REAL_USER_SHYUSD : spl.getAssociatedTokenAddressSync(SHYUSD, USER);

const P0_GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const P0_BANK = P('5syijTAMBBmdjwUgYYBvvv26zTS6YX1bYV9EdXkgYqLa');
const P0_VAULT = P('6fN1Eqh7433vm4RLBC2Ybd9m3EHg3s6S2GP1JyjABMEU');
const P0_VAULT_AUTH = P('EseejrdpACi7QmQ3X1DiNQ5caDXgGPQkAQUFDeA8y38P');
const P0_ORACLE = P('2hADaCUP7asWEuUKRRTy8M1z9XBJjtYmVKCbnp8LJJmj');
// The selected real outsider Marginfi account also carries one live USDC
// collateral balance. Marginfi's health-account ABI requires every active
// bank+oracle block, in descending bank-pubkey order, on borrow/end.
const P0_COLLATERAL_BANK = P('2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB');
const P0_COLLATERAL_ORACLE = P('6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT');

const KLEND_RESERVE = P('BhD4buCKPSpXiws9CzuXoE4Hg4XDAxfNVPnHPSWV3PgG');
const KLEND_MARKET = P('4XAxzYvQqUcxN1qdXV6Qsn1tfD19epbkg5Wkmo46L5Dq');
const KLEND_SUPPLY = P('2he82FFDtK4awwVr1XbER9XRS3BDpZYfR3b5TNNN6dS9');
const KLEND_FEE = P('4veAufs2oHh9ymfedNNZi84ycmk3sB8PRxBjtHB4JcG8');
const [KLEND_MARKET_AUTH] = PublicKey.findProgramAddressSync(
  [Buffer.from('lma'), KLEND_MARKET.toBuffer()], KLEND);

const pda = (seeds, program) => PublicKey.findProgramAddressSync(
  seeds.map(seed => Buffer.isBuffer(seed) ? seed : Buffer.from(seed)), program)[0];
const POOL_CONFIG = pda(['pool_config'], EARN_POOL);
const POOL_AUTH = pda(['pool_auth'], EARN_POOL);
const LP_MINT_AUTH = pda(['mint_auth', SHYUSD.toBuffer()], EARN_POOL);
const STABLECOIN_POOL = spl.getAssociatedTokenAddressSync(HYUSD, POOL_AUTH, true);
const HYLO = pda(['hylo'], EXCHANGE);
const STABLECOIN_AUTH = pda(['mint_auth', HYUSD.toBuffer()], EXCHANGE);
const STABLECOIN_FEE_AUTH = pda(['fee_auth', HYUSD.toBuffer()], EXCHANGE);
const STABLECOIN_FEE_VAULT = spl.getAssociatedTokenAddressSync(HYUSD, STABLECOIN_FEE_AUTH, true);
const SETTLEMENT_AUTH = pda(['settlement_auth'], EXCHANGE);
const EARN_EVENT_AUTH = pda(['__event_authority'], EARN_POOL);
const EXCHANGE_EVENT_AUTH = pda(['__event_authority'], EXCHANGE);

const hyloIdl = JSON.parse(fs.readFileSync(HYLO_IDL_PATH, 'utf8'));
const exchangeIdl = JSON.parse(fs.readFileSync(EXCHANGE_IDL_PATH, 'utf8'));
const marginfiIdl = JSON.parse(fs.readFileSync(MARGINFI_IDL_PATH, 'utf8'));
const marginfiSource = JSON.parse(fs.readFileSync(MARGINFI_SOURCE_PATH, 'utf8'));
const hyloAccountsCoder = new anchor.BorshAccountsCoder(hyloIdl);
const exchangeAccountsCoder = new anchor.BorshAccountsCoder(exchangeIdl);
const marginfiAccountsCoder = new anchor.BorshAccountsCoder(marginfiIdl);

const DISCS = {
  p0Start: Buffer.from('0e8321dc51bab46b', 'hex'),
  p0Borrow: Buffer.from('047e74353005d41f', 'hex'),
  p0Repay: Buffer.from('4fd1acb1de33ad97', 'hex'),
  p0End: Buffer.from('697cc96a9902089c', 'hex'),
  deposit: Buffer.from('bac68ce981276299', 'hex'),
  withdraw: Buffer.from('35fe1af277ed4921', 'hex'),
  absorbLoss: Buffer.from('2a2e747364feb05f', 'hex'),
  harvestYield: Buffer.from('1cc896c845382685', 'hex'),
  harvestBorrow: Buffer.from('a4667a4544d9426f', 'hex'),
  klendBorrow: Buffer.from('87e734a70734d4c1', 'hex'),
  klendRepay: Buffer.from('b97500cb60f5b4ba', 'hex'),
};

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const json = await response.json();
  return json.error ? {rpcError: json.error} : {result: json.result};
}

let forkFixture = null;

function replacePubkeyOnce(data, before, after, label) {
  const source = Buffer.from(data);
  const needle = before.toBuffer();
  let found = -1;
  let count = 0;
  for (let offset = 0; offset <= source.length - needle.length; offset += 1) {
    if (source.subarray(offset, offset + needle.length).equals(needle)) {
      found = offset;
      count += 1;
    }
  }
  if (count !== 1) throw new Error(`${label}: expected one authority occurrence, found ${count}`);
  after.toBuffer().copy(source, found);
  return {data: source, offset: found};
}

async function prepareForkFixture() {
  if (!FORK_MODE) return null;
  const templateKeys = [USER_HYUSD, REAL_USER_SHYUSD, EMPTY_MARGINFI_TEMPLATE];
  const fetched = await rpc('getMultipleAccounts', [templateKeys.map(String), {
    encoding: 'base64', commitment: 'processed',
  }]);
  if (fetched.rpcError || fetched.result.value.some(value => !value)) {
    throw new Error(`Fork fixture templates unavailable: ${JSON.stringify(fetched.rpcError || null)}`);
  }
  const [hyusdAccount, shyusdAccount, marginfiAccount] = fetched.result.value;
  const hyusdRaw = Buffer.from(hyusdAccount.data[0], 'base64');
  const shyusdRaw = Buffer.from(shyusdAccount.data[0], 'base64');
  const marginfiRaw = Buffer.from(marginfiAccount.data[0], 'base64');
  const decodedMarginfi = decodeMarginfiAccount(marginfiRaw);
  const marginfiTemplateAuthority = P(decodedMarginfi.authority);
  const patchedHyusd = replacePubkeyOnce(hyusdRaw, REAL_USER, USER, 'hyUSD token fixture');
  const patchedShyusd = replacePubkeyOnce(shyusdRaw, REAL_USER, USER, 'sHYUSD token fixture');
  const patchedMarginfi = replacePubkeyOnce(marginfiRaw, marginfiTemplateAuthority, USER,
    'Marginfi account fixture');
  const setAccount = async (address, source, data) => {
    const response = await rpc('surfnet_setAccount', [address.toString(), {
      data: Buffer.from(data).toString('hex'),
      executable: source.executable,
      lamports: source.lamports,
      owner: source.owner,
      // Mainnet token accounts commonly expose u64::MAX here, which JSON
      // cannot round-trip as an integer. Rent epoch is not program data and a
      // fork-local value of zero preserves every instruction-relevant byte.
      rentEpoch: 0,
    }]);
    if (response.rpcError) throw new Error(`surfnet_setAccount failed: ${JSON.stringify(response.rpcError)}`);
  };
  const walletSet = await rpc('surfnet_setAccount', [USER.toString(), {
    data: '', executable: false, lamports: 100_000_000_000,
    owner: SystemProgram.programId.toString(), rentEpoch: 0,
  }]);
  if (walletSet.rpcError) throw new Error(`Fork wallet fixture failed: ${JSON.stringify(walletSet.rpcError)}`);
  await setAccount(USER_HYUSD, hyusdAccount, patchedHyusd.data);
  await setAccount(USER_SHYUSD, shyusdAccount, patchedShyusd.data);
  await setAccount(USER_MARGINFI, marginfiAccount, patchedMarginfi.data);
  return {
    mode: 'Surfpool mainnet fork with lazy-fetched current public accounts',
    signer: USER.toString(),
    privateKeyPersisted: false,
    syntheticWalletLamports: '100000000000',
    templates: {
      hyusdToken: USER_HYUSD.toString(),
      shyusdToken: USER_SHYUSD.toString(),
      emptyMarginfiAccount: EMPTY_MARGINFI_TEMPLATE.toString(),
      marginfiTemplateAuthority: marginfiTemplateAuthority.toString(),
    },
    patches: {
      hyusdAuthorityOffset: patchedHyusd.offset,
      shyusdAuthorityOffset: patchedShyusd.offset,
      marginfiAuthorityOffset: patchedMarginfi.offset,
    },
    templateDataSha256: {
      hyusd: sha256(hyusdRaw), shyusd: sha256(shyusdRaw), marginfi: sha256(marginfiRaw),
    },
    patchedDataSha256: {
      hyusd: sha256(patchedHyusd.data), shyusd: sha256(patchedShyusd.data),
      marginfi: sha256(patchedMarginfi.data),
    },
  };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function ceilDiv(value, divisor) {
  return (value + divisor - 1n) / divisor;
}

function jsonValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return [...value];
  if (value instanceof PublicKey) return value.toString();
  if (anchor.BN?.isBN?.(value)) return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function fixedRaw(wrapped) {
  if (!wrapped?.value) return null;
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return value.toString();
}

function cloneInstruction(ix) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map(key => ({...key})),
    data: Buffer.from(ix.data),
  });
}

function instruction(programId, keys, data) {
  return new TransactionInstruction({programId, keys, data});
}

function sourceInstruction(name) {
  const row = marginfiSource.instructions.find(item => item.marginfiName === name);
  if (!row) throw new Error(`Missing source Marginfi instruction ${name}`);
  return instruction(P(row.programId), row.accounts.map(account => ({
    pubkey: P(account.pubkey),
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  })), Buffer.from(row.dataHex, 'hex'));
}

function isWritableIndex(message, index) {
  const header = message.header;
  if (index < header.numRequiredSignatures) {
    return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  }
  return index < message.staticAccountKeys.length - header.numReadonlyUnsignedAccounts;
}

// Solana v1 encoder. It uses the v0 compiler only to derive canonical account
// ordering and then emits the v1 inline-account wire layout directly.
function encodeV1(payer, instructions, blockhash, options = {}) {
  const {computeLimit = 1_400_000, dataLimit = 67_108_864,
    allowOversize = false, allowOverAccounts = false} = options;
  const message = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  if (message.addressTableLookups.length) throw new Error('v1 must not use address lookup tables');
  if (!allowOverAccounts && (message.staticAccountKeys.length > 64 ||
      message.compiledInstructions.length > 64)) {
    throw new Error(`v1 inline limit: ${message.staticAccountKeys.length} addresses, ` +
      `${message.compiledInstructions.length} instructions`);
  }
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const headers = [];
  const payloads = [];
  for (const ix of message.compiledInstructions) {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) {
      throw new Error('v1 instruction field overflow');
    }
    const header = Buffer.alloc(4);
    header[0] = ix.programIdIndex;
    header[1] = ix.accountKeyIndexes.length;
    header.writeUInt16LE(ix.data.length, 2);
    headers.push(header);
    payloads.push(Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data));
  }
  const unsigned = Buffer.concat([
    Buffer.from([0x81, message.header.numRequiredSignatures,
      message.header.numReadonlySignedAccounts, message.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([message.compiledInstructions.length, message.staticAccountKeys.length]),
    ...message.staticAccountKeys.map(key => key.toBuffer()),
    config,
    ...headers,
    ...payloads,
  ]);
  const wire = Buffer.concat([unsigned,
    Buffer.alloc(64 * message.header.numRequiredSignatures)]);
  if (!allowOversize && wire.length > 4096) throw new Error(`v1 wire limit: ${wire.length}`);
  return {
    wire,
    unsigned,
    sizeBytes: wire.length,
    addressCount: message.staticAccountKeys.length,
    instructionCount: message.compiledInstructions.length,
    requiredSignatures: message.header.numRequiredSignatures,
    accountKeys: message.staticAccountKeys.map((key, index) => ({
      index,
      address: key.toString(),
      signer: index < message.header.numRequiredSignatures,
      writable: isWritableIndex(message, index),
    })),
    computeLimit,
    dataLimit,
  };
}

function p0Instructions() {
  const startTemplate = sourceInstruction('lending_account_start_flashloan');
  const borrowTemplate = sourceInstruction('lending_account_borrow');
  const repayTemplate = sourceInstruction('lending_account_repay');
  const endTemplate = sourceInstruction('lending_account_end_flashloan');
  const start = endIndex => {
    const ix = cloneInstruction(startTemplate);
    ix.keys[0].pubkey = USER_MARGINFI;
    ix.keys[1].pubkey = USER;
    ix.keys[2].pubkey = IX_SYSVAR;
    ix.data = Buffer.concat([DISCS.p0Start, u64(endIndex)]);
    return ix;
  };
  const borrow = amount => {
    const ix = cloneInstruction(borrowTemplate);
    const replacements = [P0_GROUP, USER_MARGINFI, USER, P0_BANK, USER_HYUSD,
      P0_VAULT_AUTH, P0_VAULT, TOKEN, P0_BANK, P0_ORACLE];
    replacements.forEach((key, index) => { ix.keys[index].pubkey = key; });
    if (!FORK_MODE) ix.keys.push(
      {pubkey: P0_COLLATERAL_BANK, isSigner: false, isWritable: true},
      {pubkey: P0_COLLATERAL_ORACLE, isSigner: false, isWritable: false},
    );
    ix.data = Buffer.concat([DISCS.p0Borrow, u64(amount)]);
    return ix;
  };
  const repay = amount => {
    const ix = cloneInstruction(repayTemplate);
    const replacements = [P0_GROUP, USER_MARGINFI, USER, P0_BANK, USER_HYUSD,
      P0_VAULT, TOKEN];
    replacements.forEach((key, index) => { ix.keys[index].pubkey = key; });
    ix.data = Buffer.concat([DISCS.p0Repay, u64(amount), Buffer.from([1, 1])]);
    return ix;
  };
  const end = () => {
    const ix = cloneInstruction(endTemplate);
    ix.keys = [
      {...ix.keys[0], pubkey: USER_MARGINFI},
      {...ix.keys[1], pubkey: P0_GROUP},
      {...ix.keys[2], pubkey: USER},
    ];
    if (!FORK_MODE) ix.keys.push(
      {pubkey: P0_COLLATERAL_BANK, isSigner: false, isWritable: true},
      {pubkey: P0_COLLATERAL_ORACLE, isSigner: false, isWritable: false},
    );
    ix.data = DISCS.p0End;
    return ix;
  };
  const wrap = middle => [start(middle.length + 1), ...middle, end()];
  return {start, borrow, repay, end, wrap};
}

function depositIx(amount, overrides = {}) {
  const keys = [
    {pubkey: USER, isSigner: true, isWritable: true},
    {pubkey: POOL_CONFIG, isSigner: false, isWritable: false},
    {pubkey: HYLO, isSigner: false, isWritable: false},
    {pubkey: HYUSD, isSigner: false, isWritable: false},
    {pubkey: overrides.userStablecoin || USER_HYUSD, isSigner: false, isWritable: true},
    {pubkey: overrides.userLp || USER_SHYUSD, isSigner: false, isWritable: true},
    {pubkey: POOL_AUTH, isSigner: false, isWritable: false},
    {pubkey: overrides.stablecoinPool || STABLECOIN_POOL, isSigner: false, isWritable: true},
    {pubkey: LP_MINT_AUTH, isSigner: false, isWritable: false},
    {pubkey: SHYUSD, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: EARN_EVENT_AUTH, isSigner: false, isWritable: false},
    {pubkey: EARN_POOL, isSigner: false, isWritable: false},
  ];
  return instruction(EARN_POOL, keys, Buffer.concat([DISCS.deposit, u64(amount), Buffer.from([0])]));
}

function withdrawIx(shares, overrides = {}) {
  const keys = [
    {pubkey: USER, isSigner: true, isWritable: true},
    {pubkey: POOL_CONFIG, isSigner: false, isWritable: true},
    {pubkey: HYLO, isSigner: false, isWritable: false},
    {pubkey: HYUSD, isSigner: false, isWritable: false},
    {pubkey: overrides.userStablecoin || USER_HYUSD, isSigner: false, isWritable: true},
    {pubkey: STABLECOIN_FEE_AUTH, isSigner: false, isWritable: false},
    {pubkey: overrides.feeVault || STABLECOIN_FEE_VAULT, isSigner: false, isWritable: true},
    {pubkey: overrides.userLp || USER_SHYUSD, isSigner: false, isWritable: true},
    {pubkey: POOL_AUTH, isSigner: false, isWritable: false},
    {pubkey: overrides.stablecoinPool || STABLECOIN_POOL, isSigner: false, isWritable: true},
    {pubkey: SHYUSD, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: EARN_EVENT_AUTH, isSigner: false, isWritable: false},
    {pubkey: EARN_POOL, isSigner: false, isWritable: false},
  ];
  return instruction(EARN_POOL, keys, Buffer.concat([DISCS.withdraw, u64(shares), Buffer.from([0])]));
}

function absorbLossIx(amount, signer, useExpectedPda) {
  return instruction(EARN_POOL, [
    {pubkey: useExpectedPda ? SETTLEMENT_AUTH : USER, isSigner: signer, isWritable: false},
    {pubkey: HYLO, isSigner: false, isWritable: false},
    {pubkey: POOL_CONFIG, isSigner: false, isWritable: false},
    {pubkey: POOL_AUTH, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_POOL, isSigner: false, isWritable: true},
    {pubkey: HYUSD, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
  ], Buffer.concat([DISCS.absorbLoss, u64(amount)]));
}

function klendIx(kind, amount, borrowIndex = 0) {
  const keys = [USER, KLEND_MARKET_AUTH, KLEND_MARKET, KLEND_RESERVE, HYUSD,
    KLEND_SUPPLY, USER_HYUSD, KLEND_FEE, KLEND, KLEND, IX_SYSVAR, TOKEN]
    .map((pubkey, index) => ({
      pubkey,
      isSigner: index === 0,
      isWritable: [3, 5, 6, 7].includes(index),
    }));
  const data = kind === 'borrow'
    ? Buffer.concat([DISCS.klendBorrow, u64(amount)])
    : Buffer.concat([DISCS.klendRepay, u64(amount), Buffer.from([borrowIndex])]);
  return instruction(KLEND, keys, data);
}

function harvestYieldIx(registryAddresses) {
  if (registryAddresses.length < 16 || (registryAddresses.length - 16) % 4 !== 0) {
    throw new Error(`Malformed LST registry length ${registryAddresses.length}`);
  }
  const remaining = registryAddresses.map((pubkey, index) => ({
    pubkey,
    isSigner: false,
    isWritable: index >= 16 && (index - 16) % 4 === 0,
  }));
  return instruction(EXCHANGE, [
    {pubkey: HYLO, isSigner: false, isWritable: true},
    {pubkey: HYUSD, isSigner: false, isWritable: true},
    {pubkey: STABLECOIN_AUTH, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_FEE_AUTH, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_FEE_VAULT, isSigner: false, isWritable: true},
    {pubkey: STABLECOIN_POOL, isSigner: false, isWritable: true},
    {pubkey: POOL_AUTH, isSigner: false, isWritable: false},
    {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
    {pubkey: EARN_POOL, isSigner: false, isWritable: false},
    {pubkey: LST_REGISTRY, isSigner: false, isWritable: false},
    {pubkey: LUT_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: EXCHANGE_EVENT_AUTH, isSigner: false, isWritable: false},
    {pubkey: EXCHANGE, isSigner: false, isWritable: false},
    ...remaining,
  ], DISCS.harvestYield);
}

function harvestBorrowIx(exo) {
  const collateralMint = P(exo.decoded.collateral_mint);
  const exoPair = P(exo.address);
  const levercoinMint = pda(['exo_levercoin', collateralMint.toBuffer()], EXCHANGE);
  const levercoinAuth = pda(['mint_auth', levercoinMint.toBuffer()], EXCHANGE);
  const vaultAuth = pda(['exo_vault_auth', collateralMint.toBuffer()], EXCHANGE);
  const collateralVault = spl.getAssociatedTokenAddressSync(collateralMint, vaultAuth, true);
  return instruction(EXCHANGE, [
    {pubkey: HYLO, isSigner: false, isWritable: false},
    {pubkey: exoPair, isSigner: false, isWritable: true},
    {pubkey: levercoinAuth, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_AUTH, isSigner: false, isWritable: false},
    {pubkey: vaultAuth, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_FEE_AUTH, isSigner: false, isWritable: false},
    {pubkey: POOL_AUTH, isSigner: false, isWritable: false},
    {pubkey: collateralVault, isSigner: false, isWritable: false},
    {pubkey: STABLECOIN_POOL, isSigner: false, isWritable: true},
    {pubkey: STABLECOIN_FEE_VAULT, isSigner: false, isWritable: true},
    {pubkey: collateralMint, isSigner: false, isWritable: false},
    {pubkey: HYUSD, isSigner: false, isWritable: true},
    {pubkey: levercoinMint, isSigner: false, isWritable: false},
    {pubkey: P(exo.decoded.oracle), isSigner: false, isWritable: false},
    {pubkey: EARN_POOL, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: EXCHANGE_EVENT_AUTH, isSigner: false, isWritable: false},
    {pubkey: EXCHANGE, isSigner: false, isWritable: false},
  ], DISCS.harvestBorrow);
}

function decodeToken(data) {
  if (data.length < 165) return null;
  return {
    mint: P(data.subarray(0, 32)).toString(),
    authority: P(data.subarray(32, 64)).toString(),
    amountRaw: data.readBigUInt64LE(64).toString(),
    state: data[108],
  };
}

function decodeMint(data) {
  if (data.length < 82) return null;
  return {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
}

function decodeMarginfiAccount(data) {
  const value = marginfiAccountsCoder.decode('MarginfiAccount', data);
  const balance = value.lending_account.balances.find(row => row.bank_pk.equals(P0_BANK));
  const activeBalances = value.lending_account.balances.filter(row => row.active).map(row => ({
    bank: row.bank_pk.toString(),
    assetSharesI80F48Raw: fixedRaw(row.asset_shares),
    liabilitySharesI80F48Raw: fixedRaw(row.liability_shares),
  }));
  return {
    group: value.group.toString(),
    authority: value.authority.toString(),
    flags: value.account_flags.toString(),
    activeBalances,
    selectedBalance: balance ? {
      active: balance.active,
      bank: balance.bank_pk.toString(),
      assetSharesI80F48Raw: fixedRaw(balance.asset_shares),
      liabilitySharesI80F48Raw: fixedRaw(balance.liability_shares),
      premiumOutstandingI80F48Raw: fixedRaw(balance.premium_outstanding),
    } : null,
  };
}

function decodeBank(data) {
  const value = marginfiAccountsCoder.decode('Bank', data);
  return {
    group: value.group.toString(),
    mint: value.mint.toString(),
    liquidityVault: value.liquidity_vault.toString(),
    totalAssetSharesI80F48Raw: fixedRaw(value.total_asset_shares),
    totalLiabilitySharesI80F48Raw: fixedRaw(value.total_liability_shares),
    assetShareValueI80F48Raw: fixedRaw(value.asset_share_value),
    liabilityShareValueI80F48Raw: fixedRaw(value.liability_share_value),
    originationFeeI80F48Raw: fixedRaw(value.config.interest_rate_config.protocol_origination_fee),
    borrowLimitRaw: value.config.borrow_limit.toString(),
    oracle: value.config.oracle_keys[0].toString(),
    operationalState: jsonValue(value.config.operational_state),
  };
}

function rawData(account) {
  if (!account?.data) return null;
  return Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
}

function accountImage(row, account) {
  if (!account) return null;
  const data = rawData(account);
  const owner = account.owner instanceof PublicKey ? account.owner.toString() : account.owner;
  const base = {
    address: row.key.toString(),
    owner,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
  };
  try {
    if (row.type === 'token') base.token = decodeToken(data);
    else if (row.type === 'mint') base.mint = decodeMint(data);
    else if (row.type === 'poolConfig') {
      base.poolConfig = jsonValue(hyloAccountsCoder.decode('PoolConfig', data));
    } else if (row.type === 'hylo') {
      base.hylo = jsonValue(exchangeAccountsCoder.decode('Hylo', data));
    } else if (row.type === 'marginfi') base.marginfi = decodeMarginfiAccount(data);
    else if (row.type === 'bank') base.bank = decodeBank(data);
    else if (row.type === 'klend') {
      base.klend = {
        availableRaw: data.readBigUInt64LE(224).toString(),
        flashLoanFeeSf: data.readBigUInt64LE(4904).toString(),
      };
    } else if (row.type === 'exo') {
      base.exo = jsonValue(exchangeAccountsCoder.decode('ExoPair', data));
    }
  } catch (error) {
    base.decodeError = error.message;
  }
  return base;
}

function snapshot(rows, accounts) {
  return Object.fromEntries(rows.map((row, index) => [row.label, accountImage(row, accounts?.[index])]));
}

function numericState(image) {
  if (!image) return null;
  if (image.token) return {amountRaw: image.token.amountRaw};
  if (image.mint) return {supplyRaw: image.mint.supplyRaw};
  if (image.klend) return {availableRaw: image.klend.availableRaw,
    flashLoanFeeSf: image.klend.flashLoanFeeSf};
  if (image.poolConfig) return {
    withdrawalLedgerRaw: image.poolConfig.withdrawal_limiter.withdrawal_ledger.supply.bits,
    withdrawalEpoch: image.poolConfig.withdrawal_limiter.epoch,
  };
  if (image.marginfi) return {
    liabilitySharesI80F48Raw: image.marginfi.selectedBalance?.liabilitySharesI80F48Raw || '0',
    assetSharesI80F48Raw: image.marginfi.selectedBalance?.assetSharesI80F48Raw || '0',
    flags: image.marginfi.flags,
  };
  if (image.bank) return {
    totalAssetSharesI80F48Raw: image.bank.totalAssetSharesI80F48Raw,
    totalLiabilitySharesI80F48Raw: image.bank.totalLiabilitySharesI80F48Raw,
    assetShareValueI80F48Raw: image.bank.assetShareValueI80F48Raw,
    liabilityShareValueI80F48Raw: image.bank.liabilityShareValueI80F48Raw,
  };
  if (image.hylo) return {
    yieldEpoch: image.hylo.yield_harvest_cache.epoch,
    yieldStablecoinToPoolRaw: image.hylo.yield_harvest_cache.stablecoin_to_pool.bits,
    poolDrawdownRaw: image.hylo.pool_drawdown.ledger.supply.bits,
  };
  if (image.exo) return {
    borrowEpoch: image.exo.borrow_rate_harvest_cache.epoch,
    borrowStablecoinToPoolRaw: image.exo.borrow_rate_harvest_cache.stablecoin_to_pool.bits,
    virtualStablecoinRaw: image.exo.virtual_stablecoin.supply.bits,
  };
  return null;
}

function deltas(pre, post) {
  const out = {};
  for (const label of Object.keys(pre)) {
    const before = numericState(pre[label]);
    const after = numericState(post?.[label]);
    if (before && after) {
      const changes = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const left = before[key];
        const right = after[key];
        changes[key] = /^-?\d+$/.test(String(left)) && /^-?\d+$/.test(String(right))
          ? (BigInt(right) - BigInt(left)).toString()
          : left === right ? 'unchanged' : {before: left, after: right};
      }
      out[label] = changes;
    } else {
      out[label] = pre[label]?.dataSha256 === post?.[label]?.dataSha256 ? 'unchanged' : 'changed';
    }
  }
  return out;
}

function deltaRaw(deltaMap, label, field) {
  const value = deltaMap?.[label]?.[field];
  return typeof value === 'string' && /^-?\d+$/.test(value) ? BigInt(value) : 0n;
}

function allObservedDeltasZero(deltaMap) {
  return Object.values(deltaMap).every(value => {
    if (value === 'unchanged') return true;
    if (!value || typeof value !== 'object') return false;
    return Object.values(value).every(field => field === '0' || field === 'unchanged');
  });
}

function reconcile(pre, post, deltaMap, failed) {
  const userHyusd = deltaRaw(deltaMap, 'user_hyusd', 'amountRaw');
  const userShares = deltaRaw(deltaMap, 'user_shyusd', 'amountRaw');
  const postPool = BigInt(post.stablecoin_pool.token.amountRaw);
  const postSupply = BigInt(post.shyusd_mint.mint.supplyRaw);
  const shareValue = postSupply === 0n ? 0n : userShares * postPool / postSupply;
  const selectedLiability = BigInt(post.project0_marginfi_account.marginfi
    .selectedBalance?.liabilitySharesI80F48Raw || '0');
  const p0Vault = deltaRaw(deltaMap, 'project0_vault', 'amountRaw');
  const klendSupply = deltaRaw(deltaMap, 'klend_supply_vault', 'amountRaw');
  const klendFee = deltaRaw(deltaMap, 'klend_fee_vault', 'amountRaw');
  const pool = deltaRaw(deltaMap, 'stablecoin_pool', 'amountRaw');
  const feeVault = deltaRaw(deltaMap, 'withdrawal_fee_vault', 'amountRaw');
  const hyusdSupply = deltaRaw(deltaMap, 'hyusd_mint', 'supplyRaw');
  const shyusdSupply = deltaRaw(deltaMap, 'shyusd_mint', 'supplyRaw');
  return {
    failedAtomicRollbackObserved: failed ? allObservedDeltasZero(deltaMap) : null,
    postProject0LiabilitySharesI80F48Raw: selectedLiability.toString(),
    project0DebtFullyUnwound: selectedLiability === 0n,
    project0VaultDeltaRaw: p0Vault.toString(),
    klendSupplyVaultDeltaRaw: klendSupply.toString(),
    klendFeeVaultDeltaRaw: klendFee.toString(),
    lenderVaultsFullyRestored: p0Vault === 0n && klendSupply === 0n && klendFee === 0n,
    userHyusdDeltaRaw: userHyusd.toString(),
    userShyusdDeltaRaw: userShares.toString(),
    userShareDeltaMarkedToPostNavRaw: shareValue.toString(),
    outsiderEquityAfterDebtAndClaimsRaw: selectedLiability === 0n
      ? (userHyusd + shareValue).toString() : null,
    trackedHyusdTokenAccountDeltaSumRaw: (userHyusd + pool + feeVault + p0Vault +
      klendSupply + klendFee).toString(),
    trackedHyusdConservationAfterMintDeltaRaw: (userHyusd + pool + feeVault + p0Vault +
      klendSupply + klendFee - hyusdSupply).toString(),
    userAndMintShareConservationRaw: (userShares - shyusdSupply).toString(),
    hyusdMintSupplyDeltaRaw: hyusdSupply.toString(),
  };
}

function compactLogs(logs) {
  return (logs || []).filter(line => line.includes('invoke') || line.includes('success') ||
    line.includes('failed') || line.includes('Instruction:') || line.includes('AnchorError') ||
    line.includes('Error') || line.includes('consumed'));
}

function parsedTokenMovements(inner) {
  const out = [];
  for (const group of inner || []) for (const ix of group.instructions || []) {
    const info = ix.parsed?.info;
    if (!info) continue;
    const amount = info.tokenAmount?.amount ?? info.amount;
    if (amount === undefined) continue;
    out.push({
      outerInstructionIndex: group.index,
      type: ix.parsed.type,
      source: info.source || null,
      destination: info.destination || null,
      authority: info.authority || info.multisigAuthority || null,
      mint: info.mint || null,
      amount: String(amount),
    });
  }
  return out;
}

function roundTripMath(poolRaw, supplyRaw, depositRaw, harvestRaw = 0n) {
  const one = 1_000_000n;
  const navRaw = supplyRaw === 0n ? one : ceilDiv(poolRaw * one, supplyRaw);
  const sharesRaw = navRaw === 0n ? 0n : depositRaw * one / navRaw;
  const postDepositPool = poolRaw + depositRaw + harvestRaw;
  const postDepositSupply = supplyRaw + sharesRaw;
  const grossRaw = postDepositSupply === 0n ? 0n :
    sharesRaw * postDepositPool / postDepositSupply;
  const feeRaw = ceilDiv(grossRaw * 10n, 10_000n);
  const netRaw = grossRaw - feeRaw;
  return {
    navRaw,
    sharesRaw,
    grossRaw,
    feeRaw,
    netRaw,
    userHyusdDeltaRaw: netRaw - depositRaw,
  };
}

async function main() {
  forkFixture = await prepareForkFixture();
  const p0 = p0Instructions();
  const registry = await connection.getAddressLookupTable(LST_REGISTRY, 'confirmed');
  if (!registry.value) throw new Error('Current LST registry lookup table is missing');
  const registryAddresses = registry.value.state.addresses;
  const harvestYield = harvestYieldIx(registryAddresses);

  const exoAccounts = await connection.getProgramAccounts(EXCHANGE, {
    commitment: 'confirmed', filters: [{dataSize: 405}],
  });
  const exos = exoAccounts.map(row => ({
    address: row.pubkey.toString(),
    decoded: jsonValue(exchangeAccountsCoder.decode('ExoPair', row.account.data)),
  })).sort((left, right) => left.address.localeCompare(right.address));
  const harvestBorrow = exos.map(harvestBorrowIx);

  const tracked = [
    {label: 'user_wallet', key: USER, type: 'raw'},
    {label: 'user_hyusd', key: USER_HYUSD, type: 'token'},
    {label: 'user_shyusd', key: USER_SHYUSD, type: 'token'},
    {label: 'stablecoin_pool', key: STABLECOIN_POOL, type: 'token'},
    {label: 'withdrawal_fee_vault', key: STABLECOIN_FEE_VAULT, type: 'token'},
    {label: 'shyusd_mint', key: SHYUSD, type: 'mint'},
    {label: 'hyusd_mint', key: HYUSD, type: 'mint'},
    {label: 'pool_config', key: POOL_CONFIG, type: 'poolConfig'},
    {label: 'hylo', key: HYLO, type: 'hylo'},
    {label: 'project0_vault', key: P0_VAULT, type: 'token'},
    {label: 'project0_bank', key: P0_BANK, type: 'bank'},
    {label: 'project0_collateral_bank', key: P0_COLLATERAL_BANK, type: 'bank'},
    {label: 'project0_marginfi_account', key: USER_MARGINFI, type: 'marginfi'},
    {label: 'klend_supply_vault', key: KLEND_SUPPLY, type: 'token'},
    {label: 'klend_fee_vault', key: KLEND_FEE, type: 'token'},
    {label: 'klend_reserve', key: KLEND_RESERVE, type: 'klend'},
    ...exos.map((exo, index) => ({label: `exo_pair_${index}`, key: P(exo.address), type: 'exo'})),
  ];
  const initialPage = await connection.getMultipleAccountsInfoAndContext(
    tracked.map(row => row.key), 'confirmed');
  const initial = snapshot(tracked, initialPage.value);
  const userToken = initial.user_hyusd.token;
  const userShare = initial.user_shyusd.token;
  const marginfiState = initial.project0_marginfi_account.marginfi;
  const bankState = initial.project0_bank.bank;
  const collateralBankState = initial.project0_collateral_bank.bank;
  const project0Available = BigInt(initial.project0_vault.token.amountRaw);
  const klendAvailable = BigInt(initial.klend_reserve.klend.availableRaw);

  const assertions = {
    userIsOnCurve: PublicKey.isOnCurve(USER.toBytes()),
    userSystemOwned: initial.user_wallet.owner === SYSTEM.toString(),
    userHyusdOwnerMatches: userToken.authority === USER.toString(),
    userHyusdMintMatches: userToken.mint === HYUSD.toString(),
    userShyusdOwnerMatches: userShare.authority === USER.toString(),
    userShyusdMintMatches: userShare.mint === SHYUSD.toString(),
    marginfiAuthorityMatches: marginfiState.authority === USER.toString(),
    marginfiGroupMatches: marginfiState.group === P0_GROUP.toString(),
    project0BankGroupMatches: bankState.group === P0_GROUP.toString(),
    project0BankMintMatches: bankState.mint === HYUSD.toString(),
    project0VaultMatches: bankState.liquidityVault === P0_VAULT.toString(),
    project0OracleMatches: bankState.oracle === P0_ORACLE.toString(),
    marginfiFixtureBalanceShapeMatches: FORK_MODE ? marginfiState.activeBalances.length === 0 :
      marginfiState.activeBalances.length === 1 &&
      marginfiState.activeBalances[0].bank === P0_COLLATERAL_BANK.toString() &&
      marginfiState.activeBalances[0].liabilitySharesI80F48Raw === '0',
    project0CollateralBankGroupMatches: collateralBankState.group === P0_GROUP.toString(),
    project0CollateralOracleMatches: collateralBankState.oracle === P0_COLLATERAL_ORACLE.toString(),
    project0OriginationFeeExactlyZero: bankState.originationFeeI80F48Raw === '0',
    klendFlashFeeExactlyZero: initial.klend_reserve.klend.flashLoanFeeSf === '0',
    settlementAuthorityOffCurve: !PublicKey.isOnCurve(SETTLEMENT_AUTH.toBytes()),
  };
  if (Object.values(assertions).some(value => value !== true)) {
    throw new Error(`Identity/precondition assertion failed: ${JSON.stringify(assertions)}`);
  }

  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const results = [];

  async function simulateCase(name, category, expectation, build, includeWire = false,
    options = {}) {
    const prePage = await connection.getMultipleAccountsInfoAndContext(
      tracked.map(row => row.key), 'confirmed');
    const pre = snapshot(tracked, prePage.value);
    const context = {
      poolRaw: BigInt(pre.stablecoin_pool.token.amountRaw),
      supplyRaw: BigInt(pre.shyusd_mint.mint.supplyRaw),
      project0Available: BigInt(pre.project0_vault.token.amountRaw),
      klendAvailable: BigInt(pre.klend_reserve.klend.availableRaw),
    };
    let built;
    let encoded;
    try {
      built = build(context);
      const caseBlockhash = FORK_MODE
        ? (await connection.getLatestBlockhash('processed')).blockhash : blockhash;
      encoded = encodeV1(USER, built.instructions, caseBlockhash, options);
    } catch (error) {
      const row = {name, category, expectation, localCompositionError: error.message};
      results.push(row);
      process.stdout.write(`${JSON.stringify(row)}\n`);
      return row;
    }
    // simulateTransaction caps returned-account snapshots at the number of
    // accounts in the transaction. Ask only for tracked accounts present in
    // this message, then carry unrelated tracked accounts forward unchanged.
    let simulationWire = encoded.wire;
    let signerOrder = encoded.accountKeys.filter(row => row.signer).map(row => row.address);
    if (FORK_MODE) {
      if (encoded.requiredSignatures !== 1 || signerOrder[0] !== USER.toString()) {
        throw new Error(`${name}: unexpected fork signer order ${JSON.stringify(signerOrder)}`);
      }
      simulationWire = Buffer.from(encoded.wire);
      const privateKey = crypto.createPrivateKey({
        key: Buffer.concat([
          Buffer.from('302e020100300506032b657004220420', 'hex'),
          Buffer.from(FORK_SIGNER.secretKey.subarray(0, 32)),
        ]),
        format: 'der', type: 'pkcs8',
      });
      crypto.sign(null, encoded.unsigned, privateKey).copy(simulationWire, encoded.unsigned.length);
    }
    const messageAccountKeys = new Set(encoded.accountKeys.map(row => row.address));
    const requestedRows = tracked.filter(row => messageAccountKeys.has(row.key.toString()));
    const response = await rpc('simulateTransaction', [simulationWire.toString('base64'), {
      encoding: 'base64', sigVerify: FORK_MODE, replaceRecentBlockhash: !FORK_MODE,
      commitment: FORK_MODE ? 'processed' : 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: requestedRows.map(row => row.key.toString())},
    }]);
    const value = response.result?.value;
    const requestedPost = snapshot(requestedRows, value?.accounts);
    const post = Object.fromEntries(tracked.map(row => [
      row.label,
      requestedPost[row.label] ?? pre[row.label],
    ]));
    const deltaMap = deltas(pre, post);
    const failed = Boolean(value?.err || response.rpcError);
    const row = {
      name,
      category,
      expectation,
      txVersion: 1,
      liveSubmission: false,
      sigVerify: FORK_MODE,
      replaceRecentBlockhash: !FORK_MODE,
      modeledSigner: USER.toString(),
      signerOrder,
      preSlot: prePage.context.slot,
      simulationSlot: response.result?.context?.slot || null,
      rpcError: response.rpcError || null,
      err: value?.err || null,
      unitsConsumed: value?.unitsConsumed ?? null,
      loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
      sizeBytes: encoded.sizeBytes,
      headroomBytes: 4096 - encoded.sizeBytes,
      addressCount: encoded.addressCount,
      addressHeadroom: 64 - encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      accountKeys: encoded.accountKeys,
      computeLimit: encoded.computeLimit,
      loadedAccountDataLimit: encoded.dataLimit,
      wireSha256: sha256(simulationWire),
      ...(includeWire ? {
        wireBase64: simulationWire.toString('base64'),
        unsignedMessageBase64: encoded.unsigned.toString('base64'),
      } : {}),
      analysis: jsonValue(built.analysis || null),
      pre,
      post,
      deltas: deltaMap,
      tokenMovements: parsedTokenMovements(value?.innerInstructions),
      returnData: value?.returnData || null,
      trace: compactLogs(value?.logs),
      logs: value?.logs || null,
      atomicRollbackExpected: failed,
      reconciliation: reconcile(pre, post, deltaMap, failed),
    };
    results.push(row);
    process.stdout.write(`${JSON.stringify({
      name, err: row.err, rpcError: row.rpcError, sizeBytes: row.sizeBytes,
      addressCount: row.addressCount, instructions: row.instructionCount,
      unitsConsumed: row.unitsConsumed, analysis: row.analysis,
      selectedDeltas: {
        userHyusd: row.deltas.user_hyusd,
        userShyusd: row.deltas.user_shyusd,
        pool: row.deltas.stablecoin_pool,
        feeVault: row.deltas.withdrawal_fee_vault,
        p0Vault: row.deltas.project0_vault,
        p0Account: row.deltas.project0_marginfi_account,
        klendSupply: row.deltas.klend_supply_vault,
      }, tail: row.trace.slice(-5),
    })}\n`);
    return row;
  }

  const roundTrip = (amount, funding, order = 'deposit-withdraw', extra = []) => context => {
    const math = roundTripMath(context.poolRaw, context.supplyRaw, amount);
    const legs = order === 'deposit-withdraw'
      ? [depositIx(amount), ...extra, withdrawIx(math.sharesRaw)]
      : [withdrawIx(math.sharesRaw), ...extra, depositIx(amount)];
    if (funding === 'direct') return {instructions: legs, analysis: math};
    if (funding === 'klend') return {
      instructions: [klendIx('borrow', amount), ...legs, klendIx('repay', amount, 0)],
      analysis: math,
    };
    if (funding === 'project0') return {
      instructions: p0.wrap([p0.borrow(amount), ...legs, p0.repay(amount)]),
      analysis: math,
    };
    throw new Error(`Unknown funding ${funding}`);
  };

  const isSuccess = row => !row.localCompositionError && !row.rpcError && row.err == null;

  // Project0's flash-loan start is outer instruction 0, its borrow is 1, and
  // the nested KLend flash borrow is therefore outer instruction 2. KLend's
  // repay instruction commits to that exact borrow index through the
  // instructions sysvar.
  const fundedWrap = (project0Amount, klendAmount, core) => {
    if (project0Amount > 0n && klendAmount > 0n) {
      return p0.wrap([
        p0.borrow(project0Amount),
        klendIx('borrow', klendAmount),
        ...core,
        klendIx('repay', klendAmount, 2),
        p0.repay(project0Amount),
      ]);
    }
    if (project0Amount > 0n) {
      return p0.wrap([p0.borrow(project0Amount), ...core, p0.repay(project0Amount)]);
    }
    if (klendAmount > 0n) {
      return [klendIx('borrow', klendAmount), ...core,
        klendIx('repay', klendAmount, 0)];
    }
    return core;
  };

  const fundedRoundTrip = (project0Amount, klendAmount,
    order = 'deposit-withdraw', extra = []) => context => {
    const amount = project0Amount + klendAmount;
    const math = roundTripMath(context.poolRaw, context.supplyRaw, amount);
    const core = order === 'deposit-withdraw'
      ? [depositIx(amount), ...extra, withdrawIx(math.sharesRaw)]
      : [withdrawIx(math.sharesRaw), ...extra, depositIx(amount)];
    return {
      instructions: fundedWrap(project0Amount, klendAmount, core),
      analysis: {...math, project0BorrowRaw: project0Amount,
        klendBorrowRaw: klendAmount, combinedInputRaw: amount},
    };
  };

  const fundedTarget = (project0Amount, klendAmount, targetInstructions,
    analysis = {}) => () => ({
    instructions: fundedWrap(project0Amount, klendAmount, targetInstructions),
    analysis: {...analysis, project0BorrowRaw: project0Amount,
      klendBorrowRaw: klendAmount},
  });

  const fundedRepeatedRoundTrips = (project0Amount, klendAmount, repetitions) => context => {
    const amount = project0Amount + klendAmount;
    let pool = context.poolRaw;
    let supply = context.supplyRaw;
    const core = [];
    const rounds = [];
    for (let i = 0; i < repetitions; i += 1) {
      const math = roundTripMath(pool, supply, amount);
      rounds.push(math);
      core.push(depositIx(amount), withdrawIx(math.sharesRaw));
      pool = pool + amount - math.grossRaw;
      // Deposit mints and the paired withdrawal burns the same share amount.
      supply = supply + math.sharesRaw - math.sharesRaw;
    }
    return {
      instructions: fundedWrap(project0Amount, klendAmount, core),
      analysis: {project0BorrowRaw: project0Amount, klendBorrowRaw: klendAmount,
        combinedInputRaw: amount, repetitions, rounds},
    };
  };

  // Direct controls prove that the on-chain ELF accepts the official IDL's
  // deposit/withdraw discriminators and account ordering.
  for (const amount of [1n, 2n, 10n, 100n, 100_000n]) {
    await simulateCase(`direct_round_trip_${amount}`, 'earn-pool-rounding',
      'Successful positive-output cases must preserve share balance and lose only protocol-favouring rounding plus the 10 bp withdrawal fee.',
      roundTrip(amount, 'direct'), amount === 2n || amount === 100_000n);
  }
  await simulateCase('direct_withdraw_before_deposit_100000', 'same-tx-ordering',
    'Reversing the state update order must not create positive outsider equity.',
    roundTrip(100_000n, 'direct', 'withdraw-deposit'), true);
  await simulateCase('direct_four_repeated_round_trips_100000', 'same-tx-repetition',
    'Repeated same-transaction rounding must not become positive.', context => {
      const math = roundTripMath(context.poolRaw, context.supplyRaw, 100_000n);
      const instructions = [];
      for (let i = 0; i < 4; i += 1) {
        instructions.push(depositIx(100_000n), withdrawIx(math.sharesRaw));
      }
      return {instructions, analysis: {...math, repetitions: 4}};
    }, true);

  // Live account-substitution and CPI authority probes.
  const substitutionCases = [
    ['deposit_alias_protocol_pool_as_user_source', [depositIx(2n, {userStablecoin: STABLECOIN_POOL})]],
    ['deposit_substitute_user_token_as_protocol_pool', [depositIx(2n, {stablecoinPool: USER_HYUSD})]],
    ['deposit_substitute_hyusd_account_as_lp_account', [depositIx(2n, {userLp: USER_HYUSD})]],
    ['withdraw_alias_protocol_pool_as_user_destination', [withdrawIx(1n, {userStablecoin: STABLECOIN_POOL})]],
    ['withdraw_substitute_user_token_as_fee_vault', [withdrawIx(1n, {feeVault: USER_HYUSD})]],
    ['withdraw_substitute_hyusd_account_as_lp_account', [withdrawIx(1n, {userLp: USER_HYUSD})]],
    ['withdraw_substitute_user_token_as_protocol_pool', [withdrawIx(1n, {stablecoinPool: USER_HYUSD})]],
  ];
  for (const [name, instructions] of substitutionCases) {
    await simulateCase(name, 'account-substitution',
      'The deployed program must reject the substituted token owner, mint, or PDA before value leaves the pool.',
      () => ({instructions}), false);
    await simulateCase(`klend_flash_wrapped_${name}`, 'account-substitution-flash',
      'The same substitution must remain rejected inside a fully repayable exact-available KLend flash composition.',
      fundedTarget(0n, klendAvailable, instructions), false);
  }
  await simulateCase('absorb_loss_expected_pda_without_signature', 'cpi-authority',
    'A top-level outsider cannot sign the off-curve Exchange settlement PDA.',
    () => ({instructions: [absorbLossIx(1n, false, true)]}), true);
  await simulateCase('absorb_loss_outsider_signer_wrong_pda', 'cpi-authority',
    'An on-curve outsider signature must fail the settlement PDA seed constraint.',
    () => ({instructions: [absorbLossIx(1n, true, false)]}), true);
  await simulateCase('klend_flash_wrapped_absorb_loss_expected_pda_without_signature',
    'cpi-authority-flash',
    'Flash capital cannot supply the missing off-curve settlement-authority signature.',
    fundedTarget(0n, klendAvailable, [absorbLossIx(1n, false, true)]), true);
  await simulateCase('klend_flash_wrapped_absorb_loss_outsider_signer_wrong_pda',
    'cpi-authority-flash',
    'Flash capital cannot make an outsider key satisfy the settlement-authority PDA seeds.',
    fundedTarget(0n, klendAvailable, [absorbLossIx(1n, true, false)]), true);

  // Current permissionless harvest gates. All caches currently record epoch 1058.
  await simulateCase('harvest_yield_current_epoch', 'same-tx-price-update',
    'The already-run epoch gate must reject a second LST yield harvest.',
    () => ({instructions: [harvestYield]}), true);
  for (let i = 0; i < harvestBorrow.length; i += 1) {
    await simulateCase(`harvest_borrow_rate_current_epoch_${i}`, 'same-tx-price-update',
      'The already-run epoch gate must reject a second borrow-rate harvest for this pair.',
      () => ({instructions: [harvestBorrow[i]]}), i === 0);
  }

  // Exact-zero-rate KLend dust and the displayed-available boundary +/- one.
  const klendBoundaryAmounts = [klendAvailable - 1n, klendAvailable,
    klendAvailable + 1n].filter(amount => amount > 0n);
  for (const amount of [...new Set([1n, 2n, 10n, 100n, ...klendBoundaryAmounts])]) {
    await simulateCase(`klend_flash_only_${amount}`, 'klend-control',
      'Borrow and exact repayment must return wallet, reserve, supply vault and fee vault to the preimage.',
      () => ({instructions: [klendIx('borrow', amount), klendIx('repay', amount, 0)]}),
      amount === 1n || klendBoundaryAmounts.includes(amount));
    await simulateCase(`klend_hylo_round_trip_${amount}`, 'klend-hylo-v1',
      'A full flash repayment may consume the user buffer, but outsider equity after debt and claims must never increase.',
      roundTrip(amount, 'klend'), amount === 2n || klendBoundaryAmounts.includes(amount));
  }
  await simulateCase('klend_two_flash_borrows_same_transaction', 'klend-repeat-borrow',
    'A second KLend flash borrow in the same transaction must hit the reserve MultipleFlashBorrows constraint and roll back atomically.',
    () => ({instructions: [
      klendIx('borrow', 1n), klendIx('borrow', 1n),
      klendIx('repay', 1n, 0), klendIx('repay', 1n, 1),
    ], analysis: {borrowCount: 2, totalRaw: '2'}}), true);
  await simulateCase('klend_flash_withdraw_before_deposit_100000', 'same-tx-ordering-flash',
    'Reversing withdraw/deposit under flash liquidity must fully repay and cannot create positive outsider equity.',
    fundedRoundTrip(0n, 100_000n, 'withdraw-deposit'), true);
  await simulateCase('klend_flash_four_repeated_round_trips_100000',
    'same-tx-repetition-flash',
    'Four same-transaction flash-funded rounds must remain negative after exact lender repayment.',
    fundedRepeatedRoundTrips(0n, 100_000n, 4), true);

  // Project0 live controls and monotonic current-risk boundary.
  const p0Only = amount => () => ({
    instructions: p0.wrap([p0.borrow(amount), p0.repay(amount)]),
    analysis: {borrowRaw: amount},
  });
  const p0One = await simulateCase('project0_flash_only_1', 'project0-control',
    'Pin the one-raw-unit boundary.', p0Only(1n), true);
  const p0Two = await simulateCase('project0_flash_only_2', 'project0-control',
    'A successful flash-only control must fully restore all lender and debt/share balances.',
    p0Only(2n), true);
  for (const amount of [project0Available - 1n, project0Available,
    project0Available + 1n].filter(value => value > 0n)) {
    await simulateCase(`project0_flash_only_displayed_available_boundary_${amount}`,
      'project0-displayed-available',
      'Test the displayed token-vault balance boundary directly; a lower bank borrow limit may reject it before vault liquidity is exhausted.',
      p0Only(amount), true);
    await simulateCase(`project0_hylo_displayed_available_boundary_${amount}`,
      'project0-hylo-displayed-available',
      'Test the same displayed-balance boundary through the complete Hylo route and exact Project0 repayment.',
      roundTrip(amount, 'project0'), true);
  }
  let lower = p0Two.err == null && !p0Two.rpcError ? 2n : 0n;
  if (p0One.err == null && !p0One.rpcError) lower = 1n;
  let upper = project0Available;
  let project0Max = lower;
  const binaryRows = [];
  while (lower <= upper) {
    const amount = (lower + upper) / 2n;
    const row = await simulateCase(`project0_limit_binary_${amount}`,
      'project0-near-available',
      'Find the largest current risk-permitted, fully repaid target-mint flash borrow.',
      p0Only(amount), false);
    binaryRows.push(row.name);
    if (!row.localCompositionError && !row.rpcError && row.err == null) {
      project0Max = amount;
      lower = amount + 1n;
    } else {
      upper = amount - 1n;
    }
  }
  let project0RouteMax = 0n;
  const project0RouteBinaryRows = [];
  let dualRouteProject0Max = 0n;
  const dualRouteBinaryRows = [];
  let dualMaximumTotal = 0n;
  if (project0Max > 0n) {
    if (project0Max > 1n) {
      await simulateCase('project0_flash_only_risk_limited_maximum_minus_one',
        'project0-near-available',
        'The raw unit immediately below the observed Project0 risk boundary must remain fully repayable.',
        p0Only(project0Max - 1n), true);
    }
    await simulateCase('project0_flash_only_risk_limited_maximum', 'project0-control',
      'The retained near-available control must fully repay and restore all lender/debt balances.',
      p0Only(project0Max), true);
    await simulateCase('project0_flash_only_risk_limited_maximum_plus_one',
      'project0-near-available', 'The first raw unit beyond the observed boundary must fail atomically.',
      p0Only(project0Max + 1n), true);
    const p0RouteDustAmount = project0Max >= 2n ? 2n : 1n;
    const p0RouteDust = await simulateCase('project0_hylo_round_trip_dust',
      'project0-hylo-v1',
      'The dust composition must fully repay Project0 and show no positive outsider equity.',
      roundTrip(p0RouteDustAmount, 'project0'), true);
    let routeLower = isSuccess(p0RouteDust) ? p0RouteDustAmount : 0n;
    let routeUpper = project0Max;
    project0RouteMax = routeLower;
    while (routeLower <= routeUpper) {
      const amount = (routeLower + routeUpper) / 2n;
      const row = await simulateCase(`project0_hylo_route_binary_${amount}`,
        'project0-hylo-route-boundary',
        'Find the largest Project0 amount that completes deposit, withdrawal, exact repayment, and flash-loan end in one v1 transaction.',
        roundTrip(amount, 'project0'), false);
      project0RouteBinaryRows.push(row.name);
      if (isSuccess(row)) {
        project0RouteMax = amount;
        routeLower = amount + 1n;
      } else {
        routeUpper = amount - 1n;
      }
    }
    for (const amount of [project0RouteMax - 1n, project0RouteMax,
      project0RouteMax + 1n].filter(value => value > 0n)) {
      await simulateCase(`project0_hylo_route_boundary_${amount}`,
        'project0-hylo-route-boundary',
        'Retest the complete route at its observed maximum and adjacent raw units with full unwind and reconciliation.',
        roundTrip(amount, 'project0'), true);
    }

    const safeP0 = project0Max >= 2n ? 2n : 1n;
    const dualDust = await simulateCase('dual_project0_klend_hylo_asymmetric_small_p0',
      'maximum-source-hylo-v1',
      'Combine independent Project0 and KLend zero-fee liquidity in one signed v1 route, using an intentionally asymmetric allocation.',
      fundedRoundTrip(safeP0, klendAvailable), true);
    let dualLower = isSuccess(dualDust) ? safeP0 : 0n;
    let dualUpper = project0Max;
    dualRouteProject0Max = dualLower;
    while (dualLower <= dualUpper) {
      const amount = (dualLower + dualUpper) / 2n;
      const row = await simulateCase(`dual_project0_route_binary_${amount}_klend_${klendAvailable}`,
        'maximum-source-route-boundary',
        'Optimize the Project0 allocation while holding KLend at its exact current available amount; every successful route must unwind both lenders.',
        fundedRoundTrip(amount, klendAvailable), false);
      dualRouteBinaryRows.push(row.name);
      if (isSuccess(row)) {
        dualRouteProject0Max = amount;
        dualLower = amount + 1n;
      } else {
        dualUpper = amount - 1n;
      }
    }
    dualMaximumTotal = dualRouteProject0Max + klendAvailable;
    for (const amount of [dualRouteProject0Max - 1n, dualRouteProject0Max,
      dualRouteProject0Max + 1n].filter(value => value > 0n)) {
      await simulateCase(`dual_project0_boundary_${amount}_klend_exact_${klendAvailable}`,
        'maximum-source-route-boundary',
        'Retest the jointly routed maximum Project0 allocation and adjacent raw units while KLend is fixed at exact available.',
        fundedRoundTrip(amount, klendAvailable), true);
    }
    for (const amount of klendBoundaryAmounts) {
      await simulateCase(`dual_klend_boundary_${amount}_project0_${safeP0}`,
        'maximum-source-route-boundary',
        'Retest KLend displayed availability and adjacent raw units while an independent Project0 flash loan is active in the same transaction.',
        fundedRoundTrip(safeP0, amount), true);
    }
    if (dualRouteProject0Max > 0n) {
      await simulateCase('dual_project0_max_klend_one_asymmetric',
        'maximum-source-hylo-v1',
        'Exercise the opposite asymmetric allocation: maximum route-valid Project0 with one raw unit from KLend.',
        fundedRoundTrip(dualRouteProject0Max, 1n), true);
      await simulateCase('dual_maximum_jointly_route_valid', 'maximum-source-hylo-v1',
        'Use every observed route-valid raw unit from both independent zero-fee lenders, then unwind and reconcile all balances.',
        fundedRoundTrip(dualRouteProject0Max, klendAvailable), true);
    }

    const orderingP0 = project0Max >= 100_000n ? 100_000n : project0Max;
    const orderingKlend = klendAvailable >= 100_000n ? 100_000n : klendAvailable;
    await simulateCase('project0_flash_withdraw_before_deposit', 'same-tx-ordering-flash',
      'Project0-funded reversed ordering must not produce positive outsider equity.',
      fundedRoundTrip(orderingP0, 0n, 'withdraw-deposit'), true);
    await simulateCase('dual_flash_withdraw_before_deposit', 'same-tx-ordering-flash',
      'The two-lender reversed ordering must unwind both debts and cannot produce positive outsider equity.',
      fundedRoundTrip(orderingP0, orderingKlend, 'withdraw-deposit'), true);
    await simulateCase('project0_flash_four_repeated_round_trips',
      'same-tx-repetition-flash',
      'Four Project0-funded rounds in one transaction must stay negative and repay exactly.',
      fundedRepeatedRoundTrips(orderingP0, 0n, 4), true);
    await simulateCase('dual_flash_four_repeated_round_trips',
      'same-tx-repetition-flash',
      'Four two-lender-funded rounds in one transaction must stay negative and unwind both lenders.',
      fundedRepeatedRoundTrips(orderingP0, orderingKlend, 4), true);

    for (const [name, instructions] of substitutionCases) {
      await simulateCase(`dual_flash_wrapped_${name}`, 'account-substitution-flash',
        'Two simultaneous flash lenders cannot alter Hylo token-owner, mint, or PDA constraints.',
        fundedTarget(safeP0, klendAvailable, instructions), false);
    }
    await simulateCase('dual_flash_wrapped_absorb_loss_expected_pda_without_signature',
      'cpi-authority-flash',
      'Two simultaneous lenders cannot supply an off-curve settlement PDA signature.',
      fundedTarget(safeP0, klendAvailable, [absorbLossIx(1n, false, true)]), true);
    await simulateCase('dual_flash_wrapped_absorb_loss_outsider_signer_wrong_pda',
      'cpi-authority-flash',
      'Two simultaneous lenders cannot make the outsider satisfy settlement PDA seeds.',
      fundedTarget(safeP0, klendAvailable, [absorbLossIx(1n, true, false)]), true);
  }

  const cachedHarvestRaw = BigInt(initial.hylo.hylo.yield_harvest_cache.stablecoin_to_pool.bits) +
    exos.reduce((sum, exo) => sum + BigInt(exo.decoded.borrow_rate_harvest_cache
      .stablecoin_to_pool.bits), 0n);
  const currentHarvests = [
    {name: 'yield', instruction: harvestYield},
    ...harvestBorrow.map((item, index) => ({name: `borrow_rate_${index}`, instruction: item})),
  ];
  for (const harvest of currentHarvests) {
    await simulateCase(`klend_flash_deposit_${harvest.name}_withdraw_repay`,
      'same-tx-price-update-flash',
      'The current-epoch harvest gate must reject this KLend-funded interposition atomically before any outsider gain.',
      fundedRoundTrip(0n, klendAvailable, 'deposit-withdraw', [harvest.instruction]),
      harvest.name === 'yield');
    if (project0RouteMax > 0n) {
      await simulateCase(`project0_flash_deposit_${harvest.name}_withdraw_repay`,
        'same-tx-price-update-flash',
        'The same current-epoch gate must hold at the maximum route-valid Project0 input.',
        fundedRoundTrip(project0RouteMax, 0n, 'deposit-withdraw', [harvest.instruction]),
        harvest.name === 'yield');
    }
    if (dualRouteProject0Max > 0n) {
      await simulateCase(`dual_flash_deposit_${harvest.name}_withdraw_repay`,
        'same-tx-price-update-flash',
        'The same current-epoch gate must hold with the maximum two-source allocation; if it cannot fit v1, record the exact footprint blocker.',
        fundedRoundTrip(dualRouteProject0Max, klendAvailable,
          'deposit-withdraw', [harvest.instruction]), harvest.name === 'yield');
    }
  }
  const allHarvestInstructions = currentHarvests.map(row => row.instruction);
  await simulateCase('klend_flash_deposit_all_current_harvests_withdraw_repay',
    'same-tx-price-update-flash',
    'Attempt all permissionless harvests in one exact-available KLend route and record either the epoch gate or exact v1 footprint blocker.',
    fundedRoundTrip(0n, klendAvailable, 'deposit-withdraw', allHarvestInstructions), true);
  if (project0RouteMax > 0n) {
    await simulateCase('project0_flash_deposit_all_current_harvests_withdraw_repay',
      'same-tx-price-update-flash',
      'Attempt all permissionless harvests at maximum Project0 input and record the epoch gate or exact v1 footprint blocker.',
      fundedRoundTrip(project0RouteMax, 0n, 'deposit-withdraw', allHarvestInstructions), true);
  }
  if (dualRouteProject0Max > 0n) {
    const harvestMath = roundTripMath(
      BigInt(initial.stablecoin_pool.token.amountRaw),
      BigInt(initial.shyusd_mint.mint.supplyRaw), dualMaximumTotal, cachedHarvestRaw);
    await simulateCase('dual_flash_deposit_all_current_harvests_withdraw_repay',
      'same-tx-price-update-flash',
      'Attempt all permissionless harvests at maximum combined input; record exact account/size/compute or epoch-gate behavior.',
      context => {
        const built = fundedRoundTrip(dualRouteProject0Max, klendAvailable,
          'deposit-withdraw', allHarvestInstructions)(context);
        built.analysis.priorEpochCachedHarvestRaw = cachedHarvestRaw;
        built.analysis.sensitivityUsingCachedHarvest = harvestMath;
        return built;
      }, true);
  }

  const cachedYieldRaw = BigInt(initial.hylo.hylo.yield_harvest_cache.stablecoin_to_pool.bits);
  const cachedBorrowRows = exos.map((exo, index) => ({
    index,
    address: exo.address,
    collateralMint: exo.decoded.collateral_mint,
    epoch: exo.decoded.borrow_rate_harvest_cache.epoch,
    stablecoinToPoolRaw: exo.decoded.borrow_rate_harvest_cache.stablecoin_to_pool.bits,
    stabilityPoolCapRaw: exo.decoded.borrow_rate_harvest_cache.stability_pool_cap.bits,
  }));
  const cachedAggregateHarvestRaw = cachedYieldRaw + cachedBorrowRows.reduce(
    (sum, row) => sum + BigInt(row.stablecoinToPoolRaw), 0n);
  const initialPoolRaw = BigInt(initial.stablecoin_pool.token.amountRaw);
  const initialSupplyRaw = BigInt(initial.shyusd_mint.mint.supplyRaw);
  const sensitivityDepositRaw = dualMaximumTotal > 0n ? dualMaximumTotal :
    (project0RouteMax > 0n ? project0RouteMax : project0Max);
  const observedHarvestSensitivity = sensitivityDepositRaw > 0n ?
    roundTripMath(initialPoolRaw, initialSupplyRaw, sensitivityDepositRaw,
      cachedAggregateHarvestRaw) : null;
  let breakEvenHarvestRaw = null;
  if (sensitivityDepositRaw > 0n) {
    let low = 0n;
    let high = initialPoolRaw;
    while (low + 1n < high) {
      const middle = (low + high) / 2n;
      if (roundTripMath(initialPoolRaw, initialSupplyRaw, sensitivityDepositRaw, middle)
        .userHyusdDeltaRaw > 0n) high = middle;
      else low = middle;
    }
    breakEvenHarvestRaw = high;
  }

  const succeeded = results.filter(row => !row.localCompositionError && !row.rpcError && row.err == null);
  const failed = results.filter(row => row.localCompositionError || row.rpcError || row.err != null);
  const positiveOutsiderEquity = succeeded.filter(row =>
    BigInt(row.reconciliation?.outsiderEquityAfterDebtAndClaimsRaw || '0') > 0n);
  const nonUnwoundSuccessful = succeeded.filter(row =>
    row.reconciliation && (!row.reconciliation.project0DebtFullyUnwound ||
      !row.reconciliation.lenderVaultsFullyRestored));
  const output = {
    generatedAt: new Date().toISOString(),
    safety: FORK_MODE ?
      'Local mainnet fork only; fresh ephemeral outsider signatures, sigVerify:true simulations, no private key persisted, and no transaction submitted.' :
      'Read-only current-mainnet get* RPC and simulateTransaction only; no private key loaded, no signature produced, and no transaction submitted.',
    rpcEndpointRedacted: true,
    executionEnvironment: FORK_MODE ? 'signed-faithful-fork' : 'read-only-current-mainnet',
    forkFixture,
    observationSlot: initialPage.context.slot,
    programs: {
      earnPool: EARN_POOL.toString(), exchange: EXCHANGE.toString(),
      project0: MARGINFI.toString(), klend: KLEND.toString(), token: TOKEN.toString(),
    },
    sourceEvidence: {
      earnPoolIdl: path.relative(ROOT, HYLO_IDL_PATH),
      earnPoolIdlSha256: sha256(fs.readFileSync(HYLO_IDL_PATH)),
      exchangeIdl: path.relative(ROOT, EXCHANGE_IDL_PATH),
      exchangeIdlSha256: sha256(fs.readFileSync(EXCHANGE_IDL_PATH)),
      marginfiFlashTemplate: path.basename(MARGINFI_SOURCE_PATH),
      marginfiFlashTemplateSha256: sha256(fs.readFileSync(MARGINFI_SOURCE_PATH)),
      marginfiFlashTemplateSignature: marginfiSource.signature,
      marginfiFlashTemplateSlot: marginfiSource.slot,
    },
    outsider: {
      authority: USER.toString(),
      onCurve: true,
      systemOwned: true,
      hyusdTokenAccount: USER_HYUSD.toString(),
      shyusdTokenAccount: USER_SHYUSD.toString(),
      marginfiAccount: USER_MARGINFI.toString(),
      classification: 'Existing on-curve user/beneficiary used only to model that user own signature; not a Hylo admin, pause authority, upgrade authority, pool PDA, fee PDA, or settlement PDA.',
    },
    assertions,
    currentLiquidity: {
      project0: {
        group: P0_GROUP.toString(), bank: P0_BANK.toString(), vault: P0_VAULT.toString(),
        oracle: P0_ORACLE.toString(), vaultRaw: project0Available.toString(),
        outsiderActiveCollateralBank: P0_COLLATERAL_BANK.toString(),
        outsiderActiveCollateralOracle: P0_COLLATERAL_ORACLE.toString(),
        lastSuccessfulRiskLimitedRaw: project0Max.toString(),
        firstRejectedAboveObservedBoundaryRaw: project0Max < project0Available ?
          (project0Max + 1n).toString() : null,
        binaryRows,
        lastSuccessfulFullHyloRouteRaw: project0RouteMax.toString(),
        firstRejectedAboveFullHyloRouteRaw: project0RouteMax > 0n ?
          (project0RouteMax + 1n).toString() : null,
        fullHyloRouteBinaryRows: project0RouteBinaryRows,
        originationFeeI80F48Raw: bankState.originationFeeI80F48Raw,
        operationalState: bankState.operationalState,
      },
      klend: {
        market: KLEND_MARKET.toString(), reserve: KLEND_RESERVE.toString(),
        supplyVault: KLEND_SUPPLY.toString(), feeVault: KLEND_FEE.toString(),
        availableRaw: klendAvailable.toString(),
        flashLoanFeeSf: initial.klend_reserve.klend.flashLoanFeeSf,
        feeScale: '2^60',
      },
      maximumCompatibleCombination: {
        compatibleIndependentProviderCount: 2,
        project0RouteAllocationRaw: dualRouteProject0Max.toString(),
        klendRouteAllocationRaw: klendAvailable.toString(),
        totalRouteInputRaw: dualMaximumTotal.toString(),
        project0AllocationBinaryRows: dualRouteBinaryRows,
        triSourceAttempted: false,
        triSourceBlocker: 'No third independently callable hyUSD flash-loan provider was identified in the current provider inventory.',
      },
    },
    harvestOrdering: {
      currentEpoch: initial.hylo.hylo.yield_harvest_cache.epoch,
      lstYieldToPoolRaw: cachedYieldRaw.toString(),
      borrowRateCaches: cachedBorrowRows,
      priorEpochCachedAggregateToPoolRaw: cachedAggregateHarvestRaw.toString(),
      sensitivityDepositRaw: sensitivityDepositRaw.toString(),
      sensitivity: jsonValue(observedHarvestSensitivity),
      breakEvenAggregateHarvestRaw: breakEvenHarvestRaw?.toString() || null,
      interpretation: 'Current epoch harvest calls are already gated. Replaying the current caches as a next-epoch sensitivity gives the flash depositor pro-rata harvest but remains negative after deposit rounding and the 10 bp withdrawal fee. This is a sensitivity calculation, not a claim that cached amounts can be harvested twice.',
    },
    v1Limits: {wireBytes: 4096, inlineAddresses: 64, inlineInstructions: 64},
    initial,
    totals: {
      cases: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      positiveOutsiderEquityAfterDebtAndClaims: positiveOutsiderEquity.length,
      successfulButLendersNotFullyUnwound: nonUnwoundSuccessful.length,
    },
    conclusionChecks: {
      positiveOutsiderEquityCases: positiveOutsiderEquity.map(row => row.name),
      successfulButLendersNotFullyUnwound: nonUnwoundSuccessful.map(row => row.name),
    },
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: path.basename(OUTPUT), observationSlot: output.observationSlot,
    totals: output.totals, project0AvailableRaw: project0Available.toString(),
    project0MaxRaw: project0Max.toString(),
    project0RouteMaxRaw: project0RouteMax.toString(),
    dualRouteProject0MaxRaw: dualRouteProject0Max.toString(),
    dualMaximumTotalRaw: dualMaximumTotal.toString(),
    klendAvailableRaw: klendAvailable.toString(),
    cachedAggregateHarvestRaw: cachedAggregateHarvestRaw.toString(),
    breakEvenHarvestRaw: breakEvenHarvestRaw?.toString() || null,
    successfulHyloCompositions: succeeded.filter(row => row.category.includes('hylo'))
      .map(row => ({name: row.name, bytes: row.sizeBytes, accounts: row.addressCount,
        userHyusdDelta: row.deltas.user_hyusd})),
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
