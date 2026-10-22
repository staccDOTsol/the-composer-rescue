#!/usr/bin/env node
'use strict';

// Defensive, local-fork-only signed Solana v1 simulations. This harness has no
// sendTransaction path. All synthetic balances and accounts are written only
// to the disposable Surfpool fork; every tested transaction uses sigVerify:true.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {
  Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
} = require(path.join(MODULES, '@solana', 'web3.js'));
const spl = require(path.join(MODULES, '@solana', 'spl-token'));
const anchor = require(path.join(MODULES, '@coral-xyz', 'anchor'));
const bs58Module = require(path.join(MODULES, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const RPC = process.env.USDU_LOCAL_RPC || 'http://127.0.0.1:9017';
const OUT = path.join(__dirname, 'local-fork-flash-envelope-matrix.json');
const IDL = JSON.parse(fs.readFileSync(path.join(__dirname, 'unitas-idl-source', 'vault', 'vault.json'), 'utf8'));
const MARGINFI_IDL = JSON.parse(fs.readFileSync(path.join(ROOT, 'marginfi-source', 'fuzz', 'crucible', 'idls', 'marginfi_program.json'), 'utf8'));
const JUP_IDL = JSON.parse(fs.readFileSync(path.join(ROOT, 'jup6qf-onchain-idl.json'), 'utf8'));
const KLEND_CENSUS = JSON.parse(fs.readFileSync(path.join(ROOT, 'klend-zero-fee-census.json'), 'utf8'));
const KLEND_HISTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'kamino-flash-history.json'), 'utf8'));
const JUP_INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'jup6qf-current-inventory.json'), 'utf8'));

