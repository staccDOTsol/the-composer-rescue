#!/usr/bin/env node
'use strict';

// Read-only transaction discovery for Sanctum INF. This script only calls
// getSignaturesForAddress/getTransaction and writes a compact index.
const fs = require('fs');
const bs58mod = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58mod.default || bs58mod;

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PROGRAM = '5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx';
const OUT = process.argv[2] || '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15/sanctum-inf-control-index.json';
let rpcId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, retries = 7) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    const body = await response.json();
    if (body.error) {
      if (attempt < retries && /429|limit|tempor|internal/i.test(JSON.stringify(body.error))) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result;
  }
}

function instructionRows(tx, signature) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = tx.meta?.loadedAddresses?.writable || [];
  const loadedReadonly = tx.meta?.loadedAddresses?.readonly || [];
  const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  return message.instructions.flatMap((ix, index) => {
    if (allKeys[ix.programIdIndex] !== PROGRAM) return [];
    const data = Buffer.from(bs58.decode(ix.data));
    return [{
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      outerInstructionIndex: index,
      discriminator: data[0],
      dataHex: data.toString('hex'),
      accountCount: ix.accounts.length,
      accounts: ix.accounts.map((accountIndex) => allKeys[accountIndex]),
      staticKeyCount: staticKeys.length,
      loadedWritableCount: loadedWritable.length,
      loadedReadonlyCount: loadedReadonly.length,
    }];
  });
}

async function main() {
  const found = [];
  const counts = {};
  let before;
  let inspected = 0;
  for (let page = 0; page < 8; page++) {
    const signatures = await rpc('getSignaturesForAddress', [PROGRAM, {
      limit: 100, commitment: 'confirmed', ...(before ? {before} : {}),
    }]);
    if (!signatures.length) break;
    for (const row of signatures) {
      if (row.err) continue;
      inspected++;
      const tx = await rpc('getTransaction', [row.signature, {
        encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
      }]);
      if (!tx || tx.meta?.err) continue;
      for (const hit of instructionRows(tx, row.signature)) {
        found.push(hit);
        counts[hit.discriminator] = (counts[hit.discriminator] || 0) + 1;
      }
      if (found.length >= 40 && [1, 2, 3, 4, 14, 23, 24, 25].filter((x) => counts[x]).length >= 4) break;
      await sleep(25);
    }
    before = signatures[signatures.length - 1].signature;
    if (found.length >= 40 && [1, 2, 3, 4, 14, 23, 24, 25].filter((x) => counts[x]).length >= 4) break;
  }
  const output = {generatedAt: new Date().toISOString(), program: PROGRAM, inspected, counts, found};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({out: OUT, inspected, counts, samples: found.map((x) => ({signature: x.signature, slot: x.slot, index: x.outerInstructionIndex, discriminator: x.discriminator, accounts: x.accountCount})).slice(0, 50)}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
