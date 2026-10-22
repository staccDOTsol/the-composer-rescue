#!/usr/bin/env node
'use strict';

// Signed, no-broadcast current-mainnet-fork compositions for the deployed
// AlphaQ CASH/USDC route. The transaction contains real provider borrows,
// AlphaQ USDC->CASH, an independent CASH->USDC exit, and all repayments.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {pathToFileURL} = require('url');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction, SystemProgram,
} = require(`${MOD}/@solana/web3.js`);
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require(`${MOD}/@solana/spl-token`);
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;

const DIR = __dirname;
const OCT15 = path.join(DIR, '../2026-10-15');
const OUT = path.join(DIR, 'alphaq-multiflash-extremes.json');
const FORK = process.env.ALPHAQ_FORK_RPC || 'http://127.0.0.1:9397';
const V1_MAINNET = process.env.ALPHAQ_V1_MAINNET === '1';
const envPath = '/tmp/composer-helius-only.env';
const env = fs.existsSync(envPath) ? Object.fromEntries(fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const UPSTREAM = process.env.SOLANA_RPC_URL || env.HEAVY_RPC_URL || env.RPC_URL ||
  'https://api.mainnet-beta.solana.com';
const SIM_RPC = V1_MAINNET ? UPSTREAM : FORK;
const SLIPPAGE_BPS = process.env.ALPHAQ_SLIPPAGE_BPS || '100';
const EXIT_BUFFER_RAW = BigInt(process.env.ALPHAQ_EXIT_BUFFER_RAW || '0');

const P = (value) => new PublicKey(value);
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const CASH = P('CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH');
const WSOL = P('So11111111111111111111111111111111111111112');
const ALPHAQ = P('ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA');
const COMPUTE_BUDGET = P('ComputeBudget111111111111111111111111111111');
const ALPHAQ_POOL = '2YR8bXXn4tTnq8nVjvpYnBiQ7ZKjN3G16wxE8ShL3KaB';
const POOL_CASH = P('2A5Cmp2mYwPzdxsQ5w6YTukYR2dNjCWVhnDTWUrifRxd');
const POOL_USDC = P('F2KCaXcp7AoQtxTDvNEDCyMyWjSCAMWNzcyN9dsPfPs5');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const P0_SOURCE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SAVE_SOURCE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const SAVE_USDC = {
  reserve: P('BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw'),
  market: P('4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY'),
  marketAuthority: P('DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby'),
  supply: P('8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf'),
  fee: P('5Gdxn4yquneifE6uk9tK8X4CqHfWKjW2BvYU25hAykwP'),
};
const KLEND_USDC = {
  reserve: P('AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z'),
  market: P('47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8'),
  supply: P('8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB'),
  fee: P('5iLRav31Y7DJwM6bZ7s92jqvV3zd1wZMcp4mYeKXh8cj'),
};
const KLEND_AUTHORITY = PublicKey.findProgramAddressSync([
  Buffer.from('lma'), KLEND_USDC.market.toBuffer()], KLEND)[0];

let requestId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

async function rpc(url, method, params, attempts = 10) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
    const text = await response.text();
    if (response.status === 429) {
      last = new Error(`${method}: rate limited`);
      await sleep(500 * (attempt + 1));
      continue;
    }
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${method}: non-JSON response`); }
    if (body.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(body.error)}`),
      {rpcError: body.error});
    return body.result;
  }
  throw last || new Error(`${method}: retries exhausted`);
}

async function quote(inputMint, outputMint, amount, mode) {
  const params = new URLSearchParams({
    inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(), amount: String(amount),
    slippageBps: SLIPPAGE_BPS, onlyDirectRoutes: 'true', maxAccounts: '32',
  });
  if (mode === 'alphaq') params.set('dexes', 'AlphaQ');
  if (mode === 'independent') params.set('excludeDexes', 'AlphaQ');
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text); } catch {}
    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      last = {status: response.status, error: body.error || text.slice(0, 120)};
      await sleep(350 * (attempt + 1));
      continue;
    }
    return {status: response.status, body};
  }
  return {status: last?.status || 0, body: {error: last?.error || 'quote retries exhausted'}};
}

function isExactAlphaQ(result) {
  const route = result.body?.routePlan || [];
  return result.status === 200 && !!result.body.outAmount && route.length === 1 &&
    route[0].swapInfo?.label === 'AlphaQ' && route[0].swapInfo?.ammKey === ALPHAQ_POOL;
}