const P = (value) => new PublicKey(value);
const IDS = {
  vaultProgram: P('VALT7AM76ZWfRhjVeYQRrLvNRLvqBzNs8dTsAcLW3jj'),
  guardianProgram: P('GRAD6oot2mhagh3UmoqCmLkiW3G2cFS5bh9x6VbYEZxW'),
  susduProgram: P('SUSD2TSk8DJodCkPviKb2okzbeQ597kCBjLVjq3G7pp'),
  vaultConfig: P('ENcCimzGPU6dNih1qnsSShTYBu9rRERnF4Wwx7BVVt7h'),
  vaultState: P('Fx6AsfJ5GGzUyYgNAaGehG1PSQTG1e7qNwSCJ8vXJ9SX'),
  vaultSusdu: P('7ngbTXfv6ey9N6AprMSjJ4X8ifZepWo7fXsrpsUhK3NS'),
  stakePool: P('CFgrWjb9DYKVqf7QyQfmwjboDDkXpFHQ6292rnYxrjsa'),
  silo: P('xyLZUzaaFdn9tuoBAM7qLNEh5HFkTyjXFoSqoC4WBwb'),
  accessRegistry: P('8maav1g7bK1vRamXzADLUu3DQ7VmXxjVTJt9PbBuWcpd'),
  susduMinter: P('6ZY9KMGD9UjTX4tWGcw4Y4UHh14nzNmiEr92wTieYub5'),
  susduRedeemer: P('7G68qMXkCh2uMq1NrTT6uX1fzphQoBPYpPBeLbN2B9SP'),
  usdu: P('9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy'),
  susdu: P('9iq5Q33RSiz1WcupHAQKbHBZkpn92UxBG2HfPWAZhMCa'),
  susduConfig: P('DyiptL8AUJjxqphpkWAcVbFrA53EawpyaJ1VzDi8YoLc'),
  victimSusduAta: P('2myre5bewT7fAFp7NBRRBcaEeKV6fGFhGcx61Aknyu1s'),
  victimCooldown: P('FgeJ4vL828wDVa2StPsUer6twkhxYR8f7JxSFAR3Z4y1'),
  targetPool: P('94BpFoyri4uTT55NFSHKYNFyUMtoWXEisMA4LK7nTKPU'),
  targetVaultUsdu: P('AHmaeuE4mgKQaUmXgojZCTe6nvZD5cvf8qPNBdXFoTXa'),
  targetVaultUsdc: P('8fKsYGEwAJA1kZHCFbZKsondsiw23dceLLdgiwTgaPmd'),
  usdgPool: P('9RqDTfwCx2SgxsvKpspQHc38HUo3B6hRd3oR9JR966Ps'),
  usdgPoolVault: P('6j9UtMmzmWuLu45XXmdUXN3NJBdiicxxoBEex8jUs3j6'),
  usdcPoolVault: P('5Sokmb48nt8aH8TnnkrAcVea4SdRqGU3qTxhRFvTHJyn'),
  klend: P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
  p0: P('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'),
  save: P('So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'),
  jupFlash: P('jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF'),
  jupLiquidity: P('jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS'),
  orca: P('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'),
  usdc: P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  usdg: P('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'),
  pyusd: P('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'),
  token: spl.TOKEN_PROGRAM_ID,
  token2022: spl.TOKEN_2022_PROGRAM_ID,
  ata: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
  system: SystemProgram.programId,
  instructions: P('Sysvar1nstructions1111111111111111111111111'),
  memo: P('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
};

const SOURCE_P0 = '2b8NLAe4HL5JsdwPRM4CUaeBRVRWLbWQp2pzgWjBLigE8sgpCX541aQKkd5qg9jrhhXaPh8bLd95r2tFNpZCF2yG';
const SOURCE_SAVE = '2qayMSpGb2jDgx4ovSEYSNkpY3nVH622kJ6rTNyWSMBeoTFXPLpWKdNnHoAQ3sK9KrjfaKQMLkNTmvbRLHX5CHtA';
const JUP_FLASH_ADMIN = PublicKey.findProgramAddressSync([Buffer.from('flashloan_admin')], IDS.jupFlash)[0];
const JUP_BORROW = Buffer.from([103, 19, 78, 24, 240, 9, 135, 63]);
const JUP_REPAY = Buffer.from([213, 47, 153, 137, 84, 243, 94, 232]);
const JUP_REFRESH = Buffer.from([239, 244, 10, 248, 116, 25, 53, 150]);
const MIN_SQRT = 4295048016n;
const MAX_SQRT = 79226673515401279992447579055n;
const marginfiCoder = new anchor.BorshAccountsCoder(MARGINFI_IDL);
const jupCoder = new anchor.BorshAccountsCoder(JUP_IDL);

let rpcId = 0;
async function rpc(method, params) {
  const retryLimit = method === 'simulateTransaction' || method === 'getTransaction' ? 12 : 4;
  for (let attempt = 0; attempt < retryLimit; attempt += 1) {
    const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
    const body = await response.json();
    if (response.ok && !body.error) return body.result;
    const detail = JSON.stringify(body.error || response.status);
    const transient = /429 Too Many Requests|Failed to fetch accounts from remote|timed out|temporarily unavailable/i.test(detail);
    if (!transient || attempt + 1 === retryLimit) throw new Error(`${method}: ${detail}`);
    const delayMs = Math.min(2_000 + attempt * 1_000, 10_000);
    process.stdout.write(`${JSON.stringify({transportRetry: method, attempt: attempt + 1,
      delayMs, reason: 'local fork upstream rate limit'})}\n`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${method}: retry loop exhausted`);
}

const u64 = (value) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const u128 = (value) => { const out = Buffer.alloc(16); const n = BigInt(value);
  out.writeBigUInt64LE(n & ((1n << 64n) - 1n)); out.writeBigUInt64LE(n >> 64n, 8); return out; };
const disc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const key = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const clone = (ix) => new TransactionInstruction({programId: ix.programId,
  keys: ix.keys.map((item) => ({...item})), data: Buffer.from(ix.data)});

function pda(program, ...seeds) {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.isBuffer(seed) ? seed : seed.toBuffer()), program)[0];
}

function historyIx(tx, index) {
  const msg = tx.transaction.message;
  const keys = [...msg.accountKeys, ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || [])];
  const h = msg.header;
  const staticCount = msg.accountKeys.length;
  const writable = (i) => i < staticCount
    ? (i < h.numRequiredSignatures
      ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : i < staticCount - h.numReadonlyUnsignedAccounts)
    : i < staticCount + (tx.meta.loadedAddresses?.writable || []).length;
  const item = msg.instructions[index];
  return new TransactionInstruction({programId: P(keys[item.programIdIndex]),
    keys: item.accounts.map((i) => ({pubkey: P(keys[i]), isSigner: i < h.numRequiredSignatures,
      isWritable: writable(i)})), data: Buffer.from(bs58.decode(item.data))});
}

function findHistoryIx(tx, program, predicate) {
  for (let i = 0; i < tx.transaction.message.instructions.length; i += 1) {
    const ix = historyIx(tx, i);
    if (ix.programId.equals(program) && predicate(ix.data)) return ix;
  }
  throw new Error(`Historical instruction unavailable for ${program}`);
}

function vaultInstruction(name, accounts, args = []) {
  const definition = IDL.instructions.find((entry) => entry.name === name);
  if (!definition) throw new Error(`Missing vault IDL instruction ${name}`);
  return new TransactionInstruction({programId: IDS.vaultProgram,
    keys: definition.accounts.map((account) => {
      const pubkey = accounts[account.name];
      if (!pubkey) throw new Error(`${name}: missing ${account.name}`);
      return key(pubkey, !!account.signer, !!account.writable);
    }), data: Buffer.concat([Buffer.from(definition.discriminator), ...args])});
}

function roleSeed(name) { const out = Buffer.alloc(32); out.write(name); return out; }

function stakeAccounts(attacker, usduAta, susduAta) {
  return {caller: attacker, receiver: attacker, receiver_susdu_token_account: susduAta,
    caller_usdu_token_account: usduAta, access_registry: IDS.accessRegistry,
    vault_stake_pool_usdu_token_account: IDS.stakePool, susdu_minter: IDS.susduMinter,
    usdu_token: IDS.usdu, susdu_token: IDS.susdu, vault_state: IDS.vaultState,
    vault_config: IDS.vaultConfig, susdu_config: IDS.susduConfig, susdu_program: IDS.susduProgram,
    usdu_token_program: IDS.token2022, susdu_token_program: IDS.token2022,
    associated_token_program: IDS.ata, system_program: IDS.system};
}

function unstakeAccounts(attacker, susduAta, cooldown) {
  return {caller: attacker, caller_susdu_token_account: susduAta, susdu_config: IDS.susduConfig,
    vault_config: IDS.vaultConfig, vault_state: IDS.vaultState,
    vault_susdu_token_account: IDS.vaultSusdu, cooldown, access_registry: IDS.accessRegistry,
    susdu_redeemer: IDS.susduRedeemer, susdu_token: IDS.susdu, usdu_token: IDS.usdu,
    vault_stake_pool_usdu_token_account: IDS.stakePool,
    vault_silo_usdu_token_account: IDS.silo, susdu_program: IDS.susduProgram,
    usdu_token_program: IDS.token2022, susdu_token_program: IDS.token2022,
    associated_token_program: IDS.ata, system_program: IDS.system};
}

function withdrawAccounts(attacker, usduAta, cooldown) {
  return {caller: attacker, receiver: attacker, vault_config: IDS.vaultConfig,
    vault_state: IDS.vaultState, receiver_usdu_token_account: usduAta,
    vault_silo_usdu_token_account: IDS.silo, cooldown, usdu_token: IDS.usdu,
    usdu_token_program: IDS.token2022, associated_token_program: IDS.ata,
    system_program: IDS.system};
}

function accountBytes(row) { return row?.data?.[0] ? Buffer.from(row.data[0], 'base64') : null; }
function tokenAmount(row) {
  const data = accountBytes(row);
  return row && [IDS.token.toBase58(), IDS.token2022.toBase58()].includes(row.owner) && data?.length >= 72
    ? data.readBigUInt64LE(64) : null;
}
function image(row) {
  if (!row) return null;
  const data = accountBytes(row);
  const amount = tokenAmount(row);
  return {owner: row.owner, lamports: String(row.lamports), dataLength: data?.length || 0,
    sha256: data ? hash(data) : null, rawAmount: amount?.toString() || null,
    mint: amount !== null ? new PublicKey(data.subarray(0, 32)).toBase58() : null,
    authority: amount !== null ? new PublicKey(data.subarray(32, 64)).toBase58() : null};
}

async function getAccounts(addresses) {
  return rpc('getMultipleAccounts', [addresses.map(String), {encoding: 'base64', commitment: 'processed'}]);
}

async function setSystem(address, lamports = 20_000_000_000) {
  await rpc('surfnet_setAccount', [String(address), {data: '', executable: false, lamports,
    owner: IDS.system.toBase58(), rentEpoch: 0}]);
}

async function setTokenAccount(address, templateRow, mint, authority, amount) {
  const source = accountBytes(templateRow);
  if (!source || source.length < 165) throw new Error(`Invalid token template for ${address}`);
  const data = Buffer.from(source);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data.writeUInt32LE(0, 72); data.fill(0, 76, 108); data[108] = 1;
  data.writeUInt32LE(0, 109); data.fill(0, 113, 129);
  data.writeUInt32LE(0, 129); data.fill(0, 133, 165);
  await rpc('surfnet_setAccount', [String(address), {data: data.toString('hex'), executable: false,
    lamports: templateRow.lamports, owner: templateRow.owner, rentEpoch: 0}]);
}

function signEncoded(encoded, signers) {
  const count = encoded.requiredSignatures;
  const compiled = new TransactionMessage({payerKey: encoded.payer,
    recentBlockhash: encoded.blockhash, instructions: encoded.instructions}).compileToV0Message();
  const order = compiled.staticAccountKeys.slice(0, count).map(String);
  const signerMap = new Map(signers.map((signer) => [String(signer.publicKey), signer]));
  const signed = Buffer.from(encoded.wire);
  const message = signed.subarray(0, signed.length - 64 * count);
  for (let i = 0; i < count; i += 1) {
    const signer = signerMap.get(order[i]);
    if (!signer) throw new Error(`Uncontrolled signer ${order[i]}`);
    const privateKey = crypto.createPrivateKey({key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(signer.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8'});
    crypto.sign(null, message, privateKey).copy(signed, message.length + i * 64);
  }
  return {signed, order};
}

// Encode the documented no-ALT v1 message directly. Keeping this implementation
// in the harness avoids importing an older replay script whose top-level fixture
// reads depend on the caller's current working directory.
function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000,
  dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (v0.addressTableLookups.length) throw new Error('v1 has no ALTs');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64)
    throw new Error(`Current v1 address/instruction limit: ${keys.length} accounts, ${items.length} instructions`);
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
  const wire = Buffer.concat([
    Buffer.from([0x81, v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts, v0.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((item) => item.toBuffer()), config, ...heads, ...payloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit: ${wire.length}`);
  return {wire, sizeBytes: wire.length, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: v0.header.numRequiredSignatures};
}

function composeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const compiled = new TransactionMessage({payerKey: payer, recentBlockhash: blockhash, instructions}).compileToV0Message();
  const accountCount = compiled.staticAccountKeys.length;
  const instructionCount = compiled.compiledInstructions.length;
  let encoded;
  try { encoded = encodeV1(instructions, payer, blockhash, computeLimit, dataLimit); }
  catch (error) {
    const metrics = {accountCount, instructionCount, error: error.message};
    error.metrics = metrics;
    throw error;
  }
  return {...encoded, payer, blockhash, instructions, accountCount, instructionCount};
}

function interestingLogs(logs) {
  return (logs || []).filter((line) => /Instruction:|AnchorError|Error Code|Error Message|failed|success|borrow|repay|flash/i.test(line)).slice(-100);
}

async function simulate(label, instructions, payer, signers, watched, metadata = {}) {
  const before = await getAccounts(watched);
  let encoded;
  let signed;
  let response;
  for (let blockhashAttempt = 0; blockhashAttempt < 4; blockhashAttempt += 1) {
    const latest = await rpc('getLatestBlockhash', [{commitment: 'processed'}]);
    try { encoded = composeV1(instructions, payer, latest.value.blockhash); }
    catch (error) {
      const result = {label, ...metadata, compositionError: error.message,
        compositionMetrics: error.metrics || null};
      process.stdout.write(`${JSON.stringify({label, compositionError: result.compositionError,
        compositionMetrics: result.compositionMetrics})}\n`);
      return result;
    }
    signed = signEncoded(encoded, signers);
    response = await rpc('simulateTransaction', [signed.signed.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'processed', innerInstructions: true,
      accounts: {encoding: 'base64', addresses: watched.map(String)},
    }]);
    if (response.value.err !== 'BlockhashNotFound') break;
    process.stdout.write(`${JSON.stringify({label, blockhashRetry: blockhashAttempt + 1})}\n`);
  }
  if (response.value.err === 'BlockhashNotFound')
    throw new Error(`${label}: repeated BlockhashNotFound after re-signing`);
  const after = response.value.accounts || [];
  const result = {label, ...metadata, forkSlot: response.context.slot,
    transactionVersion: 1, sigVerify: true, liveSend: false,
    wireBytes: signed.signed.length, accountCount: encoded.accountCount,
    instructionCount: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    signerOrder: signed.order, wireSha256: hash(signed.signed), computeLimit: 1_400_000,
    err: response.value.err, unitsConsumed: response.value.unitsConsumed,
    loadedAccountsDataSize: response.value.loadedAccountsDataSize,
    watched: watched.map(String), before: before.value.map(image), after: after.map(image),
    deltas: watched.map((address, index) => ({address: String(address),
      rawAmount: before.value[index] && after[index] && tokenAmount(before.value[index]) !== null && tokenAmount(after[index]) !== null
        ? (tokenAmount(after[index]) - tokenAmount(before.value[index])).toString() : null,
      lamports: before.value[index] && after[index]
        ? String(BigInt(after[index].lamports) - BigInt(before.value[index].lamports)) : null})),
    logs: response.value.logs || [], logsOfInterest: interestingLogs(response.value.logs),
    innerInstructions: response.value.innerInstructions || []};
  process.stdout.write(`${JSON.stringify({label, err: result.err, bytes: result.wireBytes,
    accounts: result.accountCount, instructions: result.instructionCount,
    signers: result.requiredSignatures, cu: result.unitsConsumed,
    deltas: result.deltas.filter((row) => row.rawAmount && row.rawAmount !== '0')})}\n`);
  return result;
}

