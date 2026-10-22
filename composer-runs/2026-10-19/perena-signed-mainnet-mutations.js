#!/usr/bin/env node
'use strict';

// Fresh-outsider signed, sigVerify:true Perena controls and account-role
// mutations against the current mainnet-beta bank. Every transaction is sent
// only to simulateTransaction; this file intentionally has no broadcast path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} = require(MOD + '/@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction,
} = require(MOD + '/@solana/spl-token');

const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const KEY_PATH = '/Users/stacc/hooked.json';
const OUT = path.join(__dirname, 'perena-signed-mainnet-mutations.json');
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const P = value => new PublicKey(value);
const IDS = {
  program: P('NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P'),
  pool: P('2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ'),
  otherPool: P('5M7McNWX7yBBGrZGB6XhmHYhFwWwwB2ckrA1HEpkf3SA'),
  usdc: P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  usdt: P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  usdcVault: P('6B8k8At9879r5EsZAWg8W6DEpxzJ798Cwj48twu3pq4b'),
  usdtVault: P('DJfYbGicp4AFXWsragNWv1baugqcdFhw6eFTcK2YWdyK'),
  config: P('FS159v4b2jo3fjGBaUFmDzgx7k616XhpKhMwX2Q3HeeD'),
};
const SWAP_DISCRIMINATOR = Buffer.from([104, 104, 131, 86, 161, 189, 180, 216]);
const INPUT_RAW = 5_000n;

function loadRpc() {
  const values = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
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
let rpcId = 0;
async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1000)}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw last;
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

function swapData(direction, amountIn = INPUT_RAW, minOut = 0n) {
  const data = Buffer.alloc(26);
  SWAP_DISCRIMINATOR.copy(data, 0);
  data[8] = direction.inIndex;
  data[9] = direction.outIndex;
  data.writeBigUInt64LE(amountIn, 10);
  data.writeBigUInt64LE(minOut, 18);
  return data;
}

function meta(pubkey, writable = false, signer = false) {
  return {pubkey, isWritable: writable, isSigner: signer};
}

