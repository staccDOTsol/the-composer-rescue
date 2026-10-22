#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta attestation for Orca xORCA staking. This script only
// performs JSON-RPC/HTTP reads and intentionally has no signing or send path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(MOD + '/@solana/web3.js');

const DIR = __dirname;
const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const PROGRAM = 'StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT';
const VAULT = 'Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5';
const VAULT_AUTHORITY = 'CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK';
const ORCA_MINT = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const RECEIPT = 'MY5Hq5S24EnvXHz68699yFJXbF8AjRABg7EqbmXYsWbHoWD1GV6dgK6DZ7d2d3ryV7u2xTLoeAYDPRxh5dW5z1P';
const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function loadRpc() {
  const values = {};
  if (fs.existsSync(ENV_PATH)) {
    const stat = fs.statSync(ENV_PATH);
    if ((stat.mode & 0o777) !== 0o600) throw new Error('RPC env file must be mode 0600');
    for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
      if (!match) continue;
      values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  const endpoint = values.SOLANA_RPC_URL || values.SOLANA_RPC || values.HELIUS_RPC ||
    values.RPC || values.RPC_URL || values.HEAVY_RPC_URL || values.HELIUS_RPC_URL ||
    'https://api.mainnet-beta.solana.com';
  return {endpoint, source: Object.keys(values).length ? 'private env' : 'public Solana mainnet RPC'};
}

const rpcConfig = loadRpc();
const endpoint = rpcConfig.endpoint;
let rpcId = 0;
async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(120_000)});
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1200)}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw last;
}

async function getJson(url, timeout = 180_000) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(timeout)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {textPrefix: text.slice(0, 2000)}; }
    return {url, status: response.status, ok: response.ok, body};
  } catch (error) {
    return {url, status: null, ok: false, error: String(error.message || error)};
  }
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function rawAccount(account) { return account ? Buffer.from(account.data[0], 'base64') : null; }
function summarize(address, account) {
  if (!account) return {address, exists: false};
  const data = rawAccount(account);
  const row = {address, exists: true, owner: account.owner, executable: account.executable,
    lamports: String(account.lamports), dataLength: data.length, dataSha256: sha256(data)};
  if (account.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && data.length >= 165) {
    row.token = {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      authority: new PublicKey(data.subarray(32, 64)).toBase58(),
      amountRaw: data.readBigUInt64LE(64).toString()};
  }
  return row;
}

function parseProgramData(data) {
  if (data.length < 13 || data.readUInt32LE(0) !== 3) throw new Error('unexpected ProgramData');
  const option = data[12];
  const elfOffset = option === 1 ? 45 : 13;
  return {lastDeploySlot: data.readBigUInt64LE(4).toString(), option,
    upgradeAuthority: option === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null,
    elfOffset, elf: data.subarray(elfOffset)};
}

function targetInstructions(tx) {
  const rows = [];
  for (let i = 0; i < (tx?.transaction?.message?.instructions || []).length; i += 1) {
    const ix = tx.transaction.message.instructions[i];
    if (ix.programId === PROGRAM) rows.push({level: 'outer', index: i, ...ix});
  }
  for (const group of tx?.meta?.innerInstructions || []) for (let i = 0; i < group.instructions.length; i += 1) {
    const ix = group.instructions[i];
    if (ix.programId === PROGRAM) rows.push({level: 'inner', outerIndex: group.index, index: i, ...ix});
  }
  return rows;
}

async function main() {
  const base = 'https://the-composer-svc.fly.dev';
  const [genesis, finalizedSlot, programReply, vaultReply, receipt, idl, learn] = await Promise.all([
    rpc('getGenesisHash'), rpc('getSlot', [{commitment: 'finalized'}]),
    rpc('getAccountInfo', [PROGRAM, {encoding: 'base64', commitment: 'finalized'}]),
    rpc('getMultipleAccounts', [[VAULT, VAULT_AUTHORITY, ORCA_MINT], {encoding: 'base64', commitment: 'finalized'}]),
    rpc('getTransaction', [RECEIPT, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    getJson(`${base}/idl/${PROGRAM}`), getJson(`${base}/learn/${PROGRAM}?limit=1000`),
  ]);
  if (genesis !== GENESIS) throw new Error(`wrong genesis ${genesis}`);
  const programDataAddress = new PublicKey(rawAccount(programReply.value).subarray(4, 36)).toBase58();
  const pdReply = await rpc('getAccountInfo', [programDataAddress, {encoding: 'base64', commitment: 'finalized'}]);
  const pdRaw = rawAccount(pdReply.value);
  const pd = parseProgramData(pdRaw);
  const elfPath = path.join(DIR, 'orca-staking-current.so');
  fs.writeFileSync(elfPath, pd.elf);
  const idlPath = path.join(DIR, 'orca-staking-composer-idl.json');
  const learnPath = path.join(DIR, 'orca-staking-composer-learn.json');
  fs.writeFileSync(idlPath, JSON.stringify(idl, null, 2) + '\n');
  fs.writeFileSync(learnPath, JSON.stringify(learn, null, 2) + '\n');
  const accounts = [summarize(VAULT, vaultReply.value[0]), summarize(VAULT_AUTHORITY, vaultReply.value[1]),
    summarize(ORCA_MINT, vaultReply.value[2])];
  if (accounts[0].token?.mint !== ORCA_MINT || accounts[0].token?.authority !== VAULT_AUTHORITY) {
    throw new Error('vault mint/authority changed');
  }
  const output = {schema: 'orca-staking-current-attestation/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta', rpcSource: rpcConfig.source, genesis, finalizedSlot, programAccountContextSlot: programReply.context.slot,
    vaultContextSlot: vaultReply.context.slot, program: {address: PROGRAM, programDataAddress,
      programOwner: programReply.value.owner, executable: programReply.value.executable,
      lastDeploySlot: pd.lastDeploySlot, upgradeAuthority: pd.upgradeAuthority, elfOffset: pd.elfOffset,
      elfBytes: pd.elf.length, elfSha256: sha256(pd.elf), fullProgramDataSha256: sha256(pdRaw), elfPath},
    accounts, receipt: receipt && {signature: RECEIPT, slot: receipt.slot, blockTime: receipt.blockTime,
      err: receipt.meta?.err ?? null, accountKeys: receipt.transaction?.message?.accountKeys || [],
      targetInstructions: targetInstructions(receipt), outerInstructions: receipt.transaction?.message?.instructions || [],
      innerInstructions: receipt.meta?.innerInstructions || [], logMessages: receipt.meta?.logMessages || [],
      preTokenBalances: receipt.meta?.preTokenBalances || [], postTokenBalances: receipt.meta?.postTokenBalances || []},
    composer: {idl: {status: idl.status, ok: idl.ok, sha256: sha256(Buffer.from(JSON.stringify(idl.body ?? null))), path: idlPath},
      learn: {status: learn.status, ok: learn.ok, sha256: sha256(Buffer.from(JSON.stringify(learn.body ?? null))), path: learnPath}},
    safety: {readOnly: true, signedTransactions: false, sendTransactionCalled: false, broadcast: false}};
  const outPath = path.join(DIR, 'orca-staking-current-attestation.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, generatedAtUtc: output.generatedAtUtc, finalizedSlot,
    program: output.program, accounts, receipt: output.receipt && {slot: output.receipt.slot,
      err: output.receipt.err, targetInstructions: output.receipt.targetInstructions,
      logMessages: output.receipt.logMessages}, composer: output.composer, safety: output.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
