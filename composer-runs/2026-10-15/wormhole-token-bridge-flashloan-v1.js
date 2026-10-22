#!/usr/bin/env node
// Read-only current-mainnet Solana v1 flash-loan composition harness.
// This file only calls get* RPCs and simulateTransaction. It never signs or submits.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const spl = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const {BorshAccountsCoder} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@coral-xyz/anchor');
const {encodeV1} = require('./klend-v1-composition.js');

const bs58 = bs58Module.default || bs58Module;
const OUT = __dirname + '/wormhole-token-bridge-flashloan-v1.json';
const envFile = '/tmp/composer-helius-only.env';
const fileEnv = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8')
  .split('\n').filter(line => line.includes('=')).map(line => line.split(/=(.*)/s).slice(0, 2))) : {};
const RPC_URL = process.env.HEAVY_RPC_URL || process.env.RPC_URL || fileEnv.HEAVY_RPC_URL || fileEnv.RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL or HEAVY_RPC_URL is required');
const connection = new Connection(RPC_URL, 'confirmed');
const P = value => value instanceof PublicKey ? value : new PublicKey(value);
const TOKEN = P('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = P('11111111111111111111111111111111');
const RENT = P('SysvarRent111111111111111111111111111111111');
const CLOCK = P('SysvarC1ock11111111111111111111111111111111');
const WORMHOLE = P('wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb');
const CORE = P('worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const USDC = P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const WSOL = P('So11111111111111111111111111111111111111112');
const FLASH_SOURCE_SIGNATURE = '588vb6rp6QWDC1hAF2aZ9z3teLdMRrQRVy87RWwY6VijmSG9ZLRXAHdxicJZPG1mErYCcvRz43NmmWZyRjf6zZcd';
const PROJECT0_SOURCE_SIGNATURE = '2WxD766a1LAyiHiMYK8REpBsNpDhA8GQAkNb3occqXXooFF5xyUKz6Xim4m9tVQMiyFrhCYbKKcb6o4FibMBBdwG';
const START = Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]);
const END = Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]);
const P0_BORROW = Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]);
const P0_REPAY = Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]);
const COMPLETE_CANDIDATE = {
  postedVaa: P('4nvh9h2tou4JhuRv5AH7PXcbTfioa9bZszSKwuT1Mg5s'),
  claim: P('94sr4mxsCbcKP69GvcfQM8J6QDFdvgRRbm79e2d8q8MR'),
  endpoint: P('96Hx7DhGHwVKWbdYePwSsD8uZJKd9Kc63ni83jV9h29k'),
  to: P('8nt2UeTSNrftju56r5V6bPJnZXiMvtN5kg31fPhUN5cA'),
  custody: P('9EhGiXJFGG7NGneq76Mfu6LCvGxHKmeq4tQv9HD4iBxV'),
  mint: USDC,
  rawAmount: 101000000n,
  feeRaw: 0n,
  emitterChain: 22,
  sequence: '63452',
};
const reserveIdl = JSON.parse(fs.readFileSync(__dirname + '/marginfi-source/idls-complete/kamino_lending.json', 'utf8'));
const reserveCoder = new BorshAccountsCoder(reserveIdl);
let rpcId = 0;

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const cloneIx = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
const meta = (pubkey, isWritable = false, isSigner = false) => ({pubkey: P(pubkey), isWritable, isSigner});
const unique = values => [...new Map(values.map(item => [item.pubkey.toBase58(), item])).values()];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
    const text = await response.text();
    if (response.status === 429 || text.startsWith('Too Many Requests')) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    const body = JSON.parse(text);
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  throw new Error(`${method}: rate limited after retries`);
}

