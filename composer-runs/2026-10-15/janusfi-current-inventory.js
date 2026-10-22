#!/usr/bin/env node
'use strict';

// Read-only JanusFI mainnet inventory. This script only invokes account/history
// RPC methods and writes local evidence; it has no signing or send path.

const crypto = require('crypto');
const fs = require('fs');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = `${DIR}/janusfi-current-inventory.json`;
const ELF_OUT = `${DIR}/janusfi-current.so`;
const PROGRAM = 'JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP';
const AUTHORITY = '4H6mGpUjmqMkHesdZim6AhrNkWtjqxPSBkjpM5LTGLw4';
const CASH_VAULT = 'GL3sSqDgKN46xGyUfLQwECRseiSHXqL9UGZ2Qe1RPrRp';
const CASH_MINT = 'CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH';
const KLEND = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('No read-only RPC configured');

let rpcId = 0;
async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
      });
      if (response.status === 429 || response.status >= 500)
        throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw last;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const accountData = (account) => account?.data ? Buffer.from(account.data[0], 'base64') : null;

function pubkeyAt(data, offset) {
  if (offset + 32 > data.length) return null;
  try { return new PublicKey(data.subarray(offset, offset + 32)).toBase58(); }
  catch { return null; }
}

function compactAccount(address, account) {
  if (!account) return {address, exists: false};
  const data = accountData(account);
  const out = {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
    dataBase64: data.toString('base64'),
  };
  if (TOKEN_PROGRAMS.has(account.owner) && data.length >= 72) {
    out.token = {
      mint: pubkeyAt(data, 0),
      authority: pubkeyAt(data, 32),
      rawAmount: data.readBigUInt64LE(64).toString(),
    };
  }
  return out;
}

function accountKeys(tx) {
  const message = tx.transaction.message;
  return [
    ...(message.accountKeys || message.staticAccountKeys || []),
    ...(tx.meta?.loadedAddresses?.writable || []),
    ...(tx.meta?.loadedAddresses?.readonly || []),
  ].map(String);
}

function originalPrivilege(tx, index) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys || message.staticAccountKeys || [];
  const header = message.header;
  const signer = index < header.numRequiredSignatures;
  let writable;
  if (index < header.numRequiredSignatures) {
    writable = index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  } else if (index < staticKeys.length) {
    writable = index < staticKeys.length - header.numReadonlyUnsignedAccounts;
  } else {
    writable = index < staticKeys.length + (tx.meta?.loadedAddresses?.writable || []).length;
  }
  return {signer, writable};
}

function decodedInstruction(tx, ix, level, outerIndex, innerIndex = null) {
  const keys = accountKeys(tx);
  const raw = ix.data ? Buffer.from(bs58.decode(ix.data)) : Buffer.alloc(0);
  return {
    level,
    outerIndex,
    innerIndex,
    stackHeight: ix.stackHeight ?? null,
    programId: keys[ix.programIdIndex],
    dataBase58: ix.data || '',
    dataHex: raw.toString('hex'),
    dataLength: raw.length,
    accounts: (ix.accounts || []).map((index, position) => ({
      position,
      index,
      address: keys[index],
      ...originalPrivilege(tx, index),
    })),
  };
}

function relevantTransaction(signatureRow, tx) {
  if (!tx) return {signature: signatureRow.signature, unavailable: true};
  const top = (tx.transaction.message.instructions || tx.transaction.message.compiledInstructions || [])
    .map((ix, index) => decodedInstruction(tx, ix, 'top', index));
  const inner = (tx.meta?.innerInstructions || []).flatMap((group) =>
    (group.instructions || []).map((ix, index) => decodedInstruction(tx, ix, 'inner', group.index, index)));
  const all = [...top, ...inner];
  const includesJanus = all.some((ix) => ix.programId === PROGRAM);
  const includesKlend = all.some((ix) => ix.programId === KLEND);
  const janus = all.filter((ix) => ix.programId === PROGRAM);
  const tokenBalance = (row) => ({
    accountIndex: row.accountIndex,
    address: accountKeys(tx)[row.accountIndex],
    mint: row.mint,
    owner: row.owner || null,
    programId: row.programId || null,
    rawAmount: row.uiTokenAmount?.amount || null,
    decimals: row.uiTokenAmount?.decimals ?? null,
  });
  const pre = (tx.meta?.preTokenBalances || []).map(tokenBalance);
  const post = (tx.meta?.postTokenBalances || []).map(tokenBalance);
  const preMap = new Map(pre.map((row) => [row.accountIndex, row]));
  const deltas = post.map((row) => ({
    accountIndex: row.accountIndex,
    address: row.address,
    mint: row.mint,
    owner: row.owner || preMap.get(row.accountIndex)?.owner || null,
    rawDelta: (BigInt(row.rawAmount || 0) - BigInt(preMap.get(row.accountIndex)?.rawAmount || 0)).toString(),
  })).filter((row) => row.rawDelta !== '0');
  return {
    signature: signatureRow.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    confirmationStatus: signatureRow.confirmationStatus,
    err: tx.meta?.err || null,
    fee: tx.meta?.fee,
    transactionVersion: tx.version ?? 'legacy',
    accountCount: accountKeys(tx).length,
    staticAccountCount: (tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys || []).length,
    topLevelInstructionCount: top.length,
    includesJanus,
    includesKlend,
    janus,
    tokenDeltas: deltas,
    top,
    inner,
    logMessages: tx.meta?.logMessages || [],
  };
}

