#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta evidence collector for the deployed AlphaQ executable
// and recent successful transactions that actually invoke it. No transaction is
// constructed, signed, submitted, or broadcast by this script.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const bs58Module = require(MODULES + '/bs58');
const bs58 = bs58Module.default || bs58Module;

const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const ALPHAQ = 'ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA';
const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const CASH = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL_CASH = '2A5Cmp2mYwPzdxsQ5w6YTukYR2dNjCWVhnDTWUrifRxd';
const POOL_USDC = 'F2KCaXcp7AoQtxTDvNEDCyMyWjSCAMWNzcyN9dsPfPs5';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
let rpcId = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function rpc(method, params = [], attempts = 20) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})
    });
    const body = await response.text();
    if (response.status === 429) {
      last = new Error(`${method}: rate limited`);
      await sleep(Math.min(10000, 1000 * (attempt + 1)));
      continue;
    }
    let json;
    try { json = JSON.parse(body); } catch {
      throw new Error(`${method}: non-JSON response (${response.status})`);
    }
    if (json.error) {
      last = new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
      if (json.error.code === -32005) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw last;
    }
    return json.result;
  }
  throw last || new Error(`${method}: exhausted retries`);
}

async function programIdentity(programId, saveBinary) {
  const response = await rpc('getAccountInfo', [programId, {encoding: 'base64', commitment: 'confirmed'}]);
  const account = response.value;
  if (!account) throw new Error(`missing program account ${programId}`);
  const programData = Buffer.from(account.data[0], 'base64');
  const identity = {
    programId,
    programOwner: account.owner,
    executable: account.executable,
    programAccountDataSha256: sha256(programData),
    deploymentKind: account.owner === UPGRADEABLE ? 'upgradeable-loader' : 'direct-loader'
  };
  let code = programData;
  if (account.owner === UPGRADEABLE) {
    if (programData.length < 36 || programData.readUInt32LE(0) !== 2) {
      throw new Error(`unexpected upgradeable program account layout for ${programId}`);
    }
    const programDataAddress = bs58.encode(programData.subarray(4, 36));
    const pdResponse = await rpc('getAccountInfo', [programDataAddress, {encoding: 'base64', commitment: 'confirmed'}]);
    const pd = pdResponse.value;
    if (!pd) throw new Error(`missing program-data account for ${programId}`);
    const bytes = Buffer.from(pd.data[0], 'base64');
    if (bytes.length < 45 || bytes.readUInt32LE(0) !== 3) {
      throw new Error(`unexpected program-data layout for ${programId}`);
    }
    const authorityTag = bytes[12];
    identity.programDataAddress = programDataAddress;
    identity.lastDeploySlot = Number(bytes.readBigUInt64LE(4));
    identity.upgradeAuthority = authorityTag === 1 ? bs58.encode(bytes.subarray(13, 45)) : null;
    identity.programDataAccountSha256 = sha256(bytes);
    identity.programDataLength = bytes.length;
    code = bytes.subarray(45);
  }
  identity.executableSha256 = sha256(code);
  identity.executableLength = code.length;
  identity.elfMagic = code.subarray(0, 4).toString('hex');
  if (saveBinary) {
    const evidenceDir = path.join(__dirname, 'evidence');
    fs.mkdirSync(evidenceDir, {recursive: true});
    const binaryPath = path.join(evidenceDir, 'alphaq-current-mainnet.so');
    fs.writeFileSync(binaryPath, code);
    identity.savedBinary = path.relative(__dirname, binaryPath);
  }
  return identity;
}

function pubkey(value) {
  return typeof value === 'string' ? value : value.pubkey;
}

function allKeys(tx) {
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  return [
    ...tx.transaction.message.accountKeys.map(pubkey),
    ...loaded.writable,
    ...loaded.readonly
  ];
}

function invocationParents(logs, target) {
  const stack = [];
  const found = [];
  for (const line of logs || []) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) {
      const depth = Number(invoke[2]);
      stack.length = depth - 1;
      const parent = depth > 1 ? stack[depth - 2] || null : null;
      stack[depth - 1] = invoke[1];
      if (invoke[1] === target) found.push({depth, immediateParent: parent});
      continue;
    }
    const done = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:)/.exec(line);
    if (done) {
      const index = stack.lastIndexOf(done[1]);
      if (index >= 0) stack.length = index;
    }
  }
  return found;
}

function tokenDeltas(meta) {
  const pre = new Map((meta.preTokenBalances || []).map(x => [x.accountIndex, x]));
  const post = new Map((meta.postTokenBalances || []).map(x => [x.accountIndex, x]));
  const indices = [...new Set([...pre.keys(), ...post.keys()])].sort((a, b) => a - b);
  const out = [];
  for (const accountIndex of indices) {
    const before = pre.get(accountIndex);
    const after = post.get(accountIndex);
    const mint = after?.mint || before?.mint;
    if (mint !== CASH && mint !== USDC) continue;
    const beforeRaw = BigInt(before?.uiTokenAmount?.amount || 0);
    const afterRaw = BigInt(after?.uiTokenAmount?.amount || 0);
    const deltaRaw = afterRaw - beforeRaw;
    if (deltaRaw === 0n) continue;
    out.push({accountIndex, mint, beforeRaw: beforeRaw.toString(), afterRaw: afterRaw.toString(), deltaRaw: deltaRaw.toString()});
  }
  return out;
}

