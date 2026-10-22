#!/usr/bin/env node
'use strict';

// Fresh-outsider, signature-verified, non-broadcast mainnet simulations derived
// from a real successful OperatorRunFundCommand JSOL outflow receipt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const base = path.resolve(__dirname, '../2026-10-15/fragmetric-core-current-audit/sdk-3.0.2');
const web3 = require(path.join(base, 'node_modules/@solana/web3.js'));
const spl = require(path.join(base, 'node_modules/@solana/spl-token'));
const bs58Module = require(path.join(base, 'node_modules/bs58'));
const bs58 = bs58Module.default || bs58Module;
const {restakingTypes: T} = require(base);
const {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} = web3;

const A = {
  program: 'fragnAis7Bp6FTsMoa6YcH8UffhEw43Ph79qAiK3iF3',
  fund: '3TK9fNePM4qdKC4dwvDe8Bamv14prDqdVfuANxPeiryb',
  pool: 'AkbZvKxUAxMKz92FF7g5k2YLCJftg8SnYEPWdmZTt3mp',
  reserve: '5HrP4MEggWDsENFTFX7QqW7U49RTei6Qqh7TVCczhgWa',
  receipt: '4P9C1bfRHu9SZnjCs853cRC3HRTkV8w8CFNaDezicAvMaN7AcRCmnMAqmsTa2o11HQ9KDLjgDGRYLwNohsRFGuXv',
  jsolMint: '7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn',
  fundJsolReserve: 'BU9NeT5CfV7SSo8uKCrpCCcfxdkcLSirLtydXXV8MDhF',
};
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
const walletPath = path.join(os.homedir(), 'hooked.json');
const outsider = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8'))));

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(endpoint, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}), signal: AbortSignal.timeout(120000)});
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method}: ${JSON.stringify(body.error || response.status)}`);
  return body.result;
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
function tokenAmount(row) {
  if (!row) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}
function keyMap(message) {
  return new Map(message.accountKeys.map(row => [row.pubkey, row]));
}
function mutateInstruction(source, globalKeys, replacements = {}) {
  return new TransactionInstruction({
    programId: new PublicKey(source.programId),
    keys: source.accounts.map(address => {
      const meta = globalKeys.get(address) || {signer: false, writable: false};
      const replacement = replacements[address] || address;
      return {pubkey: new PublicKey(replacement), isSigner: replacements[address] === A.OUTSIDER ? true : !!meta.signer,
        isWritable: !!meta.writable};
    }),
    data: Buffer.from(bs58.decode(source.data)),
  });
}
function summarizeError(logs) {
  return (logs || []).filter(line => /Instruction:|AnchorError|Error Code:|failed|unauthor|constraint/i.test(line)).slice(-24);
}
async function simulate(label, instructions, watch, sourceMeta) {
  const latest = await rpc('getLatestBlockhash', [{commitment: 'confirmed'}]);
  const message = new TransactionMessage({payerKey: outsider.publicKey, recentBlockhash: latest.value.blockhash,
    instructions}).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([outsider]);
  const wire = Buffer.from(transaction.serialize());
  const totalKeys = message.staticAccountKeys.length + message.addressTableLookups.reduce((n, x) => n + x.writableIndexes.length + x.readonlyIndexes.length, 0);
  if (wire.length > 4096 || totalKeys > 64) throw new Error(`${label}: envelope ${wire.length} bytes/${totalKeys} keys`);
  const before = await rpc('getMultipleAccounts', [watch, {encoding: 'base64', commitment: 'confirmed'}]);
  const sim = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64', sigVerify: true,
    replaceRecentBlockhash: false, commitment: 'confirmed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watch}}]);
  const beforeAmounts = watch.map((address, i) => ({address, tokenAmountRaw: tokenAmount(before.value[i])}));
  const afterAmounts = watch.map((address, i) => ({address, tokenAmountRaw: tokenAmount(sim.value.accounts?.[i])}));
  const deltas = watch.map((address, i) => ({address,
    tokenAmountDeltaRaw: beforeAmounts[i].tokenAmountRaw !== null && afterAmounts[i].tokenAmountRaw !== null
      ? (BigInt(afterAmounts[i].tokenAmountRaw) - BigInt(beforeAmounts[i].tokenAmountRaw)).toString() : null}));
  return {label, sourceMeta, version: 0, signatureVerification: true, broadcast: false,
    transactionSubmitted: false, wireBytes: wire.length, totalAccountKeys: totalKeys,
    requiredSignatures: message.header.numRequiredSignatures, signedWireSha256: sha256(wire),
    err: sim.value.err, unitsConsumed: sim.value.unitsConsumed, relevantLogs: summarizeError(sim.value.logs),
    before: beforeAmounts, simulatedAfter: afterAmounts, tokenDeltas: deltas};
}

async function main() {
  A.OUTSIDER = outsider.publicKey.toBase58();
  const receipt = await rpc('getTransaction', [A.receipt, {encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0}]);
  if (!receipt || receipt.meta?.err) throw new Error('source receipt missing or failed');
  const source = receipt.transaction.message.instructions.find(ix => ix.programId === A.program);
  if (!source) throw new Error('source Fragmetric instruction absent');
  const sourceData = Buffer.from(bs58.decode(source.data));
  const decoded = T.getOperatorRunFundCommandInstructionDataDecoder().decode(sourceData);
  const globals = keyMap(receipt.transaction.message);
  const historicalSigner = receipt.transaction.message.accountKeys.find(row => row.signer)?.pubkey;
  const baseReplacements = {[historicalSigner]: A.OUTSIDER};
  const exactMutation = mutateInstruction(source, globals, baseReplacements);
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({units: 1_400_000}), ComputeBudgetProgram.requestHeapFrame({bytes: 256 * 1024})];
  const watch = [A.reserve, A.fundJsolReserve, A.fund, A.pool];
  const cases = [];
  cases.push(await simulate('historical_command_exact_data_outsider_operator', [...budget, exactMutation], watch, {
    sourceSignature: A.receipt, sourceSlot: receipt.slot, mutation: 'transaction signer/operator only',
  }));

  const outsiderAta = spl.getAssociatedTokenAddressSync(new PublicKey(A.jsolMint), outsider.publicKey).toBase58();
  const destinationMutation = mutateInstruction(source, globals, {...baseReplacements, [A.fundJsolReserve]: outsiderAta});
  const createAta = spl.createAssociatedTokenAccountIdempotentInstruction(outsider.publicKey, new PublicKey(outsiderAta),
    outsider.publicKey, new PublicKey(A.jsolMint));
  cases.push(await simulate('historical_command_outsider_destination_substitution', [...budget, createAta, destinationMutation],
    [...watch, outsiderAta], {sourceSignature: A.receipt,
      mutation: 'operator and known 24.059559458-JSOL destination changed to fresh outsider canonical ATA'}));

  const roleMutation = mutateInstruction(source, globals, {...baseReplacements,
    [A.reserve]: A.fundJsolReserve, [A.fundJsolReserve]: A.reserve});
  cases.push(await simulate('historical_command_source_destination_role_swap', [...budget, roleMutation], watch, {
    sourceSignature: A.receipt, mutation: 'operator changed; JSOL source and destination account roles swapped'}));

  const forceResetData = Buffer.from(T.getOperatorRunFundCommandInstructionDataEncoder().encode({
    forceResetCommand: {command: {__kind: 'Initialize', fields: [{state: {__kind: 'New'}}]}, requiredAccounts: []},
  }));
  const forceResetMutation = new TransactionInstruction({programId: exactMutation.programId,
    keys: exactMutation.keys, data: forceResetData});
  cases.push(await simulate('outsider_force_reset_initialize_new', [...budget, forceResetMutation], watch, {
    sourceSignature: A.receipt,
    mutation: 'well-formed Some(force_reset_command=Initialize(New), required_accounts=[]) under fresh outsider signer',
    dataHex: forceResetData.toString('hex'),
  }));

  const output = {
    generatedAt: new Date().toISOString(), network: 'mainnet-beta', commitment: 'confirmed',
    safety: {simulationOnly: true, sigVerify: true, replaceRecentBlockhash: false, broadcast: false,
      sendPathPresent: false, privateKeyPersisted: false, rpcCredentialPersisted: false},
    sourceReceipt: {signature: A.receipt, slot: receipt.slot, successful: !receipt.meta.err,
      historicalSigner, logInstructionNames: (receipt.meta.logMessages || []).filter(x => x.includes('Instruction: ')).map(x => x.split('Instruction: ')[1]),
      exactDataBase58: source.data, exactDataHex: sourceData.toString('hex'), decodedData: jsonSafe(decoded),
      accountCount: source.accounts.length, accounts: source.accounts,
      reservePreRaw: receipt.meta.preTokenBalances?.find(x => receipt.transaction.message.accountKeys[x.accountIndex]?.pubkey === A.reserve)?.uiTokenAmount?.amount || null,
      reservePostRaw: receipt.meta.postTokenBalances?.find(x => receipt.transaction.message.accountKeys[x.accountIndex]?.pubkey === A.reserve)?.uiTokenAmount?.amount || null},
    outsider: {address: A.OUTSIDER, jsolAta: outsiderAta},
    cases,
    conclusion: cases.some(row => row.err === null && row.tokenDeltas.some(delta => BigInt(delta.tokenAmountDeltaRaw || 0) < 0n))
      ? 'A signed outsider mutation changed watched custody; manual liability reconciliation is required.'
      : 'No signed outsider receipt mutation produced a custody delta.',
  };
  fs.writeFileSync(path.join(__dirname, 'fragmetric-signed-receipt-mutations.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({sourceReceipt: output.sourceReceipt, outsider: output.outsider,
    cases: cases.map(row => ({label: row.label, err: row.err, wireBytes: row.wireBytes,
      totalAccountKeys: row.totalAccountKeys, unitsConsumed: row.unitsConsumed, relevantLogs: row.relevantLogs,
      tokenDeltas: row.tokenDeltas})), conclusion: output.conclusion}, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
