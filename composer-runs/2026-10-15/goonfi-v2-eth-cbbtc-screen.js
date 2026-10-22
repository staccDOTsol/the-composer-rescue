#!/usr/bin/env node
'use strict';
// Read-only mainnet pool-custody and exact-pool cross-venue quote screen.
const fs = require('fs');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const P = x => new PublicKey(x);
const S = x => x.toBase58();
const PROGRAM = 'goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE';
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOLS = [
  { symbol: 'ETH', mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8,
    authority: '5mHTXRU1bgBDo9vUoHKkCidbFRc2mLHSgTTdQyZBjMfg' },
  { symbol: 'cbBTC', mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', decimals: 8,
    authority: '8TxrtAxqA5PA2Y1d2pxzCz9SoDhjrBcYqNAQKVv6p443' },
];
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
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function quote(inputMint, outputMint, amount, side, target) {
  const params = new URLSearchParams({ inputMint, outputMint, amount: String(amount),
    slippageBps: '50', onlyDirectRoutes: 'true' });
  if (side === 'goonfi') params.set('dexes', 'GoonFi V2');
  else params.set('excludeDexes', 'GoonFi V2');
  const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + params);
  const body = await response.json();
  const route = (body.routePlan || []).map(x => ({ label: x.swapInfo?.label || null,
    ammKey: x.swapInfo?.ammKey || null, percent: x.percent || null }));
  const matched = response.ok && route.length === 1 && (side === 'goonfi' ?
    route[0].label === 'GoonFi V2' && route[0].ammKey === target :
    route[0].label !== 'GoonFi V2' && route[0].ammKey !== target);
  return { httpStatus: response.status, inAmount: body.inAmount || String(amount),
    outAmount: body.outAmount || null, contextSlot: body.contextSlot || null,
    error: body.error || null, priceImpactPct: body.priceImpactPct || null,
    route, targetMatched: matched };
}
function accountImage(a) {
  if (!a) return null;
  const d = Buffer.from(a.data[0], 'base64');
  return { owner: a.owner, dataLength: d.length,
    mint: a.owner === SPL_TOKEN && d.length >= 165 ? S(P(d.subarray(0, 32))) : null,
    tokenAuthority: a.owner === SPL_TOKEN && d.length >= 165 ? S(P(d.subarray(32, 64))) : null,
    rawBalance: a.owner === SPL_TOKEN && d.length >= 165 ? d.readBigUInt64LE(64).toString() : null,
    sha256: crypto.createHash('sha256').update(d).digest('hex') };
}
function verify(condition, reason) { if (!condition) throw Error('pool validation: ' + reason); }
async function main() {
  const genesis = await rpc('getGenesisHash');
  verify(genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'not mainnet-beta');
  const stateKeys = POOLS.map(x => x.authority);
  const states = await rpc('getMultipleAccounts', [stateKeys, { encoding: 'base64', commitment: 'confirmed' }]);
  const vaultKeys = [];
  const poolImages = [];
  for (let i = 0; i < POOLS.length; i++) {
    const spec = POOLS[i], a = states.value[i];
    verify(a && a.owner === PROGRAM, spec.symbol + ' state not program-owned');
    verify(!PublicKey.isOnCurve(P(spec.authority).toBytes()), spec.symbol + ' authority is on-curve');
    const d = Buffer.from(a.data[0], 'base64');
    verify(d.length === 2048, spec.symbol + ' state size');
    const mintA = S(P(d.subarray(80, 112))), mintB = S(P(d.subarray(112, 144)));
    verify(new Set([mintA, mintB]).has(USDC) && new Set([mintA, mintB]).has(spec.mint),
      spec.symbol + ' state mints');
    const vaultA = S(P(d.subarray(144, 176))), vaultB = S(P(d.subarray(176, 208)));
    vaultKeys.push(vaultA, vaultB);
    poolImages.push({ symbol: spec.symbol, authority: spec.authority, stateOwner: a.owner,
      stateOffCurve: true, stateDataLength: d.length,
      stateSha256: crypto.createHash('sha256').update(d).digest('hex'),
      mintA, mintB, vaultA, vaultB });
  }
  const vaults = await rpc('getMultipleAccounts', [vaultKeys, { encoding: 'base64', commitment: 'confirmed' }]);
  for (let i = 0; i < POOLS.length; i++) {
    const p = poolImages[i], x = accountImage(vaults.value[i * 2]), y = accountImage(vaults.value[i * 2 + 1]);
    verify(x && y && x.owner === SPL_TOKEN && y.owner === SPL_TOKEN, p.symbol + ' SPL vaults');
    verify(x.tokenAuthority === p.authority && y.tokenAuthority === p.authority,
      p.symbol + ' vault authority');
    verify(x.mint === p.mintA && y.mint === p.mintB, p.symbol + ' vault mint binding');
    p.vaults = [{ address: p.vaultA, ...x }, { address: p.vaultB, ...y }];
  }
  const output = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesis,
    program: PROGRAM, stateSlot: states.context.slot, vaultSlot: vaults.context.slot,
    pools: poolImages, quoteMethod: 'ExactIn, onlyDirectRoutes, exact target GoonFi pool key; independent direct leg excludes GoonFi V2; both route orders.',
    limitations: ['State and vault reads are at adjacent, not necessarily identical, confirmed slots',
      'Quotes are not an atomic executable packet and omit priority, base, flash, and slippage costs'],
    noTransaction: true, rows: [] };
  fs.writeFileSync(__dirname + '/goonfi-v2-eth-cbbtc-screen.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'vaults', pools: poolImages.map(p => ({ symbol: p.symbol,
    authority: p.authority, vaults: p.vaults.map(v => ({ address: v.address, mint: v.mint, rawBalance: v.rawBalance })) })) }));
  for (const spec of POOLS) {
    for (const usdc of [100, 1000, 10000, 100000]) {
      for (const order of ['goonfi-first', 'goonfi-second']) {
        const firstSide = order === 'goonfi-first' ? 'goonfi' : 'independent';
        const secondSide = order === 'goonfi-first' ? 'independent' : 'goonfi';
        const first = await quote(USDC, spec.mint, BigInt(usdc) * 1000000n, firstSide, spec.authority);
        await delay(125);
        const second = first.targetMatched && first.outAmount ?
          await quote(spec.mint, USDC, first.outAmount, secondSide, spec.authority) : null;
        await delay(125);
        const valid = Boolean(first.targetMatched && second?.targetMatched && second?.outAmount);
        const netRaw = valid ? (BigInt(second.outAmount) - BigInt(first.inAmount)).toString() : null;
        const row = { symbol: spec.symbol, usdc, order, first, second, valid, netUsdcRaw: netRaw };
        output.rows.push(row);
        fs.writeFileSync(__dirname + '/goonfi-v2-eth-cbbtc-screen.json', JSON.stringify(output, null, 2) + '\n');
        console.log(JSON.stringify({ stage: 'quote', symbol: spec.symbol, usdc, order, valid,
          netUsdc: netRaw == null ? null : Number(netRaw) / 1e6,
          firstKey: first.route[0]?.ammKey || null, secondKey: second?.route[0]?.ammKey || null,
          firstSlot: first.contextSlot, secondSlot: second?.contextSlot || null,
          error: first.error || second?.error || null }));
      }
    }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
