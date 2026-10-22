#!/usr/bin/env node
'use strict';

// Fresh signed mainnet-beta SolFi V2 control. The transaction is submitted only
// to simulateTransaction with sigVerify:true. There is no send/broadcast path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require(MOD + '/@solana/web3.js');
const {getAssociatedTokenAddressSync} = require(MOD + '/@solana/spl-token');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROGRAM = 'SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF';
const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_VAULT = 'ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc';
const USDT_VAULT = '5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc';
const INPUT_RAW = 5_000n;
const OUT = path.join(__dirname, 'solfi-v2-signed-control.json');
let rpcId = 0;

function loadRpc() {
  const values = {};
  for (const raw of fs.readFileSync('/private/tmp/codex-mainnet-rpc-2026-10-19.env', 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const endpoint = values.RPC || values.SOLANA_RPC || values.SOLANA_RPC_URL || values.RPC_URL ||
    values.HEAVY_RPC_URL || values.HELIUS_RPC_URL;
  if (!endpoint) throw new Error('RPC variable unavailable');
  return endpoint;
}

const RPC = loadRpc();
const signer = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));

async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${body.error?.message || response.status}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw last;
}

async function requestJson(url, options = {}, acceptable = [200]) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(120_000)});
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {rawPrefix: text.slice(0, 200)}; }
  if (!acceptable.includes(response.status)) {
    const error = new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return {status: response.status, body};
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function delta(after, before) {
  return after == null || before == null ? null : (BigInt(after) - BigInt(before)).toString();
}

function invocationParents(logs, target) {
  const stack = [];
  const found = [];
  for (const line of logs || []) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]);
      stack.length = depth - 1;
      const parent = depth > 1 ? stack[depth - 2] || null : null;
      stack[depth - 1] = invoke[1];
      if (invoke[1] === target) found.push({depth, immediateParent: parent});
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

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  const usdcAta = getAssociatedTokenAddressSync(new PublicKey(USDC), signer.publicKey);
  const usdtAta = getAssociatedTokenAddressSync(new PublicKey(USDT), signer.publicKey);
  const tracked = [usdcAta.toBase58(), usdtAta.toBase58(), USDC_VAULT, USDT_VAULT];
  const preResponse = await rpc('getMultipleAccounts', [tracked, {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const pre = preResponse.value.map(tokenAmount);
  if (BigInt(pre[0] || 0) < INPUT_RAW) throw new Error('test signer lacks bounded USDC input');

  const composer = {queriedFirst: true};
  try {
    const idl = await requestJson(`https://the-composer-svc.fly.dev/idl/${PROGRAM}`);
    composer.idl = {status: idl.status, instructionCount: idl.body?.instructions?.length ?? null,
      body: idl.body};
  } catch (error) {
    composer.idl = {status: error.status || null, error: error.message, body: error.body || null};
  }
  try {
    const learned = await requestJson(`https://the-composer-svc.fly.dev/learn/${PROGRAM}?limit=250`);
    composer.learn = {status: learned.status, body: learned.body};
  } catch (error) {
    composer.learn = {status: error.status || null, error: error.message, body: error.body || null};
  }

  const quoteParams = new URLSearchParams({
    inputMint: USDC,
    outputMint: USDT,
    amount: INPUT_RAW.toString(),
    slippageBps: '50',
    onlyDirectRoutes: 'true',
    dexes: 'SolFi V2',
  });
  const quote = (await requestJson(`https://lite-api.jup.ag/swap/v1/quote?${quoteParams}`)).body;
  const route = (quote.routePlan || []).map(row => ({
    label: row.swapInfo?.label || null,
    ammKey: row.swapInfo?.ammKey || null,
    inAmount: row.swapInfo?.inAmount || null,
    outAmount: row.swapInfo?.outAmount || null,
  }));
  if (route.length !== 1 || route[0].ammKey !== POOL || route[0].label !== 'SolFi V2') {
    throw new Error(`quote did not resolve to exact SolFi pool: ${JSON.stringify(route)}`);
  }
  const built = (await requestJson('https://lite-api.jup.ag/swap/v1/swap', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({quoteResponse: quote, userPublicKey: signer.publicKey.toBase58(),
      wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 0}),
  })).body;
  const transaction = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, 'base64'));
  if (transaction.message.header.numRequiredSignatures !== 1 ||
      !transaction.message.staticAccountKeys[0].equals(signer.publicKey)) {
    throw new Error('built transaction requests an uncontrolled signer');
  }
  const lookups = [];
  for (const lookup of transaction.message.addressTableLookups || []) {
    const row = await rpc('getAccountInfo', [lookup.accountKey.toBase58(), {
      encoding: 'base64', commitment: 'confirmed',
    }]);
    if (!row.value) throw new Error('missing lookup table');
    lookups.push(new AddressLookupTableAccount({key: lookup.accountKey,
      state: AddressLookupTableAccount.deserialize(Buffer.from(row.value.data[0], 'base64'))}));
  }
  const keyCount = transaction.message.staticAccountKeys.length +
    (transaction.message.addressTableLookups || []).reduce((sum, table) =>
      sum + table.writableIndexes.length + table.readonlyIndexes.length, 0);
  transaction.sign([signer]);
  const wire = Buffer.from(transaction.serialize());
  const decompiled = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts: lookups,
  });
  const baselineMessage = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: transaction.message.recentBlockhash,
    instructions: decompiled.instructions.filter(ix =>
      ix.programId.toBase58() === 'ComputeBudget111111111111111111111111111111'),
  }).compileToV0Message();
  const baselineTransaction = new VersionedTransaction(baselineMessage);
  baselineTransaction.sign([signer]);
  const baselineWire = Buffer.from(baselineTransaction.serialize());
  const fee = await rpc('getFeeForMessage', [
    Buffer.from(transaction.message.serialize()).toString('base64'), {commitment: 'confirmed'},
  ]);
  const simulationOptions = addresses => ({
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses},
  });
  const baselineWallet = await rpc('simulateTransaction', [baselineWire.toString('base64'),
    simulationOptions(tracked.slice(0, 2))]);
  const simulationWallet = await rpc('simulateTransaction', [wire.toString('base64'),
    simulationOptions(tracked.slice(0, 2))]);
  const baselinePool = await rpc('simulateTransaction', [baselineWire.toString('base64'),
    simulationOptions(tracked.slice(2))]);
  const simulationPool = await rpc('simulateTransaction', [wire.toString('base64'),
    simulationOptions(tracked.slice(2))]);
  const baseline = [...(baselineWallet.value.accounts || []),
    ...(baselinePool.value.accounts || [])].map(tokenAmount);
  const post = [...(simulationWallet.value.accounts || []),
    ...(simulationPool.value.accounts || [])].map(tokenAmount);
  const simulation = simulationWallet;
  const accountKeys = transaction.message.getAccountKeys({addressLookupTableAccounts: lookups});
  const topLevelPrograms = [...new Set(transaction.message.compiledInstructions.map(ix =>
    accountKeys.get(ix.programIdIndex).toBase58()))];
  const result = {
    generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta', genesisVerified: true,
    scope: {program: PROGRAM, pool: POOL, inputRaw: INPUT_RAW.toString()},
    signer: {publicKey: signer.publicKey.toBase58(), privateBytesRetained: false},
    composer,
    quote: {contextSlot: quote.contextSlot, inAmount: quote.inAmount,
      outAmount: quote.outAmount, otherAmountThreshold: quote.otherAmountThreshold,
      priceImpactPct: quote.priceImpactPct, route},
    envelope: {wireVersion: 0, wireBytes: wire.length, accountKeys: keyCount,
      requiredSignatures: transaction.message.header.numRequiredSignatures,
      wireSha256: crypto.createHash('sha256').update(wire).digest('hex'), topLevelPrograms},
    simulation: {slot: simulation.context.slot, err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed, feeLamports: fee.value,
      sigVerify: true, replaceRecentBlockhash: false,
      accountReadSlots: {baselineWallet: baselineWallet.context.slot,
        targetWallet: simulationWallet.context.slot, baselinePool: baselinePool.context.slot,
        targetPool: simulationPool.context.slot},
      sameBankBaseline: new Set([baselineWallet.context.slot, simulationWallet.context.slot,
        baselinePool.context.slot, simulationPool.context.slot]).size === 1,
      solfiInvocations: invocationParents(simulation.value.logs, PROGRAM),
      logs: simulation.value.logs || []},
    balances: {
      addresses: {walletUsdc: tracked[0], walletUsdt: tracked[1], poolUsdc: tracked[2], poolUsdt: tracked[3]},
      preRaw: {walletUsdc: pre[0], walletUsdt: pre[1], poolUsdc: pre[2], poolUsdt: pre[3]},
      sameBankBaselineRaw: {walletUsdc: baseline[0], walletUsdt: baseline[1],
        poolUsdc: baseline[2], poolUsdt: baseline[3]},
      postRaw: {walletUsdc: post[0], walletUsdt: post[1], poolUsdc: post[2], poolUsdt: post[3]},
      deltaRaw: {walletUsdc: delta(post[0], baseline[0]), walletUsdt: delta(post[1], baseline[1]),
        poolUsdc: delta(post[2], baseline[2]), poolUsdt: delta(post[3], baseline[3])},
    },
    safety: {sendTransactionCalled: false, broadcast: false},
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({evidence: OUT, generatedAtUtc: result.generatedAtUtc,
    quote: result.quote, envelope: result.envelope,
    simulation: {slot: result.simulation.slot, err: result.simulation.err,
      unitsConsumed: result.simulation.unitsConsumed, feeLamports: result.simulation.feeLamports,
      solfiInvocations: result.simulation.solfiInvocations}, balances: result.balances,
    composer: {idlStatus: composer.idl.status, learnStatus: composer.learn.status},
    safety: result.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