function instructionFromJsonSample(hit, index) {
  const tx = hit.transaction;
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = tx.meta.loadedAddresses?.writable || [];
  const allKeys = [...staticKeys, ...loadedWritable, ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = message.header;
  const source = message.instructions[index];
  const isSigner = i => i < header.numRequiredSignatures;
  const isWritable = i => i < staticKeys.length ? (isSigner(i) ?
    i < header.numRequiredSignatures - header.numReadonlySignedAccounts :
    i < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    i < staticKeys.length + loadedWritable.length;
  return new TransactionInstruction({programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map(i => ({pubkey: P(allKeys[i]), isSigner: isSigner(i),
      isWritable: isWritable(i)})), data: Buffer.from(bs58.decode(source.data))});
}

async function decompile(signature) {
  const transaction = await rpc('getTransaction', [signature, {encoding: 'base64', maxSupportedTransactionVersion: 1}]);
  if (!transaction) throw new Error(`Missing source transaction ${signature}`);
  const wire = VersionedTransaction.deserialize(Buffer.from(transaction.transaction[0], 'base64'));
  const alts = await Promise.all((wire.message.addressTableLookups || []).map(async lookup => {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (!result.value) throw new Error(`Missing ALT ${lookup.accountKey.toBase58()}`);
    return result.value;
  }));
  return {slot: transaction.slot, message: TransactionMessage.decompile(wire.message,
    {addressLookupTableAccounts: alts})};
}

function setKlendFlash(template, owner, tokenAccount, amount, repayIndex) {
  const ix = cloneIx(template);
  ix.keys[0].pubkey = owner;
  ix.keys[6].pubkey = tokenAccount;
  ix.data.writeBigUInt64LE(amount, 8);
  if (repayIndex !== undefined) ix.data[16] = repayIndex;
  return ix;
}

function transferNative(payer, from, mint, amount, message, nonce, overrides = {}) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], WORMHOLE);
  const [custody] = PublicKey.findProgramAddressSync([mint.toBuffer()], WORMHOLE);
  const [authoritySigner] = PublicKey.findProgramAddressSync([Buffer.from('authority_signer')], WORMHOLE);
  const [custodySigner] = PublicKey.findProgramAddressSync([Buffer.from('custody_signer')], WORMHOLE);
  const [bridge] = PublicKey.findProgramAddressSync([Buffer.from('Bridge')], CORE);
  const [emitter] = PublicKey.findProgramAddressSync([Buffer.from('emitter')], WORMHOLE);
  const [sequence] = PublicKey.findProgramAddressSync([Buffer.from('Sequence'), emitter.toBuffer()], CORE);
  const [feeCollector] = PublicKey.findProgramAddressSync([Buffer.from('fee_collector')], CORE);
  const keys = [meta(payer, true, true), meta(config), meta(from, true), meta(mint, true),
    meta(custody, true), meta(authoritySigner), meta(custodySigner), meta(bridge, true),
    meta(message, true, true), meta(emitter), meta(sequence, true), meta(feeCollector, true),
    meta(CLOCK), meta(RENT), meta(SYSTEM), meta(CORE), meta(TOKEN)];
  for (const [index, value] of Object.entries(overrides)) keys[Number(index)].pubkey = P(value);
  const data = Buffer.alloc(55);
  data[0] = 5; // Token Bridge enum variant: TransferNative.
  data.writeUInt32LE(nonce >>> 0, 1);
  data.writeBigUInt64LE(amount, 5);
  data.writeBigUInt64LE(0n, 13);
  Buffer.alloc(32, 0x42).copy(data, 21);
  data.writeUInt16LE(2, 53); // Ethereum, and explicitly not Solana.
  return new TransactionInstruction({programId: WORMHOLE, keys, data});
}

function completeNative(payer, overrides = {}) {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], WORMHOLE);
  const [custodySigner] = PublicKey.findProgramAddressSync([Buffer.from('custody_signer')], WORMHOLE);
  const c = COMPLETE_CANDIDATE;
  const keys = [meta(payer, true, true), meta(config), meta(c.postedVaa), meta(c.claim, true),
    meta(c.endpoint), meta(c.to, true), meta(c.to, true), meta(c.custody, true), meta(c.mint),
    meta(custodySigner), meta(RENT), meta(SYSTEM), meta(CORE), meta(TOKEN)];
  for (const [index, value] of Object.entries(overrides)) keys[Number(index)].pubkey = P(value);
  return new TransactionInstruction({programId: WORMHOLE, keys, data: Buffer.from([2])});
}

function instructionRecord(ix, index) {
  return {index, programId: ix.programId.toBase58(), dataHex: Buffer.from(ix.data).toString('hex'),
    accounts: ix.keys.map((key, accountIndex) => ({accountIndex, address: key.pubkey.toBase58(),
      signer: key.isSigner, writable: key.isWritable}))};
}

function compiledRecord(instructions, payer, blockhash) {
  const message = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message([]);
  const h = message.header;
  return message.staticAccountKeys.map((key, index) => ({index, address: key.toBase58(),
    signer: index < h.numRequiredSignatures,
    writable: index < h.numRequiredSignatures ?
      index < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      index < message.staticAccountKeys.length - h.numReadonlyUnsignedAccounts}));
}

