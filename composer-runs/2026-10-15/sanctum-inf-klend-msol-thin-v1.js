#!/usr/bin/env node
'use strict';

// Current-mainnet, read-only v1 simulation harness. Calls get* and
// simulateTransaction only; it never signs or submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction, createInitializeAccount3Instruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs.default || bs;

const DIR = __dirname;
function rpcUrl() {
  if (process.env.HEAVY_RPC_URL || process.env.RPC_URL || process.env.SOLANA_RPC) return process.env.HEAVY_RPC_URL || process.env.RPC_URL || process.env.SOLANA_RPC;
  const rows = fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map((row) => row.split(/=(.*)/s).slice(0, 2));
  const env = Object.fromEntries(rows);
  return env.HEAVY_RPC_URL || env.RPC_URL;
}
const RPC_URL = rpcUrl();
if (!RPC_URL) throw new Error('RPC URL required');
const OUT = `${DIR}/sanctum-inf-klend-msol-thin-v1.json`;
const CONTROL_INDEX = `${DIR}/sanctum-inf-control-index.json`;
const conn = new Connection(RPC_URL, 'processed');
const P = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RESERVE = P('FpuQaFELdfNy5EETntTBrNAMbduRvrGz1oKJKN1NBSfr');
const OWNER = P('KMhcqNpDomyUVSK9WDr8uve29oeSoA4TZPGV34EA3JB');
const MSOL_ACCOUNT = P('CawhgG7R6EhPDZ9UCC74ea8fK2o5iA25QceAT9WqWmon');
const MSOL = P('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const INF = P('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
const INF_MINT = P('5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm');
const WSOL = P('So11111111111111111111111111111111111111112');
const POOL = P('AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW');
const LIST = P('Gb7m4daakbVbrFLR33FKMDVMHAprRZ66CSYt4bpFwUgS');
const INF_MSOL_RESERVE = P('4poUr2pTjTbBdbk9YvGcscQrJZrTutgGAPXGQnE1gpax');
const idl = JSON.parse(fs.readFileSync(`${DIR}/marginfi-source/idls-complete/kamino_lending.json`));
const coder = new anchor.BorshAccountsCoder(idl);
let rpcId = 0;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const clone = (ix) => new TransactionInstruction({programId: ix.programId, data: Buffer.from(ix.data), keys: ix.keys.map((key) => ({...key}))});
const u64 = (value) => { const data = Buffer.alloc(8); data.writeBigUInt64LE(value); return data; };

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function decompile(signature) {
  const row = await rpc('getTransaction', [signature, {encoding: 'base64', maxSupportedTransactionVersion: 1}]);
  if (!row) throw new Error(`missing ${signature}`);
  const wire = VersionedTransaction.deserialize(Buffer.from(row.transaction[0], 'base64'));
  const alts = await Promise.all((wire.message.addressTableLookups || []).map(async ({accountKey}) => {
    const result = await conn.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing ALT ${accountKey}`);
    return result.value;
  }));
  return {slot: row.slot, blockTime: row.blockTime, message: TransactionMessage.decompile(wire.message, {addressLookupTableAccounts: alts})};
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message([]);
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  if (compiled.addressTableLookups.length) throw new Error('v1 cannot contain ALT');
  if (keys.length > 64 || items.length > 64) throw new Error(`v1 limits ${keys.length}/${items.length}`);
  const cfg = Buffer.alloc(8); cfg.writeUInt32LE(computeLimit, 0); cfg.writeUInt32LE(dataLimit, 4);
  const heads = items.map((ix) => { const out = Buffer.alloc(4); out[0] = ix.programIdIndex; out[1] = ix.accountKeyIndexes.length; out.writeUInt16LE(ix.data.length, 2); return out; });
  const payloads = items.map((ix) => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const header = compiled.header;
  const wire = Buffer.concat([
    Buffer.from([0x81, header.numRequiredSignatures, header.numReadonlySignedAccounts, header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)), Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()), cfg, ...heads, ...payloads, Buffer.alloc(64 * header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size ${wire.length}`);
  const unsignedStart = keys.length - header.numReadonlyUnsignedAccounts;
  const writableSignedEnd = header.numRequiredSignatures - header.numReadonlySignedAccounts;
  return {wire, detail: {
    version: 1, versionPrefixHex: '81', maxBytes: 4096, maxInlineAddresses: 64,
    computeLimit, loadedAccountsDataSizeLimit: dataLimit, wireBytes: wire.length, wireSha256: sha256(wire),
    unsignedSimulationWireBase64: wire.toString('base64'), requiredSignatures: header.numRequiredSignatures,
    accountCount: keys.length, instructionCount: items.length,
    accounts: keys.map((key, index) => ({index, address: key.toBase58(), signer: index < header.numRequiredSignatures, writable: index < header.numRequiredSignatures ? index < writableSignedEnd : index < unsignedStart})),
    instructions: items.map((ix, index) => ({index, programIdIndex: ix.programIdIndex, programId: keys[ix.programIdIndex].toBase58(), accountKeyIndexes: [...ix.accountKeyIndexes], dataHex: Buffer.from(ix.data).toString('hex')})),
  }};
}

function flashIx(kind, reserve, userToken, amount, borrowIndex) {
  const market = P(reserve.lending_market);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND);
  const data = Buffer.concat([Buffer.from(kind === 'borrow' ? [135, 231, 52, 167, 7, 52, 212, 193] : [185, 117, 0, 203, 96, 245, 180, 186]), u64(amount), ...(kind === 'repay' ? [Buffer.from([borrowIndex])] : [])]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    {pubkey: OWNER, isSigner: true, isWritable: true}, {pubkey: authority, isSigner: false, isWritable: false},
    {pubkey: market, isSigner: false, isWritable: false}, {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: MSOL, isSigner: false, isWritable: false}, {pubkey: P(reserve.liquidity.supply_vault), isSigner: false, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true}, {pubkey: P(reserve.liquidity.fee_vault), isSigner: false, isWritable: true},
    {pubkey: KLEND, isSigner: false, isWritable: false}, {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false}, {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function liquidityData(discriminator, amount) {
  const data = Buffer.alloc(22); data[0] = discriminator; data[1] = 5; data.writeUInt32LE(17, 2); data.writeBigUInt64LE(amount, 6); return data;
}

function view(account, kind) {
  if (!account) return null;
  const data = account.data ? (Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64')) : Buffer.alloc(0);
  if (kind === 'system') return {lamports: String(account.lamports)};
  if (kind === 'token') return data.length >= 72 ? {rawAmount: data.readBigUInt64LE(64).toString(), lamports: String(account.lamports)} : null;
  if (kind === 'mint') return data.length >= 44 ? {rawSupply: data.readBigUInt64LE(36).toString(), lamports: String(account.lamports)} : null;
  if (kind === 'pool') return data.length >= 240 ? {dataSha256: sha256(data), totalSolValueLamports: data.readBigUInt64LE(0).toString(), protocolFeeLamports: data.readBigUInt64LE(224).toString(), lastReleaseSlot: data.readBigUInt64LE(232).toString()} : null;
  return {dataSha256: sha256(data), lamports: String(account.lamports)};
}

async function simulate(label, instructions, watched, exact = false) {
  const pre = await conn.getMultipleAccountsInfo(watched.map((row) => row.address), 'processed');
  const {blockhash} = await conn.getLatestBlockhash('processed');
  const encoded = encodeV1(instructions, OWNER, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed', innerInstructions: true, accounts: {encoding: 'base64', addresses: watched.map((row) => row.address.toBase58())}}]);
  const state = Object.fromEntries(watched.map((row, index) => {
    const address = row.address.toBase58();
    const before = view(pre[index], row.kind);
    const after = view(result.value.accounts?.[index], row.kind);
    const delta = (field) => before?.[field] != null && after?.[field] != null ? (BigInt(after[field]) - BigInt(before[field])).toString() : null;
    return [address, {label: row.label, kind: row.kind, before, after, rawAmountDelta: delta('rawAmount'), rawSupplyDelta: delta('rawSupply'), lamportsDelta: delta('lamports')}];
  }));
  const detail = exact ? encoded.detail : {version: 1, maxBytes: 4096, maxInlineAddresses: 64, wireBytes: encoded.detail.wireBytes, wireSha256: encoded.detail.wireSha256, requiredSignatures: encoded.detail.requiredSignatures, accountCount: encoded.detail.accountCount, instructionCount: encoded.detail.instructionCount};
  return {label, slot: result.context?.slot, err: result.value.err, unitsConsumed: result.value.unitsConsumed, loadedAccountsDataSize: result.value.loadedAccountsDataSize, message: detail, state, logs: (result.value.logs || []).filter((line) => line.includes('Instruction:') || line.includes('Program return:') || line.includes('Error') || line.includes('failed')).slice(-70)};
}

async function main() {
  const reserveInfo = await conn.getAccountInfo(RESERVE, 'processed');
  if (!reserveInfo || !reserveInfo.owner.equals(KLEND)) throw new Error('reserve owner mismatch');
  const reserve = coder.decode('Reserve', reserveInfo.data);
  const available = BigInt(reserve.liquidity.total_available_amount.toString());
  const feeSf = BigInt(reserve.config.fees.flash_loan_fee_sf.toString());
  if (!P(reserve.liquidity.mint_pubkey).equals(MSOL) || feeSf !== 0n) throw new Error('not exact-zero-fee mSOL');

  const index = JSON.parse(fs.readFileSync(CONTROL_INDEX, 'utf8'));
  const direct = index.found.find((row) => row.discriminator === 23 && row.accounts[1] === WSOL.toBase58() && row.accounts[2] === INF_MINT.toBase58());
  const syncRow = index.found.find((row) => row.discriminator === 0 && row.accounts[0] === MSOL.toBase58() && row.dataHex === '0011000000');
  const [directControl, syncControl] = await Promise.all([decompile(direct.signature), decompile(syncRow.signature)]);
  const v2 = directControl.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 23);
  const sync = syncControl.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 0 && ix.data.readUInt32LE(1) === 17);
  if (!v2 || !sync || sync.keys.length !== 9) throw new Error('control extraction failed');

  const infAta = getAssociatedTokenAddressSync(INF_MINT, OWNER);
  const createInf = createAssociatedTokenAccountIdempotentInstruction(OWNER, infAta, OWNER, INF_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const suffix = [...sync.keys.slice(4).map((key) => ({...key})), ...v2.keys.slice(13).map((key) => ({...key}))];
  const liqKeys = (lstAccount) => [
    {pubkey: OWNER, isSigner: true, isWritable: true}, {pubkey: MSOL, isSigner: false, isWritable: false},
    {pubkey: lstAccount, isSigner: false, isWritable: true}, {pubkey: infAta, isSigner: false, isWritable: true},
    {pubkey: INF_MINT, isSigner: false, isWritable: true}, {pubkey: POOL, isSigner: false, isWritable: true},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false}, {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    {pubkey: POOL, isSigner: false, isWritable: true}, {pubkey: LIST, isSigner: false, isWritable: true},
    {pubkey: INF_MSOL_RESERVE, isSigner: false, isWritable: true}, ...suffix,
  ];
  const add = (lstAccount, amount) => new TransactionInstruction({programId: INF, keys: liqKeys(lstAccount), data: liquidityData(3, amount)});
  const remove = (lstAccount, amount) => new TransactionInstruction({programId: INF, keys: liqKeys(lstAccount), data: liquidityData(4, amount)});
  const supply = P(reserve.liquidity.supply_vault);
  const feeVault = P(reserve.liquidity.fee_vault);
  const temp = Keypair.generate().publicKey;
  const rent = await conn.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'processed');
  const watched = [
    {address: OWNER, kind: 'system', label: 'simulation authority wallet'},
    {address: MSOL_ACCOUNT, kind: 'token', label: 'pre-existing mSOL buffer source'},
    {address: temp, kind: 'token', label: 'new isolated mSOL flash destination and repay source'},
    {address: infAta, kind: 'token', label: 'INF share account'},
    {address: supply, kind: 'token', label: 'KLend mSOL supply vault'},
    {address: feeVault, kind: 'token', label: 'KLend mSOL fee vault'},
    {address: RESERVE, kind: 'raw', label: 'KLend reserve state'},
    {address: INF_MSOL_RESERVE, kind: 'token', label: 'thin INF mSOL reserve'},
    {address: INF_MINT, kind: 'mint', label: 'INF share mint'},
    {address: POOL, kind: 'pool', label: 'INF pool state'},
  ];

  const quoteAmounts = [1n, 2n, 3n, 4n, 10n, 100n, 1_000n, 10_000n, available - 1n];
  const quotes = [];
  const minted = new Map();
  for (const amount of quoteAmounts) {
    const result = await simulate(`authorized mSOL -> INF add quote ${amount}`, [createInf, add(MSOL_ACCOUNT, amount)], watched);
    quotes.push(result);
    const after = result.state[infAta.toBase58()]?.after?.rawAmount;
    const before = result.state[infAta.toBase58()]?.before?.rawAmount || '0';
    if (result.err == null && after != null) minted.set(amount.toString(), BigInt(after) - BigInt(before));
  }

  function composed(flashAmount, routeAmount, buffer, middleBuilder) {
    const instructions = [
      SystemProgram.createAccount({fromPubkey: OWNER, newAccountPubkey: temp, lamports: rent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID}),
      createInitializeAccount3Instruction(temp, MSOL, OWNER, TOKEN_PROGRAM_ID), createInf,
    ];
    if (buffer > 0n) instructions.push(createTransferCheckedInstruction(MSOL_ACCOUNT, MSOL, temp, OWNER, buffer, 9, [], TOKEN_PROGRAM_ID));
    const borrowIndex = instructions.length;
    instructions.push(flashIx('borrow', reserve, temp, flashAmount));
    instructions.push(...middleBuilder(routeAmount).map(clone));
    instructions.push(flashIx('repay', reserve, temp, flashAmount, borrowIndex));
    return instructions;
  }

  const results = [];
  const flashAmount = available - 1n;
  for (const routeAmount of [3n, 4n, 10n, 100n, 1_000n, 10_000n, flashAmount]) {
    const shares = minted.get(routeAmount.toString());
    if (shares == null || shares === 0n) continue;
    const buffer = routeAmount === flashAmount ? 2_000n : 100n;
    results.push(await simulate(`thin mSOL reserve flash round trip route ${routeAmount} of ${flashAmount}`, composed(flashAmount, routeAmount, buffer, (amount) => [add(temp, amount), remove(temp, shares)]), watched, routeAmount === 3n || routeAmount === flashAmount));
  }

  const nearShares = minted.get(flashAmount.toString());
  if (nearShares == null || nearShares === 0n) throw new Error(`missing near-availability share quote: ${JSON.stringify(quotes.map((row) => ({label: row.label, err: row.err, logs: row.logs})))}`);
  const positive = results.find((row) => row.label.endsWith(`route ${flashAmount} of ${flashAmount}`));
  if (positive?.err == null) {
    const tempAfter = BigInt(positive.state[temp.toBase58()]?.after?.rawAmount || 0);
    const spread = 2_000n - tempAfter;
    results.push(await simulate(`thin mSOL exact spread buffer ${spread}`, composed(flashAmount, flashAmount, spread, (amount) => [add(temp, amount), remove(temp, nearShares)]), watched, true));
    if (spread > 0n) results.push(await simulate(`thin mSOL one-short spread buffer ${spread - 1n}`, composed(flashAmount, flashAmount, spread - 1n, (amount) => [add(temp, amount), remove(temp, nearShares)]), watched));
    results.push(await simulate('thin mSOL sync before/between/after mint-burn', composed(flashAmount, flashAmount, spread, (amount) => [sync, add(temp, amount), sync, remove(temp, nearShares), sync]), watched, true));
    results.push(await simulate('thin mSOL repeated add/remove twice', composed(flashAmount, flashAmount, spread * 2n, (amount) => [add(temp, amount), remove(temp, nearShares), add(temp, amount), remove(temp, nearShares)]), watched, true));
    results.push(await simulate('thin mSOL remove-before-add ordering', composed(flashAmount, flashAmount, spread, (amount) => [remove(temp, nearShares), add(temp, amount)]), watched));
  }

  const output = {
    generatedAt: new Date().toISOString(), safety: 'read-only current-mainnet get* and simulateTransaction only; no send method', submittedTransactions: 0,
    funding: {program: KLEND.toBase58(), reserve: RESERVE.toBase58(), market: P(reserve.lending_market).toBase58(), mint: MSOL.toBase58(), supplyVault: supply.toBase58(), feeVault: feeVault.toBase58(), reserveAvailableRaw: available.toString(), flashLoanFeeSf: feeSf.toString(), flashLoanFeeScale: '2^60', configuredFeeRateIsExactlyZero: feeSf === 0n},
    target: {program: INF.toBase58(), pool: POOL.toBase58(), mint: INF_MINT.toBase58(), lstIndex: 17, thinMsolReserve: INF_MSOL_RESERVE.toBase58()},
    actor: {owner: OWNER.toBase58(), sourceMsolAccount: MSOL_ACCOUNT.toBase58(), temporaryFlashAccount: temp.toBase58(), infAta: infAta.toBase58()},
    sources: {pricingControl: {signature: direct.signature, slot: directControl.slot}, msolSync: {signature: syncRow.signature, slot: syncControl.slot}},
    quotes, results,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, funding: output.funding, results: results.map((row) => ({label: row.label, err: row.err, cu: row.unitsConsumed, bytes: row.message.wireBytes, accounts: row.message.accountCount, tempAfter: row.state[temp.toBase58()]?.after?.rawAmount}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
