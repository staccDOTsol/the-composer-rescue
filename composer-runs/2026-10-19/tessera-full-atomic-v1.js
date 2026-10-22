#!/usr/bin/env node
'use strict';

// Signed mainnet-beta simulateTransaction-only v1 compositions:
// 2/3 USDC flash providers -> Tessera USDC/WSOL -> independent WSOL/USDC
// exit -> exact provider repayment. No send/broadcast path exists.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const web3 = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bsModule = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bsModule.default || bsModule;
const {Keypair, PublicKey, TransactionInstruction, TransactionMessage, SystemProgram} = web3;
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');
const DIR = __dirname;
const OCT15 = path.join(DIR, '../2026-10-15');
const OUT = path.join(DIR, 'tessera-full-atomic-v1.json');
const P = value => new PublicKey(value);
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TESSERA = P('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
const TESSERA_POOL = P('FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n');
const TESSERA_WSOL = P('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const TESSERA_USDC = P('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const SAVE_SOURCE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const P0_SOURCE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const KLEND_USDC = {reserve: P('AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z'),
  market: P('47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8'),
  supply: P('8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB'),
  fee: P('5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj')};
const SAVE_USDC = {reserve: P('BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw'),
  market: P('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'),
  marketAuthority: P('DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby'),
  supply: P('8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf'),
  fee: P('5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP')};
const TOTAL = 10_000_000n;
const EXIT_BUFFER = 10_000n;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let rpcId = 0;
function endpoint() {
  const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
    .split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
  return row.slice(row.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}
const RPC = endpoint();
async function rpc(method, params = []) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json(); if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function requestJson(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(60_000)});
    const text = await response.text(); let body;
    try { body = JSON.parse(text); } catch { body = {error: text.slice(0, 240)}; }
    last = {status: response.status, body};
    if (response.ok && !body.error) return last;
    if (response.status !== 429 && response.status < 500) return last;
    await sleep(1_500 * (attempt + 1));
  }
  return last;
}
function ix(row) { return new TransactionInstruction({programId: P(row.programId),
  data: Buffer.from(row.data, 'base64'), keys: row.accounts.map(key => ({pubkey: P(key.pubkey),
    isSigner: key.isSigner, isWritable: key.isWritable}))}); }
function routeSet(build) {
  if (build.tokenLedgerInstruction) throw new Error('unexpected token ledger');
  return [...(build.otherInstructions || []), ...(build.setupInstructions || []), build.swapInstruction,
    ...(build.cleanupInstruction ? [build.cleanupInstruction] : [])].filter(Boolean).map(ix);
}
async function quote(inputMint, outputMint, amount, mode) {
  const params = new URLSearchParams({inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(),
    amount: amount.toString(), slippageBps: '100', onlyDirectRoutes: 'true', maxAccounts: '24'});
  if (mode === 'tessera') params.set('dexes', 'TesseraV'); else params.set('excludeDexes', 'TesseraV');
  return requestJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
}
async function build(quoteResponse, user) { return requestJson('https://lite-api.jup.ag/swap/v1/swap-instructions', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({quoteResponse,
    userPublicKey: user.toBase58(), wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false,
    prioritizationFeeLamports: 0})}); }
function historyIx(tx, index) {
  const m = tx.transaction.message, keys = [...m.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])], h = m.header, n = m.accountKeys.length;
  const writable = i => i < n ? (i < h.numRequiredSignatures
    ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
    : i < n - h.numReadonlyUnsignedAccounts)
    : i < n + (tx.meta.loadedAddresses?.writable || []).length;
  const source = m.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map(i => ({pubkey: P(keys[i]), isSigner: i < h.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(source.data))});
}
const clone = source => new TransactionInstruction({programId: source.programId,
  keys: source.keys.map(key => ({...key})), data: Buffer.from(source.data)});
