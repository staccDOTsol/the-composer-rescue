#!/usr/bin/env node
// Signed, sigVerify:true local-fork JitoSOL flash -> Hylo -> full repayment harness.
// The fork lazily imports current mainnet accounts. It never submits to mainnet.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} = require(`${MODULES}@solana/web3.js`);
const spl = require(`${MODULES}@solana/spl-token`);
const bs58Module = require(`${MODULES}bs58`);
const bs58 = bs58Module.default || bs58Module;
const anchor = require(`${MODULES}@coral-xyz/anchor`);
const {encodeV1, signV1} = require('./hylo-exchange-v1-wire.js');

const ROOT = __dirname;
const OUT = process.env.HYLO_OUTPUT || `${ROOT}/hylo-exchange-signed-multisource-v1.json`;
const ENV_PATH = process.env.HYLO_RPC_ENV || '/tmp/composer-helius-rpc.env';
const KLEND_CENSUS = `${ROOT}/klend-zero-fee-census.json`;
const KLEND_HISTORY = `${ROOT}/kamino-flash-history.json`;
const MARGINFI_IDL = `${ROOT}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`;
const FORK_RPC = process.env.HYLO_FORK_RPC || ['http:', '', '127.0.0.1:9167'].join('/');
const FORK_SLOT_MS = Number(process.env.HYLO_FORK_SLOT_MS || 200);
const ACTOR_BUFFER_RAW = BigInt(process.env.HYLO_ACTOR_BUFFER_RAW || (100_000n * 1_000_000_000n));
const PROJECT0_SCOPE_SOURCE_SIGNATURE = '5LYZefMYBiD97kcEu9xQx6LdcXk4W7n5jPeDQ9KgyTi1y5Kq5Vcw6XZYa9FJ5EGTbFMorgQTix1r3epmfe4UFEPw';
const PROJECT0_LEGACY_FLASH_SOURCE_SIGNATURE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SAVE_SOURCE_SIGNATURE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const JITOSOL_PROVIDER_INVENTORY = process.env.HYLO_JITOSOL_PROVIDER_INVENTORY
  || `${ROOT}/../2026-10-19/hylo-exchange-current-jitosol-provider-inventory.json`;
const ENABLE_SAVE = process.env.HYLO_ENABLE_SAVE === '1';

const P = value => new PublicKey(value);
const HYLO = P('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const JITOSOL = P('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const SOL_USD_FEED = P('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const PROJECT0_BANK = P('Bohoc1ikHLD7xKJuzTyiTyCwzaL5N7ggJQu75A8mKYM8');
const PROJECT0_VAULT = P('38VGtXd2pDPq9FMh1z6AVjcHCoHgvWyMhdNyamDTeeks');
const PROJECT0_VAULT_AUTHORITY = P('7Ng54qf7BrCcZLqXmKA9WSR7SVRn4q6RX1YpLksBQ21A');
const PROJECT0_GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const JITOSOL_STAKE_POOL = P('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb');

const HYLO_STATE = PublicKey.findProgramAddressSync([Buffer.from('hylo')], HYLO)[0];
const HYUSD = PublicKey.findProgramAddressSync([Buffer.from('hyUSD')], HYLO)[0];
const XSOL = PublicKey.findProgramAddressSync([Buffer.from('xSOL')], HYLO)[0];
const FEE_AUTH = PublicKey.findProgramAddressSync([Buffer.from('fee_auth'), JITOSOL.toBuffer()], HYLO)[0];
const VAULT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('vault_auth'), JITOSOL.toBuffer()], HYLO)[0];
const LEVER_AUTH = PublicKey.findProgramAddressSync([Buffer.from('mint_auth'), XSOL.toBuffer()], HYLO)[0];
const LST_HEADER = PublicKey.findProgramAddressSync([Buffer.from('lst_header'), JITOSOL.toBuffer()], HYLO)[0];
const EVENT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], HYLO)[0];
const FEE_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, FEE_AUTH, true);
const LST_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, VAULT_AUTH, true);

const DISC = {
  project0Start: Buffer.from('0e8321dc51bab46b', 'hex'),
  project0Borrow: Buffer.from('047e74353005d41f', 'hex'),
  project0Repay: Buffer.from('4fd1acb1de33ad97', 'hex'),
  project0End: Buffer.from('697cc96a9902089c', 'hex'),
  project0Init: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]),
  mintLever: Buffer.from([184, 75, 99, 100, 153, 64, 243, 68]),
  redeemLever: Buffer.from([34, 147, 66, 197, 160, 82, 147, 202]),
};

const bankCoder = new anchor.BorshAccountsCoder(JSON.parse(fs.readFileSync(MARGINFI_IDL, 'utf8')));
let rpcId = 0;
const preloadedAddresses = new Set();

function readEnv(path) {
  const out = {};
  for (const rawLine of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!rawLine || rawLine.trimStart().startsWith('#')) continue;
    const raw = rawLine.replace(/^\s*export\s+/, '');
    const index = raw.indexOf('=');
    if (index > 0) out[raw.slice(0, index).trim()] = raw.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = readEnv(ENV_PATH);
const upstreamRpc = env.SOLANA_RPC || env.SOLANA_RPC_URL || env.RPC || env.RPC_URL
  || env.HEAVY_RPC_URL || env.FLUX_RPC_A || env.FLUX_RPC_B;
if (!upstreamRpc) throw new Error('No configured Solana RPC endpoint is available');

async function rpc(url, method, params) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
      });
      const body = await response.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (String(error.message || error).startsWith(`${method}:`)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`${method}: transport failed after retries: ${lastError?.message || lastError}`);
}

