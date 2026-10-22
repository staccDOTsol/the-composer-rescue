#!/usr/bin/env node
'use strict';

// Signed, simulation-only private-fork compositions:
// 2/3 distinct USDC flash providers -> exact SolFi V2 pool -> independent
// USDT/USDC exit -> full repayment. No send/broadcast path exists.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage, SystemProgram,
} = require(MOD + '/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require(MOD + '/@solana/spl-token');
const bsModule = require(MOD + '/bs58');
const bs58 = bsModule.default || bsModule;
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');

const DIR = __dirname;
const OCT15 = path.join(DIR, '../2026-10-15');
const OUT = path.join(DIR, process.env.SOLFI_FLASH_OUTPUT || 'solfi-v2-multiflash-extremes.json');
const FORK = process.env.SOLFI_FORK_RPC || 'http://127.0.0.1:9139';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const P = value => new PublicKey(value);
const SOLFI = P('SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF');
const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';
const POOL_USDC = P('ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc');
const POOL_USDT = P('5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT = P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const WSOL = P('So11111111111111111111111111111111111111112');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const TOTAL_RAW = BigInt(process.env.SOLFI_FLASH_INPUT_RAW || '100000000000'); // $100k
const EXIT_INPUT_BPS = BigInt(process.env.SOLFI_EXIT_INPUT_BPS || '9999');
const P0_SOURCE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SAVE_SOURCE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const KLEND_USDC = {
  reserve: P('AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z'),
  market: P('47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8'),
  supply: P('8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB'),
  fee: P('5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj'),
};
const KLEND_AUTHORITY = PublicKey.findProgramAddressSync([
  Buffer.from('lma'), KLEND_USDC.market.toBuffer()], KLEND)[0];
const SAVE_USDC = {
  reserve: P('BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw'),
  market: P('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'),
  marketAuthority: P('DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby'),
  supply: P('8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf'),
  fee: P('5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP'),
};
let id = 0;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function loadUpstream() {
  const values = {};
  for (const raw of fs.readFileSync('/private/tmp/codex-mainnet-rpc-2026-10-19.env', 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const endpoint = values.RPC || values.SOLANA_RPC || values.SOLANA_RPC_URL;
  if (!endpoint) throw new Error('upstream RPC unavailable');
  return endpoint;
}
const UPSTREAM = loadUpstream();

async function rpc(url, method, params = []) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const fork = (method, params) => rpc(FORK, method, params);

async function requestJson(url, options = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(120_000)});
    const body = await response.json();
    if (response.ok && !body.error) return body;
    if (response.status !== 429 || attempt === 5) {
      throw new Error(`${new URL(url).pathname}: ${response.status} ${body.error || ''}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
}

async function quote(inputMint, outputMint, amount, mode) {
  const params = new URLSearchParams({inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(),
    amount: amount.toString(), slippageBps: '100', onlyDirectRoutes: 'true', maxAccounts: '24'});
  if (mode === 'solfi') params.set('dexes', 'SolFi V2');
  if (mode === 'independent') params.set('excludeDexes', 'SolFi V2');
  return requestJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
}

async function swapInstructions(quoteResponse, user) {
  return requestJson('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
      quoteResponse, userPublicKey: user.toBase58(), wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: false, prioritizationFeeLamports: 0,
    }),
  });
}

function jupiterIx(row) {
  return new TransactionInstruction({programId: P(row.programId), keys: row.accounts.map(key => ({
    pubkey: P(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable,
  })), data: Buffer.from(row.data, 'base64')});
}

function jupiterSet(result) {
  if (result.tokenLedgerInstruction) throw new Error('unexpected token ledger');
  return [...(result.otherInstructions || []), ...(result.setupInstructions || []),
    result.swapInstruction, ...(result.cleanupInstruction ? [result.cleanupInstruction] : [])]
    .filter(Boolean).map(jupiterIx);
}

function historyIx(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const h = message.header;
  const writable = keyIndex => keyIndex < message.accountKeys.length
    ? (keyIndex < h.numRequiredSignatures
      ? keyIndex < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : keyIndex < message.accountKeys.length - h.numReadonlyUnsignedAccounts)
    : keyIndex < message.accountKeys.length + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map(keyIndex => ({pubkey: P(keys[keyIndex]),
      isSigner: keyIndex < h.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}

const clone = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});

function klendPair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow); const repay = clone(templates.repay);
  for (const ix of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: KLEND_AUTHORITY,
      2: KLEND_USDC.market, 3: KLEND_USDC.reserve, 4: USDC, 5: KLEND_USDC.supply,
      6: destination, 7: KLEND_USDC.fee, 11: TOKEN_PROGRAM_ID})) ix.keys[+index].pubkey = pubkey;
    ix.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}

function savePair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow); const repay = clone(templates.repay);
  for (const [index, pubkey] of Object.entries({0: SAVE_USDC.supply, 1: destination,
    2: SAVE_USDC.reserve, 3: SAVE_USDC.market, 4: SAVE_USDC.marketAuthority,
    5: IX_SYSVAR, 6: TOKEN_PROGRAM_ID})) borrow.keys[+index].pubkey = pubkey;
  for (const [index, pubkey] of Object.entries({0: destination, 1: SAVE_USDC.supply,
    2: SAVE_USDC.fee, 3: destination, 4: SAVE_USDC.reserve, 5: SAVE_USDC.market,
    6: authority, 7: IX_SYSVAR, 8: TOKEN_PROGRAM_ID})) repay.keys[+index].pubkey = pubkey;
  borrow.data.writeBigUInt64LE(amount, 1); repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}

function p0Set(templates, authority, marginAccount, destination, amount) {
  const start = clone(templates.start), borrow = clone(templates.borrow),
    repay = clone(templates.repay), end = clone(templates.end);
  start.keys[0].pubkey = marginAccount; start.keys[1].pubkey = authority;
  borrow.keys[1].pubkey = marginAccount; borrow.keys[2].pubkey = authority;
  borrow.keys[4].pubkey = destination; borrow.data.writeBigUInt64LE(amount, 8);
  repay.keys[1].pubkey = marginAccount; repay.keys[2].pubkey = authority;
  repay.keys[4].pubkey = destination; repay.data.writeBigUInt64LE(amount, 8);
  end.keys[0].pubkey = marginAccount; end.keys[2].pubkey = authority;
  return {start, borrow, repay, end};
}

function p0Initialize(group, account, authority) {
  return new TransactionInstruction({programId: P0, keys: [
    {pubkey: group, isSigner: false, isWritable: false},
    {pubkey: account, isSigner: true, isWritable: true},
    {pubkey: authority, isSigner: true, isWritable: false},
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});
}

function saveFee(amount) { return (amount * 4n + 9_999n) / 10_000n; }

function tokenData(mint, authority, amount) {
  const data = Buffer.alloc(165); mint.toBuffer().copy(data, 0); authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64); data[108] = 1; return data.toString('hex');
}

function signV1(encoded, instructions, payer, signers, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const order = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const byAddress = new Map(signers.map(keypair => [keypair.publicKey.toBase58(), keypair]));
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64 * encoded.requiredSignatures);
  order.forEach((address, index) => {
    const keypair = byAddress.get(address); if (!keypair) throw new Error(`uncontrolled signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(wire, wire.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {wire, order};
}

function image(account) {
  if (!account) return {exists: false, lamports: '0', tokenAmountRaw: null};
  const data = Buffer.from(account.data[0], 'base64');
  return {exists: true, lamports: String(account.lamports), owner: account.owner,
    tokenAmountRaw: account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72
      ? data.readBigUInt64LE(64).toString() : null, dataSha256: sha256(data)};
}

function delta(after, before, field) {
  if (after[field] == null || before[field] == null) return null;
  return (BigInt(after[field]) - BigInt(before[field])).toString();
}

function solfiParents(logs) {
  const stack = [], found = [];
  for (const line of logs || []) {
    const match = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (!match) continue;
    const depth = Number(match[2]); stack.length = depth - 1;
    const parent = depth > 1 ? stack[depth - 2] || null : null; stack[depth - 1] = match[1];
    if (match[1] === SOLFI.toBase58()) found.push({depth, immediateParent: parent});
  }
  return found;
}

async function importInstructions(instructions) {
  const addresses = [...new Map(instructions.flatMap(ix => [ix.programId,
    ...ix.keys.map(key => key.pubkey)]).map(address => [address.toBase58(), address])).values()];
  for (const address of addresses) await fork('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
}

async function runCase(label, providers, routeInstructions, ctx, feeUsdcRaw, allocation = null) {
  const count = BigInt(providers.length), base = TOTAL_RAW / count, remainder = TOTAL_RAW % count;
  const amounts = allocation || Object.fromEntries(providers.map((provider, index) =>
    [provider, base + (BigInt(index) < remainder ? 1n : 0n)]));
  if (Object.values(amounts).reduce((sum, value) => sum + value, 0n) !== TOTAL_RAW) {
    throw new Error(`${label}: provider allocation does not equal route input`);
  }
  const klend = providers.includes('klend') ? klendPair(ctx.klendTemplates,
    ctx.authority.publicKey, ctx.usdcAta, amounts.klend) : null;
  const p0 = providers.includes('project0') ? p0Set(ctx.p0Templates, ctx.authority.publicKey,
    ctx.marginAccount.publicKey, ctx.usdcAta, amounts.project0) : null;
  const save = providers.includes('save') ? savePair(ctx.saveTemplates, ctx.authority.publicKey,
    ctx.usdcAta, amounts.save) : null;
  const instructions = [];
  if (p0) instructions.push(p0Initialize(ctx.p0Group, ctx.marginAccount.publicKey, ctx.authority.publicKey));
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey,
    ctx.usdcAta, ctx.authority.publicKey, USDC));
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey,
    ctx.usdtAta, ctx.authority.publicKey, USDT));
  if (p0) instructions.push(p0.start);
  if (klend) instructions.push(klend.borrow);
  if (p0) instructions.push(p0.borrow);
  if (save) instructions.push(save.borrow);
  instructions.push(...routeInstructions);
  if (klend) instructions.push(klend.repay);
  if (p0) instructions.push(p0.repay);
  if (save) instructions.push(save.repay);
  if (p0) instructions.push(p0.end);
  if (p0) p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
  if (klend) klend.repay.data[16] = instructions.indexOf(klend.borrow);
  if (save) save.repay.data[9] = instructions.indexOf(save.borrow);
  await importInstructions(instructions);
  const beforeResult = await fork('getMultipleAccounts', [ctx.watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const before = beforeResult.value.map(image);
  const blockhash = (await fork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  let encoded;
  try { encoded = encodeV1(instructions, ctx.authority.publicKey, blockhash); }
  catch (error) { return {label, providers, envelopeError: error.message, completeRepayment: false}; }
  const signed = signV1(encoded, instructions, ctx.authority.publicKey,
    [ctx.authority, ctx.marginAccount], blockhash);
  const simulation = await fork('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: ctx.watched.map(String)},
  }]);
  // Surfpool can omit the entire returned-account vector when execution aborts.
  // Preserve a role-complete evidence row so the exact simulator error and logs
  // are recorded instead of masking them with a local indexing exception.
  const returnedAccounts = simulation.value.accounts || [];
  const after = ctx.watched.map((_, index) => image(returnedAccounts[index]));
  const changes = Object.fromEntries(Object.entries(ctx.roles).map(([role, index]) => [role, {
    tokenAmountRaw: delta(after[index], before[index], 'tokenAmountRaw'),
    lamports: delta(after[index], before[index], 'lamports'),
  }]));
  const expectedSaveFee = save ? saveFee(amounts.save) : 0n;
  const lenderChecks = {
    klendSupplyRestored: !klend || changes.klendSupply.tokenAmountRaw === '0',
    project0VaultRestored: !p0 || changes.project0Vault.tokenAmountRaw === '0',
    saveSupplyRestored: !save || changes.saveSupply.tokenAmountRaw === '0',
    saveFeePaid: !save || changes.saveFee.tokenAmountRaw === expectedSaveFee.toString(),
  };
  const combinedSolLamports = BigInt(changes.outsider.lamports || 0) +
    BigInt(changes.marginAccount.lamports || 0);
  const walletStableRaw = BigInt(changes.outsiderUsdc.tokenAmountRaw || 0) +
    BigInt(changes.outsiderUsdt.tokenAmountRaw || 0);
  const networkCostRaw = combinedSolLamports < 0n ? BigInt(feeUsdcRaw) : 0n;
  const row = {label, providers,
    amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toString()])),
    routeInputRaw: TOTAL_RAW.toString(), expectedSaveFeeRaw: expectedSaveFee.toString(),
    err: simulation.value.err || null, unitsConsumed: simulation.value.unitsConsumed,
    loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
    envelope: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, writableAddresses: encoded.writableCount,
      requiredSignatures: encoded.requiredSignatures, signerOrder: signed.order,
      sigVerify: true, withinLimits: encoded.sizeBytes <= 4096 && encoded.addressCount <= 64,
      signedWireSha256: sha256(signed.wire), signedWirePersisted: false},
    lenderChecks, changes,
    finalWalletStableDeltaRaw: walletStableRaw.toString(),
    combinedWalletAndMarginLamportsDelta: combinedSolLamports.toString(),
    networkFeeUsdcEquivalentRaw: networkCostRaw.toString(),
    finalWalletEquityAfterNetworkFeeRaw: (walletStableRaw - networkCostRaw).toString(),
    solfiStableEquityDeltaRaw: (BigInt(changes.solfiUsdcVault.tokenAmountRaw || 0) +
      BigInt(changes.solfiUsdtVault.tokenAmountRaw || 0)).toString(),
    solfiParents: solfiParents(simulation.value.logs),
    completeRepayment: simulation.value.err === null && Object.values(lenderChecks).every(Boolean),
    logs: simulation.value.logs || [], broadcast: false};
  console.log(JSON.stringify({label, err: row.err, envelope: row.envelope,
    lenderChecks, finalWalletEquityAfterNetworkFeeRaw: row.finalWalletEquityAfterNetworkFeeRaw,
    solfiStableEquityDeltaRaw: row.solfiStableEquityDeltaRaw,
    completeRepayment: row.completeRepayment}));
  return row;
}

