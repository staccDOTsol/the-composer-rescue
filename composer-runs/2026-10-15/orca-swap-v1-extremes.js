#!/usr/bin/env node

// Current-mainnet read-only v1 swap simulations. Never signs or submits.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, SystemProgram, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('read-only RPC unavailable');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const ORCA = P('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SYSVAR_INSTRUCTIONS = P('Sysvar1nstructions1111111111111111111111111');
const POOL = P('2TAgfogn8JRwwTnsGKUa6WUT5Xdv1iMEzfEDMor68X9C');
const POSITION = P('44pSCDrY8Ka6j5qyA7HJdx9cgCEkepjj9N6atrXSv79e');
const POSITION_TOKEN = P('AvTCVwfFPRqmdFHCipN3mwS6pXzaGb9ac21ycjyQmn5y');
const OWNER = P('4i4rYMBihHVv4VwuGQmu2eu9FEPf5tqvHQFrbFpCwQP1');
const OWNER_B = P('CrXdPjcgZgxzuiGoKNQAid4udzwUioJwGeXKTFWBubcq');
const MINT_A = P('So11111111111111111111111111111111111111112');
const MINT_B = P('A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS');
const VAULT_A = P('26NPUT2NWS8vbgdZuD4iMKXbypYb6SpZKvmi76ezaG35');
const VAULT_B = P('AbPTQH3jPZUfZYfyPmMhEPvD2tMuWjcFsgVjMbMvdTZ6');
const OLD_LOWER = P('FiQBpg47ZcHjqCj6m47GMpzhCsATihFZCjMXqmYAkN4X');
const UPPER_ARRAY = P('dBqmnuE7DJ7Dn5vemuLhdCHptc1rZAeRDGG31N8PdZe');
const OWNER_A = getAssociatedTokenAddressSync(MINT_A, OWNER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const pda = (seed, start) => PublicKey.findProgramAddressSync(
  start === undefined ? [Buffer.from(seed), POOL.toBuffer()] : [Buffer.from(seed), POOL.toBuffer(), Buffer.from(String(start))], ORCA)[0];
const TICKS = {
  m50688: pda('tick_array', -50688), m49280: pda('tick_array', -49280),
  m47872: pda('tick_array', -47872), m46464: pda('tick_array', -46464),
  m45056: pda('tick_array', -45056),
};
const ORACLE = pda('oracle');

const ZERO_CENSUS = JSON.parse(fs.readFileSync('composer-runs/2026-10-15/klend-zero-fee-census.json', 'utf8'));
const reserveRow = ZERO_CENSUS.activeZero.filter(x => x.mint === MINT_A.toBase58())
  .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
if (!reserveRow || reserveRow.flashFeeSf !== '0') throw new Error('no exact-zero-rate WSOL reserve');
const RESERVE = P(reserveRow.reserve), MARKET = P(reserveRow.market), SUPPLY = P(reserveRow.supplyVault), FEE = P(reserveRow.feeVault);
const [MARKET_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from('lma'), MARKET.toBuffer()], KLEND);

const DISC = {
  flashBorrow: Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]),
  flashRepay: Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]),
  reposition: Buffer.from([191, 169, 224, 11, 131, 19, 158, 253]),
  decrease: Buffer.from([160, 38, 208, 111, 104, 91, 44, 1]),
  swap: Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]),
};
const MIN_SQRT_PRICE_X64 = 4295048016n;
const MAX_SQRT_PRICE_X64 = 79226673515401279992447579055n;
const k = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const u128 = value => { const n = BigInt(value), b = Buffer.alloc(16); b.writeBigUInt64LE(n & ((1n << 64n) - 1n)); b.writeBigUInt64LE(n >> 64n, 8); return b; };
const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const orcaIx = (data, keys) => new TransactionInstruction({programId: ORCA, data, keys});

