#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INPUT = path.join(ROOT, 'svsp-live-finalized-evidence.json');
const OUTPUT = path.join(ROOT, 'svsp-jupiter-route-probe.json');
const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';

async function quote(inputMint, outputMint, amount) {
  const url = new URL(QUOTE);
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amount.toString());
  url.searchParams.set('slippageBps', '50');
  url.searchParams.set('swapMode', 'ExactIn');
  const response = await fetch(url, {signal: AbortSignal.timeout(20_000)});
  const body = await response.json().catch(() => ({error: `non-JSON HTTP ${response.status}`}));
  if (!response.ok || body.error) {
    return {ok: false, httpStatus: response.status, error: body.error || body, errorCode: body.errorCode || null};
  }
  return {
    ok: true,
    inAmount: body.inAmount,
    outAmount: body.outAmount,
    otherAmountThreshold: body.otherAmountThreshold,
    priceImpactPct: body.priceImpactPct,
    contextSlot: body.contextSlot,
    timeTaken: body.timeTaken,
    route: (body.routePlan || []).map((leg) => ({
      label: leg.swapInfo?.label || null,
      ammKey: leg.swapInfo?.ammKey || null,
      inAmount: leg.swapInfo?.inAmount || null,
      outAmount: leg.swapInfo?.outAmount || null,
      feeAmount: leg.swapInfo?.feeAmount || null,
      feeMint: leg.swapInfo?.feeMint || null,
      percent: leg.percent,
    })),
  };
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return output;
}

async function main() {
  const evidence = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const activeOnrampPools = new Set(
    evidence.epochFieldMergePrerequisitePools.map((row) => row.pool),
  );
  const delegatedPools = new Set(
    evidence.withdrawalExposuresByPool.map((row) => row.pool),
  );
  const rows = await mapLimit(evidence.pools, 8, async (row) => {
    const supply = BigInt(row.mintAccount.supplyRaw);
    const delegated = BigInt(row.stakeAccount.delegatedStakeLamports);
    const pricing = delegated > 1_000_000_000n ? delegated - 1_000_000_000n : 0n;
    const oneSolTokenThreshold = pricing > 0n
      ? (1_000_000_000n * supply + pricing - 1n) / pricing
      : null;
    const reverseProbeAmount = oneSolTokenThreshold === null
      ? (supply > 0n ? supply : 1n)
      : (oneSolTokenThreshold <= supply ? oneSolTokenThreshold : (supply > 0n ? supply : 1n));
    const [solToLst, lstToSol] = await Promise.all([
      quote(WSOL, row.mint.address, 1_000_000_000n),
      quote(row.mint.address, WSOL, reverseProbeAmount),
    ]);
    return {
      pool: row.pool,
      voteAccount: row.voteAccount,
      mint: row.mint.address,
      mintSupplyRaw: supply.toString(),
      pricingDenominatorMRaw: pricing.toString(),
      activeOnrampCandidate: activeOnrampPools.has(row.pool),
      delegatedCapabilityCandidate: delegatedPools.has(row.pool),
      oneSolTokenThresholdRaw: oneSolTokenThreshold?.toString() || null,
      reverseProbeAmountRaw: reverseProbeAmount.toString(),
      solToLst,
      lstToSol,
    };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    endpoint: QUOTE,
    request: {slippageBps: 50, swapMode: 'ExactIn'},
    caveat: 'A quote is route discovery, not flash compatibility, capacity validation, signed execution, or guaranteed profitability.',
    summary: {
      poolCount: rows.length,
      activeOnrampCandidateCount: rows.filter((row) => row.activeOnrampCandidate).length,
      delegatedCapabilityCandidateCount: rows.filter((row) => row.delegatedCapabilityCandidate).length,
      bidirectionalQuoteCount: rows.filter((row) => row.solToLst.ok && row.lstToSol.ok).length,
      forwardQuoteCount: rows.filter((row) => row.solToLst.ok).length,
      reverseQuoteCount: rows.filter((row) => row.lstToSol.ok).length,
      activeOnrampBidirectionalQuoteCount: rows.filter((row) =>
        row.activeOnrampCandidate && row.solToLst.ok && row.lstToSol.ok).length,
      delegatedCapabilityBidirectionalQuoteCount: rows.filter((row) =>
        row.delegatedCapabilityCandidate && row.solToLst.ok && row.lstToSol.ok).length,
    },
    rows,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUTPUT, summary: output.summary}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
