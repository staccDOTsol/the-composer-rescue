#!/usr/bin/env node

// Read-only current-state snapshot for the Solstice YieldVault program.
// This script never signs or submits a transaction and never emits the RPC URL.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dependencyRoot = new URL('./kliquidity-sdk-official/node_modules/', import.meta.url).pathname;
const { PublicKey } = require(`${dependencyRoot}@solana/web3.js`);
const bs58Module = require(`${dependencyRoot}bs58`);
const bs58 = bs58Module.default || bs58Module;

const OUT = new URL('./solstice-usx-live-snapshot.json', import.meta.url).pathname;
// Prefer the archival endpoint because the evidence set includes transactions
// older than several current RPC cache windows.
const RPC = process.env.RPC_URL || process.env.HEAVY_RPC_URL;
if (!RPC) throw new Error('Set HEAVY_RPC_URL or RPC_URL before running this script');

const PROGRAM = 'eUSXyKoZ6aGejYVbnp3wtWQ1E8zuokLAJPecPxxtgG3';
const PROGRAMDATA = 'BVDochYTcRGvCYmmdtsiX9qT63fy5dmGSB5hNgxMTbJY';
const UPGRADE_AUTHORITY = 'CYr14TrXD5MAertRqcR58KirPz7XoHGZjfBsfn5M2voh';
const USX_MINT = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';
const EUSX_MINT = '3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC';
const AUTHORITIES = [
  'E9URmf61v9M6mCXRhRExzGrJnnmYvAFjoUaXwfEq6eRv',
  '2aHdm37djj4c21ztMRBmmo4my6RtzN5Nn58Y39rpWbRM',
];
const VAULTS = [
  '2QxQFy2foi3YLG6YJPdTa242FwNaXkXvHZBKr4FunDgC',
  '2SGicAhchh23nsrtWrur7zPAdb4hHtnyThQVPfza8CHA',
];
const KLEND = {
  program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  market: '9Y7uwXgQ68mGqRtZfuFaP4hc4fxeJ7cE9zTtqTxVhfGU',
  reserve: 'H2pmnDSjfxeQ8zUeyUohokegYbXZgkjH4kgmoQVybyAX',
  liquiditySupply: '7Dow2t58RhFkqd1M2DLuZCaS5cGivXHC7WCDT632Nhsf',
};
const KNOWN_EXIT_SIGNATURES = [
  'GW5wRjGTSPoGQ2yzM1UbqxWPHW3FaMNrksjCzAjw1Hv93LhEdBxpT1X4t2uBCZ7kaNHi9k1RLSyiVBxveYk1kKL',
  '5NxKF6QV3UpJwhAhpFnUFJNStHPjg7awZ6e8Hpn6YZhGLALiyEiUCpseh8Eevdwnh4kFXAj9FsWXETNVG5jFRWep',
  '61ZtQKWUHGWcfwjkJKtTgtU4qS3jPv6kxVpTHXvAiUL3TDMj1E8wnWBRxZuwqsD6D2hniXFkRsihUzK2vWxyjfx9',
  '2iGRDxiXGZmidaQ6coyd5YLe12BpFLfu3QmcbNFkubgFDMbCepZpqip64UvZgrcK6vGJsSuCvGCvQqD8c2eYXbtm',
  '5qKyfQcs9DSsb7FQjPdJXDeSYwBV4vL9vk7eCEY917Dbg9KSdh1b7VkUJbtCVh9T9v6SkS9UmbG7DCuA712atxtW',
];

const INSTRUCTION_NAMES = [
  'initialize_controller',
  'initialize_vesting_schedule',
  'initialize_permissioned_account',
  'initialize_yield_pool',
  'edit_controller',
  'edit_permissioned_account',
  'edit_program_freeze_status',
  'transfer_in_yield',
  'lock',
  'unlock',
  'withdraw',
  'initialize_authority_transfer',
  'confirm_authority_transfer',
  'initialize_metadata',
  'edit_metadata',
];
const instructionByDiscriminator = new Map(INSTRUCTION_NAMES.map((name) => [
  crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8).toString('hex'),
  name,
]));

