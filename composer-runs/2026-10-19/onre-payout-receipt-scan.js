#!/usr/bin/env node
'use strict';

// Read-only current-mainnet scan for successful OnRe USDG payouts after the
// deployed ProgramData slot. This file has no transaction submission path.

const fs = require('fs');
const path = require('path');
const {createRequire} = require('module');
const requireAudit = createRequire(path.join(__dirname, '../2026-10-15/onre-harness/package.json'));
const bs58Module = requireAudit('bs58');
const bs58 = bs58Module.default || bs58Module;

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL is required');

const OUTPUT = process.env.ONRE_RECEIPT_OUTPUT || path.join(__dirname, 'onre-payout-receipts.json');
const PROGRAM = 'onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe';
const USDG = '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH';
const USDG_REDEMPTION_VAULT = '2XgTjcME2M18RgUzoJfaXbAeM5VGiigYCzYBegUSAGZC';
const DEPLOY_SLOT = 452310149;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 20;

const discriminatorRows = [
  ['OpenSwapSell', [93, 206, 188, 72, 45, 138, 181, 71]],
  ['FulfillRedemptionRequest', [140, 124, 139, 242, 179, 153, 208, 66]],
  ['OfferVaultWithdraw', [230, 135, 129, 48, 138, 202, 20, 72]],
  ['RedemptionVaultWithdraw', [48, 214, 145, 15, 168, 122, 39, 48]],
  ['WithdrawConfigurableVault', [255, 81, 28, 61, 192, 180, 29, 13]],
  ['TakeOfferPermissionlessV2', [37, 190, 224, 77, 197, 39, 203, 230]],
];
const discriminators = new Map(discriminatorRows.map(([name, bytes]) =>
  [Buffer.from(bytes).toString('hex'), name]));

let rpcId = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(body, attempt = 0) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)});
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if ((!response.ok || !parsed) && attempt < 4) {
    await wait(250 * (2 ** attempt));
    return request(body, attempt + 1);
  }
  if (!parsed) throw new Error(`RPC HTTP ${response.status}`);
  return parsed;
}