function klendPair(t, authority, destination, amount) {
  const borrow = clone(t.borrow), repay = clone(t.repay);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'),
    KLEND_USDC.market.toBuffer()], KLEND)[0];
  for (const instruction of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: marketAuthority,
      2: KLEND_USDC.market, 3: KLEND_USDC.reserve, 4: USDC, 5: KLEND_USDC.supply,
      6: destination, 7: KLEND_USDC.fee, 11: TOKEN})) instruction.keys[Number(index)].pubkey = pubkey;
    instruction.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}
function savePair(t, authority, destination, amount) {
  const borrow = clone(t.borrow), repay = clone(t.repay);
  for (const [index, pubkey] of Object.entries({0: SAVE_USDC.supply, 1: destination,
    2: SAVE_USDC.reserve, 3: SAVE_USDC.market, 4: SAVE_USDC.marketAuthority,
    5: IX_SYSVAR, 6: TOKEN})) borrow.keys[Number(index)].pubkey = pubkey;
  for (const [index, pubkey] of Object.entries({0: destination, 1: SAVE_USDC.supply,
    2: SAVE_USDC.fee, 3: destination, 4: SAVE_USDC.reserve, 5: SAVE_USDC.market,
    6: authority, 7: IX_SYSVAR, 8: TOKEN})) repay.keys[Number(index)].pubkey = pubkey;
  borrow.data.writeBigUInt64LE(amount, 1); repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}
function p0Set(t, authority, margin, destination, amount) {
  const start = clone(t.start), borrow = clone(t.borrow), repay = clone(t.repay), end = clone(t.end);
  start.keys[0].pubkey = margin; start.keys[1].pubkey = authority;
  borrow.keys[1].pubkey = margin; borrow.keys[2].pubkey = authority;
  borrow.keys[4].pubkey = destination; borrow.data.writeBigUInt64LE(amount, 8);
  repay.keys[1].pubkey = margin; repay.keys[2].pubkey = authority;
  repay.keys[4].pubkey = destination; repay.data.writeBigUInt64LE(amount, 8);
  end.keys[0].pubkey = margin; end.keys[2].pubkey = authority;
  return {start, borrow, repay, end};
}
function p0Initialize(group, account, authority) { return new TransactionInstruction({programId: P0, keys: [
  {pubkey: group, isSigner: false, isWritable: false}, {pubkey: account, isSigner: true, isWritable: true},
  {pubkey: authority, isSigner: true, isWritable: false}, {pubkey: authority, isSigner: true, isWritable: true},
  {pubkey: SystemProgram.programId, isSigner: false, isWritable: false}],
  data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])}); }
