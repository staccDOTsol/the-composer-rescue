#!/usr/bin/env node
'use strict';

// Read-only current-mainnet-backed fork harness. It constructs and signs the
// exact custom Solana transaction-v1 wire format, then only calls
// simulateTransaction(sigVerify:true). It never submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Keypair, PublicKey, SystemProgram, TransactionInstruction} =
  require(MODULES + '@solana/web3.js');
const spl = require(MODULES + '@solana/spl-token');
const bs58Module = require(MODULES + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1, signV1} = require('./hylo-exchange-v1-wire.js');

const ROOT = __dirname;
const CURRENT_OUT = path.join(ROOT, '..', '2026-10-19');
fs.mkdirSync(CURRENT_OUT, {recursive: true});
const OUTPUT = path.join(CURRENT_OUT, 'byreal-signed-cross-pool-v1.json');
const FORK = process.env.BYREAL_FORK_RPC || 'http://127.0.0.1:19097';
const P = value => new PublicKey(value);
const BYREAL = P('REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2');
const RAYDIUM = P('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const TOKEN_2022 = spl.TOKEN_2022_PROGRAM_ID;
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const CRCL = P('XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1');
const POOL_A = P('Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa');
const POOL_A_USDC = P('5JcntpKHEy2vyjCiiLY5e4Te1ZVG1zU6pp6ZU667d6tw');
const POOL_A_CRCL = P('8feVD1rbhaE17kZiWhTssFrC75DUoJUCX9SLZ6C9oxhd');
const POOL_B = P('GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV');
const POOL_B_CRCL = P('DMQver7kdMua1ANBY1rJPEFCX594zWn81ihv2yMVFEsF');
const POOL_B_USDC = P('8awg4iLSUmmmrkUGgj3T8VuWyvHRPudsLz8skyb3xV92');
const BYREAL_SIGNATURE = '3Pd2Li7YKLJfQC3HDqi48TBu1P5zg52V8UNczoL2u5tha2ErcCMXceHvVtDmM7hTroZEgEt9j6n96DmRRj9Sdvq3';
const RAYDIUM_SIGNATURE = '3mnyio88VKfNYtPcymMvPtB7AQzFvta7MF7Z8UWwzFUpbndHrM32MT9KH1GydBn2W28RckadpKXtBLEonNW2GhEt';
const REBALANCE_SIGNATURE = '5DnzTGPMdakorV388SHPtSw4Yx7pvzYgVnajnAfUGTUVW5idbK9EfKZcqeLeaaFD5zqZF3Yet827ZJfUvFJdfpML';
const PROJECT0_SIGNATURE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const REBALANCER = P('BYrEa363GeActic949HkNmw7VGBf9k7awKEqCTZvPuT4');
const PROJECT0_GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const PROJECT0_BANK = P('2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB');
const PROJECT0_VAULT = P('7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat');

const USDC_RESERVE = {
  reserve: 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z',
  market: '47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8',
  supplyVault: '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB',
  feeVault: '5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj',
  censusAvailableRaw: '7868315584088',
};

function readEnv() {
  const file = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env'].find(fs.existsSync);
  if (!file) return {RPC_URL: 'https://api.mainnet-beta.solana.com'};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const ENV = readEnv();
const UPSTREAMS = [...new Set([FORK, ENV.RPC_URL, ENV.HEAVY_RPC_URL].filter(Boolean))];
let rpcId = 0;
async function rpc(url, method, params) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (String(error.message).startsWith(`${method}:`)) throw error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw last;
}
async function upstream(method, params) {
  const errors = [];
  for (const endpoint of UPSTREAMS) {
    try { return await rpc(endpoint, method, params); }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`${method}: all upstreams failed: ${errors.join('; ')}`);
}
const fork = (method, params) => rpc(FORK, method, params);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function fixedKeypair(label) {
  return Keypair.fromSeed(crypto.createHash('sha256').update(`byreal-audit:${label}`).digest());
}
function cloneIx(ix) {
  return new TransactionInstruction({programId: ix.programId,
    keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
}
function rawHistoricalIx(tx, instructionIndex) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const keys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = message.header;
  const writable = index => index < staticKeys.length
    ? (index < h.numRequiredSignatures
      ? index < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : index < staticKeys.length - h.numReadonlyUnsignedAccounts)
    : index < staticKeys.length + loaded.writable.length;
  const source = message.instructions[instructionIndex];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map(index => ({pubkey: P(keys[index]),
      isSigner: index < h.numRequiredSignatures, isWritable: writable(index)})),
    data: Buffer.from(bs58.decode(source.data))});
}
function parsedIx(tx, source) {
  const meta = new Map(tx.transaction.message.accountKeys.map(key => [key.pubkey,
    {isSigner: Boolean(key.signer), isWritable: Boolean(key.writable)}]));
  return new TransactionInstruction({programId: P(source.programId),
    keys: source.accounts.map(address => ({pubkey: P(address), ...(meta.get(address) ||
      {isSigner: false, isWritable: true})})), data: Buffer.from(bs58.decode(source.data))});
}
function replaceKeys(ix, replacements) {
  return new TransactionInstruction({programId: ix.programId,
    keys: ix.keys.map(key => ({...key, pubkey: replacements.get(key.pubkey.toBase58()) || key.pubkey})),
    data: Buffer.from(ix.data)});
}
function swapExactIn(ix, amount) {
  const out = cloneIx(ix);
  if (out.data.length !== 41) throw new Error(`unexpected SwapV2 length ${out.data.length}`);
  out.data.writeBigUInt64LE(BigInt(amount), 8);
  out.data.writeBigUInt64LE(0n, 16);
  out.data[40] = 1;
  return out;
}