async function rpc(method, params) {
  const response = await request({jsonrpc: '2.0', id: ++rpcId, method, params});
  if (response.error) throw new Error(`${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}

async function batch(calls) {
  const payload = calls.map(({method, params}) => ({jsonrpc: '2.0', id: ++rpcId, method, params}));
  const response = await request(payload);
  if (!Array.isArray(response)) throw new Error('RPC batch response was not an array');
  const byId = new Map(response.map(row => [row.id, row]));
  return payload.map(row => {
    const item = byId.get(row.id);
    if (!item) throw new Error(`missing RPC batch id ${row.id}`);
    if (item.error) return {rpcError: item.error};
    return item.result;
  });
}

function keyRows(message) {
  return (message.accountKeys || []).map(row => typeof row === 'string'
    ? {pubkey: row, signer: false, writable: false, source: 'transaction'}
    : {pubkey: row.pubkey, signer: !!row.signer, writable: !!row.writable, source: row.source || 'transaction'});
}

function normalizeInstruction(ix, keys, origin, index) {
  const programId = ix.programId || keys[ix.programIdIndex]?.pubkey;
  const accounts = (ix.accounts || []).map(account => typeof account === 'number'
    ? keys[account]?.pubkey : account);
  let discriminator = null;
  let handler = null;
  if (ix.data) {
    try {
      const data = Buffer.from(bs58.decode(ix.data));
      discriminator = data.subarray(0, 8).toString('hex');
      handler = discriminators.get(discriminator) || null;
    } catch {}
  }
  return {origin, index, programId, accounts, discriminator, handler, data: ix.data || null};
}

function tokenDeltas(tx, keys) {
  const pre = new Map((tx.meta.preTokenBalances || []).map(row =>
    [`${row.accountIndex}:${row.mint}`, row]));
  const post = new Map((tx.meta.postTokenBalances || []).map(row =>
    [`${row.accountIndex}:${row.mint}`, row]));
  const ids = new Set([...pre.keys(), ...post.keys()]);
  return [...ids].map(id => {
    const before = pre.get(id);
    const after = post.get(id);
    const row = after || before;
    const beforeRaw = BigInt(before?.uiTokenAmount?.amount || 0);
    const afterRaw = BigInt(after?.uiTokenAmount?.amount || 0);
    return {accountIndex: row.accountIndex, account: keys[row.accountIndex]?.pubkey || null,
      mint: row.mint, owner: after?.owner || before?.owner || null,
      beforeRaw: beforeRaw.toString(), afterRaw: afterRaw.toString(),
      deltaRaw: (afterRaw - beforeRaw).toString()};
  }).filter(row => row.deltaRaw !== '0');
}

function summarize(signatureRow, tx) {
  if (!tx || tx.rpcError || tx.meta?.err) return null;
  const keys = keyRows(tx.transaction.message);
  const instructions = [];
  (tx.transaction.message.instructions || []).forEach((ix, index) =>
    instructions.push(normalizeInstruction(ix, keys, 'outer', index)));
  for (const set of tx.meta.innerInstructions || []) {
    (set.instructions || []).forEach((ix, index) =>
      instructions.push(normalizeInstruction(ix, keys, `inner:${set.index}`, index)));
  }
  const onre = instructions.filter(ix => ix.programId === PROGRAM && ix.handler);
  if (!onre.length) return null;
  const deltas = tokenDeltas(tx, keys);
  const usdG = deltas.filter(row => row.mint === USDG);
  const vault = usdG.find(row => row.account === USDG_REDEMPTION_VAULT);
  const recipients = usdG.filter(row => row.account !== USDG_REDEMPTION_VAULT && BigInt(row.deltaRaw) > 0n)
    .sort((a, b) => BigInt(a.deltaRaw) > BigInt(b.deltaRaw) ? -1 : 1);
  const payoutHandlers = onre.filter(ix => ['OpenSwapSell', 'FulfillRedemptionRequest',
    'OfferVaultWithdraw', 'RedemptionVaultWithdraw', 'WithdrawConfigurableVault'].includes(ix.handler));
  if (!payoutHandlers.length || !vault || BigInt(vault.deltaRaw) >= 0n || !recipients.length) return null;
  return {signature: signatureRow.signature, slot: tx.slot, blockTime: tx.blockTime,
    handlers: [...new Set(payoutHandlers.map(ix => ix.handler))],
    signers: keys.filter(row => row.signer).map(row => row.pubkey),
    onreInstructions: onre, usdGDeltas: usdG,
    redemptionVaultDeltaRaw: vault.deltaRaw,
    payoutRaw: (-BigInt(vault.deltaRaw)).toString(), recipients,
    relevantLogs: (tx.meta.logMessages || []).filter(line =>
      /Instruction: (OpenSwapSell|FulfillRedemptionRequest|OfferVaultWithdraw|RedemptionVaultWithdraw|WithdrawConfigurableVault)|Open swap sell|Redemption request fulfilled|withdraw/i.test(line))};
}

async function main() {
  const genesis = await rpc('getGenesisHash', []);
  if (genesis !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
    throw new Error(`unexpected genesis ${genesis}`);
  let before;
  const signatures = [];
  let pages = 0;
  let reachedDeploy = false;
  while (pages < MAX_PAGES && !reachedDeploy) {
    const page = await rpc('getSignaturesForAddress', [USDG_REDEMPTION_VAULT,
      {limit: PAGE_LIMIT, commitment: 'confirmed', ...(before ? {before} : {})}]);
    pages += 1;
    if (!page.length) break;
    for (const row of page) {
      if (row.slot < DEPLOY_SLOT) { reachedDeploy = true; break; }
      signatures.push(row);
    }
    before = page[page.length - 1].signature;
    if (page.length < PAGE_LIMIT) break;
  }
  const successful = signatures.filter(row => !row.err);
  const receipts = [];
  let missingTransactions = 0;
  const rpcErrors = [];
  for (let offset = 0; offset < successful.length; offset += 20) {
    const rows = successful.slice(offset, offset + 20);
    const txs = await batch(rows.map(row => ({method: 'getTransaction', params: [row.signature,
      {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]})));
    txs.forEach((tx, index) => {
      if (tx?.rpcError) rpcErrors.push({signature: rows[index].signature, error: tx.rpcError});
      else if (!tx) missingTransactions += 1;
      else {
        const receipt = summarize(rows[index], tx);
        if (receipt) receipts.push(receipt);
      }
    });
  }
  receipts.sort((a, b) => BigInt(a.payoutRaw) > BigInt(b.payoutRaw) ? -1 : 1);
  const output = {generatedAt: new Date().toISOString(), safety: {readOnly: true,
    transactionSubmitted: false, rpcCredentialRecorded: false}, program: PROGRAM,
    scannedAddress: USDG_REDEMPTION_VAULT, deploySlot: DEPLOY_SLOT, pages,
    reachedDeploySlot: reachedDeploy, signatureCount: signatures.length,
    successfulSignatureCount: successful.length, missingTransactions,
    rpcErrors, payoutReceiptCount: receipts.length,
    selectionRule: 'Largest successful post-deploy debit from the live USDG redemption vault in a decoded OnRe payout handler.',
    highestValueReceipt: receipts[0] || null, receipts};
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUTPUT, pages, reachedDeploy, signatures: signatures.length,
    successful: successful.length, receipts: receipts.length,
    highest: receipts[0] && {signature: receipts[0].signature, slot: receipts[0].slot,
      handlers: receipts[0].handlers, payoutRaw: receipts[0].payoutRaw,
      recipient: receipts[0].recipients[0]?.account}}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
