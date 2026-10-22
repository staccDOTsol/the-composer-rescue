#!/usr/bin/env node

// Read-only current-mainnet Solana v1 stress harness for marginfi/Project 0.
// This file only calls get* RPC methods and simulateTransaction. It never signs
// or submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const anchor = require('@coral-xyz/anchor');
const bs58 = require('bs58');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const baseDir = __dirname;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');

const P = (value) => new PublicKey(value);
const marginfi = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const klend = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const token = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const noop = P('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const outputPath = `${baseDir}/marginfi-flashloan-stress.json`;
const replay = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-replay-refresh.json`, 'utf8'));
const census = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-vaults-current.json`, 'utf8'));
const klendHistory = JSON.parse(fs.readFileSync(`${baseDir}/kamino-flash-history.json`, 'utf8'));
const klendCensus = JSON.parse(fs.readFileSync(`${baseDir}/klend-zero-fee-census.json`, 'utf8'));
const idl = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const coder = new anchor.BorshAccountsCoder(idl);
const connection = new Connection(rpcUrl, 'confirmed');
let rpcId = 0;

const DISCS = {
  start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  end: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
  deposit: Buffer.from([171, 94, 235, 103, 82, 64, 212, 140]),
  withdraw: Buffer.from([36, 72, 74, 19, 210, 210, 192, 192]),
  pulse: Buffer.from([186, 52, 117, 97, 34, 74, 39, 253]),
  accrue: Buffer.from([108, 201, 30, 87, 47, 65, 97, 188]),
};

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) return {rpcError: body.error};
  return {result: body.result};
}

function cloneInstruction(ix) {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((key) => ({...key})),
    data: Buffer.from(ix.data),
  });
}

function u64(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
}

function amountOptionData(discriminator, amount, value) {
  return Buffer.concat([discriminator, u64(amount), value === undefined
    ? Buffer.from([0]) : Buffer.from([1, value ? 1 : 0])]);
}

function fixedRaw(wrapped) {
  if (!wrapped?.value) return null;
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if ((bytes[15] & 0x80) !== 0) value -= 1n << 128n;
  return value.toString();
}

