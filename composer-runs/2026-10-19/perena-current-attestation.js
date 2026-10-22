#!/usr/bin/env node
'use strict';

// Read-only mainnet-beta attestation for the current Perena Numeraire binary,
// current pool/vault state, Composer metadata, and the cited successful receipt.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey} = require(MOD + '/@solana/web3.js');

const OUT_DIR = __dirname;
const ENV_PATH = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
const PROGRAM = 'NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P';
const PROGRAM_DATA = '64h2hsxpnUprJu87bwH7HcYxoVtbidw95bZ7m5JTXGp';
const POOL = '2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ';
const USDC_VAULT = '6B8k8At9879r5EsZAWg8W6DEpxzJ798Cwj48twu3pq4b';
const USDT_VAULT = 'DJfYbGicp4AFXWsragNWv1baugqcdFhw6eFTcK2YWdyK';
const CONFIG = 'FS159v4b2jo3fjGBaUFmDzgx7k616XhpKhMwX2Q3HeeD';
const LP_MINT = 'BenJy1n3WTx9mTjEvy63e8Q1j4RqUc6E4VBMz3ir4Wo6';
const RECEIPT = '5W1xG3qU1GK7ddDkZeKX9xADsbgrSjNsmpycKPQAXKkRW6bsBcWhu2EJEpXv2xb7cPvvckz46cQkzt35173SraGE';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function loadRpc() {
  const values = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  const endpoint = values.RPC || values.SOLANA_RPC || values.SOLANA_RPC_URL || values.RPC_URL ||
    values.HEAVY_RPC_URL || values.HELIUS_RPC_URL;
  if (!endpoint) throw new Error('RPC variable unavailable');
  return endpoint;
}