async function maxAlphaQQuote() {
  let low = process.env.ALPHAQ_INPUT_RAW ? BigInt(process.env.ALPHAQ_INPUT_RAW) : 20_000_000_000n;
  let lowQuote = await quote(USDC, CASH, low, 'alphaq');
  if (!isExactAlphaQ(lowQuote)) throw new Error(`requested AlphaQ input unavailable: ${JSON.stringify(lowQuote.body)}`);
  if (process.env.ALPHAQ_INPUT_RAW) {
    return {amount: low, quote: lowQuote.body, plusOne: null,
      probes: [{amountRaw: low.toString(), accepted: true, status: lowQuote.status,
        contextSlot: lowQuote.body.contextSlot || null}]};
  }
  if (process.env.ALPHAQ_RECHECK_BOUNDARY === '1') {
    const plusOne = await quote(USDC, CASH, low + 1n, 'alphaq');
    if (isExactAlphaQ(plusOne)) throw new Error('cached 20,000 USDC boundary advanced');
    return {amount: low, quote: lowQuote.body, plusOne: {
      amountRaw: (low + 1n).toString(), accepted: false, status: plusOne.status,
      error: plusOne.body.error || plusOne.body.errorCode || null,
    }, probes: [{amountRaw: low.toString(), accepted: true, status: lowQuote.status,
      contextSlot: lowQuote.body.contextSlot || null}, {amountRaw: (low + 1n).toString(),
      accepted: false, status: plusOne.status,
      error: plusOne.body.error || plusOne.body.errorCode || null}]};
  }
  let high = 25_000_000_000n;
  let highQuote = await quote(USDC, CASH, high, 'alphaq');
  while (isExactAlphaQ(highQuote) && high < 100_000_000_000n) {
    low = high;
    lowQuote = highQuote;
    high *= 2n;
    highQuote = await quote(USDC, CASH, high, 'alphaq');
  }
  if (isExactAlphaQ(highQuote)) throw new Error('AlphaQ upper quote boundary not found');
  const probes = [{amountRaw: low.toString(), accepted: true, status: lowQuote.status,
    contextSlot: lowQuote.body.contextSlot || null},
  {amountRaw: high.toString(), accepted: false, status: highQuote.status,
    error: highQuote.body.error || highQuote.body.errorCode || null}];
  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    const candidate = await quote(USDC, CASH, mid, 'alphaq');
    const accepted = isExactAlphaQ(candidate);
    probes.push({amountRaw: mid.toString(), accepted, status: candidate.status,
      contextSlot: candidate.body.contextSlot || null,
      error: candidate.body.error || candidate.body.errorCode || null});
    if (accepted) {
      low = mid;
      lowQuote = candidate;
    } else {
      high = mid;
      highQuote = candidate;
    }
    await sleep(120);
  }
  const plusOne = await quote(USDC, CASH, low + 1n, 'alphaq');
  return {amount: low, quote: lowQuote.body, plusOne: {
    amountRaw: (low + 1n).toString(), accepted: isExactAlphaQ(plusOne),
    status: plusOne.status, error: plusOne.body.error || plusOne.body.errorCode || null,
  }, probes};
}

async function swapInstructions(quoteResponse, userPublicKey) {
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({quoteResponse, userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: false, dynamicComputeUnitLimit: false,
        prioritizationFeeLamports: 0}),
    });
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      last = `swap-instructions ${response.status}: ${text.slice(0, 120)}`;
      await sleep(750 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`swap-instructions ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
  throw new Error(last || 'swap-instructions retries exhausted');
}

async function fullSwap(quoteResponse, userPublicKey) {
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({quoteResponse, userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 0}),
    });
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      last = `swap ${response.status}: ${text.slice(0, 120)}`;
      await sleep(750 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`swap ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
  throw new Error(last || 'swap retries exhausted');
}

function jupiterIx(row) {
  return new TransactionInstruction({programId: P(row.programId),
    keys: row.accounts.map((key) => ({pubkey: P(key.pubkey), isSigner: key.isSigner,
      isWritable: key.isWritable})), data: Buffer.from(row.data, 'base64')});
}

function jupiterSet(response) {
  if (response.tokenLedgerInstruction) throw new Error('unexpected token-ledger instruction');
  const rows = [...(response.otherInstructions || []), ...(response.setupInstructions || []),
    response.swapInstruction, ...(response.cleanupInstruction ? [response.cleanupInstruction] : [])];
  return rows.filter(Boolean).map(jupiterIx);
}

async function loadLookupTables(responses) {
  const addresses = [...new Set(responses.flatMap((response) =>
    response.addressLookupTableAddresses || []))];
  const tables = [];
  for (const address of addresses) {
    const account = await rpc(SIM_RPC, 'getAccountInfo', [address,
      {encoding: 'base64', commitment: 'processed'}]);
    if (!account.value) throw new Error(`missing Jupiter lookup table ${address}`);
    tables.push(new AddressLookupTableAccount({key: P(address),
      state: AddressLookupTableAccount.deserialize(Buffer.from(account.value.data[0], 'base64'))}));
  }
  return tables;
}

async function decompileFullSwap(response) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(response.swapTransaction, 'base64'));
  const addresses = transaction.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());
  const tables = await loadLookupTables([{addressLookupTableAddresses: addresses}]);
  const decompiled = TransactionMessage.decompile(transaction.message,
    {addressLookupTableAccounts: tables});
  return {instructions: decompiled.instructions.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET)),
    lookupTables: tables};
}