async function signaturesFor(address, limit) {
  const output = [];
  let before;
  while (output.length < limit) {
    const page = await rpc('getSignaturesForAddress', [address, {
      limit: Math.min(1000, limit - output.length), commitment: 'confirmed', ...(before ? {before} : {}),
    }]);
    output.push(...page);
    if (!page.length || page.length < Math.min(1000, limit - output.length + page.length)) break;
    before = page.at(-1).signature;
  }
  return output;
}

async function getTransactions(rows) {
  const output = [];
  for (let start = 0; start < rows.length; start += 10) {
    const batch = rows.slice(start, start + 10);
    const txs = await Promise.all(batch.map((row) => rpc('getTransaction', [row.signature, {
      encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
    }])));
    for (let i = 0; i < batch.length; i += 1) output.push(relevantTransaction(batch[i], txs[i]));
  }
  return output;
}

async function main() {
  const start = new Date().toISOString();
  const addresses = [PROGRAM, AUTHORITY, CASH_VAULT, CASH_MINT];
  const multiple = await rpc('getMultipleAccounts', [addresses, {
    encoding: 'base64', commitment: 'confirmed', minContextSlot: 0,
  }]);
  const snapshots = Object.fromEntries(addresses.map((address, index) =>
    [address, compactAccount(address, multiple.value[index])]));

  const programRaw = accountData(multiple.value[0]);
  if (!programRaw || programRaw.readUInt32LE(0) !== 2)
    throw new Error('Janus is not an Upgradeable Loader Program account');
  const programDataAddress = pubkeyAt(programRaw, 4);
  const programDataResult = await rpc('getAccountInfo', [programDataAddress, {
    encoding: 'base64', commitment: 'confirmed', minContextSlot: multiple.context.slot,
  }]);
  const programData = accountData(programDataResult.value);
  if (!programData || programData.readUInt32LE(0) !== 3)
    throw new Error('Janus ProgramData account is unavailable');
  const deploySlot = programData.readBigUInt64LE(4).toString();
  const hasUpgradeAuthority = programData[12] === 1;
  const upgradeAuthority = hasUpgradeAuthority ? pubkeyAt(programData, 13) : null;
  const metadataBytes = hasUpgradeAuthority ? 45 : 13;
  const elf = programData.subarray(metadataBytes);
  fs.writeFileSync(ELF_OUT, elf);

  const owned = await rpc('getProgramAccounts', [PROGRAM, {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
  }]);
  const ownedAccounts = owned.value.map((row) => compactAccount(row.pubkey, row.account));

  const sigLists = await Promise.all([
    signaturesFor(PROGRAM, 300),
    signaturesFor(AUTHORITY, 300),
    signaturesFor(CASH_VAULT, 300),
  ]);
  const signatureById = new Map();
  for (const [source, rows] of [[PROGRAM, sigLists[0]], [AUTHORITY, sigLists[1]], [CASH_VAULT, sigLists[2]]]) {
    for (const row of rows) {
      const prior = signatureById.get(row.signature) || {...row, seenAt: []};
      prior.seenAt.push(source);
      signatureById.set(row.signature, prior);
    }
  }
  const signatureRows = [...signatureById.values()]
    .sort((a, b) => b.slot - a.slot)
    .slice(0, 300);
  const transactions = await getTransactions(signatureRows);

  const transactionAddresses = [...new Set(transactions.flatMap((tx) =>
    (tx.janus || []).flatMap((ix) => ix.accounts.map((account) => account.address))))];
  const transactionAccountSnapshots = {};
  for (let start = 0; start < transactionAddresses.length; start += 100) {
    const page = transactionAddresses.slice(start, start + 100);
    const result = await rpc('getMultipleAccounts', [page, {encoding: 'base64', commitment: 'confirmed'}]);
    for (let i = 0; i < page.length; i += 1)
      transactionAccountSnapshots[page[i]] = compactAccount(page[i], result.value[i]);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    startedAt: start,
    liveSubmission: false,
    signerVerification: false,
    rpcMethods: ['getMultipleAccounts', 'getAccountInfo', 'getProgramAccounts',
      'getSignaturesForAddress', 'getTransaction'],
    identifiers: {program: PROGRAM, programData: programDataAddress, authority: AUTHORITY,
      cashVault: CASH_VAULT, cashMint: CASH_MINT, klend: KLEND},
    observationSlots: {
      fixedAccounts: multiple.context.slot,
      programData: programDataResult.context.slot,
      programOwnedAccounts: owned.context.slot,
    },
    deployment: {
      deploySlot,
      upgradeAuthority,
      immutable: !hasUpgradeAuthority,
      elfBytes: elf.length,
      elfSha256: sha256(elf),
      elfPath: ELF_OUT,
    },
    snapshots,
    programDataAccount: compactAccount(programDataAddress, programDataResult.value),
    programOwnedAccountCount: ownedAccounts.length,
    programOwnedAccounts: ownedAccounts,
    signatureCounts: {program: sigLists[0].length, authority: sigLists[1].length,
      cashVault: sigLists[2].length, uniqueFetched: signatureRows.length},
    transactionAccountSnapshots,
    transactions,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUT,
    elfOutput: ELF_OUT,
    generatedAt: output.generatedAt,
    observationSlots: output.observationSlots,
    deployment: output.deployment,
    cashVaultRawAmount: snapshots[CASH_VAULT]?.token?.rawAmount || null,
    programOwnedAccountCount: ownedAccounts.length,
    transactionCount: transactions.length,
    successfulJanusTransactions: transactions.filter((tx) => tx.includesJanus && !tx.err).length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
