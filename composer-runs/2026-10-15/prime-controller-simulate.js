#!/usr/bin/env node
'use strict';

// Read-only current-binary simulations for the PRIME Chainlink lock/release pool.
// Includes exact 4,096-byte Solana v1 KLend flash compositions. No transaction
// is signed or submitted; sigVerify=false is used only for positive controls.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const anchor = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const bs58Module = require(
  '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');

const RUN = __dirname;
const P = (value) => new PublicKey(value);
const PROGRAM = P('8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC');
const PRIME_MINT = P('3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7');
const TOKEN_PROGRAM = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = P('11111111111111111111111111111111');
const MEMO_PROGRAM = P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const stateEvidence = JSON.parse(fs.readFileSync(path.join(RUN, 'prime-controller-state.json')));
const sourceRelease = stateEvidence.successfulReleaseEvidence[0].targetInstructions[0];
const controllerState = stateEvidence.state;
const reserveState = stateEvidence.klend;
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const rpcUrl = env.HEAVY_RPC_URL || env.RPC_URL;
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');

const kaminoIdl = JSON.parse(fs.readFileSync(
  path.join(RUN, 'marginfi-source/idls-complete/kamino_lending.json')));
const reserveCoder = new anchor.BorshAccountsCoder(kaminoIdl);
const flashHistory = JSON.parse(fs.readFileSync(path.join(RUN, 'kamino-flash-history.json')));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const disc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

async function rpc(method, params) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) return {error: body.error};
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw lastError;
}

function historicalIx(index) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const staticKeys = msg.accountKeys;
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = (i) => i < staticKeys.length ?
    (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < staticKeys.length - h.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return new TransactionInstruction({programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map((i) => ({pubkey: P(allKeys[i]),
      isSigner: i < h.numRequiredSignatures, isWritable: writable(i)})),
    data: Buffer.from(bs58.decode(source.data))});
}

const borrowTemplate = historicalIx(3);
const repayTemplate = historicalIx(13);

function flash(kind, outsider, amount, borrowIndex = 0) {
  const template = kind === 'borrow' ? borrowTemplate : repayTemplate;
  const keys = template.keys.map((item) => ({...item}));
  const market = P(reserveState.market);
  const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const replacements = {0: outsider.owner, 1: marketAuthority, 2: market,
    3: P(reserveState.reserve), 4: PRIME_MINT, 5: P(reserveState.supplyVault),
    6: outsider.token, 7: P(reserveState.feeVault), 11: TOKEN_PROGRAM};
  for (const [index, value] of Object.entries(replacements)) keys[Number(index)].pubkey = value;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (kind === 'repay') data[16] = borrowIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function transferChecked(from, to, owner, amount) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = controllerState.decimals;
  return new TransactionInstruction({programId: TOKEN_PROGRAM, keys: [
    {pubkey: from, isSigner: false, isWritable: true},
    {pubkey: PRIME_MINT, isSigner: false, isWritable: false},
    {pubkey: to, isSigner: false, isWritable: true},
    {pubkey: owner, isSigner: true, isWritable: false},
  ], data});
}

function releaseData(amount, receiver, mutation = {}) {
  const data = Buffer.from(sourceRelease.dataHex, 'hex');
  let o = 8;
  const originalSenderLength = data.readUInt32LE(o); o += 4 + originalSenderLength;
  const selectorOffset = o; o += 8;
  const receiverOffset = o; o += 32;
  const amountOffset = o; o += 32;
  o += 32; // local token
  const sourcePoolLengthOffset = o;
  const sourcePoolLength = data.readUInt32LE(o); o += 4;
  const sourcePoolOffset = o; o += sourcePoolLength;
  if (mutation.remoteChainSelector !== undefined)
    data.writeBigUInt64LE(BigInt(mutation.remoteChainSelector), selectorOffset);
  receiver.toBuffer().copy(data, receiverOffset);
  let remaining = BigInt(amount);
  for (let i = 0; i < 32; i += 1) { data[amountOffset + i] = Number(remaining & 255n); remaining >>= 8n; }
  if (remaining !== 0n) throw new Error('release amount exceeds u256');
  if (mutation.invalidSourcePool && sourcePoolLength > 0) data[sourcePoolOffset] ^= 1;
  if (mutation.emptySourcePool) data.writeUInt32LE(0, sourcePoolLengthOffset);
  return data;
}