async function alignForkClockToImportedOracle() {
  const oracle = await rpc(FORK_RPC, 'getAccountInfo', [SOL_USD_FEED.toBase58(), {
    encoding: 'base64',
    commitment: 'processed',
  }]);
  const oracleData = Buffer.from(oracle.value.data[0], 'base64');
  const verificationVariant = oracleData[40];
  const verificationLength = verificationVariant === 0 ? 2 : 1;
  const priceMessageOffset = 40 + verificationLength;
  const publishTimeOffset = priceMessageOffset + 32 + 8 + 8 + 4;
  const postedSlotOffset = priceMessageOffset + 84;
  const publishTime = Number(oracleData.readBigInt64LE(publishTimeOffset));
  const postedSlot = Number(oracleData.readBigUInt64LE(postedSlotOffset));
  const beforeSlot = await rpc(FORK_RPC, 'getSlot', [{commitment: 'processed'}]);
  let timeTravelResult = null;
  if (postedSlot >= beforeSlot) {
    const blockTimeSeconds = await rpc(FORK_RPC, 'getBlockTime', [beforeSlot]);
    const slotsToAdvance = postedSlot - beforeSlot + 1;
    const targetTimestampMs = (blockTimeSeconds * 1000) + (slotsToAdvance * FORK_SLOT_MS);
    timeTravelResult = await rpc(FORK_RPC, 'surfnet_timeTravel', [{
      absoluteTimestamp: targetTimestampMs,
    }]);
  }
  const afterSlot = await rpc(FORK_RPC, 'getSlot', [{commitment: 'processed'}]);
  if (afterSlot <= postedSlot) {
    throw new Error(`Fork Clock alignment failed: clock ${afterSlot}, oracle ${postedSlot}`);
  }
  return {
    oraclePostedSlot: postedSlot,
    oraclePublishTime: publishTime,
    oracleVerificationVariant: verificationVariant,
    beforeSlot,
    afterSlot,
    advanced: timeTravelResult !== null,
    protocolOrOracleAccountsModified: false,
  };
}

function cloneIx(instruction) {
  return new TransactionInstruction({
    programId: instruction.programId,
    keys: instruction.keys.map(key => ({...key})),
    data: Buffer.from(instruction.data),
  });
}

function u64(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
}

function optionlessAmountData(discriminator, amount) {
  return Buffer.concat([discriminator, u64(amount), Buffer.from([0])]);
}

