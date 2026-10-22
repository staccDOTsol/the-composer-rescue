#!/usr/bin/env node
'use strict';

// Defensive, fork-only Loopscale validation. Every transaction is signed by a
// freshly generated outsider key and simulated with sigVerify:true. Nothing is
// submitted to mainnet. Public lender/target state is lazily forked by Surfpool;
// the only synthetic state is the fresh outsider's SOL and explicitly disclosed
// USDC fee seed used to pay the fee-bearing Save flash lender.

const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
} = require(modules + '@solana/web3.js');
const spl = require(modules + '@solana/spl-token');
const anchor = require(modules + '@coral-xyz/anchor');
const bs58Module = require(modules + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');

const ROOT = __dirname;
const OUT = `${ROOT}/1oop-signed-fork-flash-matrix.json`;
const FORK = process.env.LOOPSCALE_FORK_URL || 'http://127.0.0.1:8997';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const UPSTREAM = env.HEAVY_RPC_URL || env.RPC_URL;
if (!UPSTREAM) throw new Error('Read-only upstream RPC is unavailable');

const P = (value) => new PublicKey(value);
const LOOP = P('1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BONK = P('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
const USD_INFRA = P('dawn7ZUF7h7anFuEsDdAU1Y3HYwikwqNMAENZsQJdNL');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const TOKEN_2022 = spl.TOKEN_2022_PROGRAM_ID;
const ASSOCIATED = spl.ASSOCIATED_TOKEN_PROGRAM_ID;
const SYSTEM = SystemProgram.programId;
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');

const ADMIN_STATE = P('HcgXEnEsgvGowVnSjMmrzSewdx9yGvfXixiuMJPhyW2z');
const EVENT_AUTHORITY = P('6sbyEiDvcYELrqoxurz3XTTLLg5wpe8dHCXi4uTvSSTV');
const BONK_LOAN = P('634QWfYYzXuqdDWoVtNgQisVYkTdBmfBbBPYZoNZyHwE');
const BONK_BORROWER = P('DJTiaWW2osQwz4wwHJrzrK6U2vD7cRUGymgmVTHzuDAd');
const BONK_STRATEGY = P('6tv6XYnXUFjLSaAeap4T1GQusYeEw3nK6KTcVyyHf3ns');
const BONK_MARKET = P('5qjqX4YQL6HSQMagRfTVfFDXrwxzKpS6bHguCWPe768y');
const BONK_VAULT = P('9FXfaV6eVe5RfD8vLg137u8kzA1aNmNsV3kDHCZhdqzF');
const BONK_STRATEGY_USDC = P('3GAu8zG1bLHEd2K5JUvysEjLSkfTw4aXYCFaUcQCYsA2');
const BONK_ORACLE = P('E22Z2nKBdA3RpJhM8G2mB35zFA95Qdbs3WGbMNxFhmuH');

const USD_STRATEGY = P('836SQM4FLXELjrSu2cLLvi32aiqn22uNbZsZvBNdDHFm');
const USD_LENDER_VAULT = P('4rXteUmbxiXvgLqP14eQwtqkLyVNXVCBHnXyLQ9vZkSh');
const USD_MARKET = P('6TBbDMm1uoVbxVrcs8bWnmoyuks4wzHNyQqX3GaEFcgB');
const USD_STRATEGY_TA = P('F488bJXts4G2e5eeFqLCuT5A4ebifSqEZmwLX7qeKurV');
const USD_LP_MINT = P('GvEMgNT6GKiYTvg7TskDio6RKzQdCuhwmH55tVCLaJTe');
const USD_LENDER_TA = spl.getAssociatedTokenAddressSync(
  USD_INFRA, USD_LENDER_VAULT, true, TOKEN_2022,
);

const P0_SOURCE_SIG = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SAVE_SOURCE_SIG = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const klendHistory = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`, 'utf8'));
const klendCensus = JSON.parse(fs.readFileSync(`${ROOT}/klend-zero-fee-census.json`, 'utf8'));
const loopIdl = JSON.parse(fs.readFileSync(`${ROOT}/1oop-loopscale-idl-0.9.30.json`, 'utf8'));
const instructionCoder = new anchor.BorshInstructionCoder(loopIdl);
const marginfiIdl = JSON.parse(fs.readFileSync(
  `${ROOT}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const marginfiCoder = new anchor.BorshAccountsCoder(marginfiIdl);

let rpcId = 0;
async function rpc(url, method, params) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const cloneIx = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});

function historyIx(tx, index) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys;
  const writableLoaded = tx.meta.loadedAddresses?.writable || [];
  const readonlyLoaded = tx.meta.loadedAddresses?.readonly || [];
  const keys = [...staticKeys, ...writableLoaded, ...readonlyLoaded];
  const header = message.header;
  const writable = (i) => i < staticKeys.length ?
    (i < header.numRequiredSignatures ?
      i < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      i < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + writableLoaded.length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({pubkey: P(keys[i]),
      isSigner: i < header.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(source.data))});
}

