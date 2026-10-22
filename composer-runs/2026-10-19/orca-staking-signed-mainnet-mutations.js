#!/usr/bin/env node
'use strict';

// Fresh-outsider, sigVerify:true mainnet simulations only. This file contains
// no submit/broadcast path. ATA setup is inside each rollback-only simulation.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction} = require(MOD + '/@solana/web3.js');
const {ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync} = require(MOD + '/@solana/spl-token');

const DIR = __dirname;
const RPC = 'https://api.mainnet-beta.solana.com';
const P = value => new PublicKey(value);
const IDS = {program: P('StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT'),
  state: P('CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK'),
  vault: P('Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5'),
  orca: P('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'),
  xorca: P('xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N'),
  victimOrca: P('26wHgvEbmRdKnxVs9PjRYZMXBMUNVxuMpqG8PhDeK8Ju'),
  victimXorca: P('C6mxGUHW9eb9Ek1BL819KwEtsa4qhWzbvvmdWDpizDHz')};

let id = 0;
async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}), signal: AbortSignal.timeout(120_000)});
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1200)}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 900 * (attempt + 1)));
  }
  throw last;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function meta(pubkey, isWritable = false, isSigner = false) { return {pubkey, isWritable, isSigner}; }
function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function stakeData(amount) { return Buffer.concat([Buffer.from([0]), u64(amount)]); }
function unstakeData(amount, index) { return Buffer.concat([Buffer.from([1]), u64(amount), Buffer.from([index])]); }
function withdrawData(index) { return Buffer.from([2, index]); }
function initializeData(seconds) { const out = Buffer.alloc(9); out[0] = 3; out.writeBigInt64LE(BigInt(seconds), 1); return out; }
function setCooldownData(seconds) { const out = Buffer.alloc(10); out[0] = 4; out[1] = 0; out.writeBigInt64LE(BigInt(seconds), 2); return out; }

function stakeIx(user, userOrca, userXorca, amount, roles = {}) {
  const x = {user, vault: IDS.vault, userOrca, userXorca, xorca: IDS.xorca, state: IDS.state,
    orca: IDS.orca, tokenProgram: TOKEN_PROGRAM_ID, ...roles};
  return new TransactionInstruction({programId: IDS.program, keys: [meta(x.user, true, true), meta(x.vault, true),
    meta(x.userOrca, true), meta(x.userXorca, true), meta(x.xorca, true), meta(x.state), meta(x.orca),
    meta(x.tokenProgram)], data: stakeData(amount)});
}
function unstakeIx(user, pending, userXorca, amount, index, roles = {}) {
  const x = {user, state: IDS.state, pending, userXorca, xorca: IDS.xorca, orca: IDS.orca,
    vault: IDS.vault, system: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, ...roles};
  return new TransactionInstruction({programId: IDS.program, keys: [meta(x.user, true, true), meta(x.state, true),
    meta(x.pending, true), meta(x.userXorca, true), meta(x.xorca, true), meta(x.orca), meta(x.vault),
    meta(x.system), meta(x.tokenProgram)], data: unstakeData(amount, index)});
}
function withdrawIx(user, pending, userOrca, index, roles = {}) {
  const x = {user, state: IDS.state, pending, userOrca, vault: IDS.vault, orca: IDS.orca,
    system: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, ...roles};
  return new TransactionInstruction({programId: IDS.program, keys: [meta(x.user, true, true), meta(x.state, true),
    meta(x.pending, true), meta(x.userOrca, true), meta(x.vault, true), meta(x.orca), meta(x.system),
    meta(x.tokenProgram)], data: withdrawData(index)});
}
function setCooldownIx(authority, seconds, roles = {}) {
  const x = {authority, state: IDS.state, ...roles};
  return new TransactionInstruction({programId: IDS.program,
    keys: [meta(x.authority, true, true), meta(x.state, true)], data: setCooldownData(seconds)});
}
function initializeIx(payer, updateAuthority, seconds) {
  return new TransactionInstruction({programId: IDS.program, keys: [meta(payer, true, true),
    meta(updateAuthority, true, true), meta(IDS.state, true), meta(IDS.vault, true), meta(IDS.xorca),
    meta(IDS.orca), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID)],
  data: initializeData(seconds)});
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
async function simulate(label, feePayer, outsider, instructions, watch) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const message = new TransactionMessage({payerKey: feePayer.publicKey, recentBlockhash: latest.value.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({units: 400_000}), ...instructions]}).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const signerKeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(String);
  tx.sign([feePayer, outsider].filter(keypair => signerKeys.includes(keypair.publicKey.toBase58())));
  const wire = Buffer.from(tx.serialize());
  const reply = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify: true,
    replaceRecentBlockhash: false, commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch.map(String)}}]);
  const logs = reply.value.logs || [];
  return {label, contextSlot: reply.context.slot, err: reply.value.err, unitsConsumed: reply.value.unitsConsumed,
    logs, targetErrorLog: [...logs].reverse().find(line => line.includes('failed:')) || null,
    watchedTokenAmounts: (reply.value.accounts || []).map(tokenAmount), envelope: {version: 0, wireBytes: wire.length,
      inlineAccountKeys: message.staticAccountKeys.length, requiredSignatures: message.header.numRequiredSignatures,
      signerPublicKeys: signerKeys, signedWireSha256: sha256(wire)}, safety: {sigVerify: true,
      replaceRecentBlockhash: false, simulationOnly: true}};
}

