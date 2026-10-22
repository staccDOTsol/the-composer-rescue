#!/usr/bin/env node
// Read-only current-state snapshot of the bounded Locp census, with on-chain vesting arithmetic.
// Run: node composer-runs/2026-10-15/locp-economics-snapshot.js
// Set RPC_URL in the environment, or use /tmp/composer-helius-rpc.env as in the census scripts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let PublicKey;
try { ({ PublicKey } = require('@solana/web3.js')); }
catch { ({ PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js')); }

const dir = __dirname;
const programId = 'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn';
const source = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const rows = source.authorities.filter((r) => r.directExecutableOwner === programId);
const envPath = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries((fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '').split(/\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = process.env.RPC_URL || env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const pk = (buf) => new PublicKey(buf).toBase58();
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
      return data.result;
    } catch (error) {
      if (attempt === 4) throw new Error(`${method} failed: ${error.message}`);
      await delay(500 * 2 ** attempt);
    }
  }
}

function parseState(account) {
  if (!account) return { exists: false };
  const b = Buffer.from(account.data[0], 'base64');
  if (b.length !== 296) return { exists: true, owner: account.owner, dataLength: b.length, error: 'unexpected length' };
  const u64 = (offset) => b.readBigUInt64LE(offset).toString();
  return { exists: true, owner: account.owner, dataLength: b.length,
    sha256: hash(b), base64: account.data[0],
    discriminator: Array.from(b.subarray(0, 8)),
    recipient: pk(b.subarray(8, 40)), tokenMint: pk(b.subarray(40, 72)),
    creator: pk(b.subarray(72, 104)), base: pk(b.subarray(104, 136)),
    escrowBump: b[136], updateRecipientMode: b[137], cancelMode: b[138], tokenProgramFlag: b[139],
    cliffTime: u64(144), frequency: u64(152), cliffUnlockAmount: u64(160),
    amountPerPeriod: u64(168), numberOfPeriod: u64(176), totalClaimedAmount: u64(184),
    vestingStartTime: u64(192), cancelledAt: u64(200) };
}

function parseVault(account) {
  if (!account) return { exists: false };
  const b = Buffer.from(account.data[0], 'base64');
  if (b.length < 72) return { exists: true, owner: account.owner, dataLength: b.length, error: 'short token data' };
  return { exists: true, owner: account.owner, dataLength: b.length, sha256: hash(b),
    base64: account.data[0], mint: pk(b.subarray(0, 32)), authority: pk(b.subarray(32, 64)),
    rawAmount: b.readBigUInt64LE(64).toString() };
}

function vested(state, unixTime) {
  const cliff = BigInt(state.cliffTime);
  const claimed = BigInt(state.totalClaimedAmount);
  const initial = BigInt(state.cliffUnlockAmount);
  const frequency = BigInt(state.frequency);
  const periods = BigInt(state.numberOfPeriod);
  const each = BigInt(state.amountPerPeriod);
  const maxUnlocked = unixTime < cliff ? 0n : initial +
    (frequency === 0n ? 0n : ((unixTime - cliff) / frequency < periods ? (unixTime - cliff) / frequency : periods) * each);
  const scheduledTotal = initial + periods * each;
  const scheduledClaimable = maxUnlocked >= claimed ? maxUnlocked - claimed : 0n;
  return { scheduledTotal: scheduledTotal.toString(), maxUnlocked: maxUnlocked.toString(),
    scheduledClaimable: scheduledClaimable.toString(), vestedFraction: scheduledTotal > 0n ?
      Number(maxUnlocked) / Number(scheduledTotal) : null };
}

async function main() {
  const addresses = [...new Set(rows.flatMap((r) => [r.authority, ...r.tokenAccounts.map((t) => t.address)]))];
  const accounts = new Map();
  const slots = [];
  for (let offset = 0; offset < addresses.length; offset += 80) {
    const batch = addresses.slice(offset, offset + 80);
    const result = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', commitment: 'confirmed' }]);
    slots.push(result.context.slot);
    batch.forEach((address, i) => accounts.set(address, result.value[i]));
  }
  const snapshotSlot = Math.max(...slots);
  const blockTime = await rpc('getBlockTime', [snapshotSlot]);
  const unixTime = BigInt(blockTime ?? Math.floor(Date.now() / 1000));
  const entries = rows.map((prior) => {
    const state = parseState(accounts.get(prior.authority));
    const priorVault = prior.tokenAccounts[0];
    const vault = parseVault(accounts.get(priorVault.address));
    const schedule = state.exists && !state.error ? vested(state, unixTime) : null;
    const vaultRaw = vault.exists && !vault.error ? BigInt(vault.rawAmount) : 0n;
    const claimableRaw = schedule && state.cancelledAt === '0' ?
      (BigInt(schedule.scheduledClaimable) < vaultRaw ? BigInt(schedule.scheduledClaimable) : vaultRaw) : 0n;
    const stateValid = state.owner === programId && state.tokenMint === priorVault.mint &&
      JSON.stringify(state.discriminator) === JSON.stringify([244,119,183,4,73,116,135,195]);
    const vaultValid = vault.authority === prior.authority && vault.mint === priorVault.mint &&
      vault.owner === priorVault.tokenProgram;
    return { authority: prior.authority, vaultAddress: priorVault.address, mint: priorVault.mint,
      symbol: priorVault.symbol, tokenProgram: priorVault.tokenProgram, decimals: null,
      censusPriceUsd: priorVault.usdPrice, censusUsdValue: priorVault.usdValue,
      stateValid, vaultValid, state, vault, schedule, claimableRaw: claimableRaw.toString() };
  });
  const output = { generatedAt: new Date().toISOString(), programId, sourceCompletedAt: source.completedAt,
    sourceObservationSlots: source.observationSlots, snapshotSlots: slots, snapshotSlot,
    blockTime, unixTime: unixTime.toString(), entries };
  const file = path.join(dir, 'locp-economics-snapshot.json');
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ file, snapshotSlots: slots, blockTime, entries: entries.length,
    stateValid: entries.filter((x) => x.stateValid).length,
    vaultValid: entries.filter((x) => x.vaultValid).length,
    cancelled: entries.filter((x) => x.state.cancelledAt !== '0').length }, null, 2));
}
main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
