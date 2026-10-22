#!/usr/bin/env node
'use strict';

// Bounded, read-only mainnet check. No key material, transaction construction,
// simulation, or submission is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const base = path.resolve(__dirname, '../2026-10-15/fragmetric-core-current-audit');
const {PublicKey} = require(path.join(base, 'sdk-3.0.2/node_modules/@solana/web3.js'));
const {StakePoolLayout} = require(path.join(base, 'sdk-3.0.2/node_modules/@solana/spl-stake-pool'));
const {restakingTypes: T} = require(path.join(base, 'sdk-3.0.2'));

const envFile = '/private/tmp/codex-mainnet-rpc-2026-10-19.env';
if ((fs.statSync(envFile).mode & 0o777) !== 0o600) throw new Error('RPC env file must be mode 0600');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)\s*$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[match[1]] = value;
}
const endpoint = env.SOLANA_RPC_URL || env.SOLANA_RPC || env.HELIUS_RPC || env.RPC;
if (!endpoint) throw new Error('RPC endpoint absent');

const A = {
  program: 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3',
  fund: '3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb',
  receiptMint: 'FRAGSEthVFL7fdqM8hxfxkfCZzUvmg21cqPJVvC1qdbo',
  pool: 'AkbZvKxUAxMKz92FF7g5k2YLCJftg8SnYEPWdmZTt3mp',
  normalizedMint: 'nSoLnkrvh2aY792pgCNT6hzx84vYtkviRzxvhf3ws8e',
  vault: '5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa',
  mint: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
  stakePool: 'CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1',
  receipt: '4P9C1bfRHu9SZnjCs853cRC3HRTkV8w8CFNaDezicAvMaN7AcRCmnMAqmsTa2o11HQ9KDLjgDGRYLwNohsRFGuXv',
};
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const key = b => new PublicKey(b).toBase58();
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params})});
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
function row(value) {
  if (!value) return null;
  return {...value, data: Buffer.from(value.data[0], 'base64')};
}
function instructionProgram(ix) { return typeof ix.programId === 'string' ? ix.programId : ix.programId?.toString(); }
async function main() {
  const first = await rpc('getMultipleAccounts', [[A.program, A.fund, A.receiptMint, A.pool, A.normalizedMint, A.vault, A.mint, A.stakePool], {encoding: 'base64', commitment: 'finalized'}]);
  const [program, fund, receiptMint, pool, normalizedMint, vault, mint, stakePool] = first.value.map(row);
  if ([program, fund, receiptMint, pool, normalizedMint, vault, mint, stakePool].some(x => !x)) throw new Error('target account missing');
  if (program.data.readUInt32LE(0) !== 2) throw new Error('not upgradeable Program state');
  const programdataAddress = key(program.data.subarray(4, 36));
  const pdRpc = await rpc('getAccountInfo', [programdataAddress, {encoding: 'base64', commitment: 'finalized'}]);
  const pd = row(pdRpc.value);
  if (!pd || pd.data.readUInt32LE(0) !== 3) throw new Error('not ProgramData state');
  const deploySlot = Number(pd.data.readBigUInt64LE(4));
  const elfOffset = pd.data[12] === 1 ? 45 : 13;
  const decoded = T.getFundAccountDecoder().decode(fund.data);
  const supported = decoded.supportedTokens.slice(0, Number(decoded.numSupportedTokens));
  const jsol = supported.find(x => String(x.mint) === A.mint);
  if (!jsol) throw new Error('JSOL not in fund supported tokens');
  const poolDecoded = T.getNormalizedTokenPoolAccountDecoder().decode(pool.data);
  const poolJsol = poolDecoded.supportedTokens.find(x => String(x.mint) === A.mint);
  if (!poolJsol || String(poolJsol.reserveAccount) !== A.vault) throw new Error('pool/vault binding changed');
  const stakePoolDecoded = StakePoolLayout.decode(stakePool.data);
  const stakePoolLamports = BigInt(stakePoolDecoded.totalLamports.toString());
  const stakePoolSupply = BigInt(stakePoolDecoded.poolTokenSupply.toString());
  const receiptSupply = receiptMint.data.readBigUInt64LE(36);
  const normalizedSupply = normalizedMint.data.readBigUInt64LE(36);
  const receiptAccountingValue = BigInt(decoded.receiptTokenSupplyAmount.toString()) * BigInt(decoded.oneReceiptTokenAsSol.toString()) / 1000000000n;
  const normalizedAccountingValue = BigInt(poolDecoded.normalizedTokenSupplyAmount.toString()) * BigInt(poolDecoded.oneNormalizedTokenAsSol.toString()) / 1000000000n;
  const poolJsolAccountingValue = BigInt(poolJsol.lockedAmount.toString()) * BigInt(poolJsol.oneTokenAsSol.toString()) / 1000000000n;
  const tx = await rpc('getTransaction', [A.receipt, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0}]);
  if (!tx || tx.meta?.err) throw new Error('prior outflow receipt unavailable or failed');
  const keys = tx.transaction.message.accountKeys.map(k => typeof k === 'string' ? {pubkey:k,signer:false} : k);
  const vaultTransfers = [];
  for (const group of tx.meta.innerInstructions || []) {
    const root = instructionProgram(tx.transaction.message.instructions[group.index]);
    const stack = [];
    for (const ix of group.instructions) {
      const height = ix.stackHeight || 2;
      while (stack.length >= height - 1) stack.pop();
      const parent = height === 2 ? root : stack.at(-1)?.programId;
      const info = ix.parsed?.info;
      if (info?.source === A.vault && info?.authority === A.pool && ['transfer', 'transferChecked'].includes(ix.parsed?.type)) {
        vaultTransfers.push({outerIndex: group.index, programId: instructionProgram(ix), parentProgramId: parent, stackHeight: height, source: info.source, destination: info.destination, authority: info.authority, rawAmount: info.tokenAmount?.amount || info.amount, mint: info.mint || A.mint});
      }
      stack.push({programId: instructionProgram(ix), height});
    }
  }
  if (!vaultTransfers.some(x => x.parentProgramId === A.program)) throw new Error('no direct parent proof in receipt');
  const out = {
    observedAt: new Date().toISOString(), network: 'mainnet-beta', commitment: 'finalized',
    contextSlots: {batch: first.context.slot, programdata: pdRpc.context.slot},
    program: {address: A.program, executable: program.executable, loaderOwner: program.owner, programdataAddress, deploySlot, programdataSha256: sha256(pd.data), elfSha256: sha256(pd.data.subarray(elfOffset)), elfLength: pd.data.length - elfOffset},
    fund: {address: A.fund, owner: fund.owner, dataSha256: sha256(fund.data), receiptTokenMint: String(decoded.receiptTokenMint), receiptTokenSupplyRawOnMint: receiptSupply.toString(), receiptTokenSupplyRawRecorded: String(decoded.receiptTokenSupplyAmount), oneReceiptTokenAsSolLamports: String(decoded.oneReceiptTokenAsSol), receiptTokenValueUpdatedSlot: String(decoded.receiptTokenValueUpdatedSlot), receiptLiabilityLamportsAtRecordedRateFloor: receiptAccountingValue.toString(), withdrawalEnabled: Number(decoded.withdrawalEnabled), jsolDepositEnabled: Number(jsol.token.depositable), jsolWithdrawEnabled: Number(jsol.token.withdrawable), jsolPendingRequests: String(jsol.token.withdrawalPendingBatch.numRequests), solWithdrawalBatchIntervalSeconds: String(decoded.withdrawalBatchThresholdIntervalSeconds), withdrawalFeeRateBps: Number(decoded.withdrawalFeeRateBps)},
    pool: {address: A.pool, owner: pool.owner, offCurve: !PublicKey.isOnCurve(new PublicKey(A.pool).toBytes()), normalizedTokenMint: String(poolDecoded.normalizedTokenMint), normalizedTokenSupplyRawOnMint: normalizedSupply.toString(), normalizedTokenSupplyRawRecorded: String(poolDecoded.normalizedTokenSupplyAmount), oneNormalizedTokenAsSolLamports: String(poolDecoded.oneNormalizedTokenAsSol), normalizedTokenValueUpdatedSlot: String(poolDecoded.normalizedTokenValueUpdatedSlot), normalizedLiabilityLamportsAtRecordedRateFloor: normalizedAccountingValue.toString(), jsolReserveAccount: String(poolJsol.reserveAccount), jsolLockedAmountRaw: String(poolJsol.lockedAmount), jsolWithdrawalReservedRaw: String(poolJsol.withdrawalReservedAmount), jsolOneTokenAsSolLamportsRecorded: String(poolJsol.oneTokenAsSol), jsolAssetLamportsAtRecordedRateFloor: poolJsolAccountingValue.toString(), recordedAssetMinusLiabilityLamports: (poolJsolAccountingValue-normalizedAccountingValue).toString()},
    vault: {address: A.vault, tokenProgram: vault.owner, mint: key(vault.data.subarray(0,32)), authority: key(vault.data.subarray(32,64)), rawAmount: vault.data.readBigUInt64LE(64).toString(), decimals: mint.data[44]},
    jsolUnderlying: {stakePool: A.stakePool, stakePoolOwner: stakePool.owner, stakePoolTotalLamports: stakePoolLamports.toString(), stakePoolTokenSupplyRaw: stakePoolSupply.toString(), solLamportsPerJsolFloor: (stakePoolLamports * 1000000000n / stakePoolSupply).toString()},
    outflow: {signature: A.receipt, slot: tx.slot, successful: !tx.meta.err, poolTransactionSigner: keys.some(k => k.pubkey === A.pool && k.signer), transfers: vaultTransfers},
    limitations: 'One selected vault and one historical postdeployment receipt; no current USD price, outsider authorization, or net-loss proof.',
  };
  fs.writeFileSync(path.join(__dirname, 'fragmetric-residual-readonly-gate.json'), JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({slot: first.context.slot, rawAmount: out.vault.rawAmount, deploySlot, jsolWithdrawEnabled: out.fund.jsolWithdrawEnabled, receiptSlot: tx.slot, transferCount: vaultTransfers.length}));
}
main().catch(error => {console.error(error.message); process.exitCode=1;});
