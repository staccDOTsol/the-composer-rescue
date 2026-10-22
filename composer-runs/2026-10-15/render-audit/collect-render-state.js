#!/usr/bin/env node
// Read-only current-mainnet collector for the RENDER bridge/circuit-breaker audit.
// RPC methods are limited to get* calls. This script never signs or submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');

const bs58 = bs58Module.default || bs58Module;
const DIR = __dirname;
const ENV_FILE = '/tmp/composer-helius-only.env';
const fileEnv = fs.existsSync(ENV_FILE) ? Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8')
  .split('\n').filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL ||
  fileEnv.HEAVY_RPC_URL || fileEnv.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL or HEAVY_RPC_URL is required');

const ADDR = {
  bridge: 'brdgGYmhGdaAJmqLN9oSp4381Ywc51vUfzn9NaSZC1d',
  breakerProgram: 'circiqFCstNzaFBji1udQ6txgQBrn29pVSYHNJQo3wZ',
  breakerState: 'AYm4Knn6Sw1f52Eq42ujQ2ez5Xb7iBJeviprFCA7ADCy',
  vault: '5crgXHDPmJup446JZ8Qxyx4jjyZbdW8pUjYBpbuqs8Ra',
  mint: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  p0Program: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  p0Bank: 'EbuSnXdFz1R4VPdaJ96KQQQmeYgZTHSzpNW94Tw1PE3H',
  p0Vault: '5oidBtmXgyb9aLaHbbDDL6Wx6ddq7nD297kvDYLdFeFU',
};
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
let rpcId = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const pk = (value) => value instanceof PublicKey ? value : new PublicKey(value);
const b58 = (data) => bs58.encode(Buffer.from(data));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
    });
    const text = await response.text();
    if (response.status === 429 || text.startsWith('Too Many Requests')) {
      await sleep(650 * (attempt + 1));
      continue;
    }
    const body = JSON.parse(text);
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  throw new Error(`${method}: rate limited after retries`);
}

function rawAccount(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return {
    executable: row.executable,
    lamports: String(row.lamports),
    owner: row.owner,
    dataLength: data.length,
    dataSha256: sha256(data),
    dataBase64: data.toString('base64'),
  };
}

function tokenAccount(row) {
  const account = rawAccount(row);
  if (!account || account.dataLength < 165) return account;
  const data = Buffer.from(account.dataBase64, 'base64');
  return {
    ...account,
    mint: pk(data.subarray(0, 32)).toBase58(),
    tokenAuthority: pk(data.subarray(32, 64)).toBase58(),
    rawAmount: data.readBigUInt64LE(64).toString(),
    delegateOption: data.readUInt32LE(72),
    state: data[108],
    closeAuthorityOption: data.readUInt32LE(129),
  };
}

function mintAccount(row) {
  const account = rawAccount(row);
  if (!account || account.dataLength < 82) return account;
  const data = Buffer.from(account.dataBase64, 'base64');
  return {
    ...account,
    mintAuthorityOption: data.readUInt32LE(0),
    mintAuthority: data.readUInt32LE(0) ? pk(data.subarray(4, 36)).toBase58() : null,
    supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44],
    initialized: data[45] !== 0,
    freezeAuthorityOption: data.readUInt32LE(46),
    freezeAuthority: data.readUInt32LE(46) ? pk(data.subarray(50, 82)).toBase58() : null,
  };
}

function upgradeable(row) {
  const account = rawAccount(row);
  if (!account || account.owner !== LOADER || account.dataLength < 4) return account;
  const data = Buffer.from(account.dataBase64, 'base64');
  const tag = data.readUInt32LE(0);
  if (tag === 2) return {...account, loaderTag: tag, kind: 'program',
    programData: pk(data.subarray(4, 36)).toBase58()};
  if (tag === 3) {
    const slot = data.readBigUInt64LE(4).toString();
    const hasAuthority = data[12] === 1;
    const elfOffset = hasAuthority ? 45 : 13;
    return {...account, loaderTag: tag, kind: 'programData', slot,
      upgradeAuthority: hasAuthority ? pk(data.subarray(13, 45)).toBase58() : null,
      elfOffset, elfLength: data.length - elfOffset,
      elfSha256: sha256(data.subarray(elfOffset))};
  }
  return {...account, loaderTag: tag, kind: 'unknown'};
}

