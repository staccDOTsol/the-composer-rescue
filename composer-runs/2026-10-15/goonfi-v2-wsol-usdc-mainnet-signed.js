#!/usr/bin/env node
'use strict';
// Defensive, wallet-signed mainnet-beta simulation. There is no sendTransaction call.
const fs = require('fs');
const crypto = require('crypto');
const MOD = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules';
const { PublicKey, Keypair, SystemProgram, TransactionInstruction, TransactionMessage,
  VersionedTransaction } = require(`${MOD}/@solana/web3.js`);
const { getAssociatedTokenAddressSync, createSyncNativeInstruction, TOKEN_PROGRAM_ID } = require(`${MOD}/@solana/spl-token`);
const bs58 = require(`${MOD}/bs58`);
const P = x => new PublicKey(x), S = x => x.toBase58();
const PROGRAM = 'goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE';
const SOURCE = 'sMjvq1VE5A6iMxWEQfTPzdyG7Qmast6PK4GAD3HjesC6vxFLc5ZDeysaG12kMXNQbuvjc7hUN5Ly3Q9JntQNLgt';
const REVERSE_SOURCE = '4RK6fKuenDmQ5eUschoZpp6nHpyPpABS5JwbiJmH9KM6em8ujB2EWRg5F5kocDyRKhab6Nbk68VzmYfWwDHKMe7y';
const AUTHORITY = 'GMCJvYGf5Ex2ARiMquaBDqU6iKM8uiEQkB8jCnoNfHpC';
const VAULT_WSOL = '8ncU5YW1CQwvr4gs7buH57bW58e86TDau4STrCJBuz8z';
const VAULT_USDC = 'EunHLeqeJKvxnCPQSytnBP63HJVk2fbHceiKKpngyAo8';
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const INPUT = 5_000_000n; // 0.005 wSOL; a bounded gate test, not an exploit-size attempt.
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8'))));
const env = Object.fromEntries(fs.readFileSync('/tmp/composer-helius-only.env', 'utf8')
  .split(/\r?\n/).filter(Boolean).map(x => x.split(/=(.*)/s).slice(0, 2)));
