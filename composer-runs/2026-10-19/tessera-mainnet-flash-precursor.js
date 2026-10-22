#!/usr/bin/env node
'use strict';

// Signed mainnet-beta simulateTransaction-only precursor:
// KLend borrow -> Tessera swap -> intentionally underfunded indexed repay.
// The repay failure rolls all state back; executed token CPIs are parsed to
// measure Tessera input/output without broadcasting or synthetic token funding.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const web3 = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const bsModule = require('../2026-10-15/onre-harness/node_modules/bs58');
const bs58 = bsModule.default || bsModule;
const {Keypair, PublicKey, TransactionInstruction, TransactionMessage} = web3;
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');
const DIR = __dirname;
const OUT = path.join(DIR, process.env.TESSERA_PRECURSOR_OUTPUT || 'tessera-mainnet-flash-precursor.json');
const P = value => new PublicKey(value);
const PROGRAM = P('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
const POOL = P('FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n');
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_VAULT = P('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const USDC_VAULT = P('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const OCT15 = path.join(DIR, '../2026-10-15');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let rpcId = 0;

function endpoint() {
  const row = fs.readFileSync('/Users/stacc/.config/stacc-ladder/rpc.env', 'utf8')
    .split(/\r?\n/).find(line => /^\s*(?:export\s+)?SOLANA_RPC=/.test(line));
  if (!row) throw new Error('SOLANA_RPC missing');
  return row.slice(row.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}
const RPC = endpoint();
async function rpc(method, params = []) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function requestJson(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(60_000)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {error: text.slice(0, 240)}; }
    last = {status: response.status, body};
    if (response.ok && !body.error) return last;
    if (response.status !== 429 && response.status < 500) return last;
    await sleep(1_500 * (attempt + 1));
  }
  return last;
}
function ix(row) {
  return new TransactionInstruction({programId: P(row.programId), data: Buffer.from(row.data, 'base64'),
    keys: row.accounts.map(key => ({pubkey: P(key.pubkey), isSigner: key.isSigner,
      isWritable: key.isWritable}))});
}
function routeSet(build) {
  if (build.tokenLedgerInstruction) throw new Error('unexpected token ledger');
  return [...(build.otherInstructions || []), ...(build.setupInstructions || []),
    build.swapInstruction, ...(build.cleanupInstruction ? [build.cleanupInstruction] : [])]
    .filter(Boolean).map(ix);
}
function historyIx(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const h = message.header, staticCount = message.accountKeys.length;
  const writable = keyIndex => keyIndex < staticCount
    ? (keyIndex < h.numRequiredSignatures
      ? keyIndex < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : keyIndex < staticCount - h.numReadonlyUnsignedAccounts)
    : keyIndex < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map(keyIndex => ({pubkey: P(keys[keyIndex]),
      isSigner: keyIndex < h.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}
function clone(instruction) {
  return new TransactionInstruction({programId: instruction.programId,
    keys: instruction.keys.map(key => ({...key})), data: Buffer.from(instruction.data)});
}
function flashPair(templates, reserve, authority, destination, amount) {
  const borrow = clone(templates.borrow), repay = clone(templates.repay);
  const market = P(reserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  for (const instruction of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: marketAuthority, 2: market,
      3: P(reserve.reserve), 4: P(reserve.mint), 5: P(reserve.supplyVault),
      6: destination, 7: P(reserve.feeVault), 11: TOKEN})) {
      instruction.keys[Number(index)].pubkey = pubkey;
    }
    instruction.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}
function signV1(encoded, instructions, payer, signer, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const order = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (order.length !== 1 || order[0] !== signer.publicKey.toBase58())
    throw new Error(`unexpected signer order ${order.join(',')}`);
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64 * encoded.requiredSignatures);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(signer.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return {wire, order, compiled};
}
function tokenTransfers(innerInstructions, keys) {
  const rows = [];
  for (const group of innerInstructions || []) for (const item of group.instructions || []) {
    if (item.programId === TOKEN.toBase58() && item.parsed?.info?.tokenAmount?.amount != null) {
      rows.push({outerInstructionIndex: group.index, opcode: item.parsed.type,
        source: item.parsed.info.source, destination: item.parsed.info.destination,
        authority: item.parsed.info.authority,
        amountRaw: String(item.parsed.info.tokenAmount.amount)});
      continue;
    }
    const program = keys[item.programIdIndex]?.toBase58();
    if (program !== TOKEN.toBase58()) continue;
    const data = Buffer.from(bs58.decode(item.data || ''));
    if (![3, 12].includes(data[0]) || data.length < 9) continue;
    rows.push({outerInstructionIndex: group.index, opcode: data[0],
      source: keys[item.accounts[0]]?.toBase58(), destination: keys[item.accounts[1]]?.toBase58(),
      authority: keys[item.accounts[data[0] === 12 ? 3 : 2]]?.toBase58(),
      amountRaw: data.readBigUInt64LE(1).toString()});
  }
  return rows;
}
async function quoteAndBuild(direction, amount, user) {
  const inputMint = direction === 'wsol_to_usdc' ? WSOL : USDC;
  const outputMint = direction === 'wsol_to_usdc' ? USDC : WSOL;
  const params = new URLSearchParams({inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(),
    amount: amount.toString(), slippageBps: '5000', onlyDirectRoutes: 'true',
    maxAccounts: '24', dexes: 'TesseraV'});
  const quote = await requestJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
  const route = quote.body?.routePlan || [];
  if (quote.status !== 200 || !quote.body?.outAmount || route.length !== 1 ||
      route[0].swapInfo?.label !== 'TesseraV' || route[0].swapInfo?.ammKey !== POOL.toBase58())
    return {quoteStatus: quote.status, quote: quote.body, build: null};
  const build = await requestJson('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
      quoteResponse: quote.body, userPublicKey: user.toBase58(), wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: false, prioritizationFeeLamports: 0,
    }),
  });
  return {quoteStatus: quote.status, quote: quote.body, buildStatus: build.status, build: build.body};
}
async function main() {
  if (await rpc('getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error('wrong genesis');
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
  const userWsol = spl.getAssociatedTokenAddressSync(WSOL, authority.publicKey);
  const userUsdc = spl.getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const klendHistory = JSON.parse(fs.readFileSync(path.join(OCT15, 'kamino-flash-history.json')));
  const templates = {borrow: historyIx(klendHistory.hits[0].transaction, 3),
    repay: historyIx(klendHistory.hits[0].transaction, 13)};
  const census = JSON.parse(fs.readFileSync(path.join(OCT15, 'klend-zero-fee-census.json')));
  const wsolReserve = census.activeZero.find(row => row.reserve === '4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
  if (!wsolReserve) throw new Error('WSOL reserve missing');
  wsolReserve.mint = WSOL.toBase58();
  const usdcReserve = {reserve: 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z',
    market: '47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8',
    supplyVault: '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB',
    feeVault: '5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj', mint: USDC.toBase58()};
  const definition = process.env.TESSERA_PRECURSOR_CASE || 'wsol_to_usdc:small_control:100000000';
  const [direction, label, amountText] = definition.split(':');
  const amount = BigInt(amountText);
  const sourceAta = direction === 'wsol_to_usdc' ? userWsol : userUsdc;
  const reserve = direction === 'wsol_to_usdc' ? wsolReserve : usdcReserve;
  const prepared = await quoteAndBuild(direction, amount, authority.publicKey);
  if (!prepared.build?.swapInstruction) throw new Error(`route build failed ${JSON.stringify(prepared)}`);
  const pair = flashPair(templates, reserve, authority.publicKey, sourceAta, amount);
  const instructions = [
    spl.createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, userWsol,
      authority.publicKey, WSOL),
    spl.createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, userUsdc,
      authority.publicKey, USDC),
    pair.borrow, ...routeSet(prepared.build), pair.repay,
  ];
  pair.repay.data[16] = instructions.indexOf(pair.borrow);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value;
  const encoded = encodeV1(instructions, authority.publicKey, blockhash.blockhash);
  const signed = signV1(encoded, instructions, authority.publicKey, authority, blockhash.blockhash);
  const simulation = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed',
    innerInstructions: true,
  }]);
  const transfers = tokenTransfers(simulation.value.innerInstructions,
    signed.compiled.staticAccountKeys);
  const relevantTransfers = transfers.filter(row => [userWsol, userUsdc, WSOL_VAULT, USDC_VAULT,
    P(reserve.supplyVault)].some(address => address.toBase58() === row.source ||
      address.toBase58() === row.destination));
  const tesseraInputVault = direction === 'wsol_to_usdc' ? WSOL_VAULT : USDC_VAULT;
  const tesseraOutputVault = direction === 'wsol_to_usdc' ? USDC_VAULT : WSOL_VAULT;
  const tesseraInput = relevantTransfers.find(row => row.destination === tesseraInputVault.toBase58());
  const tesseraOutput = relevantTransfers.find(row => row.source === tesseraOutputVault.toBase58());
  const row = {generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta', direction, label,
    amountRaw: amount.toString(), quote: {contextSlot: prepared.quote.contextSlot,
      outAmount: prepared.quote.outAmount, otherAmountThreshold: prepared.quote.otherAmountThreshold,
      priceImpactPct: prepared.quote.priceImpactPct,
      route: prepared.quote.routePlan.map(item => ({label: item.swapInfo?.label,
        ammKey: item.swapInfo?.ammKey}))},
    sourceTemplate: {signature: klendHistory.hits[0].signature, slot: klendHistory.hits[0].slot},
    envelope: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: signed.order, sigVerify: true, withinLimits: encoded.sizeBytes <= 4096 &&
        encoded.addressCount <= 64, signedWireSha256: sha256(signed.wire), signedWirePersisted: false},
    simulationSlot: simulation.context.slot, err: simulation.value.err || null,
    unitsConsumed: simulation.value.unitsConsumed,
    tesseraSucceededBeforeRollback: (simulation.value.logs || []).includes(`Program ${PROGRAM} success`),
    expectedRepayFailure: simulation.value.err != null,
    relevantTransfers, reconciliation: tesseraInput && tesseraOutput ? {
      tesseraInputRaw: tesseraInput.amountRaw, tesseraOutputRaw: tesseraOutput.amountRaw,
      inputMatchesRequested: tesseraInput.amountRaw === amount.toString(),
      outputMatchesQuote: tesseraOutput.amountRaw === prepared.quote.outAmount,
    } : null,
    logs: simulation.value.logs || [], innerInstructionsPresent: !!simulation.value.innerInstructions,
    rawInnerInstructions: simulation.value.innerInstructions || [],
    broadcast: false, privateKeyPersisted: false, signedWirePersisted: false};
  fs.writeFileSync(OUT, `${JSON.stringify(row, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, simulationSlot: row.simulationSlot, err: row.err,
    tesseraSucceededBeforeRollback: row.tesseraSucceededBeforeRollback,
    envelope: row.envelope, reconciliation: row.reconciliation,
    relevantTransfers: row.relevantTransfers}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
