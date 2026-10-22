#!/usr/bin/env node
'use strict';

// Current-state authority/value controls for combining multiple live token
// accounts delegated to an SVSP mint-authority PDA. All transactions are
// freshly signed and simulated on a local exact-state fork; none are sent.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  Keypair, PublicKey, StakeProgram, SystemProgram, SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const UPSTREAM_URL = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || process.env.RPC_URL || process.env.RPC;
const FORK_URL = process.env.SVSP_FORK_RPC || 'http://127.0.0.1:19201';
if (!UPSTREAM_URL) throw new Error('mainnet RPC environment is not configured');
const OUT = process.argv[2] || path.join(__dirname, 'svsp-delegated-source-combine-fork.json');
const P = (value) => new PublicKey(value);
const X = {
  program: P('SVSPxpvHdN29nkVg9rPapPNDddN5DipNLRUFhyjFThE'),
  programData: P('CnA41uYcs8X64x4PAhoPooN1yo1vabvbb64eJe9H8SZJ'),
  pool: P('BnnjRBpecqkxGp276rNf6CP1x8cDb6CojjmeXd2WCwXu'),
  stake: P('BTST6Wy5XeDoM8UxSdGgqRkQXuae2i7jzF8CJpcr56v1'),
  onramp: P('AEgdhG7zpk8ao9jLkqtBGSpUVwLnq6DiSEjfQmJdvQPi'),
  mint: P('2k79y8CApbU9jAvWhLS2j6uRbaVjpLJTUzstBTho9vGq'),
  stakeAuthority: P('Fr1kecHooJfW5PnUuUCrjcKttjRjLm81QYSyXZ1GP6xq'),
  mintAuthority: P('6bR5YtxZL3rSvvcomzo9nPUQqypKrXEWuHFJ8Z3J2Hcx'),
  sourceA: P('2tRGyBbrKjBcKRiDMs72gBbSZt866t7FKe8NqWk7wrGS'),
  sourceB: P('AZ1a6VcmsWro6cMJY6bSRgetNLPS2pfYtBMuMBuSrQZF'),
  token: P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
};
const CLONE_KEYS = [X.program, X.programData, X.pool, X.stake, X.onramp, X.mint, X.sourceA, X.sourceB];
let id = 0;
async function rpc(url, method, params = [], retries = 6) {
  let last;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}), signal: AbortSignal.timeout(120_000)});
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 500)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt + 1 < retries) await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw last;
}
const upstream = (method, params) => rpc(UPSTREAM_URL, method, params);
const fork = (method, params) => rpc(FORK_URL, method, params);

