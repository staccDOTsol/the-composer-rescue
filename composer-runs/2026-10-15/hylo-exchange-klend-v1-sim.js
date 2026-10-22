#!/usr/bin/env node
// Read-only current-mainnet KLend JitoSOL flash -> Hylo mint/redeem -> repay probes.
// Emits real 4096-byte-format Solana v1 messages, but never signs or submits them.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const {
  PublicKey,
  TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./hylo-exchange-v1-wire.js');

const ROOT = __dirname;
const OUT = `${ROOT}/hylo-exchange-klend-v1-sim.json`;
const ENV = '/tmp/composer-helius-rpc.env';
const CENSUS = `${ROOT}/klend-zero-fee-census.json`;
const FLASH_HISTORY = `${ROOT}/kamino-flash-history.json`;

const HYLO = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
const KLEND = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const JITOSOL = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const SOL_USD_FEED = new PublicKey('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
// A real, fully verified Pyth Receiver SOL/USD PriceUpdateV2 with the same
// feed id but historical publish time. This distinguishes a canonical-address
// check from mere account-owner/discriminator validation.
const HISTORICAL_SOL_USD_FEED = new PublicKey('GGdMnioYUC8qFWrWXJP2n3YHAns49MJW87CeuT7sgvrf');
const HYLO_STATE = PublicKey.findProgramAddressSync([Buffer.from('hylo')], HYLO)[0];
const HYUSD = PublicKey.findProgramAddressSync([Buffer.from('hyUSD')], HYLO)[0];
const XSOL = PublicKey.findProgramAddressSync([Buffer.from('xSOL')], HYLO)[0];
const FEE_AUTH = PublicKey.findProgramAddressSync([Buffer.from('fee_auth'), JITOSOL.toBuffer()], HYLO)[0];
const VAULT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('vault_auth'), JITOSOL.toBuffer()], HYLO)[0];
const STABLE_AUTH = PublicKey.findProgramAddressSync([Buffer.from('mint_auth'), HYUSD.toBuffer()], HYLO)[0];
const LEVER_AUTH = PublicKey.findProgramAddressSync([Buffer.from('mint_auth'), XSOL.toBuffer()], HYLO)[0];
const LST_HEADER = PublicKey.findProgramAddressSync([Buffer.from('lst_header'), JITOSOL.toBuffer()], HYLO)[0];
const EVENT_AUTH = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], HYLO)[0];
const FEE_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, FEE_AUTH, true);
const LST_VAULT = spl.getAssociatedTokenAddressSync(JITOSOL, VAULT_AUTH, true);

function readEnv(path) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const env = readEnv(ENV);
const rpcUrl = env.RPC_URL || env.HEAVY_RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

function u64(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function ixData(discriminator, amount) {
  return Buffer.concat([Buffer.from(discriminator), u64(amount), Buffer.from([0])]);
}

function mintStableIx(user, userJito, userHyusd, amount) {
  return new TransactionInstruction({
    programId: HYLO,
    keys: [
      {pubkey: user, isSigner: true, isWritable: true},
      {pubkey: HYLO_STATE, isSigner: false, isWritable: true},
      {pubkey: FEE_AUTH, isSigner: false, isWritable: false},
      {pubkey: VAULT_AUTH, isSigner: false, isWritable: false},
      {pubkey: STABLE_AUTH, isSigner: false, isWritable: false},
      {pubkey: FEE_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_VAULT, isSigner: false, isWritable: true},
      {pubkey: LST_HEADER, isSigner: false, isWritable: false},
      {pubkey: userJito, isSigner: false, isWritable: true},
      {pubkey: userHyusd, isSigner: false, isWritable: true},
      {pubkey: JITOSOL, isSigner: false, isWritable: false},
      {pubkey: HYUSD, isSigner: false, isWritable: true},
      {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
      {pubkey: TOKEN, isSigner: false, isWritable: false},
      {pubkey: EVENT_AUTH, isSigner: false, isWritable: false},
      {pubkey: HYLO, isSigner: false, isWritable: false},
    ],
    data: ixData([6, 208, 28, 175, 229, 35, 145, 226], amount),
  });
}

function redeemStableIx(user, userJito, userHyusd, amount) {
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
      {pubkey: userHyusd, isSigner: false, isWritable: true},
      {pubkey: userJito, isSigner: false, isWritable: true},
      {pubkey: HYUSD, isSigner: false, isWritable: true},
      {pubkey: JITOSOL, isSigner: false, isWritable: false},
      {pubkey: SOL_USD_FEED, isSigner: false, isWritable: false},
      {pubkey: TOKEN, isSigner: false, isWritable: false},
      {pubkey: EVENT_AUTH, isSigner: false, isWritable: false},
      {pubkey: HYLO, isSigner: false, isWritable: false},
    ],
    data: ixData([12, 230, 189, 126, 110, 233, 234, 195], amount),
  });
}