function decodeReserve(data) {
  if (!data) return null;
  let decoded;
  try { decoded = reserveCoder.decode('Reserve', data); } catch (_) {
    try { decoded = reserveCoder.decode('reserve', data); } catch (_) { decoded = null; }
  }
  if (!decoded) return {decodeError: true, dataSha256: sha256(data)};
  const liquidity = decoded.liquidity || {};
  const fees = decoded.config?.fees || {};
  const string = value => value === undefined || value === null ? null : value.toString();
  return {
    mint: liquidity.mint_pubkey?.toBase58?.() || string(liquidity.mint_pubkey),
    supplyVault: liquidity.supply_vault?.toBase58?.() || string(liquidity.supply_vault),
    feeVault: liquidity.fee_vault?.toBase58?.() || string(liquidity.fee_vault),
    totalAvailableAmountRaw: string(liquidity.total_available_amount),
    borrowedAmountSf: string(liquidity.borrowed_amount_sf),
    flashLoanFeeSf: string(fees.flash_loan_fee_sf),
    borrowFeeSf: string(fees.borrow_fee_sf),
  };
}

function accountSnapshot(account, address, reserveAddress) {
  if (!account) return {exists: false};
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = typeof account.owner === 'string' ? account.owner : account.owner.toBase58();
  const snapshot = {exists: true, owner, lamports: String(account.lamports), executable: !!account.executable,
    dataLength: data.length, dataSha256: sha256(data)};
  if (owner === TOKEN.toBase58() && data.length >= 72) {
    if (data.length === 82) snapshot.splMint = {supplyRaw: data.readBigUInt64LE(36).toString(), decimals: data[44]};
    else snapshot.splToken = {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      authority: new PublicKey(data.subarray(32, 64)).toBase58(), amountRaw: data.readBigUInt64LE(64).toString(),
      delegateOption: data.length >= 76 ? data.readUInt32LE(72) : null,
      delegate: data.length >= 108 && data.readUInt32LE(72) ? new PublicKey(data.subarray(76, 108)).toBase58() : null,
      delegatedAmountRaw: data.length >= 129 ? data.readBigUInt64LE(121).toString() : null};
  }
  if (address === reserveAddress) snapshot.klendReserve = decodeReserve(data);
  return snapshot;
}

function snapshotEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stateDelta(pre, post) {
  if (!pre?.exists || !post?.exists) return {existsBefore: !!pre?.exists, existsAfter: !!post?.exists};
  const out = {lamports: String(BigInt(post.lamports) - BigInt(pre.lamports)),
    dataChanged: pre.dataSha256 !== post.dataSha256};
  if (pre.splToken && post.splToken) out.tokenAmountRaw = String(
    BigInt(post.splToken.amountRaw) - BigInt(pre.splToken.amountRaw));
  if (pre.klendReserve && post.klendReserve) {
    const p = pre.klendReserve, q = post.klendReserve;
    if (p.totalAvailableAmountRaw !== null && q.totalAvailableAmountRaw !== null)
      out.reserveAvailableRaw = String(BigInt(q.totalAvailableAmountRaw) - BigInt(p.totalAvailableAmountRaw));
    out.reserveBorrowedSfChanged = p.borrowedAmountSf !== q.borrowedAmountSf;
  }
  return out;
}

