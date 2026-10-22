#!/usr/bin/env node
// Independent Jupiter public GET quote check without intermediate-token restriction.
const fs = require('fs');
const path = require('path');
const SKR = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const amounts = [1000000, 5000000, 10000000, 20000000, 30000000, 40000000,
  50000000, 75000000, 100000000, 1000000000, 5077227354];
(async () => {
  const quotes = [];
  for (const amountSkr of amounts) {
    const q = new URLSearchParams({ inputMint: SKR, outputMint: USDC,
      amount: (BigInt(amountSkr) * 1000000n).toString(), slippageBps: '100',
      restrictIntermediateTokens: 'false', maxAccounts: '64' });
    const res = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${q}`);
    const body = await res.json();
    quotes.push({ amountSkr, status: res.status, response: body });
  }
  const output = { generatedAt: new Date().toISOString(), request: {
    inputMint: SKR, outputMint: USDC, slippageBps: 100,
    restrictIntermediateTokens: false, maxAccounts: 64 }, quotes };
  fs.writeFileSync(path.join(__dirname, 'unrestricted-quotes.json'), JSON.stringify(output, null, 2)+'\n');
  process.stdout.write(JSON.stringify(quotes.map(({ amountSkr, status, response }) => ({
    amountSkr, status, outUSDC: response.outAmount ? Number(response.outAmount)/1e6 : null,
    priceImpactPct: response.priceImpactPct,
    error: response.error, errorCode: response.errorCode,
    partialInSkr: response.meta?.partialInAmount ? Number(response.meta.partialInAmount)/1e6 : null,
    routeLabels: response.routePlan?.map((r)=>r.swapInfo?.label) })), null, 2)+'\n');
})().catch((e) => { process.stderr.write(`${e.stack || e.message}\n`); process.exitCode=1; });
