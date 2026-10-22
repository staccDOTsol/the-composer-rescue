#!/usr/bin/env node
'use strict';

// Read-only transaction-history scanner for current Meteora DLMM control samples.
// It only calls getSignaturesForAddress/getTransaction and never signs or submits.

const fs = require('fs');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

function configuredRpc() {
  if (process.env.SOLANA_RPC) return process.env.SOLANA_RPC;
  const envPath = '/tmp/composer-helius-only.env';
  if (fs.existsSync(envPath)) {
    const values = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
    if (values.HEAVY_RPC_URL || values.RPC_URL) return values.HEAVY_RPC_URL || values.RPC_URL;
  }
  return 'https://api.mainnet-beta.solana.com';
}

const RPC = configuredRpc();
const PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const SCAN_ADDRESS = process.env.SCAN_ADDRESS || PROGRAM;
const OUT = process.env.OUT || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/meteora-dlmm-control-signatures.json';
const MAX_SIGNATURES = Number(process.env.MAX_SIGNATURES || 30000);
const PAGE_SIZE = Math.min(1000, Number(process.env.PAGE_SIZE || 1000));
const BLOCK_DELAY_MS = Number(process.env.BLOCK_DELAY_MS || 350);
const TOP_ONLY = process.env.TOP_ONLY === '1';

const TARGETS = new Map([
  ['414b3f4ceb5b5b88', 'swap2'],
  ['70bf65ab1c907fbb', 'claimFee2'],
  ['be037f77b2579db7', 'claimReward2'],
  ['cc02c391359191cd', 'removeLiquidityByRange2'],
  ['9ec99ebd215da267', 'withdrawProtocolFee'],
  ['0f843b32c706fb2e', 'migratePosition'],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function accountKeys(tx) {
  const staticKeys = (tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys || []).map(String);
  return [
    ...staticKeys,
    ...(tx.meta?.loadedAddresses?.writable || []).map(String),
    ...(tx.meta?.loadedAddresses?.readonly || []).map(String),
  ];
}

function allInstructions(tx) {
  const top = tx.transaction.message.instructions || tx.transaction.message.compiledInstructions || [];
  const inner = (tx.meta?.innerInstructions || []).flatMap((group) => group.instructions || []);
  return [...top.map((ix) => ({ ...ix, source: 'top' })), ...inner.map((ix) => ({ ...ix, source: 'inner' }))];
}

function matches(tx) {
  if (!tx || tx.meta?.err) return [];
  const keys = accountKeys(tx);
  const found = [];
  for (const ix of allInstructions(tx)) {
    if (keys[ix.programIdIndex] !== PROGRAM || !ix.data) continue;
    let bytes;
    try { bytes = Buffer.from(bs58.decode(ix.data)); } catch { continue; }
    const discriminator = bytes.subarray(0, 8).toString('hex');
    const name = TARGETS.get(discriminator);
    if (!name) continue;
    if (TOP_ONLY && ix.source !== 'top') continue;
    found.push({
      name,
      discriminator,
      source: ix.source,
      accountsLength: ix.accounts.length,
      dataLength: bytes.length,
    });
  }
  return found;
}

async function main() {
  // Validate the configured program key before the scan begins.
  new PublicKey(PROGRAM);
  const found = Object.fromEntries([...TARGETS.values()].map((name) => [name, []]));
  let before;
  let scannedSignatures = 0;
  let fetchedTransactions = 0;
  let fetchedBlocks = 0;
  let newestSlot = null;
  let oldestSlot = null;
  const scannedSlots = new Set();

  while (scannedSignatures < MAX_SIGNATURES && Object.values(found).some((rows) => rows.length < 3)) {
    const options = { limit: Math.min(PAGE_SIZE, MAX_SIGNATURES - scannedSignatures), commitment: 'confirmed' };
    if (before) options.before = before;
    const rows = await rpc('getSignaturesForAddress', [SCAN_ADDRESS, options]);
    if (!rows.length) break;
    if (newestSlot == null) newestSlot = rows[0].slot;
    oldestSlot = rows[rows.length - 1].slot;
    before = rows[rows.length - 1].signature;
    scannedSignatures += rows.length;

    const slots = [...new Set(rows.map((row) => row.slot))].filter((slot) => !scannedSlots.has(slot)).sort((a, b) => b - a);
    for (const blockSlot of slots) {
      let block;
      try {
        block = await rpc('getBlock', [blockSlot, {
          commitment: 'confirmed',
          encoding: 'json',
          maxSupportedTransactionVersion: 1,
          transactionDetails: 'full',
          rewards: false,
        }]);
      } catch (error) {
        process.stderr.write(`${JSON.stringify({ blockSlot, blockError: String(error?.message || error) })}\n`);
        await sleep(1500);
        continue;
      }
      scannedSlots.add(blockSlot);
      fetchedBlocks += 1;
      const txs = block?.transactions || [];
      fetchedTransactions += txs.length;
      for (const tx of txs) {
        for (const hit of matches(tx)) {
          const list = found[hit.name];
          if (list.length >= 3) continue;
          list.push({
            signature: String(tx.transaction.signatures[0]),
            slot: blockSlot,
            blockTime: block.blockTime,
            ...hit,
          });
        }
      }
      await sleep(BLOCK_DELAY_MS);
    }

    const output = {
      observedAt: new Date().toISOString(),
      rpcHost: new URL(RPC).hostname,
      programId: PROGRAM,
      scanAddress: SCAN_ADDRESS,
      topOnly: TOP_ONLY,
      maxSignatures: MAX_SIGNATURES,
      scannedSignatures,
      fetchedTransactions,
      fetchedBlocks,
      newestSlot,
      oldestSlot,
      found,
    };
    fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
    process.stderr.write(`${JSON.stringify({ scannedSignatures, fetchedBlocks, fetchedTransactions, newestSlot, oldestSlot, counts: Object.fromEntries(Object.entries(found).map(([name, hits]) => [name, hits.length])) })}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
