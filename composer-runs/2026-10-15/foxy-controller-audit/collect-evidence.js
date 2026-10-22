#!/usr/bin/env node
'use strict';

// Read-only evidence collector for the deployed Famous Fox staking controller.
// It never submits a transaction and never serializes the configured RPC URL.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const PROGRAM_ID = 'FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP';
const PROGRAM_DATA = 'BZGG4GPFP9tDKyWiF1FLSNnBXHVn2w9XY3SRfiCA9VyK';
const VAULT = '32Xe8tQYy7hZDH3PWFA8q34oPbHK1BXaDLnRDhuWCx8h';
const VAULT_AUTHORITY = 'Gd18t9bFpigpnEWpYkXD6bhcbtKW5szN2HkgmFUtsM3m';
const FOXY_MINT = 'FoXyMu5xwXre7zEoSvzViRk3nGawHUp9kUh97y2NDhcq';
const POSITIVE_SIGNATURE = 'mcGyLQrXVogQvJZYWkiismSnjnXCf6MiTqpH2eiaxRDTV76VfPJUomemnBvMJbkRKu7UsJiPnJj3tsk7K52ANRg';
const OUT = process.argv[2] || path.join(__dirname, 'evidence.json');

const rpcEnv = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const archiveRpc = process.env.RPC_URL || rpcEnv.RPC_URL;
const heavyRpc = process.env.HEAVY_RPC_URL || rpcEnv.HEAVY_RPC_URL || archiveRpc;
if (!archiveRpc || !heavyRpc) throw new Error('missing RPC endpoint configuration');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpcAt(url, method, params, attempts = 7) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const body = await response.json();
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`${method}: retryable HTTP ${response.status}`);
      }
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt + 1 === attempts) break;
      await sleep(250 * (2 ** attempt));
    }
  }
  throw lastError;
}

const rpc = (method, params) => rpcAt(archiveRpc, method, params);
const heavy = (method, params) => rpcAt(heavyRpc, method, params);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const anchorDiscriminator = (kind, name) => crypto.createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);

const instructionNames = [
  'initialize',
  'update_config',
  'init_deposit',
  'deposit',
  'stake_fox_v2',
  'unstake_fox',
  'unstake_fox_v2',
  'claim',
  'auth_unstake_fox',
];
const discriminatorNames = new Map(instructionNames.map((name) => [anchorDiscriminator('global', name).toString('hex'), name]));

function decodeInstructionData(data) {
  if (!data) return null;
  const raw = Buffer.from(bs58.decode(data));
  const discriminator = raw.subarray(0, 8).toString('hex');
  return {
    base58: data,
    hex: raw.toString('hex'),
    byteLength: raw.length,
    discriminator,
    inferredName: discriminatorNames.get(discriminator) || null,
  };
}

function accountRecord(address, account, contextSlot) {
  if (!account) return { address, exists: false, contextSlot };
  const raw = Buffer.from(account.data[0], 'base64');
  const record = {
    address,
    exists: true,
    contextSlot,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    rentEpoch: account.rentEpoch,
    dataLength: raw.length,
    dataSha256: sha256(raw),
    dataBase64: raw.toString('base64'),
  };
  if (raw.length >= 8) record.discriminatorHex = raw.subarray(0, 8).toString('hex');
  return record;
}

function normalizeTransaction(signature, tx) {
  if (!tx) return { signature, available: false };
  const accountKeys = tx.transaction.message.accountKeys.map((entry) => (
    typeof entry === 'string' ? { pubkey: entry } : entry
  ));
  const outerInstructions = tx.transaction.message.instructions.map((instruction, index) => ({
    index,
    programId: instruction.programId,
    accounts: instruction.accounts,
    data: decodeInstructionData(instruction.data),
    parsed: instruction.parsed,
  }));
  return {
    signature,
    available: true,
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: tx.version,
    err: tx.meta?.err ?? null,
    fee: tx.meta?.fee ?? null,
    computeUnitsConsumed: tx.meta?.computeUnitsConsumed ?? null,
    accountKeys,
    outerInstructions,
    innerInstructions: tx.meta?.innerInstructions ?? [],
    preTokenBalances: tx.meta?.preTokenBalances ?? [],
    postTokenBalances: tx.meta?.postTokenBalances ?? [],
    logMessages: tx.meta?.logMessages ?? [],
  };
}

async function getTransaction(signature) {
  return rpc('getTransaction', [signature, {
    encoding: 'jsonParsed',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  }]);
}

