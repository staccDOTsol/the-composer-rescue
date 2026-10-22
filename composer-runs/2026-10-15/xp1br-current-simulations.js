#!/usr/bin/env node
'use strict';

// Read-only current-mainnet harness for the Exponent generic_standard program.
// It uses get* RPC methods and simulateTransaction(sigVerify=false) only. It
// never signs, broadcasts, or submits a transaction.

const crypto = require('crypto');
const fs = require('fs');
const anchor = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const OUT = `${DIR}/xp1br-current-simulations.json`;
const P = (value) => new PublicKey(value);
const XP = P('XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const NOOP = P('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const BULK = P('BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn');
const META = P('6XPT3FnRn3MBpBX3rAyBtd4AXBeGeCdChmTbfVPYnorN');
const MINT_SY = P('Fy7SiHCwMzNMXYgygQhpYvjSg23G8B9TfZm3mHNgy6Bu');
const SY_ESCROW = P('BMsiL6iSMkVZL9BEkt66VHCeNKxKVUiesdubsoZAXjNr');
const PRINCIPAL_VAULT = P('69aN14j61zbYfJBTNv6yGD7yeVDYWZxzZkbMw6erbVwH');
const INTERFACE = P('3aUmJDNpMHjkxunQEkHTj2chzyryKoH2uQj6YACLD174');
const GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const BANK = P('9p1TiAeTc6FSiNHhnR6BgmwRq49zywczAY4m77BbKGer');
const LIQUIDITY_VAULT = P('6BFcjj5u9knynMQGKRpa519PMmpik5WiuJRPjVfpRxzy');
const VAULT_AUTHORITY = P('7dvLbiNggv549PLB1ub8yXvYDp8TCkki7CyMaCuMgFPV');
const BULK_PRICE_ORACLE = P('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const CONTROL_MARGINFI_ACCOUNT = P('BNrRQTQxJKRFq1rQCLysKSJJjhTmJjXmeynzGgvMxSM1');
const CONTROL_AUTHORITY = P('BF8g3ghv52zXv7P4FTZuLMKdi5tQZxWFADhx6rxpLu2N');
const CONTROL_EXISTING_BANK = P('2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB');
const CONTROL_EXISTING_ORACLE = P('6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT');

const DISC = {
  start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  end: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
};

const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.HEAVY_RPC_URL || env.RPC_URL;
if (!RPC_URL) throw new Error('Read-only RPC configuration is unavailable');

const connection = new Connection(RPC_URL, 'confirmed');
const xpIdl = JSON.parse(fs.readFileSync(`${DIR}/xp1br-generic-standard-idl.json`, 'utf8'));
const marginfiIdl = JSON.parse(fs.readFileSync(
  `${DIR}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const xpCoder = new anchor.BorshAccountsCoder(xpIdl);
const marginfiCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const inventory = JSON.parse(fs.readFileSync(`${DIR}/xp1br-current-inventory.json`, 'utf8'));
const vaultCensus = JSON.parse(fs.readFileSync(`${DIR}/marginfi-vaults-current.json`, 'utf8'));
const replay = JSON.parse(fs.readFileSync(`${DIR}/marginfi-replay-refresh.json`, 'utf8'));
let rpcId = 0;

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) return {rpcError: body.error};
      return {result: body.result};
    } catch (error) {
      last = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return {transportError: last?.message || String(last)};
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function amountOptionData(discriminator, amount, value) {
  return Buffer.concat([discriminator, u64(amount), Buffer.from([1, value ? 1 : 0])]);
}

function cloneInstruction(ix) {
  return new TransactionInstruction({programId: ix.programId,
    keys: ix.keys.map((key) => ({...key})), data: Buffer.from(ix.data)});
}

function instruction(programId, keys, data) {
  return new TransactionInstruction({programId, keys, data: Buffer.from(data)});
}

function isWritableIndex(message, index) {
  const header = message.header;
  if (index < header.numRequiredSignatures)
    return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  return index < message.staticAccountKeys.length - header.numReadonlyUnsignedAccounts;
}

// web3.js 1.x cannot emit v1. Compile canonical key ordering with v0 and
// encode the Solana v1 layout used by the live runtime.
function encodeV1(instructions, payer, blockhash, options = {}) {
  const {computeLimit = 1_400_000, dataLimit = 67_108_864,
    allowOversize = false, allowOverAccounts = false} = options;
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 has no address-table lookups');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (!allowOverAccounts && (keys.length > 64 || items.length > 64))
    throw new Error(`v1 inline limit: ${keys.length} addresses, ${items.length} instructions`);
  if (keys.length > 255 || items.length > 255) throw new Error('u8 count overflow');
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map((ix) => {
    const out = Buffer.alloc(4);
    out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length;
    out.writeUInt16LE(ix.data.length, 2);
    return out;
  });
  const payloads = items.map((ix) => Buffer.concat([
    Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data),
  ]));
  const unsigned = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()),
    config,
    ...heads,
    ...payloads,
  ]);
  const wire = Buffer.concat([unsigned, Buffer.alloc(64 * v0.header.numRequiredSignatures)]);
  if (!allowOversize && wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {wire, unsigned, instructionCount: items.length,
    requiredSignatures: v0.header.numRequiredSignatures,
    accountKeys: keys.map((key, index) => ({index, address: key.toBase58(),
      signer: index < v0.header.numRequiredSignatures,
      writable: isWritableIndex(v0, index)}))};
}

async function fetchDecompiled(signature) {
  const fetched = await rpc('getTransaction', [signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]);
  if (fetched.rpcError || fetched.transportError || !fetched.result)
    throw new Error(`Unable to fetch Project0 control: ${JSON.stringify(fetched.rpcError || fetched.transportError)}`);
  const tx = VersionedTransaction.deserialize(Buffer.from(fetched.result.transaction[0], 'base64'));
  const lookups = await Promise.all(tx.message.addressTableLookups.map(async ({accountKey}) => {
    const table = await connection.getAddressLookupTable(accountKey);
    if (!table.value) throw new Error(`Missing lookup table ${accountKey}`);
    return table.value;
  }));
  return {slot: fetched.result.slot,
    provenance: 'live getTransaction',
    message: TransactionMessage.decompile(tx.message, {addressLookupTableAccounts: lookups})};
}

function loadStoredProject0Pair() {
  const artifact = JSON.parse(fs.readFileSync(`${DIR}/marginfi-flashloan-stress.json`, 'utf8'));
  const row = artifact.results.find((item) => item.name === 'project0_pair_2' &&
    !item.localError && !item.rpcError && !item.err);
  if (!row) throw new Error('Stored successful Project0 pair is unavailable');
  const wire = Buffer.from(row.wireBase64, 'base64');
  if (wire[0] !== 0x81) throw new Error('Stored control is not a Solana v1 message');
  const instructionCount = wire[40];
  const accountCount = wire[41];
  if (instructionCount !== row.instructionCount || accountCount !== row.accountKeys.length)
    throw new Error('Stored Project0 control metadata mismatch');
  let offset = 42 + accountCount * 32 + 8;
  const heads = [];
  for (let index = 0; index < instructionCount; index += 1) {
    heads.push({programIdIndex: wire[offset], accountCount: wire[offset + 1],
      dataLength: wire.readUInt16LE(offset + 2)});
    offset += 4;
  }
  const keys = row.accountKeys.map((item) => ({...item, pubkey: P(item.address)}));
  const instructions = heads.map((head) => {
    const accountIndexes = [...wire.subarray(offset, offset + head.accountCount)];
    offset += head.accountCount;
    const data = wire.subarray(offset, offset + head.dataLength);
    offset += head.dataLength;
    return instruction(keys[head.programIdIndex].pubkey,
      accountIndexes.map((index) => ({pubkey: keys[index].pubkey,
        isSigner: keys[index].signer, isWritable: keys[index].writable})), data);
  });
  return {slot: artifact.sourceControl.slot,
    provenance: 'locally preserved successful current-mainnet Project0 v1 simulation',
    wireSha256: row.wireSha256, message: {instructions}};
}

function findProject0Ix(instructions, discriminator) {
  const found = instructions.find((ix) => ix.programId.equals(PROJECT0) &&
    Buffer.from(ix.data).subarray(0, 8).equals(discriminator));
  if (!found) throw new Error(`Project0 control instruction absent: ${discriminator.toString('hex')}`);
  return cloneInstruction(found);
}

function fixedRaw(value) {
  if (!value?.value) return null;
  const bytes = Buffer.from(value.value);
  let number = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if ((bytes[15] & 0x80) !== 0) number -= 1n << 128n;
  return number.toString();
}

function decodeToken(data) {
  if (!data || data.length < 72) return null;
  return {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString()};
}

function decodeImage(address, account) {
  if (!account) return {address: address.toBase58(), exists: false};
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = account.owner instanceof PublicKey ? account.owner.toBase58() : account.owner;
  const image = {address: address.toBase58(), exists: true, owner, lamports: account.lamports,
    dataLength: data.length, dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
  try {
    if (owner === TOKEN.toBase58() && data.length === 165) image.token = decodeToken(data);
    else if (owner === TOKEN.toBase58() && data.length >= 82) image.mint = {
      supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
    else if (address.equals(BANK)) {
      const decoded = marginfiCoder.decode('Bank', data);
      image.bank = {mint: decoded.mint.toBase58(),
        totalAssetSharesI80F48Raw: fixedRaw(decoded.total_asset_shares),
        totalLiabilitySharesI80F48Raw: fixedRaw(decoded.total_liability_shares),
        assetShareValueI80F48Raw: fixedRaw(decoded.asset_share_value),
        liabilityShareValueI80F48Raw: fixedRaw(decoded.liability_share_value),
        originationFeeI80F48Raw: fixedRaw(decoded.config.interest_rate_config.protocol_origination_fee)};
    } else if (owner === XP.toBase58()) {
      try {
        const decoded = xpCoder.decode('Position', data);
        image.position = {owner: decoded.owner.toBase58(), meta: decoded.meta.toBase58(),
          amountRaw: decoded.amount.toString()};
      } catch {
        // Other generic_standard-owned accounts are retained by hash.
      }
    } else if (owner === PROJECT0.toBase58() && data.length === 2312) {
      const decoded = marginfiCoder.decode('MarginfiAccount', data);
      const balance = decoded.lending_account.balances.find((row) => row.bank_pk.equals(BANK));
      image.marginfiAccount = {authority: decoded.authority.toBase58(), flags: decoded.account_flags.toString(),
        targetBalance: balance ? {active: balance.active,
          assetSharesI80F48Raw: fixedRaw(balance.asset_shares),
          liabilitySharesI80F48Raw: fixedRaw(balance.liability_shares),
          premiumOutstandingI80F48Raw: fixedRaw(balance.premium_outstanding)} : null};
    }
  } catch (error) {
    image.decodeError = error.message;
  }
  return image;
}

function compactLogs(logs) {
  return (logs || []).filter((line) => line.includes('invoke') || line.includes('success') ||
    line.includes('failed') || line.includes('Instruction:') || line.includes('AnchorError') ||
    line.includes('Error') || line.includes('consumed'));
}

async function main() {
  const controlSignature = replay.successfulReplays.LendingAccountRepay.signature;
  let source;
  try {
    source = await fetchDecompiled(controlSignature);
  } catch (error) {
    source = loadStoredProject0Pair();
    source.liveFetchBlocker = error.message;
  }
  const startTemplate = findProject0Ix(source.message.instructions, DISC.start);
  const borrowTemplate = findProject0Ix(source.message.instructions, DISC.borrow);
  const repayTemplate = findProject0Ix(source.message.instructions, DISC.repay);
  const endTemplate = findProject0Ix(source.message.instructions, DISC.end);
  if (!borrowTemplate.keys[0].pubkey.equals(GROUP)) throw new Error('Control uses an unexpected group');
  const marginfiAccount = CONTROL_MARGINFI_ACCOUNT;
  const authority = CONTROL_AUTHORITY;
  const userBulk = spl.getAssociatedTokenAddressSync(BULK, authority);
  const userSy = spl.getAssociatedTokenAddressSync(MINT_SY, authority);

  const start = (endIndex) => {
    const ix = cloneInstruction(startTemplate);
    ix.keys[0].pubkey = marginfiAccount;
    ix.keys[1].pubkey = authority;
    ix.data = Buffer.concat([DISC.start, u64(endIndex)]);
    return ix;
  };
  const borrow = (amount, destination = userBulk, bank = BANK, vault = LIQUIDITY_VAULT) => {
    const ix = cloneInstruction(borrowTemplate);
    ix.keys = ix.keys.slice(0, 8);
    ix.keys[0].pubkey = GROUP;
    ix.keys[1].pubkey = marginfiAccount;
    ix.keys[2].pubkey = authority;
    ix.keys[3].pubkey = bank;
    ix.keys[4].pubkey = destination;
    ix.keys[5].pubkey = VAULT_AUTHORITY;
    ix.keys[6].pubkey = vault;
    ix.keys[7].pubkey = TOKEN;
    ix.keys.push(
      {pubkey: BANK, isSigner: false, isWritable: false},
      {pubkey: BULK_PRICE_ORACLE, isSigner: false, isWritable: false},
      {pubkey: INTERFACE, isSigner: false, isWritable: false},
      {pubkey: CONTROL_EXISTING_BANK, isSigner: false, isWritable: false},
      {pubkey: CONTROL_EXISTING_ORACLE, isSigner: false, isWritable: false},
    );
    ix.data = Buffer.concat([DISC.borrow, u64(amount)]);
    return ix;
  };
  const repay = (amount, sourceToken = userBulk, bank = BANK, vault = LIQUIDITY_VAULT) => {
    const ix = cloneInstruction(repayTemplate);
    ix.keys[0].pubkey = GROUP;
    ix.keys[1].pubkey = marginfiAccount;
    ix.keys[2].pubkey = authority;
    ix.keys[3].pubkey = bank;
    ix.keys[4].pubkey = sourceToken;
    ix.keys[5].pubkey = vault;
    ix.keys[6].pubkey = TOKEN;
    ix.data = amountOptionData(DISC.repay, amount, true);
    return ix;
  };
  const end = () => {
    const ix = cloneInstruction(endTemplate);
    ix.keys = ix.keys.slice(0, 3);
    ix.keys[0].pubkey = marginfiAccount;
    ix.keys[1].pubkey = GROUP;
    ix.keys[2].pubkey = authority;
    ix.keys.push(
      {pubkey: CONTROL_EXISTING_BANK, isSigner: false, isWritable: false},
      {pubkey: CONTROL_EXISTING_ORACLE, isSigner: false, isWritable: false},
    );
    return ix;
  };

  const createBulk = spl.createAssociatedTokenAccountIdempotentInstruction(
    authority, userBulk, authority, BULK, TOKEN);
  const createSy = spl.createAssociatedTokenAccountIdempotentInstruction(
    authority, userSy, authority, MINT_SY, TOKEN);
  const closeSy = spl.createCloseAccountInstruction(userSy, authority, authority, [], TOKEN);

  const xpMint = (amount, changes = {}) => instruction(XP, [
    {pubkey: changes.signer || authority, isSigner: true, isWritable: true},
    {pubkey: changes.meta || META, isSigner: false, isWritable: true},
    {pubkey: changes.mintSy || MINT_SY, isSigner: false, isWritable: true},
    {pubkey: changes.yieldMint || BULK, isSigner: false, isWritable: false},
    {pubkey: changes.source || userBulk, isSigner: false, isWritable: true},
    {pubkey: changes.vault || PRINCIPAL_VAULT, isSigner: false, isWritable: true},
    {pubkey: changes.destinationSy || userSy, isSigner: false, isWritable: true},
    {pubkey: changes.baseTokenProgram || TOKEN, isSigner: false, isWritable: false},
    {pubkey: changes.syTokenProgram || TOKEN, isSigner: false, isWritable: false},
    {pubkey: changes.interface || INTERFACE, isSigner: false, isWritable: true},
  ], Buffer.concat([Buffer.from([1]), u64(amount)]));

  const xpRedeem = (amount, changes = {}) => instruction(XP, [
    {pubkey: changes.signer || authority, isSigner: true, isWritable: true},
    {pubkey: changes.meta || META, isSigner: false, isWritable: true},
    {pubkey: changes.destination || userBulk, isSigner: false, isWritable: true},
    {pubkey: changes.vault || PRINCIPAL_VAULT, isSigner: false, isWritable: true},
    {pubkey: changes.sourceSy || userSy, isSigner: false, isWritable: true},
    {pubkey: changes.mintSy || MINT_SY, isSigner: false, isWritable: true},
    {pubkey: changes.yieldMint || BULK, isSigner: false, isWritable: false},
    {pubkey: changes.baseTokenProgram || TOKEN, isSigner: false, isWritable: false},
    {pubkey: changes.syTokenProgram || TOKEN, isSigner: false, isWritable: false},
    {pubkey: changes.interface || INTERFACE, isSigner: false, isWritable: true},
  ], Buffer.concat([Buffer.from([2]), u64(amount)]));

  const positionDisc = Buffer.from(xpIdl.accounts.find((row) => row.name === 'Position').discriminator);
  const positionsResponse = await rpc('getProgramAccounts', [XP.toBase58(), {encoding: 'base64',
    commitment: 'confirmed', withContext: true,
    filters: [{memcmp: {offset: 0, bytes: bs58.encode(positionDisc)}}]}]);
  if (positionsResponse.rpcError || positionsResponse.transportError) throw new Error('Position census failed');
  const positions = positionsResponse.result.value.map((item) => {
    const data = Buffer.from(item.account.data[0], 'base64');
    const decoded = xpCoder.decode('Position', data);
    return {address: item.pubkey, owner: decoded.owner.toBase58(), meta: decoded.meta.toBase58(),
      amountRaw: decoded.amount.toString(), ownerOnCurve: PublicKey.isOnCurve(decoded.owner.toBytes())};
  }).filter((row) => row.meta === META.toBase58())
    .sort((a, b) => BigInt(a.amountRaw) === BigInt(b.amountRaw) ? 0 :
      BigInt(a.amountRaw) > BigInt(b.amountRaw) ? -1 : 1);
  const victimPosition = positions.find((row) => BigInt(row.amountRaw) > 0n);
  if (!victimPosition) throw new Error('No funded BulkSOL position available for access-control tests');
  const positionKey = P(victimPosition.address);

  const xpDeposit = (amount, changes = {}) => instruction(XP, [
    {pubkey: changes.depositor || authority, isSigner: true, isWritable: true},
    {pubkey: changes.meta || META, isSigner: false, isWritable: true},
    {pubkey: changes.mintSy || MINT_SY, isSigner: false, isWritable: false},
    {pubkey: changes.syEscrow || SY_ESCROW, isSigner: false, isWritable: true},
    {pubkey: changes.sourceSy || userSy, isSigner: false, isWritable: true},
    {pubkey: changes.position || positionKey, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], Buffer.concat([Buffer.from([5]), u64(amount)]));

  const xpWithdraw = (amount, changes = {}) => instruction(XP, [
    {pubkey: changes.owner || authority, isSigner: true, isWritable: true},
    {pubkey: changes.meta || META, isSigner: false, isWritable: true},
    {pubkey: changes.mintSy || MINT_SY, isSigner: false, isWritable: false},
    {pubkey: changes.position || positionKey, isSigner: false, isWritable: true},
    {pubkey: changes.syEscrow || SY_ESCROW, isSigner: false, isWritable: true},
    {pubkey: changes.destinationSy || userSy, isSigner: false, isWritable: true},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], Buffer.concat([Buffer.from([6]), u64(amount)]));

  function compose(amount, legs, noOp = null) {
    const result = [createBulk, createSy, start(0), borrow(amount), ...legs, repay(amount)];
    if (noOp) result.push(noOp);
    result.push(end(), closeSy);
    const endIndex = result.findIndex((ix) => ix.programId.equals(PROJECT0) &&
      Buffer.from(ix.data).equals(DISC.end));
    result[2] = start(endIndex);
    return result;
  }

  const watched = [authority, marginfiAccount, CONTROL_EXISTING_BANK, BANK, LIQUIDITY_VAULT, META,
    PRINCIPAL_VAULT, MINT_SY, SY_ESCROW, userBulk, userSy, positionKey];
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const preAta = await connection.getMultipleAccountsInfo([userBulk, userSy], 'confirmed');
  if (!preAta[0] || preAta[1])
    throw new Error('The buffered control requires an existing BulkSOL ATA and an absent temporary SY ATA');

  async function simulateCase(name, instructions, category, expectation, options = {}) {
    let encoded;
    try {
      encoded = encodeV1(instructions, authority, blockhash, options);
    } catch (error) {
      return {name, category, expectation, localError: error.message};
    }
    const pre = await connection.getMultipleAccountsInfoAndContext(watched, 'confirmed');
    const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map((key) => key.toBase58())},
    }]);
    const value = response.result?.value;
    const preImages = watched.map((address, index) => decodeImage(address, pre.value[index]));
    const postImages = watched.map((address, index) => decodeImage(address, value?.accounts?.[index]));
    function tokenDelta(address) {
      const before = preImages.find((row) => row.address === address.toBase58())?.token?.amountRaw || '0';
      const after = postImages.find((row) => row.address === address.toBase58())?.token?.amountRaw || '0';
      return (BigInt(after) - BigInt(before)).toString();
    }
    function lamportDelta(address) {
      const beforeRow = preImages.find((row) => row.address === address.toBase58());
      const afterRow = postImages.find((row) => row.address === address.toBase58());
      if (!beforeRow?.exists || !afterRow?.exists) return null;
      const before = beforeRow.lamports;
      const after = afterRow.lamports;
      return String(BigInt(after) - BigInt(before));
    }
    const completed = !response.transportError && !response.rpcError && value && !value.err;
    return {name, category, expectation, txVersion: 1, liveSubmission: false,
      signatureVerification: false, preSlot: pre.context.slot,
      simulationSlot: response.result?.context?.slot || null,
      localError: null, transportError: response.transportError || null,
      rpcError: response.rpcError || null, err: value?.err || null,
      unitsConsumed: value?.unitsConsumed ?? null,
      loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
      sizeBytes: encoded.wire.length, unsignedMessageBytes: encoded.unsigned.length,
      addressCount: encoded.accountKeys.length, instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures, wireSha256: crypto.createHash('sha256')
        .update(encoded.wire).digest('hex'), unsignedMessageBase64: encoded.unsigned.toString('base64'),
      wireBase64: encoded.wire.toString('base64'), accountKeys: encoded.accountKeys,
      outsiderDeltas: completed ? {bulkRaw: tokenDelta(userBulk), syRaw: tokenDelta(userSy),
        lamportsIncludingSimulatedBaseFee: lamportDelta(authority),
        assumedBaseFeeLamports: '5000'} : null,
      pre: preImages, post: postImages, trace: compactLogs(value?.logs),
      logs: value?.logs || null, innerInstructions: value?.innerInstructions || null,
      returnData: value?.returnData || null};
  }

  const results = [];
  const bulkRow = inventory.rows.find((row) => row.meta === META.toBase58());
  const otherRow = inventory.rows.find((row) => row.meta !== META.toBase58() &&
    row.currentInterface === 'SplStakePool');
  const rateScale = 1_000_000_000_000n;
  const exchangeRate = BigInt(bulkRow.indexWords['0'][0]);
  const syForBulk = (amount) => BigInt(amount) * rateScale / exchangeRate;
  const boundaryAmounts = [1n, 2n, 3n, 10n, 1_000_000n];
  const liquidityInfo = await connection.getAccountInfo(LIQUIDITY_VAULT, 'confirmed');
  const liquidityRaw = liquidityInfo.data.readBigUInt64LE(64);
  boundaryAmounts.push(liquidityRaw - 1n, liquidityRaw, liquidityRaw + 1n);
  for (const amount of boundaryAmounts) {
    const mintedSy = syForBulk(amount);
    results.push(await simulateCase(`project0_xp_mint_redeem_${amount}`,
      compose(amount, [xpMint(amount), xpRedeem(mintedSy)]), 'funded-round-trip',
      'Borrow BulkSOL, mint and redeem the exact floor-rounded SY output, fully repay Project0 using the pre-existing raw-unit rounding buffer, close the temporary SY ATA, and end with no outsider gain.'));
  }

  let lower = liquidityRaw / 2n;
  let upper = liquidityRaw - 1n;
  let project0MaxSuccessfulRaw = 0n;
  while (lower <= upper) {
    const amount = (lower + upper) / 2n;
    const row = await simulateCase(`project0_xp_near_liquidity_binary_${amount}`,
      compose(amount, [xpMint(amount), xpRedeem(syForBulk(amount))]),
      'near-liquidity-binary-search',
      'Find the largest live BulkSOL borrow that can be round-tripped through XP and fully repaid with no outsider gain.');
    results.push(row);
    if (!row.localError && !row.transportError && !row.rpcError && !row.err) {
      project0MaxSuccessfulRaw = amount;
      lower = amount + 1n;
    } else {
      upper = amount - 1n;
    }
  }

  const mutationBorrow = 1_000_000n;
  const mutationSy = syForBulk(mutationBorrow);
  const substitutions = [
    ['redeem_protocol_sy_escrow_as_outsider_source', [xpMint(mutationBorrow),
      xpRedeem(mutationSy, {sourceSy: SY_ESCROW})]],
    ['redeem_project0_vault_as_principal_vault', [xpMint(mutationBorrow),
      xpRedeem(mutationSy, {vault: LIQUIDITY_VAULT})]],
    ['mint_project0_vault_as_principal_vault', [xpMint(mutationBorrow, {vault: LIQUIDITY_VAULT}),
      xpRedeem(mutationSy)]],
    ['mint_protocol_principal_as_outsider_source', [xpMint(mutationBorrow, {source: PRINCIPAL_VAULT}),
      xpRedeem(mutationSy)]],
    ['redeem_cross_meta_substitution', [xpMint(mutationBorrow), xpRedeem(mutationSy, {
      meta: P(otherRow.meta), mintSy: P(otherRow.mintSy),
      yieldMint: P(otherRow.yieldBearingMint), interface: P(otherRow.interfaceAccounts[0])})]],
    ['redeem_destination_aliases_principal_vault', [xpMint(mutationBorrow),
      xpRedeem(mutationSy, {destination: PRINCIPAL_VAULT})]],
    ['redeem_amount_exceeds_fresh_shares', [xpMint(mutationBorrow), xpRedeem(mutationSy + 1n)]],
    ['withdraw_largest_position_with_unrelated_signer', [xpMint(mutationBorrow),
      xpWithdraw(1n), xpRedeem(mutationSy)]],
    ['withdraw_zero_from_largest_position_with_unrelated_signer', [xpMint(mutationBorrow),
      xpWithdraw(0n), xpRedeem(mutationSy)]],
    ['deposit_then_unauthorized_withdraw_largest_position', [xpMint(mutationBorrow),
      xpDeposit(1n), xpWithdraw(1n), xpRedeem(mutationSy - 1n)]],
    ['deposit_one_to_foreign_position_is_gift_not_gain', [xpMint(mutationBorrow),
      xpDeposit(1n), xpRedeem(mutationSy - 1n)]],
    ['zero_deposit_inside_repaid_round_trip', [xpMint(mutationBorrow),
      xpDeposit(0n), xpRedeem(mutationSy)]],
  ];
  for (const [name, legs] of substitutions) {
    results.push(await simulateCase(name, compose(mutationBorrow, legs), 'substitution-position-edge',
      'A malformed or unauthorized case must fail atomically or finish with no outsider asset gain and no unpaid flash liability.'));
  }

  // Build a real exact 4,096-byte / 64-inline-address Solana v1 composition.
  // The no-op instruction ignores its data and read-only accounts; all value
  // movement remains the Project0-funded XP mint/redeem round trip above.
  const candidates = [...new Set([
    ...vaultCensus.rows.flatMap((row) => [row.address, row.bank, row.group, row.mint, row.authority]),
    ...inventory.rows.flatMap((row) => [row.meta, row.mintSy, row.tokenSyEscrow,
      row.yieldBearingMint, ...(row.interfaceAccounts || []),
      ...row.principalVaults.map((vault) => vault.address)]),
  ].filter(Boolean))].map(P);
  const dummyKeys = [];
  let exactInstructions;
  let exactEncoded;
  for (const candidate of candidates) {
    dummyKeys.push({pubkey: candidate, isSigner: false, isWritable: false});
    const trialNoop = instruction(NOOP, dummyKeys, Buffer.alloc(0));
    const exactAmount = 1_000_000n;
    const trial = compose(exactAmount, [xpMint(exactAmount), xpRedeem(syForBulk(exactAmount))], trialNoop);
    const encoded = encodeV1(trial, authority, blockhash, {allowOverAccounts: true});
    if (encoded.accountKeys.length === 64) {
      const padding = 4096 - encoded.wire.length;
      if (padding < 0) throw new Error(`64-address base is already ${encoded.wire.length} bytes`);
      const paddedNoop = instruction(NOOP, dummyKeys, Buffer.alloc(padding, 0x41));
      exactInstructions = compose(exactAmount,
        [xpMint(exactAmount), xpRedeem(syForBulk(exactAmount))], paddedNoop);
      exactEncoded = encodeV1(exactInstructions, authority, blockhash);
      break;
    }
    if (encoded.accountKeys.length > 64) break;
  }
  if (!exactEncoded || exactEncoded.wire.length !== 4096 || exactEncoded.accountKeys.length !== 64)
    throw new Error('Unable to construct the exact v1 runtime-boundary composition');
  results.push(await simulateCase('xp1br_project0_v1_exact_4096_bytes_64_addresses',
    exactInstructions, 'v1-runtime-boundary',
    'An exact-limit v1 composition must mint/redeem, fully repay, close temporary accounts, and leave no outsider gain.'));

  const succeeded = results.filter((row) => !row.localError && !row.transportError &&
    !row.rpcError && !row.err);
  const failed = results.filter((row) => !succeeded.includes(row));
  const positiveControl = succeeded.find((row) => row.category === 'funded-round-trip');
  const exact4096 = results.find((row) => row.name ===
    'xp1br_project0_v1_exact_4096_bytes_64_addresses');
  const successfulPositiveGain = succeeded.filter((row) =>
    BigInt(row.outsiderDeltas?.bulkRaw || 0) > 0n || BigInt(row.outsiderDeltas?.syRaw || 0) > 0n);
  const output = {
    generatedAt: new Date().toISOString(),
    safety: 'Read-only current-mainnet get* RPC and simulateTransaction only; sigVerify=false; no private key loaded; no transaction signed, sent, or broadcast.',
    targetProgram: XP.toBase58(),
    sourceControl: {project0Signature: controlSignature, slot: source.slot,
      provenance: source.provenance, wireSha256: source.wireSha256 || null,
      liveFetchBlocker: source.liveFetchBlocker || null,
      purpose: 'Successful current-mainnet start/borrow/repay/end account schema only.'},
    configuration: {authority: authority.toBase58(), marginfiAccount: marginfiAccount.toBase58(),
      group: GROUP.toBase58(), bank: BANK.toBase58(), bankMint: BULK.toBase58(),
      liquidityVault: LIQUIDITY_VAULT.toBase58(), liquidityVaultRaw: liquidityRaw.toString(),
      project0MaxSuccessfulBinarySampleRaw: project0MaxSuccessfulRaw.toString(),
      xpMeta: META.toBase58(), xpMintSy: MINT_SY.toBase58(), xpPrincipalVault: PRINCIPAL_VAULT.toBase58(),
      xpPrincipalVaultRaw: bulkRow.principalRaw, xpInternalSyEscrow: SY_ESCROW.toBase58(),
      temporaryBulkAta: userBulk.toBase58(), temporarySyAta: userSy.toBase58(),
      bulkBufferRawBeforeSimulation: decodeToken(preAta[0].data).amountRaw,
      bulkAtaExistedBeforeSimulation: true, temporarySyAtaAbsentBeforeSimulation: true,
      exchangeRateRaw: exchangeRate.toString(), exchangeRateScale: rateScale.toString()},
    positionCensus: {observationSlot: positionsResponse.result.context.slot,
      bulkPositionCount: positions.length, fundedBulkPositionCount: positions.filter((row) =>
        BigInt(row.amountRaw) > 0n).length,
      allOwnersOffCurve: positions.every((row) => !row.ownerOnCurve),
      largestPositionUsedForNegativeTest: victimPosition, rows: positions},
    criteria: {findingRequires: 'successful outsider-accessible unauthorized net asset gain after fees, debts, and shares',
      assumedBaseFeeLamportsPerOneSignature: '5000',
      flashMustEndAndRepay: true, temporarySyAccountMustClose: true,
      existingBulkBufferMustNotIncrease: true},
    summary: {cases: results.length, succeeded: succeeded.length, failed: failed.length,
      positiveControl: positiveControl ? {name: positiveControl.name, sizeBytes: positiveControl.sizeBytes,
        outsiderDeltas: positiveControl.outsiderDeltas} : null,
      exact4096: exact4096 ? {err: exact4096.err, sizeBytes: exact4096.sizeBytes,
        addressCount: exact4096.addressCount, instructionCount: exact4096.instructionCount,
        outsiderDeltas: exact4096.outsiderDeltas} : null,
      successfulCasesWithPositiveTokenGain: successfulPositiveGain.map((row) => row.name),
      validatedFindingCount: successfulPositiveGain.length},
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, generatedAt: output.generatedAt,
    positionCensus: output.positionCensus, summary: output.summary,
    outcomes: results.map((row) => ({name: row.name, err: row.err || row.rpcError || row.localError,
      sizeBytes: row.sizeBytes, addresses: row.addressCount,
      outsiderDeltas: row.outsiderDeltas, traceTail: row.trace?.slice(-4)}))}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
