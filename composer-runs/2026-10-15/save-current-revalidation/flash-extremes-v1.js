const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, MessageV0, PublicKey, VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(rpcUrl, 'confirmed');
const sourceSignature = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const saveProgram = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const marginfiProgram = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const outPath = `${__dirname}/flash-extremes-v1.json`;

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 300)); }
  if (json.error) throw Object.assign(new Error(JSON.stringify(json.error)), {rpcError: json.error});
  return json.result;
}

function u32(value) { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; }
function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function cloneIx(ix) { return {programIdIndex: ix.programIdIndex,
  accountKeyIndexes: Array.from(ix.accountKeyIndexes), data: Uint8Array.from(ix.data)}; }

function serializeV1({header, staticAccountKeys, recentBlockhash, compiledInstructions, computeUnitLimit}) {
  if (staticAccountKeys.length > 255 || compiledInstructions.length > 255) throw new Error('u8 count overflow');
  const configMask = computeUnitLimit == null ? 0 : 0b00100;
  const headers = [];
  const bodies = [];
  for (const ix of compiledInstructions) {
    if (ix.accountKeyIndexes.length > 255 || ix.data.length > 65535) throw new Error('instruction overflow');
    const h = Buffer.alloc(4);
    h[0] = ix.programIdIndex;
    h[1] = ix.accountKeyIndexes.length;
    h.writeUInt16LE(ix.data.length, 2);
    headers.push(h);
    bodies.push(Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data));
  }
  const message = Buffer.concat([
    Buffer.from([0x81, header.numRequiredSignatures, header.numReadonlySignedAccounts,
      header.numReadonlyUnsignedAccounts]),
    u32(configMask), Buffer.from(bs58.decode(recentBlockhash)),
    Buffer.from([compiledInstructions.length, staticAccountKeys.length]),
    ...staticAccountKeys.map(key => key.toBuffer()),
    ...(computeUnitLimit == null ? [] : [u32(computeUnitLimit)]),
    ...headers, ...bodies,
  ]);
  const signatures = Buffer.alloc(1 + 64 * header.numRequiredSignatures);
  signatures[0] = header.numRequiredSignatures;
  return {message, wire: Buffer.concat([signatures, message])};
}

function tokenAmount(data) { return data && data.length >= 72 ? data.readBigUInt64LE(64) : null; }
function hash(data) { return data ? crypto.createHash('sha256').update(data).digest('hex') : null; }

