#!/usr/bin/env node

// Read-only Solana v1 composition replay. This script never signs or submits.
const fs = require('fs');
const crypto = require('crypto');
const {
  Connection, PublicKey, SystemProgram, TransactionInstruction,
} = require('./kliquidity-sdk-official/node_modules/@solana/web3.js');
const {createSyncNativeInstruction} = require('./kliquidity-sdk-official/node_modules/@solana/spl-token');
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const SOURCE_PATH = `${DIR}/marginfi-damm-v2-real-composition-source-51rk.json`;
const OUT = process.env.OUTPUT_PATH || `${DIR}/damm-v2-marginfi-v1-composition.json`;
const DAMM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function configuredRpc() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
    .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return env.HEAVY_RPC_URL || env.RPC_URL;
}
const rpcUrl = configuredRpc();
if (!rpcUrl) throw new Error('No read-only RPC configured');
const connection = new Connection(rpcUrl, 'confirmed');

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function rpcBatch(calls) {
  const requests = calls.map(({method, params}) => ({jsonrpc: '2.0', id: ++rpcId, method, params}));
  const response = await fetch(rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify(requests)});
  const body = await response.json();
  const byId = new Map(body.map((row) => [row.id, row]));
  return requests.map(({id, method}) => {
    const row = byId.get(id);
    if (row?.error) throw new Error(`${method}: ${JSON.stringify(row.error)}`);
    return row.result;
  });
}

const pk = (value) => value instanceof PublicKey ? value : new PublicKey(value);
function toInstruction(row) {
  return new TransactionInstruction({
    programId: pk(row.programId),
    keys: row.accounts.map((account) => ({pubkey: pk(account.pubkey),
      isSigner: account.isSigner, isWritable: account.isWritable})),
    data: Buffer.from(row.dataHex, 'hex'),
  });
}

function compactAccount(value) {
  if (!value) return null;
  const data = Buffer.from(value.data[0], 'base64');
  const result = {owner: value.owner, lamports: value.lamports, dataLength: data.length,
    dataSha256: crypto.createHash('sha256').update(data).digest('hex')};
  if ((value.owner === TOKEN || value.owner === TOKEN_2022) && data.length >= 72) {
    result.tokenMint = new PublicKey(data.subarray(0, 32)).toBase58();
    result.tokenAuthority = new PublicKey(data.subarray(32, 64)).toBase58();
    result.tokenAmount = data.readBigUInt64LE(64).toString();
  }
  if (value.owner === DAMM && data.length === 1112) {
    result.dammPool = {
      protocolAFee: data.readBigUInt64LE(392).toString(),
      protocolBFee: data.readBigUInt64LE(400).toString(),
      totalProtocolAFee: data.readBigUInt64LE(600).toString(),
      totalProtocolBFee: data.readBigUInt64LE(608).toString(),
      tokenAAmount: data.readBigUInt64LE(680).toString(),
      tokenBAmount: data.readBigUInt64LE(688).toString(),
      layoutVersion: data[696],
    };
  }
  return result;
}

function delta(before, after) {
  if (!before || !after) return null;
  const result = {changed: before.dataSha256 !== after.dataSha256 || before.lamports !== after.lamports};
  if (before.tokenAmount != null && after.tokenAmount != null)
    result.tokenAmount = (BigInt(after.tokenAmount) - BigInt(before.tokenAmount)).toString();
  if (before.dammPool && after.dammPool) {
    result.dammPool = Object.fromEntries(Object.keys(before.dammPool).filter((key) => key !== 'layoutVersion')
      .map((key) => [key, (BigInt(after.dammPool[key]) - BigInt(before.dammPool[key])).toString()]));
  }
  return result;
}

async function simulate(label, instructions, payer, blockhash, trace) {
  const encoded = encodeV1(instructions, payer, blockhash, 1_400_000, 67_108_864);
  const addresses = Object.values(trace);
  const options = {encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
    commitment: 'confirmed', accounts: {encoding: 'base64', addresses}, innerInstructions: true};
  const [pre, response] = await rpcBatch([
    {method: 'getMultipleAccounts', params: [addresses, {encoding: 'base64', commitment: 'confirmed'}]},
    {method: 'simulateTransaction', params: [encoded.wire.toString('base64'), options]},
  ]);
  const value = response.value;
  const state = Object.fromEntries(Object.entries(trace).map(([role, address], index) => {
    const before = compactAccount(pre.value[index]);
    const after = compactAccount(value.accounts?.[index]);
    return [role, {address, before, after, delta: delta(before, after)}];
  }));
  return {
    label, transactionVersion: 1, submitted: false, signerVerification: false,
    contextSlot: response.context.slot, baselineContextSlot: pre.context.slot,
    sameSnapshotSlot: response.context.slot === pre.context.slot,
    err: value.err, unitsConsumed: value.unitsConsumed ?? null,
    loadedAccountsDataSize: value.loadedAccountsDataSize ?? null,
    sizeBytes: encoded.sizeBytes, addressCount: encoded.addressCount,
    writableCount: encoded.writableCount, instructionCount: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures,
    equivalentNoLookupV0Bytes: encoded.v0Bytes,
    equivalentLegacyBytes: encoded.v0Bytes - 2,
    packetLimitLegacyV0Bytes: 1232,
    v1PacketLimitBytes: 4096,
    state,
    logs: value.logs || [],
  };
}

