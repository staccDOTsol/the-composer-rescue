#!/usr/bin/env node
'use strict';

// Fork-only signed discriminator/argument-length probe for UpdateConfig. It
// discovers a deserializable payload without mutating mainnet, then proves the
// current configuration rejects a fresh outsider authority. No send path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const { encodeV1 } = require('../klend-v1-composition.js');

const P = (value) => new PublicKey(value);
const FORK = process.env.FOXY_FORK_RPC || 'http://127.0.0.1:9027';
const OUT = process.argv[2] || path.join(__dirname, 'update-config-signed-probe.json');
const PROGRAM = P('FoXpJL1exLBJgHVvdSHNKyKu2xX2uatctH9qp6dLmfpP');
const CONFIG = P('7N7M1H2CK51ip7sNtPgKhhv2eScx6BokLgHi1Ke3ZLiq');
const CONFIG_AUTHORITY = P('JDmUXLx1DKhz18UrEgMDwADyeixfNMWs8VepbM8gfipf');
const discriminator = crypto.createHash('sha256').update('global:update_config').digest().subarray(0, 8);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let id = 0;

async function rpc(method, params) {
  const response = await fetch(FORK, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

function sign(encoded, instruction, payer, keypair, blockhash) {
  const compiled = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash,
    instructions: [instruction] }).compileToV0Message();
  const signerOrder = compiled.staticAccountKeys.slice(0, encoded.requiredSignatures).map(String);
  if (signerOrder.length !== 1 || signerOrder[0] !== keypair.publicKey.toBase58()) {
    throw new Error(`unexpected signer order ${signerOrder.join(',')}`);
  }
  const wire = Buffer.from(encoded.wire);
  const message = wire.subarray(0, wire.length - 64);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]), format: 'der', type: 'pkcs8',
  });
  crypto.sign(null, message, privateKey).copy(wire, wire.length - 64);
  return { wire, signerOrder };
}

function updateIx(payload, authority, authoritySigner = true) {
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: CONFIG, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: authoritySigner, isWritable: false },
    ],
    data: Buffer.concat([discriminator, payload]),
  });
}

async function simulate(ix, payer, keypair, blockhash) {
  const encoded = encodeV1([ix], payer, blockhash);
  const signed = sign(encoded, ix, payer, keypair, blockhash);
  const result = await rpc('simulateTransaction', [signed.wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'processed', accounts: { encoding: 'base64', addresses: [CONFIG.toBase58()] },
  }]);
  return {
    err: result.value.err || null,
    unitsConsumed: result.value.unitsConsumed,
    logs: result.value.logs || [],
    simulationSlot: result.context.slot,
    wireBytes: encoded.sizeBytes,
    addressCount: encoded.addressCount,
    requiredSignatures: encoded.requiredSignatures,
    signerOrder: signed.signerOrder,
    wireSha256: sha256(signed.wire),
    signedBase64: signed.wire.toString('base64'),
  };
}

async function main() {
  const outsider = Keypair.generate();
  await rpc('surfnet_setAccount', [outsider.publicKey.toBase58(), {
    data: '', executable: false, lamports: 10_000_000_000,
    owner: SystemProgram.programId.toBase58(), rentEpoch: 0,
  }]);
  for (const address of [PROGRAM, CONFIG, CONFIG_AUTHORITY]) {
    await rpc('getAccountInfo', [address.toBase58(), { encoding: 'base64', commitment: 'processed' }]);
  }
  const before = await rpc('getAccountInfo', [CONFIG.toBase58(), { encoding: 'base64', commitment: 'processed' }]);
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'processed' }])).value.blockhash;
  const lengthProbes = [];
  let acceptedLength = null;
  for (let length = 0; length <= 160; length += 1) {
    const result = await simulate(updateIx(Buffer.alloc(length), outsider.publicKey),
      outsider.publicKey, outsider, blockhash);
    const tail = result.logs.slice(-5);
    const deserializationFailure = result.logs.some((line) =>
      line.includes('InstructionDidNotDeserialize') || line.includes('deserialize the given instruction'));
    lengthProbes.push({ length, ...result, logs: tail, deserializationFailure });
    if (!deserializationFailure) {
      acceptedLength = length;
      break;
    }
  }
  if (acceptedLength === null) throw new Error('no deserializable UpdateConfig payload through 160 bytes');
  const payload = Buffer.alloc(acceptedLength);
  const outsiderResult = lengthProbes.at(-1);
  // The real configured authority is deliberately not marked as a signer; the
  // fresh local payer remains the only cryptographic signer.
  const configuredNotSigner = await simulate(
    updateIx(payload, CONFIG_AUTHORITY, false), outsider.publicKey, outsider, blockhash,
  );
  const after = await rpc('getAccountInfo', [CONFIG.toBase58(), { encoding: 'base64', commitment: 'processed' }]);
  const beforeBytes = Buffer.from(before.value.data[0], 'base64');
  const afterBytes = Buffer.from(after.value.data[0], 'base64');
  const output = {
    generatedAt: new Date().toISOString(),
    environment: 'isolated current-mainnet Surfpool fork; simulateTransaction only',
    noMainnetSubmission: true,
    noForkSubmission: true,
    sigVerify: true,
    outsider: outsider.publicKey.toBase58(),
    programId: PROGRAM.toBase58(),
    config: CONFIG.toBase58(),
    configuredUpdateAuthority: CONFIG_AUTHORITY.toBase58(),
    discriminatorHex: discriminator.toString('hex'),
    firstDeserializableZeroPayloadBytes: acceptedLength,
    lengthProbes,
    outsiderResult,
    configuredAuthorityNotSignerResult: configuredNotSigner,
    configBeforeSha256: sha256(beforeBytes),
    configAfterSha256: sha256(afterBytes),
    forkConfigUnchanged: beforeBytes.equals(afterBytes),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: OUT,
    outsider: output.outsider,
    firstDeserializableZeroPayloadBytes: acceptedLength,
    outsider: {
      err: outsiderResult.err,
      wireBytes: outsiderResult.wireBytes,
      addressCount: outsiderResult.addressCount,
      lastLogs: outsiderResult.logs,
    },
    configuredAuthorityNotSigner: {
      err: configuredNotSigner.err,
      wireBytes: configuredNotSigner.wireBytes,
      addressCount: configuredNotSigner.addressCount,
      lastLogs: configuredNotSigner.logs.slice(-7),
    },
    forkConfigUnchanged: output.forkConfigUnchanged,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
