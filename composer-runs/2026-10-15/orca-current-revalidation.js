#!/usr/bin/env node

// Read-only current-mainnet harness. RPC methods are account/transaction reads and
// simulateTransaction only. This file intentionally contains no send method.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/spl-token');

const RUN_DIR = __dirname;
const STABLE_DIR = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/orca-current-revalidation';
const JSON_PATH = path.join(RUN_DIR, 'orca-current-revalidation.json');
const STABLE_JSON_PATH = path.join(STABLE_DIR, 'orca-current-revalidation.json');
const PROGRAM_BIN_PATH = path.join(STABLE_DIR, 'whirlpool-current.so');
const ENV_PATH = '/tmp/composer-helius-only.env';

const PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const POOL = new PublicKey('2TAgfogn8JRwwTnsGKUa6WUT5Xdv1iMEzfEDMor68X9C');
const POSITION = new PublicKey('44pSCDrY8Ka6j5qyA7HJdx9cgCEkepjj9N6atrXSv79e');
const POSITION_TOKEN = new PublicKey('AvTCVwfFPRqmdFHCipN3mwS6pXzaGb9ac21ycjyQmn5y');
const POSITION_AUTHORITY = new PublicKey('4i4rYMBihHVv4VwuGQmu2eu9FEPf5tqvHQFrbFpCwQP1');
const OWNER_B = new PublicKey('CrXdPjcgZgxzuiGoKNQAid4udzwUioJwGeXKTFWBubcq');
const TICK_LOWER = new PublicKey('FiQBpg47ZcHjqCj6m47GMpzhCsATihFZCjMXqmYAkN4X');
const TICK_UPPER = new PublicKey('dBqmnuE7DJ7Dn5vemuLhdCHptc1rZAeRDGG31N8PdZe');
// Fresh on-curve public key generated for this simulation only; no secret is
// retained or required because signature verification is disabled.
const ATTACKER = new PublicKey('GqH4VSvMynFWhQvTa5Jq2rspEKUvyHco8QzK8WY5SDXF');
const SOURCE_SIGNATURE = '3W8qvqX8UBs6iTCFcm1XyzZTuZAKaK2AYNZW2gvaFvxSTMkK7JQ79ngTxwmWU5v6j1qDaUZ9SCaMsj4RBELzejf8';

const DISC = {
  collectFees: Buffer.from('a498cf631eba13b6', 'hex'),
  collectProtocolFees: Buffer.from('1643176296b246dc', 'hex'),
  decreaseLiquidity: Buffer.from('a026d06f685b2c01', 'hex'),
  increaseLiquidityV2: Buffer.from([133, 29, 89, 223, 69, 238, 176, 10]),
  repositionLiquidityV2: Buffer.from('bfa9e00b83139efd', 'hex'),
  updateFeesAndRewards: Buffer.from('9ae6fa0decd14bdf', 'hex'),
};

function readEnv(file) {
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw || raw.trimStart().startsWith('#')) continue;
    const match = raw.match(/^([^=]+)=(.*)$/s);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1].trim()] = value;
  }
  return result;
}

const env = readEnv(ENV_PATH);
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('RPC_URL/HEAVY_RPC_URL missing');
let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function pk(data, offset) { return new PublicKey(data.subarray(offset, offset + 32)); }
function u64(data, offset) { return data.readBigUInt64LE(offset); }
function u128(data, offset) { return u64(data, offset) + (u64(data, offset + 8) << 64n); }
function i32(data, offset) { return data.readInt32LE(offset); }
function writeU64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function writeU128(value) { const b = Buffer.alloc(16); b.writeBigUInt64LE(BigInt(value) & ((1n << 64n) - 1n)); b.writeBigUInt64LE(BigInt(value) >> 64n, 8); return b; }
function writeI32(value) { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; }
function key(pubkey, isSigner = false, isWritable = false) { return {pubkey, isSigner, isWritable}; }
function ix(data, keys, programId = PROGRAM) { return new TransactionInstruction({programId, data, keys}); }

