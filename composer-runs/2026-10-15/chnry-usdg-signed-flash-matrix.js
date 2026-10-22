#!/usr/bin/env node
/*
 * Fork-only, locally signed Chancery USDG outsider/flash composition matrix.
 *
 * Safety invariants:
 *   - reads RPC credentials only from /tmp/composer-helius-rpc.env;
 *   - never prints an RPC endpoint or secret key;
 *   - never calls sendTransaction or another submission method;
 *   - signs only locally generated attacker identities;
 *   - simulates custom Solana v1 wires with sigVerify:true;
 *   - enforces the requested 4096-byte / 64-account limits before simulation.
 */

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
} = require(MODULES + '@solana/web3.js');
const anchor = require(MODULES + '@coral-xyz/anchor');
const bs58Module = require(MODULES + 'bs58');
const bs58 = bs58Module.default || bs58Module;

const ROOT = __dirname;
const OUT = `${ROOT}/chnry-usdg-signed-flash-matrix.json`;
const FORK = 'http://127.0.0.1:8997';
const ENV_PATH = '/tmp/composer-helius-rpc.env';
const env = Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => line.split(/=(.*)/s).slice(0, 2)));
const UPSTREAM = env.HEAVY_RPC_URL || env.RPC_URL;
const ARCHIVE = env.RPC_URL || env.HEAVY_RPC_URL;
if (!UPSTREAM || !ARCHIVE) throw new Error(`No RPC configured in ${ENV_PATH}`);

const P = value => value instanceof PublicKey ? value : new PublicKey(value);
const CHANCERY = P('ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const TOKEN_2022 = P('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SYSTEM = SystemProgram.programId;
const USDG = P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH');
const USDV = P('USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk');
const CHANCERY_HISTORY = '32sBxLB3zYh4efsMnBPnsCNdEenL2zfnjk48q8YVxAV9cXDZT44AFHiyHnvbypwq724uy94Jg9k2qRjKpiwqovXX';
const PROJECT0_HISTORY = '2b8NLAe4HL5JsdWPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';

const idl = JSON.parse(fs.readFileSync(`${ROOT}/chnry-usdg-source/programs/chancery/idl/idl.json`));
const p0Idl = JSON.parse(fs.readFileSync(`${ROOT}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`));
const state = JSON.parse(fs.readFileSync(`${ROOT}/chnry-usdg-current-state.json`));
const flashHistory = JSON.parse(fs.readFileSync(`${ROOT}/kamino-flash-history.json`));
const marginfiVaults = JSON.parse(fs.readFileSync(`${ROOT}/marginfi-vaults-current.json`));
const crosswalk = JSON.parse(fs.readFileSync(`${ROOT}/mainnet-token-authority-flash-crosswalk.json`));
const named = state.historicalControl.namedAccounts;
const ixCoder = new anchor.BorshInstructionCoder(idl);
const p0AccountCoder = new anchor.BorshAccountsCoder(p0Idl);
const chanceryErrors = new Map((idl.errors || []).map(row => [row.code, row]));
const p0Errors = new Map((p0Idl.errors || []).map(row => [row.code, row]));

let rpcId = 0;
async function rpc(url, method, params) {
  if (/send|submit/i.test(method)) throw new Error(`Submission RPC is forbidden: ${method}`);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
      const json = await response.json();
      if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
      return json.result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`${method} failed after retries: ${lastError?.message || lastError}`);
}

const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const cloneIx = ix => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map(key => ({...key})), data: Buffer.from(ix.data)});
function replaceKeys(ix, replacements) {
  const out = cloneIx(ix);
  for (const [rawIndex, value] of Object.entries(replacements)) {
    const index = Number(rawIndex);
    const replacement = value && value.pubkey ? value : {pubkey: value};
    out.keys[index] = {...out.keys[index], ...replacement, pubkey: P(replacement.pubkey)};
  }
  return out;
}

function metaResolver(tx) {
  const message = tx.transaction.message;
  const staticKeys = message.accountKeys.map(key => typeof key === 'string' ? key : key.pubkey);
  const loaded = tx.meta.loadedAddresses || {writable: [], readonly: []};
  const allKeys = [...staticKeys, ...loaded.writable, ...loaded.readonly];
  const header = message.header;
  const writable = index => index < staticKeys.length ?
    (index < header.numRequiredSignatures ?
      index < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      index < staticKeys.length - header.numReadonlyUnsignedAccounts) :
    index < staticKeys.length + loaded.writable.length;
  return {message, allKeys, header, writable};
}

function transactionIx(tx, index) {
  const {message, allKeys, header, writable} = metaResolver(tx);
  const source = message.instructions[index];
  return new TransactionInstruction({programId: P(allKeys[source.programIdIndex]),
    keys: source.accounts.map(accountIndex => ({pubkey: P(allKeys[accountIndex]),
      isSigner: accountIndex < header.numRequiredSignatures, isWritable: writable(accountIndex)})),
    data: Buffer.from(bs58.decode(source.data))});
}

function historyIx(tx, program, occurrence) {
  const {message, allKeys} = metaResolver(tx);
  const indexes = message.instructions.map((ix, index) => ({index, program: allKeys[ix.programIdIndex]}))
    .filter(row => row.program === program.toBase58());
  if (!indexes[occurrence]) throw new Error(`Historical ${program} instruction ${occurrence} unavailable`);
  return transactionIx(tx, indexes[occurrence].index);
}