function releaseIx(outsider, amount, options = {}) {
  const addresses = sourceRelease.accounts.map(P);
  addresses[12] = options.receiverToken || outsider.token;
  if (options.authority) addresses[0] = options.authority;
  if (options.offrampProgram) addresses[1] = options.offrampProgram;
  if (options.allowedOfframp) addresses[2] = options.allowedOfframp;
  if (options.state) addresses[3] = options.state;
  if (options.poolSigner) addresses[6] = options.poolSigner;
  if (options.poolVault) addresses[7] = options.poolVault;
  const writable = new Set([5, 7, 8, 12]);
  return new TransactionInstruction({programId: PROGRAM,
    keys: addresses.map((pubkey, index) => ({pubkey, isSigner: index === 0,
      isWritable: writable.has(index)})),
    data: releaseData(amount, options.receiver || outsider.owner, options.mutation)});
}

function liquidityIx(name, outsider, amount, authority = outsider.owner) {
  const amountBytes = Buffer.alloc(8); amountBytes.writeBigUInt64LE(amount);
  return new TransactionInstruction({programId: PROGRAM, keys: [
    {pubkey: P(stateEvidence.derivations.state), isSigner: false, isWritable: false},
    {pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false},
    {pubkey: PRIME_MINT, isSigner: false, isWritable: true},
    {pubkey: P(stateEvidence.derivations.poolSigner), isSigner: false, isWritable: false},
    {pubkey: P(stateEvidence.derivations.poolVault), isSigner: false, isWritable: true},
    {pubkey: outsider.token, isSigner: false, isWritable: true},
    {pubkey: authority, isSigner: true, isWritable: false},
  ], data: Buffer.concat([disc(name), amountBytes])});
}

function associatedAddress(owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), PRIME_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM)[0];
}

async function findOutsider() {
  const largest = await rpc('getTokenLargestAccounts', [PRIME_MINT.toBase58(), {commitment: 'confirmed'}]);
  if (largest.error) throw new Error(JSON.stringify(largest.error));
  const fallback = P('F7MNsDHEQoYCoUUUL9SCMZPSuhHPNQti7qLtUU592CC1');
  const addresses = [...new Set([...largest.value.map((item) => item.address), fallback.toBase58()])];
  const accounts = await rpc('getMultipleAccounts', [addresses, {encoding: 'base64', commitment: 'confirmed'}]);
  if (accounts.error) throw new Error(JSON.stringify(accounts.error));
  const privileged = new Set([controllerState.owner, controllerState.proposedOwner,
    controllerState.rateLimitAdmin, controllerState.routerOnrampAuthority,
    controllerState.router, controllerState.rebalancer, stateEvidence.derivations.poolSigner]);
  const candidates = accounts.value.map((account, index) => {
    if (!account || account.owner !== TOKEN_PROGRAM.toBase58()) return null;
    const data = Buffer.from(account.data[0], 'base64');
    if (data.length < 165 || data[108] !== 1) return null;
    const owner = new PublicKey(data.subarray(32, 64));
    if (!PublicKey.isOnCurve(owner.toBuffer()) || privileged.has(owner.toBase58())) return null;
    const token = P(addresses[index]);
    if (!associatedAddress(owner).equals(token)) return null;
    return {token, owner, balanceRaw: data.readBigUInt64LE(64), tokenSlot: accounts.context.slot};
  }).filter(Boolean);
  const owners = [...new Set(candidates.map((item) => item.owner.toBase58()))];
  const ownerAccounts = await rpc('getMultipleAccounts', [owners, {encoding: 'base64', commitment: 'confirmed'}]);
  if (ownerAccounts.error) throw new Error(JSON.stringify(ownerAccounts.error));
  const byOwner = new Map(owners.map((key, index) => [key, ownerAccounts.value[index]]));
  const selected = candidates.find((item) => {
    const account = byOwner.get(item.owner.toBase58());
    return account?.owner === SYSTEM_PROGRAM.toBase58() && account.lamports > 5_000_000;
  });
  if (!selected) throw new Error('No suitable non-privileged on-curve PRIME ATA owner found');
  return {...selected, ownerLamports: byOwner.get(selected.owner.toBase58()).lamports,
    ownerSlot: ownerAccounts.context.slot};
}

