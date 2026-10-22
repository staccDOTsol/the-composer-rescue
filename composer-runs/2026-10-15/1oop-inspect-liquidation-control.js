#!/usr/bin/env node
// Read-only inspection of a successful post-deployment Loopscale liquidation.
// RPC methods are getTransaction/getMultipleAccounts only; no signing or submission.

const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, VersionedTransaction, TransactionMessage} = require(modules + '@solana/web3.js');
const anchor = require(modules + '@coral-xyz/anchor');
const b58mod = require(modules + 'bs58');
const bs58 = b58mod.default || b58mod;

const ROOT = __dirname;
const PROGRAM = new PublicKey('1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78');
const DEFAULT_SIGNATURE = '2rQzpZa1JtmVPesFVq8RySWXD2NqDsGvixVR9WAzZy3uBH3qJWsUCcmVGGwaBiW5SmQANKQ6npGTH4zzHF18bMkt';
const SIGNATURE = process.argv[2] || DEFAULT_SIGNATURE;
const OUTPUT = process.argv[3] || `${ROOT}/1oop-liquidation-positive-control.json`;
const idl = JSON.parse(fs.readFileSync(`${ROOT}/1oop-loopscale-idl-0.9.30.json`, 'utf8'));
const instructionCoder = new anchor.BorshInstructionCoder(idl);

function rpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
    .split(/\n/).filter((line) => line.includes('='))
    .map((line) => line.split(/=(.*)/s).slice(0, 2)));
  if (!env.RPC_URL) throw new Error('RPC_URL unavailable');
  return env.RPC_URL;
}

let rpcId = 0;
async function rpc(method, params) {
  const response = await fetch(rpcUrl(), {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const publicKeyText = (value) => value instanceof PublicKey ? value.toBase58() : String(value);
function jsonSafe(value) {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

async function main() {
  const raw = await rpc('getTransaction', [SIGNATURE, {
    encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  const parsed = await rpc('getTransaction', [SIGNATURE, {
    encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1,
  }]);
  if (!raw || !parsed) throw new Error('positive-control transaction unavailable');
  const wireBytes = Buffer.from(raw.transaction[0], 'base64');
  const transaction = VersionedTransaction.deserialize(wireBytes);
  const lookups = await Promise.all((transaction.message.addressTableLookups || []).map(async ({accountKey}) => {
    const row = await rpc('getAccountInfo', [accountKey.toBase58(), {encoding: 'base64', commitment: 'confirmed'}]);
    return {accountKey, row};
  }));
  const {AddressLookupTableAccount} = require(modules + '@solana/web3.js');
  const lookupAccounts = lookups.map(({accountKey, row}) => {
    if (!row?.value?.data) throw new Error(`lookup table unavailable: ${accountKey}`);
    return new AddressLookupTableAccount({
      key: accountKey,
      state: AddressLookupTableAccount.deserialize(Buffer.from(row.value.data[0], 'base64')),
    });
  });
  const decompiled = TransactionMessage.decompile(transaction.message, {addressLookupTableAccounts: lookupAccounts});
  const loopscale = [];
  decompiled.instructions.forEach((instruction, outerInstructionIndex) => {
    if (!instruction.programId.equals(PROGRAM)) return;
    const decoded = instructionCoder.decode(instruction.data);
    const definition = decoded && idl.instructions.find((entry) => entry.name === decoded.name);
    loopscale.push({
      outerInstructionIndex,
      name: decoded?.name || null,
      dataBase58: bs58.encode(instruction.data),
      dataHex: instruction.data.toString('hex'),
      decodedArgs: jsonSafe(decoded?.data || null),
      accounts: instruction.keys.map((key, index) => ({
        index,
        name: definition?.accounts?.[index]?.name || `remaining_${index - (definition?.accounts?.length || 0)}`,
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
    });
  });
  const signers = parsed.transaction.message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey);
  const tokenDeltas = (parsed.meta.preTokenBalances || []).map((before) => {
    const after = (parsed.meta.postTokenBalances || []).find((row) => row.accountIndex === before.accountIndex);
    if (!after) return null;
    return {
      accountIndex: before.accountIndex,
      owner: before.owner,
      mint: before.mint,
      preRaw: before.uiTokenAmount.amount,
      postRaw: after.uiTokenAmount.amount,
      deltaRaw: (BigInt(after.uiTokenAmount.amount) - BigInt(before.uiTokenAmount.amount)).toString(),
    };
  }).filter(Boolean).filter((row) => row.deltaRaw !== '0');
  const output = {
    generatedAt: new Date().toISOString(),
    scope: 'read-only inspection; no signing or submission',
    programId: PROGRAM.toBase58(),
    signature: SIGNATURE,
    slot: raw.slot,
    blockTime: raw.blockTime,
    transactionError: raw.meta.err,
    wireBytes: wireBytes.length,
    wireSha256: crypto.createHash('sha256').update(wireBytes).digest('hex'),
    signers,
    staticAccountCount: transaction.message.staticAccountKeys.length,
    loadedWritableCount: raw.meta.loadedAddresses?.writable?.length || 0,
    loadedReadonlyCount: raw.meta.loadedAddresses?.readonly?.length || 0,
    loopscaleInstructions: loopscale,
    tokenDeltas,
    logMessages: raw.meta.logMessages,
    innerInstructions: parsed.meta.innerInstructions,
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    output: OUTPUT, slot: output.slot, signers, wireBytes: output.wireBytes,
    loopscale: loopscale.map((entry) => ({name: entry.name, index: entry.outerInstructionIndex, accounts: entry.accounts.length, decodedArgs: entry.decodedArgs})),
    tokenDeltas,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
