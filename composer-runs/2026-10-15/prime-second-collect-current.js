#!/usr/bin/env node
'use strict';

// Read-only evidence collector for the PRIME controller audit. This script only
// calls account/history RPC methods and never signs or submits a transaction.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const OUT = __dirname;
const PROGRAM = new PublicKey('4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT');
const VAULT = new PublicKey('7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC');
const AUTHORITY = new PublicKey('XcVU4Nhzjzg69VRcpybnoFWT98oQANV58F7guE6mRza');
const MINT = new PublicKey('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const RESERVE = new PublicKey('BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh');
const EXIT_SIGNATURE = '5NAJ7FJSTjscmTRiNSYKh5KdJKCESRAxcQAF45VePoJfjAafW3kR9xgcjy5vugHdnLPZfcszxyBtSMB57CFoFX2D';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

function readEnv(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const env = readEnv('/tmp/composer-helius-rpc.env');
const RPCS = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!RPCS.length) throw new Error('RPC_URL/HEAVY_RPC_URL unavailable');

let rpcId = 0;
async function rpc(method, params) {
  const errors = [];
  for (const endpoint of RPCS) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (!response.ok) { errors.push(`HTTP ${response.status}`); continue; }
      const body = await response.json();
      if (body.error) { errors.push(`${body.error.code}: ${body.error.message}`); continue; }
      return body.result;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`${method}: all configured RPCs failed (${errors.join('; ')})`);
}

async function rpcLargestArray(method, params) {
  const values = [];
  for (const endpoint of RPCS) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (!response.ok) continue;
      const body = await response.json();
      if (!body.error && Array.isArray(body.result)) values.push(body.result);
    } catch (_) {}
  }
  if (!values.length) throw new Error(`${method}: no configured RPC returned an array`);
  return values.sort((a, b) => b.length - a.length)[0];
}

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const pk = data => new PublicKey(data).toBase58();
const accountData = account => account ? Buffer.from(account.data[0], 'base64') : null;
const safeAccount = (address, account) => {
  if (!account) return {address, exists: false};
  const data = accountData(account);
  const base = {address, exists: true, lamports: String(account.lamports), owner: account.owner,
    executable: account.executable, rentEpoch: account.rentEpoch, dataLength: data.length,
    dataSha256: sha256(data)};
  if (account.owner === TOKEN && data.length === 165) return {...base, kind: 'spl-token-account',
    mint: pk(data.subarray(0, 32)), tokenAuthority: pk(data.subarray(32, 64)),
    amountRaw: data.readBigUInt64LE(64).toString(), delegateOption: data.readUInt32LE(72),
    state: data[108], isNativeOption: data.readUInt32LE(109),
    delegatedAmountRaw: data.readBigUInt64LE(121).toString(), closeAuthorityOption: data.readUInt32LE(129)};
  if (account.owner === TOKEN && data.length === 82) return {...base, kind: 'spl-mint',
    mintAuthorityOption: data.readUInt32LE(0), supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44], initialized: data[45] !== 0, freezeAuthorityOption: data.readUInt32LE(46)};
  return {...base, kind: data.length ? 'opaque' : 'system'};
};

