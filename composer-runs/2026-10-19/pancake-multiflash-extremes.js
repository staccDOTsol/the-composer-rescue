#!/usr/bin/env node
'use strict';

// Signed, simulation-only PancakeSwap USDT/WSOL round trips on a current
// mainnet-backed Surfpool fork. Deliberately contains no sendTransaction path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} =
  require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction} =
  require(`${MOD}/@solana/spl-token`);
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;

const DIR = __dirname;
const OCT15 = path.join(DIR, '../2026-10-15');
const {encodeV1} = require(path.join(OCT15, 'klend-v1-composition.js'));
const OUT = path.join(DIR, 'pancake-multiflash-extremes.json');
const FORK = process.env.PANCAKE_FLASH_FORK_RPC || 'http://127.0.0.1:9197';
const UPSTREAM = process.env.SOLANA_RPC_URL || process.env.RPC_URL ||
  'https://api.mainnet-beta.solana.com';
const P = (x) => new PublicKey(x);
const WSOL = P('So11111111111111111111111111111111111111112');
const USDT = P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const PANCAKE = P('HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq');
const PANCAKE_POOL = P('22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w');
const PANCAKE_WSOL = P('7YcR78PKBHE5divhPVJ668kmmaDzove2d9msY9NpAJL2');
const PANCAKE_USDT = P('FCBauqNLbEBUci1v3NT4gWyFZXS4YUGnX7ZsPmWVzrvV');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const P0_WSOL_BANK = P('CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh');
const P0_WSOL_VAULT = P('2eicbpitfJXDwqCuFAmPgDP7t2oUotnAzbGzRKLMgSLe');
const P0_WSOL_AUTH = P('DD3AeAssFvjqTvRTrRAtpfjkBF8FpVKnFuwnMLN9haXD');
const P0_WSOL_ORACLE = P('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const SAVE_SOURCE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const P0_SOURCE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const klendCensus = JSON.parse(fs.readFileSync(path.join(OCT15, 'klend-zero-fee-census.json')));
const klendReserve = klendCensus.activeZero.find((row) =>
  row.reserve === '4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM');
if (!klendReserve) throw new Error('Pinned zero-fee KLend WSOL reserve missing');

let requestId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const clone = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});

async function rpc(url, method, params, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
    const text = await response.text();
    if (response.status === 429) { last = new Error(`${method}: rate limited`); await sleep(300 * (i + 1)); continue; }
    const body = JSON.parse(text);
    if (body.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(body.error)}`),
      {rpcError: body.error});
    return body.result;
  }
  throw last || new Error(`${method}: retries exhausted`);
}

async function quote(inputMint, outputMint, amount, mode) {
  const params = new URLSearchParams({inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(), amount: String(amount), slippageBps: '100',
    maxAccounts: mode === 'pancake' ? '32' : '24'});
  if (mode === 'pancake') {
    params.set('onlyDirectRoutes', 'true');
    params.set('dexes', 'PancakeSwap');
  } else {
    params.set('restrictIntermediateTokens', 'true');
    params.set('excludeDexes', 'PancakeSwap');
  }
  let last;
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
    const text = await response.text();
    let body = {};
    try { body = JSON.parse(text); } catch {}
    if (response.status === 429 || response.status >= 500) {
      last = {status: response.status, error: body.error || text.slice(0, 160)};
      await sleep(600 * (i + 1));
      continue;
    }
    return {status: response.status, body};
  }
  return {status: last?.status || 0, body: {error: last?.error || 'capped quote retries exhausted'}};
}

function exactPancake(result) {
  const route = result.body?.routePlan || [];
  return result.status === 200 && !!result.body.outAmount && route.length === 1 &&
    route[0].swapInfo?.label === 'PancakeSwap' &&
    route[0].swapInfo?.ammKey === PANCAKE_POOL.toBase58();
}

async function swapInstructions(quoteResponse, authority) {
  let last;
  for (let i = 0; i < 3; i++) {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
        quoteResponse, userPublicKey: authority.toBase58(), wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: false, prioritizationFeeLamports: 0,
      }),
    });
    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      last = `swap-instructions ${response.status}: ${text.slice(0, 160)}`;
      await sleep(700 * (i + 1));
      continue;
    }
    if (!response.ok) throw new Error(`swap-instructions ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
  throw new Error(last || 'capped swap-instructions retries exhausted');
}