const RPC = loadRpc();
let rpcId = 0;
async function rpc(method, params = []) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await response.json();
      if (response.ok && !body.error) return body.result;
      last = new Error(`${method}: ${JSON.stringify(body.error || body).slice(0, 1000)}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw last;
}

async function requestJson(url) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(120_000)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {textPrefix: text.slice(0, 1000)}; }
    return {status: response.status, ok: response.ok, body};
  } catch (error) {
    return {status: null, ok: false, error: String(error.message || error)};
  }
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function summarizeAccount(address, account) {
  if (!account) return {address, exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const out = {
    address, exists: true, owner: account.owner, executable: account.executable,
    lamports: String(account.lamports), dataLength: data.length, dataSha256: sha256(data),
  };
  if (account.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && data.length >= 165) {
    out.token = {
      mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      authority: new PublicKey(data.subarray(32, 64)).toBase58(),
      amountRaw: data.readBigUInt64LE(64).toString(),
    };
  }
  return out;
}

function decodeProgramData(data) {
  const tag = data.readUInt32LE(0);
  const lastDeploySlot = data.readBigUInt64LE(4).toString();
  const option = data[12];
  const upgradeAuthority = option === 1 ? new PublicKey(data.subarray(13, 45)).toBase58() : null;
  const elfOffset = option === 1 ? 45 : 13;
  const elf = data.subarray(elfOffset);
  return {tag, lastDeploySlot, upgradeAuthority, elfOffset, elf};
}

function extractPerenaInstructions(transaction) {
  const rows = [];
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (let i = 0; i < group.instructions.length; i += 1) {
      const ix = group.instructions[i];
      const programId = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toString?.();
      if (programId !== PROGRAM) continue;
      rows.push({outerInstructionIndex: group.index, innerInstructionIndex: i, stackHeight: ix.stackHeight ?? null,
        programId, accounts: ix.accounts || null, data: ix.data || null, parsed: ix.parsed || null});
    }
  }
  return rows;
}

async function main() {
  const [genesis, slot, accounts, transaction, composerIdl, composerLearn] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getSlot', [{commitment: 'finalized'}]),
    rpc('getMultipleAccounts', [[PROGRAM, PROGRAM_DATA, POOL, USDC_VAULT, USDT_VAULT, CONFIG, LP_MINT], {
      encoding: 'base64', commitment: 'finalized',
    }]),
    rpc('getTransaction', [RECEIPT, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    requestJson(`https://the-composer-svc.fly.dev/idl/${PROGRAM}`),
    requestJson(`https://the-composer-svc.fly.dev/learn/${PROGRAM}?limit=1000`),
  ]);
  if (genesis !== MAINNET_GENESIS) throw new Error(`wrong genesis ${genesis}`);
  const summaries = [PROGRAM, PROGRAM_DATA, POOL, USDC_VAULT, USDT_VAULT, CONFIG, LP_MINT]
    .map((address, i) => summarizeAccount(address, accounts.value[i]));
  const programAccountData = Buffer.from(accounts.value[0].data[0], 'base64');
  const linkedProgramData = new PublicKey(programAccountData.subarray(4, 36)).toBase58();
  if (linkedProgramData !== PROGRAM_DATA) throw new Error(`ProgramData link changed to ${linkedProgramData}`);
  const programDataRaw = Buffer.from(accounts.value[1].data[0], 'base64');
  const decoded = decodeProgramData(programDataRaw);
  const poolRaw = Buffer.from(accounts.value[2].data[0], 'base64');
  const configRaw = Buffer.from(accounts.value[5].data[0], 'base64');
  const poolDecoded = {poolSeed: new PublicKey(poolRaw.subarray(8, 40)).toBase58(),
    lpMint: new PublicKey(poolRaw.subarray(40, 72)).toBase58(),
    whitelistedAdder: new PublicKey(poolRaw.subarray(72, 104)).toBase58(),
    owner: new PublicKey(poolRaw.subarray(104, 136)).toBase58()};
  const configDecoded = {owner: new PublicKey(configRaw.subarray(8, 40)).toBase58(),
    status: configRaw.readUInt32LE(40)};
  if (poolDecoded.lpMint !== LP_MINT) throw new Error(`LP mint changed to ${poolDecoded.lpMint}`);
  const binaryPath = path.join(OUT_DIR, 'perena-current-mainnet.so');
  fs.writeFileSync(binaryPath, decoded.elf);
  const output = {
    schema: 'perena-current-attestation/v1', generatedAtUtc: new Date().toISOString(),
    network: 'mainnet-beta', genesis, finalizedSlot: slot, accountContextSlot: accounts.context.slot,
    target: {program: PROGRAM, programData: PROGRAM_DATA, pool: POOL, usdcVault: USDC_VAULT,
      usdtVault: USDT_VAULT, config: CONFIG, lpMint: LP_MINT, receipt: RECEIPT},
    program: {linkedProgramData, stateTag: decoded.tag, lastDeploySlot: decoded.lastDeploySlot,
      upgradeAuthority: decoded.upgradeAuthority, elfOffset: decoded.elfOffset,
      elfLength: decoded.elf.length, elfSha256: sha256(decoded.elf), binaryPath,
      fullProgramDataSha256: sha256(programDataRaw)}, poolDecoded, configDecoded,
    accounts: summaries,
    receipt: transaction ? {slot: transaction.slot, blockTime: transaction.blockTime,
      err: transaction.meta?.err ?? null, fee: transaction.meta?.fee ?? null,
      signatures: transaction.transaction?.signatures || [],
      accountKeys: transaction.transaction?.message?.accountKeys || [],
      outerInstructions: transaction.transaction?.message?.instructions || [],
      perenaInstructions: extractPerenaInstructions(transaction),
      innerInstructions: transaction.meta?.innerInstructions || [],
      logMessages: transaction.meta?.logMessages || [],
      preTokenBalances: transaction.meta?.preTokenBalances || [],
      postTokenBalances: transaction.meta?.postTokenBalances || []} : null,
    composer: {idl: composerIdl, learn: composerLearn},
    safety: {readOnlyRpc: true, signedTransactions: false, sendTransactionCalled: false, broadcast: false},
  };
  const outPath = path.join(OUT_DIR, 'perena-current-attestation.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({outPath, binaryPath, generatedAtUtc: output.generatedAtUtc,
    finalizedSlot: slot, accountContextSlot: accounts.context.slot, program: output.program,
    vaults: summaries.slice(3, 5), poolDecoded, configDecoded,
    receipt: output.receipt && {slot: output.receipt.slot,
      err: output.receipt.err, perenaInstructions: output.receipt.perenaInstructions},
    composer: {idlStatus: composerIdl.status, idlOk: composerIdl.ok,
      learnStatus: composerLearn.status, learnOk: composerLearn.ok}, safety: output.safety}, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
