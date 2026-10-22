// Read-only mainnet transaction decompilation; never submits a transaction.
const fs = require('fs');
const {Connection, VersionedTransaction, TransactionMessage} = require('/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/@solana/web3.js');
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const url = env.HEAVY_RPC_URL || env.RPC_URL;
const connection = new Connection(url, 'confirmed');
const signature = process.env.SOURCE_SIGNATURE || 'vYM2KYraryaF9navrBZdHFnnoyU8axeuQFnm4YVMLwkGL4qTeyLVHUmuxQmcam3NcXtrt2inJpdu1gq19n4HT7v';
(async () => {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature,
      {encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1}]})});
  const json = await response.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  const raw = json.result;
  if (!raw) throw new Error('Source transaction unavailable');
  const tx = VersionedTransaction.deserialize(Buffer.from(raw.transaction[0], 'base64'));
  const alts = await Promise.all((tx.message.addressTableLookups || []).map(async item => {
    const x = await connection.getAddressLookupTable(item.accountKey);
    if (!x.value) throw new Error('Source lookup table unavailable: ' + item.accountKey);
    return x.value;
  }));
  const msg = TransactionMessage.decompile(tx.message, {addressLookupTableAccounts: alts});
  const output = {signature, slot: raw.slot, version: raw.version, payer: msg.payerKey.toBase58(),
    error: raw.meta.err, signerCount: tx.message.header.numRequiredSignatures,
    instructions: msg.instructions.map((ix, index) => ({index, program: ix.programId.toBase58(),
      dataHex: Buffer.from(ix.data).toString('hex'), dataLength: ix.data.length,
      keys: ix.keys.map((key, keyIndex) => ({keyIndex, address: key.pubkey.toBase58(),
        signer: key.isSigner, writable: key.isWritable}))})),
    logs: raw.meta.logMessages};
  const path = process.env.SOURCE_OUTPUT || 'composer-runs/2026-10-15/flashloan-source-introspect.json';
  fs.writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({...output, logs: output.logs?.slice(0, 30)}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
