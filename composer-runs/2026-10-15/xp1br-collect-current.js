#!/usr/bin/env node
'use strict';

// Read-only current-mainnet inventory for Exponent generic_standard. This
// script calls only get* RPC methods and never signs or submits a transaction.

const crypto = require('crypto');
const fs = require('fs');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const PROGRAM = new PublicKey('XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy');
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const OUT = `${DIR}/xp1br-current-inventory.json`;

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC_URL) throw new Error('Read-only RPC configuration is unavailable');

const idl = JSON.parse(fs.readFileSync(`${DIR}/xp1br-generic-standard-idl.json`, 'utf8'));
const coder = new anchor.BorshAccountsCoder(idl);
const interfaceVariants = idl.types.find((row) => row.name === 'InterfaceType')
  .type.variants.map((row) => row.name);
const sourceCensus = JSON.parse(fs.readFileSync(`${DIR}/mainnet-token-authority-census.raw.json`, 'utf8'));
const censusByMint = new Map(sourceCensus.tokenAccounts.map((row) => [row.mint, row]));
let rpcId = 0;

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
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

function json(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && value.constructor?.name === 'BN') return value.toString(10);
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]));
  return value;
}

function variantName(value) {
  if (!value || typeof value !== 'object') return null;
  const key = Object.keys(value)[0];
  return key ? key[0].toUpperCase() + key.slice(1) : null;
}

function accountHash(account) {
  return account?.data ? crypto.createHash('sha256')
    .update(Buffer.from(account.data[0], 'base64')).digest('hex') : null;
}

function tokenImage(address, account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return null;
  return {address, ownerProgram: account.owner, mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString(), dataLength: data.length,
    dataSha256: accountHash(account)};
}

function mintImage(address, account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 82) return null;
  return {address, ownerProgram: account.owner, supplyRaw: data.readBigUInt64LE(36).toString(),
    decimals: data[44], initialized: data[45] !== 0, dataLength: data.length,
    dataSha256: accountHash(account)};
}

async function getMultiple(addresses) {
  const values = new Map();
  const slots = [];
  for (let offset = 0; offset < addresses.length; offset += 100) {
    const batch = addresses.slice(offset, offset + 100);
    const result = await rpc('getMultipleAccounts', [batch,
      {encoding: 'base64', commitment: 'confirmed'}]);
    slots.push(result.context.slot);
    batch.forEach((address, index) => values.set(address, result.value[index]));
  }
  return {values, slots};
}

async function tokenAccountsByOwner(owner) {
  const rows = [];
  for (const programId of [TOKEN, TOKEN_2022]) {
    const result = await rpc('getTokenAccountsByOwner', [owner, {programId},
      {encoding: 'base64', commitment: 'confirmed'}]);
    for (const item of result.value) rows.push(tokenImage(item.pubkey, item.account));
  }
  return rows.filter(Boolean);
}