function fixedRaw(wrapped) {
  const bytes = Buffer.from(wrapped.value);
  let value = BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
  if (bytes[15] & 0x80) value -= 1n << 128n;
  return value;
}

function decodeBank(row) {
  const bank = marginfiCoder.decode('Bank', accountBytes(row));
  return {mint: String(bank.mint), assetShares: fixedRaw(bank.total_asset_shares).toString(),
    liabilityShares: fixedRaw(bank.total_liability_shares).toString(),
    assetShareValue: fixedRaw(bank.asset_share_value).toString(),
    liabilityShareValue: fixedRaw(bank.liability_share_value).toString()};
}

function decodeJupReserve(row) {
  const reserve = jupCoder.decode('TokenReserve', accountBytes(row));
  return {mint: String(reserve.mint), totalSupplyWithInterest: BigInt(reserve.total_supply_with_interest.toString()),
    totalSupplyInterestFree: BigInt(reserve.total_supply_interest_free.toString()),
    totalBorrowWithInterest: BigInt(reserve.total_borrow_with_interest.toString()),
    totalBorrowInterestFree: BigInt(reserve.total_borrow_interest_free.toString()),
    totalClaim: BigInt(reserve.total_claim_amount.toString()),
    supplyExchangePrice: BigInt(reserve.supply_exchange_price.toString()),
    borrowExchangePrice: BigInt(reserve.borrow_exchange_price.toString()),
    maxUtilization: BigInt(reserve.max_utilization.toString())};
}

