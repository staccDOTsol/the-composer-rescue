#!/usr/bin/env node
'use strict';

// Read-only ORCA -> USDC Jupiter route quotes. Quotes are liquidity evidence,
// not execution or proof of realizability at the displayed amount.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ORCA = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SIZES = [1_000n, 10_000n, 100_000n, 1_000_000n, 5_000_000n, 9_703_334n];
const BASE = 'https://lite-api.jup.ag/swap/v1/quote';
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function quote(uiOrca) {
  const raw = uiOrca * 1_000_000n;
  const params = new URLSearchParams({inputMint: ORCA, outputMint: USDC, amount: raw.toString(),
    swapMode: 'ExactIn', slippageBps: '100', restrictIntermediateTokens: 'true'});
  const url = `${BASE}?${params}`;
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = {textPrefix: text.slice(0, 1000)}; }
    last = {uiOrca: uiOrca.toString(), inputRaw: raw.toString(), url, status: response.status,
      ok: response.ok, responseSha256: sha256(Buffer.from(text)), body, attempts: attempt + 1};
    if (response.ok || response.status !== 429) return last;
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  return last;
}
async function main() {
  const rows = [];
  for (const size of SIZES) {
    rows.push(await quote(size));
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  const out = {schema: 'orca-staking-exit-quotes/v1', generatedAtUtc: new Date().toISOString(),
    source: 'Jupiter Lite quote API', inputMint: ORCA, outputMint: USDC, inputDecimals: 6, outputDecimals: 6,
    slippageBps: 100, restrictIntermediateTokens: true, rows,
    caveat: 'Read-only aggregator quotes only. No swap transaction was built, signed, simulated, or submitted.',
    safety: {readOnlyHttp: true, signedTransactions: false, sendTransactionCalled: false, broadcast: false}};
  const outPath = path.join(__dirname, 'orca-staking-exit-quotes.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({outPath, generatedAtUtc: out.generatedAtUtc, rows: rows.map(row => ({uiOrca: row.uiOrca,
    status: row.status, ok: row.ok, outAmountRaw: row.body?.outAmount || null,
    otherAmountThresholdRaw: row.body?.otherAmountThreshold || null, priceImpactPct: row.body?.priceImpactPct || null,
    route: (row.body?.routePlan || []).map(part => ({percent: part.percent, label: part.swapInfo?.label,
      inAmount: part.swapInfo?.inAmount, outAmount: part.swapInfo?.outAmount}))})), caveat: out.caveat}, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
