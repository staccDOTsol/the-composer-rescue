#!/usr/bin/env node
'use strict';

// Signer-enforcing, fork-only Solana v1 adversarial matrix for the PRIME NTT
// manager. Public mainnet state is imported lazily into Surfpool; only fresh,
// locally generated attacker accounts receive synthetic SOL. This script never
// calls sendTransaction on either the fork or mainnet.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
} = require(MODULES + '@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require(MODULES + '@solana/spl-token');
const bs58Module = require(MODULES + 'bs58');
const bs58 = bs58Module.default || bs58Module;
const anchor = require(MODULES + '@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');

const OUT = __dirname;
const OUTPUT = path.join(OUT, 'prime-second-signed-multiflash-v1.json');
const FORK = process.env.PRIME_FORK_RPC || 'http://127.0.0.1:9027';
const P = value => new PublicKey(value);
const PROGRAM = P('4T5m5NtRVewiCVzP2mnfeUoMYRqncfkrS21X2dhVCNRT');
const CONFIG = P('BH8E4JJJs3RGWAzQB6AQpzPdmHAGWjffxChatt8Tvi4Q');
const TOKEN_AUTHORITY = P('XcVU4Nhzjzg69VRcpybnoFWT98oQANV58F7guE6mRza');
const CUSTODY = P('7ND1JXFtoH8nn4rvRUvukDwAKgGuJ6uDtFTfTaR9VXiC');
const PRIME = P('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const TARGET_INBOX = P('2KgyxKGVxAE26QWJmBnM1REAzXj5o99yzs1WdRb3GXjg');
const OTHER_INBOX = P('AJbUkmKGuGaUhPJUNPgaqYkUXH2U29rvT8ewbeTzdZRM');
const MIN_INBOX = P('6CXfZuWFT6xkGc93iyfoFjEEvWcgs9UxrHakAWAEMy6o');
const MAX_INBOX = P('9ymRzurX2jDP7F2XVSKeWGKac626KcJpfF5SMN9gFkRa');
const TARGET_MESSAGE = P('DK6deken2FeaLVbDwzkSjQBwp98pZYuxBDvUbEJSjby6');
const OTHER_MESSAGE = P('Ht52BsFZX7KKRUvvVmhQBWXhZDDApovpnpyvcS27ZhD9');
const TARGET_VAA = P('9CfmvWrL1EBVuYw8N1bu6ugjh9nwzpZrRADtpffNb3bc');
const OTHER_VAA = P('2sZMfPEjZKtBsnYHWaDHxjbT8wt4vsqt9TrMa1tPyTJw');
const MIN_RECIPIENT_OWNER = P('5mcfpAMophavx1m15v4YYPNUrv4vqErAUzJV7Ct5wr7v');
const MAX_RECIPIENT_OWNER = P('8NVg9LBdWsEnakdzMsAoDo8tif6vJf8ANG3wpCBpzCx8');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RESERVE = P('BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh');
const MARKET = P('CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA');
const SUPPLY = P('FkSkbRU5A6JXRXo5uaFwCS7jQ6jHYa1DxFtfpXfTz352');
const FEE_VAULT = P('C8zsSvMzpVP4atgHTHQVwmFMer2smzdavQnaK3owTRdB');
const SCOPE_PRICES = P('3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const P0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL = P('So11111111111111111111111111111111111111112');
const JUP_FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const JUP_LIQUIDITY_PROGRAM = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const JUP_LIQUIDITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const JUP_ADMIN = P('G1qKidJxv6dxBn7TDEx7KSbvovCJQkwzpXbAHQCZxhrn');
const USDE = P('DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT');
const JUP_RESERVE = P('GSadisGhwK2bokEHa6ZyEJsXLXmCYAJreeJ4Wo9NL5Uw');
const JUP_RATE_MODEL = P('vNiLDiUi6ur36mF2UxcNDzWNgV8xHmzR6jc4bTHbfLY');
const JUP_VAULT = P('3V949ufzT2viNuvTNHNmJyRMeof9JBSxZ4qQ3XsHTrb3');
const JUP_POSITION = P('c9j4YxC7NfPAjrBmr6cquda6W4hVvaKCpaZ6NFVzG5h');
const JUP_BORROW_DISC = Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]);
const JUP_REPAY_DISC = Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]);
const SAVE = P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
const MEMO = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const LOADER = P('BPFLoaderUpgradeab1e11111111111111111111111');
const PROGRAM_DATA = P('BCYEL6mfLCvPQaCCzgUJq4SUYihr6x75rpANhBKtaMx8');
const SYSTEM = SystemProgram.programId;

const TARGET_SIGNATURE = '5NAJ7FJSTjscmTRiNSYKh5KdJKCESRAxcQAF45VePoJfjAafW3kR9xgcjy5vugHdnLPZfcszxyBtSMB57CFoFX2D';
const OTHER_SIGNATURE = '45vhvjR5qn8YY62PJYhq4Sks9NSmW4TNe7nfkyeobBQNX5TAbXsoKHTjTP7jWcfV6czPBBNLyLxb8XdMq8nQFjRp';
const OUTBOUND_SIGNATURE = '5FhrDJ5XW77FemaqkFKMmDSiLkR4D454jiVjDcYkoRKgDDvVwbUziyqPV7Nk6MJkze1tqXNUXVSnneWAXW91HKWo';
const P0_SOURCE_SIGNATURE = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SAVE_SOURCE_SIGNATURE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';

function readEnv() {
  const file = ['/tmp/composer-helius-rpc.env', '/tmp/composer-helius-only.env'].find(fs.existsSync);
  if (!file) throw new Error('authenticated RPC environment file unavailable');
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2)));
}
const ENV = readEnv();
const UPSTREAMS = [...new Set([ENV.RPC_URL, ENV.HEAVY_RPC_URL].filter(Boolean))];
if (!UPSTREAMS.length) throw new Error('authenticated upstream RPC unavailable');

