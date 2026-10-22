#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PublicKey } = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');

const OUT = __dirname;
const PROGRAM = 'vesFcnNXtfS9JMtspbe9SkMJiRiSPwsywuWMjYwxQ2K';
const PROGRAMDATA = '8AqtoCE2PmJWAokHWyKMq83NjDBK7G6gRr7AJpFrQeSi';
const TXS = [
  '4Mu2FnrUCfkvbmVAwza1p1cGvgxQcy7Y2PgezY5xC7xLix2tbg95gDkm8VFdLL5dwKRoCWR5dqPmgvd9MxkKRmnn',
  '5VekvbfQbubTb4YHq2Axf74zZAdEKh3Ec8LsZvybin95ZKQBT9VHjhZ2Wj411gNDxLrQMJYQs4xmdo8HWVp3p2Vv',
  'R3oMcgFqMbCKHMU8C2zG5ueXacWdnxLg5WUAiB8SbxCPGXeDTGyEYNjVmFkE1twkiScxt8rqdmZBCg91ETJJyc1',
];
const ACCOUNTS = [
  PROGRAM,
  PROGRAMDATA,
  'EL4CpiRgYZVmSs3SvAdJTAcnBogVUzrNDTyzWz2JNTk3',
  '6hmV2nDeHQVxoa71C9HmvnYvg7zFck2s2YdGGSC3AYRM',
  'Ftk41smBgQ5tiFsDpBatfofHjYgpS4TcnzwDdw1CsaTC',
  'C7J4nzXwVJpPRhSW43EUNomPci7tMjjzrGT93BYuMho',
  'ACNRX3TfWSc4xB6xgeXt4KXkAXGZi1z1xwSYwEr2NDmb',
  '5uhhtkZcVESLWf29iFbaPy7fCA5FScVp4GVtPWQs2j8i',
  '5kvAV9qe893pkjoFXCjS3pcF5xW7j615yqH7uhURp3Jf',
  '2Wu1g2ft7qZHfTpfzP3wLdfPeV1is4EwQ3CXBfRYAciD',
];

function rpcEndpoint() {
  const lines = fs.readFileSync('/tmp/composer-helius-rpc.env', 'utf8').split(/\r?\n/);
  const match = lines.find((line) => line.startsWith('RPC_URL='));
  if (!match) throw new Error('RPC_URL unavailable');
  return match.slice('RPC_URL='.length);
}

let sequence = 0;
async function rpc(method, params) {
  const response = await fetch(rpcEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function summarizeAccount(address, account) {
  if (!account) return { address, exists: false };
  const bytes = Buffer.from(account.data[0], 'base64');
  return {
    address,
    exists: true,
    owner: account.owner,
    executable: account.executable,
    lamports: account.lamports,
    dataLength: bytes.length,
    dataSha256: sha256(bytes),
    dataBase64: account.data[0],
  };
}

async function main() {
  const multiple = await rpc('getMultipleAccounts', [ACCOUNTS, {
    encoding: 'base64',
    commitment: 'confirmed',
  }]);
  const accounts = ACCOUNTS.map((address, index) => summarizeAccount(address, multiple.value[index]));
  const programData = accounts.find((row) => row.address === PROGRAMDATA);
  const programDataBytes = Buffer.from(programData.dataBase64, 'base64');
  const programDataTag = programDataBytes.readUInt32LE(0);
  const deploymentSlot = Number(programDataBytes.readBigUInt64LE(4));
  const authorityOption = programDataBytes[12];
  const elfOffset = authorityOption === 0 ? 13 : 45;
  const upgradeAuthority = authorityOption === 0 ? null : new PublicKey(programDataBytes.subarray(13, 45)).toBase58();
  const elf = programDataBytes.subarray(elfOffset);
  fs.writeFileSync(path.join(OUT, 'vesfcn-current.so'), elf);

  const transactions = [];
  for (const signature of TXS) {
    const parsed = await rpc('getTransaction', [signature, {
      encoding: 'jsonParsed',
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }]);
    const raw = await rpc('getTransaction', [signature, {
      encoding: 'base64',
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }]);
    const rawBytes = raw ? Buffer.from(raw.transaction[0], 'base64') : null;
    transactions.push({
      signature,
      parsed,
      rawTransactionBase64: raw?.transaction?.[0] || null,
      rawTransactionBytes: rawBytes?.length ?? null,
      rawTransactionSha256: rawBytes ? sha256(rawBytes) : null,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    commitment: 'confirmed',
    observationSlot: multiple.context.slot,
    programId: PROGRAM,
    programdataAddress: PROGRAMDATA,
    programDataTag,
    deploymentSlot,
    upgradeAuthority,
    elfOffset,
    elfLength: elf.length,
    elfSha256: sha256(elf),
    accounts,
    transactions,
  };
  fs.writeFileSync(path.join(OUT, 'vesfcn-chain-evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    generatedAt: output.generatedAt,
    observationSlot: output.observationSlot,
    deploymentSlot,
    upgradeAuthority,
    elfLength: elf.length,
    elfSha256: output.elfSha256,
    transactionSlots: transactions.map((row) => ({
      signature: row.signature,
      slot: row.parsed?.slot ?? null,
      err: row.parsed?.meta?.err ?? null,
      bytes: row.rawTransactionBytes,
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
