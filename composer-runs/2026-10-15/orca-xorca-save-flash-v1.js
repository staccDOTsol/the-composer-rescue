#!/usr/bin/env node
'use strict';

// Signed, sigVerify:true Solana v1 local-fork validation of current Save/Solend
// ORCA flash reserves around exact limits and through the real xORCA/ORCA
// Whirlpool exit. Mainnet is queried read-only and no transaction is submitted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage} =
  require(modules + '@solana/web3.js');
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID} = require(modules + '@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const dir = __dirname;
const outputPath = path.join(dir, 'orca-xorca-save-flash-v1.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const census = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-save-census.json')));
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
const SAVE = P(census.program.address);
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const assets = BigInt(live.currentAccounts.nonEscrowedOrcaRaw);
const supply = BigInt(live.currentAccounts.xorcaMint.supplyRaw);
const virtual = 100n;
const reserves = census.found.ORCA.reserves.map((row) => ({...row,
  reserve: P(row.address), marketKey: P(row.market), supplyKey: P(row.supplyVault),
  feeKey: P(row.feeReceiver), authority: P(row.expectedMarketAuthority)}));
if (!reserves.length) throw new Error('No current Save ORCA reserve in census');
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
      const value = await rpcAt(endpoint, method, params);
      if (value !== null && value !== undefined) return value;
      errors.push('null result');
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`${method} unavailable: ${errors.join(' | ')}`);
}
const rpcFork = (method, params) => rpcAt(forkUrl, method, params);