let rpcId = 0;
async function rpc(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function upstream(method, params) {
  const failures = [];
  for (const endpoint of UPSTREAMS) {
    try { return await rpc(endpoint, method, params); }
    catch (error) { failures.push(error.message); }
  }
  throw new Error(`${method}: every authenticated upstream failed (${failures.join('; ')})`);
}
const fork = (method, params) => rpc(FORK, method, params);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const discriminator = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const clone = (ix, changes = {}, data = ix.data) => new TransactionInstruction({
  programId: changes.programId || ix.programId,
  keys: ix.keys.map((key, index) => ({...key, ...(changes[index] || {})})),
  data: Buffer.from(data),
});

function historicalIx(tx, index) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const writableLoaded = tx.meta?.loadedAddresses?.writable || [];
  const readonlyLoaded = tx.meta?.loadedAddresses?.readonly || [];
  const keys = [...staticKeys, ...writableLoaded, ...readonlyLoaded];
  const h = message.header;
  const writable = keyIndex => keyIndex < staticKeys.length
    ? (keyIndex < h.numRequiredSignatures
      ? keyIndex < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : keyIndex < staticKeys.length - h.numReadonlyUnsignedAccounts)
    : keyIndex < staticKeys.length + writableLoaded.length;
  const source = message.instructions[index];
  if (!source) throw new Error(`historical instruction ${index} unavailable`);
  return new TransactionInstruction({programId: P(keys[source.programIdIndex]),
    keys: source.accounts.map(keyIndex => ({pubkey: P(keys[keyIndex]),
      isSigner: keyIndex < h.numRequiredSignatures, isWritable: writable(keyIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}

function signV1(encoded, instructions, payer, blockhash, signerMap) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  for (let i = 0; i < signerOrder.length; i++) {
    const keypair = signerMap.get(signerOrder[i]);
    if (!keypair) throw new Error(`uncontrolled required signer ${signerOrder[i]}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey)
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + i * 64);
  }
  return {signed, signerOrder};
}

const marginfiIdl = JSON.parse(fs.readFileSync(path.join(OUT,
  'marginfi-source/fuzz/crucible/idls/marginfi_program.json'), 'utf8'));
const marginfiCoder = new anchor.BorshAccountsCoder(marginfiIdl);
const reserveIdl = JSON.parse(fs.readFileSync(path.join(OUT,
  'marginfi-source/idls-complete/kamino_lending.json'), 'utf8'));
const reserveCoder = new anchor.BorshAccountsCoder(reserveIdl);
const jupFlashIdl = JSON.parse(fs.readFileSync(path.join(OUT,
  'jup6qf-onchain-flash-idl.json'), 'utf8'));
const jupLiquidityIdl = JSON.parse(fs.readFileSync(path.join(OUT,
  'jup6qf-onchain-idl.json'), 'utf8'));
const jupFlashCoder = new anchor.BorshAccountsCoder(jupFlashIdl);
const jupLiquidityCoder = new anchor.BorshAccountsCoder(jupLiquidityIdl);
function fixedRaw(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return value.toString();
}
function accountImage(row, address, p0Bank) {
  if (!row?.data) return null;
  const data = Buffer.from(row.data[0], 'base64');
  const base = {owner: row.owner, lamports: String(row.lamports), dataLength: data.length,
    dataSha256: sha256(data)};
  if (row.owner === TOKEN_PROGRAM_ID.toBase58() && data.length === 165) return {...base,
    kind: 'splTokenAccount', mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    amountRaw: data.readBigUInt64LE(64).toString()};
  if (address === RESERVE.toBase58()) {
    try {
      const decoded = reserveCoder.decode('Reserve', data);
      return {...base, kind: 'klendReserve',
        availableRaw: decoded.liquidity.total_available_amount.toString(),
        borrowedAmountSf: decoded.liquidity.borrowed_amount_sf.toString(),
        flashLoanFeeSf: decoded.config.fees.flash_loan_fee_sf.toString(),
        lastUpdateSlot: decoded.last_update.slot.toString(),
        lastUpdateStale: Number(decoded.last_update.stale),
        priceStatus: Number(decoded.last_update.price_status)};
    } catch (error) { return {...base, kind: 'klendReserve', decodeError: error.message}; }
  }
  if (p0Bank && address === p0Bank.toBase58()) {
    try {
      const decoded = marginfiCoder.decode('Bank', data);
      return {...base, kind: 'marginfiBank', mint: decoded.mint.toBase58(),
        totalAssetSharesI80F48Raw: fixedRaw(decoded.total_asset_shares),
        totalLiabilitySharesI80F48Raw: fixedRaw(decoded.total_liability_shares),
        assetShareValueI80F48Raw: fixedRaw(decoded.asset_share_value),
        liabilityShareValueI80F48Raw: fixedRaw(decoded.liability_share_value),
        groupFeesI80F48Raw: fixedRaw(decoded.collected_group_fees_outstanding),
        programFeesI80F48Raw: fixedRaw(decoded.collected_program_fees_outstanding)};
    } catch (error) { return {...base, kind: 'marginfiBank', decodeError: error.message}; }
  }
  if (address === JUP_ADMIN.toBase58()) {
    try {
      const decoded = jupFlashCoder.decode('FlashloanAdmin', data);
      return {...base, kind: 'jupiterFlashAdmin', feeBps: String(decoded.flashloan_fee),
        active: Boolean(decoded.is_flashloan_active),
        activeAmountRaw: String(decoded.active_flashloan_amount),
        liquidityProgram: decoded.liquidity_program.toBase58()};
    } catch (error) { return {...base, kind: 'jupiterFlashAdmin', decodeError: error.message}; }
  }
  if (address === JUP_POSITION.toBase58()) {
    try {
      const decoded = jupLiquidityCoder.decode('UserBorrowPosition', data);
      return {...base, kind: 'jupiterBorrowPosition', protocol: decoded.protocol.toBase58(),
        mint: decoded.mint.toBase58(), amountRaw: String(decoded.amount),
        debtCeilingRaw: String(decoded.debt_ceiling),
        maxDebtCeilingRaw: String(decoded.max_debt_ceiling), status: Number(decoded.status)};
    } catch (error) { return {...base, kind: 'jupiterBorrowPosition', decodeError: error.message}; }
  }
  if (row.owner === P0.toBase58()) {
    try {
      const decoded = marginfiCoder.decode('MarginfiAccount', data);
      return {...base, kind: 'marginfiAccount', authority: decoded.authority.toBase58(),
        group: decoded.group.toBase58(), activeBalances: decoded.lending_account.balances
          .filter(balance => balance.active).map(balance => ({bank: balance.bank_pk.toBase58(),
            assetSharesI80F48Raw: fixedRaw(balance.asset_shares),
            liabilitySharesI80F48Raw: fixedRaw(balance.liability_shares),
            premiumOutstandingI80F48Raw: fixedRaw(balance.premium_outstanding)}))};
    } catch (_) {}
  }
  return {...base, kind: 'opaque'};
}

function imageDelta(before, after) {
  if (!before && !after) return {existsBefore: false, existsAfter: false};
  const result = {existsBefore: Boolean(before), existsAfter: Boolean(after),
    dataChanged: before && after ? before.dataSha256 !== after.dataSha256 : before !== after,
    lamportsDelta: before && after ? (BigInt(after.lamports) - BigInt(before.lamports)).toString()
      : after ? after.lamports : before ? `-${before.lamports}` : null};
  for (const field of ['amountRaw', 'availableRaw', 'borrowedAmountSf',
    'totalAssetSharesI80F48Raw', 'totalLiabilitySharesI80F48Raw',
    'groupFeesI80F48Raw', 'programFeesI80F48Raw', 'activeAmountRaw']) {
    const beforeValue = before?.[field] !== undefined ? before[field]
      : after?.[field] !== undefined ? '0' : undefined;
    const afterValue = after?.[field] !== undefined ? after[field]
      : before?.[field] !== undefined ? '0' : undefined;
    if (beforeValue !== undefined && afterValue !== undefined)
      result[`${field}Delta`] = (BigInt(afterValue) - BigInt(beforeValue)).toString();
  }
  if (after?.kind === 'marginfiAccount') result.activeBalancesAfter = after.activeBalances;
  if (after?.kind === 'jupiterFlashAdmin') result.jupiterFlashActiveAfter = after.active;
  return result;
}

function padTo4096(instructions, payer, blockhash) {
  const empty = new TransactionInstruction({programId: MEMO, keys: [], data: Buffer.alloc(0)});
  const withEmpty = [...instructions.slice(0, -1), empty, instructions.at(-1)];
  const base = encodeV1(withEmpty, payer, blockhash);
  const bytes = 4096 - base.sizeBytes;
  if (bytes < 0) throw new Error(`cannot pad ${base.sizeBytes}-byte transaction to 4096`);
  const memo = new TransactionInstruction({programId: MEMO, keys: [], data: Buffer.alloc(bytes, 0x50)});
  const padded = [...instructions.slice(0, -1), memo, instructions.at(-1)];
  const encoded = encodeV1(padded, payer, blockhash);
  if (encoded.sizeBytes !== 4096) throw new Error(`padding produced ${encoded.sizeBytes} bytes`);
  return {instructions: padded, paddingMemoBytes: bytes};
}

async function main() {
  const authority = Keypair.generate();
  const marginfiAccount = Keypair.generate();
  const outboxItem = Keypair.generate();
  const attackerPrime = getAssociatedTokenAddressSync(PRIME, authority.publicKey);
  const attackerUsdc = getAssociatedTokenAddressSync(USDC, authority.publicKey);
  const attackerUsde = getAssociatedTokenAddressSync(USDE, authority.publicKey);
  const attackerWsol = getAssociatedTokenAddressSync(WSOL, authority.publicKey);
  const minRecipientToken = getAssociatedTokenAddressSync(PRIME, MIN_RECIPIENT_OWNER, true);
  const maxRecipientToken = getAssociatedTokenAddressSync(PRIME, MAX_RECIPIENT_OWNER, true);
  const marketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), MARKET.toBuffer()], KLEND)[0];
  if (!marketAuthority.equals(P('9SLBVnPz8dRGvafST6zNBZYSSt3HtdU68XQLGR13t3uM')))
    throw new Error('KLend market-authority derivation changed');

  await fork('surfnet_setAccount', [authority.publicKey.toBase58(), {data: '', executable: false,
    lamports: 2_000_000_000_000_000, owner: SYSTEM.toBase58(), rentEpoch: 0}]);

  const [targetTx, otherTx, outboundTx, p0Source, saveSource] = await Promise.all([
    upstream('getTransaction', [TARGET_SIGNATURE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [OTHER_SIGNATURE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [OUTBOUND_SIGNATURE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [P0_SOURCE_SIGNATURE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
    upstream('getTransaction', [SAVE_SOURCE_SIGNATURE,
      {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]),
  ]);
  if (![targetTx, otherTx, outboundTx, p0Source, saveSource].every(Boolean))
    throw new Error('one or more historical templates are unavailable');

  const asPayer = ix => clone(ix, {0: {pubkey: authority.publicKey, isSigner: true, isWritable: true}});
  const receiveTarget = asPayer(historicalIx(targetTx, 0));
  const redeemTarget = asPayer(historicalIx(targetTx, 1));
  const releaseTarget = asPayer(historicalIx(targetTx, 2));
  const receiveOther = asPayer(historicalIx(otherTx, 3));
  const redeemOther = asPayer(historicalIx(otherTx, 4));
  const releaseOther = asPayer(historicalIx(otherTx, 5));
  const outboundTemplate = historicalIx(outboundTx, 1);
  for (const [ix, expected, label] of [
    [receiveTarget, '86d58f44eb66e860', 'receive'],
    [redeemTarget, 'b80c569546c461e1', 'redeem'],
    [releaseTarget, 'b6a23ecec5895362', 'release'],
    [outboundTemplate, 'b39e9294972eb0c8', 'transferLock'],
  ]) if (ix.data.subarray(0, 8).toString('hex') !== expected)
    throw new Error(`${label} discriminator changed`);

  const p0StartTemplate = clone(historicalIx(p0Source, 1));
  const p0BorrowTemplate = clone(historicalIx(p0Source, 2));
  const p0RepayTemplate = clone(historicalIx(p0Source, 5));
  const p0EndTemplate = clone(historicalIx(p0Source, 6));
  if (![p0StartTemplate, p0BorrowTemplate, p0RepayTemplate, p0EndTemplate]
    .every(ix => ix.programId.equals(P0))) throw new Error('Project0 template changed');
  const p0Group = p0BorrowTemplate.keys[0].pubkey;
  const p0Bank = p0BorrowTemplate.keys[3].pubkey;
  const p0Vault = p0BorrowTemplate.keys[6].pubkey;

  const saveBorrowTemplate = clone(historicalIx(saveSource, 6));
  const saveRepayTemplate = clone(historicalIx(saveSource, 12));
  if (!saveBorrowTemplate.programId.equals(SAVE) || !saveRepayTemplate.programId.equals(SAVE))
    throw new Error('Save flash template changed');
  const saveSupply = saveBorrowTemplate.keys[0].pubkey;
  const saveReserve = saveBorrowTemplate.keys[2].pubkey;
  const saveFeeVault = saveRepayTemplate.keys[2].pubkey;

  const klendHistory = JSON.parse(fs.readFileSync(path.join(OUT, 'kamino-flash-history.json'), 'utf8'));
  const klendBorrowTemplate = clone(historicalIx(klendHistory.hits[0].transaction, 3));
  const klendRepayTemplate = clone(historicalIx(klendHistory.hits[0].transaction, 13));
  function klendBorrow(amount) {
    const ix = clone(klendBorrowTemplate);
    for (const [index, pubkey] of Object.entries({0: authority.publicKey, 1: marketAuthority,
      2: MARKET, 3: RESERVE, 4: PRIME, 5: SUPPLY, 6: attackerPrime, 7: FEE_VAULT,
      8: KLEND, 9: KLEND, 10: IX_SYSVAR, 11: TOKEN_PROGRAM_ID})) ix.keys[+index].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 8);
    return ix;
  }
  function klendRefresh() {
    return new TransactionInstruction({programId: KLEND, keys: [
      {pubkey: RESERVE, isSigner: false, isWritable: true},
      {pubkey: MARKET, isSigner: false, isWritable: false},
      {pubkey: KLEND, isSigner: false, isWritable: false},
      {pubkey: KLEND, isSigner: false, isWritable: false},
      {pubkey: KLEND, isSigner: false, isWritable: false},
      {pubkey: SCOPE_PRICES, isSigner: false, isWritable: false},
    ], data: Buffer.from([2, 218, 138, 235, 79, 201, 25, 102])});
  }
  function klendRepay(amount, borrowIndex) {
    const ix = clone(klendRepayTemplate);
    for (const [index, pubkey] of Object.entries({0: authority.publicKey, 1: marketAuthority,
      2: MARKET, 3: RESERVE, 4: PRIME, 5: SUPPLY, 6: attackerPrime, 7: FEE_VAULT,
      8: KLEND, 9: KLEND, 10: IX_SYSVAR, 11: TOKEN_PROGRAM_ID})) ix.keys[+index].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 8);
    ix.data[16] = borrowIndex;
    return ix;
  }
  function p0Parts(amount) {
    const start = clone(p0StartTemplate), borrow = clone(p0BorrowTemplate),
      repay = clone(p0RepayTemplate), end = clone(p0EndTemplate);
    start.keys[0].pubkey = marginfiAccount.publicKey;
    start.keys[1].pubkey = authority.publicKey;
    borrow.keys[1].pubkey = marginfiAccount.publicKey;
    borrow.keys[2].pubkey = authority.publicKey;
    borrow.keys[4].pubkey = attackerUsdc;
    repay.keys[1].pubkey = marginfiAccount.publicKey;
    repay.keys[2].pubkey = authority.publicKey;
    repay.keys[4].pubkey = attackerUsdc;
    end.keys[0].pubkey = marginfiAccount.publicKey;
    end.keys[2].pubkey = authority.publicKey;
    borrow.data.writeBigUInt64LE(BigInt(amount), 8);
    repay.data.writeBigUInt64LE(BigInt(amount), 8);
    return {start, borrow, repay, end};
  }
  function saveParts(amount) {
    const borrow = clone(saveBorrowTemplate), repay = clone(saveRepayTemplate);
    borrow.keys[1].pubkey = attackerWsol;
    repay.keys[0].pubkey = attackerWsol;
    repay.keys[3].pubkey = attackerWsol;
    repay.keys[6].pubkey = authority.publicKey;
    borrow.data.writeBigUInt64LE(BigInt(amount), 1);
    repay.data.writeBigUInt64LE(BigInt(amount), 1);
    return {borrow, repay};
  }
  const initMarginfi = new TransactionInstruction({programId: P0, keys: [
    {pubkey: p0Group, isSigner: false, isWritable: false},
    {pubkey: marginfiAccount.publicKey, isSigner: true, isWritable: true},
    {pubkey: authority.publicKey, isSigner: true, isWritable: false},
    {pubkey: authority.publicKey, isSigner: true, isWritable: true},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});
  const createPrime = () => createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,
    attackerPrime, authority.publicKey, PRIME);
  const createUsdc = () => createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,
    attackerUsdc, authority.publicKey, USDC);
  const createUsde = () => createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,
    attackerUsde, authority.publicKey, USDE);
  const createWsol = () => createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,
    attackerWsol, authority.publicKey, WSOL);
  function jupiterPair(amount) {
    const keys = [
      {pubkey: authority.publicKey, isSigner: true, isWritable: true},
      {pubkey: JUP_ADMIN, isSigner: false, isWritable: true},
      {pubkey: attackerUsde, isSigner: false, isWritable: true},
      {pubkey: USDE, isSigner: false, isWritable: false},
      {pubkey: JUP_RESERVE, isSigner: false, isWritable: true},
      {pubkey: JUP_POSITION, isSigner: false, isWritable: true},
      {pubkey: JUP_RATE_MODEL, isSigner: false, isWritable: false},
      {pubkey: JUP_VAULT, isSigner: false, isWritable: true},
      {pubkey: JUP_LIQUIDITY, isSigner: false, isWritable: false},
      {pubkey: JUP_LIQUIDITY_PROGRAM, isSigner: false, isWritable: false},
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
      {pubkey: SYSTEM, isSigner: false, isWritable: false},
      {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
    ];
    const amountData = Buffer.alloc(8); amountData.writeBigUInt64LE(BigInt(amount));
    const make = disc => new TransactionInstruction({programId: JUP_FLASH,
      keys: keys.map(key => ({...key})), data: Buffer.concat([disc, amountData])});
    return {borrow: make(JUP_BORROW_DISC), repay: make(JUP_REPAY_DISC)};
  }
  const versionIx = new TransactionInstruction({programId: PROGRAM, keys: [],
    data: discriminator('version')});

  function wrapKlend(candidate, amount) {
    const instructions = [createPrime(), klendRefresh(), klendBorrow(amount), ...candidate];
    instructions.push(klendRepay(amount, 2));
    return instructions;
  }
  function wrapP0(candidate, amount) {
    const p0 = p0Parts(amount);
    const instructions = [initMarginfi, createUsdc(), p0.start, p0.borrow, ...candidate,
      p0.repay, p0.end];
    p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
    return instructions;
  }
  function wrapJupiter(candidate, amount) {
    const jupiter = jupiterPair(amount);
    return [createUsde(), jupiter.borrow, ...candidate, jupiter.repay];
  }
  function wrapSave(candidate, amount) {
    const save = saveParts(amount);
    const fee = (BigInt(amount) * 4n + 9_999n) / 10_000n;
    const instructions = [createWsol(), save.borrow, ...candidate,
      SystemProgram.transfer({fromPubkey: authority.publicKey, toPubkey: attackerWsol,
        lamports: fee}),
      new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
        keys: [{pubkey: attackerWsol, isSigner: false, isWritable: true}],
        data: Buffer.from([17])}), save.repay];
    save.repay.data[9] = 1;
    return instructions;
  }
  function wrapDual(candidate, primeAmount, usdcAmount) {
    const p0 = p0Parts(usdcAmount);
    const instructions = [initMarginfi, createPrime(), createUsdc(), p0.start,
      klendRefresh(), klendBorrow(primeAmount), p0.borrow, ...candidate, p0.repay,
      klendRepay(primeAmount, 5), p0.end];
    p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
    return instructions;
  }
  function wrapTriple(candidate, primeAmount, usdcAmount, usdeAmount) {
    const p0 = p0Parts(usdcAmount), jupiter = jupiterPair(usdeAmount);
    const instructions = [initMarginfi, createPrime(), createUsdc(), createUsde(), p0.start,
      klendRefresh(), klendBorrow(primeAmount), jupiter.borrow, p0.borrow, ...candidate, p0.repay,
      jupiter.repay, klendRepay(primeAmount, 6), p0.end];
    p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
    return instructions;
  }
  function wrapQuad(candidate, saveAmount, primeAmount, usdcAmount, usdeAmount) {
    const save = saveParts(saveAmount), p0 = p0Parts(usdcAmount),
      jupiter = jupiterPair(usdeAmount);
    const fee = (BigInt(saveAmount) * 4n + 9_999n) / 10_000n;
    const instructions = [initMarginfi, createPrime(), createUsdc(), createUsde(), createWsol(),
      p0.start, save.borrow, klendRefresh(), klendBorrow(primeAmount), jupiter.borrow, p0.borrow,
      ...candidate, p0.repay, jupiter.repay,
      SystemProgram.transfer({fromPubkey: authority.publicKey, toPubkey: attackerWsol,
        lamports: fee}),
      new TransactionInstruction({programId: TOKEN_PROGRAM_ID,
        keys: [{pubkey: attackerWsol, isSigner: false, isWritable: true}],
        data: Buffer.from([17])}),
      klendRepay(primeAmount, 8), save.repay, p0.end];
    save.repay.data[9] = 6;
    p0.start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
    return instructions;
  }

  const staticTracked = [authority.publicKey, attackerPrime, attackerUsdc, attackerUsde,
    attackerWsol,
    marginfiAccount.publicKey, outboxItem.publicKey, CUSTODY, SUPPLY, FEE_VAULT, RESERVE,
    p0Vault, p0Bank, saveSupply, saveFeeVault, saveReserve,
    CONFIG, TARGET_INBOX, OTHER_INBOX, MIN_INBOX, MAX_INBOX,
    TARGET_MESSAGE, OTHER_MESSAGE, TARGET_VAA, OTHER_VAA, TOKEN_AUTHORITY, PRIME,
    minRecipientToken, maxRecipientToken, JUP_VAULT, JUP_RESERVE, JUP_POSITION, JUP_ADMIN];
  for (const address of staticTracked) await fork('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  const baselineRaw = await fork('getMultipleAccounts', [staticTracked.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  const baseline = Object.fromEntries(staticTracked.map((address, index) => [address.toBase58(),
    accountImage(baselineRaw.value[index], address.toBase58(), p0Bank)]));
  const klendAvailable = BigInt(baseline[RESERVE.toBase58()].availableRaw);
  const klendImportedLastUpdateSlot = Number(baseline[RESERVE.toBase58()].lastUpdateSlot);
  const p0VaultAvailable = BigInt(baseline[p0Vault.toBase58()].amountRaw);
  const saveReserveData = Buffer.from(baselineRaw.value[staticTracked.findIndex(address =>
    address.equals(saveReserve))].data[0], 'base64');
  if (saveReserveData.length !== 619) throw new Error('Save reserve layout changed');
  const saveAvailable = saveReserveData.readBigUInt64LE(171);
  const saveMint = new PublicKey(saveReserveData.subarray(42, 74));
  const jupiterVaultAvailable = BigInt(baseline[JUP_VAULT.toBase58()].amountRaw);
  const jupiterPosition = baseline[JUP_POSITION.toBase58()];
  const jupiterAdmin = baseline[JUP_ADMIN.toBase58()];
  const jupiterAvailable = [jupiterVaultAvailable,
    BigInt(jupiterPosition.debtCeilingRaw) - BigInt(jupiterPosition.amountRaw),
    BigInt(jupiterPosition.maxDebtCeilingRaw) - BigInt(jupiterPosition.amountRaw)]
    .reduce((minimum, value) => value < minimum ? value : minimum);
  if (baseline[RESERVE.toBase58()].flashLoanFeeSf !== '0')
    throw new Error('KLend PRIME flash fee is no longer zero');
  if (baseline[p0Vault.toBase58()].mint !== USDC.toBase58())
    throw new Error('Project0 source bank mint changed');
  if (!saveMint.equals(WSOL)) throw new Error('Save source reserve mint changed');
  if (baseline[JUP_VAULT.toBase58()].mint !== USDE.toBase58() ||
      jupiterPosition.mint !== USDE.toBase58()) throw new Error('Jupiter source mint changed');
  if (jupiterAdmin.feeBps !== '0') throw new Error('Jupiter flash fee is no longer zero');
  if (jupiterAvailable < 1000n) throw new Error('Jupiter usable capacity fell below minimum');

  // Lazy forks can import a just-updated reserve a few slots ahead of the
  // fork's initial clock. Wait only for the local clock to catch up; no lender
  // account is changed and every actual refresh remains inside simulation.
  const clockWaitStarted = Date.now();
  let forkSlotBeforeTests = await fork('getSlot', [{commitment: 'processed'}]);
  while (forkSlotBeforeTests < klendImportedLastUpdateSlot && Date.now() - clockWaitStarted < 60_000) {
    await new Promise(resolve => setTimeout(resolve, 500));
    forkSlotBeforeTests = await fork('getSlot', [{commitment: 'processed'}]);
  }
  if (forkSlotBeforeTests < klendImportedLastUpdateSlot) throw new Error(
    `fork clock ${forkSlotBeforeTests} remains behind imported KLend update ${klendImportedLastUpdateSlot}`);

  const bankDiscriminator = bs58.encode(Buffer.from([142, 49, 166, 242, 50, 66, 97, 188]));
  const knownBankRaw = await upstream('getAccountInfo', [p0Bank.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const bankSize = Buffer.from(knownBankRaw.value.data[0], 'base64').length;
  const primeP0Banks = await upstream('getProgramAccounts', [P0.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', filters: [
      {dataSize: bankSize}, {memcmp: {offset: 0, bytes: bankDiscriminator}},
      {memcmp: {offset: 8, bytes: PRIME.toBase58()}},
    ], dataSlice: {offset: 0, length: 0},
  }]);
  const primeSaveReserves = await upstream('getProgramAccounts', [SAVE.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', filters: [
      {dataSize: 619}, {memcmp: {offset: 42, bytes: PRIME.toBase58()}},
    ], dataSlice: {offset: 0, length: 0},
  }]);
  const jupPositionDiscriminator = bs58.encode(Buffer.from([73, 126, 65, 123, 220, 126, 197, 24]));
  const jupPositionRaw = await upstream('getAccountInfo', [JUP_POSITION.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const jupPositionSize = Buffer.from(jupPositionRaw.value.data[0], 'base64').length;
  const primeJupiterPositions = await upstream('getProgramAccounts', [JUP_LIQUIDITY_PROGRAM.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', filters: [
      {dataSize: jupPositionSize}, {memcmp: {offset: 0, bytes: jupPositionDiscriminator}},
      {memcmp: {offset: 40, bytes: PRIME.toBase58()}},
    ], dataSlice: {offset: 0, length: 0},
  }]);

  const signerMap = new Map([
    [authority.publicKey.toBase58(), authority],
    [marginfiAccount.publicKey.toBase58(), marginfiAccount],
    [outboxItem.publicKey.toBase58(), outboxItem],
  ]);
  const attackerControlledAccounts = [authority.publicKey, attackerPrime, attackerUsdc,
    attackerUsde, attackerWsol, marginfiAccount.publicKey, outboxItem.publicKey];
  const results = [];
  async function run(label, instructions, metadata = {}, compact = false) {
    const latest = await fork('getLatestBlockhash', [{commitment: 'processed'}]);
    const encoded = encodeV1(instructions, authority.publicKey, latest.value.blockhash);
    if (encoded.sizeBytes > 4096 || encoded.addressCount > 64)
      throw new Error(`v1 envelope exceeded for ${label}`);
    const {signed, signerOrder} = signV1(encoded, instructions, authority.publicKey,
      latest.value.blockhash, signerMap);
    const present = new Set([authority.publicKey, ...instructions.flatMap(ix =>
      [ix.programId, ...ix.keys.map(key => key.pubkey)])].map(String));
    const tracked = staticTracked.filter(address => present.has(address.toBase58()));
    const simulation = await fork('simulateTransaction', [signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: tracked.map(String)},
    }]);
    const post = Object.fromEntries(tracked.map((address, index) => [address.toBase58(),
      accountImage(simulation.value.accounts?.[index], address.toBase58(), p0Bank)]));
    const stateDeltas = Object.fromEntries(tracked.map(address => [address.toBase58(),
      imageDelta(baseline[address.toBase58()], post[address.toBase58()])]));
    const committed = simulation.value.err === null;
    const primeDelta = committed
      ? BigInt(stateDeltas[attackerPrime.toBase58()]?.amountRawDelta || 0) : 0n;
    const usdcDelta = committed
      ? BigInt(stateDeltas[attackerUsdc.toBase58()]?.amountRawDelta || 0) : 0n;
    const usdeDelta = committed
      ? BigInt(stateDeltas[attackerUsde.toBase58()]?.amountRawDelta || 0) : 0n;
    const wsolDelta = committed
      ? BigInt(stateDeltas[attackerWsol.toBase58()]?.amountRawDelta || 0) : 0n;
    const authorityLamportsDelta = committed
      ? BigInt(stateDeltas[authority.publicKey.toBase58()]?.lamportsDelta || 0) : 0n;
    const attackerControlledLamportsDelta = committed
      ? attackerControlledAccounts.reduce((sum, address) => sum +
        BigInt(stateDeltas[address.toBase58()]?.lamportsDelta || 0), 0n) : 0n;
    const activeBalances = post[marginfiAccount.publicKey.toBase58()]?.activeBalances || [];
    const nonzeroMarginfiLiability = activeBalances.some(balance =>
      BigInt(balance.liabilitySharesI80F48Raw) !== 0n ||
      BigInt(balance.premiumOutstandingI80F48Raw) !== 0n);
    const jupiterPositionAfter = post[JUP_POSITION.toBase58()];
    const jupiterAdminAfter = post[JUP_ADMIN.toBase58()];
    const nonzeroJupiterLiability = Boolean(jupiterPositionAfter &&
      BigInt(jupiterPositionAfter.amountRaw) !== BigInt(jupiterPosition.amountRaw));
    const activeJupiterFlash = Boolean(jupiterAdminAfter?.active) ||
      BigInt(jupiterAdminAfter?.activeAmountRaw || 0) !== 0n;
    const allLogs = simulation.value.logs || [];
    const result = {label, ...metadata, slot: simulation.context.slot,
      err: simulation.value.err, committed, signaturesVerified: true,
      replaceRecentBlockhash: false, signerOrder, allRequiredSignersControlled: true,
      targetProgramInvoked: allLogs.some(line => line.includes(`Program ${PROGRAM} invoke`)),
      saveProgramInvoked: allLogs.some(line => line.includes(`Program ${SAVE} invoke`)),
      wire: {version: 1, bytes: encoded.sizeBytes, addresses: encoded.addressCount,
        instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
        sha256: sha256(signed), withinLimits: encoded.sizeBytes <= 4096 && encoded.addressCount <= 64},
      unitsConsumed: simulation.value.unitsConsumed,
      loadedAccountsDataSize: simulation.value.loadedAccountsDataSize,
      tracked: tracked.map(String), stateDeltas,
      accounting: {attackerPrimeDeltaRaw: primeDelta.toString(),
        attackerUsdcDeltaRaw: usdcDelta.toString(), attackerUsdeDeltaRaw: usdeDelta.toString(),
        attackerWsolDeltaRaw: wsolDelta.toString(),
        attackerLamportsDeltaRaw: authorityLamportsDelta.toString(),
        attackerControlledLamportsDeltaRaw: attackerControlledLamportsDelta.toString(),
        marginfiActiveBalancesAfter: activeBalances,
        outstandingMarginfiLiability: nonzeroMarginfiLiability,
        jupiterBorrowPositionAmountAfterRaw: jupiterPositionAfter?.amountRaw || null,
        outstandingJupiterLiability: nonzeroJupiterLiability,
        jupiterFlashActiveAfter: jupiterAdminAfter?.active ?? null,
        jupiterFlashActiveAmountAfterRaw: jupiterAdminAfter?.activeAmountRaw || null,
        activeJupiterFlash,
        positiveOutsiderNetEquity: committed && !nonzeroMarginfiLiability &&
          !nonzeroJupiterLiability && !activeJupiterFlash &&
          (primeDelta > 0n || usdcDelta > 0n || usdeDelta > 0n ||
            attackerControlledLamportsDelta > 0n)},
      logs: allLogs.filter(line =>
        /Instruction:|Program log:|failed|success|Error|error/i.test(line)),
    };
    if (!compact) results.push(result);
    console.log(JSON.stringify({label, err: result.err, bytes: result.wire.bytes,
      addresses: result.wire.addresses, instructions: result.wire.instructions,
      signers: result.signerOrder.length, units: result.unitsConsumed,
      primeDelta: result.accounting.attackerPrimeDeltaRaw,
      usdcDelta: result.accounting.attackerUsdcDeltaRaw,
      usdeDelta: result.accounting.attackerUsdeDeltaRaw,
      wsolDelta: result.accounting.attackerWsolDeltaRaw,
      positive: result.accounting.positiveOutsiderNetEquity,
      finalLog: result.logs.at(-1) || null}));
    return result;
  }

  // Resolve actual usable Project0 capacity. The vault balance is only an upper
  // bound because the bank utilization limit can reject a smaller borrow.
  const p0CapacitySearch = [];
  async function p0Probe(amount, label) {
    const result = await run(label, wrapP0([versionIx], amount),
      {category: 'capacity-search', providers: ['project0'], p0UsdcRaw: amount.toString()}, true);
    p0CapacitySearch.push({amountRaw: amount.toString(), err: result.err,
      wireBytes: result.wire.bytes, addressCount: result.wire.addresses,
      unitsConsumed: result.unitsConsumed, finalLog: result.logs.at(-1) || null});
    return result.err === null;
  }
  const p0TwoWorks = await p0Probe(2n, 'p0_capacity_lower_control_2_raw');
  let p0Max = 0n;
  if (p0TwoWorks) {
    const fullWorks = await p0Probe(p0VaultAvailable, 'p0_capacity_vault_exact_probe');
    if (fullWorks) p0Max = p0VaultAvailable;
    else {
      let low = 2n, high = p0VaultAvailable;
      while (high - low > 1n) {
        const mid = (low + high) / 2n;
        if (await p0Probe(mid, `p0_capacity_binary_${mid}`)) low = mid;
        else high = mid;
      }
      p0Max = low;
    }
  }

  const boundaries = [
    ['klend_available_minus_1_signed_control', wrapKlend([versionIx], klendAvailable - 1n),
      {providers: ['klend'], klendPrimeRaw: (klendAvailable - 1n).toString()}],
    ['klend_available_exact_signed_control', wrapKlend([versionIx], klendAvailable),
      {providers: ['klend'], klendPrimeRaw: klendAvailable.toString()}],
    ['klend_available_plus_1_signed_negative', wrapKlend([versionIx], klendAvailable + 1n),
      {providers: ['klend'], klendPrimeRaw: (klendAvailable + 1n).toString()}],
    ['project0_one_raw_minimum_negative', wrapP0([versionIx], 1n),
      {providers: ['project0'], p0UsdcRaw: '1'}],
    ['project0_vault_minus_1_boundary', wrapP0([versionIx], p0VaultAvailable - 1n),
      {providers: ['project0'], p0UsdcRaw: (p0VaultAvailable - 1n).toString()}],
    ['project0_vault_exact_boundary', wrapP0([versionIx], p0VaultAvailable),
      {providers: ['project0'], p0UsdcRaw: p0VaultAvailable.toString()}],
    ['project0_vault_plus_1_boundary', wrapP0([versionIx], p0VaultAvailable + 1n),
      {providers: ['project0'], p0UsdcRaw: (p0VaultAvailable + 1n).toString()}],
    ['jupiter_minimum_minus_1_negative', wrapJupiter([versionIx], 999n),
      {providers: ['jupiter'], jupiterUsdeRaw: '999'}],
    ['jupiter_minimum_exact_control', wrapJupiter([versionIx], 1000n),
      {providers: ['jupiter'], jupiterUsdeRaw: '1000'}],
    ['jupiter_minimum_plus_1_control', wrapJupiter([versionIx], 1001n),
      {providers: ['jupiter'], jupiterUsdeRaw: '1001'}],
    ['jupiter_usable_maximum_minus_1', wrapJupiter([versionIx], jupiterAvailable - 1n),
      {providers: ['jupiter'], jupiterUsdeRaw: (jupiterAvailable - 1n).toString()}],
    ['jupiter_usable_maximum_exact', wrapJupiter([versionIx], jupiterAvailable),
      {providers: ['jupiter'], jupiterUsdeRaw: jupiterAvailable.toString()}],
    ['jupiter_usable_maximum_plus_1_negative', wrapJupiter([versionIx], jupiterAvailable + 1n),
      {providers: ['jupiter'], jupiterUsdeRaw: (jupiterAvailable + 1n).toString()}],
    ['save_small_route_probe', wrapSave([versionIx], 1_000_000n),
      {providers: ['save'], saveWsolRaw: '1000000'}],
    ['save_available_minus_1_route_probe', wrapSave([versionIx], saveAvailable - 1n),
      {providers: ['save'], saveWsolRaw: (saveAvailable - 1n).toString()}],
    ['save_available_exact_route_probe', wrapSave([versionIx], saveAvailable),
      {providers: ['save'], saveWsolRaw: saveAvailable.toString()}],
    ['save_available_plus_1_route_probe', wrapSave([versionIx], saveAvailable + 1n),
      {providers: ['save'], saveWsolRaw: (saveAvailable + 1n).toString()}],
  ];
  if (p0Max >= 2n) boundaries.push(
    ['project0_route_max_minus_1', wrapP0([versionIx], p0Max - 1n),
      {providers: ['project0'], p0UsdcRaw: (p0Max - 1n).toString()}],
    ['project0_route_max_exact', wrapP0([versionIx], p0Max),
      {providers: ['project0'], p0UsdcRaw: p0Max.toString()}],
    ['project0_route_max_plus_1', wrapP0([versionIx], p0Max + 1n),
      {providers: ['project0'], p0UsdcRaw: (p0Max + 1n).toString()}],
    ['dual_asymmetric_klend_full_p0_two', wrapDual([versionIx], klendAvailable, 2n),
      {providers: ['klend', 'project0'], klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: '2'}],
    ['dual_asymmetric_klend_one_p0_max', wrapDual([versionIx], 1n, p0Max),
      {providers: ['klend', 'project0'], klendPrimeRaw: '1', p0UsdcRaw: p0Max.toString()}],
    ['dual_maximum_route_valid_vector', wrapDual([versionIx], klendAvailable, p0Max),
      {providers: ['klend', 'project0'], klendPrimeRaw: klendAvailable.toString(),
        p0UsdcRaw: p0Max.toString()}],
    ['dual_p0_max_plus_1_negative', wrapDual([versionIx], klendAvailable, p0Max + 1n),
      {providers: ['klend', 'project0'], klendPrimeRaw: klendAvailable.toString(),
        p0UsdcRaw: (p0Max + 1n).toString()}],
    ['triple_asymmetric_klend_full', wrapTriple([versionIx], klendAvailable, 2n, 1000n),
      {providers: ['klend', 'project0', 'jupiter'],
        klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: '2', jupiterUsdeRaw: '1000'}],
    ['triple_asymmetric_project0_full', wrapTriple([versionIx], 1n, p0Max, 1000n),
      {providers: ['klend', 'project0', 'jupiter'],
        klendPrimeRaw: '1', p0UsdcRaw: p0Max.toString(), jupiterUsdeRaw: '1000'}],
    ['triple_asymmetric_jupiter_full', wrapTriple([versionIx], 1n, 2n, jupiterAvailable),
      {providers: ['klend', 'project0', 'jupiter'],
        klendPrimeRaw: '1', p0UsdcRaw: '2', jupiterUsdeRaw: jupiterAvailable.toString()}],
    ['triple_maximum_route_valid_vector',
      wrapTriple([versionIx], klendAvailable, p0Max, jupiterAvailable),
      {providers: ['klend', 'project0', 'jupiter'],
        klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: p0Max.toString(),
        jupiterUsdeRaw: jupiterAvailable.toString()}],
    ['triple_jupiter_max_plus_1_negative',
      wrapTriple([versionIx], klendAvailable, p0Max, jupiterAvailable + 1n),
      {providers: ['klend', 'project0', 'jupiter'],
        klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: p0Max.toString(),
        jupiterUsdeRaw: (jupiterAvailable + 1n).toString()}],
    ['four_source_small_route_compatibility_probe',
      wrapQuad([versionIx], 1_000_000n, 1n, 2n, 1000n),
      {providers: ['save', 'klend', 'project0', 'jupiter'], saveWsolRaw: '1000000',
        klendPrimeRaw: '1', p0UsdcRaw: '2', jupiterUsdeRaw: '1000'}],
    ['four_source_maximum_capacity_vector_probe',
      wrapQuad([versionIx], saveAvailable, klendAvailable, p0Max, jupiterAvailable),
      {providers: ['save', 'klend', 'project0', 'jupiter'],
        saveWsolRaw: saveAvailable.toString(), klendPrimeRaw: klendAvailable.toString(),
        p0UsdcRaw: p0Max.toString(), jupiterUsdeRaw: jupiterAvailable.toString()}],
    ['four_source_asymmetric_save_full',
      wrapQuad([versionIx], saveAvailable, 1n, 2n, 1000n),
      {providers: ['save', 'klend', 'project0', 'jupiter'],
        saveWsolRaw: saveAvailable.toString(), klendPrimeRaw: '1',
        p0UsdcRaw: '2', jupiterUsdeRaw: '1000'}],
    ['four_source_asymmetric_klend_full',
      wrapQuad([versionIx], 1_000_000n, klendAvailable, 2n, 1000n),
      {providers: ['save', 'klend', 'project0', 'jupiter'], saveWsolRaw: '1000000',
        klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: '2', jupiterUsdeRaw: '1000'}],
    ['four_source_asymmetric_project0_full',
      wrapQuad([versionIx], 1_000_000n, 1n, p0Max, 1000n),
      {providers: ['save', 'klend', 'project0', 'jupiter'], saveWsolRaw: '1000000',
        klendPrimeRaw: '1', p0UsdcRaw: p0Max.toString(), jupiterUsdeRaw: '1000'}],
    ['four_source_asymmetric_jupiter_full',
      wrapQuad([versionIx], 1_000_000n, 1n, 2n, jupiterAvailable),
      {providers: ['save', 'klend', 'project0', 'jupiter'], saveWsolRaw: '1000000',
        klendPrimeRaw: '1', p0UsdcRaw: '2',
        jupiterUsdeRaw: jupiterAvailable.toString()}]);
  for (const [label, instructions, metadata] of boundaries)
    await run(label, instructions, {category: 'provider-boundary', ...metadata});

  const releaseCases = [
    ['release_replay_original_recipient', releaseTarget],
    ['release_recipient_substitution_to_attacker', clone(releaseTarget, {3: {pubkey: attackerPrime}})],
    ['release_other_inbox_target_recipient', clone(releaseTarget, {2: {pubkey: OTHER_INBOX}})],
    ['release_other_inbox_matching_recipient_replay', releaseOther],
    ['release_token_authority_substitution', clone(releaseTarget, {4: {pubkey: marketAuthority}})],
    ['release_custody_substitution', clone(releaseTarget, {7: {pubkey: SUPPLY}})],
    ['release_mint_substitution', clone(releaseTarget, {5: {pubkey: USDC}})],
    ['release_token_program_substitution', clone(releaseTarget, {6: {pubkey: SYSTEM}})],
    ['release_config_substitution', clone(releaseTarget, {1: {pubkey: SYSTEM}})],
    ['release_payer_not_instruction_signer', clone(releaseTarget, {0: {pubkey: PROGRAM,
      isSigner: false, isWritable: true}})],
    ['release_minimum_claim_to_attacker', clone(releaseTarget,
      {2: {pubkey: MIN_INBOX}, 3: {pubkey: attackerPrime}})],
    ['release_maximum_claim_to_attacker', clone(releaseTarget,
      {2: {pubkey: MAX_INBOX}, 3: {pubkey: attackerPrime}})],
    ['release_minimum_claim_matching_recipient_replay', clone(releaseTarget,
      {2: {pubkey: MIN_INBOX}, 3: {pubkey: minRecipientToken}})],
    ['release_maximum_claim_matching_recipient_replay', clone(releaseTarget,
      {2: {pubkey: MAX_INBOX}, 3: {pubkey: maxRecipientToken}})],
  ];
  const redeemCases = [
    ['redeem_replay', redeemTarget],
    ['redeem_other_message_target_inbox', clone(redeemTarget, {3: {pubkey: OTHER_MESSAGE}})],
    ['redeem_target_message_other_inbox', clone(redeemTarget, {6: {pubkey: OTHER_INBOX}})],
    ['redeem_peer_substitution', clone(redeemTarget, {2: {pubkey: CONFIG}})],
    ['redeem_transceiver_substitution', clone(redeemTarget, {4: {pubkey: CONFIG}})],
    ['redeem_mint_substitution', clone(redeemTarget, {5: {pubkey: USDC}})],
  ];
  const receiveCases = [
    ['receive_replay', receiveTarget],
    ['receive_other_vaa_target_message', clone(receiveTarget, {3: {pubkey: OTHER_VAA}})],
    ['receive_target_vaa_other_message', clone(receiveTarget, {4: {pubkey: OTHER_MESSAGE}})],
    ['receive_peer_substitution', clone(receiveTarget, {2: {pubkey: CONFIG}})],
    ['receive_config_substitution', clone(receiveTarget, {1: {pubkey: SYSTEM}})],
  ];
  const governanceCases = [
    ['governance_set_paused_by_outsider', new TransactionInstruction({programId: PROGRAM,
      keys: [{pubkey: authority.publicKey, isSigner: true, isWritable: false},
        {pubkey: CONFIG, isSigner: false, isWritable: true}],
      data: Buffer.concat([discriminator('set_paused'), Buffer.from([1])])})],
    ['governance_set_threshold_zero_by_outsider', new TransactionInstruction({programId: PROGRAM,
      keys: [{pubkey: authority.publicKey, isSigner: true, isWritable: false},
        {pubkey: CONFIG, isSigner: false, isWritable: true}],
      data: Buffer.concat([discriminator('set_threshold'), Buffer.from([0])])})],
    ['governance_transfer_ownership_by_outsider', new TransactionInstruction({programId: PROGRAM,
      keys: [{pubkey: CONFIG, isSigner: false, isWritable: true},
        {pubkey: authority.publicKey, isSigner: true, isWritable: false},
        {pubkey: authority.publicKey, isSigner: false, isWritable: false},
        {pubkey: P('DAhUnWZB1g4yJ6S4f3y5wSxQRLzvUEjHFDw8sae9vSxv'), isSigner: false, isWritable: false},
        {pubkey: PROGRAM_DATA, isSigner: false, isWritable: true},
        {pubkey: LOADER, isSigner: false, isWritable: false}],
      data: discriminator('transfer_ownership')})],
  ];
  const ordinary = [
    ...releaseCases.map(([label, ix]) => [label, [ix], 'release']),
    ...redeemCases.map(([label, ix]) => [label, [ix], 'redeem']),
    ...receiveCases.map(([label, ix]) => [label, [ix], 'receive']),
    ['receive_redeem_release_replay', [receiveTarget, redeemTarget, releaseTarget], 'ordering'],
    ['release_redeem_receive_wrong_order', [releaseTarget, redeemTarget, receiveTarget], 'ordering'],
    ...governanceCases.map(([label, ix]) => [label, [ix], 'governance']),
  ];
  for (const [label, candidate, family] of ordinary)
    await run(`flash_${label}`, wrapKlend(candidate, 1n),
      {category: 'target-candidate', family, providers: ['klend'], klendPrimeRaw: '1'});

  // Repeat the most direct value-extraction candidate at maximum PRIME
  // capacity and at every jointly route-valid zero-fee provider ceiling.
  const redirect = clone(releaseTarget, {3: {pubkey: attackerPrime}});
  await run('flash_release_redirect_klend_maximum', wrapKlend([redirect], klendAvailable),
    {category: 'capital-sensitive-maximum', family: 'release', providers: ['klend'],
      klendPrimeRaw: klendAvailable.toString()});
  if (p0Max >= 2n) await run('multiflash_release_redirect_maximum_vector',
    wrapDual([redirect], klendAvailable, p0Max),
    {category: 'capital-sensitive-maximum', family: 'release', providers: ['klend', 'project0'],
      klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: p0Max.toString(),
      crossAssetProject0CannotChangeNttPrimeAuthorization: true});
  if (p0Max >= 2n) await run('maxsource_release_redirect_maximum_vector',
    wrapTriple([redirect], klendAvailable, p0Max, jupiterAvailable),
    {category: 'capital-sensitive-maximum', family: 'release',
      providers: ['klend', 'project0', 'jupiter'],
      klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: p0Max.toString(),
      jupiterUsdeRaw: jupiterAvailable.toString(),
      crossAssetSourcesCannotChangeNttPrimeAuthorization: true});
  if (p0Max >= 2n) await run('four_source_release_redirect_maximum_vector',
    wrapQuad([redirect], saveAvailable, klendAvailable, p0Max, jupiterAvailable),
    {category: 'capital-sensitive-maximum-provider-attempt', family: 'release',
      providers: ['save', 'klend', 'project0', 'jupiter'],
      saveWsolRaw: saveAvailable.toString(), klendPrimeRaw: klendAvailable.toString(),
      p0UsdcRaw: p0Max.toString(), jupiterUsdeRaw: jupiterAvailable.toString()});

  const freshOutbound = clone(outboundTemplate, {
    0: {pubkey: authority.publicKey, isSigner: true, isWritable: true},
    3: {pubkey: attackerPrime, isSigner: false, isWritable: true},
    5: {pubkey: outboxItem.publicKey, isSigner: true, isWritable: true},
  });
  freshOutbound.data.writeBigUInt64LE(1n, 8);
  await run('flash_outbound_fresh_item_borrowed_prime_then_repay',
    wrapKlend([freshOutbound], 1n),
    {category: 'capital-sensitive-outbound', family: 'outbound', providers: ['klend'],
      klendPrimeRaw: '1', targetTransferRaw: '1'});
  await run('flash_outbound_fresh_item_custody_substitution',
    wrapKlend([clone(freshOutbound, {7: {pubkey: SUPPLY}})], 1n),
    {category: 'capital-sensitive-outbound', family: 'outbound', providers: ['klend'],
      klendPrimeRaw: '1', targetTransferRaw: '1'});
  await run('flash_outbound_fresh_item_source_substitution',
    wrapKlend([clone(freshOutbound, {3: {pubkey: CUSTODY}})], 1n),
    {category: 'capital-sensitive-outbound', family: 'outbound', providers: ['klend'],
      klendPrimeRaw: '1', targetTransferRaw: '1'});
  if (p0Max >= 2n) await run('multiflash_outbound_fresh_item_maximum_vector',
    wrapDual([freshOutbound], klendAvailable, p0Max),
    {category: 'capital-sensitive-outbound', family: 'outbound',
      providers: ['klend', 'project0'], klendPrimeRaw: klendAvailable.toString(),
      p0UsdcRaw: p0Max.toString(), targetTransferRaw: '1'});
  if (p0Max >= 2n) await run('maxsource_outbound_fresh_item_maximum_vector',
    wrapTriple([freshOutbound], klendAvailable, p0Max, jupiterAvailable),
    {category: 'capital-sensitive-outbound', family: 'outbound',
      providers: ['klend', 'project0', 'jupiter'],
      klendPrimeRaw: klendAvailable.toString(), p0UsdcRaw: p0Max.toString(),
      jupiterUsdeRaw: jupiterAvailable.toString(), targetTransferRaw: '1'});
  if (p0Max >= 2n) await run('four_source_outbound_fresh_item_maximum_vector',
    wrapQuad([freshOutbound], saveAvailable, klendAvailable, p0Max, jupiterAvailable),
    {category: 'capital-sensitive-maximum-provider-attempt', family: 'outbound',
      providers: ['save', 'klend', 'project0', 'jupiter'],
      saveWsolRaw: saveAvailable.toString(), klendPrimeRaw: klendAvailable.toString(),
      p0UsdcRaw: p0Max.toString(), jupiterUsdeRaw: jupiterAvailable.toString(),
      targetTransferRaw: '1'});

  // Exact envelope control under real signature verification.
  const exactBlockhash = (await fork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const exactBase = wrapKlend([releaseTarget], 1n);
  const exact = padTo4096(exactBase, authority.publicKey, exactBlockhash);
  // run() obtains its own blockhash; padding size is blockhash-independent.
  await run('exact_4096_signed_flash_release_replay', exact.instructions,
    {category: 'exact-v1-envelope', family: 'release', providers: ['klend'],
      klendPrimeRaw: '1', paddingMemoBytes: exact.paddingMemoBytes});

  const blockers = [
    {candidate: 'historical outbound outbox-item replay', blocker:
      'The historical outbox item is a required signer whose private key is unavailable. sigVerify:true makes replay un-signable. A fresh attacker-controlled outbox signer was tested instead.'},
    {candidate: 'Project0 PRIME flash source', blocker:
      `On-chain Bank census found ${primeP0Banks.length} Bank accounts with mint PRIME; no same-asset Project0 route exists.`},
    {candidate: 'Jupiter native PRIME flash source', blocker:
      `On-chain UserBorrowPosition census found ${primeJupiterPositions.length} positions with mint PRIME. The independently composed USDe source cannot alter NTT claim/owner/PDA authentication.`},
    {candidate: 'Save PRIME flash source', blocker:
      `On-chain 619-byte reserve census found ${primeSaveReserves.length} reserves with liquidity mint PRIME. The independently composed WSOL source works but charges 4 bps and cannot alter NTT claim/owner/PDA authentication.`},
    {candidate: 'more than one KLend flash borrow in one transaction', blocker:
      'KLend instruction introspection permits one flash-borrow/repay pair; a second borrow is rejected by the MultipleFlashBorrows guard, so distinct KLend reserves are not independent combinable providers.'},
    {candidate: 'Save fee as apparent WSOL dust profit', blocker:
      'The maximum Save route leaves one raw WSOL from ceiling rounding, but the attacker-controlled lamport reconciliation includes a much larger 4 bps repayment outflow; net outsider equity is negative.'},
  ];
  const positive = results.filter(result => result.accounting.positiveOutsiderNetEquity);
  const successful = results.filter(result => result.committed);
  const successfulProviderCounts = successful.map(result => result.providers?.length || 0);
  const maximumSuccessfulProviderCount = successfulProviderCounts.length
    ? Math.max(...successfulProviderCounts) : 0;
  const fourSourceProbes = results.filter(result => result.providers?.length === 4);
  const output = {generatedAt: new Date().toISOString(),
    scope: 'fork-only signed Solana v1 simulations; no mainnet submission',
    noTransactionsSubmitted: true,
    rpc: {fork: FORK, upstream: 'authenticated endpoint redacted',
      methodsUsed: ['getTransaction', 'getAccountInfo', 'getMultipleAccounts',
        'getProgramAccounts', 'getLatestBlockhash', 'simulateTransaction',
        'surfnet_setAccount (fresh local attacker only)']},
    signaturePolicy: {sigVerify: true, replaceRecentBlockhash: false,
      allRequiredSignersControlled: true},
    envelope: {version: 1, maximumBytes: 4096, maximumAddresses: 64},
    identities: {program: PROGRAM.toBase58(), config: CONFIG.toBase58(), mint: PRIME.toBase58(),
      tokenAuthority: TOKEN_AUTHORITY.toBase58(), custody: CUSTODY.toBase58(),
      attacker: authority.publicKey.toBase58(), attackerPrime: attackerPrime.toBase58(),
      attackerUsdc: attackerUsdc.toBase58(), attackerUsde: attackerUsde.toBase58(),
      attackerWsol: attackerWsol.toBase58(),
      freshMarginfiAccount: marginfiAccount.publicKey.toBase58(),
      freshOutboxItem: outboxItem.publicKey.toBase58()},
    sourceTransactions: {targetExit: TARGET_SIGNATURE, otherInbound: OTHER_SIGNATURE,
      outbound: OUTBOUND_SIGNATURE, project0: P0_SOURCE_SIGNATURE,
      save: SAVE_SOURCE_SIGNATURE},
    baselineSlot: baselineRaw.context.slot,
    providers: {
      klend: {program: KLEND.toBase58(), reserve: RESERVE.toBase58(), mint: PRIME.toBase58(),
        supplyVault: SUPPLY.toBase58(), feeVault: FEE_VAULT.toBase58(),
        observedAvailableRaw: klendAvailable.toString(), usableMaximumRaw: klendAvailable.toString(),
        flashLoanFeeSf: baseline[RESERVE.toBase58()].flashLoanFeeSf,
        sameTransactionRepeatBorrowCompatible: false},
      project0: {program: P0.toBase58(), group: p0Group.toBase58(), bank: p0Bank.toBase58(),
        mint: USDC.toBase58(), liquidityVault: p0Vault.toBase58(),
        observedVaultRaw: p0VaultAvailable.toString(), usableMaximumRaw: p0Max.toString(),
        firstRejectedAboveUsableMaximumRaw: p0Max ? (p0Max + 1n).toString() : null,
        primeBankCount: primeP0Banks.length, primeBanks: primeP0Banks.map(row => row.pubkey),
        targetCompatibility: 'atomic cross-asset composition only; USDC cannot change PRIME NTT authorization'},
      jupiter: {flashProgram: JUP_FLASH.toBase58(),
        liquidityProgram: JUP_LIQUIDITY_PROGRAM.toBase58(), mint: USDE.toBase58(),
        vault: JUP_VAULT.toBase58(), reserve: JUP_RESERVE.toBase58(),
        borrowPosition: JUP_POSITION.toBase58(), configuredFeeBps: jupiterAdmin.feeBps,
        observedVaultRaw: jupiterVaultAvailable.toString(),
        usableMaximumRaw: jupiterAvailable.toString(), minimumRaw: '1000',
        primeBorrowPositionCount: primeJupiterPositions.length,
        primeBorrowPositions: primeJupiterPositions.map(row => row.pubkey),
        targetCompatibility: 'atomic cross-asset composition only; USDe cannot change PRIME NTT authorization'},
      save: {program: SAVE.toBase58(), mint: saveMint.toBase58(), reserve: saveReserve.toBase58(),
        supplyVault: saveSupply.toBase58(), feeVault: saveFeeVault.toBase58(),
        observedAvailableRaw: saveAvailable.toString(), configuredFeeBps: '4',
        primeReserveCount: primeSaveReserves.length,
        primeReserves: primeSaveReserves.map(row => row.pubkey),
        targetCompatibility: 'successful four-provider signed v1 composition; cross-asset WSOL cannot change PRIME NTT authorization'},
      inventoriedIndependentProviderCount: 4,
      maximumSuccessfulProviderCount,
      triSourceAttempted: true,
      fourSourceAttempted: true,
      fourSourceProbeCount: fourSourceProbes.length,
      fourSourceTargetReachedCount: fourSourceProbes.filter(result => result.targetProgramInvoked).length,
    },
    providerInventory: [
      {provider: 'KLend', testedMint: PRIME.toBase58(), sameAssetPrime: true,
        usableInSignedTargetRoute: true},
      {provider: 'Project0', testedMint: USDC.toBase58(), sameAssetPrime: false,
        usableInSignedTargetRoute: true, primeMarketCount: primeP0Banks.length},
      {provider: 'Jupiter native flash', testedMint: USDE.toBase58(), sameAssetPrime: false,
        usableInSignedTargetRoute: true, primeMarketCount: primeJupiterPositions.length},
      {provider: 'Save', testedMint: WSOL.toBase58(), sameAssetPrime: false,
        usableInSignedTargetRoute: true, primeMarketCount: primeSaveReserves.length,
        cost: '4 bps fee; reconciled as negative outsider lamport equity'},
    ],
    baseline, p0CapacitySearch, blockers,
    resultCount: results.length, successfulCount: successful.length,
    failedCount: results.length - successful.length,
    positiveOutsiderNetEquityCount: positive.length,
    validatedFinding: positive.length ? 'requires manual validation' : null,
    results,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, resultCount: output.resultCount,
    successfulCount: output.successfulCount,
    positiveOutsiderNetEquityCount: output.positiveOutsiderNetEquityCount,
    klendAvailableRaw: klendAvailable.toString(), p0VaultRaw: p0VaultAvailable.toString(),
    p0UsableMaximumRaw: p0Max.toString(), jupiterUsableMaximumRaw: jupiterAvailable.toString(),
    saveObservedAvailableRaw: saveAvailable.toString(),
    project0PrimeBankCount: primeP0Banks.length,
    jupiterPrimePositionCount: primeJupiterPositions.length,
    savePrimeReserveCount: primeSaveReserves.length,
    maximumSuccessfulProviderCount}));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