function flashBorrow(amount) {
  return new TransactionInstruction({programId: KLEND, data: Buffer.concat([DISC.flashBorrow, u64(amount)]), keys: [
    k(OWNER, true), k(MARKET_AUTHORITY), k(MARKET), k(RESERVE, false, true), k(MINT_A), k(SUPPLY, false, true),
    k(OWNER_A, false, true), k(FEE, false, true), k(KLEND), k(KLEND), k(SYSVAR_INSTRUCTIONS), k(TOKEN_PROGRAM_ID),
  ]});
}
function flashRepay(amount, borrowIndex = 1) {
  return new TransactionInstruction({programId: KLEND, data: Buffer.concat([DISC.flashRepay, u64(amount), Buffer.from([borrowIndex])]), keys: [
    k(OWNER, true), k(MARKET_AUTHORITY), k(MARKET), k(RESERVE, false, true), k(MINT_A), k(SUPPLY, false, true),
    k(OWNER_A, false, true), k(FEE, false, true), k(KLEND), k(KLEND), k(SYSVAR_INSTRUCTIONS), k(TOKEN_PROGRAM_ID),
  ]});
}
function reposition(liquidity) {
  const max = (1n << 64n) - 1n;
  return orcaIx(Buffer.concat([DISC.reposition, i32(-46464), i32(-46144), Buffer.from([0]), u128(liquidity),
    u64(0), u64(0), u64(max), u64(max), Buffer.from([0])]), [
    k(POOL, false, true), k(TOKEN_PROGRAM_ID), k(TOKEN_PROGRAM_ID), k(MEMO), k(OWNER, true), k(OWNER, true, true),
    k(POSITION, false, true), k(POSITION_TOKEN), k(MINT_A), k(MINT_B), k(OWNER_A, false, true), k(OWNER_B, false, true),
    k(VAULT_A, false, true), k(VAULT_B, false, true), k(OLD_LOWER, false, true), k(UPPER_ARRAY, false, true),
    k(UPPER_ARRAY, false, true), k(UPPER_ARRAY, false, true), k(SystemProgram.programId),
  ]);
}
function decrease(liquidity) {
  return orcaIx(Buffer.concat([DISC.decrease, u128(liquidity), u64(0), u64(0)]), [
    k(POOL, false, true), k(TOKEN_PROGRAM_ID), k(OWNER, true), k(POSITION, false, true), k(POSITION_TOKEN),
    k(OWNER_A, false, true), k(OWNER_B, false, true), k(VAULT_A, false, true), k(VAULT_B, false, true),
    k(UPPER_ARRAY, false, true), k(UPPER_ARRAY, false, true),
  ]);
}
function swap(amount, otherThreshold, aToB, arrays) {
  const limit = aToB ? MIN_SQRT_PRICE_X64 : MAX_SQRT_PRICE_X64;
  return orcaIx(Buffer.concat([DISC.swap, u64(amount), u64(otherThreshold), u128(limit), Buffer.from([1, aToB ? 1 : 0])]), [
    k(TOKEN_PROGRAM_ID), k(OWNER, true), k(POOL, false, true), k(OWNER_A, false, true), k(VAULT_A, false, true),
    k(OWNER_B, false, true), k(VAULT_B, false, true), k(arrays[0], false, true), k(arrays[1], false, true),
    k(arrays[2], false, true), k(ORACLE, false, true),
  ]);
}

