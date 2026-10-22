#!/usr/bin/env node
'use strict';
// Read-only, pool-key-checked direct quote chaining. No transaction construction.
const fs = require('fs');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const TARGET = 'GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(method + ': ' + JSON.stringify(result.error));
  return result.result;
}
async function quote(inputMint, outputMint, amount, side) {
  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount),
    slippageBps: '100', onlyDirectRoutes: 'true' });
  if (side === 'goonfi') params.set('dexes', 'GoonFi V2');
  else params.set('excludeDexes', 'GoonFi V2');
  const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + params);
  const body = await response.json();
  const route = (body.routePlan || []).map(x => ({ label: x.swapInfo?.label || null,
    ammKey: x.swapInfo?.ammKey || null, percent: x.percent || null }));
  const targetMatched = side === 'goonfi' ? route.length === 1 && route[0].ammKey === TARGET :
    route.length === 1 && route[0].label !== 'GoonFi V2' && route[0].ammKey !== TARGET;
  return { httpStatus: response.status, inAmount: body.inAmount || String(amount),
    outAmount: body.outAmount || null, contextSlot: body.contextSlot || null,
    error: body.error || null, priceImpactPct: body.priceImpactPct || null, route,
    targetMatched, side };
}
async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const rows = [];
  const sizes = process.argv[2] ? process.argv[2].split(',').map(Number) : [100, 1000, 10000, 100000, 250000];
  if (sizes.some(x => !Number.isSafeInteger(x) || x < 1)) throw Error('invalid USDC input sizes');
  for (const usdc of sizes) {
    const input = BigInt(usdc) * 1000000n;
    for (const direction of ['goonfi-first', 'goonfi-second']) {
      const firstSide = direction === 'goonfi-first' ? 'goonfi' : 'independent';
      const secondSide = direction === 'goonfi-first' ? 'independent' : 'goonfi';
      const first = await quote(USDC, WSOL, input, firstSide);
      const second = first.outAmount && first.targetMatched ?
        await quote(WSOL, USDC, first.outAmount, secondSide) : null;
      const valid = !!(first.outAmount && first.targetMatched && second?.outAmount && second.targetMatched);
      rows.push({ usdc, direction, first, second, valid,
        netUsdcRaw: valid ? (BigInt(second.outAmount) - input).toString() : null });
    }
  }
  const result = { observedAtUtc: new Date().toISOString(), source: 'Jupiter Lite direct quote API',
    network: 'mainnet-beta', genesis, targetGoonfiAmmKey: TARGET,
    method: 'Exact-input direct GoonFi V2 quote only when route ammKey equals target, chained with a direct quote excluding GoonFi V2; both route orders.',
    limitations: 'Quotes at nearby slots are not one atomic executable packet; no lender, fee, slippage, or route authorization modeled.',
    noMainnetTransaction: true, rows };
  const outputName = process.argv[3] || (process.argv[2] ? 'goonfi-v2-cross-venue-fine-quotes.json' : 'goonfi-v2-cross-venue-quotes.json');
  if (!/^goonfi-v2-[a-z0-9-]+\.json$/.test(outputName)) throw Error('invalid output filename');
  fs.writeFileSync(__dirname + '/' + outputName, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(rows.map(row => ({ usdc: row.usdc, direction: row.direction,
    valid: row.valid, netUsdc: row.netUsdcRaw == null ? null : Number(row.netUsdcRaw) / 1e6,
    first: { key: row.first.route[0]?.ammKey, label: row.first.route[0]?.label,
      slot: row.first.contextSlot, error: row.first.error },
    second: row.second && { key: row.second.route[0]?.ammKey, label: row.second.route[0]?.label,
      slot: row.second.contextSlot, error: row.second.error } })), null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