function jupAccountingAvailable(reserve) {
  const scale = 1_000_000_000_000n;
  const supply = reserve.totalSupplyWithInterest * reserve.supplyExchangePrice / scale
    + reserve.totalSupplyInterestFree;
  const borrow = reserve.totalBorrowWithInterest * reserve.borrowExchangePrice / scale
    + reserve.totalBorrowInterestFree;
  return supply - borrow - reserve.totalClaim;
}

function orcaPoolState(row) {
  const data = accountBytes(row);
  const read128 = (offset) => data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
  return {tickSpacing: data.readUInt16LE(41), feeRate: data.readUInt16LE(45),
    liquidity: read128(49), sqrtPrice: read128(65), tick: data.readInt32LE(81),
    mintA: new PublicKey(data.subarray(101, 133)), vaultA: new PublicKey(data.subarray(133, 165)),
    mintB: new PublicKey(data.subarray(181, 213)), vaultB: new PublicKey(data.subarray(213, 245))};
}

function tickArray(pool, tickSpacing, start) {
  return pda(IDS.orca, Buffer.from('tick_array'), pool, Buffer.from(String(start)));
}

function orcaSwap({pool, state, authority, ownerA, ownerB, amount, aToB, tokenProgramA, tokenProgramB}) {
  const span = 88 * state.tickSpacing;
  const currentStart = Math.floor(state.tick / span) * span;
  const starts = aToB ? [currentStart, currentStart - span, currentStart - 2 * span]
    : [currentStart, currentStart + span, currentStart + 2 * span];
  const data = Buffer.concat([disc('swap_v2'), u64(amount), u64(0n),
    u128(aToB ? MIN_SQRT : MAX_SQRT), Buffer.from([1, aToB ? 1 : 0, 0])]);
  return new TransactionInstruction({programId: IDS.orca, data, keys: [
    key(tokenProgramA), key(tokenProgramB), key(IDS.memo), key(authority, true),
    key(pool, false, true), key(state.mintA), key(state.mintB),
    key(ownerA, false, true), key(state.vaultA, false, true),
    key(ownerB, false, true), key(state.vaultB, false, true),
    ...starts.map((start) => key(tickArray(pool, state.tickSpacing, start), false, true)),
    key(pda(IDS.orca, Buffer.from('oracle'), pool), false, true),
  ]});
}

function klendBuilder(attacker, attackerUsdc) {
  const reserve = KLEND_CENSUS.activeZero.find((row) => row.reserve === 'AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z');
  if (!reserve || reserve.flashFeeSf !== '0' || reserve.mint !== String(IDS.usdc))
    throw new Error('Current exact-zero KLend USDC fixture unavailable');
  const source = KLEND_HISTORY.hits[0].transaction;
  const borrowTemplate = historyIx(source, 3);
  const repayTemplate = historyIx(source, 13);
  const market = P(reserve.market);
  const lma = pda(IDS.klend, Buffer.from('lma'), market);
  const build = (template, amount) => {
    const ix = clone(template);
    const replacements = {0: attacker, 1: lma, 2: market, 3: P(reserve.reserve),
      4: IDS.usdc, 5: P(reserve.supplyVault), 6: attackerUsdc,
      7: P(reserve.feeVault), 11: IDS.token};
    for (const [index, pubkey] of Object.entries(replacements)) ix.keys[Number(index)].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 8);
    return ix;
  };
  return {reserve, borrow: (amount) => build(borrowTemplate, amount),
    repay: (amount, borrowIndex) => { const ix = build(repayTemplate, amount); ix.data[16] = borrowIndex; return ix; }};
}