const endpoint = env.HEAVY_RPC_URL || env.RPC_URL;
if (!endpoint) throw Error('RPC endpoint unavailable');
let id = 0;
async function rpc(method, params = []) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const result = await response.json();
  if (result.error) throw Error(method + ': ' + JSON.stringify(result.error));
  return result.result;
}
function assert(condition, message) { if (!condition) throw Error('validation: ' + message); }
function image(account) {
  if (!account) return null;
  const data = Buffer.from(account.data[0], 'base64');
  const token = account.owner === S(TOKEN_PROGRAM_ID) && data.length >= 165;
  return { accountOwner: account.owner, lamports: account.lamports, dataLength: data.length,
    mint: token ? S(P(data.subarray(0, 32))) : null,
    tokenAuthority: token ? S(P(data.subarray(32, 64))) : null,
    raw: token ? data.readBigUInt64LE(64).toString() : null,
    sha256: crypto.createHash('sha256').update(data).digest('hex') };
}
function delta(a, b) { return a?.raw != null && b?.raw != null ? (BigInt(b.raw) - BigInt(a.raw)).toString() : null; }
async function main() {
  const [genesis, source, reverseSource, recent] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getTransaction', [SOURCE, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]),
    rpc('getTransaction', [REVERSE_SOURCE, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]),
    rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]) ]);
  assert(genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'not mainnet-beta');
  assert(source && !source.meta.err, 'historical successful source transaction');
  const sm = source.transaction.message, loaded = source.meta.loadedAddresses || { writable: [], readonly: [] };
  const sourceKeys = [...sm.accountKeys, ...loaded.writable, ...loaded.readonly];
  const original = (source.meta.innerInstructions || []).flatMap(g => g.instructions)
    .find(ix => sourceKeys[ix.programIdIndex] === PROGRAM && ix.accounts.length === 14 &&
      sourceKeys[ix.accounts[1]] === AUTHORITY && sourceKeys[ix.accounts[4]] === VAULT_WSOL &&
      sourceKeys[ix.accounts[5]] === VAULT_USDC);
  assert(original, 'matching historical public swap shape');
  const originalData = Buffer.from(bs58.decode(original.data));
  assert(originalData.length === 19 && originalData[0] === 1 && originalData[1] === 1,
    'historical pool direction and payload shape: ' + originalData.length + '/' + originalData[0] + '/' + originalData[1]);
  assert(reverseSource && !reverseSource.meta.err, 'historical reverse source');
  const rm = reverseSource.transaction.message, rl = reverseSource.meta.loadedAddresses || { writable: [], readonly: [] };
  const rk = [...rm.accountKeys, ...rl.writable, ...rl.readonly];
  const reverseIx = (reverseSource.meta.innerInstructions || []).flatMap(g => g.instructions)
    .find(ix => rk[ix.programIdIndex] === PROGRAM && ix.accounts.length === 13);
  assert(reverseIx, 'historical reverse swap shape');
  const data = Buffer.from(bs58.decode(reverseIx.data));
  assert(data.length === 18 && data[0] === 1 && data[1] === 0, 'historical reverse direction and payload shape');
  // The observed direction=1 swaps USDC for wSOL. Direction=0 is the bounded
  // wallet-funded reverse probe; it may reject if the contract disallows it.
  data.writeBigUInt64LE(INPUT, 2); data.writeBigUInt64LE(1n, 10);
  const ataWsol = getAssociatedTokenAddressSync(P(WSOL), wallet.publicKey);
  const ataUsdc = getAssociatedTokenAddressSync(P(USDC), wallet.publicKey);
  const watch = [S(wallet.publicKey), S(ataWsol), S(ataUsdc), PROGRAM, AUTHORITY, VAULT_WSOL, VAULT_USDC];
  const preRpc = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const pre = preRpc.value.map(image);
  assert(pre[3]?.accountOwner === 'BPFLoaderUpgradeab1e11111111111111111111111', 'program loader');
  assert(preRpc.value[3].executable, 'executable program');
  assert(pre[4]?.accountOwner === PROGRAM && !PublicKey.isOnCurve(P(AUTHORITY).toBytes()), 'off-curve program-owned authority');
  assert(pre[5]?.accountOwner === S(TOKEN_PROGRAM_ID) && pre[5].mint === WSOL &&
    pre[5].tokenAuthority === AUTHORITY && BigInt(pre[5].raw) > INPUT, 'wSOL vault authority and balance');
  assert(pre[6]?.accountOwner === S(TOKEN_PROGRAM_ID) && pre[6].mint === USDC &&
    pre[6].tokenAuthority === AUTHORITY && BigInt(pre[6].raw) > 0n, 'USDC vault authority and balance');
  assert(pre[1]?.accountOwner === S(TOKEN_PROGRAM_ID) && pre[1].mint === WSOL &&
    pre[1].tokenAuthority === S(wallet.publicKey), 'wallet wSOL ATA');
  assert(pre[2]?.accountOwner === S(TOKEN_PROGRAM_ID) && pre[2].mint === USDC &&
    pre[2].tokenAuthority === S(wallet.publicKey), 'wallet USDC ATA');
  assert(pre[0]?.lamports > Number(INPUT + 10_000_000n), 'wallet has SOL for bounded wrap');
  const poolState = Buffer.from(preRpc.value[4].data[0], 'base64');
  assert(poolState.length === 2048 &&
    P(poolState.subarray(80, 112)).equals(P(WSOL)) && P(poolState.subarray(112, 144)).equals(P(USDC)) &&
    P(poolState.subarray(144, 176)).equals(P(VAULT_WSOL)) && P(poolState.subarray(176, 208)).equals(P(VAULT_USDC)),
    'pool state binds mints and vaults');
  const programDataKey = S(P(Buffer.from(preRpc.value[3].data[0], 'base64').subarray(4, 36)));
  const programData = await rpc('getAccountInfo', [programDataKey, { encoding: 'base64', commitment: 'confirmed',
    dataSlice: { offset: 0, length: 12 } }]);
  const lastDeploySlot = Number(Buffer.from(programData.value.data[0], 'base64').readBigUInt64LE(4));
  assert(source.slot > lastDeploySlot && reverseSource.slot > lastDeploySlot,
    'source transactions postdate current deploy');
  const originalKeys = original.accounts.map(j => P(sourceKeys[j]));
  const keys = originalKeys.map((pubkey, i) => ({ pubkey: [0, 2, 3].includes(i) ?
    (i === 0 ? wallet.publicKey : i === 2 ? ataWsol : ataUsdc) : pubkey,
    isSigner: i === 0, isWritable: i < 6 }));
  assert(S(keys[1].pubkey) === AUTHORITY && S(keys[4].pubkey) === VAULT_WSOL &&
    S(keys[5].pubkey) === VAULT_USDC, 'instruction pool account order');
  const instructions = [
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: ataWsol, lamports: Number(INPUT) }),
    createSyncNativeInstruction(ataWsol),
    new TransactionInstruction({ programId: P(PROGRAM), keys, data }) ];
  const message = new TransactionMessage({ payerKey: wallet.publicKey,
    recentBlockhash: recent.value.blockhash, instructions }).compileToV0Message();
  assert(message.header.numRequiredSignatures === 1, 'only outsider wallet signs');
  const signed = new VersionedTransaction(message); signed.sign([wallet]);
  const wire = Buffer.from(signed.serialize());
  assert(wire.length <= 1232 && message.staticAccountKeys.length <= 64, 'v0 packet bounds');
  const simulation = await rpc('simulateTransaction', [wire.toString('base64'), {
    encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed',
    innerInstructions: true, accounts: { encoding: 'base64', addresses: watch } }]);
  const simulatedPost = (simulation.value.accounts || []).map(image);
  const chainAfter = await rpc('getMultipleAccounts', [watch, { encoding: 'base64', commitment: 'confirmed' }]);
  const actualPost = chainAfter.value.map(image);
  const report = { observedAtUtc: new Date().toISOString(), network: 'mainnet-beta', genesis,
    program: PROGRAM, programData: programDataKey, lastDeploySlot, sourceSignature: SOURCE, sourceSlot: source.slot,
    reverseSourceSignature: REVERSE_SOURCE, reverseSourceSlot: reverseSource.slot,
    signer: S(wallet.publicKey), poolAuthority: AUTHORITY, exactPdaSeedsKnown: false,
    poolStateBindings: { wsolMintOffset: 80, usdcMintOffset: 112, wsolVaultOffset: 144, usdcVaultOffset: 176 },
    watch, preSlot: preRpc.context.slot, pre, simulationSlot: simulation.context.slot,
    packet: { version: 0, bytes: wire.length, accountKeys: message.staticAccountKeys.length,
      requiredSignatures: message.header.numRequiredSignatures, sigVerify: true,
      sha256: crypto.createHash('sha256').update(wire).digest('hex'),
      instructions: ['wallet wrap wSOL', 'sync native', 'GoonFi swap direction 0'], inputRawWsol: INPUT.toString() },
    simulation: { err: simulation.value.err, unitsConsumed: simulation.value.unitsConsumed,
      logs: simulation.value.logs, simulatedPost,
      deltas: { walletWsolRaw: delta(pre[1], simulatedPost[1]), walletUsdcRaw: delta(pre[2], simulatedPost[2]),
        poolWsolRaw: delta(pre[5], simulatedPost[5]), poolUsdcRaw: delta(pre[6], simulatedPost[6]) } },
    actualPostSlot: chainAfter.context.slot, actualPost,
    actualPoolDeltas: { wsolRaw: delta(pre[5], actualPost[5]), usdcRaw: delta(pre[6], actualPost[6]) },
    mainnetSubmitted: false };
  fs.writeFileSync(__dirname + '/goonfi-v2-wsol-usdc-mainnet-signed.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: 'goonfi-v2-wsol-usdc-mainnet-signed.json',
    preSlot: report.preSlot, simulationSlot: report.simulationSlot, poolWsolRaw: pre[5].raw,
    poolUsdcRaw: pre[6].raw, sourceSlot: source.slot, lastDeploySlot, packet: report.packet,
    error: report.simulation.err, deltas: report.simulation.deltas, actualPoolDeltas: report.actualPoolDeltas,
    logs: report.simulation.logs.filter(x => x.includes(PROGRAM) || x.includes('failed') || x.includes('Error')) }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
