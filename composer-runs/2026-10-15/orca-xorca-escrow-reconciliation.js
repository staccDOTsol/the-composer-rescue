#!/usr/bin/env node

// Read-only repeated-slot reconciliation of the xORCA escrow counter against
// every live PendingWithdraw account. No transaction is signed or submitted.
const fs = require('fs');
const crypto = require('crypto');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const OUTPUT = `${__dirname}/orca-xorca-escrow-reconciliation.json`;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
// Prefer the archival/general endpoint: one heavy endpoint returned a stale
// getProgramAccounts view while advertising a newer context slot.
const urls = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!urls.length) throw new Error('No read-only RPC configured');

const PROGRAM = 'StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT';
const STATE = 'CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK';
const VAULT = 'Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5';
let id = 0;

async function rpc(method, params) {
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      const body = await response.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      if (body.result !== null && body.result !== undefined) return body.result;
      errors.push('null result');
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`${method} failed on configured RPCs: ${errors.join(' | ')}`);
}

function parsePending(row) {
  const data = Buffer.from(row.account.data[0], 'base64');
  if (row.account.owner !== PROGRAM || data.length !== 1024 || data[0] !== 2) return null;
  const bump = data[6];
  const index = data[7];
  const unstaker = new PublicKey(data.subarray(8, 40));
  const [expectedAddress, expectedBump] = PublicKey.findProgramAddressSync([
    Buffer.from('pending_withdraw'), unstaker.toBuffer(), Buffer.from([index]),
  ], new PublicKey(PROGRAM));
  return {
    address: row.pubkey,
    bump,
    index,
    unstaker: unstaker.toString(),
    amountRaw: data.readBigUInt64LE(40),
    timestamp: data.readBigInt64LE(48),
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    expectedAddress: expectedAddress.toString(),
    expectedBump,
    signerPdaMatchesStoredData: row.pubkey === expectedAddress.toString() && bump === expectedBump,
  };
}

