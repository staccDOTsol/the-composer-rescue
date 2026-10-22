#!/usr/bin/env node

const fs = require('fs');
const {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA');
const baseDir = __dirname;
const controls = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-replay-controls.json`, 'utf8')).successfulReplays;
const idl = JSON.parse(fs.readFileSync(`${baseDir}/marginfi-source/fuzz/crucible/idls/marginfi_program.json`, 'utf8'));
const rpcUrl = process.env.RPC_URL;
if (!rpcUrl) throw new Error('RPC_URL is required');

const discriminatorToName = new Map(idl.instructions.map((ix) => [Buffer.from(ix.discriminator).toString('hex'), ix.name]));

async function rawTransaction(signature) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, {encoding: 'base64', maxSupportedTransactionVersion: 0}],
    }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return VersionedTransaction.deserialize(Buffer.from(body.result.transaction[0], 'base64'));
}

async function main() {
  const connection = new Connection(rpcUrl, 'confirmed');
  for (const [target, control] of Object.entries(controls)) {
    const transaction = await rawTransaction(control.signature);
    const lookups = await Promise.all(transaction.message.addressTableLookups.map(async ({accountKey}) => {
      const result = await connection.getAddressLookupTable(accountKey);
      if (!result.value) throw new Error(`missing ALT ${accountKey}`);
      return result.value;
    }));
    const message = TransactionMessage.decompile(transaction.message, {addressLookupTableAccounts: lookups});
    process.stdout.write(`\n${target} ${control.signature} instructions=${message.instructions.length}\n`);
    message.instructions.forEach((ix, index) => {
      const marginfiName = ix.programId.equals(PROGRAM_ID)
        ? discriminatorToName.get(ix.data.subarray(0, 8).toString('hex')) || 'unknown'
        : '';
      process.stdout.write(`${index} ${ix.programId} ${marginfiName} keys=${ix.keys.length} data=${ix.data.length}\n`);
      if (marginfiName) {
        ix.keys.slice(0, 9).forEach((key, keyIndex) => {
          process.stdout.write(`  ${keyIndex}: ${key.pubkey} signer=${key.isSigner} writable=${key.isWritable}\n`);
        });
      }
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
