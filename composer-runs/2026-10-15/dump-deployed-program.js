#!/usr/bin/env node
// Read-only dump of an Upgradeable Loader program's current ProgramData payload.

const fs = require('fs');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error('set RPC_URL');
const [programId, outputPath] = process.argv.slice(2);
if (!programId || !outputPath) throw new Error('usage: node dump-deployed-program.js PROGRAM_ID OUTPUT_SO');

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

(async () => {
  const program = await rpc('getAccountInfo', [programId, { encoding: 'base64', commitment: 'confirmed' }]);
  const programRaw = Buffer.from(program.value.data[0], 'base64');
  if (programRaw.readUInt32LE(0) !== 2) throw new Error('not an Upgradeable Loader Program account');
  const programDataAddress = new PublicKey(programRaw.subarray(4, 36)).toBase58();
  const result = await rpc('getAccountInfo', [programDataAddress, { encoding: 'base64', commitment: 'confirmed' }]);
  const raw = Buffer.from(result.value.data[0], 'base64');
  if (raw.readUInt32LE(0) !== 3) throw new Error('not a ProgramData account');
  const metadataBytes = raw[12] === 1 ? 45 : 13;
  const payload = raw.subarray(metadataBytes);
  fs.writeFileSync(outputPath, payload);
  console.log(JSON.stringify({
    programId,
    programDataAddress,
    observationSlot: result.context.slot,
    outputPath,
    payloadBytes: payload.length,
    payloadSha256: crypto.createHash('sha256').update(payload).digest('hex'),
  }, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