const DOWN = [TICKS.m47872, TICKS.m49280, TICKS.m50688];
const UP = [TICKS.m47872, TICKS.m46464, TICKS.m45056];
const createOwnerA = createAssociatedTokenAccountIdempotentInstruction(OWNER, OWNER_A, OWNER, MINT_A, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const watched = [OWNER_A, OWNER_B, VAULT_A, VAULT_B, POSITION, POOL, SUPPLY, FEE, RESERVE];
const labels = ['walletWsol','walletTokenB','orcaVaultA','orcaVaultB','position','pool','klendSupply','klendFee','klendReserve'];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function decode(address, account) {
  if (!account?.data) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 165)
    return {kind: 'splToken', mint: new PublicKey(data.subarray(0, 32)).toBase58(), tokenOwner: new PublicKey(data.subarray(32, 64)).toBase58(), amountRaw: data.readBigUInt64LE(64).toString()};
  if (address.equals(POSITION)) return {kind: 'orcaPosition', liquidity: (data.readBigUInt64LE(72) + (data.readBigUInt64LE(80) << 64n)).toString(), tickLower: data.readInt32LE(88), tickUpper: data.readInt32LE(92), sha256: sha(data)};
  if (address.equals(POOL)) return {kind: 'orcaPool', liquidity: (data.readBigUInt64LE(49) + (data.readBigUInt64LE(57) << 64n)).toString(), sqrtPrice: (data.readBigUInt64LE(65) + (data.readBigUInt64LE(73) << 64n)).toString(), tickCurrent: data.readInt32LE(81), feeRate: data.readUInt16LE(45), protocolFeeRate: data.readUInt16LE(47), sha256: sha(data)};
  if (address.equals(RESERVE)) return {kind: 'klendReserve', availableRaw: data.readBigUInt64LE(224).toString(), flashFeeSf: data.readBigUInt64LE(4904).toString(), sha256: sha(data)};
  return {kind: 'state', sha256: sha(data), dataLength: data.length};
}
function delta(before, after) {
  if (before?.kind === 'splToken' && after?.kind === 'splToken') return (BigInt(after.amountRaw) - BigInt(before.amountRaw)).toString();
  if (!before && after?.kind === 'splToken') return after.amountRaw;
  if (before?.kind === 'orcaPosition' && after?.kind === 'orcaPosition') return (BigInt(after.liquidity) - BigInt(before.liquidity)).toString();
  if (before?.kind === 'klendReserve' && after?.kind === 'klendReserve') return (BigInt(after.availableRaw) - BigInt(before.availableRaw)).toString();
  return before?.sha256 && after?.sha256 ? String(before.sha256 === after.sha256) : null;
}
async function simulate(name, instructions, blockhash, preDecoded, meta = {}) {
  let encoded;
  try { encoded = encodeV1(instructions, OWNER, blockhash); }
  catch (error) { return {name, localError: error.message, ...meta}; }
  const request = {jsonrpc: '2.0', id: name, method: 'simulateTransaction', params: [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)}}]};
  let json;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request)});
    const text = await response.text();
    try { json = JSON.parse(text); } catch (error) {
      if (attempt === 5) throw new Error(`RPC non-JSON response after retries: ${text.slice(0, 120)}`);
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); continue;
    }
    if (!json.error || json.error.code !== 429) break;
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  const value = json.result?.value;
  const postDecoded = watched.map((address, i) => decode(address, value?.accounts?.[i]));
  return {name, ...meta, slot: json.result?.context?.slot || null, transportError: json.error || null, err: value?.err || null,
    sizeBytes: encoded.sizeBytes, equivalentV0Bytes: encoded.v0Bytes, addressCount: encoded.addressCount,
    writableCount: encoded.writableCount, instructionCount: encoded.instructionCount, signerCount: encoded.requiredSignatures,
    config: encoded.config, unitsConsumed: value?.unitsConsumed || null, loadedAccountsDataSize: value?.loadedAccountsDataSize || null,
    messageBase64: encoded.wire.toString('base64'), postDecoded,
    deltas: Object.fromEntries(watched.map((address, i) => [labels[i], delta(preDecoded[i], postDecoded[i])])),
    logs: value?.logs?.filter(x => /Instruction:|insufficient|failed:|Error|Program data:|threshold|tick/i.test(x)).slice(-70) || null,
    innerInstructions: value?.innerInstructions || null};
}
function transferAmount(result, source, destination) {
  let observed = null;
  for (const group of result.innerInstructions || []) for (const ix of group.instructions || []) {
    const info = ix.parsed?.info;
    if (info?.source === source.toBase58() && info?.destination === destination.toBase58())
      observed = BigInt(info.amount ?? info.tokenAmount?.amount ?? 0);
  }
  // Reposition/decrease transfers precede swaps in these probes. The last
  // matching transfer is the swap output, not the signer-owned LP withdrawal.
  return observed;
}
function readU128LE(data, offset) {
  return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}
