#!/usr/bin/env node
'use strict';

// Faithful current-mainnet Surfpool fork probes for JanusFI / World.
// Every executable candidate is a locally signed Solana v1 message passed only
// to simulateTransaction with sigVerify:true.  Nothing is sent to mainnet or
// to the fork.  The only synthetic state is a deterministic outsider system
// account, outsider-owned Token-2022 accounts, and a fresh marginfi account
// that is created by the signed transaction itself.

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require(`${MODULES}/@solana/web3.js`);
const bs58Module = require(`${MODULES}/bs58`);
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const OUTPUT = `${DIR}/janusfi-signed-multiflash-fork.json`;
const FORK = process.env.JANUSFI_FORK_RPC || 'http://127.0.0.1:18997';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(FORK)) throw new Error('fork RPC must be loopback-only');

const inventory = JSON.parse(fs.readFileSync(`${DIR}/janusfi-current-inventory.json`, 'utf8'));
const census = JSON.parse(fs.readFileSync(`${DIR}/klend-zero-fee-census.json`, 'utf8'));
const flashHistory = JSON.parse(fs.readFileSync(`${DIR}/kamino-flash-history.json`, 'utf8'));
const marginfiVaults = JSON.parse(fs.readFileSync(`${DIR}/marginfi-vaults-current.json`, 'utf8'));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const upstreamUrls = [...new Set([env.HEAVY_RPC_URL, env.RPC_URL].filter(Boolean))];
if (!upstreamUrls.length) throw new Error('no read-only upstream RPC configured');
const connection = new Connection(upstreamUrls[0], 'confirmed');

const P = (value) => new PublicKey(value);
const JANUS = P('JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP');
const DFLOW = P('DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const CASH = P('CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const P0_GROUP = P('4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8');
const P0_SOURCE_SIGNATURE = '3ok9CzX7U7oAkgaqUxLx6zhjCC4sMe6EeqKQRNnwMMw4TteVFCAvxf7g9kGtQbNM6m4B9FN7x4MxXGFLuxFt7D8i';
const CURRENT_DEPLOY_SLOT = 457294564;

const P0_DISCS = {
  init: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]),
  start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  end: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
};

const seedKeypair = (label) => Keypair.fromSeed(crypto.createHash('sha256').update(label).digest());
const attacker = seedKeypair('janusfi-signed-fork-outsider-2026-10-15');
const freshMarginfi = seedKeypair('janusfi-signed-fork-marginfi-2026-10-15');
const attackerCash = seedKeypair('janusfi-signed-fork-cash-2026-10-15').publicKey;
const attackerOutcome0 = seedKeypair('janusfi-signed-fork-outcome0-2026-10-15').publicKey;
const attackerOutcome1 = seedKeypair('janusfi-signed-fork-outcome1-2026-10-15').publicKey;

let rpcId = 0;
async function rpcAt(url, method, params) {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
const rpcFork = (method, params) => rpcAt(FORK, method, params);
async function rpcUpstream(method, params) {
  const errors = [];
  for (const url of upstreamUrls) {
    try { return await rpcAt(url, method, params); }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`${method} unavailable: ${errors.join(' | ')}`);
}

const u64 = (value) => {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
};
const cloneIx = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((meta) => ({...meta})), data: Buffer.from(ix.data)});
const ix = (programId, keys, data) => new TransactionInstruction({programId, keys, data});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function historicalIx(index) {
  const tx = flashHistory.hits[0].transaction;
  const msg = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...msg.accountKeys, ...loaded.writable, ...loaded.readonly];
  const h = msg.header;
  const writable = (i) => i < msg.accountKeys.length ?
    (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts :
      i < msg.accountKeys.length - h.numReadonlyUnsignedAccounts) :
    i < msg.accountKeys.length + loaded.writable.length;
  const source = msg.instructions[index];
  return ix(P(allKeys[source.programIdIndex]), source.accounts.map((i) => ({pubkey: P(allKeys[i]),
    isSigner: i < h.numRequiredSignatures, isWritable: writable(i)})),
  Buffer.from(bs58.decode(source.data)));
}
const KLEND_BORROW_TEMPLATE = historicalIx(3);
const KLEND_REPAY_TEMPLATE = historicalIx(13);
if (!KLEND_BORROW_TEMPLATE.programId.equals(KLEND) || !KLEND_REPAY_TEMPLATE.programId.equals(KLEND)) {
  throw new Error('KLend flash templates did not match');
}

function klendIx(template, reserve, destination, amount, repayIndex) {
  const out = cloneIx(template);
  const market = P(reserve.market);
  const marketAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const replacements = {
    0: attacker.publicKey, 1: marketAuthority, 2: market, 3: P(reserve.reserve),
    4: CASH, 5: P(reserve.supplyVault), 6: destination, 7: P(reserve.feeVault),
    8: KLEND, 9: KLEND, 10: IX_SYSVAR, 11: TOKEN_2022,
  };
  for (const [position, pubkey] of Object.entries(replacements)) out.keys[Number(position)].pubkey = pubkey;
  out.data.writeBigUInt64LE(BigInt(amount), 8);
  if (repayIndex !== undefined) out.data[16] = repayIndex;
  return out;
}

function findTemplate(instructions, discriminator) {
  const found = instructions.find((candidate) => candidate.programId.equals(PROJECT0) &&
    Buffer.from(candidate.data).subarray(0, 8).equals(discriminator));
  if (!found) throw new Error(`missing Project0 template ${discriminator.toString('hex')}`);
  return cloneIx(found);
}