function parseRecordedCustomV1(base64) {
  const wire = Buffer.from(base64, 'base64');
  if (wire[0] !== 0x81) throw new Error('Recorded wire is not custom v1');
  const required = wire[1], readonlySigned = wire[2], readonlyUnsigned = wire[3];
  const instructionCount = wire[40], keyCount = wire[41];
  let offset = 42;
  const keys = [];
  for (let i = 0; i < keyCount; i++, offset += 32) keys.push(P(wire.subarray(offset, offset + 32)));
  offset += 8; // v1 compute/data configuration
  const heads = [];
  for (let i = 0; i < instructionCount; i++, offset += 4) {
    heads.push({programIndex: wire[offset], accountCount: wire[offset + 1],
      dataLength: wire.readUInt16LE(offset + 2)});
  }
  const writable = index => index < required ? index < required - readonlySigned :
    index < keyCount - readonlyUnsigned;
  return heads.map(head => {
    const indexes = [...wire.subarray(offset, offset + head.accountCount)];
    offset += head.accountCount;
    const data = Buffer.from(wire.subarray(offset, offset + head.dataLength));
    offset += head.dataLength;
    return new TransactionInstruction({programId: keys[head.programIndex],
      keys: indexes.map(index => ({pubkey: keys[index], isSigner: index < required,
        isWritable: writable(index)})), data});
  });
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const compiled = new TransactionMessage({payerKey: P(payer), recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (compiled.addressTableLookups.length) throw new Error('Unexpected address lookup table');
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const heads = items.map(ix => {
    const out = Buffer.alloc(4);
    out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length;
    out.writeUInt16LE(ix.data.length, 2);
    return out;
  });
  const payloads = items.map(ix => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures,
      compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map(key => key.toBuffer()), config,
    ...heads, ...payloads, Buffer.alloc(64 * compiled.header.numRequiredSignatures),
  ]);
  return {compiled, wire, sizeBytes: wire.length, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: compiled.header.numRequiredSignatures,
    computeLimit, dataLimit, withinLimits: wire.length <= 4096 && keys.length <= 64 && items.length <= 64};
}

function signWire(encoded, signerMap) {
  if (!encoded.withinLimits) return {blocker: `v1 limits exceeded: ${encoded.sizeBytes} bytes, ` +
    `${encoded.addressCount} accounts, ${encoded.instructionCount} instructions`};
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * encoded.requiredSignatures);
  const signerOrder = encoded.compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  for (let index = 0; index < signerOrder.length; index++) {
    const keypair = signerMap.get(signerOrder[index]);
    if (!keypair) return {blocker: `required signer is not locally controlled: ${signerOrder[index]}`,
      signerOrder};
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey).copy(signed,
      signed.length - 64 * encoded.requiredSignatures + index * 64);
  }
  return {signed, signerOrder};
}

function tokenImage(account) {
  if (!account?.data) return {exists: false};
  const data = Buffer.from(account.data[0], 'base64');
  const out = {exists: true, owner: account.owner, lamports: String(account.lamports),
    dataBytes: data.length, dataSha256: sha256(data)};
  if (account.owner === TOKEN_2022.toBase58() && data.length >= 109) {
    out.token = {mint: P(data.subarray(0, 32)).toBase58(), owner: P(data.subarray(32, 64)).toBase58(),
      amountRaw: data.readBigUInt64LE(64).toString(), state: data[108]};
  }
  return out;
}

function tokenAmount(account) {
  if (!account?.data) return 0n;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
}

function mintSupply(account) {
  if (!account?.data) return 0n;
  const data = Buffer.from(account.data[0], 'base64');
  return data.length >= 44 ? data.readBigUInt64LE(36) : 0n;
}

function fixedRaw(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt('0x' + Buffer.from(bytes).reverse().toString('hex'));
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return value.toString();
}

function decodeBank(account) {
  if (!account?.data) return null;
  const decoded = p0AccountCoder.decode('Bank', Buffer.from(account.data[0], 'base64'));
  const config = decoded.config;
  return {mint: decoded.mint.toBase58(), group: decoded.group.toBase58(),
    operationalState: Object.keys(config.operational_state)[0],
    riskTier: Object.keys(config.risk_tier)[0], assetTag: config.asset_tag,
    configFlags: config.config_flags, bankFlags: decoded.flags.toString(),
    borrowLimitRawField: String(config.borrow_limit),
    protocolOriginationFeeRawI80F48: fixedRaw(config.interest_rate_config.protocol_origination_fee),
    assetSharesRawI80F48: fixedRaw(decoded.total_asset_shares),
    liabilitySharesRawI80F48: fixedRaw(decoded.total_liability_shares)};
}

function reserveImage(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  return {availableRaw: data.readBigUInt64LE(224).toString(), status: data[4856],
    emergencyMode: data[4864], flashFeeSf: data.readBigUInt64LE(4904).toString()};
}

function errorDescription(err, programs) {
  const tuple = err?.InstructionError;
  if (!Array.isArray(tuple)) return err ? {raw: err} : null;
  const index = tuple[0];
  const custom = tuple[1]?.Custom;
  const program = programs[index] || null;
  const known = program === CHANCERY.toBase58() ? chanceryErrors.get(custom) :
    program === PROJECT0.toBase58() ? p0Errors.get(custom) : null;
  const klendKnown = program === KLEND.toBase58() && custom === 6035 ?
    {name: 'MultipleFlashBorrows', msg: 'KLend permits only one flash borrow per transaction'} : null;
  const row = known || klendKnown;
  return {instructionIndex: index, program, customCode: custom ?? null,
    name: row?.name || null, message: row?.msg || null, raw: tuple[1]};
}

function pda(seed, ...parts) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts.map(part =>
    part instanceof PublicKey ? part.toBuffer() : Buffer.from(part))], CHANCERY)[0];
}

function deterministicPlaceholder(label) {
  return PublicKey.findProgramAddressSync([Buffer.from('evidence'),
    crypto.createHash('sha256').update(label).digest().subarray(0, 32)], CHANCERY)[0];
}

function instructionFromIdl(name, args, accountMap, shortenAt = null) {
  const definition = idl.instructions.find(ix => ix.name === name);
  if (!definition) throw new Error(`IDL instruction unavailable: ${name}`);
  const encoded = Buffer.from(ixCoder.encode(name, args));
  const metas = (shortenAt === null ? definition.accounts : definition.accounts.slice(0, shortenAt))
    .map(meta => {
      let pubkey = accountMap[meta.name];
      if (!pubkey) pubkey = meta.optional ? SYSTEM : deterministicPlaceholder(`${name}:${meta.name}`);
      return {pubkey: P(pubkey), isSigner: Boolean(meta.signer), isWritable: Boolean(meta.writable)};
    });
  return new TransactionInstruction({programId: CHANCERY, keys: metas, data: encoded});
}

function controllerData(moduleInstruction, pathwayId, amount, minimumOutput = amount) {
  return Buffer.concat([Buffer.from([4, moduleInstruction]), pathwayId, u64(amount), u64(minimumOutput)]);
}

async function setSystemAccount(pubkey, lamports = 20_000_000_000) {
  await rpc(FORK, 'surfnet_setAccount', [P(pubkey).toBase58(), {data: '', executable: false,
    lamports, owner: SYSTEM.toBase58(), rentEpoch: 0}]);
}

