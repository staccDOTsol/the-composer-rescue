#!/usr/bin/env node

// Read-only stake -> xORCA DEX-exit economics and Jupiter direct-route ceiling.
// No transaction is submitted. Quotes are ExactIn and use raw token units.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const outPath = path.join(dir, 'orca-xorca-roundtrip-economics.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const ORCA = live.identities.orcaMint;
const XORCA = live.identities.xorcaMint;
const endpoint = 'https://lite-api.jup.ag/swap/v1/quote';
const assets = BigInt(live.currentAccounts.nonEscrowedOrcaRaw);
const supply = BigInt(live.currentAccounts.xorcaMint.supplyRaw);
const virtual = 100n;

function mintedFor(stakeRaw) {
  return BigInt(stakeRaw) * (supply + virtual) / (assets + virtual);
}

async function quoteXorcaToOrca(amountRaw, extra = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('inputMint', XORCA);
  url.searchParams.set('outputMint', ORCA);
  url.searchParams.set('amount', BigInt(amountRaw).toString());
  url.searchParams.set('swapMode', 'ExactIn');
  url.searchParams.set('slippageBps', '100');
  url.searchParams.set('restrictIntermediateTokens', 'true');
  if (extra.onlyDirectRoutes) url.searchParams.set('onlyDirectRoutes', 'true');
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {headers: {accept: 'application/json'}});
    const body = await response.json();
    return {observedAt, httpStatus: response.status,
      routeAvailable: response.ok && Array.isArray(body.routePlan) && body.routePlan.length > 0,
      inAmount: body.inAmount ?? BigInt(amountRaw).toString(), outAmount: body.outAmount ?? null,
      otherAmountThreshold: body.otherAmountThreshold ?? null,
      priceImpactPct: body.priceImpactPct ?? null, contextSlot: body.contextSlot ?? null,
      routePlan: (body.routePlan || []).map((step) => ({percent: step.percent ?? null,
        ammKey: step.swapInfo?.ammKey ?? null, label: step.swapInfo?.label ?? null,
        inputMint: step.swapInfo?.inputMint ?? null, outputMint: step.swapInfo?.outputMint ?? null,
        inAmount: step.swapInfo?.inAmount ?? null, outAmount: step.swapInfo?.outAmount ?? null})),
      error: body.error ?? null, errorCode: body.errorCode ?? null};
  } catch (error) {
    return {observedAt, httpStatus: null, routeAvailable: false,
      inAmount: BigInt(amountRaw).toString(), outAmount: null, routePlan: [],
      error: String(error), errorCode: null};
  }
}

async function findDirectQuoteCeiling() {
  let low = 1000000000n;
  let high = supply;
  let lowQuote = await quoteXorcaToOrca(low, {onlyDirectRoutes: true});
  const highQuote = await quoteXorcaToOrca(high, {onlyDirectRoutes: true});
  if (!lowQuote.routeAvailable) return {searchPerformed: false, reason: 'lower bound unavailable',
    low: {amountRaw: low.toString(), quote: lowQuote}, high: {amountRaw: high.toString(), quote: highQuote}};
  if (highQuote.routeAvailable) return {searchPerformed: false, reason: 'full live supply quotable',
    exactLastSuccessRaw: high.toString(), exactFirstFailureRaw: null,
    boundary: [{amountRaw: high.toString(), quote: highQuote}]};
  let iterations = 0;
  while (high - low > 1n && iterations < 64) {
    const middle = (low + high) / 2n;
    const quote = await quoteXorcaToOrca(middle, {onlyDirectRoutes: true});
    if (quote.routeAvailable) { low = middle; lowQuote = quote; }
    else high = middle;
    iterations += 1;
  }
  const amounts = [...new Set([low > 0n ? low - 1n : 0n, low, low + 1n, high, high + 1n]
    .filter((value) => value > 0n).map(String))];
  const boundary = [];
  for (const amount of amounts) boundary.push({amountRaw: amount,
    quote: amount === low.toString() ? lowQuote : await quoteXorcaToOrca(amount, {onlyDirectRoutes: true})});
  return {searchPerformed: true, monotonicAssumption: 'Jupiter direct ExactIn route availability',
    iterations, initialSuccessRaw: '1000000000', initialFailureRaw: supply.toString(),
    exactLastSuccessRaw: low.toString(), exactFirstFailureRaw: high.toString(), boundary};
}

