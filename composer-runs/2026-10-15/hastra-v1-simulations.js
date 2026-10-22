#!/usr/bin/env node
// Read-only mainnet simulations for Hastra PRIME deposit/redeem and zero-fee KLend v1 flash composition.
// Never signs or sends a transaction. Every case uses simulateTransaction(sigVerify=false).

const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Connection, PublicKey, TransactionInstruction } = require(`${MOD}/@solana/web3.js`);
const anchor = require(`${MOD}/@coral-xyz/anchor`);
const bsModule = require(`${MOD}/bs58`);
const bs58 = bsModule.default || bsModule;
const { encodeV1 } = require('./klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const HAS = P('97V7JsExNC6yFWu5KjK1FLfVkNVvtMpAFL5QkLWKEGxY');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
// A system-owned holder selected from getTokenLargestAccounts. Unlike the historical
// positive-control wallet, it stayed unchanged across repeated observation slots.
const USER = P('AiuRbiK8xZmeKyCw1Shk4xCeQyFcShE1KpydwNoETL1K');
const USER_PRIME = P('4SYnQVuKwC1SJ9e3d8jdi614CFtADMkR69EwtY2JHwes');
const USER_WYLDS = P('AwqQ2SZEfrKrWAW1i9TFC1s8xModoh8xkKrduRPomr2i');
const PRIME = P('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const WYLDS = P('8fr7WGTVFszfyNWRMXj6fRjZZAnDwmXwEpCrtzmUkdih');
const STAKE_CONFIG = P('4qZvMr1THcZzHFicLAv9MtAi7cBGzQ7EzaY4K4cyYF18');
const VAULT_CONFIG = P('3BgchdaQWVeHke4iTgagADkX6LPPjuQLuNYVvPwBUpWt');
const HAS_VAULT = P('FvkbfMm98jefJWrqkvXvsSZ9RFaRBae8k6c1jaYA5vY3');
const VAULT_AUTHORITY = P('DT7z9w9fGJ6sH7vmGbPCa5JLi2xp6XPrL61z2gctzmHb');
const MINT_AUTHORITY = P('EtnHujEkqJJbgfTA2aC6vgZp8DVgwG6KdBxt9V1J31KK');
const PRICE_CONFIG = P('Ev92L9D2CsPczeKHF3UWybQSweQCG4NRfexwJfVwyqsn');

const RESERVES = {
  wylds: {
    mint: WYLDS,
    reserve: P('34GJjXf7jGTdNL8Yw1HtqWSVvfX6JTsft3UsuFFUL7VU'),
    market: P('Btu8835QDYgdTnMJJBSidbfQhrZzryZbMhCpty6h6Xdk'),
    supply: P('BHXGA3NcFeNjfbwweVfFro44fjYZGXvPqX2gxFETYpqv'),
    fee: P('Gy8WjEiTuU2jBQmC5pbCaanvGCYtVYR6auJ6ztygcNKb'),
    userToken: USER_WYLDS,
  },
  prime: {
    mint: PRIME,
    reserve: P('BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh'),
    market: P('CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA'),
    supply: P('FkSkbRU5A6JXRXo5uaFwCS7jQ6jHYa1DxFtfpXfTz352'),
    fee: P('C8zsSvMzpVP4atgHTHQVwmFMer2smzdavQnaK3owTRdB'),
    userToken: USER_PRIME,
  },
};

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^export\s+/, '');
    if (!cleaned || cleaned.startsWith('#')) continue;
    const index = cleaned.indexOf('=');
    if (index > 0) out[cleaned.slice(0, index)] = cleaned.slice(index + 1).replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = { ...readEnv('/tmp/composer-helius-rpc.env'), ...process.env };
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
const connection = new Connection(rpcUrl, 'confirmed');
const idl = JSON.parse(fs.readFileSync(`${__dirname}/hastra-release-v0.0.6/idl/vault_stake.json`, 'utf8'));
const coder = new anchor.BorshAccountsCoder(idl);
const instructionNames = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await response.json();
  if (body.error && method !== 'simulateTransaction') throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body;
}

