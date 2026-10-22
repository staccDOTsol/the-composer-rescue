#!/usr/bin/env node
'use strict';

// Chained read-only independent exit quotes for the exact raw outputs observed
// in signed Tessera mainnet precursor simulations. No transaction submission.

const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const OUT = path.join(DIR, 'tessera-mainnet-flash-exit-screen.json');
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(inputMint, outputMint, amount) {
  const params = new URLSearchParams({inputMint, outputMint, amount,
    slippageBps: '50', onlyDirectRoutes: 'true', maxAccounts: '24', excludeDexes: 'TesseraV'});
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`,
      {signal: AbortSignal.timeout(60_000)});
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
  const files = [
    'tessera-mainnet-flash-precursor.json',
    'tessera-mainnet-flash-wsol-100.json',
    'tessera-mainnet-flash-wsol-1000.json',
    'tessera-mainnet-flash-wsol-5000.json',
    'tessera-mainnet-flash-usdc-10.json',
    'tessera-mainnet-flash-usdc-100000.json',
    'tessera-mainnet-flash-usdc-1000000.json',
    'tessera-mainnet-flash-usdc-3000000.json',
  ];
  const output = {generatedAtUtc: new Date().toISOString(), method:
    'ExactIn direct independent exit quote on exact observed Tessera output; excludes TesseraV. Quote-only and time-separated from signed precursor.', rows: []};
  for (const file of files) {
    const source = JSON.parse(fs.readFileSync(path.join(DIR, file)));
    const observedOutput = source.reconciliation?.tesseraOutputRaw;
    if (!observedOutput) continue;
    const inputMint = source.direction === 'wsol_to_usdc' ? USDC : WSOL;
    const outputMint = source.direction === 'wsol_to_usdc' ? WSOL : USDC;
    const result = await quote(inputMint, outputMint, observedOutput);
    const routes = (result.body?.routePlan || []).map(row => ({label: row.swapInfo?.label,
      ammKey: row.swapInfo?.ammKey, percent: row.percent}));
    const aliasesTarget = routes.some(row => row.label === 'TesseraV' || row.ammKey === POOL);
    const exitOut = result.body?.outAmount || null;
    const netRaw = exitOut == null ? null : (BigInt(exitOut) - BigInt(source.amountRaw)).toString();
    output.rows.push({sourceFile: file, direction: source.direction, label: source.label,
      sourceSimulationSlot: source.simulationSlot, routeInputRaw: source.amountRaw,
      tesseraOutputRaw: observedOutput, exit: {status: result.status,
        contextSlot: result.body?.contextSlot || null, inAmount: result.body?.inAmount || observedOutput,
        outAmount: exitOut, otherAmountThreshold: result.body?.otherAmountThreshold || null,
        error: result.body?.error || result.body?.errorCode || null, routes, aliasesTarget},
      netRawBeforeNetworkFees: netRaw});
    await sleep(500);
  }
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT, rows: output.rows.map(row => ({direction: row.direction,
    label: row.label, tesseraOutputRaw: row.tesseraOutputRaw, exitOut: row.exit.outAmount,
    netRawBeforeNetworkFees: row.netRawBeforeNetworkFees, status: row.exit.status,
    routes: row.exit.routes}))}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