async function main() {
  const discriminator = Buffer.from(idl.accounts.find((row) => row.name === 'SyMeta').discriminator);
  const programAccounts = await rpc('getProgramAccounts', [PROGRAM.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [{memcmp: {offset: 0, bytes: bs58.encode(discriminator)}}],
  }]);
  const syMetas = programAccounts.value.map((item) => {
    const data = Buffer.from(item.account.data[0], 'base64');
    return {address: item.pubkey, lamports: item.account.lamports, dataLength: data.length,
      dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
      decoded: json(coder.decode('SyMeta', data))};
  });

  const ownedTokenRows = new Map();
  for (let offset = 0; offset < syMetas.length; offset += 4) {
    const batch = syMetas.slice(offset, offset + 4);
    const results = await Promise.all(batch.map((meta) => tokenAccountsByOwner(meta.address)));
    batch.forEach((meta, index) => ownedTokenRows.set(meta.address, results[index]));
  }

  const readAddresses = [...new Set(syMetas.flatMap((meta) => [
    meta.decoded.mint_sy, meta.decoded.token_sy_escrow, meta.decoded.yield_bearing_mint,
    ...(meta.decoded.interface_accounts || []),
    ...(ownedTokenRows.get(meta.address) || []).map((row) => row.address),
  ]).filter(Boolean))];
  const current = await getMultiple(readAddresses);

  const rows = syMetas.map((meta) => {
    const decoded = meta.decoded;
    const currentVariant = variantName(decoded.interface_type);
    const initVariant = variantName(decoded.init_interface_type);
    const yieldMint = new PublicKey(decoded.yield_bearing_mint);
    let interfaceByte = interfaceVariants.indexOf(initVariant);
    for (let candidate = 0; candidate < 256; candidate += 1) {
      const [address] = PublicKey.findProgramAddressSync(
        [Buffer.from('meta'), Buffer.from([candidate]), yieldMint.toBuffer()], PROGRAM);
      if (address.equals(new PublicKey(meta.address))) {
        interfaceByte = candidate;
        break;
      }
    }
    const [derivedMeta, metaBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('meta'), Buffer.from([interfaceByte]), yieldMint.toBuffer()], PROGRAM);
    const [derivedMintSy, mintSyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('generic_token'), Buffer.from([interfaceByte]), yieldMint.toBuffer()], PROGRAM);
    const [derivedSyEscrow, syEscrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('sy_escrow'), Buffer.from([interfaceByte]), yieldMint.toBuffer()], PROGRAM);
    const owned = ownedTokenRows.get(meta.address) || [];
    const currentOwned = owned.map((row) => tokenImage(row.address, current.values.get(row.address)))
      .filter(Boolean);
    const principalVaults = currentOwned.filter((row) =>
      row.mint === decoded.yield_bearing_mint && row.authority === meta.address);
    const mintSy = mintImage(decoded.mint_sy, current.values.get(decoded.mint_sy));
    const priceRow = censusByMint.get(decoded.yield_bearing_mint);
    const principalRaw = principalVaults.reduce((sum, vault) => sum + BigInt(vault.amountRaw), 0n);
    const price = priceRow?.usdPrice ?? null;
    const decimals = priceRow?.decimals ?? mintImage(decoded.yield_bearing_mint,
      current.values.get(decoded.yield_bearing_mint))?.decimals ?? null;
    const markedUsd = price !== null && decimals !== null
      ? Number(principalRaw) / (10 ** decimals) * price : null;
    return {
      meta: meta.address, dataLength: meta.dataLength, dataSha256: meta.dataSha256,
      currentInterface: currentVariant, initInterface: initVariant, interfaceByte,
      yieldBearingMint: decoded.yield_bearing_mint, mintSy: decoded.mint_sy,
      tokenSyEscrow: decoded.token_sy_escrow, maxSySupplyRaw: decoded.max_sy_supply,
      minMintSizeRaw: decoded.min_mint_size, minRedeemSizeRaw: decoded.min_redeem_size,
      indexWords: decoded.index, lastSlotCached: decoded.last_slot_cached,
      lastInterfaceChangeTimestamp: decoded.last_interface_change_timestamp,
      rateLimit: decoded.rate_limit, hook: decoded.hook,
      interfaceAccounts: decoded.interface_accounts, emissions: decoded.emissions,
      pdaProof: {derivedMeta: derivedMeta.toBase58(), metaBump,
        metaMatches: derivedMeta.equals(new PublicKey(meta.address)), selfAddressBump: decoded.self_address_bump,
        derivedMintSy: derivedMintSy.toBase58(), mintSyBump,
        mintSyMatches: derivedMintSy.equals(new PublicKey(decoded.mint_sy)),
        derivedSyEscrow: derivedSyEscrow.toBase58(), syEscrowBump,
        syEscrowMatches: derivedSyEscrow.equals(new PublicKey(decoded.token_sy_escrow))},
      mintSyState: mintSy, principalVaults, allTokenAccountsOwnedByMeta: currentOwned,
      principalRaw: principalRaw.toString(), symbol: priceRow?.symbol || null,
      decimals, usdPrice: price, markedUsd, priceTags: priceRow?.tags || [],
    };
  }).sort((left, right) => (right.markedUsd || 0) - (left.markedUsd || 0));

  const programResult = await rpc('getAccountInfo', [PROGRAM.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const programDataRaw = Buffer.from(programResult.value.data[0], 'base64');
  const programDataAddress = new PublicKey(programDataRaw.subarray(4, 36)).toBase58();
  const programDataResult = await rpc('getAccountInfo', [programDataAddress,
    {encoding: 'base64', commitment: 'confirmed'}]);
  const pd = Buffer.from(programDataResult.value.data[0], 'base64');
  const authorityPresent = pd[12] !== 0;
  const upgradeAuthority = authorityPresent ? new PublicKey(pd.subarray(13, 45)).toBase58() : null;
  const localBinary = fs.readFileSync(`${DIR}/xp1br-current.so`);
  const executableOffset = authorityPresent ? 45 : 13;
  const onchainBinary = pd.subarray(executableOffset);
  const localBinarySha256 = crypto.createHash('sha256').update(localBinary).digest('hex');
  const onchainBinarySha256 = crypto.createHash('sha256').update(onchainBinary).digest('hex');

  const output = {
    generatedAt: new Date().toISOString(), readOnly: true, noSubmission: true,
    programId: PROGRAM.toBase58(), programOwner: programResult.value.owner,
    programExecutable: programResult.value.executable,
    deployment: {programDataAddress, programDataOwner: programDataResult.value.owner,
      deploySlot: pd.readBigUInt64LE(4).toString(), upgradeAuthority,
      programDataBytes: pd.length, executableOffset,
      localDumpBytes: localBinary.length,
      localDumpSha256: localBinarySha256,
      onchainExecutableBytes: onchainBinary.length,
      onchainExecutableSha256: onchainBinarySha256,
      localDumpMatchesOnchain: localBinary.equals(onchainBinary),
      loaderMatchesExpected: programResult.value.owner === UPGRADEABLE_LOADER &&
        programDataResult.value.owner === UPGRADEABLE_LOADER},
    idl: {source: 'current public Exponent application bundle',
      path: 'xp1br-generic-standard-idl.json',
      sha256: crypto.createHash('sha256')
        .update(fs.readFileSync(`${DIR}/xp1br-generic-standard-idl.json`)).digest('hex')},
    observation: {syMetaProgramAccountsSlot: programAccounts.context.slot,
      accountReadSlots: current.slots,
      sourcePriceSnapshotCompletedAt: sourceCensus.completedAt},
    counts: {syMetas: rows.length,
      principalVaults: rows.reduce((sum, row) => sum + row.principalVaults.length, 0),
      tokenAccountsOwnedByMetas: rows.reduce((sum, row) =>
        sum + row.allTokenAccountsOwnedByMeta.length, 0)},
    markedPrincipalCustodyUsd: rows.reduce((sum, row) => sum + (row.markedUsd || 0), 0),
    rows,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, deployment: output.deployment,
    observation: output.observation, counts: output.counts,
    markedPrincipalCustodyUsd: output.markedPrincipalCustodyUsd,
    top: rows.slice(0, 10).map((row) => ({symbol: row.symbol, meta: row.meta,
      interface: row.currentInterface, principalRaw: row.principalRaw,
      markedUsd: row.markedUsd, pdaProof: row.pdaProof}))}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
