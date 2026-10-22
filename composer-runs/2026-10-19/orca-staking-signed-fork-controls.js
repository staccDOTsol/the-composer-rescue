#!/usr/bin/env node
'use strict';

// Signed, sigVerify:true, rollback-only controls against a mainnet-backed
// Surfpool fork. Fork writes only fund the fresh outsider and create one
// explicitly synthetic pending-withdraw fixture; no transaction is submitted.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction} = require(MOD + '/@solana/web3.js');
const {TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync} = require(MOD + '/@solana/spl-token');

const DIR = __dirname;
const FORK = process.env.ORCA_XORCA_FORK_RPC || 'http://127.0.0.1:19697';
const P = value => new PublicKey(value);
const IDS = {program: P('StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT'),
  state: P('CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK'),
  vault: P('Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5'),
  orca: P('orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'),
  xorca: P('xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N')};
const START_ORCA = 20_000_000_000_000n;
const START_XORCA = 0n;
const stateCensus = JSON.parse(fs.readFileSync(path.join(DIR, 'orca-staking-current-state.json'), 'utf8'));

let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(FORK, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}), signal: AbortSignal.timeout(120_000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1600)}`);
  return body.result;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function meta(pubkey, isWritable = false, isSigner = false) { return {pubkey, isWritable, isSigner}; }
function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function stakeData(amount) { return Buffer.concat([Buffer.from([0]), u64(amount)]); }
function unstakeData(amount, index) { return Buffer.concat([Buffer.from([1]), u64(amount), Buffer.from([index])]); }
function withdrawData(index) { return Buffer.from([2, index]); }
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
function parse(address, account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const base = {address: String(address), owner: account.owner, lamports: String(account.lamports), dataLength: data.length};
  if (account.owner === TOKEN_PROGRAM_ID.toBase58() && data.length === 165) return {...base, kind: 'token',
    amountRaw: data.readBigUInt64LE(64).toString(), mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58()};
  if (String(address) === IDS.xorca.toBase58() && data.length === 82) return {...base, kind: 'mint',
    supplyRaw: data.readBigUInt64LE(36).toString()};
  if (String(address) === IDS.state.toBase58() && data.length === 2048) return {...base, kind: 'state',
    escrowedOrcaRaw: data.readBigUInt64LE(8).toString(), coolDownSeconds: data.readBigInt64LE(16).toString()};
  return {...base, kind: 'other', dataSha256: sha256(data)};
}
function delta(before, after) {
  if (!before || !after || before.kind !== after.kind) return null;
  if (before.kind === 'token') return {amountRaw: (BigInt(after.amountRaw) - BigInt(before.amountRaw)).toString()};
  if (before.kind === 'mint') return {supplyRaw: (BigInt(after.supplyRaw) - BigInt(before.supplyRaw)).toString()};
  if (before.kind === 'state') return {escrowedOrcaRaw: (BigInt(after.escrowedOrcaRaw) - BigInt(before.escrowedOrcaRaw)).toString()};
  return null;
}
async function getAccounts(addresses) {
  const reply = await rpc('getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'processed'}]);
  return reply.value.map((account, i) => parse(addresses[i], account));
}
async function simulate(label, outsider, instructions, watch, notes = {}) {
  const before = await getAccounts(watch);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({payerKey: outsider.publicKey, recentBlockhash: latest.value.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({units: 500_000}), ...instructions]}).compileToV0Message();
  const tx = new VersionedTransaction(message); tx.sign([outsider]);
  const wire = Buffer.from(tx.serialize());
  const reply = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify: true,
    replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch.map(String)}}]);
  const after = (reply.value.accounts || []).map((account, i) => parse(watch[i], account));
  const logs = reply.value.logs || [];
  return {label, notes, contextSlot: reply.context.slot, err: reply.value.err, unitsConsumed: reply.value.unitsConsumed,
    logs, targetErrorLog: [...logs].reverse().find(line => line.includes('failed:')) || null,
    before, after, deltas: watch.map((address, i) => ({address: String(address), delta: delta(before[i], after[i])})),
    envelope: {version: 0, wireBytes: wire.length, inlineAccountKeys: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures, signerPublicKeys: [outsider.publicKey.toBase58()],
      signedWireSha256: sha256(wire), sigVerify: true, replaceRecentBlockhash: false}};
}
function predictedShares(orcaAmount) {
  const backing = BigInt(stateCensus.accounting.nonEscrowedBackingRaw);
  const supply = BigInt(stateCensus.accounting.xorcaSupplyRaw);
  return BigInt(orcaAmount) * (supply + 100n) / (backing + 100n);
}
function predictedOrca(shares, backingDelta = 0n, supplyDelta = 0n) {
  const backing = BigInt(stateCensus.accounting.nonEscrowedBackingRaw) + backingDelta;
  const supply = BigInt(stateCensus.accounting.xorcaSupplyRaw) + supplyDelta;
  return BigInt(shares) * (backing + 100n) / (supply + 100n);
}

async function main() {
  if (await rpc('getHealth') !== 'ok') throw new Error('fork unhealthy');
  const outsider = Keypair.generate();
  const outsiderOrca = getAssociatedTokenAddressSync(IDS.orca, outsider.publicKey);
  const outsiderXorca = getAssociatedTokenAddressSync(IDS.xorca, outsider.publicKey);
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await rpc('surfnet_setTokenAccount', [outsider.publicKey.toBase58(), IDS.orca.toBase58(),
    {amount: Number(START_ORCA)}, TOKEN_PROGRAM_ID.toBase58()]);
  await rpc('surfnet_setTokenAccount', [outsider.publicKey.toBase58(), IDS.xorca.toBase58(),
    {amount: Number(START_XORCA)}, TOKEN_PROGRAM_ID.toBase58()]);
  await rpc('getMultipleAccounts', [[IDS.program, IDS.state, IDS.vault, IDS.orca, IDS.xorca, TOKEN_PROGRAM_ID]
    .map(String), {encoding: 'base64', commitment: 'processed'}]);

  const watch = [IDS.vault, IDS.xorca, outsiderOrca, outsiderXorca, IDS.state];
  const tests = [];
  for (const [i, amount] of [1n, 100n, 1_000_000n, 1_000_000_000_000n, 5_000_000_000_000n].entries()) {
    const shares = predictedShares(amount);
    tests.push(await simulate(`stake_amount_${amount}`, outsider,
      [stakeIx(outsider.publicKey, outsiderOrca, outsiderXorca, amount)], watch,
      {inputOrcaRaw: amount.toString(), predictedSharesRaw: shares.toString(), scale: i < 2 ? 'rounding edge' : 'current-vault relevant'}));
    if (shares > 0n) {
      const index = 10 + i;
      const [pending] = PublicKey.findProgramAddressSync(
        [Buffer.from('pending_withdraw'), outsider.publicKey.toBuffer(), Buffer.from([index])], IDS.program);
      const expectedRedeem = predictedOrca(shares, amount, shares);
      tests.push(await simulate(`stake_then_unstake_roundtrip_${amount}`, outsider,
        [stakeIx(outsider.publicKey, outsiderOrca, outsiderXorca, amount),
          unstakeIx(outsider.publicKey, pending, outsiderXorca, shares, index)], watch,
        {inputOrcaRaw: amount.toString(), mintedThenBurnedSharesRaw: shares.toString(),
          predictedPendingOrcaRaw: expectedRedeem.toString(), predictedRoundingLossRaw: (amount - expectedRedeem).toString(),
          pendingAddress: pending.toBase58(), withdrawIndex: index}));
    }
  }

  for (const [i, pair] of [[1_000_000n, 1_000_000n], [5_000_000_000_000n, 5_000_000_000_000n]].entries()) {
    const [donation, stakeAmount] = pair;
    const backingAfterDonation = BigInt(stateCensus.accounting.nonEscrowedBackingRaw) + donation;
    const supply = BigInt(stateCensus.accounting.xorcaSupplyRaw);
    const shares = stakeAmount * (supply + 100n) / (backingAfterDonation + 100n);
    const redeem = predictedOrca(shares, donation + stakeAmount, shares);
    const index = 30 + i;
    const [pending] = PublicKey.findProgramAddressSync(
      [Buffer.from('pending_withdraw'), outsider.publicKey.toBuffer(), Buffer.from([index])], IDS.program);
    tests.push(await simulate(`reward_donation_then_roundtrip_donation_${donation}`, outsider,
      [createTransferInstruction(outsiderOrca, IDS.vault, outsider.publicKey, donation),
        stakeIx(outsider.publicKey, outsiderOrca, outsiderXorca, stakeAmount),
        unstakeIx(outsider.publicKey, pending, outsiderXorca, shares, index)], watch,
      {donationOrcaRaw: donation.toString(), stakeOrcaRaw: stakeAmount.toString(), mintedThenBurnedSharesRaw: shares.toString(),
        predictedPendingOrcaRaw: redeem.toString(), predictedAttackerEquityLossRaw: (donation + stakeAmount - redeem).toString(),
        rewardMechanism: 'direct signed SPL Token transfer to the canonical vault'}));
  }

  const matured = stateCensus.pending.filter(row => BigInt(row.withdrawableTimestamp) <= BigInt(Math.floor(Date.now() / 1000)))
    .sort((a, b) => Number(BigInt(a.withdrawableOrcaAmountRaw) - BigInt(b.withdrawableOrcaAmountRaw)))[0];
  const source = await rpc('getAccountInfo', [matured.address, {encoding: 'base64', commitment: 'processed'}]);
  const syntheticIndex = matured.withdrawIndex;
  const [syntheticPending, syntheticBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pending_withdraw'), outsider.publicKey.toBuffer(), Buffer.from([syntheticIndex])], IDS.program);
  const pendingData = Buffer.from(source.value.data[0], 'base64');
  pendingData[6] = syntheticBump; pendingData[7] = syntheticIndex;
  outsider.publicKey.toBuffer().copy(pendingData, 8);
  await rpc('surfnet_setAccount', [syntheticPending.toBase58(), {data: pendingData.toString('hex'), executable: false,
    lamports: source.value.lamports, owner: IDS.program.toBase58(), rentEpoch: 0}]);
  const victim = P(matured.unstaker);
  const victimOrcaAta = getAssociatedTokenAddressSync(IDS.orca, victim);
  await rpc('getAccountInfo', [victimOrcaAta.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  tests.push(await simulate('synthetic_bound_pending_canonical_withdraw_control', outsider,
    [withdrawIx(outsider.publicKey, syntheticPending, outsiderOrca, syntheticIndex)], watch,
    {syntheticFixture: true, sourcePending: matured.address, clonedAmountRaw: matured.withdrawableOrcaAmountRaw,
      mutation: 'unstaker and PDA changed together to fresh outsider; timestamp and amount retained'}));
  tests.push(await simulate('synthetic_bound_pending_destination_substituted_to_victim_ata', outsider,
    [withdrawIx(outsider.publicKey, syntheticPending, victimOrcaAta, syntheticIndex)], watch,
    {syntheticFixture: true, sourcePending: matured.address, victimDestination: victimOrcaAta.toBase58()}));
  tests.push(await simulate('synthetic_bound_pending_destination_aliased_to_vault', outsider,
    [withdrawIx(outsider.publicKey, syntheticPending, IDS.vault, syntheticIndex)], watch,
    {syntheticFixture: true, sourcePending: matured.address, alias: 'destination equals canonical vault'}));

  const out = {schema: 'orca-staking-signed-fork-controls/v1', generatedAtUtc: new Date().toISOString(),
    environment: {rpc: FORK, mainnetBacked: true, forkHealth: 'ok', forkWrites: [
      'fresh outsider funded with synthetic SOL', `fresh outsider canonical ORCA ATA seeded with ${START_ORCA} raw`,
      'fresh outsider canonical xORCA ATA seeded with 0 raw',
      'one matured live PendingWithdraw cloned to an outsider-bound PDA solely for destination-binding controls'],
      sourceAccountContextSlot: stateCensus.accountContextSlot, sourcePendingContextSlot: stateCensus.pendingContextSlot},
    target: Object.fromEntries(Object.entries(IDS).map(([key, value]) => [key, String(value)])),
    signer: {freshOutsiderPublicKey: outsider.publicKey.toBase58(), outsiderSecretPersisted: false,
      protocolPrivilegeKnown: false}, startingBalances: {outsiderOrcaRaw: START_ORCA.toString(), outsiderXorcaRaw: START_XORCA.toString()},
    tests, safety: {sigVerify: true, replaceRecentBlockhash: false, simulationsOnly: true,
      sendTransactionCalled: false, transactionSubmitted: false, broadcast: false, freshOutsiderSecretPersisted: false}};
  const outPath = path.join(DIR, 'orca-staking-signed-fork-controls.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({outPath, generatedAtUtc: out.generatedAtUtc, signer: out.signer,
    tests: tests.map(row => ({label: row.label, notes: row.notes, contextSlot: row.contextSlot, err: row.err,
      unitsConsumed: row.unitsConsumed, targetErrorLog: row.targetErrorLog, envelope: row.envelope, deltas: row.deltas,
      relevantLogs: row.logs.filter(line => /Instruction:|Program data:|does not match|wrong |failed/.test(line))})),
    safety: out.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
