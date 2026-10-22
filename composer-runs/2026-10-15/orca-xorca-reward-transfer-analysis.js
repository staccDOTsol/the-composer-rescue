#!/usr/bin/env node

// Read-only analysis of observed positive ORCA transfers into the xORCA vault.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = __dirname;
const outputPath = path.join(dir, 'orca-xorca-reward-transfer-analysis.json');
const live = JSON.parse(fs.readFileSync(path.join(dir, 'orca-xorca-live-revalidation.json')));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const endpoints = [...new Set([env.RPC_URL, env.HEAVY_RPC_URL].filter(Boolean))];
if (!endpoints.length) throw new Error('No read-only RPC configured');

const VAULT = live.identities.vault;
const ORCA = live.identities.orcaMint;
const signatures = live.history.directPositiveVaultChanges.slice(0, 6)
  .map((row) => row.signature);
let id = 0;

async function rpc(method, params) {
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
      const body = await response.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      if (body.result !== null && body.result !== undefined) return body.result;
      errors.push('null result');
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(`${method} failed: ${errors.join(' | ')}`);
}

function accountKeyList(tx) {
  return tx.transaction.message.accountKeys.map((row) => typeof row === 'string' ? row : row.pubkey);
}

function normalizeIx(ix, keys, outerIndex, innerIndex, immediateCaller) {
  const programId = ix.programId || (ix.programIdIndex === undefined ? null : keys[ix.programIdIndex]);
  return {outerIndex, innerIndex, stackHeight: ix.stackHeight ?? null, immediateCaller,
    programId, parsed: ix.parsed ?? null,
    accounts: ix.accounts?.map((value) => typeof value === 'number' ? keys[value] : value) ?? null,
    data: ix.data ?? null};
}

function allInstructions(tx) {
  const keys = accountKeyList(tx);
  const rows = [];
  tx.transaction.message.instructions.forEach((ix, outerIndex) => {
    rows.push(normalizeIx(ix, keys, outerIndex, null, null));
    const stack = [];
    stack[1] = ix.programId || (ix.programIdIndex === undefined ? null : keys[ix.programIdIndex]);
    const inner = tx.meta.innerInstructions?.find((group) => group.index === outerIndex)?.instructions || [];
    inner.forEach((child, innerIndex) => {
      const height = child.stackHeight ?? 2;
      const row = normalizeIx(child, keys, outerIndex, innerIndex, stack[height - 1] ?? null);
      rows.push(row);
      stack[height] = row.programId;
      stack.length = height + 1;
    });
  });
  return rows;
}

function isVaultTransfer(row) {
  const info = row.parsed?.info || {};
  return ['transfer', 'transferChecked'].includes(row.parsed?.type) &&
    (info.destination === VAULT || info.source === VAULT);
}

async function accountImages(addresses) {
  const result = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  return Object.fromEntries(addresses.map((address, index) => {
    const account = result.value[index];
    if (!account) return [address, null];
    const data = Buffer.from(account.data[0], 'base64');
    const image = {owner: account.owner, executable: account.executable, lamports: account.lamports,
      dataLength: data.length, dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
    if ((account.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
      account.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 165) {
      const web3 = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
      image.token = {mint: new web3.PublicKey(data.subarray(0, 32)).toBase58(),
        authority: new web3.PublicKey(data.subarray(32, 64)).toBase58(),
        amountRaw: data.readBigUInt64LE(64).toString()};
    }
    return [address, image];
  }));
}

async function main() {
  const transactions = [];
  const relatedAddresses = new Set([VAULT]);
  for (const signature of signatures) {
    const tx = await rpc('getTransaction', [signature, {encoding: 'jsonParsed', commitment: 'confirmed',
      maxSupportedTransactionVersion: 1}]);
    const instructions = allInstructions(tx);
    const vaultTransfers = instructions.filter(isVaultTransfer);
    for (const row of vaultTransfers) {
      const info = row.parsed.info;
      if (info.source) relatedAddresses.add(info.source);
      if (info.destination) relatedAddresses.add(info.destination);
      if (info.authority) relatedAddresses.add(info.authority);
    }
    transactions.push({signature, slot: tx.slot, blockTime: tx.blockTime, version: tx.version,
      err: tx.meta.err, feeLamports: tx.meta.fee,
      signers: tx.transaction.message.accountKeys.filter((row) => row.signer).map((row) => row.pubkey),
      vaultPre: tx.meta.preTokenBalances?.filter((row) => row.owner && row.mint === ORCA &&
        accountKeyList(tx)[row.accountIndex] === VAULT) ?? [],
      vaultPost: tx.meta.postTokenBalances?.filter((row) => row.owner && row.mint === ORCA &&
        accountKeyList(tx)[row.accountIndex] === VAULT) ?? [],
      outerInstructions: instructions.filter((row) => row.innerIndex === null),
      vaultTransfers,
      relevantLogs: tx.meta.logMessages?.filter((line) => line.includes('Instruction:') ||
        line.includes('success') || line.includes('failed')) ?? []});
  }
  const accounts = await accountImages([...relatedAddresses]);
  const classifications = transactions.map((tx) => ({signature: tx.signature,
    transferCount: tx.vaultTransfers.length,
    transfers: tx.vaultTransfers.map((row) => ({source: row.parsed.info.source,
      destination: row.parsed.info.destination, authority: row.parsed.info.authority,
      amountRaw: row.parsed.info.amount ?? row.parsed.info.tokenAmount?.amount ?? null,
      immediateCaller: row.immediateCaller, outerProgram: tx.outerInstructions
        .find((outer) => outer.outerIndex === row.outerIndex)?.programId ?? null}))}));
  const output = {generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    program: live.identities.program, vault: VAULT, orcaMint: ORCA,
    signaturesAnalyzed: signatures.length, classifications, transactions, accounts,
    rpcUrlsStored: false};
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({generatedAt: output.generatedAt, classifications}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