let rpcId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(method, params, attempts = 6) {
  let lastError = 'unknown RPC error';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      const body = await response.json();
      if (response.ok && body.result !== undefined) return body.result;
      lastError = body.error ? JSON.stringify(body.error) : `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error?.message || error).replace(/https?:\/\/\S+/g, '<redacted-url>');
    }
    await sleep(Math.min(8000, 500 * (2 ** attempt)));
  }
  throw new Error(`${method} failed: ${lastError}`);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readPubkey(data, offset) {
  if (offset < 0 || offset + 32 > data.length) return null;
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function decodeCOptionPubkey(data, offset) {
  if (offset + 36 > data.length) return null;
  const tag = data.readUInt32LE(offset);
  return tag === 1 ? readPubkey(data, offset + 4) : null;
}

function decodeTokenAccount(data) {
  if (data.length < 165) return null;
  return {
    kind: 'spl-token-account',
    mint: readPubkey(data, 0),
    authority: readPubkey(data, 32),
    amountRaw: data.readBigUInt64LE(64).toString(),
    delegate: decodeCOptionPubkey(data, 72),
    state: data[108],
    nativeReserveRaw: data.readUInt32LE(109) === 1 ? data.readBigUInt64LE(113).toString() : null,
    delegatedAmountRaw: data.readBigUInt64LE(121).toString(),
    closeAuthority: decodeCOptionPubkey(data, 129),
  };
}

function decodeMint(data) {
  if (data.length < 82) return null;
  return {
    kind: 'spl-mint',
    mintAuthority: decodeCOptionPubkey(data, 0),
    supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44],
    initialized: data[45] === 1,
    freezeAuthority: decodeCOptionPubkey(data, 46),
  };
}

function decodeUpgradeableLoader(data) {
  if (data.length < 4) return null;
  const variant = data.readUInt32LE(0);
  if (variant === 2 && data.length >= 36) {
    return { kind: 'upgradeable-program', programdataAddress: readPubkey(data, 4) };
  }
  if (variant === 3 && data.length >= 13) {
    const option = data[12];
    return {
      kind: 'upgradeable-programdata',
      lastDeploySlot: data.readBigUInt64LE(4).toString(),
      upgradeAuthority: option === 1 ? readPubkey(data, 13) : null,
      executableBytes: Math.max(0, data.length - (option === 1 ? 45 : 13)),
    };
  }
  return { kind: 'upgradeable-loader-state', variant };
}

function summarizeAccount(address, account, includeBase64 = false) {
  if (!account) return { address, exists: false };
  const data = Buffer.from(account.data[0], 'base64');
  let decoded = null;
  if (account.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
    decoded = data.length === 82 ? decodeMint(data) : decodeTokenAccount(data);
  } else if (account.owner === 'BPFLoaderUpgradeab1e11111111111111111111111') {
    decoded = decodeUpgradeableLoader(data);
  }
  const result = {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    rentEpoch: account.rentEpoch,
    dataLength: data.length,
    sha256: sha256(data),
    discriminatorHex: data.length >= 8 ? data.subarray(0, 8).toString('hex') : null,
    decoded,
  };
  if (includeBase64) result.dataBase64 = data.toString('base64');
  return result;
}

function resolveKeys(message, meta) {
  const staticKeys = message.accountKeys.map((value) => typeof value === 'string' ? value : value.pubkey);
  const loadedWritable = meta?.loadedAddresses?.writable || [];
  const loadedReadonly = meta?.loadedAddresses?.readonly || [];
  return [...staticKeys, ...loadedWritable, ...loadedReadonly];
}

function writableAt(index, message, meta) {
  const staticCount = message.accountKeys.length;
  const header = message.header;
  if (index < staticCount) {
    if (index < header.numRequiredSignatures) {
      return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
    }
    return index < staticCount - header.numReadonlyUnsignedAccounts;
  }
  return index < staticCount + (meta?.loadedAddresses?.writable?.length || 0);
}

function instructionSummary(ix, index, message, meta, allKeys, level = 'top') {
  const programId = allKeys[ix.programIdIndex];
  const data = Buffer.from(bs58.decode(ix.data || ''));
  const discriminatorHex = data.length >= 8 ? data.subarray(0, 8).toString('hex') : null;
  return {
    level,
    index,
    programId,
    discriminatorHex,
    instructionName: programId === PROGRAM ? instructionByDiscriminator.get(discriminatorHex) || null : null,
    dataHex: data.toString('hex'),
    accounts: (ix.accounts || []).map((accountIndex, position) => ({
      position,
      address: allKeys[accountIndex],
      transactionIndex: accountIndex,
      isSigner: accountIndex < message.header.numRequiredSignatures,
      isWritable: writableAt(accountIndex, message, meta),
    })),
  };
}

function parsedInnerSummary(ix, index) {
  const parsed = ix.parsed || null;
  return {
    level: 'inner-parsed',
    index,
    program: ix.program || null,
    programId: ix.programId || null,
    parsed,
  };
}

function summarizeTransaction(signature, tx) {
  if (!tx) return { signature, found: false };
  const message = tx.transaction.message;
  const meta = tx.meta;
  const allKeys = resolveKeys(message, meta);
  const top = (message.instructions || []).map((ix, index) => instructionSummary(ix, index, message, meta, allKeys));
  const inner = [];
  for (const group of meta?.innerInstructions || []) {
    for (let index = 0; index < group.instructions.length; index += 1) {
      const ix = group.instructions[index];
      inner.push(ix.parsed
        ? { parentIndex: group.index, ...parsedInnerSummary(ix, index) }
        : { parentIndex: group.index, ...instructionSummary(ix, index, message, meta, allKeys, 'inner') });
    }
  }
  return {
    signature,
    found: true,
    slot: tx.slot,
    blockTime: tx.blockTime,
    version: tx.version,
    err: meta?.err || null,
    fee: meta?.fee,
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    staticAccountCount: message.accountKeys.length,
    loadedWritableCount: meta?.loadedAddresses?.writable?.length || 0,
    loadedReadonlyCount: meta?.loadedAddresses?.readonly?.length || 0,
    allAccountCount: allKeys.length,
    requiredSignatures: message.header.numRequiredSignatures,
    signers: allKeys.slice(0, message.header.numRequiredSignatures),
    preTokenBalances: meta?.preTokenBalances || [],
    postTokenBalances: meta?.postTokenBalances || [],
    logMessages: meta?.logMessages || [],
    topLevelInstructions: top,
    innerInstructions: inner,
  };
}

function candidatePdas(programAccountAddresses) {
  const addressSet = new Set(programAccountAddresses);
  const namespaces = [
    'CONTROLLER', 'YIELD_POOL', 'VESTING_SCHEDULE', 'PERMISSIONED_ACCOUNT',
    'ASSET_VAULT', 'SHARE_MINT', 'COOLDOWN_ESCROW',
    'COOLDOWN_ESCROW_VAULT',
  ];
  const variableKeys = [USX_MINT, EUSX_MINT, ...AUTHORITIES, ...VAULTS];
  const rows = [];
  const add = (label, seeds) => {
    try {
      const [pda, bump] = PublicKey.findProgramAddressSync(seeds, new PublicKey(PROGRAM));
      rows.push({ label, address: pda.toBase58(), bump, isCurrentProgramAccount: addressSet.has(pda.toBase58()) });
    } catch {
      // Ignore invalid speculative seed combinations.
    }
  };
  for (const namespace of namespaces) {
    const prefix = Buffer.from(namespace);
    add(namespace, [prefix]);
    for (const key of variableKeys) {
      add(`${namespace}:${key}`, [prefix, new PublicKey(key).toBuffer()]);
      add(`${key}:${namespace}`, [new PublicKey(key).toBuffer(), prefix]);
    }
  }
  return rows.filter((row) => row.isCurrentProgramAccount || AUTHORITIES.includes(row.address) ||
    VAULTS.includes(row.address) || row.address === EUSX_MINT);
}

async function main() {
  const observedAt = new Date().toISOString();
  const slot = await rpc('getSlot', [{ commitment: 'confirmed' }]);
  const blockTime = await rpc('getBlockTime', [slot]);
  const namedAddresses = [
    PROGRAM, PROGRAMDATA, UPGRADE_AUTHORITY, USX_MINT, EUSX_MINT,
    ...AUTHORITIES, ...VAULTS, KLEND.market, KLEND.reserve, KLEND.liquiditySupply,
  ];
  const multiple = await rpc('getMultipleAccounts', [namedAddresses, { encoding: 'base64', commitment: 'confirmed' }]);
  const namedAccounts = Object.fromEntries(namedAddresses.map((address, index) => [
    address,
    summarizeAccount(address, multiple.value[index], [...AUTHORITIES, ...VAULTS, USX_MINT, EUSX_MINT, KLEND.reserve].includes(address)),
  ]));

  const programAccountsResponse = await rpc('getProgramAccounts', [PROGRAM, {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
  }]);
  const programAccountRows = programAccountsResponse.value.map((row) => summarizeAccount(row.pubkey, row.account, true));
  programAccountRows.sort((a, b) => a.dataLength - b.dataLength || a.address.localeCompare(b.address));

  const currentSignatures = await rpc('getSignaturesForAddress', [PROGRAM, { limit: 100, commitment: 'confirmed' }]);
  const selectedSignatures = [...new Set([
    ...KNOWN_EXIT_SIGNATURES,
    ...currentSignatures.slice(0, 30).map((row) => row.signature),
  ])];
  const transactions = [];
  for (const signature of selectedSignatures) {
    const tx = await rpc('getTransaction', [signature, {
      encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
    }]);
    transactions.push(summarizeTransaction(signature, tx));
    await sleep(125);
  }

  const output = {
    schemaVersion: 1,
    observedAt,
    readOnly: true,
    noTransactionsSubmitted: true,
    rpcHost: new URL(RPC).hostname,
    context: { slot, blockTime, accountContextSlot: multiple.context.slot, programAccountsContextSlot: programAccountsResponse.context.slot },
    constants: { programId: PROGRAM, programdataAddress: PROGRAMDATA, upgradeAuthority: UPGRADE_AUTHORITY, usxMint: USX_MINT, eusxMint: EUSX_MINT, authorities: AUTHORITIES, vaults: VAULTS, klend: KLEND },
    instructionDiscriminators: Object.fromEntries([...instructionByDiscriminator].map(([hex, name]) => [name, hex])),
    namedAccounts,
    programAccounts: programAccountRows,
    pdaCandidates: candidatePdas(programAccountRows.map((row) => row.address)),
    currentSignatures,
    transactions,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    observedAt,
    slot,
    blockTime,
    programAccountCount: programAccountRows.length,
    programAccountDataSizes: [...new Set(programAccountRows.map((row) => row.dataLength))],
    transactionCount: transactions.length,
    knownPdaMatches: output.pdaCandidates,
  }, null, 2)}\n`);
}

main().catch((error) => {
  const safe = String(error?.stack || error).replace(/https?:\/\/\S+/g, '<redacted-url>');
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
});
