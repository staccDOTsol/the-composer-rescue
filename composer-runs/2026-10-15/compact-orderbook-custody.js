// Mechanical compaction of the full custody evidence for human review.
const fs = require('fs');
const source = JSON.parse(fs.readFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/orderbook-dex-custody.json'));
let results = source.results.map(result => {
  const verified = (result.rows || []).filter(x => x.controlVerified);
  const byVault = new Map();
  for (const row of verified) {
    const prior = byVault.get(row.address);
    if (!prior || (row.valuation?.usdValue || 0) > (prior.valuation?.usdValue || 0)) byVault.set(row.address, row);
  }
  const unique = [...byVault.values()];
  const compactRow = row => ({state: row.state, kind: row.kind, vault: row.address, mint: row.mint,
    rawAmount: row.rawAmount, tokenProgram: row.tokenProgram, valuation: row.valuation || null, proof: row.proof});
  const discovery = Object.fromEntries(Object.entries(result)
    .filter(([key]) => key.endsWith('Discovery') || key === 'discovery')
    .map(([key, value]) => [key, value]));
  return {name: result.name, program: result.program, status: result.status, blocker: result.blocker || null,
    discovery, stateAccountsDecoded: result.stateAccountsDecoded,
    reachableRootBanks: result.reachableRootBanks, reachableNodeBanks: result.reachableNodeBanks,
    summary: {...result.summary, verifiedUniqueVaults: unique.length,
      pricedUniqueGrossUsd: unique.reduce((sum, row) => sum + (row.valuation?.usdValue || 0), 0)},
    topPricedUniqueVaults: unique.filter(x => x.valuation).sort((a, b) => b.valuation.usdValue - a.valuation.usdValue).slice(0, 25).map(compactRow),
    topUnpricedUniqueVaults: unique.filter(x => !x.valuation).sort((a, b) => BigInt(a.rawAmount) === BigInt(b.rawAmount) ? 0 : BigInt(a.rawAmount) > BigInt(b.rawAmount) ? -1 : 1).slice(0, 10).map(compactRow)};
});
const legacyPath = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/legacy-dex-official-registry.json';
if (fs.existsSync(legacyPath)) {
  const legacy = JSON.parse(fs.readFileSync(legacyPath));
  for (const result of legacy.results) {
    const compactRow = row => ({state: row.state, market: row.market, deprecated: row.deprecated,
      kind: row.side, vault: row.vault, mint: row.mint, rawAmount: row.rawAmount,
      tokenProgram: row.tokenProgram, valuation: row.valuation || null, proof: row.proof});
    const replacement = {name: result.name, program: result.program, status: 'completed', blocker: null,
      discovery: {officialRegistry: {url: result.registryUrl, entries: result.registryEntries,
        deprecatedEntries: result.registryDeprecatedEntries, currentDecodedMarkets: result.currentDecodedMarkets,
        unavailable: result.unavailable}},
      summary: {referencedVaultRows: result.referencedVaults, verifiedNonzeroVaults: result.verifiedNonzeroVaults,
        pricedVaults: result.pricedVaults, unpricedVaults: result.unpricedVaults,
        pricedGrossUsd: result.pricedGrossUsd, verifiedUniqueVaults: result.verifiedNonzeroVaults,
        pricedUniqueGrossUsd: result.pricedGrossUsd},
      topPricedUniqueVaults: result.rows.filter(x => x.valuation).sort((a, b) => b.valuation.usdValue - a.valuation.usdValue).slice(0, 25).map(compactRow),
      topUnpricedUniqueVaults: result.rows.filter(x => !x.valuation).sort((a, b) => BigInt(a.rawAmount) === BigInt(b.rawAmount) ? 0 : BigInt(a.rawAmount) > BigInt(b.rawAmount) ? -1 : 1).slice(0, 10).map(compactRow)};
    results = results.filter(x => x.name !== result.name).concat(replacement);
  }
}
const out = {timestamp: source.timestamp, slots: source.slots,
  denominator: {
    mainExchangeDeployments: 8,
    supportPrograms: 1,
    completedMainExchangeDeployments: 8,
    completedSupportPrograms: 1,
    stateDiscoveryDeployments: 6,
    officialRegistryDeployments: 2,
    legacyRegistryMarkets: 186,
    names: results.map(result => ({name: result.name, program: result.program, status: result.status})),
    exhaustiveAllSolanaPrograms: false
  },
  coverageDefinition: 'Eight named material orderbook/exchange deployments selected from official first-party repositories, plus one Phoenix backing program; not all deployed Solana programs. Six exchange deployments used state-account discovery, two legacy deployments used every address in their official first-party market registries, and the backing program used its canonical state.',
  overlapWarning: source.overlapWarning, results};
fs.writeFileSync('/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/orderbook-dex-custody-summary.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(results.map(x => ({name: x.name, status: x.status, ...x.summary})).sort((a, b) => b.pricedUniqueGrossUsd - a.pricedUniqueGrossUsd), null, 2));
