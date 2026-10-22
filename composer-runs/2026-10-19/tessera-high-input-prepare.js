#!/usr/bin/env node
'use strict';

// Prepares non-secret Jupiter quote/instruction JSON before the fixed-bank fork starts.
// No transaction is signed or submitted by this script.

const fs = require('fs');
const path = require('path');
const web3 = require('../2026-10-15/onre-harness/node_modules/@solana/web3.js');
const spl = require('../2026-10-15/onre-harness/node_modules/@solana/spl-token');
const {PublicKey} = web3;
const P = value => new PublicKey(value);
const DIR = __dirname;
const OUTPUT = path.join(DIR, 'tessera-high-input-prepared.json');
const POOL = 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n';
const WSOL = P('So11111111111111111111111111111111111111112');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BUILDER = P('331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function requestJson(url, options = {}) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(60_000)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {error: text.slice(0, 240)}; }
    last = {status: response.status, body};
    if (response.ok && !body.error) return last;
    if (response.status !== 429 && response.status < 500) return last;
    await sleep(1_500 * (attempt + 1));
  }
  return last;
}

async function main() {
  let definitions = [
    ['wsol_to_usdc', 'small_control', '100000000'],
    ['wsol_to_usdc', '100_wsol', '100000000000'],
    ['wsol_to_usdc', '1000_wsol', '1000000000000'],
    ['wsol_to_usdc', '10000_wsol', '10000000000000'],
    ['wsol_to_usdc', '20000_wsol', '20000000000000'],
    ['usdc_to_wsol', 'small_control', '10000000'],
    ['usdc_to_wsol', '10000_usdc', '10000000000'],
    ['usdc_to_wsol', '100000_usdc', '100000000000'],
    ['usdc_to_wsol', '1000000_usdc', '1000000000000'],
    ['usdc_to_wsol', '3000000_usdc', '3000000000000'],
  ];
  if (process.env.TESSERA_CASE_FILTER) {
    const selected = process.env.TESSERA_CASE_FILTER;
    definitions = definitions.filter(([direction, label]) => `${direction}:${label}` === selected);
    if (definitions.length !== 1) throw new Error(`unknown TESSERA_CASE_FILTER ${selected}`);
  }
  const output = {preparedAtUtc: new Date().toISOString(), builder: BUILDER.toBase58(),
    builderWsol: spl.getAssociatedTokenAddressSync(WSOL, BUILDER).toBase58(),
    builderUsdc: spl.getAssociatedTokenAddressSync(USDC, BUILDER).toBase58(),
    safety: {signed: false, submitted: false, secretMaterial: false}, cases: []};
  for (const [direction, label, amount] of definitions) {
    const inputMint = direction === 'wsol_to_usdc' ? WSOL : USDC;
    const outputMint = direction === 'wsol_to_usdc' ? USDC : WSOL;
    const params = new URLSearchParams({inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(), amount, slippageBps: '5000',
      onlyDirectRoutes: 'true', maxAccounts: '24', dexes: 'TesseraV'});
    const quote = await requestJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
    const route = quote.body?.routePlan || [];
    const exact = quote.status === 200 && quote.body?.outAmount && route.length === 1 &&
      route[0].swapInfo?.label === 'TesseraV' && route[0].swapInfo?.ammKey === POOL;
    let build = null;
    if (exact) build = await requestJson('https://lite-api.jup.ag/swap/v1/swap-instructions', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({
        quoteResponse: quote.body, userPublicKey: BUILDER.toBase58(), wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: false, prioritizationFeeLamports: 0,
      }),
    });
    output.cases.push({direction, label, amountRaw: amount, quoteStatus: quote.status,
      quote: quote.body, exactPool: exact, buildStatus: build?.status || null, build: build?.body || null});
    await sleep(400);
  }
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, preparedAtUtc: output.preparedAtUtc,
    cases: output.cases.map(row => ({direction: row.direction, label: row.label,
      quoteStatus: row.quoteStatus, outAmount: row.quote?.outAmount || null,
      exactPool: row.exactPool, buildStatus: row.buildStatus,
      error: row.quote?.error || row.build?.error || null}))}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
