#!/usr/bin/env node
'use strict';
// Read-only, signed mainnet-beta simulation. This script never submits a transaction.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  VersionedTransaction } = require(`${MOD}/@solana/web3.js`);
const { createSyncNativeInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require(`${MOD}/@solana/spl-token`);
const bs58 = require(`${MOD}/bs58`);

const PROGRAM = '1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SOL_SOURCE = 'VhVVHjjCivjq8pFXfBBj483JFsuoo4XhKzgM53aXBnh51TC1L17EsS2YMFLsmZYrrMLLwsedFyQ7aevcajVVgwk';
const STABLE_SOURCE = '3Tr8Zsi2YpJMkkmL36YxxEj8KFhor4mXc6kp9BDo2gobJsJBWpyhD7hYfz76FBjYTczVmcXLpaKYVvGsUJkxUF8t';
const SOL_IN = 250_000n;
const STABLE_IN = 10_000n;
const OUT = `${__dirname}/onchaindexv2-mainnet-signed-chain.json`;
const P = s => new PublicKey(s);

// The audit signer is loaded at runtime. Neither its bytes nor the endpoint are logged or saved.
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
function accountImage(account) {
  if (!account) return null;
  const b = Buffer.from(account.data[0], 'base64');
  const isToken = account.owner === String(TOKEN_PROGRAM_ID) && b.length >= 165;
  return { accountOwner: account.owner, lamports: account.lamports,
    mint: isToken ? String(new PublicKey(b.subarray(0, 32))) : null,
    tokenAuthority: isToken ? String(new PublicKey(b.subarray(32, 64))) : null,
    raw: isToken ? b.readBigUInt64LE(64).toString() : null,
    sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
async function sourceInstruction(signature, expectedState, expectedVaultX, expectedVaultY) {
  const tx = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
  if (!tx || tx.meta.err) throw Error(`historical source unavailable or failed: ${signature}`);
  const m = tx.transaction.message;
  const loaded = tx.meta.loadedAddresses || { writable: [], readonly: [] };
  const keys = [...m.accountKeys, ...loaded.writable, ...loaded.readonly];
  const candidates = tx.meta.innerInstructions.flatMap(g => g.instructions)
    .filter(ix => keys[ix.programIdIndex] === PROGRAM && ix.accounts.length >= 17);
  const source = candidates.find(ix => [expectedState, expectedVaultX, expectedVaultY]
    .every((key, i) => keys[ix.accounts[[0, 5, 6][i]]] === key));
  if (!source) throw Error(`historical Swap instruction absent: ${signature}`);
  const h = m.header, n = m.accountKeys.length;
  const writable = j => j < n ? j < h.numRequiredSignatures ?
    j < h.numRequiredSignatures - h.numReadonlySignedAccounts :
    j < n - h.numReadonlyUnsignedAccounts : j < n + loaded.writable.length;
  return { slot: tx.slot, data: Buffer.from(bs58.decode(source.data)),
    keys: source.accounts.map(j => ({ pubkey: P(keys[j]), isSigner: j < h.numRequiredSignatures, isWritable: writable(j) })) };
}
function swapIx(source, userX, userY, amountOverride) {
  const keys = source.keys.map((k, i) => ({ ...k,
    pubkey: i === 7 ? userX : i === 8 ? userY : i === 9 ? signer.publicKey : k.pubkey,
    isSigner: i === 9 }));
  const data = Buffer.from(source.data);
  if (amountOverride !== undefined) data.writeBigUInt64LE(amountOverride, 8);
  return new TransactionInstruction({ programId: P(PROGRAM), keys, data });
}
function delta(before, after) {
  return before?.raw != null && after?.raw != null ?
    (BigInt(after.raw) - BigInt(before.raw)).toString() : null;
}
async function main() {
  const genesis = await rpc('getGenesisHash');
  const wallet = String(signer.publicKey);
  const ata = Object.fromEntries([WSOL, USDC, USDT].map(mint =>
    [mint, getAssociatedTokenAddressSync(P(mint), signer.publicKey)]));
  const solState = '8vZHTVMdYvcPFUoHBEbcFyfSKnjWtvbNgYpXg1aiC2uS';
  const solVaultX = '29kNb3RA8am3762iv2HQFfExctFXCNiCLck35hK7yuzf';
  const solVaultY = '2ihzwyCXtBWsmyAZpkhixF7Tj5QUGrHsE4ucPNX1ZKVk';
  const stableState = '9P3N4QxjMumpTNNdvaNNskXu2t7VHMMXtePQB72kkSAk';
  const stableVaultX = 'HkGq6HSQZeoah15RbyYK2YF6bfCkNmAK4F5VDxYMiwJv';
  const stableVaultY = 'PRYpoFwPHBcL82JGeqrU7czwmQiSHa9udbeTbtXLv7d';
  const [solSource, stableSource] = await Promise.all([
    sourceInstruction(SOL_SOURCE, solState, solVaultX, solVaultY),
    sourceInstruction(STABLE_SOURCE, stableState, stableVaultX, stableVaultY) ]);
  const watch = [wallet, String(ata[WSOL]), String(ata[USDC]), String(ata[USDT]),
    solState, solVaultX, solVaultY, stableState, stableVaultX, stableVaultY];
  const preRpc = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const pre = preRpc.value.map(accountImage);
  for (const [stateIndex, vaultXIndex, vaultYIndex, mintX, mintY] of [
    [4, 5, 6, WSOL, USDC], [7, 8, 9, USDC, USDT]]) {
    const state = watch[stateIndex];
    if (pre[stateIndex]?.accountOwner !== PROGRAM || PublicKey.isOnCurve(P(state).toBytes()))
      throw Error(`pool authority is no longer program-owned/off-curve: ${state}`);
    for (const [index, mint] of [[vaultXIndex, mintX], [vaultYIndex, mintY]]) {
      if (pre[index]?.accountOwner !== String(TOKEN_PROGRAM_ID) ||
        pre[index]?.mint !== mint || pre[index]?.tokenAuthority !== state)
        throw Error(`pool token account changed: ${watch[index]}`);
    }
  }
  for (const index of [1, 2, 3]) {
    if (pre[index]?.accountOwner !== String(TOKEN_PROGRAM_ID) || pre[index]?.tokenAuthority !== wallet)
      throw Error(`audit signer token account unavailable: ${watch[index]}`);
  }
  if (BigInt(pre[0].lamports) < SOL_IN + 10_000_000n) throw Error('audit signer SOL is insufficient');
  const instructions = [
    SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: ata[WSOL], lamports: Number(SOL_IN) }),
    createSyncNativeInstruction(ata[WSOL]),
    swapIx(solSource, ata[WSOL], ata[USDC], SOL_IN),
    swapIx(stableSource, ata[USDC], ata[USDT], STABLE_IN) ];
  const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const message = new TransactionMessage({ payerKey: signer.publicKey,
    recentBlockhash: latest.value.blockhash, instructions }).compileToV0Message();
  if (message.header.numRequiredSignatures !== 1 || String(message.staticAccountKeys[0]) !== wallet)
    throw Error('an uncontrolled signer is required');
  const signed = new VersionedTransaction(message);
  signed.sign([signer]);
  const wire = Buffer.from(signed.serialize());
  if (wire.length > 1232) throw Error(`wire size exceeds Solana packet limit: ${wire.length}`);
  const simulated = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false,
    commitment: 'confirmed', innerInstructions: true,
    accounts: { encoding: 'base64', addresses: watch } }]);
  const post = (simulated.value.accounts || []).map(accountImage);
  const report = {
    observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesisHash: genesis,
    program: PROGRAM, signer: wallet, sourceSignatures: [SOL_SOURCE, STABLE_SOURCE],
    sourceSlots: [solSource.slot, stableSource.slot], preSlot: preRpc.context.slot,
    simulationSlot: simulated.context.slot,
    tx: { version: 0, bytes: wire.length, requiredSignatures: message.header.numRequiredSignatures,
      sigVerify: true, replaceRecentBlockhash: false, instructions: instructions.length,
      sha256: crypto.createHash('sha256').update(wire).digest('hex') },
    intendedInputs: { solWrappedLamports: SOL_IN.toString(), stableUsdcRaw: STABLE_IN.toString() },
    err: simulated.value.err, unitsConsumed: simulated.value.unitsConsumed,
    watch, pre, post,
    deltas: Object.fromEntries(['walletSolLamports', 'walletWsolRaw', 'walletUsdcRaw', 'walletUsdtRaw',
      'solVaultWsolRaw', 'solVaultUsdcRaw', 'stableVaultUsdcRaw', 'stableVaultUsdtRaw']
      .map((name, i) => [name, i === 0 ?
        post[0] ? String(BigInt(post[0].lamports) - BigInt(pre[0].lamports)) : null :
        delta(pre[[0, 1, 2, 3, 5, 6, 8, 9][i]], post[[0, 1, 2, 3, 5, 6, 8, 9][i]])])),
    logs: simulated.value.logs || [] };
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, err: report.err, unitsConsumed: report.unitsConsumed,
    txBytes: wire.length, preSlot: report.preSlot, simulationSlot: report.simulationSlot,
    deltas: report.deltas, logs: report.logs }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
