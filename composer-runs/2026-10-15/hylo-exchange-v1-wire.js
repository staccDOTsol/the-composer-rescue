// Minimal no-ALT Solana transaction-v1 encoder used by the Hylo read-only harness.
'use strict';

const crypto = require('crypto');
const bs58Module = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/bs58');
const bs58 = bs58Module.default || bs58Module;
const {
  TransactionMessage,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

function shortVecLength(value) {
  return value < 128 ? 1 : value < 16384 ? 2 : 3;
}

function encodeV1(instructions, payer, blockhash, computeLimit = 1_400_000, dataLimit = 67_108_864) {
  const v0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  if (v0.addressTableLookups.length) throw new Error('v1 harness does not use address lookup tables');
  const keys = v0.staticAccountKeys;
  const items = v0.compiledInstructions;
  if (keys.length > 64 || items.length > 64) throw new Error('Current transaction-v1 account/instruction limit');

  const v0Bytes = shortVecLength(v0.header.numRequiredSignatures)
    + 64 * v0.header.numRequiredSignatures
    + 1 + 3
    + shortVecLength(keys.length)
    + 32 * keys.length
    + 32
    + shortVecLength(items.length)
    + items.reduce((sum, instruction) => sum
      + 1
      + shortVecLength(instruction.accountKeyIndexes.length)
      + instruction.accountKeyIndexes.length
      + shortVecLength(instruction.data.length)
      + instruction.data.length, 0)
    + shortVecLength(0);

  const config = Buffer.alloc(8);
  config.writeUInt32LE(computeLimit, 0);
  config.writeUInt32LE(dataLimit, 4);
  const instructionHeaders = items.map(instruction => {
    const header = Buffer.alloc(4);
    header[0] = instruction.programIdIndex;
    header[1] = instruction.accountKeyIndexes.length;
    header.writeUInt16LE(instruction.data.length, 2);
    return header;
  });
  const instructionPayloads = items.map(instruction => Buffer.concat([
    Buffer.from(instruction.accountKeyIndexes),
    Buffer.from(instruction.data),
  ]));

  const wire = Buffer.concat([
    Buffer.from([
      0x81,
      v0.header.numRequiredSignatures,
      v0.header.numReadonlySignedAccounts,
      v0.header.numReadonlyUnsignedAccounts,
    ]),
    Buffer.from([0x0c, 0, 0, 0]),
    Buffer.from(bs58.decode(blockhash)),
    Buffer.from([items.length, keys.length]),
    ...keys.map(key => key.toBuffer()),
    config,
    ...instructionHeaders,
    ...instructionPayloads,
    Buffer.alloc(64 * v0.header.numRequiredSignatures),
  ]);
  if (wire.length > 4096) throw new Error(`v1 size limit exceeded: ${wire.length}`);

  return {
    wire,
    sizeBytes: wire.length,
    v0Bytes,
    addressCount: keys.length,
    writableCount: keys.length
      - v0.header.numReadonlySignedAccounts
      - v0.header.numReadonlyUnsignedAccounts,
    instructionCount: items.length,
    requiredSignatures: v0.header.numRequiredSignatures,
    config: {computeLimit, dataLimit},
  };
}

function signV1(encoded, instructions, payer, blockhash, keypairs) {
  const compiled = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys
    .slice(0, encoded.requiredSignatures)
    .map(String);
  const byAddress = new Map(keypairs.map(keypair => [keypair.publicKey.toBase58(), keypair]));
  const signed = Buffer.from(encoded.wire);
  const messageEnd = signed.length - 64 * encoded.requiredSignatures;
  const message = signed.subarray(0, messageEnd);

  for (let index = 0; index < signerOrder.length; index += 1) {
    const keypair = byAddress.get(signerOrder[index]);
    if (!keypair) throw new Error(`No controlled keypair for required signer ${signerOrder[index]}`);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(keypair.secretKey.subarray(0, 32)),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = crypto.sign(null, message, privateKey);
    signature.copy(signed, messageEnd + index * 64);
  }

  return {wire: signed, signerOrder};
}

module.exports = {encodeV1, signV1};