async function simulateCase(spec, blockhash, reserveAddress) {
  const watched = unique(spec.watched);
  const beforeResponse = await connection.getMultipleAccountsInfoAndContext(
    watched.map(item => item.pubkey), 'confirmed');
  const before = Object.fromEntries(watched.map((item, i) => [item.role,
    accountSnapshot(beforeResponse.value[i], item.pubkey.toBase58(), reserveAddress)]));
  const encoded = encodeV1(spec.instructions, spec.payer, blockhash);
  const accounts = compiledRecord(spec.instructions, spec.payer, blockhash);
  const request = {jsonrpc: '2.0', id: ++rpcId, method: 'simulateTransaction', params: [
    encoded.wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'confirmed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(item => item.pubkey.toBase58())}},
  ]};
  let reply;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(request)});
    const text = await response.text();
    if (response.status === 429 || text.startsWith('Too Many Requests')) {
      await sleep(650 * (attempt + 1));
      continue;
    }
    reply = JSON.parse(text);
    break;
  }
  if (!reply) throw new Error('simulateTransaction rate limited after retries');
  if (reply.error) throw new Error(`simulateTransaction: ${JSON.stringify(reply.error)}`);
  const value = reply.result.value;
  const after = Object.fromEntries(watched.map((item, i) => [item.role,
    accountSnapshot(value.accounts?.[i], item.pubkey.toBase58(), reserveAddress)]));
  const deltas = Object.fromEntries(watched.map(item => [item.role,
    stateDelta(before[item.role], after[item.role])]));
  let postChainRead = null;
  let postChainReadSlot = null;
  if (value.err !== null) {
    const reread = await connection.getMultipleAccountsInfoAndContext(
      watched.map(item => item.pubkey), 'confirmed');
    postChainReadSlot = reread.context.slot;
    postChainRead = Object.fromEntries(watched.map((item, i) => [item.role,
      accountSnapshot(reread.value[i], item.pubkey.toBase58(), reserveAddress)]));
  }
  const logs = value.logs || [];
  const depths = logs.map(line => / invoke \[(\d+)\]/.exec(line)).filter(Boolean).map(x => Number(x[1]));
  const fullyRepaid = spec.loan === 'klend' && value.err === null ?
    deltas.flashSupply?.tokenAmountRaw === '0' && deltas.flashFeeVault?.tokenAmountRaw === '0' &&
      deltas.flashReserve?.reserveAvailableRaw === '0' :
    spec.loan === 'project0' && value.err === null ? deltas.project0Vault?.tokenAmountRaw === '0' : null;
  return {
    name: spec.name, purpose: spec.purpose, loan: spec.loan, amountRaw: spec.amountRaw?.toString() || null,
    signerVerification: false, liveSubmission: false, slot: reply.result.context?.slot,
    err: value.err, unitsConsumed: value.unitsConsumed, loadedAccountsDataSize: value.loadedAccountsDataSize,
    v1: {wireBytes: encoded.sizeBytes, messageBytesExcludingSignatures:
      encoded.sizeBytes - 64 * encoded.requiredSignatures, equivalentV0Bytes: encoded.v0Bytes,
      addressCount: encoded.addressCount, writableCount: encoded.writableCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      limits: encoded.config, wireSha256: sha256(encoded.wire), wireBase64: encoded.wire.toString('base64')},
    compiledAccounts: accounts, instructions: spec.instructions.map(instructionRecord),
    watchedAccounts: watched.map(item => ({role: item.role, address: item.pubkey.toBase58()})),
    preSlot: beforeResponse.context.slot, pre: before, post: after, deltas,
    failedSimulationPostAccountsReturned: value.err === null ? null :
      watched.some(item => after[item.role]?.exists),
    postChainReadSlot, postChainRead,
    rollbackMatchesPre: value.err === null ? null : watched.every(item =>
      snapshotEqual(before[item.role], postChainRead[item.role])),
    rollbackInterpretation: value.err === null ? null :
      'The RPC returned null requested accounts for the failed simulation; an immediate read-only chain re-read is recorded separately. The transaction was never submitted.',
    loanAccounting: {persistentObligationAccount: null, debtShareAccounts: [],
      explanation: 'Both lenders implement transaction-scoped flash accounting; no obligation/debt-share account is created.',
      fullyRepaid},
    trace: {topLevelInstructionCount: spec.instructions.length,
      invocationCount: depths.length, maxInvokeDepth: depths.length ? Math.max(...depths) : 0,
      innerInstructionGroups: value.innerInstructions || []},
    logs,
  };
}

