#!/usr/bin/env node
// Public quote-only bound; record the A fill, exact B exit, and B capacity checks.
const fs = require('fs');
const path = require('path');
const S = 'sUSDai6Y3GxysDEtA9BVcEFTaog6UZpYUVxJiMhAKYE';
const U = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const A = 'G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(inputMint, outputMint, amountRaw, selection, dexes) {
  const params = new URLSearchParams({inputMint, outputMint, amount: String(amountRaw),
    slippageBps: '100', maxAccounts: '64'});
  params.set(selection, dexes);
  const url = 'https://lite-api.jup.ag/swap/v1/quote?' + params;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {signal: AbortSignal.timeout(20000)});
      const data = await res.json();
      if (res.status === 429 && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
      const route = (data.routePlan || []).map(x => ({label: x.swapInfo?.label,
        ammKey: x.swapInfo?.ammKey, inRaw: x.swapInfo?.inAmount,
        outRaw: x.swapInfo?.outAmount}));
      return {inputMint, outputMint, inputRaw: String(amountRaw), selection, dexes,
        httpStatus: res.status, contextSlot: data.contextSlot || null,
        outRaw: data.outAmount || null, minOutRaw: data.otherAmountThreshold || null,
        priceImpactPct: data.priceImpactPct || null,
        errorCode: data.errorCode || null, error: data.error || null,
        route, independentOfA: route.length > 0 && route.every(x => x.ammKey !== A)};
    } catch (error) {
      if (attempt === 3) return {inputMint, outputMint, inputRaw: String(amountRaw),
        selection, dexes, httpStatus: null, error: error.message, route: []};
      await sleep(2000 * (attempt + 1));
    }
  }
}
async function main() {
  const a = await quote(U, S, 1_000_000_000n, 'dexes', 'JupLend AMM');
  const b = a.outRaw ? await quote(S, U, BigInt(a.outRaw), 'excludeDexes', 'JupLend AMM') : null;
  await sleep(700);
  const near = await quote(S, U, 3_999_000_000n, 'excludeDexes', 'JupLend AMM');
  await sleep(700);
  const cap = await quote(S, U, 4_000_000_000n, 'excludeDexes', 'JupLend AMM');
  const quotedNetUsdcRaw = b?.outRaw ? (BigInt(b.outRaw) - 1_000_000_000n).toString() : null;
  const result = {generatedAt: new Date().toISOString(), source: 'public Jupiter Lite quote API',
    quoteOnly: true, mainnetSubmission: false, poolA: A,
    a, b, near, cap, quotedNetUsdcRaw,
    validatedProfitUsdcRaw: null};
  fs.writeFileSync(path.join(__dirname, 'route-quote-bound.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({a, b, near, cap, quotedNetUsdcRaw}, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
