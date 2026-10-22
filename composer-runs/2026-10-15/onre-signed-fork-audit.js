#!/usr/bin/env node
'use strict';

// Signed, read-only validation of OnRe outsider candidates on a current-mainnet
// Surfpool fork. This file has no sendTransaction path. The only state writes are
// fork cheatcodes that fund deterministic attacker accounts; every candidate is
// executed by simulateTransaction with sigVerify:true and rolls back atomically.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {createRequire} = require('module');
const DIR = __dirname;
const requireAudit = createRequire(path.join(DIR, 'onre-harness', 'package.json'));
const anchor = requireAudit('@coral-xyz/anchor');
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} = requireAudit('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createCloseAccountInstruction,
} = requireAudit('@solana/spl-token');
const bs58Module = requireAudit('bs58');
const bs58 = bs58Module.default || bs58Module;

const OUTPUT = process.env.ONRE_SIGNED_OUTPUT || path.join(DIR, 'onre-signed-fork-audit.json');
const FORK = process.env.ONRE_FORK_RPC || 'http://127.0.0.1:8997';
const P = value => value instanceof PublicKey ? value : new PublicKey(value);

const ONRE = P('onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const JUP_FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const JUP_LIQUIDITY_PROGRAM = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const JUP_LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const JUP_ADMIN = P('G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn');
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const ONYC = P('5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5');
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
const P0_GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const JUP = {
  reserve: P('EcKLyKWMJAUnsv3MMGGHrjVMDm9KtuCzdz8wNV3JpGsp'),
  rateModel: P('3iKXNjuDkTRstxggkarMS81FNzxgyFgDGNQAmmEcqMEu'),
  vault: P('8DesAbtAabk7s2YdPX5P3Bs5QpHFps5H35mWuzbLYRZX'),
  position: P('956yZ1MQjnsG1H6oRQS218Ww8ne6o7VE2hYKAiv6dU7q'),
};
const P0_ROWS = [
  {bank: '6KP94PsCrBk2gPqtqT4WSvZ8Zss7r1auz3azXpv5ptrS', vault: '3daECBzxvpgcyuB6KPfUXu5HtewGVjTzQ6RwvYvA3aVQ'},
  {bank: 'B5nEYndavwuzEX1pQZUYcvfuhk1fMGgqrBrJkkEAe7iT', vault: 'GVafRPhx4DbvDDyyoVcYJQ5mxjYinmjRAYJgxtFK52th'},
  {bank: 'Dj2CwMF3GM7mMT5hcyGXKuYSQ2kQ5zaVCkA1zX1qaTva', vault: '5Euy1GJaWcF8BcZa2wbvKZq9ZU95anedL9TW416ZJNpK'},
].map(row => ({bank: P(row.bank), vault: P(row.vault)}));

const idl = JSON.parse(fs.readFileSync(path.join(DIR, 'onre-source/target/idl/onreapp.json')));
const klendIdl = JSON.parse(fs.readFileSync(path.join(DIR, 'marginfi-source/idls-complete/kamino_lending.json')));
const marginfiIdl = JSON.parse(fs.readFileSync(path.join(DIR,
  'marginfi-source/fuzz/crucible/idls/marginfi_program.json')));
const jupLiquidityIdl = JSON.parse(fs.readFileSync(path.join(DIR, 'jup6qf-onchain-idl.json')));
const jupFlashIdl = JSON.parse(fs.readFileSync(path.join(DIR, 'jup6qf-onchain-flash-idl.json')));
const crosswalk = JSON.parse(fs.readFileSync(path.join(DIR,
  'mainnet-token-authority-flash-crosswalk.json')));
const klendCoder = new anchor.BorshAccountsCoder(klendIdl);
const marginCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const jupCoder = new anchor.BorshAccountsCoder(jupLiquidityIdl);
const jupFlashCoder = new anchor.BorshAccountsCoder(jupFlashIdl);

const seedKeypair = label => Keypair.fromSeed(crypto.createHash('sha256').update(label).digest());
const ATTACKER = seedKeypair('onre-signed-fork-attacker-v1');
const MARGIN_ACCOUNT = seedKeypair('onre-signed-fork-marginfi-v1');
const USER = ATTACKER.publicKey;
const ata = (mint, authority, tokenProgram) => getAssociatedTokenAddressSync(
  mint, authority, !PublicKey.isOnCurve(authority.toBytes()), tokenProgram);
const USER_USDG = ata(USDG, USER, TOKEN_2022_PROGRAM_ID);
const USER_ONYC = ata(ONYC, USER, TOKEN_PROGRAM_ID);
const pda = (...seeds) => PublicKey.findProgramAddressSync(
  seeds.map(seed => Buffer.isBuffer(seed) ? seed : Buffer.from(seed)), ONRE)[0];
const VAULT_AUTHORITY = pda('offer_vault_authority');
const REDEMPTION_AUTHORITY = pda('redemption_offer_vault_authority');
const PERMISSIONLESS_AUTHORITY = pda('permissionless-1');
const MINT_AUTHORITY = pda('mint_authority');
const RESERVE_VAULT_AUTHORITY = pda('reserve_vault_authority');
const USDG_REDEMPTION_VAULT = ata(USDG, REDEMPTION_AUTHORITY, TOKEN_2022_PROGRAM_ID);
const ONYC_REDEMPTION_VAULT = ata(ONYC, REDEMPTION_AUTHORITY, TOKEN_PROGRAM_ID);
const USDG_OFFER_VAULT = ata(USDG, VAULT_AUTHORITY, TOKEN_2022_PROGRAM_ID);
const ONYC_OFFER_VAULT = ata(ONYC, VAULT_AUTHORITY, TOKEN_PROGRAM_ID);
const REQUEST_ID = 'onre-signed-fork-audit-000000001';
if (Buffer.byteLength(REQUEST_ID) !== 32) throw new Error(`request id length ${Buffer.byteLength(REQUEST_ID)}`);
const REDEMPTION_REQUEST = pda('redemption_request', USDG_REDEMPTION_OFFER.toBuffer(),
  USER.toBuffer(), Buffer.from(REQUEST_ID));
const CONFIG_KIND_7 = REDEMPTION_FEE_VAULT;
const CONFIG_KIND_8 = PROP_AMM_SELL_FEE_VAULT;
const CONFIG_KIND_8_DEST = P('Bf7mHyvosAXjPx41GkcXvviFHcC89PfN84mnFXH2TMR3');

const DISC = {
  take: Buffer.from([37, 190, 224, 77, 197, 39, 203, 230]),
  sell: Buffer.from([93, 206, 188, 72, 45, 138, 181, 71]),
  offerDeposit: Buffer.from([69, 131, 100, 85, 82, 151, 72, 74]),
  offerWithdraw: Buffer.from([230, 135, 129, 48, 138, 202, 20, 72]),
  redemptionDeposit: Buffer.from([67, 104, 107, 131, 141, 2, 140, 122]),
  redemptionWithdraw: Buffer.from([48, 214, 145, 15, 168, 122, 39, 48]),
  createRequest: Buffer.from([201, 53, 181, 254, 115, 137, 70, 151]),
  cancelRequest: Buffer.from([77, 155, 4, 179, 114, 233, 162, 45]),
  fulfillRequest: Buffer.from([140, 124, 139, 242, 179, 153, 208, 66]),
  mintTo: Buffer.from([241, 34, 48, 186, 37, 179, 123, 192]),
  reserveDeposit: Buffer.from([159, 91, 174, 234, 207, 12, 167, 9]),
  reserveWithdraw: Buffer.from([224, 37, 127, 12, 213, 154, 179, 98]),
  configurableWithdraw: Buffer.from([255, 81, 28, 61, 192, 180, 29, 13]),
  klendBorrow: Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]),
  klendRepay: Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]),
  p0Init: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]),
  p0Start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  p0Borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  p0Repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  p0End: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
  p0Close: Buffer.from([186, 221, 93, 34, 50, 97, 194, 241]),
  jupBorrow: Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]),
  jupRepay: Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]),
  jupRefresh: Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]),
};