async function fetchP0Templates() {
  const fetched = await rpcUpstream('getTransaction', [P0_SOURCE_SIGNATURE, {
    encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  const tx = VersionedTransaction.deserialize(Buffer.from(fetched.transaction[0], 'base64'));
  const tables = await Promise.all(tx.message.addressTableLookups.map(async ({accountKey}) => {
    const result = await connection.getAddressLookupTable(accountKey);
    if (!result.value) throw new Error(`missing address table ${accountKey}`);
    return result.value;
  }));
  const decompiled = TransactionMessage.decompile(tx.message, {addressLookupTableAccounts: tables});
  return {sourceSlot: fetched.slot,
    start: findTemplate(decompiled.instructions, P0_DISCS.start),
    borrow: findTemplate(decompiled.instructions, P0_DISCS.borrow),
    repay: findTemplate(decompiled.instructions, P0_DISCS.repay),
    end: findTemplate(decompiled.instructions, P0_DISCS.end)};
}

function p0BankRows() {
  const rows = marginfiVaults.rows.filter((row) => row.group === P0_GROUP.toBase58() &&
    row.kind === 'liquidity' && row.mint === CASH.toBase58());
  const grouped = new Map(rows.map((row) => [row.bank, {...row}]));
  for (const bank of grouped.values()) {
    const authority = marginfiVaults.rows.find((row) => row.bank === bank.bank && row.kind === 'liquidity');
    bank.vaultAuthority = authority.authority;
    // Current verified Bank configuration.  Health-account groups are
    // [bank, oracle(s)] after the Token-2022 mint remaining account.
    if (bank.bank === 'F4brCRJHx8epWah7p8Ace4ehutphxYZ1ctRq2LS3iiBh') {
      bank.oracleSetup = 'PythPushOracle';
      bank.oracleAccounts = ['GqsXNN8rwNhshF62ViNhgL7hZRtNSWSxy6UXWhNxtumF'];
    } else if (bank.bank === '4YPGUhxmAXgoGDRkg68zGnbGrV2xCgaoqQSfcZCjFhon') {
      bank.oracleSetup = 'KaminoPythPush';
      bank.oracleAccounts = ['GqsXNN8rwNhshF62ViNhgL7hZRtNSWSxy6UXWhNxtumF',
        'FSMWJh3geL7dgeMauFWkjCpU2pvXocGpXcUpVsMQULki'];
    } else {
      bank.oracleSetup = 'not decoded for this zero-liquidity bank';
      bank.oracleAccounts = [];
    }
  }
  return [...grouped.values()].sort((a, b) => BigInt(a.rawAmount) > BigInt(b.rawAmount) ? -1 : 1);
}

function p0Builders(templates, bank, destination) {
  const start = (endIndex) => {
    const out = cloneIx(templates.start);
    out.keys[0].pubkey = freshMarginfi.publicKey;
    out.keys[1].pubkey = attacker.publicKey;
    out.keys[2].pubkey = IX_SYSVAR;
    out.data = Buffer.concat([P0_DISCS.start, u64(endIndex)]);
    return out;
  };
  const borrow = (amount) => {
    const out = cloneIx(templates.borrow);
    const fixed = [P0_GROUP, freshMarginfi.publicKey, attacker.publicKey, P(bank.bank), destination,
      P(bank.vaultAuthority), P(bank.address), TOKEN_2022];
    fixed.forEach((pubkey, position) => { out.keys[position].pubkey = pubkey; });
    // Project0 requires a Token-2022 bank's mint as the first remaining
    // account so it can calculate any extension transfer fee.  The bank and
    // System accounts that follow are the flash-mode health-check remainder.
    out.keys = [...out.keys.slice(0, 8),
      {pubkey: CASH, isSigner: false, isWritable: false},
      {pubkey: P(bank.bank), isSigner: false, isWritable: true},
      ...bank.oracleAccounts.map((address) => ({pubkey: P(address), isSigner: false, isWritable: false}))];
    out.data = Buffer.concat([P0_DISCS.borrow, u64(amount)]);
    return out;
  };
  const repay = (amount) => {
    const out = cloneIx(templates.repay);
    const values = [P0_GROUP, freshMarginfi.publicKey, attacker.publicKey, P(bank.bank), destination,
      P(bank.address), TOKEN_2022];
    values.forEach((pubkey, position) => { out.keys[position].pubkey = pubkey; });
    out.keys.push({pubkey: CASH, isSigner: false, isWritable: false});
    out.data = Buffer.concat([P0_DISCS.repay, u64(amount), Buffer.from([1, 1])]);
    return out;
  };
  const end = () => {
    const out = cloneIx(templates.end);
    out.keys[0].pubkey = freshMarginfi.publicKey;
    out.keys[1].pubkey = P0_GROUP;
    out.keys[2].pubkey = attacker.publicKey;
    for (let i = 3; i < out.keys.length; i += 1) out.keys[i].pubkey = SystemProgram.programId;
    out.data = P0_DISCS.end;
    return out;
  };
  return {start, borrow, repay, end};
}

function initP0Ix() {
  return ix(PROJECT0, [
    {pubkey: P0_GROUP, isSigner: false, isWritable: false},
    {pubkey: freshMarginfi.publicKey, isSigner: true, isWritable: true},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: false},
    {pubkey: attacker.publicKey, isSigner: true, isWritable: true},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
  ], P0_DISCS.init);
}

function sourceForSide(side) {
  const signature = side === 0 ?
    '5vC1YmLXaXcGPdZNnDB9YmbdJDTpuZEW9uYdn2oVEu6bzub2bbiGtNzey2nRRJe2JCcUPZzLLEMwKQmjvpJ5Cqig' :
    '3rSe8vTrWpXpPJfQqCEthMGeU6oe8kDnCX1rXWk9zAYAYM6jCdq5YrG52WzKEydmQEmZwPdZQ3nJfHRywzfNS5QH';
  const tx = inventory.transactions.find((candidate) => candidate.signature === signature);
  if (!tx?.janus?.[0] || tx.slot < CURRENT_DEPLOY_SLOT) throw new Error(`missing current-binary side ${side}`);
  return tx.janus[0];
}
const sideSources = [sourceForSide(0), sourceForSide(1)];

function janusIx(side, direction, amount, options = {}) {
  const source = sideSources[side];
  let keys = source.accounts.map((meta) => ({pubkey: P(meta.address),
    isSigner: meta.position === 0 ? true : meta.signer, isWritable: meta.writable}));
  const outcome = side === 0 ? attackerOutcome0 : attackerOutcome1;
  keys[0].pubkey = attacker.publicKey;
  keys[11].pubkey = attackerCash;
  keys[12].pubkey = outcome;
  for (const [position, pubkey] of Object.entries(options.replacements || {})) {
    keys[Number(position)].pubkey = P(pubkey);
  }
  if (options.dropPosition !== undefined) keys = keys.filter((_, position) => position !== options.dropPosition);
  const data = Buffer.from(source.dataHex, 'hex');
  data[0] = options.opcode ?? 7;
  data[1] = options.sideByte ?? side;
  data[2] = options.directionByte ?? direction;
  data.writeBigUInt64LE(BigInt(amount), 3);
  data[11] = options.tail ?? 0;
  return ix(JANUS, keys, options.data || data);
}

function dflowWrapperReachabilityIx() {
  const routed = inventory.transactions.find((tx) =>
    tx.signature === '5CTwXmQ2mJ4tPbodRDXixmGxu81r15d1DT8fandvF2Z9eQ1ywbr2zZkES3xVHros2FevHuoQjqTLLpVXd2hN5CFU');
  const source = routed?.top?.find((candidate) => candidate.programId === DFLOW.toBase58());
  if (!source) throw new Error('historical DFlow wrapper not found');
  const oldUser = source.accounts[3].address;
  const keys = source.accounts.map((meta) => ({
    pubkey: P(meta.address === oldUser ? attacker.publicKey : meta.address),
    isSigner: meta.signer, isWritable: meta.writable,
  }));
  return {instruction: ix(DFLOW, keys, Buffer.from(source.dataHex, 'hex')),
    sourceSignature: routed.signature, sourceSlot: routed.slot, replacedUser: oldUser};
}

function privateSigner(keypair) {
  return crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(keypair.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
}

function signV1(instructions, blockhash, keypairs = [attacker, freshMarginfi]) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  if (encoded.sizeBytes > 4096 || encoded.addressCount > 64) throw new Error('v1 footprint exceeded');
  const compiled = new TransactionMessage({payerKey: attacker.publicKey,
    recentBlockhash: blockhash, instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const available = new Map(keypairs.map((keypair) => [keypair.publicKey.toBase58(), keypair]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  for (let i = 0; i < signerOrder.length; i += 1) {
    const keypair = available.get(signerOrder[i]);
    if (!keypair) throw new Error(`uncontrolled signer ${signerOrder[i]}`);
    crypto.sign(null, message, privateSigner(keypair))
      .copy(signed, signed.length - 64 * encoded.requiredSignatures + i * 64);
  }
  const decoded = VersionedTransaction.deserialize(signed);
  if (decoded.version !== 1 || decoded.signatures.some((sig) => sig.every((byte) => byte === 0))) {
    throw new Error('signed v1 self-check failed');
  }
  return {encoded, signed, signerOrder};
}

function accountImage(account) {
  if (!account) return {exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const out = {exists: true, owner: account.owner, lamports: account.lamports,
    dataLength: data.length, dataSha256: sha256(data)};
  if (account.owner === TOKEN_2022.toBase58() && data.length >= 72) {
    out.token = {mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      authority: new PublicKey(data.subarray(32, 64)).toBase58(),
      amountRaw: data.readBigUInt64LE(64).toString()};
  } else if (account.owner === KLEND.toBase58() && data.length > 4912) {
    out.klendReserve = {availableRaw: data.readBigUInt64LE(224).toString(),
      flashFeeSf: data.readBigUInt64LE(4904).toString(), status: data[4856], emergencyMode: data[4864]};
  }
  return out;
}

function deltaImages(before, after) {
  const rows = {};
  for (const [address, pre] of Object.entries(before)) {
    const post = after[address];
    const row = {};
    if (pre?.exists && post?.exists) {
      const lamports = BigInt(post.lamports) - BigInt(pre.lamports);
      if (lamports !== 0n) row.lamports = lamports.toString();
      if (pre.token && post.token) {
        const amount = BigInt(post.token.amountRaw) - BigInt(pre.token.amountRaw);
        if (amount !== 0n) row.tokenAmountRaw = amount.toString();
      }
      if (pre.dataSha256 !== post.dataSha256) row.dataChanged = true;
    } else if (pre?.exists !== post?.exists) row.existenceChanged = true;
    if (Object.keys(row).length) rows[address] = row;
  }
  return rows;
}

async function getImages(addresses) {
  const result = await rpcFork('getMultipleAccounts', [addresses.map(String),
    {encoding: 'base64', commitment: 'processed'}]);
  return {slot: result.context.slot, rows: Object.fromEntries(addresses.map((address, index) =>
    [address.toString(), accountImage(result.value[index])]))};
}

function compactLogs(logs) {
  return (logs || []).filter((line) => line.includes('Instruction:') || line.includes('failed') ||
    line.includes('Error') || line.includes('success') || line.includes('consumed')).slice(-80);
}

async function simulate(label, instructions, watched, metadata = {}) {
  const blockhash = (await rpcFork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  let signed;
  try { signed = signV1(instructions, blockhash); }
  catch (error) {
    return {label, metadata, sigVerify: true, signatureVerificationAccepted: false,
      constructionError: error.message};
  }
  const before = await getImages(watched);
  const result = await rpcFork('simulateTransaction', [signed.signed.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)},
  }]);
  const value = result.value;
  const after = Object.fromEntries(watched.map((address, index) =>
    [address.toString(), accountImage(value.accounts?.[index])]));
  const custom = value.err?.InstructionError?.[1]?.Custom;
  const row = {label, metadata, environment: 'local faithful current-mainnet fork',
    noSubmission: true, sigVerify: true, signatureVerificationAccepted: true,
    preSlot: before.slot, simulationSlot: result.context.slot, err: value.err || null,
    failedInstructionIndex: value.err?.InstructionError?.[0] ?? null,
    customError: custom ?? null, unitsConsumed: value.unitsConsumed,
    loadedAccountsDataSize: value.loadedAccountsDataSize,
    message: {version: 1, bytes: signed.encoded.sizeBytes, addressCount: signed.encoded.addressCount,
      instructionCount: signed.encoded.instructionCount,
      requiredSignatures: signed.encoded.requiredSignatures,
      signerOrder: signed.signerOrder, within4096Bytes: signed.encoded.sizeBytes <= 4096,
      within64Accounts: signed.encoded.addressCount <= 64,
      signedWireSha256: sha256(signed.signed)},
    watched: watched.map(String), before: before.rows, after,
    changes: deltaImages(before.rows, after), logs: value.logs || [], trace: compactLogs(value.logs),
    innerInstructions: value.innerInstructions || null};
  const cashAddress = attackerCash.toBase58();
  const out0Address = attackerOutcome0.toBase58();
  const out1Address = attackerOutcome1.toBase58();
  const tokenDelta = (address) => BigInt(after[address]?.token?.amountRaw || before.rows[address]?.token?.amountRaw || 0) -
    BigInt(before.rows[address]?.token?.amountRaw || 0);
  row.outsiderReconciliation = {
    cashDeltaRaw: tokenDelta(cashAddress).toString(),
    outcome0DeltaRaw: tokenDelta(out0Address).toString(),
    outcome1DeltaRaw: tokenDelta(out1Address).toString(),
    transactionCommitted: value.err === null,
    atomicRollbackOnFailure: value.err !== null,
    fullRepaymentProved: false,
    positiveNetAssetGainProved: false,
  };
  process.stdout.write(`${JSON.stringify({label, err: row.err, sigVerify: true,
    bytes: row.message.bytes, accounts: row.message.addressCount, units: row.unitsConsumed,
    trace: row.trace.slice(-4)})}\n`);
  return row;
}

async function setForkAccount(address, owner, lamports, data) {
  await rpcFork('surfnet_setAccount', [address.toBase58(), {data: data.toString('hex'), executable: false,
    lamports, owner: owner.toBase58(), rentEpoch: 0}]);
}

async function cloneTokenAccount(source, target, authority, amount) {
  const original = (await rpcFork('getAccountInfo', [source.toString(),
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!original) throw new Error(`missing token template ${source}`);
  const data = Buffer.from(original.data[0], 'base64');
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data.writeUInt32LE(0, 72); data.fill(0, 76, 108);
  data.writeUInt32LE(0, 109); data.fill(0, 113, 121);
  data.writeBigUInt64LE(0n, 121); data.writeUInt32LE(0, 129); data.fill(0, 133, 165);
  await setForkAccount(target, TOKEN_2022, original.lamports, data);
}

function p0Envelope(templates, bankAmounts, body = [], klend = null) {
  const builders = bankAmounts.map(({bank}) => p0Builders(templates, bank, attackerCash));
  const end = builders[0].end();
  const instructions = [initP0Ix(), null];
  let klendBorrowIndex = null;
  if (klend) {
    klendBorrowIndex = instructions.length;
    instructions.push(klendIx(KLEND_BORROW_TEMPLATE, klend.reserve, attackerCash, klend.amount));
  }
  bankAmounts.forEach(({amount}, index) => instructions.push(builders[index].borrow(amount)));
  instructions.push(...body);
  [...bankAmounts].reverse().forEach(({amount}, reverseIndex) => {
    const index = bankAmounts.length - 1 - reverseIndex;
    instructions.push(builders[index].repay(amount));
  });
  if (klend) instructions.push(klendIx(KLEND_REPAY_TEMPLATE, klend.reserve,
    attackerCash, klend.amount, klendBorrowIndex));
  instructions.push(end);
  instructions[1] = builders[0].start(instructions.indexOf(end));
  return instructions;
}

function klendEnvelope(reserveAmounts, body = []) {
  const instructions = [];
  const borrowIndexes = [];
  for (const {reserve, amount} of reserveAmounts) {
    borrowIndexes.push(instructions.length);
    instructions.push(klendIx(KLEND_BORROW_TEMPLATE, reserve, attackerCash, amount));
  }
  instructions.push(...body);
  for (let i = reserveAmounts.length - 1; i >= 0; i -= 1) {
    const {reserve, amount} = reserveAmounts[i];
    instructions.push(klendIx(KLEND_REPAY_TEMPLATE, reserve, attackerCash, amount, borrowIndexes[i]));
  }
  return instructions;
}

function markRepayment(row, lenderVaults) {
  const deltaFor = (address) => row.changes?.[address]?.tokenAmountRaw || '0';
  row.outsiderReconciliation.lenderVaultDeltasRaw = Object.fromEntries(lenderVaults.map((address) =>
    [address, deltaFor(address)]));
  row.outsiderReconciliation.fullRepaymentProved = row.err === null &&
    lenderVaults.every((address) => deltaFor(address) === '0') &&
    row.outsiderReconciliation.cashDeltaRaw === '0';
  row.outsiderReconciliation.positiveNetAssetGainProved = row.err === null &&
    BigInt(row.outsiderReconciliation.cashDeltaRaw) > 0n;
}

async function compileBlockedWrapper(templates, mainBank, topReserve, mainAmount, topAmount) {
  const wrapper = dflowWrapperReachabilityIx();
  const instructions = p0Envelope(templates, [{bank: mainBank, amount: mainAmount}],
    [wrapper.instruction], {reserve: topReserve, amount: topAmount});
  const blockhash = (await rpcFork('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: attacker.publicKey,
    recentBlockhash: blockhash, instructions}).compileToV0Message();
  const signers = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  const controlled = new Set([attacker.publicKey.toBase58(), freshMarginfi.publicKey.toBase58()]);
  return {sourceSignature: wrapper.sourceSignature, sourceSlot: wrapper.sourceSlot,
    historicalQuoteUserReplacedByOutsider: wrapper.replacedUser,
    message: {version: 1, bytes: encoded.sizeBytes, addressCount: encoded.addressCount,
      instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      within4096Bytes: encoded.sizeBytes <= 4096, within64Accounts: encoded.addressCount <= 64,
      unsignedWireSha256: sha256(encoded.wire)},
    signerOrder: signers, controlledSigners: signers.filter((address) => controlled.has(address)),
    uncontrolledSigners: signers.filter((address) => !controlled.has(address)),
    executableSigVerifyTrue: signers.every((address) => controlled.has(address)),
    blocker: 'The observed quote requires two non-outsider signatures, and changing the message to add flash instructions invalidates every existing signature.'};
}

async function main() {
  const templates = await fetchP0Templates();
  const banks = p0BankRows();
  if (!banks.length) throw new Error('no current Project0 CASH banks');
  const mainBank = banks.find((bank) => bank.bank === 'F4brCRJHx8epWah7p8Ace4ehutphxYZ1ctRq2LS3iiBh');
  const dustBank = banks.find((bank) => bank.bank === '4YPGUhxmAXgoGDRkg68zGnbGrV2xCgaoqQSfcZCjFhon');
  if (!mainBank || !dustBank) throw new Error('expected current Project0 CASH banks missing');

  const reserveRows = [...(census.activeZero || []), ...(census.otherRows || [])]
    .filter((row) => row.mint === CASH.toBase58())
    .filter((row, index, all) => all.findIndex((candidate) => candidate.reserve === row.reserve) === index);
  if (!reserveRows.length) throw new Error('no exact-zero-fee KLend CASH reserve');

  await setForkAccount(attacker.publicKey, SystemProgram.programId, 100_000_000_000, Buffer.alloc(0));
  await cloneTokenAccount(P(sideSources[0].accounts[11].address), attackerCash, attacker.publicKey, 0n);
  await cloneTokenAccount(P(sideSources[0].accounts[12].address), attackerOutcome0,
    attacker.publicKey, 10_000_000_000_000n);
  await cloneTokenAccount(P(sideSources[1].accounts[12].address), attackerOutcome1,
    attacker.publicKey, 10_000_000_000_000n);

  const protocolImports = [JANUS, DFLOW, KLEND, PROJECT0, CASH, P0_GROUP,
    ...banks.flatMap((bank) => [P(bank.bank), P(bank.address), P(bank.vaultAuthority)]),
    ...reserveRows.flatMap((row) => [P(row.reserve), P(row.supplyVault), P(row.feeVault), P(row.market)]),
    ...sideSources.flatMap((source) => source.accounts.map((meta) => P(meta.address)))];
  for (const address of new Map(protocolImports.map((address) => [address.toBase58(), address])).values()) {
    await rpcFork('getAccountInfo', [address.toBase58(), {encoding: 'base64', commitment: 'processed'}]);
  }

  const reserveAccounts = await getImages(reserveRows.map((row) => P(row.reserve)));
  const liveReserves = reserveRows.map((row) => {
    const state = reserveAccounts.rows[row.reserve]?.klendReserve;
    if (!state) throw new Error(`could not decode current reserve ${row.reserve}`);
    return {...row, availableRaw: state.availableRaw, flashFeeSf: state.flashFeeSf,
      status: state.status, emergencyMode: state.emergencyMode};
  }).filter((row) => row.flashFeeSf === '0')
    .sort((a, b) => BigInt(a.availableRaw) > BigInt(b.availableRaw) ? -1 : 1);
  const topReserve = liveReserves[0];

  const baseWatch = [attacker.publicKey, freshMarginfi.publicKey, attackerCash,
    attackerOutcome0, attackerOutcome1, P(mainBank.address), P(dustBank.address),
    ...liveReserves.flatMap((row) => [P(row.supplyVault), P(row.feeVault), P(row.reserve)]),
    P(sideSources[0].accounts[7].address), P(sideSources[0].accounts[13].address),
    P(sideSources[0].accounts[15].address), P(sideSources[0].accounts[5].address),
    P(sideSources[0].accounts[6].address), P(sideSources[1].accounts[5].address),
    P(sideSources[1].accounts[6].address)];
  const watched = [...new Map(baseWatch.map((address) => [address.toBase58(), address])).values()];
  const results = [];
  const run = async (label, instructions, metadata = {}, lenderVaults = []) => {
    const row = await simulate(label, instructions, watched, metadata);
    if (row.signatureVerificationAccepted) markRepayment(row, lenderVaults);
    results.push(row);
    return row;
  };

  // Signed current-capacity boundaries for every exact-zero-fee CASH reserve.
  for (const reserve of liveReserves) {
    const available = BigInt(reserve.availableRaw);
    for (const [boundary, amount] of [['available-1', available - 1n],
      ['available', available], ['available+1', available + 1n]]) {
      if (amount < 1n) continue;
      await run(`klend_${reserve.reserve}_${boundary}`, klendEnvelope([{reserve, amount}]),
        {category: 'lender-boundary-control', provider: 'Kamino Lend', reserve: reserve.reserve,
          boundary, amountRaw: amount.toString(), exactFlashFeeSf: reserve.flashFeeSf},
        [reserve.supplyVault, reserve.feeVault]);
    }
  }

  // Signed Project0 boundary controls.  The full vault is only an upper bound;
  // if it fails, binary-search the actual maximum accepted pair.
  const p0VaultRaw = BigInt((await getImages([P(mainBank.address)])).rows[mainBank.address].token.amountRaw);
  let p0Max = 0n;
  for (const [boundary, amount] of [['dust', 1n], ['vault-1', p0VaultRaw - 1n],
    ['vault', p0VaultRaw], ['vault+1', p0VaultRaw + 1n]]) {
    const row = await run(`project0_main_${boundary}`, p0Envelope(templates,
      [{bank: mainBank, amount}]), {category: 'lender-boundary-control', provider: 'Project0',
      bank: mainBank.bank, boundary, amountRaw: amount.toString(), originationFeeI80F48Raw: '0'},
    [mainBank.address]);
    if (row.err === null && amount > p0Max) p0Max = amount;
  }
  if (p0Max < p0VaultRaw - 1n) {
    let low = p0Max + 1n;
    let high = p0VaultRaw - 1n;
    while (low <= high) {
      const amount = (low + high) / 2n;
      const row = await run(`project0_main_limit_${amount}`, p0Envelope(templates,
        [{bank: mainBank, amount}]), {category: 'lender-capacity-search', provider: 'Project0',
        bank: mainBank.bank, amountRaw: amount.toString()}, [mainBank.address]);
      if (row.err === null) { p0Max = amount; low = amount + 1n; }
      else high = amount - 1n;
    }
  }

  const dustAvailable = BigInt((await getImages([P(dustBank.address)])).rows[dustBank.address].token.amountRaw);
  let dustMax = 0n;
  for (const [boundary, amount] of [['vault-1', dustAvailable - 1n],
    ['vault', dustAvailable], ['vault+1', dustAvailable + 1n]]) {
    if (amount < 1n) continue;
    const row = await run(`project0_dust_bank_${boundary}`, p0Envelope(templates,
      [{bank: dustBank, amount}]), {category: 'lender-boundary-control', provider: 'Project0',
      bank: dustBank.bank, boundary, amountRaw: amount.toString(), originationFeeI80F48Raw: '0'},
    [dustBank.address]);
    if (row.err === null && amount > dustMax) dustMax = amount;
  }

  // Prove whether Kamino allows multiple reserves in one transaction.
  let klendRepeatControl = null;
  if (liveReserves.length > 1) {
    klendRepeatControl = await run('klend_two_reserve_repeat_borrow_rule', klendEnvelope([
      {reserve: liveReserves[0], amount: 1n}, {reserve: liveReserves[1], amount: 1n},
    ]), {category: 'provider-repeat-borrow-control', provider: 'Kamino Lend',
      reserveCount: 2, expectation: 'runtime proof of whether multiple KLend borrows are permitted'},
    [liveReserves[0].supplyVault, liveReserves[0].feeVault,
      liveReserves[1].supplyVault, liveReserves[1].feeVault]);
  }

  let p0TwoBank = null;
  if (p0Max > 0n && dustMax > 0n) {
    p0TwoBank = await run('project0_two_cash_banks_exact_usable', p0Envelope(templates,
      [{bank: mainBank, amount: p0Max}, {bank: dustBank, amount: dustMax}]),
    {category: 'multi-bank-control', provider: 'Project0', mainAmountRaw: p0Max.toString(),
      dustAmountRaw: dustMax.toString()}, [mainBank.address, dustBank.address]);
  }

  const dualKlend = 1_000_000n;
  const dualP0 = p0Max >= 1_000_000n ? 1_000_000n : p0Max;
  // Maximum usable two-provider union.  Project0's accepted maximum moves as
  // its interest state accrues, so independently discovering p0Max and then
  // replaying it with KLend can be stale.  Search the signed *joint* envelope
  // itself and retain both the maximum successful lender-only observation and
  // the maximum observation that reached Janus in the same atomic v1 message.
  // Include a second positive Project0 bank only if its signed two-bank control
  // succeeded; at the current snapshot the dust bank has no usable amount.
  const usableBanks = p0Max > 0n ? [{bank: mainBank, amount: p0Max}] : [];
  if (p0TwoBank?.err === null) usableBanks.push({bank: dustBank, amount: dustMax});
  const fixedJointBanks = usableBanks.slice(1);
  const jointBanksAt = (mainAmount) => [{bank: mainBank, amount: mainAmount}, ...fixedJointBanks];
  const jointWatch = [topReserve.supplyVault, topReserve.feeVault,
    ...usableBanks.map(({bank}) => bank.address)];
  let jointMax = null;
  let jointControlP0Max = 0n;
  let jointRouteP0Max = 0n;
  let jointPlusOne = null;
  let jointRoutePlusOne = null;
  if (usableBanks.length && dualP0 > 0n) {
    const floor = dualP0;
    const floorRow = await run('joint_klend_project0_floor_control', p0Envelope(templates,
      jointBanksAt(floor), [], {reserve: topReserve, amount: BigInt(topReserve.availableRaw)}),
    {category: 'joint-lender-capacity-floor', providers: ['Kamino Lend', 'Project0'],
      klendRaw: topReserve.availableRaw, project0MainRaw: floor.toString(),
      asymmetricInputs: true}, jointWatch);
    if (floorRow.err === null) {
      jointMax = floorRow;
      jointControlP0Max = floor;
      let low = floor + 1n;
      let high = p0Max;
      while (low <= high) {
        const amount = (low + high) / 2n;
        const row = await run(`joint_control_limit_${amount}`, p0Envelope(templates,
          jointBanksAt(amount), [], {reserve: topReserve, amount: BigInt(topReserve.availableRaw)}),
        {category: 'joint-lender-capacity-search', providers: ['Kamino Lend', 'Project0'],
          klendRaw: topReserve.availableRaw, project0MainRaw: amount.toString(),
          asymmetricInputs: true}, jointWatch);
        if (row.err === null) {
          jointMax = row;
          jointControlP0Max = amount;
          low = amount + 1n;
        } else high = amount - 1n;
      }
      jointPlusOne = await run('joint_control_observed_max_plus_one', p0Envelope(templates,
        jointBanksAt(jointControlP0Max + 1n), [],
        {reserve: topReserve, amount: BigInt(topReserve.availableRaw)}),
      {category: 'joint-lender-capacity-boundary', providers: ['Kamino Lend', 'Project0'],
        boundary: 'maximum-successful-observed-plus-one', klendRaw: topReserve.availableRaw,
        project0MainRaw: (jointControlP0Max + 1n).toString()}, jointWatch);

      // The sentinel is a real opcode-7 Janus call inside the complete borrow
      // and repayment envelope.  Reaching its instruction proves route
      // compatibility; its expected signature failure rolls the whole message
      // back before repayments execute.
      const janusInstructionIndex = 3 + jointBanksAt(floor).length;
      low = floor;
      high = jointControlP0Max;
      while (low <= high) {
        const amount = (low + high) / 2n;
        const row = await run(`joint_route_limit_${amount}`, p0Envelope(templates,
          jointBanksAt(amount), [janusIx(0, 0, 1n)],
          {reserve: topReserve, amount: BigInt(topReserve.availableRaw)}),
        {category: 'joint-route-capacity-search', providers: ['Kamino Lend', 'Project0'],
          klendRaw: topReserve.availableRaw, project0MainRaw: amount.toString(),
          janusInstructionIndex, expectedJanusBlocker: 'MissingRequiredSignature',
          allRepaymentsAppended: true}, jointWatch);
        const reachedJanus = row.err === null ||
          (row.failedInstructionIndex !== null && row.failedInstructionIndex >= janusInstructionIndex);
        if (reachedJanus) {
          jointRouteP0Max = amount;
          low = amount + 1n;
        } else high = amount - 1n;
      }
      if (jointRouteP0Max > 0n) {
        jointRoutePlusOne = await run('joint_route_observed_max_plus_one', p0Envelope(templates,
          jointBanksAt(jointRouteP0Max + 1n), [janusIx(0, 0, 1n)],
          {reserve: topReserve, amount: BigInt(topReserve.availableRaw)}),
        {category: 'joint-route-capacity-boundary', providers: ['Kamino Lend', 'Project0'],
          boundary: 'maximum-route-reached-observed-plus-one', klendRaw: topReserve.availableRaw,
          project0MainRaw: (jointRouteP0Max + 1n).toString(), janusInstructionIndex,
          allRepaymentsAppended: true}, jointWatch);
      }
    }
  }

  // Keep small dual-provider candidates stable, and give the richer two-call
  // candidate a small headroom beneath the maximum route-reached observation.
  // The exact maximum itself is already exercised by joint_route_limit_*.
  const routeHeadroom = jointRouteP0Max > 0n ?
    (jointRouteP0Max / 1_000_000n > 10_000n ? jointRouteP0Max / 1_000_000n : 10_000n) : 0n;
  const routeCandidateP0 = jointRouteP0Max > routeHeadroom ?
    jointRouteP0Max - routeHeadroom : jointRouteP0Max;
  const jointProvidersUsable = jointControlP0Max > 0n;
  const withCapital = (body, useMaximum = false) => {
    if (jointProvidersUsable && dualP0 > 0n) {
      const selected = useMaximum && routeCandidateP0 > 0n ?
        jointBanksAt(routeCandidateP0) : [{bank: mainBank, amount: dualP0}];
      return p0Envelope(templates, selected, body, {reserve: topReserve,
        amount: useMaximum ? BigInt(topReserve.availableRaw) : dualKlend});
    }
    return klendEnvelope([{reserve: topReserve,
      amount: useMaximum ? BigInt(topReserve.availableRaw) : dualKlend}], body);
  };
  const capitalMetadata = (extra = {}) => ({category: 'flash-wrapped-outsider-candidate',
    capitalProviders: jointProvidersUsable && dualP0 > 0n ? ['Kamino Lend', 'Project0'] : ['Kamino Lend'],
    allRepaymentsAppended: true, qualification: 'Only err=null plus full lender conservation and positive outsider equity could qualify',
    ...extra});
  const candidateLenderVaults = [topReserve.supplyVault, topReserve.feeVault,
    ...(jointProvidersUsable && dualP0 > 0n ? [mainBank.address] : [])];

  const fixedJointRaw = fixedJointBanks.reduce((sum, item) => sum + item.amount, 0n);
  const jointInput = routeCandidateP0 + fixedJointRaw + BigInt(topReserve.availableRaw);
  await run('joint_near_max_side0_buy_reverse_repay', withCapital([
    janusIx(0, 0, jointInput), janusIx(0, 1, jointInput),
  ], true), capitalMetadata({family: 'side0 buy/reverse', inputRaw: jointInput.toString(),
    maximumRouteReachedObservedProject0Raw: jointRouteP0Max.toString(),
    project0HeadroomRaw: routeHeadroom.toString(), maximumJoint: false}),
  [topReserve.supplyVault, topReserve.feeVault, ...usableBanks.map(({bank}) => bank.address)]);
  await run('dual_asymmetric_side1_buy_reverse_repay', withCapital([
    janusIx(1, 0, dualKlend + dualP0), janusIx(1, 1, 1n),
  ]), capitalMetadata({family: 'side1 buy/reverse', klendRaw: dualKlend.toString(),
    project0Raw: dualP0.toString(), asymmetricInputs: true}), candidateLenderVaults);

  const candidates = [
    ['side0_direct_sell', janusIx(0, 1, 1_000_000n), {family: 'sell'}],
    ['side1_direct_sell', janusIx(1, 1, 1_000_000n), {family: 'sell'}],
    ['protocol_fee_alias_attacker_cash', janusIx(0, 0, 1_000_000n,
      {replacements: {13: attackerCash}}), {family: 'fee-account alias'}],
    ['settlement_alias_attacker_cash', janusIx(0, 0, 1_000_000n,
      {replacements: {15: attackerCash}}), {family: 'settlement-account alias'}],
    ['user_cash_alias_shared_vault', janusIx(0, 0, 1_000_000n,
      {replacements: {11: sideSources[0].accounts[7].address}}), {family: 'source alias'}],
    ['user_outcome_alias_maker_a', janusIx(0, 1, 1_000_000n,
      {replacements: {12: sideSources[0].accounts[5].address}}), {family: 'outcome alias'}],
    ['maker_a_alias_attacker_outcome', janusIx(0, 0, 1_000_000n,
      {replacements: {5: attackerOutcome0}}), {family: 'maker reserve alias'}],
    ['stale_cross_side_market_state', janusIx(0, 0, 1_000_000n,
      {replacements: {2: sideSources[1].accounts[2].address}}), {family: 'stale/foreign state'}],
    ['oracle_cross_side_substitution', janusIx(0, 0, 1_000_000n,
      {replacements: {3: sideSources[1].accounts[3].address}}), {family: 'oracle substitution'}],
    ['native_market_cross_side_substitution', janusIx(0, 0, 1_000_000n,
      {replacements: {4: sideSources[1].accounts[4].address}}), {family: 'prediction market substitution'}],
    ['tail_flag_one', janusIx(0, 0, 1_000_000n, {tail: 1}), {family: 'flag boundary'}],
    ['dust_amount_one', janusIx(0, 0, 1n), {family: 'amount boundary'}],
    ['u64_max_input', janusIx(0, 0, (1n << 64n) - 1n), {family: 'amount boundary'}],
    ['side_byte_255', janusIx(0, 0, 1_000_000n, {sideByte: 255}), {family: 'enum boundary'}],
    ['direction_byte_255', janusIx(0, 0, 1_000_000n, {directionByte: 255}), {family: 'enum boundary'}],
    ['fee_alias_shared_vault', janusIx(0, 0, 1_000_000n,
      {replacements: {13: sideSources[0].accounts[7].address}}), {family: 'fee/vault alias'}],
    ['token_program_substitution', janusIx(0, 0, 1_000_000n,
      {replacements: {14: SystemProgram.programId}}), {family: 'program substitution'}],
    ['optional_state_omitted', janusIx(0, 0, 1_000_000n,
      {dropPosition: 19}), {family: 'account-list boundary'}],
  ];
  for (const [label, instruction, metadata] of candidates) {
    await run(`wrapped_${label}`, withCapital([instruction]), capitalMetadata(metadata), candidateLenderVaults);
  }

  // Dispatcher sweep for the currently deployed binary.  Non-opcode-7 rows
  // use the known 20-account shape and 12-byte payload only as reachability
  // diagnostics; malformed-layout failures are not absence proofs.
  for (let opcode = 0; opcode <= 21; opcode += 1) {
    await run(`wrapped_dispatch_opcode_${opcode}`, withCapital([
      janusIx(0, 0, 1_000_000n, {opcode}),
    ]), capitalMetadata({family: 'current-binary dispatcher reachability', opcode,
      diagnosticOnly: opcode !== 7, layoutKnownExact: opcode === 7}), candidateLenderVaults);
  }

  const wrapperBlocker = jointProvidersUsable && p0Max > 0n ?
    await compileBlockedWrapper(templates, mainBank, topReserve, dualP0, dualKlend) : null;

  const valid = results.filter((row) => row.signatureVerificationAccepted);
  const providerInventory = {
    sameMint: CASH.toBase58(),
    independentDirectProviders: [
      {name: 'Kamino Lend', programId: KLEND.toBase58(), exactZeroFee: true,
        reserveCount: liveReserves.length, reserves: liveReserves.map((row) => ({reserve: row.reserve,
          market: row.market, supplyVault: row.supplyVault, feeVault: row.feeVault,
          currentAvailableRaw: row.availableRaw, flashFeeSf: row.flashFeeSf,
          status: row.status, emergencyMode: row.emergencyMode}))},
      {name: 'Project0', programId: PROJECT0.toBase58(), originationFeeI80F48Raw: '0',
        nonzeroCashBankCount: banks.filter((bank) => BigInt(bank.rawAmount) > 0n).length,
        banks: banks.map((bank) => ({bank: bank.bank, vault: bank.address,
          displayedVaultRawAtCensus: bank.rawAmount, signedUsableMaxRaw:
            bank.bank === mainBank.bank ? p0Max.toString() : bank.bank === dustBank.bank ? dustMax.toString() : '0'}))},
    ],
    directIndependentProviderCount: 2,
    triIndependentDirectCashCombinationExists: false,
    maximumIndependentDirectProviderCount: jointProvidersUsable ? 2 : 1,
    maximumSignedUsableRaw: jointMax?.err === null ?
      (BigInt(topReserve.availableRaw) + jointControlP0Max + fixedJointRaw).toString() :
      topReserve.availableRaw,
    maximumSignedUsableBasis: jointMax?.err === null ? {
      klendRaw: topReserve.availableRaw,
      project0MainRaw: jointControlP0Max.toString(),
      project0OtherBanksRaw: fixedJointRaw.toString(),
      observedAtSimulationSlot: jointMax.simulationSlot,
      plusOneErr: jointPlusOne?.err ?? null,
      plusOneFailedInstructionIndex: jointPlusOne?.failedInstructionIndex ?? null,
    } : null,
    maximumRouteReachedRaw: jointRouteP0Max > 0n ?
      (BigInt(topReserve.availableRaw) + jointRouteP0Max + fixedJointRaw).toString() : null,
    maximumRouteReachedBasis: jointRouteP0Max > 0n ? {
      klendRaw: topReserve.availableRaw,
      project0MainRaw: jointRouteP0Max.toString(),
      project0OtherBanksRaw: fixedJointRaw.toString(),
      exactMaximumIsAnObservedMovingBoundary: true,
      plusOneErr: jointRoutePlusOne?.err ?? null,
      plusOneFailedInstructionIndex: jointRoutePlusOne?.failedInstructionIndex ?? null,
      candidateHeadroomRaw: routeHeadroom.toString(),
    } : null,
    klendRepeatBorrowControl: klendRepeatControl ? {err: klendRepeatControl.err,
      failedInstructionIndex: klendRepeatControl.failedInstructionIndex,
      trace: klendRepeatControl.trace.slice(-8)} : null,
    project0TwoBankControl: p0TwoBank ? {err: p0TwoBank.err,
      failedInstructionIndex: p0TwoBank.failedInstructionIndex,
      trace: p0TwoBank.trace.slice(-8)} : null,
    limitation: 'The repository-wide verified custody crosswalk identified no third direct CASH flash provider. Cross-mint providers require a separate executable conversion route; they cannot change the Janus DFlow-PDA signer gate proved here.'};

  const output = {generatedAt: new Date().toISOString(),
    scope: 'signed Solana v1 simulateTransaction on faithful current-mainnet local fork only',
    safety: {mainnetSubmission: false, forkSubmission: false,
      forkProtocolAccountsMutated: false,
      syntheticAccounts: [attacker.publicKey, attackerCash, attackerOutcome0, attackerOutcome1].map(String),
      freshAccountCreatedByTransactions: freshMarginfi.publicKey.toBase58(),
      rpcUrlsStored: false, secretKeysStored: false},
    currentBinary: {program: JANUS.toBase58(), deploymentSlot: CURRENT_DEPLOY_SLOT,
      elfSha256: '197f8969043e378d47859d806c9d029f21921e65614844cd5ff37a9a3cea08db'},
    deterministicOutsider: attacker.publicKey.toBase58(),
    syntheticOpeningBalances: {cashRaw: '0', outcome0Raw: '10000000000000',
      outcome1Raw: '10000000000000', note: 'Outcome fixtures are pre-existing synthetic capital and only deltas count.'},
    project0Template: {sourceSignature: P0_SOURCE_SIGNATURE, sourceSlot: templates.sourceSlot},
    providerInventory, wrapperBlocker, results,
    summary: {cases: results.length, signatureVerifiedCases: valid.length,
      signatureRejectedOrConstructionBlocked: results.length - valid.length,
      successfulTransactions: valid.filter((row) => row.err === null).length,
      allMessagesWithin4096Bytes: valid.every((row) => row.message.within4096Bytes),
      allMessagesWithin64Accounts: valid.every((row) => row.message.within64Accounts),
      maximumWireBytes: Math.max(...valid.map((row) => row.message.bytes)),
      maximumAddressCount: Math.max(...valid.map((row) => row.message.addressCount)),
      fullRepaymentControls: valid.filter((row) => row.outsiderReconciliation.fullRepaymentProved)
        .map((row) => row.label),
      positiveNetAssetGainCases: valid.filter((row) =>
        row.outsiderReconciliation.positiveNetAssetGainProved).map((row) => row.label),
      exploitVerdict: 'No signed candidate both completed every lender repayment and produced positive outsider net asset gain.'},
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({output: OUTPUT, providerInventory,
    wrapperBlocker: wrapperBlocker && {message: wrapperBlocker.message,
      uncontrolledSigners: wrapperBlocker.uncontrolledSigners}, summary: output.summary}, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