function parseSwapEvent(result) {
  let parsed = null;
  for (const line of result.logs || []) {
    if (!line.startsWith('Program data: ')) continue;
    const data = Buffer.from(line.slice('Program data: '.length), 'base64');
    if (data.length !== 121 || data.subarray(0, 8).toString('hex') !== 'e1ca49af932ba096') continue;
    const postSqrtPriceX64 = readU128LE(data, 57);
    const ratio = Number(postSqrtPriceX64) / 2 ** 64;
    parsed = {aToB: data[40] === 1, preSqrtPriceX64: readU128LE(data, 41).toString(),
      postSqrtPriceX64: postSqrtPriceX64.toString(), postTickApprox: Math.floor(Math.log(ratio * ratio) / Math.log(1.0001)),
      amountARaw: data.readBigUInt64LE(73).toString(), amountBRaw: data.readBigUInt64LE(81).toString(),
      protocolFeeRaw: data.readBigUInt64LE(89).toString(), feeRaw: data.readBigUInt64LE(97).toString()};
  }
  return parsed;
}
function increasingArraysFromTick(tick) {
  const span = 88 * 16;
  const start = Math.floor(tick / span) * span;
  return [pda('tick_array', start), pda('tick_array', start + span), pda('tick_array', start + 2 * span)];
}
function base(amount) { return [createOwnerA, flashBorrow(amount), reposition(1n), decrease(1n)]; }

