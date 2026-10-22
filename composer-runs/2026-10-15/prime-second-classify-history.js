#!/usr/bin/env node
'use strict';

// Read-only classification of recent NTT program activity and claim amounts.
const fs = require('fs');
const path = require('path');
const anchor = require('./kliquidity-sdk-official/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const PROGRAM = '4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT';
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, 'prime-second-onchain-idl.json'), 'utf8'));
const instructionCoder = new anchor.BorshInstructionCoder(idl);
const live = JSON.parse(fs.readFileSync(path.join(__dirname, 'prime-second-live-evidence.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'prime-second-state-snapshot.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoints = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];

let id = 0;
async function rpc(method, params) {
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      if (!response.ok) {errors.push(`HTTP ${response.status}`); continue;}
      const body = await response.json();
      if (body.error) {errors.push(`${body.error.code}: ${body.error.message}`); continue;}
      return body.result;
    } catch (error) {errors.push(error.message);}
  }
  throw new Error(`${method}: ${errors.join('; ')}`);
}

function keysFor(tx) {
  const message = tx.transaction.message;
  return [...message.accountKeys, ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || [])];
}

function classify(tx, signature) {
  const keys = keysFor(tx);
  const instructions = tx.transaction.message.instructions.map((ix, index) => {
    const programId = keys[ix.programIdIndex];
    const decoded = programId === PROGRAM ? instructionCoder.decode(ix.data, 'base58') : null;
    return {index, programId, name: decoded?.name || null,
      data: decoded?.data || null, accounts: ix.accounts.map(i => keys[i])};
  });
  const pre = new Map((tx.meta?.preTokenBalances || []).map(row => [row.accountIndex, row]));
  const post = new Map((tx.meta?.postTokenBalances || []).map(row => [row.accountIndex, row]));
  const tokenDeltas = [...new Set([...pre.keys(), ...post.keys()])].sort((a, b) => a - b).map(index => {
    const a = pre.get(index), b = post.get(index);
    const before = a?.uiTokenAmount?.amount || '0', after = b?.uiTokenAmount?.amount || '0';
    return {address: keys[index], mint: b?.mint || a?.mint, owner: b?.owner || a?.owner || null,
      preRaw: before, postRaw: after, deltaRaw: (BigInt(after) - BigInt(before)).toString(),
      decimals: b?.uiTokenAmount?.decimals ?? a?.uiTokenAmount?.decimals ?? null};
  }).filter(row => row.deltaRaw !== '0');
  return {signature, slot: tx.slot, blockTime: tx.blockTime, version: tx.version,
    err: tx.meta?.err || null, computeUnitsConsumed: tx.meta?.computeUnitsConsumed ?? null,
    instructionNames: instructions.map(ix => ix.name || ix.programId), instructions,
    tokenDeltas, relevant: instructions.filter(ix => ix.programId === PROGRAM).map(ix => ({
      name: ix.name, payer: ix.accounts[0] || null,
      config: ix.accounts[1] || null,
      inboxItem: ix.name === 'redeem' ? ix.accounts[6]
        : ix.name?.startsWith('releaseInbound') ? ix.accounts[2] : null,
      recipient: ix.name?.startsWith('releaseInbound') ? ix.accounts[3] : null,
      transceiverMessage: ix.name === 'receiveWormholeMessage' ? ix.accounts[4]
        : ix.name === 'redeem' ? ix.accounts[3] : null,
      vaa: ix.name === 'receiveWormholeMessage' ? ix.accounts[3] : null,
    }))};
}

async function main() {
  const signatures = live.recentSignatures.program.slice(0, 25).map(row => row.signature);
  const transactions = [];
  for (const signature of signatures) {
    const tx = await rpc('getTransaction', [signature,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
    if (tx) transactions.push(classify(tx, signature));
  }
  const inbox = state.accounts.filter(row => row.type === 'InboxItem' && row.decoded?.amount !== undefined);
  const amounts = inbox.map(row => BigInt(row.decoded.amount)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const sum = amounts.reduce((a, b) => a + b, 0n);
  const amountStats = {count: amounts.length, minRaw: amounts[0]?.toString() || null,
    medianRaw: amounts.length ? amounts[Math.floor(amounts.length / 2)].toString() : null,
    maxRaw: amounts.at(-1)?.toString() || null, sumRaw: sum.toString(),
    oneRawCount: amounts.filter(value => value === 1n).length,
    belowOneTokenCount: amounts.filter(value => value < 1_000_000n).length,
    uniqueAmountCount: new Set(amounts.map(String)).size};
  const output = {generatedAt: new Date().toISOString(),
    rpc: 'configured authenticated Solana RPC (URL redacted)', noTransactionsSubmitted: true,
    programId: PROGRAM, recentCount: transactions.length, amountStats, transactions};
  const file = path.join(__dirname, 'prime-second-history.json');
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({file, recentCount: transactions.length, amountStats,
    recent: transactions.map(tx => ({signature: tx.signature, slot: tx.slot,
      names: tx.instructionNames, tokenDeltas: tx.tokenDeltas}))}, null, 2)}\n`);
}

main().catch(error => {process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;});
