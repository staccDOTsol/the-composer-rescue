#!/usr/bin/env node
'use strict';

// Read-only finalized trace of every signature returned for the two selected
// token accounts. This script only calls getTransaction and writes local JSON.

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(HERE, 'current-snapshot.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
if (!env.RPC_URL) throw new Error('RPC_URL missing from private environment file');

let id = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(env.RPC_URL, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 6) await sleep(500 * (2 ** attempt));
    }
  }
  throw last;
}

function accountKeyText(key) {
  return typeof key === 'string' ? key : key.pubkey;
}

function tokenBalance(rows, index) {
  const row = (rows || []).find((item) => item.accountIndex === index);
  return row ? BigInt(row.uiTokenAmount.amount) : null;
}

function parsedInstruction(ix, level, parentIndex) {
  if (!ix || typeof ix !== 'object') return null;
  const parsed = ix.parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    level,
    parentIndex,
    program: ix.program || null,
    programId: ix.programId || null,
    type: parsed.type || null,
    info: parsed.info || null,
  };
}

function involved(parsed, address) {
  if (!parsed) return false;
  return Object.values(parsed.info || {}).some((value) => value === address);
}

async function trace(history) {
  const rows = [];
  for (const signatureRow of history.vaultHistory.signatures) {
    const tx = await rpc('getTransaction', [signatureRow.signature, {
      commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 1,
    }]);
    if (!tx) throw new Error(`transaction unavailable: ${signatureRow.signature}`);
    const keys = tx.transaction.message.accountKeys.map(accountKeyText);
    const index = keys.indexOf(history.vault);
    if (index < 0) throw new Error(`vault absent from ${signatureRow.signature}`);
    const before = tokenBalance(tx.meta.preTokenBalances, index);
    const after = tokenBalance(tx.meta.postTokenBalances, index);
    const parsed = [];
    tx.transaction.message.instructions.forEach((ix, outerIndex) => {
      const row = parsedInstruction(ix, 'outer', outerIndex);
      if (row) parsed.push(row);
    });
    for (const group of tx.meta.innerInstructions || []) {
      for (const ix of group.instructions || []) {
        const row = parsedInstruction(ix, 'inner', group.index);
        if (row) parsed.push(row);
      }
    }
    const vaultInstructions = parsed.filter((row) => involved(row, history.vault));
    rows.push({
      signature: signatureRow.signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      err: tx.meta.err,
      feePayer: keys[0],
      signerKeys: tx.transaction.message.accountKeys.filter((key) => typeof key !== 'string' && key.signer).map(accountKeyText),
      vaultAccountIndex: index,
      preRawAmount: before === null ? null : before.toString(),
      postRawAmount: after === null ? null : after.toString(),
      deltaRaw: before === null || after === null ? null : (after - before).toString(),
      vaultWasDebited: before !== null && after !== null && after < before,
      vaultInstructions,
      allParsedTokenInstructions: parsed.filter((row) => row.program === 'spl-token' || row.program === 'spl-associated-token-account'),
    });
  }
  return rows;
}

async function main() {
  const targets = [];
  for (const history of snapshot.histories) {
    const transactions = await trace(history);
    targets.push({
      authority: history.authority,
      vault: history.vault,
      requestedSignatureLimit: history.vaultHistory.requestedLimit,
      returnedSignatures: history.vaultHistory.returned,
      oldestReturnedSlot: history.vaultHistory.oldestSlot,
      newestReturnedSlot: history.vaultHistory.newestSlot,
      everyReturnedTransactionFetched: transactions.length === history.vaultHistory.returned,
      anySuccessfulDebit: transactions.some((row) => row.err === null && row.vaultWasDebited),
      transactions,
    });
  }
  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'finalized',
    observedSnapshotSlot: snapshot.observedSlot,
    rpcMethods: ['getTransaction'],
    noTransactionsSubmitted: true,
    targets,
  };
  const outputPath = path.join(HERE, 'vault-history-traces.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    targets: targets.map(({authority, vault, returnedSignatures, oldestReturnedSlot, newestReturnedSlot, anySuccessfulDebit, transactions}) => ({
      authority, vault, returnedSignatures, oldestReturnedSlot, newestReturnedSlot, anySuccessfulDebit,
      deltas: transactions.map(({signature, slot, preRawAmount, postRawAmount, deltaRaw, vaultWasDebited}) => ({signature, slot, preRawAmount, postRawAmount, deltaRaw, vaultWasDebited})),
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