function signV1(encoded, instructions, payer, signers, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const order = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const byAddress = new Map(signers.map(key => [key.publicKey.toBase58(), key]));
  const wire = Buffer.from(encoded.wire), message = wire.subarray(0, wire.length - 64 * encoded.requiredSignatures);
  order.forEach((address, index) => {
    const signer = byAddress.get(address); if (!signer) throw new Error(`uncontrolled signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(signer.secretKey.subarray(0, 32))]),
      format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey).copy(wire, wire.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {wire, order};
}
function amount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64) : null;
}
async function simulate(label, providers, ctx) {
  const counts = BigInt(providers.length), base = TOTAL / counts, rem = TOTAL % counts;
  const allocations = Object.fromEntries(providers.map((name, index) => [name,
    base + (BigInt(index) < rem ? 1n : 0n)]));
  const klend = providers.includes('klend') ? klendPair(ctx.klendTemplates, ctx.authority.publicKey,
    ctx.usdcAta, allocations.klend) : null;
  const p0 = providers.includes('project0') ? p0Set(ctx.p0Templates, ctx.authority.publicKey,
    ctx.margin.publicKey, ctx.usdcAta, allocations.project0) : null;
  const save = providers.includes('save') ? savePair(ctx.saveTemplates, ctx.authority.publicKey,
    ctx.usdcAta, allocations.save) : null;
  const instructions = [p0Initialize(ctx.p0Group, ctx.margin.publicKey, ctx.authority.publicKey),
    spl.createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey, ctx.usdcAta,
      ctx.authority.publicKey, USDC),
    spl.createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey, ctx.wsolAta,
      ctx.authority.publicKey, WSOL), p0.start];
  if (save) instructions.push(save.borrow);
  if (klend) instructions.push(klend.borrow);
  instructions.push(p0.borrow, ...ctx.forwardInstructions, ...ctx.exitInstructions, p0.repay);
  if (klend) instructions.push(klend.repay);
  if (save) instructions.push(save.repay);
  instructions.push(p0.end);
  p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
  if (klend) klend.repay.data[16] = instructions.indexOf(klend.borrow);
  if (save) save.repay.data[9] = instructions.indexOf(save.borrow);
  const before = await rpc('getMultipleAccounts', [ctx.watched.map(String),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const encoded = encodeV1(instructions, ctx.authority.publicKey, blockhash);
  const signed = signV1(encoded, instructions, ctx.authority.publicKey,
    [ctx.authority, ctx.margin], blockhash);
  const response = await rpc('simulateTransaction', [signed.wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: ctx.watched.map(String)}}]);
  const after = response.value.accounts || [];
  const deltas = Object.fromEntries(Object.entries(ctx.roles).map(([role, index]) => {
    const pre = amount(before.value[index]), post = amount(after[index]);
    return [role, pre == null || post == null ? null : (post - pre).toString()];
  }));
  const callerUsdc = deltas.callerUsdc == null ? null : BigInt(deltas.callerUsdc);
  const callerWsol = deltas.callerWsol == null ? null : BigInt(deltas.callerWsol);
  const saveFee = save ? (allocations.save * 4n + 9_999n) / 10_000n : 0n;
  const lendersRestored = deltas.klendSupply === '0' && deltas.project0Vault === '0' &&
    (!save || deltas.saveSupply === '0');
  return {label, providers, allocationsRaw: Object.fromEntries(Object.entries(allocations)
    .map(([key, value]) => [key, value.toString()])), routeInputRaw: TOTAL.toString(),
    expectedSaveFeeRaw: saveFee.toString(), beforeSlot: before.context.slot,
    simulationSlot: response.context.slot, err: response.value.err || null,
    unitsConsumed: response.value.unitsConsumed, loadedAccountsDataSize: response.value.loadedAccountsDataSize,
    envelope: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: signed.order, sigVerify: true, withinLimits: encoded.sizeBytes <= 4096 &&
        encoded.addressCount <= 64, signedWireSha256: sha256(signed.wire), signedWirePersisted: false},
    deltas, callerUsdcDeltaRaw: callerUsdc?.toString() || null,
    callerWsolResidualRaw: callerWsol?.toString() || null,
    lendersRestored, completeRepayment: response.value.err == null && lendersRestored,
    logs: response.value.logs || [], broadcast: false};
}
async function main() {
  if (await rpc('getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('wrong genesis');
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
  const margin = Keypair.generate(), usdcAta = spl.getAssociatedTokenAddressSync(USDC, authority.publicKey),
    wsolAta = spl.getAssociatedTokenAddressSync(WSOL, authority.publicKey);
  const forward = await quote(USDC, WSOL, TOTAL, 'tessera');
  if (forward.status !== 200 || forward.body.routePlan?.length !== 1 ||
      forward.body.routePlan[0].swapInfo?.ammKey !== TESSERA_POOL.toBase58()) throw new Error('exact Tessera quote unavailable');
  const exitInput = BigInt(forward.body.outAmount) - EXIT_BUFFER;
  const exit = await quote(WSOL, USDC, exitInput, 'independent');
  if (exit.status !== 200 || !exit.body.outAmount || (exit.body.routePlan || []).some(row =>
    row.swapInfo?.label === 'TesseraV' || row.swapInfo?.ammKey === TESSERA_POOL.toBase58()))
    throw new Error('independent exit unavailable or aliases Tessera');
  const feeQuote = await quote(WSOL, USDC, 10_000n, 'independent');
  const [forwardBuild, exitBuild, saveSource, p0Source] = await Promise.all([build(forward.body, authority.publicKey),
    build(exit.body, authority.publicKey), rpc('getTransaction', [SAVE_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc('getTransaction', [P0_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}])]);
  if (!forwardBuild.body?.swapInstruction || !exitBuild.body?.swapInstruction || !saveSource || !p0Source)
    throw new Error('route/provider build unavailable');
  const saveTemplates = {borrow: historyIx(saveSource, 6), repay: historyIx(saveSource, 12)};
  const p0Templates = {start: historyIx(p0Source, 1), borrow: historyIx(p0Source, 2),
    repay: historyIx(p0Source, 5), end: historyIx(p0Source, 6)};
  const klendHistory = JSON.parse(fs.readFileSync(path.join(OCT15, 'kamino-flash-history.json')));
  const klendTemplates = {borrow: historyIx(klendHistory.hits[0].transaction, 3),
    repay: historyIx(klendHistory.hits[0].transaction, 13)};
  const p0Group = p0Templates.borrow.keys[0].pubkey, p0Vault = p0Templates.borrow.keys[6].pubkey;
  const watched = [authority.publicKey, usdcAta, wsolAta, TESSERA_USDC, TESSERA_WSOL,
    KLEND_USDC.supply, p0Vault, SAVE_USDC.supply, SAVE_USDC.fee];
  const roles = {callerSystem: 0, callerUsdc: 1, callerWsol: 2, tesseraUsdc: 3,
    tesseraWsol: 4, klendSupply: 5, project0Vault: 6, saveSupply: 7, saveFee: 8};
  const ctx = {authority, margin, usdcAta, wsolAta, forwardInstructions: routeSet(forwardBuild.body),
    exitInstructions: routeSet(exitBuild.body), saveTemplates, p0Templates, klendTemplates,
    p0Group, watched, roles};
  const cases = [await simulate('two_provider_10_usdc', ['klend', 'project0'], ctx),
    await simulate('three_provider_10_usdc', ['klend', 'project0', 'save'], ctx)];
  const baseFeeUsdcRaw = feeQuote.body?.outAmount || null;
  for (const row of cases) row.afterNetworkFeeUsdcRaw = row.callerUsdcDeltaRaw == null || baseFeeUsdcRaw == null
    ? null : (BigInt(row.callerUsdcDeltaRaw) - BigInt(baseFeeUsdcRaw)).toString();
  const output = {generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta',
    safety: {broadcast: false, sendTransactionPathPresent: false, sigVerify: true,
      syntheticTokenFunding: false, privateKeysPersisted: false, signedWirePersisted: false},
    route: {inputRaw: TOTAL.toString(), tesseraQuotedOutputRaw: forward.body.outAmount,
      exitBufferRaw: EXIT_BUFFER.toString(), independentExitInputRaw: exitInput.toString(),
      independentExitOutputRaw: exit.body.outAmount,
      quotedGrossDeltaUsdcRaw: (BigInt(exit.body.outAmount) - TOTAL).toString(),
      tesseraContextSlot: forward.body.contextSlot, exitContextSlot: exit.body.contextSlot,
      exitRoute: (exit.body.routePlan || []).map(row => ({label: row.swapInfo?.label,
        ammKey: row.swapInfo?.ammKey})), baseFeeUsdcEquivalentRaw: baseFeeUsdcRaw},
    providerSources: {save: saveSource.slot, project0: p0Source.slot, klend: klendHistory.hits[0].slot},
    cases};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, route: output.route, cases: cases.map(row => ({label: row.label,
    err: row.err, envelope: row.envelope, deltas: row.deltas, completeRepayment: row.completeRepayment,
    afterNetworkFeeUsdcRaw: row.afterNetworkFeeUsdcRaw}))}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