function fixedDecimal(raw, places = 18) {
  const scale = 1n << 48n;
  const value = BigInt(raw);
  const whole = value / scale;
  const fraction = ((value % scale) * (10n ** BigInt(places)) / scale)
    .toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function decodeMarginfiAccount(data, targetBank) {
  const decoded = coder.decode('MarginfiAccount', data);
  const balance = decoded.lending_account.balances.find((row) =>
    row.bank_pk.equals(targetBank));
  return {
    authority: decoded.authority.toString(),
    flags: decoded.account_flags.toString(),
    lastUpdate: decoded.last_update.toString(),
    isEmpty: decoded.indexer_flags.is_empty,
    selectedBalance: balance ? {
      active: balance.active,
      bank: balance.bank_pk.toString(),
      assetSharesI80F48Raw: fixedRaw(balance.asset_shares),
      liabilitySharesI80F48Raw: fixedRaw(balance.liability_shares),
      premiumOutstandingI80F48Raw: fixedRaw(balance.premium_outstanding),
      tag: balance.tag,
    } : null,
  };
}

function decodeBank(data) {
  const decoded = coder.decode('Bank', data);
  return {
    mint: decoded.mint.toString(),
    totalAssetSharesI80F48Raw: fixedRaw(decoded.total_asset_shares),
    totalLiabilitySharesI80F48Raw: fixedRaw(decoded.total_liability_shares),
    assetShareValueI80F48Raw: fixedRaw(decoded.asset_share_value),
    liabilityShareValueI80F48Raw: fixedRaw(decoded.liability_share_value),
    groupFeesI80F48Raw: fixedRaw(decoded.collected_group_fees_outstanding),
    programFeesI80F48Raw: fixedRaw(decoded.collected_program_fees_outstanding),
    originationFeeI80F48Raw: fixedRaw(decoded.config.interest_rate_config.protocol_origination_fee),
    lastUpdate: decoded.last_update.toString(),
  };
}

function accountImage(address, account, labels, targetBank) {
  if (!account?.data) return null;
  const raw = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = account.owner instanceof PublicKey ? account.owner.toString() : account.owner;
  const image = {
    address: address.toString(),
    label: labels.get(address.toString()) || null,
    owner,
    dataLength: raw.length,
    dataSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  };
  try {
    if (owner === token.toString() && raw.length >= 72) {
      image.token = {
        mint: new PublicKey(raw.subarray(0, 32)).toString(),
        owner: new PublicKey(raw.subarray(32, 64)).toString(),
        amountRaw: raw.readBigUInt64LE(64).toString(),
      };
    } else if (address.equals(targetBank)) {
      image.bank = decodeBank(raw);
    } else if (owner === marginfi.toString() && raw.length === 2312) {
      image.marginfiAccount = decodeMarginfiAccount(raw, targetBank);
    } else if (owner === klend.toString() && raw.length === 8624) {
      image.klendReserve = {
        availableRaw: raw.readBigUInt64LE(224).toString(),
        flashLoanFeeSf: raw.readBigUInt64LE(4904).toString(),
      };
    }
  } catch (error) {
    image.decodeError = error.message;
  }
  return image;
}

function isWritableIndex(message, index) {
  const header = message.header;
  if (index < header.numRequiredSignatures) {
    return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  }
  return index < message.staticAccountKeys.length - header.numReadonlyUnsignedAccounts;
}

// web3.js 1.x cannot emit v1, so compile the account ordering with v0 and encode
// the current v1 layout directly. The same encoder has a successful current-mainnet
// KLend control in klend-jupiter-v1-extremes.json.
function encodeV1(instructions, payer, blockhash, options = {}) {
  const {computeLimit = 1_400_000, dataLimit = 67_108_864,
    allowOversize = false, allowOverAccounts = false} = options;
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 has no address-table lookups');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (!allowOverAccounts && (keys.length > 64 || items.length > 64)) {
    throw new Error(`v1 inline limit: ${keys.length} addresses, ${items.length} instructions`);
  }
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
  return {
    wire,
    unsigned,
    accountKeys: keys.map((key, index) => ({
      index,
      address: key.toString(),
      signer: index < v0.header.numRequiredSignatures,
      writable: isWritableIndex(v0, index),
    })),
    instructionCount: items.length,
    requiredSignatures: v0.header.numRequiredSignatures,
    computeLimit,
    dataLimit,
  };
}

async function fetchDecompiled(signature) {
  const fetched = await rpc('getTransaction', [signature,
    {encoding: 'base64', maxSupportedTransactionVersion: 1, commitment: 'confirmed'}]);
  if (fetched.rpcError || !fetched.result) {
    throw new Error(`getTransaction ${signature}: ${JSON.stringify(fetched.rpcError)}`);
  }
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(fetched.result.transaction[0], 'base64'));
  const lookupAccounts = await Promise.all(transaction.message.addressTableLookups.map(
    async ({accountKey}) => {
      const table = await connection.getAddressLookupTable(accountKey);
      if (!table.value) throw new Error(`missing ALT ${accountKey}`);
      return table.value;
    }));
  return {
    sourceSlot: fetched.result.slot,
    transaction,
    message: TransactionMessage.decompile(transaction.message,
      {addressLookupTableAccounts: lookupAccounts}),
  };
}

function findIx(instructions, discriminator) {
  const found = instructions.find((ix) => ix.programId.equals(marginfi) &&
    Buffer.from(ix.data).subarray(0, 8).equals(discriminator));
  if (!found) throw new Error(`missing instruction ${discriminator.toString('hex')}`);
  return cloneInstruction(found);
}

function instructionWith(programId, keys, data) {
  return new TransactionInstruction({programId, keys: keys.map((key) => ({...key})), data});
}

function compactLogs(logs) {
  return (logs || []).filter((line) => line.includes('invoke') ||
    line.includes('consumed') || line.includes('success') || line.includes('failed') ||
    line.includes('Instruction:') || line.includes('AnchorError') || line.includes('Error'));
}

