#!/usr/bin/env node
// Current-mainnet, read-only Solana v1 simulations of the live controller's
// current Mint wire shape. Unsigned wires use sigVerify=false and are never
// submitted with sendTransaction.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey, TransactionInstruction, TransactionMessage } = require(path.join(MOD, '@solana/web3.js'));
const bs58Module = require(path.join(MOD, 'bs58'));
const bs58 = bs58Module.default || bs58Module;

const DIR = __dirname;
const OUT = path.join(DIR, 'moveusd-mint-simulations.json');
const PROGRAM = new PublicKey('EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const PAYER = new PublicKey('payrXniZwqd31JT2hYU1VgQmb3T1QWD3rMNYEGtHKvJ');
const OPERATOR = new PublicKey('HAeqpi3coL6PCALPg1QkfdJexK2MBFfy2sx6FeVbxTN4');
const OUTSIDER = new PublicKey('6mgztPM3Br7Sn8Jqe49jT2RRMmZbMRK6iH2xRZ6XVLL3');
const MINT = new PublicKey('3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm');
const TOKEN_INFO = new PublicKey('8PyaUJQe3RuRHe8SaXzE7fs6KjxiboiDkrz6S2ZNThss');
const CONTROLLER_MINT_ATA = new PublicKey('Hbh1Lp5LZtkmEjwMvt3fosMeeR7mUJ6eHmrd31KjaMcu');
const PERMISSION = new PublicKey('2wwUmY5HFJe2iNipmV1p6AgaHY76dAJab1ATM4pDdQQQ');
const ORIGINAL_IDEMPOTENT = new PublicKey('ACcRDJgk5r8xaVQya3wt6idF8gUZLTDEXmPqsApfrp3x');
const EVENT_AUTHORITY = new PublicKey('BqoVR3S5xWi3syRwgxFvucisSZErafncDEV3EsXGaiCC');
const DESTINATION = new PublicKey('FaEFUZ5Lqz33GhSxEknriLPUhvcHbHhZpsm8buWtvBZd');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const ORIGINAL_DATA = Buffer.from('3339e12fb69289a6050000004658555344dca4fcb72ad55db196a574a75e939cc80100000000d0ed902e00000000', 'hex');
const IK_OFFSET = 17;
const AMOUNT_OFFSET = 37;

function endpoint() {
  const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
  const env = Object.fromEntries(lines.filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
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

function encodeV1(instructions, blockhash) {
  const message = new TransactionMessage({ payerKey: PAYER, recentBlockhash: blockhash,
    instructions }).compileToV0Message([]);
  if (message.addressTableLookups.length) throw new Error('v1 forbids address lookup tables');
  const keys = message.staticAccountKeys;
  const items = message.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error(`v1 count limit ${keys.length}/${items.length}`);
  const config = Buffer.alloc(8);
  config.writeUInt32LE(1_400_000, 0);
  config.writeUInt32LE(67_108_864, 4);
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
    Buffer.from([0x0c, 0, 0, 0]), Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]), ...keys.map((key) => key.toBuffer()),
    config, ...heads, ...payloads, Buffer.alloc(64 * message.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 byte limit ${wire.length}`);
  return { wire, sizeBytes: wire.length, addressCount: keys.length,
    instructionCount: items.length, requiredSignatures: message.header.numRequiredSignatures,
    signerKeys: keys.slice(0, message.header.numRequiredSignatures).map(String),
    wireSha256: crypto.createHash('sha256').update(wire).digest('hex') };
}

function freshIk(label) {
  return crypto.createHash('sha256').update(`MOVEUSD read-only mint ${label}`).digest().subarray(0, 16);
}

function mintInstruction(label, amount, authority = OPERATOR, authoritySigner = true,
  permission = PERMISSION, replay = false) {
  const data = Buffer.from(ORIGINAL_DATA);
  let idempotent = ORIGINAL_IDEMPOTENT;
  if (!replay) {
    const ik = freshIk(label);
    ik.copy(data, IK_OFFSET);
    idempotent = PublicKey.findProgramAddressSync([ik, Buffer.from('mint')], PROGRAM)[0];
  }
  data.writeBigUInt64LE(amount, AMOUNT_OFFSET);
  return new TransactionInstruction({ programId: PROGRAM, keys: [
    { pubkey: MINT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_INFO, isSigner: false, isWritable: false },
    { pubkey: CONTROLLER_MINT_ATA, isSigner: false, isWritable: true },
    { pubkey: permission, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: authoritySigner, isWritable: true },
    { pubkey: idempotent, isSigner: false, isWritable: true },
    { pubkey: PAYER, isSigner: true, isWritable: true },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
    { pubkey: SYSTEM, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PROGRAM, isSigner: false, isWritable: false },
    { pubkey: DESTINATION, isSigner: false, isWritable: true },
  ], data });
}

function substituted(label, index, pubkey) {
  const ix = mintInstruction(label, 1n);
  ix.keys[index] = { ...ix.keys[index], pubkey };
  return ix;
}

function decodeAccount(account, kind) {
  if (!account?.data) return null;
  const data = Buffer.from(account.data[0], 'base64');
  if (kind === 'mint') return data.length >= 44 ? data.readBigUInt64LE(36).toString() : null;
  return data.length >= 72 ? data.readBigUInt64LE(64).toString() : null;
}

async function simulate(label, instructions, blockhash) {
  const encoded = encodeV1(instructions, blockhash);
  const result = await rpc('simulateTransaction', [encoded.wire.toString('base64'), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
    innerInstructions: true,
    accounts: { encoding: 'base64', addresses: [MINT.toBase58(), CONTROLLER_MINT_ATA.toBase58(), DESTINATION.toBase58()] },
  }]);
  return { label, simulationSlot: result.context?.slot ?? null, err: result.value?.err ?? null,
    unitsConsumed: result.value?.unitsConsumed ?? null,
    supplyPostRaw: decodeAccount(result.value?.accounts?.[0], 'mint'),
    controllerMintAtaPostRaw: decodeAccount(result.value?.accounts?.[1], 'token'),
    destinationPostRaw: decodeAccount(result.value?.accounts?.[2], 'token'),
    logs: (result.value?.logs || []).filter((line) => /Instruction:|Error|failed|MOVEUSD|EmiytJ/.test(line)),
    ...encoded, wire: undefined };
}

async function main() {
  const beforeResponse = await rpc('getMultipleAccounts', [[MINT.toBase58(), CONTROLLER_MINT_ATA.toBase58(), DESTINATION.toBase58()],
    { encoding: 'base64', commitment: 'confirmed' }]);
  const before = {
    slot: beforeResponse.context.slot,
    supplyRaw: decodeAccount(beforeResponse.value[0], 'mint'),
    controllerMintAtaRaw: decodeAccount(beforeResponse.value[1], 'token'),
    destinationRaw: decodeAccount(beforeResponse.value[2], 'token'),
  };
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const specs = [
    ['operator_equivalent_fresh_mint_1', [mintInstruction('fresh-1', 1n)]],
    ['outsider_substitutes_authority_against_operator_permission',
      [mintInstruction('outsider-authority', 1n, OUTSIDER, true, PERMISSION)]],
    ['operator_account_not_marked_signer',
      [mintInstruction('missing-signer', 1n, OPERATOR, false, PERMISSION)]],
    ['replay_completed_mint_id', [mintInstruction('replay', 200_000_000_000n, OPERATOR, true, PERMISSION, true)]],
    ['token_info_substituted_with_system_program', [substituted('wrong-token-info', 1, SYSTEM)]],
    ['mint_substituted_with_usdc', [substituted('wrong-mint', 0, USDC)]],
    ['controller_mint_ata_substituted_with_system_program', [substituted('wrong-mint-ata', 2, SYSTEM)]],
    ['token_program_substituted_with_system_program', [substituted('wrong-token-program', 7, SYSTEM)]],
    ['operator_equivalent_zero_amount', [mintInstruction('zero', 0n)]],
    ['operator_equivalent_u64_max', [mintInstruction('u64-max', (1n << 64n) - 1n)]],
  ];
  const results = [];
  for (const [label, instructions] of specs) {
    try {
      const result = await simulate(label, instructions, blockhash);
      results.push(result);
      process.stdout.write(`${JSON.stringify({ label, err: result.err, bytes: result.sizeBytes,
        supplyPostRaw: result.supplyPostRaw, controllerMintAtaPostRaw: result.controllerMintAtaPostRaw,
        destinationPostRaw: result.destinationPostRaw, logs: result.logs.slice(-4) })}\n`);
    } catch (error) {
      results.push({ label, localError: error.stack || error.message });
      process.stdout.write(`${JSON.stringify({ label, localError: error.message })}\n`);
    }
  }
  const output = {
    generatedAt: new Date().toISOString(),
    transport: 'current-mainnet read-only simulateTransaction; unsigned custom Solana v1; sigVerify=false; no sendTransaction',
    programId: PROGRAM.toBase58(),
    sourceTransaction: '5voEfq87WCsH2mayahu3NkA7fMaPsSur92dXvE7mFu7pqB3fxAcckT3k1e7GY5ScVuURapckrZ2V2ypBohw9mGDQ',
    before,
    importantInterpretation: 'Cases retaining OPERATOR as a declared signer bypass cryptographic signature verification only to exercise current program logic; they are operator-equivalent controls and not outsider attack paths.',
    results,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