function parseState(result) {
  const data = Buffer.from(result.value.data[0], 'base64');
  return {
    contextSlot: result.context.slot,
    owner: result.value.owner,
    dataLength: data.length,
    discriminator: data[0],
    escrowedOrcaRaw: data.readBigUInt64LE(8).toString(),
    cooldownSeconds: data.readBigInt64LE(16).toString(),
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function parseVault(result) {
  const data = Buffer.from(result.value.data[0], 'base64');
  return {
    contextSlot: result.context.slot,
    owner: result.value.owner,
    dataLength: data.length,
    amountRaw: data.readBigUInt64LE(64).toString(),
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

async function scan(minContextSlot) {
  const pendingResult = await rpc('getProgramAccounts', [PROGRAM, {
    encoding: 'base64',
    commitment: 'confirmed',
    withContext: true,
    minContextSlot,
    filters: [{dataSize: 1024}],
  }]);
  const pending = pendingResult.value.map(parsePending).filter(Boolean)
    .sort((left, right) => left.address.localeCompare(right.address));
  const floor = pendingResult.context.slot;
  const [stateResult, vaultResult] = await Promise.all([
    rpc('getAccountInfo', [STATE, {encoding: 'base64', commitment: 'confirmed', minContextSlot: floor}]),
    rpc('getAccountInfo', [VAULT, {encoding: 'base64', commitment: 'confirmed', minContextSlot: floor}]),
  ]);
  const state = parseState(stateResult);
  const vault = parseVault(vaultResult);
  const total = pending.reduce((sum, row) => sum + row.amountRaw, 0n);
  const structurallyValid = pending.filter((row) => row.signerPdaMatchesStoredData);
  const structurallyInvalid = pending.filter((row) => !row.signerPdaMatchesStoredData);
  const validTotal = structurallyValid.reduce((sum, row) => sum + row.amountRaw, 0n);
  const invalidTotal = structurallyInvalid.reduce((sum, row) => sum + row.amountRaw, 0n);
  const matured = pending.filter((row) => row.timestamp <= BigInt(Math.floor(Date.now() / 1000)));
  const fingerprint = crypto.createHash('sha256').update(pending.map((row) =>
    `${row.address}:${row.amountRaw}:${row.timestamp}:${row.dataSha256}`).join('\n')).digest('hex');
  return {
    requestedMinContextSlot: minContextSlot,
    pendingContextSlot: pendingResult.context.slot,
    state,
    vault,
    pendingCount: pending.length,
    maturedCount: matured.length,
    pendingTotalRaw: total.toString(),
    structurallyValidPendingCount: structurallyValid.length,
    structurallyValidPendingTotalRaw: validTotal.toString(),
    structurallyInvalidPendingCount: structurallyInvalid.length,
    structurallyInvalidPendingTotalRaw: invalidTotal.toString(),
    escrowMinusPendingRaw: (BigInt(state.escrowedOrcaRaw) - total).toString(),
    escrowMinusStructurallyValidPendingRaw: (BigInt(state.escrowedOrcaRaw) - validTotal).toString(),
    vaultMinusPendingRaw: (BigInt(vault.amountRaw) - total).toString(),
    fingerprint,
    largestPending: [...pending].sort((left, right) => left.amountRaw === right.amountRaw ? 0 :
      left.amountRaw > right.amountRaw ? -1 : 1).slice(0, 10).map((row) => ({
        address: row.address,
        index: row.index,
        amountRaw: row.amountRaw.toString(),
        timestamp: row.timestamp.toString(),
      })),
    structurallyInvalidPending: structurallyInvalid.map((row) => ({
      address: row.address,
      bump: row.bump,
      index: row.index,
      unstaker: row.unstaker,
      amountRaw: row.amountRaw.toString(),
      timestamp: row.timestamp.toString(),
      expectedAddress: row.expectedAddress,
      expectedBump: row.expectedBump,
    })),
  };
}

async function main() {
  let minimum = await rpc('getSlot', [{commitment: 'confirmed'}]);
  const scans = [];
  for (let round = 0; round < 3; round += 1) {
    const result = await scan(minimum);
    scans.push(result);
    minimum = Math.max(result.pendingContextSlot, result.state.contextSlot,
      result.vault.contextSlot);
  }
  const latestStateSignatures = await rpc('getSignaturesForAddress', [STATE,
    {commitment: 'confirmed', limit: 10}]);
  const output = {
    generatedAt: new Date().toISOString(),
    scope: 'read-only repeated confirmed snapshots; no transaction signed or submitted',
    program: PROGRAM,
    state: STATE,
    vault: VAULT,
    scans,
    stablePendingFingerprint: scans.every((row) => row.fingerprint === scans[0].fingerprint),
    stableStateHash: scans.every((row) => row.state.dataSha256 === scans[0].state.dataSha256),
    stableVaultHash: scans.every((row) => row.vault.dataSha256 === scans[0].vault.dataSha256),
    persistentMismatch: scans.every((row) => row.escrowMinusPendingRaw !== '0'),
    latestStateSignatures: latestStateSignatures.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      blockTime: row.blockTime,
      err: row.err,
    })),
    interpretationBoundary: 'A persistent escrow/claim mismatch can impair rightful beneficiaries, but is not an outsider asset-gain finding without a demonstrated positive outsider-equity path.',
    rpcUrlsStored: false,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, scans: scans.map((row) => ({
    pendingContextSlot: row.pendingContextSlot,
    stateContextSlot: row.state.contextSlot,
    count: row.pendingCount,
    pendingTotalRaw: row.pendingTotalRaw,
    escrowRaw: row.state.escrowedOrcaRaw,
    escrowMinusPendingRaw: row.escrowMinusPendingRaw,
    structurallyValidPendingCount: row.structurallyValidPendingCount,
    structurallyInvalidPendingCount: row.structurallyInvalidPendingCount,
    escrowMinusStructurallyValidPendingRaw: row.escrowMinusStructurallyValidPendingRaw,
    fingerprint: row.fingerprint,
  })), stablePendingFingerprint: output.stablePendingFingerprint,
  stableStateHash: output.stableStateHash, persistentMismatch: output.persistentMismatch}, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