async function main() {
  const flashHistory = JSON.parse(fs.readFileSync(__dirname + '/kamino-flash-history.json', 'utf8'));
  const flashHit = flashHistory.hits.find(hit => hit.signature === FLASH_SOURCE_SIGNATURE) || flashHistory.hits[0];
  const klendBorrowTemplate = instructionFromJsonSample(flashHit, 3);
  const klendRepayTemplate = instructionFromJsonSample(flashHit, 13);
  if (!klendBorrowTemplate.programId.equals(KLEND) || !klendRepayTemplate.programId.equals(KLEND))
    throw new Error('KLend source instruction indexes changed');
  const owner = klendBorrowTemplate.keys[0].pubkey;
  const ownerToken = klendBorrowTemplate.keys[6].pubkey;
  const flashReserve = klendBorrowTemplate.keys[3].pubkey;
  const flashSupply = klendBorrowTemplate.keys[5].pubkey;
  const flashFeeVault = klendBorrowTemplate.keys[7].pubkey;
  const flashPre = await connection.getMultipleAccountsInfoAndContext(
    [ownerToken, flashReserve, flashSupply, flashFeeVault], 'confirmed');
  const ownerBalance = flashPre.value[0].data.readBigUInt64LE(64);
  const decodedReserve = decodeReserve(flashPre.value[1].data);
  if (!decodedReserve || decodedReserve.flashLoanFeeSf !== '0')
    throw new Error(`Selected KLend reserve is not currently fee-free: ${JSON.stringify(decodedReserve)}`);
  if (decodedReserve.mint !== USDC.toBase58())
    throw new Error(`Selected KLend reserve is not USDC: ${JSON.stringify(decodedReserve)}`);
  const available = BigInt(decodedReserve.totalAvailableAmountRaw);
  const [authoritySigner] = PublicKey.findProgramAddressSync([Buffer.from('authority_signer')], WORMHOLE);
  const [usdcCustody] = PublicKey.findProgramAddressSync([USDC.toBuffer()], WORMHOLE);
  const [wsolCustody] = PublicKey.findProgramAddressSync([WSOL.toBuffer()], WORMHOLE);
  const refreshSource = JSON.parse(fs.readFileSync(__dirname + '/kamino-direct-refresh-samples.json', 'utf8')).hits[0];
  const refreshMessage = refreshSource.transaction.transaction.message;
  const refreshKeys = [...refreshMessage.accountKeys,
    ...(refreshSource.transaction.meta.loadedAddresses?.writable || []),
    ...(refreshSource.transaction.meta.loadedAddresses?.readonly || [])];
  const refreshIndex = refreshMessage.instructions.findIndex(ix =>
    refreshKeys[ix.programIdIndex] === KLEND.toBase58() &&
    Buffer.from(bs58.decode(ix.data)).toString('hex').startsWith('02da8aeb4fc91966') &&
    refreshKeys[ix.accounts[0]] === flashReserve.toBase58());
  if (refreshIndex < 0) throw new Error('Current KLend reserve refresh sample unavailable');
  const refreshIx = instructionFromJsonSample(refreshSource, refreshIndex);
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  const baseKlendWatched = [meta(owner), meta(ownerToken), meta(flashSupply), meta(flashFeeVault),
    meta(flashReserve), meta(usdcCustody), meta(COMPLETE_CANDIDATE.to), meta(COMPLETE_CANDIDATE.claim)];
  const roleKlend = pubs => pubs.map((pubkey, i) => ({pubkey: pubkey.pubkey,
    role: ['payerWallet', 'borrowerUSDC', 'flashSupply', 'flashFeeVault', 'flashReserve',
      'wormholeUsdcCustody', 'inboundRecipientUSDC', 'inboundClaim'][i]}));
  const withMessages = (base, messages) => [...base, ...messages.map((key, i) =>
    ({role: `message${i}`, pubkey: key}))];
  let nonce = 1000;
  const makeOutbound = (amounts, messages, overrides = {}) => {
    const total = amounts.reduce((sum, amount) => sum + amount, 0n);
    const approve = spl.createApproveInstruction(ownerToken, authoritySigner, owner, total);
    const transfers = amounts.map((amount, i) => transferNative(owner, ownerToken, USDC,
      amount, messages[i], nonce++, overrides));
    return [approve, ...transfers, spl.createRevokeInstruction(ownerToken, owner)];
  };
  const klendPair = (amount, destination = ownerToken, borrowIndex = 0) => [
    setKlendFlash(klendBorrowTemplate, owner, destination, amount),
    setKlendFlash(klendRepayTemplate, owner, destination, amount, borrowIndex),
  ];
  const klendCases = [];
  const addKlend = (name, purpose, amount, instructions, messages = []) => klendCases.push({name, purpose,
    loan: 'klend', amountRaw: amount, payer: owner, instructions,
    watched: withMessages(roleKlend(baseKlendWatched), messages)});
  addKlend('klend_smallest_pair_control', 'Smallest nonzero current-config positive flash-loan control.', 1n,
    klendPair(1n));
  addKlend('klend_available_exact_pair_control', 'Current decoded available-liquidity boundary.', available,
    klendPair(available));
  addKlend('klend_available_plus_one_negative', 'First amount above decoded available liquidity.', available + 1n,
    klendPair(available + 1n));
  {
    const pair = klendPair(available * 99n / 100n);
    addKlend('klend_same_mint_large_plus_dust_outbound',
      'Fee-free near-liquidity USDC borrow, one-raw-unit Wormhole outbound transfer, full repay.',
      available * 99n / 100n, [pair[0], ...makeOutbound([1n], [Keypair.generate().publicKey]), pair[1]], []);
    const last = klendCases[klendCases.length - 1];
    const message = last.instructions.find(ix => ix.programId.equals(WORMHOLE)).keys[8].pubkey;
    last.watched.push({role: 'message0', pubkey: message});
  }
  {
    const amount = ownerBalance;
    const pair = klendPair(1n);
    const message = Keypair.generate().publicKey;
    addKlend('klend_outbound_exact_prefunded_balance',
      'Positive funded control: outbound consumes exactly the pre-existing wallet balance and the one-unit loan is fully repaid.',
      1n, [pair[0], ...makeOutbound([amount], [message]), pair[1]], [message]);
  }
  {
    const amount = ownerBalance + 1n;
    const pair = klendPair(1n);
    const message = Keypair.generate().publicKey;
    addKlend('klend_outbound_prefunded_plus_one_rollback',
      'One raw unit beyond pre-funding must fail at repayment and roll the whole transaction back.',
      1n, [pair[0], ...makeOutbound([amount], [message]), pair[1]], [message]);
  }
  {
    const pair = klendPair(available * 99n / 100n);
    addKlend('klend_inbound_complete_native_positive',
      'Same-mint cross-program positive: valid unclaimed USDC VAA executes between large borrow and repay.',
      available * 99n / 100n, [pair[0], completeNative(owner), pair[1]]);
    addKlend('klend_inbound_recipient_substitution_negative',
      'Attempt to redirect a valid inbound VAA to the borrower token account.',
      available * 99n / 100n, [pair[0], completeNative(owner, {5: ownerToken}), pair[1]]);
    addKlend('klend_inbound_zero_fee_recipient_alias',
      'Fee-recipient alias to borrower token account when VAA fee is zero.',
      available * 99n / 100n, [pair[0], completeNative(owner, {6: ownerToken}), pair[1]]);
  }
  for (const count of [2, 4, 8, 9, 10, 11, 12]) {
    const messages = Array.from({length: count}, () => Keypair.generate().publicKey);
    const pair = klendPair(1n);
    addKlend(`klend_repeated_${count}_outbound_legs`,
      `Repeated one-unit Wormhole outbound legs (${count}) inside one flash scope.`,
      1n, [pair[0], ...makeOutbound(Array(count).fill(1n), messages), pair[1]], messages);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n, ownerToken, 1);
    addKlend('klend_refresh_before_borrow', 'Reserve refresh immediately before cross-program flash composition.',
      1n, [refreshIx, pair[0], ...makeOutbound([1n], [message]), pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    addKlend('klend_refresh_between_borrow_and_bridge', 'Reserve refresh between borrow and Wormhole leg.',
      1n, [pair[0], refreshIx, ...makeOutbound([1n], [message]), pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    addKlend('klend_refresh_between_bridge_and_repay', 'Reserve refresh after Wormhole leg but before repay.',
      1n, [pair[0], ...makeOutbound([1n], [message]), refreshIx, pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    addKlend('klend_refresh_after_repay', 'Reserve refresh after complete flash pair and Wormhole leg.',
      1n, [pair[0], ...makeOutbound([1n], [message]), pair[1], refreshIx], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    const outbound = makeOutbound([1n], [message], {4: flashSupply});
    addKlend('klend_alias_wormhole_custody_to_flash_supply',
      'Alias Wormhole custody account to KLend supply vault.', 1n,
      [pair[0], ...outbound, pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    const outbound = makeOutbound([1n], [message], {2: flashSupply});
    addKlend('klend_alias_wormhole_source_to_flash_supply',
      'Alias Wormhole source account to KLend supply vault.', 1n,
      [pair[0], ...outbound, pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n, ownerToken, 3);
    addKlend('klend_wormhole_before_borrow', 'Wormhole outbound leg before flash borrow.', 1n,
      [...makeOutbound([1n], [message]), pair[0], pair[1]], [message]);
  }
  {
    const message = Keypair.generate().publicKey, pair = klendPair(1n);
    addKlend('klend_wormhole_after_repay', 'Wormhole outbound leg after flash repayment.', 1n,
      [pair[0], pair[1], ...makeOutbound([1n], [message])], [message]);
  }
  {
    const pair = klendPair(1n);
    addKlend('klend_repay_before_borrow', 'Invalid flash instruction order.', 1n, [pair[1], pair[0]]);
  }

  const p0 = await decompile(PROJECT0_SOURCE_SIGNATURE);
  const sourceIx = discriminator => p0.message.instructions.find(ix =>
    ix.programId.equals(PROJECT0) && Buffer.from(ix.data).subarray(0, 8).equals(discriminator));
  const p0Start = cloneIx(sourceIx(START)), p0End = cloneIx(sourceIx(END));
  const p0BorrowTemplate = cloneIx(sourceIx(P0_BORROW)), p0RepayTemplate = cloneIx(sourceIx(P0_REPAY));
  if (!p0Start || !p0End || !p0BorrowTemplate || !p0RepayTemplate)
    throw new Error('Project 0 source transaction is incomplete');
  const p0Payer = p0.message.payerKey;
  const p0Authority = p0BorrowTemplate.keys[2].pubkey;
  const p0Vault = p0BorrowTemplate.keys[6].pubkey;
  const p0Bank = p0BorrowTemplate.keys[3].pubkey;
  const p0Destination = spl.getAssociatedTokenAddressSync(WSOL, p0Authority);
  const createDestination = spl.createAssociatedTokenAccountIdempotentInstruction(
    p0Payer, p0Destination, p0Authority, WSOL);
  const p0VaultInfo = await connection.getAccountInfo(p0Vault, 'confirmed');
  const p0Available = p0VaultInfo.data.readBigUInt64LE(64);
  const setP0Amount = (template, amount) => {const ix = cloneIx(template); ix.data.writeBigUInt64LE(amount, 8);
    if (ix.keys[4]) ix.keys[4].pubkey = p0Destination; return ix;};
  const p0Make = middle => {const list = [cloneIx(p0Start), cloneIx(createDestination), ...middle.map(cloneIx), cloneIx(p0End)];
    list[0].data.writeBigUInt64LE(BigInt(list.length - 1), 8); return list;};
  const p0BaseWatched = [{role: 'payerWallet', pubkey: p0Payer},
    {role: 'project0BorrowerWSOL', pubkey: p0Destination}, {role: 'project0Vault', pubkey: p0Vault},
    {role: 'project0Bank', pubkey: p0Bank}, {role: 'outboundWsolCustody', pubkey: wsolCustody}];
  const project0Cases = [];
  const addP0 = (name, purpose, borrowAmount, bridgeAmounts) => {
    const borrow = setP0Amount(p0BorrowTemplate, borrowAmount);
    const repay = setP0Amount(p0RepayTemplate, borrowAmount);
    const messages = bridgeAmounts.map(() => Keypair.generate().publicKey);
    const total = bridgeAmounts.reduce((sum, amount) => sum + amount, 0n);
    const approve = spl.createApproveInstruction(p0Destination, authoritySigner, p0Authority, total);
    const transfers = bridgeAmounts.map((amount, i) => transferNative(p0Payer, p0Destination, WSOL,
      amount, messages[i], nonce++));
    const revoke = spl.createRevokeInstruction(p0Destination, p0Authority);
    project0Cases.push({name, purpose, loan: 'project0', amountRaw: borrowAmount, payer: p0Payer,
      instructions: p0Make([borrow, approve, ...transfers, revoke, repay]),
      watched: [...p0BaseWatched, ...messages.map((pubkey, i) => ({role: `message${i}`, pubkey}))]});
  };
  for (const amount of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n])
    addP0(`project0_minimum_sweep_raw_${amount}`,
      `Project 0 minimum-loan sweep; Wormhole receives a one-raw-unit WSOL sub-threshold leg.`,
      amount, [1n]);
  addP0('project0_wsol_raw_9_truncation', 'Largest sub-threshold WSOL amount.', 9n, [9n]);
  addP0('project0_wsol_raw_10_boundary', 'First WSOL amount that moves custody value.', 10n, [10n]);
  addP0('project0_wsol_raw_11_boundary_plus_dust', 'First moving amount plus one discarded raw-unit remainder.', 11n, [11n]);
  addP0('project0_near_liquidity_plus_subthreshold_bridge',
    'Near-current-vault-liquidity Project 0 loan plus one-unit truncated Wormhole leg.',
    p0Available - 1n, [1n]);
  const p0HistoricalAmount = p0BorrowTemplate.data.readBigUInt64LE(8);
  for (const amount of [p0HistoricalAmount, 1000000000n, 10000000000n, 100000000000n,
    1000000000000n, p0Available * 99n / 100n, p0Available * 999n / 1000n,
    p0Available * 9999n / 10000n, p0Available * 99999n / 100000n,
    p0Available, p0Available + 1n])
    addP0(`project0_large_sweep_raw_${amount}`,
      'Project 0 large-loan sweep plus one-unit truncated Wormhole leg.', amount, [1n]);
  for (const count of [4, 7, 8])
    addP0(`project0_${count}_repeated_subthreshold_legs`,
      'Repeated zero-effective-value Wormhole legs inside one Project 0 flash scope.',
      9n, Array(count).fill(1n));

  const specs = [...klendCases, ...project0Cases];
  const results = [];
  for (const spec of specs) {
    try {
      const result = await simulateCase(spec, blockhash, flashReserve.toBase58());
      results.push(result);
      console.log(JSON.stringify({name: result.name, err: result.err, units: result.unitsConsumed,
        bytes: result.v1.wireBytes, accounts: result.v1.addressCount,
        fullyRepaid: result.loanAccounting.fullyRepaid, rollback: result.rollbackMatchesPre,
        logTail: result.logs.filter(line => line.includes('Instruction:') || line.includes('failed:')).slice(-6)}));
    } catch (error) {
      let encoding = null;
      try {
        const encoded = encodeV1(spec.instructions, spec.payer, blockhash);
        encoding = {v1: {wireBytes: encoded.sizeBytes,
          messageBytesExcludingSignatures: encoded.sizeBytes - 64 * encoded.requiredSignatures,
          equivalentV0Bytes: encoded.v0Bytes, addressCount: encoded.addressCount,
          writableCount: encoded.writableCount, instructionCount: encoded.instructionCount,
          requiredSignatures: encoded.requiredSignatures, limits: encoded.config,
          wireSha256: sha256(encoded.wire), wireBase64: encoded.wire.toString('base64')},
        compiledAccounts: compiledRecord(spec.instructions, spec.payer, blockhash),
        instructions: spec.instructions.map(instructionRecord)};
      } catch (encodeError) {
        encoding = {encodingError: encodeError.stack || encodeError.message};
      }
      results.push({name: spec.name, purpose: spec.purpose, loan: spec.loan,
        amountRaw: spec.amountRaw?.toString() || null,
        localOrTransportError: error.stack || error.message, ...encoding});
      console.log(JSON.stringify({name: spec.name, localOrTransportError: error.message}));
    }
  }

  const output = {
    generatedAt: new Date().toISOString(), transport: 'read-only current-mainnet simulateTransaction only',
    liveSubmission: false, signatureVerification: false,
    v1Limits: {wireBytes: 4096, inlineAddresses: 64, addressLookupTables: false},
    programs: {wormholeTokenBridge: WORMHOLE.toBase58(), wormholeCore: CORE.toBase58(),
      klend: KLEND.toBase58(), project0: PROJECT0.toBase58()},
    sourceTransactions: {klend: {signature: FLASH_SOURCE_SIGNATURE, slot: flashHit.slot},
      project0: {signature: PROJECT0_SOURCE_SIGNATURE, slot: p0.slot},
      inboundVaa: {postedVaa: COMPLETE_CANDIDATE.postedVaa.toBase58(), emitterChain: 22,
        sequence: COMPLETE_CANDIDATE.sequence, amountRaw: COMPLETE_CANDIDATE.rawAmount.toString(),
        feeRaw: COMPLETE_CANDIDATE.feeRaw.toString(), recipient: COMPLETE_CANDIDATE.to.toBase58()}},
    currentConfiguration: {observedSlot: flashPre.context.slot, klendReserve: flashReserve.toBase58(),
      klendReserveDecoded: decodedReserve, verifiedFeeFree: decodedReserve.flashLoanFeeSf === '0',
      feeConclusion: 'The configured scaled flash-loan fee is exactly zero; successful one-unit repayment is not fee rounding.',
      klendOwner: owner.toBase58(), klendOwnerUsdc: ownerToken.toBase58(),
      klendOwnerUsdcPreRaw: ownerBalance.toString(), klendSupplyVault: flashSupply.toBase58(),
      klendFeeVault: flashFeeVault.toBase58(), availableRaw: available.toString(),
      project0Payer: p0Payer.toBase58(), project0Authority: p0Authority.toBase58(),
      project0DestinationWsol: p0Destination.toBase58(), project0Vault: p0Vault.toBase58(),
      project0VaultPreRaw: p0Available.toString()},
    roundingModel: {usdcDecimals: 6, usdcDivisor: '1', wsolDecimals: 9, wsolDivisor: '10',
      implementation: 'amount_trunc = (raw_amount / 10^(max(decimals,8)-8)) * divisor'},
    resultCount: results.length, results,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({output: OUT, resultCount: results.length,
    successes: results.filter(result => result.err === null).length,
    runtimeFailures: results.filter(result => result.err).length,
    localOrTransportErrors: results.filter(result => result.localOrTransportError).length}, null, 2));
}

main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