let rpcId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      const body = await response.json();
      if (body.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(body.error)}`),
        {rpcError: body.error});
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw last;
}

const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
function anchorString(value) {
  const bytes = Buffer.from(value); const len = Buffer.alloc(4); len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000,
  dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  if (v0.addressTableLookups.length) throw new Error('v1 forbids address lookup tables');
  if (v0.staticAccountKeys.length > 64 || v0.compiledInstructions.length > 64)
    throw new Error(`v1 inline limit ${v0.staticAccountKeys.length}/${v0.compiledInstructions.length}`);
  const config = Buffer.alloc(8); config.writeUInt32LE(computeLimit); config.writeUInt32LE(dataLimit, 4);
  const heads = v0.compiledInstructions.map(ix => {
    const head = Buffer.alloc(4); head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length; head.writeUInt16LE(ix.data.length, 2); return head;
  });
  const payloads = v0.compiledInstructions.map(ix => Buffer.concat([
    Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data),
  ]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([v0.compiledInstructions.length, v0.staticAccountKeys.length]),
    ...v0.staticAccountKeys.map(key => key.toBuffer()), config, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 wire size ${wire.length}`);
  return {wire, sizeBytes: wire.length, addressCount: v0.staticAccountKeys.length,
    instructionCount: v0.compiledInstructions.length,
    requiredSignatures: v0.header.numRequiredSignatures, v0};
}

