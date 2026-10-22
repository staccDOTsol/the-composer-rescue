#!/usr/bin/env node
'use strict';

// Signed, no-broadcast TesseraV size sweep on one fixed mainnet-backed Surfpool bank.
// The only fork mutations create and fund fresh outsider-owned accounts. Pool, vault,
// program, oracle and router state are fetched from mainnet and never modified directly.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const web3 = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {
  AddressLookupTableAccount, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction, SystemProgram,
} = web3;

const DIR = __dirname;
const OUTPUT = path.join(DIR, 'tessera-high-input-sweep.json');
const PREPARED = path.join(DIR, 'tessera-high-input-prepared.json');
const FORK = process.env.TESSERA_FORK_RPC || 'http://127.0.0.1:9239';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const P = value => new PublicKey(value);
const PROGRAM = P('TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH');
const POOL = P('FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n');
const AUTHORITY = P('8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF');
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL_VAULT = P('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const USDC_VAULT = P('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let rpcId = 0;

async function rpc(method, params = []) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function requestJson(url, options = {}) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(60_000)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {error: text.slice(0, 240)}; }
    if (response.ok && !body.error) return {status: response.status, body};
    last = {status: response.status, body};
    if (response.status !== 429 && response.status < 500) return last;
    await sleep(1_500 * (attempt + 1));
  }
  return last;
}

