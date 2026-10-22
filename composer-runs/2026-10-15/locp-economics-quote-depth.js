#!/usr/bin/env node
// Read-only Jupiter swap quotes for market-depth context. Quotes do not submit trades.
// Run: node composer-runs/2026-10-15/locp-economics-quote-depth.js
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'locp-economics-snapshot.json')));
const source = JSON.parse(fs.readFileSync(path.join(dir, 'mainnet-token-authority-census.raw.json')));
const byAddress = new Map(source.tokenAccounts.map((v) => [v.address, v]));
const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const byMint = new Map();
for (const e of snapshot.entries) {
  const prior = byAddress.get(e.vaultAddress);
  const mint = byMint.get(e.mint) || { mint: e.mint, symbol: e.symbol, decimals: prior.decimals,
    censusPriceUsd: e.censusPriceUsd, balanceRaw: 0n, claimableRaw: 0n, vaultCount: 0 };
  mint.balanceRaw += BigInt(e.vault.rawAmount);
  mint.claimableRaw += BigInt(e.claimableRaw);
  mint.vaultCount++;
  byMint.set(e.mint, mint);
}
const tokens = [...byMint.values()].sort((a, b) =>
  Number(b.balanceRaw) / 10 ** b.decimals * b.censusPriceUsd -
  Number(a.balanceRaw) / 10 ** a.decimals * a.censusPriceUsd).slice(0, 14)
  .filter((t) => !process.env.LOCP_ONLY_SYMBOL || process.env.LOCP_ONLY_SYMBOL.split(',').includes(t.symbol));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function quote(mint, amountRaw) {
  const params = new URLSearchParams({ inputMint: mint, outputMint: usdcMint,
    amount: amountRaw.toString(), slippageBps: '100' });
  const url = `https://lite-api.jup.ag/swap/v1/quote?${params}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      const responseText = await response.text();
      let body;
      try { body = JSON.parse(responseText); } catch { body = { error: responseText.slice(0, 300) }; }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) { await delay(500 * 2 ** attempt); continue; }
      }
      if (!response.ok) return { status: response.status, error: body.error || body.message || body,
        errorCode: body.errorCode || null };
      return { status: response.status, contextSlot: body.contextSlot, inAmount: body.inAmount,
        outAmount: body.outAmount, outputUsdc: Number(body.outAmount) / 1e6,
        priceImpactPct: body.priceImpactPct, swapUsdValue: body.swapUsdValue,
        routes: (body.routePlan || []).map((r) => ({ ammKey: r.swapInfo.ammKey,
          label: r.swapInfo.label, percent: r.percent, inAmount: r.swapInfo.inAmount,
          outAmount: r.swapInfo.outAmount, updateContextSlot: r.swapInfo.updateContextSlot })) };
    } catch (error) {
      if (attempt === 3) return { error: error.message };
      await delay(500 * 2 ** attempt);
    }
  }
}

async function main() {
  const observations = [];
  for (const t of tokens) {
    const mark = Number(t.balanceRaw) / 10 ** t.decimals * t.censusPriceUsd;
    const cases = new Map();
    for (const usd of [10000, 100000, 1000000]) {
      if (usd < mark) {
        const raw = BigInt(Math.max(1, Math.floor(usd / t.censusPriceUsd * 10 ** t.decimals)));
        cases.set(`mark_${usd}`, raw);
      }
    }
    if (t.claimableRaw > 0n) cases.set('full_scheduled_claimable', t.claimableRaw);
    cases.set('full_vault_balance', t.balanceRaw);
    const quotes = [];
    for (const [scenario, raw] of cases) {
      const result = await quote(t.mint, raw);
      quotes.push({ scenario, requestedRaw: raw.toString(),
        requestedTokens: Number(raw) / 10 ** t.decimals,
        requestedCensusMarkUsd: Number(raw) / 10 ** t.decimals * t.censusPriceUsd,
        ...result });
      await delay(80);
    }
    observations.push({ mint: t.mint, symbol: t.symbol, decimals: t.decimals, vaultCount: t.vaultCount,
      balanceRaw: t.balanceRaw.toString(), claimableRaw: t.claimableRaw.toString(),
      censusPriceUsd: t.censusPriceUsd, censusMarkUsd: mark, quotes });
    console.log(`${t.symbol}: ${quotes.map((q) => `${q.scenario}=${q.status === 200 ? '$' + Math.round(q.outputUsdc) : q.errorCode || q.error}`).join(' ')}`);
  }
  const report = { generatedAt: new Date().toISOString(), sourceSnapshotSlot: snapshot.snapshotSlot,
    sourceBlockTime: snapshot.blockTime, quoteApi: 'https://lite-api.jup.ag/swap/v1/quote',
    outputMint: usdcMint, slippageBps: 100,
    methodology: 'Independent single-transaction exact-in, read-only aggregator quotes; not executable transaction simulations, nor estimates for orderly staged liquidation.',
    observations };
  const suffix = process.env.LOCP_ONLY_SYMBOL ? `-${process.env.LOCP_ONLY_SYMBOL.replace(/[^A-Za-z0-9]+/g, '-')}` : '';
  fs.writeFileSync(path.join(dir, `locp-economics-quote-depth${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
}
main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
