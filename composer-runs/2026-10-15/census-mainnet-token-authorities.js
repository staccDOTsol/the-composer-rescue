#!/usr/bin/env node
// Read-only bounded census: top 20 accounts for every current Jupiter-verified
// mint, resolved to live SPL Token / Token-2022 authorities via Flux RPC.

const fs = require('fs');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const OUT = path.join(DIR, 'mainnet-token-authority-census.raw.json');
const CHECKPOINT = path.join(DIR, 'mainnet-token-authority-census.checkpoint.json');
const REGISTRY_URL = 'https://lite-api.jup.ag/tokens/v2/tag?query=verified';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SUPPORTED = new Set([TOKEN, TOKEN22]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
}
const endpoint = readEnv('/tmp/composer-helius-rpc.env').HEAVY_RPC_URL;
if (!endpoint) throw new Error('HEAVY_RPC_URL is unavailable');

function atomicJson(file, value) {
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

async function post(body, label) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(`${label}: non-JSON HTTP ${response.status}`); }
      if (response.status === 429 || response.status >= 500) throw new Error(`${label}: retryable HTTP ${response.status}`);
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      return parsed;
    } catch (error) {
      last = error;
      if (attempt === 6) break;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

async function rpc(method, params) {
  const response = await post({ jsonrpc: '2.0', id: 1, method, params }, method);
  if (response.error) throw new Error(`${method}: ${response.error.code} ${response.error.message}`);
  return response.result;
}

async function batchRpc(calls) {
  const response = await post(calls.map((call, index) => ({
    jsonrpc: '2.0', id: index + 1, method: call.method, params: call.params,
  })), 'batch RPC');
  const byId = new Map(response.map((row) => [row.id, row]));
  return calls.map((_, index) => byId.get(index + 1) || { error: { code: -1, message: 'missing response' } });
}

function compactToken(token) {
  return {
    mint: token.id, name: token.name, symbol: token.symbol, decimals: token.decimals,
    tokenProgram: token.tokenProgram,
    usdPrice: Number.isFinite(token.usdPrice) && token.usdPrice > 0 ? token.usdPrice : null,
    priceBlockId: token.priceBlockId ?? null, holderCount: token.holderCount ?? null,
    liquidity: token.liquidity ?? null, tags: token.tags || [], updatedAt: token.updatedAt ?? null,
  };
}

async function registry() {
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) throw new Error(`registry HTTP ${response.status}`);
  return (await response.json()).map(compactToken);
}

function fingerprint(tokens) { return `${tokens.length}:${tokens.map((token) => token.mint).join(',')}`; }

async function largestAccounts(tokens) {
  const prior = fs.existsSync(CHECKPOINT) ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) : null;
  const key = fingerprint(tokens);
  const results = prior?.fingerprint === key ? prior.results : {};
  for (let start = 0; start < tokens.length; start += 50) {
    const missing = tokens.slice(start, start + 50).filter((token) => !results[token.mint]);
    if (!missing.length) continue;
    const responses = await batchRpc(missing.map((token) => ({
      method: 'getTokenLargestAccounts', params: [token.mint, { commitment: 'confirmed' }],
    })));
    missing.forEach((token, index) => {
      const response = responses[index];
      results[token.mint] = response?.result?.value ? {
        slot: response.result.context?.slot ?? null,
        accounts: response.result.value.map((row) => ({ address: row.address, amount: row.amount })),
      } : { accounts: [], error: response?.error || { code: -1, message: 'missing result' } };
    });
    atomicJson(CHECKPOINT, { fingerprint: key, results });
    process.stderr.write(`largest accounts ${Math.min(start + 50, tokens.length)}/${tokens.length}\n`);
    await sleep(125);
  }
  return results;
}

function chunk(values, size) {
  const out = [];
  for (let start = 0; start < values.length; start += size) out.push(values.slice(start, start + size));
  return out;
}

