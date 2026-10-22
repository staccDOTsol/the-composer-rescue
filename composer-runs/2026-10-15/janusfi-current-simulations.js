#!/usr/bin/env node
'use strict';

// Read-only current-mainnet simulations for the deployed JanusFI program.
// This script never signs or submits a transaction. It uses sigVerify=false
// only to exercise instructions against current account state, and emits
// explicit pre/post token accounting for every successful simulation.

const crypto = require('crypto');
const fs = require('fs');
const {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = `${DIR}/janusfi-current-simulations.json`;
const INVENTORY_PATH = `${DIR}/janusfi-current-inventory.json`;
const FLASH_HISTORY_PATH = `${DIR}/kamino-flash-history.json`;
const CENSUS_PATH = `${DIR}/klend-zero-fee-census.json`;

const P = (value) => new PublicKey(value);
const JANUS = P('JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const DFLOW = P('DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH');
const CASH = P('CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('No read-only RPC configured');

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH));
const flashHistory = JSON.parse(fs.readFileSync(FLASH_HISTORY_PATH));
const census = JSON.parse(fs.readFileSync(CENSUS_PATH));
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

function historicalIx(index) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const loaded = tx.meta.loadedAddresses;
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = (i) => i < staticKeys.length ?
    (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < staticKeys.length - h.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return new TransactionInstruction({
    programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({pubkey: P(allKeys[i]),
      isSigner: i < h.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

const borrowTemplate = historicalIx(3);
const repayTemplate = historicalIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND))
  throw new Error('KLend historical flash template changed');

function flashIx(template, row, owner, destination, amount, repayIndex) {
  const keys = template.keys.map((item) => ({...item}));
  const market = P(row.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const replacements = {
    0: owner,
    1: marketAuthority,
    2: row.market,
    3: row.reserve,
    4: row.mint,
    5: row.supplyVault,
    6: destination,
    7: row.feeVault,
    11: TOKEN_2022,
  };
  for (const [index, address] of Object.entries(replacements)) keys[Number(index)].pubkey = P(address);
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function janusIx(source, replacements = {}, edits = {}) {
  const keys = source.accounts.map((item) => ({
    pubkey: P(replacements[item.position] || item.address),
    isSigner: item.signer,
    isWritable: item.writable,
  }));
  const data = Buffer.from(source.dataHex, 'hex');
  if (edits.side !== undefined) data[1] = edits.side;
  if (edits.direction !== undefined) data[2] = edits.direction;
  if (edits.amount !== undefined) data.writeBigUInt64LE(BigInt(edits.amount), 3);
  if (edits.tail !== undefined) data[11] = edits.tail;
  return new TransactionInstruction({programId: JANUS, keys, data});
}

function decodedTopIx(source, dataOverride) {
  return new TransactionInstruction({programId: P(source.programId),
    keys: source.accounts.map((item) => ({pubkey: P(item.address),
      isSigner: item.signer, isWritable: item.writable})),
    data: dataOverride || Buffer.from(source.dataHex, 'hex')});
}

function decodedTopIxWithAccountPositions(source, positions, dataOverride) {
  const keep = new Set(positions);
  return new TransactionInstruction({programId: P(source.programId),
    keys: source.accounts.filter((item) => keep.has(item.position)).map((item) => ({
      pubkey: P(item.address), isSigner: item.signer, isWritable: item.writable})),
    data: dataOverride || Buffer.from(source.dataHex, 'hex')});
}

function dflowWithoutLeadingActions(source, removeCount) {
  const data = Buffer.from(source.dataHex, 'hex');
  // Observed prediction quotes begin with RecordId (variant + 76 bytes),
  // then SetSponsor and IncludeAccount (one-byte variants), then route D.
  if (data.readUInt32LE(8) !== 4 || data[12] !== 0x25 || data[89] !== 0x32 ||
      data[90] !== 0x2d || data[91] !== 0x39) throw new Error('Unexpected DFlow action encoding');
  const starts = {1: 89, 2: 90, 3: 91};
  const out = Buffer.concat([data.subarray(0, 8), Buffer.alloc(4), data.subarray(starts[removeCount])]);
  out.writeUInt32LE(4 - removeCount, 8);
  return out;
}

// web3.js 1.x does not serialize Solana v1 messages. Compile the equivalent
// no-ALT v0 account order, then emit the documented v1 wire representation.
function encodeV1(instructions, payer, blockhash, computeLimit = 1400000, dataLimit = 67108864) {
  const v0 = new TransactionMessage({payerKey: P(payer), recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 message must not use ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('v1 address/instruction limit');
  const short = (n) => n < 128 ? 1 : n < 16384 ? 2 : 3;
  const legacyV0Bytes = short(v0.header.numRequiredSignatures) +
    64 * v0.header.numRequiredSignatures + 1 + 3 + short(keys.length) + 32 * keys.length + 32 +
    short(items.length) + items.reduce((sum, ix) => sum + 1 + short(ix.accountKeyIndexes.length) +
      ix.accountKeyIndexes.length + short(ix.data.length) + ix.data.length, 0) + short(0);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map((ix) => {
    const head = Buffer.alloc(4);
    head[0] = ix.programIdIndex;
    head[1] = ix.accountKeyIndexes.length;
    head.writeUInt16LE(ix.data.length, 2);
    return head;
  });
  const payloads = items.map((ix) => Buffer.concat([Buffer.from(ix.accountKeyIndexes),
    Buffer.from(ix.data)]));
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()), config, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {wire, v1Bytes: wire.length, legacyV0Bytes, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures};
}

function tokenImage(account) {
  if (!account?.data || account.owner !== TOKEN_2022.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return null;
  return {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    rawAmount: data.readBigUInt64LE(64).toString()};
}

const hashAccount = (account) => account?.data ? crypto.createHash('sha256')
  .update(Buffer.from(account.data[0], 'base64')).digest('hex') : null;

async function getAccounts(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses,
    {encoding: 'base64', commitment: 'confirmed'}]);
  return {slot: result.context.slot, accounts: result.value.map((account, index) => ({
    address: addresses[index], owner: account?.owner || null, dataLength: account?.data ?
      Buffer.from(account.data[0], 'base64').length : null,
    hash: hashAccount(account), token: tokenImage(account),
  }))};
}

function deltas(before, after) {
  return before.accounts.map((row, index) => ({
    address: row.address,
    mint: row.token?.mint || after[index]?.token?.mint || null,
    beforeRaw: row.token?.rawAmount || null,
    afterRaw: after[index]?.token?.rawAmount || null,
    deltaRaw: row.token?.rawAmount !== undefined && after[index]?.token?.rawAmount !== undefined ?
      (BigInt(after[index].token.rawAmount) - BigInt(row.token.rawAmount)).toString() : null,
    hashBefore: row.hash,
    hashAfter: after[index]?.hash || null,
  }));
}

async function simulate(label, instructions, payer, blockhash, watched, before, metadata = {}) {
  const encoded = encodeV1(instructions, payer, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', accounts: {encoding: 'base64', addresses: watched},
  }]);
  const value = result.value;
  const after = (value.accounts || []).map((account, index) => ({
    address: watched[index], hash: hashAccount(account), token: tokenImage(account),
  }));
  return {label, ...metadata, slot: result.context.slot, err: value.err,
    v1Bytes: encoded.v1Bytes, legacyV0EquivalentBytes: encoded.legacyV0Bytes,
    addressCount: encoded.addressCount, instructionCount: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures,
    unitsConsumed: value.unitsConsumed, loadedAccountsDataSize: value.loadedAccountsDataSize,
    tokenAndStateDeltas: deltas(before, after),
    logs: (value.logs || []).filter((line) => line.includes('Instruction:') ||
      line.includes('Program log:') ||
      line.includes(JANUS.toBase58()) || line.includes(KLEND.toBase58()) ||
      line.includes('failed') || line.includes('Error') || line.includes('success')).slice(-80),
  };
}

function amountDelta(result, address) {
  const row = result.tokenAndStateDeltas.find((item) => item.address === address);
  return row?.deltaRaw === null || row?.deltaRaw === undefined ? null : BigInt(row.deltaRaw);
}

async function main() {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const cashRows = census.activeZero.filter((row) => row.mint === CASH.toBase58())
    .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1);
  if (!cashRows.length) throw new Error('No retained exact-zero-fee CASH reserve');
  const flash = {...cashRows[0]};

  // Re-read all lender fields from current state; do not trust the retained
  // census amount or fee value for simulation claims.
  const flashLive = await rpc('getMultipleAccounts', [[flash.reserve, flash.supplyVault, flash.feeVault],
    {encoding: 'base64', commitment: 'confirmed'}]);
  const reserveData = Buffer.from(flashLive.value[0].data[0], 'base64');
  const supplyData = Buffer.from(flashLive.value[1].data[0], 'base64');
  const feeData = Buffer.from(flashLive.value[2].data[0], 'base64');
  const available = reserveData.readBigUInt64LE(224);
  const flashFeeSf = reserveData.readBigUInt64LE(4904);
  const supplyBalance = supplyData.readBigUInt64LE(64);
  const feeBalance = feeData.readBigUInt64LE(64);

  // Use the freshest observed live pool, but a current on-curve user whose
  // CASH and matching outcome accounts both remain open and funded.
  const poolTx = inventory.transactions.find((tx) => tx.janus?.[0]?.accounts?.[2]?.address ===
    '9hg5a1pTvtKeeXKvbQusqrDjvm8hZDmgZpEgVARqSpbN');
  if (!poolTx) throw new Error('Live Janus pool reference missing');
  const sourceIx = poolTx.janus[0];
  const user = {
    owner: '2PZHHAa1J2H2wHTtFW6Lm1qtwub3GJ1R9Wd5BFX3rgcV',
    cash: 'DD3h48sha4NdFHSFrpPWFEe3zpjCCCDUwQD7Ckwtfy2J',
    outcome: 'FPMxTirDJjRSxE5DvxLJWhJ6Q7pcCGe1DAqy7YyXV28y',
  };
  const baseReplacements = {0: user.owner, 11: user.cash, 12: user.outcome};
  const baseAddresses = sourceIx.accounts.map((item) => baseReplacements[item.position] || item.address);
  // The current RPC caps returned simulation account images at eleven.
  const watched = [...new Set([
    user.cash, user.outcome, flash.supplyVault, flash.feeVault, flash.reserve,
    ...baseAddresses.filter((_, index) => [2, 5, 6, 7, 13, 15].includes(index)),
  ])];
  const before = await getAccounts(watched);
  const results = [];

  // Replay an observed public DFlow wrapper instruction against current state.
  // This is deliberately retained even if the maker-signed quote has expired:
  // its logs distinguish the wrapper gate from Janus's direct-call signer gate.
  const routedTx = inventory.transactions.find((tx) =>
    tx.signature === '5CTwXmQ2mJ4tPbodRDXixmGxu81r15d1DT8fandvF2Z9eQ1ywbr2zZkES3xVHros2FevHuoQjqTLLpVXd2hN5CFU') ||
    inventory.transactions.find((tx) => tx.janus?.length &&
      tx.top?.some((ix) => ix.programId === DFLOW.toBase58()));
  if (routedTx) {
    const routedJanus = routedTx.janus[0];
    const routedTop = routedTx.top.find((ix) => ix.programId === DFLOW.toBase58());
    const routedAddresses = [...new Set(routedJanus.accounts
      .filter((item) => [2, 5, 6, 7, 11, 12, 13, 15].includes(item.position))
      .map((item) => item.address))];
    const routedBefore = await getAccounts(routedAddresses);
    results.push(await simulate('dflow_observed_wrapper_replay_current_state',
      [decodedTopIx(routedTop)], routedTop.accounts[3].address, blockhash,
      routedAddresses, routedBefore, {class: 'wrapper-positive-control-attempt',
        sourceSignature: routedTx.signature, sourceSlot: routedTx.slot,
        quoteAgeSlotsAtInventory: inventory.observationSlots.fixedAccounts - routedTx.slot}));
    const wrapperIndex = routedTop.outerIndex;
    results.push(await simulate('dflow_observed_full_prefix_replay_current_state',
      routedTx.top.filter((ix) => ix.outerIndex <= wrapperIndex).map((ix) => decodedTopIx(ix)),
      routedTop.accounts[3].address, blockhash, routedAddresses, routedBefore,
      {class: 'wrapper-positive-control-attempt', sourceSignature: routedTx.signature,
        sourceSlot: routedTx.slot, originalWrapperInstructionIndex: wrapperIndex,
        quoteAgeSlotsAtInventory: inventory.observationSlots.fixedAccounts - routedTx.slot}));
    for (const [label, removeCount] of [['without_record_id', 1],
      ['without_record_and_sponsor', 2], ['route_only', 3]]) {
      results.push(await simulate(`dflow_${label}_partner_signers_simulated`,
        [decodedTopIx(routedTop, dflowWithoutLeadingActions(routedTop, removeCount))],
        routedTop.accounts[3].address, blockhash, routedAddresses, routedBefore,
        {class: 'partner-authorized-non-outsider-control', sourceSignature: routedTx.signature,
          sourceSlot: routedTx.slot, removedLeadingActions: removeCount,
          exclusion: 'Requires non-outsider DFlow/market-maker transaction signers'}));
    }
    const routeOnlyPositions = routedTop.accounts.map((item) => item.position)
      .filter((position) => position < 6 || position >= 13);
    results.push(await simulate('dflow_route_only_aligned_accounts',
      [decodedTopIxWithAccountPositions(routedTop, routeOnlyPositions,
        dflowWithoutLeadingActions(routedTop, 3))], routedTop.accounts[3].address,
      blockhash, routedAddresses, routedBefore, {class: 'outsider-reachability-probe',
        sourceSignature: routedTx.signature, sourceSlot: routedTx.slot,
        removedLeadingActions: 3, removedAccountPositions: [6, 7, 8, 9, 10, 11, 12]}));
    for (let remainingStart = 6; remainingStart <= 13; remainingStart += 1) {
      const positions = routedTop.accounts.map((item) => item.position)
        .filter((position) => position < 6 || position >= remainingStart);
      results.push(await simulate(`dflow_route_only_remaining_start_${remainingStart}`,
        [decodedTopIxWithAccountPositions(routedTop, positions,
          dflowWithoutLeadingActions(routedTop, 3))], routedTop.accounts[3].address,
        blockhash, routedAddresses, routedBefore, {class: 'route-account-alignment-probe',
          sourceSignature: routedTx.signature, sourceSlot: routedTx.slot,
          remainingAccountStart: remainingStart}));
    }
    for (const spec of [
      {label: 'without_record_id_aligned', removeCount: 1, removeAccounts: [7]},
      {label: 'without_record_and_sponsor_aligned', removeCount: 2, removeAccounts: [6, 7]},
    ]) {
      const positions = routedTop.accounts.map((item) => item.position)
        .filter((position) => !spec.removeAccounts.includes(position));
      results.push(await simulate(`dflow_${spec.label}`,
        [decodedTopIxWithAccountPositions(routedTop, positions,
          dflowWithoutLeadingActions(routedTop, spec.removeCount))],
        routedTop.accounts[3].address, blockhash, routedAddresses, routedBefore,
        {class: 'outsider-reachability-probe', sourceSignature: routedTx.signature,
          sourceSlot: routedTx.slot, removedLeadingActions: spec.removeCount,
          removedAccountPositions: spec.removeAccounts}));
    }
  }

  // Current outsider-callable value-movement controls.
  const oneCash = 1_000_000n;
  const buyControl = await simulate('direct_buy_1_cash',
    [janusIx(sourceIx, baseReplacements, {side: 0, direction: 0, amount: oneCash, tail: 0})],
    user.owner, blockhash, watched, before, {class: 'positive-control', exactInputRaw: oneCash.toString()});
  results.push(buyControl);
  const boughtOutcome = amountDelta(buyControl, user.outcome);
  results.push(await simulate('direct_sell_1_outcome',
    [janusIx(sourceIx, baseReplacements, {side: 0, direction: 1, amount: oneCash, tail: 0})],
    user.owner, blockhash, watched, before, {class: 'positive-control', exactInputRaw: oneCash.toString()}));

  // Exact-zero-fee KLend controls from dust through the full current amount.
  for (const [suffix, amount] of [
    ['dust', 1n], ['one_cash', oneCash], ['ninety_nine_percent', available * 99n / 100n],
    ['exact_available', available], ['available_plus_one', available + 1n],
  ]) {
    const pair = [flashIx(borrowTemplate, flash, user.owner, user.cash, amount),
      flashIx(repayTemplate, flash, user.owner, user.cash, amount, 0)];
    const result = await simulate(`klend_flash_pair_${suffix}`, pair, user.owner, blockhash,
      watched, before, {class: suffix === 'available_plus_one' ? 'negative-control' : 'flash-control',
        flashAmountRaw: amount.toString(), exactFeeRaw: '0'});
    const cashDelta = amountDelta(result, user.cash);
    const outcomeDelta = amountDelta(result, user.outcome);
    result.callerEquity = {cashDeltaRawAfterFullRepay: cashDelta?.toString() ?? null,
      outcomeDeltaRawAfterFullRepay: outcomeDelta?.toString() ?? null,
      fullRepaymentSucceeded: result.err === null,
      positiveCashAndNoOutcomeLoss: result.err === null && cashDelta > 0n && outcomeDelta >= 0n};
    results.push(result);
  }

  // Encode and execute the exact requested outsider transaction shape even
  // when the standalone Janus positive control is gated.  The reverse amount
  // cannot be quote-derived unless the buy succeeds, but this four-instruction
  // probe proves the v1 envelope fits and records the first runtime boundary.
  const gatedRoundTrip = [
    flashIx(borrowTemplate, flash, user.owner, user.cash, oneCash),
    janusIx(sourceIx, baseReplacements, {side: 0, direction: 0, amount: oneCash, tail: 0}),
    janusIx(sourceIx, baseReplacements, {side: 0, direction: 1, amount: oneCash, tail: 0}),
    flashIx(repayTemplate, flash, user.owner, user.cash, oneCash, 0),
  ];
  const gatedResult = await simulate('atomic_flash_direct_buy_sell_repay_reachability_probe',
    gatedRoundTrip, user.owner, blockhash, watched, before, {class: 'atomic-reachability-probe',
      flashAmountRaw: oneCash.toString(), reverseInputRaw: oneCash.toString(), exactFeeRaw: '0',
      qualification: 'Not a gain test unless every instruction succeeds and the flash loan is repaid'});
  const gatedCashDelta = amountDelta(gatedResult, user.cash);
  const gatedOutcomeDelta = amountDelta(gatedResult, user.outcome);
  gatedResult.callerEquity = {
    cashDeltaRawAfterFullRepay: gatedCashDelta?.toString() ?? null,
    outcomeDeltaRawAfterFullRepay: gatedOutcomeDelta?.toString() ?? null,
    fullRepaymentSucceeded: gatedResult.err === null,
    positiveCashAndNoOutcomeLoss: gatedResult.err === null && gatedCashDelta > 0n && gatedOutcomeDelta >= 0n,
  };
  results.push(gatedResult);

  // A complete borrow -> Janus buy -> reverse Janus sell -> repay transaction.
  // The direct buy first supplies the exact simulated output amount for the
  // reverse leg. Caller equity is evaluated only on the successful full pair.
  if (buyControl.err === null && boughtOutcome > 0n) {
    const roundTrip = [
      flashIx(borrowTemplate, flash, user.owner, user.cash, oneCash),
      janusIx(sourceIx, baseReplacements, {side: 0, direction: 0, amount: oneCash, tail: 0}),
      janusIx(sourceIx, baseReplacements, {side: 0, direction: 1, amount: boughtOutcome, tail: 0}),
      flashIx(repayTemplate, flash, user.owner, user.cash, oneCash, 0),
    ];
    const result = await simulate('atomic_flash_buy_reverse_repay_1_cash', roundTrip,
      user.owner, blockhash, watched, before, {class: 'atomic-round-trip',
        flashAmountRaw: oneCash.toString(), reverseInputRaw: boughtOutcome.toString(), exactFeeRaw: '0'});
    const cashDelta = amountDelta(result, user.cash);
    const outcomeDelta = amountDelta(result, user.outcome);
    result.callerEquity = {cashDeltaRawAfterFullRepay: cashDelta?.toString() ?? null,
      outcomeDeltaRawAfterFullRepay: outcomeDelta?.toString() ?? null,
      positiveCashAndNoOutcomeLoss: result.err === null && cashDelta > 0n && outcomeDelta >= 0n};
    results.push(result);
  }

  // Arithmetic and fee-boundary inputs.
  for (const [label, edits] of [
    ['buy_amount_zero', {side: 0, direction: 0, amount: 0n, tail: 0}],
    ['buy_amount_one_raw', {side: 0, direction: 0, amount: 1n, tail: 0}],
    ['buy_amount_u64_max', {side: 0, direction: 0, amount: (1n << 64n) - 1n, tail: 0}],
    ['sell_amount_zero', {side: 0, direction: 1, amount: 0n, tail: 0}],
    ['sell_amount_one_raw', {side: 0, direction: 1, amount: 1n, tail: 0}],
    ['sell_amount_u64_max', {side: 0, direction: 1, amount: (1n << 64n) - 1n, tail: 0}],
    ['invalid_side_2', {side: 2, direction: 0, amount: oneCash, tail: 0}],
    ['invalid_side_255', {side: 255, direction: 0, amount: oneCash, tail: 0}],
    ['invalid_direction_2', {side: 0, direction: 2, amount: oneCash, tail: 0}],
    ['invalid_direction_255', {side: 0, direction: 255, amount: oneCash, tail: 0}],
    ['tail_flag_1', {side: 0, direction: 0, amount: oneCash, tail: 1}],
    ['tail_flag_255', {side: 0, direction: 0, amount: oneCash, tail: 255}],
  ]) results.push(await simulate(label, [janusIx(sourceIx, baseReplacements, edits)], user.owner,
    blockhash, watched, before, {class: 'arithmetic-or-flag-boundary'}));

  // Account binding, aliasing, stale-state, and fee-destination mutations.
  const otherPoolTx = inventory.transactions.find((tx) => tx.janus?.[0]?.accounts?.[2]?.address !==
    sourceIx.accounts[2].address && tx.janus?.[0]?.accounts?.length === sourceIx.accounts.length);
  const other = otherPoolTx.janus[0].accounts;
  const mutations = [
    ['alias_protocol_fee_to_user_cash', {13: user.cash}],
    ['alias_settlement_vault_to_user_cash', {15: user.cash}],
    ['alias_user_cash_to_janus_vault', {11: sourceIx.accounts[7].address}],
    ['alias_user_outcome_to_lp_outcome', {12: sourceIx.accounts[5].address}],
    ['alias_oracle_to_market', {3: sourceIx.accounts[4].address}],
    ['stale_other_market_state', {2: other[2].address}],
    ['other_oracle', {3: other[3].address}],
    ['other_native_market', {4: other[4].address}],
    ['other_fee_destination', {15: other[15].address}],
  ];
  for (const [label, replacements] of mutations) {
    results.push(await simulate(label, [janusIx(sourceIx, {...baseReplacements, ...replacements},
      {side: 0, direction: 0, amount: oneCash, tail: 0})], user.owner, blockhash,
    watched, before, {class: 'account-mutation'}));
  }

  const output = {
    generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    signerVerification: false, currentStateSimulation: true,
    program: JANUS.toBase58(), deployment: inventory.deployment,
    sourceJanusTransaction: {signature: poolTx.signature, slot: poolTx.slot,
      instructionHex: sourceIx.dataHex, state: sourceIx.accounts[2].address},
    outsider: user,
    klend: {program: KLEND.toBase58(), sourceFlashSignature: flashHistory.hits[0].signature,
      observationSlot: flashLive.context.slot, reserve: flash.reserve, market: flash.market,
      supplyVault: flash.supplyVault, feeVault: flash.feeVault,
      availableRaw: available.toString(), supplyVaultBalanceRaw: supplyBalance.toString(),
      feeVaultBalanceRaw: feeBalance.toString(), flashFeeSf: flashFeeSf.toString(),
      exactZeroFee: flashFeeSf === 0n},
    v1Limits: {maxSerializedBytes: 4096, maxInlineAddresses: 64, maxInstructions: 64},
    watchedPreState: before, results,
    conclusionGate: 'No result is a gain unless the simulation succeeds, KLend is fully repaid, and caller equity is positive after repayment.',
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, generatedAt: output.generatedAt,
    klend: output.klend, results: results.map((item) => ({label: item.label, err: item.err,
      v1Bytes: item.v1Bytes, callerEquity: item.callerEquity || null}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
