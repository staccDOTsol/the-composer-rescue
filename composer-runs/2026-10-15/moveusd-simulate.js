#!/usr/bin/env node
// Current-mainnet, read-only Solana v1 simulations for the live MOVEUSD
// controller. This script emits unsigned custom v1 wires and calls only
// simulateTransaction with sigVerify=false. It never calls sendTransaction.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey, TransactionInstruction, TransactionMessage } = require(path.join(MOD, '@solana/web3.js'));
const bs58Module = require(path.join(MOD, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = path.join(DIR, 'moveusd-simulations.json');
const PROGRAM = new PublicKey('EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const PAYER = new PublicKey('payrXniZwqd31JT2hYU1VgQmb3T1QWD3rMNYEGtHKvJ');
const OPERATOR = new PublicKey('HAeqpi3coL6PCALPg1QkfdJexK2MBFfy2sx6FeVbxTN4');
const OUTSIDER = new PublicKey('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3');
const PERMISSION = new PublicKey('2wwUmY5HFJe2iNipmV1p6AgaHY76dAJab1ATM4pDdQQQ');
const SOURCE = new PublicKey('9LbzSsqxTyaa9dA9nVv7oBaZy85qJuAonX7wCuEaXoXX');
const DESTINATION = new PublicKey('BrFoeW3Fa7xiMoGUJSPpe2aCZRmN7L9RE7nSiR5fgmnW');
const SOURCE_AUTHORITY = new PublicKey('F42zAoH6HGZqrXroPWTXP9fHujFc2mLrycMgn3kJkMrr');
const TARGET_AUTHORITY = new PublicKey('32BBRz2FuaRbHa4E6AfjiS5rE3v4zRkxUmzPVY8YD8ts');
const MINT = new PublicKey('3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm');
const TOKEN_INFO = new PublicKey('8PyaUJQe3RuRHe8SaXzE7fs6KjxiboiDkrz6S2ZNThss');
const EVENT_AUTHORITY = new PublicKey('BqoVR3S5xWi3syRwgxFvucisSZErafncDEV3EsXGaiCC');

const ORIGINAL_DATA = Buffer.from('a334c8e78c0345ba05000000465855534418fd6f1c5d325f64a911e1c3116441755e28cfa7694256d4aaf0b3e4ae2758470100000060858a6331000000010000001b341cc333735db194c42b613488967302000000ffff', 'hex');
const ORIGINAL_IDEMPOTENT = new PublicKey('BJ3kLA59KG9WfpP1J5eXpnziw1YZ4roUmtLuBxw433Rg');
const IK_OFFSET = 17;
const AMOUNT_OFFSET = 53;

function endpoint() {
  const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
  const env = Object.fromEntries(lines.filter((line) => line.includes('=')).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL unavailable');
  return env.RPC_URL;
}
const RPC = endpoint();
let rpcId = 1;
async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message([]);
  if (message.addressTableLookups.length) throw new Error('v1 forbids address lookup tables');
  const keys = message.staticAccountKeys;
  const items = message.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error(`v1 count limit ${keys.length}/${items.length}`);
  const cfg = Buffer.alloc(8);
  cfg.writeUInt32LE(computeLimit, 0);
  cfg.writeUInt32LE(dataLimit, 4);
  const heads = items.map((ix) => {
    const out = Buffer.alloc(4);
    out[0] = ix.programIdIndex;
    out[1] = ix.accountKeyIndexes.length;
    out.writeUInt16LE(ix.data.length, 2);
    return out;
  });
  const payloads = items.map((ix) => Buffer.concat([Buffer.from(ix.accountKeyIndexes), Buffer.from(ix.data)]));
  const wire = Buffer.concat([
    Buffer.from([0x81, message.header.numRequiredSignatures, message.header.numReadonlySignedAccounts,
      message.header.numReadonlyUnsignedAccounts]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map((key) => key.toBuffer()),
    cfg,
    ...heads,
    ...payloads,
    Buffer.alloc(64 * message.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 byte limit ${wire.length}`);
  return {
    wire,
    sizeBytes: wire.length,
    addressCount: keys.length,
    instructionCount: items.length,
    requiredSignatures: message.header.numRequiredSignatures,
    signerKeys: keys.slice(0, message.header.numRequiredSignatures).map(String),
    wireSha256: crypto.createHash('sha256').update(wire).digest('hex'),
  };
}

function freshIk(label) {
  return crypto.createHash('sha256').update(`MOVEUSD read-only ${label}`).digest().subarray(0, 16);
}

function idempotentFor(ik) {
  return PublicKey.findProgramAddressSync([ik, Buffer.from('transfer')], PROGRAM)[0];
}

function transferInstruction(label, amount, authority = OPERATOR, authoritySigner = true,
  permission = PERMISSION, useOriginalReplay = false) {
  const data = Buffer.from(ORIGINAL_DATA);
  let idempotent = ORIGINAL_IDEMPOTENT;
  if (!useOriginalReplay) {
    const ik = freshIk(label);
    ik.copy(data, IK_OFFSET);
    idempotent = idempotentFor(ik);
  }
  data.writeBigUInt64LE(amount, AMOUNT_OFFSET);
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_INFO, isSigner: false, isWritable: false },
      { pubkey: SOURCE_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: SOURCE, isSigner: false, isWritable: true },
      { pubkey: permission, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: authoritySigner, isWritable: true },
      { pubkey: idempotent, isSigner: false, isWritable: true },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TARGET_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: DESTINATION, isSigner: false, isWritable: true },
    ],
    data,
  });
}

function substituteAccount(label, index, pubkey) {
  const instruction = transferInstruction(label, 1n);
  instruction.keys[index] = { ...instruction.keys[index], pubkey };
  return instruction;
}

function tokenAmount(account) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return null;
  return data.readBigUInt64LE(64).toString();
}

async function simulate(label, instructions, blockhash) {
  const encoded = encodeV1(instructions, PAYER, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true,
    accounts: { encoding: 'base64', addresses: [SOURCE.toBase58(), DESTINATION.toBase58()] },
  }]);
  return {
    label,
    simulationSlot: result.context?.slot ?? null,
    err: result.value?.err ?? null,
    unitsConsumed: result.value?.unitsConsumed ?? null,
    loadedAccountsDataSize: result.value?.loadedAccountsDataSize ?? null,
    sourcePostRaw: tokenAmount(result.value?.accounts?.[0]),
    destinationPostRaw: tokenAmount(result.value?.accounts?.[1]),
    logs: (result.value?.logs || []).filter((line) => /Instruction:|Error|failed|MOVEUSD|EmiytJ/.test(line)),
    ...encoded,
    wire: undefined,
  };
}

function exact4096(base, blockhash) {
  for (let length = 0; length <= 4096; length++) {
    const memo = new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.alloc(length, 0x78) });
    try {
      const encoded = encodeV1([base, memo], PAYER, blockhash);
      if (encoded.sizeBytes === 4096) return [base, memo];
    } catch (error) {
      if (/byte limit/.test(error.message)) break;
      throw error;
    }
  }
  throw new Error('unable to construct exact 4096-byte v1 envelope');
}

async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(DIR, 'moveusd-current-state.json'), 'utf8'));
  const sourceBefore = BigInt(state.custodyVault.amountRaw);
  const destinationBefore = BigInt(state.observedDestination.amountRaw);
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const specs = [
    ['operator_equivalent_fresh_transfer_1', [transferInstruction('operator-transfer-1', 1n)]],
    ['outsider_substitutes_authority_against_operator_permission',
      [transferInstruction('outsider-substitution', 1n, OUTSIDER, true, PERMISSION)]],
    ['token_info_substituted_with_system_program',
      [substituteAccount('token-info-substitution', 2, SYSTEM)]],
    ['source_token_account_aliased_to_destination',
      [substituteAccount('source-alias-destination', 4, DESTINATION)]],
    ['destination_token_account_aliased_to_source',
      [substituteAccount('destination-alias-source', 13, SOURCE)]],
    ['token_program_substituted_with_system_program',
      [substituteAccount('token-program-substitution', 8, SYSTEM)]],
    ['operator_account_not_marked_signer',
      [transferInstruction('missing-signer', 1n, OPERATOR, false, PERMISSION)]],
    ['replay_completed_transfer_id', [transferInstruction('replay', 212_123_420_000n, OPERATOR, true, PERMISSION, true)]],
    ['operator_equivalent_zero_amount', [transferInstruction('amount-zero', 0n)]],
    ['operator_equivalent_source_plus_one', [transferInstruction('source-plus-one', sourceBefore + 1n)]],
    ['operator_equivalent_u64_max', [transferInstruction('u64-max', (1n << 64n) - 1n)]],
  ];
  const full = transferInstruction('exact-4096', 1n);
  specs.push(['operator_equivalent_exact_4096_byte_v1', exact4096(full, blockhash)]);

  const results = [];
  for (const [label, instructions] of specs) {
    try {
      const result = await simulate(label, instructions, blockhash);
      results.push(result);
      process.stdout.write(`${JSON.stringify({ label, err: result.err, bytes: result.sizeBytes,
        accounts: result.addressCount, sourcePostRaw: result.sourcePostRaw,
        destinationPostRaw: result.destinationPostRaw, logs: result.logs.slice(-4) })}\n`);
    } catch (error) {
      const result = { label, localError: error.stack || error.message };
      results.push(result);
      process.stdout.write(`${JSON.stringify({ label, localError: error.message })}\n`);
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'current-mainnet read-only simulateTransaction; unsigned custom Solana v1; sigVerify=false; no sendTransaction',
    programId: PROGRAM.toBase58(),
    sourceTransaction: '4LzzHMY8eCKiVCxb2258q9VbVa9XmsWpC3RZRaXzTUYkLNaxsPZjFjHX8gu2MnTrrrVdS5dZW5w2auQRf9Y5Drxq',
    before: { sourceRaw: sourceBefore.toString(), destinationRaw: destinationBefore.toString() },
    importantInterpretation: 'Cases retaining OPERATOR as a declared signer bypass cryptographic signature verification only to exercise current program logic; they are operator-equivalent controls and not outsider attack paths.',
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
