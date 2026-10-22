#!/usr/bin/env node
'use strict';
// Read-only mainnet-beta current-state and exact route economic gate.
const fs = require('fs');
const path = require('path');
const base = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw Error('RPC endpoint unavailable');
const PROGRAM = '2rU1oCHtQ7WJUvy15tKtFvxdYNNSc3id7AzUcjeFSddo';
const POOL = '9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb';
const SOL_VAULT = '6RLKARrt6oPCyuMCdYdUHmJxd4wUa6ZeyiC8VSMcYxRv';
const MARKET = 'HYvsj7UMAt2tE4QQfDwXiegogwtVJ13fuucjtZw1bf8E';
const MINT = {
  JSOL: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
  WSOL: 'So11111111111111111111111111111111111111112'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function quote(inputMint, outputMint, amount) {
  const q = new URLSearchParams({inputMint, outputMint, amount: String(amount),
    slippageBps: '100', onlyDirectRoutes: 'true'});
  const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?' + q);
  const body = await response.json();
  return {status: response.status, inAmount: body.inAmount || String(amount),
    outAmount: body.outAmount || null, contextSlot: body.contextSlot || null,
    error: body.error || null,
    route: (body.routePlan || []).map(x => ({label: x.swapInfo?.label || null,
      ammKey: x.swapInfo?.ammKey || null, percent: x.percent || null}))};
}
function keysOf(tx) {
  return tx.transaction.message.accountKeys.map(x => typeof x === 'string' ? x : x.pubkey);
}
function parentOf(tx, index) {
  const ix = tx.transaction.message.instructions[index];
  return ix?.programId || null;
}
async function main() {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const state = await rpc('getMultipleAccounts', [[PROGRAM, POOL, SOL_VAULT, MARKET],
    {encoding: 'base64', commitment: 'confirmed', dataSlice: {offset: 0, length: 0}}]);
  const accounts = Object.fromEntries([PROGRAM, POOL, SOL_VAULT, MARKET].map((k, i) =>
    [k, {owner: state.value[i]?.owner || null, executable: state.value[i]?.executable || false,
      lamports: state.value[i]?.lamports ?? null, space: state.value[i]?.space ?? null}]));
  const sigs = await rpc('getSignaturesForAddress', [PROGRAM, {limit: 30, commitment: 'confirmed'}]);
  const parents = [];
  for (const s of sigs.filter(x => !x.err).slice(0, 16)) {
    const tx = await rpc('getTransaction', [s.signature,
      {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
    if (!tx?.meta?.innerInstructions) continue;
    const keys = keysOf(tx);
    const found = [];
    for (const group of tx.meta.innerInstructions) {
      if (parentOf(tx, group.index) !== PROGRAM) continue;
      for (const inner of group.instructions || []) {
        const info = inner.parsed?.info || {};
        if ([POOL, SOL_VAULT].some(k => Object.values(info).includes(k))) {
          found.push({program: inner.program || inner.programId || null,
            type: inner.parsed?.type || null, info});
        }
      }
    }
    if (found.length) parents.push({signature: s.signature, slot: s.slot, found: found.slice(0, 5),
      signerKeys: tx.transaction.message.accountKeys.filter(x => x.signer).map(x => x.pubkey),
      accountCount: keys.length});
    if (parents.length >= 4) break;
  }
  const sizes = [1, 10, 100, 500, 1000];
  const quotes = [];
  for (const n of sizes) {
    const first = await quote(MINT.JSOL, MINT.WSOL, BigInt(n) * 1000000000n);
    await sleep(150);
    const targetUsed = first.route.length === 1 && first.route[0].ammKey === MARKET;
    const exit = first.outAmount && targetUsed ? await quote(MINT.WSOL, MINT.JSOL, first.outAmount) : null;
    await sleep(150);
    const independent = exit?.route?.every(x => x.ammKey !== MARKET) || false;
    const netJsolRaw = independent && exit.outAmount ?
      (BigInt(exit.outAmount) - BigInt(first.inAmount)).toString() : null;
    quotes.push({jsolInput: n, first, exit, independent,
      netJsolRawBeforeTxFees: netJsolRaw});
  }
  const out = {observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesis,
    stateSlot: state.context.slot, program: PROGRAM, pool: POOL, market: MARKET,
    solVault: SOL_VAULT, accounts, recentPdaRelatedInnerInstructions: parents,
    quoteMethod: 'Jupiter public ExactIn onlyDirectRoutes quote; first leg accepted only if exact VaultLiquidUnstake market, second leg accepted only if independent market.',
    quotes, noTransaction: true,
    limitations: ['Best direct quote does not enumerate all routes or prove atomic execution',
      'Read-only quote economics are not a signed current-binary simulation',
      'Stake and SOL LP inventory are not free equity']};
  const file = path.join(base, 'vault-liquid-unstaker-route-gate.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({stateSlot: out.stateSlot, accounts, parentCount: parents.length,
    quoteCount: quotes.length, quotes: quotes.map(x => ({n: x.jsolInput,
      target: x.first.route[0]?.ammKey === MARKET, first: x.first.outAmount,
      exit: x.exit?.outAmount || null, independent: x.independent,
      net: x.netJsolRawBeforeTxFees})), evidence: file}));
}
main().catch(e => {console.error(e.message); process.exitCode = 1});
