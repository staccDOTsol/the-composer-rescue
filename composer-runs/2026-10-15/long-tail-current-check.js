#!/usr/bin/env node
// Helius current-state recheck of candidate off-curve state authorities and vaults.
const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const DIR = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(DIR, 'mainnet-token-authority-census.raw.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\n/)
  .filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.RPC_URL;
if (!endpoint) throw new Error('RPC_URL unavailable');
const universe = new Map(fs.readFileSync(path.join(DIR, 'mainnet-program-universe.csv'), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [programId, loaderClass, owner, programdataAddress, observedSlot] = line.split(',');
    return [programId, { loaderClass, owner, programdataAddress, observedSlot: Number(observedSlot) }];
  }));
const programs = [
  'magnaSHyv8zzKJJmr8NSz5JXmtdGDTTFPEADmvNAwbj',
  'vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K',
  'gr8tqq2ripsM6N46gLWpSDXtdrH6J9jaXoyya1ELC9t',
  'LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn',
  '5UuMSVm7pqAYc7E3mLnj6F3K28QD7BwgULXtKKh7tSf9',
  'EyxPPowqBRTpZpiDb2ixUR6XUU1VJwTCNgJdK8eyc6kc',
  'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ',
  'jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS',
];
async function rpc(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.code} ${data.error.message}`);
  return data.result;
}
async function main() {
  const registryResponse = await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified');
  if (!registryResponse.ok) throw new Error(`registry HTTP ${registryResponse.status}`);
  const registry = new Map((await registryResponse.json()).map((token) => [token.id, token]));
  const groups = source.authorities.filter((row) => programs.includes(row.directExecutableOwner))
    .sort((a, b) => b.pricedGrossUsd - a.pricedGrossUsd);
  const selected = [];
  for (const programId of programs) selected.push(...groups.filter((row) => row.directExecutableOwner === programId).slice(0, 3));
  const addresses = [...new Set(selected.flatMap((row) => [row.authority, row.directExecutableOwner,
    universe.get(row.directExecutableOwner)?.programdataAddress, ...row.tokenAccounts.slice(0, 3).map((a) => a.address)])
    .filter(Boolean))];
  const accounts = new Map();
  const slots = [];
  for (let offset = 0; offset < addresses.length; offset += 100) {
    const batch = addresses.slice(offset, offset + 100);
    const result = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', commitment: 'confirmed',
      dataSlice: { offset: 0, length: 72 } }]);
    slots.push(result.context.slot);
    batch.forEach((address, i) => { accounts.set(address, result.value[i]); });
  }
  const rows = selected.map((group) => {
    const programId = group.directExecutableOwner;
    const programAccount = accounts.get(programId);
    const programDataAddress = universe.get(programId)?.programdataAddress;
    const programData = accounts.get(programDataAddress);
    const programDataBytes = programData ? Buffer.from(programData.data[0], 'base64') : null;
    const authority = accounts.get(group.authority);
    const vaults = group.tokenAccounts.slice(0, 3).map((prior) => {
      const info = accounts.get(prior.address);
      if (!info) return { address: prior.address, exists: false };
      const data = Buffer.from(info.data[0], 'base64');
      const mint = data.length >= 32 ? new PublicKey(data.subarray(0, 32)).toBase58() : null;
      const tokenAuthority = data.length >= 64 ? new PublicKey(data.subarray(32, 64)).toBase58() : null;
      const rawAmount = data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
      const token = registry.get(mint);
      const currentUsdPrice = Number.isFinite(token?.usdPrice) ? token.usdPrice : null;
      return { address: prior.address, exists: true, mint, tokenAuthority, rawAmount,
        tokenProgram: info.owner, mintMatches: mint === prior.mint,
        authorityMatches: tokenAuthority === group.authority,
        symbol: token?.symbol || prior.symbol, decimals: token?.decimals ?? null,
        usdPrice: currentUsdPrice, liquidity: token?.liquidity ?? null,
        updatedAt: token?.updatedAt ?? null,
        markUsd: currentUsdPrice !== null && Number.isFinite(token?.decimals) ?
          Number(rawAmount) / 10 ** token.decimals * currentUsdPrice : null };
    });
    return { programId, authority: group.authority, authorityOffCurve: !group.onCurve,
      programExecutableNow: programAccount?.executable === true,
      programOwnerNow: programAccount?.owner || null,
      programDataAddress, programDataTag: programDataBytes?.length >= 4 ? programDataBytes.readUInt32LE(0) : null,
      upgradeSlot: programDataBytes?.length >= 12 ? Number(programDataBytes.readBigUInt64LE(4)) : null,
      authorityExistsNow: Boolean(authority), authorityOwnerNow: authority?.owner || null,
      authorityOwnedByProgramNow: authority?.owner === programId,
      vaults, matchedMarkUsd: vaults.filter((v) => v.authorityMatches && v.mintMatches && v.markUsd !== null)
        .reduce((sum, v) => sum + v.markUsd, 0) };
  });
  const report = { generatedAt: new Date().toISOString(), observationSlots: slots,
    sourceCompletedAt: source.completedAt, selectedAuthorities: selected.length, rows };
  fs.writeFileSync(path.join(DIR, 'long-tail-current-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(rows.map((row) => ({ programId: row.programId,
    authority: row.authority, custodyUsd: row.matchedMarkUsd, authorityOwnedByProgramNow: row.authorityOwnedByProgramNow,
    programExecutableNow: row.programExecutableNow, upgradeSlot: row.upgradeSlot,
    vaultMatches: row.vaults.map((v) => v.authorityMatches && v.mintMatches) })), null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