function parseToken(data) {
  if (!data || data.length < 165) return null;
  return {mint: pk(data, 0).toBase58(), authority: pk(data, 32).toBase58(), amount: u64(data, 64).toString()};
}
function parsePosition(data) {
  if (!data || data.length < 144) return null;
  return {
    whirlpool: pk(data, 8).toBase58(), positionMint: pk(data, 40).toBase58(),
    liquidity: u128(data, 72).toString(), tickLower: i32(data, 88), tickUpper: i32(data, 92),
    feeOwedA: u64(data, 112).toString(), feeOwedB: u64(data, 136).toString(),
  };
}
function parsePool(data) {
  return {
    config: pk(data, 8).toBase58(), bump: data[40], tickSpacing: data.readUInt16LE(41),
    feeTierIndexSeedHex: data.subarray(43, 45).toString('hex'), feeRate: data.readUInt16LE(45),
    protocolFeeRate: data.readUInt16LE(47), liquidity: u128(data, 49).toString(),
    sqrtPrice: u128(data, 65).toString(), tickCurrent: i32(data, 81),
    protocolFeeOwedA: u64(data, 85).toString(), protocolFeeOwedB: u64(data, 93).toString(),
    mintA: pk(data, 101).toBase58(), vaultA: pk(data, 133).toBase58(),
    mintB: pk(data, 181).toBase58(), vaultB: pk(data, 213).toBase58(),
  };
}
function accountSummary(address, info) {
  if (!info) return {address: address.toBase58(), exists: false};
  return {address: address.toBase58(), exists: true, owner: info.owner.toBase58(), executable: info.executable,
    lamports: String(info.lamports), dataLength: info.data.length, dataSha256: sha256(info.data)};
}

function collectFeesIx(c) {
  return ix(DISC.collectFees, [key(c.pool), key(c.authority, true), key(c.position, false, true), key(c.positionToken),
    key(c.ownerA, false, true), key(c.vaultA, false, true), key(c.ownerB, false, true), key(c.vaultB, false, true), key(TOKEN_PROGRAM_ID)]);
}
function updateIx(c) {
  return ix(DISC.updateFeesAndRewards, [key(c.pool, false, true), key(c.position, false, true), key(c.lower), key(c.upper)]);
}
function decreaseIx(c, liquidity) {
  return ix(Buffer.concat([DISC.decreaseLiquidity, writeU128(liquidity), writeU64(0), writeU64(0)]), [
    key(c.pool, false, true), key(TOKEN_PROGRAM_ID), key(c.authority, true), key(c.position, false, true), key(c.positionToken),
    key(c.ownerA, false, true), key(c.ownerB, false, true), key(c.vaultA, false, true), key(c.vaultB, false, true),
    key(c.lower, false, true), key(c.upper, false, true),
  ]);
}
function increaseV2Ix(c, liquidity) {
  const max = (1n << 64n) - 1n;
  return ix(Buffer.concat([DISC.increaseLiquidityV2, writeU128(liquidity), writeU64(max), writeU64(max), Buffer.from([0])]), [
    key(c.pool, false, true), key(TOKEN_PROGRAM_ID), key(TOKEN_PROGRAM_ID), key(MEMO_PROGRAM), key(c.authority, true),
    key(c.position, false, true), key(c.positionToken), key(c.mintA), key(c.mintB), key(c.ownerA, false, true),
    key(c.ownerB, false, true), key(c.vaultA, false, true), key(c.vaultB, false, true), key(c.lower, false, true), key(c.upper, false, true),
  ]);
}
function repositionV2Ix(c, newLower, newUpper, liquidity) {
  const max = (1n << 64n) - 1n;
  const data = Buffer.concat([DISC.repositionLiquidityV2, writeI32(newLower), writeI32(newUpper), Buffer.from([0]),
    writeU128(liquidity), writeU64(0), writeU64(0), writeU64(max), writeU64(max), Buffer.from([0])]);
  return ix(data, [key(c.pool, false, true), key(TOKEN_PROGRAM_ID), key(TOKEN_PROGRAM_ID), key(MEMO_PROGRAM),
    key(c.authority, true), key(c.funder, true, true), key(c.position, false, true), key(c.positionToken), key(c.mintA), key(c.mintB),
    key(c.ownerA, false, true), key(c.ownerB, false, true), key(c.vaultA, false, true), key(c.vaultB, false, true),
    key(c.lower, false, true), key(c.upper, false, true), key(c.newLowerArray, false, true), key(c.newUpperArray, false, true), key(SystemProgram.programId)]);
}
function collectProtocolIx(c) {
  return ix(DISC.collectProtocolFees, [key(c.config), key(c.pool, false, true), key(c.authority, true),
    key(c.vaultA, false, true), key(c.vaultB, false, true), key(c.ownerA, false, true), key(c.ownerB, false, true), key(TOKEN_PROGRAM_ID)]);
}

