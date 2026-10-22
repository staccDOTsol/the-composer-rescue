#!/usr/bin/env node
'use strict';

// Signed, simulation-only current-state fork probes for the exact SolFi V2
// USDC/USDT pool. Only fresh outsider accounts are synthesized on the private
// nested fork; deployed programs, pool state, and vaults are imported read-only.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage,
} = require(MOD + '/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createTransferInstruction,
} = require(MOD + '/@solana/spl-token');
const {encodeV1} = require('../2026-10-15/klend-v1-composition.js');

const FORK = process.env.SOLFI_FORK_RPC || 'http://127.0.0.1:9139';
const PROGRAM = 'SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF';
const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
const USDC_VAULT = new PublicKey('ARWaajRJyF6PKQryJ4HLzLBfTWM2qmVQUQVtBjk6PgPc');
const USDT_VAULT = new PublicKey('5bHD9xdEzJdkVuhs54mGPC9BZgUshqgMg4tqmTwhWggc');
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SWAP_RAW = 100_000_000n;
const DONATION_RAW = 100_000_000n;
const OUT = path.join(__dirname, 'solfi-v2-donation-fork.json');
let rpcId = 0;

async function rpc(method, params = []) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function json(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(90_000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${new URL(url).pathname}: ${response.status}`);
  return body;
}

function fromJupiter(row) {
  return new TransactionInstruction({programId: new PublicKey(row.programId),
    keys: row.accounts.map(account => ({pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner, isWritable: account.isWritable})),
    data: Buffer.from(row.data, 'base64')});
}

function tokenAccountData(mint, owner, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

function amount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function signV1(encoded, instructions, payer, keypair, blockhash) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== keypair.publicKey.toBase58())
    throw new Error(`uncontrolled signer set ${JSON.stringify(signerOrder)}`);
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(keypair.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return wire;
}

function invocationParents(logs, target) {
  const stack = [];
  const found = [];
  for (const line of logs || []) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]); stack.length = depth - 1;
      const parent = depth > 1 ? stack[depth - 2] || null : null;
      stack[depth - 1] = invoke[1];
      if (invoke[1] === target) found.push({depth, immediateParent: parent});
    }
  }
  return found;
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error(`unexpected fork genesis ${genesis}`);
  const outsider = Keypair.generate();
  const userUsdc = getAssociatedTokenAddressSync(USDC, outsider.publicKey);
  const userUsdt = getAssociatedTokenAddressSync(USDT, outsider.publicKey);
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: '11111111111111111111111111111111', rentEpoch: 0}]);
  for (const [address, mint] of [[userUsdc, USDC], [userUsdt, USDT]]) {
    await rpc('surfnet_setAccount', [address.toBase58(), {data: tokenAccountData(mint,
      outsider.publicKey, 1_000_000_000n).toString('hex'), executable: false, lamports: 2_039_280,
      owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0}]);
  }

  const quoteParams = new URLSearchParams({inputMint: USDC.toBase58(), outputMint: USDT.toBase58(),
    amount: SWAP_RAW.toString(), slippageBps: '100', onlyDirectRoutes: 'true', dexes: 'SolFi V2'});
  const quote = await json(`https://lite-api.jup.ag/swap/v1/quote?${quoteParams}`);
  if (quote.routePlan?.length !== 1 || quote.routePlan[0].swapInfo?.ammKey !== POOL)
    throw new Error('quote did not bind exact SolFi pool');
  const built = await json('https://lite-api.jup.ag/swap/v1/swap-instructions', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
      quoteResponse: quote, userPublicKey: outsider.publicKey.toBase58(), wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: false, prioritizationFeeLamports: 0,
    }),
  });
  const routeInstructions = [
    ...(built.computeBudgetInstructions || []).map(fromJupiter),
    ...(built.setupInstructions || []).map(fromJupiter),
    fromJupiter(built.swapInstruction),
    ...(built.cleanupInstruction ? [fromJupiter(built.cleanupInstruction)] : []),
  ];
  const allAddresses = [...new Map(routeInstructions.flatMap(ix => [ix.programId,
    ...ix.keys.map(key => key.pubkey)]).map(key => [key.toBase58(), key])).values()];
  for (const address of allAddresses) {
    if ([outsider.publicKey, userUsdc, userUsdt].some(own => own.equals(address))) continue;
    await rpc('getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
  const tracked = [userUsdc, userUsdt, USDC_VAULT, USDT_VAULT];
  const beforeResponse = await rpc('getMultipleAccounts', [tracked.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const before = beforeResponse.value.map(amount);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const variants = [
    {label: 'clean', prefix: [], donatedMint: null},
    {label: 'donate_input_usdc', prefix: [createTransferInstruction(userUsdc, USDC_VAULT,
      outsider.publicKey, DONATION_RAW)], donatedMint: USDC.toBase58()},
    {label: 'donate_output_usdt', prefix: [createTransferInstruction(userUsdt, USDT_VAULT,
      outsider.publicKey, DONATION_RAW)], donatedMint: USDT.toBase58()},
  ];
  const cases = [];
  for (const variant of variants) {
    const instructions = [...variant.prefix, ...routeInstructions];
    const encoded = encodeV1(instructions, outsider.publicKey, blockhash);
    if (encoded.sizeBytes > 4096 || encoded.addressCount > 64) throw new Error('v1 envelope exceeded');
    const wire = signV1(encoded, instructions, outsider.publicKey, outsider, blockhash);
    const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: tracked.map(String)},
    }]);
    const post = (simulation.value.accounts || []).map(amount);
    const deltas = post.map((value, index) => value == null || before[index] == null ? null :
      (BigInt(value) - BigInt(before[index])).toString());
    cases.push({label: variant.label, donatedMint: variant.donatedMint,
      donationRaw: variant.prefix.length ? DONATION_RAW.toString() : '0',
      slot: simulation.context.slot, err: simulation.value.err,
      unitsConsumed: simulation.value.unitsConsumed,
      wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
        instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        sha256: crypto.createHash('sha256').update(wire).digest('hex'), sigVerify: true},
      postRaw: {walletUsdc: post[0], walletUsdt: post[1], poolUsdc: post[2], poolUsdt: post[3]},
      deltaRaw: {walletUsdc: deltas[0], walletUsdt: deltas[1],
        poolUsdc: deltas[2], poolUsdt: deltas[3]},
      solfiInvocations: invocationParents(simulation.value.logs, PROGRAM),
      logs: simulation.value.logs || []});
  }
  const cleanOut = BigInt(cases[0].deltaRaw.walletUsdt || 0);
  for (const row of cases) row.outputDifferenceVsCleanRaw =
    (BigInt(row.deltaRaw.walletUsdt || 0) - cleanOut).toString();
  const result = {generatedAtUtc: new Date().toISOString(), environment: 'private nested current fork',
    genesis, forkBaselineSlot: beforeResponse.context.slot, program: PROGRAM, pool: POOL,
    outsider: {publicKey: outsider.publicKey.toBase58(), privateKeysPersisted: false,
      syntheticSolLamports: '10000000000', syntheticUsdcRaw: '1000000000', syntheticUsdtRaw: '1000000000'},
    quote: {contextSlot: quote.contextSlot, inAmount: quote.inAmount, outAmount: quote.outAmount,
      route: quote.routePlan.map(row => ({label: row.swapInfo?.label, ammKey: row.swapInfo?.ammKey}))},
    tracked: tracked.map(String), beforeRaw: {walletUsdc: before[0], walletUsdt: before[1],
      poolUsdc: before[2], poolUsdt: before[3]}, cases,
    safety: {mainnetTransactionsSubmitted: false, sendTransactionPathPresent: false,
      persistentMutation: 'fresh outsider system and token accounts on private nested fork only'} };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({evidence: OUT, generatedAtUtc: result.generatedAtUtc,
    forkBaselineSlot: result.forkBaselineSlot, quote: result.quote,
    cases: cases.map(row => ({label: row.label, err: row.err, unitsConsumed: row.unitsConsumed,
      wire: row.wire, deltaRaw: row.deltaRaw,
      outputDifferenceVsCleanRaw: row.outputDifferenceVsCleanRaw,
      solfiInvocations: row.solfiInvocations})), safety: result.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
