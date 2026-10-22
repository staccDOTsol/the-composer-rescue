#!/usr/bin/env node
'use strict';

// Bounded read-only refresh: two vaults, four recent MNGO signatures,
// two recent mangoSOL signatures, and a short sequence of executable quotes.
// There is no transaction construction, signing, simulation, or submission.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const PROGRAM = 'DisJzzeTrLXzJgtaaqBxcNKLrLFyc4mY3ELGCdEkVPzt';
const MNGO_VAULT = 'AgLqWkeqAVrQbj1tMuTAtAao1oRVXScVjrPRmBC5AxeY';
const MANGOSOL_VAULT = 'EukVHqQDMUy8La6R9KR7PHPh5YYmBZt8XoYNuYvmWXsE';
const MNGO_AUTHORITY = '3JaWRPs677Q22oLz3xT1rPD7yhCEL3Njp9raruM81VCS';
const MANGOSOL_AUTHORITY = '4NcjVs9xEsP7ny7Ku9fAxBdEgA7vPgWTDhssSs7v6bsd';
const MNGO = 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac';
const MANGOSOL = 'MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC = process.env.RPC_URL || env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC) throw new Error('missing RPC endpoint');
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${response.status} ${JSON.stringify(body.error || body)}`);
  return body.result;
}
function accountImage(address, entry) {
  if (!entry) return { address, exists: false };
  const data = Buffer.from(entry.data[0], 'base64');
  const out = { address, exists: true, owner: entry.owner, executable: entry.executable, dataLength: data.length };
  if (entry.owner === TOKEN_PROGRAM && data.length >= 165) {
    out.mint = new PublicKey(data.subarray(0, 32)).toBase58();
    out.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    out.rawAmount = data.readBigUInt64LE(64).toString();
  }
  return out;
}
async function signatureSample(vault, count) {
  const signatures = await rpc('getSignaturesForAddress', [vault, { limit: count, commitment: 'finalized' }]);
  const transactions = [];
  for (const signature of signatures) {
    const transaction = await rpc('getTransaction', [signature.signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if (!transaction) continue;
    const keys = transaction.transaction.message.accountKeys.map((key) => typeof key === 'string' ? key : key.pubkey);
    const top = transaction.transaction.message.instructions.map((ix) => ix.programId);
    const transfers = [];
    for (const inner of transaction.meta?.innerInstructions || []) {
      const parentProgram = top[inner.index];
      for (const ix of inner.instructions) {
        if (ix.programId !== TOKEN_PROGRAM || !['transfer', 'transferChecked'].includes(ix.parsed?.type)) continue;
        const info = ix.parsed.info;
        if (info.source !== vault && info.destination !== vault) continue;
        transfers.push({ parentProgram, type: ix.parsed.type, source: info.source, destination: info.destination,
          authority: info.authority, rawAmount: info.amount || info.tokenAmount?.amount || null,
          direction: info.source === vault ? 'out' : 'in' });
      }
    }
    transactions.push({ signature: signature.signature, slot: transaction.slot, err: transaction.meta?.err || null,
      topLevelPrograms: top, relevantTransfers: transfers, accountCount: keys.length });
  }
  return { vault, signaturesRequested: count, signaturesReturned: signatures.length, transactions };
}
async function quote(mint, amountRaw) {
  const url = `https://lite-api.jup.ag/swap/v1/quote?${new URLSearchParams({
    inputMint: mint, outputMint: USDC, amount: amountRaw.toString(), swapMode: 'ExactIn', slippageBps: '50',
  })}`;
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) return { amountRaw: amountRaw.toString(), status: response.status,
    errorCode: body.errorCode || null, error: body.error || null };
  return { amountRaw: amountRaw.toString(), outUsdcRaw: body.outAmount,
    priceImpactPct: body.priceImpactPct, route: (body.routePlan || []).map((leg) => leg.swapInfo.label) };
}
async function main() {
  const addresses = [PROGRAM, MNGO_VAULT, MANGOSOL_VAULT, MNGO_AUTHORITY, MANGOSOL_AUTHORITY];
  const accounts = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }]);
  const current = {
    fetchedAt: new Date().toISOString(), slot: accounts.context.slot,
    accounts: Object.fromEntries(addresses.map((address, index) => [address, accountImage(address, accounts.value[index])])),
    samples: [await signatureSample(MNGO_VAULT, 4), await signatureSample(MANGOSOL_VAULT, 2)],
  };
  fs.writeFileSync(path.join(DIR, 'fresh-gate-snapshot.json'), JSON.stringify(current, null, 2) + '\n');
  const mngoRaw = BigInt(current.accounts[MNGO_VAULT].rawAmount);
  const mangoSolRaw = BigInt(current.accounts[MANGOSOL_VAULT].rawAmount);
  const depth = { fetchedAt: new Date().toISOString(), quoteProvider: 'Jupiter lite swap/v1/quote',
    quoteMode: 'ExactIn', slippageBps: 50, caveat: 'Read-only route quotes; not a transaction or executable aggregate liquidation guarantee.',
    assets: [] };
  for (const [mint, vault, amounts] of [
    [MNGO, MNGO_VAULT, [1_000_000_000_000n, 10_000_000_000_000n, 100_000_000_000_000n, mngoRaw]],
    [MANGOSOL, MANGOSOL_VAULT, [1_000_000_000n, 100_000_000_000n, 1_000_000_000_000n, mangoSolRaw]],
  ]) {
    const quotes = [];
    for (const amount of amounts) quotes.push(await quote(mint, amount));
    depth.assets.push({ mint, vault, vaultRaw: current.accounts[vault].rawAmount, quotes });
  }
  fs.writeFileSync(path.join(DIR, 'fresh-exit-depth.json'), JSON.stringify(depth, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ slot: current.slot,
    balances: [current.accounts[MNGO_VAULT].rawAmount, current.accounts[MANGOSOL_VAULT].rawAmount],
    samples: current.samples.map((s) => ({ vault: s.vault, returned: s.signaturesReturned,
      transfers: s.transactions.flatMap((t) => t.relevantTransfers).map((x) => ({ direction: x.direction,
        parentProgram: x.parentProgram, rawAmount: x.rawAmount })) })),
    quotes: depth.assets.map((a) => ({ mint: a.mint, quotes: a.quotes })) }, null, 2) + '\n');
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