async function main() {
  if (await fork('getGenesisHash') !== MAINNET_GENESIS) throw new Error('fork is not mainnet-beta');
  const authority = Keypair.generate(), marginAccount = Keypair.generate();
  const usdcAta = getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const usdtAta = getAssociatedTokenAddressSync(USDT, authority.publicKey);
  await fork('surfnet_setAccount', [authority.publicKey.toBase58(), {data: '', executable: false,
    lamports: 20_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await fork('surfnet_setAccount', [usdcAta.toBase58(), {data: tokenData(USDC, authority.publicKey,
    1_000_000_000n), executable: false, lamports: 2_039_280,
    owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0}]);
  await fork('surfnet_setAccount', [usdtAta.toBase58(), {data: tokenData(USDT, authority.publicKey,
    1_000_000n), executable: false, lamports: 2_039_280,
    owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0}]);

  const forward = await quote(USDC, USDT, TOTAL_RAW, 'solfi');
  const forwardRoute = forward.routePlan || [];
  if (forwardRoute.length !== 1 || forwardRoute[0].swapInfo?.label !== 'SolFi V2' ||
      forwardRoute[0].swapInfo?.ammKey !== POOL) throw new Error('forward route is not exact SolFi pool');
  // The quote service observes a slightly newer bank than the nested fork. Keep
  // 1 bp of quoted SolFi output as USDT so harmless bank drift cannot turn the
  // independent exit into an insufficient-funds false negative.
  const exitInputRaw = BigInt(forward.outAmount) * EXIT_INPUT_BPS / 10_000n;
  const exit = await quote(USDT, USDC, exitInputRaw, 'independent');
  if ((exit.routePlan || []).some(row => row.swapInfo?.label === 'SolFi V2' ||
      row.swapInfo?.ammKey === POOL)) throw new Error('exit aliases SolFi');
  const feeQuote = await quote(WSOL, USDC, 10_000n, 'independent');
  const [forwardBuilt, exitBuilt, saveSource, p0Source] = await Promise.all([
    swapInstructions(forward, authority.publicKey), swapInstructions(exit, authority.publicKey),
    rpc(UPSTREAM, 'getTransaction', [SAVE_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc(UPSTREAM, 'getTransaction', [P0_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  if (!saveSource || !p0Source) throw new Error('provider source transaction unavailable');
  const saveTemplates = {borrow: historyIx(saveSource, 6), repay: historyIx(saveSource, 12)};
  const p0Templates = {start: historyIx(p0Source, 1), borrow: historyIx(p0Source, 2),
    repay: historyIx(p0Source, 5), end: historyIx(p0Source, 6)};
  const klendSource = JSON.parse(fs.readFileSync(path.join(OCT15, 'kamino-flash-history.json')))
    .hits[0].transaction;
  const klendTemplates = {borrow: historyIx(klendSource, 3), repay: historyIx(klendSource, 13)};
  const p0Group = p0Templates.borrow.keys[0].pubkey;
  const p0Vault = p0Templates.borrow.keys[6].pubkey;
  const routeInstructions = [...jupiterSet(forwardBuilt), ...jupiterSet(exitBuilt)];
  const watched = [authority.publicKey, marginAccount.publicKey, usdcAta, usdtAta,
    POOL_USDC, POOL_USDT, KLEND_USDC.supply, p0Vault, SAVE_USDC.supply, SAVE_USDC.fee];
  const roles = {outsider: 0, marginAccount: 1, outsiderUsdc: 2, outsiderUsdt: 3,
    solfiUsdcVault: 4, solfiUsdtVault: 5, klendSupply: 6, project0Vault: 7,
    saveSupply: 8, saveFee: 9};
  const ctx = {authority, marginAccount, usdcAta, usdtAta, p0Group, watched, roles,
    saveTemplates, p0Templates, klendTemplates};
  const amountLabel = `${TOTAL_RAW / 1_000_000n}usdc`;
  const saveLeg = 1_000_000_000n;
  const nonSaveRemainder = TOTAL_RAW - saveLeg;
  if (nonSaveRemainder <= 0n) throw new Error('total must exceed fixed Save feasibility leg');
  const cases = [
    await runCase(`two_provider_${amountLabel}`, ['klend', 'project0'], routeInstructions, ctx,
      feeQuote.outAmount || '0'),
    await runCase(`three_provider_${amountLabel}`, ['klend', 'project0', 'save'], routeInstructions, ctx,
      feeQuote.outAmount || '0', {klend: nonSaveRemainder / 2n,
        project0: nonSaveRemainder - nonSaveRemainder / 2n, save: saveLeg}),
  ];
  const capacityAddresses = [SAVE_USDC.reserve, SAVE_USDC.supply, KLEND_USDC.reserve,
    KLEND_USDC.supply, p0Vault];
  const capacityRows = await fork('getMultipleAccounts', [capacityAddresses.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const data = capacityRows.value.map(row => Buffer.from(row.data[0], 'base64'));
  const result = {generatedAtUtc: new Date().toISOString(), network: 'private nested current fork',
    genesis: MAINNET_GENESIS, target: {program: SOLFI.toBase58(), pool: POOL},
    route: {inputRaw: TOTAL_RAW.toString(), solfiOutputRaw: forward.outAmount,
      exitInputBps: EXIT_INPUT_BPS.toString(),
      independentExitInputRaw: exitInputRaw.toString(), independentExitOutputRaw: exit.outAmount,
      quotedResidualUsdtRaw: (BigInt(forward.outAmount) - exitInputRaw).toString(),
      grossQuotedStableDeltaRaw: (BigInt(exit.outAmount) + BigInt(forward.outAmount) -
        exitInputRaw - TOTAL_RAW).toString(),
      forwardContextSlot: forward.contextSlot, exitContextSlot: exit.contextSlot,
      forward: forwardRoute.map(row => ({label: row.swapInfo?.label, ammKey: row.swapInfo?.ammKey})),
      exit: (exit.routePlan || []).map(row => ({label: row.swapInfo?.label,
        ammKey: row.swapInfo?.ammKey}))},
    providers: {programs: {klend: KLEND.toBase58(), project0: P0.toBase58(), save: SAVE.toBase58()},
      capacities: {saveAvailableRaw: data[0].readBigUInt64LE(171).toString(),
        saveSupplyRaw: data[1].readBigUInt64LE(64).toString(),
        klendAvailableRaw: data[2].readBigUInt64LE(224).toString(),
        klendFlashFeeSf: data[2].readBigUInt64LE(4904).toString(),
        klendSupplyRaw: data[3].readBigUInt64LE(64).toString(),
        project0VaultRaw: data[4].readBigUInt64LE(64).toString()}},
    outsider: {publicKey: authority.publicKey.toBase58(), marginAccount: marginAccount.publicKey.toBase58(),
      privateKeysPersisted: false, syntheticUsdcSeedRaw: '1000000000', syntheticUsdtSeedRaw: '1000000'},
    feeBasis: {twoSignaturesLamports: '10000', usdcEquivalentRaw: feeQuote.outAmount || '0',
      klendFee: 'exact zero', project0Fee: 'exact zero', saveFee: 'ceil(principal*4/10000)'},
    cases, safety: {broadcast: false, sendTransactionPathPresent: false,
      signedWiresPersisted: false, forkMutation: 'fresh outsider and its two token accounts only'}};
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({evidence: OUT, generatedAtUtc: result.generatedAtUtc,
    route: result.route, providers: result.providers, cases: cases.map(row => ({label: row.label,
      err: row.err, envelopeError: row.envelopeError, envelope: row.envelope,
      lenderChecks: row.lenderChecks, finalWalletStableDeltaRaw: row.finalWalletStableDeltaRaw,
      finalWalletEquityAfterNetworkFeeRaw: row.finalWalletEquityAfterNetworkFeeRaw,
      solfiStableEquityDeltaRaw: row.solfiStableEquityDeltaRaw,
      completeRepayment: row.completeRepayment})), safety: result.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
