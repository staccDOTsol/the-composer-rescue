#!/usr/bin/env node
'use strict';

// Read-only mainnet state/liability census and current receipt-schema validation.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(MOD + '/@solana/web3.js');
const bs58mod = require(MOD + '/bs58');
const bs58 = bs58mod.default || bs58mod;

const DIR = __dirname;
const PROGRAM = 'StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT';
const STATE = 'CSqKhyW1cpdyjheAx5HXx4ibcnYrzpL5JywEMAkZixBK';
const VAULT = 'Ce5j11WAsSzM3nkzrw4Kw6v6ic3nbyqpv5eywjYKeKc5';
const XORCA = 'xorcaYqbXUNz3474ubUMJAdu2xgPsew3rUCe5ughT3N';
const ORCA = 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE';
const RPC = 'https://api.mainnet-beta.solana.com';
const LEARN = JSON.parse(fs.readFileSync(path.join(DIR, 'orca-staking-composer-learn.json'), 'utf8')).body;

let id = 0;
async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
        signal: AbortSignal.timeout(120_000)});
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1200)}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 900 * (attempt + 1)));
  }
  throw last;
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function accountData(row) { return row ? Buffer.from(row.data[0], 'base64') : null; }
function readI64LE(data, offset) { return data.readBigInt64LE(offset).toString(); }
function parseState(address, account) {
  const data = accountData(account);
  if (!data || data.length !== 2048 || data[0] !== 1) throw new Error(`bad state ${address}`);
  return {address, owner: account.owner, dataLength: data.length, dataSha256: sha256(data),
    discriminator: data[0], bump: data[6], vaultBump: data[7],
    escrowedOrcaAmountRaw: data.readBigUInt64LE(8).toString(),
    coolDownPeriodSeconds: readI64LE(data, 16),
    updateAuthority: new PublicKey(data.subarray(24, 56)).toBase58()};
}
function parsePending(address, account) {
  const data = accountData(account);
  if (!data || data.length !== 1024 || data[0] !== 2) throw new Error(`bad pending ${address}`);
  return {address, owner: account.owner, lamports: String(account.lamports), dataLength: data.length,
    dataSha256: sha256(data), discriminator: data[0], bump: data[6], withdrawIndex: data[7],
    unstaker: new PublicKey(data.subarray(8, 40)).toBase58(),
    withdrawableOrcaAmountRaw: data.readBigUInt64LE(40).toString(),
    withdrawableTimestamp: readI64LE(data, 48)};
}
function parseToken(address, account) {
  const data = accountData(account);
  return {address, ownerProgram: account.owner, dataLength: data.length, dataSha256: sha256(data),
    mint: new PublicKey(data.subarray(0, 32)).toBase58(), authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString()};
}
function parseMint(address, account) {
  const data = accountData(account);
  const mintAuthorityOption = data.readUInt32LE(0);
  const freezeAuthorityOption = data.readUInt32LE(46);
  return {address, ownerProgram: account.owner, dataLength: data.length, dataSha256: sha256(data),
    mintAuthority: mintAuthorityOption ? new PublicKey(data.subarray(4, 36)).toBase58() : null,
    supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44], initialized: data[45] !== 0,
    freezeAuthority: freezeAuthorityOption ? new PublicKey(data.subarray(50, 82)).toBase58() : null};
}
function targetIxs(tx) {
  const out = [];
  for (let i = 0; i < (tx?.transaction?.message?.instructions || []).length; i += 1) {
    const ix = tx.transaction.message.instructions[i];
    if (ix.programId !== PROGRAM) continue;
    const raw = Buffer.from(bs58.decode(ix.data || ''));
    out.push({index: i, accounts: ix.accounts, dataBase58: ix.data, dataHex: raw.toString('hex'),
      discriminator: raw[0], argsHex: raw.subarray(1).toString('hex')});
  }
  return out;
}
function receiptSummary(signature, tx) {
  return {signature, exists: !!tx, slot: tx?.slot ?? null, blockTime: tx?.blockTime ?? null,
    err: tx?.meta?.err ?? null,
    signers: (tx?.transaction?.message?.accountKeys || []).filter(row => row.signer).map(row => row.pubkey),
    targetInstructions: targetIxs(tx), preTokenBalances: tx?.meta?.preTokenBalances || [],
    postTokenBalances: tx?.meta?.postTokenBalances || [], logMessages: tx?.meta?.logMessages || []};
}