function alphaQInstructions(tx, keys) {
  const found = [];
  const message = tx.transaction.message;
  for (let outerIndex = 0; outerIndex < message.instructions.length; outerIndex++) {
    const outer = message.instructions[outerIndex];
    if (keys[outer.programIdIndex] === ALPHAQ) {
      found.push({kind: 'top-level', outerIndex, accountCount: outer.accounts.length, dataHex: Buffer.from(bs58.decode(outer.data)).toString('hex')});
    }
    const group = (tx.meta.innerInstructions || []).find(x => x.index === outerIndex);
    for (const inner of group?.instructions || []) {
      if (keys[inner.programIdIndex] !== ALPHAQ) continue;
      found.push({
        kind: 'inner',
        outerIndex,
        outerProgram: keys[outer.programIdIndex],
        stackHeight: inner.stackHeight ?? null,
        accountCount: inner.accounts.length,
        dataHex: Buffer.from(bs58.decode(inner.data)).toString('hex')
      });
    }
  }
  return found;
}

function receiptFromTransaction(row, tx) {
  const keys = allKeys(tx);
  const calls = alphaQInstructions(tx, keys);
  if (!calls.length) return null;
  return {
    signature: row.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    topLevelPrograms: [...new Set(tx.transaction.message.instructions.map(ix => keys[ix.programIdIndex]))],
    invocationParents: invocationParents(tx.meta.logMessages, ALPHAQ),
    alphaQInstructions: calls,
    cashUsdcTokenDeltas: tokenDeltas(tx.meta),
    computeUnitsConsumed: tx.meta.computeUnitsConsumed ?? null,
    feeLamports: tx.meta.fee,
    accountKeyCount: keys.length,
    includesCashPoolVaults: keys.includes(POOL_CASH) && keys.includes(POOL_USDC)
  };
}

async function main() {
  const outputPath = path.join(__dirname, 'alphaq-current-receipts.json');
  const cached = process.env.RESUME === '1' && fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : null;
  const genesis = await rpc('getGenesisHash');
  if (genesis !== MAINNET_GENESIS) throw new Error('RPC is not mainnet-beta');
  const identity = cached?.programIdentity || await programIdentity(ALPHAQ, true);
  const receipts = cached?.receipts || [];
  if (!receipts.length) {
    const statusRows = await rpc('getSignaturesForAddress', [ALPHAQ, {limit: 100, commitment: 'confirmed'}]);
    for (const row of statusRows) {
      if (row.err) continue;
      const tx = await rpc('getTransaction', [row.signature, {
        encoding: 'json',
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 1
      }]);
      if (!tx || tx.meta.err) continue;
      const receipt = receiptFromTransaction(row, tx);
      if (!receipt) continue;
      receipts.push(receipt);
      if (receipts.length >= 8) break;
      await sleep(500);
    }
  }
  await sleep(1500);
  const poolStatusRows = await rpc('getSignaturesForAddress', [POOL_USDC, {limit: 100, commitment: 'confirmed'}]);
  const cashUsdcReceipts = [];
  for (const row of poolStatusRows) {
    if (row.err) continue;
    const tx = await rpc('getTransaction', [row.signature, {
      encoding: 'json',
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 1
    }]);
    if (!tx || tx.meta.err) continue;
    const receipt = receiptFromTransaction(row, tx);
    if (!receipt || !receipt.includesCashPoolVaults) continue;
    cashUsdcReceipts.push(receipt);
    if (cashUsdcReceipts.length >= 8) break;
    await sleep(750);
  }
  const parentIds = [...new Set(receipts.flatMap(r => r.invocationParents.map(x => x.immediateParent)).filter(Boolean))];
  const parentIdentities = cached?.parentIdentities || [];
  if (!parentIdentities.length) {
    for (const programId of parentIds) {
      try { parentIdentities.push(await programIdentity(programId, false)); }
      catch (error) { parentIdentities.push({programId, error: error.message}); }
    }
  }
  const out = {
    observedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis,
    source: 'getSignaturesForAddress + confirmed getTransaction receipts',
    programIdentity: identity,
    parentIdentities,
    receipts,
    cashUsdcPool: {cashVault: POOL_CASH, usdcVault: POOL_USDC},
    cashUsdcReceipts,
    noTransactionConstructed: true,
    noTransactionSigned: true,
    noBroadcast: true,
    limitations: [
      'The latest 100 address signatures are a bounded receipt window.',
      'The CASH/USDC receipt window is bounded to the latest 100 sampled USDC-vault signatures.',
      'Successful historical receipts prove routed value movement but do not establish outsider profitability.'
    ]
  };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({
    observedAtUtc: out.observedAtUtc,
    programIdentity: identity,
    parentIdentities,
    receiptCount: receipts.length,
    cashUsdcReceiptCount: cashUsdcReceipts.length,
    cashUsdcReceiptSummary: cashUsdcReceipts.map(r => ({
      slot: r.slot,
      parent: r.invocationParents,
      calls: r.alphaQInstructions,
      deltas: r.cashUsdcTokenDeltas,
      keys: r.accountKeyCount,
      compute: r.computeUnitsConsumed
    })),
    receiptSummary: receipts.map(r => ({
      slot: r.slot,
      parent: r.invocationParents,
      calls: r.alphaQInstructions,
      deltas: r.cashUsdcTokenDeltas,
      keys: r.accountKeyCount,
      compute: r.computeUnitsConsumed
    })),
    evidence: outputPath
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