const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const hastraIx = (kind, amount, overrides = {}) => {
  const deposit = kind === 'deposit';
  const discriminator = Buffer.from(deposit ? 'f223c68952e1f2b6' : 'b80c569546c461e1', 'hex');
  const user = overrides.user || USER;
  const userWylds = overrides.userWylds || USER_WYLDS;
  const userPrime = overrides.userPrime || USER_PRIME;
  const keys = deposit ? [
    [STAKE_CONFIG, false, false], [VAULT_CONFIG, false, false], [HAS_VAULT, false, true],
    [VAULT_AUTHORITY, false, false], [PRIME, false, true], [WYLDS, false, true],
    [MINT_AUTHORITY, false, false], [user, true, false], [userWylds, false, true],
    [userPrime, false, true], [PRICE_CONFIG, false, false], [TOKEN, false, false],
  ] : [
    [STAKE_CONFIG, false, false], [VAULT_CONFIG, false, false], [HAS_VAULT, false, true],
    [VAULT_AUTHORITY, false, false], [user, true, true], [HAS, false, false],
    [userWylds, false, true], [userPrime, false, true], [PRIME, false, true],
    [WYLDS, false, true], [PRICE_CONFIG, false, false], [TOKEN, false, false],
  ];
  return new TransactionInstruction({
    programId: HAS,
    keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
    data: Buffer.concat([discriminator, u64(amount)]),
  });
};

const history = require('./kamino-flash-history.json').hits[0].transaction;
const historyMessage = history.transaction.message;
const historyKeys = [...historyMessage.accountKeys, ...(history.meta.loadedAddresses?.writable || []), ...(history.meta.loadedAddresses?.readonly || [])];
const header = historyMessage.header;
const writable = (index) => index < historyMessage.accountKeys.length
  ? (index < header.numRequiredSignatures
    ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
    : index < historyMessage.accountKeys.length - header.numReadonlyUnsignedAccounts)
  : index < historyMessage.accountKeys.length + (history.meta.loadedAddresses?.writable?.length || 0);
const historyIx = (index) => {
  const ix = historyMessage.instructions[index];
  return new TransactionInstruction({
    programId: P(historyKeys[ix.programIdIndex]),
    keys: ix.accounts.map((keyIndex) => ({
      pubkey: P(historyKeys[keyIndex]),
      isSigner: keyIndex < header.numRequiredSignatures,
      isWritable: writable(keyIndex),
    })),
    data: Buffer.from(bs58.decode(ix.data)),
  });
};
const borrowTemplate = historyIx(3);
const repayTemplate = historyIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND)) {
  throw new Error('KLend history template indexes changed');
}

function flashIx(kind, reserve, amount, borrowIndex = 0) {
  const template = kind === 'borrow' ? borrowTemplate : repayTemplate;
  const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('lma'), reserve.market.toBuffer()], KLEND);
  const keys = template.keys.map((key) => ({ ...key }));
  const replacements = [USER, marketAuthority, reserve.market, reserve.reserve, reserve.mint,
    reserve.supply, reserve.userToken, reserve.fee, KLEND, KLEND];
  replacements.forEach((pubkey, index) => { keys[index].pubkey = pubkey; });
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  if (kind === 'repay') data[16] = borrowIndex;
  return new TransactionInstruction({ programId: KLEND, keys, data });
}