function historyIx(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = message.header;
  const staticCount = message.accountKeys.length;
  const writable = (keyIndex) => keyIndex < staticCount
    ? (keyIndex < header.numRequiredSignatures
      ? keyIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : keyIndex < staticCount - header.numReadonlyUnsignedAccounts)
    : keyIndex < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map((keyIndex) => ({pubkey: P(keys[keyIndex]),
      isSigner: keyIndex < header.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}

const clone = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});

function klendPair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  for (const ix of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: KLEND_AUTHORITY,
      2: KLEND_USDC.market, 3: KLEND_USDC.reserve, 4: USDC, 5: KLEND_USDC.supply,
      6: destination, 7: KLEND_USDC.fee, 11: TOKEN_PROGRAM_ID})) {
      ix.keys[Number(index)].pubkey = pubkey;
    }
    ix.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}

function savePair(templates, authority, destination, amount) {
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  for (const [index, pubkey] of Object.entries({0: SAVE_USDC.supply, 1: destination,
    2: SAVE_USDC.reserve, 3: SAVE_USDC.market, 4: SAVE_USDC.marketAuthority,
    5: IX_SYSVAR, 6: TOKEN_PROGRAM_ID})) borrow.keys[Number(index)].pubkey = pubkey;
  for (const [index, pubkey] of Object.entries({0: destination, 1: SAVE_USDC.supply,
    2: SAVE_USDC.fee, 3: destination, 4: SAVE_USDC.reserve, 5: SAVE_USDC.market,
    6: authority, 7: IX_SYSVAR, 8: TOKEN_PROGRAM_ID})) repay.keys[Number(index)].pubkey = pubkey;
  borrow.data.writeBigUInt64LE(amount, 1);
  repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}