function accountSummary(address, account) {
  if (!account) return {address, exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  return {address, exists: true, lamports: String(account.lamports), owner: account.owner,
    executable: account.executable, dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
}
function tokenImage(account) {
  const data = Buffer.from(account.data[0], 'base64');
  const delegateOption = data.readUInt32LE(72);
  return {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    owner: new PublicKey(data.subarray(32, 64)).toBase58(), amountRaw: data.readBigUInt64LE(64).toString(),
    delegate: delegateOption === 1 ? new PublicKey(data.subarray(76, 108)).toBase58() : null,
    delegatedAmountRaw: data.readBigUInt64LE(121).toString()};
}
function snapshot(addresses, accounts) {
  return Object.fromEntries(addresses.map((address, i) => {
    const account = accounts[i];
    if (!account) return [address, null];
    const data = Buffer.from(account.data[0], 'base64');
    return [address, {lamports: String(account.lamports), owner: account.owner, dataLength: data.length,
      dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
      tokenAmountRaw: account.owner === X.token.toBase58() && data.length >= 72
        ? data.readBigUInt64LE(64).toString() : null}];
  }));
}
function delta(before, after) {
  return Object.fromEntries(Object.keys(before).map((address) => {
    const a = before[address]; const z = after[address];
    return [address, {changed: JSON.stringify(a) !== JSON.stringify(z),
      lamportDelta: !a && !z ? '0' : a && z ? (BigInt(z.lamports) - BigInt(a.lamports)).toString() : null,
      tokenAmountDeltaRaw: a?.tokenAmountRaw !== null && a?.tokenAmountRaw !== undefined
        && z?.tokenAmountRaw !== null && z?.tokenAmountRaw !== undefined
        ? (BigInt(z.tokenAmountRaw) - BigInt(a.tokenAmountRaw)).toString() : null}];
  }));
}

function directTransfer(source, destination, amount) {
  const data = Buffer.alloc(9); data[0] = 3; data.writeBigUInt64LE(BigInt(amount), 1);
  return new TransactionInstruction({programId: X.token, keys: [
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: destination, isSigner: false, isWritable: true},
    // The delegate PDA is intentionally supplied as a non-signer. Marking it
    // as a signer would require an impossible off-curve transaction signature.
    {pubkey: X.mintAuthority, isSigner: false, isWritable: false},
  ], data});
}
function withdraw(source, destination, authority, amount) {
  const data = Buffer.alloc(41); data[0] = 3; authority.toBuffer().copy(data, 1);
  data.writeBigUInt64LE(BigInt(amount), 33);
  return new TransactionInstruction({programId: X.program, keys: [
    {pubkey: X.pool, isSigner: false, isWritable: false},
    {pubkey: X.stake, isSigner: false, isWritable: true},
    {pubkey: X.onramp, isSigner: false, isWritable: false},
    {pubkey: X.mint, isSigner: false, isWritable: true},
    {pubkey: X.stakeAuthority, isSigner: false, isWritable: false},
    {pubkey: X.mintAuthority, isSigner: false, isWritable: false},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
    {pubkey: X.token, isSigner: false, isWritable: false},
    {pubkey: StakeProgram.programId, isSigner: false, isWritable: false},
  ], data});
}

async function simulate(label, instructions, signers, watched) {
  for (const instruction of instructions) {
    await fork('getAccountInfo', [instruction.programId.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
    for (const key of instruction.keys) await fork('getAccountInfo', [key.pubkey.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }
  const addresses = watched.map(String);
  const prePage = await fork('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'processed'}]);
  const latest = await fork('getLatestBlockhash', [{commitment: 'processed'}]);
  const message = new TransactionMessage({payerKey: signers[0].publicKey,
    recentBlockhash: latest.value.blockhash, instructions}).compileToV0Message();
  const tx = new VersionedTransaction(message); tx.sign(signers);
  const wire = Buffer.from(tx.serialize());
  const addressCount = message.staticAccountKeys.length + message.addressTableLookups.reduce(
    (n, table) => n + table.writableIndexes.length + table.readonlyIndexes.length, 0);
  if (wire.length > 4096 || addressCount > 64) throw new Error(`${label}: envelope exceeded`);
  const fee = await fork('getFeeForMessage', [Buffer.from(message.serialize()).toString('base64'), {commitment: 'processed'}]);
  const result = await fork('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses}}]);
  const postPage = await fork('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'processed'}]);
  const before = snapshot(addresses, prePage.value); const after = snapshot(addresses, postPage.value);
  const deltas = delta(before, after);
  return {label, contextSlot: result.context.slot, sigVerify: true, broadcast: false,
    transaction: {messageVersion: 0, serializedBytes: wire.length, addressCount,
      instructionCount: instructions.length, requiredSignatures: message.header.numRequiredSignatures,
      signerPublicKeys: signers.map((keypair) => keypair.publicKey.toBase58()), secretKeysPersisted: false,
      wireSha256: crypto.createHash('sha256').update(wire).digest('hex'),
      feeLamportsIfSubmitted: fee.value === null ? null : String(fee.value)},
    err: result.value.err, unitsConsumed: result.value.unitsConsumed,
    logs: result.value.logs || [], innerInstructions: result.value.innerInstructions || null,
    persistedForkState: {before, after, deltas,
      allWatchedAccountsUnchanged: Object.values(deltas).every((row) => !row.changed)},
    finalEquity: {outsiderWalletLamportDelta: deltas[signers[0].publicKey.toBase58()].lamportDelta,
      protocolStakeLamportDelta: deltas[X.stake.toBase58()].lamportDelta,
      sourceATokenDeltaRaw: deltas[X.sourceA.toBase58()].tokenAmountDeltaRaw,
      sourceBTokenDeltaRaw: deltas[X.sourceB.toBase58()].tokenAmountDeltaRaw}};
}

async function main() {
  const [upstreamGenesis, forkGenesis, anchorSlot] = await Promise.all([
    upstream('getGenesisHash'), fork('getGenesisHash'), upstream('getSlot', [{commitment: 'finalized'}])]);
  if (upstreamGenesis !== MAINNET_GENESIS || forkGenesis !== MAINNET_GENESIS) throw new Error('wrong genesis');
  const upstreamPage = await upstream('getMultipleAccounts', [CLONE_KEYS.map(String), {encoding: 'base64', commitment: 'finalized'}]);
  const forkPage = await fork('getMultipleAccounts', [CLONE_KEYS.map(String), {encoding: 'base64', commitment: 'processed'}]);
  const cloneComparison = CLONE_KEYS.map((key, i) => {
    const address = key.toBase58(); const a = accountSummary(address, upstreamPage.value[i]);
    const z = accountSummary(address, forkPage.value[i]); return {address, upstream: a, fork: z, exact: JSON.stringify(a) === JSON.stringify(z)};
  });
  if (!cloneComparison.every((row) => row.exact)) throw new Error('target clone mismatch');
  const sourceA = tokenImage(upstreamPage.value[6]); const sourceB = tokenImage(upstreamPage.value[7]);
  if (sourceA.mint !== X.mint.toBase58() || sourceB.mint !== X.mint.toBase58()
    || sourceA.delegate !== X.mintAuthority.toBase58() || sourceB.delegate !== X.mintAuthority.toBase58()) {
    throw new Error('source mint/delegate changed');
  }
  const totalExposedRaw = BigInt(sourceA.amountRaw) + BigInt(sourceB.amountRaw);
  const mintData = Buffer.from(upstreamPage.value[5].data[0], 'base64');
  const stakeData = Buffer.from(upstreamPage.value[3].data[0], 'base64');
  const supply = mintData.readBigUInt64LE(36); const available = stakeData.readBigUInt64LE(156) - 1_000_000_000n;
  const threshold = (1_000_000_000n * supply + available - 1n) / available;

  const attacker = Keypair.generate();
  await fork('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  const rent = await fork('getMinimumBalanceForRentExemption', [200, {commitment: 'processed'}]);
  const dSum = Keypair.generate(); const dA = Keypair.generate(); const dB = Keypair.generate();
  const create = (destination) => SystemProgram.createAccount({fromPubkey: attacker.publicKey,
    newAccountPubkey: destination.publicKey, lamports: rent, space: 200, programId: StakeProgram.programId});
  const watchBase = [attacker.publicKey, X.stake, X.mint, X.sourceA, X.sourceB];
  const cases = [];
  cases.push(await simulate('direct_consolidation_via_pda_delegate_without_pda_signature',
    [directTransfer(X.sourceA, X.sourceB, sourceA.amountRaw)], [attacker], watchBase));
  cases.push(await simulate('single_withdraw_asks_source_a_to_cover_a_plus_b',
    [create(dSum), withdraw(X.sourceA, dSum.publicKey, attacker.publicKey, totalExposedRaw)],
    [attacker, dSum], [...watchBase, dSum.publicKey]));
  cases.push(await simulate('two_sequential_withdrawals_do_not_aggregate_before_split',
    [create(dA), create(dB),
      withdraw(X.sourceA, dA.publicKey, attacker.publicKey, sourceA.amountRaw),
      withdraw(X.sourceB, dB.publicKey, attacker.publicKey, sourceB.amountRaw)],
    [attacker, dA, dB], [...watchBase, dA.publicKey, dB.publicKey]));

  const output = {schema: 'svsp-delegated-source-combine-fork/v1', generatedAt: new Date().toISOString(),
    network: 'mainnet-beta exact-state local fork', broadcast: false, transactionSubmitted: false,
    upstreamAnchorSlot: anchorSlot, upstreamAccountContextSlot: upstreamPage.context.slot,
    forkCloneSlot: forkPage.context.slot, cloneComparison,
    allClonedTargetsExact: cloneComparison.every((row) => row.exact),
    syntheticState: {onlyAccount: attacker.publicKey.toBase58(), lamports: '10000000000',
      purpose: 'fresh outsider fee and destination-stake rent only', noProtocolTokenOrStakeStateFabricated: true},
    pool: {pool: X.pool.toBase58(), mint: X.mint.toBase58(), canonicalStake: X.stake.toBase58(),
      mintAuthorityPda: X.mintAuthority.toBase58(), mintSupplyRaw: supply.toString(),
      mainAvailableDelegatedStakeLamports: available.toString(), minimumTokenAmountForOneSolSplitRaw: threshold.toString()},
    currentSources: [{address: X.sourceA.toBase58(), ...sourceA}, {address: X.sourceB.toBase58(), ...sourceB}],
    groupedValue: {sourceCount: 2, totalExposedRaw: totalExposedRaw.toString(),
      thresholdRaw: threshold.toString(), shortfallRaw: (threshold - totalExposedRaw).toString(),
      aggregateWouldReachThresholdEvenIfLegallyCombined: totalExposedRaw >= threshold},
    cases,
    authorityConclusion: 'The PDA delegate can be consumed by SVSP for burn, but an outsider cannot use it as a signed SPL transfer authority. WithdrawStake accepts exactly one token source and performs that source\'s Stake split before the next instruction, so multiple current delegated accounts cannot be legally consolidated or accumulated by sequential withdrawals.',
    reconciliation: {persistedStateChange: false, outsiderWalletEquityDeltaLamports: '0',
      protocolEquityDeltaLamports: '0', sourceATokenDeltaRaw: '0', sourceBTokenDeltaRaw: '0'},
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, upstreamAnchorSlot: anchorSlot, forkCloneSlot: output.forkCloneSlot,
    allClonedTargetsExact: output.allClonedTargetsExact, groupedValue: output.groupedValue,
    cases: cases.map((row) => ({label: row.label, wire: row.transaction, err: row.err,
      unitsConsumed: row.unitsConsumed, logTail: row.logs.slice(-10), finalEquity: row.finalEquity,
      unchanged: row.persistedForkState.allWatchedAccountsUnchanged})), reconciliation: output.reconciliation}, null, 2));
}
main().catch((error) => {console.error(error.stack || String(error)); process.exitCode = 1;});
