#!/usr/bin/env node
// Lightweight end-of-audit mainnet identity check. Read-only RPC only.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey } = require(path.join(MOD, '@solana/web3.js'));

const PROGRAM = 'EmiytJ3zWX9koH3emPsWDEs9RqNm6NNFp4CkMLoiA1KC';
const PROGRAM_DATA = 'DybKXmycEuZDF4u8EVxr21Ljza9dEHKF6CKJ9G91zMMY';
const MINT = '3AdhVEX6k85yNivHVXDEiY3WyP2WgFQTUZCahGaeC2qm';
const VAULT = '9LbzSsqxTyaa9dA9nVv7oBaZy85qJuAonX7wCuEaXoXX';
const EXPECTED_HASH = '68374147fe8a5038882db50120cf61a242394aa8caf6da27d15d1c2ea9210a81';
const OUT = path.join(__dirname, 'moveusd-final-check.json');

function endpoint() {
  const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
  const env = Object.fromEntries(lines.filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL unavailable');
  return env.RPC_URL;
}

function key(buffer) {
  return new PublicKey(buffer).toBase58();
}

async function main() {
  const response = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [
      [PROGRAM, PROGRAM_DATA, MINT, VAULT], { encoding: 'base64', commitment: 'confirmed' },
    ] }) });
  const body = await response.json();
  if (body.error) throw new Error(`${body.error.code} ${body.error.message}`);
  const [programAccount, programDataAccount, mintAccount, vaultAccount] = body.result.value;
  if (![programAccount, programDataAccount, mintAccount, vaultAccount].every(Boolean)) {
    throw new Error('one or more required accounts unavailable');
  }
  const program = Buffer.from(programAccount.data[0], 'base64');
  const programData = Buffer.from(programDataAccount.data[0], 'base64');
  const mint = Buffer.from(mintAccount.data[0], 'base64');
  const vault = Buffer.from(vaultAccount.data[0], 'base64');
  const programDataAddress = key(program.subarray(4, 36));
  const authorityOption = programData.readUInt8(12);
  const metadataLength = authorityOption === 1 ? 45 : 13;
  const payload = programData.subarray(metadataLength);
  const payloadSha256 = crypto.createHash('sha256').update(payload).digest('hex');
  const output = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noTransactionConstructedOrSubmitted: true,
    contextSlot: body.result.context.slot,
    program: { address: PROGRAM, owner: programAccount.owner, executable: programAccount.executable,
      loaderStateTag: program.readUInt32LE(0), programDataAddress },
    programData: { address: PROGRAM_DATA, owner: programDataAccount.owner,
      loaderStateTag: programData.readUInt32LE(0), lastDeployedSlot: Number(programData.readBigUInt64LE(4)),
      upgradeAuthority: authorityOption === 1 ? key(programData.subarray(13, 45)) : null,
      payloadBytes: payload.length, payloadSha256 },
    mint: { address: MINT, owner: mintAccount.owner, supplyRaw: mint.readBigUInt64LE(36).toString(),
      decimals: mint.readUInt8(44), mintAuthority: mint.readUInt32LE(0) === 1 ? key(mint.subarray(4, 36)) : null,
      freezeAuthority: mint.readUInt32LE(46) === 1 ? key(mint.subarray(50, 82)) : null },
    vault: { address: VAULT, owner: vaultAccount.owner, mint: key(vault.subarray(0, 32)),
      authority: key(vault.subarray(32, 64)), amountRaw: vault.readBigUInt64LE(64).toString() },
    matchesAuditSnapshot: { programDataAddress: programDataAddress === PROGRAM_DATA,
      payloadSha256: payloadSha256 === EXPECTED_HASH, lastDeployedSlot: Number(programData.readBigUInt64LE(4)) === 449520764,
      mint: key(vault.subarray(0, 32)) === MINT },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