function klendTemplate(instructionIndex) {
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'kamino-flash-history.json'), 'utf8'))
    .hits[0].transaction;
  return rawHistoricalIx(source, instructionIndex);
}
function klendFlashIx(template, authority, userUsdc, amount, repayIndex) {
  const market = P(USDC_RESERVE.market);
  const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const out = cloneIx(template);
  const replacements = {0: authority, 1: lma, 2: market, 3: P(USDC_RESERVE.reserve),
    4: USDC, 5: P(USDC_RESERVE.supplyVault), 6: userUsdc,
    7: P(USDC_RESERVE.feeVault), 8: KLEND, 9: KLEND, 11: TOKEN};
  for (const [index, pubkey] of Object.entries(replacements)) out.keys[Number(index)].pubkey = pubkey;
  out.data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) out.data[16] = repayIndex;
  return out;
}

async function tokenTemplate(address, authority, amount) {
  const row = await upstream('getAccountInfo', [address, {encoding: 'base64', commitment: 'confirmed'}]);
  const data = Buffer.from(row.value.data[0], 'base64');
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  return {data: data.toString('hex'), executable: false, lamports: row.value.lamports,
    owner: row.value.owner, rentEpoch: 0};
}
async function createActor(label, initialUsdc, initialCrcl = 0n) {
  const signer = label === 'zero-capital-flash'
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(
      `${process.env.HOME}/hooked.json`, 'utf8'))))
    : fixedKeypair(label);
  const usdc = spl.getAssociatedTokenAddressSync(USDC, signer.publicKey, false, TOKEN);
  const crcl = spl.getAssociatedTokenAddressSync(CRCL, signer.publicKey, false, TOKEN_2022);
  await fork('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await fork('surfnet_setAccount', [usdc.toBase58(),
    await tokenTemplate('ArwpdfBciGYoxVFbJKKqEmhLbtCjZk9sy9Be3VLvrUtL', signer.publicKey, initialUsdc)]);
  await fork('surfnet_setAccount', [crcl.toBase58(),
    await tokenTemplate('5AK1cujgbvgfSxpQ2HphKKfGhdPnQLTKHBRgtktDiPLt', signer.publicKey, initialCrcl)]);
  return {signer, usdc, crcl, initialUsdc: BigInt(initialUsdc), initialCrcl: BigInt(initialCrcl),
    marginAccount: fixedKeypair(`${label}:marginfi`)};
}