function decodeBreaker(row) {
  const account = rawAccount(row);
  if (!account || account.dataLength < 138) return account;
  const data = Buffer.from(account.dataBase64, 'base64');
  return {
    ...account,
    discriminatorHex: data.subarray(0, 8).toString('hex'),
    tokenAccount: pk(data.subarray(8, 40)).toBase58(),
    authority: pk(data.subarray(40, 72)).toBase58(),
    owner: pk(data.subarray(72, 104)).toBase58(),
    config: {
      windowSizeSeconds: data.readBigUInt64LE(104).toString(),
      thresholdType: data[112] === 0 ? 'Percent' : data[112] === 1 ? 'Absolute' : `Unknown(${data[112]})`,
      threshold: data.readBigUInt64LE(113).toString(),
    },
    lastWindow: {
      lastAggregatedValue: data.readBigUInt64LE(121).toString(),
      lastUnixTimestamp: data.readBigInt64LE(129).toString(),
    },
    bumpSeed: data[137],
    trailingNonzero: [...data.subarray(138)].filter((value) => value !== 0).length,
  };
}

function txKeys(message, meta) {
  const staticKeys = message.accountKeys.map((row) => typeof row === 'string' ? row : row.pubkey);
  return [...staticKeys, ...(meta.loadedAddresses?.writable || []), ...(meta.loadedAddresses?.readonly || [])];
}

function flags(message, meta, index) {
  const keys = message.accountKeys;
  if (typeof keys[0] !== 'string') {
    const key = keys[index];
    if (key) return {signer: !!key.signer, writable: !!key.writable};
    const loaded = index - keys.length;
    return {signer: false, writable: loaded < (meta.loadedAddresses?.writable || []).length};
  }
  const h = message.header;
  if (index < keys.length) {
    const signer = index < h.numRequiredSignatures;
    const writable = signer
      ? index < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : index < keys.length - h.numReadonlyUnsignedAccounts;
    return {signer, writable};
  }
  return {signer: false,
    writable: index < keys.length + (meta.loadedAddresses?.writable || []).length};
}

function summarizeIx(ix, message, meta, keys, outerIndex, innerIndex = null) {
  if (ix.parsed) return {outerIndex, innerIndex, stackHeight: ix.stackHeight || null,
    program: ix.program, programId: ix.programId, parsed: ix.parsed};
  const programId = ix.programId || keys[ix.programIdIndex];
  const accountIndexes = ix.accounts || [];
  const accountRows = accountIndexes.map((item) => {
    if (typeof item === 'string') return {address: item};
    return {address: keys[item], ...flags(message, meta, item)};
  });
  let dataHex = null;
  if (ix.data != null) {
    try { dataHex = Buffer.from(bs58.decode(ix.data)).toString('hex'); } catch (_) {}
  }
  return {outerIndex, innerIndex, stackHeight: ix.stackHeight || null, programId,
    dataBase58: ix.data || null, dataHex, accounts: accountRows};
}

function summarizeTransaction(signature, tx) {
  if (!tx) return {signature, unavailable: true};
  const message = tx.transaction.message;
  const keys = txKeys(message, tx.meta);
  const top = message.instructions.map((ix, index) => summarizeIx(ix, message, tx.meta, keys, index));
  const inner = (tx.meta.innerInstructions || []).flatMap((group) => group.instructions.map((ix, index) =>
    summarizeIx(ix, message, tx.meta, keys, group.index, index)));
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: tx.version,
    err: tx.meta.err,
    fee: tx.meta.fee,
    computeUnitsConsumed: tx.meta.computeUnitsConsumed,
    keys,
    top,
    inner,
    preTokenBalances: tx.meta.preTokenBalances || [],
    postTokenBalances: tx.meta.postTokenBalances || [],
    logs: tx.meta.logMessages || [],
  };
}

async function programDeployment(address) {
  const program = await rpc('getAccountInfo', [address,
    {encoding: 'base64', commitment: 'finalized'}]);
  const programDecoded = upgradeable(program.value);
  const programData = await rpc('getAccountInfo', [programDecoded.programData,
    {encoding: 'base64', commitment: 'finalized'}]);
  const programDataDecoded = upgradeable(programData.value);
  const raw = Buffer.from(programData.value.data[0], 'base64');
  const elf = raw.subarray(programDataDecoded.elfOffset);
  const filename = `${address}-current.so`;
  fs.writeFileSync(path.join(DIR, filename), elf);
  return {program: programDecoded, programData: programDataDecoded, elfFile: filename};
}

