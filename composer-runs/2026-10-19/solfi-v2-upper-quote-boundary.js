#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'solfi-v2-upper-quote-boundary.json');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const POOL = 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32';

async function probe(amount) {
  const params = new URLSearchParams({inputMint: USDC, outputMint: USDT,
    amount: amount.toString(), slippageBps: '100', onlyDirectRoutes: 'true',
    maxAccounts: '24', dexes: 'SolFi V2'});
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`,
      {signal: AbortSignal.timeout(60_000)});
    const body = await response.json();
    if (response.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    const exact = response.ok && body.routePlan?.length === 1 &&
      body.routePlan[0].swapInfo?.label === 'SolFi V2' &&
      body.routePlan[0].swapInfo?.ammKey === POOL;
    return {amountRaw: amount.toString(), accepted: exact, status: response.status,
      contextSlot: body.contextSlot || null, outAmountRaw: body.outAmount || null,
      error: exact ? null : body.error || body.errorCode || 'not exact SolFi V2'};
  }
  throw new Error('rate limit retries exhausted');
}

async function main() {
  let low = 400_000_000_000n;
  let high = 600_000_000_000n;
  const probes = [];
  const lowProbe = await probe(low); probes.push(lowProbe);
  const highProbe = await probe(high); probes.push(highProbe);
  if (!lowProbe.accepted || highProbe.accepted) throw new Error('invalid initial bracket');
  // One-USDC resolution is enough for a practical executable upper edge and
  // avoids pretending a moving quote service has a permanent one-atom bound.
  while (high - low > 1_000_000n) {
    const mid = ((low + high) / 2n / 1_000_000n) * 1_000_000n;
    const row = await probe(mid); probes.push(row);
    if (row.accepted) low = mid; else high = mid;
  }
  const finalLow = await probe(low); probes.push(finalLow);
  const finalHigh = await probe(high); probes.push(finalHigh);
  const acceptedRows = probes.filter(row => row.accepted);
  const rejectedRows = probes.filter(row => !row.accepted);
  const largestAcceptedRaw = acceptedRows.reduce((max, row) =>
    BigInt(row.amountRaw) > max ? BigInt(row.amountRaw) : max, 0n);
  const lowestRejectedRaw = rejectedRows.reduce((min, row) =>
    BigInt(row.amountRaw) < min ? BigInt(row.amountRaw) : min, 2n ** 64n);
  const movingBoundary = largestAcceptedRaw >= lowestRejectedRaw;
  const result = {generatedAtUtc: new Date().toISOString(), exactPool: POOL,
    resolutionRaw: '1000000', largestObservedAcceptedRaw: largestAcceptedRaw.toString(),
    lowestObservedRejectedRaw: lowestRejectedRaw.toString(), movingBoundary,
    staticBracket: movingBoundary ? null : {largestAcceptedRaw: low.toString(),
      firstRejectedRaw: high.toString()}, finalRechecks: {low: finalLow, high: finalHigh},
    probes, safety: {broadcast: false}};
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