function mintLeverIx(user, userJito, userXsol, amount) {
  return new TransactionInstruction({
    programId: HYLO,
    keys: [
      {pubkey: user, isSigner: true, isWritable: true},
      {pubkey: HYLO_STATE, isSigner: false, isWritable: true},
      {pubkey: FEE_AUTH, isSigner: false, isWritable: false},
      {pubkey: VAULT_AUTH, isSigner: false, isWritable: false},
      {pubkey: LEVER_AUTH, isSigner: false, isWritable: false},
      {pubkey: FEE_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_HEADER, isSigner: false, isWritable: false},
      {pubkey: userJito, isSigner: false, isWritable: true},
      {pubkey: userXsol, isSigner: false, isWritable: true},
      {pubkey: JITOSOL, isSigner: false, isWritable: false},
      {pubkey: XSOL, isSigner: false, isWritable: true},
      {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
      {pubkey: TOKEN, isSigner: false, isWritable: false},
      {pubkey: EVENT_AUTH, isSigner: false, isWritable: false},
      {pubkey: HYLO, isSigner: false, isWritable: false},
    ],
    data: optionlessAmountData(DISC.mintLever, amount),
  });
}

function redeemLeverIx(user, userJito, userXsol, amount) {
  return new TransactionInstruction({
    programId: HYLO,
    keys: [
      {pubkey: user, isSigner: true, isWritable: true},
      {pubkey: HYLO_STATE, isSigner: false, isWritable: true},
      {pubkey: FEE_AUTH, isSigner: false, isWritable: false},
      {pubkey: VAULT_AUTH, isSigner: false, isWritable: false},
      {pubkey: FEE_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_HEADER, isSigner: false, isWritable: false},
      {pubkey: userXsol, isSigner: false, isWritable: true},
      {pubkey: userJito, isSigner: false, isWritable: true},
      {pubkey: XSOL, isSigner: false, isWritable: true},
      {pubkey: JITOSOL, isSigner: false, isWritable: false},
      {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
      {pubkey: TOKEN, isSigner: false, isWritable: false},
      {pubkey: EVENT_AUTH, isSigner: false, isWritable: false},
      {pubkey: HYLO, isSigner: false, isWritable: false},
    ],
    data: optionlessAmountData(DISC.redeemLever, amount),
  });
}

function fromRawTransaction(transaction, instructionIndex) {
  const message = transaction.transaction.message;
  const staticKeys = message.accountKeys;
  const loaded = transaction.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const header = message.header;
  const writable = index => index < staticKeys.length
    ? (index < header.numRequiredSignatures
      ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : index < staticKeys.length - header.numReadonlyUnsignedAccounts)
    : index < staticKeys.length + loaded.writable.length;
  const source = message.instructions[instructionIndex];
  return new TransactionInstruction({
    programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map(index => ({
      pubkey: P(allKeys[index]),
      isSigner: index < header.numRequiredSignatures,
      isWritable: writable(index),
    })),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

async function project0Templates() {
  const scopeTransaction = await rpc(upstreamRpc, 'getTransaction', [PROJECT0_SCOPE_SOURCE_SIGNATURE, {
    encoding: 'json',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  }]);
  const borrowTransaction = await rpc(upstreamRpc, 'getTransaction', [PROJECT0_LEGACY_FLASH_SOURCE_SIGNATURE, {
    encoding: 'json',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  }]);
  if (!scopeTransaction || !borrowTransaction) throw new Error('Project 0 source transaction unavailable');
  const scopeInstructions = scopeTransaction.transaction.message.instructions
    .map((_, index) => fromRawTransaction(scopeTransaction, index))
    .filter(instruction => instruction.programId.equals(PROJECT0));
  const borrowInstructions = borrowTransaction.transaction.message.instructions
    .map((_, index) => fromRawTransaction(borrowTransaction, index))
    .filter(instruction => instruction.programId.equals(PROJECT0));
  const templates = {
    start: scopeInstructions.find(instruction => instruction.data.subarray(0, 8).equals(DISC.project0Start)),
    borrow: borrowInstructions.find(instruction => instruction.data.subarray(0, 8).equals(DISC.project0Borrow)),
    repay: scopeInstructions.find(instruction => instruction.data.subarray(0, 8).equals(DISC.project0Repay)),
    end: scopeInstructions.find(instruction => instruction.data.subarray(0, 8).equals(DISC.project0End)),
  };
  if (Object.values(templates).some(value => !value)) throw new Error('Incomplete Project 0 JitoSOL template quartet');
  if (templates.borrow.keys.length < 8) throw new Error('Project 0 legacy borrow template is incomplete');
  return {scopeSlot: scopeTransaction.slot, borrowSlot: borrowTransaction.slot, ...templates};
}

async function saveTemplates() {
  const transaction = await rpc(upstreamRpc, 'getTransaction', [SAVE_SOURCE_SIGNATURE, {
    encoding: 'json',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 1,
  }]);
  if (!transaction) throw new Error('Save source transaction unavailable');
  const borrow = fromRawTransaction(transaction, 6);
  const repay = fromRawTransaction(transaction, 12);
  if (!borrow.programId.equals(SAVE) || !repay.programId.equals(SAVE)
      || borrow.keys.length < 7 || repay.keys.length < 9) {
    throw new Error('Historical Save template mismatch');
  }
  return {sourceSlot: transaction.slot, borrow, repay};
}

function project0InitIx(authority, marginfiAccount) {
  return new TransactionInstruction({
    programId: PROJECT0,
    keys: [
      {pubkey: PROJECT0_GROUP, isSigner: false, isWritable: false},
      {pubkey: marginfiAccount, isSigner: true, isWritable: true},
      {pubkey: authority, isSigner: true, isWritable: false},
      {pubkey: authority, isSigner: true, isWritable: true},
      {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    ],
    data: DISC.project0Init,
  });
}

function project0Set(templates, authority, marginfiAccount, userJito, amount) {
  const start = cloneIx(templates.start);
  const borrow = cloneIx(templates.borrow);
  const repay = cloneIx(templates.repay);
  const end = cloneIx(templates.end);
  start.keys[0].pubkey = marginfiAccount;
  start.keys[1].pubkey = authority;
  borrow.keys = borrow.keys.slice(0, 8);
  borrow.keys[0].pubkey = PROJECT0_GROUP;
  borrow.keys[1].pubkey = marginfiAccount;
  borrow.keys[2].pubkey = authority;
  borrow.keys[3].pubkey = PROJECT0_BANK;
  borrow.keys[4].pubkey = userJito;
  borrow.keys[5].pubkey = PROJECT0_VAULT_AUTHORITY;
  borrow.keys[6].pubkey = PROJECT0_VAULT;
  borrow.keys[7].pubkey = TOKEN;
  borrow.keys.push(
    {pubkey: PROJECT0_BANK, isSigner: false, isWritable: true},
    {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
    {pubkey: JITOSOL_STAKE_POOL, isSigner: false, isWritable: false},
  );
  borrow.data.writeBigUInt64LE(amount, 8);
  repay.keys[1].pubkey = marginfiAccount;
  repay.keys[2].pubkey = authority;
  repay.keys[4].pubkey = userJito;
  repay.data.writeBigUInt64LE(amount, 8);
  end.keys[0].pubkey = marginfiAccount;
  end.keys[2].pubkey = authority;
  return {start, borrow, repay, end};
}

function klendTemplate(instructionIndex) {
  const source = JSON.parse(fs.readFileSync(KLEND_HISTORY, 'utf8')).hits[0].transaction;
  return fromRawTransaction(source, instructionIndex);
}

function klendFlashIx(template, reserve, authority, userJito, amount, repayIndex) {
  const keys = template.keys.map(key => ({...key}));
  const market = P(reserve.market);
  const lendingMarketAuthority = PublicKey.findProgramAddressSync([
    Buffer.from('lma'),
    market.toBuffer(),
  ], KLEND)[0];
  const replacements = {
    0: authority,
    1: lendingMarketAuthority,
    2: market,
    3: P(reserve.reserve),
    4: JITOSOL,
    5: P(reserve.supplyVault),
    6: userJito,
    7: P(reserve.feeVault),
    11: TOKEN,
  };
  for (const [index, pubkey] of Object.entries(replacements)) keys[Number(index)].pubkey = pubkey;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function saveFlashPair(templates, reserve, authority, userJito, amount) {
  const borrow = cloneIx(templates.borrow);
  const repay = cloneIx(templates.repay);
  const market = P(reserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync([market.toBuffer()], SAVE)[0];
  const borrowReplacements = {
    0: P(reserve.supplyVault),
    1: userJito,
    2: P(reserve.reserve),
    3: market,
    4: marketAuthority,
    5: IX_SYSVAR,
    6: TOKEN,
  };
  const repayReplacements = {
    0: userJito,
    1: P(reserve.supplyVault),
    2: P(reserve.feeReceiver),
    3: userJito,
    4: P(reserve.reserve),
    5: market,
    6: authority,
    7: IX_SYSVAR,
    8: TOKEN,
  };
  for (const [index, pubkey] of Object.entries(borrowReplacements)) {
    borrow.keys[Number(index)].pubkey = pubkey;
  }
  for (const [index, pubkey] of Object.entries(repayReplacements)) {
    repay.keys[Number(index)].pubkey = pubkey;
  }
  borrow.data.writeBigUInt64LE(amount, 1);
  repay.data.writeBigUInt64LE(amount, 1);
  return {borrow, repay};
}

function tokenAccountData(mint, authority, amount) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

async function setForkAccount(address, account) {
  await rpc(FORK_RPC, 'surfnet_setAccount', [address.toBase58(), account]);
  preloadedAddresses.add(address.toBase58());
}

async function createActor(jitoBufferRaw = ACTOR_BUFFER_RAW) {
  const authority = Keypair.generate();
  const marginfiAccount = Keypair.generate();
  const userJito = spl.getAssociatedTokenAddressSync(JITOSOL, authority.publicKey);
  const userXsol = spl.getAssociatedTokenAddressSync(XSOL, authority.publicKey);
  const userHyusd = spl.getAssociatedTokenAddressSync(HYUSD, authority.publicKey);
  await setForkAccount(authority.publicKey, {
    data: '',
    executable: false,
    lamports: 20_000_000_000,
    owner: SystemProgram.programId.toBase58(),
    rentEpoch: 0,
  });
  for (const [address, mint, amount] of [
    [userJito, JITOSOL, jitoBufferRaw],
    [userXsol, XSOL, 0n],
    [userHyusd, HYUSD, 0n],
  ]) {
    await setForkAccount(address, {
      data: tokenAccountData(mint, authority.publicKey, amount).toString('hex'),
      executable: false,
      lamports: 2_039_280,
      owner: TOKEN.toBase58(),
      rentEpoch: 0,
    });
  }
  // This account intentionally does not exist until the signed initialize
  // instruction runs, so there is nothing to import from upstream.
  preloadedAddresses.add(marginfiAccount.publicKey.toBase58());
  return {authority, marginfiAccount, userJito, userXsol, userHyusd, jitoBufferRaw};
}

function tokenAmount(account) {
  if (!account?.data || account.owner !== TOKEN.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64) : null;
}

function mintSupply(account) {
  if (!account?.data || account.owner !== TOKEN.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length === 82 ? data.readBigUInt64LE(36) : null;
}

function accountImage(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const amount = tokenAmount(account);
  const supply = mintSupply(account);
  return {
    owner: account.owner,
    lamports: account.lamports,
    dataLength: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    tokenAmountRaw: amount === null ? null : amount.toString(),
    mintSupplyRaw: supply === null ? null : supply.toString(),
  };
}

function fixedRawBigInt(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return value;
}

function fixedRaw(wrapped) {
  return fixedRawBigInt(wrapped).toString();
}

function bankImage(account) {
  if (!account?.data) return null;
  const bank = bankCoder.decode('Bank', Buffer.from(account.data[0], 'base64'));
  return {
    mint: bank.mint.toBase58(),
    totalAssetSharesRaw: fixedRaw(bank.total_asset_shares),
    totalLiabilitySharesRaw: fixedRaw(bank.total_liability_shares),
    assetShareValueRaw: fixedRaw(bank.asset_share_value),
    liabilityShareValueRaw: fixedRaw(bank.liability_share_value),
    groupFeesOutstandingRaw: fixedRaw(bank.collected_group_fees_outstanding),
    programFeesOutstandingRaw: fixedRaw(bank.collected_program_fees_outstanding),
  };
}

function bankLiquidityHeadroomRawFloor(account) {
  const bank = bankCoder.decode('Bank', Buffer.from(account.data[0], 'base64'));
  const scale = 1n << 48n;
  const assetsFixed = fixedRawBigInt(bank.total_asset_shares)
    * fixedRawBigInt(bank.asset_share_value) / scale;
  const liabilitiesFixed = fixedRawBigInt(bank.total_liability_shares)
    * fixedRawBigInt(bank.liability_share_value) / scale;
  return (assetsFixed - liabilitiesFixed) / scale;
}

function marginfiAccountImage(account) {
  if (!account?.data) return null;
  try {
    const decoded = bankCoder.decode('MarginfiAccount', Buffer.from(account.data[0], 'base64'));
    return {
      authority: decoded.authority.toBase58(),
      group: decoded.group.toBase58(),
      activeBalances: decoded.lending_account.balances
        .filter(balance => balance.active)
        .map(balance => ({
          bank: balance.bank_pk.toBase58(),
          assetShares: balance.asset_shares.value,
          liabilityShares: balance.liability_shares.value,
        })),
    };
  } catch (error) {
    return {decodeError: String(error)};
  }
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const address = row.pubkey.toBase58();
    if (seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}

async function preload(instructions, watched) {
  const addresses = uniqueRows([
    ...instructions.flatMap(instruction => [
      {pubkey: instruction.programId},
      ...instruction.keys.map(key => ({pubkey: key.pubkey})),
    ]),
    ...watched,
  ]);
  const pending = addresses.filter(row => !preloadedAddresses.has(row.pubkey.toBase58()));
  for (let offset = 0; offset < pending.length; offset += 12) {
    const batch = pending.slice(offset, offset + 12);
    await Promise.all(batch.map(row => rpc(FORK_RPC, 'getAccountInfo', [row.pubkey.toBase58(), {
      encoding: 'base64',
      commitment: 'processed',
    }])));
    for (const row of batch) preloadedAddresses.add(row.pubkey.toBase58());
  }
}

function baseWatched(actor, reserves, saveLoan = null) {
  return uniqueRows([
    {label: 'attacker', pubkey: actor.authority.publicKey},
    {label: 'marginfiAccount', pubkey: actor.marginfiAccount.publicKey},
    {label: 'attackerJitosol', pubkey: actor.userJito},
    {label: 'attackerXsol', pubkey: actor.userXsol},
    {label: 'attackerHyusd', pubkey: actor.userHyusd},
    {label: 'project0LiquidityVault', pubkey: PROJECT0_VAULT},
    {label: 'project0Bank', pubkey: PROJECT0_BANK},
    {label: 'hyloJitosolVault', pubkey: LST_VAULT},
    {label: 'hyloJitosolFeeVault', pubkey: FEE_VAULT},
    {label: 'hyloState', pubkey: HYLO_STATE},
    {label: 'xsolMint', pubkey: XSOL},
    ...reserves.flatMap((reserve, index) => [
      {label: `klend${index}SupplyVault`, pubkey: P(reserve.supplyVault)},
      {label: `klend${index}FeeVault`, pubkey: P(reserve.feeVault)},
      {label: `klend${index}Reserve`, pubkey: P(reserve.reserve)},
    ]),
    ...(saveLoan ? [
      {label: 'saveSupplyVault', pubkey: P(saveLoan.reserve.supplyVault)},
      {label: 'saveFeeReceiver', pubkey: P(saveLoan.reserve.feeReceiver)},
      {label: 'saveReserve', pubkey: P(saveLoan.reserve.reserve)},
    ] : []),
  ]);
}

async function getMultiple(rows) {
  return rpc(FORK_RPC, 'getMultipleAccounts', [
    rows.map(row => row.pubkey.toBase58()),
    {encoding: 'base64', commitment: 'processed'},
  ]);
}

function snapshots(rows, accounts) {
  return Object.fromEntries(rows.map((row, index) => [row.label, accountImage(accounts[index])]));
}

function deltas(before, after) {
  const out = {};
  for (const label of Object.keys(before)) {
    const a = before[label];
    const b = after[label];
    const aValue = a?.tokenAmountRaw ?? a?.mintSupplyRaw;
    const bValue = b?.tokenAmountRaw ?? b?.mintSupplyRaw;
    out[label] = aValue !== null && aValue !== undefined && bValue !== null && bValue !== undefined
      ? (BigInt(bValue) - BigInt(aValue)).toString()
      : (!a && !b) || (a && b && a.sha256 === b.sha256 && a.lamports === b.lamports)
        ? 'unchanged'
        : 'changed';
  }
  return out;
}

function assemble({actor, templates, saveTemplates: saveTemplateSet,
  klendBorrowTemplate, klendRepayTemplate, project0Amount = 0n,
  klendLoans = [], saveLoan = null, hyloAmount = null, redeemXsol = null}) {
  const instructions = [];
  let p0 = null;
  let save = null;
  if (project0Amount > 0n) {
    p0 = project0Set(templates, actor.authority.publicKey, actor.marginfiAccount.publicKey,
      actor.userJito, project0Amount);
    instructions.push(project0InitIx(actor.authority.publicKey, actor.marginfiAccount.publicKey));
    instructions.push(p0.start, p0.borrow);
  }
  if (saveLoan) {
    if (!saveTemplateSet) throw new Error('Save loan requested without templates');
    save = saveFlashPair(saveTemplateSet, saveLoan.reserve, actor.authority.publicKey,
      actor.userJito, saveLoan.amount);
    instructions.push(save.borrow);
  }
  const klendBorrowRows = [];
  for (const loan of klendLoans) {
    const instruction = klendFlashIx(klendBorrowTemplate, loan.reserve,
      actor.authority.publicKey, actor.userJito, loan.amount);
    klendBorrowRows.push({loan, instruction});
    instructions.push(instruction);
  }
  if (hyloAmount !== null) {
    instructions.push(mintLeverIx(actor.authority.publicKey, actor.userJito, actor.userXsol, hyloAmount));
  }
  if (redeemXsol !== null) {
    instructions.push(redeemLeverIx(actor.authority.publicKey, actor.userJito, actor.userXsol, redeemXsol));
  }
  if (p0) instructions.push(p0.repay);
  for (const row of klendBorrowRows) {
    const borrowIndex = instructions.indexOf(row.instruction);
    instructions.push(klendFlashIx(klendRepayTemplate, row.loan.reserve,
      actor.authority.publicKey, actor.userJito, row.loan.amount, borrowIndex));
  }
  if (save) {
    const borrowIndex = instructions.indexOf(save.borrow);
    instructions.push(save.repay);
    save.repay.data[9] = borrowIndex;
  }
  if (p0) {
    instructions.push(p0.end);
    p0.start.data.writeBigUInt64LE(BigInt(instructions.indexOf(p0.end)), 8);
  }
  return instructions;
}

async function simulateCase(label, actor, instructions, reserves, extra = {}, saveLoan = null) {
  const watched = baseWatched(actor, reserves, saveLoan);
  await preload(instructions, watched);
  const beforeRaw = await getMultiple(watched);
  const blockhash = (await rpc(FORK_RPC, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  let encoded;
  try {
    encoded = encodeV1(instructions, actor.authority.publicKey, blockhash);
  } catch (error) {
    const result = {label, localCompositionError: error.message, ...extra};
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  const signed = signV1(encoded, instructions, actor.authority.publicKey, blockhash,
    [actor.authority, actor.marginfiAccount]);
  const simulation = await rpc(FORK_RPC, 'simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64',
    sigVerify: true,
    replaceRecentBlockhash: false,
    commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(row => row.pubkey.toBase58())},
  }]);
  const before = snapshots(watched, beforeRaw.value);
  const postAccounts = simulation.value.accounts || [];
  const after = snapshots(watched, postAccounts);
  const result = {
    label,
    forkBaselineSlot: beforeRaw.context.slot,
    simulationSlot: simulation.context.slot,
    err: simulation.value.err,
    sigVerify: true,
    signerOrder: signed.signerOrder,
    wire: {
      version: 1,
      sizeBytes: encoded.sizeBytes,
      maximumBytes: 4096,
      addressCount: encoded.addressCount,
      maximumAddresses: 64,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      sha256: crypto.createHash('sha256').update(signed.wire).digest('hex'),
    },
    unitsConsumed: simulation.value.unitsConsumed,
    loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
    before,
    after,
    deltas: simulation.value.err === null ? deltas(before, after) : null,
    marginfiAccountAfter: marginfiAccountImage(postAccounts[1]),
    project0BankBefore: bankImage(beforeRaw.value[6]),
    project0BankAfter: bankImage(postAccounts[6]),
    logs: simulation.value.logs,
    ...extra,
  };
  process.stdout.write(`${JSON.stringify({
    label,
    err: result.err,
    bytes: result.wire.sizeBytes,
    addresses: result.wire.addressCount,
    instructions: result.wire.instructionCount,
    units: result.unitsConsumed,
    deltas: result.deltas && {
      attackerJitosol: result.deltas.attackerJitosol,
      attackerXsol: result.deltas.attackerXsol,
      project0LiquidityVault: result.deltas.project0LiquidityVault,
      saveSupplyVault: result.deltas.saveSupplyVault,
      saveFeeReceiver: result.deltas.saveFeeReceiver,
      hyloJitosolVault: result.deltas.hyloJitosolVault,
      hyloJitosolFeeVault: result.deltas.hyloJitosolFeeVault,
    },
    tail: result.logs?.slice(-4),
  })}\n`);
  return result;
}

async function readCurrentInventory(reserves) {
  const addresses = [PROJECT0_VAULT, PROJECT0_BANK,
    ...reserves.flatMap(reserve => [P(reserve.reserve), P(reserve.supplyVault)])];
  await Promise.all(addresses.map(address => rpc(FORK_RPC, 'getAccountInfo', [
    address.toBase58(),
    {encoding: 'base64', commitment: 'processed'},
  ])));
  for (const address of addresses) preloadedAddresses.add(address.toBase58());
  const page = await rpc(FORK_RPC, 'getMultipleAccounts', [
    addresses.map(String),
    {encoding: 'base64', commitment: 'processed'},
  ]);
  const project0VaultRaw = tokenAmount(page.value[0]);
  const project0HeadroomRawFloor = bankLiquidityHeadroomRawFloor(page.value[1]);
  const currentReserves = reserves.map((reserve, index) => {
    const reserveAccount = page.value[2 + index * 2];
    const supplyAccount = page.value[3 + index * 2];
    const data = Buffer.from(reserveAccount.data[0], 'base64');
    return {
      ...reserve,
      currentAvailableRaw: data.readBigUInt64LE(224).toString(),
      currentFlashFeeSf: data.readBigUInt64LE(4904).toString(),
      currentSupplyVaultRaw: tokenAmount(supplyAccount).toString(),
    };
  });
  return {
    slot: page.context.slot,
    project0VaultRaw: project0VaultRaw.toString(),
    project0LiquidityHeadroomRawFloor: project0HeadroomRawFloor.toString(),
    reserves: currentReserves,
  };
}

async function readCurrentSave(candidate) {
  const addresses = [P(candidate.reserve), P(candidate.supplyVault), P(candidate.feeReceiver)];
  await Promise.all(addresses.map(address => rpc(FORK_RPC, 'getAccountInfo', [
    address.toBase58(), {encoding: 'base64', commitment: 'processed'},
  ])));
  for (const address of addresses) preloadedAddresses.add(address.toBase58());
  const page = await rpc(FORK_RPC, 'getMultipleAccounts', [
    addresses.map(String), {encoding: 'base64', commitment: 'processed'},
  ]);
  const reserveData = Buffer.from(page.value[0].data[0], 'base64');
  if (reserveData.length !== 619) throw new Error('Unexpected Save reserve layout');
  const available = reserveData.readBigUInt64LE(171);
  const supply = tokenAmount(page.value[1]);
  if (supply === null) throw new Error('Save supply vault is not a classic SPL token account');
  const capacity = available < supply ? available : supply;
  return {
    ...candidate,
    slot: page.context.slot,
    lastUpdateSlot: reserveData.readBigUInt64LE(1).toString(),
    stale: reserveData[9] !== 0,
    currentAvailableRaw: available.toString(),
    currentSupplyVaultRaw: supply.toString(),
    currentFeeReceiverRaw: tokenAmount(page.value[2])?.toString() || null,
    currentFlashLoanFeeWad: reserveData.readBigUInt64LE(314).toString(),
    currentBorrowableUpperBoundRaw: capacity.toString(),
  };
}

function isSuccess(result) {
  return result && !result.localCompositionError && result.err === null;
}

async function quoteAndRoundTrip(label, actor, assemblyArgs, reserves, results) {
  const total = BigInt(assemblyArgs.project0Amount || 0n)
    + (assemblyArgs.klendLoans || []).reduce((sum, loan) => sum + loan.amount, 0n)
    + BigInt(assemblyArgs.saveLoan?.amount || 0n);
  const quoteInstructions = assemble({...assemblyArgs, actor, hyloAmount: total, redeemXsol: null});
  const providerAmountsRaw = {
    project0: BigInt(assemblyArgs.project0Amount || 0n).toString(),
    klend: (assemblyArgs.klendLoans || []).map(loan => ({
      reserve: loan.reserve.reserve,
      amountRaw: loan.amount.toString(),
    })),
    save: assemblyArgs.saveLoan ? {
      reserve: assemblyArgs.saveLoan.reserve.reserve,
      amountRaw: assemblyArgs.saveLoan.amount.toString(),
    } : null,
  };
  const quote = await simulateCase(`${label}_quote`, actor, quoteInstructions, reserves, {
    phase: 'quote',
    totalFlashJitosolRaw: total.toString(),
    providerAmountsRaw,
  }, assemblyArgs.saveLoan || null);
  results.push(quote);
  if (!isSuccess(quote)) return {quote, roundTrip: null};
  const mintedXsolRaw = BigInt(quote.deltas.attackerXsol);
  const fullInstructions = assemble({...assemblyArgs, actor, hyloAmount: total, redeemXsol: mintedXsolRaw});
  const roundTrip = await simulateCase(`${label}_roundtrip`, actor, fullInstructions, reserves, {
    phase: 'roundtrip',
    totalFlashJitosolRaw: total.toString(),
    redeemXsolRaw: mintedXsolRaw.toString(),
    providerAmountsRaw,
  }, assemblyArgs.saveLoan || null);
  results.push(roundTrip);
  return {quote, roundTrip};
}

async function main() {
  const health = await rpc(FORK_RPC, 'getHealth', []);
  if (health !== 'ok') throw new Error(`Local fork is not healthy: ${health}`);
  const genesisHash = await rpc(FORK_RPC, 'getGenesisHash', []);
  if (genesisHash !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') {
    throw new Error('Local fork is not backed by Solana mainnet-beta');
  }
  const templates = await project0Templates();
  const saveTemplateSet = ENABLE_SAVE ? await saveTemplates() : null;
  const klendBorrowTemplate = klendTemplate(3);
  const klendRepayTemplate = klendTemplate(13);
  const retainedReserves = JSON.parse(fs.readFileSync(KLEND_CENSUS, 'utf8')).activeZero
    .filter(reserve => reserve.mint === JITOSOL.toBase58());
  const inventory = await readCurrentInventory(retainedReserves);
  const reserves = inventory.reserves.filter(reserve => reserve.currentFlashFeeSf === '0');
  reserves.sort((a, b) => BigInt(a.currentAvailableRaw) > BigInt(b.currentAvailableRaw) ? -1 : 1);
  let saveCurrent = null;
  if (ENABLE_SAVE) {
    const providerInventory = JSON.parse(fs.readFileSync(JITOSOL_PROVIDER_INVENTORY, 'utf8'));
    const candidates = providerInventory.providers.save.matches
      .filter(row => BigInt(row.stateDerivedBorrowableUpperBoundRaw) > 0n)
      .sort((a, b) => BigInt(a.stateDerivedBorrowableUpperBoundRaw)
        > BigInt(b.stateDerivedBorrowableUpperBoundRaw) ? -1 : 1);
    if (!candidates.length) throw new Error('No current borrowable Save JitoSOL reserve');
    saveCurrent = await readCurrentSave(candidates[0]);
    if (saveCurrent.stale || BigInt(saveCurrent.currentBorrowableUpperBoundRaw) === 0n) {
      throw new Error('Largest current Save JitoSOL reserve is not runtime-ready');
    }
  }
  const clockAlignment = await alignForkClockToImportedOracle();
  const results = [];

  const p0Actor = await createActor();
  for (const amount of [
    1n,
    2n,
    BigInt(inventory.project0VaultRaw) - 1n,
    BigInt(inventory.project0VaultRaw),
    BigInt(inventory.project0VaultRaw) + 1n,
  ]) {
    const instructions = assemble({
      actor: p0Actor,
      templates,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: amount,
    });
    results.push(await simulateCase(`project0_capacity_${amount}`, p0Actor, instructions, [], {
      category: 'provider_capacity',
      project0AmountRaw: amount.toString(),
    }));
  }

  let project0UsableMaximumRaw;
  const project0Exact = results.find(result => result.label === `project0_capacity_${inventory.project0VaultRaw}`);
  if (isSuccess(project0Exact)) {
    project0UsableMaximumRaw = BigInt(inventory.project0VaultRaw);
  } else {
    const vaultUpper = BigInt(inventory.project0VaultRaw) - 1n;
    let high = BigInt(inventory.project0LiquidityHeadroomRawFloor) + 2n;
    if (high > vaultUpper) high = vaultUpper;
    let low = high > 10_000_000n ? high - 10_000_000n : 2n;
    const lowInstructions = assemble({
      actor: p0Actor,
      templates,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: low,
    });
    const lowProbe = await simulateCase(`project0_binary_floor_${low}`, p0Actor, lowInstructions, [], {
      category: 'provider_capacity_binary_search_floor',
      project0AmountRaw: low.toString(),
    });
    results.push(lowProbe);
    if (!isSuccess(lowProbe)) low = 2n;
    while (low < high) {
      const middle = (low + high + 1n) / 2n;
      const instructions = assemble({
        actor: p0Actor,
        templates,
        klendBorrowTemplate,
        klendRepayTemplate,
        project0Amount: middle,
      });
      const probe = await simulateCase(`project0_binary_${middle}`, p0Actor, instructions, [], {
        category: 'provider_capacity_binary_search',
        project0AmountRaw: middle.toString(),
      });
      results.push(probe);
      if (isSuccess(probe)) low = middle;
      else high = middle - 1n;
    }
    project0UsableMaximumRaw = low;
  }

  const p0RouteActor = await createActor();
  for (const amount of [
    project0UsableMaximumRaw > 1n ? project0UsableMaximumRaw - 1n : 1n,
    project0UsableMaximumRaw,
    project0UsableMaximumRaw + 1n,
  ]) {
    await quoteAndRoundTrip(`project0_hylo_${amount}`, p0RouteActor, {
      templates,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: amount,
      klendLoans: [],
    }, [], results);
  }

  for (const reserve of reserves) {
    const available = BigInt(reserve.currentAvailableRaw);
    const actor = await createActor();
    for (const amount of [available > 1n ? available - 1n : 1n, available, available + 1n]) {
      await quoteAndRoundTrip(`klend_${reserve.reserve}_${amount}`, actor, {
        templates,
        klendBorrowTemplate,
        klendRepayTemplate,
        project0Amount: 0n,
        klendLoans: [{reserve, amount}],
      }, [reserve], results);
    }
  }

  const multiActor = await createActor();
  const oneEach = reserves.map(reserve => ({reserve, amount: 1n}));
  await quoteAndRoundTrip('all_klend_one_raw_each', multiActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: 0n,
    klendLoans: oneEach,
  }, reserves, results);

  const exactEach = reserves.map(reserve => ({reserve, amount: BigInt(reserve.currentAvailableRaw)}));
  await quoteAndRoundTrip('all_klend_exact_available', multiActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: 0n,
    klendLoans: exactEach,
  }, reserves, results);

  const largest = reserves[0];
  const asymmetricActor = await createActor();
  await quoteAndRoundTrip('asymmetric_klend_max_project0_two', asymmetricActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: 2n,
    klendLoans: [{reserve: largest, amount: BigInt(largest.currentAvailableRaw)}],
  }, [largest], results);
  await quoteAndRoundTrip('asymmetric_klend_one_project0_max', asymmetricActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: project0UsableMaximumRaw,
    klendLoans: [{reserve: largest, amount: 1n}],
  }, [largest], results);
  await quoteAndRoundTrip('dual_largest_klend_project0_max', asymmetricActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: project0UsableMaximumRaw,
    klendLoans: [{reserve: largest, amount: BigInt(largest.currentAvailableRaw)}],
  }, [largest], results);

  if (saveCurrent) {
    const saveMaximumRaw = BigInt(saveCurrent.currentBorrowableUpperBoundRaw);
    const saveActor = await createActor();
    await quoteAndRoundTrip('save_largest_exact_max', saveActor, {
      templates,
      saveTemplates: saveTemplateSet,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: 0n,
      klendLoans: [],
      saveLoan: {reserve: saveCurrent, amount: saveMaximumRaw},
    }, [], results);
    await quoteAndRoundTrip('save_largest_exact_max_plus_one', saveActor, {
      templates,
      saveTemplates: saveTemplateSet,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: 0n,
      klendLoans: [],
      saveLoan: {reserve: saveCurrent, amount: saveMaximumRaw + 1n},
    }, [], results);

    const tripleActor = await createActor();
    await quoteAndRoundTrip('triple_largest_klend_project0_save_max', tripleActor, {
      templates,
      saveTemplates: saveTemplateSet,
      klendBorrowTemplate,
      klendRepayTemplate,
      project0Amount: project0UsableMaximumRaw,
      klendLoans: [{reserve: largest, amount: BigInt(largest.currentAvailableRaw)}],
      saveLoan: {reserve: saveCurrent, amount: saveMaximumRaw},
    }, [largest], results);
  }

  const allActor = await createActor();
  await quoteAndRoundTrip('maximum_retained_sources', allActor, {
    templates,
    klendBorrowTemplate,
    klendRepayTemplate,
    project0Amount: project0UsableMaximumRaw,
    klendLoans: exactEach,
  }, reserves, results);

  const successfulRoundTrips = results.filter(result => result.phase === 'roundtrip' && isSuccess(result));
  const positiveGain = successfulRoundTrips.filter(result => {
    const jito = BigInt(result.deltas.attackerJitosol);
    const xsol = BigInt(result.deltas.attackerXsol);
    return jito > 0n || (jito === 0n && xsol > 0n);
  });
  const report = {
    generatedAt: new Date().toISOString(),
    transport: 'current-mainnet-backed local Surfpool fork; locally generated Ed25519 signers; simulateTransaction sigVerify:true; no mainnet send',
    noMainnetTransactionsSubmitted: true,
    rpcEndpointRedacted: true,
    forkHealth: health,
    genesisHash,
    forkClockAlignment: clockAlignment,
    sourceTemplates: {
      project0ScopeSignature: PROJECT0_SCOPE_SOURCE_SIGNATURE,
      project0ScopeSlot: templates.scopeSlot,
      project0LegacyBorrowSignature: PROJECT0_LEGACY_FLASH_SOURCE_SIGNATURE,
      project0LegacyBorrowSlot: templates.borrowSlot,
      klendSignature: JSON.parse(fs.readFileSync(KLEND_HISTORY, 'utf8')).hits[0].signature,
      ...(saveTemplateSet ? {
        saveSignature: SAVE_SOURCE_SIGNATURE,
        saveSlot: saveTemplateSet.sourceSlot,
      } : {}),
    },
    providerInventory: {
      observationSlot: inventory.slot,
      mint: JITOSOL.toBase58(),
      retainedIndependentPrograms: [
        {name: 'Kamino Lend', programId: KLEND.toBase58(), reserveCount: reserves.length},
        {name: 'Project 0 / marginfi v1', programId: PROJECT0.toBase58(), bank: PROJECT0_BANK.toBase58()},
        ...(saveCurrent ? [{name: 'Save / Solend', programId: SAVE.toBase58(),
          reserve: saveCurrent.reserve}] : []),
      ],
      thirdIndependentProviderPresentInRetainedCensus: !!saveCurrent,
      project0DisplayedVaultRaw: inventory.project0VaultRaw,
      project0LiquidityHeadroomRawFloor: inventory.project0LiquidityHeadroomRawFloor,
      project0UsableMaximumRaw: project0UsableMaximumRaw.toString(),
      klendZeroFeeJitosolReserves: reserves,
      saveJitosolReserve: saveCurrent,
    },
    constraints: {
      maximumWireBytes: 4096,
      maximumAddresses: 64,
      signatureVerification: true,
      signerSecretsPersisted: false,
      callerSyntheticForkFundingRaw: ACTOR_BUFFER_RAW.toString(),
      callerSyntheticForkFunding: 'Synthetic JitoSOL plus rent/fees; pre/post deltas are reconciled and no synthetic starting balance is treated as profit',
    },
    conclusion: {
      successfulFullRoundTrips: successfulRoundTrips.length,
      positiveOutsiderGainCases: positiveGain.map(result => result.label),
      reportableOutsiderGainObserved: positiveGain.length > 0,
    },
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    project0DisplayedVaultRaw: inventory.project0VaultRaw,
    project0UsableMaximumRaw: project0UsableMaximumRaw.toString(),
    klendReserveCount: reserves.length,
    resultCount: results.length,
    successfulFullRoundTrips: successfulRoundTrips.length,
    positiveOutsiderGainCases: report.conclusion.positiveOutsiderGainCases,
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