function u64(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
}
function fromJupiter(ix) {
  return new TransactionInstruction({programId: P(ix.programId),
    keys: ix.accounts.map((account) => ({pubkey: P(account.pubkey),
      isSigner: account.isSigner, isWritable: account.isWritable})),
    data: Buffer.from(ix.data, 'base64')});
}
async function fetchJsonWithRetry(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, {...options,
      headers: {...(options.headers || {}), accept: 'application/json'}});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch (error) { body = {error: text.slice(0, 240) || error.message}; }
    if (response.status !== 429 && response.status < 500) return {response, body};
    last = new Error(`HTTP ${response.status}: ${body.error || 'retryable Jupiter response'}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw last;
}
const quoteCache = new Map();
async function jupiterXorcaExit(user, destinationTokenAccount, amount) {
  const cacheKey = BigInt(amount).toString();
  if (quoteCache.has(cacheKey)) return quoteCache.get(cacheKey);
  const url = new URL('https://lite-api.jup.ag/swap/v1/quote');
  url.searchParams.set('inputMint', XORCA.toString());
  url.searchParams.set('outputMint', ORCA.toString());
  url.searchParams.set('amount', cacheKey);
  url.searchParams.set('swapMode', 'ExactIn');
  url.searchParams.set('slippageBps', '100');
  url.searchParams.set('restrictIntermediateTokens', 'true');
  url.searchParams.set('onlyDirectRoutes', 'true');
  url.searchParams.set('maxAccounts', '32');
  const quoted = await fetchJsonWithRetry(url);
  if (!quoted.response.ok || !quoted.body.outAmount)
    throw new Error(`quote: ${JSON.stringify(quoted.body)}`);
  const quoteResponse = quoted.body;
  const built = await fetchJsonWithRetry('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({quoteResponse, userPublicKey: user.toString(),
      destinationTokenAccount: destinationTokenAccount.toString(),
      wrapAndUnwrapSol: false, useSharedAccounts: false,
      dynamicComputeUnitLimit: false, skipUserAccountsRpcCalls: true}),
  });
  if (!built.response.ok || built.body.error || !built.body.swapInstruction)
    throw new Error(`swap-instructions: ${JSON.stringify(built.body)}`);
  const result = {instructions: [...(built.body.setupInstructions || []).map(fromJupiter),
    fromJupiter(built.body.swapInstruction),
    ...(built.body.cleanupInstruction ? [fromJupiter(built.body.cleanupInstruction)] : [])],
    quote: {inAmount: quoteResponse.inAmount, outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct, contextSlot: quoteResponse.contextSlot,
      routePlan: quoteResponse.routePlan.map((step) => ({label: step.swapInfo?.label,
        ammKey: step.swapInfo?.ammKey, inAmount: step.swapInfo?.inAmount,
        outAmount: step.swapInfo?.outAmount}))},
    lookupTables: built.body.addressLookupTableAddresses || []};
  quoteCache.set(cacheKey, result);
  return result;
}

function saveBorrow(row, destination, amount) {
  return new TransactionInstruction({programId: SAVE, keys: [
    {pubkey: row.supplyKey, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: row.reserve, isSigner: false, isWritable: true},
    {pubkey: row.marketKey, isSigner: false, isWritable: false},
    {pubkey: row.authority, isSigner: false, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ], data: Buffer.concat([Buffer.from([19]), u64(amount)])});
}
function saveRepay(row, source, owner, amount, borrowInstructionIndex) {
  return new TransactionInstruction({programId: SAVE, keys: [
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: row.supplyKey, isSigner: false, isWritable: true},
    {pubkey: row.feeKey, isSigner: false, isWritable: true},
    // Maximally favorable public host receiver: the borrower's source account.
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: row.reserve, isSigner: false, isWritable: true},
    {pubkey: row.marketKey, isSigner: false, isWritable: false},
    {pubkey: owner, isSigner: true, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
  ], data: Buffer.concat([Buffer.from([20]), u64(amount),
    Buffer.from([borrowInstructionIndex])])});
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
const mintedFor = (amount) => BigInt(amount) * (supply + virtual) / (assets + virtual);

function signerFor(keypair) {
  return crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8'});
}
function signV1(encoded, instructions, payer, blockhash, keypairs) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const keyMap = new Map(keypairs.map((keypair) => [keypair.publicKey.toString(), keypair]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  signerOrder.forEach((address, index) => {
    const keypair = keyMap.get(address);
    if (!keypair) throw new Error(`uncontrolled signer ${address}`);
    crypto.sign(null, message, signerFor(keypair))
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + index * 64);
  });
  return {signed, signerOrder};
}
function dataBuffer(account) {
  return account?.data ? Buffer.from(account.data[0], 'base64') : null;
}
function tokenAmount(account) {
  const data = dataBuffer(account);
  return data && data.length >= 72 && account.owner === TOKEN_PROGRAM_ID.toString() ?
    data.readBigUInt64LE(64).toString() : null;
}
function accountHash(account) {
  const data = dataBuffer(account);
  return data ? crypto.createHash('sha256').update(data).digest('hex') : null;
}
function delta(after, before) {
  return after == null || before == null ? null : (BigInt(after) - BigInt(before)).toString();
}
function compactLogs(logs) {
  return (logs || []).filter((line) => /Instruction:|failed|Error|success|flash|BorrowTooSmall|Multiple/i.test(line));
}
function expectedFees(amount, feeWad, hostPercentage) {
  const scale = 1_000_000_000_000_000_000n;
  const rawNumerator = BigInt(amount) * BigInt(feeWad);
  // Save's Decimal::try_round_u64 uses half-up rounding, after a two-raw-unit
  // minimum whenever a nonzero host percentage is configured.
  const minimumScaled = BigInt(hostPercentage) > 0n ? 2n * scale : scale;
  const assessedScaled = rawNumerator > minimumScaled ? rawNumerator : minimumScaled;
  const total = (assessedScaled + scale / 2n) / scale;
  let host = 0n;
  if (BigInt(hostPercentage) > 0n) {
    host = (assessedScaled * BigInt(hostPercentage) + 50n * scale) / (100n * scale);
    if (host < 1n) host = 1n;
  }
  return {totalFeeRaw: total.toString(), hostFeeRaw: host.toString(),
    originationFeeRaw: (total - host).toString(), borrowTooSmall: total >= BigInt(amount)};
}
function classicTokenData(mint, owner, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  return data;
}
async function setForkAccount(address, owner, lamports, data) {
  await rpcFork('surfnet_setAccount', [address.toString(), {data: data.toString('hex'),
    executable: false, lamports, owner: owner.toString(), rentEpoch: 0}]);
}

async function simulateCase(name, instructions, attacker, orcaToken, xorcaToken,
  row, blockhash, metadata) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const {signed, signerOrder} = signV1(encoded, instructions, attacker.publicKey,
    blockhash, [attacker]);
  const watched = [attacker.publicKey, orcaToken, xorcaToken, STAKING_VAULT,
    STATE, XORCA, row.reserve, row.supplyKey, row.feeKey, row.marketKey];
  const pre = await rpcFork('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const simulation = await rpcFork('simulateTransaction', [signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const returnedPost = simulation.value.accounts || [];
  const beforeAmounts = pre.value.map(tokenAmount);
  const returnedAfterAmounts = watched.map((_, index) => tokenAmount(returnedPost[index]));
  const effectiveAfterAmounts = simulation.value.err ? beforeAmounts : returnedAfterAmounts;
  return {name, environment: 'signed local fork of current mainnet protocol/DEX accounts',
    liveSubmission: false, signatureVerification: true, forkProtocolMutation: false,
    syntheticMutation: 'fresh attacker system/token accounts only', metadata,
    err: simulation.value.err, unitsConsumed: simulation.value.unitsConsumed,
    loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
    wire: {version: 1, bytes: encoded.sizeBytes, addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      signerOrder, sha256: crypto.createHash('sha256').update(signed).digest('hex')},
    watched: watched.map(String), accounting: {beforeRaw: beforeAmounts,
      returnedAfterRaw: returnedAfterAmounts, effectiveAfterRollbackRaw: effectiveAfterAmounts,
      effectiveDeltasRaw: effectiveAfterAmounts.map((value, index) => delta(value, beforeAmounts[index])),
      attackerOrcaBeforeRaw: beforeAmounts[1], attackerOrcaAfterRaw: effectiveAfterAmounts[1],
      attackerOrcaDeltaAfterDebtRaw: delta(effectiveAfterAmounts[1], beforeAmounts[1]),
      attackerXorcaBeforeRaw: beforeAmounts[2], attackerXorcaAfterRaw: effectiveAfterAmounts[2],
      lenderSupplyDeltaRaw: delta(effectiveAfterAmounts[7], beforeAmounts[7]),
      feeReceiverDeltaRaw: delta(effectiveAfterAmounts[8], beforeAmounts[8]),
      reserveHashBefore: accountHash(pre.value[6]),
      reserveHashReturnedAfter: accountHash(returnedPost[6]),
      failedTransactionCountedAsAtomicRollback: Boolean(simulation.value.err)},
    logs: simulation.value.logs || [], trace: compactLogs(simulation.value.logs),
    innerInstructions: simulation.value.innerInstructions || null};
}

async function main() {
  const attacker = Keypair.generate();
  const orcaToken = getAssociatedTokenAddressSync(ORCA, attacker.publicKey);
  const xorcaToken = getAssociatedTokenAddressSync(XORCA, attacker.publicKey);
  // The seed is solely to let negative paths pay real fees and fully repay; its
  // pre/post delta, not its absolute balance, is the outsider-equity measure.
  const syntheticOrcaFeeAndLossSeedRaw = 1_000_000_000n;
  await setForkAccount(attacker.publicKey, SystemProgram.programId, 20_000_000_000, Buffer.alloc(0));
  await setForkAccount(orcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    classicTokenData(ORCA, attacker.publicKey, syntheticOrcaFeeAndLossSeedRaw));
  await setForkAccount(xorcaToken, TOKEN_PROGRAM_ID, 2_039_280,
    classicTokenData(XORCA, attacker.publicKey, 0n));

  for (const address of [PROGRAM, STATE, STAKING_VAULT, ORCA, XORCA, SAVE,
    ...reserves.flatMap((row) => [row.reserve, row.marketKey, row.authority,
      row.supplyKey, row.feeKey])]) {
    await rpcFork('getAccountInfo', [address.toString(),
      {encoding: 'base64', commitment: 'processed'}]);
  }
  const blockhash = (await rpcFork('getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  const results = [];
  const quoteBlockers = [];
  const sorted = [...reserves].sort((a, b) => BigInt(a.availableRaw) < BigInt(b.availableRaw) ? -1 : 1);
  const largest = sorted[sorted.length - 1];

  async function runPair(label, row, amount, extra = {}) {
    const ixs = [saveBorrow(row, orcaToken, amount),
      saveRepay(row, orcaToken, attacker.publicKey, amount, 0)];
    results.push(await simulateCase(label, ixs, attacker, orcaToken, xorcaToken,
      row, blockhash, {route: 'Save ORCA flash borrow -> exact indexed repay',
        reserve: row.address, displayedAvailableRaw: row.availableRaw,
        amountRaw: amount.toString(), expectedFees: expectedFees(amount,
          row.flashLoanFeeWad, row.hostFeePercentage), fullRepayRequested: true, ...extra}));
  }
  async function runRoute(label, row, amount, extra = {}) {
    try {
      const shares = mintedFor(amount);
      if (shares === 0n) throw new Error('stake output rounds to zero xORCA');
      const exit = await jupiterXorcaExit(attacker.publicKey, orcaToken, shares);
      const ixs = [saveBorrow(row, orcaToken, amount),
        stakeIx(attacker.publicKey, orcaToken, xorcaToken, amount),
        ...exit.instructions];
      ixs.push(saveRepay(row, orcaToken, attacker.publicKey, amount, 0));
      const fees = expectedFees(amount, row.flashLoanFeeWad, row.hostFeePercentage);
      results.push(await simulateCase(label, ixs, attacker, orcaToken, xorcaToken,
        row, blockhash, {route: 'Save ORCA flash -> xORCA Stake -> direct Whirlpool xORCA/ORCA exit -> exact indexed repay',
          reserve: row.address, displayedAvailableRaw: row.availableRaw,
          amountRaw: amount.toString(), mintedXorcaRaw: shares.toString(),
          quote: exit.quote, quotedOrcaOutRaw: exit.quote.outAmount,
          quotedDeltaBeforeLenderFeeRaw: (BigInt(exit.quote.outAmount) - amount).toString(),
          expectedFees: fees,
          quotedDeltaAfterOriginationFeeRaw: (BigInt(exit.quote.outAmount) - amount -
            BigInt(fees.originationFeeRaw)).toString(),
          fullUnwindAndRepayRequested: true, ...extra}));
    } catch (error) {
      quoteBlockers.push({label, reserve: row.address, amountRaw: amount.toString(),
        blocker: error.message, diagnostic: error.stack});
    }
  }

  // Exact fee-bearing dust boundary: 2 fails because the two-unit minimum fee
  // is not less than principal; 3 is the first structurally fee-payable amount.
  for (const amount of [2n, 3n, 4n])
    await runPair(`save_orca_flash_dust_${amount}`, largest, amount,
      {boundary: amount === 2n ? 'minimum_minus_1' : amount === 3n ? 'minimum' : 'minimum_plus_1'});

  // Each independent reserve gets exact displayed capacity +/- 1. These are
  // pair controls: displayed capacity remains only an upper bound until proven.
  for (const row of sorted) {
    const available = BigInt(row.availableRaw);
    for (const [suffix, amount] of [['minus_1', available - 1n],
      ['exact', available], ['plus_1', available + 1n]]) {
      if (amount <= 0n) continue;
      await runPair(`save_orca_${row.address.slice(0, 8)}_capacity_${suffix}`,
        row, amount, {boundary: `displayed_capacity_${suffix}`});
    }
  }

  // Full target composition at dust, each reserve's exact displayed capacity,
  // and the largest reserve immediately around its capacity.
  await runRoute('save_orca_flash_stake_exit_repay_dust_10', largest, 10n,
    {boundary: 'route_dust'});
  for (const row of sorted) {
    await runRoute(`save_orca_${row.address.slice(0, 8)}_stake_exit_repay_exact`,
      row, BigInt(row.availableRaw), {boundary: 'displayed_capacity_exact'});
  }
  await runRoute('save_orca_largest_stake_exit_repay_capacity_minus_1',
    largest, BigInt(largest.availableRaw) - 1n, {boundary: 'displayed_capacity_minus_1'});
  await runRoute('save_orca_largest_stake_exit_repay_capacity_plus_1',
    largest, BigInt(largest.availableRaw) + 1n, {boundary: 'displayed_capacity_plus_1'});

  // Save rejects more than one flash borrow anywhere later in the transaction,
  // so even separate ORCA reserves cannot form a same-program multi-source leg.
  if (sorted.length >= 2) {
    const first = sorted[sorted.length - 1];
    const second = sorted[sorted.length - 2];
    const amountA = 10n;
    const amountB = 10n;
    const ixs = [saveBorrow(first, orcaToken, amountA),
      saveBorrow(second, orcaToken, amountB),
      saveRepay(second, orcaToken, attacker.publicKey, amountB, 1),
      saveRepay(first, orcaToken, attacker.publicKey, amountA, 0)];
    results.push(await simulateCase('save_orca_two_reserve_repeat_borrow_rejected', ixs,
      attacker, orcaToken, xorcaToken, first, blockhash, {
        route: 'two independent Save ORCA reserves in one transaction',
        secondReserve: second.address, amountsRaw: [amountA.toString(), amountB.toString()],
        expectedBlocker: 'MultipleFlashBorrows', fullRepayRequested: true}));
  }

  const successful = results.filter((row) => !row.err);
  const fullRoutes = results.filter((row) => row.metadata.route.includes('xORCA Stake'));
  const output = {generatedAt: new Date().toISOString(), readOnly: true,
    liveSubmission: false, sigVerify: true, protocolAccountsMutated: false,
    targetProgram: PROGRAM.toString(), saveProgram: SAVE.toString(),
    attacker: attacker.publicKey.toString(), attackerAccounts: {
      orca: orcaToken.toString(), xorca: xorcaToken.toString()}, secretKeysStored: false,
    rpcUrlsStored: false, censusGeneratedAt: census.generatedAt,
    censusSlot: census.fullReserveCensus.contextSlot,
    syntheticOrcaFeeAndLossSeedRaw: syntheticOrcaFeeAndLossSeedRaw.toString(),
    syntheticSeedTreatment: 'Excluded as proceeds; only pre/post attacker ORCA delta after exact repayment is evaluated.',
    reserves: sorted.map((row) => ({address: row.address, market: row.market,
      displayedAvailableRaw: row.availableRaw, vaultRaw: row.vault.rawAmount,
      flashLoanFeeWad: row.flashLoanFeeWad, hostFeePercentage: row.hostFeePercentage})),
    results, quoteBlockers,
    summary: {simulatedCases: results.length, quoteBlockerCount: quoteBlockers.length,
      successfulCases: successful.length,
      successfulFullTargetRoutes: fullRoutes.filter((row) => !row.err).length,
      positiveOutsiderEquityCases: successful.filter((row) =>
        BigInt(row.accounting.attackerOrcaDeltaAfterDebtRaw || 0) > 0n ||
        BigInt(row.accounting.attackerXorcaAfterRaw || 0) > 0n).map((row) => row.name),
      successfulFullRoutesNotFullyUnwound: fullRoutes.filter((row) => !row.err &&
        (row.accounting.attackerXorcaAfterRaw !== '0' ||
          row.accounting.lenderSupplyDeltaRaw !== '0')).map((row) => row.name),
      maxWireBytes: Math.max(0, ...results.map((row) => row.wire.bytes)),
      maxAddressCount: Math.max(0, ...results.map((row) => row.wire.addressCount)),
      allWithinV1Limits: results.every((row) => row.wire.bytes <= 4096 &&
        row.wire.addressCount <= 64)},
    interpretation: 'Displayed Save liquidity was not equated with usable capacity. Every successful full route measures outsider ORCA after lender principal and fees, and requires zero attacker xORCA plus zero lender-supply principal delta.'};
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, summary: output.summary,
    quoteBlockers: output.quoteBlockers,
    results: results.map((row) => ({name: row.name, err: row.err,
      bytes: row.wire.bytes, addresses: row.wire.addressCount,
      attackerOrcaDeltaAfterDebtRaw: row.accounting.attackerOrcaDeltaAfterDebtRaw,
      attackerXorcaAfterRaw: row.accounting.attackerXorcaAfterRaw,
      lenderSupplyDeltaRaw: row.accounting.lenderSupplyDeltaRaw,
      feeReceiverDeltaRaw: row.accounting.feeReceiverDeltaRaw,
      trace: row.trace.slice(-8)}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
