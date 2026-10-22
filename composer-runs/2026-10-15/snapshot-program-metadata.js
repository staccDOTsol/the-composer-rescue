#!/usr/bin/env node
// Read-only Upgradeable Loader metadata and deployed-payload hashes.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const OUT = process.argv[2] || path.join(__dirname, 'native-stake-program-metadata.json');
const programIds = process.argv.slice(3);
if (!programIds.length) throw new Error('usage: node snapshot-program-metadata.js OUTPUT PROGRAM...');

async function rpc(method, params) {
  const response = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

(async () => {
  const entries = [];
  for (const programId of programIds) {
    const programResult = await rpc('getAccountInfo', [programId, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!programResult.value) throw new Error(`missing program ${programId}`);
    const programData = Buffer.from(programResult.value.data[0], 'base64');
    if (programData.readUInt32LE(0) !== 2 || programData.length < 36) throw new Error(`${programId} is not an upgradeable Program account`);
    const programDataAddress = new PublicKey(programData.subarray(4, 36)).toBase58();
    const dataResult = await rpc('getAccountInfo', [programDataAddress, { encoding: 'base64', commitment: 'confirmed' }]);
    const raw = Buffer.from(dataResult.value.data[0], 'base64');
    if (raw.readUInt32LE(0) !== 3 || raw.length < 13) throw new Error(`${programDataAddress} is not ProgramData`);
    const deploySlot = Number(raw.readBigUInt64LE(4));
    const hasAuthority = raw[12] === 1;
    const metadataLength = hasAuthority ? 45 : 13;
    const upgradeAuthority = hasAuthority ? new PublicKey(raw.subarray(13, 45)).toBase58() : null;
    const payload = raw.subarray(metadataLength);
    entries.push({
      programId,
      observationSlot: dataResult.context.slot,
      programDataAddress,
      upgradeAuthority,
      lastDeployedSlot: deploySlot,
      allocatedProgramDataBytes: raw.length,
      payloadBytes: payload.length,
      payloadSha256: sha256(payload),
      nonzeroPayloadBytes: payload.findLastIndex((byte) => byte !== 0) + 1,
      nonzeroPayloadSha256: sha256(payload.subarray(0, payload.findLastIndex((byte) => byte !== 0) + 1)),
    });
  }
  const output = { generatedAt: new Date().toISOString(), entries };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
