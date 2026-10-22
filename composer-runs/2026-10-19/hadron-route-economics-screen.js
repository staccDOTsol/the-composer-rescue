#!/usr/bin/env node
// Read-only Jupiter quote screen for atomic Hadron -> non-Hadron round trips.
// No transaction is built, signed, simulated, or broadcast here.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CENSUS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hadron-current-census.json')));
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const fractionsPpm = [100, 1000, 10000, 50000, 200000, 500000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(inputMint, outputMint, amount, mode) {
  const q = new URL('https://lite-api.jup.ag/swap/v1/quote');
  q.searchParams.set('inputMint', inputMint);
  q.searchParams.set('outputMint', outputMint);
  q.searchParams.set('amount', amount.toString());
  q.searchParams.set('slippageBps', '0');
  q.searchParams.set('restrictIntermediateTokens', 'false');
  q.searchParams.set(mode === 'hadron' ? 'dexes' : 'excludeDexes', 'Hadron');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(q);
    const body = await res.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {error: body.slice(0, 300)}; }
    if (res.ok && parsed.outAmount) {
      return {
        inputMint: parsed.inputMint,
        outputMint: parsed.outputMint,
        inAmount: parsed.inAmount,
        outAmount: parsed.outAmount,
        priceImpactPct: parsed.priceImpactPct,
        contextSlot: parsed.contextSlot,
        timeTaken: parsed.timeTaken,
        routePlan: parsed.routePlan,
      };
    }
    if (res.status !== 429) return {error: parsed.error || `HTTP ${res.status}`, errorCode: parsed.errorCode || null};
    await sleep(1200 * (attempt + 1));
  }
  return {error: 'rate limited after retries'};
}

function topPools() {
  return CENSUS.pools
    .filter(p => p.state === 1 && (p.mintX === USDC || p.mintY === USDC))
    .filter(p => BigInt(p.balances.x.raw) > 0n && BigInt(p.balances.y.raw) > 0n)
    .sort((a, b) => Number(BigInt(b.usdcRaw) - BigInt(a.usdcRaw)))
    .slice(0, 18);
}

async function main() {
  const startedAtUtc = new Date().toISOString();
  const records = [];
  for (const pool of topPools()) {
    const xIsUsdc = pool.mintX === USDC;
    const assetMint = xIsUsdc ? pool.mintY : pool.mintX;
    const assetReserve = BigInt(xIsUsdc ? pool.balances.y.raw : pool.balances.x.raw);
    const usdcReserve = BigInt(pool.usdcRaw);
    const directions = [];
    for (const side of ['usdc-to-asset', 'asset-to-usdc']) {
      const reserveIn = side === 'usdc-to-asset' ? usdcReserve : assetReserve;
      const inputMint = side === 'usdc-to-asset' ? USDC : assetMint;
      const outputMint = side === 'usdc-to-asset' ? assetMint : USDC;
      const samples = [];
      for (const fractionPpm of fractionsPpm) {
        const amountIn = reserveIn * BigInt(fractionPpm) / 1_000_000n;
        if (amountIn <= 0n) continue;
        const hadron = await quote(inputMint, outputMint, amountIn, 'hadron');
        await sleep(260);
        let independent = null;
        let returned = null;
        let gain = null;
        if (hadron.outAmount) {
          independent = await quote(outputMint, inputMint, BigInt(hadron.outAmount), 'independent');
          if (independent.outAmount) {
            returned = BigInt(independent.outAmount);
            gain = returned - amountIn;
          }
          await sleep(260);
        }
        samples.push({
          fractionPpm,
          amountIn: amountIn.toString(),
          hadron,
          independent,
          returned: returned?.toString() || null,
          gainRawBeforeFlashAndPriorityFees: gain?.toString() || null,
          profitableBeforeFlashAndPriorityFees: gain === null ? null : gain > 0n,
        });
      }
      directions.push({side, samples});
    }
    records.push({
      pool: pool.id,
      assetMint,
      assetReserve: assetReserve.toString(),
      usdcReserve: usdcReserve.toString(),
      directions,
    });
    process.stderr.write(`screened ${pool.id}\n`);
  }
  const output = {
    startedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    genesis: CENSUS.genesis,
    censusStartSlot: CENSUS.startSlot,
    censusEndSlot: CENSUS.endSlot,
    methodology: 'Hadron-only exact-in quote followed by exact-output-amount non-Hadron exact-in quote; 0 slippage tolerance; gains are before flash and priority fees',
    noTransactions: true,
    fractionsPpm,
    records,
  };
  fs.writeFileSync(path.join(ROOT, 'hadron-route-economics-screen.json'), JSON.stringify(output, null, 2) + '\n');
  const profitable = [];
  for (const r of records) for (const d of r.directions) for (const s of d.samples) {
    if (s.profitableBeforeFlashAndPriorityFees) profitable.push({pool:r.pool, assetMint:r.assetMint, side:d.side, fractionPpm:s.fractionPpm, amountIn:s.amountIn, returned:s.returned, gain:s.gainRawBeforeFlashAndPriorityFees});
  }
  console.log(JSON.stringify({finishedAtUtc:output.finishedAtUtc, pools:records.length, profitable}, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