function project0Initialize(actor) {
  return new TransactionInstruction({programId: PROJECT0, keys: [
    {pubkey: PROJECT0_GROUP, isSigner: false, isWritable: false},
    {pubkey: actor.marginAccount.publicKey, isSigner: true, isWritable: true},
    {pubkey: actor.signer.publicKey, isSigner: true, isWritable: false},
    {pubkey: actor.signer.publicKey, isSigner: true, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});
}
function project0Parts(templates, actor, amount) {
  const start = cloneIx(templates.start), borrow = cloneIx(templates.borrow),
    repay = cloneIx(templates.repay), end = cloneIx(templates.end);
  start.keys[0].pubkey = actor.marginAccount.publicKey;
  start.keys[1].pubkey = actor.signer.publicKey;
  borrow.keys[1].pubkey = actor.marginAccount.publicKey;
  borrow.keys[2].pubkey = actor.signer.publicKey;
  borrow.keys[4].pubkey = actor.usdc;
  repay.keys[1].pubkey = actor.marginAccount.publicKey;
  repay.keys[2].pubkey = actor.signer.publicKey;
  repay.keys[4].pubkey = actor.usdc;
  end.keys[0].pubkey = actor.marginAccount.publicKey;
  end.keys[2].pubkey = actor.signer.publicKey;
  borrow.data.writeBigUInt64LE(BigInt(amount), 8);
  repay.data.writeBigUInt64LE(BigInt(amount), 8);
  return {start, borrow, repay, end};
}
function tokenAmount(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64) : null;
}
function image(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {owner: account.owner, lamports: String(account.lamports), dataLength: data.length,
    dataSha256: sha256(data), tokenAmountRaw: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null};
}
async function preload(instructions, extra = []) {
  const unique = [...new Set([...instructions.flatMap(ix => [ix.programId, ...ix.keys.map(k => k.pubkey)]),
    ...extra].map(String))];
  for (let offset = 0; offset < unique.length; offset += 12) {
    await Promise.all(unique.slice(offset, offset + 12).map(address =>
      fork('getAccountInfo', [address, {encoding: 'base64', commitment: 'processed'}])));
  }
}
async function simulate(label, actor, instructions, watched, metadata = {}) {
  await preload(instructions, watched.map(row => row.pubkey));
  const beforePage = await fork('getMultipleAccounts', [watched.map(row => String(row.pubkey)),
    {encoding: 'base64', commitment: 'processed'}]);
  const blockhash = (await fork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  let encoded;
  try { encoded = encodeV1(instructions, actor.signer.publicKey, blockhash); }
  catch (error) { return {label, localCompositionError: error.message, ...metadata}; }
  const signed = signV1(encoded, instructions, actor.signer.publicKey, blockhash,
    [actor.signer, actor.marginAccount].filter(Boolean));
  const response = await fork('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(row => String(row.pubkey))},
  }]);
  const before = Object.fromEntries(watched.map((row, index) => [row.label, image(beforePage.value[index])]));
  const after = Object.fromEntries(watched.map((row, index) => [row.label, image(response.value.accounts?.[index])]));
  const deltas = {};
  for (const row of watched) {
    const a = before[row.label]?.tokenAmountRaw;
    const b = after[row.label]?.tokenAmountRaw;
    deltas[row.label] = a !== null && a !== undefined && b !== null && b !== undefined
      ? (BigInt(b) - BigInt(a)).toString()
      : before[row.label]?.dataSha256 === after[row.label]?.dataSha256 ? 'unchanged' : 'changed';
  }
  const result = {label, forkBaselineSlot: beforePage.context.slot, simulationSlot: response.context.slot,
    err: response.value.err, sigVerify: true, signerOrder: signed.signerOrder,
    wire: {version: 1, sizeBytes: encoded.sizeBytes, maximumBytes: 4096,
      addressCount: encoded.addressCount, maximumAddresses: 64,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      sha256: sha256(signed.wire)}, unitsConsumed: response.value.unitsConsumed,
    loadedAccountsDataSize: response.value.loadedAccountsDataSize, before, after, deltas,
    logs: response.value.logs, ...metadata};
  process.stdout.write(JSON.stringify({label, err: result.err, wire: result.wire,
    units: result.unitsConsumed, deltas: {attackerUsdc: deltas.attackerUsdc,
      attackerCrcl: deltas.attackerCrcl, poolAUsdc: deltas.poolAUsdc,
      poolACrcl: deltas.poolACrcl, poolBCrcl: deltas.poolBCrcl,
      poolBUsdc: deltas.poolBUsdc, lenderSupply: deltas.lenderSupply},
    tail: result.logs?.slice(-5)}) + '\n');
  return result;
}

