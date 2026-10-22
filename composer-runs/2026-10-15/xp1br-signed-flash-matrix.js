#!/usr/bin/env node
'use strict';

// Locally signed, fork-only Solana v1 outsider-gain harness for XP1BR.
// The fork lazily mirrors current mainnet public accounts. Only a fresh local
// attacker system account is funded. Every retained transaction is signed,
// simulated with sigVerify=true, and never submitted to mainnet.

const crypto = require('crypto');
const fs = require('fs');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const anchor = require(`${modules}@coral-xyz/anchor`);
const bs58Module = require(`${modules}bs58`);
const bs58 = bs58Module.default || bs58Module;
const spl = require(`${modules}@solana/spl-token`);
const {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} = require(`${modules}@solana/web3.js`);

const DIR = __dirname;
const OUT = process.env.XP1BR_MATRIX_OUT || `${DIR}/xp1br-signed-flash-matrix.json`;
const FORK = process.env.XP1BR_FORK_RPC || 'http://127.0.0.1:8997';
const envText = fs.existsSync('/tmp/composer-helius-rpc.env')
  ? fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8') : '';
const env = Object.fromEntries(envText
  .split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const UPSTREAM = process.env.XP1BR_PUBLIC_RPC || env.HEAVY_RPC_URL || env.RPC_URL ||
  'https://api.mainnet-beta.solana.com';
const P = (value) => new PublicKey(value);
const XP = P('XP1BRLn8eCYSygrd8er5P4GKdzqKbC3DLoSsS5UYVZy');
const PROJECT0 = P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const JUP_LIQUIDITY = P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS');
const JUP_FLASH = P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF');
const JUP_LIQUIDITY_AUTHORITY = P('6GjquP3CKxb9G6RDsDsbMRjvomhzzeDq9twa9mS8AumL');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN = spl.ASSOCIATED_TOKEN_PROGRAM_ID;
const SYSTEM = SystemProgram.programId;
const UPGRADEABLE_LOADER = P('BPFLoaderUpgradeab1e11111111111111111111111');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const NOOP = P('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const DEFAULT = SYSTEM.toBase58();
const [JUP_FLASH_ADMIN] = PublicKey.findProgramAddressSync(
  [Buffer.from('flashloan_admin')], JUP_FLASH);

const P0_DISC = {
  init: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154]),
  start: Buffer.from([14, 131, 33, 220, 81, 186, 180, 107]),
  borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
  repay: Buffer.from([79, 209, 172, 177, 222, 51, 173, 151]),
  end: Buffer.from([105, 124, 201, 106, 153, 2, 8, 156]),
};
const JUP_DISC = {
  borrow: Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]),
  repay: Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]),
  refresh: Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]),
};

const inventory = JSON.parse(fs.readFileSync(`${DIR}/xp1br-current-inventory.json`, 'utf8'));
if (process.env.XP1BR_REFRESH_PATH) {
  const refresh = JSON.parse(fs.readFileSync(process.env.XP1BR_REFRESH_PATH, 'utf8'));
  const onyc = inventory.rows.find((row) => row.symbol === 'ONyc');
  if (!onyc) throw new Error('ONyc row absent from base inventory');
  onyc.indexWords = refresh.meta.index;
  onyc.lastSlotCached = refresh.meta.last_slot_cached;
  onyc.rateLimit = refresh.meta.rate_limit;
  onyc.hook = refresh.meta.hook;
  onyc.interfaceAccounts = refresh.meta.interface_accounts;
  onyc.principalRaw = refresh.balances.principalVaultRaw;
  onyc.principalVaults[0].amountRaw = refresh.balances.principalVaultRaw;
  onyc.mintSyState.supplyRaw = refresh.balances.syMintSupplyRaw;
  const syEscrow = onyc.allTokenAccountsOwnedByMeta.find((row) => row.address === onyc.tokenSyEscrow);
  if (syEscrow) syEscrow.amountRaw = refresh.balances.syEscrowRaw;
}
const xpIdl = JSON.parse(fs.readFileSync(`${DIR}/xp1br-generic-standard-idl.json`, 'utf8'));
const klendCensus = JSON.parse(fs.readFileSync(`${DIR}/klend-zero-fee-census.json`, 'utf8'));
const p0VaultCensus = JSON.parse(fs.readFileSync(`${DIR}/marginfi-vaults-current.json`, 'utf8'));
const p0Idl = JSON.parse(fs.readFileSync(
  `${DIR}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const jupInventory = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-current-inventory.json`, 'utf8'));
const jupLiquidityIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-idl.json`, 'utf8'));
const jupFlashIdl = JSON.parse(fs.readFileSync(`${DIR}/jup6qf-onchain-flash-idl.json`, 'utf8'));
const xpCoder = new anchor.BorshAccountsCoder(xpIdl);
const p0Coder = new anchor.BorshAccountsCoder(p0Idl);
const jupLiquidityCoder = new anchor.BorshAccountsCoder(jupLiquidityIdl);
const jupFlashCoder = new anchor.BorshAccountsCoder(jupFlashIdl);

let rpcId = 0;

async function rpcAt(endpoint, method, params) {
  let last;
  const maxAttempts = endpoint === FORK ? 4 : 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
        signal: AbortSignal.timeout(endpoint === FORK ? 15_000 : 30_000)});
      const body = await response.json();
      if (body.error) return {rpcError: body.error};
      return {result: body.result};
    } catch (error) {
      last = error;
      if (attempt < maxAttempts - 1) await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1_500, 200 * (attempt + 1))));
    }
  }
  return {transportError: last?.message || String(last)};
}

const rpc = (method, params) => rpcAt(FORK, method, params);
const upstreamRpc = (method, params) => rpcAt(UPSTREAM, method, params);

async function strictRpc(method, params) {
  const response = await rpc(method, params);
  if (response.rpcError || response.transportError)
    throw new Error(`${method} failed: ${JSON.stringify(response.rpcError || response.transportError)}`);
  return response.result;
}

async function strictUpstreamRpc(method, params) {
  const response = await upstreamRpc(method, params);
  if (response.rpcError || response.transportError)
    throw new Error(`${method} upstream failed: ${JSON.stringify(response.rpcError || response.transportError)}`);
  return response.result;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function amountOptionData(discriminator, amount, value) {
  return Buffer.concat([discriminator, u64(amount), Buffer.from([1, value ? 1 : 0])]);
}

function instruction(programId, keys, data) {
  return new TransactionInstruction({programId, keys, data: Buffer.from(data)});
}

function cloneInstruction(ix) {
  return instruction(ix.programId, ix.keys.map((key) => ({...key})), ix.data);
}

function fixedRaw(value) {
  if (!value?.value) return null;
  const bytes = Buffer.from(value.value);
  let number = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if ((bytes[15] & 0x80) !== 0) number -= 1n << 128n;
  return number.toString();
}

function tokenAmountFromAccount(account) {
  if (!account?.data) return null;
  const owner = account.owner instanceof PublicKey ? account.owner.toBase58() : account.owner;
  if (owner !== TOKEN.toBase58()) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  return data.length >= 165 ? data.readBigUInt64LE(64).toString() : null;
}

function mintSupplyFromAccount(account) {
  if (!account?.data) return null;
  const owner = account.owner instanceof PublicKey ? account.owner.toBase58() : account.owner;
  if (owner !== TOKEN.toBase58()) return null;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  return data.length >= 82 && data.length < 165 ? data.readBigUInt64LE(36).toString() : null;
}

function accountImage(address, account) {
  if (!account) return {address: address.toBase58(), exists: false};
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  const owner = account.owner instanceof PublicKey ? account.owner.toBase58() : account.owner;
  const image = {address: address.toBase58(), exists: true, owner,
    lamports: String(account.lamports), dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex'),
    tokenAmountRaw: tokenAmountFromAccount(account), mintSupplyRaw: mintSupplyFromAccount(account)};
  if (owner === PROJECT0.toBase58() && data.length === 2312) {
    try {
      const decoded = p0Coder.decode('MarginfiAccount', data);
      image.marginfiAccount = {authority: decoded.authority.toBase58(), group: decoded.group.toBase58(),
        activeBalances: decoded.lending_account.balances.filter((row) => row.active).map((row) => ({
          bank: row.bank_pk.toBase58(), assetSharesI80F48Raw: fixedRaw(row.asset_shares),
          liabilitySharesI80F48Raw: fixedRaw(row.liability_shares),
          premiumOutstandingI80F48Raw: fixedRaw(row.premium_outstanding),
        }))};
    } catch (error) {
      image.decodeError = error.message;
    }
  } else if (owner === XP.toBase58()) {
    try {
      const decoded = xpCoder.decode('Position', data);
      image.position = {owner: decoded.owner.toBase58(), meta: decoded.meta.toBase58(),
        amountRaw: decoded.amount.toString()};
    } catch {
      // Other XP-owned accounts are retained by hash.
    }
  } else if (address.equals(JUP_FLASH_ADMIN)) {
    try {
      const decoded = jupFlashCoder.decode('FlashloanAdmin', data);
      image.jupFlash = {status: decoded.status, feeBps: decoded.flashloan_fee,
        active: decoded.is_flashloan_active,
        activeAmountRaw: decoded.active_flashloan_amount.toString()};
    } catch (error) {
      image.decodeError = error.message;
    }
  }
  return image;
}

function delta(after, before) {
  return (BigInt(after || 0) - BigInt(before || 0)).toString();
}

function isWritableIndex(message, index) {
  const header = message.header;
  if (index < header.numRequiredSignatures)
    return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  return index < message.staticAccountKeys.length - header.numReadonlyUnsignedAccounts;
}

function ed25519Sign(message, keypair) {
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(keypair.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  return crypto.sign(null, message, privateKey);
}

// web3.js 1.x is used only for canonical account ordering. This emits the
// runtime v1 wire and appends real Ed25519 signatures over the v1 message.
function encodeSignedV1(instructions, payer, blockhash, signers, options = {}) {
  const {computeLimit = 1_400_000, dataLimit = 67_108_864,
    allowOversize = false, allowOverAccounts = false} = options;
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (compiled.addressTableLookups.length) throw new Error('v1 has no address-table lookups');
  const keys = compiled.staticAccountKeys;
  const items = compiled.compiledInstructions;
  if (!allowOverAccounts && (keys.length > 64 || items.length > 64))
    throw new Error(`v1 inline limit: ${keys.length} addresses, ${items.length} instructions`);
  if (keys.length > 255 || items.length > 255) throw new Error('v1 u8 count overflow');
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
  const message = Buffer.concat([
    Buffer.from([0x81, compiled.header.numRequiredSignatures,
      compiled.header.numReadonlySignedAccounts, compiled.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map((key) => key.toBuffer()),
    config, ...heads, ...payloads,
  ]);
  const signatureCount = compiled.header.numRequiredSignatures;
  const signerOrder = keys.slice(0, signatureCount).map((key) => key.toBase58());
  const signatures = signerOrder.map((address) => {
    const keypair = signers.get(address);
    if (!keypair) throw new Error(`Uncontrolled required signer ${address}`);
    return ed25519Sign(message, keypair);
  });
  const wire = Buffer.concat([message, ...signatures]);
  if (!allowOversize && wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {wire, message, signerOrder, requiredSignatures: signatureCount,
    instructionCount: items.length,
    accountKeys: keys.map((key, index) => ({index, address: key.toBase58(),
      signer: index < signatureCount, writable: isWritableIndex(compiled, index)}))};
}

function historyInstruction(tx, index) {
  const message = tx.transaction.message;
  const keys = [...message.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const header = message.header;
  const staticCount = message.accountKeys.length;
  const writable = (keyIndex) => keyIndex < staticCount ?
    (keyIndex < header.numRequiredSignatures ?
      keyIndex < header.numRequiredSignatures - header.numReadonlySignedAccounts :
      keyIndex < staticCount - header.numReadonlyUnsignedAccounts) :
    keyIndex < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const source = message.instructions[index];
  return instruction(P(keys[source.programIdIndex]), source.accounts.map((keyIndex) => ({
    pubkey: P(keys[keyIndex]), isSigner: keyIndex < header.numRequiredSignatures,
    isWritable: writable(keyIndex),
  })), Buffer.from(bs58.decode(source.data)));
}

function loadKlendTemplates() {
  const history = JSON.parse(fs.readFileSync(`${DIR}/kamino-flash-history.json`, 'utf8'));
  const tx = history.hits[0].transaction;
  const borrow = historyInstruction(tx, 3);
  const repay = historyInstruction(tx, 13);
  if (!borrow.programId.equals(KLEND) || !repay.programId.equals(KLEND))
    throw new Error('KLend source instruction mismatch');
  return {borrow, repay, sourceSignature: history.hits[0].signature,
    sourceSlot: history.hits[0].slot};
}

function loadP0Templates() {
  const artifact = JSON.parse(fs.readFileSync(`${DIR}/marginfi-flashloan-stress.json`, 'utf8'));
  const row = artifact.results.find((item) => item.name === 'project0_pair_2' &&
    !item.localError && !item.rpcError && !item.err);
  if (!row) throw new Error('Stored successful Project0 v1 source unavailable');
  const wire = Buffer.from(row.wireBase64, 'base64');
  if (wire[0] !== 0x81) throw new Error('Stored Project0 source is not v1');
  const instructionCount = wire[40];
  const accountCount = wire[41];
  let offset = 42 + accountCount * 32 + 8;
  const heads = [];
  for (let index = 0; index < instructionCount; index += 1) {
    heads.push({programIdIndex: wire[offset], accountCount: wire[offset + 1],
      dataLength: wire.readUInt16LE(offset + 2)});
    offset += 4;
  }
  const keys = row.accountKeys.map((item) => ({...item, pubkey: P(item.address)}));
  const instructions = heads.map((head) => {
    const accountIndexes = [...wire.subarray(offset, offset + head.accountCount)];
    offset += head.accountCount;
    const data = wire.subarray(offset, offset + head.dataLength);
    offset += head.dataLength;
    return instruction(keys[head.programIdIndex].pubkey,
      accountIndexes.map((keyIndex) => ({pubkey: keys[keyIndex].pubkey,
        isSigner: keys[keyIndex].signer, isWritable: keys[keyIndex].writable})), data);
  });
  const find = (discriminator) => {
    const found = instructions.find((ix) => ix.programId.equals(PROJECT0) &&
      Buffer.from(ix.data).subarray(0, 8).equals(discriminator));
    if (!found) throw new Error(`Project0 source instruction missing ${discriminator.toString('hex')}`);
    return cloneInstruction(found);
  };
  return {start: find(P0_DISC.start), borrow: find(P0_DISC.borrow),
    repay: find(P0_DISC.repay), end: find(P0_DISC.end),
    sourceSlot: artifact.sourceControl.slot, wireSha256: row.wireSha256};
}

const klendTemplates = loadKlendTemplates();
const p0Templates = loadP0Templates();

function makeKlendPair(provider, amount, authority, baseAta) {
  const market = P(provider.market);
  const lma = PublicKey.findProgramAddressSync([Buffer.from('lma'), market.toBuffer()], KLEND)[0];
  const remap = (template) => {
    const ix = cloneInstruction(template);
    const replacements = {0: authority, 1: lma, 2: market, 3: P(provider.reserve),
      4: P(provider.mint), 5: P(provider.supplyVault), 6: baseAta,
      7: P(provider.feeVault), 11: TOKEN};
    for (const [index, pubkey] of Object.entries(replacements)) ix.keys[Number(index)].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 8);
    return ix;
  };
  return {borrow: remap(klendTemplates.borrow), repay: remap(klendTemplates.repay)};
}

async function prepareKlendProvider(censusRow) {
  const [reserveAccount, supplyAccount, feeAccount] = (await strictUpstreamRpc('getMultipleAccounts', [[
    censusRow.reserve, censusRow.supplyVault, censusRow.feeVault,
  ], {encoding: 'base64', commitment: 'processed'}])).value;
  if (!reserveAccount || !supplyAccount || !feeAccount) throw new Error('KLend provider account missing');
  const reserveData = Buffer.from(reserveAccount.data[0], 'base64');
  const available = reserveData.readBigUInt64LE(224);
  const flashFeeSf = reserveData.readBigUInt64LE(4904);
  const supply = BigInt(tokenAmountFromAccount(supplyAccount));
  return {...censusRow, currentAvailableRaw: available.toString(),
    currentSupplyVaultRaw: supply.toString(), currentFeeVaultRaw: tokenAmountFromAccount(feeAccount),
    routeCapacityRaw: (available < supply ? available : supply).toString(),
    currentFlashFeeSf: flashFeeSf.toString(), exactZeroFee: flashFeeSf === 0n};
}

async function prepareP0Provider(vaultRow) {
  const [bankAccount, vaultAccount] = (await strictUpstreamRpc('getMultipleAccounts', [[
    vaultRow.bank, vaultRow.address,
  ], {encoding: 'base64', commitment: 'processed'}])).value;
  if (!bankAccount || !vaultAccount) throw new Error('Project0 provider account missing');
  const decoded = p0Coder.decode('Bank', Buffer.from(bankAccount.data[0], 'base64'));
  const oracleKeys = decoded.config.oracle_keys.map((key) => key.toBase58())
    .filter((address) => address !== DEFAULT);
  const feeRaw = fixedRaw(decoded.config.interest_rate_config.protocol_origination_fee);
  return {...vaultRow, currentLiquidityRaw: tokenAmountFromAccount(vaultAccount),
    oracleSetup: Object.keys(decoded.config.oracle_setup)[0], oracleKeys,
    operationalState: Object.keys(decoded.config.operational_state)[0],
    originationFeeI80F48Raw: feeRaw, exactZeroFee: feeRaw === '0'};
}

function makeP0Parts(provider, amount, authority, marginfiAccount, baseAta) {
  const group = P(provider.group);
  const bank = P(provider.bank);
  const health = [bank, ...provider.oracleKeys.map(P)].map((pubkey) => ({
    pubkey, isSigner: false, isWritable: false,
  }));
  const init = instruction(PROJECT0, [
    {pubkey: group, isSigner: false, isWritable: false},
    {pubkey: marginfiAccount, isSigner: true, isWritable: true},
    {pubkey: authority, isSigner: true, isWritable: false},
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
  ], P0_DISC.init);
  const start = cloneInstruction(p0Templates.start);
  start.keys[0].pubkey = marginfiAccount;
  start.keys[1].pubkey = authority;
  const borrow = cloneInstruction(p0Templates.borrow);
  borrow.keys = borrow.keys.slice(0, 8);
  const replacements = {0: group, 1: marginfiAccount, 2: authority, 3: bank,
    4: baseAta, 5: P(provider.authority), 6: P(provider.address), 7: TOKEN};
  for (const [index, pubkey] of Object.entries(replacements)) borrow.keys[Number(index)].pubkey = pubkey;
  borrow.keys.push(...health);
  borrow.data = Buffer.concat([P0_DISC.borrow, u64(amount)]);
  const repay = cloneInstruction(p0Templates.repay);
  const repayReplacements = {0: group, 1: marginfiAccount, 2: authority, 3: bank,
    4: baseAta, 5: P(provider.address), 6: TOKEN};
  for (const [index, pubkey] of Object.entries(repayReplacements)) repay.keys[Number(index)].pubkey = pubkey;
  repay.data = amountOptionData(P0_DISC.repay, amount, true);
  const end = cloneInstruction(p0Templates.end);
  end.keys = end.keys.slice(0, 3);
  end.keys[0].pubkey = marginfiAccount;
  end.keys[1].pubkey = group;
  end.keys[2].pubkey = authority;
  end.keys.push(...health);
  return {init, start, borrow, repay, end};
}

async function prepareJupUsdeProvider() {
  const target = jupInventory.reserves.find((row) => row.symbol === 'USDe');
  const binding = jupInventory.protocolBindings.find((row) => row.protocol === JUP_FLASH_ADMIN.toBase58());
  if (!target || !binding) throw new Error('Jupiter USDe flash binding unavailable');
  const position = binding.borrowPositions.find((row) => row.mint === target.mint);
  if (!position) throw new Error('Jupiter USDe flash borrow position unavailable');
  const [vaultAccount, reserveAccount, positionAccount, adminAccount] =
    (await strictUpstreamRpc('getMultipleAccounts', [[target.vault, target.reserve, position.address,
      JUP_FLASH_ADMIN.toBase58()], {encoding: 'base64', commitment: 'processed'}])).value;
  const reserve = jupLiquidityCoder.decode('TokenReserve', Buffer.from(reserveAccount.data[0], 'base64'));
  const currentPosition = jupLiquidityCoder.decode('UserBorrowPosition',
    Buffer.from(positionAccount.data[0], 'base64'));
  const admin = jupFlashCoder.decode('FlashloanAdmin', Buffer.from(adminAccount.data[0], 'base64'));
  const scale = 1_000_000_000_000n;
  const supply = BigInt(reserve.total_supply_with_interest.toString()) *
    BigInt(reserve.supply_exchange_price.toString()) / scale +
    BigInt(reserve.total_supply_interest_free.toString());
  const borrow = BigInt(reserve.total_borrow_with_interest.toString()) *
    BigInt(reserve.borrow_exchange_price.toString()) / scale +
    BigInt(reserve.total_borrow_interest_free.toString());
  const accountingAvailable = supply - borrow - BigInt(reserve.total_claim_amount.toString());
  const vaultRaw = BigInt(tokenAmountFromAccount(vaultAccount));
  const ceiling = BigInt(currentPosition.max_debt_ceiling.toString());
  const capacity = [accountingAvailable, vaultRaw, ceiling].reduce((a, b) => a < b ? a : b);
  return {provider: 'jupiter-native-flash', mint: target.mint, reserve: target.reserve,
    vault: target.vault, rateModel: target.rateModel, borrowPosition: position.address,
    currentVaultRaw: vaultRaw.toString(), currentAccountingAvailableRaw: accountingAvailable.toString(),
    currentDebtCeilingRaw: ceiling.toString(), routeCapacityRaw: capacity.toString(),
    feeBps: Number(admin.flashloan_fee), exactZeroFee: Number(admin.flashloan_fee) === 0};
}

function makeJupPair(provider, amount, authority, baseAta) {
  const keys = () => [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: JUP_FLASH_ADMIN, isSigner: false, isWritable: true},
    {pubkey: baseAta, isSigner: false, isWritable: true},
    {pubkey: P(provider.mint), isSigner: false, isWritable: false},
    {pubkey: P(provider.reserve), isSigner: false, isWritable: true},
    {pubkey: P(provider.borrowPosition), isSigner: false, isWritable: true},
    {pubkey: P(provider.rateModel), isSigner: false, isWritable: false},
    {pubkey: P(provider.vault), isSigner: false, isWritable: true},
    {pubkey: JUP_LIQUIDITY_AUTHORITY, isSigner: false, isWritable: false},
    {pubkey: JUP_LIQUIDITY, isSigner: false, isWritable: false},
    {pubkey: TOKEN, isSigner: false, isWritable: false},
    {pubkey: ASSOCIATED_TOKEN, isSigner: false, isWritable: false},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
    {pubkey: IX_SYSVAR, isSigner: false, isWritable: false},
  ];
  return {borrow: instruction(JUP_FLASH, keys(), Buffer.concat([JUP_DISC.borrow, u64(amount)])),
    refresh: instruction(JUP_LIQUIDITY, [
      {pubkey: P(provider.reserve), isSigner: false, isWritable: true},
      {pubkey: P(provider.rateModel), isSigner: false, isWritable: false},
    ], Buffer.concat([JUP_DISC.refresh, P(provider.mint).toBuffer()])),
    repay: instruction(JUP_FLASH, keys(), Buffer.concat([JUP_DISC.repay, u64(amount)]))};
}

function targetContext(row, authority) {
  const baseMint = P(row.yieldBearingMint);
  const syMint = P(row.mintSy);
  const baseTokenProgram = P(row.principalVaults[0].ownerProgram);
  const syTokenProgram = P(row.mintSyState.ownerProgram);
  const baseAta = spl.getAssociatedTokenAddressSync(baseMint, authority, false, baseTokenProgram);
  const syAta = spl.getAssociatedTokenAddressSync(syMint, authority, false, syTokenProgram);
  const rateWord = String(row.indexWords['0'][0]);
  const rate = BigInt(/[a-f]/i.test(rateWord) ? `0x${rateWord}` : rateWord);
  const scale = 1_000_000_000_000n;
  const syForBase = (amount) => BigInt(amount) * scale / rate;
  const mint = (amount, changes = {}) => {
    const target = changes.row || row;
    return instruction(XP, [
      {pubkey: changes.signer || authority, isSigner: true, isWritable: true},
      {pubkey: P(target.meta), isSigner: false, isWritable: true},
      {pubkey: P(target.mintSy), isSigner: false, isWritable: true},
      {pubkey: P(target.yieldBearingMint), isSigner: false, isWritable: false},
      {pubkey: changes.source || baseAta, isSigner: false, isWritable: true},
      {pubkey: changes.vault || P(target.principalVaults[0].address), isSigner: false, isWritable: true},
      {pubkey: changes.destinationSy || syAta, isSigner: false, isWritable: true},
      {pubkey: P(target.principalVaults[0].ownerProgram), isSigner: false, isWritable: false},
      {pubkey: P(target.mintSyState.ownerProgram), isSigner: false, isWritable: false},
      ...(target.interfaceAccounts || []).map((address) => ({
        pubkey: P(address), isSigner: false, isWritable: true,
      })),
    ], Buffer.concat([Buffer.from([1]), u64(amount)]));
  };
  const redeem = (amount, changes = {}) => {
    const target = changes.row || row;
    return instruction(XP, [
      {pubkey: changes.signer || authority, isSigner: true, isWritable: true},
      {pubkey: P(target.meta), isSigner: false, isWritable: true},
      {pubkey: changes.destination || baseAta, isSigner: false, isWritable: true},
      {pubkey: changes.vault || P(target.principalVaults[0].address), isSigner: false, isWritable: true},
      {pubkey: changes.sourceSy || syAta, isSigner: false, isWritable: true},
      {pubkey: P(target.mintSy), isSigner: false, isWritable: true},
      {pubkey: P(target.yieldBearingMint), isSigner: false, isWritable: false},
      {pubkey: P(target.principalVaults[0].ownerProgram), isSigner: false, isWritable: false},
      {pubkey: P(target.mintSyState.ownerProgram), isSigner: false, isWritable: false},
      ...(target.interfaceAccounts || []).map((address) => ({
        pubkey: P(address), isSigner: false, isWritable: true,
      })),
    ], Buffer.concat([Buffer.from([2]), u64(amount)]));
  };
  return {row, baseMint, syMint, baseTokenProgram, syTokenProgram, baseAta, syAta,
    rate, scale, syForBase, mint, redeem,
    createBase: spl.createAssociatedTokenAccountIdempotentInstruction(
      authority, baseAta, authority, baseMint, baseTokenProgram),
    createSy: spl.createAssociatedTokenAccountIdempotentInstruction(
      authority, syAta, authority, syMint, syTokenProgram),
    closeBase: spl.createCloseAccountInstruction(baseAta, authority, authority, [], baseTokenProgram),
    closeSy: spl.createCloseAccountInstruction(syAta, authority, authority, [], syTokenProgram)};
}

function positionInstructions(context, authority, positionKey) {
  const row = context.row;
  const deposit = (amount, changes = {}) => instruction(XP, [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: P(row.meta), isSigner: false, isWritable: true},
    {pubkey: P(row.mintSy), isSigner: false, isWritable: false},
    {pubkey: P(row.tokenSyEscrow), isSigner: false, isWritable: true},
    {pubkey: context.syAta, isSigner: false, isWritable: true},
    {pubkey: changes.position || positionKey, isSigner: false, isWritable: true},
    {pubkey: context.syTokenProgram, isSigner: false, isWritable: false},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
  ], Buffer.concat([Buffer.from([5]), u64(amount)]));
  const withdraw = (amount, changes = {}) => instruction(XP, [
    {pubkey: authority, isSigner: true, isWritable: true},
    {pubkey: P(row.meta), isSigner: false, isWritable: true},
    {pubkey: P(row.mintSy), isSigner: false, isWritable: false},
    {pubkey: changes.position || positionKey, isSigner: false, isWritable: true},
    {pubkey: P(row.tokenSyEscrow), isSigner: false, isWritable: true},
    {pubkey: context.syAta, isSigner: false, isWritable: true},
    {pubkey: context.syTokenProgram, isSigner: false, isWritable: false},
    {pubkey: SYSTEM, isSigner: false, isWritable: false},
  ], Buffer.concat([Buffer.from([6]), u64(amount)]));
  return {deposit, withdraw};
}

function assembleRoute({context, authority, marginfiAccount, klend = [], p0 = null,
  jup = null, actions, noOp = null, closeAccounts = true}) {
  const instructions = [context.createBase, context.createSy];
  let p0Parts = null;
  if (p0) {
    p0Parts = makeP0Parts(p0.provider, p0.amount, authority, marginfiAccount, context.baseAta);
    instructions.push(p0Parts.init, p0Parts.start);
  }
  const klendPairs = klend.map((entry) => ({entry,
    pair: makeKlendPair(entry.provider, entry.amount, authority, context.baseAta)}));
  const klendBorrowIndexes = [];
  for (const item of klendPairs) {
    klendBorrowIndexes.push(instructions.length);
    instructions.push(item.pair.borrow);
  }
  if (p0Parts) instructions.push(p0Parts.borrow);
  let jupParts = null;
  if (jup) {
    jupParts = makeJupPair(jup.provider, jup.amount, authority, context.baseAta);
    instructions.push(jupParts.borrow);
  }
  instructions.push(...actions);
  if (noOp) instructions.push(noOp);
  if (jupParts) instructions.push(jupParts.refresh, jupParts.repay);
  if (p0Parts) instructions.push(p0Parts.repay);
  for (let index = klendPairs.length - 1; index >= 0; index -= 1) {
    const repay = klendPairs[index].pair.repay;
    repay.data[16] = klendBorrowIndexes[index];
    instructions.push(repay);
  }
  if (p0Parts) {
    const endIndex = instructions.length;
    p0Parts.start.data = Buffer.concat([P0_DISC.start, u64(endIndex)]);
    instructions.push(p0Parts.end);
  }
  if (closeAccounts) instructions.push(context.closeSy, context.closeBase);
  return instructions;
}

function compactLogs(logs) {
  return (logs || []).filter((line) => line.includes('Instruction:') ||
    line.includes('AnchorError') || line.includes('Error') || line.includes('failed') ||
    line.includes('consumed') || line.includes('success')).slice(-80);
}

const baselineCache = new Map();
const mirroredAccounts = new Map();
const mirrorSkipped = new Set([
  SYSTEM.toBase58(), TOKEN.toBase58(), ASSOCIATED_TOKEN.toBase58(),
  IX_SYSVAR.toBase58(), UPGRADEABLE_LOADER.toBase58(),
]);

async function mirrorPublicAccounts(addresses, syntheticAddresses) {
  const requested = [...new Set(addresses.map((address) => address.toBase58()))]
    .filter((address) => !syntheticAddresses.has(address) && !mirrorSkipped.has(address) &&
      !mirroredAccounts.has(address));
  for (let offset = 0; offset < requested.length; offset += 50) {
    const batch = requested.slice(offset, offset + 50);
    const response = await strictUpstreamRpc('getMultipleAccounts', [batch,
      {encoding: 'base64', commitment: 'confirmed'}]);
    for (let index = 0; index < batch.length; index += 1) {
      const address = batch[index];
      const account = response.value[index];
      mirroredAccounts.set(address, account);
      if (!account) continue;
      const data = Buffer.from(account.data[0], 'base64');
      // Executable programs used here were already exercised on this fork.
      // Avoid pushing multi-megabyte ProgramData through the custom account
      // setter; the runtime's existing executable cache is the authoritative
      // fork copy, while all mutable public state is mirrored below.
      if (account.executable) continue;
      await strictRpc('surfnet_setAccount', [address, {data: data.toString('hex'),
        executable: account.executable, lamports: account.lamports,
        owner: account.owner, rentEpoch: 0}]);
    }
  }
}

async function simulateCase(spec, runtime) {
  const watched = [...new Map(spec.watched.map((entry) => [entry.address.toBase58(), entry])).values()];
  const baselineKey = watched.map((entry) => entry.address.toBase58()).join(',');
  let beforeResponse = baselineCache.get(baselineKey);
  if (!beforeResponse) {
    // Compile once to discover every public account needed by the transaction,
    // mirror those accounts from the configured read-only endpoint, and keep
    // fresh attacker state explicit. This prevents the fork from falling back
    // to a rate-limited public RPC for random, nonexistent attacker addresses.
    const discovery = encodeSignedV1(spec.instructions, runtime.authority.publicKey,
      runtime.blockhash, runtime.signers, {...(spec.encodeOptions || {}), allowOversize: true});
    const syntheticAddresses = new Set([
      runtime.authority.publicKey.toBase58(), runtime.marginfiAccount.publicKey.toBase58(),
      ...spec.syntheticAbsent.map((address) => address.toBase58()),
    ]);
    await mirrorPublicAccounts([
      ...discovery.accountKeys.map((entry) => P(entry.address)),
      ...watched.map((entry) => entry.address),
    ], syntheticAddresses);
    const slot = await strictUpstreamRpc('getSlot', [{commitment: 'confirmed'}]);
    const authorityAccount = {data: ['', 'base64'], executable: false,
      lamports: 100_000_000_000, owner: SYSTEM.toBase58(), rentEpoch: 0};
    beforeResponse = {context: {slot}, value: watched.map((entry) => {
      const address = entry.address.toBase58();
      if (address === runtime.authority.publicKey.toBase58()) return authorityAccount;
      if (syntheticAddresses.has(address)) return null;
      return mirroredAccounts.get(address) || null;
    })};
    baselineCache.set(baselineKey, beforeResponse);
  }
  // The fork advances with its upstream. Fetch after all lazy account imports so
  // sigVerify=true never races an expired blockhash during a long matrix.
  const freshBlockhash = (await strictRpc('getLatestBlockhash',
    [{commitment: 'processed'}])).value.blockhash;
  let encoded;
  try {
    encoded = encodeSignedV1(spec.instructions, runtime.authority.publicKey,
      freshBlockhash, runtime.signers, spec.encodeOptions || {});
  } catch (error) {
    return {name: spec.name, category: spec.category, expectation: spec.expectation,
      localError: error.message, signatureVerification: true};
  }
  const response = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map((entry) => entry.address.toBase58())},
  }]);
  const value = response.result?.value;
  const before = watched.map((entry, index) => ({label: entry.label,
    ...accountImage(entry.address, beforeResponse.value[index])}));
  const persistentRoles = new Set(['target', 'target-token', 'target-mint',
    'lender-state', 'lender-token']);
  const after = watched.map((entry, index) => {
    const simulated = value?.accounts?.[index];
    const account = simulated == null && persistentRoles.has(entry.role)
      ? beforeResponse.value[index] : simulated;
    return {label: entry.label, ...accountImage(entry.address, account)};
  });
  const metric = (rows, label, field) => rows.find((row) => row.label === label)?.[field] || '0';
  const tokenDelta = (label) => delta(metric(after, label, 'tokenAmountRaw'),
    metric(before, label, 'tokenAmountRaw'));
  const mintDelta = (label) => delta(metric(after, label, 'mintSupplyRaw'),
    metric(before, label, 'mintSupplyRaw'));
  const lamportDelta = (label) => delta(metric(after, label, 'lamports'),
    metric(before, label, 'lamports'));
  const completed = !response.transportError && !response.rpcError && value && !value.err;
  const authorityLamports = lamportDelta('attacker');
  const marginfiLamports = spec.hasP0 ? lamportDelta('freshMarginfiAccount') : '0';
  const attackerTokenAccountLamports = (BigInt(lamportDelta('attackerBase')) +
    BigInt(lamportDelta('attackerSy'))).toString();
  const attackerLamportsNet = (BigInt(authorityLamports) + BigInt(marginfiLamports) +
    BigInt(attackerTokenAccountLamports)).toString();
  const lenderLabels = watched.filter((entry) => entry.role === 'lender-token').map((entry) => entry.label);
  const lenderTokenDeltas = Object.fromEntries(lenderLabels.map((label) => [label, tokenDelta(label)]));
  const p0After = after.find((row) => row.label === 'freshMarginfiAccount')?.marginfiAccount;
  const jupAfter = after.find((row) => row.label === 'jupiterFlashAdmin')?.jupFlash;
  const allLenderTokenDeltasZero = Object.values(lenderTokenDeltas).every((valueDelta) => valueDelta === '0');
  const p0Cleared = !spec.hasP0 || (p0After && p0After.activeBalances.length === 0);
  const jupCleared = !spec.hasJup || (jupAfter && !jupAfter.active && jupAfter.activeAmountRaw === '0');
  const outsiderDeltas = completed ? {baseRaw: tokenDelta('attackerBase'),
    syRaw: tokenDelta('attackerSy'), attackerLamportsNet, authorityLamports,
    attackerTokenAccountLamports, freshMarginfiAccountLamports: marginfiLamports} : null;
  const reconciliation = completed ? {
    targetPrincipalVaultRaw: tokenDelta('xpPrincipalVault'),
    targetSyMintSupplyRaw: mintDelta('xpSyMint'),
    targetSyEscrowRaw: tokenDelta('xpSyEscrow'),
    victimPositionRaw: watched.some((entry) => entry.label === 'victimPosition') ?
      delta(after.find((row) => row.label === 'victimPosition')?.position?.amountRaw || '0',
        before.find((row) => row.label === 'victimPosition')?.position?.amountRaw || '0') : null,
    lenderTokenDeltas, allLenderTokenDeltasZero, p0Cleared, jupCleared,
    everyProviderRepaid: allLenderTokenDeltasZero && p0Cleared && jupCleared,
  } : null;
  const hasPositiveOutsiderGain = completed && reconciliation.everyProviderRepaid &&
    (BigInt(outsiderDeltas.baseRaw) > 0n || BigInt(outsiderDeltas.syRaw) > 0n ||
      BigInt(outsiderDeltas.attackerLamportsNet) > 0n);
  const xpExecution = completed ? {
    mintLogged: (value.logs || []).some((line) => line === 'Program log: Instruction: Mint'),
    redeemLogged: (value.logs || []).some((line) => line === 'Program log: Instruction: Redeem'),
    successLogCount: (value.logs || []).filter((line) =>
      line === `Program ${XP.toBase58()} success`).length,
  } : null;
  return {name: spec.name, category: spec.category, expectation: spec.expectation,
    targetSymbol: spec.targetSymbol, allocations: spec.allocations,
    txVersion: 1, liveSubmission: false, localForkOnly: true,
    signatureVerification: true, signerOrder: encoded.signerOrder,
    preSlot: beforeResponse.context.slot, simulationSlot: response.result?.context?.slot || null,
    localError: null, transportError: response.transportError || null,
    rpcError: response.rpcError || null, err: value?.err || null,
    unitsConsumed: value?.unitsConsumed ?? null,
    loadedAccountsDataSize: value?.loadedAccountsDataSize ?? null,
    sizeBytes: encoded.wire.length, addressCount: encoded.accountKeys.length,
    instructionCount: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures,
    wireSha256: crypto.createHash('sha256').update(encoded.wire).digest('hex'),
    wireBase64: spec.storeWire ? encoded.wire.toString('base64') : null,
    accountKeys: spec.storeWire ? encoded.accountKeys : null,
    outsiderDeltas, reconciliation, hasPositiveOutsiderGain,
    xpExecution, before, after, trace: compactLogs(value?.logs),
    innerInstructions: value?.innerInstructions || null,
  };
}

function watchedFor(context, runtime, providers, positionKey = null) {
  const watched = [
    {label: 'attacker', address: runtime.authority.publicKey, role: 'attacker'},
    {label: 'attackerBase', address: context.baseAta, role: 'attacker-token'},
    {label: 'attackerSy', address: context.syAta, role: 'attacker-token'},
    {label: 'xpMeta', address: P(context.row.meta), role: 'target'},
    {label: 'xpPrincipalVault', address: P(context.row.principalVaults[0].address), role: 'target-token'},
    {label: 'xpSyMint', address: P(context.row.mintSy), role: 'target-mint'},
    {label: 'xpSyEscrow', address: P(context.row.tokenSyEscrow), role: 'target-token'},
  ];
  if (positionKey) watched.push({label: 'victimPosition', address: positionKey, role: 'target'});
  if (providers.p0) watched.push(
    {label: 'freshMarginfiAccount', address: runtime.marginfiAccount.publicKey, role: 'attacker-state'},
    {label: `p0Bank:${providers.p0.bank}`, address: P(providers.p0.bank), role: 'lender-state'},
    {label: `p0Vault:${providers.p0.address}`, address: P(providers.p0.address), role: 'lender-token'});
  for (const provider of providers.klend || []) watched.push(
    {label: `klendReserve:${provider.reserve}`, address: P(provider.reserve), role: 'lender-state'},
    {label: `klendSupply:${provider.reserve}`, address: P(provider.supplyVault), role: 'lender-token'},
    {label: `klendFee:${provider.reserve}`, address: P(provider.feeVault), role: 'lender-token'});
  if (providers.jup) watched.push(
    {label: 'jupiterFlashAdmin', address: JUP_FLASH_ADMIN, role: 'lender-state'},
    {label: `jupiterReserve:${providers.jup.reserve}`, address: P(providers.jup.reserve), role: 'lender-state'},
    {label: `jupiterVault:${providers.jup.reserve}`, address: P(providers.jup.vault), role: 'lender-token'},
    {label: `jupiterPosition:${providers.jup.reserve}`,
      address: P(providers.jup.borrowPosition), role: 'lender-state'});
  return watched;
}

async function main() {
  const authority = Keypair.generate();
  const marginfiAccount = Keypair.generate();
  await strictRpc('surfnet_setAccount', [authority.publicKey.toBase58(), {
    data: '', executable: false, lamports: 100_000_000_000,
    owner: SYSTEM.toBase58(), rentEpoch: 0,
  }]);
  const blockhash = (await strictRpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const runtime = {authority, marginfiAccount, blockhash,
    signers: new Map([[authority.publicKey.toBase58(), authority],
      [marginfiAccount.publicKey.toBase58(), marginfiAccount]])};

  const rowBySymbol = new Map(inventory.rows.filter((row) => row.symbol)
    .map((row) => [row.symbol, row]));
  const bulkRow = rowBySymbol.get('BulkSOL');
  const onycRow = rowBySymbol.get('ONyc');
  const rkuRow = rowBySymbol.get('rkuSOL');
  const usdeRow = rowBySymbol.get('USDe');
  if (!bulkRow || !onycRow || !rkuRow || !usdeRow) throw new Error('Required target rows absent');

  const klendFor = async (row) => Promise.all(klendCensus.activeZero
    .filter((provider) => provider.mint === row.yieldBearingMint)
    .map(prepareKlendProvider));
  const p0For = async (row) => Promise.all(p0VaultCensus.rows
    .filter((provider) => provider.kind === 'liquidity' && provider.mint === row.yieldBearingMint)
    .map(async (provider) => {
      try { return await prepareP0Provider(provider); }
      catch (error) { return {...provider, preparationBlocker: error.message}; }
    }));

  const [bulkKlend, bulkP0All, onycKlend, onycP0, rkuKlend, rkuP0,
    usdeKlend, usdeP0All, jupUsde] = await Promise.all([
    klendFor(bulkRow), p0For(bulkRow), klendFor(onycRow), p0For(onycRow),
    klendFor(rkuRow), p0For(rkuRow), klendFor(usdeRow), p0For(usdeRow),
    prepareJupUsdeProvider(),
  ]);
  const bulkP0 = bulkP0All.find((provider) => provider.exactZeroFee &&
    BigInt(provider.currentLiquidityRaw || 0) > 0n);
  const usdeP0 = usdeP0All.find((provider) => provider.exactZeroFee &&
    BigInt(provider.currentLiquidityRaw || 0) > 0n);
  if (!bulkP0 || !usdeP0 || onycKlend.length < 2 || !rkuKlend.length || usdeKlend.length < 2)
    throw new Error('Expected compatible current providers absent');
  for (const provider of [...bulkKlend, ...onycKlend, ...rkuKlend, ...usdeKlend])
    if (!provider.exactZeroFee) throw new Error(`Nonzero KLend fee ${provider.reserve}`);
  if (!jupUsde.exactZeroFee) throw new Error('Jupiter USDe flash fee is nonzero');

  const providerInventory = inventory.rows.map((row) => {
    const klend = klendCensus.activeZero.filter((provider) => provider.mint === row.yieldBearingMint);
    const p0 = p0VaultCensus.rows.filter((provider) => provider.kind === 'liquidity' &&
      provider.mint === row.yieldBearingMint);
    const jupiterNative = jupInventory.reserves.filter((provider) =>
      provider.mint === row.yieldBearingMint).map((provider) => ({symbol: provider.symbol,
      reserve: provider.reserve, vault: provider.vault}));
    return {symbol: row.symbol, meta: row.meta, mint: row.yieldBearingMint,
      markedUsd: row.markedUsd, klendExactZero: klend.map((provider) => ({
        reserve: provider.reserve, market: provider.market,
        snapshotAvailableRaw: provider.availableRaw, flashFeeSf: provider.flashFeeSf,
      })), project0: p0.map((provider) => ({bank: provider.bank, group: provider.group,
        vault: provider.address, snapshotVaultRaw: provider.rawAmount,
      })), jupiterNative};
  });

  const sourceInventory = {
    checkedProviderFamilies: [
      {family: 'KLend', independence: 'one reserve state/vault per listed reserve',
        feeCriterion: 'on-chain flash_loan_fee_sf equals zero'},
      {family: 'Project0/marginfi', independence: 'one bank/liquidity vault per listed bank',
        feeCriterion: 'protocol_origination_fee I80F48 raw equals zero'},
      {family: 'Jupiter native flash wrapper', independence:
        'wrapper bound to Jupiter Liquidity reserve; wrappers sharing the same reserve are deduplicated',
        feeCriterion: 'FlashloanAdmin.flashloan_fee integer bps equals zero'},
      {family: 'Save/Solend control set', independence: 'separate lending reserve',
        compatibility: 'retained live control is wrapped SOL, which does not match an XP principal mint'},
    ],
    selected: {
      BulkSOL: {klend: bulkKlend, project0: bulkP0All},
      ONyc: {klend: onycKlend, project0: onycP0},
      rkuSOL: {klend: rkuKlend, project0: rkuP0},
      USDe: {klend: usdeKlend, project0: usdeP0All, jupiterNative: jupUsde},
    },
    allXpMints: providerInventory,
  };

  const results = [];
  async function run(spec) {
    const row = await simulateCase(spec, runtime);
    results.push(row);
    process.stdout.write(`${JSON.stringify({name: row.name, err: row.err || row.rpcError || row.localError,
      sizeBytes: row.sizeBytes, addresses: row.addressCount, units: row.unitsConsumed,
      outsiderDeltas: row.outsiderDeltas, repaid: row.reconciliation?.everyProviderRepaid})}\n`);
    return row;
  }

  function standardSpec(name, row, allocations, providers, category, options = {}) {
    const context = targetContext(row, authority.publicKey);
    const total = allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountRaw), 0n);
    const klend = allocations.filter((item) => item.kind === 'klend').map((item) => ({
      provider: item.provider, amount: BigInt(item.amountRaw),
    }));
    const p0Allocation = allocations.find((item) => item.kind === 'project0');
    const jupAllocation = allocations.find((item) => item.kind === 'jupiter-native');
    const p0 = p0Allocation ? {provider: p0Allocation.provider,
      amount: BigInt(p0Allocation.amountRaw)} : null;
    const jup = jupAllocation ? {provider: jupAllocation.provider,
      amount: BigInt(jupAllocation.amountRaw)} : null;
    const actions = options.actions ? options.actions(context, total) :
      [context.mint(total), context.redeem(context.syForBase(total))];
    const instructions = assembleRoute({context, authority: authority.publicKey,
      marginfiAccount: marginfiAccount.publicKey, klend, p0, jup, actions,
      noOp: options.noOp || null, closeAccounts: !options.preserveAccounts});
    return {name, category, expectation: options.expectation ||
      'Every flash provider must be repaid and the outsider must finish without positive net assets.',
      targetSymbol: row.symbol, allocations: allocations.map((item) => ({kind: item.kind,
        id: item.kind === 'klend' ? item.provider.reserve :
          item.kind === 'project0' ? item.provider.bank : item.provider.reserve,
        amountRaw: String(item.amountRaw)})), instructions,
      watched: watchedFor(context, runtime, {klend: klend.map((item) => item.provider),
        p0: p0?.provider || null, jup: jup?.provider || null}, options.positionKey || null),
      hasP0: Boolean(p0), hasJup: Boolean(jup), storeWire: options.storeWire || false,
      encodeOptions: options.encodeOptions || {}, context,
      syntheticAbsent: [context.baseAta, context.syAta, marginfiAccount.publicKey]};
  }

  // BulkSOL: Project0 is the only compatible exact-zero provider. Prove both
  // the displayed-vault boundary and the smaller utilization-limited capacity.
  const bulkCapacity = BigInt(bulkP0.currentLiquidityRaw);
  for (const amount of [1n, 2n, bulkCapacity - 1n, bulkCapacity, bulkCapacity + 1n]) {
    await run(standardSpec(`signed_bulk_project0_boundary_${amount}`, bulkRow,
      [{kind: 'project0', provider: bulkP0, amountRaw: amount}],
      {p0: bulkP0}, 'signed-project0-boundary'));
  }
  let lower = 1n;
  let upper = bulkCapacity;
  let bulkP0Max = 0n;
  while (lower <= upper) {
    const amount = (lower + upper) / 2n;
    const row = await run(standardSpec(`signed_bulk_project0_binary_${amount}`, bulkRow,
      [{kind: 'project0', provider: bulkP0, amountRaw: amount}],
      {p0: bulkP0}, 'signed-project0-capacity-search'));
    if (!row.localError && !row.transportError && !row.rpcError && !row.err) {
      bulkP0Max = amount;
      lower = amount + 1n;
    } else upper = amount - 1n;
  }

  // Every plausible account/authority/share candidate is wrapped inside a
  // signed Project0 flash route. Capital cannot alter has_one/token-owner gates.
  const bulkContext = targetContext(bulkRow, authority.publicKey);
  const victim = P('FUFDpDezLofQM3kpbQm8j4yoBZ2ACKMMi5QzmDseCDM2');
  const positions = positionInstructions(bulkContext, authority.publicKey, victim);
  const otherRow = inventory.rows.find((row) => row.meta !== bulkRow.meta &&
    row.currentInterface === 'SplStakePool');
  const mutationAmount = 1_000_000n;
  const mutationSy = bulkContext.syForBase(mutationAmount);
  const mutationCases = [
    ['redeem_protocol_sy_escrow_as_outsider_source', (ctx) => [ctx.mint(mutationAmount),
      ctx.redeem(mutationSy, {sourceSy: P(bulkRow.tokenSyEscrow)})]],
    ['redeem_project0_vault_as_principal_vault', (ctx) => [ctx.mint(mutationAmount),
      ctx.redeem(mutationSy, {vault: P(bulkP0.address)})]],
    ['mint_project0_vault_as_principal_vault', (ctx) => [ctx.mint(mutationAmount,
      {vault: P(bulkP0.address)}), ctx.redeem(mutationSy)]],
    ['mint_protocol_principal_as_outsider_source', (ctx) => [ctx.mint(mutationAmount,
      {source: P(bulkRow.principalVaults[0].address)}), ctx.redeem(mutationSy)]],
    ['redeem_cross_meta_substitution', (ctx) => [ctx.mint(mutationAmount),
      ctx.redeem(mutationSy, {row: otherRow})]],
    ['redeem_destination_aliases_principal_vault', (ctx) => [ctx.mint(mutationAmount),
      ctx.redeem(mutationSy, {destination: P(bulkRow.principalVaults[0].address)})]],
    ['redeem_amount_exceeds_fresh_shares', (ctx) => [ctx.mint(mutationAmount),
      ctx.redeem(mutationSy + 1n)]],
    ['withdraw_largest_position_with_unrelated_signer', (ctx) => [ctx.mint(mutationAmount),
      positions.withdraw(1n), ctx.redeem(mutationSy)]],
    ['withdraw_zero_from_largest_position_with_unrelated_signer', (ctx) => [ctx.mint(mutationAmount),
      positions.withdraw(0n), ctx.redeem(mutationSy)]],
    ['deposit_then_unauthorized_withdraw_largest_position', (ctx) => [ctx.mint(mutationAmount),
      positions.deposit(1n), positions.withdraw(1n), ctx.redeem(mutationSy - 1n)]],
    ['deposit_one_to_foreign_position_is_gift_not_gain', (ctx) => [ctx.mint(mutationAmount),
      positions.deposit(1n), ctx.redeem(mutationSy - 1n)]],
    ['zero_deposit_inside_repaid_round_trip', (ctx) => [ctx.mint(mutationAmount),
      positions.deposit(0n), ctx.redeem(mutationSy)]],
  ];
  for (const [name, actions] of mutationCases) {
    await run(standardSpec(`signed_bulk_${name}`, bulkRow,
      [{kind: 'project0', provider: bulkP0, amountRaw: mutationAmount}], {p0: bulkP0},
      'signed-substitution-position-edge', {actions, positionKey: victim,
        expectation: 'Capital is present, but an authorization/account binding must still fail or the fully repaid route must have no outsider gain.'}));
  }

  // ONyc: independently test both zero-fee KLend reserves and then combine
  // them asymmetrically and at their maximum displayed route capacities.
  for (const provider of onycKlend) {
    const capacity = BigInt(provider.routeCapacityRaw);
    for (const amount of [1n, capacity - 1n, capacity, capacity + 1n]) {
      if (amount <= 0n) continue;
      await run(standardSpec(`signed_onyc_klend_${provider.reserve}_${amount}`, onycRow,
        [{kind: 'klend', provider, amountRaw: amount}], {klend: [provider]},
        'signed-klend-boundary'));
    }
  }
  const onycA = onycKlend[0];
  const onycB = onycKlend[1];
  const onycACap = BigInt(onycA.routeCapacityRaw);
  const onycBCap = BigInt(onycB.routeCapacityRaw);
  const onycControlProvider = onycB;
  await run(standardSpec('signed_onyc_tiny_paid_control_preserved_accounts', onycRow,
    [{kind: 'klend', provider: onycControlProvider, amountRaw: 2n}],
    {klend: [onycControlProvider]},
    'signed-current-outsider-control', {preserveAccounts: true,
      expectation: 'A fresh outsider must complete the paid mint/redeem round trip with zero token equity and exact lender repayment; the two canonical ATAs remain to make final balances observable.'}));
  const onycMutationAmount = 1_000n;
  const otherRateRow = inventory.rows.find((row) => row.meta !== onycRow.meta &&
    row.interfaceAccounts?.length && row.interfaceAccounts[0] !== onycRow.interfaceAccounts[0]);
  const onycMutationCases = [
    ['redeem_protocol_sy_escrow_as_outsider_source', (ctx) => [ctx.mint(onycMutationAmount),
      ctx.redeem(ctx.syForBase(onycMutationAmount), {sourceSy: P(onycRow.tokenSyEscrow)})]],
    ['mint_protocol_principal_as_outsider_source', (ctx) => [ctx.mint(onycMutationAmount,
      {source: P(onycRow.principalVaults[0].address)}),
      ctx.redeem(ctx.syForBase(onycMutationAmount))]],
    ['redeem_destination_aliases_principal_vault', (ctx) => [ctx.mint(onycMutationAmount),
      ctx.redeem(ctx.syForBase(onycMutationAmount),
        {destination: P(onycRow.principalVaults[0].address)})]],
    ['redeem_exceeds_fresh_shares', (ctx) => [ctx.mint(onycMutationAmount),
      ctx.redeem(ctx.syForBase(onycMutationAmount) + 1n)]],
  ];
  if (otherRateRow) onycMutationCases.push(['cross_meta_rate_input_substitution', (ctx) => {
    const wrongRateRow = {...onycRow, interfaceAccounts: otherRateRow.interfaceAccounts};
    return [ctx.mint(onycMutationAmount, {row: wrongRateRow}),
      ctx.redeem(ctx.syForBase(onycMutationAmount))];
  }]);
  for (const [name, actions] of onycMutationCases) {
    await run(standardSpec(`signed_onyc_${name}`, onycRow,
      [{kind: 'klend', provider: onycControlProvider, amountRaw: onycMutationAmount}],
      {klend: [onycControlProvider]},
      'signed-onyc-authorization-rate-edge', {actions,
        expectation: 'The substituted authority, custody, share, or rate input must fail, or a completed fully repaid route must have no outsider gain.'}));
  }
  for (const cycles of [2, 4]) {
    await run(standardSpec(`signed_onyc_${cycles}_rounding_cycles`, onycRow,
      [{kind: 'klend', provider: onycControlProvider, amountRaw: onycMutationAmount}],
      {klend: [onycControlProvider]},
      'signed-onyc-rounding-repetition', {actions: (ctx) => Array.from({length: cycles}, () =>
        [ctx.mint(onycMutationAmount), ctx.redeem(ctx.syForBase(onycMutationAmount))]).flat()}));
  }
  const onycCombinations = [
    ['a_max_b_one', onycACap, 1n],
    ['a_one_b_max', 1n, onycBCap],
    ['both_max_minus_one', onycACap - 1n, onycBCap - 1n],
    ['both_exact_displayed_max', onycACap, onycBCap],
    ['a_max_plus_one_b_max', onycACap + 1n, onycBCap],
  ];
  for (const [suffix, amountA, amountB] of onycCombinations) {
    await run(standardSpec(`signed_onyc_dual_klend_${suffix}`, onycRow, [
      {kind: 'klend', provider: onycA, amountRaw: amountA},
      {kind: 'klend', provider: onycB, amountRaw: amountB},
    ], {klend: [onycA, onycB]}, 'signed-dual-source'));
  }
  // Explicit repeat-borrow negative control on one reserve. This documents the
  // KLend per-reserve MultipleFlashBorrows constraint without treating the
  // lender error as target evidence.
  await run(standardSpec('signed_onyc_same_klend_reserve_twice', onycRow, [
    {kind: 'klend', provider: onycA, amountRaw: 1_000n},
    {kind: 'klend', provider: onycA, amountRaw: 1_000n},
  ], {klend: [onycA, onycA]}, 'signed-repeat-borrow-constraint'));

  if (process.env.XP1BR_TARGET_ONLY === 'ONyc') {
    const targetResults = results.filter((row) => row.name.includes('_onyc_'));
    const successes = targetResults.filter((row) => !row.localError && !row.transportError &&
      !row.rpcError && !row.err);
    const failures = targetResults.filter((row) => !successes.includes(row));
    const positive = successes.filter((row) => row.hasPositiveOutsiderGain);
    const output = {
      generatedAt: new Date().toISOString(),
      safety: 'Local current-mainnet-backed fork simulateTransaction only; every wire is locally signed and uses sigVerify=true; no mainnet send/broadcast. Only the fresh outsider system account was funded locally.',
      targetProgram: XP.toBase58(), targetSymbol: 'ONyc', forkEndpointClass: 'loopback-only',
      forkBaselineSlot: targetResults.find((row) => row.preSlot)?.preSlot || null,
      attacker: {publicKey: authority.publicKey.toBase58(), privateKeyPersisted: false,
        syntheticLamportsOnly: '100000000000'},
      sourceInventory: {selected: {ONyc: sourceInventory.selected.ONyc}},
      criteria: {findingRequires: 'successful signed outsider-accessible unauthorized net asset gain after fees, every flash repayment, share reconciliation, and unwind',
        signatureVerificationRequired: true, maxWireBytes: 4096, maxInlineAddresses: 64},
      summary: {cases: targetResults.length, succeeded: successes.length, failed: failures.length,
        maximumWireBytes: Math.max(...targetResults.map((row) => row.sizeBytes || 0)),
        maximumInlineAddresses: Math.max(...targetResults.map((row) => row.addressCount || 0)),
        successfulCasesWithPositiveOutsiderGain: positive.map((row) => row.name),
        validatedFindingCount: positive.length},
      results: targetResults,
    };
    fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({output: OUT, generatedAt: output.generatedAt,
      summary: output.summary}, null, 2)}\n`);
    return;
  }

  // rkuSOL: the KLend source is usable, while the only matching Project0 vault
  // is empty. Test KLend's exact live boundary; the empty P0 row is retained as
  // a concrete no-capital blocker in sourceInventory.
  const rkuProvider = rkuKlend[0];
  const rkuCapacity = BigInt(rkuProvider.routeCapacityRaw);
  for (const amount of [1n, rkuCapacity - 1n, rkuCapacity, rkuCapacity + 1n]) {
    await run(standardSpec(`signed_rkusol_klend_boundary_${amount}`, rkuRow,
      [{kind: 'klend', provider: rkuProvider, amountRaw: amount}],
      {klend: [rkuProvider]}, 'signed-klend-boundary'));
  }

  // USDe: KLend + Project0 + Jupiter native flash is a genuine three-program,
  // four-reserve composition. Establish each source's own usable boundary,
  // then maximize the jointly route-valid allocation without duplicating a
  // KLend reserve.
  for (const provider of usdeKlend) {
    const capacity = BigInt(provider.routeCapacityRaw);
    for (const amount of [1n, capacity - 1n, capacity, capacity + 1n]) {
      if (amount <= 0n) continue;
      await run(standardSpec(`signed_usde_klend_${provider.reserve}_${amount}`, usdeRow,
        [{kind: 'klend', provider, amountRaw: amount}], {klend: [provider]},
        'signed-klend-boundary'));
    }
  }
  const usdeP0Displayed = BigInt(usdeP0.currentLiquidityRaw);
  for (const amount of [1n, usdeP0Displayed - 1n, usdeP0Displayed, usdeP0Displayed + 1n]) {
    if (amount <= 0n) continue;
    await run(standardSpec(`signed_usde_project0_displayed_${amount}`, usdeRow,
      [{kind: 'project0', provider: usdeP0, amountRaw: amount}],
      {p0: usdeP0}, 'signed-project0-boundary'));
  }
  lower = 1n;
  upper = usdeP0Displayed;
  let usdeP0Max = 0n;
  while (lower <= upper) {
    const amount = (lower + upper) / 2n;
    const row = await run(standardSpec(`signed_usde_project0_binary_${amount}`, usdeRow,
      [{kind: 'project0', provider: usdeP0, amountRaw: amount}],
      {p0: usdeP0}, 'signed-project0-capacity-search'));
    if (!row.localError && !row.transportError && !row.rpcError && !row.err) {
      usdeP0Max = amount;
      lower = amount + 1n;
    } else upper = amount - 1n;
  }
  const jupCapacity = BigInt(jupUsde.routeCapacityRaw);
  for (const amount of [1n, jupCapacity - 1n, jupCapacity, jupCapacity + 1n]) {
    await run(standardSpec(`signed_usde_jupiter_boundary_${amount}`, usdeRow,
      [{kind: 'jupiter-native', provider: jupUsde, amountRaw: amount}],
      {jup: jupUsde}, 'signed-jupiter-boundary'));
  }

  const usdeLarge = usdeKlend[0];
  const usdeSmall = usdeKlend[1];
  const usdeLargeCap = BigInt(usdeLarge.routeCapacityRaw);
  const usdeSmallCap = BigInt(usdeSmall.routeCapacityRaw);
  const combinedCases = [
    ['tri_program_asymmetric_klend_max_p0_one_jup_one', usdeLargeCap, 0n, 1n, 1n],
    ['tri_program_asymmetric_klend_one_p0_max_jup_one', 1n, 0n, usdeP0Max, 1n],
    ['tri_program_asymmetric_klend_one_p0_one_jup_max', 1n, 0n, 1n, jupCapacity],
    ['max_sources_minus_one', usdeLargeCap - 1n, usdeSmallCap - 1n,
      usdeP0Max > 0n ? usdeP0Max - 1n : 0n, jupCapacity - 1n],
    ['max_sources_exact_route_cap', usdeLargeCap, usdeSmallCap, usdeP0Max, jupCapacity],
    ['max_sources_p0_plus_one', usdeLargeCap, usdeSmallCap, usdeP0Max + 1n, jupCapacity],
  ];
  for (const [suffix, large, small, p0Amount, jupAmount] of combinedCases) {
    const allocations = [];
    if (large > 0n) allocations.push({kind: 'klend', provider: usdeLarge, amountRaw: large});
    if (small > 0n) allocations.push({kind: 'klend', provider: usdeSmall, amountRaw: small});
    if (p0Amount > 0n) allocations.push({kind: 'project0', provider: usdeP0, amountRaw: p0Amount});
    if (jupAmount > 0n) allocations.push({kind: 'jupiter-native', provider: jupUsde,
      amountRaw: jupAmount});
    await run(standardSpec(`signed_usde_${suffix}`, usdeRow, allocations,
      {klend: [usdeLarge, usdeSmall], p0: usdeP0, jup: jupUsde},
      'signed-multi-provider', {storeWire: suffix === 'max_sources_exact_route_cap'}));
  }

  // Exact 4,096-byte, 64-address, signed composition using the proven BulkSOL
  // Project0 route. Dummy accounts are read-only no-op inputs; value movement
  // remains the fully repaid target route.
  const dummyCandidates = [...new Set([
    ...inventory.rows.flatMap((row) => [row.meta, row.mintSy, row.tokenSyEscrow,
      row.yieldBearingMint, ...(row.interfaceAccounts || []),
      ...row.principalVaults.map((vault) => vault.address)]),
    ...p0VaultCensus.rows.flatMap((row) => [row.address, row.bank, row.group, row.mint, row.authority]),
    ...klendCensus.activeZero.flatMap((row) => [row.reserve, row.market, row.supplyVault,
      row.feeVault, row.mint]),
  ].filter(Boolean))].map(P);
  const exactAmount = 1_000_000n;
  const exactAllocations = [{kind: 'project0', provider: bulkP0, amountRaw: exactAmount}];
  const dummyKeys = [];
  let exactSpec = null;
  for (const candidate of dummyCandidates) {
    dummyKeys.push({pubkey: candidate, isSigner: false, isWritable: false});
    const trialNoop = instruction(NOOP, dummyKeys, Buffer.alloc(0));
    const trial = standardSpec('trial', bulkRow, exactAllocations, {p0: bulkP0},
      'v1-boundary', {noOp: trialNoop, encodeOptions: {allowOverAccounts: true}});
    const encoded = encodeSignedV1(trial.instructions, authority.publicKey, blockhash,
      runtime.signers, {allowOverAccounts: true});
    if (encoded.accountKeys.length === 64) {
      const padding = 4096 - encoded.wire.length;
      if (padding < 0) throw new Error(`64-address signed v1 base exceeds limit: ${encoded.wire.length}`);
      const paddedNoop = instruction(NOOP, dummyKeys, Buffer.alloc(padding, 0x58));
      exactSpec = standardSpec('signed_xp1br_project0_v1_exact_4096_bytes_64_addresses',
        bulkRow, exactAllocations, {p0: bulkP0}, 'signed-v1-runtime-boundary',
        {noOp: paddedNoop, storeWire: true});
      const check = encodeSignedV1(exactSpec.instructions, authority.publicKey, blockhash,
        runtime.signers);
      if (check.wire.length !== 4096 || check.accountKeys.length !== 64)
        throw new Error(`Exact signed composition mismatch ${check.wire.length}/${check.accountKeys.length}`);
      break;
    }
    if (encoded.accountKeys.length > 64) break;
  }
  if (!exactSpec) throw new Error('Unable to build exact signed v1 boundary composition');
  const exactResult = await run(exactSpec);

  const successes = results.filter((row) => !row.localError && !row.transportError &&
    !row.rpcError && !row.err);
  const failures = results.filter((row) => !successes.includes(row));
  const positive = successes.filter((row) => row.hasPositiveOutsiderGain);
  const providerCapacity = {
    bulkProject0: {displayedVaultRaw: bulkP0.currentLiquidityRaw,
      maximumRouteValidRaw: bulkP0Max.toString(),
      firstAdjacentRejectedRaw: (bulkP0Max + 1n).toString()},
    usdeProject0: {displayedVaultRaw: usdeP0.currentLiquidityRaw,
      maximumRouteValidRaw: usdeP0Max.toString(),
      firstAdjacentRejectedRaw: (usdeP0Max + 1n).toString()},
    usdeJupiter: {capacityRaw: jupUsde.routeCapacityRaw},
  };
  const output = {
    generatedAt: new Date().toISOString(),
    safety: 'Local mainnet fork simulateTransaction only; every wire is locally signed and uses sigVerify=true; no mainnet send/broadcast. Only the fresh attacker system account was funded locally.',
    targetProgram: XP.toBase58(), forkEndpointClass: 'loopback-only',
    forkBaselineSlot: results.find((row) => row.preSlot)?.preSlot || null,
    attacker: {publicKey: authority.publicKey.toBase58(), privateKeyPersisted: false,
      syntheticLamportsOnly: '100000000000'},
    sources: {klend: {program: KLEND.toBase58(), signature: klendTemplates.sourceSignature,
      slot: klendTemplates.sourceSlot},
    project0: {program: PROJECT0.toBase58(), slot: p0Templates.sourceSlot,
      sourceWireSha256: p0Templates.wireSha256},
    jupiterNative: {flashProgram: JUP_FLASH.toBase58(),
      liquidityProgram: JUP_LIQUIDITY.toBase58(), flashAdmin: JUP_FLASH_ADMIN.toBase58()}},
    sourceInventory, providerCapacity,
    criteria: {findingRequires:
      'successful signed outsider-accessible unauthorized net asset gain after fees, every flash repayment, share reconciliation, and unwind',
    signatureVerificationRequired: true, maxWireBytes: 4096, maxInlineAddresses: 64,
    noRepeatedKlendReserveInMaximumSourceRoute: true},
    summary: {cases: results.length, succeeded: successes.length, failed: failures.length,
      exact4096: {err: exactResult.err, sizeBytes: exactResult.sizeBytes,
        addressCount: exactResult.addressCount, instructionCount: exactResult.instructionCount,
        signatureVerification: exactResult.signatureVerification,
        outsiderDeltas: exactResult.outsiderDeltas,
        everyProviderRepaid: exactResult.reconciliation?.everyProviderRepaid,
        wireSha256: exactResult.wireSha256},
      successfulCasesWithPositiveOutsiderGain: positive.map((row) => row.name),
      validatedFindingCount: positive.length},
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, generatedAt: output.generatedAt,
    providerCapacity, summary: output.summary}, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

