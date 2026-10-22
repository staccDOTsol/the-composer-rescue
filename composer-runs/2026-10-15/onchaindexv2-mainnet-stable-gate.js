#!/usr/bin/env node
'use strict';
// Two signed mainnet-beta simulations of the selected stable pool. No submission.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Keypair, PublicKey, TransactionInstruction, TransactionMessage,
  VersionedTransaction } = require(`${MOD}/@solana/web3.js`);
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require(`${MOD}/@solana/spl-token`);
const bs58 = require(`${MOD}/bs58`);
const P = value => new PublicKey(value);
const PROGRAM = '1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const STATE = '9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk';
const VAULT_USDC = 'HkGq6HSQZeoah15RbyYK2YF6bfCkNmAK4F5VDxYMiwJv';
const VAULT_USDT = 'PRYpoFwPHBcL82JGeqrU7czwmQiSHa9udbeTbtXLv7d';
const SOURCE = '3Tr8Zsi2YpJMkkmL36YxxEj8KFhor4mXc6kp9BDo2gobJsJBWpyhD7hYfz76FBjYTczVmcXLpaKYVvGsUJkxUF8t';
const OUT = `${__dirname}/onchaindexv2-mainnet-stable-gate.json`;

const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('mainnet RPC endpoint unavailable');
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(`${method}: ${JSON.stringify(result.error)}`);
  return result.result;
}
function image(account) {
  if (!account) return null;
  const b = Buffer.from(account.data[0], 'base64');
  const token = account.owner === String(TOKEN_PROGRAM_ID) && b.length >= 165;
  return { accountOwner: account.owner, lamports: account.lamports,
    mint: token ? String(new PublicKey(b.subarray(0, 32))) : null,
    tokenAuthority: token ? String(new PublicKey(b.subarray(32, 64))) : null,
    raw: token ? b.readBigUInt64LE(64).toString() : null,
    sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
async function source() {
  const tx = await rpc('getTransaction', [SOURCE, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  if (!tx || tx.meta.err) throw Error('historical Swap source unavailable');
  const m = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || { writable: [], readonly: [] };
  const keys = [...m.accountKeys, ...loaded.writable, ...loaded.readonly];
  const ix = tx.meta.innerInstructions.flatMap(g => g.instructions)
    .find(item => keys[item.programIdIndex] === PROGRAM && item.accounts.length >= 17 &&
      keys[item.accounts[0]] === STATE && keys[item.accounts[5]] === VAULT_USDC &&
      keys[item.accounts[6]] === VAULT_USDT);
  if (!ix) throw Error('selected Swap source instruction absent');
  const h = m.header, n = m.accountKeys.length;
  const writable = j => j < n ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < n - h.numReadonlyUnsignedAccounts : j < n + loaded.writable.length;
  return { slot: tx.slot, data: Buffer.from(bs58.decode(ix.data)),
    keys: ix.accounts.map(j => ({ pubkey: P(keys[j]), isSigner: j < h.numRequiredSignatures,
      isWritable: writable(j) })) };
}
function delta(before, after) {
  return before?.raw != null && after?.raw != null ?
    String(BigInt(after.raw) - BigInt(before.raw)) : null;
}
async function main() {
  const genesis = await rpc('getGenesisHash');
  const owner = String(signer.publicKey);
  const userUsdc = getAssociatedTokenAddressSync(P(USDC), signer.publicKey);
  const userUsdt = getAssociatedTokenAddressSync(P(USDT), signer.publicKey);
  const src = await source();
  const watch = [String(userUsdc), String(userUsdt), VAULT_USDC, VAULT_USDT, STATE];
  const before = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const pre = before.value.map(image);
  if (pre[4]?.accountOwner !== PROGRAM || PublicKey.isOnCurve(P(STATE).toBytes()))
    throw Error('selected pool authority is no longer program-owned/off-curve');
  for (const [index, mint, authority] of [[0, USDC, owner], [1, USDT, owner],
    [2, USDC, STATE], [3, USDT, STATE]]) {
    if (pre[index]?.accountOwner !== String(TOKEN_PROGRAM_ID) || pre[index]?.mint !== mint ||
      pre[index]?.tokenAuthority !== authority)
      throw Error(`selected token account no longer matches: ${watch[index]}`);
  }
  const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const cases = [];
  for (const [name, sourceAccount] of [
    ['own_empty_usdc_source', userUsdc], ['program_vault_as_user_source', P(VAULT_USDC)] ]) {
    const keys = src.keys.map((k, i) => ({ ...k,
      pubkey: i === 7 ? sourceAccount : i === 8 ? userUsdt : i === 9 ? signer.publicKey : k.pubkey,
      isSigner: i === 9 }));
    const ix = new TransactionInstruction({ programId: P(PROGRAM), keys, data: src.data });
    const message = new TransactionMessage({ payerKey: signer.publicKey,
      recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
    if (message.header.numRequiredSignatures !== 1 || String(message.staticAccountKeys[0]) !== owner)
      throw Error('an uncontrolled signer is required');
    const tx = new VersionedTransaction(message);
    tx.sign([signer]);
    const wire = Buffer.from(tx.serialize());
    if (wire.length > 1232) throw Error('wire size exceeds Solana packet limit');
    const result = await rpc('simulateTransaction', [wire.toString('base64'), {
      encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
      commitment: 'confirmed', innerInstructions: true,
      accounts: { encoding: 'base64', addresses: watch } }]);
    const post = (result.value.accounts || []).map(image);
    cases.push({ name, simulationSlot: result.context.slot, tx: { version: 0, bytes: wire.length,
      sigVerify: true, requiredSignatures: message.header.numRequiredSignatures,
      sha256: crypto.createHash('sha256').update(wire).digest('hex') },
      err: result.value.err, unitsConsumed: result.value.unitsConsumed,
      post, deltas: watch.map((_, i) => delta(pre[i], post[i])), logs: result.value.logs || [] });
  }
  const after = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const observedAfter = after.value.map(image);
  const report = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesisHash: genesis,
    program: PROGRAM, signer: owner, sourceSignature: SOURCE, sourceSlot: src.slot,
    intendedUsdcRaw: src.data.readBigUInt64LE(8).toString(), preSlot: before.context.slot,
    postReadSlot: after.context.slot, watch, pre, observedAfter,
    observedReadHashesMatch: pre.map((a, i) => a?.sha256 === observedAfter[i]?.sha256), cases };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, preSlot: report.preSlot, postReadSlot: report.postReadSlot,
    observedReadHashesMatch: report.observedReadHashesMatch,
    cases: cases.map(c => ({ name: c.name, simulationSlot: c.simulationSlot, err: c.err,
      unitsConsumed: c.unitsConsumed, logs: c.logs.filter(x => x.includes('Instruction:') ||
        x.includes('AnchorError') || x.includes('failed:') || x.includes('Error:')) })) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