function p0Set(templates, authority, marginAccount, destination, amount) {
  const start = clone(templates.start);
  const borrow = clone(templates.borrow);
  const repay = clone(templates.repay);
  const end = clone(templates.end);
  start.keys[0].pubkey = marginAccount;
  start.keys[1].pubkey = authority;
  borrow.keys[1].pubkey = marginAccount;
  borrow.keys[2].pubkey = authority;
  borrow.keys[4].pubkey = destination;
  repay.keys[1].pubkey = marginAccount;
  repay.keys[2].pubkey = authority;
  repay.keys[4].pubkey = destination;
  end.keys[0].pubkey = marginAccount;
  end.keys[2].pubkey = authority;
  borrow.data.writeBigUInt64LE(amount, 8);
  repay.data.writeBigUInt64LE(amount, 8);
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

function saveFee(amount) {
  return amount * 4n / 10_000n;
}

function signV1(encoded, instructions, payer, keypairs, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const byAddress = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  signerOrder.forEach((address, index) => {
    const keypair = byAddress.get(address);
    if (!keypair) throw new Error(`uncontrolled required signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder};
}

function encodeV0(instructions, payer, keypairs, blockhash, lookupTables) {
  const message = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message(lookupTables);
  const shortvec = (value) => {
    const bytes = [];
    let remaining = value;
    do {
      let byte = remaining & 0x7f;
      remaining >>>= 7;
      if (remaining) byte |= 0x80;
      bytes.push(byte);
    } while (remaining);
    return Buffer.from(bytes);
  };
  const messageBytes = Buffer.concat([
    Buffer.from([0x80, message.header.numRequiredSignatures,
      message.header.numReadonlySignedAccounts, message.header.numReadonlyUnsignedAccounts]),
    shortvec(message.staticAccountKeys.length),
    ...message.staticAccountKeys.map((key) => key.toBuffer()),
    Buffer.from(bs58.decode(message.recentBlockhash)),
    shortvec(message.compiledInstructions.length),
    ...message.compiledInstructions.map((ix) => Buffer.concat([
      Buffer.from([ix.programIdIndex]), shortvec(ix.accountKeyIndexes.length),
      Buffer.from(ix.accountKeyIndexes), shortvec(ix.data.length), Buffer.from(ix.data),
    ])),
    shortvec(message.addressTableLookups.length),
    ...message.addressTableLookups.map((lookup) => Buffer.concat([
      lookup.accountKey.toBuffer(), shortvec(lookup.writableIndexes.length),
      Buffer.from(lookup.writableIndexes), shortvec(lookup.readonlyIndexes.length),
      Buffer.from(lookup.readonlyIndexes),
    ])),
  ]);
  const signerOrder = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(String);
  const byAddress = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  const signatures = signerOrder.map((address) => {
    const keypair = byAddress.get(address);
    if (!keypair) throw new Error(`uncontrolled required signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    return crypto.sign(null, messageBytes, privateKey);
  });
  const wire = Buffer.concat([shortvec(signatures.length), ...signatures, messageBytes]);
  const loadedAddresses = message.addressTableLookups.reduce((sum, lookup) =>
    sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length, 0);
  return {wire, sizeBytes: wire.length,
    addressCount: message.staticAccountKeys.length + loadedAddresses,
    staticAddressCount: message.staticAccountKeys.length,
    loadedAddressCount: loadedAddresses,
    instructionCount: message.compiledInstructions.length,
    requiredSignatures: message.header.numRequiredSignatures,
    lookupTableCount: message.addressTableLookups.length,
    signerOrder};
}

async function encodeV1Kit(instructions, payer, keypairs, blockhashValue, lastValidBlockHeight) {
  const modulePath = process.env.SOLANA_KIT_MODULE;
  if (!modulePath) throw new Error('SOLANA_KIT_MODULE is required for the official v1 encoder');
  const kit = await import(pathToFileURL(modulePath).href);
  const signerPairs = await Promise.all(keypairs.map(async (keypair) => [
    keypair.publicKey.toBase58(), await kit.createKeyPairSignerFromBytes(keypair.secretKey),
  ]));
  const signerByAddress = new Map(signerPairs);
  const feePayer = signerByAddress.get(payer.toBase58());
  if (!feePayer) throw new Error('v1 fee payer signer unavailable');
  const converted = instructions.map((ix) => ({
    programAddress: kit.address(ix.programId.toBase58()),
    accounts: ix.keys.map((meta) => {
      const value = meta.pubkey.toBase58();
      const signer = signerByAddress.get(value);
      const role = meta.isSigner
        ? (meta.isWritable ? kit.AccountRole.WRITABLE_SIGNER : kit.AccountRole.READONLY_SIGNER)
        : (meta.isWritable ? kit.AccountRole.WRITABLE : kit.AccountRole.READONLY);
      return signer ? {address: signer.address, role, signer} : {address: kit.address(value), role};
    }),
    data: new Uint8Array(ix.data),
  }));
  let message = kit.createTransactionMessage({version: 1});
  message = kit.setTransactionMessageFeePayerSigner(feePayer, message);
  message = kit.setTransactionMessageLifetimeUsingBlockhash({
    blockhash: kit.blockhash(blockhashValue), lastValidBlockHeight: BigInt(lastValidBlockHeight),
  }, message);
  message = kit.setTransactionMessageConfig({computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 67_108_864}, message);
  message = kit.appendTransactionMessageInstructions(converted, message);
  const signed = await kit.signTransactionMessageWithSigners(message);
  const wire = Buffer.from(kit.getTransactionEncoder().encode(signed));
  const decoded = VersionedTransaction.deserialize(wire);
  const signerOrder = decoded.message.staticAccountKeys
    .slice(0, decoded.message.header.numRequiredSignatures).map(String);
  return {wire, sizeBytes: wire.length, addressCount: decoded.message.staticAccountKeys.length,
    staticAddressCount: decoded.message.staticAccountKeys.length, loadedAddressCount: 0,
    lookupTableCount: 0, instructionCount: decoded.message.compiledInstructions.length,
    requiredSignatures: decoded.message.header.numRequiredSignatures, signerOrder,
    sdk: '@solana/kit', sdkVersion: '8.5.0'};
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function splTokenAccount(mint, authority, amount = 0n) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data.toString('hex');
}

async function routeOnlyControl(amount, routeInstructions, ctx) {
  await rpc(FORK, 'surfnet_setAccount', [ctx.usdcAta.toBase58(), {
    data: splTokenAccount(USDC, ctx.authority.publicKey, amount), executable: false,
    lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0,
  }]);
  await importInstructions(routeInstructions);
  const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV0(routeInstructions, ctx.authority.publicKey, [ctx.authority], blockhash,
    ctx.lookupTables);
  const response = await rpc(FORK, 'simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
  }]);
  return {purpose: 'runtime diagnostic only; USDC input synthetically seeded on isolated fork',
    inputRaw: amount.toString(), err: response.value.err || null,
    unitsConsumed: response.value.unitsConsumed,
    envelope: {version: 0, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      staticAddresses: encoded.staticAddressCount, loadedAddresses: encoded.loadedAddressCount,
      lookupTables: encoded.lookupTableCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: encoded.signerOrder, sigVerify: true, signedWireSha256: sha256(encoded.wire)},
    alphaQParents: alphaQParents(response.value.logs || []), logs: response.value.logs || [],
    broadcast: false, signedWirePersisted: false};
}

function alphaQParents(logs) {
  const stack = [];
  const found = [];
  for (const line of logs || []) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]);
      stack.length = depth - 1;
      const parent = depth > 1 ? stack[depth - 2] || null : null;
      stack[depth - 1] = invoke[1];
      if (invoke[1] === ALPHAQ.toBase58()) found.push({depth, immediateParent: parent});
      continue;
    }
    const done = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:)/.exec(line);
    if (done) {
      const index = stack.lastIndexOf(done[1]);
      if (index >= 0) stack.length = index;
    }
  }
  return found;
}

