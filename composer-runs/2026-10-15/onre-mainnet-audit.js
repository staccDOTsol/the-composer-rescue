#!/usr/bin/env node
// Read-only current-mainnet OnRe audit harness. It never signs or submits a transaction.
// It emits Solana v1 messages and uses simulateTransaction with sigVerify=false.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {createRequire} = require('module');
const DIR = __dirname;
const requireAudit = createRequire(path.join(DIR, 'onre-harness', 'package.json'));
const anchor = requireAudit('@coral-xyz/anchor');
const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} = requireAudit('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} = requireAudit('@solana/spl-token');
const bs58Module = requireAudit('bs58');
const bs58 = bs58Module.default || bs58Module;

const OUTPUT = process.env.ONRE_MAINNET_OUTPUT || `${DIR}/onre-mainnet-audit.json`;
const ELF_OUTPUT = process.env.ONRE_ELF_OUTPUT || `${DIR}/onre-current.so`;
const LOCAL_BUILD = `${DIR}/onre-source/target/deploy-audit/onreapp.so`;
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const env = fs.existsSync(ENV_PATH) ? Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC_URL) throw new Error('read-only RPC unavailable');

const conn = new Connection(RPC_URL, 'confirmed');
const P = value => value instanceof PublicKey ? value : new PublicKey(value);
const ONRE = P('onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const UPGRADEABLE_LOADER = P('BPFLoaderUpgradeab1e11111111111111111111111');
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const ONYC = P('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5');

// An ordinary on-curve system account observed owning a funded canonical USDG ATA.
// No private key is present or needed: simulations disable signature verification.
const USER = P('C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo');
const USER_USDG = P('8T8DLKDtoMUKNgCdY9b7USDGJaP6RVYP6QmRgCKLtyxR');
const BOSS = P('45YnzauhsBM8CpUz96Djf8UG5vqq2Dua62wuW9H3jaJ5');
const WORKER = P('authVN3SAsujqwYq66mMhnCYV1YQnvbZjJFFhPExkrT');
const STATE = P('EL5qwcpKyc2FuQxjWmVLEwpcb4LXXwwWWjMYjf1yi3to');
const USDG_OFFER = P('8w1BAUUn6RbAtU3BuCUNXzHR7cxNyNga9pJLQYgpXJU');
const MAIN_OFFER = P('E88zkA9Pxb1i8EfSHrEW5ZUe6hiQbo8DHWQ3WhDFw7p6');
const USDG_REDEMPTION_OFFER = P('H1EHA35ZuZq5vPtSRjyE7XdHqXCbi15A9CBHdgqYo3Xc');
const USDG_PROP_AMM_PAIR = P('4xYJH6Yf3bTPmsVoqi9rfBCSVyiwSkU1VMMcE6LE86oG');
const BUFFER_STATE = P('DHzS7xFhj6zkkxE5BGofapwYwiRjHUT2NP8ALWYKAw5c');
const MARKET_STATS = P('BuPMet2URHuTVKSHpj32AjsXxHgdsqeA1i82dr1b4Mi5');
const EXCLUDED_BALANCE = P('657AQTHcmBcr7mu4r3ft7HVd6VsgGdkMBX9AUppsWrB3');
const PROP_AMM_PROCEEDS_VAULT = P('GmMw4S4JBAkFq1Y5jnu9Q2zEQnWq5n5q5b2bU9GP3PzS');
const PROP_AMM_SELL_FEE_VAULT = P('FLXr1zARDg4CYmYiH4JnAcN9UP3P4s56JBvUyYrPUqhA');
const MANAGEMENT_FEE_VAULT = P('CnR5r2zSsqFTzLk8rSQcvd8yDeEvsTYmPoVr8GZdx9XS');
const PERFORMANCE_FEE_VAULT = P('2kcYyWiEnGnqFJyJNsYy2HzhVYh431Lp8GQxfCCpa7td');
const OFFER_PROCEEDS_VAULT = P('94zax2Cbub2sKkLksfHmmhF1SMkeh5RFhu9dWs8nALjh');
const REDEMPTION_FEE_VAULT = P('FRxHpVCB6kpWf5dZjc7Ya6BywyC4Pa9zTXmvriiemqeW');

const idl = JSON.parse(fs.readFileSync(`${DIR}/onre-source/target/idl/onreapp.json`));
const klendIdl = JSON.parse(fs.readFileSync(`${DIR}/marginfi-source/idls-complete/kamino_lending.json`));
const onreCoder = new anchor.BorshAccountsCoder(idl);
const klendCoder = new anchor.BorshAccountsCoder(klendIdl);
const crosswalk = JSON.parse(fs.readFileSync(`${DIR}/mainnet-token-authority-flash-crosswalk.json`));
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const u64 = value => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const pda = (...seeds) => PublicKey.findProgramAddressSync(
  seeds.map(seed => Buffer.isBuffer(seed) ? seed : Buffer.from(seed)), ONRE)[0];
const ata = (mint, authority, tokenProgram) => getAssociatedTokenAddressSync(
  mint, authority, !PublicKey.isOnCurve(authority.toBytes()), tokenProgram);
const VAULT_AUTHORITY = pda('offer_vault_authority');
const REDEMPTION_AUTHORITY = pda('redemption_offer_vault_authority');
const PERMISSIONLESS_AUTHORITY = pda('permissionless-1');
const MINT_AUTHORITY = pda('mint_authority');
const RESERVE_VAULT_AUTHORITY = pda('reserve_vault_authority');
const USER_ONYC = ata(ONYC, USER, TOKEN_PROGRAM_ID);
const USDG_REDEMPTION_VAULT = ata(USDG, REDEMPTION_AUTHORITY, TOKEN_2022_PROGRAM_ID);
const ONYC_REDEMPTION_VAULT = ata(ONYC, REDEMPTION_AUTHORITY, TOKEN_PROGRAM_ID);
const USDG_OFFER_VAULT = ata(USDG, VAULT_AUTHORITY, TOKEN_2022_PROGRAM_ID);
const REQUEST_ID = 'onre-audit-2026-10-15-0000000000';
if (Buffer.byteLength(REQUEST_ID) !== 32) throw new Error('redemption request id must be 32 bytes');
const REDEMPTION_REQUEST = pda('redemption_request', USDG_REDEMPTION_OFFER.toBuffer(),
  USER.toBuffer(), Buffer.from(REQUEST_ID));

const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
function anchorString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  if (v0.addressTableLookups.length) throw new Error('v1 does not use address lookup tables');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64)
    throw new Error(`v1 key/instruction limit ${keys.length}/${items.length}`);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535)
      throw new Error('v1 instruction length exceeds encoding');
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
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map(key => key.toBuffer()),
    config,
    ...heads,
    ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 wire size ${wire.length}`);
  return {wire, sizeBytes: wire.length, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures,
    computeLimit, dataLimit};
}

function takeOfferPermissionless(amount, mutations = {}) {
  const keys = [
    [USDG_OFFER, false, true],
    [STATE, false, false],
    [BOSS, false, false],
    [VAULT_AUTHORITY, false, false],
    [ata(USDG, VAULT_AUTHORITY, TOKEN_2022_PROGRAM_ID), false, true],
    [ata(ONYC, VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true],
    [PERMISSIONLESS_AUTHORITY, false, false],
    [ata(USDG, PERMISSIONLESS_AUTHORITY, TOKEN_2022_PROGRAM_ID), false, true],
    [ata(ONYC, PERMISSIONLESS_AUTHORITY, TOKEN_PROGRAM_ID), false, true],
    [USDG, false, true],
    [TOKEN_2022_PROGRAM_ID, false, false],
    [ONYC, false, true],
    [TOKEN_PROGRAM_ID, false, false],
    [USER_USDG, false, true],
    [USER_ONYC, false, true],
    [ata(USDG, BOSS, TOKEN_2022_PROGRAM_ID), false, true],
    [MINT_AUTHORITY, false, false],
    [SYSVAR_INSTRUCTIONS_PUBKEY, false, false],
    [USER, true, true],
    [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
    [SystemProgram.programId, false, false],
  ].map(([pubkey, isSigner, isWritable]) => ({pubkey, isSigner, isWritable}));
  for (const [index, pubkey] of Object.entries(mutations)) keys[Number(index)].pubkey = P(pubkey);
  return new TransactionInstruction({programId: ONRE, keys,
    data: Buffer.concat([
      Buffer.from([37, 190, 224, 77, 197, 39, 203, 230]), u64(amount), Buffer.from([0]),
    ])});
}

function openSwapSell(amount, mutations = {}) {
  const keys = [
    [USDG_OFFER, false, false],
    [USDG_PROP_AMM_PAIR, false, true],
    [USDG_REDEMPTION_OFFER, false, false],
    [STATE, false, false],
    [VAULT_AUTHORITY, false, false],
    [REDEMPTION_AUTHORITY, false, false],
    [ata(ONYC, REDEMPTION_AUTHORITY, TOKEN_PROGRAM_ID), false, true],
    [USDG_REDEMPTION_VAULT, false, true],
    [ONYC, false, true],
    [TOKEN_PROGRAM_ID, false, false],
    [USDG, false, true],
    [TOKEN_2022_PROGRAM_ID, false, false],
    [USER_ONYC, false, true],
    [USER_USDG, false, true],
    [PROP_AMM_PROCEEDS_VAULT, false, true],
    [ata(ONYC, PROP_AMM_PROCEEDS_VAULT, TOKEN_PROGRAM_ID), false, true],
    [PROP_AMM_SELL_FEE_VAULT, false, true],
    [ata(ONYC, PROP_AMM_SELL_FEE_VAULT, TOKEN_PROGRAM_ID), false, true],
    [MINT_AUTHORITY, false, false],
    [BUFFER_STATE, false, true],
    [ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true],
    [ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), false, true],
    [ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), false, true],
    [MARKET_STATS, false, true],
    [EXCLUDED_BALANCE, false, false],
    [SYSVAR_INSTRUCTIONS_PUBKEY, false, false],
    [USER, true, true],
    [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
    [SystemProgram.programId, false, false],
    [MAIN_OFFER, false, false],
    [ata(ONYC, VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, false],
  ].map(([pubkey, isSigner, isWritable]) => ({pubkey, isSigner, isWritable}));
  for (const [index, pubkey] of Object.entries(mutations)) keys[Number(index)].pubkey = P(pubkey);
  return new TransactionInstruction({programId: ONRE, keys,
    data: Buffer.concat([
      Buffer.from([93, 206, 188, 72, 45, 138, 181, 71]), u64(amount), u64(0),
    ])});
}

function offerVaultDeposit(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(STATE), meta(VAULT_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
    meta(USDG_OFFER_VAULT, false, true), meta(USER, true, true), meta(TOKEN_2022_PROGRAM_ID),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], data: Buffer.concat([
    Buffer.from([69, 131, 100, 85, 82, 151, 72, 74]), u64(amount),
  ])});
}

function offerVaultWithdraw(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(VAULT_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
    meta(USDG_OFFER_VAULT, false, true), meta(USER, true, true), meta(STATE),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], data: Buffer.concat([
    Buffer.from([230, 135, 129, 48, 138, 202, 20, 72]), u64(amount),
  ])});
}

function redemptionVaultDeposit(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(REDEMPTION_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
    meta(USDG_REDEMPTION_VAULT, false, true), meta(USER, true, true), meta(STATE),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], data: Buffer.concat([
    Buffer.from([67, 104, 107, 131, 141, 2, 140, 122]), u64(amount),
  ])});
}

function redemptionVaultWithdraw(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(REDEMPTION_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
    meta(USDG_REDEMPTION_VAULT, false, true), meta(USER, true, true), meta(STATE),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], data: Buffer.concat([
    Buffer.from([48, 214, 145, 15, 168, 122, 39, 48]), u64(amount),
  ])});
}

function createRedemptionRequest(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(STATE), meta(USDG_REDEMPTION_OFFER, false, true), meta(USDG_OFFER),
    meta(REDEMPTION_REQUEST, false, true), meta(USER, true, true), meta(REDEMPTION_AUTHORITY),
    meta(ONYC), meta(USER_ONYC, false, true), meta(ONYC_REDEMPTION_VAULT, false, true),
    meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
  ], data: Buffer.concat([
    Buffer.from([201, 53, 181, 254, 115, 137, 70, 151]), u64(amount), anchorString(REQUEST_ID),
  ])});
}

function cancelRedemptionRequest() {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(STATE), meta(USDG_REDEMPTION_OFFER, false, true), meta(REDEMPTION_REQUEST, false, true),
    meta(USER, true, true), meta(USER), meta(WORKER, false, true), meta(REDEMPTION_AUTHORITY),
    meta(ONYC), meta(ONYC_REDEMPTION_VAULT, false, true), meta(USER_ONYC, false, true),
    meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(ASSOCIATED_TOKEN_PROGRAM_ID),
  ], data: Buffer.from([77, 155, 4, 179, 114, 233, 162, 45])});
}

// Deliberately supplies the outsider as `worker`; the current binary must reject it.
function fulfillRedemptionRequestAsOutsider(amount) {
  return new TransactionInstruction({programId: ONRE, keys: [
    meta(STATE), meta(USDG_OFFER), meta(USDG_REDEMPTION_OFFER, false, true),
    meta(REDEMPTION_REQUEST, false, true), meta(REDEMPTION_AUTHORITY),
    meta(ONYC_REDEMPTION_VAULT, false, true), meta(USDG_REDEMPTION_VAULT, false, true),
    meta(ONYC, false, true), meta(TOKEN_PROGRAM_ID), meta(USDG, false, true),
    meta(TOKEN_2022_PROGRAM_ID), meta(USER_USDG, false, true),
    meta(OFFER_PROCEEDS_VAULT, false, true),
    meta(ata(ONYC, OFFER_PROCEEDS_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(REDEMPTION_FEE_VAULT, false, true),
    meta(ata(ONYC, REDEMPTION_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(MINT_AUTHORITY), meta(USER), meta(USER, true, true),
    meta(BUFFER_STATE, false, true),
    meta(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(VAULT_AUTHORITY),
    meta(ata(ONYC, VAULT_AUTHORITY, TOKEN_PROGRAM_ID)), meta(MARKET_STATS, false, true),
    meta(EXCLUDED_BALANCE), meta(MAIN_OFFER),
  ], data: Buffer.concat([
    Buffer.from([140, 124, 139, 242, 179, 153, 208, 66]), u64(amount),
  ])});
}

function flashIx(kind, reserveAddress, reserve, userToken, amount, borrowIndex) {
  const lendingMarket = P(reserve.lending_market);
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), lendingMarket.toBuffer()], KLEND);
  const data = Buffer.concat([
    Buffer.from(kind === 'borrow'
      ? [135, 231, 52, 167, 7, 52, 212, 193]
      : [185, 117, 0, 203, 96, 245, 180, 186]),
    u64(amount),
    ...(kind === 'repay' ? [Buffer.from([borrowIndex])] : []),
  ]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    {pubkey: USER, isSigner: true, isWritable: false},
    {pubkey: marketAuthority, isSigner: false, isWritable: false},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
    {pubkey: reserveAddress, isSigner: false, isWritable: true},
    {pubkey: P(reserve.liquidity.mint_pubkey), isSigner: false, isWritable: false},
    {pubkey: P(reserve.liquidity.supply_vault), isSigner: false, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: P(reserve.liquidity.fee_vault), isSigner: false, isWritable: true},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function tokenAmount(data) {
  return data.length >= 72 ? data.readBigUInt64LE(64) : null;
}

function accountView(address, account) {
  if (!account) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = account.owner?.toBase58?.() || account.owner;
  const isToken = owner === TOKEN_PROGRAM_ID.toBase58() || owner === TOKEN_2022_PROGRAM_ID.toBase58();
  const isMint = address.equals(USDG) || address.equals(ONYC);
  return {
    lamports: account.lamports,
    owner,
    dataLength: data.length,
    tokenAmount: isToken && !isMint && data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
    mintSupply: isToken && isMint && data.length >= 44 ? data.readBigUInt64LE(36).toString() : null,
    sha256: sha256(data),
  };
}

async function currentViews(addresses) {
  const infos = await conn.getMultipleAccountsInfo(addresses, 'confirmed');
  return Object.fromEntries(addresses.map((address, i) =>
    [address.toBase58(), accountView(address, infos[i])]));
}

async function simulate(label, instructions, watched, blockhash) {
  const pre = await currentViews(watched);
  const encoded = encodeV1(instructions, USER, blockhash);
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const value = response.value;
  const post = Object.fromEntries(watched.map((address, i) =>
    [address.toBase58(), accountView(address, value.accounts?.[i])]));
  const deltas = {};
  for (const address of watched) {
    const key = address.toBase58();
    const before = pre[key];
    const after = post[key];
    if (before?.tokenAmount !== null && after?.tokenAmount !== null &&
        before?.tokenAmount !== undefined && after?.tokenAmount !== undefined) {
      deltas[key] = {tokenAmount: (BigInt(after.tokenAmount) - BigInt(before.tokenAmount)).toString()};
    } else if (before?.mintSupply !== null && after?.mintSupply !== null &&
        before?.mintSupply !== undefined && after?.mintSupply !== undefined) {
      deltas[key] = {mintSupply: (BigInt(after.mintSupply) - BigInt(before.mintSupply)).toString()};
    } else if (before && after) {
      deltas[key] = {lamports: String(after.lamports - before.lamports)};
    } else if (!before && after) {
      deltas[key] = {created: true, lamports: String(after.lamports),
        tokenAmount: after.tokenAmount};
    } else if (before && !after) {
      deltas[key] = {closed: true, recoveredLamports: String(before.lamports),
        preTokenAmount: before.tokenAmount};
    }
  }
  return {
    label,
    slot: response.context?.slot ?? null,
    err: value.err,
    v1: {
      versionPrefix: encoded.wire[0],
      sizeBytes: encoded.sizeBytes,
      maximumBytes: 4096,
      accountCount: encoded.addressCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      computeLimit: encoded.computeLimit,
      loadedAccountsDataLimit: encoded.dataLimit,
      sha256: sha256(encoded.wire),
      base64: encoded.wire.toString('base64'),
    },
    unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    pre,
    post,
    deltas,
    logs: value.logs || [],
    innerInstructions: value.innerInstructions || null,
  };
}

async function simulateEncoded(encoded, watched) {
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  return {
    contextSlot: response.context?.slot ?? null,
    err: response.value.err,
    accounts: Object.fromEntries(watched.map((address, i) =>
      [address.toBase58(), accountView(address, response.value.accounts?.[i])])),
    _rawAccounts: Object.fromEntries(watched.map((address, i) =>
      [address.toBase58(), response.value.accounts?.[i]?.data?.[0] || null])),
    logs: response.value.logs || [],
    unitsConsumed: response.value.unitsConsumed,
  };
}

async function sameSlotDifferential(
  label, baselineInstructions, treatmentInstructions, watched, blockhash,
) {
  // The baseline performs the identical zero-fee KLend flash borrow/repay. This
  // makes reserve refresh/accrual bookkeeping identical and isolates OnRe's effect.
  const baselineV1 = encodeV1(baselineInstructions, USER, blockhash);
  const treatmentV1 = encodeV1(treatmentInstructions, USER, blockhash);
  let pair = null;
  for (let attempt = 1; attempt <= 12; attempt++) {
    const [baseline, treatment] = await Promise.all([
      simulateEncoded(baselineV1, watched), simulateEncoded(treatmentV1, watched),
    ]);
    pair = {attempt, baseline, treatment};
    if (baseline.contextSlot === treatment.contextSlot) break;
  }
  const sameSlot = pair.baseline.contextSlot === pair.treatment.contextSlot;
  const deltas = {};
  if (sameSlot) {
    for (const address of watched) {
      const key = address.toBase58();
      const before = pair.baseline.accounts[key];
      const after = pair.treatment.accounts[key];
      deltas[key] = {
        tokenAmountRaw: before?.tokenAmount !== null && before?.tokenAmount !== undefined &&
          after?.tokenAmount !== null && after?.tokenAmount !== undefined
          ? (BigInt(after.tokenAmount) - BigInt(before.tokenAmount)).toString() : null,
        mintSupplyRaw: before?.mintSupply !== null && before?.mintSupply !== undefined &&
          after?.mintSupply !== null && after?.mintSupply !== undefined
          ? (BigInt(after.mintSupply) - BigInt(before.mintSupply)).toString() : null,
        dataSha256Equal: before?.sha256 === after?.sha256,
      };
    }
  }
  const reserveKey = watched.find(address => address.equals(P('ESCkPWKHmgNE7Msf77n9yzqJd5kQVWWGy3o5Mgxhvavp')))?.toBase58();
  let reserveAccounting = null;
  if (sameSlot && reserveKey && pair.baseline._rawAccounts[reserveKey] &&
      pair.treatment._rawAccounts[reserveKey]) {
    const decodeAccounting = encoded => {
      const reserve = klendCoder.decode('Reserve', Buffer.from(encoded, 'base64'));
      return {
        totalAvailableRaw: reserve.liquidity.total_available_amount.toString(),
        borrowedAmountSf: reserve.liquidity.borrowed_amount_sf.toString(),
        accumulatedProtocolFeesSf: reserve.liquidity.accumulated_protocol_fees_sf.toString(),
        accumulatedReferrerFeesSf: reserve.liquidity.accumulated_referrer_fees_sf.toString(),
        pendingReferrerFeesSf: reserve.liquidity.pending_referrer_fees_sf.toString(),
        lastUpdateSlot: reserve.last_update.slot.toString(),
        lastUpdateTimestamp: String(reserve.last_update.timestamp),
      };
    };
    const baselineAccounting = decodeAccounting(pair.baseline._rawAccounts[reserveKey]);
    const treatmentAccounting = decodeAccounting(pair.treatment._rawAccounts[reserveKey]);
    reserveAccounting = {
      baseline: baselineAccounting,
      treatment: treatmentAccounting,
      economicFieldsEqual: ['totalAvailableRaw', 'borrowedAmountSf', 'accumulatedProtocolFeesSf',
        'accumulatedReferrerFeesSf', 'pendingReferrerFeesSf'].every(field =>
        baselineAccounting[field] === treatmentAccounting[field]),
    };
  }
  const {_rawAccounts: baselineRaw, ...baselinePublic} = pair.baseline;
  const {_rawAccounts: treatmentRaw, ...treatmentPublic} = pair.treatment;
  return {
    label,
    sameSlot,
    attempts: pair.attempt,
    slot: sameSlot ? pair.baseline.contextSlot : null,
    baselineErr: pair.baseline.err,
    treatmentErr: pair.treatment.err,
    treatmentRepayLogged: pair.treatment.logs.includes(
      'Program log: Instruction: FlashRepayReserveLiquidity'),
    deltas,
    reserveAccounting,
    baselineV1: {sizeBytes: baselineV1.sizeBytes, sha256: sha256(baselineV1.wire),
      base64: baselineV1.wire.toString('base64')},
    treatmentV1: {sizeBytes: treatmentV1.sizeBytes, sha256: sha256(treatmentV1.wire),
      base64: treatmentV1.wire.toString('base64')},
    baseline: baselinePublic,
    treatment: treatmentPublic,
  };
}

function parseBuy(result) {
  const line = result.logs.find(log => log.includes('Offer taken (permissionless)'));
  if (!line) return null;
  const output = line.match(/token_out: (\d+)/);
  const price = line.match(/price: (\d+)\.(\d+)/);
  return {
    tokenOutRaw: output ? output[1] : null,
    priceRaw: price ? (price[1] + price[2].padEnd(9, '0').slice(0, 9)) : null,
    log: line,
  };
}

function parseSell(result) {
  const line = result.logs.find(log => log.includes('Open swap sell - offer:'));
  if (!line) return null;
  const values = line.match(/token_in\(\+fee\): (\d+)\(\+(\d+)\), token_out: (\d+)/);
  if (!values) return {log: line};
  return {
    tokenInAfterFeeRaw: values[1],
    feeOnycRaw: values[2],
    tokenOutUsdgRaw: values[3],
    log: line,
  };
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function buyOut(amount, priceRaw) {
  return BigInt(amount) * 10n ** 18n / (BigInt(priceRaw) * 10n ** 6n);
}

const hexBnToDecimal = value => BigInt(`0x${value || '0'}`).toString();
function summarizeLiveConfiguration(accounts) {
  const byAddress = address => accounts.decoded.find(row => row.address === address)?.data;
  const state = byAddress(STATE.toBase58());
  const offer = byAddress(USDG_OFFER.toBase58());
  const redemption = byAddress(USDG_REDEMPTION_OFFER.toBase58());
  const pair = byAddress(USDG_PROP_AMM_PAIR.toBase58());
  const activeVector = offer.vectors.filter(vector => vector.start_time !== '00')
    .sort((a, b) => BigInt(`0x${a.start_time}`) > BigInt(`0x${b.start_time}`) ? -1 : 1)[0];
  return {
    state: {
      boss: state.boss,
      worker: state.worker,
      isKilled: state.is_killed,
      onycMint: state.onyc_mint,
      mainOffer: state.main_offer,
      maxSupplyRaw: hexBnToDecimal(state.max_supply),
      maxMintAmountRaw: hexBnToDecimal(state.max_mint_amount),
    },
    usdGOffer: {
      address: USDG_OFFER.toBase58(),
      tokenInMint: offer.token_in_mint,
      tokenOutMint: offer.token_out_mint,
      feeBps: offer.fee_basis_points,
      permissionlessFeeBps: offer.fee_basis_points_permissionless,
      needsApproval: Boolean(offer.needs_approval),
      allowPermissionless: Boolean(offer.allow_permissionless),
      disabled: Boolean(offer.disabled),
      activeVector: {
        startTimeUnix: hexBnToDecimal(activeVector.start_time),
        baseTimeUnix: hexBnToDecimal(activeVector.base_time),
        basePriceRaw: hexBnToDecimal(activeVector.base_price),
        aprScale6: hexBnToDecimal(activeVector.apr),
        priceFixDurationSeconds: hexBnToDecimal(activeVector.price_fix_duration),
      },
      priceAuthority: 'Solana Clock sysvar plus boss-authored on-chain Offer vectors; no caller oracle account',
    },
    usdGRedemption: {
      address: USDG_REDEMPTION_OFFER.toBase58(),
      requestFeeBps: redemption.fee_basis_points,
      propAmmSellFeeBps: redemption.fee_basis_points_prop_amm_sell,
      vaultTargetBps: redemption.vault_target_bps,
      disabled: Boolean(redemption.disabled),
      requestedRedemptionsOnycRaw: hexBnToDecimal(redemption.requested_redemptions),
    },
    usdGPropAmm: {
      address: USDG_PROP_AMM_PAIR.toBase58(),
      enabled: pair.enabled,
      curvePegHaircutBps: pair.curve_peg_haircut_bps,
      curveExponentScaled: pair.curve_exponent_scaled,
      minimumSellHaircutOnycRaw: hexBnToDecimal(pair.minimum_sell_haircut_onyc),
      epochDurationSeconds: hexBnToDecimal(pair.epoch_duration_seconds),
    },
  };
}

async function loadProgram() {
  const programResult = await rpc('getAccountInfo', [ONRE.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const programData = Buffer.from(programResult.value.data[0], 'base64');
  if (!P(programResult.value.owner).equals(UPGRADEABLE_LOADER) || programData.readUInt32LE(0) !== 2)
    throw new Error('OnRe is not an Upgradeable Loader Program account');
  const programDataAddress = new PublicKey(programData.subarray(4, 36));
  const result = await rpc('getAccountInfo', [programDataAddress.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const raw = Buffer.from(result.value.data[0], 'base64');
  if (raw.readUInt32LE(0) !== 3) throw new Error('OnRe ProgramData layout mismatch');
  const deploySlot = raw.readBigUInt64LE(4);
  const option = raw[12];
  const metadataBytes = option === 1 ? 45 : 13;
  const upgradeAuthority = option === 1 ? new PublicKey(raw.subarray(13, 45)).toBase58() : null;
  const elf = raw.subarray(metadataBytes);
  fs.writeFileSync(ELF_OUTPUT, elf);
  const localBuild = fs.existsSync(LOCAL_BUILD) ? fs.readFileSync(LOCAL_BUILD) : null;
  return {
    programId: ONRE.toBase58(),
    programDataAddress: programDataAddress.toBase58(),
    observationSlot: result.context.slot,
    deploySlot: deploySlot.toString(),
    upgradeAuthority,
    executable: programResult.value.executable,
    loader: programResult.value.owner,
    elfPath: ELF_OUTPUT,
    elfBytes: elf.length,
    elfSha256: sha256(elf),
    embeddedSecurityTxtOfficialSource:
      elf.includes(Buffer.from('https://github.com/onre-finance/onre-sol')),
    embeddedReviewedModulePaths: [
      'programs/onreapp/src/instructions/offer/take_offer_permissionless.rs',
      'programs/onreapp/src/instructions/prop_amm/sell.rs',
      'programs/onreapp/src/instructions/redemption/fulfill_redemption_request.rs',
    ].filter(value => elf.includes(Buffer.from(value))),
    localOfficialSourceBuild: localBuild ? {
      path: LOCAL_BUILD,
      bytes: localBuild.length,
      sha256: sha256(localBuild),
      byteForByteMatch: localBuild.equals(elf),
      limitation: localBuild.equals(elf) ? null :
        'A local build with the installed SBF toolchain is not a reproducible-build attestation; a hash mismatch does not prove source divergence.',
    } : {
      path: LOCAL_BUILD,
      available: false,
      limitation: 'Local source build had not completed when the harness ran.',
    },
  };
}

async function loadOnreAccounts() {
  const result = await rpc('getProgramAccounts', [ONRE.toBase58(),
    {encoding: 'base64', commitment: 'confirmed', withContext: true}]);
  const decoded = [];
  const unknown = [];
  for (const row of result.value) {
    const data = Buffer.from(row.account.data[0], 'base64');
    const accountType = idl.accounts.find(type =>
      Buffer.from(type.discriminator).equals(data.subarray(0, 8)));
    if (!accountType) {
      unknown.push({address: row.pubkey, dataLength: data.length, sha256: sha256(data)});
      continue;
    }
    const value = onreCoder.decode(accountType.name, data);
    const json = JSON.parse(JSON.stringify(value, (_key, item) =>
      item instanceof PublicKey ? item.toBase58() : item));
    decoded.push({address: row.pubkey, type: accountType.name,
      lamports: row.account.lamports, dataLength: data.length, data: json});
  }
  return {slot: result.context.slot, decoded, unknown};
}

async function loadKlendInventory() {
  const target = crosswalk.targets.find(row => row.programId === ONRE.toBase58());
  const rows = target.assets.flatMap(asset => asset.liveInventory)
    .filter(row => row.provider === 'Kamino Lend');
  const infos = await conn.getMultipleAccountsInfo(rows.map(row => P(row.reserve)), 'confirmed');
  const inventory = rows.map((row, index) => {
    const reserve = klendCoder.decode('Reserve', infos[index].data);
    return {
      address: row.reserve,
      market: P(reserve.lending_market).toBase58(),
      mint: P(reserve.liquidity.mint_pubkey).toBase58(),
      supplyVault: P(reserve.liquidity.supply_vault).toBase58(),
      feeVault: P(reserve.liquidity.fee_vault).toBase58(),
      availableRaw: reserve.liquidity.total_available_amount.toString(),
      flashLoanFeeSf: reserve.config.fees.flash_loan_fee_sf.toString(),
      decoded: reserve,
    };
  });
  const zeroFee = inventory.filter(row => row.flashLoanFeeSf === '0' && row.mint === USDG.toBase58());
  zeroFee.sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1);
  return {
    inventory: inventory.map(({decoded, ...row}) => row),
    aggregateZeroFeeAvailableRaw: zeroFee.reduce((sum, row) => sum + BigInt(row.availableRaw), 0n).toString(),
    selected: zeroFee[0],
    selectedDecoded: zeroFee[0].decoded,
  };
}

async function loadProject0Inventory() {
  const target = crosswalk.targets.find(row => row.programId === ONRE.toBase58());
  const rows = target.assets.flatMap(asset => asset.liveInventory)
    .filter(row => row.provider === 'Project 0 / marginfi v1');
  const addresses = rows.map(row => P(row.vault));
  const views = await currentViews(addresses);
  const inventory = rows.map(row => ({
    provider: row.provider,
    programId: row.programId,
    bank: row.bank,
    vault: row.vault,
    currentVaultAmountRaw: views[row.vault]?.tokenAmount ?? null,
  }));
  return {
    inventory,
    aggregateCurrentVaultAmountRaw: inventory.reduce((sum, row) =>
      sum + BigInt(row.currentVaultAmountRaw || '0'), 0n).toString(),
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const program = await loadProgram();
  const accounts = await loadOnreAccounts();
  const liveConfiguration = summarizeLiveConfiguration(accounts);
  const klend = await loadKlendInventory();
  const project0 = await loadProject0Inventory();
  const selectedReserve = P(klend.selected.address);
  const selectedAvailable = BigInt(klend.selected.availableRaw);
  const nearInventoryAmount = selectedAvailable * 99n / 100n;
  const supplyVault = P(klend.selected.supplyVault);
  const feeVault = P(klend.selected.feeVault);
  // simulateTransaction's account-return extension accepts at most ten addresses.
  const commonWatched = [USER_USDG, USER_ONYC, USDG, ONYC,
    USDG_REDEMPTION_VAULT, ONYC_REDEMPTION_VAULT, USDG_OFFER_VAULT,
    REDEMPTION_REQUEST, supplyVault, feeVault];
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const cases = [];

  cases.push(await simulate('outsider_buy_dust_1_raw_usdg',
    [takeOfferPermissionless(1n)], commonWatched, blockhash));
  const buyControl = await simulate('outsider_buy_positive_control_1_usdg',
    [takeOfferPermissionless(1_000_000n)], commonWatched, blockhash);
  cases.push(buyControl);
  const parsed = parseBuy(buyControl);
  if (!parsed?.priceRaw) throw new Error('unable to recover current OnRe buy price from positive control');
  const priceRaw = BigInt(parsed.priceRaw);

  cases.push(await simulate('outsider_offer_vault_deposit_1_raw_usdg',
    [offerVaultDeposit(1n)], commonWatched, blockhash));
  cases.push(await simulate('outsider_offer_vault_withdraw_rejected',
    [offerVaultWithdraw(1n)], commonWatched, blockhash));
  cases.push(await simulate('outsider_redemption_vault_deposit_1_raw_usdg',
    [redemptionVaultDeposit(1n)], commonWatched, blockhash));
  cases.push(await simulate('outsider_redemption_vault_withdraw_rejected',
    [redemptionVaultWithdraw(1n)], commonWatched, blockhash));

  const flashPair = amount => {
    const borrow = flashIx('borrow', selectedReserve, klend.selectedDecoded, USER_USDG, amount);
    const repay = flashIx('repay', selectedReserve, klend.selectedDecoded, USER_USDG, amount, 0);
    return [borrow, repay];
  };
  cases.push(await simulate('klend_usdg_zero_fee_flash_pair_1_raw',
    flashPair(1n), commonWatched, blockhash));
  cases.push(await simulate('klend_usdg_zero_fee_flash_pair_1_usdg',
    flashPair(1_000_000n), commonWatched, blockhash));
  cases.push(await simulate('klend_usdg_zero_fee_flash_pair_99pct_inventory',
    flashPair(nearInventoryAmount), commonWatched, blockhash));

  const minimumSellFeeOnyc = 1_000_000_000n;
  // Leave enough post-fee ONyc for roughly 0.001 USDG before dampening.
  const dustTargetOut = minimumSellFeeOnyc + ceilDiv(1_000n * 10n ** 12n, priceRaw);
  const dustCycleInput = ceilDiv(dustTargetOut * priceRaw * 10n ** 6n, 10n ** 18n);
  const cycleInstructions = amount => {
    const onycAmount = buyOut(amount, priceRaw);
    return [
      flashIx('borrow', selectedReserve, klend.selectedDecoded, USER_USDG, amount),
      takeOfferPermissionless(amount),
      openSwapSell(onycAmount),
      createCloseAccountInstruction(USER_ONYC, USER, USER, [], TOKEN_PROGRAM_ID),
      flashIx('repay', selectedReserve, klend.selectedDecoded, USER_USDG, amount, 0),
    ];
  };
  const cycleAmounts = [dustCycleInput, 2_000_000n, 1_000_000_000n, nearInventoryAmount];
  for (const amount of cycleAmounts) {
    cases.push(await simulate(`klend_onre_buy_sell_repay_${amount}`,
      cycleInstructions(amount), commonWatched, blockhash));
  }

  const sameSlot = await sameSlotDifferential(
    'klend_onre_buy_sell_repay_1000000000_vs_equal_flash_pair',
    flashPair(1_000_000_000n),
    cycleInstructions(1_000_000_000n),
    [USER_USDG, supplyVault, feeVault, selectedReserve, USER_ONYC, REDEMPTION_REQUEST],
    blockhash);

  const claimAmount = 2_000_000n;
  const claimOnycAmount = buyOut(claimAmount, priceRaw);
  cases.push(await simulate(`klend_onre_claim_create_cancel_sell_repay_${claimAmount}`,
    [
      flashIx('borrow', selectedReserve, klend.selectedDecoded, USER_USDG, claimAmount),
      takeOfferPermissionless(claimAmount),
      createRedemptionRequest(claimOnycAmount),
      cancelRedemptionRequest(),
      openSwapSell(claimOnycAmount),
      createCloseAccountInstruction(USER_ONYC, USER, USER, [], TOKEN_PROGRAM_ID),
      flashIx('repay', selectedReserve, klend.selectedDecoded, USER_USDG, claimAmount, 0),
    ], commonWatched, blockhash));

  cases.push(await simulate('claim_fulfill_rejects_outsider_worker',
    [takeOfferPermissionless(claimAmount), createRedemptionRequest(claimOnycAmount),
      fulfillRedemptionRequestAsOutsider(1n)], commonWatched, blockhash));

  const twoUsdOut = buyOut(2_000_000n, priceRaw);
  cases.push(await simulate('atomic_order_sell_before_buy',
    [openSwapSell(twoUsdOut), takeOfferPermissionless(2_000_000n)], commonWatched, blockhash));
  cases.push(await simulate('buy_rejects_substituted_boss_destination',
    [takeOfferPermissionless(1_000_000n, {15: USER_USDG})], commonWatched, blockhash));
  cases.push(await simulate('buy_rejects_substituted_permissionless_output',
    [takeOfferPermissionless(1_000_000n, {8: USER_ONYC})], commonWatched, blockhash));
  cases.push(await simulate('buy_rejects_substituted_input_token_program',
    [takeOfferPermissionless(1_000_000n, {10: TOKEN_PROGRAM_ID})], commonWatched, blockhash));
  cases.push(await simulate('sell_rejects_substituted_redemption_usdg_vault',
    [takeOfferPermissionless(2_000_000n), openSwapSell(twoUsdOut, {7: USER_USDG})],
    commonWatched, blockhash));
  cases.push(await simulate('sell_rejects_substituted_market_stats',
    [takeOfferPermissionless(2_000_000n), openSwapSell(twoUsdOut, {23: USER_USDG})],
    commonWatched, blockhash));

  const summaryCases = cases.map(result => {
    const cycleMatch = result.label.match(/^klend_onre_(?:claim_create_cancel_sell_repay_|buy_sell_repay_)(\d+)$/);
    const sell = parseSell(result);
    const borrowedRaw = cycleMatch ? cycleMatch[1] : null;
    const economicNetUsdgRaw = sell?.tokenOutUsdgRaw && borrowedRaw
      ? (BigInt(sell.tokenOutUsdgRaw) - BigInt(borrowedRaw)).toString() : null;
    const repayConfirmedByAtomicSuccess = Boolean(cycleMatch && result.err === null &&
      result.logs.includes('Program log: Instruction: FlashRepayReserveLiquidity'));
    const onycLiabilityClosed = Boolean(cycleMatch && result.err === null);
    const postRequest = result.post[REDEMPTION_REQUEST.toBase58()];
    const requestClosed = postRequest === null || (postRequest?.owner === SystemProgram.programId.toBase58() &&
      postRequest?.lamports === 0 && postRequest?.dataLength === 0);
    const claimLiabilityClosed = !result.label.includes('claim_create_cancel') || Boolean(
      result.err === null && result.logs.some(log => log.includes('Redemption request cancelled at:')) &&
      requestClosed);
    return {
      label: result.label,
      slot: result.slot,
      err: result.err,
      v1Bytes: result.v1.sizeBytes,
      accounts: result.v1.accountCount,
      instructions: result.v1.instructionCount,
      unitsConsumed: result.unitsConsumed,
      borrowedUsdgRaw: borrowedRaw,
      sell,
      economicNetUsdgRaw,
      repayConfirmedByAtomicSuccess,
      onycLiabilityClosed,
      claimLiabilityClosed,
      userUsdgSnapshotDeltaRaw: result.deltas[USER_USDG.toBase58()]?.tokenAmount ?? null,
      userOnycSnapshotDeltaRaw: result.deltas[USER_ONYC.toBase58()]?.tokenAmount ??
        (result.deltas[USER_ONYC.toBase58()]?.closed ? '0_closed' : null),
      klendSupplyCrossSlotSnapshotDeltaRaw: result.deltas[supplyVault.toBase58()]?.tokenAmount ?? null,
      klendFeeCrossSlotSnapshotDeltaRaw: result.deltas[feeVault.toBase58()]?.tokenAmount ?? null,
      redemptionVaultSnapshotDeltaRaw:
        result.deltas[USDG_REDEMPTION_VAULT.toBase58()]?.tokenAmount ?? null,
    };
  });
  const successfulCycles = summaryCases.filter(row =>
    row.borrowedUsdgRaw !== null && row.err === null);
  const positiveCycles = successfulCycles.filter(row => BigInt(row.economicNetUsdgRaw || '0') > 0n);
  const allSuccessfulCyclesFullyRepaid = successfulCycles.every(row =>
    row.repayConfirmedByAtomicSuccess);
  const allSuccessfulCyclesLiabilityFree = successfulCycles.every(row =>
    row.onycLiabilityClosed && row.claimLiabilityClosed);

  const output = {
    generatedAt,
    restrictions: {
      transport: 'current-mainnet read-only RPC and simulateTransaction only',
      signatureVerification: false,
      transactionSubmitted: false,
      operatorContacted: false,
      rpcUrlRecorded: false,
      crossSlotSnapshotCaveat: 'Pre-state RPC reads and simulated post-state may use different live slots; economic cycle results use transaction logs and atomic success, not active-reserve cross-slot deltas.',
    },
    source: {
      officialRepository: 'https://github.com/onre-finance/onre-sol',
      commit: 'c0490831f438074562ebf51e437ca5f8e027596b',
      integrationRepository: 'https://github.com/onre-finance/jup-onyc-integration',
      integrationCommit: '578ebc629c23ada9c8ab0c2b299f66967232ed03',
      idlAddress: idl.address,
    },
    program,
    pdas: {
      state: STATE.toBase58(),
      offerVaultAuthority: VAULT_AUTHORITY.toBase58(),
      redemptionVaultAuthority: REDEMPTION_AUTHORITY.toBase58(),
      permissionlessAuthority: PERMISSIONLESS_AUTHORITY.toBase58(),
      mintAuthority: MINT_AUTHORITY.toBase58(),
      usdGRedemptionVault: USDG_REDEMPTION_VAULT.toBase58(),
    },
    onreAccounts: accounts,
    liveConfiguration,
    liveLiquidity: {
      custody: await currentViews([USDG_REDEMPTION_VAULT,
        ata(ONYC, REDEMPTION_AUTHORITY, TOKEN_PROGRAM_ID),
        ata(USDG, VAULT_AUTHORITY, TOKEN_2022_PROGRAM_ID),
        ata(ONYC, VAULT_AUTHORITY, TOKEN_PROGRAM_ID)]),
      klend: {inventory: klend.inventory,
        aggregateZeroFeeAvailableRaw: klend.aggregateZeroFeeAvailableRaw,
        selected: (({decoded, ...row}) => row)(klend.selected),
        nearInventoryTestAmountRaw: nearInventoryAmount.toString()},
      project0,
    },
    pricing: {
      positiveControl: parsed,
      priceRaw: priceRaw.toString(),
      minimumSellFeeOnycRaw: minimumSellFeeOnyc.toString(),
      computedDustCycleInputUsdgRaw: dustCycleInput.toString(),
    },
    watched: commonWatched.map(String),
    sameSlotDifferential: sameSlot,
    summaryCases,
    result: {
      successfulFlashOnreCycles: successfulCycles.length,
      allSuccessfulCyclesFullyRepaid,
      allSuccessfulCyclesLiabilityFree,
      positiveOutsiderNetEquityCycles: positiveCycles.length,
      findingDemonstrated: positiveCycles.length > 0 && allSuccessfulCyclesFullyRepaid &&
        allSuccessfulCyclesLiabilityFree,
      conclusion: positiveCycles.length > 0 && allSuccessfulCyclesFullyRepaid &&
        allSuccessfulCyclesLiabilityFree
        ? 'A fully repaid positive outsider net-equity cycle was simulated.'
        : 'No fully repaid positive outsider net-equity cycle was simulated.',
    },
    cases,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, elf: program, pricing: output.pricing,
    result: output.result, cases: summaryCases}, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