function returnedData(account) { return account?.data?.[0] ? Buffer.from(account.data[0], 'base64') : null; }
function relevantLogs(logs) {
  return (logs || []).filter(line => /Instruction:|insufficient|custom program error|failed|success|transfer|Liquidity|Constraint|Error/i.test(line)).slice(-40);
}

async function snapshot(connection, addresses) {
  const infos = await connection.getMultipleAccountsInfo(addresses, 'processed');
  return Object.fromEntries(addresses.map((address, i) => [address.toBase58(), infos[i]?.data ? Buffer.from(infos[i].data) : null]));
}
function summarizeAccount(address, before, after) {
  const stateAddress = address.equals(POSITION) || address.equals(POOL) || address.equals(TICK_LOWER) || address.equals(TICK_UPPER);
  const beforeToken = stateAddress ? null : parseToken(before); const afterToken = stateAddress ? null : parseToken(after);
  const beforePosition = address.equals(POSITION) ? parsePosition(before) : null;
  const afterPosition = address.equals(POSITION) ? parsePosition(after) : null;
  return {
    address: address.toBase58(),
    beforeExists: !!before, afterExists: !!after,
    beforeSha256: before ? sha256(before) : null, afterSha256: after ? sha256(after) : null,
    token: beforeToken || afterToken ? {before: beforeToken, after: afterToken,
      amountDelta: afterToken ? (BigInt(afterToken.amount) - BigInt(beforeToken?.amount || 0)).toString() : null} : null,
    position: beforePosition || afterPosition ? {before: beforePosition, after: afterPosition,
      liquidityDelta: beforePosition && afterPosition ? (BigInt(afterPosition.liquidity) - BigInt(beforePosition.liquidity)).toString() : null} : null,
  };
}

async function simulateCase(label, payer, instructions, tracked, before, extra = {}) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
  const blockhash = latest.value.blockhash;
  const message = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const wire = Buffer.from(transaction.serialize());
  const uniqueInline = message.staticAccountKeys.length;
  let result;
  try {
    result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify: false,
      replaceRecentBlockhash: true, commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: tracked.map(String)}}]);
  } catch (error) {
    return {label, harnessError: error.message, wireBytes: wire.length, messageBytes: Buffer.from(message.serialize()).length,
      inlineAccountCount: uniqueInline, signerCount: message.header.numRequiredSignatures, instructionCount: instructions.length, ...extra};
  }
  const accounts = tracked.map((address, i) => summarizeAccount(address, before[address.toBase58()] || null, returnedData(result.value.accounts?.[i])));
  return {label, err: result.value.err, unitsConsumed: result.value.unitsConsumed ?? null,
    wireBytes: wire.length, messageBytes: Buffer.from(message.serialize()).length, inlineAccountCount: uniqueInline,
    signerCount: message.header.numRequiredSignatures, instructionCount: instructions.length,
    accountKeys: message.staticAccountKeys.map(String), accounts, relevantLogs: relevantLogs(result.value.logs),
    innerInstructions: result.value.innerInstructions || null, returnData: result.value.returnData || null, ...extra};
}