function mintLeverIx(user, userJito, userXsol, amount) {
  const ix = mintStableIx(user, userJito, userXsol, amount);
  ix.keys[4].pubkey = LEVER_AUTH;
  ix.keys[11].pubkey = XSOL;
  ix.data = ixData([184, 75, 99, 100, 153, 64, 243, 68], amount);
  return ix;
}

function redeemLeverIx(user, userJito, userXsol, amount) {
  const ix = redeemStableIx(user, userJito, userXsol, amount);
  ix.keys[9].pubkey = XSOL;
  ix.data = ixData([34, 147, 66, 197, 160, 82, 147, 202], amount);
  return ix;
}

function historicalIx(index, flashHistory) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const header = msg.header;
  const writable = i => i < staticKeys.length
    ? (i < header.numRequiredSignatures
      ? i < header.numRequiredSignatures - header.numReadonlySignedAccounts
      : i < staticKeys.length - header.numReadonlyUnsignedAccounts)
    : i < staticKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return new TransactionInstruction({
    programId: new PublicKey(allKeys[source.programIdIndex]),
    keys: source.accounts.map(i => ({
      pubkey: new PublicKey(allKeys[i]),
      isSigner: i < header.numRequiredSignatures,
      isWritable: writable(i),
    })),
    data: Buffer.from(bs58.decode(source.data)),
  });
}

