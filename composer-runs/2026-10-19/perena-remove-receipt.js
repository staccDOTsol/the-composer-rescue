#!/usr/bin/env node
'use strict';

// Read-only extraction of the recent Composer-observed Perena remove-liquidity
// receipt used to recover the exact current remaining-account order.

const fs = require('fs');
const path = require('path');
const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const PROGRAM = 'NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P';
const SIGNATURE = '3pCnbuuKAfyZFyiH7EoE5vs6G3PEBfjAAbdbPubtKUi4ACns63rbKPPuYGwbLeUVpf7F5FeiN38Ugfu8AqE51Tsh';

function loadRpc() {
  const values = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const endpoint = values.RPC || values.SOLANA_RPC || values.SOLANA_RPC_URL || values.RPC_URL ||
    values.HEAVY_RPC_URL || values.HELIUS_RPC_URL;
  if (!endpoint) throw new Error('RPC variable unavailable');
  return endpoint;
}

async function main() {
  const response = await fetch(loadRpc(), {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [SIGNATURE,
      {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]}),
    signal: AbortSignal.timeout(60_000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(JSON.stringify(body.error || body));
  const tx = body.result;
  const perena = [];
  for (const group of tx.meta?.innerInstructions || []) {
    for (let i = 0; i < group.instructions.length; i += 1) {
      const ix = group.instructions[i];
      if (ix.programId === PROGRAM) perena.push({outerInstructionIndex: group.index,
        innerInstructionIndex: i, stackHeight: ix.stackHeight ?? null, accounts: ix.accounts,
        data: ix.data});
    }
  }
  const output = {generatedAtUtc: new Date().toISOString(), network: 'mainnet-beta', signature: SIGNATURE,
    slot: tx.slot, err: tx.meta?.err ?? null, perena, accountKeys: tx.transaction.message.accountKeys,
    outerInstructions: tx.transaction.message.instructions || [],
    innerInstructions: tx.meta?.innerInstructions || [], logMessages: tx.meta?.logMessages || [],
    preTokenBalances: tx.meta?.preTokenBalances || [], postTokenBalances: tx.meta?.postTokenBalances || [],
    safety: {readOnlyRpc: true, sendTransactionCalled: false, broadcast: false}};
  const out = path.join(__dirname, 'perena-remove-receipt.json');
  fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({out, generatedAtUtc: output.generatedAtUtc, slot: output.slot,
    err: output.err, perena, safety: output.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