async function p0Builder(attacker, marginfiAccount, attackerUsdc) {
  const source = await rpc('getTransaction', [SOURCE_P0,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  if (!source) throw new Error('Project0 source unavailable');
  const start = clone(findHistoryIx(source, IDS.p0, (data) => data.subarray(0, 8).equals(Buffer.from('0e8321dc51bab46b', 'hex'))));
  const borrow = clone(findHistoryIx(source, IDS.p0, (data) => data.subarray(0, 8).equals(Buffer.from('047e74353005d41f', 'hex'))));
  const repay = clone(findHistoryIx(source, IDS.p0, (data) => data.subarray(0, 8).equals(Buffer.from('4fd1acb1de33ad97', 'hex'))));
  const end = clone(findHistoryIx(source, IDS.p0, (data) => data.subarray(0, 8).equals(Buffer.from('697cc96a9902089c', 'hex'))));
  const group = borrow.keys[0].pubkey;
  const bank = borrow.keys[3].pubkey;
  const vault = borrow.keys[6].pubkey;
  const init = new TransactionInstruction({programId: IDS.p0, keys: [
    key(group), key(marginfiAccount, true, true), key(attacker, true), key(attacker, true, true), key(IDS.system),
  ], data: Buffer.from([43, 78, 61, 255, 148, 52, 249, 154])});
  start.keys[0].pubkey = marginfiAccount; start.keys[1].pubkey = attacker;
  borrow.keys[1].pubkey = marginfiAccount; borrow.keys[2].pubkey = attacker; borrow.keys[4].pubkey = attackerUsdc;
  repay.keys[1].pubkey = marginfiAccount; repay.keys[2].pubkey = attacker; repay.keys[4].pubkey = attackerUsdc;
  end.keys[0].pubkey = marginfiAccount; end.keys[2].pubkey = attacker;
  return {sourceSlot: source.slot, group, bank, vault, init,
    start: (endIndex) => { const ix = clone(start); ix.data.writeBigUInt64LE(BigInt(endIndex), 8); return ix; },
    borrow: (amount) => { const ix = clone(borrow); ix.data.writeBigUInt64LE(BigInt(amount), 8); return ix; },
    repay: (amount) => { const ix = clone(repay); ix.data.writeBigUInt64LE(BigInt(amount), 8); return ix; },
    end: () => clone(end)};
}

async function saveBuilder(attacker, attackerUsdc) {
  const source = await rpc('getTransaction', [SOURCE_SAVE,
    {encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]);
  if (!source) throw new Error('Save source unavailable');
  const borrowTemplate = findHistoryIx(source, IDS.save, (data) => data[0] === 19);
  const repayTemplate = findHistoryIx(source, IDS.save, (data) => data[0] === 20);
  const reserve = P('BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw');
  const reserveRow = (await getAccounts([reserve])).value[0];
  const data = accountBytes(reserveRow);
  const market = new PublicKey(data.subarray(10, 42));
  const vault = new PublicKey(data.subarray(75, 107));
  const feeReceiver = new PublicKey(data.subarray(339, 371));
  const marketAuthority = pda(IDS.save, market);
  const available = data.readBigUInt64LE(171);
  const flashFeeWad = data.readBigUInt64LE(314);
  const hostFeePct = data[322];
  const borrow = (amount) => {
    const ix = clone(borrowTemplate);
    const replacements = {0: vault, 1: attackerUsdc, 2: reserve, 3: market,
      4: marketAuthority, 5: IDS.instructions, 6: IDS.token};
    for (const [index, pubkey] of Object.entries(replacements)) ix.keys[Number(index)].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 1);
    return ix;
  };
  const repay = (amount, borrowIndex) => {
    const ix = clone(repayTemplate);
    const replacements = {0: attackerUsdc, 1: vault, 2: feeReceiver, 3: attackerUsdc,
      4: reserve, 5: market, 6: attacker, 7: IDS.instructions, 8: IDS.token};
    for (const [index, pubkey] of Object.entries(replacements)) ix.keys[Number(index)].pubkey = pubkey;
    ix.data.writeBigUInt64LE(BigInt(amount), 1); ix.data[9] = borrowIndex;
    return ix;
  };
  const grossFee = (amount) => (BigInt(amount) * flashFeeWad + 999_999_999_999_999_999n) / 1_000_000_000_000_000_000n;
  const protocolFee = (amount) => {
    const gross = grossFee(amount);
    return gross - gross * BigInt(hostFeePct) / 100n;
  };
  return {sourceSlot: source.slot, reserve, market, vault, feeReceiver, marketAuthority,
    available, flashFeeWad, hostFeePct, grossFee, protocolFee, borrow, repay};
}

function jupBuilder(attacker, attackerToken, symbol) {
  const row = JUP_INVENTORY.reserves.find((item) => item.symbol === symbol);
  const binding = JUP_INVENTORY.protocolBindings.find((item) => String(item.protocol) === String(JUP_FLASH_ADMIN));
  if (!row || !binding) throw new Error(`Jupiter fixture unavailable for ${symbol}`);
  const position = binding.borrowPositions.find((item) => item.mint === row.mint);
  if (!position) throw new Error(`Jupiter borrow position unavailable for ${symbol}`);
  const tokenProgram = [String(IDS.usdg), String(IDS.pyusd)].includes(row.mint) ? IDS.token2022 : IDS.token;
  const flash = (discriminator, amount) => new TransactionInstruction({programId: IDS.jupFlash,
    keys: [key(attacker, true, true), key(JUP_FLASH_ADMIN, false, true),
      key(attackerToken, false, true), key(P(row.mint)), key(P(row.reserve), false, true),
      key(P(position.address), false, true), key(P(row.rateModel)), key(P(row.vault), false, true),
      key(IDS.jupLiquidity), key(IDS.jupLiquidity), key(tokenProgram), key(IDS.ata),
      key(IDS.system), key(IDS.instructions)],
    data: Buffer.concat([discriminator, u64(amount)])});
  const refresh = () => new TransactionInstruction({programId: IDS.jupLiquidity,
    keys: [key(P(row.reserve), false, true), key(P(row.rateModel))],
    data: Buffer.concat([JUP_REFRESH, P(row.mint).toBuffer()])});
  return {row, position, tokenProgram, borrow: (amount) => flash(JUP_BORROW, amount),
    repay: (amount) => flash(JUP_REPAY, amount), refresh};
}

function p0Envelope(builder, middle) {
  const instructions = [builder.init, null, ...middle, builder.end()];
  instructions[1] = builder.start(instructions.length - 1);
  return instructions;
}

function dualEnvelope(p0, klend, p0Amount, klendAmount, middle = []) {
  const list = [p0.init, null, klend.borrow(klendAmount), p0.borrow(p0Amount), ...middle,
    p0.repay(p0Amount), null, p0.end()];
  list[1] = p0.start(list.length - 1);
  const klendBorrowIndex = list.findIndex((ix) => ix.programId.equals(IDS.klend));
  const repayIndex = list.length - 2;
  list[repayIndex] = klend.repay(klendAmount, klendBorrowIndex);
  return list;
}

function tripleEnvelope(p0, klend, save, p0Amount, klendAmount, saveAmount, middle = []) {
  const list = [p0.init, null, save.borrow(saveAmount), klend.borrow(klendAmount),
    p0.borrow(p0Amount), ...middle, p0.repay(p0Amount), null, null, p0.end()];
  list[1] = p0.start(list.length - 1);
  const saveBorrowIndex = list.findIndex((ix) => ix.programId.equals(IDS.save));
  const klendBorrowIndex = list.findIndex((ix) => ix.programId.equals(IDS.klend));
  list[list.length - 3] = klend.repay(klendAmount, klendBorrowIndex);
  list[list.length - 2] = save.repay(saveAmount, saveBorrowIndex);
  return list;
}

async function main() {
  const attacker = Keypair.generate();
  const marginfiAccount = Keypair.generate();
  const ataUsdc = spl.getAssociatedTokenAddressSync(IDS.usdc, attacker.publicKey);
  const ataUsdg = spl.getAssociatedTokenAddressSync(IDS.usdg, attacker.publicKey, false, IDS.token2022);
  const ataPyusd = spl.getAssociatedTokenAddressSync(IDS.pyusd, attacker.publicKey, false, IDS.token2022);
  const ataUsdu = spl.getAssociatedTokenAddressSync(IDS.usdu, attacker.publicKey, false, IDS.token2022);
  const ataSusdu = spl.getAssociatedTokenAddressSync(IDS.susdu, attacker.publicKey, false, IDS.token2022);
  const cooldown = pda(IDS.vaultProgram, Buffer.from('vault-cooldown'), IDS.usdu, attacker.publicKey);
  const vaultAdmin = pda(IDS.guardianProgram, Buffer.from('access-role'), IDS.accessRegistry,
    attacker.publicKey, roleSeed('vault_admin'));

  await setSystem(attacker.publicKey);
  await rpc('getAccountInfo', [String(IDS.victimCooldown), {encoding: 'base64', commitment: 'processed'}]);
  const templateResult = await getAccounts([IDS.targetVaultUsdc, IDS.usdgPoolVault,
    IDS.targetVaultUsdu, IDS.victimSusduAta]);
  const templates = {usdc: templateResult.value[0], usdg: templateResult.value[1],
    usdu: templateResult.value[2], susdu: templateResult.value[3]};
  const seed = async ({usdc = 0n, usdg = 0n, pyusd = 0n, usdu = 0n, susdu = 0n} = {}) => {
    await setTokenAccount(ataUsdc, templates.usdc, IDS.usdc, attacker.publicKey, usdc);
    await setTokenAccount(ataUsdg, templates.usdg, IDS.usdg, attacker.publicKey, usdg);
    await setTokenAccount(ataPyusd, templates.usdg, IDS.pyusd, attacker.publicKey, pyusd);
    await setTokenAccount(ataUsdu, templates.usdu, IDS.usdu, attacker.publicKey, usdu);
    await setTokenAccount(ataSusdu, templates.susdu, IDS.susdu, attacker.publicKey, susdu);
  };

  await seed();
  const [p0, save] = await Promise.all([
    p0Builder(attacker.publicKey, marginfiAccount.publicKey, ataUsdc),
    saveBuilder(attacker.publicKey, ataUsdc),
  ]);
  const klend = klendBuilder(attacker.publicKey, ataUsdc);
  const jupUsdg = jupBuilder(attacker.publicKey, ataUsdg, 'USDG');
  const jupPyusd = jupBuilder(attacker.publicKey, ataPyusd, 'PYUSD');

  const imported = await getAccounts([P(klend.reserve.reserve), P(klend.reserve.supplyVault),
    p0.vault, p0.bank, save.reserve, save.vault, P(jupUsdg.row.reserve), P(jupUsdg.row.vault),
    P(jupUsdg.position.address), IDS.targetPool, IDS.usdgPool]);
  const klendAvailable = accountBytes(imported.value[0]).readBigUInt64LE(224);
  const klendSupply = tokenAmount(imported.value[1]);
  const p0VaultBalance = tokenAmount(imported.value[2]);
  const p0BankBefore = decodeBank(imported.value[3]);
  const saveAvailable = accountBytes(imported.value[4]).readBigUInt64LE(171);
  const saveVaultBalance = tokenAmount(imported.value[5]);
  const jupReserve = decodeJupReserve(imported.value[6]);
  const jupVaultBalance = tokenAmount(imported.value[7]);
  const jupPosition = jupCoder.decode('UserBorrowPosition', accountBytes(imported.value[8]));
  const jupPositionCeiling = BigInt(jupPosition.max_debt_ceiling.toString());
  const targetPoolState = orcaPoolState(imported.value[9]);
  const usdgPoolState = orcaPoolState(imported.value[10]);
  const results = [];
  const run = async (...args) => { const result = await simulate(...args); results.push(result); return result; };
  const providerWatch = [ataUsdc, ataUsdg, ataPyusd, P(klend.reserve.supplyVault),
    P(klend.reserve.feeVault), P(klend.reserve.reserve), p0.vault, p0.bank,
    save.vault, save.feeReceiver, save.reserve, P(jupUsdg.row.vault), P(jupUsdg.row.reserve),
    P(jupUsdg.position.address), JUP_FLASH_ADMIN, marginfiAccount.publicKey];

  // Exact current available/boundary +/-1 controls for KLend.
  for (const [suffix, amount] of [['minus_one', klendAvailable - 1n], ['exact', klendAvailable],
    ['plus_one', klendAvailable + 1n]]) {
    await seed();
    const borrow = klend.borrow(amount);
    const ixs = [borrow, klend.repay(amount, 0)];
    await run(`klend_current_available_${suffix}`, ixs, attacker.publicKey, [attacker], providerWatch,
      {provider: 'KLend', mint: String(IDS.usdc), amountRaw: amount.toString(),
        observedAvailableRaw: klendAvailable.toString()});
  }

  // Project0 displayed vault boundary and live risk-limited maximum.
  const p0Only = (amount) => p0Envelope(p0, [p0.borrow(amount), p0.repay(amount)]);
  for (const [suffix, amount] of [['minus_one', p0VaultBalance - 1n], ['exact', p0VaultBalance],
    ['plus_one', p0VaultBalance + 1n]]) {
    await seed();
    await run(`project0_vault_balance_${suffix}`, p0Only(amount), attacker.publicKey,
      [attacker, marginfiAccount], providerWatch,
      {provider: 'Project0/marginfi', mint: String(IDS.usdc), amountRaw: amount.toString(),
        displayedVaultRaw: p0VaultBalance.toString()});
  }
  let p0Low = 2n;
  let p0High = p0VaultBalance + 1n;
  while (p0High - p0Low > 1n) {
    const middle = (p0Low + p0High) / 2n;
    await seed();
    const row = await simulate(`project0_binary_${middle}`, p0Only(middle), attacker.publicKey,
      [attacker, marginfiAccount], providerWatch, {provider: 'Project0/marginfi', binaryProbe: true,
        amountRaw: middle.toString()});
    if (row.err === null) p0Low = middle; else p0High = middle;
  }
  for (const [suffix, amount] of [['minus_one', p0Low - 1n], ['exact', p0Low], ['plus_one', p0Low + 1n]]) {
    await seed();
    await run(`project0_risk_max_${suffix}`, p0Only(amount), attacker.publicKey,
      [attacker, marginfiAccount], providerWatch,
      {provider: 'Project0/marginfi', mint: String(IDS.usdc), amountRaw: amount.toString(),
        riskLimitedMaximumRaw: p0Low.toString(), firstRejectedRaw: p0High.toString()});
  }

  // Save/Solend boundary. A disclosed synthetic attacker buffer pays the exact
  // configured fee; protocol/host fee accounting is reconciled in each result.
  for (const [suffix, amount] of [['minus_one', saveAvailable - 1n], ['exact', saveAvailable],
    ['plus_one', saveAvailable + 1n]]) {
    const feeBuffer = save.grossFee(amount) + 10n;
    await seed({usdc: feeBuffer});
    const ixs = [save.borrow(amount), save.repay(amount, 0)];
    await run(`save_current_available_${suffix}`, ixs, attacker.publicKey, [attacker], providerWatch,
      {provider: 'Save/Solend', mint: String(IDS.usdc), amountRaw: amount.toString(),
        observedAvailableRaw: saveAvailable.toString(), observedVaultRaw: saveVaultBalance.toString(),
        configuredFlashFeeWad: save.flashFeeWad.toString(), hostFeePct: save.hostFeePct,
        syntheticAttackerFeeBufferRaw: feeBuffer.toString(), expectedGrossFeeRaw: save.grossFee(amount).toString(),
        expectedProtocolFeeRaw: save.protocolFee(amount).toString()});
  }

  // Jupiter native USDG zero-fee boundary. Binary search measures actual usable
  // capacity instead of treating the token vault as flash capacity.
  const jupPair = (builder, amount) => [builder.borrow(amount), builder.refresh(), builder.repay(amount)];
  let jupLow = 1_000n;
  let jupHigh = [jupVaultBalance, jupPositionCeiling].reduce((a, b) => a < b ? a : b) + 1n;
  while (jupHigh - jupLow > 1n) {
    const middle = (jupLow + jupHigh) / 2n;
    await seed();
    const row = await simulate(`jupiter_usdg_binary_${middle}`, jupPair(jupUsdg, middle),
      attacker.publicKey, [attacker], providerWatch,
      {provider: 'Jupiter native flash', binaryProbe: true, amountRaw: middle.toString()});
    if (row.err === null) jupLow = middle; else jupHigh = middle;
  }
  for (const [suffix, amount] of [['minus_one', jupLow - 1n], ['exact', jupLow], ['plus_one', jupLow + 1n]]) {
    await seed();
    await run(`jupiter_usdg_usable_max_${suffix}`, jupPair(jupUsdg, amount), attacker.publicKey,
      [attacker], providerWatch,
      {provider: 'Jupiter native flash', mint: String(IDS.usdg), amountRaw: amount.toString(),
        tokenVaultRaw: jupVaultBalance.toString(), accountingAvailableRaw: jupAccountingAvailable(jupReserve).toString(),
        positionCeilingRaw: jupPositionCeiling.toString(), usableMaximumRaw: jupLow.toString(),
        firstRejectedRaw: jupHigh.toString(), configuredFeeBps: 0});
  }

  // Same-provider repetition constraint and currently utilization-blocked PYUSD.
  await seed();
  await run('jupiter_two_flash_cycles_same_transaction', [
    ...jupPair(jupUsdg, 1_000_000n), ...jupPair(jupUsdg, 1_000_000n),
  ], attacker.publicKey, [attacker], providerWatch,
  {provider: 'Jupiter native flash', repeatBorrowProbe: true, amountEachRaw: '1000000'});
  for (const amount of [1_000n, 1_000_000n]) {
    await seed();
    await run(`jupiter_pyusd_current_blocker_${amount}`, jupPair(jupPyusd, amount),
      attacker.publicKey, [attacker], providerWatch,
      {provider: 'Jupiter native flash', mint: String(IDS.pyusd), amountRaw: amount.toString(),
        expectedBlocker: 'current reserve utilization gate'});
  }

  // Same-atomic dual and tri-provider USDC controls, including asymmetric and
  // maximum jointly valid amounts. Save fee is supplied only by a disclosed
  // local attacker buffer and is included in attacker/protocol reconciliation.
  const dualCases = [
    ['small_asymmetric', 2_000_003n, 7_000_019n],
    ['maximum_each', p0Low, klendAvailable],
  ];
  for (const [suffix, p0Amount, klendAmount] of dualCases) {
    await seed();
    const ixs = dualEnvelope(p0, klend, p0Amount, klendAmount);
    await run(`dual_project0_klend_${suffix}`, ixs, attacker.publicKey,
      [attacker, marginfiAccount], providerWatch,
      {providers: ['Project0/marginfi', 'KLend'], p0Raw: p0Amount.toString(),
        klendRaw: klendAmount.toString(), aggregateRaw: (p0Amount + klendAmount).toString(),
        asymmetric: p0Amount !== klendAmount});
  }

  const saveMaxControl = saveAvailable;
  const tripleBuffer = save.grossFee(saveMaxControl) + 10n;
  await seed({usdc: tripleBuffer});
  const tripleMax = tripleEnvelope(p0, klend, save, p0Low, klendAvailable, saveMaxControl);
  await run('triple_project0_klend_save_maximum_each', tripleMax, attacker.publicKey,
    [attacker, marginfiAccount], providerWatch,
    {providers: ['Project0/marginfi', 'KLend', 'Save/Solend'], p0Raw: p0Low.toString(),
      klendRaw: klendAvailable.toString(), saveRaw: saveMaxControl.toString(),
      aggregateRaw: (p0Low + klendAvailable + saveMaxControl).toString(),
      syntheticAttackerFeeBufferRaw: tripleBuffer.toString(),
      expectedSaveGrossFeeRaw: save.grossFee(saveMaxControl).toString()});

  const output = {generatedAt: new Date().toISOString(), safety: {defensive: true,
    localForkRpc: RPC, liveTransactionsSubmitted: 0, sendTransactionCalls: 0,
    localForkWritesOnly: true, allTransactionsSigned: true, sigVerify: true,
    transactionVersion: 1, limits: {bytes: 4096, accounts: 64, instructions: 64}},
  attacker: {authority: String(attacker.publicKey), marginfiAccount: String(marginfiAccount.publicKey),
    usdcAta: String(ataUsdc), usdgAta: String(ataUsdg), pyusdAta: String(ataPyusd),
    usduAta: String(ataUsdu), susduAta: String(ataSusdu), cooldown: String(cooldown),
    vaultAdminRolePda: String(vaultAdmin)},
  sources: {klend: {reserve: klend.reserve, currentAvailableRaw: klendAvailable.toString(),
    supplyVaultRaw: klendSupply.toString()},
  project0: {sourceSlot: p0.sourceSlot, group: String(p0.group), bank: String(p0.bank),
    vault: String(p0.vault), displayedVaultRaw: p0VaultBalance.toString(), bankBefore: p0BankBefore,
    riskLimitedMaximumRaw: p0Low.toString(), firstRejectedRaw: p0High.toString()},
  save: {sourceSlot: save.sourceSlot, reserve: String(save.reserve), market: String(save.market),
    vault: String(save.vault), feeReceiver: String(save.feeReceiver), currentAvailableRaw: saveAvailable.toString(),
    currentVaultRaw: saveVaultBalance.toString(), flashFeeWad: save.flashFeeWad.toString(),
    hostFeePct: save.hostFeePct},
  jupiter: {flashAdmin: String(JUP_FLASH_ADMIN), usdg: {reserve: jupUsdg.row.reserve,
    vault: jupUsdg.row.vault, position: jupUsdg.position.address,
    currentVaultRaw: jupVaultBalance.toString(), accountingAvailableRaw: jupAccountingAvailable(jupReserve).toString(),
    positionCeilingRaw: jupPositionCeiling.toString(), usableMaximumRaw: jupLow.toString(),
    firstRejectedRaw: jupHigh.toString(), configuredFeeBps: 0}}},
  routes: {targetUsduUsdc: {pool: String(IDS.targetPool), ...Object.fromEntries(Object.entries(targetPoolState)
    .map(([name, value]) => [name, typeof value === 'bigint' ? value.toString() : String(value)]))},
  usdgUsdc: {pool: String(IDS.usdgPool), ...Object.fromEntries(Object.entries(usdgPoolState)
    .map(([name, value]) => [name, typeof value === 'bigint' ? value.toString() : String(value)]))}},
  results};
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({output: OUT, resultCount: results.length,
    p0RiskMax: p0Low.toString(), jupiterUsdgMax: jupLow.toString(),
    successes: results.filter((row) => row.err === null && !row.compositionError).length,
    failures: results.filter((row) => row.err !== null || row.compositionError).length})}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