function flashIx(template, reserve, user, userToken, amount, repayIndex) {
  const keys = template.keys.map(x => ({...x}));
  const market = new PublicKey(reserve.market);
  const authority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const replacements = {
    0: user,
    1: authority,
    2: market,
    3: new PublicKey(reserve.reserve),
    4: JITOSOL,
    5: new PublicKey(reserve.supplyVault),
    6: userToken,
    7: new PublicKey(reserve.feeVault),
    11: TOKEN,
  };
  for (const [index, value] of Object.entries(replacements)) keys[Number(index)].pubkey = value;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function tokenAccount(account) {
  if (!account || account.owner !== TOKEN.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return null;
  return {
    mint: bs58.encode(data.subarray(0, 32)),
    authority: bs58.encode(data.subarray(32, 64)),
    amount: data.readBigUInt64LE(64).toString(),
  };
}

function mintAccount(account) {
  if (!account || account.owner !== TOKEN.toBase58()) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 45) return null;
  return {supply: data.readBigUInt64LE(36).toString(), decimals: data[44]};
}

async function findOutsider() {
  const largest = await rpc('getTokenLargestAccounts', [JITOSOL.toBase58(), {commitment: 'confirmed'}]);
  const addresses = largest.value.map(row => row.address);
  const page = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  const candidates = page.value.map((account, i) => {
    const decoded = tokenAccount(account);
    if (!decoded || !PublicKey.isOnCurve(new PublicKey(decoded.authority).toBytes())) return null;
    return {token: addresses[i], owner: decoded.authority, amount: decoded.amount};
  }).filter(Boolean);
  if (!candidates.length) throw new Error('No on-curve owner among largest JitoSOL accounts');
  const owners = [...new Set(candidates.map(row => row.owner))];
  const ownerPage = await rpc('getMultipleAccounts', [owners, {encoding: 'base64', commitment: 'confirmed'}]);
  const ownerInfo = new Map(owners.map((owner, i) => [owner, ownerPage.value[i]]));
  const usable = candidates
    .filter(row => ownerInfo.get(row.owner)?.owner === SYSTEM.toBase58() && ownerInfo.get(row.owner)?.lamports > 5_000_000)
    .sort((a, b) => BigInt(a.amount) > BigInt(b.amount) ? -1 : 1)[0];
  if (!usable) throw new Error('No funded on-curve System owner among largest JitoSOL accounts');
  return {...usable, ownerLamports: ownerInfo.get(usable.owner).lamports, observedSlot: ownerPage.context.slot};
}

function summarizeAccount(account, kind) {
  if (!account) return null;
  if (kind === 'token') return tokenAccount(account);
  if (kind === 'mint') return mintAccount(account);
  const data = Buffer.from(account.data[0], 'base64');
  return {
    owner: account.owner,
    lamports: account.lamports,
    dataLength: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

function amountOf(snapshot, label) {
  const value = snapshot[label];
  if (!value) return 0n;
  if (value.amount !== undefined) return BigInt(value.amount);
  if (value.supply !== undefined) return BigInt(value.supply);
  return null;
}

function deltaSnapshot(pre, post) {
  const out = {};
  for (const key of Object.keys(pre)) {
    const a = amountOf(pre, key);
    const b = amountOf(post, key);
    out[key] = a !== null && b !== null ? (b - a).toString()
      : JSON.stringify(pre[key]) === JSON.stringify(post[key]) ? 'unchanged' : 'changed';
  }
  return out;
}

function parsedTokenMovements(inner) {
  const out = [];
  for (const group of inner || []) for (const ix of group.instructions || []) {
    const parsed = ix.parsed?.info;
    if (!parsed) continue;
    const amount = parsed.tokenAmount?.amount ?? parsed.amount;
    if (amount === undefined) continue;
    out.push({
      outerInstructionIndex: group.index,
      type: ix.parsed.type,
      source: parsed.source || null,
      destination: parsed.destination || null,
      mint: parsed.mint || null,
      authority: parsed.authority || parsed.multisigAuthority || null,
      amount: String(amount),
    });
  }
  return out;
}

async function main() {
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'));
  const flashHistory = JSON.parse(fs.readFileSync(FLASH_HISTORY, 'utf8'));
  const reserve = census.activeZero
    .filter(row => row.mint === JITOSOL.toBase58() && row.status === 0 && row.emergencyMode === 0 && row.flashFeeSf === '0')
    .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1)[0];
  if (!reserve) throw new Error('No active zero-rate JitoSOL KLend reserve');
  const outsider = await findOutsider();
  const user = new PublicKey(outsider.owner);
  const userJito = new PublicKey(outsider.token);
  const userHyusd = spl.getAssociatedTokenAddressSync(HYUSD, user);
  const userXsol = spl.getAssociatedTokenAddressSync(XSOL, user);
  const createHyusd = spl.createAssociatedTokenAccountIdempotentInstruction(user, userHyusd, user, HYUSD);
  const createXsol = spl.createAssociatedTokenAccountIdempotentInstruction(user, userXsol, user, XSOL);
  const borrowTemplate = historicalIx(3, flashHistory);
  const repayTemplate = historicalIx(13, flashHistory);
  if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND)) {
    throw new Error('Historical KLend flash instruction template indexes changed');
  }

  const tracked = [
    ['outsider_jitosol', userJito, 'token'],
    ['outsider_hyusd', userHyusd, 'token'],
    ['klend_supply_vault', new PublicKey(reserve.supplyVault), 'token'],
    ['klend_fee_vault', new PublicKey(reserve.feeVault), 'token'],
    ['hylo_jitosol_vault', LST_VAULT, 'token'],
    ['hylo_jitosol_fee_vault', FEE_VAULT, 'token'],
    ['hyusd_mint', HYUSD, 'mint'],
    ['hylo_state', HYLO_STATE, 'raw'],
    ['klend_reserve', new PublicKey(reserve.reserve), 'raw'],
    ['outsider_xsol', userXsol, 'token'],
    ['xsol_mint', XSOL, 'mint'],
  ];
  const prePage = await rpc('getMultipleAccounts', [tracked.map(row => row[1].toBase58()), {
    encoding: 'base64', commitment: 'confirmed',
  }]);
  const pre = Object.fromEntries(tracked.map((row, i) => [row[0], summarizeAccount(prePage.value[i], row[2])]));
  const reserveData = Buffer.from(prePage.value[8].data[0], 'base64');
  const currentAvailable = reserveData.readBigUInt64LE(224);
  const currentFlashFeeSf = reserveData.readBigUInt64LE(4904);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'confirmed'}])).value.blockhash;
  const results = [];

  async function simulate(label, instructions, includeWire = false) {
    let encoded;
    try {
      encoded = encodeV1(instructions, user, blockhash);
    } catch (error) {
      const local = {label, localCompositionError: error.message};
      results.push(local);
      return local;
    }
    const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
      encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
      innerInstructions: true,
      accounts: {encoding: 'base64', addresses: tracked.map(row => row[1].toBase58())},
    }]);
    const value = response.value;
    const succeeded = value.err === null;
    const post = succeeded
      ? Object.fromEntries(tracked.map((row, i) => [row[0], summarizeAccount(value.accounts?.[i], row[2])]))
      : null;
    const tokenMovements = parsedTokenMovements(value.innerInstructions);
    const result = {
      label,
      slot: response.context?.slot,
      err: value.err,
      sizeBytes: encoded.sizeBytes,
      v0Bytes: encoded.v0Bytes,
      addressCount: encoded.addressCount,
      writableCount: encoded.writableCount,
      instructionCount: encoded.instructionCount,
      requiredSignatures: encoded.requiredSignatures,
      wireSha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
      ...(includeWire ? {wireBase64: encoded.wire.toString('base64')} : {}),
      unitsConsumed: value.unitsConsumed,
      loadedAccountsDataSize: value.loadedAccountsDataSize,
      returnData: value.returnData || null,
      pre,
      post,
      // Failed Solana transactions are atomic. RPCs return null post-accounts on
      // failure, so computing numeric deltas against them would be misleading.
      balanceDeltasRaw: succeeded ? deltaSnapshot(pre, post) : null,
      atomicRollbackExpected: !succeeded,
      parsedTokenMovements: tokenMovements,
      logs: value.logs,
    };
    results.push(result);
    return result;
  }

  function bundle(amount, redeemAmount = null, wrongAccounts = null) {
    const borrow = flashIx(borrowTemplate, reserve, user, userJito, amount);
    const mint = mintStableIx(user, userJito, userHyusd, amount);
    if (wrongAccounts === 'substitute_lst_vault') mint.keys[6].pubkey = new PublicKey(reserve.supplyVault);
    const middle = [createHyusd, borrow, mint];
    if (redeemAmount !== null) {
      const redeem = redeemStableIx(user, userJito, userHyusd, redeemAmount);
      if (wrongAccounts === 'substitute_lst_header') redeem.keys[6].pubkey = HYLO_STATE;
      middle.push(redeem);
    }
    const borrowIndex = 1;
    middle.push(flashIx(repayTemplate, reserve, user, userJito, amount, borrowIndex));
    return middle;
  }

  function leverBundle(amount, redeemAmount = null, wrongAccounts = null) {
    const borrow = flashIx(borrowTemplate, reserve, user, userJito, amount);
    const mint = mintLeverIx(user, userJito, userXsol, amount);
    if (wrongAccounts === 'substitute_lst_vault') mint.keys[6].pubkey = new PublicKey(reserve.supplyVault);
    if (wrongAccounts === 'substitute_sol_usd_feed') mint.keys[12].pubkey = LST_HEADER;
    if (wrongAccounts === 'substitute_historical_same_feed') mint.keys[12].pubkey = HISTORICAL_SOL_USD_FEED;
    const middle = [createXsol, borrow, mint];
    if (redeemAmount !== null) {
      const redeem = redeemLeverIx(user, userJito, userXsol, redeemAmount);
      if (wrongAccounts === 'substitute_lst_header') redeem.keys[6].pubkey = HYLO_STATE;
      middle.push(redeem);
    }
    middle.push(flashIx(repayTemplate, reserve, user, userJito, amount, 1));
    return middle;
  }

  const oneJito = 1_000_000_000n;
  const requested = [
    ['dust_1_raw', 1n],
    ['dust_2_raw', 2n],
    ['dust_10_raw', 10n],
    ['dust_1000_raw', 1000n],
    ['one_jitosol', oneJito],
    ['hundred_jitosol', 100n * oneJito],
    ['near_liquidity_90pct', currentAvailable * 90n / 100n],
    ['near_liquidity_minus_one', currentAvailable - 1n],
    ['exact_liquidity', currentAvailable],
    ['liquidity_plus_one', currentAvailable + 1n],
  ];

  for (const [label, amount] of requested) {
    const quote = await simulate(`${label}_flash_mint_quote_then_repay`, bundle(amount), label === 'one_jitosol');
    let minted = quote.parsedTokenMovements
      ?.filter(row => (row.type === 'mintTo' || row.type === 'mintToChecked') &&
        (row.destination === userHyusd.toBase58() || row.mint === HYUSD.toBase58()))
      .reduce((sum, row) => sum + BigInt(row.amount), 0n) || 0n;
    if (minted === 0n && quote.err === null && quote.balanceDeltasRaw?.outsider_hyusd !== undefined) {
      const observedDelta = BigInt(quote.balanceDeltasRaw.outsider_hyusd);
      if (observedDelta > 0n) minted = observedDelta;
    }
    quote.derivedMintedHyusdRaw = minted.toString();
    if (minted > 0n) {
      const roundtrip = await simulate(`${label}_flash_mint_redeem_full_repay`, bundle(amount, minted), label === 'near_liquidity_minus_one');
      roundtrip.flashAmountRaw = amount.toString();
      roundtrip.redeemAmountHyusdRaw = minted.toString();
      const jitoDelta = roundtrip.balanceDeltasRaw?.outsider_jitosol;
      const hyusdDelta = roundtrip.balanceDeltasRaw?.outsider_hyusd;
      roundtrip.outsiderNetAssetGain = roundtrip.err === null && jitoDelta !== undefined && hyusdDelta !== undefined
        ? (BigInt(jitoDelta) > 0n || (BigInt(jitoDelta) === 0n && BigInt(hyusdDelta) > 0n))
        : false;
      roundtrip.fullRepaymentProven = roundtrip.err === null
        && roundtrip.balanceDeltasRaw?.klend_supply_vault === '0'
        && roundtrip.balanceDeltasRaw?.klend_fee_vault === '0';
    }
  }


  for (const [label, amount] of [
    ['lever_dust_10_raw', 10n],
    ['lever_one_jitosol', oneJito],
    ['lever_hundred_jitosol', 100n * oneJito],
    ['lever_near_liquidity_90pct', currentAvailable * 90n / 100n],
    ['lever_near_liquidity_minus_one', currentAvailable - 1n],
    ['lever_exact_liquidity', currentAvailable],
  ]) {
    const quote = await simulate(`${label}_flash_mint_quote_then_repay`, leverBundle(amount), label === 'lever_one_jitosol');
    let minted = quote.parsedTokenMovements
      ?.filter(row => (row.type === 'mintTo' || row.type === 'mintToChecked') &&
        (row.destination === userXsol.toBase58() || row.mint === XSOL.toBase58()))
      .reduce((sum, row) => sum + BigInt(row.amount), 0n) || 0n;
    if (quote.err === null && quote.balanceDeltasRaw?.outsider_xsol !== undefined) {
      const observedDelta = BigInt(quote.balanceDeltasRaw.outsider_xsol);
      if (observedDelta > 0n) minted = observedDelta;
    }
    quote.derivedMintedXsolRaw = minted.toString();
    if (minted > 0n) {
      const roundtrip = await simulate(`${label}_flash_mint_redeem_full_repay`, leverBundle(amount, minted), label === 'lever_hundred_jitosol');
      roundtrip.flashAmountRaw = amount.toString();
      roundtrip.redeemAmountXsolRaw = minted.toString();
      const jitoDelta = roundtrip.balanceDeltasRaw?.outsider_jitosol;
      const xsolDelta = roundtrip.balanceDeltasRaw?.outsider_xsol;
      roundtrip.outsiderNetAssetGain = roundtrip.err === null && jitoDelta !== undefined && xsolDelta !== undefined
        ? (BigInt(jitoDelta) > 0n || (BigInt(jitoDelta) === 0n && BigInt(xsolDelta) > 0n))
        : false;
      roundtrip.fullRepaymentProven = roundtrip.err === null
        && roundtrip.balanceDeltasRaw?.klend_supply_vault === '0'
        && roundtrip.balanceDeltasRaw?.klend_fee_vault === '0';
    }
  }

  await simulate('account_substitution_hylo_lst_vault_with_klend_supply_vault', bundle(oneJito, null, 'substitute_lst_vault'));
  const baseline = results.find(row => row.label === 'one_jitosol_flash_mint_quote_then_repay');
  const baselineMinted = BigInt(baseline?.derivedMintedHyusdRaw || 0);
  if (baselineMinted > 0n) {
    await simulate('account_substitution_redeem_lst_header_with_hylo_state', bundle(oneJito, baselineMinted, 'substitute_lst_header'));
    const ordered = bundle(oneJito, baselineMinted);
    await simulate('ordering_redeem_before_mint', [ordered[0], ordered[1], ordered[3], ordered[2], ordered[4]]);
    await simulate('ordering_repay_before_redeem', [ordered[0], ordered[1], ordered[2], ordered[4], ordered[3]]);
  }

  // Run substitution and same-transaction ordering controls on the levercoin
  // path too; unlike stablecoin redemption, this path is live at the current CR.
  await simulate('lever_account_substitution_hylo_lst_vault_with_klend_supply_vault',
    leverBundle(oneJito, null, 'substitute_lst_vault'));
  await simulate('lever_account_substitution_sol_usd_feed_with_lst_header',
    leverBundle(oneJito, null, 'substitute_sol_usd_feed'));
  await simulate('lever_oracle_substitution_verified_historical_same_feed',
    leverBundle(oneJito, null, 'substitute_historical_same_feed'));
  const leverBaseline = results.find(row => row.label === 'lever_one_jitosol_flash_mint_quote_then_repay');
  const leverBaselineMinted = BigInt(leverBaseline?.derivedMintedXsolRaw || 0);
  if (leverBaselineMinted > 0n) {
    await simulate('lever_account_substitution_redeem_lst_header_with_hylo_state',
      leverBundle(oneJito, leverBaselineMinted, 'substitute_lst_header'));
    const ordered = leverBundle(oneJito, leverBaselineMinted);
    await simulate('lever_ordering_redeem_before_mint',
      [ordered[0], ordered[1], ordered[3], ordered[2], ordered[4]]);
    await simulate('lever_ordering_repay_before_redeem',
      [ordered[0], ordered[1], ordered[2], ordered[4], ordered[3]]);

    const twice = 2n * oneJito;
    await simulate('lever_ordering_two_sequential_mint_redeem_cycles_full_repay', [
      createXsol,
      flashIx(borrowTemplate, reserve, user, userJito, twice),
      mintLeverIx(user, userJito, userXsol, oneJito),
      redeemLeverIx(user, userJito, userXsol, leverBaselineMinted),
      mintLeverIx(user, userJito, userXsol, oneJito),
      redeemLeverIx(user, userJito, userXsol, leverBaselineMinted),
      flashIx(repayTemplate, reserve, user, userJito, twice, 1),
    ], true);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'read-only current-mainnet simulateTransaction; real no-ALT 4096-byte Solana v1 wire; sigVerify=false; no signing or submission',
    rpcEndpointRedacted: true,
    noTransactionsSubmitted: true,
    signerModel: {
      address: user.toBase58(),
      onCurve: PublicKey.isOnCurve(user.toBytes()),
      systemOwnedAtObservation: true,
      startingLamports: outsider.ownerLamports,
      signatureVerificationDisabledOnlyForSimulation: true,
    },
    programs: {hylo: HYLO.toBase58(), klend: KLEND.toBase58(), token: TOKEN.toBase58()},
    mints: {jitosol: JITOSOL.toBase58(), hyusd: HYUSD.toBase58(), xsol: XSOL.toBase58()},
    accounts: {
      userJitosol: userJito.toBase58(), userHyusd: userHyusd.toBase58(), userXsol: userXsol.toBase58(), hyloState: HYLO_STATE.toBase58(),
      feeAuth: FEE_AUTH.toBase58(), vaultAuth: VAULT_AUTH.toBase58(), stablecoinAuth: STABLE_AUTH.toBase58(), levercoinAuth: LEVER_AUTH.toBase58(),
      feeVault: FEE_VAULT.toBase58(), lstVault: LST_VAULT.toBase58(), lstHeader: LST_HEADER.toBase58(),
      solUsdPythFeed: SOL_USD_FEED.toBase58(), eventAuthority: EVENT_AUTH.toBase58(),
      historicalSameFeedControl: HISTORICAL_SOL_USD_FEED.toBase58(),
    },
    klendReserve: {
      ...reserve,
      currentAvailableRaw: currentAvailable.toString(),
      currentFlashFeeSf: currentFlashFeeSf.toString(),
      currentFlashFeeExactZero: currentFlashFeeSf === 0n,
    },
    sourceFlashTemplate: {signature: flashHistory.hits[0].signature, slot: flashHistory.hits[0].slot},
    preObservationSlot: prePage.context.slot,
    pre,
    cases: results,
    conclusion: {
      reportableOutsiderGainObserved: results.some(row => row.outsiderNetAssetGain === true && row.fullRepaymentProven === true),
      successfulFullRoundTrips: results.filter(row => row.fullRepaymentProven === true).map(row => row.label),
    },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    outputPath: OUT,
    observationSlot: prePage.context.slot,
    signer: output.signerModel,
    reserve: {reserve: reserve.reserve, currentAvailableRaw: currentAvailable.toString(), currentFlashFeeSf: currentFlashFeeSf.toString()},
    resultCount: results.length,
    cases: results.map(row => ({
      label: row.label,
      err: row.err ?? row.localCompositionError ?? null,
      bytes: row.sizeBytes,
      accounts: row.addressCount,
      mintedHyusdRaw: row.derivedMintedHyusdRaw,
      deltas: row.balanceDeltasRaw,
      fullRepayment: row.fullRepaymentProven,
      outsiderGain: row.outsiderNetAssetGain,
      logTail: row.logs?.slice(-5),
    })),
    conclusion: output.conclusion,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
