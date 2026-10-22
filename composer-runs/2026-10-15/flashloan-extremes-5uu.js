#!/usr/bin/env node
// Read-only current-state Solana v1 flashloan probes for the 5UuMS asset set.
// Calls get* and simulateTransaction only. Never signs or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const {Connection, PublicKey, TransactionInstruction, TransactionMessage} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const b = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = b.default || b;

const dir = __dirname;
function localRpc() {
  if (process.env.RPC_URL || process.env.SOLANA_RPC) return process.env.RPC_URL || process.env.SOLANA_RPC;
  const e = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8').split('\n').filter(Boolean).map(s => s.split(/=(.*)/s).slice(0, 2)));
  return e.HEAVY_RPC_URL || e.RPC_URL;
}
const rpcUrl = localRpc();
const conn = new Connection(rpcUrl, 'confirmed');
const P = x => new PublicKey(x);
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const target = P('5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9');
const mintSet = [
  'M1M6sdffCs3ozzhpRveweRCWdZhxth4mvVujPtYEC3h',
  'dog1viwbb2vWDpER5FrJ4YFG6gq6XuyFohUe9TXN65u',
  '2oGLxYuNBJRcepT1mEV6KnETaLD7Bf6qq3CM6skasBfe',
];
const tokenProgram = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const source = JSON.parse(fs.readFileSync(dir + '/kamino-flash-history.json'));
const hit = source.hits[0];
const sample = hit.transaction;
const msg = sample.transaction.message;
const staticKeys = msg.accountKeys;
const loadedW = sample.meta.loadedAddresses?.writable || [];
const allKeys = [...staticKeys, ...loadedW, ...(sample.meta.loadedAddresses?.readonly || [])];
const header = msg.header;
const owner = P('B36gY52xxE5jTm77CcPiemtpqEnif6Lcw3Qh2TcjdZY1');
const userToken = P('3rYyUVvjsgXAVqTQc2QVudZZx4tCtz7eXyaQavQarCnf');

