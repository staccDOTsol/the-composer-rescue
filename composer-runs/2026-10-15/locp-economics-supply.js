#!/usr/bin/env node
// Read-only mint supply context for the sampled Locp vaults.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dir = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'locp-economics-snapshot.json')));
const source = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const byAddress = new Map(source.tokenAccounts.map((v) => [v.address, v]));
const envPath = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries((fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '').split(/\n/)
  .filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = process.env.RPC_URL || env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const byMint = new Map();
for (const e of snapshot.entries) {
  const prior = byAddress.get(e.vaultAddress);
  const row = byMint.get(e.mint) || { mint: e.mint, symbol: e.symbol, tokenProgram: e.tokenProgram,
    decimals: prior.decimals, vaultCount: 0, rawVaultAmount: 0n, rawClaimableAmount: 0n,
    censusUsdPrice: e.censusPriceUsd };
  row.vaultCount++;
  row.rawVaultAmount += BigInt(e.vault.rawAmount);
  row.rawClaimableAmount += BigInt(e.claimableRaw);
  byMint.set(e.mint, row);
}
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
  return data.result;
}
async function main() {
  const mints = [...byMint.keys()];
  const result = await rpc('getMultipleAccounts', [mints, { encoding: 'base64', commitment: 'confirmed' }]);
  const rows = mints.map((mint, i) => {
    const row = byMint.get(mint);
    const acct = result.value[i];
    if (!acct) return { ...row, rawVaultAmount: row.rawVaultAmount.toString(),
      rawClaimableAmount: row.rawClaimableAmount.toString(), mintExists: false };
    const b = Buffer.from(acct.data[0], 'base64');
    const supply = b.length >= 45 ? b.readBigUInt64LE(36) : null;
    return { ...row, rawVaultAmount: row.rawVaultAmount.toString(),
      rawClaimableAmount: row.rawClaimableAmount.toString(), mintExists: true,
      mintOwner: acct.owner, mintDataLength: b.length, mintSha256: crypto.createHash('sha256').update(b).digest('hex'),
      mintBase64: acct.data[0], mintRawSupply: supply?.toString() ?? null,
      mintDecimals: b.length >= 45 ? b[44] : null,
      vaultShareOfMintSupply: supply && supply > 0n ? Number(row.rawVaultAmount) / Number(supply) : null,
      ownerMatchesVaultProgram: acct.owner === row.tokenProgram,
      decimalsMatchCensus: b.length >= 45 && b[44] === row.decimals };
  });
  const output = { generatedAt: new Date().toISOString(), snapshotSlot: snapshot.snapshotSlot,
    mintObservationSlot: result.context.slot, rows };
  fs.writeFileSync(path.join(dir, 'locp-economics-supply.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ slot: result.context.slot, mints: rows.length,
    validMintOwners: rows.filter((r) => r.ownerMatchesVaultProgram).length,
    validDecimals: rows.filter((r) => r.decimalsMatchCensus).length,
    top: rows.sort((a,b) => (Number(b.rawVaultAmount)/10**b.decimals*b.censusUsdPrice) -
      (Number(a.rawVaultAmount)/10**a.decimals*a.censusUsdPrice)).slice(0, 14).map((r) => ({
        symbol: r.symbol, share: r.vaultShareOfMintSupply })) }, null, 2));
}
main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
