#!/usr/bin/env node
// Read-only Hylo mainnet instruction/account probe. Never signs or submits.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const IDL_PATH = `${ROOT}/hylo-exchange-sdk-source/hylo-idl/idls/hylo_exchange.json`;
const OUT_PATH = `${ROOT}/hylo-exchange-instruction-map.json`;
const HYLO = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const PROGRAM_DATA = new PublicKey('BA5b6FzvZ77m7MZbsMEVSCFW1x86f7jM98wjcecVwzYN');
const CENSUS_SIGNATURE = '2hPe12oDQL2jLmtRmeH9NQWWjg9A7rLPG4q9fQcywe4S3qtnxtg9VRngoVpjCHzJxWknwJsJrAzSGAyDGuP34Sxz';
const JITOSOL_VAULT = new PublicKey('2Y3TLkdGoJwbdizxqrZmQwNLYJyGKTgzC4tbetbkvQ43');

function readEnv(path) {
  const out = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!raw || raw.trimStart().startsWith('#')) continue;
    const i = raw.indexOf('=');
    if (i > 0) out[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
  }
  return out;
}

const env = readEnv(ENV_PATH);
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
const conn = new Connection(rpcUrl, 'confirmed');
const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
const byDisc = new Map(idl.instructions.map(ix => [Buffer.from(ix.discriminator).toString('hex'), ix]));

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function decompile(signature) {
  const raw = await rpc('getTransaction', [signature, {
    encoding: 'base64',
    maxSupportedTransactionVersion: 1,
    commitment: 'confirmed',
  }]);
  if (!raw) return null;
  const wireBytes = Buffer.from(raw.transaction[0], 'base64');
  const wire = VersionedTransaction.deserialize(wireBytes);
  const alts = await Promise.all((wire.message.addressTableLookups || []).map(async lookup => {
    const got = await conn.getAddressLookupTable(lookup.accountKey);
    if (!got.value) throw new Error(`Missing lookup table ${lookup.accountKey}`);
    return got.value;
  }));
  const message = TransactionMessage.decompile(wire.message, {addressLookupTableAccounts: alts});
  const accountKeys = wire.message.getAccountKeys({addressLookupTableAccounts: alts});
  return {raw, wire, wireBytes, message, accountKeys};
}

function decodeArgs(ix, data) {
  const args = {};
  let offset = 8;
  for (const arg of ix.args || []) {
    if (arg.type === 'u64') {
      if (offset + 8 > data.length) break;
      args[arg.name] = data.readBigUInt64LE(offset).toString();
      offset += 8;
      continue;
    }
    if (arg.type && typeof arg.type === 'object' && arg.type.option) {
      if (offset >= data.length) break;
      const tag = data[offset++];
      args[arg.name] = {present: tag === 1, remainingHex: data.subarray(offset).toString('hex')};
      break;
    }
    args[arg.name] = {unparsedRemainingHex: data.subarray(offset).toString('hex')};
    break;
  }
  return args;
}

function describeInstruction(instruction, index) {
  const data = Buffer.from(instruction.data);
  const disc = data.subarray(0, 8).toString('hex');
  const schema = byDisc.get(disc);
  return {
    outerInstructionIndex: index,
    discriminatorHex: disc,
    instruction: schema?.name || null,
    dataHex: data.toString('hex'),
    args: schema ? decodeArgs(schema, data) : null,
    accounts: instruction.keys.map((meta, i) => ({
      index: i,
      name: schema?.accounts?.[i]?.name || null,
      address: meta.pubkey.toBase58(),
      signer: meta.isSigner,
      writable: meta.isWritable,
    })),
  };
}

function describeInnerInstruction(tx, instruction, groupIndex, innerIndex) {
  const programId = tx.accountKeys.get(instruction.programIdIndex);
  if (!programId?.equals(HYLO)) return null;
  const data = Buffer.from(bs58.decode(instruction.data));
  const disc = data.subarray(0, 8).toString('hex');
  const schema = byDisc.get(disc);
  return {
    outerInstructionIndex: groupIndex,
    innerInstructionIndex: innerIndex,
    stackHeight: instruction.stackHeight ?? null,
    discriminatorHex: disc,
    instruction: schema?.name || null,
    dataHex: data.toString('hex'),
    args: schema ? decodeArgs(schema, data) : null,
    accounts: instruction.accounts.map((accountIndex, i) => ({
      index: i,
      name: schema?.accounts?.[i]?.name || null,
      address: tx.accountKeys.get(accountIndex).toBase58(),
      signer: accountIndex < tx.wire.message.header.numRequiredSignatures,
      writable: tx.wire.message.isAccountWritable(accountIndex),
    })),
  };
}

function tokenAmount(data) {
  if (!data || data.length < 72) return null;
  return {
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amount: data.readBigUInt64LE(64).toString(),
  };
}