function jupiterIx(row) {
  return new TransactionInstruction({programId: P(row.programId), data: Buffer.from(row.data, 'base64'),
    keys: row.accounts.map((key) => ({pubkey: P(key.pubkey), isSigner: key.isSigner,
      isWritable: key.isWritable}))});
}

function jupiterSet(response) {
  if (response.tokenLedgerInstruction) throw new Error('unexpected token ledger');
  return [...(response.otherInstructions || []), ...(response.setupInstructions || []),
    response.swapInstruction, ...(response.cleanupInstruction ? [response.cleanupInstruction] : [])]
    .filter(Boolean).map(jupiterIx);
}

function historyIx(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const h = message.header;
  const staticCount = message.accountKeys.length;
  const writable = (i) => i < staticCount
    ? (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : i < staticCount - h.numReadonlyUnsignedAccounts)
    : i < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({pubkey: P(keys[i]), isSigner: i < h.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(source.data))});
}

function savePair(t, authority, destination, amount) {
  const borrow = clone(t.borrow); const repay = clone(t.repay);
  borrow.keys[1].pubkey = destination;
  repay.keys[0].pubkey = destination; repay.keys[3].pubkey = destination;
  repay.keys[6].pubkey = authority;
  borrow.data.writeBigUInt64LE(amount, 1); repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}