function decodeToken(account) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {ownerProgram: account.owner, dataSha256: sha256(data),
    mint: new PublicKey(data.subarray(0, 32)).toBase58(),
    authority: new PublicKey(data.subarray(32, 64)).toBase58(),
    rawAmount: data.readBigUInt64LE(64).toString()};
}

function decodeMint(account) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {ownerProgram: account.owner, dataSha256: sha256(data),
    supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
}

function decodeReserve(account) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const reserve = reserveCoder.decode('Reserve', data);
  return {ownerProgram: account.owner, dataSha256: sha256(data),
    lastUpdate: {slot: reserve.last_update.slot.toString(), stale: reserve.last_update.stale,
      priceStatus: reserve.last_update.price_status,
      timestamp: reserve.last_update.timestamp.toString()},
    totalAvailableRaw: reserve.liquidity.total_available_amount.toString(),
    borrowedAmountSf: reserve.liquidity.borrowed_amount_sf.toString(),
    accumulatedProtocolFeesSf: reserve.liquidity.accumulated_protocol_fees_sf.toString(),
    accumulatedReferrerFeesSf: reserve.liquidity.accumulated_referrer_fees_sf.toString(),
    pendingReferrerFeesSf: reserve.liquidity.pending_referrer_fees_sf.toString(),
    collateralMintTotalSupplyRaw: reserve.collateral.mint_total_supply.toString(),
    rawAvailableOffset224: data.readBigUInt64LE(224).toString(),
    rawFlashFeeSfOffset4904: data.readBigUInt64LE(4904).toString()};
}

function readVec(data, cursor) {
  const length = data.readUInt32LE(cursor.offset); cursor.offset += 4;
  const value = data.subarray(cursor.offset, cursor.offset + length); cursor.offset += length;
  return value;
}

function readBucket(data, cursor) {
  const tokens = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const lastUpdated = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const enabled = data[cursor.offset] !== 0; cursor.offset += 1;
  const capacity = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  const rate = data.readBigUInt64LE(cursor.offset); cursor.offset += 8;
  return {tokens: tokens.toString(), lastUpdated: lastUpdated.toString(), enabled,
    capacity: capacity.toString(), rate: rate.toString()};
}

function decodeChain(account) {
  if (!account?.data?.[0]) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const cursor = {offset: 8};
  const count = data.readUInt32LE(cursor.offset); cursor.offset += 4;
  const poolAddresses = [];
  for (let i = 0; i < count; i += 1) poolAddresses.push(readVec(data, cursor).toString('hex'));
  const tokenAddress = readVec(data, cursor).toString('hex');
  const decimals = data[cursor.offset]; cursor.offset += 1;
  return {ownerProgram: account.owner, dataSha256: sha256(data),
    remote: {poolAddresses, tokenAddress, decimals}, inbound: readBucket(data, cursor),
    outbound: readBucket(data, cursor)};
}

