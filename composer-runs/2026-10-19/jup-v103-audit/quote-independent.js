#!/usr/bin/env node
// Read-only current quote gate for the v103 sUSDai/USDC cross-pool path.
const fs = require('fs');
const path = require('path');
const SUSD = 'sUSDai6Y3GxysDEtA9BVcEFTaog6UZpYUVxJiMhAKYE';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL_A = 'G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF';
const endpoint = 'https://lite-api.jup.ag/swap/v1/quote';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(inputMint, outputMint, amountRaw, excludedDexes) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({inputMint, outputMint,
    amount: String(amountRaw), slippageBps: '100', maxAccounts: '64',
    ...(excludedDexes ? {excludeDexes: excludedDexes} : {})})) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
    const result = await response.json();
    const route = (result.routePlan || []).map(step => ({
      label: step.swapInfo?.label, ammKey: step.swapInfo?.ammKey,
      inputMint: step.swapInfo?.inputMint, outputMint: step.swapInfo?.outputMint,
      inRaw: step.swapInfo?.inAmount, outRaw: step.swapInfo?.outAmount,
      feeRaw: step.swapInfo?.feeAmount, percent: step.percent,
    }));
    return {inputMint, outputMint, inputRaw: String(amountRaw), excludedDexes: excludedDexes || null,
      httpStatus: response.status, contextSlot: result.contextSlot || null,
      outRaw: result.outAmount || null, minOutRaw: result.otherAmountThreshold || null,
      priceImpactPct: result.priceImpactPct || null,
      error: result.error || null, errorCode: result.errorCode || null,
      route, containsPoolA: route.some(step => step.ammKey === POOL_A),
      allRoutesIndependent: route.length > 0 && route.every(step => step.ammKey !== POOL_A),
    };
  } catch (error) {
    return {inputMint, outputMint, inputRaw: String(amountRaw), excludedDexes: excludedDexes || null,
      httpStatus: null, error: error.message, route: [], allRoutesIndependent: false};
  }
}
async function main() {
  const queries = [
    [SUSD, USDC, 1_000_000n], [SUSD, USDC, 100_000_000n],
    [SUSD, USDC, 1_000_000_000n], [SUSD, USDC, 10_000_000_000n],
    [SUSD, USDC, 100_000_000_000n], [SUSD, USDC, 1_000_000_000_000n],
    [USDC, SUSD, 1_000_000_000n], [USDC, SUSD, 10_000_000_000n],
    [USDC, SUSD, 100_000_000_000n],
  ];
  const rows = [];
  for (const [inputMint, outputMint, amountRaw] of queries) {
    rows.push(await quote(inputMint, outputMint, amountRaw, 'JupLend AMM'));
    await sleep(300);
  }
  const result = {generatedAt: new Date().toISOString(), endpoint,
    scope: 'read-only quote; no transaction submission', excludedDexes: 'JupLend AMM',
    poolA: POOL_A, rows};
  fs.writeFileSync(path.join(__dirname, 'independent-quotes.json'), JSON.stringify(result, null, 2) + '\n');
  for (const row of rows) console.log(JSON.stringify({side: row.inputMint === SUSD ? 'sUSDai->USDC' : 'USDC->sUSDai',
    inputRaw: row.inputRaw, httpStatus: row.httpStatus, outRaw: row.outRaw,
    route: row.route.map(step => `${step.label}:${step.ammKey}`), errorCode: row.errorCode,
    error: row.error, contextSlot: row.contextSlot}));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