async function importInstructions(instructions) {
  const addresses = [...new Map(instructions.flatMap((ix) => [ix.programId,
    ...ix.keys.map((key) => key.pubkey)]).map((address) => [address.toBase58(), address])).values()];
  for (const address of addresses) {
    await rpc(SIM_RPC, 'getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
}

async function buildCase(label, providers, total, routeInstructions, ctx, economics) {
  const count = BigInt(providers.length);
  const base = total / count;
  const remainder = total % count;
  const amounts = Object.fromEntries(providers.map((provider, index) =>
    [provider, base + (BigInt(index) < remainder ? 1n : 0n)]));
  const klend = providers.includes('klend') ? klendPair(ctx.klendTemplates,
    ctx.authority.publicKey, ctx.usdcAta, amounts.klend) : null;
  const p0 = providers.includes('project0') ? p0Set(ctx.p0Templates, ctx.authority.publicKey,
    ctx.marginAccount.publicKey, ctx.usdcAta, amounts.project0) : null;
  const save = providers.includes('save') ? savePair(ctx.saveTemplates, ctx.authority.publicKey,
    ctx.usdcAta, amounts.save) : null;
  const instructions = [];
  if (p0) instructions.push(p0Initialize(ctx.p0Group, ctx.marginAccount.publicKey,
    ctx.authority.publicKey));
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    ctx.authority.publicKey, ctx.usdcAta, ctx.authority.publicKey, USDC, TOKEN_PROGRAM_ID));
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(
    ctx.authority.publicKey, ctx.cashAta, ctx.authority.publicKey, CASH, TOKEN_2022_PROGRAM_ID));
  if (p0) instructions.push(p0.start);
  if (klend) instructions.push(klend.borrow);
  if (p0) instructions.push(p0.borrow);
  if (save) instructions.push(save.borrow);
  instructions.push(...routeInstructions);
  // Repay zero-fee sources first and Save last. If the route cannot restore
  // principal, the exact failing repayment is preserved in the receipt.
  if (klend) instructions.push(klend.repay);
  if (p0) instructions.push(p0.repay);
  if (save) instructions.push(save.repay);
  if (p0) instructions.push(p0.end);
  if (p0) p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
  if (klend) klend.repay.data[16] = instructions.indexOf(klend.borrow);
  if (save) save.repay.data[9] = instructions.indexOf(save.borrow);

  await importInstructions(instructions);
  const latestBlockhash = (await rpc(SIM_RPC, 'getLatestBlockhash', [{commitment: 'processed'}])).value;
  const blockhash = latestBlockhash.blockhash;
  let encoded;
  try {
    encoded = V1_MAINNET
      ? await encodeV1Kit(instructions, ctx.authority.publicKey,
        [ctx.authority, ctx.marginAccount], blockhash, latestBlockhash.lastValidBlockHeight)
      : encodeV0(instructions, ctx.authority.publicKey,
        [ctx.authority, ctx.marginAccount], blockhash, ctx.lookupTables);
  } catch (error) {
    return {label, providers, amounts: Object.fromEntries(Object.entries(amounts)
      .map(([key, value]) => [key, value.toString()])), envelopeError: error.message,
      completeRepayment: false};
  }
  const providerFee = save ? saveFee(amounts.save) : 0n;
  const protocolRepaymentRaw = total + providerFee;
  const grossOutputRaw = BigInt(economics.exitOutRaw);
  const equityAfterProtocolRepaymentRaw = grossOutputRaw - protocolRepaymentRaw;
  const netAfterNetworkCostRaw = equityAfterProtocolRepaymentRaw - BigInt(economics.feeUsdcRaw);
  const envelope = {version: V1_MAINNET ? 1 : 0, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
    staticAddresses: encoded.staticAddressCount, loadedAddresses: encoded.loadedAddressCount,
    lookupTables: encoded.lookupTableCount,
    instructions: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures, signerOrder: encoded.signerOrder, sigVerify: true,
    maxBytes: 4096, maxAddresses: 64, currentRuntimePacketMaxBytes: V1_MAINNET ? 4096 : 1232,
    withinRequestedLimits: encoded.sizeBytes <= 4096 && encoded.addressCount <= 64,
    withinCurrentRuntimePacketLimit: encoded.sizeBytes <= (V1_MAINNET ? 4096 : 1232),
    sdk: encoded.sdk || '@solana/web3.js', sdkVersion: encoded.sdkVersion || '1.99.0',
    signedWireSha256: sha256(encoded.wire)};
  let response;
  const beforeResponse = await rpc(SIM_RPC, 'getMultipleAccounts', [ctx.watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const beforeRaw = Object.fromEntries(Object.entries(ctx.roles).map(([role, address]) => {
    const index = ctx.watched.findIndex((item) => item.toBase58() === address);
    return [role, tokenAmount(beforeResponse.value[index])];
  }));
  try {
    response = await rpc(SIM_RPC, 'simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: ctx.watched.map(String)},
    }]);
  } catch (error) {
    return {label, providers,
      amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toString()])),
      routeInputRaw: total.toString(), providerFeeRaw: providerFee.toString(),
      protocolRepaymentRaw: protocolRepaymentRaw.toString(), grossExitOutputRaw: grossOutputRaw.toString(),
      equityAfterProtocolRepaymentRaw: equityAfterProtocolRepaymentRaw.toString(),
      networkFeeUsdcEquivalentRaw: economics.feeUsdcRaw,
      netAfterAllQuotedCostsRaw: netAfterNetworkCostRaw.toString(),
      repaymentShortfallRaw: equityAfterProtocolRepaymentRaw < 0n
        ? (-equityAfterProtocolRepaymentRaw).toString() : '0',
      transportError: error.message, rpcError: error.rpcError || null, envelope,
      completeRepayment: false, broadcast: false, signedWirePersisted: false};
  }
  const post = response.value.accounts || [];
  const postRaw = Object.fromEntries(Object.entries(ctx.roles).map(([role, address]) => {
    const index = ctx.watched.findIndex((item) => item.toBase58() === address);
    return [role, tokenAmount(post[index])];
  }));
  const tokenDeltas = response.value.err ? Object.fromEntries(Object.keys(ctx.roles)
    .map((role) => [role, null])) : Object.fromEntries(Object.keys(ctx.roles).map((role) => {
    const before = beforeRaw[role] == null && (role === 'outsiderCash' || role === 'outsiderUsdc')
      ? 0n : beforeRaw[role] == null ? null : BigInt(beforeRaw[role]);
    const after = postRaw[role] == null && (role === 'outsiderCash' || role === 'outsiderUsdc')
      ? 0n : postRaw[role] == null ? null : BigInt(postRaw[role]);
    return [role, before == null || after == null ? null : (after - before).toString()];
  }));
  const logs = response.value.logs || [];
  const providerRoles = [...(klend ? ['klendSupply'] : []),
    ...(p0 ? ['project0Vault'] : []), ...(save ? ['saveSupply'] : [])];
  const completeRepayment = response.value.err === null &&
    providerRoles.every((role) => tokenDeltas[role] === '0') &&
    (!save || tokenDeltas.saveFee === providerFee.toString());
  const actualOutsiderUsdcDeltaRaw = tokenDeltas.outsiderUsdc;
  const actualNetAfterNetworkCostRaw = actualOutsiderUsdcDeltaRaw == null ? null
    : (BigInt(actualOutsiderUsdcDeltaRaw) - BigInt(economics.feeUsdcRaw)).toString();
  let residualCashMarkUsdcRaw = null;
  if (tokenDeltas.outsiderCash != null && BigInt(tokenDeltas.outsiderCash) > 0n) {
    const residualQuote = await quote(CASH, USDC, BigInt(tokenDeltas.outsiderCash), 'independent');
    residualCashMarkUsdcRaw = residualQuote.body.outAmount || null;
  }
  const actualNetAllAssetsAfterNetworkCostRaw = actualOutsiderUsdcDeltaRaw == null ||
    residualCashMarkUsdcRaw == null ? null : (BigInt(actualOutsiderUsdcDeltaRaw) +
      BigInt(residualCashMarkUsdcRaw) - BigInt(economics.feeUsdcRaw)).toString();
  const row = {label, providers,
    amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toString()])),
    routeInputRaw: total.toString(), providerFeeRaw: providerFee.toString(),
    protocolRepaymentRaw: protocolRepaymentRaw.toString(),
    grossExitOutputRaw: grossOutputRaw.toString(),
    equityAfterProtocolRepaymentRaw: equityAfterProtocolRepaymentRaw.toString(),
    networkFeeUsdcEquivalentRaw: economics.feeUsdcRaw,
    netAfterAllQuotedCostsRaw: netAfterNetworkCostRaw.toString(),
    repaymentShortfallRaw: equityAfterProtocolRepaymentRaw < 0n
      ? (-equityAfterProtocolRepaymentRaw).toString() : '0',
    err: response.value.err || null, unitsConsumed: response.value.unitsConsumed,
    loadedAccountsDataSize: response.value.loadedAccountsDataSize,
    envelope,
    alphaQParents: alphaQParents(logs),
    providerInvocations: Object.fromEntries([[KLEND, 'klend'], [P0, 'project0'], [SAVE, 'save']]
      .filter(([, name]) => providers.includes(name))
      .map(([program, name]) => [name, logs.filter((line) => line === `Program ${program} invoke [1]`).length])),
    beforeContextSlot: beforeResponse.context.slot, simulationContextSlot: response.context.slot,
    beforeRaw, postRaw, tokenDeltas, actualOutsiderUsdcDeltaRaw,
    actualOutsiderCashDeltaRaw: tokenDeltas.outsiderCash,
    actualNetAfterNetworkCostRaw, residualCashMarkUsdcRaw,
    actualNetAllAssetsAfterNetworkCostRaw, logs, completeRepayment,
    broadcast: false, signedWirePersisted: false,
  };
  console.log(JSON.stringify({label, err: row.err, envelope: row.envelope,
    unitsConsumed: row.unitsConsumed, repaymentShortfallRaw: row.repaymentShortfallRaw,
    completeRepayment: row.completeRepayment}));
  return row;
}

