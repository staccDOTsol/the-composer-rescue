#!/usr/bin/env node

// Read-only Jupiter route census for the live ORCA/xORCA pair. This checks
// whether xORCA received from Stake can be liquidated inside a flash-loan
// transaction instead of waiting through the protocol's withdrawal cooldown.
const fs = require('fs');
const path = require('path');

const ORCA = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const XORCA = 'xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const endpoint = 'https://lite-api.jup.ag/swap/v1/quote';
const outPath = path.join(__dirname, 'orca-xorca-jupiter-liquidity.json');

const probes = [
  ...['1', '2', '1000000', '1000000000', '4903464351105'].map((amount) => ({
    direction: 'xORCA->ORCA', inputMint: XORCA, outputMint: ORCA, amount,
  })),
  ...['1', '2', '1000000', '1000000000', '8289625983285'].map((amount) => ({
    direction: 'ORCA->xORCA', inputMint: ORCA, outputMint: XORCA, amount,
  })),
  ...['1000000', '1000000000', '4903464351105'].map((amount) => ({
    direction: 'xORCA->USDC', inputMint: XORCA, outputMint: USDC, amount,
  })),
];

async function quote(probe) {
  const url = new URL(endpoint);
  url.searchParams.set('inputMint', probe.inputMint);
  url.searchParams.set('outputMint', probe.outputMint);
  url.searchParams.set('amount', probe.amount);
  url.searchParams.set('swapMode', 'ExactIn');
  url.searchParams.set('slippageBps', '100');
  // Jupiter Lite currently supports its default stable-intermediate set only.
  // Direct xORCA markets, if any, are still discoverable under this setting.
  url.searchParams.set('restrictIntermediateTokens', 'true');
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {headers: {accept: 'application/json'}});
    let body;
    try {
      body = await response.json();
    } catch (error) {
      body = {error: `non-JSON response: ${error.message}`};
    }
    return {
      ...probe,
      observedAt,
      httpStatus: response.status,
      routeAvailable: response.ok && Array.isArray(body.routePlan) && body.routePlan.length > 0,
      inAmount: body.inAmount ?? null,
      outAmount: body.outAmount ?? null,
      otherAmountThreshold: body.otherAmountThreshold ?? null,
      priceImpactPct: body.priceImpactPct ?? null,
      contextSlot: body.contextSlot ?? null,
      timeTaken: body.timeTaken ?? null,
      routePlan: (body.routePlan || []).map((step) => ({
        percent: step.percent ?? null,
        bps: step.bps ?? null,
        ammKey: step.swapInfo?.ammKey ?? null,
        label: step.swapInfo?.label ?? null,
        inputMint: step.swapInfo?.inputMint ?? null,
        outputMint: step.swapInfo?.outputMint ?? null,
        inAmount: step.swapInfo?.inAmount ?? null,
        outAmount: step.swapInfo?.outAmount ?? null,
        feeAmount: step.swapInfo?.feeAmount ?? null,
        feeMint: step.swapInfo?.feeMint ?? null,
      })),
      error: body.error ?? null,
      errorCode: body.errorCode ?? null,
    };
  } catch (error) {
    return {...probe, observedAt, httpStatus: null, routeAvailable: false,
      error: String(error), errorCode: null, routePlan: []};
  }
}

async function main() {
  const results = [];
  for (const probe of probes) results.push(await quote(probe));
  const byDirection = Object.fromEntries([...new Set(results.map((row) => row.direction))]
    .map((direction) => {
      const rows = results.filter((row) => row.direction === direction);
      return [direction, {
        probes: rows.length,
        routesAvailable: rows.filter((row) => row.routeAvailable).length,
        anyRouteAvailable: rows.some((row) => row.routeAvailable),
      }];
    }));
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    liveSubmission: false,
    endpointClass: 'Jupiter Lite Quote API',
    request: {swapMode: 'ExactIn', slippageBps: 100, restrictIntermediateTokens: true},
    mints: {ORCA, xORCA: XORCA, USDC},
    byDirection,
    results,
    interpretation: 'A reverse route is required to turn freshly minted xORCA back into a flash lender repayment asset in the same atomic transaction without invoking the seven-day Withdraw cooldown.',
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, byDirection,
    results: results.map((row) => ({direction: row.direction, amount: row.amount,
      status: row.httpStatus, routeAvailable: row.routeAvailable, outAmount: row.outAmount,
      labels: row.routePlan.map((step) => step.label), error: row.error,
      errorCode: row.errorCode}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