async function main() {
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
  const outsider = Keypair.generate();
  const outsiderOrca = getAssociatedTokenAddressSync(IDS.orca, outsider.publicKey);
  const outsiderXorca = getAssociatedTokenAddressSync(IDS.xorca, outsider.publicKey);
  const pendingFixture = JSON.parse(fs.readFileSync(path.join(DIR, 'orca-staking-current-state.json'), 'utf8'))
    .pending.find(row => BigInt(row.withdrawableTimestamp) <= BigInt(Math.floor(Date.now() / 1000)));
  if (!pendingFixture) throw new Error('no live matured pending withdrawal fixture');
  const victimPending = P(pendingFixture.address), victim = P(pendingFixture.unstaker);
  const victimOrcaAta = getAssociatedTokenAddressSync(IDS.orca, victim);
  const outsiderIndex = 250;
  const [outsiderPending] = PublicKey.findProgramAddressSync(
    [Buffer.from('pending_withdraw'), outsider.publicKey.toBuffer(), Buffer.from([outsiderIndex])], IDS.program);
  const setup = [
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, outsiderOrca, outsider.publicKey, IDS.orca,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, outsiderXorca, outsider.publicKey, IDS.xorca,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
  ];
  // The public RPC permits at most five returned accounts per simulation.
  const watch = [IDS.vault, IDS.xorca, IDS.state, outsiderOrca, outsiderXorca];
  const tests = [];
  tests.push(await simulate('stake_valid_shape_empty_outsider_amount_1', feePayer, outsider,
    [...setup, stakeIx(outsider.publicKey, outsiderOrca, outsiderXorca, 1n)], watch));
  tests.push(await simulate('stake_source_substituted_with_victim_orca_account', feePayer, outsider,
    [...setup, stakeIx(outsider.publicKey, IDS.victimOrca, outsiderXorca, 1n)], watch));
  tests.push(await simulate('stake_xorca_destination_substituted_with_victim_account', feePayer, outsider,
    [...setup, stakeIx(outsider.publicKey, outsiderOrca, IDS.victimXorca, 0n)], watch));
  tests.push(await simulate('stake_vault_substituted_with_outsider_orca_account', feePayer, outsider,
    [...setup, stakeIx(outsider.publicKey, outsiderOrca, outsiderXorca, 0n, {vault: outsiderOrca})], watch));
  tests.push(await simulate('stake_source_destination_alias', feePayer, outsider,
    [...setup, stakeIx(outsider.publicKey, outsiderOrca, outsiderOrca, 0n)], watch));
  tests.push(await simulate('unstake_valid_shape_empty_outsider_amount_1', feePayer, outsider,
    [...setup, unstakeIx(outsider.publicKey, outsiderPending, outsiderXorca, 1n, outsiderIndex)], watch));
  tests.push(await simulate('unstake_source_substituted_with_victim_xorca_account', feePayer, outsider,
    [...setup, unstakeIx(outsider.publicKey, outsiderPending, IDS.victimXorca, 1n, outsiderIndex)], watch));
  tests.push(await simulate('withdraw_victim_pending_to_outsider_destination', feePayer, outsider,
    [...setup, withdrawIx(outsider.publicKey, victimPending, outsiderOrca, pendingFixture.withdrawIndex)], watch));
  tests.push(await simulate('withdraw_victim_pending_and_victim_destination', feePayer, outsider,
    [...setup, withdrawIx(outsider.publicKey, victimPending, victimOrcaAta, pendingFixture.withdrawIndex)], watch));
  tests.push(await simulate('withdraw_outsider_nonexistent_pending', feePayer, outsider,
    [...setup, withdrawIx(outsider.publicKey, outsiderPending, outsiderOrca, outsiderIndex)], watch));
  tests.push(await simulate('set_cooldown_authority_substituted_with_outsider', feePayer, outsider,
    [setCooldownIx(outsider.publicKey, 0n)], watch));
  tests.push(await simulate('set_state_substituted_with_pending_account', feePayer, outsider,
    [setCooldownIx(outsider.publicKey, 0n, {state: victimPending})], watch));
  tests.push(await simulate('initialize_deployer_substituted_with_outsider', feePayer, outsider,
    [initializeIx(outsider.publicKey, outsider.publicKey, 0n)], watch));
  const out = {schema: 'orca-staking-signed-mainnet-mutations/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta simulateTransaction', target: Object.fromEntries(Object.entries(IDS).map(([k, v]) => [k, String(v)])),
    signer: {feePayerPublicKey: feePayer.publicKey.toBase58(), freshOutsiderPublicKey: outsider.publicKey.toBase58(),
      outsiderSecretPersisted: false, protocolPrivilegeKnown: false}, fixture: {pending: pendingFixture,
      victimOrcaAta: victimOrcaAta.toBase58(), outsiderPending: outsiderPending.toBase58(), outsiderIndex,
      outsiderOrcaAta: outsiderOrca.toBase58(), outsiderXorcaAta: outsiderXorca.toBase58()}, watch: watch.map(String), tests,
    safety: {sigVerify: true, simulationsOnly: true, sendTransactionCalled: false, transactionSubmitted: false,
      broadcast: false, freshOutsiderSecretPersisted: false}};
  const outPath = path.join(DIR, 'orca-staking-signed-mainnet-mutations.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({outPath, generatedAtUtc: out.generatedAtUtc, signer: out.signer, fixture: out.fixture,
    tests: tests.map(row => ({label: row.label, contextSlot: row.contextSlot, err: row.err,
      unitsConsumed: row.unitsConsumed, targetErrorLog: row.targetErrorLog, envelope: row.envelope,
      relevantLogs: row.logs.filter(line => /Instruction:|wrong |not |failed|insufficient|Invalid|Account /.test(line))})),
    safety: out.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