function snapshot(accounts) {
  if (!accounts) return null;
  return {
    outsiderToken: decodeToken(accounts[0]),
    klendSupply: decodeToken(accounts[1]),
    klendFeeVault: decodeToken(accounts[2]),
    controllerVault: decodeToken(accounts[3]),
    reserve: decodeReserve(accounts[4]),
    chainConfig: decodeChain(accounts[5]),
    mint: decodeMint(accounts[6]),
  };
}

function deltas(pre, post) {
  if (!pre || !post) return null;
  const tokenFields = ['outsiderToken', 'klendSupply', 'klendFeeVault', 'controllerVault'];
  const tokens = Object.fromEntries(tokenFields.map((key) => [key,
    pre[key] && post[key] ?
      (BigInt(post[key].rawAmount) - BigInt(pre[key].rawAmount)).toString() : null]));
  if (!pre.reserve || !post.reserve || !pre.chainConfig || !post.chainConfig ||
      !pre.mint || !post.mint) return {tokens, reserve: null,
    mintSupplyRaw: null, inboundRateTokensRaw: null};
  return {tokens,
    reserve: {
      availableRaw: (BigInt(post.reserve.totalAvailableRaw) - BigInt(pre.reserve.totalAvailableRaw)).toString(),
      borrowedAmountSf: (BigInt(post.reserve.borrowedAmountSf) - BigInt(pre.reserve.borrowedAmountSf)).toString(),
      protocolFeesSf: (BigInt(post.reserve.accumulatedProtocolFeesSf) - BigInt(pre.reserve.accumulatedProtocolFeesSf)).toString(),
      referrerFeesSf: (BigInt(post.reserve.accumulatedReferrerFeesSf) - BigInt(pre.reserve.accumulatedReferrerFeesSf)).toString(),
      pendingReferrerFeesSf: (BigInt(post.reserve.pendingReferrerFeesSf) - BigInt(pre.reserve.pendingReferrerFeesSf)).toString(),
      collateralMintSupplyRaw: (BigInt(post.reserve.collateralMintTotalSupplyRaw) -
        BigInt(pre.reserve.collateralMintTotalSupplyRaw)).toString(),
    },
    mintSupplyRaw: (BigInt(post.mint.supplyRaw) - BigInt(pre.mint.supplyRaw)).toString(),
    inboundRateTokensRaw: (BigInt(post.chainConfig.inbound.tokens) -
      BigInt(pre.chainConfig.inbound.tokens)).toString(),
  };
}

function addExactPadding(instructions, payer, blockhash, insertAt = 1) {
  const empty = new TransactionInstruction({programId: MEMO_PROGRAM, keys: [], data: Buffer.alloc(0)});
  const withEmpty = [...instructions]; withEmpty.splice(insertAt, 0, empty);
  const initial = encodeV1(withEmpty, payer, blockhash);
  const paddingBytes = 4096 - initial.sizeBytes;
  if (paddingBytes < 0) throw new Error(`Base transaction exceeds v1 limit: ${initial.sizeBytes}`);
  const memo = new TransactionInstruction({programId: MEMO_PROGRAM, keys: [],
    data: Buffer.alloc(paddingBytes, 0x47)});
  const padded = [...instructions]; padded.splice(insertAt, 0, memo);
  const encoded = encodeV1(padded, payer, blockhash);
  if (encoded.sizeBytes !== 4096) throw new Error(`Exact padding failed: ${encoded.sizeBytes}`);
  return {instructions: padded, paddingBytes};
}

async function simulate(label, instructions, outsider, blockhash, watched, pre, exact = false) {
  let items = instructions;
  let paddingBytes = 0;
  if (exact) ({instructions: items, paddingBytes} = addExactPadding(items, outsider.owner, blockhash));
  const encoded = encodeV1(items, outsider.owner, blockhash, 1_400_000, 67_108_864);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'),
    {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
      commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map((key) => key.toBase58())}}]);
  if (result.error) return {label, transportError: result.error, exact4096: exact,
    v1Bytes: encoded.sizeBytes, paddingBytes};
  const post = snapshot(result.value.accounts);
  return {label, exact4096: exact, v1Bytes: encoded.sizeBytes, v0Bytes: encoded.v0Bytes,
    paddingBytes, addressCount: encoded.addressCount, writableCount: encoded.writableCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    simulationSlot: result.context.slot, err: result.value.err,
    unitsConsumed: result.value.unitsConsumed,
    loadedAccountsDataSize: result.value.loadedAccountsDataSize,
    pre, post, deltas: deltas(pre, post),
    returnData: result.value.returnData || null, logs: result.value.logs};
}

