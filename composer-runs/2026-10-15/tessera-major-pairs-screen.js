#!/usr/bin/env node
'use strict';
// Read-only, bounded direct-route screen. Saves quotes and account owners only.
const fs = require('fs');
const path = require('path');
const output = path.join(__dirname, 'tessera-major-pairs-screen.json');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
const genesisExpected = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const tessera = 'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH';
const mints = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  cbBTC: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  WSOL: 'So11111111111111111111111111111111111111112'
};
const expectedPools = {
  cbBTC: '9NkuAWB4LgCVFV77omEkJEjXqgV5PGupwMTu3B3pBRhc',
  WSOL: 'FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n'
};
const tests = [
  ['cbBTC', 'USDC', '100000000', 'small'],
  ['cbBTC', 'USDC', '10000000000', 'medium'],
  ['cbBTC', 'USDC', '75000000000', 'near-liquid'],
  ['cbBTC', 'cbBTC', '100000', 'small'],
  ['cbBTC', 'cbBTC', '10000000', 'medium'],
  ['cbBTC', 'cbBTC', '100000000', 'near-liquid'],
  ['WSOL', 'USDC', '100000000', 'small'],
  ['WSOL', 'USDC', '10000000000', 'medium'],
  ['WSOL', 'USDC', '3000000000000', 'near-liquid'],
  ['WSOL', 'WSOL', '1000000000', 'small'],
  ['WSOL', 'WSOL', '100000000000', 'medium'],
  ['WSOL', 'WSOL', '30000000000000', 'near-liquid']
];
let rpcId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function quote(input, outputMint, amount, filter) {
  const params = new URLSearchParams({ inputMint: mints[input],
    outputMint: mints[outputMint], amount, slippageBps: '50',
    onlyDirectRoutes: 'true', ...filter });
  const response = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = {}; }
  return { status: response.status, input, output: outputMint, inAmount: amount,
    outAmount: body.outAmount || null, contextSlot: body.contextSlot || null,
    error: body.error || (response.ok ? null : bodyText.slice(0, 160)),
    route: (body.routePlan || []).map(x => ({
      label: x.swapInfo?.label || null, ammKey: x.swapInfo?.ammKey || null,
      percent: x.percent ?? null
    })) };
}
function save(result) { fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); }
async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== genesisExpected) throw Error('wrong Solana genesis');
  const result = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta',
    genesis, method: 'Jupiter Lite ExactIn onlyDirectRoutes, forced TesseraV and TesseraV-excluded exit; chained exact output. Confirmed RPC owner checks.',
    noTransaction: true, rows: [], exitOwners: {}, stopReason: null };
  for (const [pair, initial, amount, size] of tests) {
    const middle = initial === 'USDC' ? pair : 'USDC';
    const firstIsTessera = initial === 'USDC';
    const first = await quote(initial, middle, amount,
      firstIsTessera ? { dexes: 'TesseraV' } : { excludeDexes: 'TesseraV' });
    if (first.status !== 200 || !first.outAmount) {
      result.stopReason = `first quote HTTP ${first.status}: ${first.error}`;
      result.rows.push({ pair, initial, size, first }); save(result); break;
    }
    if (firstIsTessera && (first.route.length !== 1 || first.route[0].ammKey !== expectedPools[pair])) {
      result.stopReason = `forced TesseraV first leg did not select target pool for ${pair}`;
      result.rows.push({ pair, initial, size, first }); save(result); break;
    }
    if (!firstIsTessera && first.route.some(x => x.label === 'TesseraV' || x.ammKey === expectedPools[pair])) {
      result.stopReason = `independent first leg included TesseraV for ${pair}`;
      result.rows.push({ pair, initial, size, first }); save(result); break;
    }
    const second = await quote(middle, initial, first.outAmount,
      firstIsTessera ? { excludeDexes: 'TesseraV' } : { dexes: 'TesseraV' });
    if (second.status !== 200 || !second.outAmount) {
      result.stopReason = `second quote HTTP ${second.status}: ${second.error}`;
      result.rows.push({ pair, initial, size, first, second }); save(result); break;
    }
    if (!firstIsTessera && (second.route.length !== 1 || second.route[0].ammKey !== expectedPools[pair])) {
      result.stopReason = `forced TesseraV second leg did not select target pool for ${pair}`;
      result.rows.push({ pair, initial, size, first, second }); save(result); break;
    }
    if (firstIsTessera && second.route.some(x => x.label === 'TesseraV' || x.ammKey === expectedPools[pair])) {
      result.stopReason = `independent second leg included TesseraV for ${pair}`;
      result.rows.push({ pair, initial, size, first, second }); save(result); break;
    }
    const netRaw = (BigInt(second.outAmount) - BigInt(amount)).toString();
    result.rows.push({ pair, initial, size, first, second, netRaw,
      netBeforeCosts: Number(netRaw) / (initial === 'USDC' ? 1e6 : initial === 'WSOL' ? 1e9 : 1e8) });
    save(result);
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  const keys = [...new Set(result.rows.flatMap(row => [row.first, row.second]
    .filter(Boolean).flatMap(q => q.route.map(x => x.ammKey))).filter(Boolean))];
  if (keys.length) {
    const accounts = await rpc('getMultipleAccounts', [keys,
      { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]);
    keys.forEach((key, i) => { result.exitOwners[key] = accounts.value[i]?.owner || null; });
    result.ownerSlot = accounts.context.slot;
    save(result);
  }
  console.log(JSON.stringify({ output, completed: result.rows.filter(x => x.netRaw !== undefined).length,
    stopReason: result.stopReason,
    rows: result.rows.map(x => ({ pair: x.pair, initial: x.initial, size: x.size,
      net: x.netBeforeCosts, firstRoute: x.first?.route, secondRoute: x.second?.route })) }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
