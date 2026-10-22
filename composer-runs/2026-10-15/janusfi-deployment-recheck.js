#!/usr/bin/env node
'use strict';

// Fast, read-only identity recheck for the upgradeable JanusFI deployment.
// It intentionally writes no secret or RPC endpoint to its evidence file.

const crypto = require('crypto');
const fs = require('fs');
const {PublicKey} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const OUT = `${DIR}/janusfi-deployment-recheck.json`;
const ELF = `${DIR}/janusfi-current.so`;
const PROGRAM = new PublicKey('JanusXpm3gsW3c9ErNoUgHppL8dGLvZKB7uekkJEYFP');
const DFLOW = new PublicKey('DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => line.split(/=(.*)/s).slice(0, 2)));
const RPC_URL = env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC_URL) throw new Error('No read-only RPC configured');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const keyAt = (bytes, offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
let rpcId = 0;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function main() {
  const programResult = await rpc('getAccountInfo', [PROGRAM.toBase58(),
    {encoding: 'base64', commitment: 'confirmed'}]);
  const program = Buffer.from(programResult.value.data[0], 'base64');
  if (program.readUInt32LE(0) !== 2) throw new Error('Not an upgradeable Program account');
  const programDataAddress = keyAt(program, 4);
  const dataResult = await rpc('getAccountInfo', [programDataAddress,
    {encoding: 'base64', commitment: 'confirmed', minContextSlot: programResult.context.slot}]);
  const data = Buffer.from(dataResult.value.data[0], 'base64');
  if (data.readUInt32LE(0) !== 3) throw new Error('Not an upgradeable ProgramData account');
  const hasAuthority = data[12] === 1;
  const metadataBytes = hasAuthority ? 45 : 13;
  const onChainElf = data.subarray(metadataBytes);
  const localElf = fs.readFileSync(ELF);
  const [eventAuthority, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')], DFLOW);
  const output = {
    generatedAt: new Date().toISOString(), readOnly: true, liveSubmission: false,
    observationSlots: {program: programResult.context.slot, programData: dataResult.context.slot},
    program: PROGRAM.toBase58(), programOwner: programResult.value.owner,
    programData: programDataAddress, deploySlot: data.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasAuthority ? keyAt(data, 13) : null, immutable: !hasAuthority,
    onChainElfBytes: onChainElf.length, onChainElfSha256: sha256(onChainElf),
    savedElfBytes: localElf.length, savedElfSha256: sha256(localElf),
    savedElfMatchesCurrentDeployment: onChainElf.equals(localElf),
    dflowProgram: DFLOW.toBase58(), dflowEventAuthority: eventAuthority.toBase58(),
    dflowEventAuthorityBump: bump, dflowEventAuthorityOnCurve:
      PublicKey.isOnCurve(eventAuthority.toBuffer()),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