async function main() {
  const observedSlot = await rpc('getSlot', [{commitment: 'finalized'}]);
  const accountResult = await rpc('getMultipleAccounts', [[
    ADDR.vault, ADDR.mint, ADDR.breakerState, ADDR.p0Bank, ADDR.p0Vault,
  ], {encoding: 'base64', commitment: 'finalized'}]);
  const [vaultRow, mintRow, breakerRow, p0BankRow, p0VaultRow] = accountResult.value;
  const [bridgeDeployment, breakerDeployment] = await Promise.all([
    programDeployment(ADDR.bridge), programDeployment(ADDR.breakerProgram),
  ]);

  const expectedBreaker = PublicKey.findProgramAddressSync([
    Buffer.from('account_windowed_breaker'), pk(ADDR.vault).toBuffer(),
  ], pk(ADDR.breakerProgram));
  const breaker = decodeBreaker(breakerRow);

  const bridgeAccountsResult = await rpc('getProgramAccounts', [ADDR.bridge,
    {encoding: 'base64', commitment: 'finalized', withContext: true}]);
  const bridgeAccounts = bridgeAccountsResult.value.map((row) => {
    const account = rawAccount(row.account);
    const data = Buffer.from(account.dataBase64, 'base64');
    return {address: row.pubkey, ...account,
      discriminatorHex: data.length >= 8 ? data.subarray(0, 8).toString('hex') : null};
  });

  const vaultSignatures = await rpc('getSignaturesForAddress', [ADDR.vault,
    {limit: 100, commitment: 'finalized'}]);
  const bridgeSignatures = await rpc('getSignaturesForAddress', [ADDR.bridge,
    {limit: 250, commitment: 'finalized'}]);
  const selectedSignatures = [...new Set([
    ...vaultSignatures.slice(0, 40).map((row) => row.signature),
    ...bridgeSignatures.filter((row) => row.err === null).slice(0, 60).map((row) => row.signature),
    ...bridgeSignatures.filter((row) => row.err !== null).slice(0, 20).map((row) => row.signature),
  ])];
  const transactions = [];
  for (let i = 0; i < selectedSignatures.length; i += 4) {
    const batch = selectedSignatures.slice(i, i + 4);
    const rows = await Promise.all(batch.map((signature) => rpc('getTransaction', [signature,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}])));
    transactions.push(...rows.map((row, index) => summarizeTransaction(batch[index], row)));
  }

  const bridgeInstructionHistogram = {};
  for (const tx of transactions) {
    for (const ix of tx.top || []) {
      if (ix.programId !== ADDR.bridge) continue;
      const discriminator = ix.dataHex?.slice(0, 16) || '(empty)';
      bridgeInstructionHistogram[discriminator] = (bridgeInstructionHistogram[discriminator] || 0) + 1;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'finalized',
    observedSlot,
    accountContextSlot: accountResult.context.slot,
    addresses: ADDR,
    vault: tokenAccount(vaultRow),
    mint: mintAccount(mintRow),
    breaker: {
      ...breaker,
      expectedPda: expectedBreaker[0].toBase58(),
      expectedBump: expectedBreaker[1],
      pdaMatches: expectedBreaker[0].toBase58() === ADDR.breakerState,
    },
    p0Bank: rawAccount(p0BankRow),
    p0Vault: tokenAccount(p0VaultRow),
    deployments: {bridge: bridgeDeployment, breaker: breakerDeployment},
    bridgeProgramAccounts: {
      contextSlot: bridgeAccountsResult.context.slot,
      count: bridgeAccounts.length,
      byLength: Object.fromEntries(Object.entries(Object.groupBy(bridgeAccounts, (row) => row.dataLength))
        .map(([key, value]) => [key, value.length])),
      byDiscriminator: Object.fromEntries(Object.entries(Object.groupBy(bridgeAccounts,
        (row) => `${row.dataLength}:${row.discriminatorHex}`)).map(([key, value]) => [key, value.length])),
      rows: bridgeAccounts,
    },
    vaultSignatures,
    bridgeSignatures,
    bridgeInstructionHistogram,
    transactions,
  };
  fs.writeFileSync(path.join(DIR, 'render-current-state-and-history.json'),
    `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({observedSlot, vaultRaw: output.vault.rawAmount,
    p0VaultRaw: output.p0Vault.rawAmount, breakerOwner: output.breaker.owner,
    bridgeAccounts: bridgeAccounts.length, transactions: transactions.length,
    bridgeInstructionHistogram, deployments: {
      bridge: bridgeDeployment.programData.elfSha256,
      breaker: breakerDeployment.programData.elfSha256,
    }}));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
