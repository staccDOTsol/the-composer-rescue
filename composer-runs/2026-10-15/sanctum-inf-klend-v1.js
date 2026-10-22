#!/usr/bin/env node
'use strict';

// Current-mainnet, read-only v1 simulation harness. No signing or submission.
const crypto = require('crypto');
const fs = require('fs');
const {
  Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs.default || bs;

const DIR = __dirname;
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || process.env.SOLANA_RPC;
if (!RPC_URL) throw new Error('RPC URL required');
const OUT = `${DIR}/sanctum-inf-klend-v1.json`;
const CONTROL_INDEX = `${DIR}/sanctum-inf-control-index.json`;
const conn = new Connection(RPC_URL, 'processed');
const P = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RESERVE = P('4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
const OWNER = P('Dsg7ZFQzXuiKsBAmL78Y5V5VjN6ASkfKDxB7VUNpp6aM');
const INF = P('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
const INF_MINT = P('5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm');
const WSOL = P('So11111111111111111111111111111111111111112');
const POOL = P('AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW');
const NOOP = P('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
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
  const lendingMarket = P(reserve.lending_market);
  const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), lendingMarket.toBuffer()], KLEND);
  const data = Buffer.concat([Buffer.from(kind === 'borrow' ? [135, 231, 52, 167, 7, 52, 212, 193] : [185, 117, 0, 203, 96, 245, 180, 186]), u64(amount), ...(kind === 'repay' ? [Buffer.from([borrowIndex])] : [])]);
  return new TransactionInstruction({programId: KLEND, data, keys: [
    {pubkey: OWNER, isSigner: true, isWritable: true},
    {pubkey: marketAuthority, isSigner: false, isWritable: false},
    {pubkey: lendingMarket, isSigner: false, isWritable: false},
    {pubkey: RESERVE, isSigner: false, isWritable: true},
    {pubkey: P(reserve.liquidity.mint_pubkey), isSigner: false, isWritable: false},
    {pubkey: P(reserve.liquidity.supply_vault), isSigner: false, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: P(reserve.liquidity.fee_vault), isSigner: false, isWritable: true},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: KLEND, isSigner: false, isWritable: false},
    {pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ]});
}

function liquidityData(discriminator, amount) {
  const data = Buffer.alloc(22); data[0] = discriminator; data[1] = 1; data.writeUInt32LE(1, 2); data.writeBigUInt64LE(amount, 6); return data;
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
  const detail = exact ? encoded.detail : {version: 1, maxBytes: 4096, maxInlineAddresses: 64, computeLimit: encoded.detail.computeLimit, loadedAccountsDataSizeLimit: encoded.detail.loadedAccountsDataSizeLimit, wireBytes: encoded.detail.wireBytes, wireSha256: encoded.detail.wireSha256, requiredSignatures: encoded.detail.requiredSignatures, accountCount: encoded.detail.accountCount, instructionCount: encoded.detail.instructionCount};
  return {label, slot: result.context?.slot, err: result.value.err, unitsConsumed: result.value.unitsConsumed, loadedAccountsDataSize: result.value.loadedAccountsDataSize, message: detail, state, logs: (result.value.logs || []).filter((line) => line.includes('Instruction:') || line.includes('Program return:') || line.includes('Error') || line.includes('failed')).slice(-45)};
}