function klendPair(t, authority, destination, amount) {
  const borrow = clone(t.borrow); const repay = clone(t.repay);
  const market = P(klendReserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  for (const ix of [borrow, repay]) {
    for (const [index, pubkey] of Object.entries({0: authority, 1: marketAuthority, 2: market,
      3: P(klendReserve.reserve), 4: WSOL, 5: P(klendReserve.supplyVault),
      6: destination, 7: P(klendReserve.feeVault), 11: TOKEN_PROGRAM_ID}))
      ix.keys[Number(index)].pubkey = pubkey;
    ix.data.writeBigUInt64LE(amount, 8);
  }
  return {borrow, repay};
}

function p0Set(t, authority, margin, destination, amount) {
  const start = clone(t.start); const borrow = clone(t.borrow);
  const repay = clone(t.repay); const end = clone(t.end);
  start.keys[0].pubkey = margin; start.keys[1].pubkey = authority;
  borrow.keys[1].pubkey = margin; borrow.keys[2].pubkey = authority;
  borrow.keys[3].pubkey = P0_WSOL_BANK; borrow.keys[4].pubkey = destination;
  borrow.keys[5].pubkey = P0_WSOL_AUTH; borrow.keys[6].pubkey = P0_WSOL_VAULT;
  borrow.keys[8].pubkey = P0_WSOL_BANK; borrow.keys[9].pubkey = P0_WSOL_ORACLE;
  repay.keys[1].pubkey = margin; repay.keys[2].pubkey = authority;
  repay.keys[3].pubkey = P0_WSOL_BANK; repay.keys[4].pubkey = destination;
  repay.keys[5].pubkey = P0_WSOL_VAULT; repay.keys[6].pubkey = TOKEN_PROGRAM_ID;
  end.keys[0].pubkey = margin; end.keys[2].pubkey = authority;
  borrow.data.writeBigUInt64LE(amount, 8); repay.data.writeBigUInt64LE(amount, 8);
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

const saveFee = (amount) => (amount * 4n + 9_999n) / 10_000n;

function signV1(encoded, instructions, payer, keypairs, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions})
    .compileToV0Message();
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const order = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const map = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  order.forEach((address, index) => {
    const keypair = map.get(address);
    if (!keypair) throw new Error(`uncontrolled signer ${address}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder: order};
}

function accountImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const row = {owner: account.owner, lamports: String(account.lamports), dataLength: data.length,
    dataSha256: sha256(data)};
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length >= 72) {
    row.mint = P(data.subarray(0, 32)).toBase58();
    row.authority = P(data.subarray(32, 64)).toBase58();
    row.amountRaw = data.readBigUInt64LE(64).toString();
  }
  return row;
}

async function importInstructions(instructions) {
  const addresses = [...new Map(instructions.flatMap((ix) => [ix.programId,
    ...ix.keys.map((key) => key.pubkey)]).map((x) => [x.toBase58(), x])).values()];
  for (const address of addresses)
    await rpc(FORK, 'getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
}

async function buildCase(label, total, quotePair, builtPair, ctx) {
  const saveAmount = total / 3n;
  const p0Amount = total / 3n;
  const klendAmount = total - saveAmount - p0Amount;
  const fee = saveFee(saveAmount);
  const exitMinimum = BigInt(quotePair.exit.otherAmountThreshold);
  const seedRaw = (total + fee > exitMinimum ? total + fee - exitMinimum : 0n) + 10_000n;
  const save = savePair(ctx.saveTemplates, ctx.authority.publicKey, ctx.wsolAta, saveAmount);
  const klend = klendPair(ctx.klendTemplates, ctx.authority.publicKey, ctx.wsolAta, klendAmount);
  const p0 = p0Set(ctx.p0Templates, ctx.authority.publicKey, ctx.margin.publicKey,
    ctx.wsolAta, p0Amount);
  const first = jupiterSet(builtPair.first);
  const exit = jupiterSet(builtPair.exit);
  const instructions = [
    p0Initialize(ctx.p0Group, ctx.margin.publicKey, ctx.authority.publicKey),
    createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey, ctx.wsolAta,
      ctx.authority.publicKey, WSOL),
    createAssociatedTokenAccountIdempotentInstruction(ctx.authority.publicKey, ctx.usdtAta,
      ctx.authority.publicKey, USDT),
    SystemProgram.transfer({fromPubkey: ctx.authority.publicKey, toPubkey: ctx.wsolAta,
      lamports: seedRaw}),
    createSyncNativeInstruction(ctx.wsolAta),
    p0.start, save.borrow, klend.borrow, p0.borrow,
    ...first, ...exit,
    p0.repay, klend.repay, save.repay, p0.end,
  ];
  p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
  klend.repay.data[16] = instructions.indexOf(klend.borrow);
  save.repay.data[9] = instructions.indexOf(save.borrow);
  const compiled = new TransactionMessage({payerKey: ctx.authority.publicKey,
    recentBlockhash: '11111111111111111111111111111111', instructions}).compileToV0Message();
  const preflightEnvelope = {addresses: compiled.staticAccountKeys.length,
    instructions: compiled.compiledInstructions.length, maxAddresses: 64, maxBytes: 4096};
  if (preflightEnvelope.addresses > 64) return {label, completeRepayment: false,
    constructionBlocker: `v1 address limit: ${preflightEnvelope.addresses} > 64`, preflightEnvelope};
  await importInstructions(instructions);
  const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  let encoded;
  try { encoded = encodeV1(instructions, ctx.authority.publicKey, blockhash); }
  catch (error) { return {label, completeRepayment: false, constructionBlocker: error.message,
    preflightEnvelope}; }
  const signed = signV1(encoded, instructions, ctx.authority.publicKey,
    [ctx.authority, ctx.margin], blockhash);
  const routeWritable = [...new Map(instructions.flatMap((ix) => ix.keys.filter((key) => key.isWritable)
    .map((key) => [key.pubkey.toBase58(), key.pubkey]))).values()];
  const fixed = [ctx.authority.publicKey, ctx.margin.publicKey, ctx.wsolAta, ctx.usdtAta,
    PANCAKE_POOL, PANCAKE_WSOL, PANCAKE_USDT, ctx.saveReserve, ctx.saveSupply, ctx.saveFee,
    ctx.klendReserve, ctx.klendSupply, ctx.klendFee, P0_WSOL_BANK, P0_WSOL_VAULT];
  const watched = [...new Map([...fixed, ...routeWritable].map((x) => [x.toBase58(), x])).values()];
  const before = await rpc(FORK, 'getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  let simulation;
  try {
    simulation = await rpc(FORK, 'simulateTransaction', [signed.signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)},
    }]);
  } catch (error) {
    return {label, completeRepayment: false, transportError: error.message,
      rpcError: error.rpcError || null, envelope: {...preflightEnvelope, version: 1,
        bytes: encoded.sizeBytes, requiredSignatures: encoded.requiredSignatures,
        sigVerify: true, signedWireSha256: sha256(signed.signed)}};
  }
  const beforeImages = Object.fromEntries(watched.map((address, i) =>
    [address.toBase58(), accountImage(before.value[i])]));
  const afterImages = Object.fromEntries(watched.map((address, i) =>
    [address.toBase58(), accountImage(simulation.value.accounts?.[i])]));
  const deltas = {};
  const stateChanged = {};
  for (const address of watched.map(String)) {
    const pre = beforeImages[address]; const post = afterImages[address];
    deltas[address] = pre?.amountRaw != null && post?.amountRaw != null
      ? (BigInt(post.amountRaw) - BigInt(pre.amountRaw)).toString()
      : pre == null && post?.amountRaw != null ? post.amountRaw : null;
    stateChanged[address] = pre?.dataSha256 !== post?.dataSha256;
  }
  const roleAddresses = {outsiderWsol: ctx.wsolAta, outsiderUsdt: ctx.usdtAta,
    pancakePool: PANCAKE_POOL, pancakeWsolVault: PANCAKE_WSOL, pancakeUsdtVault: PANCAKE_USDT,
    saveReserve: ctx.saveReserve, saveSupply: ctx.saveSupply, saveFee: ctx.saveFee,
    klendReserve: ctx.klendReserve, klendSupply: ctx.klendSupply, klendFee: ctx.klendFee,
    project0Bank: P0_WSOL_BANK, project0Vault: P0_WSOL_VAULT};
  const roleDeltas = Object.fromEntries(Object.entries(roleAddresses)
    .map(([role, address]) => [role, deltas[address.toBase58()]]));
  const postWsol = afterImages[ctx.wsolAta.toBase58()]?.amountRaw || '0';
  const postUsdt = afterImages[ctx.usdtAta.toBase58()]?.amountRaw || '0';
  const completeRepayment = simulation.value.err === null && roleDeltas.saveSupply === '0' &&
    roleDeltas.klendSupply === '0' && roleDeltas.project0Vault === '0' &&
    roleDeltas.saveFee === fee.toString();
  return {label, providers: ['Save', 'KLend', 'Project0'], totalPrincipalRaw: total.toString(),
    allocationsRaw: {save: saveAmount.toString(), klend: klendAmount.toString(),
      project0: p0Amount.toString()}, feesRaw: {save: fee.toString(), klend: '0', project0: '0'},
    seedRaw: seedRaw.toString(), seedPurpose: 'explicit fork-only outsider equity for route spread, Save fee and 10,000 raw safety; excluded from profit',
    route: {pancakeInputRaw: total.toString(), pancakeQuotedOutputRaw: quotePair.first.outAmount,
      pancakeMinimumOutputRaw: quotePair.first.otherAmountThreshold,
      independentExitInputRaw: quotePair.exit.inAmount,
      independentExitQuotedOutputRaw: quotePair.exit.outAmount,
      independentExitMinimumOutputRaw: quotePair.exit.otherAmountThreshold,
      independentExitLabels: (quotePair.exit.routePlan || []).map((row) => row.swapInfo?.label)},
    envelope: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: signed.signerOrder, sigVerify: true, maxBytes: 4096, maxAddresses: 64,
      withinLimits: encoded.sizeBytes <= 4096 && encoded.addressCount <= 64,
      signedWireSha256: sha256(signed.signed)},
    slots: {before: before.context.slot, simulation: simulation.context.slot},
    err: simulation.value.err || null, unitsConsumed: simulation.value.unitsConsumed,
    loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
    roleDeltas, allTokenDeltasByAddress: deltas, stateChangedByAddress: stateChanged,
    walletEquity: {postWsolRaw: postWsol, postUsdtRaw: postUsdt,
      wsolAfterExcludingSeedRaw: (BigInt(postWsol) - seedRaw).toString()},
    expectedRepaymentRaw: (total + fee).toString(), completeRepayment,
    logs: simulation.value.logs || [], broadcast: false, signedWirePersisted: false};
}

async function main() {
  const output = {generatedAtUtc: new Date().toISOString(), network: 'current mainnet-beta-backed Surfpool fork',
    safety: {broadcast: false, sendTransactionPathPresent: false, sigVerify: true,
      freshOutsider: true, privateKeysPersisted: false, signedWirePersisted: false}, cases: []};
  try {
    const genesis = await rpc(FORK, 'getGenesisHash', []);
    if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      throw new Error(`fork genesis is not mainnet-beta: ${genesis}`);
    output.genesis = genesis;
    const authority = Keypair.generate(); const margin = Keypair.generate();
    await rpc(FORK, 'surfnet_setAccount', [authority.publicKey.toBase58(), {data: '', executable: false,
      lamports: 2_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
    const wsolAta = getAssociatedTokenAddressSync(WSOL, authority.publicKey);
    const usdtAta = getAssociatedTokenAddressSync(USDT, authority.publicKey);
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
    const klendTemplates = {borrow: historyIx(klendHistory.hits[0].transaction, 3),
      repay: historyIx(klendHistory.hits[0].transaction, 13)};
    const p0Group = p0Templates.borrow.keys[0].pubkey;
    const saveReserve = saveTemplates.borrow.keys[2].pubkey;
    const saveSupply = saveTemplates.borrow.keys[0].pubkey;
    const saveFeeAccount = saveTemplates.repay.keys[2].pubkey;
    const klendReserveAddress = P(klendReserve.reserve);
    const klendSupply = P(klendReserve.supplyVault);
    const klendFee = P(klendReserve.feeVault);
    const ctx = {authority, margin, wsolAta, usdtAta, saveTemplates, p0Templates, klendTemplates,
      p0Group, saveReserve, saveSupply, saveFee: saveFeeAccount,
      klendReserve: klendReserveAddress, klendSupply, klendFee};
    output.outsider = {authority: authority.publicKey.toBase58(), margin: margin.publicKey.toBase58(),
      wsolAta: wsolAta.toBase58(), usdtAta: usdtAta.toBase58(), syntheticLamports: '2000000000000'};
    output.providerSourceSlots = {save: saveSource.slot, project0: p0Source.slot,
      klend: klendHistory.hits[0].slot};
    const capacityRows = await rpc(FORK, 'getMultipleAccounts', [[saveReserve, saveSupply,
      klendReserveAddress, klendSupply, P0_WSOL_VAULT].map(String),
    {encoding: 'base64', commitment: 'processed'}]);
    const cap = capacityRows.value.map((row) => Buffer.from(row.data[0], 'base64'));
    output.capacitiesRaw = {saveAvailable: cap[0].readBigUInt64LE(171).toString(),
      saveSupply: cap[1].readBigUInt64LE(64).toString(),
      klendAvailable: cap[2].readBigUInt64LE(224).toString(),
      klendFlashFeeSf: cap[2].readBigUInt64LE(4904).toString(),
      klendSupply: cap[3].readBigUInt64LE(64).toString(),
      project0Vault: cap[4].readBigUInt64LE(64).toString()};

    const smallAmount = 10_000_000n;
    const smallFirst = await quote(WSOL, USDT, smallAmount, 'pancake');
    if (!exactPancake(smallFirst)) throw new Error(`fresh small Pancake quote unavailable: ${JSON.stringify({status: smallFirst.status, body: smallFirst.body})}`);
    const probes = [];
    let edgeFirst = null; let edgeAmount = null;
    for (const amount of [198_000_000_000n, 197_500_000_000n, 197_000_000_000n,
      195_000_000_000n, 190_000_000_000n, 175_000_000_000n]) {
      const result = await quote(WSOL, USDT, amount, 'pancake');
      probes.push({amountRaw: amount.toString(), status: result.status, accepted: exactPancake(result),
        error: result.body?.error || result.body?.errorCode || null, contextSlot: result.body?.contextSlot || null});
      if (exactPancake(result)) { edgeFirst = result; edgeAmount = amount; break; }
    }
    if (!edgeFirst) throw new Error(`fresh upper-edge Pancake quote unavailable after capped probes: ${JSON.stringify(probes)}`);
    output.boundaryProbes = probes;
    const inputs = [{label: 'small_control', amount: smallAmount, first: smallFirst.body},
      {label: 'near_executable_upper_edge', amount: edgeAmount, first: edgeFirst.body}];
    for (const item of inputs) {
      const exitResult = await quote(USDT, WSOL, BigInt(item.first.otherAmountThreshold), 'independent');
      if (exitResult.status !== 200 || !exitResult.body.outAmount ||
          (exitResult.body.routePlan || []).some((row) => row.swapInfo?.label === 'PancakeSwap' ||
            row.swapInfo?.ammKey === PANCAKE_POOL.toBase58())) {
        output.cases.push({label: item.label, completeRepayment: false,
          constructionBlocker: `fresh independent exit unavailable: ${JSON.stringify({status: exitResult.status, body: exitResult.body})}`});
        continue;
      }
      let firstBuilt; let exitBuilt;
      try {
        firstBuilt = await swapInstructions(item.first, authority.publicKey);
        exitBuilt = await swapInstructions(exitResult.body, authority.publicKey);
      } catch (error) {
        output.cases.push({label: item.label, completeRepayment: false,
          constructionBlocker: error.message});
        continue;
      }
      const row = await buildCase(item.label, item.amount,
        {first: item.first, exit: exitResult.body}, {first: firstBuilt, exit: exitBuilt}, ctx);
      output.cases.push(row);
      console.log(JSON.stringify({label: row.label, err: row.err || null,
        blocker: row.constructionBlocker || row.transportError || null,
        envelope: row.envelope || row.preflightEnvelope || null,
        completeRepayment: row.completeRepayment, roleDeltas: row.roleDeltas || null}));
    }
  } catch (error) {
    output.constructionBlocker = error.message;
    output.stack = error.stack;
  }
  output.conclusion = output.cases.length === 2 && output.cases.every((row) => row.completeRepayment)
    ? 'Both fresh signed three-source atomic round trips executed and repaid completely; inspect reconciled wallet/protocol deltas for economic outcome.'
    : 'No executed finding: one or more required fresh atomic packets could not be completed; exact blockers are preserved.';
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, {mode: 0o600});
  console.log(JSON.stringify({output: OUT, conclusion: output.conclusion,
    constructionBlocker: output.constructionBlocker || null,
    cases: output.cases.map((row) => ({label: row.label, completeRepayment: row.completeRepayment,
      err: row.err || null, blocker: row.constructionBlocker || row.transportError || null,
      envelope: row.envelope || row.preflightEnvelope || null}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
