#!/usr/bin/env node
'use strict';

// Current read-only quote gate for concrete AlphaQ CASH/USDC round trips.
// Quotes are candidate discovery only and are never reported as realized profit.

const fs = require('fs');
const path = require('path');

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ALPHAQ_POOL = '2YR8bXXn4tTnq8nVjvpYnBiQ7ZKjN3G16wxE8ShL3KaB';
const POOL_CASH = '2A5Cmp2mYwPzdxsQ5w6YTukYR2dNjCWVhnDTWUrifRxd';
const POOL_USDC = 'F2KCaXcp7AoQtxTDvNEDCyMyWjSCAMWNzcyN9dsPfPs5';
const CASH = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SIZES_USDC = [1, 10, 100, 1000, 5000, 10000, 20000, 25000, 50000, 100000];
let rpcId = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})
  });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

async function quote(inputMint, outputMint, amount, mode) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: '100',
    onlyDirectRoutes: 'true'
  });
  if (mode === 'alphaq') params.set('dexes', 'AlphaQ');
  if (mode === 'independent') params.set('excludeDexes', 'AlphaQ');
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + params);
    const body = await response.text();
    if (response.status === 429 || body.startsWith('Rate limit')) {
      last = {status: response.status, error: 'rate limited'};
      await sleep(600 * (attempt + 1));
      continue;
    }
    let json;
    try { json = JSON.parse(body); } catch {
      return {status: response.status, error: 'non-JSON quote response'};
    }
    await sleep(150);
    return {
      status: response.status,
      inAmount: json.inAmount || String(amount),
      outAmount: json.outAmount || null,
      priceImpactPct: json.priceImpactPct || null,
      contextSlot: json.contextSlot || null,
      error: json.error || json.errorCode || null,
      route: (json.routePlan || []).map(x => ({
        label: x.swapInfo?.label || null,
        ammKey: x.swapInfo?.ammKey || null,
        percent: x.percent ?? null
      }))
    };
  }
  return last;
}

function tokenAmount(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function roundTrip(direction, size) {
  const inputRaw = BigInt(size) * 1000000n;
  if (direction === 'alphaq-first') {
    const first = await quote(USDC, CASH, inputRaw, 'alphaq');
    if (!first.outAmount) return {direction, sizeUsdc: size, inputRaw: inputRaw.toString(), first, exit: null, netUsdcRawBeforeCosts: null};
    const exit = await quote(CASH, USDC, first.outAmount, 'independent');
    return {
      direction,
      sizeUsdc: size,
      inputRaw: inputRaw.toString(),
      first,
      exit,
      netUsdcRawBeforeCosts: exit.outAmount ? (BigInt(exit.outAmount) - inputRaw).toString() : null,
      alphaQPoolMatched: first.route.length === 1 && first.route[0].ammKey === ALPHAQ_POOL,
      independentExit: exit.route?.length > 0 && exit.route.every(x => x.ammKey !== ALPHAQ_POOL)
    };
  }
  const first = await quote(USDC, CASH, inputRaw, 'independent');
  if (!first.outAmount) return {direction, sizeUsdc: size, inputRaw: inputRaw.toString(), first, exit: null, netUsdcRawBeforeCosts: null};
  const exit = await quote(CASH, USDC, first.outAmount, 'alphaq');
  return {
    direction,
    sizeUsdc: size,
    inputRaw: inputRaw.toString(),
    first,
    exit,
    netUsdcRawBeforeCosts: exit.outAmount ? (BigInt(exit.outAmount) - inputRaw).toString() : null,
    independentEntry: first.route.length > 0 && first.route.every(x => x.ammKey !== ALPHAQ_POOL),
    alphaQPoolMatched: exit.route?.length === 1 && exit.route[0].ammKey === ALPHAQ_POOL
  };
}

async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  const accounts = await rpc('getMultipleAccounts', [[POOL_CASH, POOL_USDC], {encoding: 'base64', commitment: 'confirmed'}]);
  const rows = [];
  for (const size of SIZES_USDC) {
    rows.push(await roundTrip('alphaq-first', size));
    rows.push(await roundTrip('alphaq-second', size));
  }
  const numeric = rows.filter(x => x.netUsdcRawBeforeCosts !== null);
  const profitableCandidates = numeric.filter(x => BigInt(x.netUsdcRawBeforeCosts) > 0n);
  const out = {
    observedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis,
    pool: {
      ammKey: ALPHAQ_POOL,
      cashVaultRaw: tokenAmount(accounts.value[0]),
      usdcVaultRaw: tokenAmount(accounts.value[1]),
      stateSlot: accounts.context.slot
    },
    method: 'ExactIn, direct AlphaQ leg constrained with dexes=AlphaQ; opposite leg constrained with excludeDexes=AlphaQ',
    rows,
    profitableCandidateCountBeforeCosts: profitableCandidates.length,
    bestNetUsdcRawBeforeCosts: numeric.length ? numeric.reduce((a, b) => BigInt(a.netUsdcRawBeforeCosts) > BigInt(b.netUsdcRawBeforeCosts) ? a : b).netUsdcRawBeforeCosts : null,
    candidateGate: 'A route must be positive before lender and transaction costs before any signed atomic composition is attempted.',
    quoteOnly: true,
    noTransaction: true,
    limitations: [
      'Quotes are discovery evidence, not realized or simulated profit.',
      'A positive quote would require a signed one-transaction simulation before it could survive this gate.'
    ]
  };
  const outputPath = path.join(__dirname, 'alphaq-current-economic-gate.json');
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    observedAtUtc: out.observedAtUtc,
    pool: out.pool,
    profitableCandidateCountBeforeCosts: out.profitableCandidateCountBeforeCosts,
    bestNetUsdcRawBeforeCosts: out.bestNetUsdcRawBeforeCosts,
    rows: rows.map(x => ({
      direction: x.direction,
      sizeUsdc: x.sizeUsdc,
      netUsdcRawBeforeCosts: x.netUsdcRawBeforeCosts,
      alphaQ: x.direction === 'alphaq-first' ? x.first.route?.[0]?.label : x.exit?.route?.[0]?.label,
      independent: x.direction === 'alphaq-first' ? x.exit?.route?.[0]?.label : x.first.route?.[0]?.label,
      firstError: x.first.error,
      exitError: x.exit?.error || null
    })),
    evidence: outputPath
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