async function main() {
  const examples = [...new Set(LEARN.instructions.flatMap(row => row.exampleSignatures || []))];
  const [slot, accounts, pendingReply] = await Promise.all([
    rpc('getSlot', [{commitment: 'finalized'}]),
    rpc('getMultipleAccounts', [[STATE, VAULT, XORCA, ORCA], {encoding: 'base64', commitment: 'finalized'}]),
    rpc('getProgramAccounts', [PROGRAM, {encoding: 'base64', commitment: 'finalized', withContext: true,
      filters: [{dataSize: 1024}, {memcmp: {offset: 0, bytes: bs58.encode(Buffer.from([2]))}}]}]),
  ]);
  const state = parseState(STATE, accounts.value[0]);
  const vault = parseToken(VAULT, accounts.value[1]);
  const xorcaMint = parseMint(XORCA, accounts.value[2]);
  const orcaMint = parseMint(ORCA, accounts.value[3]);
  if (vault.mint !== ORCA || vault.authority !== STATE) throw new Error('vault binding changed');
  if (xorcaMint.mintAuthority !== STATE || xorcaMint.freezeAuthority !== null) throw new Error('xORCA mint authority changed');
  const pending = pendingReply.value.map(row => parsePending(row.pubkey, row.account));
  const pendingTotal = pending.reduce((sum, row) => sum + BigInt(row.withdrawableOrcaAmountRaw), 0n);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const live = {count: pending.length, totalWithdrawableOrcaRaw: pendingTotal.toString(),
    maturedCount: pending.filter(row => BigInt(row.withdrawableTimestamp) <= now).length,
    futureCount: pending.filter(row => BigInt(row.withdrawableTimestamp) > now).length,
    earliestTimestamp: pending.length ? pending.reduce((a, b) => BigInt(a.withdrawableTimestamp) < BigInt(b.withdrawableTimestamp) ? a : b).withdrawableTimestamp : null,
    latestTimestamp: pending.length ? pending.reduce((a, b) => BigInt(a.withdrawableTimestamp) > BigInt(b.withdrawableTimestamp) ? a : b).withdrawableTimestamp : null};
  const vaultRaw = BigInt(vault.amountRaw), escrowRaw = BigInt(state.escrowedOrcaAmountRaw);
  const backingRaw = vaultRaw - escrowRaw, supplyRaw = BigInt(xorcaMint.supplyRaw);
  const receiptRows = [];
  for (const signature of examples) {
    const tx = await rpc('getTransaction', [signature, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
    receiptRows.push(receiptSummary(signature, tx));
  }
  const output = {schema: 'orca-staking-current-state/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta', commitment: 'finalized', finalizedSlot: slot, accountContextSlot: accounts.context.slot,
    pendingContextSlot: pendingReply.context.slot, target: {program: PROGRAM, state: STATE, vault: VAULT, xorcaMint: XORCA, orcaMint: ORCA},
    sourceSchema: {repository: 'https://github.com/orca-so/xorca', headCommit: '05fe66b67c95271cb07aa42c83b9fdfd8a39b936',
      equivalenceToDeployedElfEstablished: false}, state, vault, xorcaMint, orcaMint, pending, livePendingSummary: live,
    accounting: {vaultOrcaRaw: vaultRaw.toString(), escrowedOrcaRaw: escrowRaw.toString(),
      pendingLiabilityRaw: pendingTotal.toString(), escrowMinusLivePendingRaw: (escrowRaw - pendingTotal).toString(),
      nonEscrowedBackingRaw: backingRaw.toString(), xorcaSupplyRaw: supplyRaw.toString(),
      orcaPerXorcaNumeratorWithVirtualRaw: (backingRaw + 100n).toString(),
      orcaPerXorcaDenominatorWithVirtualRaw: (supplyRaw + 100n).toString()},
    receiptSamples: receiptRows,
    safety: {readOnly: true, signedTransactions: false, sendTransactionCalled: false, broadcast: false}};
  const outPath = path.join(DIR, 'orca-staking-current-state.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, generatedAtUtc: output.generatedAtUtc, finalizedSlot: slot,
    accountContextSlot: accounts.context.slot, pendingContextSlot: pendingReply.context.slot,
    state, vault, xorcaMint, livePendingSummary: live, accounting: output.accounting,
    receipts: receiptRows.map(row => ({signature: row.signature, slot: row.slot, err: row.err,
      signers: row.signers, targetInstructions: row.targetInstructions,
      relevantLogs: row.logMessages.filter(line => /Instruction:|failed|Program data/.test(line))}))}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
