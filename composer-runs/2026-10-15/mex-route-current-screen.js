#!/usr/bin/env node
// Bounded read-only authority, recent-handler, and independent exit screen.
const fs = require('fs');
const path = require('path');
const {PublicKey, Keypair} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const program = 'MEXkeo4BPUCZuEJ4idUUwMPu4qvc9nkqtLn3yAyZLxg';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const runtimeSigner = JSON.parse(fs.readFileSync(path.join(process.env.HOME, 'hooked.json'), 'utf8'));
if (!Array.isArray(runtimeSigner) || runtimeSigner.length !== 64) throw Error('runtime signer unavailable');
const wallet = Keypair.fromSecretKey(Uint8Array.from(runtimeSigner));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(x => x.includes('=')).map(x => x.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
if (!url) throw Error('RPC unavailable');
let id = 0;
async function rpc(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
    if (r.status === 429) {
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
      continue;
    }
    const j = await r.json(); if (j.error) throw Error(method + ': ' + JSON.stringify(j.error));
    return j.result;
  }
  throw Error(method + ': rate limit');
}
async function quote(mint, amount) {
  const q = new URL('https://lite-api.jup.ag/swap/v1/quote');
  for (const [k, v] of Object.entries({inputMint: mint, outputMint: USDC,
      amount: String(amount), slippageBps: '100'})) q.searchParams.set(k, v);
  try {
    const r = await fetch(q); const j = await r.json();
    return {requestedRaw: String(amount), httpStatus: r.status, contextSlot: j.contextSlot || null,
      inAmount: j.inAmount || null, outAmount: j.outAmount || null,
      priceImpactPct: j.priceImpactPct || null, error: j.error || null,
      route: (j.routePlan || []).map(x => ({label: x.swapInfo?.label, ammKey: x.swapInfo?.ammKey}))};
  } catch (e) {return {requestedRaw: String(amount), error: String(e)};}
}
async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw Error('not mainnet-beta');
  const crosswalk = JSON.parse(fs.readFileSync(path.join(__dirname, 'mainnet-token-authority-flash-crosswalk.json'), 'utf8'));
  const target = crosswalk.targets.find(x => x.programId === program);
  const chosen = target.assets.slice().sort((a, b) => b.sampledCustodyUsd - a.sampledCustodyUsd).slice(0, 4);
  const vaults = chosen.map(a => a.sampledTokenAccounts[0]);
  const vaultState = (await rpc('getMultipleAccounts', [vaults, {encoding: 'jsonParsed', commitment: 'confirmed'}])).value;
  const assets = chosen.map((a, i) => {
    const info = vaultState[i]?.data?.parsed?.info;
    return {symbol: a.symbols[0], mint: a.mint, vault: vaults[i], tokenProgram: vaultState[i]?.owner,
      owner: info?.owner || null, amountRaw: info?.tokenAmount?.amount || null,
      decimals: info?.tokenAmount?.decimals ?? null, priorSampledUsd: a.sampledCustodyUsd};
  });
  const authorities = [...new Set(assets.map(x => x.owner).filter(Boolean))];
  const authorityAccounts = (await rpc('getMultipleAccounts', [authorities, {encoding: 'base64', commitment: 'confirmed'}])).value;
  const authorityState = authorityAccounts
    .map((v, i) => ({address: authorities[i], programOwner: v?.owner || null,
      lamports: v?.lamports || null, dataLength: v?.data?.[0] ? Buffer.from(v.data[0], 'base64').length : null}));
  const proxyPda = PublicKey.findProgramAddressSync([Buffer.from('proxy')], new PublicKey(program))[0].toBase58();
  const proxyIndex = authorities.indexOf(proxyPda);
  if (proxyIndex < 0 || !authorityAccounts[proxyIndex]) throw Error('selected vault authority is not live proxy PDA');
  const proxyBytes = Buffer.from(authorityAccounts[proxyIndex].data[0], 'base64');
  const roles = {};
  if (proxyBytes.length !== 137 || !proxyBytes.subarray(0, 8).equals(Buffer.from([36, 36, 123, 35, 158, 89, 75, 41])))
    throw Error('live proxy layout differs from on-chain IDL');
  for (const [i, name] of ['admin', 'manager', 'treasurer', 'trader'].entries())
    roles[name] = new PublicKey(proxyBytes.subarray(8 + i * 32, 40 + i * 32)).toBase58();
  const proxy = {address: proxyPda, roles, isPaused: proxyBytes[136] !== 0,
    runtimeSigner: wallet.publicKey.toBase58(),
    runtimeIsRole: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v === wallet.publicKey.toBase58()]))};
  for (const a of assets) {
    if (!a.amountRaw || BigInt(a.amountRaw) === 0n) {a.quotes = []; continue;}
    const full = BigInt(a.amountRaw), small = full / 100n;
    a.quotes = await Promise.all([small > 0n ? small : 1n, full].map(x => quote(a.mint, x)));
  }
  const sigs = await rpc('getSignaturesForAddress', [program, {limit: 20, commitment: 'confirmed'}]);
  const transactions = [];
  for (const s of sigs.slice(0, 6)) {
    const tx = await rpc('getTransaction', [s.signature,
      {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
    if (!tx) continue;
    const msg = tx.transaction.message, directTransfers = [];
    for (const g of tx.meta.innerInstructions || []) {
      const stack = [msg.instructions[g.index]?.programId];
      for (const ix of g.instructions) {
        const h = ix.stackHeight || 2, parent = stack[h - 2] || null;
        stack[h - 1] = ix.programId; stack.length = h;
        if (parent !== program || !/transfer/i.test(ix.parsed?.type || '')) continue;
        const info = ix.parsed.info;
        directTransfers.push({source: info.source, destination: info.destination,
          authority: info.authority, amount: info.amount || info.tokenAmount?.amount || null});
      }
    }
    transactions.push({signature: s.signature, slot: s.slot, err: tx.meta.err,
      signerKeys: msg.accountKeys.filter(x => x.signer).map(x => x.pubkey),
      topLevel: msg.instructions.filter(x => x.programId === program).length,
      directTransfers});
  }
  const out = {generatedAt: new Date().toISOString(), genesis, program, proxy,
    sampleLimit: 20, sampledTransactions: transactions.length, assets, authorityState, transactions,
    noTransactionsSubmitted: true};
  const dest = path.join(__dirname, 'mex-route-current-screen.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({file: dest, program,
    proxyPaused: proxy.isPaused, runtimeIsRole: proxy.runtimeIsRole,
    assetSummary: assets.map(x => ({symbol: x.symbol, amountRaw: x.amountRaw,
      ownerProgram: authorityState.find(y => y.address === x.owner)?.programOwner,
      quotedOnePctUSDC: x.quotes?.[0]?.outAmount || null,
      quotedFullUSDC: x.quotes?.[1]?.outAmount || null,
      quoteError: x.quotes?.[1]?.error || null})),
    txs: transactions.length, directTransfers: transactions.flatMap(x => x.directTransfers).length,
    topLevel: transactions.filter(x => x.topLevel).length}));
}
main().catch(e => {console.error(e.stack || e); process.exitCode = 1;});