async function multipleAccounts(addresses, dataSlice) {
  const rows = new Map(); const slots = [];
  const batches = chunk(addresses, 255);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const result = await rpc('getMultipleAccounts', [batch, { encoding: 'base64', commitment: 'confirmed', dataSlice }]);
    slots.push(result.context.slot);
    batch.forEach((address, offset) => rows.set(address, result.value[offset]));
    if ((index + 1) % 20 === 0 || index + 1 === batches.length) process.stderr.write(`account batches ${index + 1}/${batches.length}\n`);
    await sleep(125);
  }
  return { rows, slots };
}

function slotRange(slots) { return slots.length ? { min: Math.min(...slots), max: Math.max(...slots) } : { min: null, max: null }; }

async function main() {
  const startedAt = new Date().toISOString();
  const allTokens = await registry();
  const tokens = allTokens.filter((token) => SUPPORTED.has(token.tokenProgram));
  const unsupported = allTokens.filter((token) => !SUPPORTED.has(token.tokenProgram));
  const largest = await largestAccounts(tokens);

  const expected = new Map(); const duplicates = [];
  for (const token of tokens) for (const account of largest[token.mint]?.accounts || []) {
    const row = { ...token, amountAtLargestRead: account.amount, largestAccountsSlot: largest[token.mint].slot ?? null };
    if (expected.has(account.address)) duplicates.push({ address: account.address, firstMint: expected.get(account.address).mint, secondMint: token.mint });
    else expected.set(account.address, row);
  }

  const tokenRead = await multipleAccounts([...expected.keys()], { offset: 0, length: 72 });
  const tokenAccounts = [];
  for (const [address, wanted] of expected) {
    const info = tokenRead.rows.get(address);
    if (!info) { tokenAccounts.push({ address, ...wanted, exists: false }); continue; }
    const data = Buffer.from(info.data[0], 'base64');
    if (data.length < 72) { tokenAccounts.push({ address, ...wanted, exists: true, dataLength: data.length }); continue; }
    const mint = new PublicKey(data.subarray(0, 32)).toBase58();
    const authority = new PublicKey(data.subarray(32, 64)).toBase58();
    const rawAmount = data.readBigUInt64LE(64).toString();
    tokenAccounts.push({
      address, mint, authority, rawAmount, tokenProgram: info.owner, symbol: wanted.symbol,
      decimals: wanted.decimals, tags: wanted.tags, usdPrice: wanted.usdPrice,
      usdValue: wanted.usdPrice === null ? null : Number(rawAmount) / (10 ** wanted.decimals) * wanted.usdPrice,
      largestAccountsSlot: wanted.largestAccountsSlot,
      mintMatches: mint === wanted.mint, tokenProgramMatches: info.owner === wanted.tokenProgram,
      largestAmountMatches: rawAmount === wanted.amountAtLargestRead,
    });
  }

  const valid = tokenAccounts.filter((row) => row.mintMatches && row.tokenProgramMatches);
  const authorities = new Map();
  for (const row of valid) {
    let group = authorities.get(row.authority);
    if (!group) {
      group = { authority: row.authority, onCurve: PublicKey.isOnCurve(new PublicKey(row.authority).toBytes()), pricedGrossUsd: 0, priced: 0, unpriced: 0, tokenAccounts: [] };
      authorities.set(row.authority, group);
    }
    if (row.usdValue === null) group.unpriced += 1; else { group.priced += 1; group.pricedGrossUsd += row.usdValue; }
    group.tokenAccounts.push({ address: row.address, mint: row.mint, symbol: row.symbol, tokenProgram: row.tokenProgram, rawAmount: row.rawAmount, usdPrice: row.usdPrice, usdValue: row.usdValue, tags: row.tags });
  }

  const offCurve = [...authorities.values()].filter((row) => !row.onCurve).map((row) => row.authority);
  const authorityRead = await multipleAccounts(offCurve, { offset: 0, length: 0 });
  const ownerIds = new Set();
  for (const authority of offCurve) {
    const info = authorityRead.rows.get(authority); const group = authorities.get(authority);
    group.authorityAccount = info ? { exists: true, owner: info.owner, executable: info.executable, lamports: info.lamports, dataLength: info.space } : { exists: false };
    if (info) ownerIds.add(info.owner);
  }
  const ownerRead = await multipleAccounts([...ownerIds], { offset: 0, length: 0 });
  const ownerInfo = {};
  for (const owner of ownerIds) {
    const info = ownerRead.rows.get(owner);
    ownerInfo[owner] = info ? { exists: true, owner: info.owner, executable: info.executable, lamports: info.lamports, dataLength: info.space } : { exists: false };
  }

  const programs = new Map();
  for (const group of authorities.values()) {
    const owner = group.authorityAccount?.owner;
    group.directExecutableOwner = ownerInfo[owner]?.executable === true ? owner : null;
    if (!group.directExecutableOwner) continue;
    let program = programs.get(owner);
    if (!program) { program = { programId: owner, pricedGrossUsd: 0, priced: 0, unpriced: 0, authorities: [], tokenAccounts: 0 }; programs.set(owner, program); }
    program.pricedGrossUsd += group.pricedGrossUsd; program.priced += group.priced; program.unpriced += group.unpriced;
    program.authorities.push(group.authority); program.tokenAccounts += group.tokenAccounts.length;
  }

  const authorityRows = [...authorities.values()].sort((a, b) => b.pricedGrossUsd - a.pricedGrossUsd);
  const programRows = [...programs.values()].sort((a, b) => b.pricedGrossUsd - a.pricedGrossUsd);
  const success = tokens.filter((token) => !largest[token.mint]?.error);
  const errors = tokens.filter((token) => largest[token.mint]?.error);
  const largestSlots = success.map((token) => largest[token.mint].slot).filter(Number.isFinite);
  const output = {
    methodology: {
      kind: 'bounded top-holder census', registryUrl: REGISTRY_URL, registryFetchedAt: startedAt,
      perMintLimit: 20, largestAccountSource: 'Flux getTokenLargestAccounts', liveAccountSource: 'Flux getMultipleAccounts',
      noTransactionsSubmitted: true,
      exclusions: ['accounts below each mint top 20', 'mints absent from Jupiter verified registry', 'native SOL/stake', 'compressed tokens'],
    },
    denominator: {
      registryEntries: allTokens.length, supportedRegistryEntries: tokens.length, unsupportedRegistryEntries: unsupported.length,
      tokenProgramMints: tokens.filter((token) => token.tokenProgram === TOKEN).length,
      token2022Mints: tokens.filter((token) => token.tokenProgram === TOKEN22).length,
      pricedMints: tokens.filter((token) => token.usdPrice !== null).length,
      unpricedMints: tokens.filter((token) => token.usdPrice === null).length,
      successfulMints: success.length, erroredMints: errors.length,
      enumeratedTopAccountRows: [...expected.values()].length, uniqueTopAccounts: expected.size,
      duplicateTopAccounts: duplicates.length, liveBoundTokenAccounts: valid.length,
      distinctAuthorities: authorities.size, offCurveAuthorities: offCurve.length,
      directStateAuthoritiesMapped: authorityRows.filter((row) => row.directExecutableOwner).length,
      directExecutableProgramsMapped: programRows.length,
    },
    observationSlots: {
      largestAccounts: slotRange(largestSlots), tokenAccounts: slotRange(tokenRead.slots),
      authorityAccounts: slotRange(authorityRead.slots), authorityOwners: slotRange(ownerRead.slots),
    },
    unsupportedRegistry: unsupported, errors: errors.map((token) => ({ token, error: largest[token.mint].error })), duplicates,
    tokenAccounts, authorities: authorityRows, programsByDirectStateAuthority: programRows, ownerInfo,
    completedAt: new Date().toISOString(),
  };
  atomicJson(OUT, output);
  if (fs.existsSync(CHECKPOINT)) fs.unlinkSync(CHECKPOINT);
  process.stdout.write(`${JSON.stringify({ output: OUT, denominator: output.denominator, observationSlots: output.observationSlots, topPrograms: programRows.slice(0, 25), topOffCurveAuthorities: authorityRows.filter((row) => !row.onCurve).slice(0, 40).map((row) => ({ ...row, tokenAccounts: row.tokenAccounts.slice(0, 5) })) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