function programDataMetadata(data) {
  if (!data || data.length < 45 || data.readUInt32LE(0) !== 3) return null;
  const hasUpgradeAuthority = data[12] === 1;
  const metadataLength = hasUpgradeAuthority ? 45 : 13;
  return {
    stateVariant: data.readUInt32LE(0),
    deploySlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasUpgradeAuthority
      ? new PublicKey(data.subarray(13, 45)).toBase58()
      : null,
    metadataLength,
    executableLength: data.length - metadataLength,
    executableSha256: crypto.createHash('sha256').update(data.subarray(metadataLength)).digest('hex'),
  };
}

async function inspectSignature(row) {
  let tx;
  try {
    tx = await decompile(row.signature);
  } catch (error) {
    return {signature: row.signature, unavailable: true, error: String(error.message || error)};
  }
  if (!tx) return {signature: row.signature, unavailable: true};
  const instructions = tx.message.instructions
    .map((instruction, index) => ({instruction, index}))
    .filter(x => x.instruction.programId.equals(HYLO))
    .map(x => describeInstruction(x.instruction, x.index));
  for (const group of tx.raw.meta?.innerInstructions || []) {
    for (const [innerIndex, instruction] of group.instructions.entries()) {
      const parsed = describeInnerInstruction(tx, instruction, group.index, innerIndex);
      if (parsed) instructions.push(parsed);
    }
  }
  if (!instructions.length) return null;
  return {
    signature: row.signature,
    slot: tx.raw.slot,
    blockTime: tx.raw.blockTime,
    err: tx.raw.meta?.err ?? null,
    version: tx.raw.version,
    wireBytes: tx.wireBytes.length,
    payer: tx.message.payerKey.toBase58(),
    instructions,
  };
}

async function main() {
  const context = await conn.getSlot('confirmed');
  const [programAccount, programDataAccount, signatures, vaultSignatures] = await Promise.all([
    conn.getAccountInfo(HYLO, 'confirmed'),
    conn.getAccountInfo(PROGRAM_DATA, 'confirmed'),
    conn.getSignaturesForAddress(HYLO, {limit: 100}, 'confirmed'),
    conn.getSignaturesForAddress(JITOSOL_VAULT, {limit: 100}, 'confirmed'),
  ]);
  const wanted = [{signature: CENSUS_SIGNATURE}, ...signatures, ...vaultSignatures];
  const seen = new Set();
  const transactions = [];
  for (const row of wanted) {
    if (seen.has(row.signature)) continue;
    seen.add(row.signature);
    const parsed = await inspectSignature(row);
    if (parsed) transactions.push(parsed);
  }

  const addresses = new Map();
  for (const tx of transactions) {
    for (const ix of tx.instructions || []) {
      for (const account of ix.accounts) addresses.set(account.address, account.name);
    }
  }
  const addressList = [...addresses.keys()].map(x => new PublicKey(x));
  const infos = addressList.length ? await conn.getMultipleAccountsInfo(addressList, 'confirmed') : [];
  const accounts = addressList.map((key, i) => {
    const info = infos[i];
    const parsedToken = info?.owner?.toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      ? tokenAmount(info.data) : null;
    return {
      address: key.toBase58(),
      observedRole: addresses.get(key.toBase58()),
      exists: Boolean(info),
      owner: info?.owner?.toBase58() || null,
      executable: info?.executable || false,
      dataLength: info?.data?.length || 0,
      lamports: info?.lamports ?? null,
      token: parsedToken,
      dataSha256: info ? crypto.createHash('sha256').update(info.data).digest('hex') : null,
    };
  });
  const output = {
    generatedAt: new Date().toISOString(),
    noTransactionsSubmitted: true,
    rpcEndpointRedacted: true,
    observationSlot: context,
    program: {
      address: HYLO.toBase58(),
      owner: programAccount?.owner.toBase58() || null,
      executable: programAccount?.executable || false,
      dataLength: programAccount?.data.length || null,
      programData: PROGRAM_DATA.toBase58(),
      programDataLength: programDataAccount?.data.length || null,
      programDataSha256: programDataAccount ? crypto.createHash('sha256').update(programDataAccount.data).digest('hex') : null,
      programDataMetadata: programDataMetadata(programDataAccount?.data),
    },
    publicIdl: {
      path: IDL_PATH,
      address: idl.address,
      metadata: idl.metadata,
      instructionCount: idl.instructions.length,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(IDL_PATH)).digest('hex'),
    },
    transactions,
    accounts,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  const histogram = {};
  for (const tx of transactions) for (const ix of tx.instructions || []) {
    histogram[ix.instruction || ix.discriminatorHex] = (histogram[ix.instruction || ix.discriminatorHex] || 0) + 1;
  }
  console.log(JSON.stringify({
    outputPath: OUT_PATH,
    observationSlot: context,
    transactionsWithHylo: transactions.length,
    instructionHistogram: histogram,
    censusInstruction: transactions.find(x => x.signature === CENSUS_SIGNATURE)?.instructions || null,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