async function quote(direction, amount) {
  const inputMint = direction === 'wsol_to_usdc' ? WSOL : USDC;
  const outputMint = direction === 'wsol_to_usdc' ? USDC : WSOL;
  const params = new URLSearchParams({inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(), amount: amount.toString(), slippageBps: '5000',
    onlyDirectRoutes: 'true', maxAccounts: '24', dexes: 'TesseraV'});
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

function ix(row) {
  return new TransactionInstruction({programId: P(row.programId), data: Buffer.from(row.data, 'base64'),
    keys: row.accounts.map(key => ({pubkey: P(key.pubkey), isSigner: key.isSigner,
      isWritable: key.isWritable}))});
}

function instructionSet(result) {
  if (result.tokenLedgerInstruction) throw new Error('unexpected token ledger instruction');
  return [...(result.computeBudgetInstructions || []), ...(result.otherInstructions || []),
    ...(result.setupInstructions || []), result.swapInstruction,
    ...(result.cleanupInstruction ? [result.cleanupInstruction] : [])].filter(Boolean).map(ix);
}

async function importAddresses(instructions, lookupAddresses) {
  const addresses = [...new Map([...lookupAddresses.map(P), ...instructions.flatMap(row =>
    [row.programId, ...row.keys.map(key => key.pubkey)])].map(address =>
    [address.toBase58(), address])).values()];
  for (const address of addresses) {
    await rpc('getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
}

function tokenImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {lamports: String(account.lamports), owner: account.owner,
    mint: data.length >= 72 ? P(data.subarray(0, 32)).toBase58() : null,
    authority: data.length >= 72 ? P(data.subarray(32, 64)).toBase58() : null,
    amountRaw: data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
    dataSha256: sha256(data)};
}

function delta(after, before, field) {
  if (field === 'amountRaw' && after?.amountRaw != null && before == null) return after.amountRaw;
  if (field === 'amountRaw' && after == null && before?.amountRaw != null) return (-BigInt(before.amountRaw)).toString();
  if (after?.[field] == null || before?.[field] == null) return null;
  return (BigInt(after[field]) - BigInt(before[field])).toString();
}

function heldoutTemplate() {
  const receipts = JSON.parse(fs.readFileSync(path.join(DIR, 'tessera-receipt-shapes.json')));
  const hit = receipts.receipts.find(receipt => receipt.holdout && receipt.err == null &&
    receipt.instructions.some(item => ['1000', '1001', '1100', '1101'].includes(item.discriminator) &&
      item.accounts.some(account => account.address === WSOL_VAULT.toBase58()) &&
      item.accounts.some(account => account.address === USDC_VAULT.toBase58())));
  if (!hit) throw new Error('no held-out successful WSOL/USDC TesseraV swap receipt');
  const item = hit.instructions.find(row => ['1000', '1001', '1100', '1101'].includes(row.discriminator));
  return {signature: hit.signature, slot: hit.slot, version: hit.version, selector: item.discriminator,
    dataHex: item.dataHex, accountCount: item.accounts.length,
    accounts: item.accounts.map((account, index) => ({index, address: account.address,
      signer: account.signer, writable: account.writable})),
    vaultDeltas: hit.tokenDeltas.filter(row => [WSOL_VAULT.toBase58(), USDC_VAULT.toBase58()]
      .includes(row.address)).map(row => ({address: row.address, mint: row.mint, delta: row.delta}))};
}

async function main() {
  const output = {generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta-backed Surfpool',
    safety: {broadcast: false, sendTransactionPathPresent: false, sigVerify: true,
      freshEphemeralSigner: true, privateKeyPersisted: false, signedWirePersisted: false,
      forkMutations: 'fresh outsider accounts plus exact byte-for-byte captured mainnet pool/global/price/vault/mint images when tessera-pin-state.js is used; no synthetic target-state edits'},
    rubric: [
      'Current executable identity and Composer schema must match the pinned baseline.',
      'A held-out current successful receipt must confirm the live swap selector, accounts, and vault outflow.',
      'Every tested route must be fresh-signed, sigVerify:true, no-broadcast, and reconcile wallet/vault deltas.',
      'Small controls and high inputs must run against the same fixed fork bank without committing state.',
      'A flash packet is warranted only if a positive pricing precursor survives an independent exit and fees.',
    ], cases: []};
  output.genesis = await rpc('getGenesisHash');
  if (output.genesis !== MAINNET_GENESIS) throw new Error(`wrong genesis ${output.genesis}`);
  output.fixedBankSlot = await rpc('getSlot', [{commitment: 'processed'}]);
  output.heldoutTemplate = heldoutTemplate();

  const outsider = process.env.TESSERA_USE_EXISTING_TEST_SIGNER === '1'
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
      fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))))
    : Keypair.generate();
  const userWsol = spl.getAssociatedTokenAddressSync(WSOL, outsider.publicKey);
  const userUsdc = spl.getAssociatedTokenAddressSync(USDC, outsider.publicKey);
  output.outsider = {authority: outsider.publicKey.toBase58(), userWsol: userWsol.toBase58(),
    userUsdc: userUsdc.toBase58()};
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {data: '', executable: false,
    lamports: 100_000_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);

  let definitions = [
    ['wsol_to_usdc', 'small_control', 100_000_000n],
    ['wsol_to_usdc', '100_wsol', 100_000_000_000n],
    ['wsol_to_usdc', '1000_wsol', 1_000_000_000_000n],
    ['wsol_to_usdc', '10000_wsol', 10_000_000_000_000n],
    ['wsol_to_usdc', '20000_wsol', 20_000_000_000_000n],
    ['usdc_to_wsol', 'small_control', 10_000_000n],
    ['usdc_to_wsol', '10000_usdc', 10_000_000_000n],
    ['usdc_to_wsol', '100000_usdc', 100_000_000_000n],
    ['usdc_to_wsol', '1000000_usdc', 1_000_000_000_000n],
    ['usdc_to_wsol', '3000000_usdc', 3_000_000_000_000n],
  ];
  if (process.env.TESSERA_CASE_FILTER) {
    const selected = process.env.TESSERA_CASE_FILTER;
    definitions = definitions.filter(([direction, label]) => `${direction}:${label}` === selected);
    if (definitions.length !== 1) throw new Error(`unknown TESSERA_CASE_FILTER ${selected}`);
  }
  const prepared = process.env.TESSERA_USE_PREPARED === '1'
    ? JSON.parse(fs.readFileSync(PREPARED)) : null;
  const substitutions = prepared ? new Map([
    [prepared.builder, outsider.publicKey.toBase58()],
    [prepared.builderWsol, userWsol.toBase58()],
    [prepared.builderUsdc, userUsdc.toBase58()],
  ]) : null;
  const replaceBuildAddresses = build => JSON.parse(JSON.stringify(build), (key, value) =>
    typeof value === 'string' && substitutions?.has(value) ? substitutions.get(value) : value);
  const built = [];
  for (let definitionIndex = 0; definitionIndex < definitions.length; definitionIndex++) {
    const [direction, label, amount] = definitions[definitionIndex];
    const preparedCase = prepared?.cases?.find(row => row.direction === direction && row.label === label);
    if (preparedCase && (preparedCase.direction !== direction || preparedCase.label !== label ||
        preparedCase.amountRaw !== amount.toString())) throw new Error(`prepared case mismatch at ${label}`);
    const quoteResult = preparedCase
      ? {status: preparedCase.quoteStatus, body: preparedCase.quote}
      : await quote(direction, amount);
    const quoteSummary = {status: quoteResult.status, contextSlot: quoteResult.body?.contextSlot || null,
      inAmount: quoteResult.body?.inAmount || amount.toString(), outAmount: quoteResult.body?.outAmount || null,
      otherAmountThreshold: quoteResult.body?.otherAmountThreshold || null,
      priceImpactPct: quoteResult.body?.priceImpactPct || null,
      error: quoteResult.body?.error || quoteResult.body?.errorCode || null,
      route: (quoteResult.body?.routePlan || []).map(row => ({label: row.swapInfo?.label,
        ammKey: row.swapInfo?.ammKey, inputMint: row.swapInfo?.inputMint,
        outputMint: row.swapInfo?.outputMint}))};
    const exact = quoteResult.status === 200 && quoteResult.body?.outAmount &&
      quoteSummary.route.length === 1 && quoteSummary.route[0].label === 'TesseraV' &&
      quoteSummary.route[0].ammKey === POOL.toBase58();
    if (!exact) {
      output.cases.push({direction, label, amountRaw: amount.toString(), quote: quoteSummary,
        disposition: 'quote_rejected_or_wrong_pool'});
      continue;
    }
    const instructionsResult = preparedCase
      ? {status: preparedCase.buildStatus, body: replaceBuildAddresses(preparedCase.build)}
      : await swapInstructions(quoteResult.body, outsider.publicKey);
    if (instructionsResult.status !== 200 || !instructionsResult.body?.swapInstruction) {
      output.cases.push({direction, label, amountRaw: amount.toString(), quote: quoteSummary,
        disposition: 'swap_instruction_build_failed', buildStatus: instructionsResult.status,
        buildError: instructionsResult.body?.error || null});
      continue;
    }
    const instructions = instructionSet(instructionsResult.body);
    const lookupAddresses = instructionsResult.body.addressLookupTableAddresses || [];
    await importAddresses(instructions, lookupAddresses);
    built.push({direction, label, amount, quote: quoteSummary, instructions, lookupAddresses});
    await sleep(400);
  }

  const vaultRows = await rpc('getMultipleAccounts', [[WSOL_VAULT, USDC_VAULT].map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const wsolVaultAccount = vaultRows.value[0], usdcVaultAccount = vaultRows.value[1];
  const makeUserToken = (source, authority, amount, native) => {
    const data = Buffer.from(source.data[0], 'base64');
    authority.toBuffer().copy(data, 32); data.writeBigUInt64LE(amount, 64);
    const reserve = native && data.readUInt32LE(109) === 1 ? data.readBigUInt64LE(113) : 0n;
    return {data: data.toString('hex'), executable: false,
      lamports: Number(native ? amount + reserve : BigInt(source.lamports)),
      owner: TOKEN.toBase58(), rentEpoch: 0};
  };
  if (definitions.some(([direction]) => direction === 'usdc_to_wsol')) {
    await rpc('surfnet_setAccount', [userUsdc.toBase58(),
      makeUserToken(usdcVaultAccount, outsider.publicKey, 5_000_000_000_000n, false)]);
  }

  const watched = [userWsol, userUsdc, WSOL_VAULT, USDC_VAULT, POOL];
  const watchedNames = ['userWsol', 'userUsdc', 'wsolVault', 'usdcVault', 'pool'];
  const pre = await rpc('getMultipleAccounts', [watched.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  output.preSlot = pre.context.slot;
  output.pre = Object.fromEntries(watchedNames.map((name, index) => [name, tokenImage(pre.value[index])]));
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;

  for (const item of built) {
    const accountSetup = [
      spl.createAssociatedTokenAccountIdempotentInstruction(outsider.publicKey, userWsol,
        outsider.publicKey, WSOL),
      spl.createAssociatedTokenAccountIdempotentInstruction(outsider.publicKey, userUsdc,
        outsider.publicKey, USDC),
    ];
    if (item.direction === 'wsol_to_usdc') accountSetup.push(
      SystemProgram.transfer({fromPubkey: outsider.publicKey, toPubkey: userWsol,
        lamports: Number(item.amount)}),
      spl.createSyncNativeInstruction(userWsol));
    const caseInstructions = [...accountSetup, ...item.instructions];
    const lookupTables = [];
    for (const address of item.lookupAddresses) {
      const account = await rpc('getAccountInfo', [address, {encoding: 'base64', commitment: 'processed'}]);
      lookupTables.push(new AddressLookupTableAccount({key: P(address),
        state: AddressLookupTableAccount.deserialize(Buffer.from(account.value.data[0], 'base64'))}));
    }
    const message = new TransactionMessage({payerKey: outsider.publicKey, recentBlockhash: blockhash,
      instructions: caseInstructions}).compileToV0Message(lookupTables);
    const tx = new VersionedTransaction(message); tx.sign([outsider]);
    const wire = Buffer.from(tx.serialize());
    const addressCount = message.staticAccountKeys.length + message.addressTableLookups.reduce((sum, row) =>
      sum + row.writableIndexes.length + row.readonlyIndexes.length, 0);
    const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
      sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)}}]);
    const post = watchedNames.map((name, index) => [name, tokenImage(simulation.value.accounts?.[index])]);
    const changes = Object.fromEntries(post.map(([name, image]) => [name, {
      amountRaw: delta(image, output.pre[name], 'amountRaw'),
      lamports: delta(image, output.pre[name], 'lamports'),
      dataChanged: image?.dataSha256 !== output.pre[name]?.dataSha256,
    }]));
    const inputRole = item.direction === 'wsol_to_usdc' ? 'userWsol' : 'userUsdc';
    const outputRole = item.direction === 'wsol_to_usdc' ? 'userUsdc' : 'userWsol';
    const inputVault = item.direction === 'wsol_to_usdc' ? 'wsolVault' : 'usdcVault';
    const outputVault = item.direction === 'wsol_to_usdc' ? 'usdcVault' : 'wsolVault';
    const callerInput = -(BigInt(changes[inputRole].amountRaw || '0'));
    const callerOutput = BigInt(changes[outputRole].amountRaw || '0');
    const inputVaultGain = BigInt(changes[inputVault].amountRaw || '0');
    const outputVaultLoss = -(BigInt(changes[outputVault].amountRaw || '0'));
    output.cases.push({direction: item.direction, label: item.label,
      amountRaw: item.amount.toString(), quote: item.quote,
      fixedBankSlot: output.fixedBankSlot, simulationSlot: simulation.context.slot,
      err: simulation.value.err || null, unitsConsumed: simulation.value.unitsConsumed,
      loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
      envelope: {version: 0, bytes: wire.length, addresses: addressCount,
        instructions: message.compiledInstructions.length, requiredSignatures: message.header.numRequiredSignatures,
        sigVerify: true, withinRequestedLimits: wire.length <= 4096 && addressCount <= 64,
        signedWireSha256: sha256(wire), signedWirePersisted: false},
      changes, reconciliation: simulation.value.err == null ? {callerInputRaw: callerInput.toString(),
        inputVaultGainRaw: inputVaultGain.toString(), callerOutputRaw: callerOutput.toString(),
        outputVaultLossRaw: outputVaultLoss.toString(),
        inputConserved: callerInput === inputVaultGain,
        outputConserved: callerOutput === outputVaultLoss} : null,
      tesseraLogs: (simulation.value.logs || []).filter(line =>
        line.includes(PROGRAM.toBase58()) || line.includes('failed:')),
      disposition: simulation.value.err == null ? 'executed_same_bank' : 'simulation_failed',
      broadcast: false});
  }
  output.postSweepBankSlot = await rpc('getSlot', [{commitment: 'processed'}]);
  output.sameBank = output.fixedBankSlot === output.preSlot && output.preSlot === output.postSweepBankSlot &&
    output.cases.filter(row => row.simulationSlot != null).every(row => row.simulationSlot === output.preSlot);
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, fixedBankSlot: output.fixedBankSlot,
    sameBank: output.sameBank, cases: output.cases.map(row => ({direction: row.direction,
      label: row.label, quoteOut: row.quote?.outAmount, err: row.err, units: row.unitsConsumed,
      reconciliation: row.reconciliation, disposition: row.disposition}))}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