async function main() {
  const reserveInfo = await conn.getAccountInfo(RESERVE, 'processed');
  if (!reserveInfo || !reserveInfo.owner.equals(KLEND)) throw new Error('reserve owner mismatch');
  const reserve = coder.decode('Reserve', reserveInfo.data);
  const mint = P(reserve.liquidity.mint_pubkey);
  const supply = P(reserve.liquidity.supply_vault);
  const feeVault = P(reserve.liquidity.fee_vault);
  const available = BigInt(reserve.liquidity.total_available_amount.toString());
  const feeSf = BigInt(reserve.config.fees.flash_loan_fee_sf.toString());
  if (!mint.equals(WSOL) || feeSf !== 0n) throw new Error(`reserve is not exact-zero-fee wSOL: ${mint}/${feeSf}`);

  const index = JSON.parse(fs.readFileSync(CONTROL_INDEX, 'utf8'));
  const direct = index.found.find((row) => row.discriminator === 23 && row.accounts[1] === WSOL.toBase58() && row.accounts[2] === INF_MINT.toBase58());
  const syncRow = index.found.find((row) => row.discriminator === 0 && row.accounts[0] === WSOL.toBase58() && row.dataHex === '0001000000');
  const [control, syncControl] = await Promise.all([decompile(direct.signature), decompile(syncRow.signature)]);
  const v2 = control.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 23);
  const sync = syncControl.message.instructions.find((ix) => ix.programId.equals(INF) && ix.data[0] === 0 && ix.data.readUInt32LE(1) === 1);
  if (!v2 || !sync) throw new Error('INF controls missing');
  const wsolAta = getAssociatedTokenAddressSync(WSOL, OWNER);
  const infAta = getAssociatedTokenAddressSync(INF_MINT, OWNER);
  const createWsol = createAssociatedTokenAccountIdempotentInstruction(OWNER, wsolAta, OWNER, WSOL, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createInf = createAssociatedTokenAccountIdempotentInstruction(OWNER, infAta, OWNER, INF_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const liqKeys = [
    {...v2.keys[0], pubkey: OWNER}, {...v2.keys[1]}, {...v2.keys[3], pubkey: wsolAta}, {...v2.keys[4], pubkey: infAta}, {...v2.keys[2]},
    {pubkey: POOL, isSigner: false, isWritable: true}, {...v2.keys[5]}, {...v2.keys[6]}, {...v2.keys[7]}, {...v2.keys[8]}, {...v2.keys[9]}, {...v2.keys[11]}, {...v2.keys[13]}, {...v2.keys[14]},
  ];
  const add = (amount) => new TransactionInstruction({programId: INF, keys: liqKeys.map((key) => ({...key})), data: liquidityData(3, amount)});
  const remove = (amount) => new TransactionInstruction({programId: INF, keys: liqKeys.map((key) => ({...key})), data: liquidityData(4, amount)});
  const infReserve = v2.keys[9].pubkey;
  const watched = [
    {address: OWNER, kind: 'system', label: 'KLend flash authority wallet'},
    {address: wsolAta, kind: 'token', label: 'wSOL flash destination and repay source'},
    {address: infAta, kind: 'token', label: 'INF share account'},
    {address: supply, kind: 'token', label: 'KLend wSOL supply vault'},
    {address: feeVault, kind: 'token', label: 'KLend wSOL fee vault'},
    {address: RESERVE, kind: 'raw', label: 'KLend reserve state'},
    {address: infReserve, kind: 'token', label: 'INF wSOL reserve'},
    {address: INF_MINT, kind: 'mint', label: 'INF share mint'},
    {address: POOL, kind: 'pool', label: 'INF pool state'},
  ];

  const quoteAmounts = [1n, 2n, 3n, 4n, 10n, 100n, 1_000n, 10_000n, 10_000_000n];
  const quotes = [];
  const minted = new Map();
  for (const amount of quoteAmounts) {
    const result = await simulate(`funded INF add quote ${amount}`, [createWsol, createInf, SystemProgram.transfer({fromPubkey: OWNER, toPubkey: wsolAta, lamports: amount}), createSyncNativeInstruction(wsolAta), add(amount)], watched);
    quotes.push(result);
    const after = result.state[infAta.toBase58()]?.after?.rawAmount;
    const before = result.state[infAta.toBase58()]?.before?.rawAmount || '0';
    if (result.err == null && after != null) minted.set(amount.toString(), BigInt(after) - BigInt(before));
  }

  function composed(amount, buffer, middle) {
    const instructions = [createWsol, createInf, SystemProgram.transfer({fromPubkey: OWNER, toPubkey: wsolAta, lamports: buffer}), createSyncNativeInstruction(wsolAta)];
    const borrowIndex = instructions.length;
    instructions.push(flashIx('borrow', reserve, wsolAta, amount));
    instructions.push(...middle.map(clone));
    instructions.push(flashIx('repay', reserve, wsolAta, amount, borrowIndex));
    return instructions;
  }

  const results = [];
  // Pure exact-zero-fee controls prove that this is not small-fee rounding.
  for (const amount of [1n, 10_000_000n, available - 1n]) {
    const instructions = [createWsol];
    const borrowIndex = instructions.length;
    instructions.push(flashIx('borrow', reserve, wsolAta, amount));
    instructions.push(flashIx('repay', reserve, wsolAta, amount, borrowIndex));
    results.push(await simulate(`KLend exact-zero-fee wSOL pair ${amount}`, instructions, watched, amount === 1n || amount === available - 1n));
  }

  for (const amount of [2n, 3n, 4n, 10n, 100n, 1_000n, 10_000n]) {
    const shares = minted.get(amount.toString());
    if (!shares) continue;
    results.push(await simulate(`KLend flash INF dust round trip ${amount}`, composed(amount, 100n, [add(amount), remove(shares)]), watched));
  }

  const amount = 10_000_000n;
  const shares = minted.get(amount.toString());
  if (!shares) throw new Error('missing 10m INF share quote');
  const positive = await simulate('KLend exact-zero-fee wSOL -> INF add/remove -> repay', composed(amount, 100_000n, [add(amount), remove(shares)]), watched, true);
  results.push(positive);
  if (positive.err == null) {
    const left = BigInt(positive.state[wsolAta.toBase58()]?.after?.rawAmount || 0);
    const spread = 100_000n - left;
    results.push(await simulate(`KLend INF exact spread buffer ${spread}`, composed(amount, spread, [add(amount), remove(shares)]), watched, true));
    results.push(await simulate(`KLend INF one-short spread buffer ${spread - 1n}`, composed(amount, spread - 1n, [add(amount), remove(shares)]), watched));
  }
  results.push(await simulate('KLend flash two repeated INF add/remove cycles', composed(amount, 200_000n, [add(amount), remove(shares), add(amount), remove(shares)]), watched, true));
  results.push(await simulate('KLend flash INF sync before/between/after', composed(amount, 100_000n, [sync, add(amount), sync, remove(shares), sync]), watched, true));

  const near = available - 1n;
  const estimatedNearShares = near * shares / amount;
  results.push(await simulate(`KLend near-liquidity INF round trip ${near} with 40000000 buffer`, composed(near, 40_000_000n, [add(near), remove(estimatedNearShares)]), watched, true));

  // Exercise both hard v1 transport limits without changing the economic path:
  // add existing, read-only accounts to SPL Noop and pad its data to 4,096 bytes.
  const transportBase = composed(amount, 100_000n, [add(amount), remove(shares)]);
  const transportHash = (await conn.getLatestBlockhash('processed')).blockhash;
  const baseEncoded = encodeV1(transportBase, OWNER, transportHash);
  const baseKeys = new Set(baseEncoded.detail.accounts.map((row) => row.address));
  baseKeys.add(NOOP.toBase58());
  const candidates = [...new Set(index.found.flatMap((row) => row.accounts || []))]
    .filter((address) => !baseKeys.has(address));
  const infos = [];
  for (let offset = 0; offset < candidates.length && infos.length < 64; offset += 100) {
    const batch = candidates.slice(offset, offset + 100);
    const rows = await conn.getMultipleAccountsInfo(batch.map(P), 'processed');
    rows.forEach((account, i) => { if (account && account.data.length <= 200 && infos.length < 64) infos.push(batch[i]); });
  }
  const needed = 64 - baseEncoded.detail.accountCount - 1;
  if (needed < 0 || infos.length < needed) throw new Error(`not enough v1 padding accounts: need ${needed}, have ${infos.length}`);
  const noopKeys = infos.slice(0, needed).map((address) => ({pubkey: P(address), isSigner: false, isWritable: false}));
  const noopEmpty = new TransactionInstruction({programId: NOOP, keys: noopKeys, data: Buffer.alloc(0)});
  const emptyTransport = encodeV1([...transportBase, noopEmpty], OWNER, transportHash);
  const paddingBytes = 4096 - emptyTransport.wire.length;
  if (paddingBytes < 0) throw new Error(`v1 transport base already exceeds limit: ${emptyTransport.wire.length}`);
  const noopPadded = new TransactionInstruction({programId: NOOP, keys: noopKeys, data: Buffer.alloc(paddingBytes, 0x42)});
  results.push(await simulate('KLend INF completed path at exact v1 4096-byte and 64-inline-address limits', [...transportBase, noopPadded], watched, true));

  const output = {
    generatedAt: new Date().toISOString(), safety: 'read-only current-mainnet get* and simulateTransaction only; no send method', submittedTransactions: 0,
    funding: {program: KLEND.toBase58(), reserve: RESERVE.toBase58(), market: P(reserve.lending_market).toBase58(), mint: mint.toBase58(), supplyVault: supply.toBase58(), feeVault: feeVault.toBase58(), reserveAvailableRaw: available.toString(), flashLoanFeeSf: feeSf.toString(), flashLoanFeeScale: '2^60', configuredFeeRateIsExactlyZero: feeSf === 0n},
    target: {program: INF.toBase58(), pool: POOL.toBase58(), mint: INF_MINT.toBase58(), wsolReserve: infReserve.toBase58()},
    actor: {owner: OWNER.toBase58(), wsolAta: wsolAta.toBase58(), infAta: infAta.toBase58()},
    sources: {infSwap: {signature: direct.signature, slot: control.slot}, infSync: {signature: syncRow.signature, slot: syncControl.slot}},
    quotes, results,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, funding: output.funding, results: results.map((row) => ({label: row.label, err: row.err, cu: row.unitsConsumed, bytes: row.message.wireBytes, accounts: row.message.accountCount}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