async function main() {
  const outsider = await findOutsider();
  const chainConfig = P(sourceRelease.accounts[8]);
  const watched = [outsider.token, P(reserveState.supplyVault), P(reserveState.feeVault),
    P(stateEvidence.derivations.poolVault), P(reserveState.reserve), chainConfig, PRIME_MINT];
  const prior = await rpc('getMultipleAccounts', [watched.map((key) => key.toBase58()),
    {encoding: 'base64', commitment: 'confirmed'}]);
  if (prior.error) throw new Error(JSON.stringify(prior.error));
  const pre = snapshot(prior.value);
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  if (latest.error) throw new Error(JSON.stringify(latest.error));
  const blockhash = latest.value.blockhash;
  const available = BigInt(reserveState.realisticFlashLiquidityRaw);
  const controllerVault = P(stateEvidence.derivations.poolVault);
  const offrampAuthority = P(sourceRelease.accounts[0]);
  const onePrime = 10n ** BigInt(controllerState.decimals);

  const roundtrip = (amount, authority = offrampAuthority, releaseOptions = {}) => [
    flash('borrow', outsider, amount),
    transferChecked(outsider.token, controllerVault, outsider.owner, amount),
    releaseIx(outsider, amount, {authority, ...releaseOptions}),
    flash('repay', outsider, amount, 0),
  ];
  const specs = [
    ['flash_pair_zero', [flash('borrow', outsider, 0n), flash('repay', outsider, 0n, 0)]],
    ['flash_pair_one_raw', [flash('borrow', outsider, 1n), flash('repay', outsider, 1n, 0)]],
    ['flash_pair_one_prime', [flash('borrow', outsider, onePrime), flash('repay', outsider, onePrime, 0)]],
    ['flash_one_raw_no_repay', [flash('borrow', outsider, 1n)]],
    ['flash_one_prime_underpay', [flash('borrow', outsider, onePrime),
      flash('repay', outsider, onePrime - 1n, 0)]],
    ['flash_one_prime_wrong_repay_index', [flash('borrow', outsider, onePrime),
      flash('repay', outsider, onePrime, 1)]],
    ['flash_pair_near_available', [flash('borrow', outsider, available - 1n),
      flash('repay', outsider, available - 1n, 0)]],
    ['flash_pair_exact_available', [flash('borrow', outsider, available),
      flash('repay', outsider, available, 0)]],
    ['flash_pair_over_available', [flash('borrow', outsider, available + 1n),
      flash('repay', outsider, available + 1n, 0)]],
    ['controller_roundtrip_one_raw_control', roundtrip(1n)],
    ['controller_roundtrip_one_prime_control_v1_4096', roundtrip(onePrime), true],
    ['controller_roundtrip_one_prime_outsider_authority_v1_4096',
      roundtrip(onePrime, outsider.owner), true],
    ['controller_roundtrip_wrong_offramp_program', roundtrip(1n, outsider.owner,
      {offrampProgram: SYSTEM_PROGRAM})],
    ['controller_roundtrip_allowed_offramp_substitution', roundtrip(1n, offrampAuthority,
      {allowedOfframp: P(stateEvidence.derivations.state)})],
    ['controller_roundtrip_state_substitution', roundtrip(1n, offrampAuthority,
      {state: P(stateEvidence.derivations.globalConfig)})],
    ['controller_roundtrip_pool_signer_substitution', roundtrip(1n, offrampAuthority,
      {poolSigner: outsider.owner})],
    ['controller_roundtrip_pool_vault_substitution', roundtrip(1n, offrampAuthority,
      {poolVault: outsider.token})],
    ['controller_roundtrip_receiver_account_mismatch', roundtrip(1n, offrampAuthority,
      {receiverToken: controllerVault})],
    ['controller_roundtrip_invalid_source_pool', roundtrip(1n, offrampAuthority,
      {mutation: {invalidSourcePool: true}})],
    ['controller_roundtrip_wrong_chain_selector', roundtrip(1n, offrampAuthority,
      {mutation: {remoteChainSelector: BigInt(sourceRelease.release.remoteChainSelector) + 1n}})],
    ['release_zero_amount_control', [releaseIx(outsider, 0n)]],
    ['release_u64_overflow_control', [releaseIx(outsider, (1n << 64n))]],
    ['release_double_control_no_pool_nonce', [
      transferChecked(outsider.token, controllerVault, outsider.owner, 2n),
      releaseIx(outsider, 1n), releaseIx(outsider, 1n),
    ]],
    ['release_double_outsider_authority', [
      transferChecked(outsider.token, controllerVault, outsider.owner, 2n),
      releaseIx(outsider, 1n, {authority: outsider.owner}),
      releaseIx(outsider, 1n, {authority: outsider.owner}),
    ]],
    ['withdraw_liquidity_outsider', [liquidityIx('withdraw_liquidity', outsider, 1n)]],
    ['withdraw_liquidity_configured_rebalancer_control', [
      liquidityIx('withdraw_liquidity', outsider, 1n, P(controllerState.rebalancer))]],
    ['provide_liquidity_outsider', [liquidityIx('provide_liquidity', outsider, 1n)]],
  ];

  const cases = [];
  for (const [label, instructions, exact] of specs.filter(([label]) =>
    !process.env.PRIME_CASE || label === process.env.PRIME_CASE)) {
    const result = await simulate(label, instructions, outsider, blockhash, watched, pre, Boolean(exact));
    cases.push(result);
    console.log(JSON.stringify({label, err: result.err || null,
      transportError: result.transportError || null, v1Bytes: result.v1Bytes,
      exact4096: result.exact4096, unitsConsumed: result.unitsConsumed,
      tokenDeltas: result.deltas?.tokens || null,
      reserveDelta: result.deltas?.reserve || null,
      logTail: result.logs?.filter((line) => line.includes('Instruction:') ||
        line.includes('Error') || line.includes('failed')).slice(-5) || null}));
  }

  const output = {generatedAt: new Date().toISOString(),
    transport: 'read-only current-mainnet simulateTransaction', sigVerify: false,
    liveSubmission: false, v1LimitBytes: 4096,
    programs: {controller: PROGRAM.toBase58(), klend: KLEND.toBase58()},
    sourceRelease: {signature: stateEvidence.successfulReleaseEvidence[0].signature,
      slot: stateEvidence.successfulReleaseEvidence[0].slot,
      instructionDataHex: sourceRelease.dataHex,
      accounts: sourceRelease.accounts, decoded: sourceRelease.release},
    outsider: {owner: outsider.owner.toBase58(), tokenAccount: outsider.token.toBase58(),
      tokenBalanceRaw: outsider.balanceRaw.toString(), ownerLamports: outsider.ownerLamports,
      selection: 'on-curve System-owned non-privileged owner of canonical PRIME ATA'},
    watched: watched.map((key) => key.toBase58()), preSlot: prior.context.slot,
    initial: pre, realisticFlashLiquidityRaw: available.toString(), cases};
  const outputPath = process.env.PRIME_OUTPUT || path.join(RUN, 'prime-controller-simulations.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath, caseCount: cases.length,
    exact4096: cases.filter((item) => item.v1Bytes === 4096).map((item) => item.label)}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