function makeSwap(direction, roles = {}) {
  const resolved = {
    pool: IDS.pool, inMint: direction.inMint, outMint: direction.outMint,
    inTrader: direction.outsiderInAta, outTrader: direction.outsiderOutAta,
    inVault: direction.inVault, outVault: direction.outVault,
    config: IDS.config, payer: direction.outsider,
    tokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID,
    ...roles,
  };
  return new TransactionInstruction({programId: IDS.program, keys: [
    meta(resolved.pool, true), meta(resolved.inMint, true), meta(resolved.outMint, true),
    meta(resolved.inTrader, true), meta(resolved.outTrader, true),
    meta(resolved.inVault, true), meta(resolved.outVault, true), meta(resolved.config),
    meta(resolved.payer, false, true), meta(resolved.tokenProgram), meta(resolved.token2022Program),
  ], data: swapData(direction)});
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

async function simulate(label, feePayer, outsider, instructions, watch) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const message = new TransactionMessage({payerKey: feePayer.publicKey,
    recentBlockhash: latest.value.blockhash, instructions}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const requiredSignerKeys = message.staticAccountKeys
    .slice(0, message.header.numRequiredSignatures).map(key => key.toBase58());
  const available = [feePayer, outsider];
  tx.sign(available.filter(keypair => requiredSignerKeys.includes(keypair.publicKey.toBase58())));
  const wire = Buffer.from(tx.serialize());
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch.map(String)},
  }]);
  return {label, signed: true, sigVerify: true, replaceRecentBlockhash: false,
    contextSlot: result.context.slot, err: result.value.err,
    unitsConsumed: result.value.unitsConsumed, logs: result.value.logs || [],
    returnedTokenAmounts: (result.value.accounts || []).map(tokenAmount),
    envelope: {wireBytes: wire.length, accountKeys: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures,
      signerPublicKeys: requiredSignerKeys,
      wireSha256: sha256(wire)}};
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error(`wrong genesis ${genesis}`);
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))));
  const outsider = Keypair.generate();
  const feeUsdc = getAssociatedTokenAddressSync(IDS.usdc, feePayer.publicKey);
  const feeUsdt = getAssociatedTokenAddressSync(IDS.usdt, feePayer.publicKey);
  const balancePage = await rpc('getMultipleAccounts', [[feeUsdc.toBase58(), feeUsdt.toBase58()], {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const feeBalances = balancePage.value.map(tokenAmount);
  let direction;
  if (BigInt(feeBalances[0] || 0) >= INPUT_RAW) {
    direction = {name: 'USDC_to_USDT', inIndex: 0, outIndex: 1,
      inMint: IDS.usdc, outMint: IDS.usdt, inVault: IDS.usdcVault, outVault: IDS.usdtVault,
      feeInAta: feeUsdc, feeOutAta: feeUsdt};
  } else if (BigInt(feeBalances[1] || 0) >= INPUT_RAW) {
    direction = {name: 'USDT_to_USDC', inIndex: 1, outIndex: 0,
      inMint: IDS.usdt, outMint: IDS.usdc, inVault: IDS.usdtVault, outVault: IDS.usdcVault,
      feeInAta: feeUsdt, feeOutAta: feeUsdc};
  } else {
    throw new Error(`test fee payer lacks ${INPUT_RAW} raw USDC or USDT`);
  }
  direction.outsider = outsider.publicKey;
  direction.outsiderInAta = getAssociatedTokenAddressSync(direction.inMint, outsider.publicKey);
  direction.outsiderOutAta = getAssociatedTokenAddressSync(direction.outMint, outsider.publicKey);
  const setup = [
    ComputeBudgetProgram.setComputeUnitLimit({units: 400_000}),
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey,
      direction.outsiderInAta, outsider.publicKey, direction.inMint),
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey,
      direction.outsiderOutAta, outsider.publicKey, direction.outMint),
    createTransferInstruction(direction.feeInAta, direction.outsiderInAta,
      feePayer.publicKey, INPUT_RAW),
  ];
  const watch = [direction.outsiderInAta, direction.outsiderOutAta,
    direction.inVault, direction.outVault, direction.feeInAta, direction.feeOutAta];
  const tests = [];
  tests.push(await simulate('setup_only_same_bank_baseline', feePayer, outsider, setup, watch));
  tests.push(await simulate('legitimate_fresh_outsider_exact_in_control', feePayer, outsider,
    [...setup, makeSwap(direction)], watch));
  tests.push(await simulate('recipient_role_alias_to_input_mint_account', feePayer, outsider,
    [...setup, makeSwap(direction, {outTrader: direction.outsiderInAta})], watch));
  tests.push(await simulate('vault_roles_swapped', feePayer, outsider,
    [...setup, makeSwap(direction, {inVault: direction.outVault, outVault: direction.inVault})], watch));
  tests.push(await simulate('out_vault_replaced_with_outsider_destination', feePayer, outsider,
    [...setup, makeSwap(direction, {outVault: direction.outsiderOutAta})], watch));
  tests.push(await simulate('pool_replaced_with_distinct_perena_pool', feePayer, outsider,
    [...setup, makeSwap(direction, {pool: IDS.otherPool})], watch));
  tests.push(await simulate('authority_changed_to_fresh_outsider_over_fee_payer_source', feePayer, outsider,
    [...setup.slice(0, 3), makeSwap(direction, {inTrader: direction.feeInAta})], watch));
  tests.push(await simulate('valid_trader_redirects_output_to_fee_payer_account', feePayer, outsider,
    [...setup, makeSwap(direction, {outTrader: direction.feeOutAta})], watch));

  const baseline = tests[0];
  const control = tests[1];
  const deltas = control.returnedTokenAmounts.map((value, i) => value == null ||
    baseline.returnedTokenAmounts[i] == null ? null :
      (BigInt(value) - BigInt(baseline.returnedTokenAmounts[i])).toString());
  const output = {
    schema: 'perena-signed-mainnet-mutations/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta read-only simulateTransaction', genesis,
    target: Object.fromEntries(Object.entries(IDS).map(([key, value]) => [key, value.toBase58()])),
    currentAccountContextSlot: balancePage.context.slot,
    signer: {feePayerPublicKey: feePayer.publicKey.toBase58(),
      freshOutsiderPublicKey: outsider.publicKey.toBase58(), outsiderSecretPersisted: false,
      protocolPrivilegeKnown: false},
    input: {direction: direction.name, amountRaw: INPUT_RAW.toString(), minAmountOutRaw: '0',
      feePayerBalancesRaw: {usdc: feeBalances[0], usdt: feeBalances[1]},
      addresses: {feeInAta: direction.feeInAta.toBase58(), feeOutAta: direction.feeOutAta.toBase58(),
        outsiderInAta: direction.outsiderInAta.toBase58(), outsiderOutAta: direction.outsiderOutAta.toBase58()}},
    watchAddresses: watch.map(String), tests,
    controlDeltaVersusSetupOnlyRaw: {
      outsiderInput: deltas[0], outsiderOutput: deltas[1], poolInputVault: deltas[2],
      poolOutputVault: deltas[3], feePayerInput: deltas[4], feePayerOutput: deltas[5],
    },
    safety: {sigVerify: true, simulationsOnly: true, sendTransactionCalled: false,
      transactionSubmitted: false, broadcast: false, freshOutsiderSecretPersisted: false},
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, generatedAtUtc: output.generatedAtUtc,
    accountContextSlot: output.currentAccountContextSlot, signer: output.signer, input: output.input,
    controlDeltaVersusSetupOnlyRaw: output.controlDeltaVersusSetupOnlyRaw,
    tests: tests.map(test => ({label: test.label, contextSlot: test.contextSlot,
      err: test.err, unitsConsumed: test.unitsConsumed, envelope: test.envelope,
      logTail: test.logs.slice(-12)})), safety: output.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