function sampleIx(i) {
  const ix = msg.instructions[i];
  return new TransactionInstruction({programId: P(allKeys[ix.programIdIndex]), data: Buffer.from(bs58.decode(ix.data)), keys: ix.accounts.map(j => ({
    pubkey: P(allKeys[j]), isSigner: j < header.numRequiredSignatures,
    isWritable: j < staticKeys.length
      ? j < header.numRequiredSignatures
        ? j < header.numRequiredSignatures - header.numReadonlySignedAccounts
        : j < staticKeys.length - header.numReadonlyUnsignedAccounts
      : j < staticKeys.length + loadedW.length,
  }))});
}
const originalBorrow = sampleIx(3);
const originalRepay = sampleIx(13);
if (!originalBorrow.programId.equals(klend) || !originalRepay.programId.equals(klend)) throw Error('Source instruction indexes changed');
function flash(ix, amount, repayIndex) {
  const keys = ix.keys.map(k => ({...k}));
  keys[0].pubkey = owner;
  keys[6].pubkey = userToken;
  const data = Buffer.from(ix.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: ix.programId, keys, data});
}
function encodeV1(instructions, blockhash) {
  const m = new TransactionMessage({payerKey: owner, recentBlockhash: blockhash, instructions}).compileToV0Message([]);
  if (m.addressTableLookups.length || m.staticAccountKeys.length > 64 || m.compiledInstructions.length > 64) throw Error('v1 key/instruction limit');
  const cfg = Buffer.alloc(8); cfg.writeUInt32LE(1400000, 0); cfg.writeUInt32LE(67108864, 4);
  const heads = m.compiledInstructions.map(ix => {
    const h = Buffer.alloc(4); h[0] = ix.programIdIndex; h[1] = ix.accountKeyIndexes.length; h.writeUInt16LE(ix.data.length, 2); return h;
  });
  const payloads = m.compiledInstructions.flatMap(ix => [Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]);
  const wire = Buffer.concat([
    Buffer.from([0x81, m.header.numRequiredSignatures, m.header.numReadonlySignedAccounts, m.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([m.compiledInstructions.length, m.staticAccountKeys.length]),
    ...m.staticAccountKeys.map(x => x.toBuffer()), cfg, ...heads, ...payloads,
    Buffer.alloc(64 * m.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw Error('4096-byte v1 limit: ' + wire.length);
  return {wire, bytes: wire.length, accounts: m.staticAccountKeys.length, instructions: m.compiledInstructions.length, signers: m.header.numRequiredSignatures};
}
function readU128LE(data, offset) { return BigInt('0x' + Buffer.from(data.subarray(offset, offset + 16)).reverse().toString('hex')); }
function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function decodeImage(a, role) {
  if (!a) return null;
  const d = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data[0], 'base64');
  // SBF uses 8-byte u128 alignment for this zero-copy Reserve layout.
  if (role === 'reserve') return {available: d.readBigUInt64LE(224).toString(), borrowedSf: readU128LE(d, 232).toString(), collateralShares: d.readBigUInt64LE(2592).toString(), flashLoanFeeSf: d.readBigUInt64LE(4904).toString(), hash: hash(d)};
  if (role === 'mint') return {supply: d.readBigUInt64LE(36).toString(), hash: hash(d)};
  return {amount: d.readBigUInt64LE(64).toString(), hash: hash(d)};
}
let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(rpcUrl, {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0', id:++rpcId, method, params})});
  const json = await res.json(); if (json.error) throw Error(`${method}: ${JSON.stringify(json.error)}`); return json.result;
}
async function main() {
  const reserve = originalBorrow.keys[3].pubkey;
  const supply = originalBorrow.keys[5].pubkey;
  const feeVault = originalBorrow.keys[7].pubkey;
  const reserveInfo = await conn.getAccountInfo(reserve, 'confirmed');
  if (!reserveInfo || !reserveInfo.owner.equals(klend)) throw Error('Reserve owner mismatch');
  const mint = P(reserveInfo.data.subarray(128, 160));
  const collateralMint = P(reserveInfo.data.subarray(2560, 2592));
  const monitor = [supply, userToken, feeVault, reserve, collateralMint];
  const roles = ['supply', 'user', 'fee', 'reserve', 'mint'];
  const pre = await conn.getMultipleAccountsInfoAndContext(monitor, 'confirmed');
  const before = Object.fromEntries(monitor.map((x, i) => [x.toBase58(), decodeImage(pre.value[i], roles[i])]));
  const available = BigInt(before[supply.toBase58()].amount);
  const reserveAvailable = BigInt(before[reserve.toBase58()].available);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const pair = (a, start = 0) => [flash(originalBorrow, a), flash(originalRepay, a, start)];
  const cases = [
    ['zero_raw', pair(0n)], ['min_1_raw', pair(1n)], ['min_2_raw', pair(2n)], ['small_1000_raw', pair(1000n)],
    ['control_100000_raw', pair(100000n)],
    ['near_liquidity_90pct', pair(available * 9n / 10n)],
    ['near_reserve_available_minus_1', pair(reserveAvailable - 1n)],
    ['at_reserve_available', pair(reserveAvailable)],
    ['above_reserve_available_negative', pair(reserveAvailable + 1n)],
    ['at_token_vault_balance_negative', pair(available)],
    ['two_pairs', [...pair(100000n, 0), ...pair(100000n, 2)]],
    ['eight_pairs', Array.from({length: 8}, (_, i) => pair(100000n, 2*i)).flat()],
    ['sixteen_pairs', Array.from({length: 16}, (_, i) => pair(100000n, 2*i)).flat()],
    ['borrow_borrow_repay_repay_negative', [flash(originalBorrow, 100000n), flash(originalBorrow, 100000n), flash(originalRepay, 100000n, 1), flash(originalRepay, 100000n, 0)]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    try {
      const encoded = encodeV1(instructions, blockhash);
      const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: {encoding: 'base64', addresses: monitor.map(String)}}]);
      const v = result.value;
      const after = Object.fromEntries(monitor.map((x, i) => [x.toBase58(), decodeImage(v.accounts?.[i], roles[i])]));
      const row = {label, amountRaw: instructions[0].data.readBigUInt64LE(8).toString(), slot: result.context?.slot, err: v.err, bytes: encoded.bytes, accounts: encoded.accounts, instructions: encoded.instructions, signers: encoded.signers, computeLimit: 1400000, dataLimit: 67108864, units: v.unitsConsumed, loadedDataBytes: v.loadedAccountsDataSize, after, logTail: v.logs?.filter(x => x.includes('Instruction:') || x.includes('failed') || x.includes('Error')).slice(-12)};
      results.push(row);
      console.log(JSON.stringify({label, amountRaw: row.amountRaw, err: row.err, bytes: row.bytes, units: row.units, supplyAfter: after[supply.toBase58()]?.amount, userAfter: after[userToken.toBase58()]?.amount, reserveAfter: after[reserve.toBase58()]?.available}));
    } catch (e) { results.push({label, localError: e.message}); console.log(JSON.stringify({label, localError: e.message})); }
  }
  const lending = JSON.parse(fs.readFileSync('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/outputs/current-lending-vaults.json'));
  const sameMintReserves = lending.protocols.flatMap(p => p.rows).filter(r => mintSet.includes(r.mint)).map(r => ({protocol:r.protocol,mint:r.mint,reserve:r.reserve,address:r.address,rawAmount:r.rawAmount}));
  const output = {generatedAt: new Date().toISOString(), transport: 'read-only mainnet getAccountInfo/getMultipleAccounts/simulateTransaction; sigVerify:false; no sendTransaction', target: target.toBase58(), targetMints: mintSet, reserveCensusSlot: lending.observedSlot, reserveCensusRows: lending.protocols.map(p => ({protocol:p.rows[0]?.protocol, rows:p.rows.length})), sameMintReserves, flashSource: {signature: hit.signature, slot: hit.slot}, flash: {program:klend.toBase58(), reserve:reserve.toBase58(), mint:mint.toBase58(), supply:supply.toBase58(), feeVault:feeVault.toBase58(), collateralMint:collateralMint.toBase58(), userToken:userToken.toBase58(), signer:owner.toBase58()}, preSlot:pre.context.slot, availableRaw:available.toString(), reserveAvailableRaw:reserveAvailable.toString(), before, results};
  fs.writeFileSync(dir + '/flashloan-extremes-5uu.json', JSON.stringify(output, null, 2) + '\n');
}
main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