async function currentTemplates() {
  const [byreal, raydium, rebalance, project0] = await Promise.all([
    upstream('getTransaction', [BYREAL_SIGNATURE, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [RAYDIUM_SIGNATURE, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [REBALANCE_SIGNATURE, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [PROJECT0_SIGNATURE, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  const byrealSource = byreal.transaction.message.instructions.find(ix => ix.programId === BYREAL.toBase58());
  const raydiumSource = raydium.meta.innerInstructions.flatMap(row => row.instructions)
    .find(ix => ix.programId === RAYDIUM.toBase58());
  const rebalanceIndex = rebalance.transaction.message.instructions.findIndex(ix =>
    P([...rebalance.transaction.message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey),
      ...(rebalance.meta.loadedAddresses?.writable || []), ...(rebalance.meta.loadedAddresses?.readonly || [])][ix.programIdIndex]).equals(REBALANCER));
  if (!byrealSource || !raydiumSource || rebalanceIndex < 0) throw new Error('live instruction template unavailable');
  const p0 = {start: rawHistoricalIx(project0, 1), borrow: rawHistoricalIx(project0, 2),
    repay: rawHistoricalIx(project0, 5), end: rawHistoricalIx(project0, 6)};
  if (Object.values(p0).some(ix => !ix.programId.equals(PROJECT0)))
    throw new Error('Project0 template quartet changed');
  return {byreal: parsedIx(byreal, byrealSource), raydium: parsedIx(raydium, raydiumSource), p0,
    rebalance: rawHistoricalIx(rebalance, rebalanceIndex),
    slots: {byreal: byreal.slot, raydium: raydium.slot, rebalance: rebalance.slot,
      project0: project0.slot}};
}
function actorSwaps(templates, actor) {
  const a = replaceKeys(templates.byreal, new Map([
    ['Hasda78TSaT9bjiPxDBvP4GpohFpP3TDTaJEcCYK5kyN', actor.signer.publicKey],
    ['ArwpdfBciGYoxVFbJKKqEmhLbtCjZk9sy9Be3VLvrUtL', actor.usdc],
    ['5AK1cujgbvgfSxpQ2HphKKfGhdPnQLTKHBRgtktDiPLt', actor.crcl],
  ]));
  const sourcePayer = templates.raydium.keys.find(key => key.isSigner)?.pubkey.toBase58();
  const b = replaceKeys(templates.raydium, new Map([
    [sourcePayer, actor.signer.publicKey],
    ['J44wFy7zLQ8yqfe5aMoPFuZJ5G7QWJt3Q7pHQPwT6Hs2', actor.crcl],
    ['9GL8qX8tppzG9BLVM87Va1BetoBMjCzbmqjXAHAG1HE', actor.usdc],
  ]));
  return {a, b};
}
function dualProviderRoute(templates, actor, total, klendAmount, crclOut,
  borrowTemplate, repayTemplate) {
  const p0Amount = BigInt(total) - BigInt(klendAmount);
  const p0 = project0Parts(templates.p0, actor, p0Amount);
  const klendBorrow = klendFlashIx(borrowTemplate, actor.signer.publicKey, actor.usdc,
    klendAmount);
  const swaps = actorSwaps(templates, actor);
  const instructions = [project0Initialize(actor), p0.start, klendBorrow, p0.borrow,
    swapExactIn(swaps.a, total), swapExactIn(swaps.b, crclOut), p0.repay,
    klendFlashIx(repayTemplate, actor.signer.publicKey, actor.usdc, klendAmount, 2), p0.end];
  p0.start.data.writeBigUInt64LE(BigInt(instructions.indexOf(p0.end)), 8);
  return {instructions, p0Amount};
}
function watched(actor) {
  return [
    {label: 'attackerUsdc', pubkey: actor.usdc}, {label: 'attackerCrcl', pubkey: actor.crcl},
    {label: 'poolAUsdc', pubkey: POOL_A_USDC}, {label: 'poolACrcl', pubkey: POOL_A_CRCL},
    {label: 'poolBCrcl', pubkey: POOL_B_CRCL}, {label: 'poolBUsdc', pubkey: POOL_B_USDC},
    {label: 'lenderSupply', pubkey: P(USDC_RESERVE.supplyVault)},
    {label: 'lenderFee', pubkey: P(USDC_RESERVE.feeVault)},
    {label: 'lenderReserve', pubkey: P(USDC_RESERVE.reserve)},
    {label: 'project0Vault', pubkey: PROJECT0_VAULT},
    {label: 'project0Bank', pubkey: PROJECT0_BANK},
    {label: 'project0MarginAccount', pubkey: actor.marginAccount.publicKey},
    {label: 'poolAState', pubkey: POOL_A}, {label: 'poolBState', pubkey: POOL_B},
  ];
}
function logAnchorError(result) {
  return result.logs?.find(line => /Error Code:|Error Message:|custom program error/.test(line)) || null;
}

async function main() {
  const templates = await currentTemplates();
  if (!templates.byreal.programId.equals(BYREAL) || !templates.raydium.programId.equals(RAYDIUM))
    throw new Error('wrong swap program fixture');
  if (!templates.p0.borrow.keys[3].pubkey.equals(PROJECT0_BANK) ||
    !templates.p0.borrow.keys[6].pubkey.equals(PROJECT0_VAULT))
    throw new Error('Project0 current USDC bank/vault fixture changed');
  const control = await createActor('funded-control', 2_000_000n * 1_000_000n);
  const flash = await createActor('zero-capital-flash', 0n);
  const buffered = await createActor('buffered-flash-control', 2_000_000n * 1_000_000n);
  const donation = await createActor('donation-control', 2_000_000n * 1_000_000n,
    10_000n * 100_000_000n);
  await preload([], [POOL_A_USDC, POOL_A_CRCL]);
  const poolVaultPage = await fork('getMultipleAccounts', [[POOL_A_USDC.toBase58(), POOL_A_CRCL.toBase58()],
    {encoding: 'base64', commitment: 'processed'}]);
  const poolAUsdcRaw = tokenAmount(poolVaultPage.value[0]);
  const poolACrclRaw = tokenAmount(poolVaultPage.value[1]);
  const controls = [];
  const controlSwaps = actorSwaps(templates, control);
  const probeAmounts = [1n, 200n * 1_000_000n, 10_000n * 1_000_000n,
    100_000n * 1_000_000n, 200_000n * 1_000_000n, 210_000n * 1_000_000n,
    220_000n * 1_000_000n, 225_000n * 1_000_000n, 230_000n * 1_000_000n,
    226_000n * 1_000_000n, 227_000n * 1_000_000n, 228_000n * 1_000_000n,
    229_000n * 1_000_000n, 240_000n * 1_000_000n, poolAUsdcRaw - 1n,
    poolAUsdcRaw, poolAUsdcRaw + 1n];
  for (const amount of probeAmounts) {
    controls.push(await simulate(`byreal_outsider_exact_in_${amount}`, control,
      [swapExactIn(controlSwaps.a, amount)], watched(control), {inputUsdcRaw: amount.toString()}));
  }

  const flashSwaps = actorSwaps(templates, flash);
  const bufferedSwaps = actorSwaps(templates, buffered);
  const borrowTemplate = klendTemplate(3);
  const repayTemplate = klendTemplate(13);
  if (process.env.BYREAL_DONATION_ONLY === '1') {
    const amount = 200n * 1_000_000n;
    const preview = controls.find(row => row.inputUsdcRaw === amount.toString());
    if (preview?.err) throw new Error('donation baseline preview failed');
    const crclOut = BigInt(preview.deltas.attackerCrcl);
    const swaps = actorSwaps(templates, donation);
    const donationUsdc = 100_000n * 1_000_000n;
    const donationCrcl = 1_000n * 100_000_000n;
    const cases = [];
    cases.push(await simulate('donation_baseline_cross_pool', donation,
      [swapExactIn(swaps.a, amount), swapExactIn(swaps.b, crclOut)], watched(donation),
      {swapUsdcRaw: amount.toString(), expectedCrclOutRaw: crclOut.toString()}));
    cases.push(await simulate('donate_usdc_vault_then_cross_pool', donation,
      [spl.createTransferInstruction(donation.usdc, POOL_A_USDC, donation.signer.publicKey,
        donationUsdc, [], TOKEN), swapExactIn(swaps.a, amount), swapExactIn(swaps.b, crclOut)],
      watched(donation), {swapUsdcRaw: amount.toString(), donationUsdcRaw: donationUsdc.toString(),
        expectedCrclOutRaw: crclOut.toString()}));
    cases.push(await simulate('donate_crcl_vault_then_cross_pool', donation,
      [spl.createTransferCheckedInstruction(donation.crcl, CRCL, POOL_A_CRCL,
        donation.signer.publicKey, donationCrcl, 8, [], TOKEN_2022),
      swapExactIn(swaps.a, amount), swapExactIn(swaps.b, crclOut)],
      watched(donation), {swapUsdcRaw: amount.toString(), donationCrclRaw: donationCrcl.toString(),
        expectedCrclOutRaw: crclOut.toString()}));
    const flashBorrow = klendFlashIx(borrowTemplate, donation.signer.publicKey, donation.usdc, amount);
    const flashRepay = klendFlashIx(repayTemplate, donation.signer.publicKey, donation.usdc, amount, 0);
    cases.push(await simulate('donate_crcl_flash_cross_pool_full_repayment', donation,
      [flashBorrow, spl.createTransferCheckedInstruction(donation.crcl, CRCL, POOL_A_CRCL,
        donation.signer.publicKey, donationCrcl, 8, [], TOKEN_2022), swapExactIn(swaps.a, amount),
        swapExactIn(swaps.b, crclOut), flashRepay], watched(donation),
      {borrowUsdcRaw: amount.toString(), donationCrclRaw: donationCrcl.toString(),
        initialBufferUsdcRaw: donation.initialUsdc.toString(),
        initialBufferCrclRaw: donation.initialCrcl.toString()}));
    const donationPath = path.join(CURRENT_OUT, 'byreal-vault-donation-v1.json');
    fs.writeFileSync(donationPath, JSON.stringify({generatedAt: new Date().toISOString(),
      noTransactionsSubmitted: true, sigVerify: true,
      sourceAccounting: {priceState: 'PoolState.sqrt_price_x64 plus tick liquidity',
        rawVaultUse: 'post-quote transfer solvency/freeze check only'}, cases}, null, 2) + '\n');
    process.stdout.write(JSON.stringify({output: donationPath, cases: cases.map(row => ({
      label: row.label, err: row.err, units: row.unitsConsumed, wire: row.wire,
      deltas: row.deltas}))}) + '\n');
    return;
  }
  if (process.env.BYREAL_DUAL_BOUNDARY_ONLY === '1') {
    const dualProviderCases = [];
    for (const amount of [poolAUsdcRaw - 1n, poolAUsdcRaw, poolAUsdcRaw + 1n,
      225_000n * 1_000_000n, 226_000n * 1_000_000n, 227_000n * 1_000_000n,
      228_000n * 1_000_000n, 229_000n * 1_000_000n, 230_000n * 1_000_000n,
      240_000n * 1_000_000n]) {
      const preview = controls.find(row => row.inputUsdcRaw === amount.toString());
      if (preview?.err || !preview?.deltas?.attackerCrcl) {
        dualProviderCases.push({label: `dual_boundary_${amount}`, skipped: 'Byreal preview failed',
          previewErr: preview?.err || null});
        continue;
      }
      const crclOut = BigInt(preview.deltas.attackerCrcl);
      const split = amount / 2n;
      const built = dualProviderRoute(templates, buffered, amount, split, crclOut,
        borrowTemplate, repayTemplate);
      dualProviderCases.push(await simulate(`dual_boundary_${amount}`, buffered,
        built.instructions, watched(buffered), {totalUsdcRaw: amount.toString(),
          klendUsdcRaw: split.toString(), project0UsdcRaw: built.p0Amount.toString(),
          initialBufferUsdcRaw: buffered.initialUsdc.toString()}));
    }
    const boundaryOutput = {generatedAt: new Date().toISOString(), noTransactionsSubmitted: true,
      sigVerify: true, customTransactionVersion: 1,
      poolVaultBaseline: {slot: poolVaultPage.context.slot, usdcRaw: poolAUsdcRaw.toString(),
        crclRaw: poolACrclRaw.toString()}, controls, dualProviderCases};
    const boundaryPath = path.join(CURRENT_OUT, 'byreal-dual-provider-boundary-v1.json');
    fs.writeFileSync(boundaryPath, JSON.stringify(boundaryOutput, null, 2) + '\n');
    process.stdout.write(JSON.stringify({output: boundaryPath,
      cases: dualProviderCases.map(row => ({label: row.label, err: row.err,
        wire: row.wire, units: row.unitsConsumed, attackerUsdcDelta: row.deltas?.attackerUsdc}))}) + '\n');
    return;
  }
  const roundTrips = [];
  const economicControls = [];
  const repaidControls = [];
  for (const amount of [200n * 1_000_000n, 10_000n * 1_000_000n,
    100_000n * 1_000_000n, 200_000n * 1_000_000n, poolAUsdcRaw - 1n,
    poolAUsdcRaw, poolAUsdcRaw + 1n]) {
    const preview = controls.find(row => row.inputUsdcRaw === amount.toString());
    const crclOut = BigInt(preview.deltas?.attackerCrcl || '0');
    if (preview.err || crclOut <= 0n) {
      roundTrips.push({label: `cross_pool_${amount}`, skipped: 'Byreal preview failed', previewErr: preview.err});
      continue;
    }
    const borrow = klendFlashIx(borrowTemplate, flash.signer.publicKey, flash.usdc, amount);
    const a = swapExactIn(flashSwaps.a, amount);
    const b = swapExactIn(flashSwaps.b, crclOut);
    const repay = klendFlashIx(repayTemplate, flash.signer.publicKey, flash.usdc, amount, 0);
    roundTrips.push(await simulate(`klend_byreal_raydium_repay_${amount}`, flash,
      [borrow, a, b, repay], watched(flash), {borrowUsdcRaw: amount.toString(),
        byrealPreviewCrclOutRaw: crclOut.toString(), independentExitPool: POOL_B.toBase58()}));
    economicControls.push(await simulate(`funded_byreal_raydium_${amount}`, control,
      [swapExactIn(controlSwaps.a, amount), swapExactIn(controlSwaps.b, crclOut)], watched(control),
      {inputUsdcRaw: amount.toString(), byrealPreviewCrclOutRaw: crclOut.toString()}));
    const bufferedBorrow = klendFlashIx(borrowTemplate, buffered.signer.publicKey, buffered.usdc, amount);
    const bufferedRepay = klendFlashIx(repayTemplate, buffered.signer.publicKey, buffered.usdc, amount, 0);
    repaidControls.push(await simulate(`buffered_klend_byreal_raydium_repay_${amount}`, buffered,
      [bufferedBorrow, swapExactIn(bufferedSwaps.a, amount), swapExactIn(bufferedSwaps.b, crclOut),
        bufferedRepay], watched(buffered), {borrowUsdcRaw: amount.toString(),
        initialBufferUsdcRaw: buffered.initialUsdc.toString(), byrealPreviewCrclOutRaw: crclOut.toString()}));
  }

  const lenderBoundaries = [];
  const currentReservePage = await fork('getMultipleAccounts', [[USDC_RESERVE.reserve, USDC_RESERVE.supplyVault],
    {encoding: 'base64', commitment: 'processed'}]);
  const reserveData = Buffer.from(currentReservePage.value[0].data[0], 'base64');
  const currentAvailable = reserveData.readBigUInt64LE(224);
  for (const amount of [currentAvailable - 1n, currentAvailable, currentAvailable + 1n]) {
    const borrow = klendFlashIx(borrowTemplate, flash.signer.publicKey, flash.usdc, amount);
    const repay = klendFlashIx(repayTemplate, flash.signer.publicKey, flash.usdc, amount, 0);
    lenderBoundaries.push(await simulate(`klend_capacity_${amount}`, flash,
      [borrow, repay], watched(flash), {borrowUsdcRaw: amount.toString()}));
  }

  const dualProviderCases = [];
  const previewByAmount = new Map(controls.filter(row => !row.err)
    .map(row => [row.inputUsdcRaw, BigInt(row.deltas.attackerCrcl)]));
  const dualTotals = [200_000n * 1_000_000n, 210_000n * 1_000_000n,
    220_000n * 1_000_000n, poolAUsdcRaw];
  for (const total of dualTotals) {
    const crclOut = previewByAmount.get(total.toString());
    if (!crclOut) continue;
    const split = total / 2n;
    const built = dualProviderRoute(templates, buffered, total, split, crclOut,
      borrowTemplate, repayTemplate);
    dualProviderCases.push(await simulate(`dual_klend_project0_buffered_${total}`, buffered,
      built.instructions, watched(buffered), {totalUsdcRaw: total.toString(),
        klendUsdcRaw: split.toString(), project0UsdcRaw: built.p0Amount.toString(),
        initialBufferUsdcRaw: buffered.initialUsdc.toString()}));
  }
  const asymTotal = 200_000n * 1_000_000n;
  const asymCrclOut = previewByAmount.get(asymTotal.toString());
  for (const klendAmount of [1n, asymTotal - 1n]) {
    const built = dualProviderRoute(templates, buffered, asymTotal, klendAmount, asymCrclOut,
      borrowTemplate, repayTemplate);
    dualProviderCases.push(await simulate(`dual_asymmetric_klend_${klendAmount}`, buffered,
      built.instructions, watched(buffered), {totalUsdcRaw: asymTotal.toString(),
        klendUsdcRaw: klendAmount.toString(), project0UsdcRaw: built.p0Amount.toString(),
        initialBufferUsdcRaw: buffered.initialUsdc.toString()}));
  }
  const zeroBuilt = dualProviderRoute(templates, flash, asymTotal, asymTotal / 2n,
    asymCrclOut, borrowTemplate, repayTemplate);
  dualProviderCases.push(await simulate('dual_klend_project0_zero_capital_200000000000', flash,
    zeroBuilt.instructions, watched(flash), {totalUsdcRaw: asymTotal.toString(),
      klendUsdcRaw: (asymTotal / 2n).toString(), project0UsdcRaw: zeroBuilt.p0Amount.toString(),
      initialBufferUsdcRaw: '0'}));

  const signerReplacements = new Map();
  for (const key of templates.rebalance.keys) if (key.isSigner)
    signerReplacements.set(key.pubkey.toBase58(), flash.signer.publicKey);
  const outsiderRebalance = replaceKeys(templates.rebalance, signerReplacements);
  const rebalanceReplay = await simulate('outsider_rebalance_current_accounts', flash,
    [outsiderRebalance], watched(flash), {historicalSignature: REBALANCE_SIGNATURE});

  const output = {
    generatedAt: new Date().toISOString(), scope: 'current-mainnet-backed Surfpool fork; no sendTransaction',
    forkRpc: FORK, sigVerify: true, customTransactionVersion: 1,
    source: {program: BYREAL.toBase58(), programPool: POOL_A.toBase58(),
      independentExitProgram: RAYDIUM.toBase58(), independentExitPool: POOL_B.toBase58(),
      signatures: {byreal: BYREAL_SIGNATURE, raydium: RAYDIUM_SIGNATURE,
        rebalance: REBALANCE_SIGNATURE}, slots: templates.slots},
    actors: {control: control.signer.publicKey.toBase58(), flash: flash.signer.publicKey.toBase58(),
      flashInitialUsdcRaw: '0', flashInitialCrclRaw: '0'},
    poolVaultBaseline: {slot: poolVaultPage.context.slot, usdcRaw: poolAUsdcRaw.toString(),
      crclRaw: poolACrclRaw.toString()},
    flashSource: {...USDC_RESERVE, currentSlot: currentReservePage.context.slot,
      currentAvailableRaw: currentAvailable.toString(), reserveAccountDataLength: reserveData.length},
    controls, economicControls, roundTrips, repaidControls, lenderBoundaries, dualProviderCases,
    rebalanceReplay: {...rebalanceReplay, extractedError: logAnchorError(rebalanceReplay)},
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({output: OUTPUT, controls: controls.length,
    roundTrips: roundTrips.map(row => ({label: row.label, err: row.err || row.previewErr || null,
      wire: row.wire, extractedError: logAnchorError(row)})),
    repaidControls: repaidControls.map(row => ({label: row.label, err: row.err,
      wire: row.wire, attackerUsdcDelta: row.deltas?.attackerUsdc})),
    dualProviderCases: dualProviderCases.map(row => ({label: row.label, err: row.err,
      localCompositionError: row.localCompositionError, wire: row.wire,
      attackerUsdcDelta: row.deltas?.attackerUsdc})),
    lenderBoundaries: lenderBoundaries.map(row => ({label: row.label, err: row.err})),
    rebalance: {err: rebalanceReplay.err, extractedError: logAnchorError(rebalanceReplay)}}) + '\n');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