async function main() {
  const accountSet = [...watched, ...Object.values(TICKS), ORACLE];
  const pre = await conn.getMultipleAccountsInfoAndContext(accountSet, 'confirmed');
  const preDecoded = watched.map((address, i) => decode(address, pre.value[i]));
  const tickExistence = Object.fromEntries(Object.entries(TICKS).map(([name], i) => [name, !!pre.value[watched.length + i]]));
  const oracleExists = !!pre.value[watched.length + Object.keys(TICKS).length];
  const available = BigInt(preDecoded[8].availableRaw), feeRate = BigInt(preDecoded[8].flashFeeSf);
  if (feeRate !== 0n) throw new Error('selected reserve is not currently zero-fee');
  const positionLiquidity = BigInt(preDecoded[4].liquidity);
  const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  const results = [];
  const run = async (name, instructions, meta = {}) => {
    const result = await simulate(name, instructions, blockhash, preDecoded, meta); results.push(result);
    process.stdout.write(JSON.stringify({name, err: result.err, localError: result.localError, bytes: result.sizeBytes,
      accounts: result.addressCount, instructions: result.instructionCount, units: result.unitsConsumed,
      deltas: result.deltas, postPool: result.postDecoded?.[5], logs: result.logs?.slice(-5)}) + '\n');
    await new Promise(resolve => setTimeout(resolve, 220)); return result;
  };

  const baselineAmount = 1_000_000_000n;
  await run('authorized_position_withdrawal_baseline', [...base(baselineAmount), flashRepay(baselineAmount)],
    {kind: 'control', amountRaw: baselineAmount.toString()});

  const amounts = [1n, 2n, 10n, 1000n, 1_000_000n, 1_000_000_000n, 9_000_000_000n, available / 100n, available];
  const quotes = new Map();
  for (const amount of amounts) {
    const quote = await run(`forward_quote_${amount}`, [...base(amount), swap(amount, 0n, true, DOWN), flashRepay(amount)],
      {kind: 'A-to-B exact-input quote with full flash repayment attempted', amountRaw: amount.toString()});
    const event = parseSwapEvent(quote);
    const outB = event ? BigInt(event.amountBRaw) : transferAmount(quote, VAULT_B, OWNER_B);
    quote.swapEvent = event;
    quote.observedOutputBRaw = outB?.toString() ?? null;
    if (outB !== null && outB > 0n) quotes.set(amount.toString(), {outB, event});
  }

  for (const amount of amounts) {
    const quoteInfo = quotes.get(amount.toString());
    if (!quoteInfo) continue;
    const {outB, event} = quoteInfo;
    const reverseArrays = event ? increasingArraysFromTick(event.postTickApprox) : UP;
    const pair = [...base(amount), swap(amount, 0n, true, DOWN), swap(outB, 0n, false, reverseArrays), flashRepay(amount)];
    const reverse = await run(`forward_reverse_${amount}`, pair,
      {kind: 'KLend→Orca A-to-B→B-to-A→KLend', amountRaw: amount.toString(), observedForwardOutputBRaw: outB.toString(),
        forwardPostTickApprox: event?.postTickApprox ?? null, reverseTickArrays: reverseArrays.map(String)});
    reverse.observedReverseOutputARaw = transferAmount(reverse, VAULT_A, OWNER_A)?.toString() ?? null;
    reverse.reverseSwapEvent = parseSwapEvent(reverse);
  }

  const thresholdAmount = 1_000_000_000n, thresholdInfo = quotes.get(thresholdAmount.toString());
  if (thresholdInfo) {
    const thresholdOut = thresholdInfo.outB;
    await run('threshold_exact_observed_output', [...base(thresholdAmount), swap(thresholdAmount, thresholdOut, true, DOWN), flashRepay(thresholdAmount)],
      {kind: 'threshold boundary', amountRaw: thresholdAmount.toString(), otherAmountThresholdRaw: thresholdOut.toString()});
    await run('threshold_observed_output_plus_one', [...base(thresholdAmount), swap(thresholdAmount, thresholdOut + 1n, true, DOWN), flashRepay(thresholdAmount)],
      {kind: 'threshold boundary', amountRaw: thresholdAmount.toString(), otherAmountThresholdRaw: (thresholdOut + 1n).toString()});
    await run('order_reverse_before_forward', [...base(thresholdAmount), swap(thresholdOut, 0n, false, UP), swap(thresholdAmount, 0n, true, DOWN), flashRepay(thresholdAmount)],
      {kind: 'swap ordering', amountRaw: thresholdAmount.toString(), reverseFirstAmountBRaw: thresholdOut.toString()});
    const noncanonicalTickOrder = swap(thresholdAmount, 0n, true, [TICKS.m49280, TICKS.m47872, TICKS.m50688]);
    await run('noncanonical_unused_tick_array_order', [...base(thresholdAmount), noncanonicalTickOrder, flashRepay(thresholdAmount)],
      {kind: 'tick-array order mutation (tests whether unused arrays are required to be canonical)', amountRaw: thresholdAmount.toString()});
    const missingCurrentTick = swap(thresholdAmount, 0n, true, [TICKS.m50688, TICKS.m50688, TICKS.m50688]);
    await run('negative_missing_current_tick_array', [...base(thresholdAmount), missingCurrentTick, flashRepay(thresholdAmount)],
      {kind: 'tick-array substitution', amountRaw: thresholdAmount.toString()});
    const badOracle = swap(thresholdAmount, 0n, true, DOWN); badOracle.keys[10].pubkey = POOL;
    await run('negative_oracle_alias_to_pool', [...base(thresholdAmount), badOracle, flashRepay(thresholdAmount)],
      {kind: 'oracle alias mutation', amountRaw: thresholdAmount.toString()});
    const badSource = swap(thresholdAmount, 0n, true, DOWN); badSource.keys[3].pubkey = VAULT_A;
    await run('negative_swap_source_alias_to_vault', [...base(thresholdAmount), badSource, flashRepay(thresholdAmount)],
      {kind: 'source alias mutation', amountRaw: thresholdAmount.toString()});
    for (const rounds of [2, 3, 4]) {
      const sequence = base(thresholdAmount);
      for (let i = 0; i < rounds; i++) sequence.push(swap(thresholdAmount, 0n, true, DOWN), swap(thresholdOut, 0n, false, UP));
      sequence.push(flashRepay(thresholdAmount));
      await run(`repeated_swap_pairs_${rounds}`, sequence,
        {kind: 'repeated forward/reverse swaps', amountRaw: thresholdAmount.toString(), forwardOutputBRaw: thresholdOut.toString(), rounds});
    }
  }

  const baseline = results.find(x => x.name === 'authorized_position_withdrawal_baseline');
  const successfulRoundTrips = results.filter(x => x.name.startsWith('forward_reverse_') && !x.err && !x.transportError && !x.localError);
  const residualAnalysis = successfulRoundTrips.map(x => ({name: x.name, amountRaw: x.amountRaw,
    walletWsolDeltaRaw: x.deltas.walletWsol, baselineWalletWsolDeltaRaw: baseline.deltas.walletWsol,
    incrementalWalletWsolVsAuthorizedBaselineRaw: (BigInt(x.deltas.walletWsol) - BigInt(baseline.deltas.walletWsol)).toString(),
    walletTokenBDeltaRaw: x.deltas.walletTokenB, baselineWalletTokenBDeltaRaw: baseline.deltas.walletTokenB,
    incrementalWalletTokenBVsAuthorizedBaselineRaw: (BigInt(x.deltas.walletTokenB) - BigInt(baseline.deltas.walletTokenB)).toString(),
    klendSupplyDeltaRaw: x.deltas.klendSupply, klendFeeDeltaRaw: x.deltas.klendFee, klendReserveDeltaRaw: x.deltas.klendReserve,
    observedForwardOutputBRaw: x.observedForwardOutputBRaw, observedReverseOutputARaw: x.observedReverseOutputARaw}));

  const output = {generatedAt: new Date().toISOString(), safety: {readOnly: true, simulateTransactionOnly: true, submitted: false, sigVerify: false},
    transactionFormat: {version: 1, maxBytes: 4096, maxInlineAddresses: 64, encoder: 'local v1 encoder preserved in klend-v1-composition.js'},
    programs: {klend: KLEND.toBase58(), orca: ORCA.toBase58()},
    flashReserve: {...reserveRow, reserveAccountReadSlot: pre.context.slot, currentDecodedAvailableRaw: available.toString(),
      currentDecodedFlashFeeSf: feeRate.toString(), marketAuthority: MARKET_AUTHORITY.toBase58(), feeClassification: 'exact-zero-rate, not rounded'},
    target: {pool: POOL.toBase58(), position: POSITION.toBase58(), positionAuthority: OWNER.toBase58(), positionLiquidity: positionLiquidity.toString(),
      poolPre: preDecoded[5], tickArrays: Object.fromEntries(Object.entries(TICKS).map(([name, address]) => [name, address.toBase58()])),
      tickArrayExistence: tickExistence, oracle: ORACLE.toBase58(), oracleExists,
      sourceMinMax: {minSqrtPriceX64: MIN_SQRT_PRICE_X64.toString(), maxSqrtPriceX64: MAX_SQRT_PRICE_X64.toString()}},
    watched: watched.map(String), watchedLabels: labels, preDecoded,
    accounting: {authorizedBaseline: baseline.name, residualAnalysis,
      interpretation: 'Each round trip begins by withdrawing the signer-owned position. Incremental residuals are therefore measured against that authorized withdrawal baseline. A positive absolute wallet delta is not an unauthorized gain. Successful flash cases must restore KLend supply, fee, and reserve available balances.'},
    results};
  const outputPath = 'composer-runs/2026-10-15/orca-swap-v1-extremes.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  const stable = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation';
  fs.mkdirSync(stable, {recursive: true});
  fs.writeFileSync(`${stable}/orca-swap-v1-extremes.json`, JSON.stringify(output, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