async function setSyntheticToken(address, templateAddress, owner, amount) {
  const source = await rpc(FORK, 'getAccountInfo', [P(templateAddress).toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  if (!source.value) throw new Error(`Token template unavailable: ${templateAddress}`);
  const data = Buffer.from(source.value.data[0], 'base64');
  P(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  await rpc(FORK, 'surfnet_setAccount', [P(address).toBase58(), {data: data.toString('hex'),
    executable: false, lamports: source.value.lamports, owner: source.value.owner,
    rentEpoch: 0}]);
}

function allObjects(value, out = []) {
  if (Array.isArray(value)) for (const child of value) allObjects(child, out);
  else if (value && typeof value === 'object') {
    out.push(value);
    for (const child of Object.values(value)) allObjects(child, out);
  }
  return out;
}

async function getMultiple(addresses, url = FORK) {
  const result = await rpc(url, 'getMultipleAccounts', [addresses.map(address => P(address).toBase58()),
    {encoding: 'base64', commitment: url === FORK ? 'processed' : 'confirmed'}]);
  return {slot: result.context.slot, value: result.value};
}

async function getTransactionAny(signature) {
  for (const url of [...new Set([ARCHIVE, UPSTREAM])]) {
    try {
      const transaction = await rpc(url, 'getTransaction', [signature,
        {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
      if (transaction) return transaction;
    } catch (_) { /* try the other configured read-only endpoint */ }
  }
  return null;
}

async function main() {
  const actors = {
    attacker: Keypair.generate(), principalB: Keypair.generate(), executor: Keypair.generate(),
    marginfiAccount: Keypair.generate(),
  };
  const attackerUsdg = Keypair.generate().publicKey;
  const attackerUsdv = Keypair.generate().publicKey;
  for (const actor of [actors.attacker, actors.principalB, actors.executor])
    await setSystemAccount(actor.publicKey);
  await setSyntheticToken(attackerUsdg, named.destination_asset_token_account,
    actors.attacker.publicKey, 0n);
  await setSyntheticToken(attackerUsdv, named.source_issued_token_account,
    actors.attacker.publicKey, BigInt(state.currentHistoricalAccounts.accounts[named.asset_config]
      .decoded.maximum_single_settlement_amount) * 3n);

  const signerMap = new Map(Object.values(actors).map(keypair => [keypair.publicKey.toBase58(), keypair]));
  const chanceryTx = await getTransactionAny(CHANCERY_HISTORY);
  const p0Tx = await getTransactionAny(PROJECT0_HISTORY);
  if (!chanceryTx) throw new Error('Historical Chancery instruction source transaction unavailable');
  const directTemplate = historyIx(chanceryTx, CHANCERY, 0);
  const klendTx = flashHistory.hits[0].transaction;
  const klendBorrowTemplate = historyIx(klendTx, KLEND, 0);
  const klendRepayTemplate = historyIx(klendTx, KLEND, 1);
  let p0Templates;
  let p0TemplateSource;
  if (p0Tx) {
    p0Templates = [0, 1, 2, 3].map(index => historyIx(p0Tx, PROJECT0, index));
    p0TemplateSource = {kind: 'archived-transaction', signature: PROJECT0_HISTORY, slot: p0Tx.slot};
  } else {
    const recorded = JSON.parse(fs.readFileSync(`${ROOT}/p0-klend-single-attacker-control.json`));
    const p0Instructions = parseRecordedCustomV1(recorded.wire.signedBase64)
      .filter(ix => ix.programId.equals(PROJECT0));
    if (p0Instructions.length !== 5) throw new Error(`Recorded Project0 template count ${p0Instructions.length}`);
    p0Templates = p0Instructions.slice(1); // omit marginfi_account_initialize
    p0TemplateSource = {kind: 'recorded-signed-fork-control',
      artifact: 'p0-klend-single-attacker-control.json', wireSha256: recorded.wire.sha256,
      originalSignature: recorded.sourceProject0Signature, originalSlot: recorded.sourceProject0Slot};
  }
  const [p0StartTemplate, p0BorrowTemplate, p0RepayTemplate, p0EndTemplate] = p0Templates;

  const assetState = state.currentHistoricalAccounts.accounts[named.asset_config].decoded;
  const minimum = BigInt(assetState.minimum_deposit_amount);
  const maximum = BigInt(assetState.maximum_single_settlement_amount);
  const pathwayId = Buffer.from(state.historicalControl.pathwayIdHex, 'hex');
  const pathway = P(named.pathway_policy);
  const attackerPathwayPermission = pda('permission', actors.attacker.publicKey,
    Buffer.from([2]), pathway);
  const principalBPermission = pda('permission', actors.principalB.publicKey,
    Buffer.from([2]), pathway);
  const executorPermission = pda('permission', actors.executor.publicKey,
    Buffer.from([2]), pathway);
  const config = state.currentHistoricalAccounts.accounts[named.chancery_config].decoded;

  const directMint = (amount, overrides = {}) => {
    const ix = replaceKeys(directTemplate, {6: attackerPathwayPermission, 7: attackerUsdg,
      9: attackerUsdv, 12: config.mint_authority_pda, 15: actors.attacker.publicKey,
      ...overrides});
    ix.data = controllerData(1, pathwayId, amount);
    return ix;
  };
  const directRedeem = (amount, overrides = {}) => {
    const ix = replaceKeys(directTemplate, {6: attackerPathwayPermission, 7: attackerUsdv,
      9: attackerUsdg, 12: named.reserve_authority_pda, 15: actors.attacker.publicKey,
      ...overrides});
    ix.data = controllerData(2, pathwayId, amount);
    return ix;
  };

  const liveKlendRows = [];
  for (const saved of state.klendUsdGCensus.reserves) {
    const rows = await getMultiple([saved.reserve, saved.supplyVault, saved.feeVault]);
    const reserve = reserveImage(rows.value[0]);
    const supplyRaw = tokenAmount(rows.value[1]);
    const compatible = rows.value[0]?.owner === KLEND.toBase58() &&
      reserve?.status === 0 && reserve.emergencyMode === 0 && reserve.flashFeeSf === '0';
    liveKlendRows.push({program: KLEND.toBase58(), reserve: saved.reserve, market: saved.market,
      supplyVault: saved.supplyVault, feeVault: saved.feeVault, mint: saved.mint,
      observationSlot: rows.slot, reserveAvailableRaw: reserve?.availableRaw || null,
      supplyBalanceRaw: supplyRaw.toString(), currentDisplayedCapacityRaw: reserve ?
        (BigInt(reserve.availableRaw) < supplyRaw ? BigInt(reserve.availableRaw) : supplyRaw).toString() : '0',
      flashFeeSf: reserve?.flashFeeSf || null, status: reserve?.status ?? null,
      emergencyMode: reserve?.emergencyMode ?? null, compatibleExactZero: compatible});
  }
  const compatibleKlend = liveKlendRows.filter(row => row.compatibleExactZero)
    .sort((a, b) => BigInt(a.currentDisplayedCapacityRaw) > BigInt(b.currentDisplayedCapacityRaw) ? -1 : 1);
  if (!compatibleKlend.length) throw new Error('No compatible exact-zero USDG KLend reserve');

  const savedP0Rows = marginfiVaults.rows.filter(row => row.kind === 'liquidity' &&
    row.mint === USDG.toBase58() && row.controlVerified);
  const liveP0Rows = [];
  for (const saved of savedP0Rows) {
    const rows = await getMultiple([saved.bank, saved.address]);
    liveP0Rows.push({program: PROJECT0.toBase58(), bank: saved.bank, group: saved.group,
      vault: saved.address, vaultAuthority: saved.authority, tokenProgram: saved.tokenProgram,
      observationSlot: rows.slot, displayedVaultBalanceRaw: tokenAmount(rows.value[1]).toString(),
      bankConfig: decodeBank(rows.value[0]), compatibleTokenProgram: saved.tokenProgram === TOKEN_2022.toBase58()});
  }

  function klendSource(row, amount) {
    const market = P(row.market);
    const marketAuthority = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
    const replacements = {0: actors.attacker.publicKey, 1: marketAuthority, 2: market,
      3: row.reserve, 4: USDG, 5: row.supplyVault, 6: attackerUsdg,
      7: row.feeVault, 11: TOKEN_2022};
    const borrow = replaceKeys(klendBorrowTemplate, replacements);
    const repay = replaceKeys(klendRepayTemplate, replacements);
    borrow.data.writeBigUInt64LE(BigInt(amount), 8);
    repay.data.writeBigUInt64LE(BigInt(amount), 8);
    return {kind: 'klend', id: row.reserve, amount: BigInt(amount), borrow, repay};
  }

  function p0Source(row, amount) {
    const replacements = {0: row.group, 1: actors.marginfiAccount.publicKey,
      2: actors.attacker.publicKey, 3: row.bank, 4: attackerUsdg,
      5: row.vaultAuthority, 6: row.vault, 7: TOKEN_2022};
    const borrow = replaceKeys(p0BorrowTemplate, replacements);
    const repay = replaceKeys(p0RepayTemplate, replacements);
    // Project0 consumes a Token-2022 bank's mint as the first remaining
    // account in both borrow and repay before any extension-hook accounts.
    borrow.keys.push({pubkey: USDG, isSigner: false, isWritable: false});
    repay.keys.push({pubkey: USDG, isSigner: false, isWritable: false});
    borrow.data.writeBigUInt64LE(BigInt(amount), 8);
    repay.data.writeBigUInt64LE(BigInt(amount), 8);
    return {kind: 'project0', id: row.bank, amount: BigInt(amount), row, borrow, repay};
  }

  function wrap(sources, candidates = []) {
    const p0Sources = sources.filter(source => source.kind === 'project0');
    const klendSources = sources.filter(source => source.kind === 'klend');
    const instructions = [];
    let p0Start = null;
    if (p0Sources.length) {
      const group = P(p0Sources[0].row.group);
      instructions.push(new TransactionInstruction({programId: PROJECT0, keys: [
        {pubkey: group, isSigner: false, isWritable: false},
        {pubkey: actors.marginfiAccount.publicKey, isSigner: true, isWritable: true},
        {pubkey: actors.attacker.publicKey, isSigner: true, isWritable: false},
        {pubkey: actors.attacker.publicKey, isSigner: true, isWritable: true},
        {pubkey: SYSTEM, isSigner: false, isWritable: false},
      ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])}));
      p0Start = replaceKeys(p0StartTemplate, {0: actors.marginfiAccount.publicKey,
        1: actors.attacker.publicKey});
      instructions.push(p0Start);
    }
    const klendBorrowIndexes = new Map();
    for (const source of klendSources) {
      klendBorrowIndexes.set(source.id, instructions.length);
      instructions.push(source.borrow);
    }
    for (const source of p0Sources) instructions.push(source.borrow);
    instructions.push(...candidates);
    for (const source of [...p0Sources].reverse()) instructions.push(source.repay);
    for (const source of [...klendSources].reverse()) {
      source.repay.data[16] = klendBorrowIndexes.get(source.id);
      instructions.push(source.repay);
    }
    if (p0Sources.length) {
      const p0End = replaceKeys(p0EndTemplate, {0: actors.marginfiAccount.publicKey,
        2: actors.attacker.publicKey});
      instructions.push(p0End);
      p0Start.data.writeBigUInt64LE(BigInt(instructions.length - 1), 8);
    }
    return instructions;
  }

  const watch = [...new Set([
    attackerUsdg.toBase58(), attackerUsdv.toBase58(), named.reserve_asset_token_account,
    named.asset_mint, named.issued_token_mint,
    ...compatibleKlend.slice(0, 2).flatMap(row => [row.supplyVault, row.feeVault, row.reserve]),
    ...liveP0Rows.flatMap(row => [row.vault, row.bank]),
  ])];
  const beforeAll = await getMultiple(watch);

  const simulations = [];
  async function simulate(label, category, instructions, metadata = {}) {
    // simulateTransaction never commits. All cases therefore share the one
    // post-setup baseline, avoiding a slow prefetch after obtaining a blockhash.
    const pre = beforeAll;
    const blockhash = (await rpc(FORK, 'getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
    const encoded = encodeV1(instructions, actors.attacker.publicKey, blockhash);
    const programs = instructions.map(ix => ix.programId.toBase58());
    const base = {label, category, metadata, requestedSources: metadata.sources || [],
      transaction: {version: 1, sizeBytes: encoded.sizeBytes, sizeLimitBytes: 4096,
        addressCount: encoded.addressCount, addressLimit: 64,
        instructionCount: encoded.instructionCount, instructionLimit: 64,
        requiredSignatures: encoded.requiredSignatures, withinLimits: encoded.withinLimits,
        sigVerifyRequested: true}};
    const signed = signWire(encoded, signerMap);
    if (signed.blocker) {
      const result = {...base, simulated: false, signaturesVerified: false,
        concreteBlocker: signed.blocker, signerOrder: signed.signerOrder || []};
      simulations.push(result);
      console.log(JSON.stringify({label, blocker: result.concreteBlocker,
        bytes: encoded.sizeBytes, accounts: encoded.addressCount}));
      return result;
    }
    const response = await rpc(FORK, 'simulateTransaction', [signed.signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watch},
    }]);
    const err = response.value.err || null;
    const returned = response.value.accounts || [];
    // Some local simulators return null for requested accounts that were not
    // loaded by the transaction. Preserve their baseline image; a true close
    // is not part of any tested route.
    const committedEquivalent = err === null ?
      pre.value.map((account, index) => returned[index] || account) : pre.value;
    const index = address => watch.indexOf(P(address).toBase58());
    const deltaToken = address => (tokenAmount(committedEquivalent[index(address)]) -
      tokenAmount(pre.value[index(address)])).toString();
    const deltaSupply = address => (mintSupply(committedEquivalent[index(address)]) -
      mintSupply(pre.value[index(address)])).toString();
    const equity = BigInt(deltaToken(attackerUsdg)) + BigInt(deltaToken(attackerUsdv));
    const result = {...base, simulated: true, signaturesVerified: true,
      signerOrder: signed.signerOrder, wireSha256: sha256(signed.signed),
      baselineSlot: pre.slot, simulationSlot: response.context.slot, err,
      decodedError: errorDescription(err, programs), unitsConsumed: response.value.unitsConsumed,
      atomicRollbackAppliedToAccounting: err !== null,
      accounting: {valuation: 'raw 6-decimal units; USDG and USDv valued 1:1 per current Chancery config',
        attackerUsdGDeltaRaw: deltaToken(attackerUsdg), attackerUsdVDeltaRaw: deltaToken(attackerUsdv),
        attackerNetEquityDeltaRaw: equity.toString(), positiveAttackerNetEquity: equity > 0n,
        chanceryVaultUsdGDeltaRaw: deltaToken(named.reserve_asset_token_account),
        usdGMintSupplyDeltaRaw: deltaSupply(named.asset_mint),
        usdVMintSupplyDeltaRaw: deltaSupply(named.issued_token_mint),
        lenderDeltas: Object.fromEntries((metadata.lenderVaults || []).map(address =>
          [P(address).toBase58(), deltaToken(address)])),
        allBorrowInstructionsHavePlannedRepay: metadata.allRepaysPlanned !== false,
        outstandingFlashLiabilityAfterCommittedTransactionRaw: '0'},
      logs: (response.value.logs || []).filter(line => line.includes('Program log:') ||
        line.includes('Instruction:') || line.includes('failed') || line.includes('success')).slice(-100)};
    simulations.push(result);
    console.log(JSON.stringify({label, err: result.decodedError?.name || err,
      bytes: encoded.sizeBytes, accounts: encoded.addressCount,
      units: result.unitsConsumed, net: result.accounting.attackerNetEquityDeltaRaw}));
    return result;
  }

  const boundary = value => [...new Set([value > 0n ? value - 1n : 0n, value, value + 1n].map(String))]
    .map(BigInt).filter(value => value > 0n);
  const providerControls = {klend: [], project0: [], repeatBorrow: null, combinations: []};

  // Exact current available and boundary +/-1 for the maximum same-program
  // KLend source. Other KLend reserve accounts cannot be added because the
  // program's transaction-wide MultipleFlashBorrows guard is tested below.
  const selectedKlend = compatibleKlend[0];
  const klendDisplayed = BigInt(selectedKlend.currentDisplayedCapacityRaw);
  for (const amount of boundary(klendDisplayed)) {
    const source = klendSource(selectedKlend, amount);
    providerControls.klend.push(await simulate(`provider_klend_${selectedKlend.reserve}_${amount}`,
      'provider-boundary', wrap([source]), {sources: [{provider: 'KLend', id: source.id,
        amountRaw: amount.toString()}], lenderVaults: [selectedKlend.supplyVault, selectedKlend.feeVault]}));
  }

  // Project0 has distinct banks but one independent provider program. Test
  // every live USDG bank at displayed balance +/-1, then binary-search a bank
  // whose displayed balance is not actually usable.
  const p0Usable = new Map();
  for (const row of liveP0Rows) {
    const displayed = BigInt(row.displayedVaultBalanceRaw);
    const tests = [];
    for (const amount of boundary(displayed)) {
      const source = p0Source(row, amount);
      tests.push(await simulate(`provider_project0_${row.bank}_${amount}`,
        'provider-boundary', wrap([source]), {sources: [{provider: 'Project0', id: source.id,
          amountRaw: amount.toString()}], lenderVaults: [row.vault]}));
    }
    providerControls.project0.push(...tests);
    const exact = tests.find(test => test.metadata.sources[0].amountRaw === displayed.toString());
    if (exact?.err === null && exact.simulated) {
      p0Usable.set(row.bank, displayed);
    } else if (displayed > 0n && tests.some(test => test.err === null) ||
      (displayed > 0n && new Set(tests.map(test => test.decodedError?.name ||
        JSON.stringify(test.err))).size > 1)) {
      let low = 0n, high = displayed;
      while (high - low > 1n) {
        const mid = (low + high) / 2n;
        const source = p0Source(row, mid);
        const result = await simulate(`provider_project0_search_${row.bank}_${mid}`,
          'provider-capacity-search', wrap([source]), {sources: [{provider: 'Project0',
            id: source.id, amountRaw: mid.toString()}], lenderVaults: [row.vault]});
        if (result.err === null && result.simulated) low = mid; else high = mid;
      }
      p0Usable.set(row.bank, low);
    } else p0Usable.set(row.bank, 0n);
  }

  if (compatibleKlend.length > 1) {
    const first = klendSource(compatibleKlend[0], minimum);
    const second = klendSource(compatibleKlend[1], minimum);
    providerControls.repeatBorrow = await simulate('provider_klend_two_reserves_repeat_guard',
      'provider-repeat-borrow', wrap([first, second]), {sources: [
        {provider: 'KLend', id: first.id, amountRaw: minimum.toString()},
        {provider: 'KLend', id: second.id, amountRaw: minimum.toString()},
      ], lenderVaults: [compatibleKlend[0].supplyVault, compatibleKlend[0].feeVault,
        compatibleKlend[1].supplyVault, compatibleKlend[1].feeVault]});
  }

  const usableP0Rows = liveP0Rows.filter(row => (p0Usable.get(row.bank) || 0n) > 0n);
  const maximumSources = [klendSource(selectedKlend, klendDisplayed),
    ...usableP0Rows.map(row => p0Source(row, p0Usable.get(row.bank)))];
  const maximumSourceMetadata = maximumSources.map(source => ({provider:
    source.kind === 'klend' ? 'KLend' : 'Project0', id: source.id, amountRaw: source.amount.toString()}));
  const maximumLenderVaults = [selectedKlend.supplyVault, selectedKlend.feeVault,
    ...usableP0Rows.map(row => row.vault)];
  providerControls.combinations.push(await simulate('provider_maximum_joint_route_control',
    'provider-maximum-combination', wrap(maximumSources), {sources: maximumSourceMetadata,
      lenderVaults: maximumLenderVaults}));
  if (usableP0Rows.length) {
    const asymmetricSources = [klendSource(selectedKlend, minimum),
      p0Source(usableP0Rows[0], p0Usable.get(usableP0Rows[0].bank))];
    providerControls.combinations.push(await simulate('provider_dual_asymmetric_control',
      'provider-asymmetric-combination', wrap(asymmetricSources), {sources:
        asymmetricSources.map(source => ({provider: source.kind === 'klend' ? 'KLend' : 'Project0',
          id: source.id, amountRaw: source.amount.toString()})),
        lenderVaults: [selectedKlend.supplyVault, selectedKlend.feeVault, usableP0Rows[0].vault]}));
  }

  const common = {
    module_activation_state: named.module_activation_state, activation: named.module_activation_state,
    chancery_config: named.chancery_config, event_authority: named.event_authority,
    event_authority_direct: named.event_authority, event_program: CHANCERY,
    pause_state: named.pause_state, asset_config: named.asset_config,
    pathway_policy: named.pathway_policy, asset_pause_state: named.asset_pause_state,
    issued_token_control: named.issued_token_control, asset_mint: USDG, issued_token_mint: USDV,
    reserve_asset_token_account: named.reserve_asset_token_account,
    asset_token_program: TOKEN_2022, issued_token_program: TOKEN_2022,
    mint_authority_pda: config.mint_authority_pda, reserve_authority_pda: named.reserve_authority_pda,
    source_asset_token_account: attackerUsdg, source_issued_token_account: attackerUsdv,
    destination_asset_token_account: attackerUsdg, destination_issued_token_account: attackerUsdv,
    principal: actors.attacker.publicKey, authority: actors.attacker.publicKey,
    granting_authority: actors.attacker.publicKey, operations_authority: actors.attacker.publicKey,
    governance_authority: actors.attacker.publicKey, payer: actors.attacker.publicKey,
    holder: actors.attacker.publicKey, relayer: actors.attacker.publicKey,
    sender: actors.attacker.publicKey, creator: actors.attacker.publicKey,
    executor: actors.executor.publicKey, principal_a: actors.attacker.publicKey,
    principal_b: actors.principalB.publicKey, system_program: SYSTEM,
    permission_record: attackerPathwayPermission, principal_permission_record: attackerPathwayPermission,
    principal_a_permission_record: attackerPathwayPermission,
    principal_b_permission_record: principalBPermission, executor_permission_record: executorPermission,
    relayer_permission_record: attackerPathwayPermission, sender_permission_record: attackerPathwayPermission,
    grantor_permission: SYSTEM, rent_refund_recipient: actors.attacker.publicKey,
  };

  const directCandidates = [];
  for (const amount of [1n, minimum - 1n, minimum, maximum, maximum + 1n]) {
    directCandidates.push({label: `outsider_direct_mint_unwind_${amount}`, amount,
      instructions: [directMint(amount), directRedeem(amount)],
      note: 'Mint followed by redeem is the unwind needed to restore USDG for lender repayment.'});
    directCandidates.push({label: `outsider_direct_redeem_${amount}`, amount,
      instructions: [directRedeem(amount)],
      note: 'Fork seeds pre-existing attacker USDv; provider inventory found no USDv flash source.'});
  }
  const routePrincipal = maximumSources.reduce((sum, source) => sum + source.amount, 0n);
  const routeInput = routePrincipal < maximum ? routePrincipal : maximum;
  directCandidates.push({label: `outsider_direct_mint_unwind_max_joint_${routeInput}`,
    amount: routeInput, instructions: [directMint(routeInput), directRedeem(routeInput)],
    sources: maximumSources, note: 'Maximum jointly usable provider allocation; action input capped by Chancery per-settlement maximum.'});
  directCandidates.push({label: `outsider_direct_redeem_max_joint_${routeInput}`,
    amount: routeInput, instructions: [directRedeem(routeInput)], sources: maximumSources,
    note: 'Maximum provider allocation accompanies the action; USDv source is synthetic fork inventory, not lender liquidity.'});

  const targetResults = [];
  const defaultSource = klendSource(selectedKlend, minimum);
  async function runTarget(candidate, category = 'outsider-candidate') {
    const sources = candidate.sources || [klendSource(selectedKlend, minimum)];
    const result = await simulate(candidate.label, category, wrap(sources, candidate.instructions), {
      candidateAmountRaw: candidate.amount?.toString() || null, note: candidate.note || null,
      sources: sources.map(source => ({provider: source.kind === 'klend' ? 'KLend' : 'Project0',
        id: source.id, amountRaw: source.amount.toString()})),
      lenderVaults: [selectedKlend.supplyVault, selectedKlend.feeVault,
        ...sources.filter(source => source.kind === 'project0').map(source => source.row.vault)],
    });
    targetResults.push(result);
    return result;
  }
  for (const candidate of directCandidates) await runTarget(candidate, 'direct-settlement');

  const substitutions = [
    ['substitution_operator_permission_attacker_principal', directRedeem(minimum,
      {6: named.permission_record}), 'live operator permission record paired with attacker principal'],
    ['substitution_noncanonical_permission', directRedeem(minimum,
      {6: deterministicPlaceholder('noncanonical-permission')}), 'noncanonical permission account'],
    ['substitution_destination_operator_account', directRedeem(minimum,
      {9: named.destination_asset_token_account}), 'destination token owner differs from attacker principal'],
    ['substitution_reserve_klend_supply', directRedeem(minimum,
      {8: selectedKlend.supplyVault}), 'reserve vault replaced by KLend supply'],
    ['substitution_reserve_authority_mint_authority', directRedeem(minimum,
      {12: config.mint_authority_pda}), 'reserve authority replaced by mint authority'],
    ['substitution_mint_authority_reserve_authority', directMint(minimum,
      {12: named.reserve_authority_pda}), 'mint authority replaced by reserve authority'],
    ['substitution_asset_mint_issued_mint', directRedeem(minimum,
      {10: USDV}), 'asset mint alias'],
  ];
  for (const [label, instruction, note] of substitutions)
    await runTarget({label, amount: minimum, instructions: [instruction], note}, 'account-substitution');

  const noSignerPrincipal = directRedeem(minimum,
    {15: {pubkey: actors.attacker.publicKey, isSigner: false}});
  await runTarget({label: 'principal_not_instruction_signer', amount: minimum,
    instructions: [noSignerPrincipal], note: 'Signed transaction, but principal meta deliberately lacks signer privilege.'},
  'signer-auth');

  const offCurvePrincipal = P(named.chancery_config);
  const offCurvePermission = pda('permission', offCurvePrincipal, Buffer.from([2]), pathway);
  const offCurveIx = directRedeem(minimum, {6: offCurvePermission,
    15: {pubkey: offCurvePrincipal, isSigner: true}});
  await runTarget({label: 'program_pda_as_external_principal', amount: minimum,
    instructions: [offCurveIx], note: 'Expected local signing blocker: program PDA has no external private key.'},
  'signer-auth');

  const permissionEscalation = instructionFromIdl('upsert_permission', {
    subject: actors.attacker.publicKey, scope_kind: 2, scope_key: pathway,
    role_bits: [new anchor.BN(3), new anchor.BN(0)], expiry_unix_timestamp: new anchor.BN(0),
  }, {...common, permission_record: attackerPathwayPermission});
  await runTarget({label: 'outsider_self_grant_mint_redeem_roles', instructions: [permissionEscalation],
    note: 'Attempts to create a new capability-bearing permission directly.'}, 'privilege-escalation');

  const setModule = instructionFromIdl('set_module_status', {module_id: 10, new_status: 2}, common);
  await runTarget({label: 'outsider_enable_migration_module', instructions: [setModule],
    note: 'Attempts to enable disabled migration module.'}, 'privilege-escalation');
  const updateAsset = instructionFromIdl('update_asset_config', {
    approved_extension_mask: null, observed_extension_mask: null,
    deposit_rate_e9: new anchor.BN('2000000000'), redeem_rate_e9: null,
    minimum_deposit_amount: null, minimum_redeem_amount: null,
    maximum_single_settlement_amount: null, forbidden_extension_mask: null,
    required_module_mask: null,
  }, common);
  await runTarget({label: 'outsider_change_deposit_rate', instructions: [updateAsset],
    note: 'Attempts to double the mint conversion rate.'}, 'privilege-escalation');

  // Discover a real USDG ReserveDestination solely to ensure the authority
  // check is exercised against an authentic destination-scoped key.
  const reserveAccount = idl.accounts.find(account => account.name === 'ReserveDestination');
  const reserveRowsRaw = await rpc(UPSTREAM, 'getProgramAccounts', [CHANCERY.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', filters: [
      {dataSize: 216}, {memcmp: {offset: 0, bytes: bs58.encode(Buffer.from(reserveAccount.discriminator))}},
    ],
  }]);
  const usdReserveDestinations = reserveRowsRaw.filter(row => {
    const data = Buffer.from(row.account.data[0], 'base64');
    return data.subarray(16, 48).equals(USDG.toBuffer());
  });
  if (usdReserveDestinations.length) {
    const selected = usdReserveDestinations[0];
    const data = Buffer.from(selected.account.data[0], 'base64');
    const destinationToken = P(data.subarray(48, 80));
    const withdrawalPermission = pda('permission', actors.attacker.publicKey,
      Buffer.from([3]), P(selected.pubkey));
    const withdrawal = instructionFromIdl('withdraw_reserve', {amount: new anchor.BN(minimum.toString()),
      minimum_destination_amount: new anchor.BN(minimum.toString())}, {...common,
      reserve_destination: selected.pubkey, destination_asset_token_account: destinationToken,
      withdrawal_limit_policy: deterministicPlaceholder('withdrawal-limit-policy'),
      withdrawal_daily_usage_window: deterministicPlaceholder('withdrawal-window'),
      permission_record: withdrawalPermission});
    await runTarget({label: 'outsider_withdraw_reserve', amount: minimum,
      instructions: [withdrawal], note: 'Authentic USDG ReserveDestination; attacker lacks its exact destination-scoped role.'},
    'reserve-withdrawal');
  }

  const intentId = crypto.createHash('sha256').update('chnry-usdg-signed-intent').digest();
  const settlementIntent = pda('settlement-intent', intentId);
  const intentArgs = {intent_id: [...intentId], pathway_id: [...pathwayId], settlement_mode: 1,
    settlement_action: 0, principal_a: actors.attacker.publicKey,
    principal_b: actors.principalB.publicKey, executor: actors.executor.publicKey,
    asset_mint: USDG, issued_token_mint: USDV,
    asset_amount: new anchor.BN(minimum.toString()), issued_token_amount: new anchor.BN(minimum.toString()),
    minimum_asset_amount: new anchor.BN(minimum.toString()),
    minimum_issued_token_amount: new anchor.BN(minimum.toString()), nonce: new anchor.BN(1),
    valid_after_unix_timestamp: new anchor.BN(0), expires_at_unix_timestamp: new anchor.BN('4102444800'),
    policy_id: [...Buffer.alloc(32)], intent_hash: [...Buffer.alloc(32)]};
  const createIntent = instructionFromIdl('create_settlement_intent', intentArgs,
    {...common, settlement_intent: settlementIntent});
  await runTarget({label: 'outsider_create_delegated_intent_on_direct_pathway', amount: minimum,
    instructions: [createIntent], note: 'Current USDG pathway kind is DIRECT, not DELEGATED.'}, 'settlement-prerequisite');

  const delegatedMap = {...common, intent: settlementIntent};
  for (const instructionName of ['mint_delegated', 'redeem_delegated']) {
    const instruction = instructionFromIdl(instructionName,
      {intent_id: [...intentId], pathway_id: [...pathwayId]}, delegatedMap);
    await runTarget({label: `outsider_${instructionName}_on_direct_pathway`, amount: minimum,
      instructions: [instruction], note: 'Current USDG pathway kind is DIRECT and the attacker intent is absent.'},
    'delegated-settlement');
  }
  for (const instructionName of ['mint_trilateral', 'redeem_trilateral']) {
    const instruction = instructionFromIdl(instructionName,
      {intent_id: [...intentId], pathway_id: [...pathwayId]}, delegatedMap);
    await runTarget({label: `outsider_${instructionName}_on_direct_pathway`, amount: minimum,
      instructions: [instruction], note: 'All three local actors sign; current pathway is not TRILATERAL.'},
    'trilateral-settlement');
  }

  // Disabled modules reject at the dispatch prefix. Supplying only that prefix
  // avoids inventing downstream state while proving capital cannot affect the gate.
  const disabledCandidates = [
    ['migration_enable_legacy', 'enable_legacy_migration', {legacy_program: SYSTEM, legacy_mint: USDG}],
    ['migration_convert_legacy', 'migrate_legacy_to_token2022', {amount: new anchor.BN(minimum.toString())}],
    ['cross_chain_consume_inbound', 'consume_inbound_message', {pathway_id: [...pathwayId],
      remote_chain_kind: 0, remote_domain_id: new anchor.BN(1), message_kind: 0,
      source_nonce: new anchor.BN(1), amount: new anchor.BN(minimum.toString()),
      expires_at_unix_timestamp: new anchor.BN('4102444800'), source_asset: [...Buffer.alloc(32)],
      sender: [...Buffer.alloc(32)], recipient: [...actors.attacker.publicKey.toBuffer()],
      provided_message_hash: [...Buffer.alloc(32)], signatures: []}],
    ['cross_chain_emit_outbound', 'emit_outbound_message', {pathway_id: [...pathwayId],
      remote_chain_kind: 0, remote_domain_id: new anchor.BN(1), amount: new anchor.BN(minimum.toString()),
      minimum_remote_amount: new anchor.BN(minimum.toString()), recipient: [...Buffer.alloc(32)],
      destination_asset: [...Buffer.alloc(32)], message_kind: 0,
      expires_at_unix_timestamp: new anchor.BN('4102444800')}],
  ];
  for (const [label, name, args] of disabledCandidates) {
    const definition = idl.instructions.find(ix => ix.name === name);
    const instruction = new TransactionInstruction({programId: CHANCERY,
      keys: [{pubkey: P(named.module_activation_state), isSigner: false, isWritable: false}],
      data: Buffer.from(ixCoder.encode(name, args))});
    await runTarget({label, amount: minimum, instructions: [instruction],
      note: `Module dispatch gate precedes all ${name} accounts and capital-sensitive logic.`},
    'disabled-module');
  }

  const crosswalkObjects = allObjects(crosswalk);
  const liveInventory = crosswalkObjects.filter(row => row.mint === USDG.toBase58() &&
    typeof row.provider === 'string' && typeof row.programId === 'string');
  const inventoryUnique = [...new Map(liveInventory.map(row => [
    [row.programId, row.vault, row.bank || row.reserve].join(':'),
    {provider: row.provider, programId: row.programId, vault: row.vault,
      bank: row.bank || null, reserve: row.reserve || null, market: row.market || null,
      displayedRaw: row.rawAmount, pdaControlVerified: row.pdaControlVerified},
  ])).values()];
  const independentPrograms = [...new Set(inventoryUnique.map(row => row.programId))];
  const usdvInventory = crosswalkObjects.filter(row => row.mint === USDV.toBase58() &&
    typeof row.provider === 'string' && typeof row.programId === 'string');

  const outsiderSuccesses = targetResults.filter(row => row.simulated && row.err === null);
  const positiveEquity = targetResults.filter(row => row.accounting?.positiveAttackerNetEquity);
  const output = {
    observedAt: new Date().toISOString(), scope: 'local fork simulation only; no live submission',
    fork: {endpointClass: 'localhost only', baselineSlot: beforeAll.slot},
    transactionRequirements: {version: 1, sigVerify: true, maximumBytes: 4096,
      maximumAccounts: 64, allSimulatedTransactionsLocallySigned: simulations
        .filter(row => row.simulated).every(row => row.signaturesVerified && row.transaction.sigVerifyRequested)},
    programs: {chancery: CHANCERY.toBase58(), klend: KLEND.toBase58(), project0: PROJECT0.toBase58()},
    instructionTemplateProvenance: {project0: p0TemplateSource,
      klend: {artifact: 'kamino-flash-history.json'},
      chancery: {signature: CHANCERY_HISTORY, slot: chanceryTx.slot}},
    actors: {attacker: actors.attacker.publicKey.toBase58(), principalB: actors.principalB.publicKey.toBase58(),
      executor: actors.executor.publicKey.toBase58(), marginfiAccount: actors.marginfiAccount.publicKey.toBase58(),
      attackerUsdG: attackerUsdg.toBase58(), attackerUsdV: attackerUsdv.toBase58()},
    providerInventory: {sourceArtifactTimestamp: crosswalk.timestamp || null,
      exactVerifiedUsdGEntries: inventoryUnique, independentProviderPrograms: independentPrograms,
      independentProviderProgramCount: independentPrograms.length,
      triProviderAvailableInVerifiedInventory: independentPrograms.length >= 3,
      thirdIndependentProviderBlocker: independentPrograms.length < 3 ?
        'The verified same-mint inventory contains only KLend and Project0/marginfi program IDs; multiple reserves/banks do not create another independent provider.' : null,
      usdVCompatibleProviderEntries: usdvInventory,
      usdVFlashBlocker: usdvInventory.length ? null :
        'No verified same-mint USDv flash source exists in the current inventory; standalone redeem uses disclosed synthetic fork inventory.',
      klendSources: liveKlendRows, project0Sources: liveP0Rows.map(row => ({...row,
        measuredUsableCapacityRaw: (p0Usable.get(row.bank) || 0n).toString()})),
      klendSelection: selectedKlend,
      klendRepeatBorrowConstraint: providerControls.repeatBorrow?.decodedError || null,
      maximumCombination: {sourceCount: maximumSources.length, independentProviderCount:
        new Set(maximumSourceMetadata.map(row => row.provider)).size,
        principalRaw: routePrincipal.toString(), actionInputRaw: routeInput.toString(),
        sources: maximumSourceMetadata}},
    currentChanceryGuards: {minimumRaw: minimum.toString(), maximumRaw: maximum.toString(),
      currentPathwayKind: state.currentHistoricalAccounts.accounts[named.pathway_policy].decoded.pathway_kind,
      migrationModuleStatus: state.currentHistoricalAccounts.accounts[named.module_activation_state]
        .decoded.moduleStatusById.migration,
      crossChainModuleStatus: state.currentHistoricalAccounts.accounts[named.module_activation_state]
        .decoded.moduleStatusById.cross_chain},
    providerControls, targetResults,
    conclusion: {targetCaseCount: targetResults.length,
      fullySignedSimulatedTargetCases: targetResults.filter(row => row.simulated && row.signaturesVerified).length,
      locallyBlockedTargetCases: targetResults.filter(row => !row.simulated).map(row => ({label: row.label,
        blocker: row.concreteBlocker, bytes: row.transaction.sizeBytes, accounts: row.transaction.addressCount})),
      outsiderSuccessfulCases: outsiderSuccesses.map(row => row.label),
      positiveUnauthorizedNetEquityCases: positiveEquity.map(row => row.label),
      validatedUnauthorizedDrain: positiveEquity.length > 0,
      noDrainQualification: 'A failed auth/module/pathway gate or an unconstructible wrapper is a concrete blocker, not proof that a hypothetical bypass drains assets.'},
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({out: OUT, cases: targetResults.length,
    signedCases: output.conclusion.fullySignedSimulatedTargetCases,
    blockedCases: output.conclusion.locallyBlockedTargetCases.length,
    positiveEquityCases: output.conclusion.positiveUnauthorizedNetEquityCases,
    independentProviders: independentPrograms.length,
    maximumSources: maximumSources.length}));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