(async () => {
  const source = await rpc('getTransaction', [sourceSignature,
    {encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]);
  const template = VersionedTransaction.deserialize(Buffer.from(source.transaction[0], 'base64'));
  const sourceJson = await rpc('getTransaction', [sourceSignature,
    {encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed'}]);
  const messageJson = sourceJson.transaction.message;
  const staticKeys = messageJson.accountKeys.map(key => new PublicKey(key));
  const saveIndex = staticKeys.findIndex(key => key.toBase58() === saveProgram);
  const compiled = template.message.compiledInstructions;
  const saveIx = discriminator => compiled.find(ix => ix.programIdIndex === saveIndex && ix.data?.[0] === discriminator);
  const baseBorrow = saveIx(19);
  const baseRepay = saveIx(20);
  const baseRefresh = saveIx(3);
  if (!baseBorrow || !baseRepay || !baseRefresh) throw new Error('missing Save flash template instructions');
  const payerIndex = 0;
  const destinationIndex = baseBorrow.accountKeyIndexes[1];
  const systemIndex = baseRefresh.accountKeyIndexes[3];
  const tokenIndex = baseBorrow.accountKeyIndexes[6];
  const sourceSupplyIndex = baseBorrow.accountKeyIndexes[0];
  const reserveIndex = baseBorrow.accountKeyIndexes[2];
  const feeReceiverIndex = baseRepay.accountKeyIndexes[2];
  const setup = compiled.slice(2, 6).map(cloneIx);

  const programAccounts = await connection.getProgramAccounts(new PublicKey(saveProgram),
    {commitment: 'confirmed', dataSlice: {offset: 0, length: 0}});
  const fillerCandidates = [memoProgram, ...programAccounts.map(row => row.pubkey)];
  const keys64 = [...staticKeys];
  for (const key of fillerCandidates) {
    if (keys64.length === 64) break;
    if (!keys64.some(existing => existing.equals(key))) keys64.push(key);
  }
  if (keys64.length !== 64) throw new Error(`only ${keys64.length} unique keys`);
  const memoIndex64 = keys64.findIndex(key => key.equals(memoProgram));

  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const reserveInfo = await connection.getAccountInfo(staticKeys[reserveIndex], 'confirmed');
  const supplyInfo = await connection.getAccountInfo(staticKeys[sourceSupplyIndex], 'confirmed');
  const availableRaw = reserveInfo.data.readBigUInt64LE(171);
  const supplyRaw = tokenAmount(supplyInfo.data);
  const monitorKeys = [payerIndex, sourceSupplyIndex, destinationIndex, feeReceiverIndex, reserveIndex]
    .map(index => staticKeys[index]);
  const beforeInfos = await connection.getMultipleAccountsInfo(monitorKeys, 'confirmed');
  const before = Object.fromEntries(monitorKeys.map((key, i) => [key.toBase58(), {
    exists: !!beforeInfos[i], tokenAmount: tokenAmount(beforeInfos[i]?.data)?.toString() ?? null,
    lamports: beforeInfos[i]?.lamports?.toString() ?? null,
    dataHash: hash(beforeInfos[i]?.data),
  }]));

  function pair(amount, fundLamports, options = {}) {
    const borrow = cloneIx(baseBorrow);
    const repay = cloneIx(baseRepay);
    Buffer.from(borrow.data.buffer, borrow.data.byteOffset, borrow.data.byteLength).writeBigUInt64LE(BigInt(amount), 1);
    Buffer.from(repay.data.buffer, repay.data.byteOffset, repay.data.byteLength).writeBigUInt64LE(BigInt(amount), 1);
    const out = [];
    if (options.refreshBefore) out.push(cloneIx(baseRefresh));
    const borrowIndex = setup.length + (options.prefixCount || 0) + out.length;
    out.push(borrow);
    if (fundLamports > 0n) {
      out.push({programIdIndex: systemIndex, accountKeyIndexes: [payerIndex, destinationIndex],
        data: Uint8Array.from(Buffer.concat([u32(2), u64(fundLamports)]))});
      out.push({programIdIndex: tokenIndex, accountKeyIndexes: [destinationIndex], data: Uint8Array.from([17])});
    }
    if (options.tokenSelfTransfer) {
      out.push({programIdIndex: tokenIndex, accountKeyIndexes: [destinationIndex, destinationIndex, payerIndex],
        data: Uint8Array.from(Buffer.concat([Buffer.from([3]), u64(options.tokenSelfTransfer)]))});
    }
    if (options.refreshBetween) out.push(cloneIx(baseRefresh));
    repay.data[9] = borrowIndex;
    out.push(repay);
    if (options.refreshAfter) out.push(cloneIx(baseRefresh));
    return out;
  }

  function instructionsFor(amount, fundLamports, options = {}) {
    return [...setup.map(cloneIx), ...pair(amount, fundLamports, options)];
  }

  async function simulate(label, instructions, keyMode = 22, desiredWireBytes = null) {
    let keys = keyMode === 64 ? [...keys64] : [...staticKeys];
    let ixs = instructions.map(cloneIx);
    const header = {...template.message.header,
      numReadonlyUnsignedAccounts: template.message.header.numReadonlyUnsignedAccounts + (keys.length - staticKeys.length)};
    let serialized = serializeV1({header, staticAccountKeys: keys, recentBlockhash: blockhash,
      compiledInstructions: ixs, computeUnitLimit: 1400000});
    if (desiredWireBytes != null) {
      const extra = desiredWireBytes - serialized.wire.length - 4;
      if (extra < 0) throw new Error(`${label}: base ${serialized.wire.length} exceeds target ${desiredWireBytes}`);
      ixs.push({programIdIndex: memoIndex64, accountKeyIndexes: [], data: Uint8Array.from(Buffer.alloc(extra, 65))});
      serialized = serializeV1({header, staticAccountKeys: keys, recentBlockhash: blockhash,
        compiledInstructions: ixs, computeUnitLimit: 1400000});
    }
    try {
      const result = await rpc('simulateTransaction', [serialized.wire.toString('base64'), {
        encoding: 'base64', sigVerify: false, commitment: 'confirmed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: monitorKeys.map(key => key.toBase58())},
      }]);
      const value = result.value;
      const after = {};
      for (let i = 0; i < monitorKeys.length; i++) {
        const key = monitorKeys[i].toBase58();
        const account = value.accounts?.[i];
        const data = account ? Buffer.from(account.data[0], 'base64') : null;
        after[key] = {exists: !!account, tokenAmount: tokenAmount(data)?.toString() ?? null,
          dataHash: hash(data)};
      }
      const deltas = {};
      for (const key of monitorKeys.map(key => key.toBase58())) {
        if (before[key].tokenAmount != null && after[key].tokenAmount != null) {
          const delta = BigInt(after[key].tokenAmount) - BigInt(before[key].tokenAmount);
          if (delta !== 0n) deltas[key] = delta.toString();
        }
      }
      const row = {label, transactionVersion: 1, wireBytes: serialized.wire.length,
        messageBytes: serialized.message.length, inlineAccounts: keys.length, instructionCount: ixs.length,
        err: value.err, unitsConsumed: value.unitsConsumed ?? null,
        logLineCount: value.logs?.length ?? 0,
        logTruncated: (value.logs || []).some(line => /truncated/i.test(line)),
        innerInstructionGroups: value.innerInstructions?.length ?? 0, nonzeroTokenDeltas: deltas,
        relevantLogs: (value.logs || []).filter(line => /Instruction:|flash|failed:|Error|insufficient/i.test(line)).slice(-16)};
      console.log(JSON.stringify({label, wireBytes: row.wireBytes, accounts: row.inlineAccounts,
        err: row.err, cu: row.unitsConsumed, deltas}));
      return row;
    } catch (error) {
      const row = {label, transactionVersion: 1, wireBytes: serialized.wire.length,
        messageBytes: serialized.message.length, inlineAccounts: keys.length, instructionCount: ixs.length,
        transportError: error.message, rpcError: error.rpcError ?? null};
      console.log(JSON.stringify(row));
      return row;
    }
  }

  async function simulateV0(label, instructions) {
    const message = new MessageV0({header: {...template.message.header},
      staticAccountKeys: [...template.message.staticAccountKeys], recentBlockhash: blockhash,
      compiledInstructions: instructions.map(cloneIx), addressTableLookups: []});
    const wire = Buffer.from(new VersionedTransaction(message).serialize());
    try {
      const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
        sigVerify: false, commitment: 'confirmed', innerInstructions: true,
        accounts: {encoding: 'base64', addresses: monitorKeys.map(key => key.toBase58())}}]);
      const value = result.value;
      const deltas = {};
      const lamportDeltas = {};
      const after = {};
      for (let i = 0; i < monitorKeys.length; i++) {
        const key = monitorKeys[i].toBase58();
        const account = value.accounts?.[i];
        if (!account) { after[key] = {exists: false, tokenAmount: null, lamports: null, dataHash: null}; continue; }
        const data = Buffer.from(account.data[0], 'base64');
        const amount = tokenAmount(data);
        after[key] = {exists: true, tokenAmount: amount?.toString() ?? null,
          lamports: account.lamports.toString(), dataHash: hash(data)};
        if (before[key].tokenAmount != null && amount != null) {
          const delta = amount - BigInt(before[key].tokenAmount);
          if (delta !== 0n) deltas[key] = delta.toString();
        }
        if (before[key].lamports != null) {
          const delta = BigInt(account.lamports) - BigInt(before[key].lamports);
          if (delta !== 0n) lamportDeltas[key] = delta.toString();
        }
      }
      const row = {label, transactionVersion: 0, wireBytes: wire.length,
        messageBytes: message.serialize().length, inlineAccounts: message.staticAccountKeys.length,
        instructionCount: message.compiledInstructions.length, err: value.err,
        unitsConsumed: value.unitsConsumed ?? null, logLineCount: value.logs?.length ?? 0,
        logTruncated: (value.logs || []).some(line => /truncated/i.test(line)),
        innerInstructionGroups: value.innerInstructions?.length ?? 0, after,
        nonzeroTokenDeltas: deltas, nonzeroLamportDeltas: lamportDeltas,
        relevantLogs: (value.logs || []).filter(line => /Instruction:|flash|failed:|Error|insufficient|small/i.test(line)).slice(-16)};
      console.log(JSON.stringify({label, wireBytes: wire.length, err: row.err, cu: row.unitsConsumed, deltas}));
      return row;
    } catch (error) {
      return {label, transactionVersion: 0, wireBytes: wire.length, transportError: error.message,
        rpcError: error.rpcError ?? null};
    }
  }

  const cases = [];
  for (const amount of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 100n, 1000n, 2497n, 2498n, 2499n, 2500n, 2501n, 1000000n]) {
    cases.push(await simulate(`v1_amount_${amount}`, instructionsFor(amount, 1000000n)));
  }
  cases.push(await simulate('v1_refresh_before', instructionsFor(1000000n, 1000000n, {refreshBefore: true})));
  cases.push(await simulate('v1_refresh_between', instructionsFor(1000000n, 1000000n, {refreshBetween: true})));
  cases.push(await simulate('v1_refresh_after', instructionsFor(1000000n, 1000000n, {refreshAfter: true})));
  cases.push(await simulate('v1_token_self_transfer_between',
    instructionsFor(1000000n, 1000000n, {tokenSelfTransfer: 500000n})));

  const firstPair = pair(1000000n, 1000000n, {prefixCount: 0});
  const secondPair = pair(1000000n, 0n, {prefixCount: firstPair.length});
  cases.push(await simulate('v1_two_flash_pairs', [...setup.map(cloneIx), ...firstPair, ...secondPair]));
  cases.push(await simulate('v1_near_available_minus_1', instructionsFor(availableRaw - 1n, 1000000n)));
  cases.push(await simulate('v1_at_available', instructionsFor(availableRaw, 1000000n)));
  cases.push(await simulate('v1_available_plus_1', instructionsFor(availableRaw + 1n, 1000000n)));
  cases.push(await simulate('v1_64_accounts_control', instructionsFor(1000000n, 1000000n), 64));
  cases.push(await simulate('v1_exact_4096_bytes', instructionsFor(1000000n, 1000000n), 64, 4096));
  cases.push(await simulate('v1_4097_bytes', instructionsFor(1000000n, 1000000n), 64, 4097));

  const fallback = [];
  for (const amount of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 100n, 1000n, 2497n, 2498n, 2499n, 2500n, 2501n, 1000000n]) {
    fallback.push(await simulateV0(`v0_amount_${amount}`, instructionsFor(amount, 1000000n)));
  }
  fallback.push(await simulateV0('v0_refresh_before', instructionsFor(1000000n, 1000000n, {refreshBefore: true})));
  fallback.push(await simulateV0('v0_refresh_between', instructionsFor(1000000n, 1000000n, {refreshBetween: true})));
  fallback.push(await simulateV0('v0_refresh_after', instructionsFor(1000000n, 1000000n, {refreshAfter: true})));
  fallback.push(await simulateV0('v0_token_self_transfer_between',
    instructionsFor(1000000n, 1000000n, {tokenSelfTransfer: 500000n})));
  fallback.push(await simulateV0('v0_two_flash_pairs', [...setup.map(cloneIx), ...firstPair, ...secondPair]));
  fallback.push(await simulateV0('v0_near_available_minus_1', instructionsFor(availableRaw - 1n, 1000000n)));
  fallback.push(await simulateV0('v0_at_available', instructionsFor(availableRaw, 1000000n)));
  fallback.push(await simulateV0('v0_available_plus_1', instructionsFor(availableRaw + 1n, 1000000n)));

  const marginfiAccounts = await connection.getProgramAccounts(marginfiProgram, {commitment: 'confirmed',
    filters: [{dataSize: 2312}, {memcmp: {offset: 40, bytes: staticKeys[payerIndex].toBase58()}}],
    dataSlice: {offset: 0, length: 0}});
  const slot = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slot);
  const output = {generatedAt: new Date().toISOString(), observedSlot: slot, observedBlockTime: blockTime,
    program: saveProgram, safety: 'read-only RPC and simulateTransaction only; no submission',
    sourceSignature, payer: staticKeys[payerIndex].toBase58(), sourceSupply: staticKeys[sourceSupplyIndex].toBase58(),
    destinationAta: staticKeys[destinationIndex].toBase58(), feeReceiver: staticKeys[feeReceiverIndex].toBase58(),
    reserve: staticKeys[reserveIndex].toBase58(), availableRaw: availableRaw.toString(),
    supplyVaultRaw: supplyRaw.toString(), computeUnitLimit: 1400000,
    project0Composition: {attemptedPrerequisiteLookup: true, marginfiAccountDataSize: 2312,
      authorityMemcmpOffset: 40, matchingMarginfiAccounts: marginfiAccounts.map(row => row.pubkey.toBase58()),
      blocker: marginfiAccounts.length ? null : 'Save control signer has no current Project 0/marginfi account; start/end flashloan cannot be authorized without changing signer and rebuilding all signer-owned Save setup/fee accounts.'},
    before, results: cases, supportedFallbackResults: fallback};
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