async function main() {
  const controlSignature = replay.successfulReplays.LendingAccountRepay.signature;
  const source = await fetchDecompiled(controlSignature);
  const sourceIxs = source.message.instructions;
  const startTemplate = findIx(sourceIxs, DISCS.start);
  const borrowTemplate = findIx(sourceIxs, DISCS.borrow);
  const repayTemplate = findIx(sourceIxs, DISCS.repay);
  const endTemplate = findIx(sourceIxs, DISCS.end);

  const group = borrowTemplate.keys[0].pubkey;
  const marginfiAccount = borrowTemplate.keys[1].pubkey;
  const authority = borrowTemplate.keys[2].pubkey;
  const bank = borrowTemplate.keys[3].pubkey;
  const userToken = borrowTemplate.keys[4].pubkey;
  const vaultAuthority = borrowTemplate.keys[5].pubkey;
  const liquidityVault = borrowTemplate.keys[6].pubkey;
  const oracle = borrowTemplate.keys.at(-1).pubkey;
  const bankStateInfo = await connection.getAccountInfo(bank, 'confirmed');
  const bankState = decodeBank(bankStateInfo.data);
  const marginfiMint = P(bankState.mint);

  // Census every currently discovered bank to close the exact-zero-share
  // hypothesis. For a one-raw-unit borrow, I80F48 division produces
  // floor(2^96 / liability_share_value_raw) share bits; zero requires a raw
  // share value strictly greater than 2^96 (numeric value > 2^48).
  const currentBankKeys = [...new Set(census.rows.map((row) => row.bank))].map(P);
  const bankCensusRows = [];
  const bankCensusSlots = [];
  for (let offset = 0; offset < currentBankKeys.length; offset += 100) {
    const keys = currentBankKeys.slice(offset, offset + 100);
    const batch = await connection.getMultipleAccountsInfoAndContext(keys, 'confirmed');
    bankCensusSlots.push(batch.context.slot);
    for (let index = 0; index < keys.length; index += 1) {
      if (!batch.value[index]) continue;
      const decoded = decodeBank(batch.value[index].data);
      const liabilityRaw = BigInt(decoded.liabilityShareValueI80F48Raw);
      const oneRawShares = liabilityRaw > 0n ? (1n << 96n) / liabilityRaw : null;
      bankCensusRows.push({
        bank: keys[index].toString(),
        mint: decoded.mint,
        dataLength: batch.value[index].data.length,
        liabilityShareValueI80F48Raw: liabilityRaw.toString(),
        liabilityShareValueNumeric: fixedDecimal(liabilityRaw),
        oneRawBorrowLiabilitySharesI80F48Raw: oneRawShares?.toString() || null,
        exactZeroShareForOneRawBorrow: oneRawShares === 0n,
        originationFeeI80F48Raw: decoded.originationFeeI80F48Raw,
      });
    }
  }
  bankCensusRows.sort((left, right) => {
    const a = BigInt(left.liabilityShareValueI80F48Raw);
    const b = BigInt(right.liabilityShareValueI80F48Raw);
    return a === b ? 0 : a > b ? -1 : 1;
  });

  const start = (endIndex, account = marginfiAccount) => {
    const ix = cloneInstruction(startTemplate);
    ix.keys[0].pubkey = account;
    ix.data = Buffer.concat([DISCS.start, u64(endIndex)]);
    return ix;
  };
  const borrow = (amount, destination = userToken, vault = liquidityVault) => {
    const ix = cloneInstruction(borrowTemplate);
    ix.keys[4].pubkey = destination;
    ix.keys[6].pubkey = vault;
    ix.data = Buffer.concat([DISCS.borrow, u64(amount)]);
    return ix;
  };
  const repay = (amount, sourceToken = userToken, repayAll = true) => {
    const ix = cloneInstruction(repayTemplate);
    ix.keys[4].pubkey = sourceToken;
    ix.data = amountOptionData(DISCS.repay, amount, repayAll);
    return ix;
  };
  const end = (account = marginfiAccount) => {
    const ix = cloneInstruction(endTemplate);
    ix.keys[0].pubkey = account;
    ix.data = DISCS.end;
    return ix;
  };
  const project0Pair = (amount) => [start(3), borrow(amount), repay(amount), end()];
  const repeatedPairs = (count, amount) => {
    const middle = Array.from({length: count}, () => [borrow(amount), repay(amount)]).flat();
    return [start(middle.length + 1), ...middle, end()];
  };
  const deposit = (amount, sourceToken = userToken) => instructionWith(marginfi,
    repayTemplate.keys.slice(0, 7).map((key, index) => ({...key,
      pubkey: index === 4 ? sourceToken : key.pubkey})),
    amountOptionData(DISCS.deposit, amount, false));
  const withdraw = (amount, destination = userToken, withdrawAll = true) =>
    instructionWith(marginfi, borrowTemplate.keys.map((key, index) => ({...key,
      pubkey: index === 4 ? destination : key.pubkey})),
    amountOptionData(DISCS.withdraw, amount, withdrawAll));
  const accrue = () => instructionWith(marginfi, [
    {pubkey: group, isSigner: false, isWritable: false},
    {pubkey: bank, isSigner: false, isWritable: true},
  ], DISCS.accrue);
  const pulse = () => instructionWith(marginfi, [
    {pubkey: marginfiAccount, isSigner: false, isWritable: true},
    {pubkey: group, isSigner: false, isWritable: false},
    {pubkey: bank, isSigner: false, isWritable: false},
    {pubkey: oracle, isSigner: false, isWritable: false},
  ], DISCS.pulse);

  const klendSample = klendHistory.hits[0];
  const censusReserve = klendCensus.activeZero
    .filter((row) => row.mint === marginfiMint.toString())
    .sort((left, right) => BigInt(left.availableRaw) > BigInt(right.availableRaw) ? -1 : 1)[0];
  if (!censusReserve) throw new Error(`No exact-zero-rate KLend reserve for ${marginfiMint}`);
  const klendReserve = P(censusReserve.reserve);
  const klendSupply = P(censusReserve.supplyVault);
  const klendFeeVault = P(censusReserve.feeVault);
  const klendMarket = P(censusReserve.market);
  const [klendMarketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), klendMarket.toBuffer()], klend);
  const ixSysvar = P('Sysvar1nstructions1111111111111111111111111');
  const klendDiscs = {
    borrow: Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]),
    repay: Buffer.from([185, 117, 0, 203, 96, 245, 180, 186]),
  };
  const klendIx = (kind, amount, repayIndex) => {
    const isBorrow = kind === 'borrow';
    const keys = [authority, klendMarketAuthority, klendMarket, klendReserve,
      marginfiMint, klendSupply, userToken, klendFeeVault, klend, klend,
      ixSysvar, token].map((pubkey, index) => ({
      pubkey,
      isSigner: index === 0,
      isWritable: [3, 5, 6, 7].includes(index),
    }));
    return instructionWith(klend, keys, Buffer.concat([
      klendDiscs[kind], u64(amount), ...(isBorrow ? [] : [Buffer.from([repayIndex])]),
    ]));
  };
  const crossRoundTrip = (amount, rounds = 1, prefix = [], interleave = []) => {
    const borrowIndex = prefix.length;
    const body = Array.from({length: rounds}, (_, index) => [
      deposit(amount), ...(index === 0 ? interleave : []), withdraw(amount),
    ]).flat();
    return [...prefix, klendIx('borrow', amount), ...body,
      klendIx('repay', amount, borrowIndex)];
  };
  const crossBufferedRoundTrip = (principal, marginAmount, rounds = 1,
    prefix = [], interleave = []) => {
    const borrowIndex = prefix.length;
    const body = Array.from({length: rounds}, (_, index) => [
      deposit(marginAmount), ...(index === 0 ? interleave : []),
      withdraw(marginAmount, userToken, false),
    ]).flat();
    return [...prefix, klendIx('borrow', principal), ...body,
      klendIx('repay', principal, borrowIndex)];
  };

  const labels = new Map([
    [marginfiAccount.toString(), 'marginfi_account'],
    [bank.toString(), 'marginfi_bank'],
    [userToken.toString(), 'user_usdt_token'],
    [liquidityVault.toString(), 'marginfi_liquidity_vault'],
    [klendReserve.toString(), 'klend_usdt_reserve'],
    [klendSupply.toString(), 'klend_usdt_supply_vault'],
    [klendFeeVault.toString(), 'klend_usdt_fee_vault'],
  ]);
  const watched = [marginfiAccount, bank, userToken, liquidityVault,
    klendReserve, klendSupply, klendFeeVault];
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  async function simulateCase(name, instructions, category, expectation, options = {}) {
    let encoded;
    try {
      encoded = encodeV1(instructions, authority, blockhash, options);
    } catch (error) {
      return {name, category, expectation, localError: error.message};
    }
    const pre = await connection.getMultipleAccountsInfoAndContext(watched, 'confirmed');
    const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'confirmed',
      innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)},
    }]);
    const value = response.result?.value;
    const preImage = watched.map((address, index) =>
      accountImage(address, pre.value[index], labels, bank));
    const postImage = watched.map((address, index) =>
      accountImage(address, value?.accounts?.[index], labels, bank));
    return {
      name,
      category,
      expectation,
      txVersion: 1,
      liveSubmission: false,
      sigVerify: false,
      preSlot: pre.context.slot,
      simulationSlot: response.result?.context?.slot || null,
      rpcError: response.rpcError || null,
      err: value?.err || null,
      unitsConsumed: value?.unitsConsumed ?? null,
      loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
      sizeBytes: encoded.wire.length,
      unsignedMessageBytes: encoded.unsigned.length,
      addressCount: encoded.accountKeys.length,
      writableCount: encoded.accountKeys.filter((row) => row.writable).length,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      computeLimit: encoded.computeLimit,
      loadedAccountDataLimit: encoded.dataLimit,
      accountKeys: encoded.accountKeys,
      wireSha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      wireBase64: encoded.wire.toString('base64'),
      unsignedMessageBase64: encoded.unsigned.toString('base64'),
      pre: preImage,
      post: postImage,
      logs: value?.logs || null,
      trace: compactLogs(value?.logs),
      innerInstructions: value?.innerInstructions || null,
      returnData: value?.returnData || null,
    };
  }

  const vaultInfo = await connection.getAccountInfo(liquidityVault, 'confirmed');
  const marginfiVaultAmount = vaultInfo.data.readBigUInt64LE(64);
  const reserveInfo = await connection.getAccountInfo(klendReserve, 'confirmed');
  const klendAvailable = reserveInfo.data.readBigUInt64LE(224);
  const klendFeeSf = reserveInfo.data.readBigUInt64LE(4904);
  const results = [];

  for (const amount of [0n, 1n, 2n, 3n, 10n, 100n, 1_000_000n,
    marginfiVaultAmount - 1n, marginfiVaultAmount, marginfiVaultAmount + 1n]) {
    results.push(await simulateCase(`project0_pair_${amount}`, project0Pair(amount),
      'project0-boundary', 'Successful cases must return wallet/vault and debt/share state to the preimage.'));
  }

  // The token-vault balance is not itself fully borrowable: bank utilization is
  // enforced against accounting totals. Pin the exact current transition with a
  // monotonic binary search, then retain every probed signed wire and trace.
  let lower = 2n;
  let upper = marginfiVaultAmount;
  let project0MaxSuccessfulRaw = 2n;
  while (lower <= upper) {
    const amount = (lower + upper) / 2n;
    const row = await simulateCase(`project0_limit_binary_${amount}`,
      project0Pair(amount), 'project0-near-available',
      'Binary-search the largest current borrow that remains below the bank utilization gate and fully repays.');
    results.push(row);
    if (!row.localError && !row.rpcError && !row.err) {
      project0MaxSuccessfulRaw = amount;
      lower = amount + 1n;
    } else {
      upper = amount - 1n;
    }
  }

  for (const count of [2, 4, 8, 12, 16, 24, 30]) {
    results.push(await simulateCase(`project0_repeated_${count}_pairs`, repeatedPairs(count, 2n),
      'project0-repetition', 'Find the first trace, compute, instruction, or byte limit; successful cases must fully repay.'));
  }

  const updateCases = [
    ['accrue_before_start', [accrue(), start(4), borrow(2n), repay(2n), end()]],
    ['accrue_after_start', [start(4), accrue(), borrow(2n), repay(2n), end()]],
    ['accrue_between_borrow_repay', [start(4), borrow(2n), accrue(), repay(2n), end()]],
    ['accrue_after_repay', [start(4), borrow(2n), repay(2n), accrue(), end()]],
    ['accrue_after_end', [...project0Pair(2n), accrue()]],
    ['pulse_before_start', [pulse(), start(4), borrow(2n), repay(2n), end()]],
    ['pulse_after_start', [start(4), pulse(), borrow(2n), repay(2n), end()]],
    ['pulse_between_borrow_repay', [start(4), borrow(2n), pulse(), repay(2n), end()]],
    ['pulse_after_repay', [start(4), borrow(2n), repay(2n), pulse(), end()]],
    ['pulse_after_end', [...project0Pair(2n), pulse()]],
  ];
  for (const [name, instructions] of updateCases) {
    results.push(await simulateCase(name, instructions, 'project0-refresh-order',
      'Permissionless accrue/pulse placement must not leave debt or token gain after a successful full repayment.'));
  }

  const aliasBorrowVault = borrow(2n, liquidityVault);
  const aliasRepayVault = repay(2n, liquidityVault);
  const wrongVaultBorrow = borrow(2n, userToken, userToken);
  const orderCases = [
    ['declared_end_points_to_repay', [start(2), borrow(2n), repay(2n), end()]],
    ['end_before_repay', [start(2), borrow(2n), end(), repay(2n)]],
    ['duplicate_start', [start(4), start(4), borrow(2n), repay(2n), end()]],
    ['borrow_before_start', [borrow(2n), start(3), repay(2n), end()]],
    ['repay_before_borrow', [start(3), repay(2n), borrow(2n), end()]],
    ['alias_borrow_destination_to_vault', [start(3), aliasBorrowVault, repay(2n), end()]],
    ['alias_repay_source_to_vault', [start(3), borrow(2n), aliasRepayVault, end()]],
    ['substitute_borrow_vault_with_user_token', [start(3), wrongVaultBorrow, repay(2n), end()]],
  ];
  for (const [name, instructions] of orderCases) {
    results.push(await simulateCase(name, instructions, 'project0-alias-order',
      'Reject malformed ordering or aliases atomically before any unauthorized net gain.'));
  }

  const crossAmounts = [1n, 2n, 10n, 100n, 1_000_000n,
    klendAvailable * 99n / 100n, klendAvailable - 1n, klendAvailable, klendAvailable + 1n];
  for (const amount of crossAmounts) {
    results.push(await simulateCase(`klend_marginfi_round_trip_${amount}`,
      crossRoundTrip(amount), 'cross-program-same-usdt',
      'KLend exact-zero-rate same-mint funding reaches marginfi deposit/withdraw; reserve, fee vault, wallet and marginfi shares must reconcile and KLend must be fully repaid.'));
  }
  const bufferedAmounts = [3n, 101n, 1_000_001n, klendAvailable];
  for (const principal of bufferedAmounts) {
    results.push(await simulateCase(`klend_marginfi_buffered_round_trip_${principal}`,
      crossBufferedRoundTrip(principal, principal - 1n), 'cross-program-same-mint-buffered',
      'Keep one borrowed raw unit outside marginfi, explicitly round-trip the remainder, and fully repay the exact-zero-rate KLend principal.'));
  }
  for (const count of [2, 4, 6, 7, 8]) {
    results.push(await simulateCase(`klend_marginfi_repeated_${count}_buffered_rounds`,
      crossBufferedRoundTrip(1_000_001n, 1_000_000n, count), 'cross-program-repetition',
      'Repeated marginfi deposit/withdraw legs must remain fully repaid or fail atomically at a concrete runtime limit.'));
  }
  const crossVariants = [
    ['klend_accrue_before_borrow', crossBufferedRoundTrip(1_000_001n, 1_000_000n, 1, [accrue()])],
    ['klend_accrue_between_deposit_withdraw', crossBufferedRoundTrip(1_000_001n, 1_000_000n, 1, [], [accrue()])],
    ['klend_pulse_between_deposit_withdraw', crossBufferedRoundTrip(1_000_001n, 1_000_000n, 1, [], [pulse()])],
    ['klend_withdraw_before_deposit', [klendIx('borrow', 1_000_000n),
      withdraw(1_000_000n), deposit(1_000_000n), klendIx('repay', 1_000_000n, 0)]],
  ];
  for (const [name, instructions] of crossVariants) {
    results.push(await simulateCase(name, instructions, 'cross-program-update-order',
      'Updates may change accounting timestamps but must not permit a net token gain or unpaid KLend principal.'));
  }

  // Construct a real Project 0 flash round trip with exactly 64 inline accounts
  // and exactly 4,096 wire bytes. Existing, read-only program/vault/bank addresses
  // are supplied to the SPL no-op instruction and are ignored by that program.
  const dummyCandidates = [...new Set(census.rows.flatMap((row) =>
    [row.address, row.bank, row.group, row.mint, row.authority]).filter(Boolean))]
    .map(P).filter((key) => !key.equals(authority));
  const dummyKeys = [];
  let boundaryIxs;
  let boundaryEncoded;
  for (const candidate of dummyCandidates) {
    dummyKeys.push({pubkey: candidate, isSigner: false, isWritable: false});
    const noPadding = instructionWith(noop, dummyKeys, Buffer.alloc(0));
      const trial = [start(4), borrow(2n), repay(2n), noPadding, end()];
    const encoded = encodeV1(trial, authority, blockhash, {allowOverAccounts: true});
    if (encoded.accountKeys.length === 64) {
      const padding = 4096 - encoded.wire.length;
      if (padding < 0) throw new Error(`64-account base exceeds v1 limit: ${encoded.wire.length}`);
      const exactNoop = instructionWith(noop, dummyKeys, Buffer.alloc(padding, 0x41));
      boundaryIxs = [start(4), borrow(2n), repay(2n), exactNoop, end()];
      boundaryEncoded = encodeV1(boundaryIxs, authority, blockhash);
      break;
    }
    if (encoded.accountKeys.length > 64) break;
  }
  if (!boundaryEncoded || boundaryEncoded.accountKeys.length !== 64 ||
      boundaryEncoded.wire.length !== 4096) {
    throw new Error('Could not construct exact 4,096-byte / 64-address v1 boundary');
  }
  results.push(await simulateCase('v1_exact_4096_bytes_64_inline_addresses', boundaryIxs,
    'v1-runtime-boundary', 'Runtime must accept the exact documented size/address boundary and preserve full repayment.'));
  const overSize = boundaryIxs.map(cloneInstruction);
  overSize.at(-2).data = Buffer.concat([overSize.at(-2).data, Buffer.from([0x42])]);
  results.push(await simulateCase('v1_4097_bytes_64_inline_addresses', overSize,
    'v1-runtime-boundary', 'One byte beyond the v1 wire limit must be rejected.',
    {allowOversize: true}));
  const extraKey = dummyCandidates.find((candidate) =>
    !boundaryEncoded.accountKeys.some((row) => row.address === candidate.toString()));
  const overAccounts = boundaryIxs.map(cloneInstruction);
  overAccounts.at(-2).keys.push({pubkey: extraKey, isSigner: false, isWritable: false});
  overAccounts.at(-2).data = Buffer.alloc(0);
  results.push(await simulateCase('v1_65_inline_addresses', overAccounts,
    'v1-runtime-boundary', 'One inline address beyond the v1 limit must be rejected.',
    {allowOverAccounts: true}));

  const succeeded = results.filter((row) => !row.localError && !row.rpcError && !row.err);
  const failed = results.filter((row) => row.localError || row.rpcError || row.err);
  const result = {
    generatedAt: new Date().toISOString(),
    safety: 'Read-only current-mainnet get* RPC and simulateTransaction only; no signatures produced and no transaction submitted.',
    program: marginfi.toString(),
    sourceControl: {signature: controlSignature, slot: source.sourceSlot},
    configuration: {
      group: group.toString(),
      marginfiAccount: marginfiAccount.toString(),
      authority: authority.toString(),
      bank: bank.toString(),
      mint: bankState.mint,
      userToken: userToken.toString(),
      liquidityVault: liquidityVault.toString(),
      liquidityVaultRaw: marginfiVaultAmount.toString(),
      project0OriginationFeeI80F48Raw: bankState.originationFeeI80F48Raw,
      project0LastSuccessfulBinarySampleRaw: project0MaxSuccessfulRaw.toString(),
      project0NearLiquidityCaveat: 'The bank accrues interest against the live Clock during each simulation, so the assets-minus-liabilities utilization boundary moves between slots. Every binary-search row retains its own pre/simulation slots; the last successful sample is not represented as a timeless exact maximum.',
      emptyBalanceThresholdNativeUnits: '1',
      zeroAmountThresholdNativeUnits: '0.0001',
      smallestPositiveRawTokenUnit: '1',
      thresholdInterpretation: 'Both thresholds are expressed in native/raw bank units. EMPTY_BALANCE_THRESHOLD=1 can reject one-raw-unit operations when share value exceeds one; ZERO_AMOUNT_THRESHOLD=0.0001 is below the smallest integer raw token amount.',
    },
    exactZeroShareCensus: {
      source: 'All 401 bank addresses from the current verified vault census, re-read with getMultipleAccountsInfoAndContext and decoded with the exact-source IDL.',
      observationSlots: bankCensusSlots,
      requestedBanks: currentBankKeys.length,
      decodedBanks: bankCensusRows.length,
      zeroShareRiskBanks: bankCensusRows.filter((row) => row.exactZeroShareForOneRawBorrow).length,
      exactPrecondition: 'For a fee-free one-raw-unit borrow: floor(2^96 / liability_share_value_raw) == 0, equivalently liability_share_value_raw > 2^96 or numeric liability share value > 2^48.',
      thresholdRaw: (1n << 96n).toString(),
      maximumObserved: bankCensusRows[0] || null,
      rows: bankCensusRows,
    },
    klendFunding: {
      program: klend.toString(),
      genericInstructionControlSignature: klendSample.signature,
      genericInstructionControlSlot: klendSample.slot,
      market: klendMarket.toString(),
      marketAuthority: klendMarketAuthority.toString(),
      reserve: klendReserve.toString(),
      supplyVault: klendSupply.toString(),
      feeVault: klendFeeVault.toString(),
      availableRaw: klendAvailable.toString(),
      flashLoanFeeSf: klendFeeSf.toString(),
      feeScale: '2^60',
      feeClass: klendFeeSf === 0n ? 'exact-zero-rate' : 'nonzero-rate',
      censusEvidence: censusReserve || null,
    },
    v1LimitsRequested: {wireBytes: 4096, inlineAddresses: 64},
    totals: {cases: results.length, succeeded: succeeded.length, failed: failed.length},
    results,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath,
    generatedAt: result.generatedAt,
    totals: result.totals,
    successes: succeeded.map((row) => ({name: row.name, sizeBytes: row.sizeBytes,
      accounts: row.addressCount, instructions: row.instructionCount, units: row.unitsConsumed})),
    failures: failed.map((row) => ({name: row.name, localError: row.localError,
      rpcError: row.rpcError, err: row.err, trace: row.trace?.slice(-3)})),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