function tokenAmount(row) {
  if (!row?.data || ![TOKEN.toBase58(), TOKEN_2022.toBase58()].includes(row.owner)) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function accountImage(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return {owner: row.owner, lamports: row.lamports, dataLength: data.length,
    dataSha256: sha256(data), tokenAmountRaw: tokenAmount(row)};
}

function compactLogs(logs) {
  return (logs || []).filter((line) => /Instruction:|failed|Error|Constraint|liquidat|flash|healthy|default|maturity|signer|authority|insufficient|Multiple/i.test(line)).slice(-80);
}

function makeTokenAccountData(mint, owner, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1; // AccountState::Initialized
  return data;
}

function privateKey(kp) {
  return crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(kp.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
}

function signEncoded(encoded, instructions, payer, blockhash, signerMap) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  for (let i = 0; i < signerOrder.length; i += 1) {
    const kp = signerMap.get(signerOrder[i]);
    if (!kp) throw new Error(`Uncontrolled required signer ${signerOrder[i]}`);
    const signature = crypto.sign(null, message, privateKey(kp));
    signature.copy(signed, signed.length - 64 * encoded.requiredSignatures + i * 64);
  }
  return {signed, signerOrder};
}

function checkpoint(report) {
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

function liquidateInstruction(attacker, attackerUsdc, attackerBonk) {
  const data = Buffer.concat([
    Buffer.from([5, 124, 101, 85, 254, 175, 184, 249]),
    Buffer.from([0, 0]),
    Buffer.from([2, 0, 0, 0, 1, 2]),
  ]);
  return new TransactionInstruction({programId: LOOP, data, keys: [
    meta(attacker, true, true), meta(attacker, true, true), meta(BONK_BORROWER, false, true),
    meta(BONK_LOAN, false, true), meta(BONK_STRATEGY, false, true),
    meta(BONK_MARKET, false, true), meta(attackerUsdc, false, true),
    meta(BONK_STRATEGY_USDC, false, true), meta(USDC), meta(ASSOCIATED), meta(TOKEN),
    meta(TOKEN_2022), meta(SYSTEM), meta(ADMIN_STATE), meta(EVENT_AUTHORITY), meta(LOOP),
    meta(BONK_ORACLE), meta(SYSTEM), meta(BONK_ORACLE), meta(SYSTEM),
    meta(BONK), meta(BONK_VAULT, false, true), meta(attackerBonk, false, true),
  ]});
}

function withdrawStrategyInstruction(attacker) {
  const data = Buffer.alloc(17);
  Buffer.from([31, 45, 162, 5, 193, 217, 134, 188]).copy(data);
  data.writeBigUInt64LE(1n, 8);
  data[16] = 0;
  return new TransactionInstruction({programId: LOOP, data, keys: [
    meta(attacker, true), meta(attacker, true, true),
    // The real lender is an off-curve Loopscale Vault PDA. It cannot produce a
    // top-level signature, so a realizable outsider transaction leaves it unsigned.
    meta(USD_LENDER_VAULT, false, true), meta(USD_STRATEGY, false, true),
    meta(USD_INFRA), meta(USD_MARKET), meta(USD_LENDER_TA, false, true),
    meta(USD_STRATEGY_TA, false, true), meta(ASSOCIATED), meta(TOKEN_2022),
    meta(SYSTEM), meta(ADMIN_STATE), meta(EVENT_AUTHORITY), meta(LOOP),
  ]});
}

function withdrawCollateralInstruction(attacker, attackerBonk) {
  const data = instructionCoder.encode('withdraw_collateral', {params: {
    amount: new anchor.BN(1), collateral_index: 0,
    asset_index_guidance: Buffer.from([1, 2]),
    expected_loan_values: {expected_apy: new anchor.BN(0), expected_lqt: [0, 0, 0, 0, 0]},
    close_if_eligible: false, withdraw_all: false,
  }});
  return new TransactionInstruction({programId: LOOP, data, keys: [
    meta(attacker, true), meta(attacker, true, true), meta(attacker, true),
    meta(BONK_LOAN, false, true), meta(attackerBonk, false, true),
    meta(BONK_VAULT, false, true), meta(SYSTEM), meta(BONK), meta(TOKEN),
    meta(ASSOCIATED), meta(ADMIN_STATE), meta(EVENT_AUTHORITY), meta(LOOP),
  ]});
}

function withdrawUserVaultInstruction(attacker, attackerLp, attackerUsdInfra) {
  const data = instructionCoder.encode('withdraw_user_vault', {params: {
    ExactIn: [{amount_in: new anchor.BN(1), min_amount_out: new anchor.BN(0)}],
  }});
  return new TransactionInstruction({programId: LOOP, data, keys: [
    meta(attacker, true), meta(attacker, true, true), meta(attacker, true, true),
    meta(USD_LENDER_VAULT, false, true), meta(USD_STRATEGY, false, true), meta(USD_MARKET),
    meta(USD_LP_MINT, false, true), meta(attackerLp, false, true),
    meta(attackerUsdInfra, false, true), meta(USD_STRATEGY_TA, false, true),
    meta(USD_INFRA), meta(TOKEN_2022), meta(TOKEN_2022), meta(ASSOCIATED),
    meta(SYSTEM), meta(ADMIN_STATE), meta(EVENT_AUTHORITY), meta(LOOP),
  ]});
}

async function main() {
  const attacker = Keypair.generate();
  const marginfiAccount = Keypair.generate();
  const attackerUsdc = spl.getAssociatedTokenAddressSync(USDC, attacker.publicKey);
  const attackerBonk = spl.getAssociatedTokenAddressSync(BONK, attacker.publicKey);
  const attackerUsdInfra = spl.getAssociatedTokenAddressSync(
    USD_INFRA, attacker.publicKey, false, TOKEN_2022,
  );
  const attackerLp = spl.getAssociatedTokenAddressSync(
    USD_LP_MINT, attacker.publicKey, false, TOKEN_2022,
  );
  const syntheticUsdcSeed = 2000000000n; // 2,000 USDC, solely for Save's real fee.

  await rpc(FORK, 'surfnet_setAccount', [attacker.publicKey.toBase58(), {
    data: '', executable: false, lamports: 20000000000,
    owner: SYSTEM.toBase58(), rentEpoch: 0,
  }]);
  await rpc(FORK, 'surfnet_setAccount', [attackerUsdc.toBase58(), {
    data: makeTokenAccountData(USDC, attacker.publicKey, syntheticUsdcSeed).toString('hex'),
    executable: false, lamports: 2039280, owner: TOKEN.toBase58(), rentEpoch: 0,
  }]);

  const [p0Source, saveSource] = await Promise.all([
    rpc(UPSTREAM, 'getTransaction', [P0_SOURCE_SIG,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc(UPSTREAM, 'getTransaction', [SAVE_SOURCE_SIG,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  if (!p0Source || !saveSource) throw new Error('Historical source transaction unavailable');

  const p0StartTemplate = historyIx(p0Source, 1);
  const p0BorrowTemplate = historyIx(p0Source, 2);
  const p0RepayTemplate = historyIx(p0Source, 5);
  const p0EndTemplate = historyIx(p0Source, 6);
  if (![p0StartTemplate, p0BorrowTemplate, p0RepayTemplate, p0EndTemplate]
    .every((ix) => ix.programId.equals(P0))) throw new Error('Project0 source mismatch');
  const p0Group = p0BorrowTemplate.keys[0].pubkey;
  const p0Bank = p0BorrowTemplate.keys[3].pubkey;
  const p0Vault = p0BorrowTemplate.keys[6].pubkey;

  const p0Init = new TransactionInstruction({programId: P0, keys: [
    meta(p0Group), meta(marginfiAccount.publicKey, true, true), meta(attacker.publicKey, true),
    meta(attacker.publicKey, true, true), meta(SYSTEM),
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});

  function p0Parts(amount) {
    const start = cloneIx(p0StartTemplate);
    const borrow = cloneIx(p0BorrowTemplate);
    const repay = cloneIx(p0RepayTemplate);
    const end = cloneIx(p0EndTemplate);
    start.keys[0].pubkey = marginfiAccount.publicKey;
    start.keys[1].pubkey = attacker.publicKey;
    borrow.keys[1].pubkey = marginfiAccount.publicKey;
    borrow.keys[2].pubkey = attacker.publicKey;
    borrow.keys[4].pubkey = attackerUsdc;
    repay.keys[1].pubkey = marginfiAccount.publicKey;
    repay.keys[2].pubkey = attacker.publicKey;
    repay.keys[4].pubkey = attackerUsdc;
    end.keys[0].pubkey = marginfiAccount.publicKey;
    end.keys[2].pubkey = attacker.publicKey;
    borrow.data.writeBigUInt64LE(amount, 8);
    repay.data.writeBigUInt64LE(amount, 8);
    return {start, borrow, repay, end};
  }

  const klendTemplateTx = klendHistory.hits[0].transaction;
  const klendBorrowTemplate = historyIx(klendTemplateTx, 3);
  const klendRepayTemplate = historyIx(klendTemplateTx, 13);
  const klendReserveRow = klendCensus.activeZero
    .filter((row) => row.mint === USDC.toBase58())
    .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
  if (!klendReserveRow) throw new Error('No current zero-fee KLend USDC reserve');
  const klendMarket = P(klendReserveRow.market);
  const klendMarketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), klendMarket.toBuffer()], KLEND,
  )[0];

  function klendParts(amount) {
    const borrow = cloneIx(klendBorrowTemplate);
    const repay = cloneIx(klendRepayTemplate);
    for (const ix of [borrow, repay]) {
      for (const [index, pubkey] of Object.entries({
        0: attacker.publicKey, 1: klendMarketAuthority, 2: klendMarket,
        3: P(klendReserveRow.reserve), 4: USDC, 5: P(klendReserveRow.supplyVault),
        6: attackerUsdc, 7: P(klendReserveRow.feeVault), 11: TOKEN,
      })) ix.keys[Number(index)].pubkey = pubkey;
      ix.data.writeBigUInt64LE(amount, 8);
    }
    return {borrow, repay};
  }

  const saveBorrowSourceIndex = saveSource.transaction.message.instructions.findIndex((ix) => {
    const keys = [...saveSource.transaction.message.accountKeys,
      ...(saveSource.meta.loadedAddresses?.writable || []),
      ...(saveSource.meta.loadedAddresses?.readonly || [])];
    return keys[ix.programIdIndex] === SAVE.toBase58() && Buffer.from(bs58.decode(ix.data))[0] === 19;
  });
  const saveRepaySourceIndex = saveSource.transaction.message.instructions.findIndex((ix) => {
    const keys = [...saveSource.transaction.message.accountKeys,
      ...(saveSource.meta.loadedAddresses?.writable || []),
      ...(saveSource.meta.loadedAddresses?.readonly || [])];
    return keys[ix.programIdIndex] === SAVE.toBase58() && Buffer.from(bs58.decode(ix.data))[0] === 20;
  });
  if (saveBorrowSourceIndex < 0 || saveRepaySourceIndex < 0)
    throw new Error('Save source flash pair unavailable');
  const saveBorrowTemplate = historyIx(saveSource, saveBorrowSourceIndex);
  const saveRepayTemplate = historyIx(saveSource, saveRepaySourceIndex);

  const saveRowsRaw = await rpc(UPSTREAM, 'getProgramAccounts', [SAVE.toBase58(), {
    encoding: 'base64', commitment: 'confirmed',
    filters: [{dataSize: 619}, {memcmp: {offset: 42, bytes: USDC.toBase58()}}],
  }]);
  const saveRows = saveRowsRaw.map((row) => {
    const data = Buffer.from(row.account.data[0], 'base64');
    return {reserve: row.pubkey, market: new PublicKey(data.subarray(10, 42)).toBase58(),
      mint: new PublicKey(data.subarray(42, 74)).toBase58(),
      supplyVault: new PublicKey(data.subarray(75, 107)).toBase58(),
      availableRaw: data.readBigUInt64LE(171).toString(),
      flashLoanFeeWad: data.readBigUInt64LE(314).toString(),
      hostFeePercentage: data[322],
      feeReceiver: new PublicKey(data.subarray(339, 371)).toBase58()};
  }).sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1);
  const saveReserve = saveRows[0];
  if (!saveReserve) throw new Error('No current Save USDC reserve');
  const saveMarket = P(saveReserve.market);
  const saveMarketAuthority = PublicKey.findProgramAddressSync(
    [saveMarket.toBuffer()], SAVE,
  )[0];

  function saveParts(amount) {
    const borrow = cloneIx(saveBorrowTemplate);
    const repay = cloneIx(saveRepayTemplate);
    for (const [index, pubkey] of Object.entries({
      0: P(saveReserve.supplyVault), 1: attackerUsdc, 2: P(saveReserve.reserve),
      3: saveMarket, 4: saveMarketAuthority, 5: IX_SYSVAR, 6: TOKEN,
    })) borrow.keys[Number(index)].pubkey = pubkey;
    for (const [index, pubkey] of Object.entries({
      0: attackerUsdc, 1: P(saveReserve.supplyVault), 2: P(saveReserve.feeReceiver),
      3: attackerUsdc, 4: P(saveReserve.reserve), 5: saveMarket,
      6: attacker.publicKey, 7: IX_SYSVAR, 8: TOKEN,
    })) repay.keys[Number(index)].pubkey = pubkey;
    borrow.data.writeBigUInt64LE(amount, 1);
    repay.data.writeBigUInt64LE(amount, 1);
    return {borrow, repay};
  }

  function buildRoute({p0 = 0n, klend = 0n, save = 0n, setup = [], candidate = null}) {
    const instructions = [...setup];
    const pp = p0 > 0n ? p0Parts(p0) : null;
    const kp = klend > 0n ? klendParts(klend) : null;
    const sp = save > 0n ? saveParts(save) : null;
    if (pp) instructions.push(p0Init, pp.start);
    if (kp) instructions.push(kp.borrow);
    if (sp) instructions.push(sp.borrow);
    if (pp) instructions.push(pp.borrow);
    if (candidate) instructions.push(candidate);
    if (pp) instructions.push(pp.repay);
    if (sp) instructions.push(sp.repay);
    if (kp) instructions.push(kp.repay);
    if (pp) instructions.push(pp.end);
    if (pp) pp.start.data.writeBigUInt64LE(BigInt(instructions.indexOf(pp.end)), 8);
    if (kp) kp.repay.data[16] = instructions.indexOf(kp.borrow);
    if (sp) sp.repay.data[9] = instructions.indexOf(sp.borrow);
    return instructions;
  }

  const watched = [
    attacker.publicKey, attackerUsdc, attackerBonk, attackerUsdInfra, attackerLp,
    marginfiAccount.publicKey, p0Bank, p0Vault,
    P(klendReserveRow.reserve), P(klendReserveRow.supplyVault), P(klendReserveRow.feeVault),
    P(saveReserve.reserve), P(saveReserve.supplyVault), P(saveReserve.feeReceiver),
    BONK_LOAN, BONK_VAULT, BONK_STRATEGY, BONK_STRATEGY_USDC,
    USD_LENDER_VAULT, USD_STRATEGY, USD_STRATEGY_TA, USD_LENDER_TA, ADMIN_STATE,
  ];
  const labels = [
    'attacker', 'attackerUSDC', 'attackerBONK', 'attackerUSDinfra', 'attackerLP',
    'freshMarginfiAccount', 'project0Bank', 'project0LiquidityVault',
    'klendReserve', 'klendSupplyVault', 'klendFeeVault',
    'saveReserve', 'saveSupplyVault', 'saveFeeReceiver',
    'bonkLoan', 'bonkCollateralVault', 'bonkStrategy', 'bonkStrategyUSDC',
    'usdVaultPda', 'usdStrategy', 'usdStrategyTokenAccount', 'usdVaultTokenAccount',
    'protocolAdminState',
  ];
  for (const address of watched) await rpc(FORK, 'getAccountInfo', [
    address.toBase58(), {encoding: 'base64', commitment: 'processed'},
  ]);
  const baseline = await rpc(FORK, 'getMultipleAccounts', [
    watched.map(String), {encoding: 'base64', commitment: 'processed'},
  ]);
  const baselineImages = baseline.value.map(accountImage);
  const p0Available = BigInt(tokenAmount(baseline.value[7]) || 0);
  const klendReserveData = Buffer.from(baseline.value[8].data[0], 'base64');
  const klendAvailable = klendReserveData.readBigUInt64LE(224);
  const saveReserveData = Buffer.from(baseline.value[11].data[0], 'base64');
  const saveAvailable = saveReserveData.readBigUInt64LE(171);
  const strategyTokenDataLength = Buffer.from(baseline.value[20].data[0], 'base64').length;
  const forkStrategyRentMinimum = BigInt(await rpc(FORK,
    'getMinimumBalanceForRentExemption', [strategyTokenDataLength, {commitment: 'processed'}]));
  const strategyRentTopup = forkStrategyRentMinimum > BigInt(baseline.value[20].lamports) ?
    forkStrategyRentMinimum - BigInt(baseline.value[20].lamports) : 0n;

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'local Surfpool fork only; signed simulations with sigVerify:true; no sendTransaction',
    programId: LOOP.toBase58(), forkBaselineSlot: baseline.context.slot,
    attacker: {authority: attacker.publicKey.toBase58(),
      freshMarginfiAccount: marginfiAccount.publicKey.toBase58(),
      generatedEphemeralKeysOnly: true, syntheticLamports: '20000000000',
      syntheticUsdcFeeSeedRaw: syntheticUsdcSeed.toString(),
      feeSeedReason: 'Pay the real fee of the independent Save lender in positive controls; excluded from exploit proceeds and reconciled by raw delta.'},
    sources: {
      project0: {program: P0.toBase58(), sourceSignature: P0_SOURCE_SIG,
        sourceSlot: p0Source.slot, group: p0Group.toBase58(), bank: p0Bank.toBase58(),
        liquidityVault: p0Vault.toBase58(), observedAvailableRaw: p0Available.toString(),
        fee: 'No same-transaction principal fee observed in positive controls.'},
      klend: {program: KLEND.toBase58(), sourceSignature: klendHistory.hits[0].signature,
        sourceSlot: klendHistory.hits[0].slot, reserve: klendReserveRow.reserve,
        market: klendReserveRow.market, supplyVault: klendReserveRow.supplyVault,
        feeVault: klendReserveRow.feeVault, observedAvailableRaw: klendAvailable.toString(),
        observedSupplyRaw: tokenAmount(baseline.value[9]),
        flashLoanFeeSf: klendReserveData.readBigUInt64LE(4904).toString(),
        repeatBorrowConstraint: 'A separate signed-fork duplicate-borrow case is included.'},
      save: {program: SAVE.toBase58(), sourceSignature: SAVE_SOURCE_SIG,
        sourceSlot: saveSource.slot, matchingUsdcReserveCount: saveRows.length,
        reserve: saveReserve.reserve, market: saveReserve.market,
        marketAuthority: saveMarketAuthority.toBase58(), supplyVault: saveReserve.supplyVault,
        feeReceiver: saveReserve.feeReceiver, observedAvailableRaw: saveAvailable.toString(),
        observedSupplyRaw: tokenAmount(baseline.value[12]),
        flashLoanFeeWad: saveReserve.flashLoanFeeWad,
        flashLoanFeeScale: '1e18', hostFeePercentage: saveReserve.hostFeePercentage,
        repeatBorrowConstraint: 'Current program rejects multiple flash borrows in one transaction; a signed-fork duplicate-borrow case is included.'},
    },
    limits: {maxBytes: 4096, maxInlineAccounts: 64, transactionVersion: 1},
    forkRuntimeNormalization: {strategyTokenAccount: USD_STRATEGY_TA.toBase58(),
      copiedMainnetLamports: String(baseline.value[20].lamports),
      copiedDataLength: strategyTokenDataLength,
      forkRentMinimumLamports: forkStrategyRentMinimum.toString(),
      outsiderTransferTopupRawLamports: strategyRentTopup.toString(),
      reason: 'Surfpool rent parameters exceed the copied mainnet account balance. A normal signed System transfer inside only the withdraw_user_vault test removes this emulator-only precondition; the failed transaction rolls the transfer back.'},
    watched: Object.fromEntries(labels.map((label, i) => [label, watched[i].toBase58()])),
    baselineAccounts: Object.fromEntries(labels.map((label, i) => [label, baselineImages[i]])),
    sourceBoundaries: {}, cases: [], inventoryNotes: [],
  };
  checkpoint(report);

  const signerMap = new Map([
    [attacker.publicKey.toBase58(), attacker],
    [marginfiAccount.publicKey.toBase58(), marginfiAccount],
  ]);

  async function runCase(label, instructions, options = {}) {
    try {
      const blockhash = (await rpc(FORK, 'getLatestBlockhash',
        [{commitment: 'processed'}])).value.blockhash;
      const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
      const {signed, signerOrder} = signEncoded(
        encoded, instructions, attacker.publicKey, blockhash, signerMap,
      );
      const simulation = await rpc(FORK, 'simulateTransaction', [signed.toString('base64'), {
        encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
        commitment: 'processed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: watched.map(String)},
      }]);
      const post = simulation.value.accounts || [];
      const persisted = options.persistedCheck ? await rpc(FORK, 'getMultipleAccounts', [
        watched.map(String), {encoding: 'base64', commitment: 'processed'},
      ]) : null;
      const row = {label, simulationSlot: simulation.context.slot,
        sigVerify: true, err: simulation.value.err,
        unitsConsumed: simulation.value.unitsConsumed,
        wire: {version: 1, bytes: encoded.sizeBytes, inlineAccounts: encoded.addressCount,
          instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
          signerOrder, signedSha256: sha256(signed), within4096Bytes: encoded.sizeBytes <= 4096,
          within64Accounts: encoded.addressCount <= 64},
        relevantLogs: compactLogs(simulation.value.logs)};
      if (options.metadata) row.metadata = options.metadata;
      if (options.full) {
        row.simulatedPostAccounts = Object.fromEntries(labels.map((name, i) =>
          [name, accountImage(post[i])]));
        row.simulatedTokenDeltasRaw = Object.fromEntries(labels.map((name, i) => {
          const before = baselineImages[i]?.tokenAmountRaw;
          const after = accountImage(post[i])?.tokenAmountRaw;
          return [name, before !== null && before !== undefined && after !== null && after !== undefined ?
            (BigInt(after) - BigInt(before)).toString() : null];
        }));
      }
      if (persisted) {
        row.persistedForkAfterSlot = persisted.context.slot;
        row.persistedStateMatchesBaseline = persisted.value.every((account, i) =>
          JSON.stringify(accountImage(account)) === JSON.stringify(baselineImages[i]));
      }
      return row;
    } catch (error) {
      return {label, constructionOrTransportError: error.stack || error.message,
        sigVerify: true};
    }
  }

  const sourceBuilder = {
    project0: (amount) => buildRoute({p0: amount}),
    klend: (amount) => buildRoute({klend: amount}),
    save: (amount) => buildRoute({save: amount}),
  };
  const observed = {project0: p0Available, klend: klendAvailable, save: saveAvailable};
  const boundaryCache = new Map();
  async function boundaryCase(provider, name, amount, full = false) {
    const key = `${provider}:${amount}`;
    if (boundaryCache.has(key)) return boundaryCache.get(key);
    const row = await runCase(`${provider}_${name}`, sourceBuilder[provider](amount),
      {full, metadata: {provider, amountRaw: amount.toString()}});
    boundaryCache.set(key, row);
    return row;
  }

  for (const provider of ['project0', 'klend', 'save']) {
    const available = observed[provider];
    const stateBoundary = [];
    for (const [name, amount] of [
      ['observed_available_minus_one', available - 1n],
      ['observed_available_exact', available],
      ['observed_available_plus_one', available + 1n],
    ]) stateBoundary.push(await boundaryCase(provider, name, amount, true));
    const exactPasses = stateBoundary[1].err === null && !stateBoundary[1].constructionOrTransportError;
    let maximum = exactPasses ? available : 0n;
    const searchTrace = [];
    if (!exactPasses) {
      let low = 0n;
      let high = available;
      while (low + 1n < high) {
        const mid = (low + high) / 2n;
        const row = await boundaryCase(provider, 'binary_search', mid, false);
        const passes = row.err === null && !row.constructionOrTransportError;
        searchTrace.push({amountRaw: mid.toString(), passes, err: row.err || null,
          relevantLogs: row.relevantLogs?.slice(-4) || null});
        if (passes) low = mid;
        else high = mid;
      }
      maximum = low;
    }
    const routeBoundary = [];
    for (const [name, amount] of [
      ['route_maximum_minus_one', maximum > 0n ? maximum - 1n : 0n],
      ['route_maximum_exact', maximum],
      ['route_maximum_plus_one', maximum + 1n],
    ]) {
      if (amount > 0n) routeBoundary.push(await runCase(`${provider}_${name}`,
        sourceBuilder[provider](amount), {full: true,
          metadata: {provider, amountRaw: amount.toString()}}));
    }
    report.sourceBoundaries[provider] = {observedAvailableRaw: available.toString(),
      observedStateBoundary: stateBoundary, searchTrace,
      maximumRouteValidRaw: maximum.toString(), maximumRouteBoundary: routeBoundary};
    checkpoint(report);
    console.log(JSON.stringify({phase: 'source-boundary', provider,
      observedAvailableRaw: available.toString(), maximumRouteValidRaw: maximum.toString(),
      stateBoundary: stateBoundary.map((row) => [row.metadata?.amountRaw, row.err || null])}));
  }

  const p0Max = BigInt(report.sourceBoundaries.project0.maximumRouteValidRaw);
  const klendMax = BigInt(report.sourceBoundaries.klend.maximumRouteValidRaw);
  const saveMax = BigInt(report.sourceBoundaries.save.maximumRouteValidRaw);
  const maxCombined = p0Max + klendMax + saveMax;

  const maxControl = await runCase('maximum_three_provider_control', buildRoute({
    p0: p0Max, klend: klendMax, save: saveMax,
  }), {full: true, persistedCheck: true, metadata: {
    allocationRaw: {project0: p0Max.toString(), klend: klendMax.toString(),
      save: saveMax.toString(), combined: maxCombined.toString()},
    asymmetric: new Set([p0Max.toString(), klendMax.toString(), saveMax.toString()]).size > 1,
    expected: 'All three lenders borrow and repay in one atomic signed v1 control.',
  }});
  report.cases.push(maxControl);
  checkpoint(report);

  // Explicitly confirm program-global repeat-borrow guards instead of summing
  // multiple displayed reserve balances from the same provider.
  {
    const first = klendParts(1n);
    const second = klendParts(1n);
    const ixs = [first.borrow, first.repay, second.borrow, second.repay];
    first.repay.data[16] = 0;
    second.repay.data[16] = 2;
    report.cases.push(await runCase('klend_duplicate_flash_borrow_blocker', ixs,
      {full: true, persistedCheck: true, metadata: {amountEachRaw: '1'}}));
  }
  {
    const first = saveParts(1000n);
    const second = saveParts(1000n);
    const ixs = [first.borrow, first.repay, second.borrow, second.repay];
    first.repay.data[9] = 0;
    second.repay.data[9] = 2;
    report.cases.push(await runCase('save_duplicate_flash_borrow_blocker', ixs,
      {full: true, persistedCheck: true, metadata: {amountEachRaw: '1000'}}));
  }
  checkpoint(report);

  const bonkAtaSetup = spl.createAssociatedTokenAccountIdempotentInstruction(
    attacker.publicKey, attackerBonk, attacker.publicKey, BONK,
  );
  const debtCoverTotal = 900000000000n;
  const p0Asym = p0Max < 123456789123n ? p0Max : 123456789123n;
  const klendAsym = klendMax < 543210987654n ? klendMax : 543210987654n;
  const saveAsym = debtCoverTotal > p0Asym + klendAsym ?
    debtCoverTotal - p0Asym - klendAsym : 1000000000n;
  const liquidation = liquidateInstruction(attacker.publicKey, attackerUsdc, attackerBonk);
  for (const [label, allocation] of [
    ['bonk_liquidation_asymmetric_debt_cover',
      {p0: p0Asym, klend: klendAsym, save: saveAsym}],
    ['bonk_liquidation_maximum_three_provider',
      {p0: p0Max, klend: klendMax, save: saveMax}],
  ]) {
    report.cases.push(await runCase(label, buildRoute({
      ...allocation, setup: [bonkAtaSetup], candidate: liquidation,
    }), {full: true, persistedCheck: true, metadata: {
      allocationRaw: Object.fromEntries(Object.entries(allocation).map(([key, value]) =>
        [key, value.toString()])),
      combinedRaw: (allocation.p0 + allocation.klend + allocation.save).toString(),
      route: ['create attacker BONK ATA', 'Project0 start', 'KLend borrow', 'Save borrow',
        'Project0 borrow', 'Loopscale liquidate_ledger', 'Project0 repay',
        'Save repay', 'KLend repay', 'Project0 end'],
      unwind: 'No swap is inserted because current Loopscale rejects before any BONK transfer. The later lender repayments are encoded but unreachable; transaction failure atomically restores every lender and target account.',
    }}));
  }
  checkpoint(report);

  const small = {
    p0: p0Max >= 1000n ? 1000n : p0Max,
    klend: klendMax >= 1000n ? 1000n : klendMax,
    save: saveMax >= 1000n ? 1000n : saveMax,
  };
  const usdVaultAtaSetup = spl.createAssociatedTokenAccountIdempotentInstruction(
    attacker.publicKey, USD_LENDER_TA, USD_LENDER_VAULT, USD_INFRA, TOKEN_2022,
  );
  const userUsdSetup = spl.createAssociatedTokenAccountIdempotentInstruction(
    attacker.publicKey, attackerUsdInfra, attacker.publicKey, USD_INFRA, TOKEN_2022,
  );
  const userLpSetup = spl.createAssociatedTokenAccountIdempotentInstruction(
    attacker.publicKey, attackerLp, attacker.publicKey, USD_LP_MINT, TOKEN_2022,
  );
  const strategyRentSetup = strategyRentTopup > 0n ? [SystemProgram.transfer({
    fromPubkey: attacker.publicKey, toPubkey: USD_STRATEGY_TA,
    lamports: Number(strategyRentTopup),
  })] : [];
  const authCases = [
    ['usd_withdraw_strategy_three_provider_auth_gate', [usdVaultAtaSetup],
      withdrawStrategyInstruction(attacker.publicKey),
      'Real lender is an off-curve Vault PDA and cannot sign this top-level outsider transaction.'],
    ['bonk_withdraw_collateral_three_provider_auth_gate', [bonkAtaSetup],
      withdrawCollateralInstruction(attacker.publicKey, attackerBonk),
      'Outsider is not the current protocol admin and is not the selected loan borrower.'],
    ['usd_withdraw_user_vault_three_provider_auth_and_equity_gate',
      [...strategyRentSetup, userUsdSetup, userLpSetup],
      withdrawUserVaultInstruction(attacker.publicKey, attackerLp, attackerUsdInfra),
      'Outsider is not protocol admin and has no victim LP shares to burn.'],
  ];
  for (const [label, setup, candidate, blocker] of authCases) {
    report.cases.push(await runCase(label, buildRoute({
      ...small, setup, candidate,
    }), {full: true, persistedCheck: true, metadata: {allocationRaw: Object.fromEntries(
      Object.entries(small).map(([key, value]) => [key, value.toString()])), blocker,
      capitalSensitivity: 'Flash balances cannot create the required signer/PDA/admin/LP authority.'}}));
  }

  const decodedBank = marginfiCoder.decode('Bank', Buffer.from(baseline.value[6].data[0], 'base64'));
  report.sources.project0.currentBankGroup = decodedBank.group.toBase58();
  report.maximumValidatedThreeProviderRaw = maxCombined.toString();
  report.maximumValidatedThreeProviderUiUsdc = Number(maxCombined) / 1e6;
  report.inventoryNotes = [
    'Project0 has six current USDC Banks in the same group, but only the selected Bank has material liquidity; the other nonzero vaults total 179 raw USDC at the inventory snapshot. The maximum figure is the signed route-valid maximum of the material Bank, not the sum of displayed vault balances.',
    'KLend has multiple USDC Reserves, but its current program rejects a second flash borrow anywhere in the same transaction (MultipleFlashBorrows). The selected reserve is the largest observed exact-zero-fee USDC reserve.',
    'Save has 153 matching USDC Reserves, but its current program likewise rejects multiple flash borrows in one transaction. The selected reserve is the largest observed USDC reserve and charges the decoded live fee.',
    'Jupiter Lend native flash inventory in this workspace has USDe, PYUSD, and USDG but no USDC reserve; adding a stable-swap leg cannot influence the Loopscale liquidation eligibility or signer gates and would only add route/price risk.',
    'Mango v4 and Drift expose flash/swap-style facilities but require protocol account/health or two-market swap state not reconstructed in this target task. They are not counted as validated capacity. This does not weaken the target conclusion because every tested Loopscale path rejects before capital amount can affect target state.',
  ];
  report.conclusion = {
    validatedDrain: false,
    reason: 'The only outsider asset-transfer candidate, liquidate_ledger, is rejected by the current Loopscale account constraint before collateral transfer at both debt-covering asymmetric and maximum validated three-provider capital. Direct exits are independently signer/admin/PDA/LP gated.',
    realizedOutsiderGainRaw: '0',
    liveSubmission: false,
  };
  checkpoint(report);
  console.log(JSON.stringify({output: OUT, forkBaselineSlot: report.forkBaselineSlot,
    maximumValidatedThreeProviderRaw: report.maximumValidatedThreeProviderRaw,
    cases: report.cases.map((row) => ({label: row.label, err: row.err || null,
      constructionOrTransportError: row.constructionOrTransportError || null,
      bytes: row.wire?.bytes, accounts: row.wire?.inlineAccounts,
      units: row.unitsConsumed, persistedStateMatchesBaseline: row.persistedStateMatchesBaseline})),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