async function main() {
  const project0DisplayedRaw = BigInt(live.project0.liquidityVaultAccount.amountRaw);
  const stakes = [...new Set([
    1n, 2n, 3n, 10n, 100n, 1000n, 10000n, 100000n,
    1000000n, 10000000n, 100000000n, 1000000000n,
    project0DisplayedRaw - 1n, project0DisplayedRaw, project0DisplayedRaw + 1n,
    10000000000n, 100000000000n, 1000000000000n, assets,
  ].filter((value) => value > 0n).map(String))].map(BigInt).sort((a, b) => a < b ? -1 : 1);
  const roundTrips = [];
  for (const stakeRaw of stakes) {
    const xorcaMintedRaw = mintedFor(stakeRaw);
    const quote = xorcaMintedRaw > 0n ? await quoteXorcaToOrca(xorcaMintedRaw) : null;
    const out = quote?.routeAvailable ? BigInt(quote.outAmount) : null;
    roundTrips.push({stakeRaw: stakeRaw.toString(), xorcaMintedRaw: xorcaMintedRaw.toString(),
      quote, orcaOutRaw: out?.toString() ?? null,
      orcaOutMinusStakeRaw: out === null ? null : (out - stakeRaw).toString(),
      positiveBeforeFlashFees: out !== null && out > stakeRaw});
  }
  const ceiling = await findDirectQuoteCeiling();
  const output = {generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    endpointClass: 'Jupiter Lite Quote API', request: {swapMode: 'ExactIn', slippageBps: 100,
      restrictIntermediateTokens: true}, context: {assetsRaw: assets.toString(),
      supplyRaw: supply.toString(), virtualAssetsRaw: virtual.toString(),
      virtualSharesRaw: virtual.toString(), project0DisplayedOrcaRaw: project0DisplayedRaw.toString()},
    formula: 'xORCA minted = floor(stake * (supply + 100) / (nonEscrowed ORCA + 100))',
    roundTrips, directRouteQuoteCeiling: ceiling,
    summary: {testedStakeAmounts: roundTrips.length,
      quotedRoundTrips: roundTrips.filter((row) => row.orcaOutRaw !== null).length,
      positiveBeforeFlashFees: roundTrips.filter((row) => row.positiveBeforeFlashFees),
      bestQuotedDeltaRaw: roundTrips.filter((row) => row.orcaOutMinusStakeRaw !== null)
        .reduce((best, row) => best === null || BigInt(row.orcaOutMinusStakeRaw) > BigInt(best)
          ? row.orcaOutMinusStakeRaw : best, null)},
    interpretation: 'This is the best-case ORCA-denominated stake-to-secondary-market exit before lender fees, stable/ORCA swap fees, priority fees, and slippage threshold execution. A non-positive result cannot become positive when those omitted costs are added.'};
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, summary: output.summary,
    roundTrips: roundTrips.map((row) => ({stakeRaw: row.stakeRaw,
      xorcaMintedRaw: row.xorcaMintedRaw, outRaw: row.orcaOutRaw,
      deltaRaw: row.orcaOutMinusStakeRaw, route: row.quote?.routeAvailable ?? false})),
    directRouteQuoteCeiling: {exactLastSuccessRaw: ceiling.exactLastSuccessRaw,
      exactFirstFailureRaw: ceiling.exactFirstFailureRaw,
      boundary: ceiling.boundary?.map((row) => ({amountRaw: row.amountRaw,
        available: row.quote.routeAvailable, outAmount: row.quote.outAmount,
        errorCode: row.quote.errorCode}))}}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