async function main() {
  const genesis = await rpc(SIM_RPC, 'getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('fork is not mainnet-beta');
  const authority = V1_MAINNET ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(process.env.HOOKED_KEYPAIR_PATH || path.join(process.env.HOME, 'hooked.json'), 'utf8'))))
    : Keypair.generate();
  const marginAccount = Keypair.generate();
  if (!V1_MAINNET) {
    await rpc(FORK, 'surfnet_setAccount', [authority.publicKey.toBase58(), {
      data: '', executable: false, lamports: 2_000_000_000, owner: SystemProgram.programId.toBase58(),
      rentEpoch: 0,
    }]);
  }
  const usdcAta = getAssociatedTokenAddressSync(USDC, authority.publicKey, false, TOKEN_PROGRAM_ID);
  const cashAta = getAssociatedTokenAddressSync(CASH, authority.publicKey, false, TOKEN_2022_PROGRAM_ID);
  // Realistic pre-transaction setup: the outsider may create its empty ATA in
  // advance. No USDC is seeded; all route input must still come from lenders.
  if (!V1_MAINNET) {
    await rpc(FORK, 'surfnet_setAccount', [usdcAta.toBase58(), {
      data: splTokenAccount(USDC, authority.publicKey), executable: false,
      lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0,
    }]);
  }

  const boundary = await maxAlphaQQuote();
  if (boundary.plusOne?.accepted) throw new Error('quote boundary changed during final +1 probe');
  if (EXIT_BUFFER_RAW >= BigInt(boundary.quote.outAmount)) throw new Error('exit buffer consumes AlphaQ output');
  const exitInputRaw = BigInt(boundary.quote.outAmount) - EXIT_BUFFER_RAW;
  const exitResult = await quote(CASH, USDC, exitInputRaw, 'independent');
  if (exitResult.status !== 200 || !exitResult.body.outAmount) {
    throw new Error(`independent exit unavailable: ${JSON.stringify(exitResult.body)}`);
  }
  if ((exitResult.body.routePlan || []).some((row) => row.swapInfo?.ammKey === ALPHAQ_POOL ||
      row.swapInfo?.label === 'AlphaQ')) throw new Error('exit unexpectedly aliases AlphaQ');
  const feeQuoteResult = await quote(WSOL, USDC, 10_000n, 'independent');
  const feeUsdcRaw = feeQuoteResult.body.outAmount || '0';
  const alphaQBuilt = await fullSwap(boundary.quote, authority.publicKey);
  await sleep(500);
  const exitBuilt = await fullSwap(exitResult.body, authority.publicKey);
  const [saveSource, p0Source] = await Promise.all([
    rpc(UPSTREAM, 'getTransaction', [SAVE_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    rpc(UPSTREAM, 'getTransaction', [P0_SOURCE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  if (!saveSource || !p0Source) throw new Error('provider source transaction unavailable');
  const saveTemplates = {borrow: historyIx(saveSource, 6), repay: historyIx(saveSource, 12)};
  const p0Templates = {start: historyIx(p0Source, 1), borrow: historyIx(p0Source, 2),
    repay: historyIx(p0Source, 5), end: historyIx(p0Source, 6)};
  const klendHistory = JSON.parse(fs.readFileSync(path.join(OCT15, 'kamino-flash-history.json')));
  const klendSource = klendHistory.hits[0].transaction;
  const klendTemplates = {borrow: historyIx(klendSource, 3), repay: historyIx(klendSource, 13)};
  if (!saveTemplates.borrow.programId.equals(SAVE) || !saveTemplates.repay.programId.equals(SAVE) ||
      !p0Templates.start.programId.equals(P0) || !p0Templates.end.programId.equals(P0) ||
      !klendTemplates.borrow.programId.equals(KLEND) || !klendTemplates.repay.programId.equals(KLEND)) {
    throw new Error('provider template mismatch');
  }
  const p0Group = p0Templates.borrow.keys[0].pubkey;
  const p0Bank = p0Templates.borrow.keys[3].pubkey;
  const p0Vault = p0Templates.borrow.keys[6].pubkey;
  const alphaQDecompiled = await decompileFullSwap(alphaQBuilt);
  const exitDecompiled = await decompileFullSwap(exitBuilt);
  const routeInstructions = [...alphaQDecompiled.instructions, ...exitDecompiled.instructions];
  const lookupTables = [...new Map([...alphaQDecompiled.lookupTables, ...exitDecompiled.lookupTables]
    .map((table) => [table.key.toBase58(), table])).values()];
  const watched = [usdcAta, cashAta, POOL_CASH, POOL_USDC, KLEND_USDC.supply,
    p0Vault, SAVE_USDC.supply, SAVE_USDC.fee];
  const roles = {outsiderUsdc: usdcAta.toBase58(), outsiderCash: cashAta.toBase58(),
    alphaQCashVault: POOL_CASH.toBase58(), alphaQUsdcVault: POOL_USDC.toBase58(),
    klendSupply: KLEND_USDC.supply.toBase58(), project0Vault: p0Vault.toBase58(),
    saveSupply: SAVE_USDC.supply.toBase58(), saveFee: SAVE_USDC.fee.toBase58()};
  const ctx = {authority, marginAccount, usdcAta, cashAta, p0Group, p0Bank, p0Vault,
    saveTemplates, p0Templates, klendTemplates, lookupTables, watched, roles};
  const economics = {exitOutRaw: exitResult.body.outAmount, feeUsdcRaw};
  const cases = [];
  cases.push(await buildCase('two_source_klend_project0_max_route', ['klend', 'project0'],
    boundary.amount, routeInstructions, ctx, economics));
  cases.push(await buildCase('three_source_klend_project0_save_max_route',
    ['klend', 'project0', 'save'], boundary.amount, routeInstructions, ctx, economics));
  const v0RouteOnlyControl = V1_MAINNET ? null : await routeOnlyControl(boundary.amount, routeInstructions, ctx);

  const capacityAddresses = [SAVE_USDC.reserve, SAVE_USDC.supply, KLEND_USDC.reserve,
    KLEND_USDC.supply, p0Vault];
  const capacityAccounts = await rpc(SIM_RPC, 'getMultipleAccounts', [capacityAddresses.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const data = capacityAccounts.value.map((row) => Buffer.from(row.data[0], 'base64'));
  const capacities = {
    saveAvailableRaw: data[0].readBigUInt64LE(171).toString(),
    saveSupplyRaw: data[1].readBigUInt64LE(64).toString(),
    klendAvailableRaw: data[2].readBigUInt64LE(224).toString(),
    klendFlashFeeSf: data[2].readBigUInt64LE(4904).toString(),
    klendSupplyRaw: data[3].readBigUInt64LE(64).toString(),
    project0VaultRaw: data[4].readBigUInt64LE(64).toString(),
  };
  const output = {
    generatedAtUtc: new Date().toISOString(), network: V1_MAINNET
      ? 'mainnet-beta signed simulateTransaction' : 'mainnet-beta current Surfpool fork', genesis,
    safety: {broadcast: false, sendTransactionPathPresent: false, sigVerify: true,
      freshOutsider: !V1_MAINNET, privateKeysPersisted: false, signedWirePersisted: false,
      syntheticState: V1_MAINNET
        ? 'none; runtime-loaded outsider wallet and a fresh Project0 margin signer; no state mutation or broadcast'
        : 'fresh outsider received SOL and an initialized empty USDC ATA; no USDC or CASH was seeded'},
    routeBoundary: {highestObservedAcceptedInputRaw: boundary.amount.toString(),
      slippageBps: SLIPPAGE_BPS,
      plusOne: boundary.plusOne, probeCount: boundary.probes.length,
      probes: boundary.probes, alphaQOutputRaw: boundary.quote.outAmount,
      exitBufferRaw: EXIT_BUFFER_RAW.toString(),
      independentExitInputRaw: exitInputRaw.toString(),
      independentExitOutputRaw: exitResult.body.outAmount,
      grossRoundTripDeltaRaw: (BigInt(exitResult.body.outAmount) - boundary.amount).toString(),
      alphaQContextSlot: boundary.quote.contextSlot || null,
      independentExitContextSlot: exitResult.body.contextSlot || null,
      alphaQRoute: (boundary.quote.routePlan || []).map((row) => ({label: row.swapInfo?.label,
        ammKey: row.swapInfo?.ammKey})),
      independentExitRoute: (exitResult.body.routePlan || []).map((row) => ({
        label: row.swapInfo?.label, ammKey: row.swapInfo?.ammKey})),
      caveat: 'Highest accepted Jupiter quote observed during a live monotonic boundary search; quote state advances while mainnet produces slots.'},
    costBasis: {baseFeeLamports: '10000', signerCount: 2,
      baseFeeUsdcEquivalentRaw: feeUsdcRaw, prioritizationFeeLamports: '0',
      saveFee: 'floor(save principal * 4 / 10000)', klendFee: '0', project0Fee: '0'},
    providers: {programs: {klend: KLEND.toBase58(), project0: P0.toBase58(), save: SAVE.toBase58()},
      capacities, accounts: {klendReserve: KLEND_USDC.reserve.toBase58(),
        project0Bank: p0Bank.toBase58(), project0Vault: p0Vault.toBase58(),
        saveReserve: SAVE_USDC.reserve.toBase58()}},
    routeInstructionCount: routeInstructions.length,
    lookupTables: lookupTables.map((table) => table.key.toBase58()),
    atomicFormat: V1_MAINNET ? 'v1 via @solana/kit 8.5.0; all addresses inline; no ALTs'
      : 'v0 via @solana/web3.js 1.99.0; Jupiter ALTs retained',
    v0RouteOnlyControl,
    cases,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, routeBoundary: output.routeBoundary,
    capacities, cases: cases.map((row) => ({label: row.label, err: row.err || null,
      envelopeError: row.envelopeError || null, envelope: row.envelope || null,
      unitsConsumed: row.unitsConsumed, repaymentShortfallRaw: row.repaymentShortfallRaw,
      completeRepayment: row.completeRepayment}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
