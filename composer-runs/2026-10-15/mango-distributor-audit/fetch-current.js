#!/usr/bin/env node
'use strict';

// Read-only current-mainnet evidence capture for the Mango distributor.
// This script only calls account-reading RPC methods and never constructs,
// signs, simulates, or submits a transaction.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  PublicKey,
} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const DIR = __dirname;
const PROGRAM = new PublicKey('DisJzzeTrLXzJgtaaqBxcNKLrLFyc4mY3ELGCdEkVPzt');
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const KNOWN = [
  '3JaWRPs677Q22oLz3xT1rPD7yhCEL3Njp9raruM81VCS',
  'AgLqWkeqAVrQbj1tMuTAtAao1oRVXScVjrPRmBC5AxeY',
  '4NcjVs9xEsP7ny7Ku9fAxBdEgA7vPgWTDhssSs7v6bsd',
  'EukVHqQDMUy8La6R9KR7PHPh5YYmBZt8XoYNuYvmWXsE',
  '27BKiiUbJAUXBZSAs7defx1BDPmciWLf7kCoLiNfHajm',
  '5rjkXaWbou7xhgFdBknuUG3g1ZgNHn61Ae1pigCKyv7',
  'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  'MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY',
  '6DNSN2BJsaPFdFFc1zP37kkeNe4Usc1Sqkzr9C9vPWcU',
];

const env = Object.fromEntries(
  fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8')
    .split(/\n/)
    .filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
const RPC = process.env.RPC_URL || env.RPC_URL || env.HEAVY_RPC_URL;
if (!RPC) throw new Error('missing RPC endpoint configuration');

let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${method}: ${response.status} ${JSON.stringify(body.error || body)}`);
  }
  return body.result;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pubkey = (bytes) => new PublicKey(bytes).toBase58();

function image(address, account, includeData = true) {
  if (!account) return { address, exists: false };
  const data = Buffer.from(account.data[0], 'base64');
  const out = {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: data.length,
    dataSha256: sha256(data),
  };
  if (account.owner === TOKEN_PROGRAM && data.length >= 165) {
    out.kind = 'spl-token-account';
    out.mint = pubkey(data.subarray(0, 32));
    out.tokenAuthority = pubkey(data.subarray(32, 64));
    out.rawAmount = data.readBigUInt64LE(64).toString();
  }
  if (includeData) out.dataBase64 = data.toString('base64');
  return out;
}

async function anchorIdl() {
  const base = PublicKey.findProgramAddressSync([], PROGRAM)[0];
  const address = await PublicKey.createWithSeed(base, 'anchor:idl', PROGRAM);
  const response = await rpc('getAccountInfo', [address.toBase58(), {
    encoding: 'base64', commitment: 'finalized',
  }]);
  if (!response.value) return { slot: response.context.slot, address: address.toBase58(), exists: false };
  const bytes = Buffer.from(response.value.data[0], 'base64');
  const authority = pubkey(bytes.subarray(8, 40));
  const compressedLength = bytes.readUInt32LE(40);
  const compressed = bytes.subarray(44, 44 + compressedLength);
  const idl = JSON.parse(zlib.inflateSync(compressed).toString('utf8'));
  fs.writeFileSync(path.join(DIR, 'current-idl.json'), `${JSON.stringify(idl, null, 2)}\n`);
  return {
    slot: response.context.slot,
    address: address.toBase58(),
    exists: true,
    owner: response.value.owner,
    authority,
    accountLength: bytes.length,
    compressedLength,
    idlName: idl.name,
    idlVersion: idl.version,
  };
}

async function main() {
  const programResponse = await rpc('getAccountInfo', [PROGRAM.toBase58(), {
    encoding: 'base64', commitment: 'finalized',
  }]);
  const programBytes = Buffer.from(programResponse.value.data[0], 'base64');
  if (programBytes.readUInt32LE(0) !== 2) throw new Error('program is not upgradeable-loader Program state');
  const programDataAddress = pubkey(programBytes.subarray(4, 36));
  const programDataResponse = await rpc('getAccountInfo', [programDataAddress, {
    encoding: 'base64', commitment: 'finalized',
  }]);
  const programDataBytes = Buffer.from(programDataResponse.value.data[0], 'base64');
  if (programDataBytes.readUInt32LE(0) !== 3) throw new Error('program data is not upgradeable-loader ProgramData state');
  const hasAuthority = programDataBytes[12] === 1;
  const metadataLength = hasAuthority ? 45 : 13;
  const elf = programDataBytes.subarray(metadataLength);
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error('ProgramData payload is not ELF');
  fs.writeFileSync(path.join(DIR, 'current.so'), elf);

  const knownResponse = await rpc('getMultipleAccounts', [KNOWN, {
    encoding: 'base64', commitment: 'finalized',
  }]);
  const programAccountsResponse = await rpc('getProgramAccounts', [PROGRAM.toBase58(), {
    encoding: 'base64', commitment: 'finalized', withContext: true,
  }]);
  const idl = await anchorIdl();

  const metadata = {
    fetchedAt: new Date().toISOString(),
    commitment: 'finalized',
    program: PROGRAM.toBase58(),
    programAccount: image(PROGRAM.toBase58(), programResponse.value, false),
    programObservationSlot: programResponse.context.slot,
    programDataAddress,
    programData: {
      observationSlot: programDataResponse.context.slot,
      upgradeSlot: Number(programDataBytes.readBigUInt64LE(4)),
      upgradeAuthority: hasAuthority ? pubkey(programDataBytes.subarray(13, 45)) : null,
      accountLength: programDataBytes.length,
      elfLength: elf.length,
      elfSha256: sha256(elf),
    },
    anchorIdl: idl,
  };
  fs.writeFileSync(path.join(DIR, 'current-binary.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  const snapshot = {
    fetchedAt: metadata.fetchedAt,
    commitment: 'finalized',
    knownAccountsSlot: knownResponse.context.slot,
    knownAccounts: Object.fromEntries(KNOWN.map((address, index) => [
      address, image(address, knownResponse.value[index]),
    ])),
    programAccountsSlot: programAccountsResponse.context.slot,
    programAccounts: programAccountsResponse.value.map(({ pubkey: address, account }) => image(address, account)),
  };
  fs.writeFileSync(path.join(DIR, 'current-state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({
    ...metadata,
    knownAccountsSlot: snapshot.knownAccountsSlot,
    programAccountsSlot: snapshot.programAccountsSlot,
    programAccountCount: snapshot.programAccounts.length,
    programAccountDataLengths: [...new Set(snapshot.programAccounts.map((entry) => entry.dataLength))].sort((a, b) => a - b),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
