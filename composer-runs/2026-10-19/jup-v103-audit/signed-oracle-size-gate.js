#!/usr/bin/env node
// Wallet-signed v1 local-fork-only probe. Moves DEX A at the independently quoted
// exit size, reads the same-slot oracle, and records exact token deltas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, SystemProgram} = require(modules + '@solana/web3.js');
const {TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync} = require(modules + '@solana/spl-token');
const {encodeV1} = require('../../2026-10-15/klend-v1-composition.js');
const fork = process.env.V103_FORK || 'http://127.0.0.1:19137';
const P = x => new PublicKey(x);
const secret = Uint8Array.from(JSON.parse(fs.readFileSync('/Users/stacc/hooked.json', 'utf8')));
const signer = Keypair.fromSecretKey(secret);
const X = {
  dexProgram: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
  oracleProgram: P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
  liquidityProgram: P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
  dex: P('G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF'),
  oracle: P('Hf9Yw2a1EA9aTUbHS8N7AoyqXvWrRvsZqGJuC4YVeaXN'),
  source: P('H8i4Bz4inXLyWQFgGjXc8sYNCvQgAaAAS45ZZ4UqCCcV'),
  conversion: P('DXSLbLNfjYrjp4KKoDnLXT5j5Wdcr9hZCGCwpeeyDxZV'),
  center: P('2gFY1YckrZtmK6LiTzTSdq5JbU3SdfZaHzLQoseD1xHu'),
  mint0: P('sUSDai6Y3GxysDEtA9BVcEFTaog6UZpYUVxJiMhAKYE'),
  mint1: P('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  supply0: P('EdRupWtgK6FRjTHCo2TgbjDUGe91oNQno1tG6Vj35fvW'),
  supply1: P('8qXBLcG7hm1NKeAxGbX7kxEy9HhevX4SN6yAmDduQNYk'),
  reserve0: P('2zhomdC3giLb5vf91fCZiKWiFXAD9NwMcV8EQo8NmA3i'),
  reserve1: P('94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu'),
  rate0: P('5BxfXqPPbGwnhSp1wHsTwwqEXVeoKebHMZvyZcxh7U9P'),
  rate1: P('5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688'),
  vault0: P('GzjLtjeaaFBerWrpJx8VXwpXcdzkUFm9zsXgaedsbXsW'),
  vault1: P('BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB'),
  borrow0: P('2hAjymMb6MPSoJ6jm9MZotJuPsFSCYa3eQ3qMysAFZLw'),
  borrow1: P('3RUCn7NZ5Cfh5AeVmGhsk9CL9JxNrymw1EGSkhMJmSJR'),
  liquidity: P('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z'),
};
const user0 = getAssociatedTokenAddressSync(X.mint0, signer.publicKey, false, TOKEN_2022_PROGRAM_ID);
const user1 = getAssociatedTokenAddressSync(X.mint1, signer.publicKey, false, TOKEN_PROGRAM_ID);
let id = 0;
async function rpc(method, params) {
  const response = await fetch(fork, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
  const json = await response.json();
  if (json.error) throw Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({pubkey, isWritable, isSigner});
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const amount = x => x?.data ? Buffer.from(x.data[0], 'base64').readBigUInt64LE(64).toString() : null;
function readU128(b, o) { let x = 0n; for (let i = 15; i >= 0; i--) x = (x << 8n) + BigInt(b[o+i]); return x; }
function oracleRead() {
  return new TransactionInstruction({programId: X.oracleProgram,
    keys: [X.oracle, X.source, X.dex, X.supply0, X.supply1,
      X.reserve0, X.reserve1, X.conversion].map(x => meta(x)),
    data: Buffer.from([92, 88, 161, 46, 230, 193, 46, 237, 100, 0])});
}
function buyExactSUSD(amountOutRaw, maxUsdcInRaw) {
  const k = [meta(signer.publicKey, false, true), meta(X.dex, true), meta(user0, true),
    meta(user1, true), meta(signer.publicKey), meta(user0, true), meta(user1, true),
    meta(X.mint0), meta(X.mint1), meta(X.reserve0, true), meta(X.reserve1, true),
    meta(X.rate0), meta(X.rate1), meta(X.vault0, true), meta(X.vault1, true),
    meta(X.supply0, true), meta(X.supply1, true), meta(X.borrow0, true),
    meta(X.borrow1, true), meta(X.liquidity), meta(X.liquidityProgram),
    meta(TOKEN_2022_PROGRAM_ID), meta(TOKEN_PROGRAM_ID), meta(X.oracleProgram),
    meta(X.center), meta(X.conversion)];
  return new TransactionInstruction({programId: X.dexProgram, keys: k,
    data: Buffer.concat([Buffer.from([206, 36, 149, 14, 163, 132, 148, 1, 0]),
      u64(amountOutRaw), u64(maxUsdcInRaw)])});
}
async function setToken(source, target, mint, tokenProgram, rawAmount) {
  const original = (await rpc('getAccountInfo', [source.toBase58(),
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!original || original.owner !== tokenProgram.toBase58()) throw Error('template token account unavailable');
  const data = Buffer.from(original.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw Error('template mint mismatch');
  signer.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(rawAmount), 64);
  await rpc('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'),
    executable: false, lamports: original.lamports, owner: tokenProgram.toBase58(), rentEpoch: 0}]);
}
async function simulate(label, amountOutRaw, maxUsdcInRaw) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const encoded = encodeV1([oracleRead(), buyExactSUSD(amountOutRaw, maxUsdcInRaw), oracleRead()],
    signer.publicKey, blockhash);
  const wire = Buffer.from(encoded.wire);
  const key = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret.subarray(0, 32))]),
    format: 'der', type: 'pkcs8'});
  crypto.sign(null, wire.subarray(0, wire.length - 64), key).copy(wire, wire.length - 64);
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed',
    accounts: {encoding: 'base64', addresses: [user0, user1].map(String)}}]);
  const prefix = `Program return: ${X.oracleProgram.toBase58()} `;
  const rates = (result.value.logs || []).filter(line => line.startsWith(prefix))
    .map(line => Buffer.from(line.slice(prefix.length), 'base64'))
    .filter(b => b.length >= 32).map(b => ({supplyRateX15: readU128(b, 0).toString(),
      borrowRateX15: readU128(b, 16).toString()}));
  return {label, requestedSUSDaiOutRaw: String(amountOutRaw), maxUsdcInRaw: String(maxUsdcInRaw),
    contextSlot: result.context?.slot || null, err: result.value.err,
    unitsConsumed: result.value.unitsConsumed, wire: {version: 1, bytes: encoded.sizeBytes,
      accounts: encoded.addressCount, instructions: encoded.instructionCount,
      signatures: encoded.requiredSignatures,
      sha256: crypto.createHash('sha256').update(wire).digest('hex')},
    oracleRates: rates, after: {sUSDaiRaw: amount(result.value.accounts?.[0]),
      usdcRaw: amount(result.value.accounts?.[1])},
    failureLogs: result.value.err ? result.value.logs?.slice(-12) : undefined};
}
async function main() {
  await rpc('surfnet_setAccount', [signer.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await setToken(X.vault0, user0, X.mint0, TOKEN_2022_PROGRAM_ID, 0n);
  await setToken(X.vault1, user1, X.mint1, TOKEN_PROGRAM_ID, 10_000_000_000n);
  const tests = [
    ['b_exit_quote_895_659732', 895_659_732n, 1_000_000_000n],
    ['b_upper_bound_3_999', 3_999_000_000n, 5_000_000_000n],
  ];
  const rows = [];
  for (const [label, out, max] of tests) rows.push(await simulate(label, out, max));
  const result = {generatedAt: new Date().toISOString(), scope: 'isolated current mainnet fork only',
    mainnetSubmission: false, sigVerify: true,
    syntheticStarting: {sUSDaiRaw: '0', usdcRaw: '10000000000'},
    signerPublicKey: signer.publicKey.toBase58(), rows};
  fs.writeFileSync(path.join(__dirname, 'signed-oracle-size-gate.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(rows.map(x => ({label: x.label, err: x.err,
    oracleRates: x.oracleRates, after: x.after, wire: x.wire,
    failureLogs: x.failureLogs?.slice(-3)})), null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