async function mapLimit(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

async function recentTransactions(limit = 500) {
  const signatures = await rpc('getSignaturesForAddress', [PROGRAM_ID, {
    commitment: 'confirmed',
    limit,
  }]);
  const transactions = await mapLimit(signatures, 8, async (entry) => {
    const tx = await getTransaction(entry.signature);
    return normalizeTransaction(entry.signature, tx);
  });
  return { signatures, transactions };
}

async function main() {
  const targetAddresses = [
    PROGRAM_ID,
    PROGRAM_DATA,
    VAULT,
    VAULT_AUTHORITY,
    FOXY_MINT,
    '7N7M1H2CK51ip7sNtPgKhhv2eScx6BokLgHi1Ke3ZLiq',
    '6kW1byGh9RaeJGQNTDx8UWKuajD8u1tv83vrLzn7GSN7',
    '5ouUMrQuhr7n2241g4q9Ddq7FesgTGCgBgWZHeKUrxxM',
    'BH8BkxJgP5VZ4cHazTD2VvNxTTJFh7zdgq85g1EQUZPq',
    'BNF1uzrS9XUyjUYJ89X3QAhmJZLU7GyXXpMSp96pSx3X',
    '3YqCz8eNJDhW3boSQdyCVmtpL9CzNmyPkyapF2qdBDwD',
  ];
  const accountsResult = await heavy('getMultipleAccounts', [targetAddresses, {
    encoding: 'base64',
    commitment: 'confirmed',
  }]);
  const programAccountsResult = await heavy('getProgramAccounts', [PROGRAM_ID, {
    encoding: 'base64',
    commitment: 'confirmed',
    dataSlice: { offset: 0, length: 8 },
    withContext: true,
  }]);
  const groups = new Map();
  for (const item of programAccountsResult.value) {
    const discriminator = Buffer.from(item.account.data[0], 'base64').toString('hex');
    const key = `${discriminator}:${item.account.space}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const positive = normalizeTransaction(POSITIVE_SIGNATURE, await getTransaction(POSITIVE_SIGNATURE));
  const recent = await recentTransactions(500);

  const instructionCounts = new Map();
  const examples = new Map();
  for (const tx of recent.transactions) {
    for (const instruction of tx.outerInstructions || []) {
      if (instruction.programId !== PROGRAM_ID || !instruction.data) continue;
      const key = instruction.data.inferredName || instruction.data.discriminator;
      instructionCounts.set(key, (instructionCounts.get(key) || 0) + 1);
      if (!examples.has(key)) {
        examples.set(key, {
          signature: tx.signature,
          slot: tx.slot,
          err: tx.err,
          accounts: instruction.accounts,
          data: instruction.data,
          logMessages: tx.logMessages,
        });
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    noTransactionsSubmitted: true,
    target: {
      programId: PROGRAM_ID,
      programDataAddress: PROGRAM_DATA,
      vault: VAULT,
      vaultAuthority: VAULT_AUTHORITY,
      mint: FOXY_MINT,
      positiveSignature: POSITIVE_SIGNATURE,
    },
    knownDiscriminators: Object.fromEntries([...discriminatorNames].map(([hex, name]) => [name, hex])),
    liveAccounts: {
      contextSlot: accountsResult.context.slot,
      accounts: targetAddresses.map((address, index) => accountRecord(address, accountsResult.value[index], accountsResult.context.slot)),
    },
    programOwnedAccountCensus: {
      contextSlot: programAccountsResult.context.slot,
      count: programAccountsResult.value.length,
      groups: [...groups].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      knownAccountDiscriminators: {
        StakingConfig: anchorDiscriminator('account', 'StakingConfig').toString('hex'),
        StakingAccount: anchorDiscriminator('account', 'StakingAccount').toString('hex'),
      },
    },
    positiveControl: positive,
    recentHistory: {
      signatureCount: recent.signatures.length,
      range: recent.signatures.length ? {
        newestSlot: recent.signatures[0].slot,
        oldestSlot: recent.signatures.at(-1).slot,
      } : null,
      instructionCounts: Object.fromEntries([...instructionCounts].sort()),
      examples: Object.fromEntries([...examples].sort()),
      transactions: recent.transactions,
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    liveSlot: output.liveAccounts.contextSlot,
    programAccountSlot: output.programOwnedAccountCensus.contextSlot,
    programOwnedAccounts: output.programOwnedAccountCensus.count,
    instructionCounts: output.recentHistory.instructionCounts,
    examples: Object.fromEntries(Object.entries(output.recentHistory.examples).map(([name, example]) => [name, {
      signature: example.signature,
      slot: example.slot,
      err: example.err,
      accounts: example.accounts,
      data: example.data,
    }])),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
