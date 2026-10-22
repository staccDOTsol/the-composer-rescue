#!/usr/bin/env node
'use strict';

// Current-mainnet, read-only JanusFI rounding/reserve diagnostics.  The
// event-authority signer is an off-curve DFlow PDA.  Promoting it to a
// top-level signer while simulateTransaction uses sigVerify=false is
// intentionally impossible on chain: it lets this script exercise Janus's
// arithmetic after separately proving that outsiders stop at the signer gate.

const fs = require('fs');
const {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = `${DIR}/janusfi-side-reserve-probe.json`;
const inventory = JSON.parse(fs.readFileSync(`${DIR}/janusfi-current-inventory.json`));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('No read-only RPC configured');

const JANUS = new PublicKey('JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP');
const DFLOW = new PublicKey('DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH');
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const EVENT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')], DFLOW)[0];
let rpcId = 0;

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}

function encodeV1(instructions, payer, blockhash) {
  const v0 = new TransactionMessage({payerKey: new PublicKey(payer), recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64 || v0.addressTableLookups.length)
    throw new Error('v1 inline limits exceeded');
  const config = Buffer.alloc(8);
  config.writeUInt32LE(1_400_000, 0);
  config.writeUInt32LE(67_108_864, 4);
  const heads = items.map((ix) => {
    const head = Buffer.alloc(4);
    head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length;
    head.writeUInt16LE(ix.data.length, 2);
    return head;
  });
  const payloads = items.map((ix) => Buffer.concat([
    Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data),
  ]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map((key) => key.toBuffer()),
    config, ...heads, ...payloads, Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size ${wire.length} exceeds 4096`);
  return {wire, v1Bytes: wire.length,
    requiredSigners: keys.slice(0, v0.header.numRequiredSignatures).map((key) => key.toBase58())};
}

function tokenImage(account) {
  if (!account?.data || account.owner !== TOKEN_2022) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return null;
  return {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    raw: data.readBigUInt64LE(64).toString()};
}

async function readAccounts(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  return {slot: result.context.slot, rows: Object.fromEntries(result.value.map((account, index) =>
    [addresses[index], {exists: account !== null, owner: account?.owner || null,
      dataLength: account?.data ? Buffer.from(account.data[0], 'base64').length : null,
      token: tokenImage(account)}]))};
}

function instruction(source, side, direction, amount, promoteEventAuthority) {
  const keys = source.accounts.map((item) => ({
    pubkey: new PublicKey(item.address),
    isSigner: item.signer || (promoteEventAuthority && item.position === 18),
    isWritable: item.writable,
  }));
  const data = Buffer.from(source.dataHex, 'hex');
  data[1] = side;
  data[2] = direction;
  data.writeBigUInt64LE(BigInt(amount), 3);
  data[11] = 0;
  return new TransactionInstruction({programId: JANUS, keys, data});
}

async function simulate(instructions, payer, blockhash, watched, pre) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', accounts: {encoding: 'base64', addresses: watched},
  }]);
  const balances = Object.fromEntries((result.value.accounts || []).map((account, index) =>
    [watched[index], tokenImage(account)?.raw ?? null]));
  const deltas = Object.fromEntries(watched.map((address) => {
    const before = pre.rows[address]?.token?.raw;
    const after = balances[address];
    return [address, before !== undefined && after !== null ?
      (BigInt(after) - BigInt(before)).toString() : null];
  }));
  return {err: result.value.err, v1Bytes: encoded.v1Bytes,
    requiredSigners: encoded.requiredSigners, unitsConsumed: result.value.unitsConsumed,
    balances, deltas, logs: (result.value.logs || []).filter((line) =>
      line.includes('Program log:') || line.includes('failed') || line.includes('success')).slice(-24)};
}

async function probeSample(spec, blockhash) {
  const tx = inventory.transactions.find((item) => item.signature === spec.sourceSignature);
  if (!tx?.janus?.[0]) throw new Error(`Missing source ${spec.sourceSignature}`);
  const source = tx.janus[0];
  const side = Buffer.from(source.dataHex, 'hex')[1];
  if (side !== spec.side) throw new Error(`Unexpected source side for ${spec.label}`);
  if (source.accounts[18].address !== EVENT_AUTHORITY.toBase58())
    throw new Error(`Unexpected event authority for ${spec.label}`);
  const owner = source.accounts[0].address;
  const userCash = source.accounts[11].address;
  const userOutcome = source.accounts[12].address;
  const makerA = source.accounts[5].address;
  const makerB = source.accounts[6].address;
  const watched = [userCash, userOutcome, makerA, makerB, source.accounts[7].address,
    source.accounts[13].address, source.accounts[15].address];
  const pre = await readAccounts(watched);
  const cashRaw = BigInt(pre.rows[userCash].token?.raw || 0);
  const outcomeRaw = BigInt(pre.rows[userOutcome].token?.raw || 0);
  const directGate = await simulate([
    instruction(source, side, 0, 1_000_000n, false),
  ], owner, blockhash, watched, pre);

  const requested = [1n, 2n, 3n, 9n, 10n, 11n, 99n, 100n, 101n,
    999n, 1_000n, 1_001n, 999_999n, 1_000_000n, 1_000_001n,
    cashRaw, cashRaw + 1n, (1n << 64n) - 1n];
  const amounts = [...new Set(requested.map(String))].map(BigInt);
  const buys = [];
  for (const amount of amounts) {
    const buy = await simulate([instruction(source, side, 0, amount, true)],
      owner, blockhash, watched, pre);
    const outputRaw = buy.deltas[userOutcome] === null ? null : BigInt(buy.deltas[userOutcome]);
    const row = {inputCashRaw: amount.toString(), buy, outputOutcomeRaw: outputRaw?.toString() ?? null};
    if (buy.err === null && outputRaw > 0n) {
      const roundTrip = await simulate([
        instruction(source, side, 0, amount, true),
        instruction(source, side, 1, outputRaw, true),
      ], owner, blockhash, watched, pre);
      row.roundTrip = roundTrip;
      row.callerEquity = {cashDeltaRaw: roundTrip.deltas[userCash],
        outcomeDeltaRaw: roundTrip.deltas[userOutcome],
        positiveCashAndNoOutcomeLoss: roundTrip.err === null &&
          BigInt(roundTrip.deltas[userCash]) > 0n && BigInt(roundTrip.deltas[userOutcome]) >= 0n};
    }
    buys.push(row);
  }

  const sells = [];
  for (const amount of [...new Set([1n, 100n, 1_000_000n, outcomeRaw,
    outcomeRaw + 1n].map(String))].map(BigInt)) {
    const sell = await simulate([instruction(source, side, 1, amount, true)],
      owner, blockhash, watched, pre);
    sells.push({inputOutcomeRaw: amount.toString(), sell,
      outputCashRaw: sell.deltas[userCash]});
  }

  return {label: spec.label, sourceSignature: tx.signature, sourceSlot: tx.slot,
    side, state: source.accounts[2].address, owner, userCash, userOutcome,
    makerA, makerB, currentObservationSlot: pre.slot, preState: pre.rows,
    exactZeroMakerReservePresent: [makerA, makerB].some((address) =>
      pre.rows[address].token?.raw === '0'), directGate, buys, sells};
}

async function main() {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const samples = [];
  for (const spec of [
    {label: 'side_0_zero_maker_a', side: 0,
      sourceSignature: '5vC1YmLXaXcGPdZNnDB9YmbdJDTpuZEW9uYdn2oVEu6bzub2bbiGtNzey2nRRJe2JCcUPZzLLEMwKQmjvpJ5Cqig'},
    {label: 'side_1_zero_maker_b', side: 1,
      sourceSignature: '3rSe8vTrWpXpPJfQqCEthMGeU6oe8kDnCX1rXWk9zAYAYM6jCdq5YrG52WzKEydmQEmZwPdZQ3nJfHRywzfNS5QH'},
  ]) samples.push(await probeSample(spec, blockhash));
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    liveSubmission: false, currentStateSimulation: true, sigVerify: false,
    program: JANUS.toBase58(), dflowProgram: DFLOW.toBase58(),
    eventAuthority: EVENT_AUTHORITY.toBase58(), eventAuthorityOnCurve: false,
    warning: 'Signer-promoted cases are impossible outsider transactions and only diagnose arithmetic behind the proven DFlow PDA gate.',
    gainRule: 'Only err=null plus positive caller equity after all reverse/repayment legs can qualify.',
    samples};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, generatedAt: output.generatedAt,
    samples: samples.map((sample) => ({label: sample.label, slot: sample.currentObservationSlot,
      exactZeroMakerReservePresent: sample.exactZeroMakerReservePresent,
      directGate: sample.directGate.err,
      buySummary: sample.buys.map((row) => ({inputCashRaw: row.inputCashRaw,
        buyErr: row.buy.err, outputOutcomeRaw: row.outputOutcomeRaw,
        roundTripErr: row.roundTrip?.err ?? null, callerEquity: row.callerEquity ?? null})),
      sellSummary: sample.sells.map((row) => ({inputOutcomeRaw: row.inputOutcomeRaw,
        sellErr: row.sell.err, outputCashRaw: row.outputCashRaw}))}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