async function confirmedTargetInstruction(signature, wantedName) {
  const response = await rpc('getTransaction', [signature, {
    encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  const tx = response.result;
  if (!tx) throw new Error(`historical template transaction unavailable: ${signature}`);
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map((key) => typeof key === 'string' ? key : key.pubkey);
  const all = [...staticKeys, ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = message.header;
  const isWritable = (index) => index < staticKeys.length
    ? (index < header.numRequiredSignatures
      ? index < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : index < staticKeys.length - header.numReadonlyUnsignedAccounts)
    : index < staticKeys.length + (tx.meta.loadedAddresses?.writable?.length || 0);
  for (const ix of message.instructions) {
    if (all[ix.programIdIndex] !== HAS.toBase58()) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    if (instructionNames.get(data.subarray(0, 8).toString('hex')) !== wantedName) continue;
    return new TransactionInstruction({
      programId: HAS,
      keys: ix.accounts.map((index) => ({
        pubkey: P(all[index]), isSigner: index < header.numRequiredSignatures, isWritable: isWritable(index),
      })),
      data,
    });
  }
  throw new Error(`${wantedName} instruction not found in ${signature}`);
}

function tokenAmount(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function mintSupply(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 45 ? data.readBigUInt64LE(36).toString() : null;
}

const watched = [USER_WYLDS, USER_PRIME, HAS_VAULT, PRIME,
  RESERVES.wylds.supply, RESERVES.wylds.fee, RESERVES.wylds.reserve,
  RESERVES.prime.supply, RESERVES.prime.fee, RESERVES.prime.reserve, PRICE_CONFIG];
const roles = ['userWylds', 'userPrime', 'hastraVault', 'primeMint',
  'klendWyldsSupply', 'klendWyldsFee', 'klendWyldsReserve',
  'klendPrimeSupply', 'klendPrimeFee', 'klendPrimeReserve', 'priceConfig'];
function image(accounts) {
  return Object.fromEntries(roles.map((role, index) => {
    const account = accounts?.[index];
    const address = watched[index].toBase58();
    if (!account) return [role, { address, exists: false }];
    if (role === 'primeMint') return [role, { address, supplyRaw: mintSupply(account) }];
    if (role === 'priceConfig') {
      const data = Buffer.from(account.data[0], 'base64');
      const decoded = coder.decode('StakePriceConfig', data);
      return [role, {
        address,
        priceRaw: decoded.price.toString(10),
        scaleRaw: (decoded.priceScale ?? decoded.price_scale).toString(10),
        timestamp: (decoded.priceTimestamp ?? decoded.price_timestamp).toString(10),
        dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
      }];
    }
    if (role.endsWith('Reserve')) {
      const data = Buffer.from(account.data[0], 'base64');
      return [role, { address, availableRaw: data.readBigUInt64LE(224).toString(),
        flashFeeSf: data.readBigUInt64LE(4904).toString(),
        dataSha256: crypto.createHash('sha256').update(data).digest('hex') }];
    }
    return [role, { address, rawAmount: tokenAmount(account) }];
  }));
}
function deltas(pre, post) {
  const out = {};
  for (const role of roles) {
    const before = pre[role]?.rawAmount ?? pre[role]?.supplyRaw;
    const after = post[role]?.rawAmount ?? post[role]?.supplyRaw;
    if (before != null && after != null) out[role] = (BigInt(after) - BigInt(before)).toString();
  }
  return out;
}

(async () => {
  const latest = await connection.getLatestBlockhashAndContext('confirmed');
  const blockhash = latest.value.blockhash;
  let freshnessFloor = latest.context.slot;
  try {
    const prior = JSON.parse(fs.readFileSync(`${__dirname}/hastra-v1-simulations.json`, 'utf8'));
    for (const row of prior.results || []) {
      if (Number.isSafeInteger(row.slot)) freshnessFloor = Math.max(freshnessFloor, row.slot);
    }
  } catch (_) {
    // The first run has no prior simulation slot; getLatestBlockhash supplies the floor.
  }
  const preContext = await rpc('getMultipleAccounts', [watched.map(String), {
    encoding: 'base64', commitment: 'confirmed', minContextSlot: freshnessFloor,
  }]);
  const pre = image(preContext.result.value);
  const price = BigInt(pre.priceConfig.priceRaw);
  const scale = BigInt(pre.priceConfig.scaleRaw);
  const directAssets = 1_000_000n;
  const directShares = directAssets * scale / price;
  const directReturned = directShares * price / scale;

  for (const name of ['wylds', 'prime']) {
    if (pre[`klend${name[0].toUpperCase()}${name.slice(1)}Reserve`].flashFeeSf !== '0') {
      throw new Error(`${name} KLend reserve is not exact zero fee`);
    }
  }
  const inventory = {
    wylds: BigInt(pre.klendWyldsReserve.availableRaw),
    prime: BigInt(pre.klendPrimeReserve.availableRaw),
  };
  const results = [];

  const publishTemplate = await confirmedTargetInstruction(
    'TCRGVmYqyjTpXfnT3jkhpD2WirW2xzWiFtEwr8REZZJpBKTR5AuJEhrz42deZ1zSVbMGYsRfPEULbBBZHhaLFEJ',
    'publish_rewards',
  );
  const attemptedPublicationId = 11448;
  const attemptedRewardRaw = 1n;
  const publicationData = Buffer.from(publishTemplate.data);
  publicationData.writeUInt32LE(attemptedPublicationId, 8);
  publicationData.writeBigUInt64LE(attemptedRewardRaw, 12);
  const publicationIdLe = Buffer.alloc(4);
  publicationIdLe.writeUInt32LE(attemptedPublicationId);
  const [attemptedRewardRecord] = PublicKey.findProgramAddressSync([
    Buffer.from('reward_record'), publicationIdLe, u64(attemptedRewardRaw),
  ], HAS);
  const outsiderPublish = new TransactionInstruction({
    programId: HAS,
    keys: publishTemplate.keys.map((key, index) => index === 6
      ? { ...key, pubkey: USER, isSigner: true }
      : index === 13 ? { ...key, pubkey: attemptedRewardRecord } : { ...key }),
    data: publicationData,
  });

  const verifyTemplate = await confirmedTargetInstruction(
    'DHiUji3MPDprRJ8NUyQPoWHs2Ej1TP8f9VNkMcF9ADKFDsDC8YDF5DsCogJB84xgnXDo4BaYmdpDT7KFUiCFQem',
    'verify_price',
  );
  const outsiderVerify = new TransactionInstruction({
    programId: HAS,
    keys: verifyTemplate.keys.map((key, index) => index === 6
      ? { ...key, pubkey: USER, isSigner: true }
      : { ...key }),
    data: Buffer.from(verifyTemplate.data),
  });

  async function simulate(name, instructions, metadata) {
    let encoded;
    try {
      encoded = encodeV1(instructions, USER, blockhash);
    } catch (error) {
      results.push({ name, metadata, localError: error.stack });
      return;
    }
    const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', innerInstructions: true,
      accounts: { encoding: 'base64', addresses: watched.map(String) },
    }]);
    const value = response.result?.value;
    const post = image(value?.accounts);
    const row = {
      name, metadata,
      slot: response.result?.context?.slot,
      rpcError: response.error || null,
      err: value?.err ?? null,
      transport: {
        version: 1, bytes: encoded.sizeBytes, addressCount: encoded.addressCount,
        writableCount: encoded.writableCount, instructionCount: encoded.instructionCount,
        requiredSignatures: encoded.requiredSignatures, under4096Bytes: encoded.sizeBytes <= 4096,
      },
      unitsConsumed: value?.unitsConsumed,
      loadedAccountsDataSize: value?.loadedAccountsDataSize,
      post,
      deltas: deltas(pre, post),
      logs: value?.logs || [],
    };
    row.reconciliation = {
      klendWyldsPrincipalFullyRepaid: post.klendWyldsSupply?.rawAmount === pre.klendWyldsSupply.rawAmount,
      klendWyldsFeeUnchanged: post.klendWyldsFee?.rawAmount === pre.klendWyldsFee.rawAmount,
      klendWyldsReserveAvailableRestored: post.klendWyldsReserve?.availableRaw === pre.klendWyldsReserve.availableRaw,
      klendWyldsReserveMatchesSupply: post.klendWyldsReserve?.availableRaw === post.klendWyldsSupply?.rawAmount,
      klendWyldsFlashFeeSfUnchanged: post.klendWyldsReserve?.flashFeeSf === pre.klendWyldsReserve.flashFeeSf,
      klendPrimePrincipalFullyRepaid: post.klendPrimeSupply?.rawAmount === pre.klendPrimeSupply.rawAmount,
      klendPrimeFeeUnchanged: post.klendPrimeFee?.rawAmount === pre.klendPrimeFee.rawAmount,
      klendPrimeReserveAvailableRestored: post.klendPrimeReserve?.availableRaw === pre.klendPrimeReserve.availableRaw,
      klendPrimeReserveMatchesSupply: post.klendPrimeReserve?.availableRaw === post.klendPrimeSupply?.rawAmount,
      klendPrimeFlashFeeSfUnchanged: post.klendPrimeReserve?.flashFeeSf === pre.klendPrimeReserve.flashFeeSf,
      hastraShareSupplyDelta: row.deltas.primeMint ?? null,
      hastraVaultDelta: row.deltas.hastraVault ?? null,
      userWyldsDelta: row.deltas.userWylds ?? null,
      userPrimeDelta: row.deltas.userPrime ?? null,
      priceConfigUnchanged: post.priceConfig?.dataSha256 === pre.priceConfig.dataSha256,
      wyldsEconomicDeltaSum: row.deltas.userWylds != null && row.deltas.hastraVault != null
        ? (BigInt(row.deltas.userWylds) + BigInt(row.deltas.hastraVault)
          + BigInt(row.deltas.klendWyldsSupply || 0) + BigInt(row.deltas.klendWyldsFee || 0)).toString()
        : null,
      primeUserEqualsMintSupplyDelta: row.deltas.userPrime != null && row.deltas.primeMint != null
        ? row.deltas.userPrime === row.deltas.primeMint
        : null,
    };
    results.push(row);
    process.stdout.write(JSON.stringify({ name, err: row.err, bytes: row.transport.bytes,
      accounts: row.transport.addressCount, units: row.unitsConsumed, deltas: row.deltas,
      reconciliation: row.reconciliation, tail: row.logs.filter((line) => /Instruction:|failed|Error/.test(line)).slice(-8) }) + '\n');
  }

  await simulate('permissionless_deposit_positive_control', [hastraIx('deposit', directAssets)], {
    assetsRaw: directAssets.toString(), expectedSharesRaw: directShares.toString(),
  });
  await simulate('permissionless_deposit_redeem_roundtrip', [
    hastraIx('deposit', directAssets), hastraIx('redeem', directShares),
  ], {
    assetsInRaw: directAssets.toString(), sharesRaw: directShares.toString(),
    assetsReturnedRaw: directReturned.toString(), expectedUserLossRaw: (directAssets - directReturned).toString(),
  });
  await simulate('deposit_vault_alias_rejected', [hastraIx('deposit', directAssets, { userWylds: HAS_VAULT })], {
    mutation: 'attacker supplies the configured program vault as the user source',
  });

  await simulate('outsider_atomic_flash_deposit_publish_redeem_repay_rejected', [
    flashIx('borrow', RESERVES.wylds, directAssets),
    hastraIx('deposit', directAssets),
    outsiderPublish,
    hastraIx('redeem', directShares),
    flashIx('repay', RESERVES.wylds, directAssets, 0),
  ], {
    mutation: 'quiet outsider replaces the rewards administrator in a current-account publish_rewards template',
    expectedGuard: 'InvalidRewardsAdministrator',
  });

  await simulate('outsider_atomic_flash_deposit_verify_redeem_repay_rejected', [
    flashIx('borrow', RESERVES.wylds, directAssets),
    hastraIx('deposit', directAssets),
    outsiderVerify,
    hastraIx('redeem', directShares),
    flashIx('repay', RESERVES.wylds, directAssets, 0),
  ], {
    mutation: 'quiet outsider replaces the rewards administrator in a confirmed verify_price template',
    expectedGuard: 'InvalidRewardsAdministrator',
  });

  for (const [size, amount] of [['dust', 1_000_000n], ['near_available', inventory.wylds - 1n]]) {
    const shares = amount * scale / price;
    const returned = shares * price / scale;
    await simulate(`klend_wylds_${size}_flash_deposit_redeem_repay`, [
      flashIx('borrow', RESERVES.wylds, amount),
      hastraIx('deposit', amount),
      hastraIx('redeem', shares),
      flashIx('repay', RESERVES.wylds, amount, 0),
    ], { lenderAsset: 'wYLDS', borrowRaw: amount.toString(), sharesRaw: shares.toString(),
      returnedRaw: returned.toString(), userSubsidyRaw: (amount - returned).toString() });
  }

  for (const [size, amount] of [['dust', 1_000_000n], ['near_available', inventory.prime - 1n]]) {
    const redeemedAssets = amount * price / scale;
    const depositAssets = (amount * price + scale - 1n) / scale;
    const remintedShares = depositAssets * scale / price;
    await simulate(`klend_prime_${size}_flash_redeem_deposit_repay`, [
      flashIx('borrow', RESERVES.prime, amount),
      hastraIx('redeem', amount),
      hastraIx('deposit', depositAssets),
      flashIx('repay', RESERVES.prime, amount, 0),
    ], { lenderAsset: 'PRIME', borrowRaw: amount.toString(), redeemedAssetsRaw: redeemedAssets.toString(),
      depositAssetsRaw: depositAssets.toString(), remintedSharesRaw: remintedShares.toString(),
      userWyldsSubsidyRaw: (depositAssets - redeemedAssets).toString() });
  }

  await simulate('klend_wylds_flash_repay_before_redeem_ordering', [
    flashIx('borrow', RESERVES.wylds, directAssets),
    hastraIx('deposit', directAssets),
    flashIx('repay', RESERVES.wylds, directAssets, 0),
    hastraIx('redeem', directShares),
  ], { mutation: 'repayment precedes the Hastra redeem; full transaction still reconciles atomically' });
  await simulate('klend_prime_flash_redeem_floor_then_repay_consumes_one_prime', [
    flashIx('borrow', RESERVES.prime, directAssets),
    hastraIx('redeem', directAssets),
    hastraIx('deposit', directAssets * price / scale),
    flashIx('repay', RESERVES.prime, directAssets, 0),
  ], { mutation: 'deposit only the floored redeemed wYLDS; repayment consumes one pre-existing raw PRIME rather than producing gain' });

  const output = {
    generatedAt: new Date().toISOString(),
    method: 'current-mainnet read-only simulateTransaction; sigVerify=false; custom atomic v1 messages; never signed or submitted',
    rpcEndpointRedacted: true,
    verifiedTarget: { programId: HAS.toBase58(), sourceCommit: '121e4cc600b976a97faa018359e00bda48113ec2', release: 'v0.0.6' },
    sourcePositiveControl: { signature: '2R7QJqN1R4SdX4FyYR5zjDirX6FQtcgLPSHhZBAn4h9QRuKA2DeXkrAbKCagEgqPzCGZbXPc1qwCQAAzz7NxxymE', note: 'confirmed permissionless redeem establishes the live path; simulations use a quieter current holder selected with hastra-holder-discovery.js', simulationUser: USER.toBase58() },
    price: { raw: price.toString(), scale: scale.toString(), assetsPerShareScaled1e9: (price * 1_000_000_000n / scale).toString() },
    lenderInventory: {
      wylds: { ...Object.fromEntries(Object.entries(RESERVES.wylds).map(([key, value]) => [key, String(value)])), availableRaw: inventory.wylds.toString(), flashFeeSf: '0' },
      prime: { ...Object.fromEntries(Object.entries(RESERVES.prime).map(([key, value]) => [key, String(value)])), availableRaw: inventory.prime.toString(), flashFeeSf: '0' },
    },
    preSlot: preContext.result.context.slot,
    requestedFreshnessFloor: freshnessFloor,
    pre,
    results,
  };
  fs.writeFileSync(`${__dirname}/hastra-v1-simulations.json`, JSON.stringify(output, null, 2) + '\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
