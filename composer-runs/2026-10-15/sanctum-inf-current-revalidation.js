#!/usr/bin/env node
'use strict';

// Sanctum INF mainnet revalidation harness.
// Safety boundary: read-only RPC methods plus simulateTransaction. This file
// has no sendTransaction/sendRawTransaction code path and never signs a wire.
const crypto = require('crypto');
const fs = require('fs');
const {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const OUT = process.argv[2] || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/sanctum-inf-current-evidence.json';
const CONTROL_INDEX = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/sanctum-inf-control-index.json';
const PRIOR_PRICES = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/mainnet-token-authority-census.raw.json';
const PROGRAM = new PublicKey('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const INF_MINT = new PublicKey('5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const [POOL_STATE] = PublicKey.findProgramAddressSync([Buffer.from('state')], PROGRAM);
const [LST_STATE_LIST] = PublicKey.findProgramAddressSync([Buffer.from('lst-state-list')], PROGRAM);
const EXPECTED_POOL_STATE = 'AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW';
const EXPECTED_LST_LIST = 'Gb7m4daakbVbrFLR33FKMDVMHAprRZ66CSYt4bpFwUgS';
const AMOUNT = 1_000_000n;
const ROUNDTRIP_AMOUNT = 2_000_000n;
const U32_MAX = 0xffffffff;
const connection = new Connection(RPC, 'confirmed');
let rpcId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pk = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function rpc(method, params, retries = 7) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    const body = await response.json();
    if (body.error) {
      if (attempt < retries && /429|limit|tempor|internal/i.test(JSON.stringify(body.error))) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result;
  }
}

function pubkeyAt(data, offset) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function parsePoolState(data) {
  if (data.length !== 240 || data[12] !== 2) throw new Error(`unexpected pool state layout ${data.length}/${data[12]}`);
  return {
    totalSolValueLamports: data.readBigUInt64LE(0).toString(),
    protocolFeeNanos: data.readUInt32LE(8),
    version: data[12], isDisabled: data[13], isRebalancing: data[14],
    admin: pubkeyAt(data, 16), rebalanceAuthority: pubkeyAt(data, 48),
    protocolFeeBeneficiary: pubkeyAt(data, 80), pricingProgram: pubkeyAt(data, 112),
    lpTokenMint: pubkeyAt(data, 144), rpsAuthority: pubkeyAt(data, 176),
    rpsRaw: data.readBigUInt64LE(208).toString(),
    withheldLamports: data.readBigUInt64LE(216).toString(),
    protocolFeeLamports: data.readBigUInt64LE(224).toString(),
    lastReleaseSlot: data.readBigUInt64LE(232).toString(),
  };
}

async function getMany(addresses, commitment = 'confirmed') {
  const rows = [];
  const slots = [];
  for (let start = 0; start < addresses.length; start += 100) {
    const batch = addresses.slice(start, start + 100).map(String);
    const result = await rpc('getMultipleAccounts', [batch, {encoding: 'base64', commitment}]);
    slots.push(result.context.slot);
    rows.push(...result.value.map((value) => value ? {
      ...value, dataBuffer: Buffer.from(value.data[0], 'base64'),
    } : null));
  }
  return {rows, slots};
}

async function deploymentEvidence() {
  const {rows, slots} = await getMany([PROGRAM]);
  const program = rows[0];
  if (!program || program.owner !== LOADER.toBase58() || !program.executable) throw new Error('program is not live upgradeable executable');
  const programData = pubkeyAt(program.dataBuffer, 4);
  const read = await getMany([programData]);
  const pd = read.rows[0];
  if (!pd || pd.dataBuffer.readUInt32LE(0) !== 3) throw new Error('invalid ProgramData account');
  const authorityPresent = pd.dataBuffer[12] === 1;
  const elfOffset = authorityPresent ? 45 : 13;
  let verifiedBuild = null;
  try {
    const response = await fetch(`https://verify.osec.io/status/${PROGRAM}`);
    if (response.ok) verifiedBuild = await response.json();
  } catch (_) {}
  return {
    observedSlots: [...slots, ...read.slots], program: PROGRAM.toBase58(), programOwner: program.owner,
    executable: program.executable, programData, programDataOwner: pd.owner,
    lastDeployedSlot: pd.dataBuffer.readBigUInt64LE(4).toString(),
    upgradeAuthority: authorityPresent ? pubkeyAt(pd.dataBuffer, 13) : null,
    programDataLength: pd.dataBuffer.length, elfOffset, elfLength: pd.dataBuffer.length - elfOffset,
    elfSha256: sha256(pd.dataBuffer.subarray(elfOffset)), verifiedBuild,
    pdaChecks: {
      poolState: POOL_STATE.toBase58(), poolStateMatchesExpected: POOL_STATE.toBase58() === EXPECTED_POOL_STATE,
      lstStateList: LST_STATE_LIST.toBase58(), lstStateListMatchesExpected: LST_STATE_LIST.toBase58() === EXPECTED_LST_LIST,
    },
  };
}

function priorPriceMap() {
  if (!fs.existsSync(PRIOR_PRICES)) return new Map();
  const raw = JSON.parse(fs.readFileSync(PRIOR_PRICES, 'utf8'));
  return new Map((raw.tokenAccounts || []).filter((row) => row.usdPrice != null).map((row) => [row.mint, {
    price: row.usdPrice, symbol: row.symbol, timestamp: raw.completedAt || null,
    source: 'same-day retained authority census price',
  }]));
}

async function livePrices(mints) {
  const prices = new Map();
  for (let start = 0; start < mints.length; start += 35) {
    const ids = mints.slice(start, start + 35).map((mint) => `solana:${mint}`).join(',');
    try {
      const response = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
      if (!response.ok) continue;
      const body = await response.json();
      for (const [key, value] of Object.entries(body.coins || {})) {
        prices.set(key.slice('solana:'.length), {
          price: value.price, symbol: value.symbol, timestamp: value.timestamp,
          confidence: value.confidence, source: 'https://coins.llama.fi/prices/current',
        });
      }
    } catch (_) {}
    await sleep(40);
  }
  return prices;
}

async function custodyEvidence() {
  const stateRead = await getMany([POOL_STATE, LST_STATE_LIST]);
  const stateInfo = stateRead.rows[0];
  const listInfo = stateRead.rows[1];
  if (!stateInfo || stateInfo.owner !== PROGRAM.toBase58()) throw new Error('pool state not program owned');
  if (!listInfo || listInfo.owner !== PROGRAM.toBase58() || listInfo.dataBuffer.length % 80 !== 0) throw new Error('LST list invalid');
  const pool = parsePoolState(stateInfo.dataBuffer);
  const entries = [];
  for (let offset = 0; offset < listInfo.dataBuffer.length; offset += 80) {
    const data = listInfo.dataBuffer.subarray(offset, offset + 80);
    entries.push({
      index: offset / 80, isInputDisabled: data[0], poolReserveBump: data[1],
      solValueLamports: data.readBigUInt64LE(8).toString(), mint: pubkeyAt(data, 16),
      solValueCalculator: pubkeyAt(data, 48),
    });
  }
  const mintRead = await getMany(entries.map((row) => row.mint));
  for (let i = 0; i < entries.length; i++) {
    const info = mintRead.rows[i];
    entries[i].mintExists = !!info;
    entries[i].tokenProgram = info?.owner || null;
    entries[i].decimals = info?.dataBuffer?.length >= 45 ? info.dataBuffer[44] : null;
    if (info && (info.owner === TOKEN_PROGRAM_ID.toBase58() || info.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')) {
      entries[i].derivedReserve = getAssociatedTokenAddressSync(pk(entries[i].mint), POOL_STATE, true, pk(info.owner), ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
    }
  }
  const reserveRead = await getMany(entries.map((row) => row.derivedReserve || SystemProgram.programId));
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    const info = reserveRead.rows[i];
    row.reserveExists = !!info && !!row.derivedReserve;
    row.reserveOwnerProgram = info?.owner || null;
    row.storedMint = info?.dataBuffer?.length >= 72 ? pubkeyAt(info.dataBuffer, 0) : null;
    row.storedAuthority = info?.dataBuffer?.length >= 72 ? pubkeyAt(info.dataBuffer, 32) : null;
    row.rawAmount = info?.dataBuffer?.length >= 72 ? info.dataBuffer.readBigUInt64LE(64).toString() : '0';
    row.proof = {
      addressDerivedFromPoolState: !!row.derivedReserve,
      tokenProgramMatchesMintOwner: !!row.tokenProgram && row.reserveOwnerProgram === row.tokenProgram,
      storedMintMatches: row.storedMint === row.mint,
      storedAuthorityIsPoolState: row.storedAuthority === POOL_STATE.toBase58(),
    };
  }
  const live = await livePrices(entries.map((row) => row.mint));
  const prior = priorPriceMap();
  const nonzero = entries.filter((row) => BigInt(row.rawAmount || 0) > 0n);
  for (const row of nonzero) {
    const quote = live.get(row.mint) || prior.get(row.mint);
    row.price = quote || null;
    row.usdValue = quote && row.decimals != null
      ? Number(row.rawAmount) / (10 ** row.decimals) * quote.price
      : null;
  }
  const priced = nonzero.filter((row) => Number.isFinite(row.usdValue));
  const valid = nonzero.filter((row) => Object.values(row.proof).every(Boolean));
  const compactRows = nonzero.map((row) => [row.derivedReserve, row.mint, row.tokenProgram, row.rawAmount, row.storedAuthority]);
  const smallestNonzeroByRecordedSolValue = [...nonzero]
    .sort((left, right) => {
      const a = BigInt(left.solValueLamports);
      const b = BigInt(right.solValueLamports);
      return a === b ? 0 : a < b ? -1 : 1;
    })
    .slice(0, 15)
    .map((row) => ({
      index: row.index, address: row.derivedReserve, mint: row.mint,
      rawAmount: row.rawAmount, decimals: row.decimals,
      recordedSolValueLamports: row.solValueLamports,
      tokenProgram: row.tokenProgram, authority: row.storedAuthority,
      usdValue: row.usdValue, priceSource: row.price?.source || null,
    }));
  return {
    observedSlots: [...stateRead.slots, ...mintRead.slots, ...reserveRead.slots],
    poolStateOwner: stateInfo.owner, poolStateDataSha256: sha256(stateInfo.dataBuffer), pool,
    lstStateListOwner: listInfo.owner, lstStateListDataLength: listInfo.dataBuffer.length,
    lstStateListSha256: sha256(listInfo.dataBuffer), lstEntryCount: entries.length,
    nonzeroReserveCount: nonzero.length, authorityAndBindingVerifiedNonzeroCount: valid.length,
    pricedNonzeroCount: priced.length, unpricedNonzeroCount: nonzero.length - priced.length,
    pricedGrossUsdLowerBound: priced.reduce((sum, row) => sum + row.usdValue, 0),
    livePriceCount: nonzero.filter((row) => live.has(row.mint)).length,
    retainedSameDayFallbackPriceCount: nonzero.filter((row) => !live.has(row.mint) && prior.has(row.mint)).length,
    reserveEvidenceSha256: sha256(Buffer.from(JSON.stringify(compactRows))),
    allNonzeroBindingsValid: valid.length === nonzero.length,
    smallestNonzeroByRecordedSolValue,
    topPricedReserves: priced.sort((a, b) => b.usdValue - a.usdValue).slice(0, 12).map((row) => ({
      address: row.derivedReserve, mint: row.mint, rawAmount: row.rawAmount, decimals: row.decimals,
      tokenProgram: row.tokenProgram, authority: row.storedAuthority, symbol: row.price.symbol,
      usdPrice: row.price.price, priceTimestamp: row.price.timestamp, priceSource: row.price.source,
      usdValue: row.usdValue,
    })),
  };
}

function cloneIx(ix) {
  return new TransactionInstruction({
    programId: ix.programId, data: Buffer.from(ix.data),
    keys: ix.keys.map((key) => ({pubkey: key.pubkey, isSigner: key.isSigner, isWritable: key.isWritable})),
  });
}

function swapData(discriminator, amount, limit = 0n, inpIndex = 1, outIndex = U32_MAX) {
  const data = Buffer.alloc(27);
  data[0] = discriminator; data[1] = 1; data[2] = 1;
  data.writeUInt32LE(inpIndex, 3); data.writeUInt32LE(outIndex, 7);
  data.writeBigUInt64LE(limit, 11); data.writeBigUInt64LE(amount, 19);
  return data;
}

function liquidityData(discriminator, amount, minOut = 0n, index = 1) {
  const data = Buffer.alloc(22);
  data[0] = discriminator; data[1] = 1; data.writeUInt32LE(index, 2);
  data.writeBigUInt64LE(amount, 6); data.writeBigUInt64LE(minOut, 14);
  return data;
}

async function fetchDecompiled(signature) {
  const raw = await rpc('getTransaction', [signature, {encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  if (!raw) throw new Error(`missing transaction ${signature}`);
  const transaction = VersionedTransaction.deserialize(Buffer.from(raw.transaction[0], 'base64'));
  const lookups = await Promise.all(transaction.message.addressTableLookups.map(async ({accountKey}) => {
    const result = await connection.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing ALT ${accountKey}`);
    return result.value;
  }));
  return {raw, transaction, lookups, message: TransactionMessage.decompile(transaction.message, {addressLookupTableAccounts: lookups})};
}

function sourceSetup(signer, sourceAta, fundAmount) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}),
    createAssociatedTokenAccountIdempotentInstruction(signer, sourceAta, signer, WSOL),
    SystemProgram.transfer({fromPubkey: signer, toPubkey: sourceAta, lamports: fundAmount}),
    createSyncNativeInstruction(sourceAta),
  ];
}

function decodeTracked(data, kind) {
  if (!data) return null;
  if (kind === 'token') return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
  if (kind === 'mint') return data.length >= 44 ? data.readBigUInt64LE(36).toString() : null;
  if (kind === 'pool') return data.length >= 240 ? {
    hash: sha256(data), totalSolValueLamports: data.readBigUInt64LE(0).toString(),
    protocolFeeLamports: data.readBigUInt64LE(224).toString(), lastReleaseSlot: data.readBigUInt64LE(232).toString(),
  } : null;
  return sha256(data);
}

function relevantLogs(logs) {
  return (logs || []).filter((line) =>
    line.includes(PROGRAM.toBase58()) || line.includes('Program log:') || line.includes('failed:') || line.includes('Error'),
  ).slice(-24);
}

async function preTracked(tracked) {
  const read = await getMany(tracked.map((row) => row.address), 'processed');
  return {slot: read.slots[0], values: tracked.map((row, i) => decodeTracked(read.rows[i]?.dataBuffer, row.kind))};
}

async function simulate(label, payer, instructions, tracked, extra = {}) {
  const before = await preTracked(tracked);
  const {blockhash} = await connection.getLatestBlockhash('processed');
  const message = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const result = await rpc('simulateTransaction', [Buffer.from(transaction.serialize()).toString('base64'), {
    encoding: 'base64', sigVerify: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: tracked.map((row) => String(row.address))},
  }]);
  const after = tracked.map((row, i) => decodeTracked(result.value.accounts?.[i]?.data?.[0]
    ? Buffer.from(result.value.accounts[i].data[0], 'base64') : null, row.kind));
  const accounts = Object.fromEntries(tracked.map((row, i) => {
    const bef = before.values[i]; const aft = after[i];
    const delta = typeof bef === 'string' && typeof aft === 'string' ? (BigInt(aft) - BigInt(bef)).toString() : null;
    return [String(row.address), {kind: row.kind, before: bef, after: aft, delta}];
  }));
  return {
    label, expected: extra.expected, sourceSignature: extra.sourceSignature,
    simulationContextSlot: result.context.slot, beforeReadSlot: before.slot,
    err: result.value.err, unitsConsumed: result.value.unitsConsumed ?? null,
    wireBytes: transaction.serialize().length, accounts, relevantLogs: relevantLogs(result.value.logs),
    mutation: extra.mutation || null,
  };
}

async function runtimeEvidence(custody) {
  const index = JSON.parse(fs.readFileSync(CONTROL_INDEX, 'utf8'));
  const sample = index.found.find((row) => row.discriminator === 23 && row.accounts[1] === WSOL.toBase58() && row.accounts[2] === INF_MINT.toBase58());
  if (!sample) throw new Error('no direct V2 wSOL->INF control');
  const control = await fetchDecompiled(sample.signature);
  const ixIndex = control.message.instructions.findIndex((ix) => ix.programId.equals(PROGRAM) && ix.data[0] === 23);
  if (ixIndex < 0) throw new Error('control instruction missing');
  const original = control.message.instructions[ixIndex];
  const signer = original.keys[0].pubkey;
  const sourceAta = getAssociatedTokenAddressSync(WSOL, signer);
  const destination = original.keys[4].pubkey;
  const alternateDestination = pk(index.found.find((row) => row.discriminator === 23 && row.signature !== sample.signature && row.accounts[2] === INF_MINT.toBase58())?.accounts[4] || destination);
  const otherLstSample = index.found.find((row) => row.discriminator === 23 && row.accounts[1] !== WSOL.toBase58());
  const otherMint = pk(otherLstSample?.accounts[1] || original.keys[2].pubkey);
  const otherReserve = pk(otherLstSample?.accounts[9] || original.keys[10].pubkey);
  const v2 = cloneIx(original);
  v2.keys[3].pubkey = sourceAta;
  v2.data = swapData(23, AMOUNT);
  const v1 = cloneIx(v2);
  v1.keys.splice(5, 0, {pubkey: POOL_STATE, isSigner: false, isWritable: true});
  v1.data = swapData(1, AMOUNT);
  const tracked = [
    {address: sourceAta, kind: 'token'}, {address: destination, kind: 'token'},
    {address: original.keys[9].pubkey, kind: 'token'}, {address: INF_MINT, kind: 'mint'},
    {address: POOL_STATE, kind: 'pool'},
  ];
  const cases = [];
  const runSwap = (label, ix, fund = AMOUNT, extra = {}, tail = []) => simulate(label, signer,
    [...sourceSetup(signer, sourceAta, fund), ix, ...tail], tracked, {...extra, sourceSignature: sample.signature});
  cases.push(await runSwap('V2 exact-in wSOL to INF positive control', cloneIx(v2), AMOUNT, {expected: 'success with user INF increase and pool/mint accounting change'}));
  cases.push(await runSwap('V1 exact-in compatibility positive control', cloneIx(v1), AMOUNT, {expected: 'success through current binary V1 adapter'}));

  const unauthorized = cloneIx(v2);
  unauthorized.keys[0] = {pubkey: SystemProgram.programId, isSigner: false, isWritable: false};
  cases.push(await runSwap('V2 unauthorized signer substitution', unauthorized, AMOUNT, {expected: 'reject', mutation: 'signer -> SystemProgram/non-signer'}));
  const aliasDestination = cloneIx(v2); aliasDestination.keys[4].pubkey = sourceAta;
  cases.push(await runSwap('V2 source/destination alias', aliasDestination, AMOUNT, {expected: 'reject', mutation: 'output token account aliases input token account'}));
  const wrongReserve = cloneIx(v2); wrongReserve.keys[9].pubkey = otherReserve;
  cases.push(await runSwap('V2 reserve substitution', wrongReserve, AMOUNT, {expected: 'reject', mutation: `wSOL reserve -> ${otherReserve}`}));
  const wrongMint = cloneIx(v2); wrongMint.keys[1].pubkey = otherMint;
  cases.push(await runSwap('V2 mint substitution', wrongMint, AMOUNT, {expected: 'reject', mutation: `input mint -> ${otherMint}`}));
  const wrongToken = cloneIx(v2); wrongToken.keys[5].pubkey = SystemProgram.programId;
  cases.push(await runSwap('V2 token CPI program substitution', wrongToken, AMOUNT, {expected: 'reject', mutation: 'input token program -> SystemProgram'}));
  const wrongCalc = cloneIx(v2); wrongCalc.keys[11].pubkey = SystemProgram.programId;
  cases.push(await runSwap('V2 calculator CPI program substitution', wrongCalc, AMOUNT, {expected: 'reject', mutation: 'wSOL calculator -> SystemProgram'}));
  const wrongPricing = cloneIx(v2); wrongPricing.keys[13].pubkey = SystemProgram.programId;
  cases.push(await runSwap('V2 pricing CPI program substitution', wrongPricing, AMOUNT, {expected: 'reject', mutation: 'pricing program -> SystemProgram'}));
  const aliasState = cloneIx(v2); aliasState.keys[8].pubkey = POOL_STATE;
  cases.push(await runSwap('V2 state/list account alias', aliasState, AMOUNT, {expected: 'reject', mutation: 'LST state list aliases pool state'}));

  const redirect = cloneIx(v2); redirect.keys[4].pubkey = alternateDestination;
  const redirectTracked = [...tracked, {address: alternateDestination, kind: 'token'}];
  cases.push(await simulate('V2 authorized gift to alternate INF destination', signer,
    [...sourceSetup(signer, sourceAta, AMOUNT), redirect], redirectTracked,
    {expected: 'success; destination is intentionally caller-selectable, but the spending signer remains required', mutation: `destination -> ${alternateDestination}`, sourceSignature: sample.signature}));

  cases.push(await simulate('V2 duplicate swaps with sufficient funding', signer,
    [...sourceSetup(signer, sourceAta, AMOUNT * 2n), cloneIx(v2), cloneIx(v2)], tracked,
    {expected: 'success; each authorized leg is charged independently', mutation: 'duplicate exact-in instruction', sourceSignature: sample.signature}));
  cases.push(await simulate('V2 duplicate swaps with only one-leg funding', signer,
    [...sourceSetup(signer, sourceAta, AMOUNT), cloneIx(v2), cloneIx(v2)], tracked,
    {expected: 'reject second leg and atomically roll back first', mutation: 'duplicate exact-in instruction without second funding', sourceSignature: sample.signature}));
  const forcedFailure = new TransactionInstruction({programId: SystemProgram.programId, keys: [], data: Buffer.from([255])});
  cases.push(await runSwap('V2 successful leg followed by forced terminal failure', cloneIx(v2), AMOUNT,
    {expected: 'transaction failure with atomic rollback', mutation: 'append invalid SystemProgram instruction'}, [forcedFailure]));

  const liqKeys = [
    v2.keys[0], v2.keys[1], v2.keys[3], v2.keys[4], v2.keys[2],
    {pubkey: POOL_STATE, isSigner: false, isWritable: true}, v2.keys[5], v2.keys[6],
    v2.keys[7], v2.keys[8], v2.keys[9], v2.keys[11], v2.keys[13], v2.keys[14],
  ].map((key) => ({...key}));
  const add = new TransactionInstruction({programId: PROGRAM, keys: liqKeys, data: liquidityData(3, ROUNDTRIP_AMOUNT)});
  const addControl = await simulate('add-liquidity share conversion positive control', signer,
    [...sourceSetup(signer, sourceAta, ROUNDTRIP_AMOUNT), add], tracked,
    {expected: 'success; wSOL deposited and INF shares minted', sourceSignature: sample.signature});
  cases.push(addControl);
  const minted = BigInt(addControl.accounts[destination.toBase58()].delta || 0);
  if (addControl.err || minted <= 0n) throw new Error(`add-liquidity did not mint shares: ${JSON.stringify(addControl.err)}`);
  const remove = new TransactionInstruction({programId: PROGRAM, keys: liqKeys.map((key) => ({...key})), data: liquidityData(4, minted)});
  cases.push(await simulate('same-transaction add then remove full minted shares', signer,
    [...sourceSetup(signer, sourceAta, ROUNDTRIP_AMOUNT), add, remove], tracked,
    {expected: 'success with no free share inflation; round-trip output does not exceed funded wSOL', mutation: 'compose add and remove atomically', sourceSignature: sample.signature}));
  const overRemove = cloneIx(remove); overRemove.data = liquidityData(4, minted + 1n);
  cases.push(await simulate('same-transaction add then over-redeem one share', signer,
    [...sourceSetup(signer, sourceAta, ROUNDTRIP_AMOUNT), add, overRemove], tracked,
    {expected: 'reject and atomically roll back add', mutation: 'remove amount = newly minted shares + 1', sourceSignature: sample.signature}));
  cases.push(await simulate('remove before add ordering mutation', signer,
    [...sourceSetup(signer, sourceAta, ROUNDTRIP_AMOUNT), remove, add], tracked,
    {expected: 'reject before value release', mutation: 'reverse share-conversion order', sourceSignature: sample.signature}));

  const beneficiary = pk(custody.pool.protocolFeeBeneficiary);
  const feeDestination = getAssociatedTokenAddressSync(INF_MINT, beneficiary, true);
  const feeTracked = [
    {address: feeDestination, kind: 'token'}, {address: INF_MINT, kind: 'mint'}, {address: POOL_STATE, kind: 'pool'},
  ];
  const feeIx = new TransactionInstruction({
    programId: PROGRAM, data: Buffer.from([25]), keys: [
      {pubkey: POOL_STATE, isSigner: false, isWritable: true},
      {pubkey: beneficiary, isSigner: true, isWritable: false},
      {pubkey: feeDestination, isSigner: false, isWritable: true},
      {pubkey: INF_MINT, isSigner: false, isWritable: true},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    ],
  });
  const feeCases = [];
  feeCases.push(await simulate('V2 protocol-fee withdrawal positive control', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), feeIx], feeTracked,
    {expected: 'success; mint only to configured beneficiary-selected INF account'}));
  const attackerFee = cloneIx(feeIx); attackerFee.keys[1].pubkey = signer;
  feeCases.push(await simulate('protocol-fee beneficiary substitution', signer,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), attackerFee], feeTracked,
    {expected: 'reject', mutation: `configured beneficiary -> ${signer}`}));
  const redirectFee = cloneIx(feeIx); redirectFee.keys[2].pubkey = alternateDestination;
  feeCases.push(await simulate('authorized protocol-fee destination redirect', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), redirectFee], [...feeTracked, {address: alternateDestination, kind: 'token'}],
    {expected: 'success; configured beneficiary intentionally chooses any valid INF destination', mutation: `withdrawTo -> ${alternateDestination}`}));
  const wrongFeeDest = cloneIx(feeIx); wrongFeeDest.keys[2].pubkey = original.keys[9].pubkey;
  feeCases.push(await simulate('protocol-fee wrong-mint destination', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), wrongFeeDest], feeTracked,
    {expected: 'reject token mint mismatch', mutation: 'withdrawTo -> wSOL reserve'}));
  const wrongFeeMint = cloneIx(feeIx); wrongFeeMint.keys[3].pubkey = WSOL;
  feeCases.push(await simulate('protocol-fee INF mint substitution', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), wrongFeeMint], feeTracked,
    {expected: 'reject pool LP mint binding mismatch', mutation: 'INF mint -> wSOL mint'}));
  const wrongFeeToken = cloneIx(feeIx); wrongFeeToken.keys[4].pubkey = SystemProgram.programId;
  feeCases.push(await simulate('protocol-fee token CPI program substitution', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), wrongFeeToken], feeTracked,
    {expected: 'reject token-program owner binding mismatch', mutation: 'token program -> SystemProgram'}));
  feeCases.push(await simulate('duplicate protocol-fee withdrawal in one transaction', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 700_000}), cloneIx(feeIx), cloneIx(feeIx)], feeTracked,
    {expected: 'success with one mint only; second call observes zero accumulator', mutation: 'duplicate withdrawal'}));
  feeCases.push(await simulate('protocol-fee withdrawal followed by forced terminal failure', beneficiary,
    [ComputeBudgetProgram.setComputeUnitLimit({units: 700_000}), cloneIx(feeIx), forcedFailure], feeTracked,
    {expected: 'transaction failure with fee mint and accumulator update rolled back', mutation: 'append invalid SystemProgram instruction'}));

  return {
    controlDiscovery: {signature: sample.signature, slot: sample.slot, blockTime: sample.blockTime, originalDataHex: sample.dataHex},
    actor: signer.toBase58(), sourceAta: sourceAta.toBase58(), destination: destination.toBase58(),
    alternateDestination: alternateDestination.toBase58(), otherMint: otherMint.toBase58(), otherReserve: otherReserve.toBase58(),
    shareRoundTripMintedRaw: minted.toString(), swapAndShareCases: cases,
    protocolFee: {beneficiary: beneficiary.toBase58(), destination: feeDestination.toBase58(), accumulatorBeforeLamports: custody.pool.protocolFeeLamports, cases: feeCases},
  };
}

async function main() {
  if (POOL_STATE.toBase58() !== EXPECTED_POOL_STATE || LST_STATE_LIST.toBase58() !== EXPECTED_LST_LIST) throw new Error('PDA derivation mismatch');
  const deployment = await deploymentEvidence();
  const custody = await custodyEvidence();
  const runtime = await runtimeEvidence(custody);
  const output = {
    generatedAt: new Date().toISOString(), safety: 'read-only RPC and simulateTransaction only', submittedTransactions: 0,
    validationRubric: [
      'current executable and upgrade authority established',
      'custody reserve address/mint/authority/program bindings and priced lower bound established',
      'successful current-state value-moving control',
      'signer/destination/vault/mint/CPI/alias controls mutated',
      'replay/order/share-conversion/fee/atomicity controls exercised',
    ],
    deployment, custody, runtime,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    out: OUT, deployment: {slot: deployment.lastDeployedSlot, hash: deployment.elfSha256, upgradeAuthority: deployment.upgradeAuthority, verified: deployment.verifiedBuild?.is_verified},
    custody: {entries: custody.lstEntryCount, nonzero: custody.nonzeroReserveCount, valid: custody.authorityAndBindingVerifiedNonzeroCount, priced: custody.pricedNonzeroCount, unpriced: custody.unpricedNonzeroCount, usd: custody.pricedGrossUsdLowerBound},
    swaps: runtime.swapAndShareCases.map((row) => ({label: row.label, err: row.err, destinationDelta: row.accounts[runtime.destination]?.delta || null})),
    fees: runtime.protocolFee.cases.map((row) => ({label: row.label, err: row.err, destinationDelta: row.accounts[runtime.protocolFee.destination]?.delta || null})),
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
