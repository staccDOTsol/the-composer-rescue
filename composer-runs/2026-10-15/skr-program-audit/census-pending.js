#!/usr/bin/env node
// Read-only, bounded dataSlice census of live UserStake pending withdrawals.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
const CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
const VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const usePrimary = process.env.SKR_CENSUS_RPC === 'primary';
const endpoint = usePrimary ? env.RPC_URL : env.HEAVY_RPC_URL;
const out = path.join(__dirname, usePrimary ? 'pending-census-primary.json' : 'pending-census.json');
const u128 = (b, offset) => { let n = 0n; for (let i = 15; i >= 0; i--) n = (n << 8n) + BigInt(b[offset + i]); return n; };
async function rpc(endpoint, method, params, timeoutMs = 45000) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error(`${method}: ${JSON.stringify(json.error || response.status)}`);
  return json.result;
}
async function snapshot() {
  const result = await rpc(endpoint, 'getMultipleAccounts', [[CONFIG, VAULT], { encoding: 'base64', commitment: 'confirmed' }], 10000);
  const config = Buffer.from(result.value[0].data[0], 'base64');
  const vault = Buffer.from(result.value[1].data[0], 'base64');
  const shares = u128(config, 121), price = u128(config, 137), amount = vault.readBigUInt64LE(64);
  return { slot: result.context.slot, vaultRaw: amount.toString(), totalShares: shares.toString(),
    sharePrice: price.toString(), shareClaimFloorRaw: (shares * price / 1000000000n).toString(),
    residualAfterShareClaimRaw: (amount - shares * price / 1000000000n).toString(),
    lastVaultRaw: config.readBigUInt64LE(185).toString() };
}
async function main() {
  const before = await snapshot();
  let rows;
  try {
    rows = await rpc(endpoint, 'getProgramAccounts', [PROGRAM,
      { encoding: 'base64', commitment: 'confirmed', withContext: true,
        filters: [{ dataSize: 169 }, { memcmp: { offset: 0, bytes: 'J6ZWGMgjwQC' } },
          { memcmp: { offset: 9, bytes: CONFIG } }], dataSlice: { offset: 105, length: 64 } }]);
  } catch (error) {
    const failure = { generatedAt: new Date().toISOString(), noTransactionsSubmitted: true,
      before, censusError: error.message };
    fs.writeFileSync(out, `${JSON.stringify(failure, null, 2)}\n`);
    console.log(JSON.stringify(failure, null, 2));
    return;
  }
  const accounts = rows.value || rows;
  let pendingRaw = 0n, activeShares = 0n, positiveCount = 0, malformed = 0;
  const largest = [];
  for (const row of accounts) {
    const bytes = Buffer.from(row.account.data[0], 'base64');
    if (bytes.length !== 64) { malformed += 1; continue; }
    activeShares += u128(bytes, 0);
    const amount = bytes.readBigUInt64LE(48), timestamp = bytes.readBigInt64LE(56);
    pendingRaw += amount;
    if (amount > 0n) {
      positiveCount += 1;
      largest.push({ account: row.pubkey, pendingRaw: amount.toString(), timestamp: timestamp.toString() });
      largest.sort((a, b) => BigInt(a.pendingRaw) > BigInt(b.pendingRaw) ? -1 : 1);
      if (largest.length > 10) largest.pop();
    }
  }
  const after = await snapshot();
  const report = { generatedAt: new Date().toISOString(), noTransactionsSubmitted: true,
    provider: usePrimary ? 'primary Helius RPC' : 'heavy Flux RPC',
    method: 'getProgramAccounts dataSize=169, UserStake discriminator at offset 0, this StakeConfig at offset 9, dataSlice offset=105 length=64',
    censusSlot: rows.context?.slot ?? null, accountCount: accounts.length, malformed,
    positiveCount, pendingSumRaw: pendingRaw.toString(), activeUserSharesSum: activeShares.toString(), largest, before, after,
    activeUserSharesMinusConfigBefore: (activeShares - BigInt(before.totalShares)).toString(),
    activeUserSharesMinusConfigAfter: (activeShares - BigInt(after.totalShares)).toString(),
    pendingMinusResidualBeforeRaw: (pendingRaw - BigInt(before.residualAfterShareClaimRaw)).toString(),
    pendingMinusResidualAfterRaw: (pendingRaw - BigInt(after.residualAfterShareClaimRaw)).toString() };
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