function writeJson(name, value) {
  const output = path.join(OUT, name);
  fs.writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`);
  return output;
}

function messageAccounts(tx) {
  const message = tx.transaction.message;
  const statics = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loadedWritable = tx.meta?.loadedAddresses?.writable || [];
  const loadedReadonly = tx.meta?.loadedAddresses?.readonly || [];
  const all = [...statics, ...loadedWritable, ...loadedReadonly];
  const header = message.header;
  const isSigner = index => index < header.numRequiredSignatures;
  const isWritable = index => index < statics.length
    ? (isSigner(index)
      ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : index < statics.length - header.numReadonlyUnsignedAccounts)
    : index < statics.length + loadedWritable.length;
  return {all, statics, loadedWritable, loadedReadonly, isSigner, isWritable};
}

function summarizeInstruction(ix, index, accounts) {
  const data = Buffer.from(bs58.decode(ix.data));
  return {index, programId: accounts.all[ix.programIdIndex], programIdIndex: ix.programIdIndex,
    dataBase58: ix.data, dataHex: data.toString('hex'), dataLength: data.length,
    anchorDiscriminatorHex: data.length >= 8 ? data.subarray(0, 8).toString('hex') : null,
    accounts: ix.accounts.map(accountIndex => ({index: accountIndex,
      pubkey: accounts.all[accountIndex], isSigner: accounts.isSigner(accountIndex),
      isWritable: accounts.isWritable(accountIndex)}))};
}

function tokenDeltas(tx, accounts) {
  const pre = new Map((tx.meta?.preTokenBalances || []).map(row => [row.accountIndex, row]));
  const post = new Map((tx.meta?.postTokenBalances || []).map(row => [row.accountIndex, row]));
  const indexes = [...new Set([...pre.keys(), ...post.keys()])].sort((a, b) => a - b);
  return indexes.map(index => {
    const before = pre.get(index);
    const after = post.get(index);
    const preRaw = before?.uiTokenAmount?.amount || '0';
    const postRaw = after?.uiTokenAmount?.amount || '0';
    return {accountIndex: index, address: accounts.all[index], mint: after?.mint || before?.mint,
      owner: after?.owner || before?.owner || null, preRaw, postRaw,
      deltaRaw: (BigInt(postRaw) - BigInt(preRaw)).toString(),
      decimals: after?.uiTokenAmount?.decimals ?? before?.uiTokenAmount?.decimals ?? null};
  });
}

async function fetchAnchorIdl() {
  const base = PublicKey.findProgramAddressSync([], PROGRAM)[0];
  const idlAddress = await PublicKey.createWithSeed(base, 'anchor:idl', PROGRAM);
  const result = await rpc('getAccountInfo', [idlAddress.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  if (!result.value) return {slot: result.context.slot, idlAddress: idlAddress.toBase58(), exists: false};
  const data = accountData(result.value);
  const status = {slot: result.context.slot, idlAddress: idlAddress.toBase58(), exists: true,
    owner: result.value.owner, accountLength: data.length, dataSha256: sha256(data)};
  try {
    status.authority = pk(data.subarray(8, 40));
    status.compressedLength = data.readUInt32LE(40);
    const inflated = zlib.inflateSync(data.subarray(44, 44 + status.compressedLength));
    const idl = JSON.parse(inflated.toString('utf8'));
    status.idlName = idl.name || idl.metadata?.name || null;
    status.idlVersion = idl.version || idl.metadata?.version || null;
    status.instructionNames = (idl.instructions || []).map(ix => ix.name);
    writeJson('prime-second-onchain-idl.json', idl);
  } catch (error) {
    status.decodeError = error.message;
  }
  return status;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const addresses = [PROGRAM, VAULT, AUTHORITY, MINT, RESERVE].map(key => key.toBase58());
  const first = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const accounts = Object.fromEntries(addresses.map((address, index) =>
    [address, safeAccount(address, first.value[index])]));

  const programDataRaw = accountData(first.value[0]);
  if (first.value[0]?.owner !== UPGRADEABLE_LOADER || programDataRaw?.readUInt32LE(0) !== 2)
    throw new Error('Target is not an upgradeable-loader Program account');
  const programDataAddress = pk(programDataRaw.subarray(4, 36));
  const programDataResult = await rpc('getAccountInfo', [programDataAddress,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const programData = accountData(programDataResult.value);
  if (!programData || programData.readUInt32LE(0) !== 3) throw new Error('ProgramData unavailable');
  const hasUpgradeAuthority = programData[12] === 1;
  const elfOffset = hasUpgradeAuthority ? 45 : 13;
  const elf = programData.subarray(elfOffset);
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46')
    throw new Error(`ELF magic missing at ProgramData offset ${elfOffset}`);
  fs.writeFileSync(path.join(OUT, 'prime-second-current.so'), elf);
  const programDataSummary = {...safeAccount(programDataAddress, programDataResult.value),
    tag: programData.readUInt32LE(0), deploySlot: programData.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasUpgradeAuthority ? pk(programData.subarray(13, 45)) : null,
    elfOffset, elfLength: elf.length, elfSha256: sha256(elf),
    nonzeroElfLength: (() => {let n = elf.length; while (n > 0 && elf[n - 1] === 0) n--; return n;})()};
  programDataSummary.nonzeroElfSha256 = sha256(elf.subarray(0, programDataSummary.nonzeroElfLength));

  const reserveIdlPath = path.join(OUT, 'marginfi-source/idls-complete/kamino_lending.json');
  let reserveDecoded = null;
  if (fs.existsSync(reserveIdlPath) && first.value[4]) {
    try {
      const idl = JSON.parse(fs.readFileSync(reserveIdlPath, 'utf8'));
      const coder = new anchor.BorshAccountsCoder(idl);
      const decoded = coder.decode('Reserve', accountData(first.value[4]));
      const normalize = value => {
        if (value === null || typeof value !== 'object') return value;
        if (value instanceof PublicKey) return value.toBase58();
        if (value.constructor?.name === 'BN') return value.toString();
        if (Array.isArray(value)) return value.map(normalize);
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
      };
      const normalized = normalize(decoded);
      reserveDecoded = {lendingMarket: normalized.lending_market,
        mint: normalized.liquidity.mint_pubkey, supplyVault: normalized.liquidity.supply_vault,
        feeVault: normalized.liquidity.fee_vault,
        totalAvailableRaw: normalized.liquidity.total_available_amount,
        borrowedAmountSf: normalized.liquidity.borrowed_amount_sf,
        status: normalized.config.status, flashLoanFeeSf: normalized.config.fees.flash_loan_fee_sf};
      const related = await rpc('getMultipleAccounts', [[reserveDecoded.supplyVault, reserveDecoded.feeVault],
        {encoding: 'base64', commitment: 'confirmed'}]);
      reserveDecoded.supplyVaultAccount = safeAccount(reserveDecoded.supplyVault, related.value[0]);
      reserveDecoded.feeVaultAccount = safeAccount(reserveDecoded.feeVault, related.value[1]);
      reserveDecoded.contextSlot = related.context.slot;
    } catch (error) {
      reserveDecoded = {decodeError: error.message};
    }
  }

  const [rawTx, parsedTx, programSignatures, vaultSignatures, idlStatus] = await Promise.all([
    rpc('getTransaction', [EXIT_SIGNATURE,
      {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    rpc('getTransaction', [EXIT_SIGNATURE,
      {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1}]),
    rpcLargestArray('getSignaturesForAddress', [PROGRAM.toBase58(), {limit: 25, commitment: 'finalized'}]),
    rpcLargestArray('getSignaturesForAddress', [VAULT.toBase58(), {limit: 25, commitment: 'finalized'}]),
    fetchAnchorIdl(),
  ]);
  if (!rawTx) throw new Error('Exit transaction unavailable');
  const txAccounts = messageAccounts(rawTx);
  const instructions = rawTx.transaction.message.instructions.map((ix, index) =>
    summarizeInstruction(ix, index, txAccounts));
  const innerInstructions = (rawTx.meta?.innerInstructions || []).map(group => ({index: group.index,
    instructions: group.instructions.map((ix, innerIndex) => ({innerIndex,
      ...summarizeInstruction(ix, innerIndex, txAccounts), stackHeight: ix.stackHeight ?? null}))}));
  const exitSummary = {signature: EXIT_SIGNATURE, slot: rawTx.slot, blockTime: rawTx.blockTime,
    version: rawTx.version, err: rawTx.meta?.err || null, fee: rawTx.meta?.fee,
    computeUnitsConsumed: rawTx.meta?.computeUnitsConsumed ?? null,
    staticAccountCount: txAccounts.statics.length,
    loadedWritableCount: txAccounts.loadedWritable.length,
    loadedReadonlyCount: txAccounts.loadedReadonly.length,
    accountKeys: txAccounts.all.map((address, index) => ({index, address,
      isSigner: txAccounts.isSigner(index), isWritable: txAccounts.isWritable(index)})),
    instructions, innerInstructions, tokenDeltas: tokenDeltas(rawTx, txAccounts),
    logMessages: rawTx.meta?.logMessages || [],
    parsedInstructions: parsedTx?.transaction?.message?.instructions || [],
    parsedInnerInstructions: parsedTx?.meta?.innerInstructions || []};

  writeJson('prime-second-exit-transaction.raw.json', rawTx);
  writeJson('prime-second-exit-transaction.json', exitSummary);
  writeJson('prime-second-idl-status.json', idlStatus);
  const evidence = {generatedAt: fetchedAt,
    rpc: 'configured authenticated Solana RPC (URL redacted)',
    noTransactionsSubmitted: true, methodsUsed: ['getMultipleAccounts', 'getAccountInfo',
      'getTransaction', 'getSignaturesForAddress'],
    contextSlots: {baseAccounts: first.context.slot, programData: programDataResult.context.slot,
      reserveRelated: reserveDecoded?.contextSlot || null},
    programId: PROGRAM.toBase58(), programDataAddress, programData: programDataSummary,
    accounts, reserve: reserveDecoded, anchorIdl: idlStatus,
    exitTransaction: exitSummary,
    recentSignatures: {program: programSignatures, vault: vaultSignatures}};
  const output = writeJson('prime-second-live-evidence.json', evidence);
  process.stdout.write(`${JSON.stringify({output, observedSlot: first.context.slot,
    programDataAddress, deploySlot: programDataSummary.deploySlot,
    elfLength: programDataSummary.elfLength, elfSha256: programDataSummary.elfSha256,
    vaultAmountRaw: accounts[VAULT.toBase58()].amountRaw,
    mintSupplyRaw: accounts[MINT.toBase58()].supplyRaw,
    reserveAvailableRaw: reserveDecoded?.totalAvailableRaw || null,
    reserveFlashFeeSf: reserveDecoded?.flashLoanFeeSf || null,
    exitSlot: exitSummary.slot, exitInstructions: instructions.map(ix => ({index: ix.index,
      programId: ix.programId, discriminator: ix.anchorDiscriminatorHex,
      accountCount: ix.accounts.length})), idlStatus}, null, 2)}\n`);
}

main().catch(error => {process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;});