function signV1(encoded, instructions, blockhash) {
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = encoded.v0.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const signers = new Map([[ATTACKER.publicKey.toBase58(), ATTACKER],
    [MARGIN_ACCOUNT.publicKey.toBase58(), MARGIN_ACCOUNT]]);
  signerOrder.forEach((address, index) => {
    const keypair = signers.get(address);
    if (!keypair) throw new Error(`uncontrolled signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey).copy(signed,
      signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder, messageSha256: sha256(message), blockhash};
}

function ix(programId, keys, data) { return new TransactionInstruction({programId, keys, data}); }

function takeOffer(amount, mutations = {}) {
  const keys = [
    [USDG_OFFER, 0, 1], [STATE, 0, 0], [BOSS, 0, 0], [VAULT_AUTHORITY, 0, 0],
    [USDG_OFFER_VAULT, 0, 1], [ONYC_OFFER_VAULT, 0, 1], [PERMISSIONLESS_AUTHORITY, 0, 0],
    [ata(USDG, PERMISSIONLESS_AUTHORITY, TOKEN_2022_PROGRAM_ID), 0, 1],
    [ata(ONYC, PERMISSIONLESS_AUTHORITY, TOKEN_PROGRAM_ID), 0, 1], [USDG, 0, 1],
    [TOKEN_2022_PROGRAM_ID, 0, 0], [ONYC, 0, 1], [TOKEN_PROGRAM_ID, 0, 0],
    [USER_USDG, 0, 1], [USER_ONYC, 0, 1], [ata(USDG, BOSS, TOKEN_2022_PROGRAM_ID), 0, 1],
    [MINT_AUTHORITY, 0, 0], [SYSVAR_INSTRUCTIONS_PUBKEY, 0, 0], [USER, 1, 1],
    [ASSOCIATED_TOKEN_PROGRAM_ID, 0, 0], [SystemProgram.programId, 0, 0],
  ].map(([pubkey, signer, writable]) => meta(pubkey, !!signer, !!writable));
  for (const [index, pubkey] of Object.entries(mutations)) keys[Number(index)].pubkey = P(pubkey);
  return ix(ONRE, keys, Buffer.concat([DISC.take, u64(amount), Buffer.from([0])]));
}

function openSwapSell(amount, mutations = {}, minimumOut = 0n) {
  const keys = [
    [USDG_OFFER, 0, 0], [USDG_PROP_AMM_PAIR, 0, 1], [USDG_REDEMPTION_OFFER, 0, 0],
    [STATE, 0, 0], [VAULT_AUTHORITY, 0, 0], [REDEMPTION_AUTHORITY, 0, 0],
    [ONYC_REDEMPTION_VAULT, 0, 1], [USDG_REDEMPTION_VAULT, 0, 1], [ONYC, 0, 1],
    [TOKEN_PROGRAM_ID, 0, 0], [USDG, 0, 1], [TOKEN_2022_PROGRAM_ID, 0, 0],
    [USER_ONYC, 0, 1], [USER_USDG, 0, 1], [PROP_AMM_PROCEEDS_VAULT, 0, 1],
    [ata(ONYC, PROP_AMM_PROCEEDS_VAULT, TOKEN_PROGRAM_ID), 0, 1],
    [PROP_AMM_SELL_FEE_VAULT, 0, 1], [ata(ONYC, PROP_AMM_SELL_FEE_VAULT, TOKEN_PROGRAM_ID), 0, 1],
    [MINT_AUTHORITY, 0, 0], [BUFFER_STATE, 0, 1],
    [ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), 0, 1],
    [ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), 0, 1],
    [ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), 0, 1],
    [MARKET_STATS, 0, 1], [EXCLUDED_BALANCE, 0, 0], [SYSVAR_INSTRUCTIONS_PUBKEY, 0, 0],
    [USER, 1, 1], [ASSOCIATED_TOKEN_PROGRAM_ID, 0, 0], [SystemProgram.programId, 0, 0],
    [MAIN_OFFER, 0, 0], [ONYC_OFFER_VAULT, 0, 0],
  ].map(([pubkey, signer, writable]) => meta(pubkey, !!signer, !!writable));
  for (const [index, pubkey] of Object.entries(mutations)) keys[Number(index)].pubkey = P(pubkey);
  return ix(ONRE, keys, Buffer.concat([DISC.sell, u64(amount), u64(minimumOut)]));
}

function offerVault(kind, amount) {
  const isDeposit = kind === 'deposit';
  const keys = isDeposit
    ? [meta(STATE), meta(VAULT_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
      meta(USDG_OFFER_VAULT, false, true), meta(USER, true, true), meta(TOKEN_2022_PROGRAM_ID),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)]
    : [meta(VAULT_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
      meta(USDG_OFFER_VAULT, false, true), meta(USER, true, true), meta(STATE),
      meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)];
  return ix(ONRE, keys, Buffer.concat([isDeposit ? DISC.offerDeposit : DISC.offerWithdraw, u64(amount)]));
}

function redemptionVault(kind, amount) {
  const isDeposit = kind === 'deposit';
  return ix(ONRE, [meta(REDEMPTION_AUTHORITY), meta(USDG), meta(USER_USDG, false, true),
    meta(USDG_REDEMPTION_VAULT, false, true), meta(USER, true, true), meta(STATE),
    meta(TOKEN_2022_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)],
  Buffer.concat([isDeposit ? DISC.redemptionDeposit : DISC.redemptionWithdraw, u64(amount)]));
}

function createRequest(amount) {
  return ix(ONRE, [meta(STATE), meta(USDG_REDEMPTION_OFFER, false, true), meta(USDG_OFFER),
    meta(REDEMPTION_REQUEST, false, true), meta(USER, true, true), meta(REDEMPTION_AUTHORITY),
    meta(ONYC), meta(USER_ONYC, false, true), meta(ONYC_REDEMPTION_VAULT, false, true),
    meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)],
  Buffer.concat([DISC.createRequest, u64(amount), anchorString(REQUEST_ID)]));
}

function cancelRequest() {
  return ix(ONRE, [meta(STATE), meta(USDG_REDEMPTION_OFFER, false, true),
    meta(REDEMPTION_REQUEST, false, true), meta(USER, true, true), meta(USER),
    meta(WORKER, false, true), meta(REDEMPTION_AUTHORITY), meta(ONYC),
    meta(ONYC_REDEMPTION_VAULT, false, true), meta(USER_ONYC, false, true),
    meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(ASSOCIATED_TOKEN_PROGRAM_ID)],
  DISC.cancelRequest);
}

function fulfillRequestOutsider(amount) {
  return ix(ONRE, [meta(STATE), meta(USDG_OFFER), meta(USDG_REDEMPTION_OFFER, false, true),
    meta(REDEMPTION_REQUEST, false, true), meta(REDEMPTION_AUTHORITY),
    meta(ONYC_REDEMPTION_VAULT, false, true), meta(USDG_REDEMPTION_VAULT, false, true),
    meta(ONYC, false, true), meta(TOKEN_PROGRAM_ID), meta(USDG, false, true),
    meta(TOKEN_2022_PROGRAM_ID), meta(USER_USDG, false, true), meta(OFFER_PROCEEDS_VAULT, false, true),
    meta(ata(ONYC, OFFER_PROCEEDS_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(REDEMPTION_FEE_VAULT, false, true),
    meta(ata(ONYC, REDEMPTION_FEE_VAULT, TOKEN_PROGRAM_ID), false, true), meta(MINT_AUTHORITY),
    meta(USER), meta(USER, true, true), meta(BUFFER_STATE, false, true),
    meta(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(VAULT_AUTHORITY),
    meta(ONYC_OFFER_VAULT), meta(MARKET_STATS, false, true), meta(EXCLUDED_BALANCE), meta(MAIN_OFFER)],
  Buffer.concat([DISC.fulfillRequest, u64(amount)]));
}

function mintToOutsider(amount) {
  return ix(ONRE, [meta(STATE), meta(USER, true, true), meta(ONYC, false, true),
    meta(USER_ONYC, false, true), meta(MINT_AUTHORITY), meta(TOKEN_PROGRAM_ID),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(MAIN_OFFER),
    meta(BUFFER_STATE, false, true), meta(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), false, true),
    meta(MARKET_STATS, false, true), meta(EXCLUDED_BALANCE)],
  Buffer.concat([DISC.mintTo, u64(amount)]));
}

function reserveDeposit(amount) {
  return ix(ONRE, [meta(STATE), meta(BUFFER_STATE), meta(RESERVE_VAULT_AUTHORITY), meta(ONYC),
    meta(USER_ONYC, false, true), meta(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true),
    meta(USER, true, true), meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(SystemProgram.programId)], Buffer.concat([DISC.reserveDeposit, u64(amount)]));
}

function reserveWithdrawOutsider(amount) {
  return ix(ONRE, [meta(STATE), meta(BUFFER_STATE), meta(RESERVE_VAULT_AUTHORITY), meta(ONYC),
    meta(USER_ONYC, false, true), meta(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), false, true),
    meta(USER, true, true), meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(SystemProgram.programId)], Buffer.concat([DISC.reserveWithdraw, u64(amount)]));
}

function configurableWithdraw(kind, configurableVault, destination, amount) {
  const vaultAta = ata(ONYC, configurableVault, TOKEN_PROGRAM_ID);
  const destinationAta = ata(ONYC, destination, TOKEN_PROGRAM_ID);
  return ix(ONRE, [meta(STATE), meta(USER, true, true), meta(configurableVault),
    meta(vaultAta, false, true), meta(destination), meta(destinationAta, false, true), meta(ONYC),
    meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId)],
  Buffer.concat([DISC.configurableWithdraw, Buffer.from([kind]), u64(amount)]));
}

function klendPair(row, amount) {
  const marketAuthority = PublicKey.findProgramAddressSync([
    Buffer.from('lma'), row.market.toBuffer()], KLEND)[0];
  const common = [meta(USER, true), meta(marketAuthority), meta(row.market),
    meta(row.reserve, false, true), meta(USDG), meta(row.supplyVault, false, true),
    meta(USER_USDG, false, true), meta(row.feeVault, false, true), meta(KLEND), meta(KLEND),
    meta(SYSVAR_INSTRUCTIONS_PUBKEY), meta(TOKEN_2022_PROGRAM_ID)];
  return {
    borrow: ix(KLEND, common.map(key => ({...key})), Buffer.concat([DISC.klendBorrow, u64(amount)])),
    repay: borrowIndex => ix(KLEND, common.map(key => ({...key})),
      Buffer.concat([DISC.klendRepay, u64(amount), Buffer.from([borrowIndex])])),
  };
}

function p0Initialize() {
  return ix(P0, [meta(P0_GROUP), meta(MARGIN_ACCOUNT.publicKey, true, true), meta(USER, true),
    meta(USER, true, true), meta(SystemProgram.programId)], DISC.p0Init);
}

function p0Start(endIndex = 0) {
  return ix(P0, [meta(MARGIN_ACCOUNT.publicKey, false, true), meta(USER, true),
    meta(SYSVAR_INSTRUCTIONS_PUBKEY)], Buffer.concat([DISC.p0Start, u64(endIndex)]));
}

function p0Pair(row, amount) {
  const [vaultAuthority] = PublicKey.findProgramAddressSync([
    Buffer.from('liquidity_vault_auth'), row.bank.toBuffer()], P0);
  return {
    borrow: ix(P0, [meta(P0_GROUP), meta(MARGIN_ACCOUNT.publicKey, false, true), meta(USER, true),
      meta(row.bank, false, true), meta(USER_USDG, false, true), meta(vaultAuthority),
      meta(row.vault, false, true), meta(TOKEN_2022_PROGRAM_ID), meta(USDG)],
    Buffer.concat([DISC.p0Borrow, u64(amount)])),
    repay: ix(P0, [meta(P0_GROUP), meta(MARGIN_ACCOUNT.publicKey, false, true), meta(USER, true),
      meta(row.bank, false, true), meta(USER_USDG, false, true), meta(row.vault, false, true),
      meta(TOKEN_2022_PROGRAM_ID), meta(USDG)],
    Buffer.concat([DISC.p0Repay, u64(amount), Buffer.from([0])])),
  };
}

function p0End() {
  return ix(P0, [meta(MARGIN_ACCOUNT.publicKey, false, true), meta(P0_GROUP), meta(USER, true)], DISC.p0End);
}

function p0Close() {
  const [rebalanceFeePool] = PublicKey.findProgramAddressSync([
    Buffer.from('rebalance_fee_pool'), MARGIN_ACCOUNT.publicKey.toBuffer()], P0);
  return ix(P0, [meta(MARGIN_ACCOUNT.publicKey, false, true), meta(USER, true),
    meta(USER, true, true), meta(rebalanceFeePool)], DISC.p0Close);
}

function jupInstruction(discriminator, amount) {
  return ix(JUP_FLASH, [meta(USER, true, true), meta(JUP_ADMIN, false, true),
    meta(USER_USDG, false, true), meta(USDG), meta(JUP.reserve, false, true),
    meta(JUP.position, false, true), meta(JUP.rateModel), meta(JUP.vault, false, true),
    meta(JUP_LIQUIDITY), meta(JUP_LIQUIDITY_PROGRAM), meta(TOKEN_2022_PROGRAM_ID),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId), meta(SYSVAR_INSTRUCTIONS_PUBKEY)],
  Buffer.concat([discriminator, u64(amount)]));
}

function jupRefresh() {
  return ix(JUP_LIQUIDITY_PROGRAM, [meta(JUP.reserve, false, true), meta(JUP.rateModel)],
    Buffer.concat([DISC.jupRefresh, USDG.toBuffer()]));
}

function compose({klendLoans = [], p0Loans = [], jupLoans = [], actions = []}) {
  const instructions = [];
  if (p0Loans.length) instructions.push(p0Initialize());
  let start = null;
  if (p0Loans.length) { start = p0Start(); instructions.push(start); }
  const jupPairs = jupLoans.map(amount => ({amount, borrow: jupInstruction(DISC.jupBorrow, amount),
    repay: jupInstruction(DISC.jupRepay, amount)}));
  const klendPairs = klendLoans.map(loan => ({...loan, ...klendPair(loan.row, loan.amount)}));
  const p0Pairs = p0Loans.map(loan => ({...loan, ...p0Pair(loan.row, loan.amount)}));
  for (const pair of jupPairs) { pair.borrowIndex = instructions.length; instructions.push(pair.borrow); }
  for (const pair of klendPairs) { pair.borrowIndex = instructions.length; instructions.push(pair.borrow); }
  for (const pair of p0Pairs) instructions.push(pair.borrow);
  instructions.push(...actions);
  for (const pair of [...p0Pairs].reverse()) instructions.push(pair.repay);
  for (const pair of [...klendPairs].reverse()) instructions.push(pair.repay(pair.borrowIndex));
  for (const pair of [...jupPairs].reverse()) instructions.push(jupRefresh(), pair.repay);
  let endIndex = null;
  if (p0Loans.length) {
    endIndex = instructions.length; instructions.push(p0End(), p0Close());
    start.data.writeBigUInt64LE(BigInt(endIndex), 8);
  }
  return {instructions, layout: {jupPairs: jupPairs.length, klendPairs: klendPairs.length,
    p0Pairs: p0Pairs.length, actionInstructions: actions.length, p0EndIndex: endIndex,
    klendBorrowIndexes: klendPairs.map(pair => pair.borrowIndex)}};
}

function accountImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const token = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner) &&
    data.length >= 165;
  return {owner: account.owner, lamports: String(account.lamports), dataLength: data.length,
    sha256: sha256(data), tokenAmountRaw: token ? data.readBigUInt64LE(64).toString() : null,
    mint: token ? new PublicKey(data.subarray(0, 32)).toBase58() : null,
    tokenAuthority: token ? new PublicKey(data.subarray(32, 64)).toBase58() : null,
    dataBase64: data.toString('base64')};
}

async function getAccounts(addresses) {
  if (!addresses.length) return {slot: null, rows: {}};
  const rows = {};
  let slot = null;
  for (let offset = 0; offset < addresses.length; offset += 100) {
    const chunk = addresses.slice(offset, offset + 100);
    const result = await rpc('getMultipleAccounts', [chunk.map(String),
      {encoding: 'base64', commitment: 'processed'}]);
    slot = result.context.slot;
    chunk.forEach((address, index) => { rows[address.toBase58()] = accountImage(result.value[index]); });
  }
  return {slot, rows};
}

async function importInstructions(instructions) {
  const addresses = [...new Map(instructions.flatMap(instruction => [instruction.programId,
    ...instruction.keys.map(key => key.pubkey)]).map(address => [address.toBase58(), address])).values()];
  for (const address of addresses) await rpc('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
}

function tokenDelta(before, after) {
  if (before?.tokenAmountRaw == null || after?.tokenAmountRaw == null) return null;
  return (BigInt(after.tokenAmountRaw) - BigInt(before.tokenAmountRaw)).toString();
}

function conciseLogs(logs) {
  return (logs || []).filter(line => /Instruction:|AnchorError|Error|failed|Offer taken|Open swap sell|cancelled|Flashloan|FlashBorrow|FlashRepay|Custom program error/.test(line));
}

const ROLE = new Map();
function remember(address, role) { ROLE.set(P(address).toBase58(), role); return P(address); }

const PROTOCOL_WATCH = [
  remember(USER_USDG, 'attackerUsdG'), remember(USER_ONYC, 'attackerOnyc'),
  remember(REDEMPTION_REQUEST, 'attackerRedemptionRequest'),
  remember(USDG_REDEMPTION_VAULT, 'onreRedemptionUsdGVault'),
  remember(ONYC_REDEMPTION_VAULT, 'onreRedemptionOnycVault'),
  remember(USDG_OFFER_VAULT, 'onreOfferUsdGVault'), remember(ONYC_OFFER_VAULT, 'onreOfferOnycVault'),
  remember(ata(USDG, PERMISSIONLESS_AUTHORITY, TOKEN_2022_PROGRAM_ID), 'onrePermissionlessUsdGVault'),
  remember(ata(ONYC, PERMISSIONLESS_AUTHORITY, TOKEN_PROGRAM_ID), 'onrePermissionlessOnycVault'),
  remember(ata(ONYC, PROP_AMM_PROCEEDS_VAULT, TOKEN_PROGRAM_ID), 'onrePropAmmProceedsOnyc'),
  remember(ata(ONYC, PROP_AMM_SELL_FEE_VAULT, TOKEN_PROGRAM_ID), 'onrePropAmmFeeOnyc'),
  remember(ata(ONYC, RESERVE_VAULT_AUTHORITY, TOKEN_PROGRAM_ID), 'onreReserveOnyc'),
  remember(ata(ONYC, MANAGEMENT_FEE_VAULT, TOKEN_PROGRAM_ID), 'onreManagementFeeOnyc'),
  remember(ata(ONYC, PERFORMANCE_FEE_VAULT, TOKEN_PROGRAM_ID), 'onrePerformanceFeeOnyc'),
  remember(ONYC, 'onycMint'), remember(USDG, 'usdGMint'),
];

const cases = [];
async function simulate(label, composed, watch = [], metadata = {}, options = {}) {
  const unique = [...new Map([...watch].map(address => [P(address).toBase58(), P(address)])).values()];
  await importInstructions(composed.instructions);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  let encoded;
  try { encoded = encodeV1(composed.instructions, USER, latest.value.blockhash); }
  catch (error) {
    const row = {label, metadata, composition: composed.layout, localCompositionError: error.message,
      limits: {maxBytes: 4096, maxAccounts: 64, maxInstructions: 64}};
    cases.push(row); console.log(JSON.stringify({label, localCompositionError: error.message})); return row;
  }
  const signed = signV1(encoded, composed.instructions, latest.value.blockhash);
  const before = await getAccounts(unique);
  const post = {};
  let primary = null;
  const chunks = unique.length ? Array.from({length: Math.ceil(unique.length / 10)}, (_, index) =>
    unique.slice(index * 10, index * 10 + 10)) : [[]];
  for (const chunk of chunks) {
    const result = await rpc('simulateTransaction', [signed.signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      ...(chunk.length ? {accounts: {encoding: 'base64', addresses: chunk.map(String)}} : {}),
    }]);
    if (!primary) primary = result;
    if (JSON.stringify(result.value.err || null) !== JSON.stringify(primary.value.err || null))
      throw new Error(`${label}: chunked replay error mismatch`);
    (result.value.accounts || []).forEach((account, index) => {
      post[chunk[index].toBase58()] = accountImage(account);
    });
  }
  const deltas = {};
  for (const address of unique) {
    const key = address.toBase58();
    deltas[ROLE.get(key) || key] = {address: key, tokenAmountRaw: tokenDelta(before.rows[key], post[key]),
      existedBefore: before.rows[key] !== null, existsAfter: post[key] !== null,
      dataSha256Equal: before.rows[key]?.sha256 === post[key]?.sha256};
  }
  const logs = primary.value.logs || [];
  const row = {label, metadata, composition: composed.layout,
    slots: {before: before.slot, simulation: primary.context.slot}, err: primary.value.err || null,
    unitsConsumed: primary.value.unitsConsumed, loadedAccountsDataSize: primary.value.loadedAccountsDataSize,
    wire: {version: 1, bytes: encoded.sizeBytes, accounts: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: signed.signerOrder, sigVerify: true, replaceRecentBlockhash: false,
      messageSha256: signed.messageSha256, signedWireSha256: sha256(signed.signed),
      ...(options.includeWire ? {signedBase64: signed.signed.toString('base64')} : {})},
    watched: unique.map(address => ({address: address.toBase58(), role: ROLE.get(address.toBase58()) || null})),
    before: before.rows, post, deltas, logs: options.fullLogs ? logs : conciseLogs(logs)};
  row.repayLogs = {
    klend: logs.filter(line => line.includes('Instruction: FlashRepayReserveLiquidity')).length,
    p0End: logs.filter(line => line.includes('Instruction: LendingAccountEndFlashloan')).length,
    jupiter: logs.filter(line => line.includes('Instruction: FlashloanPayback')).length,
  };
  row.targetErrorLog = [...logs].reverse().find(line => /AnchorError|failed|Error/.test(line)) || null;
  cases.push(row);
  console.log(JSON.stringify({label, err: row.err, bytes: row.wire.bytes, accounts: row.wire.accounts,
    instructions: row.wire.instructions, units: row.unitsConsumed, targetErrorLog: row.targetErrorLog}));
  return row;
}

function parsePrice(logs) {
  const line = (logs || []).find(log => log.includes('Offer taken (permissionless)'));
  const match = line?.match(/price: (\d+)\.(\d+)/);
  return match ? BigInt(match[1] + match[2].padEnd(9, '0').slice(0, 9)) : null;
}

function parseSell(logs) {
  const line = (logs || []).find(log => log.includes('Open swap sell - offer:'));
  const match = line?.match(/token_in\(\+fee\): (\d+)\(\+(\d+)\), token_out: (\d+)/);
  return match ? {tokenInAfterFeeRaw: match[1], feeOnycRaw: match[2], tokenOutUsdGRaw: match[3], log: line}
    : line ? {log: line} : null;
}

function buyOut(amount, priceRaw) {
  return BigInt(amount) * 10n ** 18n / (BigInt(priceRaw) * 10n ** 6n);
}

function cycleActions(amount, priceRaw) {
  const onyc = buyOut(amount, priceRaw);
  return [takeOffer(amount), openSwapSell(onyc),
    createCloseAccountInstruction(USER_ONYC, USER, USER, [], TOKEN_PROGRAM_ID)];
}

function lenderWatch(klendLoans = [], p0Loans = [], includeJup = false) {
  const addresses = [];
  for (const loan of klendLoans) {
    addresses.push(remember(loan.row.supplyVault, `klendSupply:${loan.row.reserve}`),
      remember(loan.row.feeVault, `klendFee:${loan.row.reserve}`),
      remember(loan.row.reserve, `klendReserve:${loan.row.reserve}`));
  }
  for (const loan of p0Loans) {
    addresses.push(remember(loan.row.vault, `project0Vault:${loan.row.bank}`),
      remember(loan.row.bank, `project0Bank:${loan.row.bank}`));
  }
  if (p0Loans.length) addresses.push(remember(MARGIN_ACCOUNT.publicKey, 'project0AttackerMarginAccount'));
  if (includeJup) addresses.push(remember(JUP.vault, 'jupiterUsdGVault'),
    remember(JUP.reserve, 'jupiterUsdGReserve'), remember(JUP.position, 'jupiterFlashBorrowPosition'),
    remember(JUP_ADMIN, 'jupiterFlashAdmin'));
  return addresses;
}

function rawData(image) { return image?.dataBase64 ? Buffer.from(image.dataBase64, 'base64') : null; }
function decodeAccount(image, coder, name) {
  try { return image ? coder.decode(name, rawData(image)) : null; }
  catch (error) { return {decodeError: error.message}; }
}

function reserveEconomic(image) {
  const decoded = decodeAccount(image, klendCoder, 'Reserve');
  if (!decoded || decoded.decodeError) return decoded;
  return {availableRaw: decoded.liquidity.total_available_amount.toString(),
    borrowedAmountSf: decoded.liquidity.borrowed_amount_sf.toString(),
    protocolFeesSf: decoded.liquidity.accumulated_protocol_fees_sf.toString(),
    flashFeeSf: decoded.config.fees.flash_loan_fee_sf.toString()};
}

function marginEconomic(image, name) {
  const decoded = decodeAccount(image, marginCoder, name);
  if (!decoded || decoded.decodeError) return decoded;
  if (name === 'MarginfiAccount') return {authority: decoded.authority.toBase58(),
    group: decoded.group.toBase58(), activeBalances: decoded.lending_account.balances
      .filter(balance => balance.active).map(balance => ({bank: balance.bank_pk.toBase58(),
        assetShares: String(balance.asset_shares.value), liabilityShares: String(balance.liability_shares.value)}))};
  return {mint: decoded.mint.toBase58(), totalAssetShares: String(decoded.total_asset_shares.value),
    totalLiabilityShares: String(decoded.total_liability_shares.value)};
}

function jupEconomic(image, name) {
  const coder = name === 'FlashloanAdmin' ? jupFlashCoder : jupCoder;
  const decoded = decodeAccount(image, coder, name);
  if (!decoded || decoded.decodeError) return decoded;
  if (name === 'FlashloanAdmin') return {feeBps: Number(decoded.flashloan_fee),
    active: !!decoded.is_flashloan_active, activeAmountRaw: decoded.active_flashloan_amount.toString()};
  if (name === 'UserBorrowPosition') return {amountRaw: decoded.amount.toString(),
    debtCeilingRaw: decoded.debt_ceiling.toString(), maxDebtCeilingRaw: decoded.max_debt_ceiling.toString(),
    status: Number(decoded.status)};
  return {totalSupplyWithInterestRaw: decoded.total_supply_with_interest.toString(),
    totalSupplyInterestFreeRaw: decoded.total_supply_interest_free.toString(),
    totalBorrowWithInterestRaw: decoded.total_borrow_with_interest.toString(),
    totalBorrowInterestFreeRaw: decoded.total_borrow_interest_free.toString(),
    totalClaimRaw: decoded.total_claim_amount.toString(), supplyExchangePrice: decoded.supply_exchange_price.toString(),
    borrowExchangePrice: decoded.borrow_exchange_price.toString(), maxUtilization: Number(decoded.max_utilization)};
}

function classifySuccessfulCycle(row, providers) {
  const attacker = row.deltas.attackerUsdG?.tokenAmountRaw;
  const onyc = row.post[USER_ONYC.toBase58()];
  const request = row.post[REDEMPTION_REQUEST.toBase58()];
  const margin = row.post[MARGIN_ACCOUNT.publicKey.toBase58()];
  const lenderDeltas = Object.entries(row.deltas).filter(([role]) =>
    role.startsWith('klendSupply:') || role.startsWith('project0Vault:') || role === 'jupiterUsdGVault');
  const repaymentsLogged = (!providers.klend || row.repayLogs.klend === providers.klend) &&
    (!providers.p0 || row.repayLogs.p0End === 1) && (!providers.jup || row.repayLogs.jupiter === providers.jup);
  const isClosed = image => image === null || (image?.owner === SystemProgram.programId.toBase58() &&
    image?.lamports === '0' && image?.dataLength === 0);
  return {atomicSuccess: row.err === null, attackerUsdGDeltaRaw: attacker,
    attackerOnycClosedOrZero: isClosed(onyc) || onyc?.tokenAmountRaw === '0',
    requestClosed: isClosed(request), marginAccountClosed: !providers.p0 || isClosed(margin),
    lenderVaultDeltas: Object.fromEntries(lenderDeltas.map(([role, delta]) => [role, delta.tokenAmountRaw])),
    lenderVaultsConserved: lenderDeltas.every(([, delta]) => delta.tokenAmountRaw === '0'),
    repaymentsLogged, positiveNetEquity: row.err === null && attacker != null && BigInt(attacker) > 0n &&
      (isClosed(onyc) || onyc?.tokenAmountRaw === '0') && isClosed(request) &&
      (!providers.p0 || isClosed(margin)) && repaymentsLogged &&
      lenderDeltas.every(([, delta]) => delta.tokenAmountRaw === '0')};
}

async function testBoundary(prefix, build, lower, upper, watch, metadata = {}) {
  const trace = [];
  let lo = BigInt(lower), hi = BigInt(upper);
  const probe = async amount => {
    const row = await simulate(`${prefix}_search_${amount}`, build(amount), watch,
      {...metadata, class: 'capacity-search', amountRaw: amount.toString()});
    trace.push({amountRaw: amount.toString(), success: row.err === null,
      err: row.err, targetErrorLog: row.targetErrorLog, bytes: row.wire?.bytes,
      accounts: row.wire?.accounts, unitsConsumed: row.unitsConsumed});
    return row.err === null;
  };
  if (!(await probe(lo))) return {maximumUsableRaw: null, trace,
    blocker: `known lower bound ${lo} failed`};
  if (await probe(hi)) return {maximumUsableRaw: hi.toString(), trace,
    note: 'displayed upper bound was usable; +1 is tested separately'};
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (await probe(mid)) lo = mid; else hi = mid;
  }
  return {maximumUsableRaw: lo.toString(), firstFailRaw: hi.toString(), trace};
}

async function loadProviders() {
  const target = crosswalk.targets.find(row => row.programId === ONRE.toBase58());
  const klendRows = target.assets.flatMap(asset => asset.liveInventory)
    .filter(row => row.provider === 'Kamino Lend').map(row => ({reserve: P(row.reserve)}));
  const reserveResult = await rpc('getMultipleAccounts', [klendRows.map(row => row.reserve.toBase58()),
    {encoding: 'base64', commitment: 'processed'}]);
  klendRows.forEach((row, index) => {
    const account = accountImage(reserveResult.value[index]);
    const decoded = klendCoder.decode('Reserve', rawData(account));
    Object.assign(row, {market: P(decoded.lending_market), supplyVault: P(decoded.liquidity.supply_vault),
      feeVault: P(decoded.liquidity.fee_vault), availableRaw: BigInt(decoded.liquidity.total_available_amount.toString()),
      flashFeeSf: BigInt(decoded.config.fees.flash_loan_fee_sf.toString())});
  });
  klendRows.sort((a, b) => a.availableRaw > b.availableRaw ? -1 : 1);
  const p0Accounts = await getAccounts(P0_ROWS.flatMap(row => [row.bank, row.vault]));
  const p0Rows = P0_ROWS.map(row => ({...row,
    vaultRaw: BigInt(p0Accounts.rows[row.vault.toBase58()]?.tokenAmountRaw || '0'),
    bankState: marginEconomic(p0Accounts.rows[row.bank.toBase58()], 'Bank')}));
  p0Rows.sort((a, b) => a.vaultRaw > b.vaultRaw ? -1 : 1);
  const jupAccounts = await getAccounts([JUP.vault, JUP.reserve, JUP.position, JUP_ADMIN]);
  const jupReserve = jupEconomic(jupAccounts.rows[JUP.reserve.toBase58()], 'TokenReserve');
  const jupPosition = jupEconomic(jupAccounts.rows[JUP.position.toBase58()], 'UserBorrowPosition');
  const jupAdmin = jupEconomic(jupAccounts.rows[JUP_ADMIN.toBase58()], 'FlashloanAdmin');
  return {slot: reserveResult.context.slot, klendRows, p0Rows,
    jup: {vaultRaw: BigInt(jupAccounts.rows[JUP.vault.toBase58()].tokenAmountRaw),
      reserveState: jupReserve, positionState: jupPosition, adminState: jupAdmin}};
}

const ceilDiv = (a, b) => (a + b - 1n) / b;
async function main() {
  const health = await rpc('getHealth', []);
  if (health !== 'ok') throw new Error(`fork health ${health}`);
  await rpc('surfnet_setAccount', [USER.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const syntheticStartingUsdGRaw = 100_000_000_000_000;
  await rpc('surfnet_setTokenAccount', [USER.toBase58(), USDG.toBase58(),
    {amount: syntheticStartingUsdGRaw}, TOKEN_2022_PROGRAM_ID.toBase58()]);
  const funded = await getAccounts([USER, USER_USDG]);
  if (funded.rows[USER_USDG.toBase58()]?.tokenAmountRaw !== String(syntheticStartingUsdGRaw))
    throw new Error('fork-only attacker USDG setup failed');

  const providers = await loadProviders();
  const zeroKlend = providers.klendRows.filter(row => row.flashFeeSf === 0n);
  const feeKlend = providers.klendRows.filter(row => row.flashFeeSf !== 0n);
  if (!zeroKlend.length) throw new Error('no current zero-fee KLend USDG reserve');
  const selectedKlend = zeroKlend[0];
  const secondKlend = zeroKlend[1];
  const largestP0 = providers.p0Rows[0];

  // Signed current-price probe. This is discovery, not an exploit candidate.
  const priceProbe = await simulate('signed_price_discovery_1_usdg', compose({actions: [takeOffer(1_000_000n)]}),
    PROTOCOL_WATCH, {class: 'price-discovery'}, {fullLogs: true, includeWire: true});
  const priceRaw = parsePrice(priceProbe.logs);
  if (priceProbe.err || !priceRaw) throw new Error('signed current price probe failed');

  const providerBoundaries = {klend: {}, project0: {}, jupiter: {}};
  const selectedLoan = amount => [{row: selectedKlend, amount}];
  const selectedWatch = lenderWatch(selectedLoan(1n));
  for (const [suffix, amount] of [['minus_1', selectedKlend.availableRaw - 1n],
    ['exact', selectedKlend.availableRaw], ['plus_1', selectedKlend.availableRaw + 1n]]) {
    const row = await simulate(`klend_selected_available_${suffix}`, compose({klendLoans: selectedLoan(amount)}),
      [USER_USDG, ...lenderWatch(selectedLoan(amount))], {class: 'provider-boundary', provider: 'KLend',
        reserve: selectedKlend.reserve.toBase58(), amountRaw: amount.toString()});
    providerBoundaries.klend[suffix] = row.label;
  }
  if (secondKlend) {
    await simulate('klend_two_distinct_reserves_repeat_borrow_probe', compose({klendLoans: [
      {row: selectedKlend, amount: 1_000_000n}, {row: secondKlend, amount: 1_000_000n},
    ]}), [USER_USDG, ...lenderWatch([{row: selectedKlend}, {row: secondKlend}])],
    {class: 'repeat-borrow-constraint', expected: 'MultipleFlashBorrows'});
  }
  if (feeKlend[0]) {
    const feeLoan = [{row: feeKlend[0], amount: feeKlend[0].availableRaw > 1_000_000n
      ? 1_000_000n : feeKlend[0].availableRaw}];
    await simulate('klend_nonzero_fee_reserve_control', compose({klendLoans: feeLoan}),
      [USER_USDG, ...lenderWatch(feeLoan)], {class: 'fee-mode-control',
        flashFeeSf: feeKlend[0].flashFeeSf.toString()});
  }

  for (const row of providers.p0Rows) {
    const amounts = [...new Set([row.vaultRaw > 1n ? row.vaultRaw - 1n : 0n,
      row.vaultRaw, row.vaultRaw + 1n].map(String))].map(BigInt);
    for (const amount of amounts) {
      const loan = [{row, amount}];
      await simulate(`project0_bank_${row.bank}_vault_boundary_${amount}`, compose({p0Loans: loan}),
        [USER_USDG, ...lenderWatch([], loan)], {class: 'provider-displayed-boundary', provider: 'Project0',
          bank: row.bank.toBase58(), displayedVaultRaw: row.vaultRaw.toString(), amountRaw: amount.toString()});
    }
  }
  const p0Search = await testBoundary('project0_largest_usable', amount => compose({
    p0Loans: [{row: largestP0, amount}]}), 1_000n, largestP0.vaultRaw,
  [USER_USDG, ...lenderWatch([], [{row: largestP0}])], {provider: 'Project0', bank: largestP0.bank.toBase58()});
  providerBoundaries.project0 = p0Search;
  const p0Max = p0Search.maximumUsableRaw ? BigInt(p0Search.maximumUsableRaw) : 0n;
  if (p0Max > 0n) {
    for (const [suffix, amount] of [['minus_1', p0Max > 0n ? p0Max - 1n : 0n],
      ['exact', p0Max], ['plus_1', p0Max + 1n]]) {
      const loan = [{row: largestP0, amount}];
      await simulate(`project0_usable_${suffix}`, compose({p0Loans: loan}),
        [USER_USDG, ...lenderWatch([], loan)], {class: 'provider-usable-boundary', provider: 'Project0',
          amountRaw: amount.toString()});
    }
  }
  await simulate('project0_three_usdg_banks_same_session_probe', compose({p0Loans:
    providers.p0Rows.map(row => ({row, amount: row.vaultRaw}))}),
  [USER_USDG, ...lenderWatch([], providers.p0Rows.map(row => ({row})))],
  {class: 'same-provider-multi-bank-capacity', displayedAggregateRaw:
    providers.p0Rows.reduce((sum, row) => sum + row.vaultRaw, 0n).toString()});

  for (const amount of [999n, 1_000n, 1_001n]) {
    await simulate(`jupiter_minimum_${amount}`, compose({jupLoans: [amount]}),
      [USER_USDG, ...lenderWatch([], [], true)], {class: 'provider-minimum', provider: 'Jupiter',
        amountRaw: amount.toString()});
  }
  const jupUpper = [providers.jup.vaultRaw,
    BigInt(providers.jup.positionState.maxDebtCeilingRaw)].reduce((a, b) => a < b ? a : b);
  const jupSearch = await testBoundary('jupiter_usable', amount => compose({jupLoans: [amount]}),
    1_000n, jupUpper, [USER_USDG, ...lenderWatch([], [], true)], {provider: 'Jupiter'});
  providerBoundaries.jupiter = jupSearch;
  const jupMax = jupSearch.maximumUsableRaw ? BigInt(jupSearch.maximumUsableRaw) : 0n;
  if (jupMax > 0n) {
    for (const [suffix, amount] of [['minus_1', jupMax - 1n], ['exact', jupMax],
      ['plus_1', jupMax + 1n]]) {
      await simulate(`jupiter_usable_${suffix}`, compose({jupLoans: [amount]}),
        [USER_USDG, ...lenderWatch([], [], true)], {class: 'provider-usable-boundary', provider: 'Jupiter',
          amountRaw: amount.toString()});
    }
  }
  await simulate('jupiter_repeated_borrow_same_transaction_probe', compose({jupLoans: [1_000n, 1_000n]}),
    [USER_USDG, ...lenderWatch([], [], true)], {class: 'repeat-borrow-constraint'});

  const cycleRows = [];
  async function runCycle(label, source, amount, metadata = {}) {
    const composed = compose({...source, actions: cycleActions(amount, priceRaw)});
    const watch = [...PROTOCOL_WATCH,
      ...lenderWatch(source.klendLoans || [], source.p0Loans || [], (source.jupLoans || []).length > 0)];
    const row = await simulate(label, composed, watch, {...metadata, class: 'fully-unwound-onre-cycle',
      routedUsdGRaw: amount.toString()}, {includeWire: label === 'tri_source_maximum_usable_onre_cycle'});
    row.sell = parseSell(row.logs);
    row.economic = classifySuccessfulCycle(row, {klend: (source.klendLoans || []).length,
      p0: (source.p0Loans || []).length, jup: (source.jupLoans || []).length});
    cycleRows.push(row);
    return row;
  }

  const minimumSellFeeOnyc = 1_000_000_000n;
  const dustOnyc = minimumSellFeeOnyc + ceilDiv(1_000n * 10n ** 12n, priceRaw);
  const dustUsdG = ceilDiv(dustOnyc * priceRaw * 10n ** 6n, 10n ** 18n);
  for (const amount of [dustUsdG, 2_000_000n, 1_000_000_000n,
    selectedKlend.availableRaw * 99n / 100n]) {
    await runCycle(`klend_onre_roundtrip_${amount}`, {klendLoans: selectedLoan(amount)}, amount,
      {providerSet: ['KLend']});
  }
  if (p0Max >= 2n) await runCycle('project0_maximum_usable_onre_cycle',
    {p0Loans: [{row: largestP0, amount: p0Max}]}, p0Max, {providerSet: ['Project0']});
  if (jupMax >= 1_000n) await runCycle('jupiter_maximum_usable_onre_cycle',
    {jupLoans: [jupMax]}, jupMax, {providerSet: ['Jupiter']});

  const triBase = {klend: 1_000_000n, p0: p0Max >= 1_000n ? 1_000n : p0Max, jup: 1_000n};
  if (triBase.p0 > 0n && jupMax >= 1_000n) {
    const triSpecs = [
      ['tri_source_asymmetric_klend_heavy', selectedKlend.availableRaw * 99n / 100n, triBase.p0, triBase.jup],
      ['tri_source_asymmetric_project0_heavy', triBase.klend, p0Max, triBase.jup],
      ['tri_source_asymmetric_jupiter_heavy', triBase.klend, triBase.p0, jupMax],
      ['tri_source_maximum_usable_onre_cycle', selectedKlend.availableRaw, p0Max, jupMax],
    ];
    for (const [label, klendAmount, p0Amount, jupAmount] of triSpecs) {
      const total = klendAmount + p0Amount + jupAmount;
      await runCycle(label, {klendLoans: selectedLoan(klendAmount),
        p0Loans: [{row: largestP0, amount: p0Amount}], jupLoans: [jupAmount]}, total,
      {providerSet: ['KLend', 'Project0', 'Jupiter'], allocationRaw: {
        klend: klendAmount.toString(), project0: p0Amount.toString(), jupiter: jupAmount.toString()}});
    }
    if (secondKlend) {
      const source = {klendLoans: [{row: selectedKlend, amount: 1_000_000n},
        {row: secondKlend, amount: 1_000_000n}], p0Loans: [{row: largestP0, amount: triBase.p0}],
        jupLoans: [1_000n]};
      const total = 2_000_000n + triBase.p0 + 1_000n;
      await runCycle('four_loan_legs_two_klend_plus_p0_plus_jupiter_probe', source, total,
        {providerSet: ['KLend reserve A', 'KLend reserve B', 'Project0', 'Jupiter'],
          expectedBlocker: 'KLend MultipleFlashBorrows or v1 envelope'});
    }
  }

  const wrapperAmount = 2_000_000n;
  const wrapper = {klendLoans: selectedLoan(wrapperAmount)};
  const wrapperWatch = source => [...PROTOCOL_WATCH,
    ...lenderWatch(source.klendLoans || [], source.p0Loans || [], (source.jupLoans || []).length > 0)];
  async function candidate(label, actions, source = wrapper, metadata = {}, extraWatch = []) {
    return simulate(label, compose({...source, actions}), [...wrapperWatch(source), ...extraWatch],
      {...metadata, class: 'flash-wrapped-outsider-candidate'});
  }
  const boughtOnyc = buyOut(wrapperAmount, priceRaw);
  const claimSource = triBase.p0 > 0n && jupMax >= 1_000n
    ? {klendLoans: selectedLoan(1_000_000n), p0Loans: [{row: largestP0, amount: triBase.p0}],
      jupLoans: [1_000n]} : wrapper;
  const claimUsdG = (claimSource.klendLoans || []).reduce((sum, loan) => sum + loan.amount, 0n) +
    (claimSource.p0Loans || []).reduce((sum, loan) => sum + loan.amount, 0n) +
    (claimSource.jupLoans || []).reduce((sum, amount) => sum + amount, 0n);
  const claimOnyc = buyOut(claimUsdG, priceRaw);
  const claimCycle = await candidate('claim_create_cancel_sell_unwind_repay',
    [takeOffer(claimUsdG), createRequest(claimOnyc), cancelRequest(), openSwapSell(claimOnyc),
      createCloseAccountInstruction(USER_ONYC, USER, USER, [], TOKEN_PROGRAM_ID)], claimSource,
    {candidate: 'redemption create/cancel accounting', providerSet: Object.keys(claimSource)});
  claimCycle.sell = parseSell(claimCycle.logs);
  claimCycle.economic = classifySuccessfulCycle(claimCycle, {klend: (claimSource.klendLoans || []).length,
    p0: (claimSource.p0Loans || []).length, jup: (claimSource.jupLoans || []).length});
  cycleRows.push(claimCycle);

  await candidate('claim_fulfill_outsider_worker_rejected',
    [takeOffer(claimUsdG), createRequest(claimOnyc), fulfillRequestOutsider(1n)], claimSource,
    {candidate: 'issue/redeem worker substitution'});
  await candidate('atomic_order_sell_before_buy_rejected', [openSwapSell(boughtOnyc), takeOffer(wrapperAmount)],
    wrapper, {candidate: 'atomic ordering'});
  await candidate('buy_substitute_boss_destination_rejected', [takeOffer(wrapperAmount, {15: USER_USDG})],
    wrapper, {candidate: 'CPI destination substitution'});
  await candidate('buy_substitute_permissionless_output_rejected', [takeOffer(wrapperAmount, {8: USER_ONYC})],
    wrapper, {candidate: 'CPI output substitution'});
  await candidate('buy_substitute_token_program_rejected', [takeOffer(wrapperAmount, {10: TOKEN_PROGRAM_ID})],
    wrapper, {candidate: 'CPI program substitution'});
  await candidate('sell_substitute_redemption_vault_rejected',
    [takeOffer(wrapperAmount), openSwapSell(boughtOnyc, {7: USER_USDG})], wrapper,
    {candidate: 'CPI redemption-vault substitution'});
  await candidate('sell_substitute_market_stats_rejected',
    [takeOffer(wrapperAmount), openSwapSell(boughtOnyc, {23: USER_USDG})], wrapper,
    {candidate: 'CPI state substitution'});
  await candidate('offer_vault_withdraw_outsider_rejected', [offerVault('withdraw', 1n)], wrapper,
    {candidate: 'direct custody withdraw'});
  await candidate('offer_vault_deposit_then_withdraw_rejected',
    [offerVault('deposit', 1n), offerVault('withdraw', 1n)], wrapper,
    {candidate: 'deposit/withdraw sequencing'});
  await candidate('redemption_vault_withdraw_outsider_rejected', [redemptionVault('withdraw', 1n)], wrapper,
    {candidate: 'direct redemption custody withdraw'});
  await candidate('redemption_vault_deposit_then_withdraw_rejected',
    [redemptionVault('deposit', 1n), redemptionVault('withdraw', 1n)], wrapper,
    {candidate: 'redemption deposit/withdraw sequencing'});
  await candidate('mint_to_outsider_boss_rejected', [mintToOutsider(1_000_000_000n)], wrapper,
    {candidate: 'unauthorized issue'});
  await candidate('reserve_vault_withdraw_outsider_boss_rejected', [reserveWithdrawOutsider(1n)], wrapper,
    {candidate: 'buffer custody withdraw'});
  await candidate('buy_deposit_reserve_then_outsider_withdraw_rejected',
    [takeOffer(wrapperAmount), reserveDeposit(boughtOnyc), reserveWithdrawOutsider(boughtOnyc)], wrapper,
    {candidate: 'buffer deposit/withdraw sequencing'});
  const config7VaultAta = ata(ONYC, CONFIG_KIND_7, TOKEN_PROGRAM_ID);
  const defaultDestAta = ata(ONYC, SystemProgram.programId, TOKEN_PROGRAM_ID);
  await candidate('configurable_vault_kind7_missing_destination_rejected',
    [configurableWithdraw(7, CONFIG_KIND_7, SystemProgram.programId, 0n)], wrapper,
    {candidate: 'permissionless configurable vault trigger; unset fixed destination'},
    [remember(config7VaultAta, 'configKind7OnycVault'), remember(defaultDestAta, 'configKind7DefaultDestinationAta')]);
  const config8VaultAta = ata(ONYC, CONFIG_KIND_8, TOKEN_PROGRAM_ID);
  const config8DestAta = ata(ONYC, CONFIG_KIND_8_DEST, TOKEN_PROGRAM_ID);
  await candidate('configurable_vault_kind8_fixed_destination_zero_balance',
    [configurableWithdraw(8, CONFIG_KIND_8, CONFIG_KIND_8_DEST, 0n)], wrapper,
    {candidate: 'permissionless configurable vault trigger; fixed non-attacker destination'},
    [remember(config8VaultAta, 'configKind8OnycVault'), remember(config8DestAta, 'configKind8FixedDestinationAta')]);
  await candidate('configurable_vault_kind8_redirect_to_attacker_rejected',
    [configurableWithdraw(8, CONFIG_KIND_8, USER, 0n)], wrapper,
    {candidate: 'configurable vault destination substitution'},
    [config8VaultAta, USER_ONYC]);

  // Remove raw account bytes from ordinary cases; decoded/hash evidence is retained.
  for (const row of cases) for (const side of ['before', 'post']) {
    if (!row[side]) continue;
    for (const image of Object.values(row[side])) if (image) delete image.dataBase64;
  }
  const successfulCycles = cycleRows.filter(row => row.economic?.atomicSuccess);
  const positiveCycles = successfulCycles.filter(row => row.economic.positiveNetEquity);
  const report = {
    generatedAt: new Date().toISOString(),
    restrictions: {environment: 'isolated current-mainnet-backed Surfpool fork',
      transport: 'simulateTransaction only', sigVerify: true, replaceRecentBlockhash: false,
      transactionSubmitted: false, sendPathPresent: false, operatorContacted: false,
      rpcUrlOrCredentialRecorded: false,
      forkWrites: 'Only deterministic attacker SOL/USDG setup via Surfpool cheatcodes; all tested transactions are simulations and roll back.'},
    forkBaseline: {providerObservationSlot: providers.slot, attacker: USER.toBase58(),
      attackerUsdG: USER_USDG.toBase58(), attackerOnyc: USER_ONYC.toBase58(),
      freshMarginfiAccount: MARGIN_ACCOUNT.publicKey.toBase58(), privateKeysPersisted: false,
      syntheticStartingUsdGRaw: String(syntheticStartingUsdGRaw),
      measurement: 'Only post-minus-pre deltas count; the synthetic starting balance is never counted as gain.'},
    livePrice: {priceScale9Raw: priceRaw.toString(), minimumPropSellFeeOnycRaw: minimumSellFeeOnyc.toString(),
      computedDustCycleInputUsdGRaw: dustUsdG.toString(), authority:
      'Solana Clock plus boss-authored Offer vectors; the instruction exposes no caller-supplied oracle account.'},
    providerInventory: {
      compatibleSameMintIndependentProviders: ['KLend', 'Project0 / marginfi v1', 'Jupiter native flash'],
      saveSolendCensus: {program: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
        sourceArtifact: path.join(DIR, 'chnry-usdg-daybreak-provider-save-census.json'),
        currentUsdGReserveCount: 0, compatible: false},
      klend: {aggregateDisplayedZeroFeeAvailableRaw: zeroKlend.reduce((sum, row) => sum + row.availableRaw, 0n).toString(),
        selectedReserve: selectedKlend.reserve.toBase58(), selectedAvailableRaw: selectedKlend.availableRaw.toString(),
        zeroFeeReserveCount: zeroKlend.length, nonzeroFeeReserveCount: feeKlend.length,
        rows: providers.klendRows.map(row => ({reserve: row.reserve.toBase58(), market: row.market.toBase58(),
          supplyVault: row.supplyVault.toBase58(), feeVault: row.feeVault.toBase58(),
          availableRaw: row.availableRaw.toString(), flashFeeSf: row.flashFeeSf.toString()}))},
      project0: {group: P0_GROUP.toBase58(), displayedAggregateVaultRaw:
        providers.p0Rows.reduce((sum, row) => sum + row.vaultRaw, 0n).toString(),
        rows: providers.p0Rows.map(row => ({bank: row.bank.toBase58(), vault: row.vault.toBase58(),
          displayedVaultRaw: row.vaultRaw.toString(), bankState: row.bankState}))},
      jupiter: {flashProgram: JUP_FLASH.toBase58(), liquidityProgram: JUP_LIQUIDITY_PROGRAM.toBase58(),
        admin: JUP_ADMIN.toBase58(), reserve: JUP.reserve.toBase58(), vault: JUP.vault.toBase58(),
        position: JUP.position.toBase58(), displayedVaultRaw: providers.jup.vaultRaw.toString(),
        reserveState: providers.jup.reserveState, positionState: providers.jup.positionState,
        adminState: providers.jup.adminState}},
    providerBoundaries,
    result: {signedCases: cases.filter(row => row.wire?.sigVerify).length,
      localCompositionBlockers: cases.filter(row => row.localCompositionError).length,
      successfulFullyUnwoundCycles: successfulCycles.length,
      positiveOutsiderNetEquityCycles: positiveCycles.length,
      findingDemonstrated: positiveCycles.length > 0,
      conclusion: positiveCycles.length
        ? 'A positive, fully repaid, liability-free outsider cycle was reproduced.'
        : 'No positive, fully repaid, liability-free outsider cycle was reproduced.'},
    cycleSummary: cycleRows.map(row => ({label: row.label, err: row.err,
      wire: row.wire && {bytes: row.wire.bytes, accounts: row.wire.accounts,
        instructions: row.wire.instructions, sigVerify: row.wire.sigVerify}, unitsConsumed: row.unitsConsumed,
      sell: row.sell, economic: row.economic})),
    cases,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, result: report.result,
    price: report.livePrice, boundaries: {klend: selectedKlend.availableRaw.toString(),
      project0: p0Search.maximumUsableRaw, jupiter: jupSearch.maximumUsableRaw},
    cycles: report.cycleSummary}, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = {rpc, simulate, compose, openSwapSell, takeOffer, cycleActions, getAccounts,
  remember, parseSell, parsePrice, buyOut, loadProviders, testBoundary, lenderWatch,
  classifySuccessfulCycle,
  USER, USER_USDG, USER_ONYC, BOSS, ONYC, USDG, USDG_REDEMPTION_VAULT, ONYC_REDEMPTION_VAULT,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, PROTOCOL_WATCH, MARGIN_ACCOUNT, cases};



