#!/usr/bin/env node
'use strict';

// Read-only account census and IDL-backed state decoding for the deployed NTT
// controller. No transaction RPC is used.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const anchor = require('./kliquidity-sdk-official/node_modules/@coral-xyz/anchor');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {getAssociatedTokenAddressSync} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const PROGRAM = new PublicKey('4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT');
const MINT = new PublicKey('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const EXPECTED_AUTHORITY = new PublicKey('XcVU4Nhzjzg69VRcpybnoFWT98oQANV58F7guE6mRza');
const EXPECTED_CUSTODY = new PublicKey('7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC');
const IDL_PATH = path.join(__dirname, 'prime-second-onchain-idl.json');
const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoints = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!endpoints.length) throw new Error('No configured RPC');

let rpcId = 0;
async function rpc(method, params) {
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (!response.ok) {errors.push(`HTTP ${response.status}`); continue;}
      const body = await response.json();
      if (body.error) {errors.push(`${body.error.code}: ${body.error.message}`); continue;}
      return body.result;
    } catch (error) {errors.push(error.message);}
  }
  throw new Error(`${method}: all configured RPCs failed (${errors.join('; ')})`);
}

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const normalize = value => {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof PublicKey || typeof value.toBase58 === 'function') return value.toBase58();
  if (value.constructor?.name === 'BN') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
};

const accountTypes = idl.accounts.map(def => ({name: def.name,
  discriminator: crypto.createHash('sha256').update(`account:${def.name}`).digest().subarray(0, 8), def}));
const coders = new Map();
for (const type of accountTypes) {
  try {
    coders.set(type.name, new anchor.BorshAccountsCoder({...idl, accounts: [type.def]}));
  } catch (_) {}
}

function decodeAccount(row) {
  const data = Buffer.from(row.account.data[0], 'base64');
  const type = accountTypes.find(item => item.discriminator.equals(data.subarray(0, 8)));
  const base = {address: row.pubkey, owner: row.account.owner, lamports: String(row.account.lamports),
    dataLength: data.length, dataSha256: sha256(data),
    discriminatorHex: data.subarray(0, 8).toString('hex'), type: type?.name || 'unknown'};
  if (type && coders.has(type.name)) {
    try {base.decoded = normalize(coders.get(type.name).decode(type.name, data));}
    catch (error) {base.decodeError = error.message;}
  }
  return base;
}

async function main() {
  const raw = await rpc('getProgramAccounts', [PROGRAM.toBase58(),
    {encoding: 'base64', commitment: 'confirmed', withContext: true}]);
  const contextSlot = raw.context?.slot || null;
  const rows = raw.value || raw;
  const decoded = rows.map(decodeAccount).sort((a, b) => a.type.localeCompare(b.type)
    || a.address.localeCompare(b.address));
  const byType = Object.fromEntries([...new Set(decoded.map(row => row.type))].sort()
    .map(type => [type, decoded.filter(row => row.type === type).length]));

  const [tokenAuthority, tokenAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_authority')], PROGRAM);
  const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM);
  const custody = getAssociatedTokenAddressSync(MINT, tokenAuthority, true, TOKEN);
  const configRow = decoded.find(row => row.address === config.toBase58());
  const inbox = decoded.filter(row => row.type === 'InboxItem');
  const releaseStatusCounts = {};
  for (const row of inbox) {
    const key = JSON.stringify(row.decoded?.releaseStatus ?? 'undecoded');
    releaseStatusCounts[key] = (releaseStatusCounts[key] || 0) + 1;
  }
  const pendingInboxItems = inbox.filter(row => {
    const status = row.decoded?.releaseStatus;
    return status && !Object.prototype.hasOwnProperty.call(status, 'released');
  });

  const output = {generatedAt: new Date().toISOString(),
    rpc: 'configured authenticated Solana RPC (URL redacted)', noTransactionsSubmitted: true,
    programId: PROGRAM.toBase58(), contextSlot, programAccountCount: decoded.length, byType,
    derived: {config: config.toBase58(), configBump,
      tokenAuthority: tokenAuthority.toBase58(), tokenAuthorityBump,
      custody: custody.toBase58(), expected: {tokenAuthority: EXPECTED_AUTHORITY.toBase58(),
        custody: EXPECTED_CUSTODY.toBase58()},
      matchesExpected: {tokenAuthority: tokenAuthority.equals(EXPECTED_AUTHORITY),
        custody: custody.equals(EXPECTED_CUSTODY)}},
    config: configRow || null, releaseStatusCounts,
    pendingInboxItems: pendingInboxItems.map(row => ({address: row.address, decoded: row.decoded,
      dataSha256: row.dataSha256})), accounts: decoded};
  const file = path.join(__dirname, 'prime-second-state-snapshot.json');
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({file, contextSlot, programAccountCount: decoded.length,
    byType, derived: output.derived, config: configRow?.decoded || null,
    releaseStatusCounts, pendingInboxCount: pendingInboxItems.length}, null, 2)}\n`);
}

main().catch(error => {process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;});
