#!/usr/bin/env node
// Read-only current Jupiter route/depth probe for MOVEUSD. Quotes are indicative
// and never converted into swap transactions or submitted.

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'moveusd-liquidity.json');
const MOVEUSD = '3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AMOUNTS = [1n, 1_000n, 5_000n, 10_000n, 20_000n, 30_000n, 40_000n,
  50_000n, 60_000n, 75_000n, 90_000n, 100_000n, 1_000_000n, 10_000_000n];

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function quote(inputMint, outputMint, inputDecimals, amountUi) {
  const amountRaw = amountUi * 10n ** BigInt(inputDecimals);
  const params = new URLSearchParams({ inputMint, outputMint, amount: amountRaw.toString(),
    swapMode: 'ExactIn', slippageBps: '100', restrictIntermediateTokens: 'true', maxAccounts: '64' });
  try {
    const result = await json(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
    return {
      amountUi: amountUi.toString(), amountRaw: amountRaw.toString(), status: 'quoted',
      inputMint: result.inputMint, outputMint: result.outputMint,
      inAmount: result.inAmount, outAmount: result.outAmount,
      otherAmountThreshold: result.otherAmountThreshold,
      priceImpactPct: result.priceImpactPct,
      contextSlot: result.contextSlot,
      timeTaken: result.timeTaken,
      routePlan: (result.routePlan || []).map((step) => ({ percent: step.percent, bps: step.bps,
        swapInfo: { ammKey: step.swapInfo?.ammKey, label: step.swapInfo?.label,
          inputMint: step.swapInfo?.inputMint, outputMint: step.swapInfo?.outputMint,
          inAmount: step.swapInfo?.inAmount, outAmount: step.swapInfo?.outAmount,
          feeAmount: step.swapInfo?.feeAmount, feeMint: step.swapInfo?.feeMint } })),
    };
  } catch (error) {
    return { amountUi: amountUi.toString(), amountRaw: amountRaw.toString(), status: 'unavailable', error: error.message };
  }
}

async function main() {
  let tokenMetadata;
  try {
    tokenMetadata = await json(`https://lite-api.jup.ag/tokens/v2/search?query=${MOVEUSD}`);
  } catch (error) {
    tokenMetadata = { error: error.message };
  }
  const moveusdToUsdc = [];
  const usdcToMoveusd = [];
  for (const amount of AMOUNTS) {
    moveusdToUsdc.push(await quote(MOVEUSD, USDC, 6, amount));
    usdcToMoveusd.push(await quote(USDC, MOVEUSD, 6, amount));
  }
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noSwapTransactionRequestedOrSubmitted: true,
    caveat: 'Jupiter quote availability is route evidence, not guaranteed executable or redeemable liquidity.',
    tokenMetadata,
    probes: { moveusdToUsdc, usdcToMoveusd },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    tokenMetadata,
    moveusdToUsdc: moveusdToUsdc.map((row) => ({ amountUi: row.amountUi, status: row.status,
      outAmount: row.outAmount, priceImpactPct: row.priceImpactPct,
      labels: row.routePlan?.map((step) => step.swapInfo.label), error: row.error })),
    usdcToMoveusd: usdcToMoveusd.map((row) => ({ amountUi: row.amountUi, status: row.status,
      outAmount: row.outAmount, priceImpactPct: row.priceImpactPct,
      labels: row.routePlan?.map((step) => step.swapInfo.label), error: row.error })),
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