async function main() {
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH));
  const rows = source.instructions;
  const original = rows.map(toInstruction);
  const strippedRows = rows.filter((row) => row.index !== 9);
  const stripped = strippedRows.map(toInstruction);
  const start = strippedRows.findIndex((row) => row.marginfiName === 'lending_account_start_flashloan');
  const end = strippedRows.findIndex((row) => row.marginfiName === 'lending_account_end_flashloan');
  stripped[start].data.writeBigUInt64LE(BigInt(end), 8);

  const borrow = rows.find((row) => row.marginfiName === 'lending_account_borrow');
  const cpSwap = source.innerInstructions.find((row) => row.programId === DAMM &&
    row.dataHex.startsWith('f8c69e91e17587c8'));
  if (!borrow || !cpSwap) throw new Error('Expected live Marginfi borrow and DAMM v2 swap were not found');
  const trace = {
    marginfiAccount: rows.find((row) => row.marginfiName === 'lending_account_start_flashloan').accounts[0].pubkey,
    marginfiBank: borrow.accounts[3].pubkey,
    marginfiLiquidityVault: borrow.accounts[6].pubkey,
    loanDestination: borrow.accounts[4].pubkey,
    dammPool: cpSwap.accounts[1],
    dammInput: cpSwap.accounts[2],
    dammOutput: cpSwap.accounts[3],
    dammVaultA: cpSwap.accounts[4],
    dammVaultB: cpSwap.accounts[5],
  };
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const payer = pk(source.feePayer);
  const results = [];
  results.push(await simulate('source_shape_with_profit_guard_v1', original, payer, blockhash, trace));
  results.push(await simulate('profit_guard_removed_v1', stripped, payer, blockhash, trace));
  const buffered = strippedRows.map(toInstruction);
  const bufferLamports = 1_000_000;
  buffered.splice(start + 1, 0,
    SystemProgram.transfer({fromPubkey: payer, toPubkey: pk(borrow.accounts[4].pubkey), lamports: bufferLamports}),
    createSyncNativeInstruction(pk(borrow.accounts[4].pubkey)));
  const bufferedEnd = buffered.length - 1;
  buffered[start].data.writeBigUInt64LE(BigInt(bufferedEnd), 8);
  results.push(await simulate('buffered_profit_guard_removed_v1', buffered, payer, blockhash, trace));
  const output = {
    generatedAt: new Date().toISOString(),
    rpcMode: 'simulateTransaction(sigVerify=false, replaceRecentBlockhash=true); no send methods',
    source: {signature: source.signature, slot: source.slot, version: source.version,
      wireBytes: source.wireBytes, accountCount: source.accountCount,
      originalUnitsConsumed: source.unitsConsumed},
    programs: {marginfi: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA', dammV2: DAMM},
    providerModel: {
      startInstructionIndex: start,
      endInstructionIndexAfterGuardRemoval: end,
      loanRawAmount: BigInt(`0x${borrow.dataHex.slice(16).match(/../g).reverse().join('')}`).toString(),
      directCpiDisallowed: true,
      feeClaim: 'Marginfi documents flashloans as 0% fee; ordinary bank borrow/repay instructions are the loan legs.',
    },
    dammSwap: {parentInstructionIndex: cpSwap.parentIndex, dataHex: cpSwap.dataHex,
      accounts: cpSwap.accounts, trace},
    removedInstruction: {sourceIndex: 9, programId: rows[9].programId, dataHex: rows[9].dataHex,
      observedCurrentFailure: 'error: minimum profit not reached'},
    bufferLamports,
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({outputPath: OUT, results: results.map((result) => ({label: result.label,
    err: result.err, sizeBytes: result.sizeBytes, equivalentLegacyBytes: result.equivalentLegacyBytes,
    addressCount: result.addressCount, unitsConsumed: result.unitsConsumed}))}, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