async function getTransaction() {
  return rpc('getTransaction', [SOURCE_SIGNATURE, {encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0}]);
}

async function main() {
  fs.mkdirSync(STABLE_DIR, {recursive: true});
  const connection = new Connection(RPC_URL, 'processed');
  const observedAt = new Date().toISOString();
  const context = await rpc('getMultipleAccounts', [[PROGRAM.toBase58(), POOL.toBase58(), POSITION.toBase58(), POSITION_TOKEN.toBase58()],
    {encoding: 'base64', commitment: 'processed'}]);
  const programInfo = await connection.getAccountInfo(PROGRAM, 'processed');
  if (!programInfo || !programInfo.executable || !programInfo.owner.equals(UPGRADEABLE_LOADER)) throw new Error('current program account is not expected executable');
  if (programInfo.data.readUInt32LE(0) !== 2) throw new Error('loader Program state tag mismatch');
  const programDataAddress = pk(programInfo.data, 4);
  const programDataInfo = await connection.getAccountInfo(programDataAddress, 'processed');
  if (!programDataInfo || programDataInfo.data.readUInt32LE(0) !== 3) throw new Error('ProgramData state missing');
  const programBytes = programDataInfo.data.subarray(45);
  fs.writeFileSync(PROGRAM_BIN_PATH, programBytes);

  const poolInfo = await connection.getAccountInfo(POOL, 'processed');
  const positionInfo = await connection.getAccountInfo(POSITION, 'processed');
  const positionTokenInfo = await connection.getAccountInfo(POSITION_TOKEN, 'processed');
  if (!poolInfo || !positionInfo || !positionTokenInfo) throw new Error('control accounts unavailable');
  const pool = parsePool(poolInfo.data); const position = parsePosition(positionInfo.data); const positionToken = parseToken(positionTokenInfo.data);
  const config = new PublicKey(pool.config); const mintA = new PublicKey(pool.mintA); const mintB = new PublicKey(pool.mintB);
  const vaultA = new PublicKey(pool.vaultA); const vaultB = new PublicKey(pool.vaultB);
  const configInfo = await connection.getAccountInfo(config, 'processed');
  const mintAInfo = await connection.getAccountInfo(mintA, 'processed'); const mintBInfo = await connection.getAccountInfo(mintB, 'processed');
  const vaultAInfo = await connection.getAccountInfo(vaultA, 'processed'); const vaultBInfo = await connection.getAccountInfo(vaultB, 'processed');
  const protocolAuthority = pk(configInfo.data, 40);
  const ownerA = getAssociatedTokenAddressSync(mintA, POSITION_AUTHORITY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const attackerA = getAssociatedTokenAddressSync(mintA, ATTACKER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const attackerB = getAssociatedTokenAddressSync(mintB, ATTACKER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const protocolA = getAssociatedTokenAddressSync(mintA, protocolAuthority, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const protocolB = getAssociatedTokenAddressSync(mintB, protocolAuthority, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const [derivedPosition] = PublicKey.findProgramAddressSync([Buffer.from('position'), new PublicKey(position.positionMint).toBuffer()], PROGRAM);
  const [derivedPool] = PublicKey.findProgramAddressSync([Buffer.from('whirlpool'), config.toBuffer(), mintA.toBuffer(), mintB.toBuffer(), Buffer.from(pool.feeTierIndexSeedHex, 'hex')], PROGRAM);
  const tickArray = (start) => PublicKey.findProgramAddressSync([Buffer.from('tick_array'), POOL.toBuffer(), Buffer.from(String(start))], PROGRAM)[0];
  const tickArraySpan = 88 * pool.tickSpacing;
  const startFor = (tick) => Math.floor(tick / tickArraySpan) * tickArraySpan;
  const lowerStart = startFor(position.tickLower); const upperStart = startFor(position.tickUpper);
  const newTickLower = position.tickLower - pool.tickSpacing; const newTickUpper = position.tickUpper - pool.tickSpacing;
  const newLowerArray = tickArray(startFor(newTickLower)); const newUpperArray = tickArray(startFor(newTickUpper));

  const c = {pool: POOL, authority: POSITION_AUTHORITY, funder: POSITION_AUTHORITY, position: POSITION, positionToken: POSITION_TOKEN,
    ownerA, ownerB: OWNER_B, vaultA, vaultB, mintA, mintB, lower: TICK_LOWER, upper: TICK_UPPER, newLowerArray, newUpperArray};
  const tracked = [ownerA, OWNER_B, vaultA, vaultB, POSITION, POOL, TICK_LOWER, TICK_UPPER];
  const before = await snapshot(connection, tracked);
  const createOwnerA = createAssociatedTokenAccountIdempotentInstruction(POSITION_AUTHORITY, ownerA, POSITION_AUTHORITY, mintA, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createAttackerA = createAssociatedTokenAccountIdempotentInstruction(POSITION_AUTHORITY, attackerA, ATTACKER, mintA, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createAttackerB = createAssociatedTokenAccountIdempotentInstruction(POSITION_AUTHORITY, attackerB, ATTACKER, mintB, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const baseBudget = ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000});
  const liquidity = BigInt(position.liquidity); const onePercent = liquidity / 100n;
  const cases = [];

  cases.push(await simulateCase('positive: update and collect current position fees', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, updateIx(c), collectFeesIx(c)], tracked, before));
  cases.push(await simulateCase('positive: decrease one percent liquidity', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(c, onePercent)], tracked, before, {liquidityAmount: onePercent.toString()}));
  cases.push(await simulateCase('positive: reposition to adjacent range with one percent liquidity', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, repositionV2Ix(c, newTickLower, newTickUpper, onePercent)], tracked, before,
    {newTickLower, newTickUpper, newLiquidity: onePercent.toString()}));

  const protocolTracked = [protocolA, protocolB, vaultA, vaultB, POOL];
  const protocolBefore = await snapshot(connection, protocolTracked);
  const createProtocolA = createAssociatedTokenAccountIdempotentInstruction(POSITION_AUTHORITY, protocolA, protocolAuthority, mintA, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const createProtocolB = createAssociatedTokenAccountIdempotentInstruction(POSITION_AUTHORITY, protocolB, protocolAuthority, mintB, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const pc = {config, pool: POOL, authority: protocolAuthority, vaultA, vaultB, ownerA: protocolA, ownerB: protocolB};
  cases.push(await simulateCase('positive: collect protocol fees with configured authority', POSITION_AUTHORITY,
    [baseBudget, createProtocolA, createProtocolB, collectProtocolIx(pc)], protocolTracked, protocolBefore));

  const attackerTracked = [attackerA, attackerB, vaultA, vaultB, POSITION, POOL];
  const attackerBefore = await snapshot(connection, attackerTracked);
  const badAuthorityC = {...c, authority: ATTACKER, ownerA: attackerA, ownerB: attackerB};
  cases.push(await simulateCase('negative: unauthorized position authority and attacker destinations', POSITION_AUTHORITY,
    [baseBudget, createAttackerA, createAttackerB, decreaseIx(badAuthorityC, onePercent)], attackerTracked, attackerBefore));
  const badProtocol = {...pc, authority: ATTACKER, ownerA: attackerA, ownerB: attackerB};
  cases.push(await simulateCase('negative: unauthorized protocol authority and attacker destinations', POSITION_AUTHORITY,
    [baseBudget, createAttackerA, createAttackerB, collectProtocolIx(badProtocol)], attackerTracked, attackerBefore));
  const redirectedC = {...c, ownerA: attackerA, ownerB: attackerB};
  cases.push(await simulateCase('authorized behavior: signer redirects proceeds to same-mint attacker accounts', POSITION_AUTHORITY,
    [baseBudget, createAttackerA, createAttackerB, decreaseIx(redirectedC, onePercent)], attackerTracked, attackerBefore));
  const wrongMintC = {...c, ownerA: OWNER_B};
  cases.push(await simulateCase('negative: wrong-mint destination alias', POSITION_AUTHORITY,
    [baseBudget, decreaseIx(wrongMintC, onePercent)], tracked, before));
  const wrongVaultC = {...c, vaultA: vaultB};
  cases.push(await simulateCase('negative: vault substitution alias', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(wrongVaultC, onePercent)], tracked, before));
  const wrongTokenProgramIx = decreaseIx(c, onePercent); wrongTokenProgramIx.keys[1].pubkey = SystemProgram.programId;
  cases.push(await simulateCase('negative: CPI token program substitution', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, wrongTokenProgramIx], tracked, before));
  const wrongPositionTokenC = {...c, positionToken: POSITION};
  cases.push(await simulateCase('negative: position-token alias to position state', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(wrongPositionTokenC, onePercent)], tracked, before));
  cases.push(await simulateCase('order/replay: two authorized decreases in one transaction', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(c, onePercent), decreaseIx(c, onePercent)], tracked, before));
  cases.push(await simulateCase('atomicity: valid decrease then invalid authority', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(c, onePercent), decreaseIx(badAuthorityC, onePercent)], tracked, before));
  cases.push(await simulateCase('atomicity: invalid authority then valid decrease', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, decreaseIx(badAuthorityC, onePercent), decreaseIx(c, onePercent)], tracked, before));

  // Critical runtime probe: both user token sources are empty. If the Pinocchio
  // wrappers propagate CPI failure, this must fail. If not, state rises for free.
  cases.push(await simulateCase('critical probe: increase liquidity from empty correct-mint token accounts', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, increaseV2Ix(c, liquidity)], tracked, before, {liquidityAmount: liquidity.toString()}));
  // Only a simulation: pair the free increase with an equal decrease so the
  // post-state directly proves or disproves a net pool-vault extraction.
  cases.push(await simulateCase('critical atomic proof: empty-source increase then equal decrease', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, increaseV2Ix(c, liquidity), decreaseIx(c, liquidity)], tracked, before,
    {liquidityAmount: liquidity.toString(), repaymentRequired: false}));
  const wrongIncreaseProgram = increaseV2Ix(c, liquidity); wrongIncreaseProgram.keys[1].pubkey = SystemProgram.programId;
  cases.push(await simulateCase('negative: increase-v2 token program substitution', POSITION_AUTHORITY,
    [baseBudget, createOwnerA, wrongIncreaseProgram], tracked, before));

  const sourceTx = await getTransaction();
  const upgradeOption = programDataInfo.data.readUInt32LE(12);
  const upgradeAuthority = upgradeOption === 1 ? pk(programDataInfo.data, 13).toBase58() : null;
  const output = {
    schemaVersion: 1, observedAt, safety: {rpcMethods: ['getAccountInfo','getMultipleAccounts','getLatestBlockhash','getTransaction','simulateTransaction'],
      transactionSubmitted: false, teamContacted: false, signatureVerification: false},
    contextSlot: context.context.slot,
    program: {...accountSummary(PROGRAM, programInfo), programData: accountSummary(programDataAddress, programDataInfo),
      programDataAddress: programDataAddress.toBase58(), deploySlot: u64(programDataInfo.data, 4).toString(), upgradeAuthority,
      fullProgramDataSha256: sha256(programDataInfo.data), executableSha256: sha256(programBytes), executableBytes: programBytes.length,
      dumpedExecutablePath: PROGRAM_BIN_PATH},
    sourceControl: {signature: SOURCE_SIGNATURE, slot: sourceTx?.slot ?? null, err: sourceTx?.meta?.err ?? null,
      blockTime: sourceTx?.blockTime ?? null, unitsConsumed: sourceTx?.meta?.computeUnitsConsumed ?? null},
    bindings: {
      pool: {...accountSummary(POOL, poolInfo), parsed: pool, derivedPda: derivedPool.toBase58(), pdaMatches: derivedPool.equals(POOL)},
      position: {...accountSummary(POSITION, positionInfo), parsed: position, derivedPda: derivedPosition.toBase58(), pdaMatches: derivedPosition.equals(POSITION)},
      positionToken: {...accountSummary(POSITION_TOKEN, positionTokenInfo), parsed: positionToken,
        mintMatches: positionToken.mint === position.positionMint, authorityMatches: positionToken.authority === POSITION_AUTHORITY.toBase58(), amountIsOne: positionToken.amount === '1'},
      config: {...accountSummary(config, configInfo), collectProtocolFeesAuthority: protocolAuthority.toBase58()},
      mintA: accountSummary(mintA, mintAInfo), mintB: accountSummary(mintB, mintBInfo),
      vaultA: {...accountSummary(vaultA, vaultAInfo), parsed: parseToken(vaultAInfo.data), mintMatches: parseToken(vaultAInfo.data).mint === mintA.toBase58(), authorityMatchesPool: parseToken(vaultAInfo.data).authority === POOL.toBase58()},
      vaultB: {...accountSummary(vaultB, vaultBInfo), parsed: parseToken(vaultBInfo.data), mintMatches: parseToken(vaultBInfo.data).mint === mintB.toBase58(), authorityMatchesPool: parseToken(vaultBInfo.data).authority === POOL.toBase58()},
      ticks: {lower: TICK_LOWER.toBase58(), upper: TICK_UPPER.toBase58(), lowerStart, upperStart,
        derivedLower: tickArray(lowerStart).toBase58(), derivedUpper: tickArray(upperStart).toBase58(),
        lowerMatches: tickArray(lowerStart).equals(TICK_LOWER), upperMatches: tickArray(upperStart).equals(TICK_UPPER)},
      ownerAccounts: {ownerA: ownerA.toBase58(), ownerB: OWNER_B.toBase58(), ownerAExists: !!before[ownerA.toBase58()],
        ownerBBefore: parseToken(before[OWNER_B.toBase58()])},
    },
    custodyContext: {historicalQueuePricedGrossUsdLowerBound: 259110000,
      historicalQueueCoverage: '200 authority-verified vaults in 100-pool sample; 5 nonzero vaults unpriced',
      derivationStatus: 'retained aggregate only; raw per-vault pricing derivation absent',
      currentControlPoolVaultRawAmounts: {vaultA: parseToken(vaultAInfo.data).amount, vaultB: parseToken(vaultBInfo.data).amount}},
    cases,
  };
  fs.writeFileSync(JSON_PATH, JSON.stringify(output, null, 2) + '\n');
  fs.writeFileSync(STABLE_JSON_PATH, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({jsonPath: JSON_PATH, stableJsonPath: STABLE_JSON_PATH,
    programHash: output.program.executableSha256, cases: cases.map(x => ({label: x.label, err: x.err, harnessError: x.harnessError,
      units: x.unitsConsumed, wireBytes: x.wireBytes, deltas: x.accounts?.filter(a => a.token?.amountDelta && a.token.amountDelta !== '0').map(a => [a.address, a.token.amountDelta]),
      liquidityDelta: x.accounts?.find(a => a.address === POSITION.toBase58())?.position?.liquidityDelta}))}, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
